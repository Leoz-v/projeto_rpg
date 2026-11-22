import { randomUUID } from 'node:crypto';
import type { RawData } from 'ws';
import type { z } from 'zod';
import { type ClientMessage, type HostMessage, UuidSchema } from '../../shared/protocol';

/** Codificação dos frames: um objeto JSON por frame de texto (docs/network-protocol.md). */

export type Decoded<T> = { ok: true; value: T } | { ok: false; message: string; replyTo?: string };

type Outgoing<M extends { type: string; replyTo?: string; payload: unknown }> = M extends unknown ? Omit<M, 'id'> & { id?: string } : never;
export type OutgoingHostMessage = Outgoing<HostMessage>;
export type OutgoingClientMessage = Outgoing<ClientMessage>;

/** Serializa uma mensagem, gerando o `id` quando não vier. */
export function encode(message: OutgoingHostMessage | OutgoingClientMessage): string {
  return JSON.stringify({ ...message, id: message.id ?? randomUUID() });
}

function textOf(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return raw.toString('utf8');
}

/** O `id` de uma mensagem que não passou no schema, para o `replyTo` do `Error`. */
function idOf(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null || !('id' in json)) return undefined;
  const id = UuidSchema.safeParse(json.id);
  return id.success ? id.data : undefined;
}

/** Valida um frame recebido. Frames binários não fazem parte do protocolo. */
export function decode<T>(schema: z.ZodType<T>, raw: RawData, isBinary: boolean): Decoded<T> {
  if (isBinary) return { ok: false, message: 'Frames binários não são aceitos' };
  let json: unknown;
  try {
    json = JSON.parse(textOf(raw));
  } catch {
    return { ok: false, message: 'JSON inválido' };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  const replyTo = idOf(json);
  return { ok: false, message: 'Mensagem fora do protocolo', ...(replyTo !== undefined ? { replyTo } : {}) };
}
