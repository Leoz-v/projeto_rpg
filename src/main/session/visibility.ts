import { type ChatEntry, ChatEntrySchema, type PatchOp, type Role, type SessionState, type Token, TokenSchema } from '../../shared/protocol';

/**
 * Visibilidade por cliente (docs/network-protocol.md, seção 2.12): o mestre vê
 * tudo. Para os outros jogadores:
 * - a rolagem secreta vira `hidden_roll` na mesma posição (quem rolou sempre vê a própria);
 * - os PV de tokens que não são personagens (monstros) chegam como `null`,
 *   a menos que o jogador seja dono do token;
 * - as propostas de dano (fila do mestre) não chegam.
 */

export interface Viewer {
  playerId: string;
  role: Role;
}

export function redactEntry(entry: ChatEntry, viewer: Viewer): ChatEntry {
  const secret = entry.kind === 'roll' || entry.kind === 'd20_roll' || entry.kind === 'damage_roll' || entry.kind === 'attack_roll' || entry.kind === 'save_roll' || entry.kind === 'mastery_damage'
      ? entry.visibility === 'gm'
      : false;
  if (viewer.role === 'gm' || !secret || entry.authorId === viewer.playerId) return entry;
  return { kind: 'hidden_roll', id: entry.id, at: entry.at, authorId: entry.authorId };
}

/** O jogador vê os PV deste token (mestre, dono do token; tokens de personagem não têm PV próprios). */
export function seesTokenHp(token: Pick<Token, 'ownerIds'>, viewer: Viewer): boolean {
  return viewer.role === 'gm' || token.ownerIds.includes(viewer.playerId);
}

function redactToken(token: Token, viewer: Viewer): Token {
  return token.hp === null || seesTokenHp(token, viewer) ? token : { ...token, hp: null };
}

/** O estado que esse cliente pode ver. */
export function viewOf(state: SessionState, viewer: Viewer): SessionState {
  if (viewer.role === 'gm') return state;
  return {
    ...state,
    chat: state.chat.map((e) => redactEntry(e, viewer)),
    tokens: Object.fromEntries(Object.entries(state.tokens).map(([id, t]) => [id, redactToken(t, viewer)])),
    proposals: {},
  };
}

/** `/tokens/<id>/hp` ou abaixo: o id do token. */
const TOKEN_HP_PATH = /^\/tokens\/([^/]+)\/hp(?:\/|$)/;
const TOKEN_PATH = /^\/tokens\/([^/]+)$/;

/**
 * As operações de um patch que esse cliente pode ver. `state` é o estado
 * depois do patch, para saber de quem é cada token.
 */
export function opsFor(ops: readonly PatchOp[], viewer: Viewer, state: SessionState): PatchOp[] {
  if (viewer.role === 'gm') return [...ops];
  return ops.flatMap((op): PatchOp[] => {
    if (op.op === 'add' && op.path.startsWith('/chat/')) {
      const entry = ChatEntrySchema.safeParse(op.value);
      return [entry.success ? { ...op, value: redactEntry(entry.data, viewer) } : op];
    }
    if (op.op !== 'remove' && TOKEN_PATH.test(op.path)) {
      const token = TokenSchema.safeParse(op.value);
      return [token.success ? { ...op, value: redactToken(token.data, viewer) } : op];
    }
    // Propostas de dano são a fila de trabalho do mestre.
    if (op.path.startsWith('/proposals/')) return [];
    const hp = TOKEN_HP_PATH.exec(op.path);
    if (hp?.[1] !== undefined) {
      const token = state.tokens[hp[1]];
      return token && seesTokenHp(token, viewer) ? [op] : [];
    }
    return [op];
  });
}
