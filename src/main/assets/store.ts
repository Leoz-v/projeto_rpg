import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AssetMime, MAX_ASSET_BYTES, Sha256Schema } from '../../shared/protocol';

/**
 * Assets endereçados pelo SHA-256 do conteúdo (CLAUDE.md): cada arquivo é
 * gravado uma vez em `<pasta>/<2 primeiros>/<sha256>` e nunca muda. O mesmo
 * armazenamento serve o Host (o que o mestre importou) e o cliente (o cache do
 * que já baixou). A existência do arquivo é a fonte da verdade: não há índice.
 */

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetError';
  }
}

export interface StoredAsset {
  sha256: string;
  mime: AssetMime;
  size: number;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean => signature.every((b, i) => bytes[offset + i] === b);

/** O tipo da imagem pela assinatura dos primeiros bytes; `undefined` se não for PNG, JPEG nem WebP. */
export function sniffMime(bytes: Uint8Array): AssetMime | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return undefined;
}

export class AssetStore {
  constructor(private readonly dir: string) {}

  private pathOf(sha256: string): string {
    if (!Sha256Schema.safeParse(sha256).success) throw new AssetError('SHA-256 inválido');
    return join(this.dir, sha256.slice(0, 2), sha256);
  }

  has(sha256: string): boolean {
    return Sha256Schema.safeParse(sha256).success && existsSync(this.pathOf(sha256));
  }

  /** O conteúdo e o tipo, ou `undefined` se não existe. */
  read(sha256: string): { bytes: Buffer; mime: AssetMime } | undefined {
    if (!this.has(sha256)) return undefined;
    const bytes = readFileSync(this.pathOf(sha256));
    const mime = sniffMime(bytes);
    return mime ? { bytes, mime } : undefined;
  }

  /**
   * Valida e grava. `expected`: o hash anunciado (asset recebido do Host);
   * se não bater, nada é gravado. Gravar de novo o mesmo conteúdo não faz nada.
   */
  put(bytes: Uint8Array, expected?: string): StoredAsset {
    if (bytes.length === 0) throw new AssetError('Arquivo vazio');
    if (bytes.length > MAX_ASSET_BYTES) throw new AssetError('Imagem maior que 32 MiB');
    const mime = sniffMime(bytes);
    if (!mime) throw new AssetError('Formato não suportado: use PNG, JPEG ou WebP');
    const sha256 = sha256Hex(bytes);
    if (expected !== undefined && expected !== sha256) throw new AssetError('O conteúdo não confere com o SHA-256');

    const target = this.pathOf(sha256);
    if (!existsSync(target)) {
      mkdirSync(join(this.dir, sha256.slice(0, 2)), { recursive: true });
      // Grava num temporário e renomeia: um arquivo com esse nome está sempre completo.
      const temp = `${target}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temp, bytes);
        renameSync(temp, target);
      } catch (err: unknown) {
        rmSync(temp, { force: true });
        throw err;
      }
    }
    return { sha256, mime, size: bytes.length };
  }
}
