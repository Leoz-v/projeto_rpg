import { describe, expect, it } from 'vitest';
import type { DerivedSheet } from '../../src/engine/types';
import type { CharacterInput } from '../../src/schemas/character';
import { EffectSchema } from '../../src/schemas/effect';
import { loadSrdCompendium } from '../../src/srd';
import dragonbornPaladin from '../fixtures/dragonborn-paladin-6.json';
import humanCleric from '../fixtures/human-cleric-5.json';
import { derive } from './helpers';

/** Características que forçam salvaguarda (docs/effects-spec.md 3.30, partes `save` e `fail_damage`; nota 0082). */

type Fixture = { character: Pick<CharacterInput, 'steps' | 'baseScores'> };
const fromFixture = (f: unknown): DerivedSheet => {
  const { character } = f as Fixture;
  return derive({ steps: character.steps, baseScores: character.baseScores });
};
const use = (sheet: DerivedSheet, id: string) => sheet.featureUses.find((f) => f.id === id);
const adjustment = (id: string, effects: unknown[]) => ({ id, name: id, effects });

describe('save parts of feature_use', () => {
  it('validates the save and fail_damage parts and many targets', () => {
    const base = { type: 'feature_use', id: 'x', name: 'X', targets: 'many', maxTargets: { ability: 'cha', min: 1 } };
    expect(EffectSchema.safeParse({ ...base, parts: [{ kind: 'save', ability: 'wis', dc: 'spell', conditions: ['frightened'], endsOnDamage: true, onlyTypes: ['undead'] }] }).success).toBe(true);
    expect(EffectSchema.safeParse({ ...base, parts: [{ kind: 'save', ability: 'dex', dc: { ability: 'con' }, damage: { dice: '1d10', type: ['fire', 'cold'] }, onSuccess: 'half' }] }).success).toBe(true);
    expect(EffectSchema.safeParse({ ...base, parts: [{ kind: 'save', ability: 'dex', dc: 12 }] }).success).toBe(false);
    expect(EffectSchema.safeParse({ ...base, parts: [{ kind: 'save', ability: 'dex', dc: 'spell', conditions: ['exhaustion'] }] }).success).toBe(false);
    expect(EffectSchema.safeParse({ ...base, parts: [{ kind: 'fail_damage', count: { ability: 'wis', min: 1 }, sides: 8, type: 'radiant' }] }).success).toBe(true);
  });

  it('a DC from an ability falls back to 8 + proficiency + modifier, and maxTargets is at least one', () => {
    const sheet = derive({
      adjustments: [adjustment('a', [{ type: 'feature_use', id: 'roar', name: 'Rugido', targets: 'many', maxTargets: { ability: 'int', min: 1 }, parts: [{ kind: 'save', ability: 'wis', dc: { ability: 'str' }, conditions: ['frightened'] }] }])],
    });
    const roar = use(sheet, 'roar');
    expect(roar?.maxTargets).toBe(1);
    expect(roar?.parts).toEqual([{ kind: 'save', ability: 'wis', dc: 8 + sheet.proficiencyBonus + sheet.abilities.str.modifier, onSuccess: 'none', conditions: ['frightened'], endsOnDamage: false }]);
  });
});

describe('SRD curation (save features)', () => {
  it('Cleric 5: Divine Spark damage and Turn Undead with Sear Undead, at the Cleric spell save DC', () => {
    const sheet = fromFixture(humanCleric);
    expect(use(sheet, 'divine_spark_damage')).toMatchObject({
      targets: 'one',
      cost: { resourceId: 'channel_divinity', amount: 1 },
      parts: [{ kind: 'save', ability: 'con', dc: 15, damage: { dice: '1d8+4', type: ['necrotic', 'radiant'] }, onSuccess: 'half' }],
    });
    expect(use(sheet, 'turn_undead')).toMatchObject({
      targets: 'many',
      parts: [
        { kind: 'save', ability: 'wis', dc: 15, conditions: ['frightened', 'incapacitated'], endsOnDamage: true, onlyTypes: ['undead'] },
        { kind: 'fail_damage', dice: '4d8', type: 'radiant' },
      ],
    });
  });

  it('Dragonborn Paladin 6 (red): Breath Weapon 2d10 fire, DC 8 + CON + proficiency', () => {
    const sheet = fromFixture(dragonbornPaladin);
    expect(use(sheet, 'breath_weapon')).toMatchObject({
      targets: 'many',
      cost: { resourceId: 'breath_weapon', amount: 1 },
      parts: [{ kind: 'save', ability: 'dex', dc: 13, damage: { dice: '2d10', type: 'fire' }, onSuccess: 'half' }],
    });
    // Abjure Foes só no nível 9.
    expect(use(sheet, 'abjure_foes')).toBeUndefined();
  });

  it('every Draconic Ancestry gives the Breath Weapon of its damage type, and the damage grows at 5, 11 and 17', () => {
    const dragonborn = loadSrdCompendium().species.find((s) => s.id === 'dragonborn');
    const ancestry = dragonborn?.levels.flatMap((l) => l.grants).find((g) => g.kind === 'choice' && g.id === 'draconic_ancestry');
    const options = ancestry?.kind === 'choice' && 'options' in ancestry.options && Array.isArray(ancestry.options.options) ? ancestry.options.options : [];
    expect(options).toHaveLength(10);
    for (const option of options) {
      const effects = option.grants.flatMap((g) => (g.kind === 'effect' ? [g.effect] : []));
      const resistance = effects.find((e) => e.type === 'resistance');
      const breath = effects.find((e) => e.type === 'feature_use');
      const part = breath?.type === 'feature_use' ? breath.parts[0] : undefined;
      expect(part?.kind === 'save' && part.damage?.type).toBe(resistance?.type === 'resistance' ? resistance.damageType : 'missing');
      const dice = part?.kind === 'save' && part.damage && typeof part.damage.dice === 'object' ? part.damage.dice.byLevel : [];
      expect([dice[0], dice[4], dice[10], dice[16]]).toEqual(['1d10', '2d10', '3d10', '4d10']);
    }
  });

  it('Abjure Foes and Intimidating Presence', () => {
    const compendium = loadSrdCompendium();
    const effectsOf = (list: { levels: { grants: unknown[] }[] }[], id: string): unknown[] =>
      list
        .flatMap((c) => c.levels)
        .flatMap((l) => l.grants)
        .flatMap((g) => {
          const grant = g as { kind: string; feature?: { id: string; effects: unknown[] } };
          return grant.kind === 'feature' && grant.feature?.id === id ? grant.feature.effects : [];
        });
    expect(effectsOf(compendium.classes, 'abjure_foes')).toEqual([
      expect.objectContaining({ type: 'feature_use', targets: 'many', maxTargets: { ability: 'cha', min: 1 }, parts: [expect.objectContaining({ kind: 'save', ability: 'wis', dc: 'spell', conditions: ['frightened'], endsOnDamage: true })] }),
    ]);
    expect(effectsOf(compendium.subclasses, 'intimidating_presence')).toEqual([
      { type: 'resource', id: 'intimidating_presence', name: 'Intimidating Presence', max: 1, recharge: 'long_rest' },
      expect.objectContaining({ type: 'feature_use', cost: { resource: 'intimidating_presence', amount: 1 }, parts: [expect.objectContaining({ kind: 'save', ability: 'wis', dc: { ability: 'str' }, conditions: ['frightened'] })] }),
    ]);
  });
});
