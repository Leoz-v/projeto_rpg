/** Constantes do protocolo de rede (docs/network-protocol.md). */

/** Porta padrão do Host. */
export const DEFAULT_PORT = 47820;
/** Tamanho máximo de um frame de texto. */
export const MAX_FRAME_BYTES = 1024 * 1024;
/** Dados brutos por `AssetChunk`, antes do Base64. */
export const ASSET_CHUNK_BYTES = 512 * 1024;
/** Tempo que o Host espera pelo `Handshake` depois de abrir a conexão. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
/** Intervalo dos `Ping` do Host. */
export const PING_INTERVAL_MS = 15_000;
/** Sem `Pong` nesse tempo, a conexão é considerada morta. */
export const PONG_TIMEOUT_MS = 30_000;
/** 1 célula = 5 ft = 100 unidades de mundo. */
export const WORLD_UNITS_PER_CELL = 100;
/** Limites da fórmula de `dice.roll`. */
export const MAX_FORMULA_LENGTH = 100;
export const MAX_FORMULA_DICE = 100;
