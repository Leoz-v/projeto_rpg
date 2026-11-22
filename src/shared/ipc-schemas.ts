import { z } from 'zod';

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
  code: z.enum(['invalid_payload', 'internal_error']),
  message: z.string(),
});
export type IpcError = z.infer<typeof IpcErrorSchema>;
