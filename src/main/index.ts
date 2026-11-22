import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { RULES_ENGINE_VERSION } from 'rules-engine';
import { type AppInfo, type IpcResult, IpcChannel } from '../shared/ipc';
import { PROTOCOL_VERSION } from '../shared/versions';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'VTT',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Links externos abrem no navegador do sistema, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.getAppInfo, (): IpcResult<AppInfo> => {
    try {
      return {
        ok: true,
        value: {
          appVersion: app.getVersion(),
          protocolVersion: PROTOCOL_VERSION,
          rulesEngineVersion: RULES_ENGINE_VERSION,
        },
      };
    } catch (err: unknown) {
      return {
        ok: false,
        error: { code: 'internal_error', message: err instanceof Error ? err.message : String(err) },
      };
    }
  });
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
