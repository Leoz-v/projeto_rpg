import { describe, expect, it } from 'vitest';
import { resolveAttack } from '../../src/engine/attack';
import { rollD20 } from '../../src/engine/d20';
import type { Rng } from '../../src/engine/dice';
import { addInspirationDie, inspirationRollOf, inspirationUseless } from '../../src/engine/inspiration';
import { d20StepNotes } from '../../src/engine/sheet-roll';
import type { Defenses, SourceLabel } from '../../src/engine/types';
import { EffectSchema } from '../../src/schemas/effect';
import type { CharacterInput } from '../../src/schemas/character';
import halflingBard from '../fixtures/halfling-bard-6.json';
import { loadSrdCompendium } from '../../src/srd';
import { derive } from './helpers';

/** Dados de inspiração (docs/effects-spec.md 3.30 `inspire` e 3.33 `self_inspiration`, nota 0079). */

const fixed = (...values: number[]): Rng => ({ roll: () => values.shift() ?? 1 });
const BARD: SourceLabel = { kind: 'class', id: 'bard', name: 'Bardic Inspiration' };
const NO_DEFENSES: Defenses = { damageReductions: [], resistances: [], vulnerabilities: [], damageImmunities: [], conditionImmunities: [] };
type Fixture = { character: Pick<CharacterInput, 'steps' | 'baseScores'> };
const { character: bard6 } = halflingBard as unknown as Fixture;
const adjustment = (id: string, effects: unknown[]) => ({ id, name: id, effects });
const levels = (n: number) => [...Array.from({ length: 4 }, () => '1d6'), ...Array.from({ length: 16 }, () => `1d${n}`)];

describe('inspiration effects', () => {
  it('validates the inspire part and self_inspiration', () => {
    const use = { type: 'feature_use', id: 'x', name: 'X', targets: 'one', parts: [{ kind: 'inspire', dice: '1d6' }] };
    expect(EffectSchema.safeParse(use).success).toBe(true);
    expect(EffectSchema.safeParse({ ...use, parts: [{ kind: 'inspire', dice: { byLevel: ['1d6'] } }] }).success).toBe(false);
    const self = { type: 'self_inspiration', id: 'p', name: 'P', resource: 'r', dice: '1d8', rolls: ['check'] };
    expect(EffectSchema.safeParse(self).success).toBe(true);
    expect(EffectSchema.safeParse({ ...self, rolls: [] }).success).toBe(false);
    expect(EffectSchema.safeParse({ ...self, rolls: ['damage'] }).success).toBe(false);
  });

  it('resolves self_inspiration with the die of the scale level', () => {
    const sheet = derive({ adjustments: [adjustment('a', [{ type: 'self_inspiration', id: 'p', name: 'P', resource: 'r', dice: { byLevel: levels(8) }, rolls: ['check', 'attack'], keepOnFailure: true }])] });
    expect(sheet.selfInspirations).toEqual([expect.objectContaining({ id: 'p', name: 'P', resourceId: 'r', rolls: ['check', 'attack'], keepOnFailure: true })]);
  });
});

describe('SRD curation (Bardic Inspiration)', () => {
  it('Bard 6 (College of Lore): gives a d8 to another creature, as a Bonus Action', () => {
    const sheet = derive({ steps: bard6.steps, baseScores: bard6.baseScores });
    const use = sheet.featureUses.find((f) => f.id === 'bardic_inspiration');
    expect(use).toMatchObject({ name: 'Bardic Inspiration', action: 'Ação Bônus', targets: 'one', cost: { resourceId: 'bardic_inspiration', amount: 1 }, parts: [{ kind: 'inspire', dice: '1d8' }] });
    // Peerless Skill só no nível 14.
    expect(sheet.selfInspirations).toEqual([]);
  });

  it('the die grows with the Bard level, and Peerless Skill keeps the use on a failure', () => {
    const lore = loadSrdCompendium().subclasses.find((s) => s.id === 'college_of_lore');
    const peerless = lore?.levels.flatMap((l) => l.grants).flatMap((g) => (g.kind === 'feature' ? g.feature.effects : [])).find((e) => e.type === 'self_inspiration');
    expect(peerless).toMatchObject({ id: 'peerless_skill', resource: 'bardic_inspiration', rolls: ['check', 'attack'], keepOnFailure: true });
    const dice = peerless?.type === 'self_inspiration' && typeof peerless.dice === 'object' ? peerless.dice.byLevel : [];
    expect([dice[0], dice[4], dice[9], dice[13], dice[14], dice[19]]).toEqual(['1d6', '1d8', '1d10', '1d10', '1d12', '1d12']);
  });
});

describe('addInspirationDie', () => {
  it('adds the die to the total and records it as a step', () => {
    const roll = rollD20({ modifier: 3, mode: 'normal' }, fixed(8));
    const inspired = addInspirationDie(roll, '1d8', BARD, fixed(5));
    expect(inspired.total).toBe(16);
    expect(d20StepNotes(inspired.steps)).toEqual(['Bardic Inspiration: +5 (1d8)']);
    // O d20 não muda.
    expect(inspired).toMatchObject({ dice: [8], natural: 8, die: 8 });
  });

  it('turns a failure into a success against the DC', () => {
    const roll = rollD20({ modifier: 2, mode: 'normal', dc: 15 }, fixed(10));
    expect(roll.success).toBe(false);
    expect(addInspirationDie(roll, '1d6', BARD, fixed(3), 15).success).toBe(true);
    expect(addInspirationDie(roll, '1d6', BARD, fixed(2), 15).success).toBe(false);
  });

  it('keeps an automatic failure', () => {
    const autoFail: SourceLabel = { kind: 'rule', id: 'paralyzed', name: 'Paralisado' };
    const roll = rollD20({ modifier: 2, mode: 'normal', dc: 10, autoFail: [autoFail] }, fixed(15));
    expect(addInspirationDie(roll, '1d6', BARD, fixed(6), 10).success).toBe(false);
    expect(inspirationUseless(roll, 'save')).toBe('Falha automática: o dado não muda o resultado');
  });

  it('a pre-rolled attack hits with the die (resolveAttack with rolled)', () => {
    const d20 = { modifier: 4, mode: 'normal' as const };
    const missed = rollD20(d20, fixed(9));
    const rollDamage = () => ({ groups: [{ dice: '1d8', type: 'piercing' as const, rolls: [{ sides: 8, value: 6 }], total: 6 }], bonus: 4 });
    expect(resolveAttack({ d20, targetAc: 15, rollDamage, defenses: NO_DEFENSES, rolled: missed }, fixed()).hit).toBe(false);
    const inspired = addInspirationDie(missed, '1d8', BARD, fixed(2));
    const result = resolveAttack({ d20, targetAc: 15, rollDamage, defenses: NO_DEFENSES, rolled: inspired }, fixed());
    expect(result).toMatchObject({ hit: true, critical: false });
    expect(result.damage?.applied.total).toBe(10);
  });

  it('is useless on a natural 1 or 20 of an attack, and on an automatic success', () => {
    expect(inspirationUseless(rollD20({ modifier: 0, mode: 'normal' }, fixed(1)), 'attack')).toBe('O 1 natural sempre erra o ataque');
    expect(inspirationUseless(rollD20({ modifier: 0, mode: 'normal' }, fixed(20)), 'attack')).toBe('O ataque já é um Acerto Crítico');
    expect(inspirationUseless(rollD20({ modifier: 0, mode: 'normal' }, fixed(1)), 'check')).toBeUndefined();
  });

  it('maps sheet roll targets to D20 Test kinds', () => {
    expect(inspirationRollOf({ kind: 'skill' })).toBe('check');
    expect(inspirationRollOf({ kind: 'initiative' })).toBe('check');
    expect(inspirationRollOf({ kind: 'save' })).toBe('save');
    expect(inspirationRollOf({ kind: 'death_save' })).toBe('save');
    expect(inspirationRollOf({ kind: 'attack' })).toBe('attack');
  });
});
