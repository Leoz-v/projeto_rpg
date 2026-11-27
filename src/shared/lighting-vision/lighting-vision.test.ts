import { describe, expect, it } from 'vitest';
import { DEFAULT_VISION_PROFILE, type VisionProfile } from 'rules-engine/vision';
import type { TerrainHeightfield } from '../collision';
import type { ExtractedPropLight } from '../lighting';
import { WORLD_UNITS_PER_CELL } from '../protocol/constants';
import { defaultMapFog, getFogCell } from '../protocol/fog';
import {
  classifyTokenPerceptionByObserver,
  computeMapLightGrid,
  computePlayerVisionGrid,
  computeTokenVisionGrid,
  isTokenPerceivedByPlayer,
  LIGHT_CODE_BRIGHT,
  LIGHT_CODE_DARKNESS,
  LIGHT_CODE_DIM,
  LIGHT_CODE_MAGICAL_DARKNESS,
  type LightingVisionMapLike,
  type LightingVisionTokenLike,
  PERCEPTION_CODE_BRIGHT_COLOR,
  PERCEPTION_CODE_DARKVISION_BW,
  PERCEPTION_CODE_DIM_COLOR,
  PERCEPTION_CODE_UNSEEN,
} from './index';

const PLAYER_A = '11111111-1111-4111-8111-111111111111';

function makeMap(partial?: Partial<LightingVisionMapLike>): LightingVisionMapLike {
  const width = partial?.width ?? 20;
  const height = partial?.height ?? 20;
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    width,
    height,
    fog: { ...defaultMapFog(width, height), autoEnabled: true },
    walls: [],
    lighting: { environment: 'exterior', timeOfDay: 'day', ambientOverride: null },
    lights: [],
    propLightOverrides: {},
    ...partial,
  };
}

function makeToken(id: string, xCell: number, yCell: number, ownerIds: readonly string[] = []): LightingVisionTokenLike {
  return {
    id,
    mapId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    position: { x: xCell * WORLD_UNITS_PER_CELL, y: yCell * WORLD_UNITS_PER_CELL },
    size: 'medium',
    ownerIds,
    characterId: null,
    visionFeet: null,
  };
}

describe('shared lighting-vision solver', () => {
  it('blocks both light and vision across walls and closed doors, while open doors and windows pass both', () => {
    const observer = makeToken('t-obs', 2, 5, [PLAYER_A]);
    const target = makeToken('t-tgt', 6, 5);
    const baseWall = {
      id: 'w1',
      x1: 4,
      y1: 0,
      x2: 4,
      y2: 10,
      kind: 'wall' as const,
      open: false,
      locked: false,
      layer: 'surface' as const,
      source: 'manual' as const,
    };

    const walledMap = makeMap({
      lighting: { environment: 'interior', timeOfDay: 'night', ambientOverride: null },
      walls: [baseWall],
      lights: [
        {
          id: 'l1',
          name: 'Tocha',
          kind: 'light',
          enabled: true,
          brightFeet: 20,
          dimFeet: 20,
          darknessFeet: 0,
          spellLevel: null,
          angleDeg: 360,
          directionDeg: 0,
          color: '#ff9442',
          flicker: true,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'point', x: 2.5, y: 5.5 },
          ownerId: null,
        },
      ],
    });

    const gridBlocked = computeMapLightGrid(walledMap, [observer, target]);
    expect(gridBlocked.levels[5 * 20 + 2]).toBe(LIGHT_CODE_BRIGHT);
    expect(gridBlocked.levels[5 * 20 + 6]).toBe(LIGHT_CODE_DARKNESS);
    expect(
      isTokenPerceivedByPlayer(
        walledMap,
        [observer, target],
        target,
        () => ({ ...DEFAULT_VISION_PROFILE, darkvisionFeet: 60 }),
        (t) => t.ownerIds.includes(PLAYER_A),
        { lightGrid: gridBlocked },
      ),
    ).toBe(false);

    // Closed door still blocks; open door lets both light and vision pass
    const closedDoorMap = makeMap({ ...walledMap, walls: [{ ...baseWall, kind: 'door', open: false }] });
    expect(computeMapLightGrid(closedDoorMap, [observer]).levels[5 * 20 + 6]).toBe(LIGHT_CODE_DARKNESS);

    const openDoorMap = makeMap({ ...walledMap, walls: [{ ...baseWall, kind: 'door', open: true }] });
    const gridOpen = computeMapLightGrid(openDoorMap, [observer, target]);
    expect(gridOpen.levels[5 * 20 + 5]).toBe(LIGHT_CODE_BRIGHT);
    expect(
      isTokenPerceivedByPlayer(
        openDoorMap,
        [observer, target],
        target,
        () => DEFAULT_VISION_PROFILE,
        (t) => t.ownerIds.includes(PLAYER_A),
        { lightGrid: gridOpen },
      ),
    ).toBe(true);

    // Window allows both light and vision through (target at x=6 is 20 ft from torch -> bright_color)
    const windowMap = makeMap({ ...walledMap, walls: [{ ...baseWall, kind: 'window', open: false }] });
    const gridWindow = computeMapLightGrid(windowMap, [observer, target]);
    expect(gridWindow.levels[5 * 20 + 5]).toBe(LIGHT_CODE_BRIGHT);
    expect(
      classifyTokenPerceptionByObserver(windowMap, observer, DEFAULT_VISION_PROFILE, target, gridWindow),
    ).toBe('bright_color');
  });

  it('distinguishes bright/dim color vs darkvision B&W and unseen cells in a dark dungeon', () => {
    const observer = makeToken('t-obs', 2, 2, [PLAYER_A]);
    const map = makeMap({
      lighting: { environment: 'interior', timeOfDay: 'night', ambientOverride: null },
      lights: [
        {
          id: 'l-torch',
          name: 'Tocha',
          kind: 'light',
          enabled: true,
          brightFeet: 10,
          dimFeet: 10,
          darknessFeet: 0,
          spellLevel: null,
          angleDeg: 360,
          directionDeg: 0,
          color: '#ff9442',
          flicker: true,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'token', tokenId: observer.id },
          ownerId: null,
        },
      ],
    });
    const lightGrid = computeMapLightGrid(map, [observer]);
    // At observer cell (2,2): bright; 3 cells away (5,2) = 15 ft: dim; 6 cells away (8,2) = 30 ft: darkness
    expect(lightGrid.levels[2 * 20 + 2]).toBe(LIGHT_CODE_BRIGHT);
    expect(lightGrid.levels[2 * 20 + 5]).toBe(LIGHT_CODE_DIM);
    expect(lightGrid.levels[2 * 20 + 8]).toBe(LIGHT_CODE_DARKNESS);

    const human = computeTokenVisionGrid(map, observer, DEFAULT_VISION_PROFILE, lightGrid);
    expect(human.perception[2 * 20 + 2]).toBe(PERCEPTION_CODE_BRIGHT_COLOR);
    expect(human.perception[2 * 20 + 5]).toBe(PERCEPTION_CODE_DIM_COLOR);
    expect(human.perception[2 * 20 + 8]).toBe(PERCEPTION_CODE_UNSEEN);
    expect(getFogCell(human.seenBits, 20, 8, 2)).toBe(false);

    const elfProfile: VisionProfile = { ...DEFAULT_VISION_PROFILE, darkvisionFeet: 60 };
    const elf = computeTokenVisionGrid(map, observer, elfProfile, lightGrid);
    expect(elf.perception[2 * 20 + 2]).toBe(PERCEPTION_CODE_BRIGHT_COLOR);
    expect(elf.perception[2 * 20 + 5]).toBe(PERCEPTION_CODE_BRIGHT_COLOR); // dim -> bright for Darkvision
    expect(elf.perception[2 * 20 + 8]).toBe(PERCEPTION_CODE_DARKVISION_BW); // darkness -> B&W
    expect(getFogCell(elf.seenBits, 20, 8, 2)).toBe(true);
    expect(elf.perception[2 * 20 + 16]).toBe(PERCEPTION_CODE_UNSEEN); // 70 ft > 60 ft darkvision
  });

  it('handles magical Darkness precedence vs cantrip Light, Devil Sight, Truesight, and Daylight', () => {
    const observer = makeToken('t-obs', 2, 5, [PLAYER_A]);
    const darknessBase = makeMap({
      lighting: { environment: 'exterior', timeOfDay: 'day', ambientOverride: null },
      lights: [
        {
          id: 'l-cantrip',
          name: 'Light',
          kind: 'light',
          enabled: true,
          brightFeet: 20,
          dimFeet: 20,
          darknessFeet: 0,
          spellLevel: 0,
          angleDeg: 360,
          directionDeg: 0,
          color: '#fff1c4',
          flicker: false,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'point', x: 6.5, y: 5.5 },
          ownerId: null,
        },
        {
          id: 'l-dark',
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
          attach: { kind: 'point', x: 6.5, y: 5.5 },
          ownerId: null,
        },
      ],
    });

    const darkGrid = computeMapLightGrid(darknessBase, [observer]);
    expect(darkGrid.levels[5 * 20 + 6]).toBe(LIGHT_CODE_MAGICAL_DARKNESS);

    const elfVision = computeTokenVisionGrid(darknessBase, observer, { ...DEFAULT_VISION_PROFILE, darkvisionFeet: 60 }, darkGrid);
    expect(elfVision.perception[5 * 20 + 6]).toBe(PERCEPTION_CODE_UNSEEN);

    const devilVision = computeTokenVisionGrid(
      darknessBase,
      observer,
      { ...DEFAULT_VISION_PROFILE, magicalDarknessVisionFeet: 120 },
      darkGrid,
    );
    expect(devilVision.perception[5 * 20 + 6]).toBe(PERCEPTION_CODE_BRIGHT_COLOR);

    const trueVision = computeTokenVisionGrid(
      darknessBase,
      observer,
      { ...DEFAULT_VISION_PROFILE, truesightFeet: 60 },
      darkGrid,
    );
    expect(trueVision.perception[5 * 20 + 6]).toBe(PERCEPTION_CODE_BRIGHT_COLOR);

    // Level 3 Daylight overcomes Level 2 Darkness
    const daylightMap = makeMap({
      ...darknessBase,
      lights: [
        ...darknessBase.lights,
        {
          id: 'l-daylight',
          name: 'Daylight',
          kind: 'light',
          enabled: true,
          brightFeet: 30,
          dimFeet: 30,
          darknessFeet: 0,
          spellLevel: 3,
          angleDeg: 360,
          directionDeg: 0,
          color: '#fff9e8',
          flicker: false,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'point', x: 6.5, y: 5.5 },
          ownerId: null,
        },
      ],
    });
    const litGrid = computeMapLightGrid(daylightMap, [observer]);
    expect(litGrid.levels[5 * 20 + 6]).toBe(LIGHT_CODE_BRIGHT);
  });

  it('supports directional cones, token-carried lights, and propLightOverrides without editing scene3d', () => {
    const carrier = makeToken('t-car', 5, 5, [PLAYER_A]);
    const propLights: ExtractedPropLight[] = [
      {
        id: 'prop:0:greyvein.standing_torch',
        propIndex: 0,
        key: 'greyvein.standing_torch',
        name: 'Tocha',
        x: 14.5,
        y: 5.5,
        layer: 'surface',
        elevationFeet: 7,
        brightFeet: 10,
        dimFeet: 10,
        color: '#ff8a2b',
        flicker: true,
      },
    ];
    const map = makeMap({
      lighting: { environment: 'interior', timeOfDay: 'night', ambientOverride: null },
      lights: [
        {
          id: 'l-cone',
          name: 'Bullseye',
          kind: 'light',
          enabled: true,
          brightFeet: 20,
          dimFeet: 0,
          darknessFeet: 0,
          spellLevel: null,
          angleDeg: 60,
          directionDeg: 0, // +X
          color: '#ffd280',
          flicker: true,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'token', tokenId: carrier.id },
          ownerId: null,
        },
      ],
    });

    const g1 = computeMapLightGrid(map, [carrier], { bakedPropLights: propLights });
    expect(g1.levels[5 * 20 + 7]).toBe(LIGHT_CODE_BRIGHT); // ahead in +X cone
    expect(g1.levels[5 * 20 + 3]).toBe(LIGHT_CODE_DARKNESS); // behind carrier
    expect(g1.levels[5 * 20 + 14]).toBe(LIGHT_CODE_BRIGHT); // baked 3D torch active

    const extinguished = makeMap({ ...map, propLightOverrides: { 'prop:0:greyvein.standing_torch': 'off' } });
    const g2 = computeMapLightGrid(extinguished, [carrier], { bakedPropLights: propLights });
    expect(g2.levels[5 * 20 + 14]).toBe(LIGHT_CODE_DARKNESS);
  });

  it('occludes across 3D terrain heightfields and between surface and interior except through surface holes', () => {
    // 10x10 heightfield: column x>=5 rises into a 20 ft tall plateau (20 / (5/128) = 512 units)
    const width = 10;
    const length = 10;
    const heights = new Array<number>((width + 1) * (length + 1)).fill(0);
    for (let z = 0; z <= length; z++) {
      for (let x = 5; x <= width; x++) {
        heights[z * (width + 1) + x] = 512;
      }
    }
    const holes = new Array<number>(width * length).fill(0);
    holes[5 * width + 2] = 1; // hole at tile (2, 5)
    const heightfield: TerrainHeightfield = {
      width,
      length,
      heights,
      holes,
      interior: { heights: new Array<number>((width + 1) * (length + 1)).fill(0), holes: new Array<number>(width * length).fill(0) },
      interiorDepthFeet: 12,
    };

    const obs = makeToken('t-obs', 2, 5, [PLAYER_A]);
    const behindPlateau = makeToken('t-far', 8, 5);
    const map = makeMap({ width, height: length });

    const gridSurface = computeMapLightGrid(map, [obs, behindPlateau], { layer: 'surface', heightfield });
    expect(
      isTokenPerceivedByPlayer(
        map,
        [obs, behindPlateau],
        behindPlateau,
        () => DEFAULT_VISION_PROFILE,
        (t) => t.ownerIds.includes(PLAYER_A),
        { layer: 'surface', heightfield, lightGrid: gridSurface },
      ),
    ).toBe(false);

    // Interior ambient light: dark except under surface hole (2, 5)
    const gridInterior = computeMapLightGrid(map, [], { layer: 'interior', heightfield });
    expect(gridInterior.levels[5 * width + 2]).toBe(LIGHT_CODE_BRIGHT);
    expect(gridInterior.levels[5 * width + 7]).toBe(LIGHT_CODE_DARKNESS);

    // Surface light source does not leak to sealed interior cell (7, 5)
    const surfaceTorchMap = makeMap({
      width,
      height: length,
      lighting: { environment: 'exterior', timeOfDay: 'night', ambientOverride: null },
      lights: [
        {
          id: 'l-surf',
          name: 'Tocha',
          kind: 'light',
          enabled: true,
          brightFeet: 20,
          dimFeet: 20,
          darknessFeet: 0,
          spellLevel: null,
          angleDeg: 360,
          directionDeg: 0,
          color: '#ff9442',
          flicker: false,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'point', x: 7.5, y: 5.5 },
          ownerId: null,
        },
      ],
    });
    const gridInteriorUnderNight = computeMapLightGrid(surfaceTorchMap, [], { layer: 'interior', heightfield });
    expect(gridInteriorUnderNight.levels[5 * width + 7]).toBe(LIGHT_CODE_DARKNESS);
    // Light at the surface hole (2.5, 5.5) shines through to interior (2, 5)
    const surfTorch = surfaceTorchMap.lights[0];
    if (!surfTorch) throw new Error('Expected surface torch');
    const holeTorchMap = makeMap({
      ...surfaceTorchMap,
      lights: [{ ...surfTorch, attach: { kind: 'point', x: 2.5, y: 5.5 } }],
    });
    const gridInteriorHole = computeMapLightGrid(holeTorchMap, [], { layer: 'interior', heightfield });
    expect(gridInteriorHole.levels[5 * width + 2]).toBe(LIGHT_CODE_BRIGHT);
  });

  it('detects grounded tokens behind walls via Tremorsense without revealing floor cells, and respects Blinded', () => {
    const obs = makeToken('t-obs', 2, 5, [PLAYER_A]);
    const enemy = makeToken('t-enemy', 4, 5);
    const map = makeMap({
      walls: [
        {
          id: 'w1',
          x1: 3.5,
          y1: 0,
          x2: 3.5,
          y2: 10,
          kind: 'wall',
          open: false,
          locked: false,
          layer: 'surface',
          source: 'manual',
        },
      ],
    });
    const tremorProfile: VisionProfile = { ...DEFAULT_VISION_PROFILE, tremorsenseFeet: 15 };
    const visionGrid = computePlayerVisionGrid(
      map,
      [obs, enemy],
      () => tremorProfile,
      (t) => t.ownerIds.includes(PLAYER_A),
    );
    expect(getFogCell(visionGrid.seenBits, 20, 4, 5)).toBe(false); // wall hides behind-wall floor layout
    expect(
      isTokenPerceivedByPlayer(
        map,
        [obs, enemy],
        enemy,
        () => tremorProfile,
        (t) => t.ownerIds.includes(PLAYER_A),
      ),
    ).toBe(true); // tremorsense detects grounded target

    // Blinded creature without blindsight/tremorsense sees nothing even in broad daylight
    const blindedProfile: VisionProfile = { ...DEFAULT_VISION_PROFILE, normalRangeFeet: 0, blinded: true };
    const blindGrid = computePlayerVisionGrid(
      makeMap(),
      [obs, enemy],
      () => blindedProfile,
      (t) => t.ownerIds.includes(PLAYER_A),
    );
    expect(getFogCell(blindGrid.seenBits, 20, 2, 5)).toBe(false);
    expect(
      isTokenPerceivedByPlayer(
        makeMap(),
        [obs, enemy],
        enemy,
        () => blindedProfile,
        (t) => t.ownerIds.includes(PLAYER_A),
      ),
    ).toBe(false);
  });
});
