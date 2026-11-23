import { describe, expect, it } from 'vitest';
import { availableValues, isComplete } from './score-pool';

describe('score pool', () => {
  const standard = [15, 14, 13, 12, 10, 8];

  it('offers what the other abilities have not taken', () => {
    expect(availableValues(standard, {}, 'str')).toEqual(standard);
    expect(availableValues(standard, { str: 15, dex: 14 }, 'con')).toEqual([13, 12, 10, 8]);
    // O próprio valor do atributo continua na lista, para poder trocar.
    expect(availableValues(standard, { str: 15, dex: 14 }, 'str')).toEqual([15, 13, 12, 10, 8]);
  });

  it('handles repeated rolled values', () => {
    const rolled = [12, 12, 9, 15, 10, 8];
    expect(availableValues(rolled, { str: 12 }, 'dex')).toEqual([15, 12, 10, 9, 8]);
    expect(availableValues(rolled, { str: 12, dex: 12 }, 'con')).toEqual([15, 10, 9, 8]);
  });

  it('knows when all six are assigned', () => {
    expect(isComplete({ str: 15, dex: 14, con: 13, int: 12, wis: 10 })).toBe(false);
    expect(isComplete({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 })).toBe(true);
  });
});
