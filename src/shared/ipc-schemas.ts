import { z } from 'zod';
import { NameSchema } from './protocol/common';

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

export const HostTableRequestSchema = z.strictObject({
  campaignName: NameSchema,
  displayName: NameSchema,
  port: z.int().min(1024).max(65535).optional(),
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
