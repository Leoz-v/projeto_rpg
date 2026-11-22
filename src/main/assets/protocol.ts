import { Sha256Schema } from '../../shared/protocol';

/**
 * Resposta do protocolo `vtt-asset://<sha256>` (registrado com
 * `protocol.handle` no main). O PixiJS carrega a imagem por essa URL, sem
 * Base64 pelo IPC. Função pura sobre `Request`/`Response` para ser testável.
 */

export const ASSET_SCHEME = 'vtt-asset';

export type AssetResolver = (sha256: string) => Promise<{ bytes: Uint8Array; mime: string } | undefined>;

/** `vtt-asset://<sha256>` → o hash; `undefined` se a URL não é desse formato. */
export function assetHashOf(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${ASSET_SCHEME}:` || (parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search !== '') return undefined;
  const sha = Sha256Schema.safeParse(parsed.hostname);
  return sha.success ? sha.data : undefined;
}

export async function assetResponse(request: Request, resolve: AssetResolver): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const sha256 = assetHashOf(request.url);
  if (!sha256) return new Response(null, { status: 400 });
  try {
    const asset = await resolve(sha256);
    if (!asset) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        'Content-Type': asset.mime,
        // O conteúdo de um hash nunca muda.
        'Cache-Control': 'public, max-age=31536000, immutable',
        // A tela vem de `file://` (outra origem): sem isto, o `fetch` do PixiJS é bloqueado. O esquema só existe dentro do app.
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
