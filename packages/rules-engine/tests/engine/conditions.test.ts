import { describe, expect, it } from 'vitest';
import { attackedConditions, conditionDefenses, creatureD20, effectiveConditions, ownRollConditions } from '../../src/engine/conditions';
import { rollD20 } from '../../src/engine/d20';
import type { Rng } from '../../src/engine/dice';
import { distanceFeet } from '../../src/engine/space';
import type { Condition } from '../../src/schemas/common';

const set = (...cs: Condition[]) => effectiveConditions(cs);
const names = (list: { name: string }[]) => list.map((s) => s.name);
const fixed = (values: number[]): Rng => {
  let i = 0;
  return { roll: () => values[i++ % values.length] ?? 1 };
};
const NONE = { damageReductions: [], resistances: [], vulnerabilities: [], damageImmunities: [], conditionImmunities: [] };

describe('conditions on the creature own rolls (SRD 5.2.1 Rules Glossary)', () => {
  it('adds the implied conditions', () => {
    expect([...set('unconscious')].sort()).toEqual(['incapacitated', 'prone', 'unconscious']);
    expect([...set('stunned')].sort()).toEqual(['incapacitated', 'stunned']);
  });

  it('gives Disadvantage on attacks to Blinded, Poisoned, Prone and Restrained, and Advantage to Invisible', () => {
    expect(names(ownRollConditions(set('blinded', 'poisoned', 'prone', 'restrained'), { kind: 'attack' }).disadvantage)).toEqual(['Cego', 'Envenenado', 'Caído', 'Impedido']);
    expect(names(ownRollConditions(set('invisible'), { kind: 'attack' }).advantage)).toEqual(['Invisível']);
  });

  it('keeps Frightened and Grappled as reminders on attacks', () => {
    const { situational, disadvantage } = ownRollConditions(set('frightened', 'grappled'), { kind: 'attack' });
    expect(disadvantage).toEqual([]);
    expect(situational.map((s) => s.note)).toEqual(['enquanto a fonte do medo estiver à vista', 'contra quem não é o agarrador']);
  });

  it('affects initiative: Incapacitated with Disadvantage, Invisible with Advantage, Poisoned as an ability check', () => {
    const roll = ownRollConditions(set('stunned', 'invisible', 'poisoned'), { kind: 'initiative' });
    expect(names(roll.disadvantage)).toEqual(['Envenenado', 'Incapacitado']);
    expect(names(roll.advantage)).toEqual(['Invisível']);
  });

  it('fails STR and DEX saves automatically, beating an automatic success', () => {
    const effects = ownRollConditions(set('unconscious'), { kind: 'save', ability: 'dex' });
    expect(names(effects.autoFail)).toEqual(['Inconsciente']);
    expect(ownRollConditions(set('unconscious'), { kind: 'save', ability: 'wis' }).autoFail).toEqual([]);
    const result = rollD20({ modifier: 10, mode: 'normal', dc: 5, autoFail: effects.autoFail, rules: [{ rule: 'auto_success' }] }, fixed([20]));
    expect(result.success).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ kind: 'auto_fail' });
  });
});

describe('conditions of the target of an attack', () => {
  it('gives Advantage against Blinded, Paralyzed, Restrained, Stunned and Unconscious, Disadvantage against Invisible', () => {
    expect(names(attackedConditions(set('restrained'), 30).advantage)).toEqual(['Impedido']);
    expect(names(attackedConditions(set('invisible'), 5).disadvantage)).toEqual(['Invisível']);
  });

  it('uses the distance for Prone and for automatic critical hits', () => {
    expect(names(attackedConditions(set('prone'), 5).advantage)).toEqual(['Caído']);
    expect(names(attackedConditions(set('prone'), 10).disadvantage)).toEqual(['Caído']);
    // Inconsciente também é Caído: de longe, Vantagem e Desvantagem se anulam.
    const far = attackedConditions(set('unconscious'), 30);
    expect(names(far.advantage)).toEqual(['Inconsciente']);
    expect(names(far.disadvantage)).toEqual(['Caído']);
    expect(far.autoCritical).toEqual([]);
    expect(names(attackedConditions(set('paralyzed'), 5).autoCritical)).toEqual(['Paralisado']);
    const unknown = attackedConditions(set('paralyzed', 'prone'), undefined);
    expect(unknown.autoCritical).toEqual([]);
    expect(unknown.reminders).toHaveLength(2);
  });

  it('gives Petrified Resistance to all damage and Immunity to Poisoned', () => {
    const defenses = conditionDefenses(set('petrified'), NONE);
    expect(defenses.resistances).toHaveLength(13);
    expect(defenses.conditionImmunities.map((c) => c.condition)).toEqual(['poisoned']);
    expect(conditionDefenses(set('prone'), NONE)).toBe(NONE);
  });
});

describe('monster d20 with conditions and exhaustion', () => {
  it('subtracts 2 per exhaustion level and applies the conditions and the declared roll', () => {
    const roll = creatureD20({ label: 'Bônus de ataque', modifier: 4 }, { conditions: set('poisoned'), exhaustion: 2 }, { kind: 'attack' }, { advantage: true });
    expect(roll.input).toMatchObject({ modifier: 0, mode: 'normal' });
    expect(roll.parts).toEqual([
      { label: 'Bônus de ataque', value: 4 },
      { label: 'Exaustão 2', value: -4 },
    ]);
    expect(roll.disadvantage).toEqual(['Envenenado']);
    expect(roll.advantage).toEqual(['Declarada na rolagem']);
    const save = creatureD20({ label: 'Salvaguarda do bloco', modifier: 2 }, { conditions: set('paralyzed'), exhaustion: 0 }, { kind: 'save', ability: 'str' });
    expect(save.input.autoFail?.map((s) => s.name)).toEqual(['Paralisado']);
  });
});

describe('distance between creatures on the grid', () => {
  it('counts squares between the spaces, diagonals as 5 ft', () => {
    expect(distanceFeet({ x: 0, y: 0, size: 'medium' }, { x: 1, y: 0, size: 'medium' })).toBe(5);
    expect(distanceFeet({ x: 0, y: 0, size: 'medium' }, { x: 1, y: 1, size: 'medium' })).toBe(5);
    expect(distanceFeet({ x: 0, y: 0, size: 'medium' }, { x: 3, y: 1, size: 'medium' })).toBe(15);
    expect(distanceFeet({ x: 0, y: 0, size: 'medium' }, { x: 0, y: 0, size: 'medium' })).toBe(5);
    // Grande ocupa 2×2: vizinho do lado direito.
    expect(distanceFeet({ x: 0, y: 0, size: 'large' }, { x: 2, y: 1, size: 'medium' })).toBe(5);
    expect(distanceFeet({ x: 0, y: 0, size: 'large' }, { x: 4, y: 0, size: 'medium' })).toBe(15);
  });
});
