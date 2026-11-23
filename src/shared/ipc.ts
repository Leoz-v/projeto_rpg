import type { AppInfo, HostTableRequest, IpcError, JoinTableRequest, Preferences } from './ipc-schemas';
import type { DerivedSheet } from 'rules-engine';
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
  characterSheet: 'table:character-sheet',
  creationOptions: 'compendium:creation-options',
  searchItems: 'compendium:search-items',
  characterHpMaxima: 'table:character-hp-maxima',
  monsterActions: 'compendium:monster-actions',
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
    };

/** Uma imagem importada: use `vtt-asset://<sha256>` para exibir e o `sha256` nos `Intent`. */
export interface ImportedAsset {
  sha256: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
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
  /** Exclui uma campanha hospedada aqui (o arquivo vai para a Lixeira). */
  deleteCampaign(id: string): Promise<IpcResult<null>>;
  hostTable(request: HostTableRequest): Promise<IpcResult<TableView>>;
  joinTable(request: JoinTableRequest): Promise<IpcResult<TableView>>;
  leaveTable(): Promise<IpcResult<null>>;
  /** A mesa atual, ou `null` (ex.: depois de recarregar a janela). */
  getTable(): Promise<IpcResult<TableView | null>>;
  sendIntent(intent: Intent): Promise<IpcResult<IntentResultPayload>>;
  /** Monstros do compêndio cujo nome contém o texto (até 20). */
  searchMonsters(query: string): Promise<IpcResult<MonsterSummary[]>>;
  /** Ficha calculada de um personagem da mesa atual. */
  characterSheet(characterId: string): Promise<IpcResult<CharacterSheetView>>;
  /** Itens do compêndio cujo nome contém o texto (até 30). */
  searchItems(query: string): Promise<IpcResult<ItemSummary[]>>;
  /** Ações de ataque e de salvaguarda do bloco de estatísticas de um monstro. */
  monsterActions(monsterId: string): Promise<IpcResult<MonsterAction[]>>;
  /** PV máximos da ficha de cada personagem da mesa atual (os sem atributos ficam de fora). */
  characterHpMaxima(): Promise<IpcResult<Record<string, number>>>;
  /** Espécies, antecedentes e classes do compêndio. */
  creationOptions(): Promise<IpcResult<CreationOptions>>;
  /** Abre o seletor de arquivos e importa uma imagem; `null` se o usuário cancelou. */
  importAsset(): Promise<IpcResult<ImportedAsset | null>>;
  /** Avisa a cada estado novo e quando a mesa fecha. Devolve a função que cancela. */
  onTableEvent(listener: (event: TableEvent) => void): () => void;
}
