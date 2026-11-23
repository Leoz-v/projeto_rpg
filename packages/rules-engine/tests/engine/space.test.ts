import { describe, expect, it } from 'vitest';
import { SizeSchema } from '../../src/schemas/common';
import { SPACE_FEET, spaceSquares } from '../../src/engine/space';

describe('creature space (SRD 5.2.1 p. 14)', () => {
  it('follows the Creature Size and Space table', () => {
    expect(SizeSchema.options.map((size) => [size, SPACE_FEET[size], spaceSquares(size)])).toEqual([
      ['tiny', 2.5, 0.5],
      ['small', 5, 1],
      ['medium', 5, 1],
      ['large', 10, 2],
      ['huge', 15, 3],
      ['gargantuan', 20, 4],
    ]);
  });
});
