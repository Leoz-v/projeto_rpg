import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import { SessionStateSchema } from '../../shared/protocol';
import { HostSession, type IntentOutcome } from './executor';

/** Usos limitados e recarga dos monstros (nota 0064). */

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const rejection = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.code : undefined);

/** Dragão vermelho adulto (Fire Breath com recarga 5–6, Resistência Lendária 3/dia) e um goblin. */
function table(rolls: number[]) {
  let i = 0;
  const session = new HostSession({ id: randomUUID(), name: 'Mesa' }, GM, {
    rng: { roll: () => rolls[i++ % rolls.length] ?? 1 },
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
    assetExists: () => false,
    pruneSteps: (steps) => steps,
    itemProblems: () => [],
    characterSheet: () => undefined,
    monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    creature: (id) => compendium.creatures.find((c) => c.id === id),
    spell: () => undefined,
  });
  session.connect(ANA);
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Covil', width: 20, height: 20 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Dragão', position: { x: 0, y: 0 }, size: 'huge', monsterId: 'adult_red_dragon' } });
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin', position: { x: 1000, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
  const id = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
  const dragon = id('Dragão');
  const goblin = id('Goblin');
  const breath = () => session.handle(GM.playerId, { kind: 'save.force', data: { source: { tokenId: dragon, actionId: 'fire_breath' }, targetTokenIds: [goblin], visibility: 'public' } });
  const use = (playerId: string, featureId: string, change: 'spend' | 'restore') => session.handle(playerId, { kind: 'monster.use', data: { tokenId: dragon, featureId, change } });
  const spent = () => session.state.tokens[dragon]?.uses.spent;
  return { session, dragon, goblin, breath, use, spent };
}

describe('HostSession: monster limited uses (note 0064)', () => {
  it('spends the breath, refuses it while spent and lets the GM restore it', () => {
    const t = table([3]);
    expect(applied(t.breath())).toBe(true);
    expect(t.spent()).toEqual({ fire_breath: 1 });
    expect(rejection(t.breath())).toBe('rule_violation');
    expect(applied(t.use(GM.playerId, 'fire_breath', 'restore'))).toBe(true);
    expect(rejection(t.use(GM.playerId, 'fire_breath', 'restore'))).toBe('rule_violation');
    expect(applied(t.breath())).toBe(true);
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('does not spend anything when an attack has no limit', () => {
    const t = table([10]);
    expect(applied(t.session.handle(GM.playerId, { kind: 'attack.make', data: { attacker: { tokenId: t.dragon, actionId: 'rend' }, targetTokenId: t.goblin, visibility: 'public' } }))).toBe(true);
    expect(t.spent()).toEqual({});
  });

  it('counts uses per day by hand, with the lair limit, and gives all back on a rest', () => {
    const t = table([1]);
    for (let i = 0; i < 3; i++) expect(applied(t.use(GM.playerId, 'legendary_resistance', 'spend'))).toBe(true);
    expect(rejection(t.use(GM.playerId, 'legendary_resistance', 'spend'))).toBe('rule_violation');
    t.session.handle(GM.playerId, { kind: 'monster.lair', data: { tokenId: t.dragon, lair: true } });
    expect(applied(t.use(GM.playerId, 'legendary_resistance', 'spend'))).toBe(true);
    expect(rejection(t.use(GM.playerId, 'rend', 'spend'))).toBe('rule_violation');
    t.session.handle(GM.playerId, { kind: 'monster.rest', data: { tokenId: t.dragon } });
    expect(t.session.state.tokens[t.dragon]?.uses).toEqual({ spent: {}, lair: true });
  });

  it('only the GM and the token owners change the uses; players do not see them', () => {
    const t = table([3]);
    expect(rejection(t.use(ANA.playerId, 'fire_breath', 'spend'))).toBe('not_allowed');
    expect(rejection(t.session.handle(ANA.playerId, { kind: 'monster.rest', data: { tokenId: t.dragon } }))).toBe('not_allowed');
    const { change } = t.use(GM.playerId, 'fire_breath', 'spend');
    if (!change) throw new Error('sem mudança');
    expect(t.session.patchFor(change, ANA.playerId).ops).toEqual([]);
    expect(t.session.viewFor(ANA.playerId).tokens[t.dragon]?.uses).toEqual({ spent: {}, lair: false });
    expect(t.session.viewFor(GM.playerId).tokens[t.dragon]?.uses.spent).toEqual({ fire_breath: 1 });
  });

  it('rolls the recharge at the start of the turn, hidden from the players', () => {
    const rolls = [1];
    const t = table(rolls);
    t.use(GM.playerId, 'fire_breath', 'spend');
    t.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [t.dragon, t.goblin] } });
    // Uma volta inteira com 1: continua gasta; com 6, volta.
    const round = () => {
      t.session.handle(GM.playerId, { kind: 'combat.next', data: {} });
      t.session.handle(GM.playerId, { kind: 'combat.next', data: {} });
    };
    round();
    expect(t.spent()).toEqual({ fire_breath: 1 });
    rolls[0] = 6;
    round();
    expect(t.spent()).toEqual({});
    const entry = t.session.state.chat.findLast((e) => e.kind === 'recharge_roll');
    expect(entry).toMatchObject({ actionName: 'Fire Breath', roll: 6, min: 5 });
    expect(t.session.viewFor(ANA.playerId).chat.find((e) => e.id === entry?.id)?.kind).toBe('hidden_roll');
    const count = t.session.state.chat.filter((e) => e.kind === 'recharge_roll').length;
    round();
    expect(t.session.state.chat.filter((e) => e.kind === 'recharge_roll')).toHaveLength(count);
  });

  it('a monster at 0 hit points does not recharge', () => {
    const t = table([6]);
    t.use(GM.playerId, 'fire_breath', 'spend');
    t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { tokenId: t.dragon }, change: { kind: 'damage', amount: 999 } } });
    t.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [t.dragon] } });
    expect(t.spent()).toEqual({ fire_breath: 1 });
  });
});
