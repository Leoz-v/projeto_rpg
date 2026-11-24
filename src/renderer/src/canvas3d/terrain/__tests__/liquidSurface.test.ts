import { describe, expect, it } from 'vitest';
import { parseMapDocument, serializeMapDocument } from '../../map/mapDocument';
import { resolveLiquidStyleCode, sampleLiquidDepthFeet } from '../../render/liquidRenderer';
import { feetToHeightUnits } from '../constants';
import { TerrainGrid } from '../terrainGrid';
import {
  areLiquidsConnected,
  createContinuedLiquid,
  feetToWorldMeters,
  findConnectedLiquidIds,
  intersectHorizontalPlane,
  pickLiquidEdgeHandle,
  pickLiquidSurface,
  snapLiquidRectMove,
  snapPointToLiquidEdges,
  type LiquidSurface,
} from '../liquidSurface';

function makeSurface(overrides: Partial<LiquidSurface> = {}): LiquidSurface {
  return {
    id: 'lq_1',
    layer: 'surface',
    preset: 'clear_water',
    x: 4,
    z: 4,
    width: 4,
    length: 4,
    levelFeet: -1.5,
    ...overrides,
  };
}

describe('LiquidSurface geometry, connection & snapping', () => {
  it('detects flush-connected segments on the same layer and level', () => {
    const a = makeSurface({ id: 'a', x: 4, z: 4, width: 4, length: 4, levelFeet: -2 });
    const b = makeSurface({ id: 'b', x: 8, z: 4, width: 3, length: 4, levelFeet: -2 });
    const c = makeSurface({ id: 'c', x: 8, z: 8, width: 3, length: 3, levelFeet: -2 });
    const differentLevel = makeSurface({ id: 'd', x: 8, z: 11, width: 3, length: 3, levelFeet: 1.0 });
    const differentLayer = makeSurface({ id: 'e', layer: 'interior', x: 4, z: 4, width: 4, length: 4, levelFeet: -2 });

    expect(areLiquidsConnected(a, b)).toBe(true);
    expect(areLiquidsConnected(b, c)).toBe(true);
    expect(areLiquidsConnected(a, c)).toBe(false);
    expect(areLiquidsConnected(c, differentLevel, true)).toBe(false);
    expect(areLiquidsConnected(c, differentLevel, false)).toBe(true);
    expect(areLiquidsConnected(a, differentLayer)).toBe(false);

    const network = findConnectedLiquidIds([a, b, c, differentLevel, differentLayer], 'a', true);
    expect(Array.from(network).sort()).toEqual(['a', 'b', 'c']);
  });

  it('creates flush directional continuations inheriting level, preset, and opacity', () => {
    const src = makeSurface({
      id: 'canal_1',
      preset: 'sewer_sludge',
      x: 6,
      z: 6,
      width: 4,
      length: 3,
      levelFeet: -3.25,
      opacity: 0.91,
    });

    const east = createContinuedLiquid(src, 'E', 5, 32, 32, 'canal_e')!;
    expect(east.x).toBe(10);
    expect(east.z).toBe(6);
    expect(east.width).toBe(5);
    expect(east.length).toBe(3);
    expect(east.levelFeet).toBe(-3.25);
    expect(east.preset).toBe('sewer_sludge');
    expect(east.opacity).toBe(0.91);
    expect(areLiquidsConnected(src, east)).toBe(true);

    const north = createContinuedLiquid(src, 'N', 4, 32, 32, 'canal_n')!;
    expect(north.x).toBe(6);
    expect(north.z).toBe(2);
    expect(north.width).toBe(4);
    expect(north.length).toBe(4);
    expect(areLiquidsConnected(src, north)).toBe(true);

    const west = createContinuedLiquid(src, 'W', 2, 32, 32, 'canal_w')!;
    expect(west.x).toBe(4);
    expect(west.width).toBe(2);
    expect(areLiquidsConnected(src, west)).toBe(true);

    const south = createContinuedLiquid(src, 'S', 3, 32, 32, 'canal_s')!;
    expect(south.z).toBe(9);
    expect(south.length).toBe(3);
    expect(areLiquidsConnected(src, south)).toBe(true);
  });

  it('snaps moving rectangles and draw points flush to nearby liquid edges', () => {
    const existing = makeSurface({ id: 'base', x: 4, z: 4, width: 6, length: 4, levelFeet: -1.0, preset: 'magma' });

    const moved = snapLiquidRectMove({ x: 10.25, z: 4.15, width: 4, length: 4 }, [existing], 0.55);
    expect(moved.rect.x).toBe(10);
    expect(moved.rect.z).toBe(4);
    expect(moved.snappedTo?.id).toBe('base');
    expect(moved.snapLines.length).toBeGreaterThan(0);

    const pt = snapPointToLiquidEdges(9.8, 6.0, [existing], 0.55);
    expect(pt.x).toBe(10);
    expect(pt.snappedTo?.id).toBe('base');
    expect(pt.snappedTo?.preset).toBe('magma');
  });

  it('picks flat liquid surfaces and N/S/E/W edge handles via horizontal plane rays', () => {
    const s = makeSurface({ id: 'pool', x: 4, z: 6, width: 4, length: 4, levelFeet: 5 });
    const planeY = feetToWorldMeters(5);

    const planeHit = intersectHorizontalPlane(
      { originX: 9, originY: planeY + 10, originZ: 12, dirX: 0, dirY: -1, dirZ: 0 },
      planeY
    );
    expect(planeHit).not.toBeNull();
    expect(planeHit!.tileX).toBeCloseTo(6);
    expect(planeHit!.tileZ).toBeCloseTo(8);

    const picked = pickLiquidSurface(
      { originX: 9, originY: planeY + 10, originZ: 12, dirX: 0, dirY: -1, dirZ: 0 },
      [s],
      0
    );
    expect(picked?.surface.id).toBe('pool');

    // East edge midpoint is at tile (8, 8) => world (12, planeY, 12)
    const eastEdge = pickLiquidEdgeHandle(
      { originX: 12, originY: planeY + 10, originZ: 12, dirX: 0, dirY: -1, dirZ: 0 },
      s,
      0
    );
    expect(eastEdge).toBe('E');
  });

  it('serializes and parses liquid surfaces cleanly in VttMapDocument', () => {
    const grid = new TerrainGrid(16, 16);
    const surfaces: LiquidSurface[] = [
      makeSurface({ id: 'river_1', x: 2, z: 2, width: 4, length: 6, levelFeet: -2.5, preset: 'deep_water' }),
      makeSurface({ id: 'sewer_1', layer: 'interior', x: 6, z: 2, width: 5, length: 2, levelFeet: -1.25, preset: 'sewer_sludge', opacity: 0.88 }),
    ];

    const doc = serializeMapDocument({
      name: 'Liquid Test Map',
      grid,
      liquids: surfaces,
      props: [],
      shadingMode: 'pbr_shadows',
      showGrid: true,
    });

    const parsed = parseMapDocument(JSON.parse(JSON.stringify(doc)));
    expect(parsed.liquids).toHaveLength(2);
    expect(parsed.liquids![0]).toMatchObject({
      id: 'river_1',
      layer: 'surface',
      preset: 'deep_water',
      x: 2,
      z: 2,
      width: 4,
      length: 6,
      levelFeet: -2.5,
    });
    expect(parsed.liquids![1]).toMatchObject({
      id: 'sewer_1',
      layer: 'interior',
      preset: 'sewer_sludge',
      levelFeet: -1.25,
      opacity: 0.88,
    });
  });

  it('samples exact terrain depth and narrow-canal curb depth over cutout holes', () => {
    const grid = new TerrainGrid(16, 16);
    // Carve a -5 ft basin in tiles x:4..8, z:4..8 while leaving banks at 0 ft
    for (let vz = 5; vz <= 7; vz++) {
      for (let vx = 5; vx <= 7; vx++) {
        grid.heights[grid.vertexIndex(vx, vz)] = feetToHeightUnits(-5);
      }
    }
    const basin = makeSurface({ x: 4, z: 4, width: 4, length: 4, levelFeet: -2 });
    const centerDepth = sampleLiquidDepthFeet(basin, 6, 6, grid);
    const bankDepth = sampleLiquidDepthFeet(basin, 4.05, 4.05, grid);
    expect(centerDepth).toBeCloseTo(3.0, 1);
    expect(bankDepth).toBeLessThan(0);

    // Cutout hole beneath a narrow 1-tile modular sewer raceway uses curb distance fallback
    grid.setHole(10, 6, true);
    const raceStrip = makeSurface({ x: 9.5, z: 4, width: 1.04, length: 6, levelFeet: -2 });
    const curbDepth = sampleLiquidDepthFeet(raceStrip, 9.52, 6.5, grid);
    const midCanalDepth = sampleLiquidDepthFeet(raceStrip, 10.02, 6.5, grid);
    expect(curbDepth).toBeLessThan(0.5);
    expect(midCanalDepth).toBeGreaterThan(2.0);
  });

  it('maps all 8 liquid presets to their pixelized shader style codes', () => {
    expect(resolveLiquidStyleCode('clear_water')).toBe(1);
    expect(resolveLiquidStyleCode('deep_water')).toBe(1);
    expect(resolveLiquidStyleCode('swamp_water')).toBe(2);
    expect(resolveLiquidStyleCode('sewer_sludge')).toBe(2);
    expect(resolveLiquidStyleCode('magma')).toBe(3);
    expect(resolveLiquidStyleCode('acid')).toBe(4);
    expect(resolveLiquidStyleCode('blood')).toBe(5);
    expect(resolveLiquidStyleCode('oil')).toBe(5);
  });
});
