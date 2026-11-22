import type { AppInfo, HostTableRequest, IpcError, JoinTableRequest, Preferences } from './ipc-schemas';
import type { Intent, IntentResultSchema, Role, SessionState } from './protocol';
import type { z } from 'zod';

export type { AppInfo, CampaignChoice, HostTableRequest, IpcError, JoinTableRequest, Preferences } from './ipc-schemas';

/** Canais de IPC. `table:event` vai do main para o renderer; os outros são `invoke`. */
export const IpcChannel = {
  getAppInfo: 'app:get-info',
  getPreferences: 'app:get-preferences',
  listCampaigns: 'campaigns:list',
  hostTable: 'table:host',
  joinTable: 'table:join',
  leaveTable: 'table:leave',
  getTable: 'table:get',
  sendIntent: 'table:intent',
  tableEvent: 'table:event',
} as const;

/** Resposta serializável do main: erros viram valor, nunca exceção. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

export type IntentResultPayload = z.infer<typeof IntentResultSchema>['payload'];

/** A mesa em que este app está. */
export interface TableInfo {
  /** `host`: este app hospeda (o usuário é o mestre); `player`: entrou na mesa de outro. */
  mode: 'host' | 'player';
  role: Role;
  playerId: string;
  campaignName: string;
  /** Só no modo `host`: porta e endereços para passar aos jogadores. */
  port?: number;
  addresses?: string[];
}

/** Uma campanha hospedada nesta máquina. */
export interface CampaignSummary {
  id: string;
  name: string;
  lastOpenedAt: number;
}

/** O que o renderer precisa para desenhar a mesa. */
export interface TableView {
  info: TableInfo;
  rev: number;
  state: SessionState;
}

export type TableEvent = { kind: 'state'; rev: number; state: SessionState } | { kind: 'closed'; message: string };

/** API exposta pelo preload em `window.vtt`. */
export interface VttApi {
  getAppInfo(): Promise<IpcResult<AppInfo>>;
  getPreferences(): Promise<IpcResult<Preferences>>;
  /** Campanhas hospedadas aqui, da mais recente para a mais antiga. */
  listCampaigns(): Promise<IpcResult<CampaignSummary[]>>;
  hostTable(request: HostTableRequest): Promise<IpcResult<TableView>>;
  joinTable(request: JoinTableRequest): Promise<IpcResult<TableView>>;
  leaveTable(): Promise<IpcResult<null>>;
  /** A mesa atual, ou `null` (ex.: depois de recarregar a janela). */
  getTable(): Promise<IpcResult<TableView | null>>;
  sendIntent(intent: Intent): Promise<IpcResult<IntentResultPayload>>;
  /** Avisa a cada estado novo e quando a mesa fecha. Devolve a função que cancela. */
  onTableEvent(listener: (event: TableEvent) => void): () => void;
}
