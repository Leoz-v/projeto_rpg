import { CHAT_WINDOW } from './constants';
import type { ChatEntry, SessionState } from './state';

/**
 * Janela do chat (nota 0047): o estado com só as últimas `size` entradas, e a
 * posição da primeira no log completo. `chatFrom` é a posição de `state.chat[0]`
 * no log (0 quando o estado tem o log inteiro).
 */
export function chatWindow(state: SessionState, chatFrom = 0, size = CHAT_WINDOW): { state: SessionState; chatFrom: number } {
  const drop = Math.max(0, state.chat.length - size);
  if (drop === 0) return { state, chatFrom };
  return { state: { ...state, chat: state.chat.slice(drop) }, chatFrom: chatFrom + drop };
}

/** As até `limit` entradas antes da posição `before` de um log completo, com a posição da primeira. */
export function chatBefore(chat: readonly ChatEntry[], before: number, limit: number): { from: number; entries: ChatEntry[] } {
  const end = Math.min(Math.max(0, before), chat.length);
  const from = Math.max(0, end - limit);
  return { from, entries: chat.slice(from, end) };
}
