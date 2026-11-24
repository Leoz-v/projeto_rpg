/**
 * Exact TypeScript port of WorldLab's terrain sculpting math:
 *   - TerrainBrushMode.java (RAISE, LOWER, SMOOTH, RELAX, FLATTEN, TERRACE, PLATEAU, RIDGE, VALLEY, NOISE, GRADE)
 *   - SculptFalloff.java (HARD, LINEAR, SMOOTH, GAUSSIAN)
 *   - TerrainSculptKernel.java & SculptHeightMath.java
 *   - Built-in WorldLab presets + D&D 5ft Ledge preset + Editable Masks + Max Slope Limiter
 */

import { HEIGHT_UNITS_PER_TILE, MAX_HEIGHT_UNITS, MIN_HEIGHT_UNITS } from '../terrain/constants';
import type { TerrainGrid } from '../terrain/terrainGrid';

export type TerrainBrushMode =
  | 'RAISE'
  | 'LOWER'
  | 'SMOOTH'
  | 'RELAX'
  | 'FLATTEN'
  | 'TERRACE'
  | 'PLATEAU'
  | 'RIDGE'
  | 'VALLEY'
  | 'NOISE'
  | 'GRADE';

export type SculptBrushShape = 'CIRCLE' | 'SQUARE';
export type SculptFalloff = 'HARD' | 'LINEAR' | 'SMOOTH' | 'GAUSSIAN';
export type SculptMaskMode = 'ALL' | 'HEIGHT' | 'UNDERLAY' | 'OVERLAY';

export interface SculptSettings {
  mode: TerrainBrushMode;
  shape: SculptBrushShape;
  falloff: SculptFalloff;
  radius: number;
  strength: number;
  terraceStep: number;
  terraceOffset: number;
  terraceTransitionPercent: number;
  plateauInnerPercent: number;
  ridgeCrestPercent: number;
  ridgeShoulderPercent: number;
  featureHeight: number;
  noiseAmplitude: number;
  noiseScale: number;
  noiseSeed: number;
  flattenTarget: number;
  maxSlope: number; // 0 = disabled, otherwise max adjacent delta in height units
  maskMode: SculptMaskMode;
  maskMinHeight: number;
  maskMaxHeight: number;
  maskMaterialId: number;
}

export interface SculptPreset {
  id: string;
  label: string;
  description: string;
  patch: Partial<SculptSettings>;
}

export const SCULPT_PRESETS: readonly SculptPreset[] = [
  {
    id: 'soft_hills',
    label: 'Soft Hills',
    description: 'Gentle Gaussian raise, broad radius, low strength',
    patch: {
      mode: 'RAISE',
      shape: 'CIRCLE',
      falloff: 'GAUSSIAN',
      radius: 5,
      strength: 0.45,
      maxSlope: 0,
      maskMode: 'ALL',
    },
  },
  {
    id: 'dnd_ledge',
    label: '5 ft Ledge',
    description: 'D&D tactical 5 ft (1.5 m) elevation contours',
    patch: {
      mode: 'TERRACE',
      shape: 'SQUARE',
      falloff: 'HARD',
      radius: 3,
      strength: 0.85,
      terraceStep: HEIGHT_UNITS_PER_TILE, // Exact 5 ft = 1.5 m = 128 units!
      terraceOffset: 0,
      terraceTransitionPercent: 10,
      maxSlope: 0,
      maskMode: 'ALL',
    },
  },
  {
    id: 'terraced_hill',
    label: 'Terraced Hill',
    description: 'Square footprint with crisp elevation bands',
    patch: {
      mode: 'TERRACE',
      shape: 'SQUARE',
      falloff: 'SMOOTH',
      radius: 4,
      strength: 0.75,
      terraceStep: 64,
      terraceOffset: 0,
      terraceTransitionPercent: 20,
      maxSlope: 0,
      maskMode: 'ALL',
    },
  },
  {
    id: 'ridge_line',
    label: 'Ridge Line',
    description: 'Continuous crest with shaped shoulders',
    patch: {
      mode: 'RIDGE',
      shape: 'CIRCLE',
      falloff: 'SMOOTH',
      radius: 4,
      strength: 0.8,
      featureHeight: 160,
      ridgeCrestPercent: 30,
      ridgeShoulderPercent: 110,
      maxSlope: 0,
      maskMode: 'ALL',
    },
  },
  {
    id: 'carved_channel',
    label: 'Carved Channel',
    description: 'Valley trench cross-section for rivers & ditches',
    patch: {
      mode: 'VALLEY',
      shape: 'CIRCLE',
      falloff: 'SMOOTH',
      radius: 3,
      strength: 0.8,
      featureHeight: 128,
      ridgeCrestPercent: 25,
      ridgeShoulderPercent: 120,
      maxSlope: 0,
      maskMode: 'ALL',
    },
  },
  {
    id: 'level_site',
    label: 'Level Site',
    description: 'Hard-edged square flatten for buildings & camps',
    patch: {
      mode: 'FLATTEN',
      shape: 'SQUARE',
      falloff: 'HARD',
      radius: 3,
      strength: 0.9,
      maxSlope: 0,
      maskMode: 'ALL',
    },
  },
];

export function createDefaultSculptSettings(): SculptSettings {
  return {
    mode: 'RAISE',
    shape: 'CIRCLE',
    falloff: 'SMOOTH',
    radius: 3,
    strength: 0.65,
    terraceStep: HEIGHT_UNITS_PER_TILE,
    terraceOffset: 0,
    terraceTransitionPercent: 15,
    plateauInnerPercent: 50,
    ridgeCrestPercent: 30,
    ridgeShoulderPercent: 100,
    featureHeight: 128,
    noiseAmplitude: 64,
    noiseScale: 6,
    noiseSeed: 42,
    flattenTarget: 0,
    maxSlope: 0,
    maskMode: 'ALL',
    maskMinHeight: MIN_HEIGHT_UNITS,
    maskMaxHeight: MAX_HEIGHT_UNITS,
    maskMaterialId: 1,
  };
}

export function falloffWeight(falloff: SculptFalloff, normalizedDistance: number): number {
  const d = Math.max(0, Math.min(1, normalizedDistance));
  switch (falloff) {
    case 'HARD':
      return 1;
    case 'LINEAR':
      return 1 - d;
    case 'SMOOTH':
      return 1 - d * d * (3 - 2 * d);
    case 'GAUSSIAN':
      return Math.exp(-4 * d * d);
  }
}

export function sculptInfluence(
  shape: SculptBrushShape,
  falloff: SculptFalloff,
  dx: number,
  dz: number,
  radius: number
): number {
  const dist = shape === 'SQUARE' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
  if (dist > radius) return 0;
  if (radius === 0) return 1;
  return falloffWeight(falloff, dist / (radius + 1));
}

function blend(current: number, target: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  return current + (target - current) * t;
}

export function terraceHeight(height: number, step: number, offset: number, transitionPercent: number): number {
  const s = Math.max(1, step);
  const unit = (height - offset) / s;
  const level = Math.floor(unit);
  const fraction = unit - level;
  const width = Math.max(0, Math.min(1, transitionPercent / 100));
  let transition: number;
  if (width <= 0) {
    transition = fraction >= 0.5 ? 1 : 0;
  } else {
    const start = 0.5 - width * 0.5;
    const t = Math.max(0, Math.min(1, (fraction - start) / width));
    transition = t * t * (3 - 2 * t);
  }
  return offset + (level + transition) * s;
}

export function ridgeProfile(
  dx: number,
  dz: number,
  radius: number,
  shape: SculptBrushShape,
  crestPercent: number,
  shoulderPercent: number,
  falloff: SculptFalloff
): number {
  const dist = shape === 'SQUARE' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
  if (dist > radius) return 0;
  if (radius === 0) return 1;
  const crest = radius * Math.max(0, Math.min(0.9, crestPercent / 100));
  if (dist <= crest) return 1;
  const t = (dist - crest) / (radius + 1 - crest);
  const shoulder = Math.pow(Math.max(0, 1 - t), Math.max(0.25, shoulderPercent / 100));
  if (falloff === 'HARD') return shoulder;
  return shoulder * falloffWeight(falloff, t);
}

function hashNoise(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77) ^ Math.imul(seed, 0xc2b2ae3d)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 8) & 0xffffff) / 0x7fffff - 1;
}

function valueNoise2d(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  let tx = x - x0;
  let tz = z - z0;
  tx = tx * tx * (3 - 2 * tx);
  tz = tz * tz * (3 - 2 * tz);
  const a = hashNoise(x0, z0, seed);
  const b = hashNoise(x0 + 1, z0, seed);
  const c = hashNoise(x0, z0 + 1, seed);
  const d = hashNoise(x0 + 1, z0 + 1, seed);
  const south = a + (b - a) * tx;
  const north = c + (d - c) * tx;
  return south + (north - south) * tz;
}

export function sculptNoise(x: number, z: number, scale: number, seed: number): number {
  let total = 0;
  let amp = 1;
  let norm = 0;
  let px = x / Math.max(2, scale);
  let pz = z / Math.max(2, scale);
  for (let oct = 0; oct < 3; oct++) {
    total += valueNoise2d(px, pz, seed + oct * 0x45d9f3b) * amp;
    norm += amp;
    px *= 2;
    pz *= 2;
    amp *= 0.5;
  }
  return total / norm;
}

export function neighborAverageHeight(
  x: number,
  z: number,
  center: number,
  getHeight: (vx: number, vz: number) => number,
  preserveEdges: boolean
): number {
  let total = 0;
  let weightSum = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const sample = getHeight(x + dx, z + dz);
      let w = dx === 0 && dz === 0 ? 1.5 : dx === 0 || dz === 0 ? 1.0 : 0.75;
      if (preserveEdges) {
        const diff = (sample - center) / 48;
        w /= 1 + diff * diff * 2.5;
      }
      total += sample * w;
      weightSum += w;
    }
  }
  return weightSum > 0 ? total / weightSum : center;
}

export function vertexMatchesMask(
  grid: TerrainGrid,
  vx: number,
  vz: number,
  originalHeight: number,
  settings: SculptSettings
): boolean {
  switch (settings.maskMode) {
    case 'ALL':
      return true;
    case 'HEIGHT':
      return originalHeight >= settings.maskMinHeight && originalHeight <= settings.maskMaxHeight;
    case 'UNDERLAY':
      return grid.inTileBounds(vx, vz) && grid.getUnderlay(vx, vz) === settings.maskMaterialId;
    case 'OVERLAY':
      return grid.inTileBounds(vx, vz) && grid.getTile(vx, vz).overlayId === settings.maskMaterialId;
  }
}

export function evaluateSculptVertex(
  settings: SculptSettings,
  vx: number,
  vz: number,
  dx: number,
  dz: number,
  current: number,
  original: number,
  neighborSampler: (x: number, z: number) => number
): number {
  const weight = sculptInfluence(settings.shape, settings.falloff, dx, dz, settings.radius);
  if (weight <= 0) return current;
  const strength = Math.max(0, settings.strength);

  switch (settings.mode) {
    case 'RAISE':
      return current + 10 * strength * weight;
    case 'LOWER':
      return current - 10 * strength * weight;
    case 'FLATTEN':
      return blend(current, settings.flattenTarget, 0.38 * strength * weight);
    case 'SMOOTH':
    case 'RELAX': {
      const avg = neighborAverageHeight(vx, vz, current, neighborSampler, settings.mode === 'RELAX');
      const rate = settings.mode === 'RELAX' ? 0.55 : 0.35;
      return blend(current, avg, rate * strength * weight);
    }
    case 'TERRACE':
      return blend(
        current,
        terraceHeight(current, settings.terraceStep, settings.terraceOffset, settings.terraceTransitionPercent),
        strength * weight
      );
    case 'PLATEAU': {
      const dist = settings.shape === 'SQUARE' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
      const inner = (settings.radius * settings.plateauInnerPercent) / 100;
      const transition = Math.max(0.001, settings.radius - inner);
      const rim = dist <= inner ? 1 : Math.max(0, 1 - (dist - inner) / (transition + 1));
      const factor = dist <= inner ? 1 : weight * rim;
      return blend(current, settings.flattenTarget, strength * factor);
    }
    case 'RIDGE': {
      const profile = ridgeProfile(
        dx,
        dz,
        settings.radius,
        settings.shape,
        settings.ridgeCrestPercent,
        settings.ridgeShoulderPercent,
        settings.falloff
      );
      return Math.max(current, original + settings.featureHeight * strength * profile);
    }
    case 'VALLEY': {
      const profile = ridgeProfile(
        dx,
        dz,
        settings.radius,
        settings.shape,
        settings.ridgeCrestPercent,
        settings.ridgeShoulderPercent,
        settings.falloff
      );
      return Math.min(current, original - settings.featureHeight * strength * profile);
    }
    case 'NOISE':
      return blend(
        current,
        original + sculptNoise(vx, vz, settings.noiseScale, settings.noiseSeed) * settings.noiseAmplitude,
        0.35 * strength * weight
      );
    case 'GRADE':
      return current;
  }
}

/**
 * Enforce WorldLab's max-slope limiter on a proposed vertex height without
 * making pre-existing cliffs steeper.
 */
export function applySlopeLimit(
  grid: TerrainGrid,
  vx: number,
  vz: number,
  proposed: number,
  preStrokeHeights: Int16Array,
  maxSlope: number
): number {
  if (maxSlope <= 0) return proposed;
  const orig = preStrokeHeights[grid.vertexIndex(vx, vz)] ?? 0;
  let clamped = proposed;
  const dirs: readonly [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [ox, oz] of dirs) {
    const nx = vx + ox;
    const nz = vz + oz;
    if (!grid.inVertexBounds(nx, nz)) continue;
    const neighborCurrent = grid.getHeight(nx, nz);
    const neighborOrig = preStrokeHeights[grid.vertexIndex(nx, nz)] ?? 0;
    const allowedDelta = Math.max(maxSlope, Math.abs(orig - neighborOrig));
    clamped = Math.max(neighborCurrent - allowedDelta, Math.min(neighborCurrent + allowedDelta, clamped));
  }
  return clamped;
}

/**
 * Apply a Grade line stroke from (startX, startZ) to (endX, endZ).
 */
export function applyGradeStroke(
  grid: TerrainGrid,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  settings: SculptSettings,
  preStrokeHeights: Int16Array
): void {
  const startH = preStrokeHeights[grid.vertexIndex(startX, startZ)] ?? grid.getHeight(startX, startZ);
  const endH = preStrokeHeights[grid.vertexIndex(endX, endZ)] ?? grid.getHeight(endX, endZ);
  const dxLine = endX - startX;
  const dzLine = endZ - startZ;
  const lenSq = dxLine * dxLine + dzLine * dzLine;
  const radius = Math.max(1, settings.radius);

  const minX = Math.max(0, Math.min(startX, endX) - radius);
  const maxX = Math.min(grid.width, Math.max(startX, endX) + radius);
  const minZ = Math.max(0, Math.min(startZ, endZ) - radius);
  const maxZ = Math.min(grid.length, Math.max(startZ, endZ) + radius);

  for (let vz = minZ; vz <= maxZ; vz++) {
    for (let vx = minX; vx <= maxX; vx++) {
      const orig = preStrokeHeights[grid.vertexIndex(vx, vz)] ?? 0;
      if (!vertexMatchesMask(grid, vx, vz, orig, settings)) continue;
      const t = lenSq < 1e-6 ? 0 : Math.max(0, Math.min(1, ((vx - startX) * dxLine + (vz - startZ) * dzLine) / lenSq));
      const projX = startX + dxLine * t;
      const projZ = startZ + dzLine * t;
      const dist = Math.hypot(vx - projX, vz - projZ);
      if (dist > radius) continue;
      const w = falloffWeight(settings.falloff, dist / (radius + 1));
      const target = startH + (endH - startH) * t;
      const next = blend(orig, target, settings.strength * w);
      const limited = applySlopeLimit(grid, vx, vz, next, preStrokeHeights, settings.maxSlope);
      grid.setHeight(vx, vz, limited);
    }
  }
}
