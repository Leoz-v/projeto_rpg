/**
 * 3D surface stacking system for fitting models cleanly on top of other placed models.
 *
 * Supports:
 *  - Exact 3D ray-vs-placed-asset world AABB picking (so aiming at the top of a tall
 *    tower, table, plinth, or barrel vault hits the model's top surface rather than the
 *    ground behind it).
 *  - Computing each placed model's exact world top Y (accounting for scale, authored mount
 *    height, and existing stack elevation — enabling multi-story stacking: footing -> drum
 *    -> crown -> spire, or table -> box -> torch!).
 *  - Modular snap alignment: same-footprint architectural modules (e.g. 2x2 crown on 2x2
 *    tower drum, 3x3 smock storey on 3x3 mill roundhouse) lock cleanly onto the support's
 *    exact horizontal center, while smaller props sit cleanly wherever aimed on the top face.
 */

import { METERS_PER_HEIGHT_UNIT, TILE_SIZE_FEET, TILE_SIZE_METERS } from '../terrain/constants';
import type { Ray3 } from '../terrain/raycast';
import type { TerrainGrid } from '../terrain/terrainGrid';
import { getRotatedFootprint, type WorldLabAssetEntry } from './modelScalePolicy';
import { isWallDecorEntry, preservesAuthoredMountHeight } from './wallDecoration';

export interface StackablePropBounds {
  readonly id: string;
  readonly entry: WorldLabAssetEntry;
  readonly tileX: number;
  readonly tileZ: number;
  readonly rotationDegrees: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface StackSnapResult {
  readonly supportId: string;
  readonly supportEntry: WorldLabAssetEntry;
  readonly tileX: number;
  readonly tileZ: number;
  readonly topWorldY: number;
  readonly yOffsetFeet: number;
  readonly alignedToSupportCenter: boolean;
  readonly surfaceBox: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly y: number;
  };
}

const METERS_PER_FOOT = TILE_SIZE_METERS / TILE_SIZE_FEET;

export function isStackSupportCandidate(entry: WorldLabAssetEntry): boolean {
  if (entry.category === 'fx') return false;
  if (isWallDecorEntry(entry)) return false;
  const text = `${entry.key} ${entry.name}`.toLowerCase();
  // Thin torches/pennants/banners shouldn't act as floor surfaces to stack towers on
  if (/standing_torch|watch_pennant|scarecrow/.test(text)) return false;
  return true;
}

/**
 * Computes the exact world-space bounding box of a placed asset, including its true top surface Y.
 */
export function computePlacedWorldBounds(
  grid: TerrainGrid,
  prop: {
    readonly id: string;
    readonly entry: WorldLabAssetEntry;
    readonly tileX: number;
    readonly tileZ: number;
    readonly rotationDegrees: number;
    readonly baseScaleX: number;
    readonly baseScaleY: number;
    readonly baseScaleZ: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly scaleZ: number;
    readonly yOffsetFeet: number;
    readonly localMinY: number;
    readonly localSizeX: number;
    readonly localSizeY: number;
    readonly localSizeZ: number;
  },
  layerOffsetY = 0
): StackablePropBounds {
  const sx = prop.baseScaleX * prop.scaleX;
  const sy = prop.baseScaleY * prop.scaleY;
  const sz = prop.baseScaleZ * prop.scaleZ;
  const worldX = prop.tileX * TILE_SIZE_METERS;
  const worldZ = prop.tileZ * TILE_SIZE_METERS;
  const groundY = grid.sampleHeightAtTileCoord(prop.tileX, prop.tileZ) * METERS_PER_HEIGHT_UNIT + layerOffsetY;
  const extraY = prop.yOffsetFeet * METERS_PER_FOOT;

  const keepAuthoredY = preservesAuthoredMountHeight(prop.entry);
  const minY = keepAuthoredY ? groundY + extraY + prop.localMinY * sy : groundY + extraY;
  const maxY = minY + prop.localSizeY * sy;

  const rad = (prop.rotationDegrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfX = Math.max(0.15, (prop.localSizeX * sx * cos + prop.localSizeZ * sz * sin) * 0.5);
  const halfZ = Math.max(0.15, (prop.localSizeX * sx * sin + prop.localSizeZ * sz * cos) * 0.5);

  return {
    id: prop.id,
    entry: prop.entry,
    tileX: prop.tileX,
    tileZ: prop.tileZ,
    rotationDegrees: prop.rotationDegrees,
    minX: worldX - halfX,
    maxX: worldX + halfX,
    minY,
    maxY,
    minZ: worldZ - halfZ,
    maxZ: worldZ + halfZ,
  };
}

/** Slab ray-vs-AABB intersection returning entry distance `t >= 0` or `null`. */
function intersectRayAabb(ray: Ray3, b: StackablePropBounds): number | null {
  let tMin = 0;
  let tMax = Infinity;

  const axes: readonly [number, number, number, number][] = [
    [ray.originX, ray.dirX, b.minX, b.maxX],
    [ray.originY, ray.dirY, b.minY, b.maxY],
    [ray.originZ, ray.dirZ, b.minZ, b.maxZ],
  ];

  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo - o) * inv;
    let t2 = (hi - o) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin >= 0 ? tMin : null;
}

/**
 * Raycasts against all stackable placed props and resolves the exact top-surface stacking
 * position and `yOffsetFeet` for placing `placingEntry` on top of the hit model.
 */
export function resolveStackPlacement(
  ray: Ray3,
  grid: TerrainGrid,
  placingEntry: WorldLabAssetEntry | null,
  placingRotationDegrees: number,
  snapMode: 'center' | 'corner' | 'wall' | 'free',
  candidates: readonly StackablePropBounds[],
  excludePropId: string | null = null,
  layerOffsetY = 0
): StackSnapResult | null {
  if (!placingEntry || snapMode === 'wall' || isWallDecorEntry(placingEntry)) {
    return null;
  }

  let bestHit: { box: StackablePropBounds; t: number; hitX: number; hitZ: number } | null = null;

  for (const box of candidates) {
    if (box.id === excludePropId) continue;
    if (!isStackSupportCandidate(box.entry)) continue;
    const t = intersectRayAabb(ray, box);
    if (t === null) continue;
    if (bestHit === null || t < bestHit.t) {
      bestHit = {
        box,
        t,
        hitX: ray.originX + ray.dirX * t,
        hitZ: ray.originZ + ray.dirZ * t,
      };
    }
  }

  if (!bestHit) return null;

  const { box } = bestHit;
  // Project the ray directly onto the support's top plane y = box.maxY when looking downward,
  // falling back to the AABB entry point if the ray is nearly horizontal.
  let topHitX = bestHit.hitX;
  let topHitZ = bestHit.hitZ;
  if (Math.abs(ray.dirY) > 1e-4) {
    const tTop = (box.maxY - ray.originY) / ray.dirY;
    if (tTop >= 0) {
      const px = ray.originX + ray.dirX * tTop;
      const pz = ray.originZ + ray.dirZ * tTop;
      topHitX = Math.max(box.minX, Math.min(box.maxX, px));
      topHitZ = Math.max(box.minZ, Math.min(box.maxZ, pz));
    }
  }

  const placeFoot = getRotatedFootprint(placingEntry, placingRotationDegrees);
  const supFoot = getRotatedFootprint(box.entry, box.rotationDegrees);
  const sameFootprint =
    placeFoot.widthTiles === supFoot.widthTiles && placeFoot.lengthTiles === supFoot.lengthTiles;
  const largerOrEqualFootprint =
    placeFoot.widthTiles >= supFoot.widthTiles && placeFoot.lengthTiles >= supFoot.lengthTiles;

  let tileX: number;
  let tileZ: number;
  let alignedToSupportCenter = false;

  if (snapMode === 'free') {
    tileX = topHitX / TILE_SIZE_METERS;
    tileZ = topHitZ / TILE_SIZE_METERS;
  } else if (sameFootprint || largerOrEqualFootprint || (snapMode === 'center' && supFoot.widthTiles <= 2 && supFoot.lengthTiles <= 2 && placingEntry.category === 'architecture')) {
    // Lock matching modular pieces (e.g. tower crown on tower drum, smock storey on roundhouse,
    // crenellation on wall, crate on plinth) straight onto the support's exact horizontal center!
    tileX = box.tileX;
    tileZ = box.tileZ;
    alignedToSupportCenter = true;
  } else if (snapMode === 'corner') {
    tileX = Math.round(topHitX / TILE_SIZE_METERS);
    tileZ = Math.round(topHitZ / TILE_SIZE_METERS);
  } else {
    // Small prop on a wider support (e.g. barrel/box/brazier on a 2x2 tower or 4x4 passage):
    // snap to the nearest half-tile / tile center within the support's top bounds!
    const rawTx = topHitX / TILE_SIZE_METERS;
    const rawTz = topHitZ / TILE_SIZE_METERS;
    const minTileX = box.minX / TILE_SIZE_METERS;
    const maxTileX = box.maxX / TILE_SIZE_METERS;
    const minTileZ = box.minZ / TILE_SIZE_METERS;
    const maxTileZ = box.maxZ / TILE_SIZE_METERS;

    // If support is small (like a 2x1 work_table), snap cleanly to 0.5-tile increments inside its top!
    const snappedX = Math.round(rawTx * 2) / 2;
    const snappedZ = Math.round(rawTz * 2) / 2;
    tileX = Math.max(minTileX + 0.15, Math.min(maxTileX - 0.15, snappedX));
    tileZ = Math.max(minTileZ + 0.15, Math.min(maxTileZ - 0.15, snappedZ));
  }

  const groundYAtTarget = grid.sampleHeightAtTileCoord(tileX, tileZ) * METERS_PER_HEIGHT_UNIT + layerOffsetY;
  const yOffsetFeet = Number(((box.maxY - groundYAtTarget) / METERS_PER_FOOT).toFixed(2));

  return {
    supportId: box.id,
    supportEntry: box.entry,
    tileX,
    tileZ,
    topWorldY: box.maxY,
    yOffsetFeet,
    alignedToSupportCenter,
    surfaceBox: {
      minX: box.minX,
      maxX: box.maxX,
      minZ: box.minZ,
      maxZ: box.maxZ,
      // Returned in layer-local Y because overlayRoot already rides at layerOffsetY
      y: box.maxY - layerOffsetY,
    },
  };
}
