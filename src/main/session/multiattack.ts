import { monsterSpells, monsterSpellUseId, multiattackFits } from 'rules-engine';
import type { IntentData, PatchOp, Role } from '../../shared/protocol';
import { castMonsterSpell } from './casting';
import { forceSave, makeAttack } from './attacks';
import { spendMonsterUse } from './monsters';
import { notAllowed, type SessionContext, violation } from './context';

/** Multiattack dos monstros (nota 0066). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/** Confere quem pede e se os usos cabem numa opção da ação do bloco; gasta o uso dela, se é limitada ou lendária. */
export function requireMultiattack(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'attack.multi'>): PatchOp[] {
  const token = ctx.token(data.tokenId);
  if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
  const creature = token.monsterId !== null ? ctx.deps.creature(token.monsterId) : undefined;
  // Sem `actionId`, o Multiattack; com ele, uma ação lendária que encadeia outras (nota 0069).
  const action = creature?.actions.find((a) => a.kind === 'text' && a.multiattack !== undefined && (data.actionId === undefined ? a.activation !== 'legendary' : a.id === data.actionId));
  if (action?.kind !== 'text' || !action.multiattack) throw violation('Este monstro não tem Multiattack estruturado');
  if (!multiattackFits(action.multiattack, data.option, data.steps.map((s) => s.actionId))) throw violation('Estes ataques não cabem no Multiattack do monstro');
  return spendMonsterUse(ctx, token, action.id);
}

/** Um uso: o ataque contra o alvo dele, a magia do bloco, ou a salvaguarda dos alvos dela. */
export function multiattackStep(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'attack.multi'>, step: IntentData<'attack.multi'>['steps'][number]): PatchOp[] {
  const token = ctx.token(data.tokenId);
  const creature = token.monsterId !== null ? ctx.deps.creature(token.monsterId) : undefined;
  const action = creature?.actions.find((a) => a.id === step.actionId);
  const spell = creature && !action ? monsterSpells(creature).find((s) => monsterSpellUseId(s.spellId) === step.actionId) : undefined;
  if (spell) {
    // A magia vai ao chat, e os alvos são escolhidos lá.
    if (step.targetTokenIds.length > 0 || step.advantage !== undefined || step.disadvantage !== undefined) throw violation('Os alvos da magia são escolhidos no chat');
    return castMonsterSpell(ctx, playerId, role, { tokenId: token.id, spellId: spell.spellId });
  }
  if (action?.kind === 'save') {
    if (step.advantage !== undefined || step.disadvantage !== undefined) throw violation('Vantagem e Desvantagem só valem nos ataques do Multiattack');
    if (step.targetTokenIds.length === 0) throw violation('Escolha os alvos da salvaguarda');
    if (new Set(step.targetTokenIds).size !== step.targetTokenIds.length) throw violation('Alvo repetido');
    return forceSave(ctx, playerId, role, { source: { tokenId: token.id, actionId: action.id }, targetTokenIds: step.targetTokenIds, visibility: data.visibility });
  }
  const [targetTokenId] = step.targetTokenIds;
  if (targetTokenId === undefined || step.targetTokenIds.length !== 1) throw violation('Cada ataque tem um alvo');
  return makeAttack(ctx, playerId, role, {
    attacker: { tokenId: token.id, actionId: step.actionId },
    targetTokenId,
    ...(step.advantage !== undefined ? { advantage: step.advantage } : {}),
    ...(step.disadvantage !== undefined ? { disadvantage: step.disadvantage } : {}),
    visibility: data.visibility,
  });
}
