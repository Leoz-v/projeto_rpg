import { NO_DEATH_SAVES, NO_SPELL_SLOTS_SPENT, rollAbilityScores, usesRolledValues } from 'rules-engine';
import { applyPatch, NO_CONDITIONS, type IntentData, type PatchOp, type Role, type SessionCharacter, MAX_ADJUSTMENTS, MAX_INVENTORY_ITEMS, MAX_ITEM_QUANTITY, toPointer } from '../../shared/protocol';
import { type SessionContext, violation, notAllowed, EMPTY_INVENTORY, type InventoryEntry } from './context';
import { recordExploredOps } from './fog';

/** Personagens, inventário e ajustes do mestre (Fase 3). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

function withCharacterExploredOps(ctx: SessionContext, characterId: string, baseOps: PatchOp[]): PatchOp[] {
  if (baseOps.length === 0) return baseOps;
  const mapIds = new Set<string>();
  for (const token of Object.values(ctx.current.tokens)) {
    if (token.characterId !== characterId) continue;
    const map = ctx.current.maps[token.mapId];
    if (map?.fog.autoEnabled && map.fog.rememberExplored) mapIds.add(map.id);
  }
  if (mapIds.size === 0) return baseOps;

  const nextState = applyPatch(ctx.current, baseOps);
  const updatedChar = nextState.characters[characterId];
  const nextTokens = Object.values(nextState.tokens);
  const ops = [...baseOps];
  for (const mapId of mapIds) {
    const map = nextState.maps[mapId];
    if (map) {
      ops.push(...recordExploredOps(ctx, map, nextTokens, updatedChar ? [updatedChar.ownerId] : undefined, nextState));
    }
  }
  return ops;
}

export function createCharacter(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'character.create'>): PatchOp[] {
  const ownerId = data.ownerId ?? playerId;
  if (ownerId !== playerId) {
    ctx.requireGm(role);
    if (ctx.current.players[ownerId] === undefined) throw violation('Dono do personagem não está na mesa');
  }
  const character: SessionCharacter = { id: ctx.deps.newId(), ownerId, name: data.name, baseScores: null, rolledScores: null, steps: [], inventory: EMPTY_INVENTORY, hp: { damage: 0, temp: 0 }, adjustments: [], conditions: NO_CONDITIONS, deathSaves: NO_DEATH_SAVES, concentration: null, hitDiceSpent: {}, spellSlotsSpent: NO_SPELL_SLOTS_SPENT, resourcesSpent: {} };
  return [{ op: 'add', path: toPointer('characters', character.id), value: character }];
}

/**
 * Troca nome, atributos ou passos de construção. O Host confere só a
 * estrutura e a origem dos atributos: a construção pode estar incompleta
 * (rascunho), e o motor aponta o que falta na ficha.
 */
export function updateCharacter(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'character.update'>): PatchOp[] {
  const character = ctx.ownCharacter(playerId, role, data.characterId);
  const ops: PatchOp[] = [];
  const set = (field: 'name' | 'baseScores' | 'steps', value: unknown): void => {
    ops.push({ op: 'replace', path: toPointer('characters', character.id, field), value });
  };
  if (data.name !== undefined) set('name', data.name);
  if (data.baseScores !== undefined) {
    const { method, scores } = data.baseScores;
    if (method === 'manual' && role !== 'gm') throw notAllowed('Só o mestre pode definir atributos à mão');
    if (method === 'rolled' && (character.rolledScores === null || !usesRolledValues(scores, character.rolledScores))) {
      throw violation('Os atributos precisam usar os valores rolados pelo Host');
    }
    set('baseScores', data.baseScores);
  }
  // Desfazer uma escolha deixa soltas as seleções de dentro dela: o Host as descarta.
  if (data.steps !== undefined) set('steps', ctx.deps.pruneSteps(data.steps));
  return withCharacterExploredOps(ctx, character.id, ops);
}

/**
 * O Host rola os atributos (4d6, descarta o menor, seis vezes) e publica no
 * chat. O dono rola uma vez; o mestre pode mandar rolar de novo, o que
 * desfaz uma distribuição feita com os valores antigos.
 */
export function rollScores(ctx: SessionContext, playerId: string, role: Role, characterId: string): PatchOp[] {
  const character = ctx.ownCharacter(playerId, role, characterId);
  if (character.rolledScores !== null && role !== 'gm') throw notAllowed('Os atributos já foram rolados; peça ao mestre para rolar de novo');
  const sets = rollAbilityScores(ctx.deps.rng);
  const ops: PatchOp[] = [
    { op: 'replace', path: toPointer('characters', character.id, 'rolledScores'), value: sets.map((s) => s.total) },
    ctx.appendChat({ kind: 'ability_roll', ...ctx.entryBase(playerId), characterId: character.id, characterName: character.name, sets }),
  ];
  if (character.baseScores?.method === 'rolled') ops.push({ op: 'replace', path: toPointer('characters', character.id, 'baseScores'), value: null });
  return ops;
}

/** Remove o personagem; os tokens dele continuam no mapa, sem a ligação. */
export function removeCharacter(ctx: SessionContext, playerId: string, role: Role, characterId: string): PatchOp[] {
  ctx.ownCharacter(playerId, role, characterId);
  const unlink = Object.values(ctx.current.tokens)
    .filter((t) => t.characterId === characterId)
    .map((t): PatchOp => ({ op: 'replace', path: toPointer('tokens', t.id, 'characterId'), value: null }));
  return [...unlink, { op: 'remove', path: toPointer('characters', characterId) }];
}

export function inventoryEntry(ctx: SessionContext, character: SessionCharacter, instanceId: string): { entry: InventoryEntry; index: number } {
  const index = character.inventory.items.findIndex((e) => e.instanceId === instanceId);
  const entry = character.inventory.items[index];
  if (!entry) throw violation('Item não encontrado no inventário');
  return { entry, index };
}

/**
 * Item do compêndio para o inventário. O motor confere o item, a variante e
 * o item base. Uma entrada igual que não está vestida nem sintonizada só
 * ganha quantidade (20 flechas + 20 flechas = 40 flechas).
 */
export function addItem(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'inventory.add'>): PatchOp[] {
  const character = ctx.ownCharacter(playerId, role, data.characterId);
  const problems = ctx.deps.itemProblems(data);
  if (problems.length > 0) throw violation(problems[0] ?? 'Item inválido');
  const quantity = data.quantity ?? 1;
  const items = character.inventory.items;
  const same = items.findIndex(
    (e) => e.itemId === data.itemId && e.baseItemId === data.baseItemId && e.variantId === data.variantId && !e.equipped && !e.attuned,
  );
  const existing = items[same];
  if (existing) {
    const total = existing.quantity + quantity;
    if (total > MAX_ITEM_QUANTITY) throw violation(`No máximo ${MAX_ITEM_QUANTITY} unidades por item`);
    return [{ op: 'replace', path: toPointer('characters', character.id, 'inventory', 'items', String(same), 'quantity'), value: total }];
  }
  if (items.length >= MAX_INVENTORY_ITEMS) throw violation(`No máximo ${MAX_INVENTORY_ITEMS} itens no inventário`);
  const entry: InventoryEntry = {
    instanceId: ctx.deps.newId(),
    itemId: data.itemId,
    ...(data.baseItemId !== undefined ? { baseItemId: data.baseItemId } : {}),
    ...(data.variantId !== undefined ? { variantId: data.variantId } : {}),
    quantity,
    equipped: false,
    attuned: false,
  };
  return [{ op: 'add', path: toPointer('characters', character.id, 'inventory', 'items', '-'), value: entry }];
}

/** Tira `quantity` unidades (padrão: a entrada inteira). */
export function removeItem(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'inventory.remove'>): PatchOp[] {
  const character = ctx.ownCharacter(playerId, role, data.characterId);
  const { entry, index } = inventoryEntry(ctx, character, data.instanceId);
  const path = toPointer('characters', character.id, 'inventory', 'items', String(index));
  if (data.quantity !== undefined && data.quantity < entry.quantity) return [{ op: 'replace', path: `${path}/quantity`, value: entry.quantity - data.quantity }];
  return [{ op: 'remove', path }];
}

/**
 * Vestir, sintonizar ou mudar a quantidade. Regras que dependem da ficha
 * (uma armadura por vez, limite de sintonização, quem pode sintonizar) o
 * motor aponta na ficha, sem bloquear: o mestre decide.
 */
export function updateItem(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'inventory.update'>): PatchOp[] {
  const character = ctx.ownCharacter(playerId, role, data.characterId);
  const { index } = inventoryEntry(ctx, character, data.instanceId);
  const path = toPointer('characters', character.id, 'inventory', 'items', String(index));
  const ops: PatchOp[] = [];
  if (data.equipped !== undefined) ops.push({ op: 'replace', path: `${path}/equipped`, value: data.equipped });
  if (data.attuned !== undefined) ops.push({ op: 'replace', path: `${path}/attuned`, value: data.attuned });
  if (data.quantity !== undefined) ops.push({ op: 'replace', path: `${path}/quantity`, value: data.quantity });
  return withCharacterExploredOps(ctx, character.id, ops);
}

/** Ajuste do mestre: os efeitos já vêm validados pelo catálogo (schema do motor). */
export function addAdjustment(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'adjustment.add'>): PatchOp[] {
  const character = ctx.ownCharacter(playerId, role, data.characterId);
  if (character.adjustments.length >= MAX_ADJUSTMENTS) throw violation(`No máximo ${MAX_ADJUSTMENTS} ajustes por personagem`);
  const adjustment = { id: ctx.deps.newId(), name: data.name, effects: data.effects };
  return withCharacterExploredOps(ctx, character.id, [{ op: 'add', path: toPointer('characters', character.id, 'adjustments', '-'), value: adjustment }]);
}
