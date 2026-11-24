/**
 * Exact ray-vs-heightfield picker for D&D terrain editing.
 *
 * Tests a world-space ray directly against every tile's two triangles (or a fast
 * coarse AABB skip per 8x8 chunk) so vertex/tile hovering and sculpting work cleanly
 * even on steep cliffs and plateaus, without depending on GPU mesh hit-volumes.
 */

import { CHUNK_SIZE, METERS_PER_HEIGHT_UNIT, TILE_SIZE_METERS } from './constants';
import type { TerrainGrid } from './terrainGrid';

export interface Ray3 {
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

export interface TerrainPickHit {
  /** Hit point in world meters */
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  /** Continuous tile coordinates */
  readonly tileFloatX: number;
  readonly tileFloatZ: number;
  /** Integer tile index under cursor */
  readonly tileX: number;
  readonly tileZ: number;
  /** Nearest vertex index under cursor (for vertex sculpting) */
  readonly vertexX: number;
  readonly vertexZ: number;
  /** Distance from ray origin in meters */
  readonly distance: number;
}

/** Möller–Trumbore ray-triangle intersection (returns t > 0 or -1 on miss). */
function intersectTriangle(
  ray: Ray3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): number {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;

  const px = ray.dirY * e2z - ray.dirZ * e2y;
  const py = ray.dirZ * e2x - ray.dirX * e2z;
  const pz = ray.dirX * e2y - ray.dirY * e2x;

  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-8) return -1;

  const invDet = 1 / det;
  const tx = ray.originX - ax;
  const ty = ray.originY - ay;
  const tz = ray.originZ - az;

  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < -1e-5 || u > 1 + 1e-5) return -1;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;

  const v = (ray.dirX * qx + ray.dirY * qy + ray.dirZ * qz) * invDet;
  if (v < -1e-5 || u + v > 1 + 1e-5) return -1;

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t > 0 ? t : -1;
}

function intersectAabb(
  ray: Ray3,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number
): boolean {
  let tMin = -Infinity;
  let tMax = Infinity;

  if (Math.abs(ray.dirX) > 1e-8) {
    const tx1 = (minX - ray.originX) / ray.dirX;
    const tx2 = (maxX - ray.originX) / ray.dirX;
    tMin = Math.max(tMin, Math.min(tx1, tx2));
    tMax = Math.min(tMax, Math.max(tx1, tx2));
  } else if (ray.originX < minX || ray.originX > maxX) {
    return false;
  }

  if (Math.abs(ray.dirY) > 1e-8) {
    const ty1 = (minY - ray.originY) / ray.dirY;
    const ty2 = (maxY - ray.originY) / ray.dirY;
    tMin = Math.max(tMin, Math.min(ty1, ty2));
    tMax = Math.min(tMax, Math.max(ty1, ty2));
  } else if (ray.originY < minY || ray.originY > maxY) {
    return false;
  }

  if (Math.abs(ray.dirZ) > 1e-8) {
    const tz1 = (minZ - ray.originZ) / ray.dirZ;
    const tz2 = (maxZ - ray.originZ) / ray.dirZ;
    tMin = Math.max(tMin, Math.min(tz1, tz2));
    tMax = Math.min(tMax, Math.max(tz1, tz2));
  } else if (ray.originZ < minZ || ray.originZ > maxZ) {
    return false;
  }

  return tMax >= Math.max(0, tMin);
}

export interface TerrainPickOptions {
  /** When true, also raycasts against punched cutout/hole tiles (useful for restoring holes or placing subterranean props). */
  includeHoles?: boolean;
}

export function pickTerrain(grid: TerrainGrid, ray: Ray3, options: TerrainPickOptions = {}): TerrainPickHit | null {
  const includeHoles = options.includeHoles ?? false;
  let bestT = Infinity;

  for (let cz = 0; cz < grid.chunksZ; cz++) {
    for (let cx = 0; cx < grid.chunksX; cx++) {
      const startTx = cx * CHUNK_SIZE;
      const startTz = cz * CHUNK_SIZE;
      const endTx = Math.min(grid.width, startTx + CHUNK_SIZE);
      const endTz = Math.min(grid.length, startTz + CHUNK_SIZE);

      let minY = Infinity;
      let maxY = -Infinity;
      for (let vz = startTz; vz <= endTz; vz++) {
        for (let vx = startTx; vx <= endTx; vx++) {
          const y = grid.getHeight(vx, vz) * METERS_PER_HEIGHT_UNIT;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }

      if (
        !intersectAabb(
          ray,
          startTx * TILE_SIZE_METERS,
          minY - 0.05,
          startTz * TILE_SIZE_METERS,
          endTx * TILE_SIZE_METERS,
          maxY + 0.05,
          endTz * TILE_SIZE_METERS
        )
      ) {
        continue;
      }

      for (let tz = startTz; tz < endTz; tz++) {
        const z0 = tz * TILE_SIZE_METERS;
        const z1 = (tz + 1) * TILE_SIZE_METERS;
        for (let tx = startTx; tx < endTx; tx++) {
          if (!includeHoles && grid.isHole(tx, tz)) continue;
          const x0 = tx * TILE_SIZE_METERS;
          const x1 = (tx + 1) * TILE_SIZE_METERS;
          const ySW = grid.getHeight(tx, tz) * METERS_PER_HEIGHT_UNIT;
          const ySE = grid.getHeight(tx + 1, tz) * METERS_PER_HEIGHT_UNIT;
          const yNW = grid.getHeight(tx, tz + 1) * METERS_PER_HEIGHT_UNIT;
          const yNE = grid.getHeight(tx + 1, tz + 1) * METERS_PER_HEIGHT_UNIT;

          const t1 = intersectTriangle(ray, x0, ySW, z0, x0, yNW, z1, x1, yNE, z1);
          if (t1 > 0 && t1 < bestT) bestT = t1;
          const t2 = intersectTriangle(ray, x0, ySW, z0, x1, yNE, z1, x1, ySE, z0);
          if (t2 > 0 && t2 < bestT) bestT = t2;
        }
      }
    }
  }

  if (!Number.isFinite(bestT)) {
    return null;
  }

  const worldX = ray.originX + ray.dirX * bestT;
  const worldY = ray.originY + ray.dirY * bestT;
  const worldZ = ray.originZ + ray.dirZ * bestT;
  const tileFloatX = worldX / TILE_SIZE_METERS;
  const tileFloatZ = worldZ / TILE_SIZE_METERS;

  const tileX = Math.max(0, Math.min(grid.width - 1, Math.floor(tileFloatX)));
  const tileZ = Math.max(0, Math.min(grid.length - 1, Math.floor(tileFloatZ)));
  const vertexX = Math.max(0, Math.min(grid.width, Math.round(tileFloatX)));
  const vertexZ = Math.max(0, Math.min(grid.length, Math.round(tileFloatZ)));

  return {
    worldX,
    worldY,
    worldZ,
    tileFloatX,
    tileFloatZ,
    tileX,
    tileZ,
    vertexX,
    vertexZ,
    distance: bestT,
  };
}
