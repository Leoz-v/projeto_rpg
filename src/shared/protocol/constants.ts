/** Constantes do protocolo de rede (docs/network-protocol.md). */

/** Porta padrão do Host. */
export const DEFAULT_PORT = 47820;
/** Tamanho máximo de um frame de texto. */
export const MAX_FRAME_BYTES = 1024 * 1024;
/** Dados brutos por `AssetChunk`, antes do Base64. */
export const ASSET_CHUNK_BYTES = 512 * 1024;
/** Tamanho máximo de um asset. */
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
/** Sem pedaço novo nesse tempo, o pedido de asset falha. */
export const ASSET_TIMEOUT_MS = 30_000;
/** Tempo que o Host espera pelo `Handshake` depois de abrir a conexão. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
/** Intervalo dos `Ping` do Host. */
export const PING_INTERVAL_MS = 15_000;
/** Sem `Pong` nesse tempo, a conexão é considerada morta. */
export const PONG_TIMEOUT_MS = 30_000;
/** 1 célula = 5 ft = 100 unidades de mundo. */
export const WORLD_UNITS_PER_CELL = 100;
/** Limites de dimensões de um mapa (em células) e da célula em pixels da imagem. */
export const MAX_MAP_CELLS = 200;
export const MAX_CELL_PX = 4096;
/** Limites da névoa de guerra (nota 0056). */
export const DEFAULT_VISION_FEET = 60;
export const MIN_VISION_FEET = 5;
export const MAX_VISION_FEET = 300;
export const MAX_FOG_PAINT_CELLS = 2000;
/** Limites de colisão e paredes por mapa (nota 0061). */
export const MAX_MAP_WALLS = 2000;
export const DOOR_INTERACT_CELLS = 2;
/** Limites de fontes de luz dinâmicas e overrides de tochas do mapa (nota 0061). */
export const MAX_MAP_LIGHTS = 100;
export const MAX_PROP_LIGHT_OVERRIDES = 500;
export const LIGHT_INTERACT_CELLS = 2;
/** Entradas no inventário de um personagem e quantidade por entrada. */
export const MAX_INVENTORY_ITEMS = 500;
export const MAX_ITEM_QUANTITY = 9999;
/** Ajustes do mestre por personagem e efeitos por ajuste. */
export const MAX_ADJUSTMENTS = 50;
export const MAX_ADJUSTMENT_EFFECTS = 20;
/** Limite de PV máximos de um token e de uma mudança de PV. */
export const MAX_HIT_POINTS = 100_000;
/** Alvos de uma salvaguarda forçada (`save.force`). */
export const MAX_SAVE_TARGETS = 20;
/** Partes da resolução de uma magia guardadas no `spell_cast` (o SRD chega a 7). */
export const MAX_SPELL_PARTS = 10;
/** Opções de uma parte `buff` de magia (Guidance: as 18 perícias). */
export const MAX_SPELL_OPTIONS = 20;
/** Itens de uma entrada `turn_trigger` (lembretes e cura de um combatente num momento). */
export const MAX_TURN_TRIGGER_ITEMS = 20;
/** Entradas do chat no `StateSnapshot` e no estado que vai à tela (nota 0047). */
export const CHAT_WINDOW = 200;
/** Entradas por `ChatHistoryRequest`. */
export const MAX_CHAT_HISTORY = 200;
/** Combatentes num combate. */
export const MAX_COMBATANTS = 50;
/** Faixa da iniciativa (rolada ou definida pelo mestre). */
export const MIN_INITIATIVE = -20;
export const MAX_INITIATIVE = 60;
/** Moedas de cada tipo. */
export const MAX_COINS = 1_000_000_000;
/** Limites da fórmula de `dice.roll`. */
export const MAX_FORMULA_LENGTH = 100;
export const MAX_FORMULA_DICE = 100;
