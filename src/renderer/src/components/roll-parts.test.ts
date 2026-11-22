import { describe, expect, it } from 'vitest';
import { rollParts } from './roll-parts';

describe('rollParts', () => {
  it('separates the dice from the flat modifier', () => {
    expect(
      rollParts('2d6+3', [
        { sides: 6, value: 1 },
        { sides: 6, value: 1 },
      ]),
    ).toEqual({
      dice: [
        { sides: 6, value: 1, negative: false },
        { sides: 6, value: 1, negative: false },
      ],
      modifier: 3,
    });
  });

  it('marks dice that subtract and sums every flat term', () => {
    expect(
      rollParts('1d10-1d6+2-5', [
        { sides: 10, value: 7 },
        { sides: 6, value: 4 },
      ]),
    ).toEqual({
      dice: [
        { sides: 10, value: 7, negative: false },
        { sides: 6, value: 4, negative: true },
      ],
      modifier: -3,
    });
  });

  it('handles formulas without dice', () => {
    expect(rollParts('5', [])).toEqual({ dice: [], modifier: 5 });
  });
});
