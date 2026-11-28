import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import dwarfFighter from '../../../packages/rules-engine/tests/fixtures/dwarf-fighter-5.json';
import { type SessionCharacter, SessionStateSchema } from '../../shared/protocol';
import { characterSheet } from '../character-sheet';
import { HostSession, type IntentOutcome } from './executor';

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };

const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const rejection = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.code : undefined);

/** Thorin (guerreiro anão 5, da Ana) com o item, um goblin e, se pedido, o token dele. */
function table(rolls: number[], item: { itemId: string; variantId?: string; quantity?: number }, options: { token?: boolean; monster?: string } = {}) {
  let i = 0;
  const session = new HostSession({ id: randomUUID(), name: 'Mina' }, GM, {
    rng: { roll: () => rolls[i++ % rolls.length] ?? 1 },
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
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 20, height: 20 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } });
  const id = Object.keys(session.state.characters)[0] ?? '';
  const fixture = dwarfFighter as unknown as { character: { baseScores: SessionCharacter['baseScores']; steps: unknown } };
  session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: fixture.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(fixture.character.steps) } });
  if (options.token !== false) {
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium', characterId: id, ownerIds: [ANA.playerId] } });
  }
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Alvo', position: { x: 500, y: 0 }, size: 'small', monsterId: options.monster ?? 'goblin_warrior' } });
  session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, ...item } });
  const character = (): SessionCharacter => session.state.characters[id] as SessionCharacter;
  const instanceId = character().inventory.items[0]?.instanceId ?? '';
  const token = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
  const use = (data: { self?: boolean; targetTokenIds?: string[]; option?: number } = {}, playerId = ANA.playerId) =>
    session.handle(playerId, {
      kind: 'item.use',
      data: { characterId: id, instanceId, self: data.self ?? true, targetTokenIds: data.targetTokenIds ?? [], ...(data.option !== undefined ? { option: data.option } : {}) },
    });
  const sheet = () => characterSheet(character(), compendium).sheet;
  const hurt = (amount: number) => session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: id }, change: { kind: 'damage', amount } } });
  const valid = () => SessionStateSchema.safeParse(session.state).success;
  return { session, id, character, use, sheet, hurt, valid, target: token('Alvo'), thorin: token('Thorin') };
}

describe('HostSession: using items (note 0074)', () => {
  it('a Potion of Healing is rolled by the Host, heals and leaves the inventory', () => {
    const t = table([3, 4], { itemId: 'potion_of_healing', variantId: 'healing', quantity: 2 });
    t.hurt(20);
    expect(applied(t.use())).toBe(true);
    // 2d4+2 = 3+4+2.
    expect(t.character().hp.damage).toBe(11);
    expect(t.character().inventory.items[0]?.quantity).toBe(1);
    expect(t.session.state.chat.find((e) => e.kind === 'item_used')).toMatchObject({ characterName: 'Thorin', itemName: 'Potion of Healing', left: 1 });
    expect(t.session.state.chat.findLast((e) => e.kind === 'spell_applied')).toMatchObject({ healing: { total: 9 }, results: [{ targetName: 'Thorin', notes: ['+9 PV'] }] });
    expect(applied(t.use())).toBe(true);
    expect(t.character().inventory.items).toEqual([]);
    expect(rejection(t.use())).toBe('rule_violation');
    expect(t.valid()).toBe(true);
  });

  it('works without a token on the map, and on another creature', () => {
    const alone = table([4], { itemId: 'potion_of_healing', variantId: 'healing' }, { token: false });
    alone.hurt(20);
    expect(applied(alone.use())).toBe(true);
    expect(alone.character().hp.damage).toBe(10);
    expect(alone.valid()).toBe(true);

    const other = table([4], { itemId: 'potion_of_healing', variantId: 'healing' });
    other.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { tokenId: other.target }, change: { kind: 'damage', amount: 500 } } });
    expect(other.session.state.tokens[other.target]?.dead).toBe(true);
    expect(applied(other.use({ self: false, targetTokenIds: [other.target] }))).toBe(true);
    expect(other.session.state.tokens[other.target]?.dead).toBe(false);
  });

  it('brings back a dying character', () => {
    const t = table([4], { itemId: 'potion_of_healing', variantId: 'healing' });
    const max = t.sheet()?.hpMax.total ?? 0;
    t.hurt(max);
    expect(t.character().conditions.active.map((c) => c.condition)).toContain('unconscious');
    expect(applied(t.use())).toBe(true);
    expect(t.character().hp.damage).toBe(max - 10);
    expect(t.character().conditions.active.map((c) => c.condition)).not.toContain('unconscious');
  });

  it('only the owner and the GM use it, with one target; a refusal spends nothing', () => {
    const t = table([4], { itemId: 'potion_of_healing', variantId: 'healing' });
    expect(rejection(t.use({}, BRUNO.playerId))).toBe('not_allowed');
    expect(rejection(t.use({ self: false }))).toBe('rule_violation');
    expect(rejection(t.use({ self: true, targetTokenIds: [t.target] }))).toBe('rule_violation');
    expect(rejection(t.use({ option: 0 }))).toBe('rule_violation');
    expect(t.character().inventory.items).toHaveLength(1);
    // O próprio token e "quem usa" são o mesmo alvo.
    expect(applied(t.use({ self: true, targetTokenIds: [t.thorin] }, GM.playerId))).toBe(true);
    const rope = table([4], { itemId: 'rope' });
    expect(rejection(rope.use())).toBe('rule_violation');
  });

  it('Heroism gives 10 temporary HP and the Bless dice, and the owner ends the effect', () => {
    const t = table([4], { itemId: 'potion_of_heroism' });
    expect(applied(t.use())).toBe(true);
    expect(t.character().hp.temp).toBe(10);
    const [effect] = t.character().adjustments;
    expect(effect).toMatchObject({ name: 'Potion of Heroism', effects: [{ type: 'd20_bonus', target: 'attack.all' }, { type: 'd20_bonus', target: 'save.all' }] });
    expect(applied(t.session.handle(ANA.playerId, { kind: 'adjustment.remove', data: { characterId: t.id, adjustmentId: effect?.id ?? '' } }))).toBe(true);
    expect(t.valid()).toBe(true);
  });

  it('Giant Strength and Resistance change the sheet; the choice is required', () => {
    const strength = table([4], { itemId: 'potion_of_giant_strength', variantId: 'hill' });
    expect(applied(strength.use())).toBe(true);
    expect(strength.sheet()?.abilities.str.total).toBe(21);

    const resistance = table([4], { itemId: 'potion_of_resistance', quantity: 2 });
    expect(rejection(resistance.use())).toBe('rule_violation');
    expect(rejection(resistance.use({ option: 10 }))).toBe('rule_violation');
    expect(applied(resistance.use({ option: 2 }))).toBe(true);
    expect(resistance.sheet()?.defenses.resistances.map((r) => r.damageType)).toContain('fire');
    // A segunda, de outro tipo, substitui a primeira.
    expect(applied(resistance.use({ option: 1 }))).toBe(true);
    expect(resistance.character().adjustments).toHaveLength(1);
  });

  it('Invisibility, Elixir of Health and Vitality change the conditions', () => {
    const invisible = table([4], { itemId: 'potion_of_invisibility' });
    expect(applied(invisible.use())).toBe(true);
    expect(invisible.character().conditions.active).toEqual([{ condition: 'invisible' }]);

    const elixir = table([4], { itemId: 'elixir_of_health' });
    for (const condition of ['blinded', 'prone'] as const) elixir.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { characterId: elixir.id }, condition } });
    expect(applied(elixir.use())).toBe(true);
    expect(elixir.character().conditions.active).toEqual([{ condition: 'prone' }]);

    const vitality = table([4], { itemId: 'potion_of_vitality' });
    vitality.session.handle(GM.playerId, { kind: 'exhaustion.set', data: { target: { characterId: vitality.id }, level: 3 } });
    expect(applied(vitality.use())).toBe(true);
    expect(vitality.character().conditions.exhaustion).toBe(0);
    expect(vitality.valid()).toBe(true);
  });

  it('Potion of Poison proposes the damage and poisons on a failed save; it needs a token', () => {
    const t = table([2], { itemId: 'potion_of_poison' });
    // Anão: Vantagem contra Envenenado e Resistência a Veneno. 4d6 = 8, metade = 4.
    expect(applied(t.use())).toBe(true);
    expect(Object.values(t.session.state.proposals).map((p) => p.amount)).toEqual([4]);
    expect(t.character().hp.damage).toBe(0);
    expect(t.session.state.chat.find((e) => e.kind === 'save_roll')).toMatchObject({ dc: 13, results: [{ mode: 'advantage' }] });
    expect(t.character().conditions.active).toEqual([{ condition: 'poisoned' }]);
    expect(t.valid()).toBe(true);
    const alone = table([2], { itemId: 'potion_of_poison' }, { token: false });
    expect(rejection(alone.use())).toBe('rule_violation');
    expect(alone.character().inventory.items).toHaveLength(1);
  });

  it('Acid uses the DC of the thrower, and Holy Water spares who is not a Fiend or Undead', () => {
    const acid = table([1], { itemId: 'acid' });
    expect(applied(acid.use({ self: false, targetTokenIds: [acid.target] }))).toBe(true);
    const sheet = acid.sheet();
    const dc = 8 + (sheet?.abilities.dex.modifier ?? 0) + (sheet?.proficiencyBonus ?? 0);
    expect(acid.session.state.chat.find((e) => e.kind === 'save_roll')).toMatchObject({ dc, onSuccess: 'none' });
    expect(Object.values(acid.session.state.proposals).map((p) => p.amount)).toEqual([2]);

    const goblin = table([1], { itemId: 'holy_water' });
    expect(applied(goblin.use({ self: false, targetTokenIds: [goblin.target] }))).toBe(true);
    expect(goblin.session.state.proposals).toEqual({});
    expect(goblin.session.state.chat.findLast((e) => e.kind === 'spell_applied')).toMatchObject({ results: [{ notes: ['Não é afetado (tipo de criatura)'] }] });
    expect(goblin.character().inventory.items).toEqual([]);

    const zombie = table([1], { itemId: 'holy_water' }, { monster: 'zombie' });
    expect(applied(zombie.use({ self: false, targetTokenIds: [zombie.target] }))).toBe(true);
    expect(Object.values(zombie.session.state.proposals)).toHaveLength(1);
  });

  it('an area item takes several targets, and a legendary creature waits for the GM', () => {
    const t = table([1], { itemId: 'dust_of_sneezing_and_choking' }, { monster: 'adult_red_dragon' });
    expect(applied(t.use({ self: true, targetTokenIds: [t.target] }))).toBe(true);
    expect(t.character().conditions.active).toEqual([{ condition: 'incapacitated' }]);
    expect(t.session.state.tokens[t.target]?.conditions.active).toEqual([]);
    const [pending] = Object.values(t.session.state.pendingSaves);
    expect(t.valid()).toBe(true);
    expect(applied(t.session.handle(GM.playerId, { kind: 'save.resolve', data: { pendingId: pending?.id ?? '', useResistance: false } }))).toBe(true);
    expect(t.session.state.tokens[t.target]?.conditions.active).toEqual([{ condition: 'incapacitated' }]);
  });
});
