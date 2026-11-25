import type { AppInfo, HostTableRequest, IpcError, JoinTableRequest, Preferences } from './ipc-schemas';
import type { Creature, DerivedSheet } from 'rules-engine';
import type { Ability, Condition, DamageType, Size } from 'rules-engine/schemas';
import type { Intent, IntentResultSchema, Role, SessionState } from './protocol';
import type { z } from 'zod';

export type { AppInfo, CampaignChoice, HostTableRequest, IpcError, JoinTableRequest, Preferences } from './ipc-schemas';

/** Canais de IPC. `table:event` vai do main para o renderer; os outros são `invoke`. */
export const IpcChannel = {
  getAppInfo: 'app:get-info',
  getPreferences: 'app:get-preferences',
  listCampaigns: 'campaigns:list',
  deleteCampaign: 'campaigns:delete',
  searchMonsters: 'compendium:search-monsters',
  hostTable: 'table:host',
  joinTable: 'table:join',
  leaveTable: 'table:leave',
  getTable: 'table:get',
  importAsset: 'assets:import',
  save3dMapAsset: 'assets:save-3d-map',
  characterSheet: 'table:character-sheet',
  creationOptions: 'compendium:creation-options',
  searchItems: 'compendium:search-items',
  characterHpMaxima: 'table:character-hp-maxima',
  monsterActions: 'compendium:monster-actions',
  monsterBlock: 'compendium:monster-block',
  sendIntent: 'table:intent',
  chatHistory: 'table:chat-history',
  tableEvent: 'table:event',
  getUpdateStatus: 'app:update-status',
  installUpdate: 'app:install-update',
  updateEvent: 'app:update-event',
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

/** Um monstro do compêndio, para colocar como token. */
export interface MonsterSummary {
  id: string;
  name: string;
  size: Size;
  /** Nível de desafio (0,125 = 1/8). */
  cr: number;
}

/** Um item do compêndio, para o inventário. Item mágico genérico: escolher `variants` e `bases`. */
export interface ItemSummary {
  id: string;
  name: string;
  kind: 'weapon' | 'armor' | 'tool' | 'gear' | 'magic_item';
  /** Raridades possíveis (as das variantes, em ordem), só para itens mágicos. */
  rarity?: string[];
  attunement: boolean;
  attunementBy?: string;
  variants: { id: string; name: string }[];
  bases: { id: string; name: string }[];
}

/** Ação de um monstro do compêndio que o mestre usa com o token: ataque ou salvaguarda. */
/** Bloco de um monstro com os modificadores e salvaguardas calculados pelo motor. */
export interface MonsterBlockView {
  creature: Creature;
  abilities: Record<Ability, { modifier: number; save: number }>;
  /** Magias do bloco (nota 0067), com o nome e o que a mesa resolve. */
  spells: { spellId: string; name: string; level: number; concentration: boolean; structured: boolean; note?: string; use?: { id: string; perDay: number } }[];
}

/** Limite de uso publicado no bloco. */
type ActionLimit = NonNullable<Creature['actions'][number]['limit']>;

export type MonsterAction =
  | {
      kind: 'attack';
      id: string;
      name: string;
      toHit: number;
      /** Dano como publicado: a expressão e o tipo (id do motor; a tela traduz). */
      damage: { dice: string; type: DamageType }[];
      reach?: number;
      range?: number;
      limit?: ActionLimit;
    }
  | {
      kind: 'save';
      id: string;
      name: string;
      ability: Ability;
      dc: number;
      damage: { dice: string; type: DamageType }[];
      onSuccess: 'half' | 'none';
      conditions: Condition[];
      limit?: ActionLimit;
    };

/** Um asset importado ou salvo: use `vtt-asset://<sha256>` para exibir/carregar e o `sha256` nos `Intent`. */
export interface ImportedAsset {
  sha256: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/json';
  size: number;
}

/**
 * Ficha calculada de um personagem da mesa. `sheet` é `null` enquanto os
 * atributos não foram definidos. `names`: nome no compêndio dos ids que a
 * ficha cita (espécie, classes, magias, ferramentas).
 */
export interface CharacterSheetView {
  sheet: DerivedSheet | null;
  names: Record<string, string>;
  /** Texto de apoio dos candidatos de talento, magia e subclasse nas escolhas pendentes, por id. */
  details: Record<string, string>;
}

/** Primeiros passos da criação: o que cada espécie, antecedente e classe oferece, para escolher. */
export interface CreationOptions {
  species: { id: string; name: string; sizes: Size[]; speed: number; traits: string[] }[];
  backgrounds: { id: string; name: string; abilityOptions: [Ability, Ability, Ability]; traits: string[] }[];
  classes: { id: string; name: string; hitDie: number; primaryAbilities: Ability[]; traits: string[] }[];
}

/** O que o renderer precisa para desenhar a mesa. */
/**
 * A mesa na tela. `state.chat` traz só as últimas entradas (janela do chat,
 * nota 0047); `chatFrom` é a posição da primeira no log completo, e as
 * anteriores vêm por `chatHistory`.
 */
export interface TableView {
  info: TableInfo;
  rev: number;
  state: SessionState;
  chatFrom: number;
}

export type TableEvent = { kind: 'state'; rev: number; state: SessionState; chatFrom: number } | { kind: 'closed'; message: string };

/** Entradas antigas do chat, com a posição da primeira no log completo. */
export interface ChatHistoryPage {
  from: number;
  entries: SessionState['chat'];
}

/** Situação da atualização automática (nota 0048). */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
  /** Sem atualização automática (app de desenvolvimento, Mac sem assinatura). */
  | { state: 'unavailable'; reason: string };

/** API exposta pelo preload em `window.vtt`. */
export interface VttApi {
  getAppInfo(): Promise<IpcResult<AppInfo>>;
  getPreferences(): Promise<IpcResult<Preferences>>;
  /** Campanhas hospedadas aqui, da mais recente para a mais antiga. */
  listCampaigns(): Promise<IpcResult<CampaignSummary[]>>;
  /** Exclui uma campanha hospedada aqui (o arquivo vai para a Lixeira). */
  deleteCampaign(id: string): Promise<IpcResult<null>>;
  hostTable(request: HostTableRequest): Promise<IpcResult<TableView>>;
  joinTable(request: JoinTableRequest): Promise<IpcResult<TableView>>;
  leaveTable(): Promise<IpcResult<null>>;
  /** A mesa atual, ou `null` (ex.: depois de recarregar a janela). */
  getTable(): Promise<IpcResult<TableView | null>>;
  sendIntent(intent: Intent): Promise<IpcResult<IntentResultPayload>>;
  /** Até `limit` entradas do chat antes da posição `before` do log. */
  chatHistory(before: number, limit: number): Promise<IpcResult<ChatHistoryPage>>;
  /** Monstros do compêndio cujo nome contém o texto (até 20). */
  searchMonsters(query: string): Promise<IpcResult<MonsterSummary[]>>;
  /** Ficha calculada de um personagem da mesa atual. */
  characterSheet(characterId: string): Promise<IpcResult<CharacterSheetView>>;
  /** Itens do compêndio cujo nome contém o texto (até 30). */
  searchItems(query: string): Promise<IpcResult<ItemSummary[]>>;
  /** Ações de ataque e de salvaguarda do bloco de estatísticas de um monstro. */
  monsterActions(monsterId: string): Promise<IpcResult<MonsterAction[]>>;
  /** Bloco de estatísticas inteiro de um monstro; `null` se não existe. */
  monsterBlock(monsterId: string): Promise<IpcResult<MonsterBlockView | null>>;
  /** PV máximos da ficha de cada personagem da mesa atual (os sem atributos ficam de fora). */
  characterHpMaxima(): Promise<IpcResult<Record<string, number>>>;
  /** Espécies, antecedentes e classes do compêndio. */
  creationOptions(): Promise<IpcResult<CreationOptions>>;
  /** Abre o seletor de arquivos e importa uma imagem; `null` se o usuário cancelou. */
  importAsset(): Promise<IpcResult<ImportedAsset | null>>;
  /** Grava o JSON de um mapa 3D no armazenamento de assets (por SHA-256) para uso em `map.create` / `map.update`. */
  save3dMapAsset(json: string): Promise<IpcResult<ImportedAsset>>;
  /** Avisa a cada estado novo e quando a mesa fecha. Devolve a função que cancela. */
  onTableEvent(listener: (event: TableEvent) => void): () => void;
  getUpdateStatus(): Promise<IpcResult<UpdateStatus>>;
  /** Reinicia e instala a versão baixada (recusa numa mesa). */
  installUpdate(): Promise<IpcResult<null>>;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
}
