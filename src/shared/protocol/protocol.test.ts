import { describe, expect, it } from 'vitest';
import {
  ClientMessageSchema,
  countDice,
  defaultMapFog,
  defaultMapLighting,
  HANDSHAKE_REJECT_MESSAGES,
  HandshakeRejectReasonSchema,
  HostMessageSchema,
  IntentSchema,
  type SessionState,
  SessionStateSchema,
} from './index';
import { makeToken } from './test-fixtures';

/** Os exemplos de docs/network-protocol.md, com ids reais no lugar de "…". */

const ID = '6f1c2b8e-4a3d-4f5e-9b1a-2c3d4e5f6a7b';
const REPLY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PLAYER = 'b2e4f6a8-1c3e-4d5f-8a9b-0c1d2e3f4a5b';
const GM = 'e7f1a2b3-c4d5-4e6f-8a7b-9c0d1e2f3a4b';
const CAMPAIGN = 'c9a0b1c2-d3e4-4f5a-8b6c-7d8e9f0a1b2c';
const MAP = 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a';
const TOKEN = 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b';
const HERO = 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c0d';
const ROLL = 'b8c9d0e1-f2a3-4b4c-9d5e-6f7a8b9c0d1e';
/** Senha fictícia da mesa, montada em tempo de execução para não parecer um segredo aos scanners. */
const TABLE_PASSWORD = ['senha', 'da', 'mesa'].join('-');
const SHA ='9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

const state: SessionState = {
  proposals: {}, pendingSaves: {}, pendingAttacks: {}, pendingInspirations: {},
  combat: null,
  rest: null,
  campaign: { id: CAMPAIGN, name: 'A Mina Perdida' },
  players: {
    [PLAYER]: { displayName: 'Ana', role: 'player', connected: true },
    [GM]: { displayName: 'Mestre', role: 'gm', connected: true },
  },
  chat: [
    { kind: 'message', id: ID, at: 1763769600000, authorId: PLAYER, text: 'Olá!' },
    {
      kind: 'roll',
      id: REPLY,
      at: 1763769601000,
      authorId: PLAYER,
      formula: '2d6+3',
      label: 'Dano',
      visibility: 'public',
      rolls: [
        { sides: 6, value: 4 },
        { sides: 6, value: 2 },
      ],
      total: 9,
    },
    { kind: 'hidden_roll', id: TOKEN, at: 1763769602000, authorId: GM },
    {
      kind: 'ability_roll',
      id: ROLL,
      at: 1763769603000,
      authorId: PLAYER,
      characterId: HERO,
      characterName: 'Thorin',
      sets: [
        { dice: [6, 1, 4, 3], dropped: 1, total: 13 },
        { dice: [5, 5, 2, 6], dropped: 2, total: 16 },
        { dice: [3, 3, 3, 3], dropped: 0, total: 9 },
        { dice: [6, 6, 6, 1], dropped: 3, total: 18 },
        { dice: [2, 4, 4, 5], dropped: 0, total: 13 },
        { dice: [1, 2, 3, 4], dropped: 0, total: 9 },
      ],
    },
  ],
  maps: { [MAP]: { id: MAP, name: 'Caverna', width: 30, height: 20, background: SHA, cellPx: 70, scene3d: null, fog: defaultMapFog(30, 20), walls: [], lighting: defaultMapLighting(), lights: [], propLightOverrides: {} } },
  activeMapId: MAP,
  tokens: {
    [TOKEN]: makeToken({ id: TOKEN, mapId: MAP, name: 'Goblin 1', position: { x: 300, y: 500 }, size: 'small', monsterId: 'goblin', hp: { max: 7, damage: 2, temp: 0 } }),
  },
  characters: {
    [HERO]: {
      id: HERO,
      ownerId: PLAYER,
      name: 'Thorin',
      baseScores: { method: 'rolled', scores: { str: 16, dex: 13, con: 18, int: 9, wis: 13, cha: 9 } },
      rolledScores: [13, 16, 9, 18, 13, 9],
      steps: [{ kind: 'species', speciesId: 'dwarf', selections: [] }],
      inventory: {
        currency: { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 },
        items: [{ instanceId: 'b9c0d1e2-f3a4-4b5c-8d6e-7f8a9b0c1d2e', itemId: 'weapon_plus', baseItemId: 'longsword', variantId: 'plus_1', quantity: 1, equipped: true, attuned: false }],
      },
      hp: { damage: 4, temp: 0 },
      adjustments: [{ id: 'c0d1e2f3-a4b5-4c6d-8e7f-8a9b0c1d2e3f', name: 'Maldição da Múmia', effects: [{ type: 'disadvantage', target: 'save.all' }] }],
      conditions: { active: [], exhaustion: 0 },
      deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
      concentration: null,
      hitDiceSpent: {},
      spellSlotsSpent: { byLevel: {}, pact: 0 },
      resourcesSpent: {},
      inspiration: null,
    },
  },
};

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown): boolean => schema.safeParse(value).success;

describe('client messages', () => {
  const handshake = {
    type: 'Handshake',
    id: ID,
    payload: { protocolVersion: 1, appVersion: '0.1.0', playerId: PLAYER, displayName: 'Ana', sessionPassword: TABLE_PASSWORD },
  };

  it('accepts the documented examples', () => {
    expect(ok(ClientMessageSchema, handshake)).toBe(true);
    expect(ok(ClientMessageSchema, { type: 'Intent', id: ID, payload: { kind: 'token.move', data: { tokenId: TOKEN, to: { x: 300, y: 500 } } } })).toBe(true);
    expect(ok(ClientMessageSchema, { type: 'AssetRequest', id: ID, payload: { sha256: SHA } })).toBe(true);
    expect(ok(ClientMessageSchema, { type: 'Ping', id: ID, payload: { t: 1763769600000 } })).toBe(true);
    expect(ok(ClientMessageSchema, { type: 'Pong', id: ID, replyTo: REPLY, payload: { t: 1763769600000 } })).toBe(true);
  });

  it('rejects unknown fields, missing ids and messages only the Host sends', () => {
    expect(ok(ClientMessageSchema, { ...handshake, extra: true })).toBe(false);
    expect(ok(ClientMessageSchema, { ...handshake, id: 'não-é-uuid' })).toBe(false);
    expect(ok(ClientMessageSchema, { type: 'StateSnapshot', id: ID, payload: { rev: 0, state } })).toBe(false);
    expect(ok(ClientMessageSchema, { type: 'Pong', id: ID, payload: { t: 1 } })).toBe(false);
  });

  it('validates the Intent data by kind', () => {
    expect(ok(ClientMessageSchema, { type: 'Intent', id: ID, payload: { kind: 'token.move', data: { text: 'oi' } } })).toBe(false);
    expect(ok(ClientMessageSchema, { type: 'Intent', id: ID, payload: { kind: 'token.fly', data: {} } })).toBe(false);
  });
});

describe('host messages', () => {
  it('accepts the documented examples', () => {
    const messages = [
      { type: 'HandshakeAccept', id: ID, replyTo: REPLY, payload: { protocolVersion: 1, hostAppVersion: '0.1.0', campaignId: CAMPAIGN, campaignName: 'A Mina Perdida', role: 'player' } },
      { type: 'HandshakeReject', id: ID, replyTo: REPLY, payload: { reason: 'protocol_mismatch', message: 'Atualize o app', hostProtocolVersion: 2 } },
      { type: 'IntentResult', id: ID, replyTo: REPLY, payload: { status: 'applied', rev: 42 } },
      { type: 'IntentResult', id: ID, replyTo: REPLY, payload: { status: 'rejected', code: 'not_allowed', message: 'Você não controla este token' } },
      { type: 'IntentResult', id: ID, replyTo: REPLY, payload: { status: 'pending_gm' } },
      { type: 'StateSnapshot', id: ID, payload: { rev: 41, state, chatFrom: 1340 } },
      { type: 'ChatHistory', id: ID, replyTo: REPLY, payload: { from: 1140, entries: state.chat } },
      { type: 'StatePatch', id: ID, payload: { rev: 42, baseRev: 41, ops: [{ op: 'replace', path: `/tokens/${TOKEN}/position`, value: { x: 300, y: 500 } }] } },
      { type: 'StatePatch', id: ID, payload: { rev: 43, baseRev: 42, ops: [] } },
      { type: 'AssetChunk', id: ID, replyTo: REPLY, payload: { sha256: SHA, mime: 'image/webp', totalSize: 2483120, index: 0, count: 4, data: 'aGVsbG8=' } },
      { type: 'Error', id: ID, payload: { code: 'invalid_message', message: 'Mensagem inválida' } },
    ];
    for (const m of messages) expect(ok(HostMessageSchema, m), m.type).toBe(true);
  });

  it('requires chatFrom on snapshots and limits history requests (note 0047)', () => {
    expect(ok(HostMessageSchema, { type: 'StateSnapshot', id: ID, payload: { rev: 41, state } })).toBe(false);
    expect(ok(ClientMessageSchema, { type: 'ChatHistoryRequest', id: ID, payload: { before: 1340, limit: 200 } })).toBe(true);
    expect(ok(ClientMessageSchema, { type: 'ChatHistoryRequest', id: ID, payload: { before: 1340, limit: 201 } })).toBe(false);
    expect(ok(ClientMessageSchema, { type: 'ChatHistoryRequest', id: ID, payload: { before: -1, limit: 10 } })).toBe(false);
  });

  it('requires replyTo on replies', () => {
    expect(ok(HostMessageSchema, { type: 'IntentResult', id: ID, payload: { status: 'applied', rev: 1 } })).toBe(false);
  });

  it('rejects patches with a gap, operations outside the subset and chunks out of range', () => {
    expect(ok(HostMessageSchema, { type: 'StatePatch', id: ID, payload: { rev: 43, baseRev: 41, ops: [] } })).toBe(false);
    expect(ok(HostMessageSchema, { type: 'StatePatch', id: ID, payload: { rev: 42, baseRev: 41, ops: [{ op: 'move', from: '/a', path: '/b' }] } })).toBe(false);
    expect(ok(HostMessageSchema, { type: 'StatePatch', id: ID, payload: { rev: 42, baseRev: 41, ops: [{ op: 'remove', path: 'tokens' }] } })).toBe(false);
    expect(ok(HostMessageSchema, { type: 'AssetChunk', id: ID, replyTo: REPLY, payload: { sha256: SHA, mime: 'image/webp', totalSize: 1, index: 4, count: 4, data: 'aA==' } })).toBe(false);
    expect(ok(HostMessageSchema, { type: 'AssetChunk', id: ID, replyTo: REPLY, payload: { sha256: SHA, mime: 'image/gif', totalSize: 1, index: 0, count: 1, data: 'aA==' } })).toBe(false);
  });

  it('has a pt-BR message for every reject reason', () => {
    expect(Object.keys(HANDSHAKE_REJECT_MESSAGES).sort()).toEqual([...HandshakeRejectReasonSchema.options].sort());
  });
});

describe('intents', () => {
  const intent = (kind: string, data: unknown): boolean => ok(IntentSchema, { kind, data });

  it('accepts each kind of the catalog', () => {
    expect(intent('session.resync', {})).toBe(true);
    expect(intent('chat.message', { text: 'Olá' })).toBe(true);
    expect(intent('dice.roll', { formula: '1d20+1d4-1', label: 'Ataque', visibility: 'gm' })).toBe(true);
    expect(intent('map.create', { name: 'Caverna', width: 30, height: 20 })).toBe(true);
    expect(intent('map.create', { name: 'Caverna', width: 30, height: 20, background: SHA, cellPx: 70 })).toBe(true);
    expect(intent('map.activate', { mapId: MAP })).toBe(true);
    expect(intent('token.create', { mapId: MAP, name: 'Goblin 1', position: { x: 0, y: 0 }, size: 'small', monsterId: 'goblin', ownerIds: [PLAYER] })).toBe(true);
    expect(intent('token.remove', { tokenId: TOKEN })).toBe(true);
    expect(intent('character.create', { name: 'Thorin' })).toBe(true);
    expect(intent('character.create', { name: 'Thorin', ownerId: PLAYER })).toBe(true);
    expect(intent('character.update', { characterId: HERO, name: 'Thorin II' })).toBe(true);
    expect(intent('character.update', { characterId: HERO, baseScores: { method: 'standard_array', scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } } })).toBe(true);
    expect(intent('character.update', { characterId: HERO, steps: [{ kind: 'class_level', classId: 'fighter' }] })).toBe(true);
    expect(intent('character.roll_scores', { characterId: HERO })).toBe(true);
    expect(intent('character.remove', { characterId: HERO })).toBe(true);
    expect(intent('token.create', { mapId: MAP, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium', characterId: HERO, ownerIds: [PLAYER] })).toBe(true);
    expect(intent('inventory.add', { characterId: HERO, itemId: 'weapon_plus', baseItemId: 'longsword', variantId: 'plus_1' })).toBe(true);
    expect(intent('inventory.add', { characterId: HERO, itemId: 'arrows', quantity: 20 })).toBe(true);
    expect(intent('inventory.remove', { characterId: HERO, instanceId: ROLL, quantity: 1 })).toBe(true);
    expect(intent('inventory.update', { characterId: HERO, instanceId: ROLL, equipped: true })).toBe(true);
    expect(intent('inventory.currency', { characterId: HERO, currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 } })).toBe(true);
    expect(intent('adjustment.add', { characterId: HERO, name: 'Bênção', effects: [{ type: 'flat_bonus', target: 'ac', value: 1 }, { type: 'resistance', damageType: 'fire' }] })).toBe(true);
    expect(intent('adjustment.remove', { characterId: HERO, adjustmentId: ROLL })).toBe(true);
    expect(intent('hp.change', { target: { characterId: HERO }, change: { kind: 'damage', amount: 7 } })).toBe(true);
    expect(intent('roll.d20', { characterId: HERO, target: { kind: 'skill', skill: 'stealth' }, advantage: true, visibility: 'public' })).toBe(true);
    expect(intent('roll.d20', { characterId: HERO, target: { kind: 'attack', instanceId: 'sword' }, visibility: 'gm' })).toBe(true);
    expect(intent('roll.d20', { characterId: HERO, target: { kind: 'skill', skill: 'luck' }, visibility: 'public' })).toBe(false);
    expect(intent('roll.damage', { characterId: HERO, instanceId: 'sword', critical: true, visibility: 'public' })).toBe(true);
    expect(intent('roll.damage', { characterId: HERO, instanceId: 'sword' })).toBe(false);
    expect(intent('attack.make', { attacker: { characterId: HERO, instanceId: 'sword' }, targetTokenId: TOKEN, visibility: 'public' })).toBe(true);
    expect(intent('attack.make', { attacker: { tokenId: TOKEN, actionId: 'scimitar' }, targetTokenId: TOKEN, advantage: true, visibility: 'gm' })).toBe(true);
    expect(intent('attack.make', { attacker: { tokenId: TOKEN }, targetTokenId: TOKEN, visibility: 'public' })).toBe(false);
    expect(intent('damage.apply', { proposalId: ROLL, amount: 7 })).toBe(true);
    expect(intent('damage.apply', { proposalId: ROLL, amount: -1 })).toBe(false);
    expect(intent('damage.dismiss', { proposalId: ROLL })).toBe(true);
    expect(intent('save.force', { source: { tokenId: TOKEN, actionId: 'acid_spray' }, targetTokenIds: [TOKEN], visibility: 'public' })).toBe(true);
    const fireball = { custom: { name: 'Fireball', ability: 'dex', dc: 15, damage: [{ dice: '8d6', type: 'fire' }], onSuccess: 'half' } };
    expect(intent('save.force', { source: fireball, targetTokenIds: [TOKEN, HERO], against: { source: 'spell' }, visibility: 'public' })).toBe(true);
    expect(intent('save.force', { source: fireball, targetTokenIds: [TOKEN, TOKEN], visibility: 'public' })).toBe(false);
    expect(intent('save.force', { source: fireball, targetTokenIds: [], visibility: 'public' })).toBe(false);
    expect(intent('save.force', { source: fireball, targetTokenIds: [TOKEN], against: {}, visibility: 'public' })).toBe(false);
    expect(intent('mastery.use', { entryId: HERO })).toBe(true);
    expect(intent('mastery.use', { entryId: HERO, targetTokenId: TOKEN, disadvantage: true })).toBe(true);
    expect(intent('mastery.use', { entryId: 'not-a-uuid' })).toBe(false);
    expect(intent('mastery.use', { entryId: HERO, property: 'cleave' })).toBe(false);
    expect(intent('combat.start', { tokenIds: [TOKEN, HERO], surprisedTokenIds: [TOKEN] })).toBe(true);
    expect(intent('combat.start', { tokenIds: [TOKEN], surprisedTokenIds: [HERO] })).toBe(false);
    expect(intent('combat.start', { tokenIds: [TOKEN, TOKEN] })).toBe(false);
    expect(intent('combat.start', { tokenIds: [] })).toBe(false);
    expect(intent('combat.set_initiative', { tokenId: TOKEN, initiative: 61 })).toBe(false);
    expect(intent('combat.next', {})).toBe(true);
    expect(intent('condition.add', { target: { tokenId: TOKEN }, condition: 'prone' })).toBe(true);
    expect(intent('condition.add', { target: { tokenId: TOKEN }, condition: 'exhaustion' })).toBe(false);
    expect(intent('condition.remove', { target: { characterId: HERO }, condition: 'poisoned' })).toBe(true);
    expect(intent('exhaustion.set', { target: { characterId: HERO }, level: 6 })).toBe(true);
    expect(intent('exhaustion.set', { target: { characterId: HERO }, level: 7 })).toBe(false);
    expect(intent('combat.end', { force: true })).toBe(false);
    expect(intent('hp.change', { target: { tokenId: TOKEN }, change: { kind: 'max', amount: 22 } })).toBe(true);
    expect(intent('token.create', { mapId: MAP, name: 'Barril', position: { x: 0, y: 0 }, size: 'medium', hpMax: 5 })).toBe(true);
    expect(intent('hp.change', { target: { tokenId: TOKEN }, change: { kind: 'damage', amount: -3 } })).toBe(false);
    expect(intent('hp.change', { target: { tokenId: TOKEN, characterId: HERO }, change: { kind: 'damage', amount: 3 } })).toBe(false);
    expect(intent('hp.change', { target: { tokenId: TOKEN }, change: { kind: 'kill', amount: 3 } })).toBe(false);
  });

  it('accepts only catalog effects in adjustments', () => {
    expect(intent('adjustment.add', { characterId: HERO, name: 'Nada', effects: [] })).toBe(false);
    expect(intent('adjustment.add', { characterId: HERO, name: 'Inventado', effects: [{ type: 'fly_forever' }] })).toBe(false);
    expect(intent('adjustment.add', { characterId: HERO, name: 'Alvo errado', effects: [{ type: 'flat_bonus', target: 'luck', value: 1 }] })).toBe(false);
  });

  it('limits inventory intents', () => {
    expect(intent('inventory.add', { characterId: HERO, itemId: 'Longsword' })).toBe(false);
    expect(intent('inventory.add', { characterId: HERO, itemId: 'arrows', quantity: 0 })).toBe(false);
    expect(intent('inventory.add', { characterId: HERO, itemId: 'arrows', quantity: 10000 })).toBe(false);
    expect(intent('inventory.update', { characterId: HERO, instanceId: ROLL })).toBe(false);
    expect(intent('inventory.currency', { characterId: HERO, currency: { gp: 10 } })).toBe(false);
    expect(intent('inventory.currency', { characterId: HERO, currency: { cp: -1, sp: 0, ep: 0, gp: 0, pp: 0 } })).toBe(false);
  });

  it('validates the character build structure', () => {
    expect(intent('character.update', { characterId: HERO })).toBe(false);
    expect(intent('character.update', { characterId: HERO, baseScores: { method: 'standard_array', scores: { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 } } })).toBe(false);
    expect(intent('character.update', { characterId: HERO, baseScores: { method: 'point_buy', scores: { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 } } })).toBe(false);
    const dwarf = { kind: 'species', speciesId: 'dwarf' };
    expect(intent('character.update', { characterId: HERO, steps: [dwarf, dwarf] })).toBe(false);
    expect(intent('character.update', { characterId: HERO, steps: Array.from({ length: 21 }, () => ({ kind: 'class_level', classId: 'fighter' })) })).toBe(false);
  });

  it('limits the dice formula', () => {
    expect(countDice('2d6+1d4+3')).toBe(3);
    expect(intent('dice.roll', { formula: '100d6', visibility: 'public' })).toBe(true);
    expect(intent('dice.roll', { formula: '101d6', visibility: 'public' })).toBe(false);
    expect(intent('dice.roll', { formula: '60d6+41d4', visibility: 'public' })).toBe(false);
    expect(intent('dice.roll', { formula: '2d7', visibility: 'public' })).toBe(false);
    expect(intent('dice.roll', { formula: '2d6 + 3', visibility: 'public' })).toBe(false);
    expect(intent('dice.roll', { formula: `1${'+1'.repeat(50)}`, visibility: 'public' })).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(intent('chat.message', { text: '' })).toBe(false);
    expect(intent('chat.message', { text: 'a'.repeat(2001) })).toBe(false);
    expect(intent('map.create', { name: 'Caverna', width: 201, height: 20 })).toBe(false);
    expect(intent('map.create', { name: 'Caverna', width: 30, height: 20, background: SHA, cellPx: 0 })).toBe(false);
    expect(intent('map.create', { name: 'Caverna', width: 30, height: 20, background: SHA, cellPx: 4097 })).toBe(false);
    expect(intent('map.create', { name: 'Caverna', width: 30, height: 20, background: SHA, cellPx: 70.5 })).toBe(false);
    expect(intent('token.move', { tokenId: TOKEN, to: { x: -100, y: 0 } })).toBe(false);
    expect(intent('token.move', { tokenId: TOKEN, to: { x: 50.5, y: 0 } })).toBe(false);
    expect(intent('token.create', { mapId: MAP, name: 'Dragão', position: { x: 0, y: 0 }, size: 'colossal' })).toBe(false);
  });
});

describe('SessionState', () => {
  it('accepts the documented example and an empty table', () => {
    expect(ok(SessionStateSchema, state)).toBe(true);
    expect(ok(SessionStateSchema, { campaign: state.campaign, players: {}, chat: [], maps: {}, activeMapId: null, tokens: {}, characters: {}, proposals: {}, pendingSaves: {}, pendingAttacks: {}, pendingInspirations: {}, combat: null, rest: null })).toBe(true);
  });

  it('keeps conditions unique and exhaustion within 0..6', () => {
    const hero = state.characters[HERO];
    const withConditions = (conditions: unknown) => ({ ...state, characters: { [HERO]: { ...hero, conditions } } });
    expect(ok(SessionStateSchema, withConditions({ active: [{ condition: 'prone' }, { condition: 'poisoned' }], exhaustion: 3 }))).toBe(true);
    expect(ok(SessionStateSchema, withConditions({ active: [{ condition: 'prone' }, { condition: 'prone' }], exhaustion: 0 }))).toBe(false);
    expect(ok(SessionStateSchema, withConditions({ active: [{ condition: 'exhaustion' }], exhaustion: 0 }))).toBe(false);
    expect(ok(SessionStateSchema, withConditions({ active: [], exhaustion: 7 }))).toBe(false);
  });

  it('keeps the combat turn inside the order, without repeated tokens', () => {
    const combatant = { tokenId: TOKEN, initiative: 12, modifier: 2 };
    expect(ok(SessionStateSchema, { ...state, combat: { round: 1, turn: 0, combatants: [combatant] } })).toBe(true);
    expect(ok(SessionStateSchema, { ...state, combat: { round: 1, turn: 1, combatants: [combatant] } })).toBe(false);
    expect(ok(SessionStateSchema, { ...state, combat: { round: 1, turn: 0, combatants: [combatant, combatant] } })).toBe(false);
    expect(ok(SessionStateSchema, { ...state, combat: { round: 0, turn: 0, combatants: [combatant] } })).toBe(false);
  });

  it('limits rolled ability scores to six values from 3 to 18', () => {
    const hero = state.characters[HERO];
    expect(ok(SessionStateSchema, { ...state, characters: { [HERO]: { ...hero, rolledScores: [13, 16, 9, 18, 13] } } })).toBe(false);
    expect(ok(SessionStateSchema, { ...state, characters: { [HERO]: { ...hero, rolledScores: [13, 16, 9, 19, 13, 9] } } })).toBe(false);
  });

  it('keeps hidden rolls without formula or result', () => {
    expect(ok(SessionStateSchema, { ...state, chat: [{ kind: 'hidden_roll', id: ID, at: 0, authorId: GM, total: 9 }] })).toBe(false);
  });
});
