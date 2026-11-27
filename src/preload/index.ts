import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { IpcChannel, type TableEvent, type UpdateStatus, type VttApi } from '../shared/ipc';

const api: VttApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
  getPreferences: () => ipcRenderer.invoke(IpcChannel.getPreferences),
  listCampaigns: () => ipcRenderer.invoke(IpcChannel.listCampaigns),
  deleteCampaign: (id) => ipcRenderer.invoke(IpcChannel.deleteCampaign, id),
  searchMonsters: (query) => ipcRenderer.invoke(IpcChannel.searchMonsters, query),
  hostTable: (request) => ipcRenderer.invoke(IpcChannel.hostTable, request),
  joinTable: (request) => ipcRenderer.invoke(IpcChannel.joinTable, request),
  leaveTable: () => ipcRenderer.invoke(IpcChannel.leaveTable),
  getTable: () => ipcRenderer.invoke(IpcChannel.getTable),
  sendIntent: (intent) => ipcRenderer.invoke(IpcChannel.sendIntent, intent),
  importAsset: () => ipcRenderer.invoke(IpcChannel.importAsset),
  save3dMapAsset: (json) => ipcRenderer.invoke(IpcChannel.save3dMapAsset, json),
  characterSheet: (characterId) => ipcRenderer.invoke(IpcChannel.characterSheet, characterId),
  chatHistory: (before, limit) => ipcRenderer.invoke(IpcChannel.chatHistory, { before, limit }),
  creationOptions: () => ipcRenderer.invoke(IpcChannel.creationOptions),
  searchItems: (query) => ipcRenderer.invoke(IpcChannel.searchItems, query),
  characterHpMaxima: () => ipcRenderer.invoke(IpcChannel.characterHpMaxima),
  tokenVisionProfiles: () => ipcRenderer.invoke(IpcChannel.tokenVisionProfiles),
  monsterActions: (monsterId) => ipcRenderer.invoke(IpcChannel.monsterActions, monsterId),
  getUpdateStatus: () => ipcRenderer.invoke(IpcChannel.getUpdateStatus),
  installUpdate: () => ipcRenderer.invoke(IpcChannel.installUpdate),
  onUpdateStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: UpdateStatus): void => {
      listener(payload);
    };
    ipcRenderer.on(IpcChannel.updateEvent, handler);
    return () => {
      ipcRenderer.removeListener(IpcChannel.updateEvent, handler);
    };
  },
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
