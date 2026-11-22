import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { IpcChannel, type TableEvent, type VttApi } from '../shared/ipc';

const api: VttApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
  hostTable: (request) => ipcRenderer.invoke(IpcChannel.hostTable, request),
  joinTable: (request) => ipcRenderer.invoke(IpcChannel.joinTable, request),
  leaveTable: () => ipcRenderer.invoke(IpcChannel.leaveTable),
  getTable: () => ipcRenderer.invoke(IpcChannel.getTable),
  sendIntent: (intent) => ipcRenderer.invoke(IpcChannel.sendIntent, intent),
  onTableEvent: (listener) => {
    // O evento do Electron não passa para o renderer: só o payload.
    const handler = (_event: IpcRendererEvent, payload: TableEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(IpcChannel.tableEvent, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannel.tableEvent, handler);
    };
  },
};

contextBridge.exposeInMainWorld('vtt', api);
