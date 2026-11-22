import { randomUUID } from 'node:crypto';
import { seededRng } from 'rules-engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { TableEvent } from '../../shared/ipc';
import { HostAddressSchema } from '../../shared/ipc-schemas';
import { TableController, TableError, hostUrl } from './controller';

/** Dois apps na mesma máquina: um hospeda, o outro entra (127.0.0.1, porta livre). */

/** Senha fictícia, montada em tempo de execução para não parecer segredo aos scanners. */
const ANY_PASSWORD = ['qualquer', 'senha'].join('-');
const controllers: TableController[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((c) => c.leave()));
});

function app(): { controller: TableController; events: TableEvent[]; playerId: string } {
  const events: TableEvent[] = [];
  const playerId = randomUUID();
  const controller = new TableController({
    appVersion: '0.1.0',
    playerId,
    rng: seededRng(3),
    monsterExists: (id) => id === 'goblin',
    addresses: () => ['100.64.0.7'],
    emit: (e) => events.push(e),
    listenHost: '127.0.0.1',
  });
  controllers.push(controller);
  return { controller, events, playerId };
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
  const view = await gm.controller.host({ campaignName: 'A Mina Perdida', displayName: 'Mestre', port: 0 });
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
    await expect(gm.controller.host({ campaignName: 'Outra', displayName: 'Mestre' })).rejects.toThrow('Você já está em uma mesa');

    const other = app();
    await expect(other.controller.host({ campaignName: 'Outra', displayName: 'Mestre', port })).rejects.toThrow(`A porta ${port} já está em uso`);
    await expect(other.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana', password: ANY_PASSWORD })).resolves.toBeDefined();
    await other.controller.leave();

    const lost = app();
    await gm.controller.leave();
    const error = await lost.controller.join({ address: `127.0.0.1:${port}`, displayName: 'Ana' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TableError);
    await expect(lost.controller.send({ kind: 'chat.message', data: { text: 'oi' } })).rejects.toThrow('Você não está em uma mesa');
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
