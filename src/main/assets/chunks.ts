import { ASSET_CHUNK_BYTES, type AssetMime, MAX_ASSET_BYTES } from '../../shared/protocol';
import { AssetError, sha256Hex } from './store';

/** Divisão de um asset em `AssetChunk` e a montagem do lado do cliente (docs/network-protocol.md, 2.9). */

export interface ChunkPayload {
  sha256: string;
  mime: AssetMime;
  totalSize: number;
  index: number;
  count: number;
  /** Base64. */
  data: string;
}

/** Os pedaços de um asset, em ordem, com até 512 KiB de dados brutos cada. */
export function toChunks(sha256: string, mime: AssetMime, bytes: Buffer): ChunkPayload[] {
  const count = Math.max(1, Math.ceil(bytes.length / ASSET_CHUNK_BYTES));
  return Array.from({ length: count }, (_, index) => ({
    sha256,
    mime,
    totalSize: bytes.length,
    index,
    count,
    data: bytes.subarray(index * ASSET_CHUNK_BYTES, (index + 1) * ASSET_CHUNK_BYTES).toString('base64'),
  }));
}

/**
 * Junta os pedaços de um pedido. Exige ordem, cabeçalho igual em todos e,
 * no fim, o tamanho e o SHA-256 anunciados. Qualquer desvio é `AssetError`.
 */
export class ChunkAssembler {
  private readonly parts: Buffer[] = [];
  private received = 0;
  private header: Omit<ChunkPayload, 'index' | 'data'> | undefined;

  constructor(private readonly sha256: string) {}

  /** Acrescenta um pedaço; devolve o asset completo no último, ou `undefined`. */
  add(chunk: ChunkPayload): { bytes: Buffer; mime: AssetMime } | undefined {
    if (chunk.sha256 !== this.sha256) throw new AssetError('Pedaço de outro asset');
    if (chunk.totalSize > MAX_ASSET_BYTES) throw new AssetError('Imagem maior que 32 MiB');
    const header = { sha256: chunk.sha256, mime: chunk.mime, totalSize: chunk.totalSize, count: chunk.count };
    this.header ??= header;
    if (this.header.mime !== header.mime || this.header.totalSize !== header.totalSize || this.header.count !== header.count) {
      throw new AssetError('Pedaços com cabeçalhos diferentes');
    }
    if (chunk.index !== this.parts.length) throw new AssetError('Pedaço fora de ordem');

    const data = Buffer.from(chunk.data, 'base64');
    this.received += data.length;
    if (this.received > header.totalSize) throw new AssetError('Mais dados que o anunciado');
    this.parts.push(data);
    if (this.parts.length < header.count) return undefined;

    const bytes = Buffer.concat(this.parts);
    if (bytes.length !== header.totalSize) throw new AssetError('Tamanho diferente do anunciado');
    if (sha256Hex(bytes) !== this.sha256) throw new AssetError('O conteúdo não confere com o SHA-256');
    return { bytes, mime: header.mime };
  }
}
