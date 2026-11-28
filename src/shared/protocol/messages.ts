import { z } from 'zod';
import { NameSchema, Sha256Schema, UuidSchema } from './common';
import { ASSET_CHUNK_BYTES, MAX_ASSET_BYTES, MAX_CHAT_HISTORY } from './constants';
import { IntentSchema } from './intents';
import { ChatEntrySchema, RoleSchema, SessionStateSchema } from './state';

/** Mensagens WebSocket (docs/network-protocol.md, seção 2). */

/** Envelope com `replyTo` opcional. */
const message = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.strictObject({ type: z.literal(type), id: UuidSchema, replyTo: UuidSchema.optional(), payload });
/** Envelope de resposta: `replyTo` obrigatório. */
const reply = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.strictObject({ type: z.literal(type), id: UuidSchema, replyTo: UuidSchema, payload });

export const HandshakeRejectReasonSchema = z.enum(['protocol_mismatch', 'bad_password', 'duplicate_player', 'session_full']);
export type HandshakeRejectReason = z.infer<typeof HandshakeRejectReasonSchema>;

/** Texto exibido para cada recusa (seção 2.3). */
export const HANDSHAKE_REJECT_MESSAGES: Record<HandshakeRejectReason, string> = {
  protocol_mismatch: 'Atualize o app',
  bad_password: 'Senha da mesa incorreta',
  duplicate_player: 'Este jogador já está conectado',
  session_full: 'A mesa está cheia',
};

export const IntentRejectCodeSchema = z.enum(['invalid_intent', 'not_allowed', 'rule_violation', 'gm_rejected', 'internal_error']);
export type IntentRejectCode = z.infer<typeof IntentRejectCodeSchema>;
export const ErrorCodeSchema = z.enum(['invalid_message', 'not_ready', 'asset_not_found', 'internal_error']);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const AssetMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/json']);
export type AssetMime = z.infer<typeof AssetMimeSchema>;

/** Operação JSON Patch (RFC 6902), restrita a `add`, `remove` e `replace`. */
const PointerSchema = z.string().regex(/^(\/[^/]*)+$/, 'JSON Pointer inválido');
export const PatchOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), path: PointerSchema, value: z.unknown() }),
  z.strictObject({ op: z.literal('remove'), path: PointerSchema }),
  z.strictObject({ op: z.literal('replace'), path: PointerSchema, value: z.unknown() }),
]);
export type PatchOp = z.infer<typeof PatchOpSchema>;

const ProtocolVersionSchema = z.int().positive();
const RevSchema = z.int().nonnegative();

export const HandshakeSchema = message(
  'Handshake',
  z.strictObject({
    protocolVersion: ProtocolVersionSchema,
    appVersion: z.string().min(1),
    playerId: UuidSchema,
    displayName: NameSchema,
    sessionPassword: z.string().min(1).optional(),
  }),
);
export const HandshakeAcceptSchema = reply(
  'HandshakeAccept',
  z.strictObject({
    protocolVersion: ProtocolVersionSchema,
    hostAppVersion: z.string().min(1),
    campaignId: UuidSchema,
    campaignName: NameSchema,
    role: RoleSchema,
  }),
);
export const HandshakeRejectSchema = reply(
  'HandshakeReject',
  z.strictObject({ reason: HandshakeRejectReasonSchema, message: z.string().min(1), hostProtocolVersion: ProtocolVersionSchema.optional() }),
);
export const IntentMessageSchema = message('Intent', IntentSchema);
export const IntentResultSchema = reply(
  'IntentResult',
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('applied'), rev: RevSchema }),
    z.strictObject({ status: z.literal('rejected'), code: IntentRejectCodeSchema, message: z.string().min(1) }),
    z.strictObject({ status: z.literal('pending_gm') }),
  ]),
);
/** `chatFrom`: posição da primeira entrada de `state.chat` no log completo (janela do chat, nota 0047). */
export const StateSnapshotSchema = message('StateSnapshot', z.strictObject({ rev: RevSchema, state: SessionStateSchema, chatFrom: z.int().nonnegative() }));
export const ChatHistoryRequestSchema = message('ChatHistoryRequest', z.strictObject({ before: z.int().nonnegative(), limit: z.int().min(1).max(MAX_CHAT_HISTORY) }));
export const ChatHistorySchema = reply('ChatHistory', z.strictObject({ from: z.int().nonnegative(), entries: z.array(ChatEntrySchema).max(MAX_CHAT_HISTORY) }));
export const StatePatchSchema = message(
  'StatePatch',
  z
    .strictObject({ rev: RevSchema, baseRev: RevSchema, ops: z.array(PatchOpSchema) })
    .refine((p) => p.rev === p.baseRev + 1, { message: 'rev deve ser baseRev + 1' }),
);
export const AssetRequestSchema = message('AssetRequest', z.strictObject({ sha256: Sha256Schema }));
export const AssetChunkSchema = reply(
  'AssetChunk',
  z
    .strictObject({
      sha256: Sha256Schema,
      mime: AssetMimeSchema,
      totalSize: z.int().positive().max(MAX_ASSET_BYTES),
      index: z.int().nonnegative(),
      count: z.int().positive().max(Math.ceil(MAX_ASSET_BYTES / ASSET_CHUNK_BYTES)),
      data: z.base64(),
    })
    .refine((c) => c.index < c.count, { message: 'index deve ser menor que count' }),
);
export const PingSchema = message('Ping', z.strictObject({ t: z.int().nonnegative() }));
export const PongSchema = reply('Pong', z.strictObject({ t: z.int().nonnegative() }));
export const ErrorMessageSchema = message('Error', z.strictObject({ code: ErrorCodeSchema, message: z.string().min(1) }));

/** O que o Host aceita de um cliente. */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  HandshakeSchema,
  IntentMessageSchema,
  ChatHistoryRequestSchema,
  AssetRequestSchema,
  PingSchema,
  PongSchema,
  ErrorMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/**
 * O que um cliente aceita do Host. O tipo vem declarado, mensagem por
 * mensagem: inferido da união inteira, ele passa do tamanho que o TypeScript
 * consegue escrever numa declaração (TS7056 nos projetos `composite`).
 */
export type HostMessage =
  | z.infer<typeof HandshakeAcceptSchema>
  | z.infer<typeof HandshakeRejectSchema>
  | z.infer<typeof IntentResultSchema>
  | z.infer<typeof StateSnapshotSchema>
  | z.infer<typeof StatePatchSchema>
  | z.infer<typeof ChatHistorySchema>
  | z.infer<typeof AssetChunkSchema>
  | z.infer<typeof PingSchema>
  | z.infer<typeof PongSchema>
  | z.infer<typeof ErrorMessageSchema>;
export const HostMessageSchema: z.ZodType<HostMessage, unknown> = z.discriminatedUnion('type', [
  HandshakeAcceptSchema,
  HandshakeRejectSchema,
  IntentResultSchema,
  StateSnapshotSchema,
  StatePatchSchema,
  ChatHistorySchema,
  AssetChunkSchema,
  PingSchema,
  PongSchema,
  ErrorMessageSchema,
]);
