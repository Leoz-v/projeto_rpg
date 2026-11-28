import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import dragonbornPaladin from '../../../packages/rules-engine/tests/fixtures/dragonborn-paladin-6.json';
import dwarfFighter from '../../../packages/rules-engine/tests/fixtures/dwarf-fighter-5.json';
import dwarfMonk from '../../../packages/rules-engine/tests/fixtures/dwarf-monk-6.json';
import humanCleric from '../../../packages/rules-engine/tests/fixtures/human-cleric-5.json';
import humanSorcerer from '../../../packages/rules-engine/tests/fixtures/human-sorcerer-3.json';
import orcBarbarian from '../../../packages/rules-engine/tests/fixtures/orc-barbarian-5.json';
import { type ChatEntry, type Intent, type SessionCharacter, SessionStateSchema } from '../../shared/protocol';
import { characterSheet } from '../character-sheet';
import { HostSession, type IntentOutcome } from './executor';

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };
const FIXTURES = { barbarian: orcBarbarian, fighter: dwarfFighter, paladin: dragonbornPaladin, monk: dwarfMonk, cleric: humanCleric, sorcerer: humanSorcerer };

const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const rejection = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.code : undefined);

function table(rolls: number[], who: keyof typeof FIXTURES, items: string[] = []) {
  let i = 0;
  const session = new HostSession({ id: randomUUID(), name: 'Mina' }, GM, {
    rng: { roll: (sides) => Math.min(sides, rolls[i++ % rolls.length] ?? 1) },
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
    assetExists: () => false,
    pruneSteps: (s) => s,
    itemProblems: () => [],
    characterSheet: (c) => characterSheet(c, compendium).sheet ?? undefined,
    monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    creature: (id) => compendium.creatures.find((c) => c.id === id),
    item: (id) => compendium.items.find((x) => x.id === id),
    spell: (id) => compendium.spells.find((s) => s.id === id),
  });
  session.connect(ANA);
  session.connect(BRUNO);
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 30, height: 30 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Lia' } });
  const id = Object.keys(session.state.characters)[0] ?? '';
  const fixture = FIXTURES[who] as unknown as { character: { baseScores: SessionCharacter['baseScores']; steps: unknown } };
  session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: fixture.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(fixture.character.steps) } });
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Lia', position: { x: 0, y: 0 }, size: 'medium', characterId: id, ownerIds: [ANA.playerId] } });
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Alvo', position: { x: 100, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
  const token = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
  const character = (): SessionCharacter => session.state.characters[id] as SessionCharacter;
  for (const itemId of items) session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, itemId } });
  const entry = (itemId: string) => character().inventory.items.find((e) => e.itemId === itemId)?.instanceId ?? '';
  const equip = (itemId: string, equipped = true) => session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: id, instanceId: entry(itemId), equipped } });
  const use = (featureId: string, data: Partial<Extract<Intent, { kind: 'feature.use' }>['data']> = {}, playerId = ANA.playerId) =>
    session.handle(playerId, { kind: 'feature.use', data: { characterId: id, featureId, ...data } });
  const hurt = (amount: number) => session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: id }, change: { kind: 'damage', amount } } });
  const condition = (c: 'poisoned' | 'incapacitated' | 'frightened') => session.handle(GM.playerId, { kind: 'condition.add', data: { target: { characterId: id }, condition: c } });
  const fight = () => session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [token('Lia'), token('Alvo')] } });
  const next = () => session.handle(GM.playerId, { kind: 'combat.next', data: {} });
  const sheet = () => characterSheet(character(), compendium).sheet;
  const states = () => character().adjustments.map((a) => a.feature?.id);
  const last = <K extends ChatEntry['kind']>(kind: K) => session.state.chat.findLast((e): e is Extract<ChatEntry, { kind: K }> => e.kind === kind);
  const valid = () => SessionStateSchema.safeParse(session.state).success;
  return { session, id, character, entry, equip, use, hurt, condition, fight, next, sheet, states, last, valid, target: token('Alvo'), own: token('Lia') };
}

describe('HostSession: using features (note 0078)', () => {
  it('Rage spends a use and goes on the sheet: Resistance, Strength Advantage and the damage of the level', () => {
    const t = table([15], 'barbarian', ['greataxe']);
    t.equip('greataxe');
    expect(applied(t.use('rage'))).toBe(true);
    expect(t.character().resourcesSpent['rage']).toBe(1);
    expect(t.states()).toEqual(['rage']);
    const sheet = t.sheet();
    expect(sheet?.defenses.resistances.map((r) => r.damageType)).toEqual(expect.arrayContaining(['bludgeoning', 'piercing', 'slashing']));
    expect(sheet?.saves.str.roll.mode).toBe('advantage');
    expect(sheet?.skills.athletics.roll.mode).toBe('advantage');
    t.session.handle(ANA.playerId, { kind: 'attack.make', data: { attacker: { characterId: t.id, instanceId: t.entry('greataxe') }, targetTokenId: t.target, visibility: 'public' } });
    expect(t.last('attack_roll')?.damage?.groups.map((g) => [g.source, g.dice])).toEqual([[undefined, '1d12'], ['Rage', '2']]);
    // Usar de novo renova; o dono encerra.
    expect(applied(t.use('rage'))).toBe(true);
    expect(t.states()).toEqual(['rage']);
    const [state] = t.character().adjustments;
    expect(rejection(t.session.handle(BRUNO.playerId, { kind: 'adjustment.remove', data: { characterId: t.id, adjustmentId: state?.id ?? '' } }))).toBe('not_allowed');
    expect(applied(t.session.handle(ANA.playerId, { kind: 'adjustment.remove', data: { characterId: t.id, adjustmentId: state?.id ?? '' } }))).toBe(true);
    expect(t.states()).toEqual([]);
    expect(t.last('spell_effect_ended')).toMatchObject({ effectName: 'Rage', reason: 'removed' });
    expect(t.valid()).toBe(true);
  });

  it('Rage ends by itself when Incapacitated, dying or in Heavy armor, and cannot start in it', () => {
    const inc = table([15], 'barbarian');
    inc.use('rage');
    inc.condition('incapacitated');
    expect(inc.states()).toEqual([]);
    expect(inc.last('spell_effect_ended')).toMatchObject({ reason: 'broken' });
    expect(rejection(inc.use('rage'))).toBe('rule_violation');
    expect(inc.character().resourcesSpent['rage']).toBe(1);

    const down = table([15], 'barbarian');
    down.use('rage');
    down.hurt(500);
    expect(down.states()).toEqual([]);

    const plate = table([15], 'barbarian', ['plate_armor']);
    plate.use('rage');
    plate.equip('plate_armor');
    expect(plate.states()).toEqual([]);
    expect(rejection(plate.use('rage'))).toBe('rule_violation');
    expect(plate.valid()).toBe(true);
  });

  it('Rage reminds at the end of the turn, and blocks spells and Concentration', () => {
    const t = table([15], 'barbarian', ['wand_of_magic_missiles']);
    t.equip('wand_of_magic_missiles');
    t.use('rage');
    t.fight();
    t.next();
    t.next();
    expect(t.session.state.chat.some((e) => e.kind === 'turn_trigger' && e.on === 'turn_end' && e.items.some((x) => x.source === 'Rage'))).toBe(true);
    const cast = () => t.session.handle(ANA.playerId, { kind: 'item.cast', data: { characterId: t.id, instanceId: t.entry('wand_of_magic_missiles'), spellId: 'magic_missile' } });
    expect(rejection(cast())).toBe('rule_violation');
    const [state] = t.character().adjustments;
    t.session.handle(ANA.playerId, { kind: 'adjustment.remove', data: { characterId: t.id, adjustmentId: state?.id ?? '' } });
    expect(applied(cast())).toBe(true);
  });

  it('Reckless Attack gives Advantage against the barbarian until the next turn', () => {
    const t = table([15], 'barbarian');
    t.fight();
    expect(applied(t.use('reckless_attack'))).toBe(true);
    const attack = () => t.session.handle(GM.playerId, { kind: 'attack.make', data: { attacker: { tokenId: t.target, actionId: 'scimitar' }, targetTokenId: t.own, visibility: 'public' } });
    expect(applied(attack())).toBe(true);
    expect(t.last('attack_roll')?.mode).toBe('advantage');
    t.next();
    t.next();
    expect(t.states()).toEqual([]);
    attack();
    expect(t.last('attack_roll')?.mode).toBe('normal');
  });

  it('Second Wind heals 1d10 plus the level, and needs a use', () => {
    const t = table([6], 'fighter');
    t.hurt(20);
    expect(applied(t.use('second_wind'))).toBe(true);
    expect(t.character().hp.damage).toBe(9);
    expect(t.last('feature_used')).toMatchObject({ featureName: 'Second Wind', action: 'Ação Bônus' });
    const uses = t.sheet()?.resources.find((r) => r.id === 'second_wind')?.max ?? 0;
    for (let n = 1; n < uses; n++) t.use('second_wind');
    expect(rejection(t.use('second_wind'))).toBe('rule_violation');
    expect(rejection(t.use('rage'))).toBe('rule_violation');
    expect(rejection(t.use('second_wind', { targetTokenId: t.target }))).toBe('rule_violation');
  });

  it('Lay On Hands draws the chosen amount, on any target, and removes Poisoned for 5', () => {
    const t = table([1], 'paladin');
    t.hurt(12);
    t.condition('poisoned');
    expect(applied(t.use('lay_on_hands', { amount: 7, conditions: ['poisoned'] }))).toBe(true);
    expect(t.character().hp.damage).toBe(5);
    expect(t.character().conditions.active).toEqual([]);
    expect(t.character().resourcesSpent['lay_on_hands']).toBe(12);
    // 30 na reserva: restam 18.
    expect(rejection(t.use('lay_on_hands', { amount: 19 }))).toBe('rule_violation');
    expect(rejection(t.use('lay_on_hands', { amount: 0 }))).toBe('rule_violation');
    expect(rejection(t.use('lay_on_hands', { conditions: ['blinded'] }))).toBe('rule_violation');
    expect(rejection(t.use('lay_on_hands', { amount: 1 }, BRUNO.playerId))).toBe('not_allowed');
    t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { tokenId: t.target }, change: { kind: 'damage', amount: 4 } } });
    expect(applied(t.use('lay_on_hands', { amount: 3, targetTokenId: t.target }))).toBe(true);
    expect(t.session.state.tokens[t.target]?.hp?.damage).toBe(1);
    expect(t.valid()).toBe(true);
  });

  it('Sacred Weapon goes on one held melee weapon', () => {
    const t = table([10], 'paladin', ['longsword', 'longbow']);
    t.equip('longsword');
    t.equip('longbow');
    const bonus = () => t.sheet()?.attacks.find((a) => a.itemId === 'longsword')?.attack.total ?? 0;
    const before = bonus();
    expect(rejection(t.use('sacred_weapon'))).toBe('rule_violation');
    expect(rejection(t.use('sacred_weapon', { weaponId: t.entry('longbow') }))).toBe('rule_violation');
    expect(applied(t.use('sacred_weapon', { weaponId: t.entry('longsword') }))).toBe(true);
    expect(bonus()).toBe(before + Math.max(1, t.sheet()?.abilities.cha.modifier ?? 0));
    expect(t.character().resourcesSpent['channel_divinity']).toBe(1);
  });

  it('Divine Spark, Wholeness of Body, Uncanny Metabolism and Adrenaline Rush', () => {
    const cleric = table([8], 'cleric');
    cleric.hurt(20);
    cleric.use('divine_spark');
    expect(cleric.character().hp.damage).toBe(20 - 8 - (cleric.sheet()?.abilities.wis.modifier ?? 0));

    const monk = table([5], 'monk');
    monk.hurt(30);
    monk.session.handle(ANA.playerId, { kind: 'resource.spend', data: { characterId: monk.id, resourceId: 'focus_points', amount: 4 } });
    expect(applied(monk.use('uncanny_metabolism'))).toBe(true);
    expect(monk.character().resourcesSpent).toEqual({ uncanny_metabolism: 1 });
    expect(monk.character().hp.damage).toBe(30 - 5 - 6);

    const orc = table([5], 'barbarian');
    orc.use('adrenaline_rush');
    expect(orc.character().hp.temp).toBe(orc.sheet()?.proficiencyBonus);
  });

  it('Innate Sorcery raises the DC; the spells keep working', () => {
    const t = table([5], 'sorcerer');
    const dc = () => t.sheet()?.spellcasting.classes[0]?.saveDc.total ?? 0;
    const before = dc();
    t.use('innate_sorcery');
    expect(dc()).toBe(before + 1);
    expect(t.sheet()?.spellcasting.attackRoll.mode).toBe('advantage');
    expect(t.valid()).toBe(true);
  });
});
