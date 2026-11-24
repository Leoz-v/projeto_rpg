import { describe, expect, it } from 'vitest';
import { availableUses, resourcesAfterRest } from '../../src/engine/resources';
import type { DerivedSheet } from '../../src/engine/types';
import { EffectSchema } from '../../src/schemas/effect';
import type { CharacterInput } from '../../src/schemas/character';
import orcBarbarian from '../fixtures/orc-barbarian-5.json';
import halflingBard from '../fixtures/halfling-bard-6.json';
import dwarfFighter from '../fixtures/dwarf-fighter-5.json';
import { derive } from './helpers';

/** Recursos de uso limitado (docs/effects-spec.md 3.24, nota 0052). */

type Fixture = { character: Pick<CharacterInput, 'steps' | 'baseScores'> };
const fromFixture = (f: unknown) => {
  const { character } = f as Fixture;
  return derive({ steps: character.steps, baseScores: character.baseScores });
};
const resource = (sheet: DerivedSheet, id: string) => {
  const found = sheet.resources.find((r) => r.id === id);
  return found && { name: found.name, max: found.max, recharge: found.recharge };
};
const adjustment = (id: string, effects: unknown[]) => ({ id, name: id, effects });

describe('resource effect', () => {
  it('validates the maximum and the recharge', () => {
    expect(EffectSchema.safeParse({ type: 'resource', id: 'rage', name: 'Rage', max: 2, recharge: 'short_rest_one' }).success).toBe(true);
    expect(EffectSchema.safeParse({ type: 'resource', id: 'rage', name: 'Rage', max: { byLevel: [2] }, recharge: 'long_rest' }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'resource', id: 'rage', name: 'Rage', max: 2, recharge: 'dawn' }).success).toBe(false);
  });

  it('merges the same id: the largest maximum and the most generous recharge', () => {
    const sheet = derive({
      adjustments: [
        adjustment('a', [{ type: 'resource', id: 'luck', name: 'Sorte', max: 1, recharge: 'long_rest' }]),
        adjustment('b', [{ type: 'resource', id: 'luck', name: 'Outro nome', max: 3, recharge: 'short_rest_one' }]),
        adjustment('c', [{ type: 'resource', id: 'zero', name: 'Zero', max: 0, recharge: 'long_rest' }]),
      ],
    });
    expect(resource(sheet, 'luck')).toEqual({ name: 'Sorte', max: 3, recharge: 'short_rest_one' });
    // Máximo 0 não aparece.
    expect(resource(sheet, 'zero')).toBeUndefined();
  });
});

describe('SRD curation (resources)', () => {
  it('Barbarian 5: 3 uses of Rage, one back on a Short Rest', () => {
    expect(resource(fromFixture(orcBarbarian), 'rage')).toEqual({ name: 'Rage', max: 3, recharge: 'short_rest_one' });
    // Orc: Adrenaline Rush pelo bônus de proficiência (+3 no nível 5) e Relentless Endurance.
    expect(resource(fromFixture(orcBarbarian), 'adrenaline_rush')).toEqual({ name: 'Adrenaline Rush', max: 3, recharge: 'short_rest' });
    expect(resource(fromFixture(orcBarbarian), 'relentless_endurance')).toEqual({ name: 'Relentless Endurance', max: 1, recharge: 'long_rest' });
  });

  it('Bard 6: Bardic Inspiration by Charisma, back on a Short Rest after Font of Inspiration', () => {
    const sheet = fromFixture(halflingBard);
    const cha = sheet.abilities.cha.modifier;
    expect(resource(sheet, 'bardic_inspiration')).toEqual({ name: 'Bardic Inspiration', max: Math.max(1, cha), recharge: 'short_rest' });
  });

  it('Fighter 5: Second Wind 3, Action Surge 1, no Indomitable yet', () => {
    const sheet = fromFixture(dwarfFighter);
    expect(resource(sheet, 'second_wind')).toEqual({ name: 'Second Wind', max: 3, recharge: 'short_rest_one' });
    expect(resource(sheet, 'action_surge')).toEqual({ name: 'Action Surge', max: 1, recharge: 'short_rest' });
    expect(resource(sheet, 'indomitable')).toBeUndefined();
    // Anão: Stonecunning pelo bônus de proficiência.
    expect(resource(sheet, 'stonecunning')).toEqual({ name: 'Stonecunning', max: 3, recharge: 'long_rest' });
  });
});

describe('resources after a rest', () => {
  const resources = [
    { id: 'rage', recharge: 'short_rest_one' as const },
    { id: 'focus_points', recharge: 'short_rest' as const },
    { id: 'lay_on_hands', recharge: 'long_rest' as const },
  ];
  const spent = { rage: 3, focus_points: 4, lay_on_hands: 15, removed: 2 };

  it('a Short Rest restores short_rest fully and one use of short_rest_one', () => {
    expect(resourcesAfterRest(resources, spent, 'short')).toEqual({ rage: 2, lay_on_hands: 15 });
  });

  it('a Long Rest restores everything', () => {
    expect(resourcesAfterRest(resources, spent, 'long')).toEqual({});
  });

  it('counts the uses left, never below 0', () => {
    expect(availableUses(5, spent, 'rage')).toBe(2);
    expect(availableUses(2, spent, 'rage')).toBe(0);
    expect(availableUses(4, spent, 'unknown')).toBe(4);
  });
});
