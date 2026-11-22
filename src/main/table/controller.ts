import { randomUUID } from 'node:crypto';
import type { Rng } from 'rules-engine';
import type { HostTableRequest, IntentResultPayload, JoinTableRequest, TableEvent, TableInfo, TableView } from '../../shared/ipc';
import { DEFAULT_PORT, type Intent } from '../../shared/protocol';
import { ConnectError, HostClient, HostServer } from '../net';
import { HostSession } from '../session';

/**
 * A mesa deste app: hospeda (mestre) ou entra na de outro (jogador). Só
 * orquestra o executor e o transporte e avisa a tela de cada estado novo. O
 * mestre local manda seus `Intent` pelo mesmo `dispatch` dos jogadores.
 */

export interface TableControllerDeps {
  appVersion: string;
  /** Id deste app (salvo em `app.db` quando o SQLite chegar). */
  playerId: string;
  rng: Rng;
  monsterExists(id: string): boolean;
  /** Endereços desta máquina para mostrar aos jogadores. */
  addresses(): string[];
  /** Entrega um evento à tela. */
  emit(event: TableEvent): void;
  /** Interface de rede do Host; padrão: todas (testes usam 127.0.0.1). */
  listenHost?: string;
}

/** Falha esperada, com mensagem em pt-BR para a tela. */
export class TableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableError';
  }
}

type Table =
  | { mode: 'host'; info: TableInfo; session: HostSession; server: HostServer }
  | { mode: 'player'; info: TableInfo; client: HostClient; unsubscribe: () => void };

const hasCode = (err: unknown, code: string): boolean => err instanceof Error && 'code' in err && err.code === code;

/** `100.64.0.7` → `ws://100.64.0.7:47820`; mantém a porta se vier. */
export function hostUrl(address: string): string {
  return /:\d+$/.test(address) ? `ws://${address}` : `ws://${address}:${DEFAULT_PORT}`;
}

export class TableController {
  private table: Table | undefined;

  constructor(private readonly deps: TableControllerDeps) {}

  /** A mesa atual, para a tela recarregada. */
  view(): TableView | null {
    const table = this.table;
    if (!table) return null;
    if (table.mode === 'host') return { info: table.info, rev: table.session.rev, state: table.session.state };
    return { info: table.info, rev: table.client.rev, state: table.client.state };
  }

  async host(request: HostTableRequest): Promise<TableView> {
    this.requireIdle();
    const { deps } = this;
    const session = new HostSession({ id: randomUUID(), name: request.campaignName }, { playerId: deps.playerId, displayName: request.displayName }, {
      rng: deps.rng,
      now: Date.now,
      newId: randomUUID,
      monsterExists: (id) => deps.monsterExists(id),
    });
    const server = new HostServer({
      session,
      appVersion: deps.appVersion,
      port: request.port ?? DEFAULT_PORT,
      ...(deps.listenHost !== undefined ? { host: deps.listenHost } : {}),
      ...(request.password !== undefined ? { password: request.password } : {}),
      // O mestre vê o estado completo. Depois de encerrar, as quedas dos jogadores não chegam à tela.
      onChange: (change) => {
        if (this.table?.mode === 'host' && this.table.session === session) deps.emit({ kind: 'state', rev: change.rev, state: session.state });
      },
    });
    let port: number;
    try {
      port = await server.start();
    } catch (err: unknown) {
      if (hasCode(err, 'EADDRINUSE')) throw new TableError(`A porta ${request.port ?? DEFAULT_PORT} já está em uso`);
      if (hasCode(err, 'EACCES')) throw new TableError(`Sem permissão para usar a porta ${request.port ?? DEFAULT_PORT}`);
      throw err;
    }
    const info: TableInfo = { mode: 'host', role: 'gm', playerId: deps.playerId, campaignName: request.campaignName, port, addresses: deps.addresses() };
    this.table = { mode: 'host', info, session, server };
    return { info, rev: session.rev, state: session.state };
  }

  async join(request: JoinTableRequest): Promise<TableView> {
    this.requireIdle();
    const { deps } = this;
    let client: HostClient;
    try {
      client = await HostClient.connect({
        url: hostUrl(request.address),
        playerId: deps.playerId,
        displayName: request.displayName,
        appVersion: deps.appVersion,
        ...(request.password !== undefined ? { password: request.password } : {}),
      });
    } catch (err: unknown) {
      if (err instanceof ConnectError) throw new TableError(err.message);
      throw err;
    }
    const info: TableInfo = { mode: 'player', role: client.welcome.role, playerId: deps.playerId, campaignName: client.welcome.campaignName };
    const stopState = client.subscribe((state, rev) => { deps.emit({ kind: 'state', rev, state }); });
    const stopClose = client.onClose(() => {
      // Fechamento pedido por `leave` já limpou a mesa; aqui só a queda.
      if (this.table?.mode !== 'player' || this.table.client !== client) return;
      this.table.unsubscribe();
      this.table = undefined;
      deps.emit({ kind: 'closed', message: 'A conexão com o Host caiu' });
    });
    this.table = { mode: 'player', info, client, unsubscribe: () => { stopState(); stopClose(); } };
    return { info, rev: client.rev, state: client.state };
  }

  /** Sai da mesa; no modo `host`, encerra a mesa para todos. */
  async leave(): Promise<void> {
    const table = this.table;
    this.table = undefined;
    if (!table) return;
    if (table.mode === 'host') {
      await table.server.stop();
      return;
    }
    table.unsubscribe();
    table.client.close();
  }

  async send(intent: Intent): Promise<IntentResultPayload> {
    const table = this.table;
    if (!table) throw new TableError('Você não está em uma mesa');
    if (table.mode === 'host') return table.server.dispatch(this.deps.playerId, intent).result;
    return table.client.send(intent);
  }

  private requireIdle(): void {
    if (this.table) throw new TableError('Você já está em uma mesa');
  }
}
