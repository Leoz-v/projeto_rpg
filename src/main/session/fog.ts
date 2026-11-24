import {
  applyFogCells,
  applyFogRect,
  computePlayerVision,
  decodeFogBits,
  emptyFogBits,
  encodeFogBits,
  fogBitsEqual,
  fullFogBits,
  hasAnyFogBit,
  type GameMap,
  type IntentData,
  type PatchOp,
  type Token,
  toPointer,
  unionFogBits,
} from '../../shared/protocol';
import { type SessionContext, violation } from './context';

/** Névoa de guerra (nota 0056): ações do mestre e atualização automática da memória explorada. */

function requireCellInside(map: GameMap, cell: { x: number; y: number }): void {
  if (cell.x < 0 || cell.x >= map.width || cell.y < 0 || cell.y >= map.height) {
    throw violation('Célula fora do mapa');
  }
}

/**
 * Atualiza `map.fog.explored` para os jogadores afetados quando a névoa automática
 * e a memória explorada estão ativas. Células cobertas pela névoa manual nunca
 * entram na memória até serem reveladas pelo mestre.
 */
export function recordExploredOps(map: GameMap, tokens: readonly Token[], playerIds?: readonly string[]): PatchOp[] {
  if (!map.fog.autoEnabled || !map.fog.rememberExplored) return [];
  const targets = new Set<string>();
  if (playerIds) {
    for (const id of playerIds) targets.add(id);
  } else {
    for (const token of tokens) {
      if (token.mapId !== map.id) continue;
      for (const ownerId of token.ownerIds) targets.add(ownerId);
    }
  }
  const ops: PatchOp[] = [];
  for (const playerId of targets) {
    const vision = computePlayerVision(map, tokens, playerId);
    const existing = map.fog.explored[playerId];
    const prev = existing !== undefined ? decodeFogBits(existing, map.width, map.height) : emptyFogBits(map.width, map.height);
    const next = unionFogBits(prev, vision);
    if (existing === undefined) {
      if (hasAnyFogBit(next)) {
        ops.push({ op: 'add', path: toPointer('maps', map.id, 'fog', 'explored', playerId), value: encodeFogBits(next) });
      }
    } else if (!fogBitsEqual(prev, next)) {
      ops.push({ op: 'replace', path: toPointer('maps', map.id, 'fog', 'explored', playerId), value: encodeFogBits(next) });
    }
  }
  return ops;
}

export function paintManualFog(ctx: SessionContext, data: IntentData<'fog.manual.paint'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  for (const cell of data.cells) requireCellInside(map, cell);
  const current = decodeFogBits(map.fog.manual, map.width, map.height);
  const nextManual = encodeFogBits(applyFogCells(current, map.width, map.height, data.cells, data.mode === 'cover'));
  const ops: PatchOp[] = [{ op: 'replace', path: toPointer('maps', map.id, 'fog', 'manual'), value: nextManual }];
  if (data.mode === 'reveal') {
    const updatedMap: GameMap = { ...map, fog: { ...map.fog, manual: nextManual } };
    ops.push(...recordExploredOps(updatedMap, Object.values(ctx.current.tokens)));
  }
  return ops;
}

export function rectManualFog(ctx: SessionContext, data: IntentData<'fog.manual.rect'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  requireCellInside(map, data.from);
  requireCellInside(map, data.to);
  const current = decodeFogBits(map.fog.manual, map.width, map.height);
  const nextManual = encodeFogBits(applyFogRect(current, map.width, map.height, data.from, data.to, data.mode === 'cover'));
  const ops: PatchOp[] = [{ op: 'replace', path: toPointer('maps', map.id, 'fog', 'manual'), value: nextManual }];
  if (data.mode === 'reveal') {
    const updatedMap: GameMap = { ...map, fog: { ...map.fog, manual: nextManual } };
    ops.push(...recordExploredOps(updatedMap, Object.values(ctx.current.tokens)));
  }
  return ops;
}

export function fillManualFog(ctx: SessionContext, data: IntentData<'fog.manual.fill'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const bits = data.mode === 'cover' ? fullFogBits(map.width, map.height) : emptyFogBits(map.width, map.height);
  const nextManual = encodeFogBits(bits);
  const ops: PatchOp[] = [{ op: 'replace', path: toPointer('maps', map.id, 'fog', 'manual'), value: nextManual }];
  if (data.mode === 'reveal') {
    const updatedMap: GameMap = { ...map, fog: { ...map.fog, manual: nextManual } };
    ops.push(...recordExploredOps(updatedMap, Object.values(ctx.current.tokens)));
  }
  return ops;
}

export function configureFog(ctx: SessionContext, data: IntentData<'fog.config'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const ops: PatchOp[] = [];
  const nextFog = { ...map.fog };
  if (data.autoEnabled !== undefined) {
    nextFog.autoEnabled = data.autoEnabled;
    ops.push({ op: 'replace', path: toPointer('maps', map.id, 'fog', 'autoEnabled'), value: data.autoEnabled });
  }
  if (data.visionFeet !== undefined) {
    nextFog.visionFeet = data.visionFeet;
    ops.push({ op: 'replace', path: toPointer('maps', map.id, 'fog', 'visionFeet'), value: data.visionFeet });
  }
  if (data.rememberExplored !== undefined) {
    nextFog.rememberExplored = data.rememberExplored;
    ops.push({ op: 'replace', path: toPointer('maps', map.id, 'fog', 'rememberExplored'), value: data.rememberExplored });
  }
  ops.push(...recordExploredOps({ ...map, fog: nextFog }, Object.values(ctx.current.tokens)));
  return ops;
}

export function clearFogMemory(ctx: SessionContext, data: IntentData<'fog.memory.clear'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  if (data.playerId !== undefined) {
    if (ctx.current.players[data.playerId] === undefined) throw violation('Jogador não encontrado');
    if (map.fog.explored[data.playerId] === undefined) return [];
    return [{ op: 'remove', path: toPointer('maps', map.id, 'fog', 'explored', data.playerId) }];
  }
  return [{ op: 'replace', path: toPointer('maps', map.id, 'fog', 'explored'), value: {} }];
}

export function setTokenVision(ctx: SessionContext, data: IntentData<'token.vision'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  const map = ctx.map(token.mapId);
  const ops: PatchOp[] = [{ op: 'replace', path: toPointer('tokens', token.id, 'visionFeet'), value: data.visionFeet }];
  if (token.ownerIds.length > 0) {
    const tokens = Object.values(ctx.current.tokens).map((t) => (t.id === token.id ? { ...t, visionFeet: data.visionFeet } : t));
    ops.push(...recordExploredOps(map, tokens, token.ownerIds));
  }
  return ops;
}
