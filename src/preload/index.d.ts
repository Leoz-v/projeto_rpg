import type { VttApi } from '../shared/ipc';

declare global {
  interface Window {
    readonly vtt: VttApi;
  }
}

export {};
