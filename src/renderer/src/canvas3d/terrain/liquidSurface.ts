/**
 * Flat Liquid Surface data model, presets, flush edge-snapping,
 * directional continuation, connected-network detection, and ray picking.
 *
 * Liquid surfaces are independent of the terrain heightmap: each surface is a
 * perfectly flat horizontal rectangle at an explicit elevation (`levelFeet`),
 * with world-space animated shaders so flush-connected segments join seamlessly.
 */

import type { MapLayerId } from '../map/mapDocument';
import { METERS_PER_FOOT, TILE_SIZE_METERS } from './constants';
import type { Ray3 } from './raycast';

export type LiquidPresetId =
  | 'clear_water'
  | 'deep_water'
  | 'swamp_water'
  | 'sewer_sludge'
  | 'magma'
  | 'acid'
  | 'blood'
  | 'oil';

export type LiquidShaderPattern = 'WATER' | 'MAGMA' | 'ACID';
export type LiquidEdgeSide = 'N' | 'S' | 'E' | 'W';

export interface LiquidPreset {
  readonly id: LiquidPresetId;
  readonly name: string;
  readonly hex: number;
  readonly opacity: number;
  readonly roughness: number;
  readonly pattern: LiquidShaderPattern;
  readonly emissive: boolean;
}

export const LIQUID_PRESETS: readonly LiquidPreset[] = [
  {
    id: 'clear_water',
    name: 'Clear Water',
    hex: 0x3587b8,
    opacity: 0.56,
    roughness: 0.14,
    pattern: 'WATER',
    emissive: false,
  },
  {
    id: 'deep_water',
    name: 'Deep Water',
    hex: 0x1d4f7a,
    opacity: 0.72,
    roughness: 0.18,
    pattern: 'WATER',
    emissive: false,
  },
  {
    id: 'swamp_water',
    name: 'Swamp Water',
    hex: 0x355946,
    opacity: 0.74,
    roughness: 0.30,
    pattern: 'WATER',
    emissive: false,
  },
  {
    id: 'sewer_sludge',
    name: 'Sewer Sludge',
    hex: 0x3c4f2b,
    opacity: 0.80,
    roughness: 0.34,
    pattern: 'WATER',
    emissive: false,
  },
  {
    id: 'magma',
    name: 'Magma / Lava',
    hex: 0xc94718,
    opacity: 0.98,
    roughness: 0.45,
    pattern: 'MAGMA',
    emissive: true,
  },
  {
    id: 'acid',
    name: 'Toxic Acid',
    hex: 0x57c922,
    opacity: 0.84,
    roughness: 0.22,
    pattern: 'ACID',
    emissive: true,
  },
  {
    id: 'blood',
    name: 'Blood Pool',
    hex: 0x7c141a,
    opacity: 0.90,
    roughness: 0.20,
    pattern: 'WATER',
    emissive: false,
  },
  {
    id: 'oil',
    name: 'Dark Oil',
    hex: 0x1e2029,
    opacity: 0.94,
    roughness: 0.10,
    pattern: 'WATER',
    emissive: false,
  },
];

const PRESET_BY_ID = new Map<LiquidPresetId, LiquidPreset>(
  LIQUID_PRESETS.map((p) => [p.id, p])
);

export function getLiquidPreset(id: LiquidPresetId): LiquidPreset {
  return PRESET_BY_ID.get(id) ?? LIQUID_PRESETS[0]!;
}

export function isValidLiquidPreset(value: unknown): value is LiquidPresetId {
  return typeof value === 'string' && PRESET_BY_ID.has(value as LiquidPresetId);
}

export interface LiquidSurface {
  id: string;
  layer: MapLayerId;
  preset: LiquidPresetId;
  /** Origin (min X, min Z) in tile coordinates (5ft / 1.5m units). */
  x: number;
  z: number;
  /** Extent along +X in tiles (minimum 0.5). */
  width: number;
  /** Extent along +Z in tiles (minimum 0.5). */
  length: number;
  /** Perfectly flat horizontal elevation in feet relative to the layer's 0 ft datum. */
  levelFeet: number;
  /** Optional opacity override (0.15..1.0); defaults to preset opacity. */
  opacity?: number;
  /** Optional custom hex color override; defaults to preset hex. */
  colorHex?: number;
}

export interface LiquidRect {
  x: number;
  z: number;
  width: number;
  length: number;
}

export interface LiquidSnapLine {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  levelFeet: number;
}

export interface LiquidSnapResult {
  rect: LiquidRect;
  snappedTo: LiquidSurface | null;
  snapLines: LiquidSnapLine[];
}

export const MIN_LIQUID_SIZE_TILES = 0.5;
export const MIN_LIQUID_LEVEL_FEET = -40;
export const MAX_LIQUID_LEVEL_FEET = 80;

const CONNECTION_EDGE_EPS = 0.06;
const CONNECTION_LEVEL_EPS = 0.15;
const MIN_SHARED_SPAN = 0.05;

export function feetToWorldMeters(feet: number): number {
  return feet * METERS_PER_FOOT;
}

export function worldMetersToFeet(meters: number): number {
  return meters / METERS_PER_FOOT;
}

export function quantizeStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clampLiquidLevelFeet(levelFeet: number): number {
  if (!Number.isFinite(levelFeet)) return 0;
  return Math.max(MIN_LIQUID_LEVEL_FEET, Math.min(MAX_LIQUID_LEVEL_FEET, Math.round(levelFeet * 100) / 100));
}

export function clampLiquidOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 0.8;
  return Math.max(0.15, Math.min(1.0, Math.round(opacity * 100) / 100));
}

export function clampLiquidRectToMap(
  rect: LiquidRect,
  mapWidth: number,
  mapLength: number
): LiquidRect {
  const w = Math.max(MIN_LIQUID_SIZE_TILES, Math.min(mapWidth, rect.width));
  const l = Math.max(MIN_LIQUID_SIZE_TILES, Math.min(mapLength, rect.length));
  const x = Math.max(0, Math.min(mapWidth - w, rect.x));
  const z = Math.max(0, Math.min(mapLength - l, rect.z));
  return {
    x: roundCoord(x),
    z: roundCoord(z),
    width: roundCoord(w),
    length: roundCoord(l),
  };
}

/**
 * Returns true if two liquid surfaces on the same layer touch flush along a
 * shared edge (or overlap) AND sit at the same elevation (within tolerance).
 */
export function areLiquidsConnected(
  a: LiquidSurface,
  b: LiquidSurface,
  requireSameLevel = true
): boolean {
  if (a.id === b.id) return false;
  if (a.layer !== b.layer) return false;
  if (requireSameLevel && Math.abs(a.levelFeet - b.levelFeet) > CONNECTION_LEVEL_EPS) {
    return false;
  }

  const aMaxX = a.x + a.width;
  const aMaxZ = a.z + a.length;
  const bMaxX = b.x + b.width;
  const bMaxZ = b.z + b.length;

  const overlapX = Math.min(aMaxX, bMaxX) - Math.max(a.x, b.x);
  const overlapZ = Math.min(aMaxZ, bMaxZ) - Math.max(a.z, b.z);

  // Overlapping in 2D
  if (overlapX > MIN_SHARED_SPAN && overlapZ > MIN_SHARED_SPAN) {
    return true;
  }

  // Touching flush along East/West edge with positive Z span
  const touchesX =
    Math.abs(aMaxX - b.x) <= CONNECTION_EDGE_EPS || Math.abs(bMaxX - a.x) <= CONNECTION_EDGE_EPS;
  if (touchesX && overlapZ > MIN_SHARED_SPAN) {
    return true;
  }

  // Touching flush along North/South edge with positive X span
  const touchesZ =
    Math.abs(aMaxZ - b.z) <= CONNECTION_EDGE_EPS || Math.abs(bMaxZ - a.z) <= CONNECTION_EDGE_EPS;
  if (touchesZ && overlapX > MIN_SHARED_SPAN) {
    return true;
  }

  return false;
}

/**
 * Finds all liquid surfaces in the same connected network as `seedId` (including `seedId`).
 */
export function findConnectedLiquidIds(
  surfaces: readonly LiquidSurface[],
  seedId: string,
  requireSameLevel = true
): Set<string> {
  const byId = new Map<string, LiquidSurface>();
  for (const s of surfaces) byId.set(s.id, s);
  const seed = byId.get(seedId);
  const visited = new Set<string>();
  if (!seed) return visited;

  const queue: LiquidSurface[] = [seed];
  visited.add(seed.id);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const candidate of surfaces) {
      if (visited.has(candidate.id)) continue;
      if (areLiquidsConnected(cur, candidate, requireSameLevel)) {
        visited.add(candidate.id);
        queue.push(candidate);
      }
    }
  }
  return visited;
}

/**
 * Finds the nearest touching/adjacent neighbor (even if at a different level)
 * for "Match Neighbor Level" workflows.
 */
export function findAdjacentNeighbor(
  surfaces: readonly LiquidSurface[],
  target: LiquidSurface
): LiquidSurface | null {
  for (const candidate of surfaces) {
    if (areLiquidsConnected(target, candidate, false)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Creates a new connected liquid surface flush against one of `source`'s 4 edges:
 *   - 'N': -Z side
 *   - 'S': +Z side
 *   - 'E': +X side
 *   - 'W': -X side
 * Inherits exact `levelFeet`, `preset`, `opacity`, `colorHex`, and `layer`.
 */
export function createContinuedLiquid(
  source: LiquidSurface,
  side: LiquidEdgeSide,
  extensionTiles: number,
  mapWidth: number,
  mapLength: number,
  newId: string
): LiquidSurface | null {
  const ext = Math.max(MIN_LIQUID_SIZE_TILES, extensionTiles);
  let x = source.x;
  let z = source.z;
  let width = source.width;
  let length = source.length;

  if (side === 'E') {
    x = source.x + source.width;
    width = Math.min(ext, mapWidth - x);
  } else if (side === 'W') {
    width = Math.min(ext, source.x);
    x = source.x - width;
  } else if (side === 'S') {
    z = source.z + source.length;
    length = Math.min(ext, mapLength - z);
  } else {
    // 'N' (-Z)
    length = Math.min(ext, source.z);
    z = source.z - length;
  }

  if (width < MIN_LIQUID_SIZE_TILES - 1e-4 || length < MIN_LIQUID_SIZE_TILES - 1e-4) {
    return null;
  }

  return {
    id: newId,
    layer: source.layer,
    preset: source.preset,
    x: roundCoord(x),
    z: roundCoord(z),
    width: roundCoord(width),
    length: roundCoord(length),
    levelFeet: source.levelFeet,
    ...(source.opacity !== undefined ? { opacity: source.opacity } : {}),
    ...(source.colorHex !== undefined ? { colorHex: source.colorHex } : {}),
  };
}

/**
 * Snaps a moving or newly placed rectangle flush against nearby neighbor liquid edges.
 * Returns the adjusted rect, the primary snapped neighbor (for inheriting level/preset),
 * and visual snap-seam lines to highlight in the 3D viewport.
 */
export function snapLiquidRectMove(
  rect: LiquidRect,
  neighbors: readonly LiquidSurface[],
  snapThresholdTiles = 0.55
): LiquidSnapResult {
  let x = rect.x;
  let z = rect.z;
  const w = rect.width;
  const l = rect.length;

  let bestDx = snapThresholdTiles + 1;
  let snapX: number | null = null;
  let xNeighbor: LiquidSurface | null = null;
  let xSeamCoord = 0;

  let bestDz = snapThresholdTiles + 1;
  let snapZ: number | null = null;
  let zNeighbor: LiquidSurface | null = null;
  let zSeamCoord = 0;

  for (const n of neighbors) {
    const nMinX = n.x;
    const nMaxX = n.x + n.width;
    const nMinZ = n.z;
    const nMaxZ = n.z + n.length;

    // Check if Z intervals are close enough to make an X-edge snap meaningful
    const zGap = Math.max(0, Math.max(z - nMaxZ, nMinZ - (z + l)));
    if (zGap <= snapThresholdTiles) {
      // Flush west-to-east: rect.x -> nMaxX
      const d1 = Math.abs(x - nMaxX);
      if (d1 < bestDx) {
        bestDx = d1;
        snapX = nMaxX;
        xNeighbor = n;
        xSeamCoord = nMaxX;
      }
      // Flush east-to-west: rect.x + w -> nMinX
      const d2 = Math.abs(x + w - nMinX);
      if (d2 < bestDx) {
        bestDx = d2;
        snapX = nMinX - w;
        xNeighbor = n;
        xSeamCoord = nMinX;
      }
      // Align left edges
      const d3 = Math.abs(x - nMinX);
      if (d3 < bestDx * 0.85) {
        bestDx = d3;
        snapX = nMinX;
        xNeighbor = n;
        xSeamCoord = nMinX;
      }
      // Align right edges
      const d4 = Math.abs(x + w - nMaxX);
      if (d4 < bestDx * 0.85) {
        bestDx = d4;
        snapX = nMaxX - w;
        xNeighbor = n;
        xSeamCoord = nMaxX;
      }
    }

    // Check if X intervals are close enough to make a Z-edge snap meaningful
    const xGap = Math.max(0, Math.max(x - nMaxX, nMinX - (x + w)));
    if (xGap <= snapThresholdTiles) {
      // Flush north-to-south: rect.z -> nMaxZ
      const d1 = Math.abs(z - nMaxZ);
      if (d1 < bestDz) {
        bestDz = d1;
        snapZ = nMaxZ;
        zNeighbor = n;
        zSeamCoord = nMaxZ;
      }
      // Flush south-to-north: rect.z + l -> nMinZ
      const d2 = Math.abs(z + l - nMinZ);
      if (d2 < bestDz) {
        bestDz = d2;
        snapZ = nMinZ - l;
        zNeighbor = n;
        zSeamCoord = nMinZ;
      }
      // Align top edges
      const d3 = Math.abs(z - nMinZ);
      if (d3 < bestDz * 0.85) {
        bestDz = d3;
        snapZ = nMinZ;
        zNeighbor = n;
        zSeamCoord = nMinZ;
      }
      // Align bottom edges
      const d4 = Math.abs(z + l - nMaxZ);
      if (d4 < bestDz * 0.85) {
        bestDz = d4;
        snapZ = nMaxZ - l;
        zNeighbor = n;
        zSeamCoord = nMaxZ;
      }
    }
  }

  const snapLines: LiquidSnapLine[] = [];
  if (snapX !== null && bestDx <= snapThresholdTiles && xNeighbor) {
    x = snapX;
    const minZ = Math.min(z, xNeighbor.z);
    const maxZ = Math.max(z + l, xNeighbor.z + xNeighbor.length);
    snapLines.push({ x0: xSeamCoord, z0: minZ, x1: xSeamCoord, z1: maxZ, levelFeet: xNeighbor.levelFeet });
  }
  if (snapZ !== null && bestDz <= snapThresholdTiles && zNeighbor) {
    z = snapZ;
    const minX = Math.min(x, zNeighbor.x);
    const maxX = Math.max(x + w, zNeighbor.x + zNeighbor.width);
    snapLines.push({ x0: minX, z0: zSeamCoord, x1: maxX, z1: zSeamCoord, levelFeet: zNeighbor.levelFeet });
  }

  const snappedTo =
    xNeighbor && zNeighbor
      ? bestDx <= bestDz
        ? xNeighbor
        : zNeighbor
      : xNeighbor ?? zNeighbor;

  return {
    rect: { x: roundCoord(x), z: roundCoord(z), width: roundCoord(w), length: roundCoord(l) },
    snappedTo,
    snapLines,
  };
}

/**
 * Snaps a single dragged point (e.g. draw start/end or edge handle coordinate)
 * to any nearby neighbor liquid edge on the X or Z axis.
 */
export function snapPointToLiquidEdges(
  tileX: number,
  tileZ: number,
  neighbors: readonly LiquidSurface[],
  snapThresholdTiles = 0.55
): {
  x: number;
  z: number;
  snappedTo: LiquidSurface | null;
  snapLines: LiquidSnapLine[];
} {
  let outX = tileX;
  let outZ = tileZ;
  let bestDx = snapThresholdTiles + 1;
  let xNeighbor: LiquidSurface | null = null;
  let bestDz = snapThresholdTiles + 1;
  let zNeighbor: LiquidSurface | null = null;

  for (const n of neighbors) {
    const nMinX = n.x;
    const nMaxX = n.x + n.width;
    const nMinZ = n.z;
    const nMaxZ = n.z + n.length;

    if (tileZ >= nMinZ - snapThresholdTiles && tileZ <= nMaxZ + snapThresholdTiles) {
      const dMinX = Math.abs(tileX - nMinX);
      if (dMinX < bestDx) {
        bestDx = dMinX;
        outX = nMinX;
        xNeighbor = n;
      }
      const dMaxX = Math.abs(tileX - nMaxX);
      if (dMaxX < bestDx) {
        bestDx = dMaxX;
        outX = nMaxX;
        xNeighbor = n;
      }
    }

    if (tileX >= nMinX - snapThresholdTiles && tileX <= nMaxX + snapThresholdTiles) {
      const dMinZ = Math.abs(tileZ - nMinZ);
      if (dMinZ < bestDz) {
        bestDz = dMinZ;
        outZ = nMinZ;
        zNeighbor = n;
      }
      const dMaxZ = Math.abs(tileZ - nMaxZ);
      if (dMaxZ < bestDz) {
        bestDz = dMaxZ;
        outZ = nMaxZ;
        zNeighbor = n;
      }
    }
  }

  const snapLines: LiquidSnapLine[] = [];
  if (xNeighbor && bestDx <= snapThresholdTiles) {
    snapLines.push({
      x0: outX,
      z0: xNeighbor.z,
      x1: outX,
      z1: xNeighbor.z + xNeighbor.length,
      levelFeet: xNeighbor.levelFeet,
    });
  } else {
    xNeighbor = null;
    outX = tileX;
  }

  if (zNeighbor && bestDz <= snapThresholdTiles) {
    snapLines.push({
      x0: zNeighbor.x,
      z0: outZ,
      x1: zNeighbor.x + zNeighbor.width,
      z1: outZ,
      levelFeet: zNeighbor.levelFeet,
    });
  } else {
    zNeighbor = null;
    outZ = tileZ;
  }

  const snappedTo =
    xNeighbor && zNeighbor
      ? bestDx <= bestDz
        ? xNeighbor
        : zNeighbor
      : xNeighbor ?? zNeighbor;

  return {
    x: roundCoord(outX),
    z: roundCoord(outZ),
    snappedTo,
    snapLines,
  };
}

/**
 * Exact ray-vs-horizontal-plane intersection.
 * Returns world & tile coordinates where the ray crosses `y = planeWorldY`,
 * or `null` if the ray is parallel or points away from the plane.
 */
export function intersectHorizontalPlane(
  ray: Ray3,
  planeWorldY: number
): { worldX: number; worldY: number; worldZ: number; tileX: number; tileZ: number; distance: number } | null {
  if (Math.abs(ray.dirY) < 1e-6) return null;
  const t = (planeWorldY - ray.originY) / ray.dirY;
  if (t <= 0) return null;
  const worldX = ray.originX + ray.dirX * t;
  const worldZ = ray.originZ + ray.dirZ * t;
  return {
    worldX,
    worldY: planeWorldY,
    worldZ,
    tileX: worldX / TILE_SIZE_METERS,
    tileZ: worldZ / TILE_SIZE_METERS,
    distance: t,
  };
}

/**
 * Picks the closest liquid surface hit by `ray` on the active layer.
 */
export function pickLiquidSurface(
  ray: Ray3,
  surfaces: readonly LiquidSurface[],
  layerOffsetY = 0
): { surface: LiquidSurface; tileX: number; tileZ: number; distance: number } | null {
  let best: { surface: LiquidSurface; tileX: number; tileZ: number; distance: number } | null = null;
  for (const s of surfaces) {
    const planeY = feetToWorldMeters(s.levelFeet) + layerOffsetY;
    const hit = intersectHorizontalPlane(ray, planeY);
    if (!hit) continue;
    if (
      hit.tileX >= s.x - 0.02 &&
      hit.tileX <= s.x + s.width + 0.02 &&
      hit.tileZ >= s.z - 0.02 &&
      hit.tileZ <= s.z + s.length + 0.02
    ) {
      if (!best || hit.distance < best.distance) {
        best = { surface: s, tileX: hit.tileX, tileZ: hit.tileZ, distance: hit.distance };
      }
    }
  }
  return best;
}

/**
 * Tests whether `ray` hits one of the 4 edge resize handles (N, S, E, W)
 * of the currently selected liquid surface.
 */
export function pickLiquidEdgeHandle(
  ray: Ray3,
  surface: LiquidSurface,
  layerOffsetY = 0,
  handleRadiusTiles = 0.48
): LiquidEdgeSide | null {
  const planeY = feetToWorldMeters(surface.levelFeet) + layerOffsetY;
  const hit = intersectHorizontalPlane(ray, planeY);
  if (!hit) return null;

  const midX = surface.x + surface.width * 0.5;
  const midZ = surface.z + surface.length * 0.5;
  const handles: readonly { side: LiquidEdgeSide; x: number; z: number }[] = [
    { side: 'N', x: midX, z: surface.z },
    { side: 'S', x: midX, z: surface.z + surface.length },
    { side: 'W', x: surface.x, z: midZ },
    { side: 'E', x: surface.x + surface.width, z: midZ },
  ];

  let bestSide: LiquidEdgeSide | null = null;
  let bestDist = handleRadiusTiles;
  for (const h of handles) {
    const d = Math.hypot(hit.tileX - h.x, hit.tileZ - h.z);
    if (d < bestDist) {
      bestDist = d;
      bestSide = h.side;
    }
  }
  return bestSide;
}
