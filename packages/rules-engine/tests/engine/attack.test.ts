import { describe, expect, it } from 'vitest';
import { creatureDefenses, criticalDice, resolveAttack, rollActionDamage } from '../../src/engine/attack';
import { damageNotes } from '../../src/engine/damage';
import type { Rng } from '../../src/engine/dice';
import { loadSrdCompendium } from '../../src/srd';

const compendium = loadSrdCompendium();
const creature = (id: string) => {
  const c = compendium.creatures.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const fixed = (values: number[]): Rng => {
  let i = 0;
  return { roll: () => values[i++ % values.length] ?? 1 };
};
const NONE = { damageReductions: [], resistances: [], vulnerabilities: [], damageImmunities: [], conditionImmunities: [] };

describe('monster defenses and damage', () => {
  it('reads resistances, vulnerabilities and immunities from the stat block', () => {
    const { defenses } = creatureDefenses(creature('skeleton'));
    expect(defenses.vulnerabilities.map((v) => v.damageType)).toEqual(['bludgeoning']);
    expect(defenses.damageImmunities.map((v) => v.damageType)).toEqual(['poison']);
    expect(defenses.conditionImmunities.map((c) => c.condition)).toEqual(['exhaustion', 'poisoned']);
  });

  it('doubles only the dice on a critical hit', () => {
    expect(criticalDice('1d6+2')).toBe('2d6+2');
    expect(criticalDice('2d8+1d4-1')).toBe('4d8+2d4-1');
    const [scimitar] = creature('goblin_warrior').actions.filter((a) => a.kind === 'attack');
    const groups = rollActionDamage(scimitar?.kind === 'attack' ? scimitar.damage : [], true, fixed([3, 4]));
    expect(groups).toEqual([{ dice: '2d6+2', type: 'slashing', rolls: [{ sides: 6, value: 3 }, { sides: 6, value: 4 }], total: 9 }]);
  });
});

describe('attack against a target', () => {
  const damage = (critical: boolean) => ({ groups: [{ dice: critical ? '2d8' : '1d8', type: 'bludgeoning' as const, rolls: [], total: critical ? 10 : 5 }], bonus: 3 });

  it('hits on AC or more and applies the target defenses', () => {
    const { defenses } = creatureDefenses(creature('skeleton'));
    const result = resolveAttack({ d20: { modifier: 5, mode: 'normal' }, targetAc: 14, rollDamage: damage, defenses }, fixed([9]));
    expect(result).toMatchObject({ hit: true, critical: false });
    // 5 + 3 de concussão, vulnerável: 16.
    expect(result.damage?.applied.total).toBe(16);
    expect(damageNotes(result.damage?.applied ?? { total: 0, instances: [] })).toEqual(['Vulnerabilidade a Concussão: 8 → 16 (Skeleton)']);
  });

  it('misses below AC and on a natural 1; a natural 20 always hits as a critical', () => {
    expect(resolveAttack({ d20: { modifier: 5, mode: 'normal' }, targetAc: 14, rollDamage: damage, defenses: NONE }, fixed([8])).hit).toBe(false);
    expect(resolveAttack({ d20: { modifier: 30, mode: 'normal' }, targetAc: 14, rollDamage: damage, defenses: NONE }, fixed([1])).hit).toBe(false);
    const crit = resolveAttack({ d20: { modifier: -5, mode: 'normal' }, targetAc: 30, rollDamage: damage, defenses: NONE }, fixed([20]));
    expect(crit).toMatchObject({ hit: true, critical: true });
    expect(crit.damage?.applied.total).toBe(13);
  });
});
