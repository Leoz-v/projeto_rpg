import { availableMonsterUses, type Creature, pendingRecharges, RECHARGE_DIE, withMonsterUse } from 'rules-engine';
import { type IntentData, NO_MONSTER_USES, type PatchOp, type Role, type SessionState, type Token, toPointer } from '../../shared/protocol';
import { notAllowed, type SessionContext, violation } from './context';

/** Usos limitados e recarga dos monstros (nota 0064). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

function creatureOfToken(ctx: SessionContext, token: Token): Creature {
  const creature = token.characterId === null && token.monsterId !== null ? ctx.deps.creature(token.monsterId) : undefined;
  if (!creature) throw violation('O token não tem bloco de monstro');
  return creature;
}

/** Ações e traços do bloco, onde os limites de uso ficam. */
const featuresOf = (creature: Creature): (Creature['actions'][number] | Creature['traits'][number])[] => [...creature.actions, ...creature.traits];

const setSpent = (token: Token, spent: Record<string, number>): PatchOp => ({ op: 'replace', path: toPointer('tokens', token.id, 'uses', 'spent'), value: spent });

/** Gasta um uso da ação, se ela é limitada; sem usos, recusa (o mestre recupera pelo bloco). */
export function spendMonsterUse(ctx: SessionContext, token: Token, featureId: string): PatchOp[] {
  const feature = featuresOf(creatureOfToken(ctx, token)).find((f) => f.id === featureId);
  if (!feature) throw violation('Ação não encontrada no bloco do monstro');
  if (!feature.limit) return [];
  if (availableMonsterUses({ id: feature.id, limit: feature.limit }, token.uses) === 0) throw violation(`${token.name}: ${feature.name} sem usos (recupere no bloco do monstro)`);
  return [setSpent(token, withMonsterUse(token.uses.spent, feature.id, 1))];
}

/** Gasta ou recupera um uso à mão: ações só de texto, ou a correção do mestre. */
export function changeMonsterUse(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'monster.use'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
  const feature = featuresOf(creatureOfToken(ctx, token)).find((f) => f.id === data.featureId);
  if (!feature?.limit) throw violation('Esta ação não tem usos limitados');
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

/** Início do turno: rola 1d6 para cada recarga gasta. Com 0 PV, não rola. */
export function rechargeMonster(ctx: SessionContext, playerId: string, state: SessionState, tokenId: string): PatchOp[] {
  const token = state.tokens[tokenId];
  if (!token || token.characterId !== null || token.monsterId === null) return [];
  if (token.hp && token.hp.damage >= token.hp.max) return [];
  const creature = ctx.deps.creature(token.monsterId);
  if (!creature) return [];
  let { spent } = token.uses;
  const ops: PatchOp[] = [];
  for (const { id, name, min } of pendingRecharges(featuresOf(creature), spent)) {
    const roll = ctx.deps.rng.roll(RECHARGE_DIE);
    if (roll >= min) spent = withMonsterUse(spent, id, -1);
    ops.push(ctx.appendChat({ kind: 'recharge_roll', ...ctx.entryBase(playerId), tokenId, name: token.name, actionName: name.slice(0, 100), roll, min }));
  }
  return spent === token.uses.spent ? ops : [setSpent(token, spent), ...ops];
}
