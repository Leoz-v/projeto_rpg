import type { IntentData, PatchOp, PendingSave, Token } from '../../shared/protocol';
import { toPointer } from '../../shared/protocol';
import { applySpellFailure } from './casting';
import { type SessionContext, violation } from './context';
import { applyItemFailure } from './items';
import { endTokenConcentration } from './monster-concentration';
import { spendMonsterUse } from './monsters';
import { imposeFromAction } from './spell-effects';

/** Resistência Lendária (nota 0069): a falha espera o mestre. Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

export const addPendingSave = (pending: PendingSave): PatchOp => ({ op: 'add', path: toPointer('pendingSaves', pending.id), value: pending });

/** Decide a falha: com a resistência, gasta o uso e vale o sucesso; aceita, as consequências entram. */
export function resolvePendingSave(ctx: SessionContext, playerId: string, data: IntentData<'save.resolve'>): PatchOp[] {
  const pending = ctx.current.pendingSaves[data.pendingId];
  if (!pending) throw violation('Falha não encontrada (já decidida)');
  const token = ctx.token(pending.targetTokenId);
  const ops: PatchOp[] = [{ op: 'remove', path: toPointer('pendingSaves', pending.id) }];
  // Gasta antes do resto: sem usos, nada muda.
  if (data.useResistance) ops.push(...spendMonsterUse(ctx, token, 'legendary_resistance'));
  ops.push(
    ctx.appendChat({ kind: 'legendary_resistance', ...ctx.entryBase(playerId), saveEntryId: pending.entryId, tokenId: token.id, name: token.name, label: pending.label, used: data.useResistance }),
  );
  if (pending.damage) {
    const amount = data.useResistance ? pending.damage.saved : pending.damage.failed;
    const { proposalId } = pending.damage;
    if (amount > 0) ops.push({ op: 'add', path: toPointer('proposals', proposalId), value: { id: proposalId, entryId: pending.entryId, targetTokenId: token.id, targetName: token.name, amount } });
  }
  if (!data.useResistance) ops.push(...failure(ctx, playerId, pending, token));
  return ops;
}

function failure(ctx: SessionContext, playerId: string, pending: PendingSave, token: Token): PatchOp[] {
  const ops: PatchOp[] = [];
  if (pending.impose) {
    const actor = ctx.current.tokens[pending.impose.actorTokenId];
    const { actionId } = pending.impose;
    const action = actor && actor.monsterId !== null ? ctx.deps.creature(actor.monsterId)?.actions.find((a) => a.id === actionId) : undefined;
    if (actor && action?.kind === 'save') ops.push(...imposeFromAction(ctx, playerId, action.imposes, actor, token, `${action.name} (${actor.name})`).ops);
  }
  if (pending.spell) ops.push(...applySpellFailure(ctx, playerId, pending.spell, [token]));
  if (pending.item) ops.push(...applyItemFailure(ctx, playerId, pending.item, [token]));
  // A magia pode ter trocado enquanto a falha esperava.
  if (pending.concentration !== undefined && token.concentration?.spellId === pending.concentration) ops.push(...endTokenConcentration(ctx, playerId, token, 'failed_save'));
  return ops;
}

/** O token saiu: as falhas dele não têm mais o que decidir. */
export function dropPendingSaves(ctx: SessionContext, tokenId: string): PatchOp[] {
  return Object.values(ctx.current.pendingSaves)
    .filter((p) => p.targetTokenId === tokenId)
    .map((p) => ({ op: 'remove', path: toPointer('pendingSaves', p.id) }));
}
