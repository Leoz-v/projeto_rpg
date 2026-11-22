import { describe, expect, it } from 'vitest';
import { applyDamage } from '../../src/engine/damage';
import { type Rng, rollDice, seededRng } from '../../src/engine/dice';
import type { Defenses, SourceLabel } from '../../src/engine/types';
import { EffectSchema } from '../../src/schemas/effect';
import { derive } from './helpers';

const src = (name: string): SourceLabel => ({ kind: 'item', id: name, name });
/** RNG que devolve os valores dados, em ordem (para rolagens conhecidas). */
const fixed = (...values: number[]): Rng => ({ roll: () => values.shift() ?? 1 });
const none: Defenses = { damageReductions: [], resistances: [], vulnerabilities: [], damageImmunities: [], conditionImmunities: [] };

describe('dice', () => {
  it('rolls every die of the expression and records each one', () => {
    expect(rollDice('2d8+1d4-1', fixed(3, 7, 2))).toEqual({
      expression: '2d8+1d4-1',
      rolls: [{ sides: 8, value: 3 }, { sides: 8, value: 7 }, { sides: 4, value: 2 }],
      total: 11,
    });
    expect(rollDice('5', fixed())).toMatchObject({ rolls: [], total: 5 });
  });

  it('seeds a reproducible RNG within the die range', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const values = Array.from({ length: 200 }, () => a.roll(8));
    expect(Array.from({ length: 200 }, () => b.roll(8))).toEqual(values);
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(8);
  });
});

describe('applyDamage (SRD 5.2.1 order of application)', () => {
  it('follows the SRD example: reduction, then Resistance, then Vulnerability', () => {
    // "Resistance to all damage and Vulnerability to Fire damage, in an aura that reduces all damage by 5.
    // 28 Fire damage: reduced by 5 (to 23), then halved (11), then doubled (22)."
    const defenses: Defenses = {
      ...none,
      damageReductions: [{ damageType: 'fire', amount: '5', source: src('Aura') }],
      resistances: [{ damageType: 'fire', sources: [src('Resistance')] }],
      vulnerabilities: [{ damageType: 'fire', sources: [src('Vulnerability')] }],
    };
    const result = applyDamage(defenses, [{ amount: 28, type: 'fire' }], fixed());
    expect(result.total).toBe(22);
    expect(result.instances[0]?.steps.map((s) => [s.kind, s.before, s.after])).toEqual([
      ['reduction', 28, 23],
      ['resistance', 23, 11],
      ['vulnerability', 11, 22],
    ]);
  });

  it('zeroes the damage with Immunity and skips the other steps', () => {
    const defenses: Defenses = { ...none, damageImmunities: [{ damageType: 'poison', sources: [src('Periapt')] }] };
    const result = applyDamage(defenses, [{ amount: 12, type: 'poison' }, { amount: 4, type: 'slashing' }], fixed());
    expect(result.total).toBe(4);
    expect(result.instances[0]?.steps).toEqual([{ kind: 'immunity', sources: [src('Periapt')], before: 12, after: 0 }]);
  });

  it('never reduces damage below 0', () => {
    const defenses: Defenses = { ...none, damageReductions: [{ damageType: 'cold', amount: '2d8', source: src('Ring of Warmth') }] };
    expect(applyDamage(defenses, [{ amount: 5, type: 'cold' }], fixed(6, 4)).total).toBe(0);
  });
});

describe('SRD items applied automatically', () => {
  it('rolls the Ring of Warmth reduction on each Cold damage while attuned', () => {
    const ring = (attuned: boolean) =>
      derive({ inventory: { items: [{ instanceId: 'r', itemId: 'ring_of_warmth', equipped: true, attuned }] } }).defenses;
    expect(ring(true).damageReductions).toEqual([{ damageType: 'cold', amount: '2d8', source: { kind: 'item', id: 'ring_of_warmth', name: 'Ring of Warmth' } }]);
    expect(ring(false).damageReductions).toEqual([]);
    // 20 de frio, anel rola 3 + 5 = 8: sofre 12. Fogo não é reduzido.
    const result = applyDamage(ring(true), [{ amount: 20, type: 'cold' }, { amount: 20, type: 'fire' }], fixed(3, 5));
    expect(result.instances.map((i) => i.final)).toEqual([12, 20]);
    expect(result.instances[0]?.steps[0]).toMatchObject({ kind: 'reduction', roll: { rolls: [{ sides: 8, value: 3 }, { sides: 8, value: 5 }], total: 8 } });
  });

  it('extends an existing Darkvision with Goggles of Night, or grants it', () => {
    const goggles = { items: [{ instanceId: 'g', itemId: 'goggles_of_night', equipped: true }] };
    const darkvision = (sheet: ReturnType<typeof derive>) => sheet.senses.find((s) => s.sense === 'darkvision')?.range;
    // Anão (Darkvision 120 ft no SRD 5.2.1): 120 + 60.
    expect(darkvision(derive({}))).toBe(120);
    expect(darkvision(derive({ inventory: goggles }))).toBe(180);
    // Humano (sem Darkvision): os óculos concedem 60 ft.
    const human = [
      { kind: 'species' as const, speciesId: 'human', size: 'medium' as const, selections: [] },
    ];
    const humanSheet = derive({ steps: human, inventory: goggles });
    expect(darkvision(humanSheet)).toBe(60);
  });

  it('validates the new effect fields', () => {
    expect(EffectSchema.safeParse({ type: 'damage_reduction', damageType: 'cold', amount: '2d8' }).success).toBe(true);
    expect(EffectSchema.safeParse({ type: 'damage_reduction', damageType: 'cold', amount: '2 d8' }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'grant_sense', sense: 'darkvision', range: 60, extend: true }).success).toBe(true);
    expect(EffectSchema.safeParse({ type: 'grant_sense', sense: 'darkvision', range: 60, extend: false }).success).toBe(false);
  });
});
