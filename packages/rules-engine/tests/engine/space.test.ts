import { describe, expect, it } from 'vitest';
import { SizeSchema } from '../../src/schemas/common';
import { cellDistanceFeet, distanceFeet, FEET_PER_SQUARE, SPACE_FEET, spaceSquares } from '../../src/engine/space';

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

describe('cellDistanceFeet (SRD 5.2.1 grid distance)', () => {
  it('returns 0 ft for the same cell and matches distanceFeet for distinct cells', () => {
    expect(cellDistanceFeet({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(0);
    expect(cellDistanceFeet({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(FEET_PER_SQUARE);
    expect(cellDistanceFeet({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(FEET_PER_SQUARE);
    expect(cellDistanceFeet({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(15);
    expect(cellDistanceFeet({ x: 4, y: 5 }, { x: 1, y: 2 })).toBe(15);
    expect(cellDistanceFeet({ x: 1, y: 2 }, { x: 6, y: 4 })).toBe(
      distanceFeet({ x: 1, y: 2, size: 'medium' }, { x: 6, y: 4, size: 'medium' }),
    );
  });
});
