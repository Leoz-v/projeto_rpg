import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { type Compendium, inventoryEntryProblems, loadSrdCompendium, pruneSelections, RULES_ENGINE_VERSION } from 'rules-engine';
import { z } from 'zod';
import { type AppInfo, IpcChannel, type IpcResult, type TableEvent } from '../shared/ipc';
import { HostTableRequestSchema, JoinTableRequestSchema } from '../shared/ipc-schemas';
import { IntentSchema, MAX_ASSET_BYTES, MAX_CHAT_HISTORY, UuidSchema } from '../shared/protocol';
import { PROTOCOL_VERSION } from '../shared/versions';
import { ASSET_SCHEME, AssetError, assetResponse, AssetStore, type StoredAsset } from './assets';
import { characterSheet, creationOptions } from './character-sheet';
import { monsterActions, searchItems, searchMonsters } from './compendium';
import { AppDb, CampaignLibrary, CampaignNotFoundError } from './db';
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
      if (err instanceof TableError || err instanceof AssetError || err instanceof CampaignNotFoundError) return { ok: false, error: { code: 'table_error', message: err.message } };
      console.error(`[ipc ${channel}]`, err);
      return { ok: false, error: { code: 'internal_error', message: 'Erro interno' } };
    }
  });
}

/** O compêndio, carregado (e validado) só quando alguém precisa dele. */
let compendium: Compendium | undefined;
const getCompendium = (): Compendium => (compendium ??= loadSrdCompendium());
let monsterIds: Set<string> | undefined;
const monsterExists = (id: string): boolean => {
  monsterIds ??= new Set(getCompendium().creatures.map((c) => c.id));
  return monsterIds.has(id);
};

const emit = (event: TableEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.tableEvent, event);
};

/** O mestre escolhe uma imagem no disco; ela entra no armazenamento pelo hash. `null` se cancelou. */
async function importAsset(assets: AssetStore): Promise<StoredAsset | null> {
  const win = BrowserWindow.getFocusedWindow();
  const options: Electron.OpenDialogOptions = {
    title: 'Escolher imagem',
    properties: ['openFile'],
    filters: [{ name: 'Imagens (PNG, JPEG, WebP)', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const file = result.filePaths[0];
  if (result.canceled || file === undefined) return null;
  // Confere o tamanho antes de ler tudo para a memória.
  if (statSync(file).size > MAX_ASSET_BYTES) throw new AssetError('Imagem maior que 32 MiB');
  return assets.put(readFileSync(file));
}

function registerIpc(appDb: AppDb, table: TableController, library: CampaignLibrary, assets: AssetStore): void {
  handle(IpcChannel.importAsset, () => importAsset(assets));
  handle(IpcChannel.getAppInfo, (): AppInfo => ({ appVersion: app.getVersion(), protocolVersion: PROTOCOL_VERSION, rulesEngineVersion: RULES_ENGINE_VERSION }));
  handle(IpcChannel.getPreferences, () => appDb.preferences());
  handle(IpcChannel.listCampaigns, () => library.list().map(({ id, name, lastOpenedAt }) => ({ id, name, lastOpenedAt })));
  handle(IpcChannel.searchMonsters, (payload) => searchMonsters(getCompendium().creatures, parse(z.string().max(100), payload)));
  handle(IpcChannel.deleteCampaign, async (payload) => {
    const id = parse(UuidSchema, payload);
    if (table.isHosting(id)) throw new TableError('Encerre a mesa antes de excluir esta campanha');
    await library.delete(id);
    return null;
  });
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
  handle(IpcChannel.chatHistory, (payload) => {
    const { before, limit } = parse(z.strictObject({ before: z.int().nonnegative(), limit: z.int().min(1).max(MAX_CHAT_HISTORY) }), payload);
    return table.chatHistory(before, limit);
  });
  handle(IpcChannel.creationOptions, () => creationOptions(getCompendium()));
  handle(IpcChannel.monsterActions, (payload) => monsterActions(getCompendium().creatures, parse(z.string().max(100), payload)));
  handle(IpcChannel.characterHpMaxima, () => {
    const characters = Object.values(table.view()?.state.characters ?? {});
    return Object.fromEntries(characters.flatMap((c) => {
      const max = characterSheet(c, getCompendium()).sheet?.hpMax.total;
      return max === undefined ? [] : [[c.id, max]];
    }));
  });
  handle(IpcChannel.searchItems, (payload) => searchItems(getCompendium(), parse(z.string().max(100), payload)));
  handle(IpcChannel.characterSheet, (payload) => {
    const record = table.view()?.state.characters[parse(UuidSchema, payload)];
    if (!record) throw new TableError('Personagem não encontrado');
    return characterSheet(record, getCompendium());
  });
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

// `vtt-asset://<sha256>`: as imagens do mapa e dos tokens, servidas do armazenamento local (precisa vir antes do `ready`).
protocol.registerSchemesAsPrivileged([{ scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

void app.whenReady().then(() => {
  const appDb = openAppDb();
  if (!appDb) {
    app.quit();
    return;
  }
  const library = new CampaignLibrary(appDb, join(app.getPath('userData'), 'campaigns'), Date.now, (file) => shell.trashItem(file));
  const assets = new AssetStore(join(app.getPath('userData'), 'assets'));
  const controller = new TableController({
    assets,
    appVersion: app.getVersion(),
    playerId: appDb.playerId(),
    campaigns: library,
    rng: cryptoRng,
    monsterExists,
    pruneSteps: (steps) => pruneSelections(steps, getCompendium()),
    characterSheet: (character) => characterSheet(character, getCompendium()).sheet ?? undefined,
    monsterHpMax: (id) => getCompendium().creatures.find((c) => c.id === id)?.hp.average,
    creature: (id) => getCompendium().creatures.find((c) => c.id === id),
    spellName: (id) => getCompendium().spells.find((s) => s.id === id)?.name,
    itemProblems: (entry) => inventoryEntryProblems(entry, getCompendium()),
    addresses: localAddresses,
    emit,
    log: (message) => {
      console.error(`[mesa] ${message}`);
    },
  });
  table = controller;
  protocol.handle(ASSET_SCHEME, (request) => assetResponse(request, (sha) => controller.asset(sha)));
  registerIpc(appDb, controller, library, assets);
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
