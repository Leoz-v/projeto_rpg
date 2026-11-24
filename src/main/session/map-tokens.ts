import { rollDice } from 'rules-engine';
import { type ChatEntry, NO_CONDITIONS, type GameMap, type IntentData, type PatchOp, type Role, type Token, toPointer } from '../../shared/protocol';
import { type SessionContext, violation, notAllowed } from './context';

/** Mapas, tokens e rolagens livres do chat. Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

export function roll(ctx: SessionContext, playerId: string, data: IntentData<'dice.roll'>): ChatEntry {
  const result = rollDice(data.formula, ctx.deps.rng);
  return {
    kind: 'roll',
    ...ctx.entryBase(playerId),
    formula: data.formula,
    ...(data.label !== undefined ? { label: data.label } : {}),
    visibility: data.visibility,
    rolls: result.rolls.map((r) => ({ sides: r.sides, value: r.value })),
    total: result.total,
  };
}

export function moveToken(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'token.move'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
  ctx.requireInside(ctx.map(token.mapId), data.to, token.size);
  return [{ op: 'replace', path: toPointer('tokens', token.id, 'position'), value: data.to }];
}

export function createMap(ctx: SessionContext, data: IntentData<'map.create'>): PatchOp[] {
  ctx.requireAsset(data.background);
  ctx.requireAsset(data.scene3d);
  if (data.cellPx !== undefined && data.background === undefined) throw violation('Tamanho de célula em pixels exige imagem de fundo');
  if (data.scene3d !== undefined && (data.background !== undefined || data.cellPx !== undefined)) {
    throw violation('Mapa 3D não usa imagem de fundo 2D');
  }
  const map: GameMap = {
    id: ctx.deps.newId(),
    name: data.name,
    width: data.width,
    height: data.height,
    background: data.background ?? null,
    cellPx: data.cellPx ?? null,
    scene3d: data.scene3d ?? null,
  };
  const ops: PatchOp[] = [{ op: 'add', path: toPointer('maps', map.id), value: map }];
  if (ctx.current.activeMapId === null) ops.push({ op: 'replace', path: '/activeMapId', value: map.id });
  return ops;
}

export function updateMap(ctx: SessionContext, data: IntentData<'map.update'>): PatchOp[] {
  const map = ctx.map(data.mapId);
  if (data.scene3d !== undefined) {
    if (map.background !== null) throw violation('Não é possível definir cena 3D em um mapa 2D com imagem de fundo');
    ctx.requireAsset(data.scene3d);
  }
  const ops: PatchOp[] = [];
  if (data.name !== undefined) ops.push({ op: 'replace', path: toPointer('maps', map.id, 'name'), value: data.name });
  if (data.width !== undefined) ops.push({ op: 'replace', path: toPointer('maps', map.id, 'width'), value: data.width });
  if (data.height !== undefined) ops.push({ op: 'replace', path: toPointer('maps', map.id, 'height'), value: data.height });
  if (data.scene3d !== undefined) ops.push({ op: 'replace', path: toPointer('maps', map.id, 'scene3d'), value: data.scene3d });
  return ops;
}

export function createToken(ctx: SessionContext, data: IntentData<'token.create'>): PatchOp[] {
  ctx.requireInside(ctx.map(data.mapId), data.position, data.size);
  if (data.monsterId !== undefined && !ctx.deps.monsterExists(data.monsterId)) throw violation('Monstro não encontrado no compêndio');
  ctx.requireAsset(data.image);
  const ownerIds = [...new Set(data.ownerIds ?? [])];
  if (ownerIds.some((id) => ctx.current.players[id] === undefined)) throw violation('Dono do token não está na mesa');
  if (data.characterId !== undefined && ctx.current.characters[data.characterId] === undefined) throw violation('Personagem não encontrado');
  // PV próprios só para tokens que não são personagem: os informados, ou a média do monstro.
  const hpMax = data.characterId !== undefined ? undefined : (data.hpMax ?? (data.monsterId !== undefined ? ctx.deps.monsterHpMax(data.monsterId) : undefined));
  const token: Token = {
    id: ctx.deps.newId(),
    mapId: data.mapId,
    name: data.name,
    position: data.position,
    size: data.size,
    monsterId: data.monsterId ?? null,
    image: data.image ?? null,
    ownerIds,
    characterId: data.characterId ?? null,
    hp: hpMax !== undefined ? { max: hpMax, damage: 0, temp: 0 } : null,
    conditions: NO_CONDITIONS,
  };
  return [{ op: 'add', path: toPointer('tokens', token.id), value: token }];
}
