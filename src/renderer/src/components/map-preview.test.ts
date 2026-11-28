import { describe, expect, it } from 'vitest';
import { createGridFromTemplate, serializeMapDocument } from '../canvas3d/map/mapDocument';
import { compute3dPreviewPixels, countTokensByMap, defaultViewerModeForMap, formatMapMeta, mapKind } from './map-preview';

describe('map-preview helpers', () => {
  it('classifies maps as 3d, image2d, or grid2d', () => {
    expect(mapKind({ background: null, scene3d: 'a'.repeat(64) })).toBe('3d');
    expect(mapKind({ background: 'b'.repeat(64), scene3d: null })).toBe('image2d');
    expect(mapKind({ background: null, scene3d: null })).toBe('grid2d');
  });

  it('picks default viewer mode based on whether the map is 3D', () => {
    expect(defaultViewerModeForMap({ scene3d: 'a'.repeat(64) })).toBe('3d');
    expect(defaultViewerModeForMap({ scene3d: null })).toBe('2d');
  });

  it('counts tokens grouped by mapId', () => {
    expect(
      countTokensByMap({
        t1: { mapId: 'm1' },
        t2: { mapId: 'm1' },
        t3: { mapId: 'm2' },
      }),
    ).toEqual({ m1: 2, m2: 1 });
  });

  it('formats map dimensions, optional cellPx, and pluralized token counts', () => {
    expect(formatMapMeta({ width: 30, height: 20, cellPx: null }, 0)).toBe('30×20');
    expect(formatMapMeta({ width: 12, height: 8, cellPx: 70 }, 1)).toBe('12×8 · 70 px · 1 token');
    expect(formatMapMeta({ width: 24, height: 16, cellPx: null }, 4)).toBe('24×16 · 4 tokens');
  });

  it('rasterizes a 3D map document into an opaque RGBA bitmap with liquids and props', () => {
    const grid = createGridFromTemplate({
      name: 'Taverna',
      width: 16,
      length: 12,
      template: 'flat',
      baseUnderlayId: 1,
      baseElevationFeet: 0,
      includeStarterProps: false,
    });
    const doc = serializeMapDocument({
      name: 'Taverna',
      grid,
      shadingMode: 'rs2_gouraud',
      showGrid: true,
      liquids: [
        {
          id: 'river',
          layer: 'surface',
          preset: 'magma',
          x: 0,
          z: 0,
          width: 4,
          length: 4,
          levelFeet: 0,
        },
      ],
      props: [
        {
          key: 'tree',
          tileX: 10,
          tileZ: 6,
          rotationDegrees: 0,
          scalePolicy: 'auto_dnd',
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
          yOffsetFeet: 0,
        },
      ],
    });

    const bitmap = compute3dPreviewPixels(doc);
    expect(bitmap.width).toBe(64);
    expect(bitmap.height).toBe(48);
    expect(bitmap.rgba.length).toBe(64 * 48 * 4);

    // Top-left pixel is inside the magma liquid (strong red channel).
    expect(bitmap.rgba[0]).toBeGreaterThan(150);
    expect(bitmap.rgba[3]).toBe(255);

    // Bottom-right pixel is untouched meadow grass (strong green channel).
    const lastPixel = (bitmap.width * bitmap.height - 1) * 4;
    expect((bitmap.rgba[lastPixel + 1] ?? 0)).toBeGreaterThan(bitmap.rgba[lastPixel] ?? 0);
    expect(bitmap.rgba[lastPixel + 3]).toBe(255);
  });
});
