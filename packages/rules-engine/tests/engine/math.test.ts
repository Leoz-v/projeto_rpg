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
  const armored = { armor: heavy, shield: true };
  const naked = { armor: undefined, shield: false };

  it('evaluates armor and shield predicates', () => {
    expect(evaluatePredicate({ wearingArmor: true }, armored)).toBe(true);
    expect(evaluatePredicate({ wearingArmor: false }, naked)).toBe(true);
    expect(evaluatePredicate({ armorCategory: 'heavy' }, armored)).toBe(true);
    expect(evaluatePredicate({ armorCategory: 'light' }, armored)).toBe(false);
    expect(evaluatePredicate({ wieldingShield: false }, armored)).toBe(false);
  });

  it('is false for attack predicates outside an attack', () => {
    expect(evaluatePredicate({ attackKind: 'melee' }, naked)).toBe(false);
    expect(evaluatePredicate({ attackKind: 'melee' }, { ...naked, attack: { kind: 'melee', properties: [] } })).toBe(true);
    expect(evaluatePredicate({ weaponProperty: 'finesse' }, { ...naked, attack: { kind: 'melee', properties: ['finesse'] } })).toBe(true);
  });

  it('combines with all/any', () => {
    expect(evaluatePredicate({ all: [{ wearingArmor: true }, { wieldingShield: true }] }, armored)).toBe(true);
    expect(evaluatePredicate({ all: [{ wearingArmor: true }, { wieldingShield: false }] }, armored)).toBe(false);
    expect(evaluatePredicate({ any: [{ wearingArmor: false }, { wieldingShield: true }] }, armored)).toBe(true);
  });
});
