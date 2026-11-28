import { spaceSquares } from 'rules-engine';
import {
  extractPropLightsFrom3dMapDocument,
  type GameMap,
  type IntentData,
  type LightAttachment,
  LIGHT_INTERACT_CELLS,
  type MapLightSource,
  MAX_MAP_LIGHTS,
  MAX_PROP_LIGHT_OVERRIDES,
  type PatchOp,
  type PropLightOverrides,
  sameSpellLink,
  type SpellLink,
  type Role,
  toPointer,
  WORLD_UNITS_PER_CELL,
} from '../../shared/protocol';
import { notAllowed, type SessionContext, violation } from './context';

/** Iluminação dinâmica em tempo de execução: ambiente, luzes e overrides de tochas 3D (nota 0061). */

function validateAttachment(ctx: SessionContext, map: GameMap, attach: LightAttachment, playerId: string, role: Role): void {
  if (attach.kind === 'point') {
    if (attach.x < 0 || attach.x > map.width || attach.y < 0 || attach.y > map.height) {
      throw violation('Posição da luz fora dos limites do mapa');
    }
    return;
  }
  const token = ctx.token(attach.tokenId);
  if (token.mapId !== map.id) throw violation('O token precisa estar neste mapa');
  if (role !== 'gm' && !ctx.controls(playerId, token)) {
    throw notAllowed('Você não controla este token');
  }
}

function canManageLight(ctx: SessionContext, light: MapLightSource, playerId: string, role: Role): boolean {
  if (role === 'gm') return true;
  if (light.ownerId === playerId) return true;
  if (light.attach.kind === 'token') {
    const token = ctx.current.tokens[light.attach.tokenId];
    if (token && ctx.controls(playerId, token)) return true;
  }
  if (light.spell) {
    if ('characterId' in light.spell) {
      const ch = ctx.current.characters[light.spell.characterId];
      if (ch && ch.ownerId === playerId) return true;
    } else {
      const token = ctx.current.tokens[light.spell.tokenId];
      if (token && ctx.controls(playerId, token)) return true;
    }
  }
  return false;
}

export function configureLighting(ctx: SessionContext, data: IntentData<'lighting.config'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const next = {
    environment: data.environment ?? map.lighting.environment,
    timeOfDay: data.timeOfDay ?? map.lighting.timeOfDay,
    ambientOverride: data.ambientOverride === undefined ? map.lighting.ambientOverride : data.ambientOverride,
  };
  return [{ op: 'replace', path: toPointer('maps', map.id, 'lighting'), value: next }];
}

export function addLight(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'light.add'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  if (map.lights.length >= MAX_MAP_LIGHTS) {
    throw violation(`Limite de ${MAX_MAP_LIGHTS} fontes de luz por mapa atingido`);
  }
  const input = data.light;
  validateAttachment(ctx, map, input.attach, playerId, role);
  if (input.spell) {
    if ('characterId' in input.spell) ctx.ownCharacter(playerId, role, input.spell.characterId);
    else if (role !== 'gm' && !ctx.controls(playerId, ctx.token(input.spell.tokenId))) throw notAllowed('Você não controla este token');
  }
  const light: MapLightSource = {
    id: ctx.deps.newId(),
    name: input.name,
    kind: input.kind,
    enabled: input.enabled ?? true,
    brightFeet: input.brightFeet ?? (input.kind === 'light' ? 20 : 0),
    dimFeet: input.dimFeet ?? (input.kind === 'light' ? 20 : 0),
    darknessFeet: input.darknessFeet ?? (input.kind === 'darkness' ? 15 : 0),
    spellLevel: input.spellLevel ?? null,
    angleDeg: input.angleDeg ?? 360,
    directionDeg: input.directionDeg ?? 0,
    color: input.color ?? (input.kind === 'darkness' ? '#000000' : '#ff9442'),
    flicker: input.flicker ?? false,
    layer: input.layer ?? 'surface',
    elevationFeet: input.elevationFeet ?? 5,
    attach: input.attach,
    ownerId: role === 'gm' ? null : playerId,
    ...(input.spell ? { spell: input.spell } : {}),
    ...(input.itemInstanceId !== undefined ? { itemInstanceId: input.itemInstanceId } : {}),
  };
  return [{ op: 'replace', path: toPointer('maps', map.id, 'lights'), value: [...map.lights, light] }];
}

export function updateLight(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'light.update'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const index = map.lights.findIndex((l) => l.id === data.lightId);
  const existing = map.lights[index];
  if (!existing) throw violation('Fonte de luz não encontrada');
  if (!canManageLight(ctx, existing, playerId, role)) {
    throw notAllowed('Você não pode alterar esta fonte de luz');
  }
  if (data.attach !== undefined) {
    validateAttachment(ctx, map, data.attach, playerId, role);
  }
  const next: MapLightSource = {
    ...existing,
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    ...(data.brightFeet !== undefined ? { brightFeet: data.brightFeet } : {}),
    ...(data.dimFeet !== undefined ? { dimFeet: data.dimFeet } : {}),
    ...(data.darknessFeet !== undefined ? { darknessFeet: data.darknessFeet } : {}),
    ...(data.spellLevel !== undefined ? { spellLevel: data.spellLevel } : {}),
    ...(data.angleDeg !== undefined ? { angleDeg: data.angleDeg } : {}),
    ...(data.directionDeg !== undefined ? { directionDeg: data.directionDeg } : {}),
    ...(data.color !== undefined ? { color: data.color } : {}),
    ...(data.flicker !== undefined ? { flicker: data.flicker } : {}),
    ...(data.layer !== undefined ? { layer: data.layer } : {}),
    ...(data.elevationFeet !== undefined ? { elevationFeet: data.elevationFeet } : {}),
    ...(data.attach !== undefined ? { attach: data.attach } : {}),
  };
  const nextLights = map.lights.map((l, i) => (i === index ? next : l));
  return [{ op: 'replace', path: toPointer('maps', map.id, 'lights'), value: nextLights }];
}

export function toggleLight(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'light.toggle'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const index = map.lights.findIndex((l) => l.id === data.lightId);
  const existing = map.lights[index];
  if (!existing) throw violation('Fonte de luz não encontrada');
  if (!canManageLight(ctx, existing, playerId, role)) {
    throw notAllowed('Você não pode alterar esta fonte de luz');
  }
  const nextLights = map.lights.map((l, i) => (i === index ? { ...l, enabled: !l.enabled } : l));
  return [{ op: 'replace', path: toPointer('maps', map.id, 'lights'), value: nextLights }];
}

export function removeLight(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'light.remove'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  const existing = map.lights.find((l) => l.id === data.lightId);
  if (!existing) throw violation('Fonte de luz não encontrada');
  if (!canManageLight(ctx, existing, playerId, role)) {
    throw notAllowed('Você não pode remover esta fonte de luz');
  }
  const nextLights = map.lights.filter((l) => l.id !== data.lightId);
  return [{ op: 'replace', path: toPointer('maps', map.id, 'lights'), value: nextLights }];
}

export function setMapPropLight(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'map_prop_light.set'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  if (role !== 'gm') {
    if (!map.scene3d || !ctx.deps.readAsset) {
      throw notAllowed('Sem informações do mapa 3D para interagir com esta fonte de luz');
    }
    const bytes = ctx.deps.readAsset(map.scene3d);
    if (!bytes) throw violation('Documento do mapa 3D não encontrado');
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw violation('Documento do mapa 3D inválido');
    }
    const propLight = extractPropLightsFrom3dMapDocument(parsed).find((p) => p.id === data.propLightId);
    if (!propLight) throw violation('Fonte de luz do mapa não encontrada');

    const near = Object.values(ctx.current.tokens).some((t) => {
      if (t.mapId !== map.id || !ctx.controls(playerId, t)) return false;
      const side = spaceSquares(t.size);
      const cx = t.position.x / WORLD_UNITS_PER_CELL + side * 0.5;
      const cy = t.position.y / WORLD_UNITS_PER_CELL + side * 0.5;
      return Math.hypot(cx - propLight.x, cy - propLight.y) <= LIGHT_INTERACT_CELLS + side * 0.5;
    });
    if (!near) throw notAllowed('Aproxime seu token para interagir com esta fonte de luz');
  }

  const next: PropLightOverrides = { ...map.propLightOverrides };
  if (data.state === 'on') {
    if (!(data.propLightId in next)) return [];
    const entries = Object.entries(next).filter(([k]) => k !== data.propLightId);
    return [{ op: 'replace', path: toPointer('maps', map.id, 'propLightOverrides'), value: Object.fromEntries(entries) }];
  }
  if (!(data.propLightId in next) && Object.keys(next).length >= MAX_PROP_LIGHT_OVERRIDES) {
    throw violation(`Limite de ${MAX_PROP_LIGHT_OVERRIDES} overrides de luz por mapa atingido`);
  }
  next[data.propLightId] = data.state;
  return [{ op: 'replace', path: toPointer('maps', map.id, 'propLightOverrides'), value: next }];
}

/** Remove luzes presas a um token removido do mapa. */
export function removeTokenLights(ctx: SessionContext, tokenId: string): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const map of Object.values(ctx.current.maps)) {
    const nextLights = map.lights.filter((l) => !(l.attach.kind === 'token' && l.attach.tokenId === tokenId));
    if (nextLights.length !== map.lights.length) {
      ops.push({ op: 'replace', path: toPointer('maps', map.id, 'lights'), value: nextLights });
    }
  }
  return ops;
}

/** Remove luzes ou zonas de escuridão mágica ligadas a uma magia cuja Concentração terminou. */
export function removeSpellLights(ctx: SessionContext, link: SpellLink): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const map of Object.values(ctx.current.maps)) {
    const nextLights = map.lights.filter(
      (l) => !sameSpellLink(l.spell, link),
    );
    if (nextLights.length !== map.lights.length) {
      ops.push({ op: 'replace', path: toPointer('maps', map.id, 'lights'), value: nextLights });
    }
  }
  return ops;
}
