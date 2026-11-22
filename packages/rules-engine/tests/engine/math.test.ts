import { describe, expect, it } from 'vitest';
import { abilityModifier, casterLevelContribution, fixedHitPointsPerLevel, proficiencyBonus, spellSlots } from '../../src/engine/math';
import { evaluatePredicate } from '../../src/engine/sheet';
import { ArmorSchema } from '../../src/schemas/item';

describe('math', () => {
  it.each([
    [1, -5],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [15, 2],
    [20, 5],
    [30, 10],
  ])('modifier of %i is %i', (score, mod) => {
    expect(abilityModifier(score)).toBe(mod);
  });

  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [13, 5],
    [17, 6],
    [20, 6],
  ])('proficiency bonus at level %i is +%i', (level, pb) => {
    expect(proficiencyBonus(level)).toBe(pb);
  });

  it.each([
    [6, 4],
    [8, 5],
    [10, 6],
    [12, 7],
  ])('fixed HP per level for d%i is %i', (die, hp) => {
    expect(fixedHitPointsPerLevel(die)).toBe(hp);
  });

  it('follows the multiclass spellcaster table', () => {
    expect(spellSlots(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlots(1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlots(5)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(spellSlots(7)).toEqual([4, 3, 3, 1, 0, 0, 0, 0, 0]);
    expect(spellSlots(20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it('counts half casters rounding up (Paladin/Ranger)', () => {
    expect(casterLevelContribution('half', 1)).toBe(1);
    expect(casterLevelContribution('half', 3)).toBe(2);
    expect(casterLevelContribution('half', 4)).toBe(2);
    expect(casterLevelContribution('full', 4)).toBe(4);
  });
});

describe('evaluatePredicate', () => {
  const heavy = ArmorSchema.parse({ id: 'plate', name: 'Plate', kind: 'armor', category: 'heavy' });
  const none = new Set<never>();
  const armored = { armor: heavy, shield: true, conditions: none };
  const naked = { armor: undefined, shield: false, conditions: none };

  it('evaluates armor and shield predicates', () => {
    expect(evaluatePredicate({ wearingArmor: true }, armored)).toBe(true);
    expect(evaluatePredicate({ wearingArmor: false }, naked)).toBe(true);
    expect(evaluatePredicate({ armorCategory: 'heavy' }, armored)).toBe(true);
    expect(evaluatePredicate({ armorCategory: 'light' }, armored)).toBe(false);
    expect(evaluatePredicate({ wieldingShield: false }, armored)).toBe(false);
  });

  it('treats roll predicates as unknown on the static sheet', () => {
    expect(evaluatePredicate({ attackKind: 'melee' }, naked)).toBeUndefined();
    expect(evaluatePredicate({ weaponProperty: 'finesse' }, naked)).toBeUndefined();
    expect(evaluatePredicate({ against: { condition: 'poisoned' } }, naked)).toBeUndefined();
  });

  it('evaluates roll predicates inside a roll', () => {
    const swing = { ...naked, roll: { attack: { kind: 'melee' as const, properties: ['finesse'] } } };
    expect(evaluatePredicate({ attackKind: 'melee' }, swing)).toBe(true);
    expect(evaluatePredicate({ weaponProperty: 'finesse' }, swing)).toBe(true);
    expect(evaluatePredicate({ weaponProperty: 'heavy' }, swing)).toBe(false);
    // Um ataque não é uma rolagem para evitar condição.
    expect(evaluatePredicate({ against: { condition: 'poisoned' } }, swing)).toBe(false);
    const save = { ...naked, roll: { against: { condition: 'poisoned' as const } } };
    expect(evaluatePredicate({ against: { condition: 'poisoned' } }, save)).toBe(true);
    expect(evaluatePredicate({ against: { condition: 'charmed' } }, save)).toBe(false);
    expect(evaluatePredicate({ attackKind: 'melee' }, save)).toBe(false);
  });

  it('matches the weapon used by its compendium id', () => {
    const bow = { ...naked, roll: { attack: { kind: 'ranged' as const, properties: ['ammunition'], weaponId: 'longbow' } } };
    expect(evaluatePredicate({ weaponId: 'longbow' }, bow)).toBe(true);
    expect(evaluatePredicate({ weaponId: 'shortbow' }, bow)).toBe(false);
    expect(evaluatePredicate({ weaponId: 'longbow' }, naked)).toBeUndefined();
  });

  it('distinguishes saves against spells from saves against other magical effects', () => {
    const vsSpell = { ...naked, roll: { against: { source: 'spell' as const } } };
    const vsMagic = { ...naked, roll: { against: { source: 'magic' as const } } };
    const mundane = { ...naked, roll: { against: { condition: 'poisoned' as const } } };
    // "against spells": só magia.
    expect(evaluatePredicate({ against: { source: 'spell' } }, vsSpell)).toBe(true);
    expect(evaluatePredicate({ against: { source: 'spell' } }, vsMagic)).toBe(false);
    // "against spells and other magical effects": magia satisfaz também.
    expect(evaluatePredicate({ against: { source: 'magic' } }, vsSpell)).toBe(true);
    expect(evaluatePredicate({ against: { source: 'magic' } }, vsMagic)).toBe(true);
    expect(evaluatePredicate({ against: { source: 'magic' } }, mundane)).toBe(false);
    expect(evaluatePredicate({ against: { source: 'spell' } }, naked)).toBeUndefined();
    // Uma magia que causa uma condição: os dois predicados valem na mesma rolagem.
    const holdPerson = { ...naked, roll: { against: { source: 'spell' as const, condition: 'paralyzed' as const } } };
    expect(evaluatePredicate({ all: [{ against: { source: 'spell' } }, { against: { condition: 'paralyzed' } }] }, holdPerson)).toBe(true);
  });

  it('uses three-valued logic in all/any', () => {
    const unknown = { against: { condition: 'poisoned' } } as const;
    // Falso domina o desconhecido em `all`; verdadeiro domina em `any`.
    expect(evaluatePredicate({ all: [{ wearingArmor: true }, unknown] }, naked)).toBe(false);
    expect(evaluatePredicate({ all: [{ wearingArmor: false }, unknown] }, naked)).toBeUndefined();
    expect(evaluatePredicate({ any: [{ wearingArmor: false }, unknown] }, naked)).toBe(true);
    expect(evaluatePredicate({ any: [{ wearingArmor: true }, unknown] }, naked)).toBeUndefined();
  });

  it('combines with all/any', () => {
    expect(evaluatePredicate({ all: [{ wearingArmor: true }, { wieldingShield: true }] }, armored)).toBe(true);
    expect(evaluatePredicate({ all: [{ wearingArmor: true }, { wieldingShield: false }] }, armored)).toBe(false);
    expect(evaluatePredicate({ any: [{ wearingArmor: false }, { wieldingShield: true }] }, armored)).toBe(true);
  });
});
