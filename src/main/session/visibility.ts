import {
  type ChatEntry,
  ChatEntrySchema,
  type Combat,
  CombatSchema,
  computePlayerVision,
  type GameMap,
  isTokenVisibleToPlayer,
  type MapFog,
  MapFogSchema,
  MapSchema,
  type PatchOp,
  type Role,
  type SessionState,
  type Token,
  TokenSchema,
  toPointer,
} from '../../shared/protocol';

/**
 * Visibilidade por cliente (docs/network-protocol.md, seção 2.12): o mestre vê
 * tudo. Para os outros jogadores:
 * - a rolagem secreta vira `hidden_roll` na mesma posição (quem rolou sempre vê a própria);
 * - os PV de tokens que não são personagens (monstros) chegam como `null`,
 *   a menos que o jogador seja dono do token;
 * - as propostas de dano (fila do mestre) não chegam;
 * - a iniciativa de tokens que não são personagens só chega ao mestre e aos
 *   donos do token: a ordem do combate é de todos, o valor não;
 * - em `maps[id].fog.explored`, cada jogador só recebe a própria entrada;
 * - tokens ocultos pelo mestre (`hidden: true`) nunca chegam a jogadores;
 * - tokens que o jogador não controla só chegam quando ao menos uma célula do
 *   token está atualmente visível (fora da névoa manual e, com névoa automática,
 *   dentro do alcance de visão atual de algum token do jogador).
 */

export interface Viewer {
  playerId: string;
  role: Role;
}

export function redactEntry(entry: ChatEntry, viewer: Viewer, tokens: SessionState['tokens']): ChatEntry {
  if (entry.kind === 'initiative_roll') {
    if (viewer.role === 'gm') return entry;
    return { ...entry, results: entry.results.filter((r) => seesInitiative(tokens[r.tokenId], viewer)) };
  }
  const secret =
    entry.kind === 'roll' ||
    entry.kind === 'd20_roll' ||
    entry.kind === 'damage_roll' ||
    entry.kind === 'attack_roll' ||
    entry.kind === 'save_roll' ||
    entry.kind === 'mastery_damage'
      ? entry.visibility === 'gm'
      : false;
  if (viewer.role === 'gm' || !secret || entry.authorId === viewer.playerId) return entry;
  return { kind: 'hidden_roll', id: entry.id, at: entry.at, authorId: entry.authorId };
}

/** O jogador vê os PV deste token (mestre, dono do token; tokens de personagem não têm PV próprios). */
export function seesTokenHp(token: Pick<Token, 'ownerIds'>, viewer: Viewer): boolean {
  return viewer.role === 'gm' || token.ownerIds.includes(viewer.playerId);
}

/** O jogador vê o valor da iniciativa deste token: personagens, e os tokens em que vê os PV. Token que saiu do mapa: não. */
export function seesInitiative(token: Pick<Token, 'ownerIds' | 'characterId'> | undefined, viewer: Viewer): boolean {
  if (viewer.role === 'gm') return true;
  return token !== undefined && (token.characterId !== null || seesTokenHp(token, viewer));
}

function redactCombat(combat: Combat | null, viewer: Viewer, tokens: SessionState['tokens']): Combat | null {
  if (!combat || viewer.role === 'gm') return combat;
  return {
    ...combat,
    combatants: combat.combatants.map((c) => (seesInitiative(tokens[c.tokenId], viewer) ? c : { ...c, initiative: null, modifier: null })),
  };
}

function redactToken(token: Token, viewer: Viewer): Token {
  return token.hp === null || seesTokenHp(token, viewer) ? token : { ...token, hp: null };
}

function redactExplored(explored: MapFog['explored'], playerId: string): MapFog['explored'] {
  const own = explored[playerId];
  return own !== undefined ? { [playerId]: own } : {};
}

function redactFog(fog: MapFog, playerId: string): MapFog {
  return { ...fog, explored: redactExplored(fog.explored, playerId) };
}

function redactMap(map: GameMap, viewer: Viewer): GameMap {
  if (viewer.role === 'gm') return map;
  return { ...map, fog: redactFog(map.fog, viewer.playerId) };
}

/** Pré-calcula a visão do jogador por mapa com névoa automática ativa, evitando recalcular por token. */
function visionCacheFor(state: SessionState, playerId: string): Map<string, Uint8Array> {
  const cache = new Map<string, Uint8Array>();
  const allTokens = Object.values(state.tokens);
  for (const map of Object.values(state.maps)) {
    if (map.fog.autoEnabled) cache.set(map.id, computePlayerVision(map, allTokens, playerId));
  }
  return cache;
}

function tokenVisibleInState(state: SessionState, token: Token | undefined, viewer: Viewer, visionCache: Map<string, Uint8Array>): boolean {
  if (!token) return false;
  if (viewer.role === 'gm') return true;
  if (token.hidden) return false;
  const map = state.maps[token.mapId];
  return isTokenVisibleToPlayer(map, Object.values(state.tokens), token, viewer.playerId, visionCache.get(token.mapId));
}

/** O estado que esse cliente pode ver. */
export function viewOf(state: SessionState, viewer: Viewer): SessionState {
  if (viewer.role === 'gm') return state;
  const visionCache = visionCacheFor(state, viewer.playerId);
  const visibleTokens: SessionState['tokens'] = {};
  for (const [id, token] of Object.entries(state.tokens)) {
    if (tokenVisibleInState(state, token, viewer, visionCache)) {
      visibleTokens[id] = redactToken(token, viewer);
    }
  }
  return {
    ...state,
    chat: state.chat.map((e) => redactEntry(e, viewer, state.tokens)),
    maps: Object.fromEntries(Object.entries(state.maps).map(([id, m]) => [id, redactMap(m, viewer)])),
    tokens: visibleTokens,
    proposals: {},
    combat: redactCombat(state.combat, viewer, state.tokens),
  };
}

/** `/tokens/<id>/hp` ou abaixo: o id do token. */
const TOKEN_HP_PATH = /^\/tokens\/([^/]+)\/hp(?:\/|$)/;
const TOKEN_PATH = /^\/tokens\/([^/]+)$/;
const TOKEN_ANY_PATH = /^\/tokens\/([^/]+)(?:\/|$)/;
const MAP_PATH = /^\/maps\/([^/]+)$/;
const MAP_FOG_PATH = /^\/maps\/([^/]+)\/fog$/;
const MAP_EXPLORED_PATH = /^\/maps\/([^/]+)\/fog\/explored$/;
const MAP_EXPLORED_PLAYER_PATH = /^\/maps\/([^/]+)\/fog\/explored\/([^/]+)$/;

/**
 * As operações de um patch que esse cliente pode ver. `state` é o estado
 * depois do patch e `prevState` (quando informado) é o estado imediatamente
 * anterior, usado para emitir `add`/`remove` quando tokens entram ou saem da névoa.
 */
export function opsFor(ops: readonly PatchOp[], viewer: Viewer, state: SessionState, prevState?: SessionState): PatchOp[] {
  if (viewer.role === 'gm') return [...ops];

  const nextVision = visionCacheFor(state, viewer.playerId);
  const prevVision = prevState ? visionCacheFor(prevState, viewer.playerId) : nextVision;
  const wasVisible = (id: string): boolean => (prevState ? tokenVisibleInState(prevState, prevState.tokens[id], viewer, prevVision) : tokenVisibleInState(state, state.tokens[id], viewer, nextVision));
  const isVisible = (id: string): boolean => tokenVisibleInState(state, state.tokens[id], viewer, nextVision);

  const filtered = ops.flatMap((op): PatchOp[] => {
    if (op.op === 'add' && op.path.startsWith('/chat/')) {
      const entry = ChatEntrySchema.safeParse(op.value);
      return [entry.success ? { ...op, value: redactEntry(entry.data, viewer, state.tokens) } : op];
    }
    if (op.path === '/combat' && op.op !== 'remove') {
      const combat = CombatSchema.nullable().safeParse(op.value);
      return [combat.success ? { ...op, value: redactCombat(combat.data, viewer, state.tokens) } : op];
    }
    // Propostas de dano são a fila de trabalho do mestre.
    if (op.path.startsWith('/proposals/')) return [];

    // Memória de exploração por jogador: só a do próprio viewer passa.
    const exploredPlayer = MAP_EXPLORED_PLAYER_PATH.exec(op.path);
    if (exploredPlayer?.[2] !== undefined) {
      return exploredPlayer[2] === viewer.playerId ? [op] : [];
    }
    if (MAP_EXPLORED_PATH.test(op.path) && op.op !== 'remove') {
      const parsed = MapFogSchema.shape.explored.safeParse(op.value);
      return [parsed.success ? { ...op, value: redactExplored(parsed.data, viewer.playerId) } : op];
    }
    if (MAP_FOG_PATH.test(op.path) && op.op !== 'remove') {
      const parsed = MapFogSchema.safeParse(op.value);
      return [parsed.success ? { ...op, value: redactFog(parsed.data, viewer.playerId) } : op];
    }
    if (MAP_PATH.test(op.path) && op.op !== 'remove') {
      const parsed = MapSchema.safeParse(op.value);
      return [parsed.success ? { ...op, value: redactMap(parsed.data, viewer) } : op];
    }

    const tokenAny = TOKEN_ANY_PATH.exec(op.path);
    if (tokenAny?.[1] !== undefined) {
      const tokenId = tokenAny[1];
      // Quando temos prevState, transições de visibilidade são emitidas abaixo via add/remove.
      if (prevState && (!wasVisible(tokenId) || !isVisible(tokenId))) return [];
      if (!prevState && !isVisible(tokenId)) return [];
      if (op.op !== 'remove' && TOKEN_PATH.test(op.path)) {
        const token = TokenSchema.safeParse(op.value);
        return [token.success ? { ...op, value: redactToken(token.data, viewer) } : op];
      }
      const hp = TOKEN_HP_PATH.exec(op.path);
      if (hp?.[1] !== undefined) {
        const token = state.tokens[hp[1]];
        return token && seesTokenHp(token, viewer) ? [op] : [];
      }
      return [op];
    }
    return [op];
  });

  if (!prevState) return filtered;

  // Emite `add`/`remove` para tokens que entraram ou saíram da visão deste jogador.
  const allTokenIds = new Set([...Object.keys(prevState.tokens), ...Object.keys(state.tokens)]);
  for (const id of allTokenIds) {
    const before = wasVisible(id);
    const after = isVisible(id);
    if (!before && after) {
      const token = state.tokens[id];
      if (token) filtered.push({ op: 'add', path: toPointer('tokens', id), value: redactToken(token, viewer) });
    } else if (before && !after) {
      filtered.push({ op: 'remove', path: toPointer('tokens', id) });
    }
  }
  return filtered;
}
