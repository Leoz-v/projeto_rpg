import { describe, expect, it } from 'vitest';
import { DEFAULT_VISION_PROFILE, type VisionProfile } from 'rules-engine/vision';
import {
  defaultMapFog,
  defaultMapLighting,
  emptyFogBits,
  encodeFogBits,
  NO_CONDITIONS,
  setFogCell,
  type GameMap,
  type Token,
  WORLD_UNITS_PER_CELL,
} from '../../../shared/protocol';
import {
  clampFogCell,
  fillFogImageData,
  fillVisionMaskImageData,
  fogSignature,
  MASK_BRIGHT,
  MASK_DARKVISION_BW,
  MASK_GM_DARKNESS,
  MASK_UNSEEN,
  worldToFogCell,
} from './fog-render';

const MAP_ID = '00000000-0000-4000-8000-000000000001';
const PLAYER_ID = '00000000-0000-4000-8000-000000000010';
const TOKEN_ID = '00000000-0000-4000-8000-000000000099';
const WALL_ID = '00000000-0000-4000-8000-000000000201';
const LIGHT_ID = '00000000-0000-4000-8000-000000000301';
const DARK_ID = '00000000-0000-4000-8000-000000000302';
const DAY_ID = '00000000-0000-4000-8000-000000000303';

function pixelAlpha(data: Uint8ClampedArray, width: number, col: number, row: number): number {
  return data[(row * width + col) * 4 + 3] ?? -1;
}

function pixelRgba(data: Uint8ClampedArray, width: number, col: number, row: number): [number, number, number, number] {
  const offset = (row * width + col) * 4;
  return [
    data[offset] ?? -1,
    data[offset + 1] ?? -1,
    data[offset + 2] ?? -1,
    data[offset + 3] ?? -1,
  ];
}

function makeCorridorMap(width: number, height: number, override?: Partial<GameMap>): GameMap {
  return {
    id: MAP_ID,
    name: 'Corredor',
    width,
    height,
    background: null,
    cellPx: null,
    scene3d: null,
    fog: defaultMapFog(width, height),
    walls: [],
    lighting: defaultMapLighting(),
    lights: [],
    propLightOverrides: {},
    ...override,
  };
}

function makeHero(override?: Partial<Token>): Token {
  return {
    id: TOKEN_ID,
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
    ...override,
  };
}

describe('fog-render', () => {
  it('renders clear, explored dimmed shroud, auto opaque, and manual opaque for players', () => {
    const manual = emptyFogBits(6, 1);
    setFogCell(manual, 6, 1, 0, true); // cell 1 covered by manual fog even though adjacent to hero
    const explored = emptyFogBits(6, 1);
    setFogCell(explored, 6, 4, 0, true); // cell 4 previously seen, now out of view

    const map = makeCorridorMap(6, 1, {
      fog: {
        ...defaultMapFog(6, 1),
        manual: encodeFogBits(manual),
        autoEnabled: true,
        visionFeet: 5,
        rememberExplored: true,
        explored: { [PLAYER_ID]: encodeFogBits(explored) },
      },
    });
    const hero = makeHero();

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

    // GM selecting a token previews that token's live vision + explored unlocked map (100% opaque unseen/manual, dark explored, clear live)
    const gmPreview = new Uint8ClampedArray(6 * 1 * 4);
    fillFogImageData(gmPreview, map, [hero], { role: 'gm', playerId: 'gm', previewTokenId: hero.id });
    expect(pixelAlpha(gmPreview, 6, 0, 0)).toBe(0); // currently seen = normal
    expect(pixelAlpha(gmPreview, 6, 4, 0)).toBe(145); // seen before = dark
    expect(pixelAlpha(gmPreview, 6, 5, 0)).toBe(255); // not seen = opaque black/fog
    expect(pixelAlpha(gmPreview, 6, 1, 0)).toBe(255); // manual fog = opaque black/fog
  });

  it('produces selective B&W Darkvision in unlit cells while keeping lit cells full color in the same frame', () => {
    const hero = makeHero();
    const map = makeCorridorMap(8, 1, {
      lighting: defaultMapLighting('interior', 'night'),
      fog: { ...defaultMapFog(8, 1), autoEnabled: true, visionFeet: 60 },
      lights: [
        {
          id: LIGHT_ID,
          name: 'Tocha',
          kind: 'light',
          enabled: true,
          brightFeet: 10,
          dimFeet: 0,
          darknessFeet: 0,
          spellLevel: null,
          angleDeg: 360,
          directionDeg: 0,
          color: '#ff9442',
          flicker: true,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'point', x: 0.5, y: 0.5 },
          ownerId: PLAYER_ID,
        },
      ],
    });

    const elfProfiles: Record<string, VisionProfile> = {
      [TOKEN_ID]: { ...DEFAULT_VISION_PROFILE, darkvisionFeet: 60 },
    };
    const elfMask = new Uint8ClampedArray(8 * 1 * 4);
    fillVisionMaskImageData(elfMask, map, [hero], { role: 'player', playerId: PLAYER_ID }, { visionProfiles: elfProfiles });
    expect(pixelRgba(elfMask, 8, 0, 0)).toEqual([...MASK_BRIGHT]); // lit cell -> full color (desaturate = 0)
    expect(pixelRgba(elfMask, 8, 5, 0)).toEqual([...MASK_DARKVISION_BW]); // unlit cell -> B&W (desaturate = 255)

    const humanProfiles: Record<string, VisionProfile> = {
      [TOKEN_ID]: DEFAULT_VISION_PROFILE,
    };
    const humanMask = new Uint8ClampedArray(8 * 1 * 4);
    fillVisionMaskImageData(humanMask, map, [hero], { role: 'player', playerId: PLAYER_ID }, { visionProfiles: humanProfiles });
    expect(pixelRgba(humanMask, 8, 0, 0)).toEqual([...MASK_BRIGHT]);
    expect(pixelRgba(humanMask, 8, 5, 0)).toEqual([...MASK_UNSEEN]);
  });

  it('stops torch light and Darkvision at walls and closed doors, opening when door toggles open', () => {
    const hero = makeHero();
    const wallMap = makeCorridorMap(6, 1, {
      lighting: defaultMapLighting('interior', 'night'),
      fog: { ...defaultMapFog(6, 1), autoEnabled: true, visionFeet: 60 },
      walls: [
        {
          id: WALL_ID,
          x1: 2,
          y1: 0,
          x2: 2,
          y2: 1,
          kind: 'door',
          open: false,
          locked: false,
          layer: 'surface',
          source: 'manual',
        },
      ],
      lights: [
        {
          id: LIGHT_ID,
          name: 'Tocha',
          kind: 'light',
          enabled: true,
          brightFeet: 25,
          dimFeet: 0,
          darknessFeet: 0,
          spellLevel: null,
          angleDeg: 360,
          directionDeg: 0,
          color: '#ff9442',
          flicker: false,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'point', x: 0.5, y: 0.5 },
          ownerId: null,
        },
      ],
    });
    const profiles = { [TOKEN_ID]: { ...DEFAULT_VISION_PROFILE, darkvisionFeet: 60 } };

    const closedMask = new Uint8ClampedArray(6 * 1 * 4);
    fillVisionMaskImageData(closedMask, wallMap, [hero], { role: 'player', playerId: PLAYER_ID }, { visionProfiles: profiles });
    expect(pixelRgba(closedMask, 6, 1, 0)).toEqual([...MASK_BRIGHT]);
    expect(pixelRgba(closedMask, 6, 4, 0)).toEqual([...MASK_UNSEEN]);

    const openMap = { ...wallMap, walls: [{ ...wallMap.walls[0], open: true }] } as GameMap;
    const openMask = new Uint8ClampedArray(6 * 1 * 4);
    fillVisionMaskImageData(openMask, openMap, [hero], { role: 'player', playerId: PLAYER_ID }, { visionProfiles: profiles });
    expect(pixelRgba(openMask, 6, 4, 0)).toEqual([...MASK_BRIGHT]);
  });

  it('handles Magical Darkness suppression, Devil Sight, Daylight override, and GM overview vs token preview', () => {
    const hero = makeHero();
    const darkMap = makeCorridorMap(6, 1, {
      lighting: defaultMapLighting('interior', 'night'),
      fog: { ...defaultMapFog(6, 1), autoEnabled: true, visionFeet: 60 },
      lights: [
        {
          id: DARK_ID,
          name: 'Darkness',
          kind: 'darkness',
          enabled: true,
          brightFeet: 0,
          dimFeet: 0,
          darknessFeet: 15,
          spellLevel: 2,
          angleDeg: 360,
          directionDeg: 0,
          color: '#000000',
          flicker: false,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'point', x: 2.5, y: 0.5 },
          ownerId: null,
        },
      ],
    });

    const elfProfile: VisionProfile = { ...DEFAULT_VISION_PROFILE, darkvisionFeet: 60 };
    const elfMask = new Uint8ClampedArray(6 * 1 * 4);
    fillVisionMaskImageData(elfMask, darkMap, [hero], { role: 'player', playerId: PLAYER_ID }, { visionProfiles: { [TOKEN_ID]: elfProfile } });
    expect(pixelRgba(elfMask, 6, 2, 0)).toEqual([...MASK_UNSEEN]); // magical darkness blinds normal darkvision

    const devilProfile: VisionProfile = { ...DEFAULT_VISION_PROFILE, magicalDarknessVisionFeet: 120 };
    const devilMask = new Uint8ClampedArray(6 * 1 * 4);
    fillVisionMaskImageData(devilMask, darkMap, [hero], { role: 'player', playerId: PLAYER_ID }, { visionProfiles: { [TOKEN_ID]: devilProfile } });
    expect(pixelRgba(devilMask, 6, 2, 0)).toEqual([...MASK_BRIGHT]);

    const daylightMap = makeCorridorMap(6, 1, {
      ...darkMap,
      lights: [
        ...darkMap.lights,
        {
          id: DAY_ID,
          name: 'Daylight',
          kind: 'light',
          enabled: true,
          brightFeet: 30,
          dimFeet: 0,
          darknessFeet: 0,
          spellLevel: 3,
          angleDeg: 360,
          directionDeg: 0,
          color: '#fff9e8',
          flicker: false,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'point', x: 2.5, y: 0.5 },
          ownerId: null,
        },
      ],
    });
    const daylightMask = new Uint8ClampedArray(6 * 1 * 4);
    fillVisionMaskImageData(daylightMask, daylightMap, [hero], { role: 'player', playerId: PLAYER_ID }, { visionProfiles: { [TOKEN_ID]: elfProfile } });
    expect(pixelRgba(daylightMask, 6, 2, 0)).toEqual([...MASK_BRIGHT]);

    // GM overview keeps unlit dark cells readable (brightness > 0, not opaque black)
    const gmOverview = new Uint8ClampedArray(6 * 1 * 4);
    fillVisionMaskImageData(gmOverview, makeCorridorMap(6, 1, { lighting: defaultMapLighting('interior', 'night') }), [hero], { role: 'gm', playerId: 'gm' });
    expect(pixelRgba(gmOverview, 6, 2, 0)).toEqual([...MASK_GM_DARKNESS]);

    // GM token preview on Elf shows B&W darkvision at unlit cell and opaque unseen outside 60 ft
    const wideDarkMap = makeCorridorMap(20, 1, {
      lighting: defaultMapLighting('interior', 'night'),
      fog: { ...defaultMapFog(20, 1), autoEnabled: true },
    });
    const gmPreview = new Uint8ClampedArray(20 * 1 * 4);
    fillVisionMaskImageData(
      gmPreview,
      wideDarkMap,
      [hero],
      { role: 'gm', playerId: 'gm', previewTokenId: TOKEN_ID },
      { visionProfiles: { [TOKEN_ID]: elfProfile } },
    );
    expect(pixelRgba(gmPreview, 20, 5, 0)).toEqual([...MASK_DARKVISION_BW]);
    expect(pixelRgba(gmPreview, 20, 18, 0)).toEqual([...MASK_UNSEEN]);
  });

  it('invalidates fogSignature when walls, lights, lighting, prop overrides, or vision profiles change', () => {
    const hero = makeHero();
    const viewer = { role: 'player' as const, playerId: PLAYER_ID };
    const m1 = makeCorridorMap(6, 1, { fog: { ...defaultMapFog(6, 1), autoEnabled: true } });
    const sBase = fogSignature(m1, [hero], viewer, { visionProfiles: { [TOKEN_ID]: DEFAULT_VISION_PROFILE } });
    const sWall = fogSignature(
      { ...m1, walls: [{ id: WALL_ID, x1: 1, y1: 0, x2: 1, y2: 1, kind: 'wall', open: false, locked: false, layer: 'surface', source: 'manual' }] },
      [hero],
      viewer,
      { visionProfiles: { [TOKEN_ID]: DEFAULT_VISION_PROFILE } },
    );
    const sLight = fogSignature(
      { ...m1, lighting: defaultMapLighting('interior', 'night') },
      [hero],
      viewer,
      { visionProfiles: { [TOKEN_ID]: DEFAULT_VISION_PROFILE } },
    );
    const sOverride = fogSignature(
      { ...m1, propLightOverrides: { 'prop:0:torch': 'off' } },
      [hero],
      viewer,
      { visionProfiles: { [TOKEN_ID]: DEFAULT_VISION_PROFILE } },
    );
    const sProfile = fogSignature(m1, [hero], viewer, {
      visionProfiles: { [TOKEN_ID]: { ...DEFAULT_VISION_PROFILE, darkvisionFeet: 60 } },
    });
    expect(new Set([sBase, sWall, sLight, sOverride, sProfile]).size).toBe(5);
  });

  it('converts and clamps world coordinates to fog cells', () => {
    const map = { width: 5, height: 4 };
    expect(worldToFogCell({ x: 2.5 * WORLD_UNITS_PER_CELL, y: 1.9 * WORLD_UNITS_PER_CELL }, map)).toEqual({ x: 2, y: 1 });
    expect(worldToFogCell({ x: -1, y: 0 }, map)).toBeNull();
    expect(worldToFogCell({ x: 5 * WORLD_UNITS_PER_CELL, y: 0 }, map)).toBeNull();
    expect(clampFogCell({ x: -50, y: 9999 }, map)).toEqual({ x: 0, y: 3 });
  });
});
