import type { ChatEntry } from '../../../shared/protocol';

/**
 * Log do chat na tela (nota 0047). O estado traz só a janela das últimas
 * entradas, e as anteriores chegam sob demanda. O log junta tudo pela posição
 * no log completo: cada entrada tem a mesma posição para todos e nunca muda
 * depois de criada, então o que saiu da janela continua valendo.
 */
export type ChatLog = ReadonlyMap<number, ChatEntry>;

export const EMPTY_CHAT_LOG: ChatLog = new Map();

/** Um log novo com as entradas a partir da posição `from`; as novas substituem as da mesma posição. */
export function addToChatLog(log: ChatLog, from: number, entries: readonly ChatEntry[]): ChatLog {
  if (entries.length === 0) return log;
  const next = new Map(log);
  entries.forEach((entry, i) => next.set(from + i, entry));
  return next;
}

/** Posição da entrada mais antiga do log (0 se vazio). */
export function firstChatIndex(log: ChatLog): number {
  let min = Number.POSITIVE_INFINITY;
  for (const index of log.keys()) if (index < min) min = index;
  return min === Number.POSITIVE_INFINITY ? 0 : min;
}

/** As entradas em ordem. */
export function chatLogEntries(log: ChatLog): ChatEntry[] {
  return [...log.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry);
}

/**
 * O log da tela: as páginas guardadas mais a janela atual do estado. Se a
 * janela andou e deixou um buraco depois das páginas guardadas, elas são
 * descartadas (o botão "Carregar mensagens anteriores" busca de novo).
 */
export function chatLogWithWindow(saved: ChatLog, from: number, window: readonly ChatEntry[]): ChatLog {
  let last = -1;
  for (const index of saved.keys()) if (index > last) last = index;
  const base = saved.size > 0 && last < from - 1 ? EMPTY_CHAT_LOG : saved;
  return addToChatLog(base, from, window);
}
