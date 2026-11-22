import { type ChatEntry, ChatEntrySchema, type PatchOp, type Role, type SessionState } from '../../shared/protocol';

/**
 * Visibilidade por cliente (docs/network-protocol.md, seção 2.12): o mestre vê
 * tudo; para o jogador, a rolagem secreta vira `hidden_roll` na mesma posição.
 */

export function redactEntry(entry: ChatEntry, role: Role): ChatEntry {
  if (role === 'gm' || entry.kind !== 'roll' || entry.visibility === 'public') return entry;
  return { kind: 'hidden_roll', id: entry.id, at: entry.at, authorId: entry.authorId };
}

/** O estado que um cliente com esse papel pode ver. */
export function viewOf(state: SessionState, role: Role): SessionState {
  if (role === 'gm') return state;
  return { ...state, chat: state.chat.map((e) => redactEntry(e, role)) };
}

/** As operações de um patch que um cliente com esse papel pode ver. */
export function opsFor(ops: readonly PatchOp[], role: Role): PatchOp[] {
  if (role === 'gm') return [...ops];
  return ops.map((op) => {
    if (op.op !== 'add' || !op.path.startsWith('/chat/')) return op;
    const entry = ChatEntrySchema.safeParse(op.value);
    return entry.success ? { ...op, value: redactEntry(entry.data, role) } : op;
  });
}
