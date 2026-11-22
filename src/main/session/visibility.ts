import { type ChatEntry, ChatEntrySchema, type PatchOp, type Role, type SessionState } from '../../shared/protocol';

/**
 * Visibilidade por cliente (docs/network-protocol.md, seção 2.12): o mestre vê
 * tudo; para os outros jogadores, a rolagem secreta vira `hidden_roll` na
 * mesma posição. Quem rolou sempre vê a própria rolagem.
 */

export interface Viewer {
  playerId: string;
  role: Role;
}

export function redactEntry(entry: ChatEntry, viewer: Viewer): ChatEntry {
  if (viewer.role === 'gm' || entry.kind !== 'roll' || entry.visibility === 'public' || entry.authorId === viewer.playerId) return entry;
  return { kind: 'hidden_roll', id: entry.id, at: entry.at, authorId: entry.authorId };
}

/** O estado que esse cliente pode ver. */
export function viewOf(state: SessionState, viewer: Viewer): SessionState {
  if (viewer.role === 'gm') return state;
  return { ...state, chat: state.chat.map((e) => redactEntry(e, viewer)) };
}

/** As operações de um patch que esse cliente pode ver. */
export function opsFor(ops: readonly PatchOp[], viewer: Viewer): PatchOp[] {
  if (viewer.role === 'gm') return [...ops];
  return ops.map((op) => {
    if (op.op !== 'add' || !op.path.startsWith('/chat/')) return op;
    const entry = ChatEntrySchema.safeParse(op.value);
    return entry.success ? { ...op, value: redactEntry(entry.data, viewer) } : op;
  });
}
