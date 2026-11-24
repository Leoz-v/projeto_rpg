import { randomUUID } from 'node:crypto';
import type { Rng } from 'rules-engine';
import type { ChatHistoryPage, HostTableRequest, IntentResultPayload, JoinTableRequest, TableEvent, TableInfo, TableView } from '../../shared/ipc';
import { type AssetMime, chatBefore, chatWindow, DEFAULT_PORT, type Intent } from '../../shared/protocol';
import type { CampaignChoice } from '../../shared/ipc-schemas';
import { AssetError, type AssetStore } from '../assets';
import { CampaignDbError, CampaignNotFoundError, DatabaseTooNewError, type OpenCampaign } from '../db';
import { ConnectError, HostClient, HostServer } from '../net';
import { HostSession, type SessionDeps } from '../session';

/**
 * A mesa deste app: hospeda (mestre) ou entra na de outro (jogador). Só
 * orquestra o executor e o transporte e avisa a tela de cada estado novo. O
 * mestre local manda seus `Intent` pelo mesmo `dispatch` dos jogadores.
 */

export interface TableControllerDeps {
  appVersion: string;
  /** Id deste app (`app.db`). */
  playerId: string;
  /** Abre ou cria a campanha a hospedar (`CampaignLibrary`). */
  campaigns: { open(choice: CampaignChoice): OpenCampaign };
  /** Imagens: as do mestre (Host) e o cache do que veio do Host (jogador). */
  assets: AssetStore;
  rng: Rng;
  monsterExists(id: string): boolean;
  pruneSteps: SessionDeps['pruneSteps'];
  itemProblems: SessionDeps['itemProblems'];
  characterSheet: SessionDeps['characterSheet'];
  monsterHpMax: SessionDeps['monsterHpMax'];
  creature: SessionDeps['creature'];
  spellName: SessionDeps['spellName'];
  /** Endereços desta máquina para mostrar aos jogadores. */
  addresses(): string[];
  /** Entrega um evento à tela. */
  emit(event: TableEvent): void;
  /** Interface de rede do Host; padrão: todas (testes usam 127.0.0.1). */
  listenHost?: string;
  /** Problemas que não chegam à tela (ex.: falha ao salvar). */
  log?: (message: string) => void;
}

/** Falha esperada, com mensagem em pt-BR para a tela. */
export class TableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableError';
  }
}

type Table =
  | { mode: 'host'; info: TableInfo; session: HostSession; server: HostServer; store: OpenCampaign }
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
    if (table.mode === 'host') return { info: table.info, rev: table.session.rev, ...chatWindow(table.session.state) };
    return { info: table.info, rev: table.client.rev, ...chatWindow(table.client.state, table.client.chatFrom) };
  }

  /** Entradas antigas do chat: do estado do Host (o mestre vê tudo) ou pedidas ao Host (`ChatHistoryRequest`). */
  async chatHistory(before: number, limit: number): Promise<ChatHistoryPage> {
    const table = this.table;
    if (!table) throw new TableError('Você não está em uma mesa');
    if (table.mode === 'host') return chatBefore(table.session.state.chat, before, limit);
    try {
      return await table.client.requestChatHistory(before, limit);
    } catch (err: unknown) {
      throw new TableError(err instanceof Error ? err.message : 'Falha ao buscar o histórico do chat');
    }
  }

  async host(request: HostTableRequest): Promise<TableView> {
    this.requireIdle();
    const { deps } = this;
    const store = this.openCampaign(request.campaign);
    const session = new HostSession(
      store.campaign,
      { playerId: deps.playerId, displayName: request.displayName },
      { rng: deps.rng, now: Date.now, newId: randomUUID, monsterExists: (id) => deps.monsterExists(id), assetExists: (sha) => deps.assets.has(sha), pruneSteps: deps.pruneSteps, itemProblems: deps.itemProblems, characterSheet: deps.characterSheet, monsterHpMax: deps.monsterHpMax, creature: deps.creature, spellName: deps.spellName },
      store.restored,
    );
    const server = new HostServer({
      session,
      appVersion: deps.appVersion,
      assets: deps.assets,
      port: request.port ?? DEFAULT_PORT,
      ...(deps.listenHost !== undefined ? { host: deps.listenHost } : {}),
      ...(request.password !== undefined ? { password: request.password } : {}),
      // Salva e avisa a tela (o mestre vê o estado completo). Depois de encerrar, as quedas dos jogadores são ignoradas.
      onChange: (change) => {
        if (this.table?.mode !== 'host' || this.table.session !== session) return;
        this.persist(store, session);
        // Só a janela do chat vai à tela: o custo do IPC não cresce com a campanha (nota 0047).
        deps.emit({ kind: 'state', rev: change.rev, ...chatWindow(session.state) });
      },
    });
    let port: number;
    try {
      port = await server.start();
    } catch (err: unknown) {
      store.close();
      if (hasCode(err, 'EADDRINUSE')) throw new TableError(`A porta ${request.port ?? DEFAULT_PORT} já está em uso`);
      if (hasCode(err, 'EACCES')) throw new TableError(`Sem permissão para usar a porta ${request.port ?? DEFAULT_PORT}`);
      throw err;
    }
    // Grava o mestre desta sessão (e o nome dele) logo ao abrir.
    this.persist(store, session);
    const info: TableInfo = { mode: 'host', role: 'gm', playerId: deps.playerId, campaignName: store.campaign.name, port, addresses: deps.addresses() };
    this.table = { mode: 'host', info, session, server, store };
    return { info, rev: session.rev, ...chatWindow(session.state) };
  }

  private openCampaign(choice: CampaignChoice): OpenCampaign {
    try {
      return this.deps.campaigns.open(choice);
    } catch (err: unknown) {
      if (err instanceof CampaignNotFoundError || err instanceof CampaignDbError || err instanceof DatabaseTooNewError) throw new TableError(err.message);
      throw err;
    }
  }

  /** Salvar nunca derruba a mesa: a falha é registrada e a sessão segue em memória. */
  private persist(store: OpenCampaign, session: HostSession): void {
    try {
      store.save(session.state);
    } catch (err: unknown) {
      this.deps.log?.(`falha ao salvar a campanha: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** A campanha está aberta nesta mesa (não pode ser excluída agora). */
  isHosting(campaignId: string): boolean {
    return this.table?.mode === 'host' && this.table.store.campaign.id === campaignId;
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
    const stopState = client.subscribe((state, rev) => { deps.emit({ kind: 'state', rev, ...chatWindow(state, client.chatFrom) }); });
    const stopClose = client.onClose(() => {
      // Fechamento pedido por `leave` já limpou a mesa; aqui só a queda.
      if (this.table?.mode !== 'player' || this.table.client !== client) return;
      this.table.unsubscribe();
      this.table = undefined;
      deps.emit({ kind: 'closed', message: 'A conexão com o Host caiu' });
    });
    this.table = { mode: 'player', info, client, unsubscribe: () => { stopState(); stopClose(); } };
    return { info, rev: client.rev, ...chatWindow(client.state, client.chatFrom) };
  }

  /** Sai da mesa; no modo `host`, encerra a mesa para todos. */
  async leave(): Promise<void> {
    const table = this.table;
    this.table = undefined;
    if (!table) return;
    if (table.mode === 'host') {
      await table.server.stop();
      this.persist(table.store, table.session);
      table.store.close();
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

  /**
   * Uma imagem para a tela (`vtt-asset://`): do armazenamento local; se não
   * houver e este app for jogador, baixa do Host, confere e guarda no cache.
   */
  async asset(sha256: string): Promise<{ bytes: Buffer; mime: AssetMime } | undefined> {
    const local = this.deps.assets.read(sha256);
    if (local) return local;
    const table = this.table;
    if (table?.mode !== 'player') return undefined;
    try {
      const downloaded = await table.client.requestAsset(sha256);
      this.deps.assets.put(downloaded.bytes, sha256);
      return downloaded;
    } catch (err: unknown) {
      if (err instanceof AssetError) {
        this.deps.log?.(`imagem ${sha256.slice(0, 12)}…: ${err.message}`);
        return undefined;
      }
      throw err;
    }
  }

  private requireIdle(): void {
    if (this.table) throw new TableError('Você já está em uma mesa');
  }
}
