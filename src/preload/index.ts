import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type VttApi } from '../shared/ipc';

const api: VttApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
};

contextBridge.exposeInMainWorld('vtt', api);
