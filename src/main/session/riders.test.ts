import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import dwarfFighter from '../../../packages/rules-engine/tests/fixtures/dwarf-fighter-5.json';
import gnomeRanger from '../../../packages/rules-engine/tests/fixtures/gnome-ranger-6.json';
import goliathWarlock from '../../../packages/rules-engine/tests/fixtures/goliath-warlock-5.json';
import orcBarbarian from '../../../packages/rules-engine/tests/fixtures/orc-barbarian-5.json';
import tieflingRogue from '../../../packages/rules-engine/tests/fixtures/tiefling-rogue-5.json';
import { type ChatEntry, type Intent, type SessionCharacter, SessionStateSchema } from '../../shared/protocol';
import { characterSheet } from '../character-sheet';
import { HostSession, type IntentOutcome } from './executor';

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const FIXTURES = { rogue: tieflingRogue, ranger: gnomeRanger, warlock: goliathWarlock, barbarian: orcBarbarian, fighter: dwarfFighter };

const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const rejection = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.code : undefined);

/** O personagem da Ana com a arma, a 5 ft do alvo. Todo dado sai `rolls` (em ciclo). */
function table(rolls: number[], who: keyof typeof FIXTURES, weapon: { itemId: string; baseItemId?: string }, monster = 'goblin_warrior') {
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
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 30, height: 30 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Lia' } });
  const id = Object.keys(session.state.characters)[0] ?? '';
  const fixture = FIXTURES[who] as unknown as { character: { baseScores: SessionCharacter['baseScores']; steps: unknown } };
  session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: fixture.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(fixture.character.steps) } });
  const place = (name: string, x: number, extra: Partial<Extract<Intent, { kind: 'token.create' }>['data']>) => {
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name, position: { x, y: 0 }, size: 'medium', ...extra } });
    return Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
  };
  const own = place('Lia', 0, { characterId: id, ownerIds: [ANA.playerId] });
  const target = place('Alvo', 100, { monsterId: monster });
  session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, ...weapon } });
  const character = (): SessionCharacter => session.state.characters[id] as SessionCharacter;
  const instanceId = character().inventory.items[0]?.instanceId ?? '';
  session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: id, instanceId, equipped: true, attuned: true } });
  type Attack = Extract<Intent, { kind: 'attack.make' }>['data'];
  const attack = (riders: NonNullable<Attack['riders']> = [], more: Partial<Attack> = {}) =>
    session.handle(ANA.playerId, { kind: 'attack.make', data: { attacker: { characterId: id, instanceId }, targetTokenId: target, visibility: 'public', ...(riders.length > 0 ? { riders } : {}), ...more } });
  const last = () => session.state.chat.findLast((e): e is Extract<ChatEntry, { kind: 'attack_roll' }> => e.kind === 'attack_roll');
  const groups = () => (last()?.damage?.groups ?? []).map((g) => [g.source, g.dice, g.type]);
  const hurt = () => session.handle(GM.playerId, { kind: 'hp.change', data: { target: { tokenId: target }, change: { kind: 'damage', amount: 1 } } });
  const fight = () => session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [own, target] } });
  const next = () => session.handle(GM.playerId, { kind: 'combat.next', data: {} });
  const sheet = () => characterSheet(character(), compendium).sheet;
  const valid = () => SessionStateSchema.safeParse(session.state).success;
  return { session, id, character, attack, last, groups, hurt, fight, next, place, sheet, valid, own, target, instanceId };
}

const SNEAK = [{ id: 'sneak_attack' }];

describe('HostSession: extra damage on attacks (note 0077)', () => {
  it('Sneak Attack adds the dice of the level when marked, of the weapon type, doubled on a critical', () => {
    const t = table([18], 'rogue', { itemId: 'rapier' });
    expect(applied(t.attack())).toBe(true);
    expect(t.groups()).toEqual([[undefined, '1d8', 'piercing']]);
    expect(applied(t.attack(SNEAK, { advantage: true }))).toBe(true);
    expect(t.groups()).toEqual([[undefined, '1d8', 'piercing'], ['Sneak Attack', '3d6', 'piercing']]);
    expect(t.last()?.notes).toEqual([]);
    const crit = table([20], 'rogue', { itemId: 'rapier' });
    crit.attack(SNEAK);
    expect(crit.groups()[1]).toEqual(['Sneak Attack', '6d6', 'piercing']);
    expect(t.valid()).toBe(true);
  });

  it('warns without Advantage nor an ally near the target, and never blocks', () => {
    const t = table([18], 'rogue', { itemId: 'rapier' });
    expect(applied(t.attack(SNEAK))).toBe(true);
    expect(t.last()?.notes.some((n) => n.startsWith('Sneak Attack sem Vantagem'))).toBe(true);
    const wolf = t.place('Lobo', 200, { monsterId: 'wolf', ownerIds: [ANA.playerId] });
    t.attack(SNEAK);
    expect(t.last()?.notes).toEqual([]);
    // Com Desvantagem, o aliado não basta; Incapacitado, também não.
    t.attack(SNEAK, { disadvantage: true });
    expect(t.last()?.notes.some((n) => n.startsWith('Sneak Attack sem Vantagem'))).toBe(true);
    t.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { tokenId: wolf }, condition: 'incapacitated' } });
    t.attack(SNEAK);
    expect(t.last()?.notes.some((n) => n.startsWith('Sneak Attack sem Vantagem'))).toBe(true);
  });

  it('once per turn only in combat; a miss does not spend it, and another turn frees it', () => {
    const free = table([18], 'rogue', { itemId: 'rapier' });
    expect(applied(free.attack(SNEAK))).toBe(true);
    expect(applied(free.attack(SNEAK))).toBe(true);

    const t = table([18], 'rogue', { itemId: 'rapier' });
    t.fight();
    expect(applied(t.attack(SNEAK))).toBe(true);
    expect(rejection(t.attack(SNEAK))).toBe('rule_violation');
    expect(applied(t.attack())).toBe(true);
    // Ataque de reação no turno de outro: outro turno, outro Sneak Attack.
    t.next();
    expect(applied(t.attack(SNEAK))).toBe(true);
    expect(t.session.state.combat?.usedRiders).toHaveLength(1);
    expect(t.session.viewFor(ANA.playerId).combat).not.toHaveProperty('usedRiders');
    expect(t.valid()).toBe(true);

    const miss = table([2], 'rogue', { itemId: 'rapier' });
    miss.fight();
    miss.attack(SNEAK);
    expect(miss.last()?.hit).toBe(false);
    expect(miss.session.state.combat?.usedRiders).toBeUndefined();
  });

  it('only weapons that allow it, only known riders, never twice in one attack', () => {
    const mace = table([18], 'rogue', { itemId: 'mace' });
    expect(rejection(mace.attack(SNEAK))).toBe('rule_violation');
    const t = table([18], 'rogue', { itemId: 'rapier' });
    expect(rejection(t.attack([{ id: 'frenzy' }]))).toBe('rule_violation');
    expect(rejection(t.attack([...SNEAK, ...SNEAK]))).toBe('rule_violation');
    const monster = t.session.handle(GM.playerId, { kind: 'attack.make', data: { attacker: { tokenId: t.target, actionId: 'scimitar' }, targetTokenId: t.own, visibility: 'public', riders: SNEAK } });
    expect(rejection(monster)).toBe('rule_violation');
  });

  it('Colossus Slayer enters by itself against an injured target, once per turn', () => {
    const t = table([18], 'ranger', { itemId: 'shortsword' });
    t.attack();
    expect(t.groups()).toHaveLength(1);
    t.hurt();
    t.attack();
    expect(t.groups()[1]).toEqual(['Colossus Slayer', '1d8', 'piercing']);
    t.fight();
    t.attack();
    expect(t.groups()).toHaveLength(2);
    t.attack();
    expect(t.groups()).toHaveLength(1);
  });

  it('Frenzy follows the Rage Damage of the level, with Strength', () => {
    const t = table([18], 'barbarian', { itemId: 'greataxe' });
    t.attack([{ id: 'frenzy' }]);
    expect(t.groups()[1]).toEqual(['Frenzy', '2d6', 'slashing']);
    expect(t.last()?.reminders.some((r) => r.startsWith('Frenzy:'))).toBe(true);
  });

  it("Fire's Burn spends a use only on a hit, and is refused without uses", () => {
    const burn = [{ id: 'fires_burn' }];
    const miss = table([2], 'warlock', { itemId: 'dagger' });
    miss.attack(burn);
    expect(miss.character().resourcesSpent).toEqual({});
    const t = table([18], 'warlock', { itemId: 'dagger' });
    const uses = t.sheet()?.resources.find((r) => r.id === 'giant_ancestry')?.max ?? 0;
    t.attack(burn);
    expect(t.groups()[1]).toEqual(["Fire's Burn", '1d10', 'fire']);
    expect(t.character().resourcesSpent['giant_ancestry']).toBe(1);
    for (let n = 1; n < uses; n++) t.attack(burn);
    expect(rejection(t.attack(burn))).toBe('rule_violation');
    expect(t.valid()).toBe(true);
  });

  it('magic weapons hit harder the right creatures', () => {
    const dragon = table([18], 'fighter', { itemId: 'dragon_slayer', baseItemId: 'longsword' }, 'adult_red_dragon');
    dragon.attack();
    expect(dragon.groups()[1]).toEqual(['Dragon Slayer', '3d6', 'slashing']);
    const goblin = table([18], 'fighter', { itemId: 'dragon_slayer', baseItemId: 'longsword' });
    goblin.attack();
    expect(goblin.groups()).toHaveLength(1);
    const brand = table([18], 'fighter', { itemId: 'frost_brand', baseItemId: 'longsword' });
    brand.attack();
    expect(brand.groups()[1]).toMatchObject([expect.any(String), '1d6', 'cold']);
    const tongue = table([18], 'fighter', { itemId: 'flame_tongue', baseItemId: 'longsword' });
    tongue.attack();
    expect(tongue.groups()).toHaveLength(1);
    tongue.attack([{ id: 'flame_tongue' }]);
    expect(tongue.groups()[1]).toEqual(['Flame Tongue', '2d6', 'fire']);
  });

  it('a natural 20 triggers the fixed damage, which the critical does not double', () => {
    const t = table([20], 'fighter', { itemId: 'sword_of_sharpness', baseItemId: 'longsword' });
    t.attack();
    expect(t.groups()[1]).toEqual(['Sword of Sharpness', '14', 'slashing']);
    const no = table([18], 'fighter', { itemId: 'sword_of_sharpness', baseItemId: 'longsword' });
    no.attack();
    expect(no.groups()).toHaveLength(1);
    const undead = table([20], 'fighter', { itemId: 'sword_of_life_stealing', baseItemId: 'longsword' }, 'zombie');
    undead.attack();
    expect(undead.groups()).toHaveLength(1);
  });

  it('the Staff of Withering spends its charge on the hit', () => {
    const t = table([18], 'fighter', { itemId: 'staff_of_withering' });
    t.attack([{ id: 'staff_of_withering' }]);
    expect(t.groups()[1]).toEqual(['Staff of Withering', '2d10', 'necrotic']);
    expect(t.character().inventory.items[0]?.chargesSpent).toBe(1);
    expect(t.valid()).toBe(true);
  });
});
