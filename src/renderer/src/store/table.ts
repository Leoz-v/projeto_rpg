import { useSyncExternalStore } from 'react';
import type { HostTableRequest, IntentResultPayload, IpcResult, JoinTableRequest, TableView } from '../../../shared/ipc';
import type { Intent } from '../../../shared/protocol';

/**
 * Estado da mesa na tela: uma cópia do que o processo main informa. A tela
 * nunca muda o estado da campanha; só pede (`send`) e espera o novo estado.
 */

export type TableSnapshot = { status: 'loading' } | { status: 'lobby'; notice?: string } | { status: 'table'; view: TableView };

let snapshot: TableSnapshot = { status: 'loading' };
const listeners = new Set<() => void>();
let started = false;

function set(next: TableSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Liga a tela aos eventos do main e busca a mesa atual (a janela pode ter recarregado). */
function start(): void {
  if (started) return;
  started = true;
  window.vtt.onTableEvent((event) => {
    if (event.kind === 'closed') {
      set({ status: 'lobby', notice: event.message });
      return;
    }
    if (snapshot.status !== 'table' || event.rev < snapshot.view.rev) return;
    set({ status: 'table', view: { ...snapshot.view, rev: event.rev, state: event.state } });
  });
  void window.vtt.getTable().then((result) => {
    if (snapshot.status !== 'loading') return;
    set(result.ok && result.value ? { status: 'table', view: result.value } : { status: 'lobby' });
  });
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTable(): TableSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Erro pronto para a tela, ou `null` se deu certo. */
async function enter(request: Promise<IpcResult<TableView>>): Promise<string | null> {
  const result = await request;
  if (!result.ok) return result.error.message;
  set({ status: 'table', view: result.value });
  return null;
}

export const hostTable = (request: HostTableRequest): Promise<string | null> => enter(window.vtt.hostTable(request));
export const joinTable = (request: JoinTableRequest): Promise<string | null> => enter(window.vtt.joinTable(request));

export async function leaveTable(): Promise<void> {
  await window.vtt.leaveTable();
  set({ status: 'lobby' });
}

/** Envia um `Intent`; devolve a mensagem de recusa, ou `null` se foi aplicado. */
export async function sendIntent(intent: Intent): Promise<string | null> {
  const result = await window.vtt.sendIntent(intent);
  if (!result.ok) return result.error.message;
  const outcome: IntentResultPayload = result.value;
  return outcome.status === 'rejected' ? outcome.message : null;
}
