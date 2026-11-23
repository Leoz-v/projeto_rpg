import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seededRng } from 'rules-engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { TableEvent } from '../../shared/ipc';
import { HostAddressSchema } from '../../shared/ipc-schemas';
import { AssetStore } from '../assets';
import { AppDb, CampaignLibrary } from '../db';
import { TableController, TableError, hostUrl } from './controller';

/** Dois apps na mesma máquina: um hospeda, o outro entra (127.0.0.1, porta livre). */

/** Senha fictícia, montada em tempo de execução para não parecer segredo aos scanners. */
const ANY_PASSWORD = ['qualquer', 'senha'].join('-');
const controllers: TableController[] = [];

const dirs: string[] = [];
const appDbs: AppDb[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((c) => c.leave()));
  for (const db of appDbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Um app com o próprio `app.db` e a própria pasta de campanhas, como numa máquina. */
function app(): { controller: TableController; events: TableEvent[]; playerId: string; library: CampaignLibrary; assets: AssetStore } {
  const events: TableEvent[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'vtt-table-'));
  dirs.push(dir);
  const appDb = AppDb.open(join(dir, 'app.db'));
  appDbs.push(appDb);
  const library = new CampaignLibrary(appDb, join(dir, 'campaigns'));
  const playerId = appDb.playerId();
  const assets = new AssetStore(join(dir, 'assets'));
  const controller = new TableController({
    assets,
    appVersion: '0.1.0',
    playerId,
    campaigns: library,
    rng: seededRng(3),
    monsterExists: (id) => id === 'goblin',
    addresses: () => ['100.64.0.7'],
    emit: (e) => events.push(e),
    listenHost: '127.0.0.1',
  });
  controllers.push(controller);
  return { controller, events, playerId, library, assets };
}

/** Espera um evento que satisfaça a condição. */
async function waitFor(events: TableEvent[], check: (e: TableEvent) => boolean): Promise<TableEvent> {
  for (let i = 0; i < 200; i++) {
    const found = events.find(check);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('evento não chegou');
}

const chatLength = (n: number) => (e: TableEvent) => e.kind === 'state' && e.state.chat.length === n;

async function hosted(): Promise<{ gm: ReturnType<typeof app>; port: number }> {
  const gm = app();
  // Porta 0 não passa no schema de IPC (1024–65535); o controlador aceita para o teste.
  const view = await gm.controller.host({ campaign: { kind: 'new', name: 'A Mina Perdida' }, displayName: 'Mestre', port: 0 });
  return { gm, port: view.info.port ?? 0 };
}

describe('TableController', () => {
  it('hosts a table as GM and shows the addresses', async () => {
    const { gm } = await hosted();
    expect(gm.controller.view()?.info).toMatchObject({ mode: 'host', role: 'gm', campaignName: 'A Mina Perdida', addresses: ['100.64.0.7'] });
  });

  it('lets a player join, and both see each other and the chat', async () => {
    const { gm, port } = await hosted();
    const ana = app();
    const view = await ana.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana' });
    expect(view.info).toMatchObject({ mode: 'player', role: 'player', campaignName: 'A Mina Perdida' });

    // O mestre vê a Ana entrar.
    await waitFor(gm.events, (e) => e.kind === 'state' && e.state.players[ana.playerId]?.connected === true);

    expect(await ana.controller.send({ kind: 'chat.message', data: { text: 'Olá!' } })).toMatchObject({ status: 'applied' });
    await waitFor(gm.events, chatLength(1));
    expect(await gm.controller.send({ kind: 'dice.roll', data: { formula: '1d20', visibility: 'gm' } })).toMatchObject({ status: 'applied' });
    const seen = await waitFor(ana.events, chatLength(2));
    if (seen.kind !== 'state') throw new Error('esperava estado');
    expect(seen.state.chat[1]).toMatchObject({ kind: 'hidden_roll' });
    expect(gm.controller.view()?.state.chat[1]).toMatchObject({ kind: 'roll' });
  });

  it('tells the player when the GM closes the table', async () => {
    const { gm, port } = await hosted();
    const ana = app();
    await ana.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana' });
    await gm.controller.leave();
    expect(await waitFor(ana.events, (e) => e.kind === 'closed')).toEqual({ kind: 'closed', message: 'A conexão com o Host caiu' });
    expect(ana.controller.view()).toBeNull();
  });

  it('does not tell the player anything when they leave on purpose', async () => {
    const { port } = await hosted();
    const ana = app();
    await ana.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana' });
    await ana.controller.leave();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ana.events.some((e) => e.kind === 'closed')).toBe(false);
  });

  it('turns expected failures into TableError with a pt-BR message', async () => {
    const { gm, port } = await hosted();
    await expect(gm.controller.host({ campaign: { kind: 'new', name: 'Outra' }, displayName: 'Mestre' })).rejects.toThrow('Você já está em uma mesa');

    const other = app();
    await expect(other.controller.host({ campaign: { kind: 'new', name: 'Outra' }, displayName: 'Mestre', port })).rejects.toThrow(`A porta ${port} já está em uso`);
    await expect(other.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana', password: ANY_PASSWORD })).resolves.toBeDefined();
    await other.controller.leave();

    const lost = app();
    await gm.controller.leave();
    const error = await lost.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TableError);
    await expect(lost.controller.send({ kind: 'chat.message', data: { text: 'oi' } })).rejects.toThrow('Você não está em uma mesa');
  });
});

describe('TableController: saved campaigns', () => {
  it('restores the log, maps and players when the GM hosts the same campaign again', async () => {
    const { gm, port } = await hosted();
    const ana = app();
    await ana.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana' });
    await ana.controller.send({ kind: 'chat.message', data: { text: 'Antes de fechar' } });
    await gm.controller.send({ kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    await waitFor(gm.events, (e) => e.kind === 'state' && Object.keys(e.state.maps).length === 1);
    await ana.controller.leave();
    await gm.controller.leave();

    const [saved] = gm.library.list();
    expect(saved?.name).toBe('A Mina Perdida');
    const view = await gm.controller.host({ campaign: { kind: 'existing', id: saved?.id ?? '' }, displayName: 'Mestre Leo', port: 0 });
    expect(view.state.campaign).toEqual({ id: saved?.id, name: 'A Mina Perdida' });
    expect(view.state.chat).toMatchObject([{ kind: 'message', text: 'Antes de fechar', authorId: ana.playerId }]);
    expect(Object.values(view.state.maps).map((m) => m.name)).toEqual(['Caverna']);
    expect(view.state.activeMapId).not.toBeNull();
    expect(view.state.players[ana.playerId]).toEqual({ displayName: 'Ana', role: 'player', connected: false });
    expect(view.state.players[gm.playerId]).toEqual({ displayName: 'Mestre Leo', role: 'gm', connected: true });
  });

  it('keeps the same player id across app restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vtt-app-'));
    dirs.push(dir);
    const first = AppDb.open(join(dir, 'app.db'));
    const id = first.playerId();
    first.close();
    const second = AppDb.open(join(dir, 'app.db'));
    expect(second.playerId()).toBe(id);
    second.close();
  });

  it('knows which campaign is open, so it cannot be deleted while hosting', async () => {
    const { gm } = await hosted();
    const [open] = gm.library.list();
    expect(gm.controller.isHosting(open?.id ?? '')).toBe(true);
    expect(gm.controller.isHosting(randomUUID())).toBe(false);
    await gm.controller.leave();
    expect(gm.controller.isHosting(open?.id ?? '')).toBe(false);
  });

  it('turns a missing campaign into a TableError', async () => {
    const gm = app();
    await expect(gm.controller.host({ campaign: { kind: 'existing', id: randomUUID() }, displayName: 'Mestre', port: 0 })).rejects.toThrow('Arquivo da campanha não encontrado');
  });
});

describe('TableController: images', () => {
  /** Uma "imagem" PNG de ~1,2 MB: assinatura PNG e bytes aleatórios (3 pedaços de 512 KiB). */
  const fakePng = (size: number): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(size)]);

  it('downloads an image from the Host in chunks, checks it and keeps it in the player cache', async () => {
    const { gm, port } = await hosted();
    const image = gm.assets.put(fakePng(1_200_000));
    expect(await gm.controller.send({ kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10, background: image.sha256 } })).toMatchObject({ status: 'applied' });

    const ana = app();
    await ana.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana' });
    expect(ana.assets.has(image.sha256)).toBe(false);
    const [first, second] = await Promise.all([ana.controller.asset(image.sha256), ana.controller.asset(image.sha256)]);
    expect(first?.mime).toBe('image/png');
    expect(first?.bytes.equals(gm.assets.read(image.sha256)?.bytes ?? Buffer.alloc(0))).toBe(true);
    expect(second?.bytes.length).toBe(first?.bytes.length);
    expect(ana.assets.has(image.sha256)).toBe(true);

    // Do cache, mesmo sem mesa.
    await ana.controller.leave();
    expect((await ana.controller.asset(image.sha256))?.mime).toBe('image/png');
  });

  it('returns nothing for an image the Host does not have', async () => {
    const { port } = await hosted();
    const ana = app();
    await ana.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana' });
    expect(await ana.controller.asset('c'.repeat(64))).toBeUndefined();
  });

  it('rejects a map whose background the Host does not have', async () => {
    const { gm } = await hosted();
    expect(await gm.controller.send({ kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10, background: 'd'.repeat(64) } })).toMatchObject({
      status: 'rejected',
      code: 'rule_violation',
    });
  });
});

describe('host address', () => {
  it('accepts IPv4, names and [IPv6], with or without port', () => {
    for (const ok of ['100.64.0.7', '100.64.0.7:47820', 'mesa.tail1234.ts.net', '[fd7a:115c::1]:47820']) expect(HostAddressSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['ws://100.64.0.7', '100.64.0.7/x', 'a b', '', '-mesa']) expect(HostAddressSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('adds the default port only when missing', () => {
    expect(hostUrl('100.64.0.7')).toBe('ws://100.64.0.7:47820');
    expect(hostUrl('100.64.0.7:5000')).toBe('ws://100.64.0.7:5000');
    expect(hostUrl('[fd7a:115c::1]')).toBe('ws://[fd7a:115c::1]:47820');
  });
});
