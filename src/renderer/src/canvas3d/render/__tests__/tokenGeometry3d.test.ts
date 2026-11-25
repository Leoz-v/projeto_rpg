import { describe, expect, it } from 'vitest';
import type { Token } from '../../../../../shared/protocol';
import { makeToken } from '../../../../../shared/protocol/test-fixtures';
import { TILE_SIZE_METERS } from '../../terrain/constants';
import { TerrainGrid } from '../../terrain/terrainGrid';
import {
  cameraTargetToWorld2d,
  pickToken3d,
  stepTokenByCameraDirection,
  tokenTo3dFootprint,
  world3dToTokenCorner,
} from '../tokenGeometry3d';

const thorin = (overrides: Partial<Token> = {}): Token => makeToken({ name: 'Thorin', position: { x: 200, y: 300 }, ...overrides });

describe('tokenGeometry3d', () => {
  it('maps 2D token position & D&D creature sizes to 3D meters accurately', () => {
    const grid = new TerrainGrid(16, 16);

    const medium = tokenTo3dFootprint(thorin({ position: { x: 200, y: 300 }, size: 'medium' }), grid);
    expect(medium.tileX).toBeCloseTo(2.5);
    expect(medium.tileZ).toBeCloseTo(3.5);
    expect(medium.centerX).toBeCloseTo(2.5 * TILE_SIZE_METERS);
    expect(medium.centerZ).toBeCloseTo(3.5 * TILE_SIZE_METERS);
    expect(medium.sideMeters).toBeCloseTo(TILE_SIZE_METERS);

    const large = tokenTo3dFootprint(thorin({ position: { x: 400, y: 400 }, size: 'large' }), grid);
    expect(large.tileX).toBeCloseTo(5.0);
    expect(large.tileZ).toBeCloseTo(5.0);
    expect(large.sideMeters).toBeCloseTo(2 * TILE_SIZE_METERS);

    const tiny = tokenTo3dFootprint(thorin({ position: { x: 50, y: 100 }, size: 'tiny' }), grid);
    expect(tiny.sideMeters).toBeCloseTo(0.5 * TILE_SIZE_METERS);
  });

  it('snaps 3D terrain drop points back to 2D grid coordinates matching 2D placeToken', () => {
    const map = { width: 16, height: 16 };
    // Dropping near center of tile (3, 4) snaps to (300, 400) for a Medium token
    const snapped = world3dToTokenCorner(3.4 * TILE_SIZE_METERS, 4.6 * TILE_SIZE_METERS, 'medium', map);
    expect(snapped).toEqual({ x: 300, y: 400 });

    // Clamps Large token (2x2) inside map bounds
    const clamped = world3dToTokenCorner(20 * TILE_SIZE_METERS, 20 * TILE_SIZE_METERS, 'large', map);
    expect(clamped).toEqual({ x: 1400, y: 1400 });

    // Camera target converts directly to logical 2D world units
    expect(cameraTargetToWorld2d(8 * TILE_SIZE_METERS, 6 * TILE_SIZE_METERS)).toEqual({ x: 800, y: 600 });

    // Free drop (Shift held: snapToGrid = false) preserves sub-cell coordinates
    const free = world3dToTokenCorner(3.25 * TILE_SIZE_METERS, 4.75 * TILE_SIZE_METERS, 'medium', map, false);
    expect(free).toEqual({ x: 275, y: 425 });
  });

  it('picks tokens on ground disc in top_down and on vertical billboard in perspective/orthographic', () => {
    const grid = new TerrainGrid(16, 16);
    const token = thorin({ position: { x: 200, y: 300 }, size: 'medium' });
    const fp = tokenTo3dFootprint(token, grid);

    // Top-down ray straight down onto the token disc
    const topDownHit = pickToken3d(
      { originX: fp.centerX, originY: 20, originZ: fp.centerZ, dirX: 0, dirY: -1, dirZ: 0 },
      [token],
      grid,
      'top_down',
    );
    expect(topDownHit?.id).toBe(token.id);

    // Horizontal ray at torso height (y = 0.8 m): misses in top_down (flat), hits in perspective (billboard)
    const torsoRay = { originX: fp.centerX, originY: 0.8, originZ: fp.centerZ + 5, dirX: 0, dirY: 0, dirZ: -1 };
    expect(pickToken3d(torsoRay, [token], grid, 'top_down')).toBeNull();
    expect(pickToken3d(torsoRay, [token], grid, 'perspective')?.id).toBe(token.id);
    expect(pickToken3d(torsoRay, [token], grid, 'orthographic')?.id).toBe(token.id);
  });

  it('steps a selected token one grid cell aligned with the 3D camera azimuth', () => {
    const map = { width: 16, height: 16 };
    const token = thorin({ position: { x: 400, y: 400 }, size: 'medium' });

    // Azimuth 0: forward = North (-Z / -y), right = East (+X / +x)
    expect(stepTokenByCameraDirection(token, map, 0, 1, 0)).toEqual({ x: 400, y: 300 });
    expect(stepTokenByCameraDirection(token, map, 0, -1, 0)).toEqual({ x: 400, y: 500 });
    expect(stepTokenByCameraDirection(token, map, 0, 0, 1)).toEqual({ x: 500, y: 400 });
    expect(stepTokenByCameraDirection(token, map, 0, 0, -1)).toEqual({ x: 300, y: 400 });

    // Azimuth +PI/2 (camera looking West, -X): forward = West (-x), right = North (-y)
    expect(stepTokenByCameraDirection(token, map, Math.PI / 2, 1, 0)).toEqual({ x: 300, y: 400 });
    expect(stepTokenByCameraDirection(token, map, Math.PI / 2, 0, 1)).toEqual({ x: 400, y: 300 });

    // Tiny token steps by half-cell (50 world units)
    const tiny = thorin({ position: { x: 400, y: 400 }, size: 'tiny' });
    expect(stepTokenByCameraDirection(tiny, map, 0, 0, 1)).toEqual({ x: 450, y: 400 });
  });
});
