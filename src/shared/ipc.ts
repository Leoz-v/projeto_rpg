import type { AppInfo, IpcError } from './ipc-schemas';

export type { AppInfo, IpcError } from './ipc-schemas';

/** Canais de IPC (renderer -> main via invoke). */
export const IpcChannel = {
  getAppInfo: 'app:get-info',
} as const;

/** Resposta serializável do main: erros viram valor, nunca exceção. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

/** API exposta pelo preload em `window.vtt`. */
export interface VttApi {
  getAppInfo(): Promise<IpcResult<AppInfo>>;
}
