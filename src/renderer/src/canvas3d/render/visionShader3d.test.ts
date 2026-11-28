import { describe, expect, it } from 'vitest';
import { DEFAULT_VISION_PROFILE, type VisionProfile } from 'rules-engine/vision';
import {
  defaultMapFog,
  defaultMapLighting,
  type ExtractedPropLight,
  type GameMap,
  type TerrainHeightfield,
  type Token,
  WORLD_UNITS_PER_CELL,
} from '../../../../shared/protocol';
import { fillVision3dMaskImageData, mapLightingConfigToPreset, visionLighting3dBit } from './visionShader3d';
import { makeToken as makeFixtureToken } from '../../../../shared/protocol/test-fixtures';

const MAP_ID = '00000000-0000-4000-8000-000000000001';
const PLAYER_ID = '00000000-0000-4000-8000-000000000010';
const TOKEN_ID = '00000000-0000-4000-8000-000000000099';
const WALL_ID = '00000000-0000-4000-8000-000000000201';
const LIGHT_ID = '00000000-0000-4000-8000-000000000301';

function pixel(data: Uint8ClampedArray, width: number, col: number, row: number): [number, number, number, number] {
  const o = (row * width + col) * 4;
  return [data[o] ?? -1, data[o + 1] ?? -1, data[o + 2] ?? -1, data[o + 3] ?? -1];
}

function makeMap(width: number, height: number, override?: Partial<GameMap>): GameMap {
  return {
    id: MAP_ID,
    name: 'Masmorra 3D',
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

function makeToken(override?: Partial<Token>): Token {
  return makeFixtureToken({ id: TOKEN_ID, mapId: MAP_ID, name: 'Herói', ownerIds: [PLAYER_ID], ...override });
}

describe('visionShader3d', () => {
  it('declares ShaderBit texture slot, uVisionBounds uniform, and both GLSL/WGSL fragment ends', () => {
    expect(visionLighting3dBit.name).toBe('vttVisionLighting3d');
    expect(visionLighting3dBit.textures).toEqual(['visionMask']);
    expect(visionLighting3dBit.bindings?.material).toEqual({ uVisionBounds: 'vec4<f32>' });
    expect(visionLighting3dBit.gl?.fragment?.end).toContain('sampleVisionMask');
    expect(visionLighting3dBit.gpu?.fragment?.end).toContain('sampleVisionMask');
  });

  it('maps environment, timeOfDay, and ambientOverride to 3D lighting presets', () => {
    expect(mapLightingConfigToPreset({ environment: 'exterior', timeOfDay: 'day', ambientOverride: null })).toBe('daylight');
    expect(mapLightingConfigToPreset({ environment: 'exterior', timeOfDay: 'dawn', ambientOverride: null })).toBe('golden_hour');
    expect(mapLightingConfigToPreset({ environment: 'exterior', timeOfDay: 'dusk', ambientOverride: null })).toBe('golden_hour');
    expect(mapLightingConfigToPreset({ environment: 'exterior', timeOfDay: 'twilight', ambientOverride: null })).toBe('twilight');
    expect(mapLightingConfigToPreset({ environment: 'exterior', timeOfDay: 'night', ambientOverride: null })).toBe('night');
    expect(mapLightingConfigToPreset({ environment: 'interior', timeOfDay: 'day', ambientOverride: null })).toBe('dungeon');
    expect(mapLightingConfigToPreset({ environment: 'interior', timeOfDay: 'night', ambientOverride: 'bright' })).toBe('daylight');
    expect(mapLightingConfigToPreset({ environment: 'exterior', timeOfDay: 'day', ambientOverride: 'darkness' })).toBe('night');
  });

  it('quenches unshadowed PointLight bleed behind walls, applies B&W Darkvision in darkness, and keeps A=255', () => {
    const hero = makeToken({ position: { x: WORLD_UNITS_PER_CELL, y: 0 } });
    const map = makeMap(8, 1, {
      lighting: defaultMapLighting('interior', 'night'),
      fog: { ...defaultMapFog(8, 1), autoEnabled: true, visionFeet: 60 },
      walls: [
        {
          id: WALL_ID,
          x1: 3,
          y1: 0,
          x2: 3,
          y2: 1,
          kind: 'wall',
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
          dimFeet: 15,
          darknessFeet: 0,
          spellLevel: null,
          angleDeg: 360,
          directionDeg: 0,
          color: '#ff9442',
          flicker: true,
          layer: 'surface',
          elevationFeet: 5,
          attach: { kind: 'point', x: 1.5, y: 0.5 },
          ownerId: null,
        },
      ],
    });

    const elfProfiles: Record<string, VisionProfile> = {
      [TOKEN_ID]: { ...DEFAULT_VISION_PROFILE, darkvisionFeet: 60 },
    };
    const elfData = new Uint8ClampedArray(8 * 1 * 4);
    fillVision3dMaskImageData(elfData, map, [hero], { role: 'player', playerId: PLAYER_ID }, { visionProfiles: elfProfiles });

    for (let c = 0; c < 8; c++) expect(pixel(elfData, 8, c, 0)[3]).toBe(255);
    expect(pixel(elfData, 8, 1, 0)).toEqual([0, 255, 255, 255]); // lit before wall -> full color + full light
    expect(pixel(elfData, 8, 5, 0)).toEqual([0, 0, 0, 255]); // behind wall -> blocked

    // Remove wall, shorten torch to 5ft bright -> cell 5 (20ft away) is unlit -> B&W Darkvision with B=0 (quenched bleed)
    const openDarkMap = makeMap(8, 1, {
      ...map,
      walls: [],
      lights: [{ ...map.lights[0], brightFeet: 5, dimFeet: 0 } as NonNullable<GameMap['lights'][number]>],
    });
    const openElfData = new Uint8ClampedArray(8 * 1 * 4);
    fillVision3dMaskImageData(openElfData, openDarkMap, [hero], { role: 'player', playerId: PLAYER_ID }, { visionProfiles: elfProfiles });
    expect(pixel(openElfData, 8, 1, 0)).toEqual([0, 255, 255, 255]);
    expect(pixel(openElfData, 8, 5, 0)).toEqual([255, 215, 0, 255]); // B&W Darkvision

    const humanData = new Uint8ClampedArray(8 * 1 * 4);
    fillVision3dMaskImageData(
      humanData,
      openDarkMap,
      [hero],
      { role: 'player', playerId: PLAYER_ID },
      { visionProfiles: { [TOKEN_ID]: DEFAULT_VISION_PROFILE } },
    );
    expect(pixel(humanData, 8, 5, 0)).toEqual([0, 0, 0, 255]);

    // GM overview keeps walled room visible (G > 0) while still quenching leaked PointLight (B = 0)
    const gmData = new Uint8ClampedArray(8 * 1 * 4);
    fillVision3dMaskImageData(gmData, map, [hero], { role: 'gm', playerId: 'gm' });
    const behindWallGm = pixel(gmData, 8, 5, 0);
    expect(behindWallGm[1]).toBeGreaterThan(0);
    expect(behindWallGm[2]).toBe(0);
    expect(behindWallGm[3]).toBe(255);
  });

  it('prevents surface torch bleed through interior ceiling unless punched by a hole, and respects propLightOverrides', () => {
    const width = 6;
    const length = 1;
    const heights = new Array<number>((width + 1) * (length + 1)).fill(0);
    const holes = new Array<number>(width * length).fill(0);
    holes[4] = 1; // surface hole at x = 4
    const heightfield: TerrainHeightfield = {
      width,
      length,
      heights,
      holes,
      interior: { heights: [...heights], holes: new Array<number>(width * length).fill(0) },
      interiorDepthFeet: 12,
    };

    const bakedPropLights: ExtractedPropLight[] = [
      {
        id: 'prop:0:greyvein.standing_torch',
        propIndex: 0,
        key: 'greyvein.standing_torch',
        name: 'Tocha',
        x: 1.5,
        y: 0.5,
        layer: 'surface',
        elevationFeet: 7,
        brightFeet: 20,
        dimFeet: 10,
        color: '#ff8a2b',
        flicker: true,
      },
    ];

    const map = makeMap(width, length, {
      lighting: defaultMapLighting('exterior', 'day'),
    });

    // Interior layer under sealed ground (x=1) stays dark (B=0), while under hole (x=4) receives daylight (B=255)
    const interiorData = new Uint8ClampedArray(width * length * 4);
    fillVision3dMaskImageData(
      interiorData,
      map,
      [],
      { role: 'gm', playerId: 'gm' },
      { layer: 'interior', heightfield, bakedPropLights },
    );
    expect(pixel(interiorData, width, 1, 0)[2]).toBe(0);
    expect(pixel(interiorData, width, 4, 0)[2]).toBe(255);

    // Night surface with baked prop torch: lit at x=1 -> B=255; turning override 'off' drops B=0
    const nightMap = makeMap(width, length, { lighting: defaultMapLighting('interior', 'night') });
    const litSurface = new Uint8ClampedArray(width * length * 4);
    fillVision3dMaskImageData(litSurface, nightMap, [], { role: 'gm', playerId: 'gm' }, { bakedPropLights });
    expect(pixel(litSurface, width, 1, 0)[2]).toBe(255);

    const offSurface = new Uint8ClampedArray(width * length * 4);
    fillVision3dMaskImageData(
      offSurface,
      { ...nightMap, propLightOverrides: { 'prop:0:greyvein.standing_torch': 'off' } },
      [],
      { role: 'gm', playerId: 'gm' },
      { bakedPropLights },
    );
    expect(pixel(offSurface, width, 1, 0)[2]).toBe(0);
  });
});
