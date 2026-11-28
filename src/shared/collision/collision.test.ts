import { describe, expect, it } from 'vitest';
import {
  computeVisibilityPolygon,
  extractHeightfieldFromMapDoc,
  extractWallsFrom3dMapDocument,
  hasLineOfSight2D,
  hasTerrainLineOfSight3D,
  isMovementBlocked,
  pointToSegmentDistance,
  sampleHeightFeet,
  segmentIntersectsSegment,
  type TerrainHeightfield,
  type WallSegment,
} from './index';

function wall(x1: number, y1: number, x2: number, y2: number, extra: Partial<WallSegment> = {}): WallSegment {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    x1,
    y1,
    x2,
    y2,
    kind: 'wall',
    open: false,
    locked: false,
    layer: 'surface',
    source: 'manual',
    ...extra,
  };
}

describe('collision geometry 2D', () => {
  it('detects crossing segments and ignores parallel/disjoint segments', () => {
    const cross = segmentIntersectsSegment({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 });
    expect(cross).not.toBeNull();
    expect(cross?.x).toBeCloseTo(2, 5);
    expect(cross?.y).toBeCloseTo(2, 5);

    expect(segmentIntersectsSegment({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 1 }, { x: 4, y: 1 })).toBeNull();
    expect(segmentIntersectsSegment({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 })).toBeNull();
    expect(pointToSegmentDistance({ x: 2, y: 3 }, wall(0, 0, 4, 0))).toBeCloseTo(3, 5);
  });

  it('blocks LOS on walls and closed doors, allows open doors and windows, and respects layers', () => {
    const walls = [
      wall(3, 0, 3, 5, { kind: 'wall' }),
      wall(6, 0, 6, 5, { kind: 'door', open: false }),
      wall(9, 0, 9, 5, { kind: 'door', open: true }),
      wall(12, 0, 12, 5, { kind: 'window' }),
      wall(2, 0, 2, 5, { kind: 'wall', layer: 'interior' }),
    ];

    expect(hasLineOfSight2D({ x: 1, y: 2.5 }, { x: 4, y: 2.5 }, walls)).toBe(false); // blocked by surface wall at x=3
    expect(hasLineOfSight2D({ x: 4, y: 2.5 }, { x: 7, y: 2.5 }, walls)).toBe(false); // blocked by closed door at x=6
    expect(hasLineOfSight2D({ x: 7, y: 2.5 }, { x: 10, y: 2.5 }, walls)).toBe(true); // open door at x=9
    expect(hasLineOfSight2D({ x: 10, y: 2.5 }, { x: 13, y: 2.5 }, walls)).toBe(true); // window at x=12
    expect(hasLineOfSight2D({ x: 1, y: 2.5 }, { x: 2.5, y: 2.5 }, walls, { layer: 'surface' })).toBe(true); // interior wall ignored on surface
    expect(hasLineOfSight2D({ x: 1, y: 2.5 }, { x: 2.5, y: 2.5 }, walls, { layer: 'interior' })).toBe(false);
  });

  it('terrain_wall allows seeing onto the first face (1 crossing) and blocks seeing beyond it (2 crossings)', () => {
    const ridge = [wall(4, 0, 4, 6, { kind: 'terrain_wall' }), wall(6, 0, 6, 6, { kind: 'terrain_wall' })];
    expect(hasLineOfSight2D({ x: 1, y: 3 }, { x: 5, y: 3 }, ridge)).toBe(true); // 1 crossing -> can see plateau
    expect(hasLineOfSight2D({ x: 1, y: 3 }, { x: 7, y: 3 }, ridge)).toBe(false); // 2 crossings -> occluded behind ridge
  });

  it('blocks token movement on walls, windows, and closed doors, but allows open doors', () => {
    const walls = [
      wall(3, 0, 3, 5, { kind: 'wall' }),
      wall(6, 0, 6, 5, { kind: 'window' }),
      wall(9, 0, 9, 5, { kind: 'door', open: false }),
      wall(12, 0, 12, 5, { kind: 'door', open: true }),
    ];

    expect(isMovementBlocked({ x: 2.5, y: 2.5 }, { x: 3.5, y: 2.5 }, walls)?.kind).toBe('wall');
    expect(isMovementBlocked({ x: 5.5, y: 2.5 }, { x: 6.5, y: 2.5 }, walls)?.kind).toBe('window');
    expect(isMovementBlocked({ x: 8.5, y: 2.5 }, { x: 9.5, y: 2.5 }, walls)?.kind).toBe('door');
    expect(isMovementBlocked({ x: 11.5, y: 2.5 }, { x: 12.5, y: 2.5 }, walls)).toBeNull();
  });

  it('computes visibility polygons clipped by walls and directional cones', () => {
    const poly = computeVisibilityPolygon({ x: 2, y: 5 }, 10, [wall(5, 3, 5, 7)]);
    expect(poly.length).toBeGreaterThan(20);
    // Rays pointing straight East (y=5) must stop at x=5 instead of x=12
    const eastPoints = poly.filter((p) => Math.abs(p.y - 5) < 0.1 && p.x > 2);
    expect(eastPoints.length).toBeGreaterThan(0);
    for (const p of eastPoints) {
      expect(p.x).toBeLessThanOrEqual(5.05);
    }

    const cone = computeVisibilityPolygon({ x: 5, y: 5 }, 6, [], { angleDeg: 60, directionDeg: 0 });
    expect(cone[0]).toEqual({ x: 5, y: 5 });
    for (let i = 1; i < cone.length; i++) {
      const pt = cone[i];
      expect(pt).toBeDefined();
      if (pt) {
        expect(pt.x).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

describe('3D heightfield occlusion and wall extraction', () => {
  it('blocks same-layer sight across tall cliffs and blocks cross-layer sight through solid ground except at holes', () => {
    const width = 6;
    const length = 6;
    const heights = new Array<number>((width + 1) * (length + 1)).fill(0);
    // Raise a ridge along x = 3 (vertices vx = 3 and vx = 4) by 15 ft (384 height units)
    for (let vz = 0; vz <= length; vz++) {
      heights[vz * (width + 1) + 3] = 384;
      heights[vz * (width + 1) + 4] = 384;
    }
    const holes = new Array<number>(width * length).fill(0);
    holes[1 * width + 1] = 1; // hole at tile (1, 1)

    const hf: TerrainHeightfield = {
      width,
      length,
      heights,
      holes,
      interior: { heights: new Array<number>((width + 1) * (length + 1)).fill(0), holes: new Array<number>(width * length).fill(0) },
      interiorDepthFeet: 12,
    };

    expect(sampleHeightFeet(hf, 3.5, 3.5, 'surface')).toBeCloseTo(15, 2);
    expect(sampleHeightFeet(hf, 1.5, 1.5, 'interior')).toBeCloseTo(-12, 2);

    // Flat area has clear LOS
    expect(
      hasTerrainLineOfSight3D(
        hf,
        { x: 0.5, y: 0.5, elevationFeet: 5, layer: 'surface' },
        { x: 2.5, y: 0.5, elevationFeet: 5, layer: 'surface' },
      ),
    ).toBe(true);

    // Ridge blocks low observer on surface
    expect(
      hasTerrainLineOfSight3D(
        hf,
        { x: 1.5, y: 2.5, elevationFeet: 5, layer: 'surface' },
        { x: 5.5, y: 2.5, elevationFeet: 5, layer: 'surface' },
      ),
    ).toBe(false);

    // Solid ground blocks surface -> interior
    expect(
      hasTerrainLineOfSight3D(
        hf,
        { x: 4.5, y: 4.5, elevationFeet: 5, layer: 'surface' },
        { x: 4.5, y: 4.5, elevationFeet: 5, layer: 'interior' },
      ),
    ).toBe(false);

    // Hole at (1, 1) permits surface <-> interior sight directly through opening
    expect(
      hasTerrainLineOfSight3D(
        hf,
        { x: 1.5, y: 1.5, elevationFeet: 5, layer: 'surface' },
        { x: 1.5, y: 1.5, elevationFeet: 5, layer: 'interior' },
      ),
    ).toBe(true);
  });

  it('extracts and merges walls/doors/windows/pillars while ignoring torches and roofs', () => {
    const doc = {
      terrain: { width: 12, length: 12, heights: new Array<number>(13 * 13).fill(0), holes: new Array<number>(12 * 12).fill(0) },
      props: [
        { key: 'blackbeck.retaining_wall', tileX: 3, tileZ: 2, rotationDegrees: 0, scaleX: 1, scaleZ: 1 },
        { key: 'blackbeck.retaining_wall', tileX: 5, tileZ: 2, rotationDegrees: 0, scaleX: 1, scaleZ: 1 },
        { key: 'reedbank.swing_door', tileX: 7, tileZ: 2, rotationDegrees: 0, scaleX: 1, scaleZ: 1 },
        { key: 'alderwatch.oriel_window', tileX: 8, tileZ: 2, rotationDegrees: 0, scaleX: 1, scaleZ: 1 },
        { key: 'alderwatch.arcade_column', tileX: 4, tileZ: 6, rotationDegrees: 0, scaleX: 1, scaleZ: 1 },
        { key: 'greyvein.standing_torch', tileX: 3, tileZ: 4, rotationDegrees: 0, scaleX: 1, scaleZ: 1 },
        { key: 'reedbank.thatched_pitch', tileX: 3, tileZ: 2, rotationDegrees: 0, scaleX: 1, scaleZ: 1, roofLayer: true },
      ],
    };

    expect(extractHeightfieldFromMapDoc(doc)).not.toBeNull();
    const extracted = extractWallsFrom3dMapDocument(doc);
    // 2 collinear retaining walls merged into 1 (x=2..6), plus 1 door, 1 window, 2 pillar cross segments = 5
    expect(extracted.length).toBe(5);
    const mergedWall = extracted.find((w) => w.kind === 'wall' && Math.abs(w.y1 - 2) < 0.01);
    expect(mergedWall).toMatchObject({ x1: 2, y1: 2, x2: 6, y2: 2, source: 'baked_3d' });
    expect(extracted.some((w) => w.kind === 'door' && !w.open)).toBe(true);
    expect(extracted.some((w) => w.kind === 'window')).toBe(true);
  });
});
