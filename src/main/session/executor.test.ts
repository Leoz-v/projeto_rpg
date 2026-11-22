import { randomUUID } from 'node:crypto';
import { seededRng } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import { applyPatch, type Intent, SessionStateSchema } from '../../shared/protocol';
import { HostSession, type IntentOutcome, type SessionDeps } from './executor';
import { cryptoRng } from './rng';

const CAMPAIGN = { id: randomUUID(), name: 'A Mina Perdida' };
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };

function setup(overrides: Partial<SessionDeps> = {}): HostSession {
  const session = new HostSession(CAMPAIGN, GM, {
    rng: seededRng(42),
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: (id) => id === 'goblin',
    ...overrides,
  });
  session.connect(ANA);
  session.connect(BRUNO);
  return session;
}

const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const rejection = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.code : undefined);

/** Mapa 10×10 com um token da Ana na origem. */
function withMap(session: HostSession): { mapId: string; tokenId: string } {
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Ana', position: { x: 0, y: 0 }, size: 'medium', ownerIds: [ANA.playerId] } });
  const tokenId = Object.keys(session.state.tokens)[0] ?? '';
  return { mapId, tokenId };
}

describe('HostSession: connections', () => {
  it('starts with the GM connected and registers players', () => {
    const session = setup();
    expect(session.roleOf(GM.playerId)).toBe('gm');
    expect(session.roleOf(ANA.playerId)).toBe('player');
    expect(session.rev).toBe(2);
    expect(SessionStateSchema.safeParse(session.state).success).toBe(true);
  });

  it('marks players as disconnected and back, keeping their role', () => {
    const session = setup();
    const change = session.disconnect(ANA.playerId);
    expect(change?.ops).toEqual([{ op: 'replace', path: `/players/${ANA.playerId}/connected`, value: false }]);
    expect(session.disconnect(ANA.playerId)).toBeUndefined();
    session.connect({ ...ANA, displayName: 'Ana Clara' });
    expect(session.state.players[ANA.playerId]).toEqual({ displayName: 'Ana Clara', role: 'player', connected: true });
  });

  it('rejects intents from unknown or disconnected players', () => {
    const session = setup();
    expect(rejection(session.handle(randomUUID(), { kind: 'chat.message', data: { text: 'oi' } }))).toBe('not_allowed');
    session.disconnect(ANA.playerId);
    expect(rejection(session.handle(ANA.playerId, { kind: 'chat.message', data: { text: 'oi' } }))).toBe('not_allowed');
  });
});

describe('HostSession: revisions', () => {
  it('advances rev by one per applied intent, and never on rejection', () => {
    const session = setup();
    const before = session.rev;
    const out = session.handle(ANA.playerId, { kind: 'chat.message', data: { text: 'oi' } });
    expect(out.result).toEqual({ status: 'applied', rev: before + 1 });
    expect(out.change).toMatchObject({ rev: before + 1, baseRev: before });
    expect(rejection(session.handle(ANA.playerId, { kind: 'map.create', data: { name: 'X', width: 1, height: 1 } }))).toBe('not_allowed');
    expect(session.rev).toBe(before + 1);
  });

  it('produces patches that rebuild the same state from a snapshot', () => {
    const session = setup();
    let mirror = session.state;
    const intents: Intent[] = [
      { kind: 'chat.message', data: { text: 'oi' } },
      { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } },
      { kind: 'dice.roll', data: { formula: '2d6+3', visibility: 'public' } },
    ];
    for (const intent of intents) {
      const { change } = session.handle(GM.playerId, intent);
      if (change) mirror = applyPatch(mirror, change.ops);
    }
    expect(mirror).toEqual(session.state);
  });

  it('answers session.resync without changing the state', () => {
    const session = setup();
    const out = session.handle(ANA.playerId, { kind: 'session.resync', data: {} });
    expect(out).toEqual({ result: { status: 'applied', rev: session.rev }, resync: true });
  });

  it('turns unexpected errors into internal_error without changing the state', () => {
    const session = setup({
      newId: () => {
        throw new Error('boom');
      },
    });
    const rev = session.rev;
    expect(rejection(session.handle(ANA.playerId, { kind: 'chat.message', data: { text: 'oi' } }))).toBe('internal_error');
    expect(session.rev).toBe(rev);
    expect(session.state.chat).toEqual([]);
  });
});

describe('HostSession: chat and dice', () => {
  it('appends messages with the author and time', () => {
    const session = setup();
    session.handle(ANA.playerId, { kind: 'chat.message', data: { text: 'Olá!' } });
    expect(session.state.chat).toMatchObject([{ kind: 'message', authorId: ANA.playerId, at: 1763769600000, text: 'Olá!' }]);
  });

  it('rolls with the Host RNG and records each die', () => {
    const fixed = { roll: (sides: number) => sides };
    const session = setup({ rng: fixed });
    session.handle(ANA.playerId, { kind: 'dice.roll', data: { formula: '2d6+1d4-1', label: 'Dano', visibility: 'public' } });
    expect(session.state.chat).toMatchObject([
      {
        kind: 'roll',
        formula: '2d6+1d4-1',
        label: 'Dano',
        rolls: [
          { sides: 6, value: 6 },
          { sides: 6, value: 6 },
          { sides: 4, value: 4 },
        ],
        total: 15,
      },
    ]);
  });

  it('hides GM rolls from players at the same log position', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'chat.message', data: { text: 'Rolando…' } });
    const { change } = session.handle(GM.playerId, { kind: 'dice.roll', data: { formula: '1d20', visibility: 'gm' } });
    if (!change) throw new Error('esperava um patch');

    const gmEntry = session.state.chat[1];
    expect(gmEntry).toMatchObject({ kind: 'roll', visibility: 'gm' });
    const hidden = { kind: 'hidden_roll', id: gmEntry?.id, at: gmEntry?.at, authorId: GM.playerId };
    expect(session.viewFor(ANA.playerId).chat[1]).toEqual(hidden);
    expect(session.viewFor(GM.playerId).chat[1]).toEqual(gmEntry);

    const forAna = session.patchFor(change, ANA.playerId);
    expect(forAna.rev).toBe(change.rev);
    expect(forAna.ops).toEqual([{ op: 'add', path: '/chat/-', value: hidden }]);
    expect(session.patchFor(change, GM.playerId).ops).toEqual(change.ops);
  });

  it('works with the crypto RNG', () => {
    const session = setup({ rng: cryptoRng });
    for (let i = 0; i < 50; i++) session.handle(ANA.playerId, { kind: 'dice.roll', data: { formula: '1d20', visibility: 'public' } });
    for (const entry of session.state.chat) {
      if (entry.kind !== 'roll') throw new Error('esperava rolagem');
      expect(entry.total).toBeGreaterThanOrEqual(1);
      expect(entry.total).toBeLessThanOrEqual(20);
    }
  });
});

describe('HostSession: maps', () => {
  it('activates the first map created, and only the GM creates or switches maps', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 30, height: 20 } });
    const first = session.state.activeMapId;
    expect(first).not.toBeNull();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Cidade', width: 40, height: 40 } });
    expect(session.state.activeMapId).toBe(first);

    const second = Object.values(session.state.maps).find((m) => m.name === 'Cidade')?.id ?? '';
    expect(rejection(session.handle(ANA.playerId, { kind: 'map.activate', data: { mapId: second } }))).toBe('not_allowed');
    expect(applied(session.handle(GM.playerId, { kind: 'map.activate', data: { mapId: second } }))).toBe(true);
    expect(session.state.activeMapId).toBe(second);
    expect(rejection(session.handle(GM.playerId, { kind: 'map.activate', data: { mapId: randomUUID() } }))).toBe('rule_violation');
  });
});

describe('HostSession: tokens', () => {
  it('creates tokens on existing maps, inside them, with known monsters and owners', () => {
    const session = setup();
    const { mapId, tokenId } = withMap(session);
    expect(session.state.tokens[tokenId]).toMatchObject({ mapId, name: 'Ana', size: 'medium', monsterId: null, image: null, ownerIds: [ANA.playerId] });

    const create = (data: Partial<Extract<Intent, { kind: 'token.create' }>['data']>): IntentOutcome =>
      session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin 1', position: { x: 0, y: 0 }, size: 'small', ...data } });
    expect(applied(create({ monsterId: 'goblin' }))).toBe(true);
    expect(rejection(create({ monsterId: 'tarrasque_rosa' }))).toBe('rule_violation');
    expect(rejection(create({ mapId: randomUUID() }))).toBe('rule_violation');
    expect(rejection(create({ position: { x: 1000, y: 0 } }))).toBe('rule_violation');
    expect(applied(create({ position: { x: 999, y: 999 } }))).toBe(true);
    expect(rejection(create({ ownerIds: [randomUUID()] }))).toBe('rule_violation');
    expect(rejection(session.handle(ANA.playerId, { kind: 'token.create', data: { mapId, name: 'X', position: { x: 0, y: 0 }, size: 'tiny' } }))).toBe('not_allowed');
  });

  it('lets the GM move any token and players only their own', () => {
    const session = setup();
    const { tokenId } = withMap(session);
    const move = (playerId: string, x: number): IntentOutcome => session.handle(playerId, { kind: 'token.move', data: { tokenId, to: { x, y: 100 } } });

    const out = move(ANA.playerId, 300);
    expect(out.change?.ops).toEqual([{ op: 'replace', path: `/tokens/${tokenId}/position`, value: { x: 300, y: 100 } }]);
    expect(rejection(move(BRUNO.playerId, 400))).toBe('not_allowed');
    expect(applied(move(GM.playerId, 500))).toBe(true);
    expect(rejection(move(GM.playerId, 1000))).toBe('rule_violation');
    expect(session.state.tokens[tokenId]?.position).toEqual({ x: 500, y: 100 });
  });

  it('lets only the GM remove tokens', () => {
    const session = setup();
    const { tokenId } = withMap(session);
    expect(rejection(session.handle(ANA.playerId, { kind: 'token.remove', data: { tokenId } }))).toBe('not_allowed');
    expect(applied(session.handle(GM.playerId, { kind: 'token.remove', data: { tokenId } }))).toBe(true);
    expect(session.state.tokens).toEqual({});
    expect(rejection(session.handle(GM.playerId, { kind: 'token.remove', data: { tokenId } }))).toBe('rule_violation');
  });
});

describe('HostSession: secret rolls by players', () => {
  it('shows the roll to its author and the GM, and hides it from the other players', () => {
    const session = setup();
    const { change } = session.handle(ANA.playerId, { kind: 'dice.roll', data: { formula: '1d20', visibility: 'gm' } });
    if (!change) throw new Error('esperava um patch');
    expect(session.viewFor(ANA.playerId).chat[0]).toMatchObject({ kind: 'roll' });
    expect(session.viewFor(GM.playerId).chat[0]).toMatchObject({ kind: 'roll' });
    expect(session.viewFor(BRUNO.playerId).chat[0]).toMatchObject({ kind: 'hidden_roll' });
    expect(session.patchFor(change, ANA.playerId).ops[0]).toMatchObject({ value: { kind: 'roll' } });
    expect(session.patchFor(change, BRUNO.playerId).ops[0]).toMatchObject({ value: { kind: 'hidden_roll' } });
  });
});
