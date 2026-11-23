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
const KNOWN_IMAGE = 'a'.repeat(64);
const UNKNOWN_IMAGE = 'b'.repeat(64);

function setup(overrides: Partial<SessionDeps> = {}): HostSession {
  const session = new HostSession(CAMPAIGN, GM, {
    rng: seededRng(42),
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: (id) => id === 'goblin',
    pruneSteps: (steps) => steps,
    itemProblems: (entry) => (entry.itemId === 'rope' || entry.itemId === 'ring_of_protection' ? [] : ['Item desconhecido']),
    assetExists: (sha) => sha === KNOWN_IMAGE,
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
    expect(applied(session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Com fundo', width: 5, height: 5, background: KNOWN_IMAGE } }))).toBe(true);
    expect(applied(session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Com grid px', width: 30, height: 20, background: KNOWN_IMAGE, cellPx: 70 } }))).toBe(true);
    expect(Object.values(session.state.maps).find((m) => m.name === 'Com grid px')?.cellPx).toBe(70);
    expect(rejection(session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Sem fundo', width: 5, height: 5, background: UNKNOWN_IMAGE } }))).toBe('rule_violation');
    expect(rejection(session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Px sem fundo', width: 5, height: 5, cellPx: 70 } }))).toBe('rule_violation');
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
    // O token inteiro precisa caber no mapa 10×10 (1000 unidades): Small ocupa 100, Large 200, Tiny 50.
    expect(applied(create({ position: { x: 900, y: 900 } }))).toBe(true);
    expect(rejection(create({ position: { x: 901, y: 0 } }))).toBe('rule_violation');
    expect(applied(create({ position: { x: 800, y: 800 }, size: 'large' }))).toBe(true);
    expect(rejection(create({ position: { x: 801, y: 0 }, size: 'large' }))).toBe('rule_violation');
    expect(applied(create({ position: { x: 950, y: 950 }, size: 'tiny' }))).toBe(true);
    expect(rejection(create({ ownerIds: [randomUUID()] }))).toBe('rule_violation');
    expect(applied(create({ image: KNOWN_IMAGE }))).toBe(true);
    expect(rejection(create({ image: UNKNOWN_IMAGE }))).toBe('rule_violation');
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

describe('HostSession: characters', () => {
  const STANDARD = { method: 'standard_array' as const, scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } };

  /** Cria um personagem para quem pede e devolve o id. */
  function create(session: HostSession, playerId: string, name = 'Thorin', ownerId?: string): string {
    const before = new Set(Object.keys(session.state.characters));
    const outcome = session.handle(playerId, { kind: 'character.create', data: { name, ...(ownerId !== undefined ? { ownerId } : {}) } });
    expect(applied(outcome)).toBe(true);
    return Object.keys(session.state.characters).find((id) => !before.has(id)) ?? '';
  }

  it('creates an empty draft owned by whoever asked', () => {
    const session = setup();
    const id = create(session, ANA.playerId);
    expect(session.state.characters[id]).toEqual({ id, ownerId: ANA.playerId, name: 'Thorin', baseScores: null, rolledScores: null, steps: [], inventory: { currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [] }, adjustments: [] });
    expect(SessionStateSchema.safeParse(session.state).success).toBe(true);
  });

  it('lets only the GM create a character for someone else', () => {
    const session = setup();
    expect(rejection(session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Intruso', ownerId: BRUNO.playerId } }))).toBe('not_allowed');
    const id = create(session, GM.playerId, 'Lia', ANA.playerId);
    expect(session.state.characters[id]?.ownerId).toBe(ANA.playerId);
    expect(rejection(session.handle(GM.playerId, { kind: 'character.create', data: { name: 'Fantasma', ownerId: randomUUID() } }))).toBe('rule_violation');
  });

  it('lets the owner and the GM edit, but not other players', () => {
    const session = setup();
    const id = create(session, ANA.playerId);
    const steps: Intent = { kind: 'character.update', data: { characterId: id, steps: [{ kind: 'class_level', classId: 'fighter', selections: [] }] } };
    expect(applied(session.handle(ANA.playerId, steps))).toBe(true);
    expect(applied(session.handle(GM.playerId, { kind: 'character.update', data: { characterId: id, name: 'Thorin II', baseScores: STANDARD } }))).toBe(true);
    expect(rejection(session.handle(BRUNO.playerId, { kind: 'character.update', data: { characterId: id, name: 'Roubado' } }))).toBe('not_allowed');
    expect(session.state.characters[id]).toMatchObject({ name: 'Thorin II', baseScores: STANDARD, steps: [{ kind: 'class_level', classId: 'fighter' }] });
  });

  it('keeps manual ability scores for the GM', () => {
    const session = setup();
    const id = create(session, ANA.playerId);
    const manual = { method: 'manual' as const, scores: { str: 20, dex: 20, con: 20, int: 20, wis: 20, cha: 20 } };
    expect(rejection(session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: manual } }))).toBe('not_allowed');
    expect(applied(session.handle(GM.playerId, { kind: 'character.update', data: { characterId: id, baseScores: manual } }))).toBe(true);
  });

  it('rolls ability scores on the Host, once for the owner, and posts them to the chat', () => {
    const session = setup();
    const id = create(session, ANA.playerId);
    expect(applied(session.handle(ANA.playerId, { kind: 'character.roll_scores', data: { characterId: id } }))).toBe(true);
    const rolled = session.state.characters[id]?.rolledScores ?? [];
    expect(rolled).toHaveLength(6);
    const entry = session.state.chat.at(-1);
    expect(entry).toMatchObject({ kind: 'ability_roll', authorId: ANA.playerId, characterId: id, characterName: 'Thorin' });
    expect(entry?.kind === 'ability_roll' && entry.sets.map((s) => s.total)).toEqual(rolled);
    expect(rejection(session.handle(ANA.playerId, { kind: 'character.roll_scores', data: { characterId: id } }))).toBe('not_allowed');
    expect(rejection(session.handle(BRUNO.playerId, { kind: 'character.roll_scores', data: { characterId: id } }))).toBe('not_allowed');
  });

  it('accepts rolled scores only with the values the Host rolled', () => {
    // Dados 6, 5, 4, 3 em sequência: todo conjunto dá 15 (descarta o 3).
    const values = [6, 5, 4, 3];
    let i = 0;
    const session = setup({ rng: { roll: () => values[i++ % values.length] ?? 1 } });
    const id = create(session, ANA.playerId);
    const rolled = (str: number) => ({ method: 'rolled' as const, scores: { str, dex: 15, con: 15, int: 15, wis: 15, cha: 15 } });
    expect(rejection(session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: rolled(15) } }))).toBe('rule_violation');
    session.handle(ANA.playerId, { kind: 'character.roll_scores', data: { characterId: id } });
    expect(session.state.characters[id]?.rolledScores).toEqual([15, 15, 15, 15, 15, 15]);
    expect(rejection(session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: rolled(18) } }))).toBe('rule_violation');
    expect(applied(session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: rolled(15) } }))).toBe(true);
  });

  it('clears a rolled assignment when the GM rerolls', () => {
    const session = setup();
    const id = create(session, ANA.playerId);
    session.handle(ANA.playerId, { kind: 'character.roll_scores', data: { characterId: id } });
    const rolled = session.state.characters[id]?.rolledScores ?? [];
    const [str = 3, dex = 3, con = 3, int = 3, wis = 3, cha = 3] = rolled;
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: { method: 'rolled', scores: { str, dex, con, int, wis, cha } } } });
    expect(applied(session.handle(GM.playerId, { kind: 'character.roll_scores', data: { characterId: id } }))).toBe(true);
    expect(session.state.characters[id]?.baseScores).toBeNull();
  });

  it('prunes loose selections from the steps it receives', () => {
    // Stub: o motor diria que nenhuma seleção é usada.
    const session = setup({ pruneSteps: (steps) => steps.map((s) => ({ ...s, selections: [] })) });
    const id = create(session, ANA.playerId);
    const loose = { source: { kind: 'class' as const, id: 'fighter' }, choiceId: 'skills', picks: ['athletics', 'perception'] };
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, steps: [{ kind: 'class_level', classId: 'fighter', selections: [loose] }] } });
    expect(session.state.characters[id]?.steps).toEqual([{ kind: 'class_level', classId: 'fighter', selections: [] }]);
  });

  it('removes a character for the owner or the GM', () => {
    const session = setup();
    const id = create(session, ANA.playerId);
    expect(rejection(session.handle(BRUNO.playerId, { kind: 'character.remove', data: { characterId: id } }))).toBe('not_allowed');
    expect(applied(session.handle(ANA.playerId, { kind: 'character.remove', data: { characterId: id } }))).toBe(true);
    expect(session.state.characters).toEqual({});
    expect(rejection(session.handle(GM.playerId, { kind: 'character.remove', data: { characterId: id } }))).toBe('rule_violation');
  });

  it('restores saved characters', () => {
    const first = setup();
    const id = create(first, ANA.playerId);
    const restored = new HostSession(CAMPAIGN, GM, { rng: cryptoRng, now: Date.now, newId: randomUUID, monsterExists: () => false, assetExists: () => false, pruneSteps: (s) => s, itemProblems: () => [] }, first.state);
    expect(restored.state.characters[id]?.name).toBe('Thorin');
  });
});

describe('HostSession: inventory', () => {
  function withCharacter(): { session: HostSession; id: string } {
    const session = setup();
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    return { session, id: Object.keys(session.state.characters)[0] ?? '' };
  }
  const items = (session: HostSession, id: string) => session.state.characters[id]?.inventory.items ?? [];

  it('adds items the engine accepts, stacking equal unequipped entries', () => {
    const { session, id } = withCharacter();
    expect(applied(session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, itemId: 'rope' } }))).toBe(true);
    expect(applied(session.handle(GM.playerId, { kind: 'inventory.add', data: { characterId: id, itemId: 'rope', quantity: 2 } }))).toBe(true);
    expect(items(session, id)).toHaveLength(1);
    expect(items(session, id)[0]).toMatchObject({ itemId: 'rope', quantity: 3, equipped: false, attuned: false });
    expect(rejection(session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, itemId: 'vorpal' } }))).toBe('rule_violation');
    expect(rejection(session.handle(BRUNO.playerId, { kind: 'inventory.add', data: { characterId: id, itemId: 'rope' } }))).toBe('not_allowed');
    expect(SessionStateSchema.safeParse(session.state).success).toBe(true);
  });

  it('equips and attunes, and does not stack onto an attuned entry', () => {
    const { session, id } = withCharacter();
    session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, itemId: 'ring_of_protection' } });
    const instanceId = items(session, id)[0]?.instanceId ?? '';
    expect(applied(session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: id, instanceId, attuned: true, equipped: true } }))).toBe(true);
    expect(items(session, id)[0]).toMatchObject({ attuned: true, equipped: true });
    session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, itemId: 'ring_of_protection' } });
    expect(items(session, id)).toHaveLength(2);
    expect(rejection(session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: id, instanceId: 'nao-existe', equipped: true } }))).toBe('rule_violation');
  });

  it('removes some units or the whole entry', () => {
    const { session, id } = withCharacter();
    session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, itemId: 'rope', quantity: 5 } });
    const instanceId = items(session, id)[0]?.instanceId ?? '';
    session.handle(ANA.playerId, { kind: 'inventory.remove', data: { characterId: id, instanceId, quantity: 2 } });
    expect(items(session, id)[0]?.quantity).toBe(3);
    session.handle(ANA.playerId, { kind: 'inventory.remove', data: { characterId: id, instanceId } });
    expect(items(session, id)).toEqual([]);
  });

  it('sets the coins', () => {
    const { session, id } = withCharacter();
    const currency = { cp: 3, sp: 0, ep: 0, gp: 15, pp: 1 };
    expect(applied(session.handle(ANA.playerId, { kind: 'inventory.currency', data: { characterId: id, currency } }))).toBe(true);
    expect(session.state.characters[id]?.inventory.currency).toEqual(currency);
  });

  it('links tokens to characters and unlinks them when the character is removed', () => {
    const { session, id } = withCharacter();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    const token = { mapId, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium' as const, ownerIds: [ANA.playerId] };
    expect(rejection(session.handle(GM.playerId, { kind: 'token.create', data: { ...token, characterId: randomUUID() } }))).toBe('rule_violation');
    expect(applied(session.handle(GM.playerId, { kind: 'token.create', data: { ...token, characterId: id } }))).toBe(true);
    const tokenId = Object.keys(session.state.tokens)[0] ?? '';
    expect(session.state.tokens[tokenId]?.characterId).toBe(id);
    session.handle(ANA.playerId, { kind: 'character.remove', data: { characterId: id } });
    expect(session.state.tokens[tokenId]?.characterId).toBeNull();
  });
});

describe('HostSession: GM adjustments', () => {
  it('lets only the GM add and remove adjustments', () => {
    const session = setup();
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const id = Object.keys(session.state.characters)[0] ?? '';
    const blessing: Intent = { kind: 'adjustment.add', data: { characterId: id, name: 'Bênção', effects: [{ type: 'flat_bonus', target: 'ac', value: 1 }] } };
    expect(rejection(session.handle(ANA.playerId, blessing))).toBe('not_allowed');
    expect(applied(session.handle(GM.playerId, blessing))).toBe(true);
    const adjustment = session.state.characters[id]?.adjustments[0];
    expect(adjustment).toMatchObject({ name: 'Bênção', effects: [{ type: 'flat_bonus', target: 'ac', value: 1 }] });
    expect(SessionStateSchema.safeParse(session.state).success).toBe(true);
    const remove: Intent = { kind: 'adjustment.remove', data: { characterId: id, adjustmentId: adjustment?.id ?? '' } };
    expect(rejection(session.handle(ANA.playerId, remove))).toBe('not_allowed');
    expect(applied(session.handle(GM.playerId, remove))).toBe(true);
    expect(session.state.characters[id]?.adjustments).toEqual([]);
    expect(rejection(session.handle(GM.playerId, remove))).toBe('rule_violation');
  });
});
