import { describe, expect, it } from 'vitest';
import { defaultMapFog, emptyFogBits, encodeFogBits, NO_CONDITIONS, setFogCell, type GameMap, type Token, WORLD_UNITS_PER_CELL } from '../../../shared/protocol';
import { clampFogCell, fillFogImageData, worldToFogCell } from './fog-render';

const MAP_ID = '00000000-0000-4000-8000-000000000001';
const PLAYER_ID = '00000000-0000-4000-8000-000000000010';

function pixelAlpha(data: Uint8ClampedArray, width: number, col: number, row: number): number {
  return data[(row * width + col) * 4 + 3] ?? -1;
}

describe('fog-render', () => {
  it('renders clear, explored dimmed shroud, auto opaque, and manual opaque for players', () => {
    const manual = emptyFogBits(6, 1);
    setFogCell(manual, 6, 1, 0, true); // cell 1 covered by manual fog even though adjacent to hero
    const explored = emptyFogBits(6, 1);
    setFogCell(explored, 6, 4, 0, true); // cell 4 previously seen, now out of view

    const map: GameMap = {
      id: MAP_ID,
      name: 'Corredor',
      width: 6,
      height: 1,
      background: null,
      cellPx: null,
      scene3d: null,
      fog: {
        ...defaultMapFog(6, 1),
        manual: encodeFogBits(manual),
        autoEnabled: true,
        visionFeet: 5,
        rememberExplored: true,
        explored: { [PLAYER_ID]: encodeFogBits(explored) },
      },
    };
    const hero: Token = {
      id: '00000000-0000-4000-8000-000000000099',
      mapId: MAP_ID,
      name: 'Hero',
      position: { x: 0, y: 0 },
      size: 'medium',
      monsterId: null,
      image: null,
      ownerIds: [PLAYER_ID],
      characterId: null,
      hp: null,
      conditions: NO_CONDITIONS,
      visionFeet: null,
    };

    const data = new Uint8ClampedArray(6 * 1 * 4);
    fillFogImageData(data, map, [hero], { role: 'player', playerId: PLAYER_ID });

    expect(pixelAlpha(data, 6, 0, 0)).toBe(0); // in live vision
    expect(pixelAlpha(data, 6, 1, 0)).toBe(255); // manual fog overrides vision
    expect(pixelAlpha(data, 6, 4, 0)).toBeGreaterThan(0); // explored dimmed shroud
    expect(pixelAlpha(data, 6, 4, 0)).toBeLessThan(255);
    expect(pixelAlpha(data, 6, 5, 0)).toBe(255); // never seen -> opaque

    // GM sees manual fog semi-transparent (not opaque) so map remains visible
    const gmData = new Uint8ClampedArray(6 * 1 * 4);
    fillFogImageData(gmData, map, [hero], { role: 'gm', playerId: 'gm' });
    expect(pixelAlpha(gmData, 6, 0, 0)).toBe(0);
    expect(pixelAlpha(gmData, 6, 1, 0)).toBeGreaterThan(0);
    expect(pixelAlpha(gmData, 6, 1, 0)).toBeLessThan(255);
  });

  it('converts and clamps world coordinates to fog cells', () => {
    const map = { width: 5, height: 4 };
    expect(worldToFogCell({ x: 2.5 * WORLD_UNITS_PER_CELL, y: 1.9 * WORLD_UNITS_PER_CELL }, map)).toEqual({ x: 2, y: 1 });
    expect(worldToFogCell({ x: -1, y: 0 }, map)).toBeNull();
    expect(worldToFogCell({ x: 5 * WORLD_UNITS_PER_CELL, y: 0 }, map)).toBeNull();
    expect(clampFogCell({ x: -50, y: 9999 }, map)).toEqual({ x: 0, y: 3 });
  });
});
