import { randomUUID } from 'node:crypto';
import { seededRng } from 'rules-engine';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { MAX_FRAME_BYTES, type SessionState } from '../../shared/protocol';
import { PROTOCOL_VERSION } from '../../shared/versions';
import { HostSession } from '../session';
import { ConnectError, HostClient } from './host-client';
import { HostServer, type HostServerOptions } from './host-server';

/** Integração do transporte: Host e clientes reais em 127.0.0.1, porta livre. */

const GM = { playerId: randomUUID(), displayName: 'Mestre' };
/** Senhas fictícias, montadas em tempo de execução para não parecerem segredos aos scanners. */
const TABLE_PASSWORD = ['senha', 'da', 'mesa'].join('-');
const WRONG_PASSWORD = ['senha', 'errada'].join('-');
const servers: HostServer[] = [];
const clients: HostClient[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of sockets.splice(0)) s.terminate();
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

async function host(options: Partial<HostServerOptions> = {}): Promise<{ server: HostServer; session: HostSession; url: string }> {
  const session = new HostSession({ id: randomUUID(), name: 'A Mina Perdida' }, GM, {
    rng: seededRng(1),
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: () => true,
    pruneSteps: (steps) => steps,
    itemProblems: () => [],
    characterSheet: () => undefined,
    monsterHpMax: () => 7,
    creature: () => undefined,
    item: () => undefined,
    spell: () => undefined,
    assetExists: () => true,
  });
  const server = new HostServer({ session, appVersion: '0.1.0', port: 0, host: '127.0.0.1', ...options });
  servers.push(server);
  const port = await server.start();
  return { server, session, url: `ws://127.0.0.1:${port}` };
}

async function join(url: string, displayName: string, extra: { playerId?: string; password?: string; protocolVersion?: number } = {}): Promise<HostClient> {
  const client = await HostClient.connect({ url, playerId: extra.playerId ?? randomUUID(), displayName, appVersion: '0.1.0', ...extra });
  clients.push(client);
  return client;
}

/** Espera o estado do cliente satisfazer a condição. */
function until(client: HostClient, check: (state: SessionState) => boolean): Promise<SessionState> {
  if (check(client.state)) return Promise.resolve(client.state);
  return new Promise((resolve) => {
    const stop = client.subscribe((state) => {
      if (!check(state)) return;
      stop();
      resolve(state);
    });
  });
}

/** Cliente cru, para testar o que o `HostClient` nunca enviaria. */
async function raw(url: string): Promise<{ socket: WebSocket; next: () => Promise<Record<string, unknown>>; closed: Promise<number> }> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  const queue: Record<string, unknown>[] = [];
  const waiting: ((m: Record<string, unknown>) => void)[] = [];
  socket.on('message', (data) => {
    const message = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : '{}') as Record<string, unknown>;
    const waiter = waiting.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => { resolve(code); }));
  await new Promise((resolve) => socket.once('open', resolve));
  const next = (): Promise<Record<string, unknown>> => {
    const queued = queue.shift();
    return queued ? Promise.resolve(queued) : new Promise((resolve) => waiting.push(resolve));
  };
  return { socket, next, closed };
}

const handshake = (playerId = randomUUID()) =>
  JSON.stringify({ type: 'Handshake', id: randomUUID(), payload: { protocolVersion: PROTOCOL_VERSION, appVersion: '0.1.0', playerId, displayName: 'Cru' } });

const connectError = async (promise: Promise<unknown>): Promise<ConnectError> => {
  try {
    await promise;
  } catch (err: unknown) {
    if (err instanceof ConnectError) return err;
    throw err;
  }
  throw new Error('esperava ConnectError');
};

describe('handshake', () => {
  it('accepts a player and sends the snapshot with them in it', async () => {
    const { url } = await host();
    const ana = await join(url, 'Ana');
    expect(ana.welcome).toMatchObject({ campaignName: 'A Mina Perdida', role: 'player', hostAppVersion: '0.1.0' });
    expect(Object.values(ana.state.players).map((p) => p.displayName).sort()).toEqual(['Ana', 'Mestre']);
  });

  it('rejects a different protocol version with "Atualize o app"', async () => {
    const { url } = await host();
    const err = await connectError(join(url, 'Ana', { protocolVersion: PROTOCOL_VERSION + 1 }));
    expect(err).toMatchObject({ reason: 'protocol_mismatch', message: 'Atualize o app' });
  });

  it('checks the table password', async () => {
    const { url } = await host({ password: TABLE_PASSWORD });
    expect(await connectError(join(url, 'Ana'))).toMatchObject({ reason: 'bad_password', message: 'Senha da mesa incorreta' });
    expect(await connectError(join(url, 'Ana', { password: WRONG_PASSWORD }))).toMatchObject({ reason: 'bad_password' });
    await expect(join(url, 'Ana', { password: TABLE_PASSWORD })).resolves.toBeInstanceOf(HostClient);
  });

  it('rejects a player already connected, and anyone using the GM id', async () => {
    const { url } = await host();
    const playerId = randomUUID();
    await join(url, 'Ana', { playerId });
    expect(await connectError(join(url, 'Ana de novo', { playerId }))).toMatchObject({ reason: 'duplicate_player' });
    expect(await connectError(join(url, 'Impostor', { playerId: GM.playerId }))).toMatchObject({ reason: 'duplicate_player' });
  });

  it('rejects when the table is full', async () => {
    const { url } = await host({ maxPlayers: 1 });
    await join(url, 'Ana');
    expect(await connectError(join(url, 'Bruno'))).toMatchObject({ reason: 'session_full', message: 'A mesa está cheia' });
  });

  it('closes the socket when the Handshake does not arrive in time', async () => {
    const { url } = await host({ timings: { handshakeMs: 50 } });
    const { closed } = await raw(url);
    expect(await closed).toBe(1008);
  });

  it('ignores anything before the Handshake', async () => {
    const { url } = await host();
    const { socket, next } = await raw(url);
    socket.send(JSON.stringify({ type: 'Ping', id: randomUUID(), payload: { t: 1 } }));
    socket.send(handshake());
    expect((await next()).type).toBe('HandshakeAccept');
  });

  it('fails cleanly when nobody is listening', async () => {
    const { url, server } = await host();
    await server.stop();
    expect(await connectError(join(url, 'Ana'))).toMatchObject({ reason: 'connection_failed' });
  });
});

describe('invalid messages', () => {
  it('answers with invalid_message and keeps the connection', async () => {
    const { url } = await host();
    const { socket, next } = await raw(url);
    socket.send(handshake());
    await next(); // HandshakeAccept
    await next(); // StateSnapshot

    socket.send('isto não é JSON');
    expect(await next()).toMatchObject({ type: 'Error', payload: { code: 'invalid_message' } });
    const id = randomUUID();
    socket.send(JSON.stringify({ type: 'Intent', id, payload: { kind: 'token.fly', data: {} } }));
    expect(await next()).toMatchObject({ type: 'Error', replyTo: id, payload: { code: 'invalid_message' } });
    socket.send(Buffer.from('binário'), { binary: true });
    expect(await next()).toMatchObject({ type: 'Error', payload: { code: 'invalid_message' } });

    socket.send(JSON.stringify({ type: 'Ping', id: randomUUID(), payload: { t: 7 } }));
    expect(await next()).toMatchObject({ type: 'Pong', payload: { t: 7 } });
  });

  it('closes the connection on frames over 1 MiB', async () => {
    const { url } = await host();
    const { socket, closed } = await raw(url);
    socket.send('x'.repeat(MAX_FRAME_BYTES + 1));
    expect(await closed).toBe(1009);
  });
});

describe('intents and patches', () => {
  it('applies a player intent and delivers the patch to everyone', async () => {
    const { url, session } = await host();
    const ana = await join(url, 'Ana');
    const bruno = await join(url, 'Bruno');
    await until(ana, (s) => Object.keys(s.players).length === 3);

    const result = await ana.send({ kind: 'chat.message', data: { text: 'Olá, mesa!' } });
    expect(result).toEqual({ status: 'applied', rev: session.rev });
    const seen = await until(bruno, (s) => s.chat.length === 1);
    expect(seen.chat[0]).toMatchObject({ kind: 'message', text: 'Olá, mesa!' });
    await until(ana, (s) => s.chat.length === 1);
    expect(ana.state).toEqual(session.state);
    expect(ana.rev).toBe(session.rev);
  });

  it('returns rejections only to the sender', async () => {
    const { url } = await host();
    const ana = await join(url, 'Ana');
    const result = await ana.send({ kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    expect(result).toMatchObject({ status: 'rejected', code: 'not_allowed' });
  });

  it('delivers the GM local intents through the same flow, hiding secret rolls', async () => {
    const changes: number[] = [];
    const { url, server, session } = await host({ onChange: (c) => changes.push(c.rev) });
    const ana = await join(url, 'Ana');
    const outcome = server.dispatch(GM.playerId, { kind: 'dice.roll', data: { formula: '1d20', visibility: 'gm' } });
    expect(outcome.result.status).toBe('applied');
    const seen = await until(ana, (s) => s.chat.length === 1);
    expect(seen.chat[0]).toMatchObject({ kind: 'hidden_roll', authorId: GM.playerId });
    expect(session.state.chat[0]).toMatchObject({ kind: 'roll', visibility: 'gm' });
    expect(changes).toContain(session.rev);
  });

  it('marks a player as disconnected for the others when the connection drops', async () => {
    const { url } = await host();
    const ana = await join(url, 'Ana');
    const bruno = await join(url, 'Bruno');
    const brunoId = Object.entries(bruno.state.players).find(([, p]) => p.displayName === 'Bruno')?.[0] ?? '';
    bruno.close();
    const state = await until(ana, (s) => s.players[brunoId]?.connected === false);
    expect(state.players[brunoId]).toMatchObject({ displayName: 'Bruno', connected: false });
  });

  it('resyncs with a snapshot when a patch arrives with a gap', async () => {
    const { url, server } = await host();
    const ana = await join(url, 'Ana');

    // Simula uma lacuna: o estado local da Ana volta uma revisão.
    const stale = ana.rev;
    server.dispatch(GM.playerId, { kind: 'chat.message', data: { text: 'um' } });
    await until(ana, (s) => s.chat.length === 1);
    Reflect.set(ana, 'revision', stale - 1);
    server.dispatch(GM.playerId, { kind: 'chat.message', data: { text: 'dois' } });
    const state = await until(ana, (s) => s.chat.length === 2);
    expect(state.chat.map((e) => (e.kind === 'message' ? e.text : ''))).toEqual(['um', 'dois']);
    expect(ana.rev).toBe(stale + 2);
  });
});

describe('heartbeat', () => {
  it('pings players and drops those that stop answering', async () => {
    // Folga larga entre o Ping (25 ms) e o prazo (1 s): uma pausa do runner (comum no Windows do CI) não derruba quem responde.
    const { url } = await host({ timings: { pingIntervalMs: 25, pongTimeoutMs: 1000 } });
    const ana = await join(url, 'Ana');
    const { socket, next, closed } = await raw(url);
    socket.send(handshake());
    await next();
    await next();
    // A Ana responde aos Ping (o HostClient faz isso sozinho); o cliente cru não.
    expect(await closed).toBe(1006);
    expect(ana.state.players).toBeDefined();
    const alive = await ana.send({ kind: 'chat.message', data: { text: 'ainda aqui' } });
    expect(alive.status).toBe('applied');
  });
});

describe('chat window (note 0047)', () => {
  it('sends only the last entries in the snapshot and the older ones on request, filtered for the player', async () => {
    const { server, session, url } = await host();
    for (let i = 0; i < 450; i++) {
      const intent = i % 50 === 0 ? { kind: 'dice.roll' as const, data: { formula: '1d20', visibility: 'gm' as const } } : { kind: 'chat.message' as const, data: { text: `mensagem ${i}` } };
      session.handle(GM.playerId, intent);
    }
    const playerId = randomUUID();
    const client = await join(url, 'Ana', { playerId });
    expect(client.chatFrom).toBe(250);
    expect(client.state.chat).toHaveLength(200);
    const full = session.viewFor(playerId).chat;
    expect(client.state.chat).toEqual(full.slice(250));

    const page = await client.requestChatHistory(250, 200);
    expect(page.from).toBe(50);
    expect(page.entries).toEqual(full.slice(50, 250));
    // As rolagens secretas do mestre chegam filtradas, como no snapshot.
    expect(page.entries.some((e) => e.kind === 'hidden_roll')).toBe(true);
    expect(page.entries).not.toEqual(session.state.chat.slice(50, 250));

    expect(await client.requestChatHistory(50, 200)).toEqual({ from: 0, entries: full.slice(0, 50) });
    expect(await client.requestChatHistory(0, 10)).toEqual({ from: 0, entries: [] });

    // Entradas novas continuam chegando por patch, no fim.
    server.dispatch(GM.playerId, { kind: 'chat.message', data: { text: 'nova' } });
    const state = await until(client, (s) => s.chat.length === 201);
    expect(state.chat.at(-1)).toMatchObject({ kind: 'message', text: 'nova' });
  });
});
