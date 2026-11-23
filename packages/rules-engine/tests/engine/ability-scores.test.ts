import { describe, expect, it } from 'vitest';
import { rollAbilityScores, usesRolledValues } from '../../src/engine/ability-scores';
import { type Rng, seededRng } from '../../src/engine/dice';

/** RNG que devolve os valores em sequência. */
const fixed = (values: number[]): Rng => {
  let i = 0;
  return { roll: () => values[i++ % values.length] ?? 1 };
};

describe('random ability scores (SRD 5.2.1 p. 20)', () => {
  it('rolls six sets of 4d6 and keeps the highest three', () => {
    const sets = rollAbilityScores(fixed([6, 1, 4, 3]));
    expect(sets).toHaveLength(6);
    expect(sets[0]).toEqual({ dice: [6, 1, 4, 3], dropped: 1, total: 13 });
  });

  it('drops only one die when the lowest repeats', () => {
    expect(rollAbilityScores(fixed([2, 5, 2, 6]))[0]).toEqual({ dice: [2, 5, 2, 6], dropped: 0, total: 13 });
  });

  it('always lands between 3 and 18', () => {
    const totals = rollAbilityScores(seededRng(7)).map((s) => s.total);
    expect(totals.every((t) => t >= 3 && t <= 18)).toBe(true);
  });

  it('checks that the assignment uses each rolled value once', () => {
    const rolled = [15, 12, 12, 10, 9, 8];
    expect(usesRolledValues({ str: 12, dex: 15, con: 12, int: 8, wis: 10, cha: 9 }, rolled)).toBe(true);
    expect(usesRolledValues({ str: 15, dex: 15, con: 12, int: 8, wis: 10, cha: 9 }, rolled)).toBe(false);
    expect(usesRolledValues({ str: 12, dex: 15, con: 12, int: 8, wis: 10, cha: 9 }, [15, 12, 12])).toBe(false);
  });
});
