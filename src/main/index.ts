import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { loadSrdCompendium, RULES_ENGINE_VERSION } from 'rules-engine';
import type { z } from 'zod';
import { type AppInfo, IpcChannel, type IpcResult, type TableEvent } from '../shared/ipc';
import { HostTableRequestSchema, JoinTableRequestSchema } from '../shared/ipc-schemas';
import { IntentSchema } from '../shared/protocol';
import { PROTOCOL_VERSION } from '../shared/versions';
import { AppDb, CampaignLibrary } from './db';
import { cryptoRng } from './session';
import { localAddresses, TableController, TableError } from './table';

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

class InvalidPayload extends Error {}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw new InvalidPayload(result.error.issues[0]?.message ?? 'Dados inválidos');
  return result.data;
}

/** Registra um canal `invoke`: toda exceção vira `IpcResult` serializável. */
function handle<T>(channel: string, run: (payload: unknown) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, payload: unknown): Promise<IpcResult<T>> => {
    try {
      return { ok: true, value: await run(payload) };
    } catch (err: unknown) {
      if (err instanceof InvalidPayload) return { ok: false, error: { code: 'invalid_payload', message: err.message } };
      if (err instanceof TableError) return { ok: false, error: { code: 'table_error', message: err.message } };
      console.error(`[ipc ${channel}]`, err);
      return { ok: false, error: { code: 'internal_error', message: 'Erro interno' } };
    }
  });
}

/** Ids das criaturas do compêndio, carregado só quando a primeira mesa precisa. */
let monsterIds: Set<string> | undefined;
const monsterExists = (id: string): boolean => {
  monsterIds ??= new Set(loadSrdCompendium().creatures.map((c) => c.id));
  return monsterIds.has(id);
};

const emit = (event: TableEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.tableEvent, event);
};

function registerIpc(appDb: AppDb, table: TableController, library: CampaignLibrary): void {
  handle(IpcChannel.getAppInfo, (): AppInfo => ({ appVersion: app.getVersion(), protocolVersion: PROTOCOL_VERSION, rulesEngineVersion: RULES_ENGINE_VERSION }));
  handle(IpcChannel.getPreferences, () => appDb.preferences());
  handle(IpcChannel.listCampaigns, () => library.list().map(({ id, name, lastOpenedAt }) => ({ id, name, lastOpenedAt })));
  handle(IpcChannel.hostTable, async (payload) => {
    const request = parse(HostTableRequestSchema, payload);
    const view = await table.host(request);
    appDb.savePreferences({ displayName: request.displayName, ...(request.port !== undefined ? { lastPort: request.port } : {}) });
    return view;
  });
  handle(IpcChannel.joinTable, async (payload) => {
    const request = parse(JoinTableRequestSchema, payload);
    const view = await table.join(request);
    appDb.savePreferences({ displayName: request.displayName, lastAddress: request.address });
    return view;
  });
  handle(IpcChannel.leaveTable, async () => {
    await table.leave();
    return null;
  });
  handle(IpcChannel.getTable, () => table.view());
  handle(IpcChannel.sendIntent, (payload) => table.send(parse(IntentSchema, payload)));
}

/** Abre o `app.db` na pasta de dados do app. Sem ele, o app não abre: avisa e sai. */
function openAppDb(): AppDb | undefined {
  try {
    return AppDb.open(join(app.getPath('userData'), 'app.db'));
  } catch (err: unknown) {
    dialog.showErrorBox('Não foi possível abrir os dados do app', err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

let table: TableController | undefined;

void app.whenReady().then(() => {
  const appDb = openAppDb();
  if (!appDb) {
    app.quit();
    return;
  }
  const library = new CampaignLibrary(appDb, join(app.getPath('userData'), 'campaigns'));
  table = new TableController({
    appVersion: app.getVersion(),
    playerId: appDb.playerId(),
    campaigns: library,
    rng: cryptoRng,
    monsterExists,
    addresses: localAddresses,
    emit,
    log: (message) => {
      console.error(`[mesa] ${message}`);
    },
  });
  registerIpc(appDb, table, library);
  app.on('will-quit', () => {
    appDb.close();
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Fechar a janela encerra a mesa (CLAUDE.md: o app do Host precisa ficar aberto).
  void (table?.leave() ?? Promise.resolve()).finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
