import {
  applyFogCells,
  applyFogRect,
  computeMapLightGrid,
  computePlayerVisionGrid,
  computeTokenVisionGrid,
  decodeFogBits,
  emptyFogBits,
  encodeFogBits,
  fogBitsEqual,
  fullFogBits,
  hasAnyFogBit,
  type GameMap,
  type IntentData,
  type PatchOp,
  type SessionState,
  type Token,
  toPointer,
  unionFogBits,
} from '../../shared/protocol';
import { type SessionContext, violation } from './context';
import { isTokenControlledBy } from './vision';

/** Névoa de guerra (nota 0056 + nota 0081): ações do mestre e memória explorada com oclusão, luz e sentidos da ficha. */

function requireCellInside(map: GameMap, cell: { x: number; y: number }): void {
  if (cell.x < 0 || cell.x >= map.width || cell.y < 0 || cell.y >= map.height) {
    throw violation('Célula fora do mapa');
  }
}

function tokenPlayerOwners(state: SessionState, token: Token): string[] {
  const charOwner = token.characterId !== null ? state.characters[token.characterId]?.ownerId : undefined;
  return charOwner !== undefined && !token.ownerIds.includes(charOwner)
    ? [...token.ownerIds, charOwner]
    : [...token.ownerIds];
}

/**
 * Atualiza `map.fog.explored` para os jogadores (ou tokens sem dono, para pré-visualização
 * do mestre) usando o solver ocluído (paredes, luz e `VisionProfile` da ficha/monstro).
 * Células cobertas pela névoa manual nunca entram na memória até serem reveladas pelo mestre.
 */
export function recordExploredOps(
  ctx: SessionContext,
  map: GameMap,
  tokens: readonly Token[],
  targetIds?: readonly string[],
  stateOverride?: SessionState,
): PatchOp[] {
  if (!map.fog.autoEnabled || !map.fog.rememberExplored) return [];
  const state = stateOverride ?? ctx.current;
  const manualFogBits = decodeFogBits(map.fog.manual, map.width, map.height);
  const scene = ctx.vision.sceneFor(map);
  const playerTargets = new Set<string>();
  const unownedTokenTargets = new Map<string, Token>();

  const allowed = targetIds ? new Set(targetIds) : undefined;
  for (const token of tokens) {
    if (token.mapId !== map.id) continue;
    const owners = tokenPlayerOwners(state, token);
    if (owners.length > 0) {
      for (const ownerId of owners) {
        if (!allowed || allowed.has(ownerId)) playerTargets.add(ownerId);
      }
    } else if (!allowed || allowed.has(token.id)) {
      unownedTokenTargets.set(token.id, token);
    }
  }

  if (playerTargets.size === 0 && unownedTokenTargets.size === 0) return [];

  const lightGrid = computeMapLightGrid(map, tokens, {
    heightfield: scene.heightfield,
    bakedPropLights: scene.bakedPropLights,
  });

  const ops: PatchOp[] = [];
  const appendForKey = (key: string, vision: Uint8Array): void => {
    const existing = map.fog.explored[key];
    const prev = existing !== undefined ? decodeFogBits(existing, map.width, map.height) : emptyFogBits(map.width, map.height);
    const next = unionFogBits(prev, vision);
    if (existing === undefined) {
      if (hasAnyFogBit(next)) {
        ops.push({ op: 'add', path: toPointer('maps', map.id, 'fog', 'explored', key), value: encodeFogBits(next) });
      }
    } else if (!fogBitsEqual(prev, next)) {
      ops.push({ op: 'replace', path: toPointer('maps', map.id, 'fog', 'explored', key), value: encodeFogBits(next) });
    }
  };

  for (const playerId of playerTargets) {
    const grid = computePlayerVisionGrid(
      map,
      tokens,
      (t) => ctx.vision.profileFor(state, state.tokens[t.id] ?? (t as Token), map),
      (t) => isTokenControlledBy(t, state.characters, playerId),
      { lightGrid, manualFogBits, heightfield: scene.heightfield },
    );
    appendForKey(playerId, grid.seenBits);
  }
  for (const [tokenId, token] of unownedTokenTargets) {
    const grid = computeTokenVisionGrid(map, token, ctx.vision.profileFor(state, token, map), lightGrid, {
      manualFogBits,
      heightfield: scene.heightfield,
    });
    appendForKey(tokenId, grid.seenBits);
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
    ops.push(...recordExploredOps(ctx, updatedMap, Object.values(ctx.current.tokens)));
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
    ops.push(...recordExploredOps(ctx, updatedMap, Object.values(ctx.current.tokens)));
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
    ops.push(...recordExploredOps(ctx, updatedMap, Object.values(ctx.current.tokens)));
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
  ops.push(...recordExploredOps(ctx, { ...map, fog: nextFog }, Object.values(ctx.current.tokens)));
  return ops;
}

export function clearFogMemory(ctx: SessionContext, data: IntentData<'fog.memory.clear'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  if (data.playerId !== undefined) {
    if (ctx.current.players[data.playerId] === undefined && map.fog.explored[data.playerId] === undefined) {
      throw violation('Jogador não encontrado');
    }
    if (map.fog.explored[data.playerId] === undefined) return [];
    return [{ op: 'remove', path: toPointer('maps', map.id, 'fog', 'explored', data.playerId) }];
  }
  return [{ op: 'replace', path: toPointer('maps', map.id, 'fog', 'explored'), value: {} }];
}

export function setTokenVision(ctx: SessionContext, data: IntentData<'token.vision'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  const map = ctx.map(token.mapId);
  const ops: PatchOp[] = [{ op: 'replace', path: toPointer('tokens', token.id, 'visionFeet'), value: data.visionFeet }];
  const tokens = Object.values(ctx.current.tokens).map((t) => (t.id === token.id ? { ...t, visionFeet: data.visionFeet } : t));
  const owners = tokenPlayerOwners(ctx.current, token);
  ops.push(...recordExploredOps(ctx, map, tokens, owners.length > 0 ? owners : [token.id]));
  return ops;
}
