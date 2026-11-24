import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSET_CHUNK_BYTES, MAX_ASSET_BYTES } from '../../shared/protocol';
import { type ChunkPayload, ChunkAssembler, toChunks } from './chunks';
import { assetHashOf, assetResponse } from './protocol';
import { create3dAssetHandler } from './catalog-3d';
import { AssetError, AssetStore, sha256Hex, sniffMime } from './store';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const image = (signature: number[], size = 100): Buffer => Buffer.concat([Buffer.from(signature), randomBytes(size)]);

const dirs: string[] = [];
const store = (): AssetStore => {
  const dir = mkdtempSync(join(tmpdir(), 'vtt-assets-'));
  dirs.push(dir);
  return new AssetStore(dir);
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('sniffMime', () => {
  it('recognizes PNG, JPEG, WebP and JSON objects by content, not by name', () => {
    expect(sniffMime(image(PNG))).toBe('image/png');
    expect(sniffMime(image(JPEG))).toBe('image/jpeg');
    expect(sniffMime(image(WEBP))).toBe('image/webp');
    expect(sniffMime(Buffer.from('{"schemaVersion":1}'))).toBe('application/json');
    expect(sniffMime(Buffer.from('  \n{"ok":true}'))).toBe('application/json');
    expect(sniffMime(Buffer.from('[1,2,3]'))).toBeUndefined();
    expect(sniffMime(Buffer.from('{invalid'))).toBeUndefined();
    expect(sniffMime(Buffer.from('GIF89a…'))).toBeUndefined();
    expect(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined();
    expect(sniffMime(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('AssetStore', () => {
  it('stores by content hash, reads it back and ignores duplicates', () => {
    const s = store();
    const bytes = image(PNG);
    const stored = s.put(bytes);
    expect(stored).toEqual({ sha256: sha256Hex(bytes), mime: 'image/png', size: bytes.length });
    expect(s.has(stored.sha256)).toBe(true);
    expect(s.read(stored.sha256)?.bytes.equals(bytes)).toBe(true);
    expect(s.put(bytes)).toEqual(stored);
  });

  it('refuses unsupported formats, empty files and content that does not match the hash', () => {
    const s = store();
    expect(() => s.put(Buffer.from('GIF89a'))).toThrow('Formato não suportado');
    expect(() => s.put(Buffer.alloc(0))).toThrow('Arquivo vazio');
    expect(() => s.put(image(PNG), 'e'.repeat(64))).toThrow('não confere');
    expect(s.has('e'.repeat(64))).toBe(false);
  });

  it('never leaves temporary files behind and rejects invalid hashes', () => {
    const s = store();
    const { sha256 } = s.put(image(JPEG));
    const folder = join(dirs[0] ?? '', sha256.slice(0, 2));
    expect(readdirSync(folder)).toEqual([sha256]);
    expect(s.has('../../etc/passwd')).toBe(false);
    expect(s.read('ABC')).toBeUndefined();
  });

  it('refuses images over 32 MiB', () => {
    expect(() => store().put(Buffer.concat([Buffer.from(PNG), Buffer.alloc(MAX_ASSET_BYTES)]))).toThrow('32 MiB');
  });
});

describe('chunks', () => {
  /** O pedaço `i`; falha o teste se não existir. */
  const at = (chunks: ChunkPayload[], i: number): ChunkPayload => {
    const chunk = chunks[i];
    if (!chunk) throw new Error(`sem o pedaço ${i}`);
    return chunk;
  };
  const big = image(PNG, ASSET_CHUNK_BYTES * 2 + 10);
  const sha = sha256Hex(big);

  it('splits into 512 KiB pieces and reassembles them', () => {
    const chunks = toChunks(sha, 'image/png', big);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(chunks.every((c) => c.count === 3 && c.totalSize === big.length)).toBe(true);
    const assembler = new ChunkAssembler(sha);
    expect(assembler.add(at(chunks, 0))).toBeUndefined();
    expect(assembler.add(at(chunks, 1))).toBeUndefined();
    expect(assembler.add(at(chunks, 2))?.bytes.equals(big)).toBe(true);
  });

  it('rejects out-of-order pieces, changed headers, extra data and a wrong hash', () => {
    const chunks = toChunks(sha, 'image/png', big);
    expect(() => new ChunkAssembler(sha).add(at(chunks, 1))).toThrow('fora de ordem');

    const headers = new ChunkAssembler(sha);
    headers.add(at(chunks, 0));
    expect(() => headers.add({ ...at(chunks, 1), totalSize: big.length + 1 })).toThrow('cabeçalhos diferentes');

    const lying = toChunks(sha, 'image/png', big).map((c) => ({ ...c, totalSize: 10 }));
    expect(() => new ChunkAssembler(sha).add(at(lying, 0))).toThrow('Mais dados');

    const other = image(PNG);
    const forged = toChunks(sha, 'image/png', other);
    expect(() => new ChunkAssembler(sha).add(at(forged, 0))).toThrow('não confere');
    expect(() => new ChunkAssembler(sha).add({ ...at(chunks, 0), sha256: 'f'.repeat(64) })).toThrow(AssetError);
  });
});

describe('vtt-asset protocol', () => {
  const sha = 'a'.repeat(64);

  it('reads the hash from vtt-asset://<sha256> only', () => {
    expect(assetHashOf(`vtt-asset://${sha}`)).toBe(sha);
    expect(assetHashOf(`vtt-asset://${sha}/`)).toBe(sha);
    expect(assetHashOf(`vtt-asset://${sha}/../x`)).toBeUndefined();
    expect(assetHashOf(`vtt-asset://${sha}?x=1`)).toBeUndefined();
    expect(assetHashOf('vtt-asset://nao-e-hash')).toBeUndefined();
    expect(assetHashOf(`https://${sha}`)).toBeUndefined();
  });

  it('answers with the bytes and type, 404 when missing and 400 for bad URLs', async () => {
    const bytes = image(WEBP);
    const resolve = (s: string) => Promise.resolve(s === sha ? { bytes, mime: 'image/webp' } : undefined);
    const ok = await assetResponse(new Request(`vtt-asset://${sha}`), resolve);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('image/webp');
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(Buffer.from(await ok.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await assetResponse(new Request(`vtt-asset://${'b'.repeat(64)}`), resolve)).status).toBe(404);
    expect((await assetResponse(new Request('vtt-asset://x'), resolve)).status).toBe(400);
    expect((await assetResponse(new Request(`vtt-asset://${sha}`, { method: 'POST' }), resolve)).status).toBe(405);
    expect((await assetResponse(new Request(`vtt-asset://${sha}`), () => Promise.reject(new Error('rede')))).status).toBe(502);
  });
});

describe('vtt-3d protocol', () => {
  it('serves the bundled 3D catalog and blocks path traversal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vtt-3d-'));
    dirs.push(dir);
    const handler = create3dAssetHandler(dir);

    const catalogRes = handler(new Request('vtt-3d://catalog.json'));
    expect(catalogRes.status).toBe(200);
    expect(catalogRes.headers.get('Content-Type')).toContain('application/json');
    const body = (await catalogRes.json()) as { count: number; assets: unknown[] };
    expect(body.count).toBe(0);
    expect(body.assets).toEqual([]);

    expect(handler(new Request('vtt-3d://models/%2e%2e%2f%2e%2e%2fsecret.glb')).status).toBe(403);
    expect(handler(new Request('vtt-3d://models/missing.glb')).status).toBe(404);
    expect(handler(new Request('vtt-3d://catalog.json', { method: 'POST' })).status).toBe(405);
  });
});
