import { z } from 'zod';
import { NameSchema, UuidSchema } from './protocol/common';

/**
 * Schemas Zod dos payloads de IPC. Usados no processo main para validar tudo
 * o que entra e sai. O preload e o renderer importam só os tipos (`./ipc`).
 */
export const AppInfoSchema = z.object({
  appVersion: z.string(),
  protocolVersion: z.number().int().positive(),
  rulesEngineVersion: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const IpcErrorSchema = z.object({
  /** `table_error`: falha esperada da mesa (porta ocupada, Host recusou), com mensagem para a tela. */
  code: z.enum(['invalid_payload', 'table_error', 'internal_error']),
  message: z.string(),
});
export type IpcError = z.infer<typeof IpcErrorSchema>;

const PasswordSchema = z.string().min(1).max(100);

const PortSchema = z.int().min(1024).max(65535);

/** Campanha a hospedar: uma nova (cria o `<campanha>.db`) ou uma já hospedada nesta máquina. */
export const CampaignChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('new'), name: NameSchema }),
  z.strictObject({ kind: z.literal('existing'), id: UuidSchema }),
]);
export type CampaignChoice = z.infer<typeof CampaignChoiceSchema>;

export const HostTableRequestSchema = z.strictObject({
  campaign: CampaignChoiceSchema,
  displayName: NameSchema,
  port: PortSchema.optional(),
  password: PasswordSchema.optional(),
});
export type HostTableRequest = z.infer<typeof HostTableRequestSchema>;

/** Endereço do Host: IPv4, nome ou `[IPv6]`, com porta opcional (ex.: `100.64.0.7:47820`). */
export const HostAddressSchema = z
  .string()
  .trim()
  .regex(/^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?)(:\d{1,5})?$/, 'Endereço inválido');

export const JoinTableRequestSchema = z.strictObject({
  address: HostAddressSchema,
  displayName: NameSchema,
  password: PasswordSchema.optional(),
});
export type JoinTableRequest = z.infer<typeof JoinTableRequestSchema>;

/** Preferências da tela inicial, guardadas no `app.db` para preencher os formulários. */
export const PreferencesSchema = z.strictObject({
  displayName: NameSchema.optional(),
  lastAddress: HostAddressSchema.optional(),
  lastPort: PortSchema.optional(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
