import { randomUUID } from 'node:crypto';
import { loadSrdCompendium, seededRng } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import { applyPatch, type Intent, SessionStateSchema } from '../../shared/protocol';
import { CharacterSchema } from 'rules-engine/schemas';
import { characterSheet } from '../character-sheet';
import { HostSession, type IntentOutcome, type SessionDeps } from './executor';
import dwarfFighter from '../../../packages/rules-engine/tests/fixtures/dwarf-fighter-5.json';
import gnomeRanger from '../../../packages/rules-engine/tests/fixtures/gnome-ranger-6.json';
import elfWizard from '../../../packages/rules-engine/tests/fixtures/elf-wizard-7.json';
import goliathWarlock from '../../../packages/rules-engine/tests/fixtures/goliath-warlock-5.json';
import type { SessionCharacter } from '../../shared/protocol';
import { cryptoRng } from './rng';

const compendium = loadSrdCompendium();
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
    characterSheet: (c) => characterSheet(c, compendium).sheet ?? undefined,
    monsterHpMax: (id) => (id === 'goblin' ? 7 : undefined),
    creature: (id) => compendium.creatures.find((c) => c.id === id),
    spellName: (id) => compendium.spells.find((s) => s.id === id)?.name,
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
    expect(session.state.characters[id]).toEqual({ id, ownerId: ANA.playerId, name: 'Thorin', baseScores: null, rolledScores: null, steps: [], inventory: { currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [] }, hp: { damage: 0, temp: 0 }, adjustments: [], conditions: { active: [], exhaustion: 0 }, deathSaves: { successes: 0, failures: 0, stable: false, dead: false }, concentration: null, hitDiceSpent: {}, spellSlotsSpent: { byLevel: {}, pact: 0 } });
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
    const restored = new HostSession(CAMPAIGN, GM, { rng: cryptoRng, now: Date.now, newId: randomUUID, monsterExists: () => false, assetExists: () => false, pruneSteps: (s) => s, itemProblems: () => [], characterSheet: () => undefined, monsterHpMax: () => undefined, creature: () => undefined, spellName: () => undefined }, first.state);
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

describe('HostSession: hit points', () => {
  const STANDARD = { method: 'standard_array' as const, scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } };

  /** Mapa, um goblin (PV médios 7), e um Guerreiro 1 da Ana (PV máximos 10 + CON 1 = 11). */
  function table(): { session: HostSession; goblin: string; hero: string } {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin 1', position: { x: 0, y: 0 }, size: 'small', monsterId: 'goblin' } });
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: hero, baseScores: STANDARD, steps: [{ kind: 'class_level', classId: 'fighter', selections: [] }] } });
    return { session, goblin: Object.keys(session.state.tokens)[0] ?? '', hero };
  }
  const hp = (session: HostSession, change: { kind: 'damage' | 'healing' | 'temp' | 'max'; amount: number }, target: { characterId: string } | { tokenId: string }, who = GM.playerId) =>
    session.handle(who, { kind: 'hp.change', data: { target, change } });

  it('gives monster tokens the average hit points of their stat block', () => {
    const { session, goblin } = table();
    expect(session.state.tokens[goblin]?.hp).toEqual({ max: 7, damage: 0, temp: 0 });
  });

  it('applies damage, temporary hit points and healing with the engine rules', () => {
    const { session, goblin, hero } = table();
    expect(applied(hp(session, { kind: 'damage', amount: 5 }, { tokenId: goblin }))).toBe(true);
    expect(session.state.tokens[goblin]?.hp).toEqual({ max: 7, damage: 5, temp: 0 });
    hp(session, { kind: 'damage', amount: 50 }, { tokenId: goblin });
    expect(session.state.tokens[goblin]?.hp?.damage).toBe(7);

    hp(session, { kind: 'temp', amount: 5 }, { characterId: hero }, ANA.playerId);
    hp(session, { kind: 'damage', amount: 7 }, { characterId: hero });
    expect(session.state.characters[hero]?.hp).toEqual({ damage: 2, temp: 0 });
    hp(session, { kind: 'healing', amount: 10 }, { characterId: hero }, ANA.playerId);
    expect(session.state.characters[hero]?.hp).toEqual({ damage: 0, temp: 0 });
  });

  it('lets the GM set a token maximum and keeps the damage within it', () => {
    const { session, goblin } = table();
    hp(session, { kind: 'damage', amount: 5 }, { tokenId: goblin });
    hp(session, { kind: 'max', amount: 4 }, { tokenId: goblin });
    expect(session.state.tokens[goblin]?.hp).toEqual({ max: 4, damage: 4, temp: 0 });
    expect(rejection(hp(session, { kind: 'max', amount: 0 }, { tokenId: goblin }))).toBe('rule_violation');
  });

  it('checks who may change hit points', () => {
    const { session, goblin, hero } = table();
    expect(rejection(hp(session, { kind: 'damage', amount: 1 }, { tokenId: goblin }, ANA.playerId))).toBe('not_allowed');
    expect(rejection(hp(session, { kind: 'damage', amount: 1 }, { characterId: hero }, BRUNO.playerId))).toBe('not_allowed');
    expect(rejection(hp(session, { kind: 'max', amount: 30 }, { characterId: hero }))).toBe('rule_violation');
  });

  it('refuses characters without a sheet and tokens without hit points', () => {
    const { session } = table();
    session.handle(BRUNO.playerId, { kind: 'character.create', data: { name: 'Rascunho' } });
    const draft = Object.values(session.state.characters).find((c) => c.name === 'Rascunho')?.id ?? '';
    expect(rejection(hp(session, { kind: 'damage', amount: 1 }, { characterId: draft }))).toBe('rule_violation');
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Barril', position: { x: 100, y: 0 }, size: 'medium' } });
    const barrel = Object.values(session.state.tokens).find((t) => t.name === 'Barril');
    expect(barrel?.hp).toBeNull();
    expect(rejection(hp(session, { kind: 'damage', amount: 1 }, { tokenId: barrel?.id ?? '' }))).toBe('rule_violation');
    expect(applied(hp(session, { kind: 'max', amount: 10 }, { tokenId: barrel?.id ?? '' }))).toBe(true);
  });

  it('hides monster hit points from players, in snapshots and patches', () => {
    const { session, goblin } = table();
    expect(session.viewFor(ANA.playerId).tokens[goblin]?.hp).toBeNull();
    expect(session.viewFor(GM.playerId).tokens[goblin]?.hp).toEqual({ max: 7, damage: 0, temp: 0 });
    const outcome = hp(session, { kind: 'damage', amount: 3 }, { tokenId: goblin });
    if (!outcome.change) throw new Error('sem mudança');
    expect(session.patchFor(outcome.change, ANA.playerId).ops).toEqual([]);
    expect(session.patchFor(outcome.change, GM.playerId).ops).toHaveLength(1);
    // Token novo de monstro chega sem PV para o jogador.
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    const created = session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin 2', position: { x: 200, y: 0 }, size: 'small', monsterId: 'goblin' } });
    if (!created.change) throw new Error('sem mudança');
    const [op] = session.patchFor(created.change, ANA.playerId).ops;
    expect(op?.op === 'add' && (op.value as { hp: unknown }).hp).toBeNull();
    // A visão do jogador, com os patches filtrados, continua válida.
    expect(SessionStateSchema.safeParse(session.viewFor(ANA.playerId)).success).toBe(true);
  });

  it('shows the hit points of their own tokens to players', () => {
    const { session } = table();
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Lobo da Ana', position: { x: 300, y: 0 }, size: 'medium', hpMax: 11, ownerIds: [ANA.playerId] } });
    const wolf = Object.values(session.state.tokens).find((t) => t.name === 'Lobo da Ana');
    expect(session.viewFor(ANA.playerId).tokens[wolf?.id ?? '']?.hp).toEqual({ max: 11, damage: 0, temp: 0 });
    expect(session.viewFor(BRUNO.playerId).tokens[wolf?.id ?? '']?.hp).toBeNull();
  });
});

describe('HostSession: rolls from the sheet', () => {
  /** Dados em sequência, para saber o resultado. */
  const sequence = (values: number[]) => {
    let i = 0;
    return { roll: () => values[i++ % values.length] ?? 1 };
  };
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] }; inventory: { items: unknown[] } };

  /** Guerreiro anão 5 da Ana (personagem de referência), com cota de malha, escudo e espada longa equipados. */
  function withFighter(rolls: number[]): { session: HostSession; id: string } {
    const session = setup({ rng: sequence(rolls), itemProblems: () => [] });
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const id = Object.keys(session.state.characters)[0] ?? '';
    // Como na mesa: o Intent passa pelo schema (que completa `selections` omitidas no JSON).
    const steps = CharacterSchema.shape.steps.parse(fighter.character.steps);
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: fighter.character.baseScores ?? undefined, steps } });
    for (const itemId of ['chain_mail', 'shield', 'longsword']) {
      session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, itemId } });
      const entry = session.state.characters[id]?.inventory.items.at(-1);
      session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: id, instanceId: entry?.instanceId ?? '', equipped: true } });
    }
    return { session, id };
  }
  const last = (session: HostSession) => session.state.chat.at(-1);

  it('rolls a skill with the sheet modifier, advantage and breakdown', () => {
    const { session, id } = withFighter([4, 17]);
    expect(applied(session.handle(ANA.playerId, { kind: 'roll.d20', data: { characterId: id, target: { kind: 'skill', skill: 'athletics' }, visibility: 'public' } }))).toBe(true);
    const entry = last(session);
    if (entry?.kind !== 'd20_roll') throw new Error('sem rolagem');
    // Remarkable Athlete: Vantagem em Atletismo; fica o 17.
    expect(entry).toMatchObject({ characterName: 'Thorin', mode: 'advantage', dice: [4, 17], natural: 17, advantage: ['Remarkable Athlete (Champion)'] });
    expect(entry.total).toBe(17 + entry.modifier);
    expect(entry.parts.reduce((sum, p) => sum + p.value, 0)).toBe(entry.modifier);
  });

  it('marks critical hits only on attack rolls', () => {
    const { session, id } = withFighter([20, 20]);
    session.handle(ANA.playerId, { kind: 'roll.d20', data: { characterId: id, target: { kind: 'skill', skill: 'athletics' }, visibility: 'public' } });
    expect(last(session)).toMatchObject({ kind: 'd20_roll', natural: 20, critical: false });
  });

  it('cancels the armor disadvantage on Stealth with a declared advantage', () => {
    const { session, id } = withFighter([9]);
    session.handle(ANA.playerId, { kind: 'roll.d20', data: { characterId: id, target: { kind: 'skill', skill: 'stealth' }, advantage: true, visibility: 'public' } });
    expect(last(session)).toMatchObject({ kind: 'd20_roll', mode: 'normal', dice: [9] });
  });

  it('rolls attacks with the crit range and damage with doubled dice on a critical', () => {
    const { session, id } = withFighter([19, 6, 2]);
    const sword = session.state.characters[id]?.inventory.items.find((e) => e.itemId === 'longsword')?.instanceId ?? '';
    session.handle(ANA.playerId, { kind: 'roll.d20', data: { characterId: id, target: { kind: 'attack', instanceId: sword }, visibility: 'public' } });
    // Improved Critical: 19 é crítico.
    expect(last(session)).toMatchObject({ kind: 'd20_roll', natural: 19, critical: true, label: 'Longsword' });
    session.handle(ANA.playerId, { kind: 'roll.damage', data: { characterId: id, instanceId: sword, critical: true, visibility: 'public' } });
    const damage = last(session);
    if (damage?.kind !== 'damage_roll') throw new Error('sem dano');
    expect(damage.groups[0]).toMatchObject({ dice: '2d8', type: 'slashing', total: 8 });
    expect(damage.total).toBe(8 + damage.bonus);
  });

  it('checks ownership and that the attack is on the sheet', () => {
    const { session, id } = withFighter([10]);
    expect(rejection(session.handle(BRUNO.playerId, { kind: 'roll.d20', data: { characterId: id, target: { kind: 'initiative' }, visibility: 'public' } }))).toBe('not_allowed');
    expect(applied(session.handle(GM.playerId, { kind: 'roll.d20', data: { characterId: id, target: { kind: 'initiative' }, visibility: 'gm' } }))).toBe(true);
    expect(rejection(session.handle(ANA.playerId, { kind: 'roll.damage', data: { characterId: id, instanceId: 'nao-equipada', visibility: 'public' } }))).toBe('rule_violation');
  });

  it('hides secret sheet rolls from other players', () => {
    const { session, id } = withFighter([12]);
    const outcome = session.handle(ANA.playerId, { kind: 'roll.d20', data: { characterId: id, target: { kind: 'skill', skill: 'perception' }, visibility: 'gm' } });
    if (!outcome.change) throw new Error('sem mudança');
    expect(session.patchFor(outcome.change, BRUNO.playerId).ops[0]).toMatchObject({ value: { kind: 'hidden_roll' } });
    expect(session.patchFor(outcome.change, ANA.playerId).ops[0]).toMatchObject({ value: { kind: 'd20_roll' } });
  });
});

describe('HostSession: attacks against a target', () => {
  const sequence = (values: number[]) => {
    let i = 0;
    return { roll: () => values[i++ % values.length] ?? 1 };
  };
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };

  /** Thorin (guerreiro anão 5, espada longa +7, CA 19 com cota, escudo e Defense) e um Goblin Warrior (CA 15, 10 PV) no mapa. */
  function arena(rolls: number[]) {
    const session = setup({
      rng: sequence(rolls),
      itemProblems: () => [],
      monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
      monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    const steps = CharacterSchema.shape.steps.parse(fighter.character.steps);
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps } });
    for (const itemId of ['chain_mail', 'shield', 'longsword']) {
      session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: hero, itemId } });
      const entry = session.state.characters[hero]?.inventory.items.at(-1);
      session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: hero, instanceId: entry?.instanceId ?? '', equipped: true } });
    }
    const sword = session.state.characters[hero]?.inventory.items.find((e) => e.itemId === 'longsword')?.instanceId ?? '';
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium', characterId: hero, ownerIds: [ANA.playerId] } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin 1', position: { x: 100, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
    const tokenNamed = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    return { session, hero, sword, thorin: tokenNamed('Thorin'), goblin: tokenNamed('Goblin 1') };
  }
  const swing = (a: ReturnType<typeof arena>, who = ANA.playerId) =>
    a.session.handle(who, { kind: 'attack.make', data: { attacker: { characterId: a.hero, instanceId: a.sword }, targetTokenId: a.goblin, visibility: 'public' } });
  const attackEntry = (session: HostSession) => {
    const entry = session.state.chat.at(-1);
    if (entry?.kind !== 'attack_roll') throw new Error('sem ataque');
    return entry;
  };

  it('hits on AC or more and proposes the damage without touching hit points', () => {
    // d20 = 8 (+7 = 15 contra CA 15): acerta; 1d8 = 5, +4.
    const a = arena([8, 5]);
    expect(applied(swing(a))).toBe(true);
    const entry = attackEntry(a.session);
    expect(entry).toMatchObject({ attackerName: 'Thorin', label: 'Longsword', targetName: 'Goblin 1', total: 15, hit: true });
    expect(entry.damage?.total).toBe(9);
    const proposal = a.session.state.proposals[entry.damage?.proposalId ?? ''];
    expect(proposal).toMatchObject({ entryId: entry.id, targetTokenId: a.goblin, amount: 9 });
    expect(a.session.state.tokens[a.goblin]?.hp?.damage).toBe(0);
  });

  it('misses below AC without a proposal', () => {
    const a = arena([7]);
    swing(a);
    expect(attackEntry(a.session)).toMatchObject({ total: 14, hit: false });
    expect(a.session.state.proposals).toEqual({});
  });

  it('lets only the GM apply the proposal, with the proposed amount or another', () => {
    const a = arena([8, 5]);
    swing(a);
    const proposalId = attackEntry(a.session).damage?.proposalId ?? '';
    expect(rejection(a.session.handle(ANA.playerId, { kind: 'damage.apply', data: { proposalId } }))).toBe('not_allowed');
    expect(applied(a.session.handle(GM.playerId, { kind: 'damage.apply', data: { proposalId, amount: 6 } }))).toBe(true);
    expect(a.session.state.tokens[a.goblin]?.hp?.damage).toBe(6);
    expect(a.session.state.proposals).toEqual({});
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'damage_applied', targetName: 'Goblin 1', amount: 6, proposed: 9 });
    expect(rejection(a.session.handle(GM.playerId, { kind: 'damage.apply', data: { proposalId } }))).toBe('rule_violation');
  });

  it('notes when the target drops to 0 hit points, and lets the GM dismiss a proposal', () => {
    const a = arena([8, 8, 8, 8]);
    swing(a);
    const first = attackEntry(a.session).damage?.proposalId ?? '';
    a.session.handle(GM.playerId, { kind: 'damage.apply', data: { proposalId: first } });
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'damage_applied', amount: 12, notes: ['Goblin 1 caiu a 0 PV'] });
    swing(a);
    const second = attackEntry(a.session).damage?.proposalId ?? '';
    expect(applied(a.session.handle(GM.playerId, { kind: 'damage.dismiss', data: { proposalId: second } }))).toBe(true);
    expect(a.session.state.proposals).toEqual({});
  });

  it('lets the GM attack with a monster action against a character AC', () => {
    // Scimitar +4: d20 15 = 19 contra CA 19 de Thorin, acerta; 1d6+2 = 3+2.
    const a = arena([15, 3]);
    const outcome = a.session.handle(GM.playerId, { kind: 'attack.make', data: { attacker: { tokenId: a.goblin, actionId: 'scimitar' }, targetTokenId: a.thorin, visibility: 'public' } });
    expect(applied(outcome)).toBe(true);
    const entry = attackEntry(a.session);
    expect(entry).toMatchObject({ attackerName: 'Goblin 1', label: 'Scimitar', modifier: 4, total: 19, hit: true });
    expect(entry.damage?.total).toBe(5);
    a.session.handle(GM.playerId, { kind: 'damage.apply', data: { proposalId: entry.damage?.proposalId ?? '' } });
    expect(a.session.state.characters[a.hero]?.hp.damage).toBe(5);
    expect(rejection(a.session.handle(ANA.playerId, { kind: 'attack.make', data: { attacker: { tokenId: a.goblin, actionId: 'scimitar' }, targetTokenId: a.thorin, visibility: 'public' } }))).toBe('not_allowed');
  });

  it('keeps proposals away from players', () => {
    const a = arena([8, 5]);
    const outcome = swing(a);
    if (!outcome.change) throw new Error('sem mudança');
    expect(a.session.patchFor(outcome.change, ANA.playerId).ops.map((o) => o.path)).toEqual(['/chat/-']);
    expect(a.session.viewFor(ANA.playerId).proposals).toEqual({});
    expect(Object.keys(a.session.viewFor(GM.playerId).proposals)).toHaveLength(1);
  });
});

describe('HostSession: forced saving throws', () => {
  const sequence = (values: number[]) => {
    let i = 0;
    return { roll: () => values[i++ % values.length] ?? 1 };
  };
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };

  /** Thorin (anão guerreiro 5, sem itens), um Goblin Warrior e um Ankheg no mapa. */
  function arena(rolls: number[]) {
    const session = setup({
      rng: sequence(rolls),
      monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
      monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    const steps = CharacterSchema.shape.steps.parse(fighter.character.steps);
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium', characterId: hero, ownerIds: [ANA.playerId] } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin 1', position: { x: 100, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Ankheg', position: { x: 300, y: 300 }, size: 'large', monsterId: 'ankheg' } });
    const tokenNamed = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    return { session, hero, thorin: tokenNamed('Thorin'), goblin: tokenNamed('Goblin 1'), ankheg: tokenNamed('Ankheg') };
  }
  const saveEntry = (session: HostSession) => {
    const entry = session.state.chat.at(-1);
    if (entry?.kind !== 'save_roll') throw new Error('sem salvaguarda');
    return entry;
  };

  it('rolls the damage once and each target saves on its own, with proposals', () => {
    // Dano 4d6 = 3+3+3+3 = 12. Thorin (DES +1) rola 15: sucesso, metade 6. Goblin (DES +2) rola 5: falha, 12.
    const a = arena([3, 3, 3, 3, 15, 5]);
    const outcome = a.session.handle(GM.playerId, { kind: 'save.force', data: { source: { tokenId: a.ankheg, actionId: 'acid_spray' }, targetTokenIds: [a.thorin, a.goblin], visibility: 'public' } });
    expect(applied(outcome)).toBe(true);
    const entry = saveEntry(a.session);
    expect(entry).toMatchObject({ actorName: 'Ankheg', label: 'Acid Spray', ability: 'dex', dc: 12, onSuccess: 'half', damage: { total: 12 } });
    expect(entry.results.map((r) => [r.targetName, r.total, r.success, r.damage?.total])).toEqual([
      ['Thorin', 16, true, 6],
      ['Goblin 1', 7, false, 12],
    ]);
    expect(Object.values(a.session.state.proposals).map((p) => [p.targetName, p.amount])).toEqual([
      ['Thorin', 6],
      ['Goblin 1', 12],
    ]);
  });

  it('applies circumstantial advantage from what the save is against (Dwarven Resilience vs poison)', () => {
    const a = arena([4, 17]);
    a.session.handle(GM.playerId, {
      kind: 'save.force',
      data: { source: { custom: { name: 'Gás venenoso', ability: 'con', dc: 13, damage: [], onSuccess: 'none', conditions: ['poisoned'] } }, targetTokenIds: [a.thorin], visibility: 'public' },
    });
    const [result] = saveEntry(a.session).results;
    expect(result).toMatchObject({ mode: 'advantage', advantage: ['Dwarven Resilience (Dwarf)'], dice: [4, 17], natural: 17, success: true });
    expect(result?.notes).toEqual([]);
  });

  it('notes the conditions of a failure and condition immunities', () => {
    const a = arena([2]);
    a.session.handle(GM.playerId, {
      kind: 'save.force',
      data: { source: { custom: { name: 'Teia', ability: 'dex', dc: 15, damage: [], onSuccess: 'none', conditions: ['restrained'] } }, targetTokenIds: [a.goblin], visibility: 'public' },
    });
    expect(saveEntry(a.session).results[0]).toMatchObject({ success: false, notes: ['Na falha: Impedido'] });
  });

  it('lets players force a save with a custom effect, but not with monster actions', () => {
    const a = arena([3, 3, 3, 3, 3, 3, 3, 3, 10]);
    const fireball = { custom: { name: 'Fireball', ability: 'dex' as const, dc: 15, damage: [{ dice: '8d6', type: 'fire' as const }], onSuccess: 'half' as const } };
    expect(applied(a.session.handle(ANA.playerId, { kind: 'save.force', data: { source: fireball, targetTokenIds: [a.goblin], against: { source: 'spell' }, visibility: 'public' } }))).toBe(true);
    expect(saveEntry(a.session)).toMatchObject({ actorName: 'Ana', damage: { total: 24 } });
    expect(rejection(a.session.handle(ANA.playerId, { kind: 'save.force', data: { source: { tokenId: a.ankheg, actionId: 'acid_spray' }, targetTokenIds: [a.thorin], visibility: 'public' } }))).toBe('not_allowed');
    expect(rejection(a.session.handle(GM.playerId, { kind: 'save.force', data: { source: { tokenId: a.ankheg, actionId: 'bite' }, targetTokenIds: [a.thorin], visibility: 'public' } }))).toBe('rule_violation');
  });
});

describe('HostSession: weapon masteries', () => {
  const sequence = (values: number[]) => {
    let i = 0;
    return { roll: () => values[i++ % values.length] ?? 1 };
  };
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };

  /**
   * Thorin (guerreiro anão 5, FOR 18: +4, proficiência +3) com a arma pedida
   * equipada e maestria em Greataxe (Cleave), Maul (Topple), Longsword (Sap) e
   * Greatsword (Graze); dois Goblin Warriors (CA 15, CON 10) no mapa.
   */
  function arena(weaponId: string, rolls: number[]) {
    const session = setup({
      rng: sequence(rolls),
      itemProblems: () => [],
      monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
      monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    const raw = JSON.stringify(fighter.character.steps).replace('["longsword","heavy_crossbow","handaxe"]', '["greataxe","maul","longsword"]');
    const steps = CharacterSchema.shape.steps.parse(JSON.parse(raw));
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps } });
    session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: hero, itemId: weaponId } });
    const weapon = session.state.characters[hero]?.inventory.items.at(-1)?.instanceId ?? '';
    session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: hero, instanceId: weapon, equipped: true } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium', characterId: hero, ownerIds: [ANA.playerId] } });
    for (const [name, x] of [['Goblin 1', 100], ['Goblin 2', 200]] as const) {
      session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name, position: { x, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
    }
    const tokenNamed = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    const attack = (visibility: 'public' | 'gm' = 'public') =>
      session.handle(ANA.playerId, { kind: 'attack.make', data: { attacker: { characterId: hero, instanceId: weapon }, targetTokenId: tokenNamed('Goblin 1'), visibility } });
    const use = (entryId: string, extra: { targetTokenId?: string; advantage?: boolean } = {}, who = ANA.playerId) =>
      session.handle(who, { kind: 'mastery.use', data: { entryId, ...extra } });
    return { session, hero, weapon, goblin1: tokenNamed('Goblin 1'), goblin2: tokenNamed('Goblin 2'), attack, use };
  }
  const lastEntry = (a: ReturnType<typeof arena>) => a.session.state.chat.at(-1);
  const attackEntry = (a: ReturnType<typeof arena>) => {
    const entry = lastEntry(a);
    if (entry?.kind !== 'attack_roll') throw new Error('sem ataque');
    return entry;
  };

  it('Topple: offered on a hit, the target saves against DC 8 + 4 + 3 and falls Prone on a failure, once per attack', () => {
    // d20 8 (+7 = 15 contra CA 15) acerta; 2d6 = 3+3, +4; salvaguarda: d20 5 + 0.
    const a = arena('maul', [8, 3, 3, 5]);
    expect(applied(a.attack())).toBe(true);
    const entry = attackEntry(a);
    expect(entry.weapon).toEqual({ characterId: a.hero, instanceId: a.weapon });
    expect(entry.mastery).toMatchObject({ property: 'topple', action: 'topple' });
    expect(entry.mastery?.notes[0]).toContain('CD 15');
    expect(applied(a.use(entry.id))).toBe(true);
    const save = lastEntry(a);
    if (save?.kind !== 'save_roll') throw new Error('sem salvaguarda');
    expect(save).toMatchObject({ actorName: 'Thorin', label: 'Topple (Maul)', ability: 'con', dc: 15, conditions: ['prone'], masteryOf: entry.id });
    expect(save.results[0]).toMatchObject({ targetTokenId: a.goblin1, total: 5, success: false });
    expect(save.results[0]?.notes).toContain('Na falha: Caído');
    expect(save.damage).toBeUndefined();
    expect(rejection(a.use(entry.id))).toBe('rule_violation');
  });

  it('Graze: offered on a miss, deals the ability modifier as a proposal for the GM', () => {
    // d20 2 (+7 = 9) erra.
    const a = arena('greatsword', [2]);
    a.attack();
    const entry = attackEntry(a);
    expect(entry).toMatchObject({ hit: false, mastery: { property: 'graze', action: 'graze' } });
    expect(rejection(a.use(entry.id, {}, BRUNO.playerId))).toBe('not_allowed');
    expect(rejection(a.use(entry.id, { advantage: true }))).toBe('rule_violation');
    expect(applied(a.use(entry.id))).toBe(true);
    const graze = lastEntry(a);
    if (graze?.kind !== 'mastery_damage') throw new Error('sem graze');
    expect(graze).toMatchObject({ property: 'graze', masteryOf: entry.id, targetTokenId: a.goblin1, damageType: 'slashing', amount: 4, total: 4 });
    expect(a.session.state.proposals[graze.proposalId ?? '']).toMatchObject({ entryId: graze.id, targetTokenId: a.goblin1, amount: 4 });
    expect(a.session.state.tokens[a.goblin1]?.hp?.damage).toBe(0);
    // O mestre também pode usar, mas só uma vez por ataque.
    expect(rejection(a.use(entry.id, {}, GM.playerId))).toBe('rule_violation');
  });

  it('Graze: nothing to use on a hit', () => {
    const a = arena('greatsword', [15, 3, 3]);
    a.attack();
    const entry = attackEntry(a);
    expect(entry.hit).toBe(true);
    expect(entry.mastery).toBeUndefined();
    expect(rejection(a.use(entry.id))).toBe('rule_violation');
  });

  it('Cleave: a second attack against another creature, without the ability modifier in the damage and without another Cleave', () => {
    // 1º: d20 8 acerta, 1d12 6 +4. 2º: d20 8 acerta, 1d12 6 sem o +4.
    const a = arena('greataxe', [8, 6]);
    a.attack();
    const first = attackEntry(a);
    expect(first.damage?.total).toBe(10);
    expect(first.mastery).toMatchObject({ property: 'cleave', action: 'cleave' });
    expect(rejection(a.use(first.id))).toBe('rule_violation');
    expect(rejection(a.use(first.id, { targetTokenId: a.goblin1 }))).toBe('rule_violation');
    expect(applied(a.use(first.id, { targetTokenId: a.goblin2 }))).toBe(true);
    const second = attackEntry(a);
    expect(second).toMatchObject({ targetTokenId: a.goblin2, hit: true, masteryOf: first.id, visibility: 'public' });
    expect(second.damage).toMatchObject({ bonus: 0, total: 6 });
    expect(second.mastery).toBeUndefined();
    expect(rejection(a.use(second.id, { targetTokenId: a.goblin1 }))).toBe('rule_violation');
    expect(rejection(a.use(first.id, { targetTokenId: a.goblin2 }))).toBe('rule_violation');
  });

  it('Sap is a reminder on the hit, without a follow-up action', () => {
    const a = arena('longsword', [8, 5]);
    a.attack();
    const entry = attackEntry(a);
    expect(entry.mastery?.property).toBe('sap');
    expect(entry.mastery?.action).toBeUndefined();
    expect(entry.mastery?.notes[0]).toContain('Desvantagem');
    expect(rejection(a.use(entry.id))).toBe('rule_violation');
  });

  it('has no mastery without Weapon Mastery in that weapon, and refuses once the weapon is unequipped', () => {
    const none = arena('battleaxe', [8, 5]);
    none.attack();
    expect(attackEntry(none).mastery).toBeUndefined();

    const a = arena('maul', [8, 3, 3, 5]);
    a.attack();
    const entry = attackEntry(a);
    a.session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: a.hero, instanceId: a.weapon, equipped: false } });
    expect(rejection(a.use(entry.id))).toBe('rule_violation');
  });

  it('hides a secret Graze from other players', () => {
    const a = arena('greatsword', [2]);
    a.attack('gm');
    a.use(attackEntry(a).id);
    expect(a.session.viewFor(BRUNO.playerId).chat.at(-1)?.kind).toBe('hidden_roll');
    expect(a.session.viewFor(ANA.playerId).chat.at(-1)?.kind).toBe('mastery_damage');
  });
});

describe('HostSession: combat and initiative', () => {
  const sequence = (values: number[]) => {
    let i = 0;
    return { roll: () => values[i++ % values.length] ?? 1 };
  };
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };

  /** Thorin (personagem da Ana, iniciativa +1 com Vantagem do Remarkable Athlete), dois Goblin Warriors (+2) e um barril (sem bônus) no mapa. */
  function arena(rolls: number[]) {
    const session = setup({
      rng: sequence(rolls),
      monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
      monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    const steps = CharacterSchema.shape.steps.parse(fighter.character.steps);
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium', characterId: hero } });
    for (const [name, x] of [['Goblin 1', 100], ['Goblin 2', 200]] as const) {
      session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name, position: { x, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
    }
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Barril', position: { x: 300, y: 0 }, size: 'medium' } });
    const id = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    return { session, thorin: id('Thorin'), goblin1: id('Goblin 1'), goblin2: id('Goblin 2'), barrel: id('Barril') };
  }
  type Arena = ReturnType<typeof arena>;
  const order = (a: Arena) => a.session.state.combat?.combatants.map((c) => a.session.state.tokens[c.tokenId]?.name) ?? [];
  const current = (a: Arena) => {
    const combat = a.session.state.combat;
    return combat ? a.session.state.tokens[combat.combatants[combat.turn]?.tokenId ?? '']?.name : undefined;
  };
  // Thorin max(10, 4)+1 = 11, Goblin 1 15+2 = 17, Goblin 2 9+2 = 11, Barril 3+0 = 3.
  const start = (a: Arena, who = GM.playerId, surprised?: string[]) =>
    a.session.handle(who, { kind: 'combat.start', data: { tokenIds: [a.thorin, a.goblin1, a.goblin2, a.barrel], ...(surprised ? { surprisedTokenIds: surprised } : {}) } });
  const next = (a: Arena, who = GM.playerId) => a.session.handle(who, { kind: 'combat.next', data: {} });

  it('rolls initiative for every token and orders by initiative, then by the modifier', () => {
    const a = arena([10, 4, 15, 9, 3]);
    expect(rejection(start(a, ANA.playerId))).toBe('not_allowed');
    expect(applied(start(a))).toBe(true);
    expect(order(a)).toEqual(['Goblin 1', 'Goblin 2', 'Thorin', 'Barril']);
    expect(a.session.state.combat).toMatchObject({ round: 1, turn: 0 });
    expect(current(a)).toBe('Goblin 1');
    const [started, rolled] = a.session.state.chat.slice(-2);
    expect(started).toMatchObject({ kind: 'combat_event', event: 'started', round: 1 });
    if (rolled?.kind !== 'initiative_roll') throw new Error('sem iniciativa');
    expect(rolled.results.map((r) => [r.name, r.total])).toEqual([
      ['Thorin', 11],
      ['Goblin 1', 17],
      ['Goblin 2', 11],
      ['Barril', 3],
    ]);
    expect(rolled.results[3]?.notes).toContain('Sem ficha nem bloco de monstro: iniciativa +0');
    expect(rejection(start(a))).toBe('rule_violation');
  });

  it('gives Disadvantage to surprised combatants', () => {
    // Goblin 1 surpreso: 15 e 4, fica o 4.
    const a = arena([10, 4, 15, 4, 9, 3]);
    start(a, GM.playerId, [a.goblin1]);
    const rolled = a.session.state.chat.at(-1);
    if (rolled?.kind !== 'initiative_roll') throw new Error('sem iniciativa');
    expect(rolled.results[1]).toMatchObject({ name: 'Goblin 1', mode: 'disadvantage', dice: [15, 4], total: 6 });
    expect(rolled.results[1]?.notes).toContain('Desvantagem: Surpresa');
  });

  it('shows the order to everyone but hides monster initiative values from players', () => {
    const a = arena([10, 4, 15, 9, 3]);
    const outcome = start(a);
    for (const view of [a.session.viewFor(BRUNO.playerId), a.session.viewFor(ANA.playerId)]) {
      expect(view.combat?.combatants.map((c) => c.initiative)).toEqual([null, null, 11, null]);
      const rolled = view.chat.at(-1);
      if (rolled?.kind !== 'initiative_roll') throw new Error('sem iniciativa');
      expect(rolled.results.map((r) => r.name)).toEqual(['Thorin']);
    }
    expect(a.session.viewFor(GM.playerId).combat?.combatants.map((c) => c.initiative)).toEqual([17, 11, 11, 3]);
    if (!outcome.change) throw new Error('sem mudança');
    const op = a.session.patchFor(outcome.change, BRUNO.playerId).ops.find((o) => o.path === '/combat');
    expect(op && 'value' in op ? op.value : undefined).toMatchObject({ combatants: [{ initiative: null }, { initiative: null }, { initiative: 11 }, { initiative: null }] });
  });

  it('passes the turn, starts a new round after the last one, and lets the player pass only their own turn', () => {
    const a = arena([10, 4, 15, 9, 3]);
    start(a);
    next(a);
    expect(rejection(next(a, ANA.playerId))).toBe('not_allowed');
    next(a);
    expect(current(a)).toBe('Thorin');
    expect(rejection(next(a, BRUNO.playerId))).toBe('not_allowed');
    expect(applied(next(a, ANA.playerId))).toBe(true);
    expect(current(a)).toBe('Barril');
    next(a);
    expect(a.session.state.combat).toMatchObject({ round: 2, turn: 0 });
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'combat_event', event: 'round', round: 2 });
    a.session.handle(GM.playerId, { kind: 'combat.previous', data: {} });
    expect(a.session.state.combat).toMatchObject({ round: 1, turn: 3 });
    expect(rejection(a.session.handle(ANA.playerId, { kind: 'combat.previous', data: {} }))).toBe('not_allowed');
  });

  it('lets the GM override initiative, reordering without changing whose turn it is', () => {
    const a = arena([10, 4, 15, 9, 3]);
    start(a);
    next(a); // vez do Goblin 2
    a.session.handle(GM.playerId, { kind: 'combat.set_initiative', data: { tokenId: a.barrel, initiative: 20 } });
    expect(order(a)).toEqual(['Barril', 'Goblin 1', 'Goblin 2', 'Thorin']);
    expect(current(a)).toBe('Goblin 2');
  });

  it('adds and removes combatants; removing a token from the map takes it out of the combat; the last one out ends it', () => {
    const a = arena([10, 4, 15, 9, 3]);
    a.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [a.thorin, a.goblin1, a.goblin2] } });
    next(a); // vez do Goblin 2
    expect(rejection(a.session.handle(GM.playerId, { kind: 'combat.add', data: { tokenIds: [a.goblin1] } }))).toBe('rule_violation');
    a.session.handle(GM.playerId, { kind: 'combat.add', data: { tokenIds: [a.barrel] } }); // 3 + 0
    expect(order(a)).toEqual(['Goblin 1', 'Goblin 2', 'Thorin', 'Barril']);
    expect(current(a)).toBe('Goblin 2');
    // Sai quem está na vez: passa ao seguinte.
    a.session.handle(GM.playerId, { kind: 'combat.remove', data: { tokenId: a.goblin2 } });
    expect(current(a)).toBe('Thorin');
    a.session.handle(GM.playerId, { kind: 'token.remove', data: { tokenId: a.goblin1 } });
    expect(order(a)).toEqual(['Thorin', 'Barril']);
    expect(current(a)).toBe('Thorin');
    a.session.handle(GM.playerId, { kind: 'combat.remove', data: { tokenId: a.thorin } });
    a.session.handle(GM.playerId, { kind: 'combat.remove', data: { tokenId: a.barrel } });
    expect(a.session.state.combat).toBeNull();
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'combat_event', event: 'ended' });
  });

  it('ends the combat, and refuses turn intents without one', () => {
    const a = arena([10, 4, 15, 9, 3]);
    expect(rejection(next(a))).toBe('rule_violation');
    expect(rejection(a.session.handle(GM.playerId, { kind: 'combat.end', data: {} }))).toBe('rule_violation');
    start(a);
    expect(rejection(a.session.handle(ANA.playerId, { kind: 'combat.end', data: {} }))).toBe('not_allowed');
    expect(applied(a.session.handle(GM.playerId, { kind: 'combat.end', data: {} }))).toBe(true);
    expect(a.session.state.combat).toBeNull();
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'combat_event', event: 'ended', round: 1 });
  });
});

describe('HostSession: conditions', () => {
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };

  /** Thorin (anão: imune a nada, Resistência a veneno), seu token, um Skeleton (imune a Envenenado e Exaustão) e um token da Ana sem personagem. */
  function table() {
    const session = setup({
      monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
      monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Cripta', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    const steps = CharacterSchema.shape.steps.parse(fighter.character.steps);
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium', characterId: hero } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Skeleton 1', position: { x: 100, y: 0 }, size: 'medium', monsterId: 'skeleton' } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Lobo da Ana', position: { x: 200, y: 0 }, size: 'medium', ownerIds: [ANA.playerId] } });
    const id = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    return { session, hero, thorin: id('Thorin'), skeleton: id('Skeleton 1'), wolf: id('Lobo da Ana') };
  }
  type Table = ReturnType<typeof table>;
  const add = (t: Table, target: { characterId: string } | { tokenId: string }, condition: 'prone' | 'poisoned' | 'blinded', who = GM.playerId) =>
    t.session.handle(who, { kind: 'condition.add', data: { target, condition } });

  it('stores the conditions of a character token on the character, and logs the change', () => {
    const t = table();
    expect(applied(add(t, { tokenId: t.thorin }, 'prone', ANA.playerId))).toBe(true);
    expect(t.session.state.characters[t.hero]?.conditions).toEqual({ active: [{ condition: 'prone' }], exhaustion: 0 });
    expect(t.session.state.tokens[t.thorin]?.conditions).toEqual({ active: [], exhaustion: 0 });
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'condition_changed', target: { characterId: t.hero }, targetName: 'Thorin', change: { kind: 'added', condition: 'prone' }, notes: [] });
    expect(rejection(add(t, { characterId: t.hero }, 'prone'))).toBe('rule_violation');
    expect(applied(t.session.handle(ANA.playerId, { kind: 'condition.remove', data: { target: { characterId: t.hero }, condition: 'prone' } }))).toBe(true);
    expect(t.session.state.characters[t.hero]?.conditions.active).toEqual([]);
    expect(rejection(t.session.handle(ANA.playerId, { kind: 'condition.remove', data: { target: { characterId: t.hero }, condition: 'prone' } }))).toBe('rule_violation');
  });

  it('lets players change only their own characters and tokens', () => {
    const t = table();
    expect(rejection(add(t, { characterId: t.hero }, 'blinded', BRUNO.playerId))).toBe('not_allowed');
    expect(rejection(add(t, { tokenId: t.thorin }, 'blinded', BRUNO.playerId))).toBe('not_allowed');
    expect(rejection(add(t, { tokenId: t.skeleton }, 'prone', ANA.playerId))).toBe('not_allowed');
    expect(applied(add(t, { tokenId: t.wolf }, 'prone', ANA.playerId))).toBe(true);
    expect(t.session.state.tokens[t.wolf]?.conditions.active).toEqual([{ condition: 'prone' }]);
    expect(applied(add(t, { tokenId: t.skeleton }, 'prone'))).toBe(true);
  });

  it('respects condition immunities, with a GM override that is logged', () => {
    const t = table();
    // Skeleton: imune a Envenenado e a Exaustão.
    const wolfOwnerTry = t.session.handle(ANA.playerId, { kind: 'condition.add', data: { target: { tokenId: t.wolf }, condition: 'poisoned' } });
    expect(applied(wolfOwnerTry)).toBe(true);
    t.session.handle(GM.playerId, { kind: 'token.create', data: { mapId: Object.keys(t.session.state.maps)[0] ?? '', name: 'Skeleton 2', position: { x: 300, y: 0 }, size: 'medium', monsterId: 'skeleton', ownerIds: [ANA.playerId] } });
    const owned = Object.values(t.session.state.tokens).find((x) => x.name === 'Skeleton 2')?.id ?? '';
    expect(rejection(add(t, { tokenId: owned }, 'poisoned', ANA.playerId))).toBe('rule_violation');
    expect(applied(add(t, { tokenId: t.skeleton }, 'poisoned'))).toBe(true);
    expect(t.session.state.chat.at(-1)).toMatchObject({ notes: ['Skeleton 1 é imune a Envenenado (aplicada pelo mestre)'] });
  });

  it('sets exhaustion levels, feeds the sheet and warns about death at level 6', () => {
    const t = table();
    const speed = (): number | undefined => {
      const character = t.session.state.characters[t.hero];
      return character ? characterSheet(character, compendium).sheet?.speed.walk.total : undefined;
    };
    const before = speed() ?? 0;
    expect(applied(t.session.handle(ANA.playerId, { kind: 'exhaustion.set', data: { target: { tokenId: t.thorin }, level: 2 } }))).toBe(true);
    expect(t.session.state.characters[t.hero]?.conditions.exhaustion).toBe(2);
    expect(speed()).toBe(before - 10);
    expect(t.session.state.chat.at(-1)).toMatchObject({ change: { kind: 'exhaustion', from: 0, to: 2 } });
    expect(rejection(t.session.handle(ANA.playerId, { kind: 'exhaustion.set', data: { target: { tokenId: t.thorin }, level: 2 } }))).toBe('rule_violation');
    t.session.handle(GM.playerId, { kind: 'exhaustion.set', data: { target: { characterId: t.hero }, level: 6 } });
    expect(t.session.state.chat.at(-2)).toMatchObject({ notes: ['Exaustão 6: Thorin morre (SRD)'] });
    // No personagem, a morte entra nas Salvaguardas contra a Morte (nota 0044).
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'death_state', cause: 'exhaustion', deathSaves: { dead: true } });
    expect(t.session.state.characters[t.hero]?.deathSaves.dead).toBe(true);
    // Descer o nível de um imune não esbarra na imunidade.
    t.session.handle(GM.playerId, { kind: 'exhaustion.set', data: { target: { tokenId: t.skeleton }, level: 1 } });
    expect(applied(t.session.handle(GM.playerId, { kind: 'exhaustion.set', data: { target: { tokenId: t.skeleton }, level: 0 } }))).toBe(true);
    expect(t.session.state.chat.at(-1)).toMatchObject({ notes: [] });
  });
});

describe('HostSession: condition effects on rolls', () => {
  const sequence = (values: number[]) => {
    let i = 0;
    return { roll: () => values[i++ % values.length] ?? 1 };
  };
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };

  /** Thorin (espada longa +7) em (0,0), Goblin 1 vizinho (CA 15, ataque +4) e Goblin 2 a 25 ft. */
  function arena(rolls: number[]) {
    const session = setup({
      rng: sequence(rolls),
      itemProblems: () => [],
      monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
      monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    const steps = CharacterSchema.shape.steps.parse(fighter.character.steps);
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps } });
    session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: hero, itemId: 'longsword' } });
    const sword = session.state.characters[hero]?.inventory.items.at(-1)?.instanceId ?? '';
    session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: hero, instanceId: sword, equipped: true } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium', characterId: hero } });
    for (const [name, x] of [['Goblin 1', 100], ['Goblin 2', 600]] as const) {
      session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name, position: { x, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
    }
    const id = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    const condition = (tokenId: string, c: 'prone' | 'paralyzed' | 'poisoned') => session.handle(GM.playerId, { kind: 'condition.add', data: { target: { tokenId }, condition: c } });
    const swing = (targetTokenId: string) => session.handle(ANA.playerId, { kind: 'attack.make', data: { attacker: { characterId: hero, instanceId: sword }, targetTokenId, visibility: 'public' } });
    return { session, hero, thorin: id('Thorin'), goblin1: id('Goblin 1'), goblin2: id('Goblin 2'), condition, swing };
  }
  const lastEntry = (session: HostSession) => session.state.chat.at(-1);

  it('attacks a Prone target with Advantage up close and Disadvantage from afar', () => {
    const a = arena([3, 12, 5, 4, 9]);
    a.condition(a.goblin1, 'prone');
    a.condition(a.goblin2, 'prone');
    a.swing(a.goblin1);
    expect(lastEntry(a.session)).toMatchObject({ kind: 'attack_roll', mode: 'advantage', advantage: ['Caído'], dice: [3, 12], natural: 12 });
    a.swing(a.goblin2);
    expect(lastEntry(a.session)).toMatchObject({ kind: 'attack_roll', mode: 'disadvantage', disadvantage: ['Caído'] });
  });

  it('turns a hit against a Paralyzed target within 5 ft into a Critical Hit', () => {
    // Vantagem (Paralisado): 10 e 8, fica o 10 (+7 = 17 contra CA 15); crítico: 2d8 = 4 + 4, +4.
    const a = arena([10, 8, 4, 4]);
    a.condition(a.goblin1, 'paralyzed');
    a.swing(a.goblin1);
    const entry = lastEntry(a.session);
    if (entry?.kind !== 'attack_roll') throw new Error('sem ataque');
    expect(entry).toMatchObject({ mode: 'advantage', natural: 10, hit: true, critical: true });
    expect(entry.notes).toContain('Acerto Crítico: alvo Paralisado a até 5 ft');
    expect(entry.damage?.groups[0]?.dice).toBe('2d8');
  });

  it('applies the conditions and the exhaustion of the attacking monster', () => {
    const a = arena([15, 6, 3]);
    a.condition(a.goblin1, 'poisoned');
    a.session.handle(GM.playerId, { kind: 'exhaustion.set', data: { target: { tokenId: a.goblin1 }, level: 1 } });
    a.session.handle(GM.playerId, { kind: 'attack.make', data: { attacker: { tokenId: a.goblin1, actionId: 'scimitar' }, targetTokenId: a.thorin, visibility: 'public' } });
    expect(lastEntry(a.session)).toMatchObject({ kind: 'attack_roll', mode: 'disadvantage', disadvantage: ['Envenenado'], modifier: 2, dice: [15, 6], natural: 6 });
  });

  it('applies the character own conditions through the sheet', () => {
    const a = arena([15, 6]);
    a.session.handle(ANA.playerId, { kind: 'condition.add', data: { target: { characterId: a.hero }, condition: 'poisoned' } });
    a.swing(a.goblin2);
    expect(lastEntry(a.session)).toMatchObject({ kind: 'attack_roll', mode: 'disadvantage', disadvantage: ['Envenenado'] });
  });

  it('makes a Paralyzed monster fail DEX saves automatically', () => {
    const a = arena([20]);
    a.condition(a.goblin1, 'paralyzed');
    const fire = { custom: { name: 'Fogo', ability: 'dex' as const, dc: 10, damage: [], onSuccess: 'none' as const } };
    a.session.handle(GM.playerId, { kind: 'save.force', data: { source: fire, targetTokenIds: [a.goblin1], visibility: 'public' } });
    const entry = lastEntry(a.session);
    if (entry?.kind !== 'save_roll') throw new Error('sem salvaguarda');
    expect(entry.results[0]).toMatchObject({ natural: 20, success: false });
    expect(entry.results[0]?.notes).toContain('Falha automática (Paralisado)');
  });
});

describe('HostSession: turn-bound durations and timed masteries', () => {
  const sequence = (values: number[]) => {
    let i = 0;
    return { roll: () => values[i++ % values.length] ?? 1 };
  };
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };
  // Iniciativa: Thorin (Vantagem) 19 e 19 +1 = 20; Goblin 1 5 +2 = 7; Goblin 2 3 +2 = 5. Ordem: Thorin, Goblin 1, Goblin 2.
  const INITIATIVE = [19, 19, 5, 3];

  /** Thorin com maestria em Longsword (Sap), Handaxe (Vex) e Club (Slow), a arma pedida equipada, dois Goblin Warriors vizinhos e o combate começado. */
  function arena(weaponId: string, rolls: number[], startCombat = true) {
    const session = setup({
      rng: sequence([...INITIATIVE, ...rolls]),
      itemProblems: () => [],
      monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
      monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    const raw = JSON.stringify(fighter.character.steps).replace('["longsword","heavy_crossbow","handaxe"]', '["longsword","handaxe","club"]');
    session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(JSON.parse(raw)) } });
    session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: hero, itemId: weaponId } });
    const weapon = session.state.characters[hero]?.inventory.items.at(-1)?.instanceId ?? '';
    session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: hero, instanceId: weapon, equipped: true } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 100, y: 100 }, size: 'medium', characterId: hero } });
    for (const [name, x] of [['Goblin 1', 200], ['Goblin 2', 0]] as const) {
      session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name, position: { x, y: 100 }, size: 'small', monsterId: 'goblin_warrior' } });
    }
    const id = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    const ids = { thorin: id('Thorin'), goblin1: id('Goblin 1'), goblin2: id('Goblin 2') };
    if (startCombat) session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [ids.thorin, ids.goblin1, ids.goblin2] } });
    const swing = (targetTokenId: string) => session.handle(ANA.playerId, { kind: 'attack.make', data: { attacker: { characterId: hero, instanceId: weapon }, targetTokenId, visibility: 'public' } });
    const next = () => session.handle(GM.playerId, { kind: 'combat.next', data: {} });
    return { session, hero, ...ids, swing, next };
  }
  const attackOf = (session: HostSession) => {
    const entry = [...session.state.chat].reverse().find((e) => e.kind === 'attack_roll');
    if (entry?.kind !== 'attack_roll') throw new Error('sem ataque');
    return entry;
  };

  it('ends a condition at the end of the next turn of the chosen combatant', () => {
    const a = arena('longsword', []);
    const current = () => a.session.state.tokens[a.session.state.combat?.combatants[a.session.state.combat.turn]?.tokenId ?? '']?.name;
    expect(current()).toBe('Thorin');
    a.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { tokenId: a.goblin1 }, condition: 'prone', until: { at: 'turn_end', tokenId: a.thorin } } });
    // É a vez do Thorin: o próximo turno dele é o da rodada 2.
    expect(a.session.state.tokens[a.goblin1]?.conditions.active).toEqual([{ condition: 'prone', until: { at: 'turn_end', tokenId: a.thorin, round: 2 } }]);
    a.next();
    a.next();
    a.next(); // rodada 2, vez do Thorin
    expect(a.session.state.tokens[a.goblin1]?.conditions.active).toHaveLength(1);
    a.next(); // fim do turno do Thorin
    expect(a.session.state.tokens[a.goblin1]?.conditions.active).toEqual([]);
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'condition_changed', change: { kind: 'removed', condition: 'prone' }, notes: ['Fim da duração'] });
  });

  it('refuses a turn duration without combat or for someone outside it', () => {
    const a = arena('longsword', [], false);
    const add = () => a.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { tokenId: a.goblin1 }, condition: 'prone', until: { at: 'turn_start', tokenId: a.thorin } } });
    expect(rejection(add())).toBe('rule_violation');
    a.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [a.goblin1] } });
    expect(rejection(add())).toBe('rule_violation');
  });

  it('Sap: the target has Disadvantage on its next attack, then the effect is spent', () => {
    // Thorin: d20 15 (+7) acerta, 1d8 5. Goblin 1: Desvantagem, 10 e 4.
    const a = arena('longsword', [15, 5, 10, 4]);
    a.swing(a.goblin1);
    expect(a.session.state.combat?.effects).toHaveLength(1);
    expect(a.session.state.combat?.effects[0]).toMatchObject({ kind: 'sap', sourceTokenId: a.thorin, targetTokenId: a.goblin1, until: { at: 'turn_start', tokenId: a.thorin, round: 2 } });
    expect(attackOf(a.session).mastery?.notes[0]).toContain('Sap: Goblin 1 tem Desvantagem');
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'timed_effect', event: 'started', effect: 'sap', sourceName: 'Thorin', targetName: 'Goblin 1' });
    a.session.handle(GM.playerId, { kind: 'attack.make', data: { attacker: { tokenId: a.goblin1, actionId: 'scimitar' }, targetTokenId: a.thorin, visibility: 'public' } });
    expect(attackOf(a.session)).toMatchObject({ mode: 'disadvantage', disadvantage: ['Sap (Thorin)'], dice: [10, 4] });
    expect(a.session.state.combat?.effects).toEqual([]);
  });

  it('Sap ends at the start of the next turn of the attacker if unused', () => {
    const a = arena('longsword', [15, 5]);
    a.swing(a.goblin1);
    a.next();
    a.next();
    expect(a.session.state.combat?.effects).toHaveLength(1);
    a.next(); // início do turno do Thorin na rodada 2
    expect(a.session.state.combat?.effects).toEqual([]);
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'timed_effect', event: 'ended', effect: 'sap' });
  });

  it('Vex: Advantage on the next attack of the attacker against that target only', () => {
    // 1º: 15 acerta, 1d6 4. 2º contra o Goblin 2: 12 (sem Vex). 3º contra o Goblin 1: 3 e 16 (Vex).
    const a = arena('handaxe', [15, 4, 12, 4, 3, 16, 4]);
    a.swing(a.goblin1);
    expect(a.session.state.combat?.effects.map((e) => e.kind)).toEqual(['vex']);
    a.swing(a.goblin2);
    expect(attackOf(a.session)).toMatchObject({ mode: 'normal', advantage: [] });
    a.swing(a.goblin1);
    expect(attackOf(a.session)).toMatchObject({ mode: 'advantage', advantage: ['Vex'], dice: [3, 16] });
    expect(a.session.state.combat?.effects.some((e) => e.kind === 'vex' && e.targetTokenId === a.goblin1)).toBe(true);
  });

  it('Slow does not stack on the same target, and leaving the combat ends the effects', () => {
    const a = arena('club', [15, 3, 15, 3]);
    a.swing(a.goblin1);
    a.swing(a.goblin1);
    expect(a.session.state.combat?.effects.filter((e) => e.kind === 'slow')).toHaveLength(1);
    a.session.handle(GM.playerId, { kind: 'combat.remove', data: { tokenId: a.goblin1 } });
    expect(a.session.state.combat?.effects).toEqual([]);
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'timed_effect', event: 'ended', effect: 'slow' });
  });

  it('ends every turn duration when the combat ends', () => {
    const a = arena('longsword', [15, 5]);
    a.swing(a.goblin1);
    a.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { characterId: a.hero }, condition: 'restrained', until: { at: 'turn_end', tokenId: a.goblin2 } } });
    a.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { characterId: a.hero }, condition: 'poisoned' } });
    a.session.handle(GM.playerId, { kind: 'combat.end', data: {} });
    expect(a.session.state.characters[a.hero]?.conditions.active).toEqual([{ condition: 'poisoned' }]);
    expect(a.session.state.chat.slice(-3).map((e) => e.kind)).toEqual(['condition_changed', 'timed_effect', 'combat_event']);
  });
});


describe('HostSession: turn and initiative reminders (note 0043)', () => {
  const sequence = (values: number[]) => {
    let i = 0;
    return { roll: () => values[i++ % values.length] ?? 1 };
  };
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };

  /** Thorin (com os efeitos num ajuste do mestre) e um Goblin Warrior; Thorin rola 19 com Vantagem e vem primeiro. */
  function table(effects: unknown[]) {
    const session = setup({
      rng: sequence([19, 19, 5, 3]),
      itemProblems: () => [],
      monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
      monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    session.handle(ANA.playerId, {
      kind: 'character.update',
      data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(fighter.character.steps) },
    });
    const add = session.handle(GM.playerId, { kind: 'adjustment.add', data: { characterId: hero, name: 'Bênção', effects: effects as never } });
    if (!applied(add)) throw new Error('ajuste recusado');
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 100, y: 100 }, size: 'medium', characterId: hero } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin', position: { x: 300, y: 100 }, size: 'small', monsterId: 'goblin_warrior' } });
    const id = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    const thorin = id('Thorin');
    const goblin = id('Goblin');
    const max = characterSheet(session.state.characters[hero] as SessionCharacter, compendium).sheet?.hpMax.total ?? 0;
    return {
      session,
      hero,
      thorin,
      goblin,
      max,
      start: (tokenIds = [thorin, goblin]) => session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds } }),
      next: () => session.handle(GM.playerId, { kind: 'combat.next', data: {} }),
      damage: (amount: number) => session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: hero }, change: { kind: 'damage', amount } } }),
      triggers: () => session.state.chat.filter((e) => e.kind === 'turn_trigger'),
    };
  }

  it('posts the initiative reminders after the initiative roll, and the turn start ones for the first combatant', () => {
    const t = table([
      { type: 'reminder', on: 'initiative', note: 'Recupera os usos.' },
      { type: 'reminder', on: 'turn_start', note: 'Pode se dar Inspiração.' },
    ]);
    expect(applied(t.start())).toBe(true);
    const kinds = t.session.state.chat.map((e) => e.kind);
    expect(kinds.indexOf('turn_trigger')).toBeGreaterThan(kinds.indexOf('initiative_roll'));
    expect(t.triggers()).toEqual([
      expect.objectContaining({ on: 'initiative', tokenId: t.thorin, name: 'Thorin', items: [{ source: 'Bênção', text: 'Recupera os usos.' }] }),
      expect.objectContaining({ on: 'turn_start', tokenId: t.thorin, items: [{ source: 'Bênção', text: 'Pode se dar Inspiração.' }] }),
    ]);
    // Goblin (sem ficha) não tem lembretes; a vez dele não gera nada.
    t.next();
    expect(t.triggers()).toHaveLength(2);
    // Rodada 2, vez do Thorin: o lembrete do início do turno volta; o da iniciativa, não.
    t.next();
    expect(t.triggers().map((e) => e.on)).toEqual(['initiative', 'turn_start', 'turn_start']);
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('posts the initiative reminders of tokens added to a combat in progress', () => {
    const t = table([{ type: 'reminder', on: 'initiative', note: 'Pode trocar a iniciativa.' }]);
    t.start([t.goblin]);
    expect(t.triggers()).toEqual([]);
    t.session.handle(GM.playerId, { kind: 'combat.add', data: { tokenIds: [t.thorin] } });
    expect(t.triggers()).toEqual([expect.objectContaining({ on: 'initiative', tokenId: t.thorin })]);
  });

  it('Heroic Rally: heals 5 + CON at the start of the turn while Bloodied with at least 1 HP', () => {
    const t = table([{ type: 'turn_start_heal', value: 5, ability: 'con', bloodiedOnly: true }]);
    // Não está Sangrando: nada.
    t.damage(1);
    t.start();
    expect(t.triggers()).toEqual([]);
    expect(t.session.state.characters[t.hero]?.hp.damage).toBe(1);
    // Sangrando: CON 16 (+3), recupera 8 no próximo turno dele.
    const half = Math.ceil(t.max / 2);
    t.damage(half);
    t.next();
    t.next();
    expect(t.session.state.characters[t.hero]?.hp.damage).toBe(1 + half - 8);
    expect(t.triggers()).toEqual([expect.objectContaining({ on: 'turn_start', tokenId: t.thorin, items: [{ source: 'Bênção', healed: 8 }] })]);
  });

  it('Heroic Rally: no healing at 0 HP, and only the hit points actually regained', () => {
    const t = table([{ type: 'turn_start_heal', value: 5, ability: 'con', bloodiedOnly: false }]);
    t.damage(3);
    t.start();
    expect(t.session.state.characters[t.hero]?.hp.damage).toBe(0);
    expect(t.triggers()).toEqual([expect.objectContaining({ items: [{ source: 'Bênção', healed: 3 }] })]);

    const dying = table([{ type: 'turn_start_heal', value: 5, ability: 'con', bloodiedOnly: true }]);
    dying.damage(dying.max);
    dying.start();
    expect(dying.session.state.characters[dying.hero]?.hp.damage).toBe(dying.max);
    expect(dying.triggers()).toEqual([]);
  });

  it('turn end reminders see the state after the durations that just ended', () => {
    const effects = [{ type: 'reminder', on: 'turn_end', note: 'Pode encerrar Envenenado.', when: { hasCondition: 'poisoned' } }];
    const t = table(effects);
    t.start();
    t.next();
    // Na vez do Goblin, Envenenado até o fim do próximo turno do Thorin: termina junto, sem lembrete.
    t.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { characterId: t.hero }, condition: 'poisoned', until: { at: 'turn_end', tokenId: t.thorin } } });
    t.next();
    t.next();
    expect(t.session.state.characters[t.hero]?.conditions.active).toEqual([]);
    expect(t.triggers()).toEqual([]);
    // Envenenado sem duração: o lembrete aparece no fim do turno.
    t.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { characterId: t.hero }, condition: 'poisoned' } });
    t.next();
    t.next();
    expect(t.triggers()).toEqual([expect.objectContaining({ on: 'turn_end', tokenId: t.thorin, items: [{ source: 'Bênção', text: 'Pode encerrar Envenenado.' }] })]);
  });
});

describe('HostSession: death saving throws (note 0044)', () => {
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };
  /** RNG que devolve os valores em ordem e depois 10. */
  const queue = (values: number[]) => ({ roll: () => values.shift() ?? 10 });

  /**
   * Thorin (dwarf-fighter-5) e um Goblin Warrior vizinho. Na iniciativa, Thorin rola 19 e o Goblin 5: com 0 PV o Thorin
   * está Incapacitado, e a Desvantagem anula a Vantagem dele (um dado só).
   */
  function table(rolls: number[] = []) {
    const session = setup({
      rng: queue([19, 5, ...rolls]),
      itemProblems: () => [],
      monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
      monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    session.handle(ANA.playerId, {
      kind: 'character.update',
      data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(fighter.character.steps) },
    });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 100, y: 100 }, size: 'medium', characterId: hero } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin', position: { x: 200, y: 100 }, size: 'small', monsterId: 'goblin_warrior' } });
    const id = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    const thorin = id('Thorin');
    const goblin = id('Goblin');
    const max = characterSheet(session.state.characters[hero] as SessionCharacter, compendium).sheet?.hpMax.total ?? 0;
    const character = () => session.state.characters[hero] as SessionCharacter;
    return {
      session,
      hero,
      thorin,
      goblin,
      max,
      character,
      hp: (kind: 'damage' | 'healing', amount: number, who = GM.playerId) => session.handle(who, { kind: 'hp.change', data: { target: { characterId: hero }, change: { kind, amount } } }),
      start: () => session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [thorin, goblin] } }),
      /** Volta à vez do Thorin (passa pelo Goblin). */
      round: () => {
        session.handle(GM.playerId, { kind: 'combat.next', data: {} });
        session.handle(GM.playerId, { kind: 'combat.next', data: {} });
      },
      saves: () => session.state.chat.filter((e) => e.kind === 'death_save'),
    };
  }

  it('dropping to 0 HP makes the character Unconscious; healing ends it and resets the counts', () => {
    const t = table();
    t.hp('damage', t.max);
    expect(t.character().conditions.active).toEqual([{ condition: 'unconscious' }]);
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'condition_changed', change: { kind: 'added', condition: 'unconscious' }, notes: ['Caiu a 0 PV'] });
    t.hp('damage', 1);
    expect(t.character().deathSaves).toEqual({ successes: 0, failures: 1, stable: false, dead: false });
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'death_state', cause: 'damage', notes: ['Dano com 0 PV: uma falha'] });
    t.hp('healing', 5, ANA.playerId);
    expect(t.character().conditions.active).toEqual([]);
    expect(t.character().deathSaves).toEqual({ successes: 0, failures: 0, stable: false, dead: false });
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('massive damage kills outright', () => {
    const t = table();
    t.hp('damage', t.max * 2);
    expect(t.character().deathSaves.dead).toBe(true);
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'death_state', notes: ['Dano massivo: morte instantânea'] });
  });

  it('the Host rolls the death save at the start of the turn of a dying character', () => {
    // Rodada 1: 12 (sucesso). Rodada 2: 4 (falha).
    const t = table([12, 4]);
    t.hp('damage', t.max);
    t.start();
    expect(t.saves()).toHaveLength(1);
    expect(t.saves()[0]).toMatchObject({ characterId: t.hero, dice: [12], total: 12, outcome: 'success', deathSaves: { successes: 1, failures: 0, stable: false, dead: false } });
    t.round();
    expect(t.saves().at(-1)).toMatchObject({ outcome: 'failure', deathSaves: { successes: 1, failures: 1 } });
    expect(t.character().deathSaves).toEqual({ successes: 1, failures: 1, stable: false, dead: false });
  });

  it('three successes make the character Stable: no more rolls', () => {
    const t = table([15, 15, 15]);
    t.hp('damage', t.max);
    t.start();
    t.round();
    t.round();
    expect(t.character().deathSaves).toEqual({ successes: 0, failures: 0, stable: true, dead: false });
    const last = t.saves().at(-1);
    expect(last?.kind === 'death_save' && last.notes).toContain('Três sucessos: Estável');
    t.round();
    expect(t.saves()).toHaveLength(3);
    // Dano tira o Estável e conta uma falha.
    t.hp('damage', 1);
    expect(t.character().deathSaves).toEqual({ successes: 0, failures: 1, stable: false, dead: false });
  });

  it('a 1 counts two failures; the third failure kills, and the dead are not healed until the GM revives them', () => {
    const t = table([1, 5]);
    t.hp('damage', t.max);
    t.start();
    expect(t.saves().at(-1)).toMatchObject({ outcome: 'two_failures', deathSaves: { failures: 2 } });
    t.round();
    expect(t.character().deathSaves.dead).toBe(true);
    const last = t.saves().at(-1);
    expect(last?.kind === 'death_save' && last.notes).toContain('Três falhas: morto');
    t.round();
    expect(t.saves()).toHaveLength(2);
    expect(rejection(t.hp('healing', 5))).toBe('rule_violation');
    const revive = { kind: 'death.set' as const, data: { characterId: t.hero, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } } };
    expect(rejection(t.session.handle(ANA.playerId, revive))).toBe('not_allowed');
    t.session.handle(GM.playerId, revive);
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'death_state', cause: 'gm' });
    expect(applied(t.hp('healing', 5))).toBe(true);
  });

  it('a 20 regains 1 HP and ends Unconscious', () => {
    const t = table([20]);
    t.hp('damage', t.max);
    t.start();
    expect(t.saves().at(-1)).toMatchObject({ outcome: 'revived', deathSaves: { successes: 0, failures: 0 } });
    expect(t.character().hp.damage).toBe(t.max - 1);
    expect(t.character().conditions.active).toEqual([]);
  });

  it('damage from a Critical Hit at 0 HP counts two failures', () => {
    // Thorin falha a salvaguarda (3); o Goblin vizinho ataca o Thorin Inconsciente (Vantagem; acerto a até 5 ft é crítico).
    const t = table([3, 20, 20, 4, 4]);
    t.hp('damage', t.max);
    t.start();
    t.session.handle(GM.playerId, { kind: 'combat.next', data: {} });
    t.session.handle(GM.playerId, { kind: 'attack.make', data: { attacker: { tokenId: t.goblin, actionId: 'scimitar' }, targetTokenId: t.thorin, visibility: 'public' } });
    const proposalId = Object.keys(t.session.state.proposals)[0] ?? '';
    expect(applied(t.session.handle(GM.playerId, { kind: 'damage.apply', data: { proposalId } }))).toBe(true);
    expect(t.character().deathSaves).toEqual({ successes: 0, failures: 3, stable: false, dead: true });
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'death_state', notes: ['Três falhas: morto'] });
  });

  it('a death save rolled from the sheet counts outside combat, and is refused in combat', () => {
    const t = table();
    t.hp('damage', t.max);
    const rollSave = () => t.session.handle(ANA.playerId, { kind: 'roll.d20', data: { characterId: t.hero, target: { kind: 'death_save' }, visibility: 'public' } });
    // Fora do combate a fila começa nos valores da iniciativa: 19.
    expect(applied(rollSave())).toBe(true);
    expect(t.saves().at(-1)).toMatchObject({ outcome: 'success', deathSaves: { successes: 1 } });
    t.start();
    expect(rejection(rollSave())).toBe('rule_violation');
    // Sem estar morrendo, é uma rolagem comum.
    t.hp('healing', 3);
    expect(applied(rollSave())).toBe(true);
    expect(t.session.state.chat.at(-1)?.kind).toBe('d20_roll');
  });
});

describe('HostSession: concentration (note 0045)', () => {
  const ranger = gnomeRanger as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };
  /** RNG que devolve os valores em ordem e depois 10. */
  const queue = (values: number[]) => ({ roll: () => values.shift() ?? 10 });

  /** Ranger de referência da Ana (Hunter's Mark) e, opcionalmente, ajustes do mestre. */
  function table(rolls: number[] = [], effects: unknown[] = []) {
    const session = setup({ rng: queue(rolls), itemProblems: () => [] });
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Nim' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    session.handle(ANA.playerId, {
      kind: 'character.update',
      data: { characterId: hero, baseScores: ranger.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(ranger.character.steps) },
    });
    if (effects.length > 0) session.handle(GM.playerId, { kind: 'adjustment.add', data: { characterId: hero, name: 'Bênção', effects: effects as never } });
    const sheet = characterSheet(session.state.characters[hero] as SessionCharacter, compendium).sheet;
    if (!sheet) throw new Error('sem ficha');
    const character = () => session.state.characters[hero] as SessionCharacter;
    return {
      session,
      hero,
      sheet,
      character,
      concentrate: (spellId: string, who = ANA.playerId) => session.handle(who, { kind: 'concentration.set', data: { characterId: hero, spellId } }),
      damage: (amount: number) => session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: hero }, change: { kind: 'damage', amount } } }),
      last: (kind: string) => [...session.state.chat].reverse().find((e) => e.kind === kind),
    };
  }

  it("concentrates on a spell of the sheet that requires Concentration; another one replaces it", () => {
    const t = table();
    const other = t.sheet.spellcasting.concentration.find((id) => id !== 'hunters_mark');
    const plain = [...t.sheet.spellcasting.classes.flatMap((c) => c.spells)].find((id) => !t.sheet.spellcasting.concentration.includes(id));
    if (plain) expect(rejection(t.concentrate(plain))).toBe('rule_violation');
    expect(rejection(t.concentrate('haste'))).toBe('rule_violation');
    expect(rejection(t.concentrate('hunters_mark', BRUNO.playerId))).toBe('not_allowed');
    expect(applied(t.concentrate('hunters_mark'))).toBe(true);
    expect(t.character().concentration).toEqual({ spellId: 'hunters_mark', name: "Hunter's Mark" });
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'concentration', event: 'started', spellName: "Hunter's Mark" });
    expect(rejection(t.concentrate('hunters_mark'))).toBe('rule_violation');
    if (other) {
      t.concentrate(other);
      expect(t.session.state.chat.slice(-2)).toMatchObject([
        { kind: 'concentration', event: 'ended', reason: 'replaced', spellName: "Hunter's Mark" },
        { kind: 'concentration', event: 'started' },
      ]);
    }
    t.session.handle(ANA.playerId, { kind: 'concentration.end', data: { characterId: t.hero } });
    expect(t.character().concentration).toBeNull();
    expect(t.last('concentration')).toMatchObject({ event: 'ended', reason: 'ended' });
    expect(rejection(t.session.handle(ANA.playerId, { kind: 'concentration.end', data: { characterId: t.hero } }))).toBe('rule_violation');
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('damage asks for a Constitution save: DC 10 or half the damage; failing ends the Concentration', () => {
    // 15 passa na CD 10; 2 falha na CD 15 (30 de dano).
    const t = table([15, 2]);
    t.concentrate('hunters_mark');
    t.damage(5);
    expect(t.last('concentration_save')).toMatchObject({ dc: 10, dice: [15], success: true, spellName: "Hunter's Mark" });
    expect(t.character().concentration).not.toBeNull();
    t.damage(30);
    expect(t.last('concentration_save')).toMatchObject({ dc: 15, dice: [2], success: false });
    expect(t.character().concentration).toBeNull();
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'concentration', event: 'ended', reason: 'failed_save' });
  });

  it('dropping to 0 HP (Unconscious) ends it without a save', () => {
    const t = table();
    t.concentrate('hunters_mark');
    t.damage(t.sheet.hpMax.total);
    expect(t.character().conditions.active).toEqual([{ condition: 'unconscious' }]);
    expect(t.character().concentration).toBeNull();
    expect(t.session.state.chat.filter((e) => e.kind === 'concentration_save')).toEqual([]);
    expect(t.last('concentration')).toMatchObject({ event: 'ended', reason: 'incapacitated' });
    // Dano massivo: morto.
    const dead = table();
    dead.concentrate('hunters_mark');
    dead.damage(dead.sheet.hpMax.total * 2);
    expect(dead.last('concentration')).toMatchObject({ event: 'ended', reason: 'dead' });
  });

  it('Incapacitated (or a condition that includes it) and death end it', () => {
    const t = table();
    t.concentrate('hunters_mark');
    t.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { characterId: t.hero }, condition: 'stunned' } });
    expect(t.character().concentration).toBeNull();
    expect(t.last('concentration')).toMatchObject({ event: 'ended', reason: 'incapacitated' });
    expect(rejection(t.concentrate('hunters_mark'))).toBe('rule_violation');
    t.session.handle(GM.playerId, { kind: 'condition.remove', data: { target: { characterId: t.hero }, condition: 'stunned' } });
    t.concentrate('hunters_mark');
    t.session.handle(GM.playerId, { kind: 'exhaustion.set', data: { target: { characterId: t.hero }, level: 6 } });
    expect(t.last('concentration')).toMatchObject({ event: 'ended', reason: 'dead' });
  });

  it('keep_concentration (Relentless Hunter): damage keeps it without a save', () => {
    const t = table([], [{ type: 'keep_concentration', spellId: 'hunters_mark' }]);
    t.concentrate('hunters_mark');
    t.damage(10);
    expect(t.character().concentration).not.toBeNull();
    expect(t.session.state.chat.filter((e) => e.kind === 'concentration_save')).toEqual([]);
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'concentration', event: 'kept' });
  });

  it('advantage to maintain Concentration applies on the save (Eldritch Mind)', () => {
    const t = table([3, 14], [{ type: 'advantage', target: 'save.con', when: { against: { concentration: true } } }]);
    t.concentrate('hunters_mark');
    t.damage(4);
    expect(t.last('concentration_save')).toMatchObject({ mode: 'advantage', dice: [3, 14], success: true, advantage: ['Bênção'] });
  });
});

describe('HostSession: rests and Hit Point Dice (note 0050)', () => {
  const fighter = dwarfFighter as { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };
  /** RNG que devolve os valores em ordem e depois 10. */
  const queue = (values: number[]) => ({ roll: () => values.shift() ?? 10 });

  /** Thorin (dwarf-fighter-5: 5d10 de vida, CON +3) da Ana, com token num mapa. */
  function table(rolls: number[] = []) {
    const session = setup({ rng: queue(rolls), itemProblems: () => [] });
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    session.handle(ANA.playerId, {
      kind: 'character.update',
      data: { characterId: hero, baseScores: fighter.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(fighter.character.steps) },
    });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 100, y: 100 }, size: 'medium', characterId: hero } });
    const thorin = Object.keys(session.state.tokens)[0] ?? '';
    const character = () => session.state.characters[hero] as SessionCharacter;
    return {
      session,
      hero,
      thorin,
      character,
      start: (kind: 'short' | 'long', who = GM.playerId) => session.handle(who, { kind: 'rest.start', data: { kind, characterIds: [hero] } }),
      finish: () => session.handle(GM.playerId, { kind: 'rest.finish', data: {} }),
      spend: (die: 6 | 8 | 10 | 12 = 10) => session.handle(ANA.playerId, { kind: 'hit_dice.spend', data: { characterId: hero, die } }),
      damage: (amount: number) => session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: hero }, change: { kind: 'damage', amount } } }),
    };
  }

  it('only the GM starts a rest, outside combat and with at least 1 HP', () => {
    const t = table();
    expect(rejection(t.start('short', ANA.playerId))).toBe('not_allowed');
    t.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [t.thorin] } });
    expect(rejection(t.start('short'))).toBe('rule_violation');
    t.session.handle(GM.playerId, { kind: 'combat.end', data: {} });
    t.damage(500);
    expect(rejection(t.start('long'))).toBe('rule_violation');
    t.session.handle(GM.playerId, { kind: 'death.set', data: { characterId: t.hero, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } } });
    t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: t.hero }, change: { kind: 'healing', amount: 1 } } });
    expect(applied(t.start('short'))).toBe(true);
    expect(t.session.state.rest).toEqual({ kind: 'short', characterIds: [t.hero] });
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'rest', event: 'started', rest: 'short', characters: [{ characterId: t.hero, name: 'Thorin' }] });
    expect(rejection(t.start('long'))).toBe('rule_violation');
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('spends Hit Point Dice one by one in a Short Rest: the roll plus CON, at least 1', () => {
    const t = table([7, 1, 4, 4, 4]);
    expect(rejection(t.spend())).toBe('rule_violation');
    t.damage(30);
    t.start('short');
    expect(applied(t.spend())).toBe(true);
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'hit_die', die: 10, roll: 7, conModifier: 3, healed: 10 });
    expect(t.character().hp.damage).toBe(20);
    expect(t.character().hitDiceSpent).toEqual({ '10': 1 });
    t.spend();
    expect(t.session.state.chat.filter((e) => e.kind === 'hit_die').at(-1)).toMatchObject({ roll: 1, healed: 4 });
    expect(rejection(t.spend(8))).toBe('rule_violation');
    t.spend();
    t.spend();
    t.spend();
    expect(t.character().hitDiceSpent).toEqual({ '10': 5 });
    expect(rejection(t.spend())).toBe('rule_violation');
    // O descanso curto não devolve os Dados de Vida.
    t.finish();
    expect(t.session.state.rest).toBeNull();
    expect(t.character().hitDiceSpent).toEqual({ '10': 5 });
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'rest', event: 'finished', rest: 'short' });
  });

  it('a Long Rest restores HP and every Hit Point Die and lowers Exhaustion by 1', () => {
    const t = table([5]);
    t.damage(25);
    t.start('short');
    t.spend();
    t.finish();
    t.session.handle(GM.playerId, { kind: 'exhaustion.set', data: { target: { characterId: t.hero }, level: 2 } });
    t.start('long');
    t.finish();
    expect(t.character().hp.damage).toBe(0);
    expect(t.character().hitDiceSpent).toEqual({});
    expect(t.character().conditions.exhaustion).toBe(1);
    const last = t.session.state.chat.at(-1);
    expect(last).toMatchObject({ kind: 'rest', event: 'finished', rest: 'long' });
    expect(last?.kind === 'rest' && last.notes[0]).toBe('Thorin: PV cheios (+17), 1 Dado(s) de Vida, Exaustão 2 → 1');
  });

  it('damage takes the character out of the rest; rolling Initiative interrupts it for everyone', () => {
    const t = table();
    t.start('long');
    t.damage(3);
    expect(t.session.state.rest).toBeNull();
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'rest', event: 'interrupted', notes: ['Sofreu dano: o descanso não vale'] });
    expect(rejection(t.finish())).toBe('rule_violation');

    t.start('short');
    t.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [t.thorin] } });
    expect(t.session.state.rest).toBeNull();
    expect(t.session.state.chat.find((e) => e.kind === 'rest' && e.event === 'interrupted' && e.notes.includes('Rolaram a iniciativa'))).toBeDefined();
  });

  it('the GM cancels a rest without benefits', () => {
    const t = table();
    t.damage(10);
    t.start('long');
    t.session.handle(GM.playerId, { kind: 'rest.cancel', data: {} });
    expect(t.session.state.rest).toBeNull();
    expect(t.character().hp.damage).toBe(10);
    expect(rejection(t.session.handle(GM.playerId, { kind: 'rest.cancel', data: {} }))).toBe('rule_violation');
  });
});

describe('HostSession: spell slots (note 0051)', () => {
  type Fixture = { character: { baseScores: SessionCharacter['baseScores']; steps: SessionCharacter['steps'] } };

  /** Um conjurador de referência da Ana. */
  function caster(fixture: Fixture) {
    const session = setup({ itemProblems: () => [] });
    session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Conjurador' } });
    const hero = Object.keys(session.state.characters)[0] ?? '';
    session.handle(ANA.playerId, {
      kind: 'character.update',
      data: { characterId: hero, baseScores: fixture.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(fixture.character.steps) },
    });
    const sheet = characterSheet(session.state.characters[hero] as SessionCharacter, compendium).sheet;
    if (!sheet) throw new Error('sem ficha');
    const slot = (kind: 'spell_slot.spend' | 'spell_slot.restore', s: { level: number } | 'pact', who = ANA.playerId) =>
      session.handle(who, { kind, data: { characterId: hero, slot: s } });
    const rest = (kind: 'short' | 'long') => {
      session.handle(GM.playerId, { kind: 'rest.start', data: { kind, characterIds: [hero] } });
      session.handle(GM.playerId, { kind: 'rest.finish', data: {} });
    };
    return { session, hero, sheet, slot, rest, spent: () => (session.state.characters[hero] as SessionCharacter).spellSlotsSpent };
  }

  it('spends and restores slots of each level, as the sheet allows', () => {
    const w = caster(elfWizard as Fixture);
    const first = w.sheet.spellcasting.slots[0] ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(applied(w.slot('spell_slot.spend', { level: 1 }))).toBe(true);
    expect(w.spent()).toEqual({ byLevel: { '1': 1 }, pact: 0 });
    expect(w.session.state.chat.at(-1)).toMatchObject({ kind: 'spell_slot', event: 'spent', slot: { level: 1 }, available: first - 1, total: first });
    for (let i = 1; i < first; i++) w.slot('spell_slot.spend', { level: 1 });
    expect(rejection(w.slot('spell_slot.spend', { level: 1 }))).toBe('rule_violation');
    expect(rejection(w.slot('spell_slot.spend', { level: 9 }))).toBe('rule_violation');
    expect(rejection(w.slot('spell_slot.spend', 'pact'))).toBe('rule_violation');
    expect(rejection(w.slot('spell_slot.spend', { level: 2 }, BRUNO.playerId))).toBe('not_allowed');
    w.slot('spell_slot.restore', { level: 1 });
    expect(w.spent()).toEqual({ byLevel: { '1': first - 1 }, pact: 0 });
    expect(rejection(w.slot('spell_slot.restore', { level: 2 }))).toBe('rule_violation');
    expect(SessionStateSchema.safeParse(w.session.state).success).toBe(true);
  });

  it('a Long Rest restores every slot; a Short Rest does not', () => {
    const w = caster(elfWizard as Fixture);
    w.slot('spell_slot.spend', { level: 1 });
    w.slot('spell_slot.spend', { level: 2 });
    w.rest('short');
    expect(w.spent()).toEqual({ byLevel: { '1': 1, '2': 1 }, pact: 0 });
    w.rest('long');
    expect(w.spent()).toEqual({ byLevel: {}, pact: 0 });
    const last = w.session.state.chat.at(-1);
    expect(last?.kind === 'rest' && last.notes.join(' ')).toContain('2 espaço(s) de magia');
  });

  it('Pact Magic slots come back on a Short Rest', () => {
    const k = caster(goliathWarlock as Fixture);
    const pact = k.sheet.spellcasting.pactSlots;
    expect(pact?.count).toBeGreaterThan(0);
    expect(applied(k.slot('spell_slot.spend', 'pact'))).toBe(true);
    expect(k.session.state.chat.at(-1)).toMatchObject({ kind: 'spell_slot', slot: 'pact', total: pact?.count });
    expect(rejection(k.slot('spell_slot.spend', { level: 1 }))).toBe('rule_violation');
    k.rest('short');
    expect(k.spent()).toEqual({ byLevel: {}, pact: 0 });
  });
});
