import { describe, expect, it } from 'vitest';
import {
  defaultMapLighting,
  extractDefaultLightingFrom3dMapDocument,
  extractPropLightsFrom3dMapDocument,
  MapLightingConfigSchema,
  MapLightSourceSchema,
  propLightId,
  PropLightOverridesSchema,
} from './index';

describe('lighting schemas and 3D prop extraction', () => {
  it('validates MapLightingConfig, MapLightSource, and PropLightOverrides schemas', () => {
    expect(MapLightingConfigSchema.parse(defaultMapLighting('interior', 'night'))).toEqual({
      environment: 'interior',
      timeOfDay: 'night',
      ambientOverride: null,
    });

    const parsedLight = MapLightSourceSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Lanterna Alvo',
      kind: 'light',
      brightFeet: 60,
      dimFeet: 60,
      angleDeg: 60,
      directionDeg: 90,
      attach: { kind: 'token', tokenId: '00000000-0000-4000-8000-000000000002' },
    });
    expect(parsedLight.enabled).toBe(true);
    expect(parsedLight.layer).toBe('surface');

    expect(PropLightOverridesSchema.parse({ 'prop:0:greyvein.standing_torch': 'off' })).toEqual({
      'prop:0:greyvein.standing_torch': 'off',
    });
  });

  it('extracts deterministic prop lights and default lighting config from 3D map documents', () => {
    const doc = {
      settings: { lighting: { preset: 'dungeon' } },
      props: [
        { key: 'blackbeck.retaining_wall', tileX: 2, tileZ: 2, yOffsetFeet: 0 },
        { key: 'greyvein.standing_torch', tileX: 5.5, tileZ: 3.5, yOffsetFeet: 2 },
        { key: 'greyvein.wall_torch', tileX: 8, tileZ: 4, layer: 'interior', yOffsetFeet: 0 },
        { key: 'dunmere.watch_brazier', tileX: 10, tileZ: 10, yOffsetFeet: 0 },
        { key: 'reedbank.lantern', tileX: 12, tileZ: 12, yOffsetFeet: 0 },
      ],
    };

    expect(extractDefaultLightingFrom3dMapDocument(doc)).toEqual({
      environment: 'interior',
      timeOfDay: 'night',
      ambientOverride: null,
    });
    expect(extractDefaultLightingFrom3dMapDocument({ settings: { lighting: { preset: 'golden_hour' } } })).toEqual({
      environment: 'exterior',
      timeOfDay: 'dusk',
      ambientOverride: null,
    });

    const lights = extractPropLightsFrom3dMapDocument(doc);
    expect(lights.length).toBe(4);
    expect(lights[0]).toMatchObject({
      id: propLightId(1, 'greyvein.standing_torch'),
      propIndex: 1,
      x: 5.5,
      y: 3.5,
      layer: 'surface',
      elevationFeet: 9,
      brightFeet: 20,
      dimFeet: 20,
    });
    expect(lights[1]).toMatchObject({
      id: propLightId(2, 'greyvein.wall_torch'),
      layer: 'interior',
    });
    expect(lights[2]?.id).toBe(propLightId(3, 'dunmere.watch_brazier'));
    expect(lights[3]?.brightFeet).toBe(15);
  });
});
