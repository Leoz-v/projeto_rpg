import { describe, expect, it } from 'vitest';
import {
  applyFogCells,
  applyFogRect,
  computePlayerVision,
  computeTokenVision,
  decodeFogBits,
  defaultMapFog,
  emptyFogBits,
  encodeFogBits,
  fogByteLength,
  fullFogBits,
  getFogCell,
  isTokenVisibleToPlayer,
  setFogCell,
  unionFogBits,
} from './fog';
import { WORLD_UNITS_PER_CELL } from './constants';
import { type GameMap, type Token } from './state';
import { NO_CONDITIONS } from './common';

const MAP_ID = '00000000-0000-4000-8000-000000000001';
const PLAYER_A = '00000000-0000-4000-8000-000000000010';
const PLAYER_B = '00000000-0000-4000-8000-000000000020';

function makeMap(width = 10, height = 10, overrides?: Partial<GameMap['fog']>): GameMap {
  return {
    id: MAP_ID,
    name: 'Caverna',
    width,
    height,
    background: null,
    cellPx: null,
    scene3d: null,
    fog: { ...defaultMapFog(width, height), ...overrides },
  };
}

function makeToken(id: string, col: number, row: number, opts?: Partial<Token>): Token {
  return {
    id,
    mapId: MAP_ID,
    name: id,
    position: { x: col * WORLD_UNITS_PER_CELL, y: row * WORLD_UNITS_PER_CELL },
    size: 'medium',
    monsterId: null,
    image: null,
    ownerIds: [],
    characterId: null,
    hp: null,
    conditions: NO_CONDITIONS,
    visionFeet: null,
    ...opts,
  };
}

describe('fog bitset helpers', () => {
  it('encodes and decodes cells accurately, masking trailing bits', () => {
    expect(fogByteLength(3, 3)).toBe(2);
    const full = fullFogBits(3, 3);
    const decoded = decodeFogBits(encodeFogBits(full), 3, 3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(getFogCell(decoded, 3, x, y)).toBe(true);
      }
    }
    // 9 bits = 1 full byte + 1 bit in second byte (0x01)
    expect(decoded[0]).toBe(0xff);
    expect(decoded[1]).toBe(0x01);
  });

  it('paints cells, rectangles, and unions bitsets', () => {
    let bits = emptyFogBits(5, 5);
    bits = applyFogCells(bits, 5, 5, [{ x: 1, y: 1 }, { x: 4, y: 4 }], true);
    expect(getFogCell(bits, 5, 1, 1)).toBe(true);
    expect(getFogCell(bits, 5, 4, 4)).toBe(true);
    expect(getFogCell(bits, 5, 2, 2)).toBe(false);

    const rect = applyFogRect(emptyFogBits(5, 5), 5, 5, { x: 2, y: 1 }, { x: 0, y: 2 }, true);
    expect(getFogCell(rect, 5, 0, 1)).toBe(true);
    expect(getFogCell(rect, 5, 2, 2)).toBe(true);
    expect(getFogCell(rect, 5, 3, 1)).toBe(false);

    const merged = unionFogBits(bits, rect);
    expect(getFogCell(merged, 5, 0, 1)).toBe(true);
    expect(getFogCell(merged, 5, 4, 4)).toBe(true);

    const revealed = applyFogCells(merged, 5, 5, [{ x: 4, y: 4 }], false);
    expect(getFogCell(revealed, 5, 4, 4)).toBe(false);
  });
});

describe('vision and token visibility', () => {
  it('computes token vision radius in cells (1 cell = 5 ft)', () => {
    const map = makeMap(10, 10);
    const hero = makeToken('hero', 5, 5, { ownerIds: [PLAYER_A], visionFeet: 10 });
    const vision = computeTokenVision(map, hero, 60);
    // Token's own cell and cells within 2 cells (10 ft) of its footprint
    expect(getFogCell(vision, 10, 5, 5)).toBe(true);
    expect(getFogCell(vision, 10, 7, 5)).toBe(true);
    expect(getFogCell(vision, 10, 3, 5)).toBe(true);
    expect(getFogCell(vision, 10, 8, 5)).toBe(false);
  });

  it('manual fog always overrides automatic vision', () => {
    const manual = emptyFogBits(10, 10);
    setFogCell(manual, 10, 6, 5, true);
    const map = makeMap(10, 10, { manual: encodeFogBits(manual), autoEnabled: true, visionFeet: 30 });
    const hero = makeToken('hero', 5, 5, { ownerIds: [PLAYER_A] });
    const vision = computePlayerVision(map, [hero], PLAYER_A);
    expect(getFogCell(vision, 10, 5, 5)).toBe(true);
    expect(getFogCell(vision, 10, 6, 5)).toBe(false);
  });

  it('hides non-owned tokens under manual fog or outside auto vision, but never hides owned tokens', () => {
    const manual = emptyFogBits(10, 10);
    setFogCell(manual, 10, 2, 2, true);
    const map = makeMap(10, 10, { manual: encodeFogBits(manual), autoEnabled: true, visionFeet: 10 });
    const hero = makeToken('hero', 2, 2, { ownerIds: [PLAYER_A] });
    const nearGoblin = makeToken('goblin-near', 3, 2);
    const manualGoblin = makeToken('goblin-manual', 2, 2);
    const farGoblin = makeToken('goblin-far', 8, 8);
    const tokens = [hero, nearGoblin, manualGoblin, farGoblin];

    expect(isTokenVisibleToPlayer(map, tokens, hero, PLAYER_A)).toBe(true);
    expect(isTokenVisibleToPlayer(map, tokens, nearGoblin, PLAYER_A)).toBe(true);
    expect(isTokenVisibleToPlayer(map, tokens, manualGoblin, PLAYER_A)).toBe(false);
    expect(isTokenVisibleToPlayer(map, tokens, farGoblin, PLAYER_A)).toBe(false);
    // Player B has no tokens on the map, so cannot see any non-owned tokens while autoEnabled
    expect(isTokenVisibleToPlayer(map, tokens, nearGoblin, PLAYER_B)).toBe(false);
  });
});
