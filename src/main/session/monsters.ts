import { availableMonsterUses, type Creature, LEGENDARY_ACTIONS_ID, LEGENDARY_RESISTANCE_ID, type LimitedFeature, monsterSpells, monsterUsesAtTurnStart, pendingRecharges, RECHARGE_DIE, withMonsterUse } from 'rules-engine';
import { type IntentData, NO_MONSTER_USES, type PatchOp, type Role, type SessionState, type Token, toPointer } from '../../shared/protocol';
import { notAllowed, type SessionContext, violation } from './context';

/** Usos limitados e recarga dos monstros (nota 0064). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

function creatureOfToken(ctx: SessionContext, token: Token): Creature {
  const creature = token.characterId === null && token.monsterId !== null ? ctx.deps.creature(token.monsterId) : undefined;
  if (!creature) throw violation('O token não tem bloco de monstro');
  return creature;
}

/** Ações, traços e magias por dia do bloco, onde os limites de uso ficam. */
const featuresOf = (ctx: SessionContext, creature: Creature): LimitedFeature[] => [
  ...creature.actions,
  ...creature.traits,
  ...(creature.legendaryActionUses ? [{ id: LEGENDARY_ACTIONS_ID, name: 'Ações Lendárias', limit: { per: 'round', ...creature.legendaryActionUses } }] : []),
  ...monsterSpells(creature).flatMap((s): LimitedFeature[] => (s.use ? [{ id: s.use.id, name: ctx.deps.spell(s.spellId)?.name ?? s.spellId, limit: { per: 'day', count: s.use.perDay } }] : [])),
];

const setSpent = (token: Token, spent: Record<string, number>): PatchOp => ({ op: 'replace', path: toPointer('tokens', token.id, 'uses', 'spent'), value: spent });

/** Gasta um uso da ação, se ela é limitada; sem usos, recusa (o mestre recupera pelo bloco). */
export function spendMonsterUse(ctx: SessionContext, token: Token, featureId: string): PatchOp[] {
  const creature = creatureOfToken(ctx, token);
  const features = featuresOf(ctx, creature);
  // Uma ação lendária gasta também um uso por rodada (nota 0069).
  const legendary = creature.legendaryActionUses !== undefined && creature.actions.some((a) => a.id === featureId && a.activation === 'legendary');
  let { spent } = token.uses;
  for (const id of legendary ? [LEGENDARY_ACTIONS_ID, featureId] : [featureId]) {
    const feature = features.find((f) => f.id === id);
    if (!feature) throw violation('Ação não encontrada no bloco do monstro');
    if (!feature.limit) continue;
    if (availableMonsterUses({ id: feature.id, limit: feature.limit }, { ...token.uses, spent }) === 0) throw violation(`${token.name}: ${feature.name} sem usos (recupere no bloco do monstro)`);
    spent = withMonsterUse(spent, id, 1);
  }
  return spent === token.uses.spent ? [] : [setSpent(token, spent)];
}

/** O monstro ainda tem Resistência Lendária. */
export function hasLegendaryResistance(ctx: SessionContext, token: Token): boolean {
  const trait = token.characterId === null && token.monsterId !== null ? ctx.deps.creature(token.monsterId)?.traits.find((t) => t.id === LEGENDARY_RESISTANCE_ID) : undefined;
  return trait?.limit !== undefined && availableMonsterUses({ id: trait.id, limit: trait.limit }, token.uses) > 0;
}

/** Gasta ou recupera um uso à mão: ações só de texto, ou a correção do mestre. */
export function changeMonsterUse(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'monster.use'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
  const creature = creatureOfToken(ctx, token);
  const feature = featuresOf(ctx, creature).find((f) => f.id === data.featureId);
  const legendary = creature.actions.some((a) => a.id === data.featureId && a.activation === 'legendary');
  if (!feature || (!feature.limit && !(legendary && data.change === 'spend'))) throw violation('Esta ação não tem usos limitados');
  if (data.change === 'spend') return spendMonsterUse(ctx, token, feature.id);
  if ((token.uses.spent[feature.id] ?? 0) === 0) throw violation(`${feature.name}: nenhum uso gasto`);
  return [setSpent(token, withMonsterUse(token.uses.spent, feature.id, -1))];
}

/** O monstro descansou: todos os usos voltam. */
export function restMonster(ctx: SessionContext, data: IntentData<'monster.rest'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  creatureOfToken(ctx, token);
  return [setSpent(token, { ...NO_MONSTER_USES.spent })];
}

/** No covil, alguns limites são maiores. */
export function setMonsterLair(ctx: SessionContext, data: IntentData<'monster.lair'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  creatureOfToken(ctx, token);
  return [{ op: 'replace', path: toPointer('tokens', token.id, 'uses', 'lair'), value: data.lair }];
}

/** Início do turno: voltam as ações lendárias e as limitadas por turno, e rola 1d6 para cada recarga gasta. Com 0 PV, nada. */
export function rechargeMonster(ctx: SessionContext, playerId: string, state: SessionState, tokenId: string): PatchOp[] {
  const token = state.tokens[tokenId];
  if (!token || token.characterId !== null || token.monsterId === null) return [];
  if (token.hp && token.hp.damage >= token.hp.max) return [];
  const creature = ctx.deps.creature(token.monsterId);
  if (!creature) return [];
  const features = featuresOf(ctx, creature);
  let spent = monsterUsesAtTurnStart(features, token.uses.spent);
  const ops: PatchOp[] = [];
  for (const { id, name, min } of pendingRecharges(features, spent)) {
    const roll = ctx.deps.rng.roll(RECHARGE_DIE);
    if (roll >= min) spent = withMonsterUse(spent, id, -1);
    ops.push(ctx.appendChat({ kind: 'recharge_roll', ...ctx.entryBase(playerId), tokenId, name: token.name, actionName: name.slice(0, 100), roll, min }));
  }
  return Object.keys(token.uses.spent).length === 0 ? ops : [setSpent(token, spent), ...ops];
}
