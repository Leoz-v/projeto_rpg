import { spaceSquares } from 'rules-engine';
import {
  DOOR_INTERACT_CELLS,
  type GameMap,
  type IntentData,
  MAX_MAP_WALLS,
  type NewWallSegment,
  type PatchOp,
  pointToSegmentDistance,
  type Role,
  type WallSegment,
  WORLD_UNITS_PER_CELL,
  toPointer,
} from '../../shared/protocol';
import { notAllowed, type SessionContext, violation } from './context';
import { recordExploredOps } from './fog';

/** Paredes, portas e janelas do mapa: validação e ações no executor da sessão (nota 0081). */

function validateSegment(map: GameMap, w: Pick<WallSegment, 'x1' | 'y1' | 'x2' | 'y2'>): void {
  if (w.x1 < 0 || w.x1 > map.width || w.x2 < 0 || w.x2 > map.width || w.y1 < 0 || w.y1 > map.height || w.y2 < 0 || w.y2 > map.height) {
    throw violation('Segmento de parede fora dos limites do mapa');
  }
  if (Math.hypot(w.x2 - w.x1, w.y2 - w1y(w)) < 0.05) {
    throw violation('Segmento de parede muito curto');
  }
}

function w1y(w: Pick<WallSegment, 'y1'>): number {
  return w.y1;
}

function buildWallSegment(ctx: SessionContext, map: GameMap, input: NewWallSegment): WallSegment {
  validateSegment(map, input);
  return {
    id: ctx.deps.newId(),
    x1: input.x1,
    y1: input.y1,
    x2: input.x2,
    y2: input.y2,
    kind: input.kind,
    open: input.open ?? false,
    locked: input.locked ?? false,
    layer: input.layer ?? 'surface',
    ...(input.heightFeet !== undefined ? { heightFeet: input.heightFeet } : {}),
    source: input.source ?? 'manual',
  };
}

export function addWalls(ctx: SessionContext, data: IntentData<'wall.add'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  if (map.walls.length + data.walls.length > MAX_MAP_WALLS) {
    throw violation(`Limite de ${MAX_MAP_WALLS} paredes por mapa atingido`);
  }
  const added = data.walls.map((w) => buildWallSegment(ctx, map, w));
  return [{ op: 'replace', path: toPointer('maps', map.id, 'walls'), value: [...map.walls, ...added] }];
}

export function updateWall(ctx: SessionContext, data: IntentData<'wall.update'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const index = map.walls.findIndex((w) => w.id === data.wallId);
  const existing = map.walls[index];
  if (!existing) throw violation('Parede não encontrada');

  const next: WallSegment = {
    id: existing.id,
    x1: data.x1 ?? existing.x1,
    y1: data.y1 ?? existing.y1,
    x2: data.x2 ?? existing.x2,
    y2: data.y2 ?? existing.y2,
    kind: data.kind ?? existing.kind,
    open: data.open ?? existing.open,
    locked: data.locked ?? existing.locked,
    layer: data.layer ?? existing.layer,
    ...(data.heightFeet === null
      ? {}
      : data.heightFeet !== undefined
        ? { heightFeet: data.heightFeet }
        : existing.heightFeet !== undefined
          ? { heightFeet: existing.heightFeet }
          : {}),
    source: existing.source,
  };
  validateSegment(map, next);
  const nextWalls = map.walls.map((w, i) => (i === index ? next : w));
  return [
    { op: 'replace', path: toPointer('maps', map.id, 'walls'), value: nextWalls },
    ...recordExploredOps(ctx, { ...map, walls: nextWalls }, Object.values(ctx.current.tokens)),
  ];
}

export function removeWalls(ctx: SessionContext, data: IntentData<'wall.remove'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const removeSet = new Set(data.wallIds);
  const nextWalls = map.walls.filter((w) => !removeSet.has(w.id));
  if (nextWalls.length === map.walls.length) return [];
  return [
    { op: 'replace', path: toPointer('maps', map.id, 'walls'), value: nextWalls },
    ...recordExploredOps(ctx, { ...map, walls: nextWalls }, Object.values(ctx.current.tokens)),
  ];
}

export function replaceWalls(ctx: SessionContext, data: IntentData<'wall.replace'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const kept =
    data.scope === 'all'
      ? []
      : map.walls.filter((w) => w.source !== data.scope);
  if (kept.length + data.walls.length > MAX_MAP_WALLS) {
    throw violation(`Limite de ${MAX_MAP_WALLS} paredes por mapa atingido`);
  }
  const inserted = data.walls.map((w) => buildWallSegment(ctx, map, w));
  const nextWalls = [...kept, ...inserted];
  return [
    { op: 'replace', path: toPointer('maps', map.id, 'walls'), value: nextWalls },
    ...recordExploredOps(ctx, { ...map, walls: nextWalls }, Object.values(ctx.current.tokens)),
  ];
}

export function toggleDoor(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'door.toggle'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const index = map.walls.findIndex((w) => w.id === data.wallId);
  const door = map.walls[index];
  if (!door) throw violation('Porta não encontrada');
  if (door.kind !== 'door') throw violation('Este segmento não é uma porta');

  if (role !== 'gm') {
    if (door.locked) throw notAllowed('Esta porta está trancada');
    const near = Object.values(ctx.current.tokens).some((t) => {
      if (t.mapId !== map.id || !ctx.controls(playerId, t)) return false;
      const side = spaceSquares(t.size);
      const center = {
        x: t.position.x / WORLD_UNITS_PER_CELL + side * 0.5,
        y: t.position.y / WORLD_UNITS_PER_CELL + side * 0.5,
      };
      return pointToSegmentDistance(center, door) <= DOOR_INTERACT_CELLS + side * 0.5;
    });
    if (!near) throw notAllowed('Aproxime seu token para abrir ou fechar esta porta');
  }

  const nextWalls = map.walls.map((w, i) => (i === index ? { ...w, open: !w.open } : w));
  const ops: PatchOp[] = [{ op: 'replace', path: toPointer('maps', map.id, 'walls'), value: nextWalls }];
  if (!door.open) {
    ops.push(...recordExploredOps(ctx, { ...map, walls: nextWalls }, Object.values(ctx.current.tokens)));
  }
  return ops;
}
