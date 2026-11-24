import { describe, expect, it } from 'vitest';
import { TILE_SIZE_METERS } from '../../terrain/constants';
import {
  TOP_DOWN_MAX_RENDER_DIM,
  TOP_DOWN_TARGET_TILE_PX,
  compute2dMapPlaneMetrics,
  computeTopDownRenderSpec,
} from '../mapConversion';

describe('compute2dMapPlaneMetrics', () => {
  it('computes floor metrics with no background image', () => {
    const metrics = compute2dMapPlaneMetrics({ width: 30, height: 20, cellPx: null }, null);
    expect(metrics.mapWidthMeters).toBeCloseTo(30 * TILE_SIZE_METERS);
    expect(metrics.mapLengthMeters).toBeCloseTo(20 * TILE_SIZE_METERS);
    expect(metrics.floorCenterX).toBeCloseTo(15 * TILE_SIZE_METERS);
    expect(metrics.floorCenterZ).toBeCloseTo(10 * TILE_SIZE_METERS);
    expect(metrics.imagePlane).toBeNull();
  });

  it('preserves exact pixel-per-cell scale when cellPx is set (including partial borders)', () => {
    // 1050x735 px at 70 px/cell -> 15 x 10.5 cells, grid is 15 x 11 cells.
    const metrics = compute2dMapPlaneMetrics(
      { width: 15, height: 11, cellPx: 70 },
      { width: 1050, height: 735 },
    );
    expect(metrics.mapWidthMeters).toBeCloseTo(15 * TILE_SIZE_METERS);
    expect(metrics.mapLengthMeters).toBeCloseTo(11 * TILE_SIZE_METERS);
    expect(metrics.imagePlane).not.toBeNull();
    expect(metrics.imagePlane?.widthMeters).toBeCloseTo(15 * TILE_SIZE_METERS);
    expect(metrics.imagePlane?.lengthMeters).toBeCloseTo(10.5 * TILE_SIZE_METERS);
    expect(metrics.imagePlane?.centerX).toBeCloseTo(7.5 * TILE_SIZE_METERS);
    expect(metrics.imagePlane?.centerZ).toBeCloseTo(5.25 * TILE_SIZE_METERS);
  });

  it('stretches image to full grid when cellPx is null (legacy map)', () => {
    const metrics = compute2dMapPlaneMetrics(
      { width: 24, height: 16, cellPx: null },
      { width: 1000, height: 800 },
    );
    expect(metrics.imagePlane).not.toBeNull();
    expect(metrics.imagePlane?.widthMeters).toBeCloseTo(24 * TILE_SIZE_METERS);
    expect(metrics.imagePlane?.lengthMeters).toBeCloseTo(16 * TILE_SIZE_METERS);
    expect(metrics.imagePlane?.centerX).toBeCloseTo(12 * TILE_SIZE_METERS);
    expect(metrics.imagePlane?.centerZ).toBeCloseTo(8 * TILE_SIZE_METERS);
  });
});

describe('computeTopDownRenderSpec', () => {
  it('uses target tile resolution for standard maps within max dimension', () => {
    const spec = computeTopDownRenderSpec(24, 16);
    expect(spec.pixelsPerTile).toBe(TOP_DOWN_TARGET_TILE_PX);
    expect(spec.pixelWidth).toBe(24 * TOP_DOWN_TARGET_TILE_PX);
    expect(spec.pixelHeight).toBe(16 * TOP_DOWN_TARGET_TILE_PX);
    expect(spec.worldWidth).toBeCloseTo(24 * TILE_SIZE_METERS);
    expect(spec.worldLength).toBeCloseTo(16 * TILE_SIZE_METERS);
    expect(spec.cameraX).toBeCloseTo(12 * TILE_SIZE_METERS);
    expect(spec.cameraZ).toBeCloseTo(8 * TILE_SIZE_METERS);
    expect(spec.orthographicSize).toBeCloseTo(12 * TILE_SIZE_METERS);
  });

  it('scales down tile resolution proportionally on large maps so dimensions stay within GPU bounds', () => {
    const spec = computeTopDownRenderSpec(64, 48);
    expect(spec.pixelWidth).toBeLessThanOrEqual(TOP_DOWN_MAX_RENDER_DIM);
    expect(spec.pixelHeight).toBeLessThanOrEqual(TOP_DOWN_MAX_RENDER_DIM);
    expect(spec.pixelWidth).toBe(64 * spec.pixelsPerTile);
    expect(spec.pixelHeight).toBe(48 * spec.pixelsPerTile);
    // Aspect ratio of output image matches map tile aspect ratio exactly.
    expect(spec.pixelWidth / spec.pixelHeight).toBeCloseTo(64 / 48);
  });

  it('keeps integer tile alignment for 96x96 maps', () => {
    const spec = computeTopDownRenderSpec(96, 96);
    expect(spec.pixelsPerTile).toBe(Math.floor(TOP_DOWN_MAX_RENDER_DIM / 96));
    expect(spec.pixelWidth).toBe(96 * spec.pixelsPerTile);
    expect(spec.pixelHeight).toBe(96 * spec.pixelsPerTile);
  });
});
