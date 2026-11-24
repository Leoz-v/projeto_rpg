/**
 * Exact TypeScript port of WorldLab's RS2 color variation & terrain lighting stack:
 *   - TerrainMaterialShading.java (domain-warped rotated 2D simplex noise,
 *     stepped HSL palette packing, RS2 chroma-weighted underlay blend math)
 *   - Rs2GroundPalette.java (6/3/7-bit HSL16 palette pack, shade, decode)
 *   - TerrainLighting.java (vertex normal daylight brightness, ambient occlusion,
 *     rock facet shading)
 */

import type { ColorVariation, TerrainMaterialDefinition } from './materials';
import { isSoftBlend, isWaterLike } from './materials';

export type TerrainFormPlane = 'PLAIN' | 'CAP' | 'FACE' | 'FOOT';

export interface TerrainLightingSettings {
  sunX: number;
  sunY: number;
  sunZ: number;
  ambient: number;
  diffuse: number;
  slopeFloor: number;
  minBrightness: number;
  maxBrightness: number;
  rockShadowThreshold: number;
  rockLitThreshold: number;
  rockShadowMultiplier: number;
  rockMiddleMultiplier: number;
  rockLitMultiplier: number;
}

export function createDefaultLightingSettings(): TerrainLightingSettings {
  const sx = -0.48;
  const sy = 0.63;
  const sz = 0.61;
  const len = Math.hypot(sx, sy, sz);
  return {
    sunX: sx / len,
    sunY: sy / len,
    sunZ: sz / len,
    ambient: 0.48,
    diffuse: 0.9,
    slopeFloor: 0.66,
    minBrightness: 0.36,
    maxBrightness: 1.34,
    rockShadowThreshold: 0.4,
    rockLitThreshold: 0.66,
    rockShadowMultiplier: 0.76,
    rockMiddleMultiplier: 0.96,
    rockLitMultiplier: 1.13,
  };
}

export const DEFAULT_LIGHTING = createDefaultLightingSettings();

const HORIZONTAL_KEY_WEIGHT = 0.22;
const SLOPE_SKY_FILL = 0.55;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function wrap(x: number): number {
  const y = x - Math.floor(x);
  return y < 0 ? y + 1 : y;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) * 0.5;
  if (delta < 1e-6) {
    return [0, 0, l];
  }
  const denom = 1 - Math.abs(2 * l - 1);
  const s = denom < 1e-6 ? 0 : delta / denom;
  let h: number;
  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  return [wrap(h / 6), s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = 6 * wrap(h);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c * 0.5;
  return [clamp(r + m, 0, 1), clamp(g + m, 0, 1), clamp(b + m, 0, 1)];
}

// ---- Rs2GroundPalette (6/3/7-bit HSL16 lattice) ----

function bucket(value: number, levels: number): number {
  return Math.min(levels - 1, Math.max(0, Math.floor(value * levels)));
}

/**
 * Lost City / RS2 highlight saturation roll-off (FloType.getTable).
 * Progressively halves saturation above lightness 179 / 192 / 217 / 243 (out of 256)
 * so bright sunlit grass, sand, snow, and marble desaturate gracefully instead of turning neon.
 */
export function applyHighlightSaturationRollOff(saturation: number, lightness: number): number {
  let s = clamp(saturation, 0, 1);
  const light255 = Math.max(0, Math.min(255, Math.floor(clamp(lightness, 0, 1) * 256)));
  if (light255 > 179) s *= 0.5;
  if (light255 > 192) s *= 0.5;
  if (light255 > 217) s *= 0.5;
  if (light255 > 243) s *= 0.5;
  return s;
}

export function packHsl16(hsl: readonly [number, number, number]): number {
  const hue = bucket(hsl[0], 64);
  const rolledSat = applyHighlightSaturationRollOff(hsl[1], hsl[2]);
  const sat = bucket(rolledSat, 8);
  const light = bucket(hsl[2], 128);
  return (hue << 10) | (sat << 7) | light;
}

export function packPreparedRgbToHsl16(rgb: readonly [number, number, number]): number {
  return packHsl16(rgbToHsl(rgb[0], rgb[1], rgb[2]));
}

export function shadeHsl16(packed: number, lightScalar: number): number {
  const baseLight = packed & 127;
  const lit = Math.max(2, Math.min(126, Math.floor(baseLight * Math.max(0, lightScalar))));
  const hue = (packed >> 10) & 63;
  let sat = (packed >> 7) & 7;
  // Apply Lost-City highlight saturation roll-off when lighting pushes a surface into bright highlights (> 179/256 ≈ 89.5/128)
  if (lit > baseLight && lit > 89) {
    const lit255 = lit * 2;
    let rolled = (sat + 0.5) / 8;
    if (lit255 > 179) rolled *= 0.5;
    if (lit255 > 192) rolled *= 0.5;
    if (lit255 > 217) rolled *= 0.5;
    if (lit255 > 243) rolled *= 0.5;
    sat = Math.min(sat, bucket(rolled, 8));
  }
  return (hue << 10) | (sat << 7) | lit;
}

export function decodeHsl16ToRgb(packed: number): [number, number, number] {
  const hue = (packed >> 10) & 63;
  const sat = (packed >> 7) & 7;
  const light = packed & 127;
  return hslToRgb((hue + 0.5) / 64, (sat + 0.5) / 8, light / 128);
}

// ---- Deterministic hash & 2D simplex gradient noise (exact port) ----

function hash2d(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(seed, 0x6c8e9cf5)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h;
}

function simplexCorner(x: number, z: number, dx: number, dz: number, seed: number): number {
  const atten = 0.5 - dx * dx - dz * dz;
  if (atten <= 0) return 0;
  const dir = hash2d(x, z, seed) & 7;
  const diag = 0.7071067812;
  let gx: number;
  let gz: number;
  switch (dir) {
    case 0:
      gx = 1;
      gz = 0;
      break;
    case 1:
      gx = -1;
      gz = 0;
      break;
    case 2:
      gx = 0;
      gz = 1;
      break;
    case 3:
      gx = 0;
      gz = -1;
      break;
    case 4:
      gx = diag;
      gz = diag;
      break;
    case 5:
      gx = -diag;
      gz = diag;
      break;
    case 6:
      gx = diag;
      gz = -diag;
      break;
    default:
      gx = -diag;
      gz = -diag;
      break;
  }
  const sq = atten * atten;
  return sq * sq * (gx * dx + gz * dz);
}

function simplexValue(x: number, z: number, seed: number): number {
  const F2 = 0.3660254038;
  const G2 = 0.2113248654;
  const skew = (x + z) * F2;
  const i = Math.floor(x + skew);
  const j = Math.floor(z + skew);
  const unskew = (i + j) * G2;
  const x0 = x - (i - unskew);
  const z0 = z - (j - unskew);
  const i1 = x0 > z0 ? 1 : 0;
  const j1 = x0 > z0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const z1 = z0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const z2 = z0 - 1 + 2 * G2;
  const value =
    0.5 +
    35 *
      (simplexCorner(i, j, x0, z0, seed) +
        simplexCorner(i + i1, j + j1, x1, z1, seed) +
        simplexCorner(i + 1, j + 1, x2, z2, seed));
  return clamp(value, 0, 1);
}

function warpedBand(x: number, z: number, fieldSeed: number, salt: number, scaleTiles: number, bands: number): number {
  const scale = Math.max(0.75, scaleTiles);
  const seed = (Math.imul(fieldSeed, 131) + salt) | 0;

  // Rotate away from world/tile axes first
  const rx = x * 0.9063078 + z * 0.4226183;
  const rz = -x * 0.4226183 + z * 0.9063078;

  const warpScale = scale * 1.85;
  const warpX = simplexValue(rx / warpScale, rz / warpScale, seed + 19) * 2 - 1;
  const warpZ = simplexValue((rx + 17.3) / warpScale, (rz - 11.7) / warpScale, seed + 71) * 2 - 1;

  const wx = rx + warpX * scale * 0.52;
  const wz = rz + warpZ * scale * 0.52;

  const primary = simplexValue(wx / scale, wz / scale, seed + 113);
  const secondaryScale = scale * 0.58;
  const secondary = simplexValue((wx + wz * 0.31) / secondaryScale, (wz - wx * 0.19) / secondaryScale, seed + 197);

  const value = clamp(primary * 0.78 + secondary * 0.22, 0, 1);
  const levels = Math.max(1, bands - 1);
  const band = Math.round(value * levels) / levels;
  return band * 2 - 1;
}

function steppedUnit(value: number, steps: number): number {
  const b = Math.min(steps - 1, Math.floor(clamp(value, 0, 1) * steps));
  return (b + 0.5) / steps;
}

function steppedField(value: number, steps: number): number {
  return steppedUnit((clamp(value, -1, 1) + 1) * 0.5, steps) * 2 - 1;
}

function visualFieldSeed(material: TerrainMaterialDefinition): number {
  let hash = 0x811c9dc5 | 0;
  for (let i = 0; i < material.key.length; i++) {
    hash ^= material.key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash;
}

export function packAuthoredHsl(
  hue: number,
  saturation: number,
  lightness: number,
  variation: ColorVariation
): [number, number, number] {
  const h = wrap(hue);
  const l = clamp(lightness, 0, 1);
  const s = applyHighlightSaturationRollOff(saturation, l);

  const hBucket = Math.min(variation.hueSteps - 1, Math.floor(h * variation.hueSteps));
  const sBucket = Math.min(variation.saturationSteps - 1, Math.floor(s * variation.saturationSteps));
  const lBucket = Math.min(variation.lightnessSteps - 1, Math.floor(l * variation.lightnessSteps));

  return [
    (hBucket + 0.5) / variation.hueSteps,
    (sBucket + 0.5) / variation.saturationSteps,
    lBucket / variation.lightnessSteps,
  ];
}

function formOffset(material: TerrainMaterialDefinition, plane: TerrainFormPlane): number {
  if (material.lightingMode === 'FACETED') {
    return plane === 'FOOT' ? -0.025 : plane === 'FACE' ? -0.018 : 0;
  }
  switch (plane) {
    case 'CAP':
      return 0.02;
    case 'FOOT':
      return -0.04;
    default:
      return 0;
  }
}

/**
 * Exact port of TerrainMaterialShading.vertexColor().
 * Evaluates world-space domain-warped macro/tile/detail color variation and
 * packs onto the RS2 HSL lattice.
 */
export function computeVertexMaterialColor(
  material: TerrainMaterialDefinition,
  baseR: number,
  baseG: number,
  baseB: number,
  variation: ColorVariation,
  tileX: number,
  tileZ: number,
  u: number,
  v: number,
  plane: TerrainFormPlane = 'PLAIN'
): [number, number, number] {
  if (isWaterLike(material)) {
    return [baseR, baseG, baseB];
  }

  const gx = tileX + u;
  const gz = tileZ + v;
  const soft = isSoftBlend(material);
  const fieldSeed = soft ? 0x4d2 : visualFieldSeed(material);

  let macroTone = warpedBand(gx, gz, fieldSeed, 47, variation.macroScaleTiles, 6);
  const tileScale = Math.max(2, variation.macroScaleTiles * 0.42);
  const detailScale = Math.max(1.25, variation.macroScaleTiles * 0.22);

  let tileTone = warpedBand(gx, gz, fieldSeed, 107, tileScale, 6);
  let detailTone = warpedBand(gx, gz, fieldSeed, 167, detailScale, 5);
  let chromaTone = clamp(
    macroTone * 0.72 + warpedBand(gx, gz, fieldSeed, 83, Math.max(2.25, variation.macroScaleTiles * 0.62), 5) * 0.28,
    -1,
    1
  );

  if (soft) {
    macroTone = steppedField(macroTone, 6);
    chromaTone = steppedField(chromaTone, 5);
    tileTone *= 0.25;
    detailTone = 0;
  }

  const hueVar = chromaTone * variation.macroHue + tileTone * variation.tileHue + detailTone * variation.vertexHue;
  const satVar =
    chromaTone * variation.macroSaturation +
    tileTone * variation.tileSaturation +
    detailTone * variation.vertexSaturation;
  const lightVar =
    macroTone * variation.macroLightness + tileTone * variation.tileLightness + detailTone * variation.vertexLightness;

  const hsl = rgbToHsl(baseR, baseG, baseB);
  const form = formOffset(material, plane);

  let authoredHue = wrap(hsl[0] + hueVar);
  let authoredSat = clamp(hsl[1] * material.saturationMultiplier + satVar, 0, 1);
  let authoredLight = clamp((hsl[2] + lightVar + form) * material.brightnessMultiplier, 0, 1);

  if (soft) {
    authoredHue = steppedUnit(authoredHue, 32);
    authoredSat = steppedUnit(authoredSat, 12);
    authoredLight = steppedUnit(authoredLight, 24);
  }

  const packed = packAuthoredHsl(authoredHue, authoredSat, authoredLight, variation);
  return hslToRgb(packed[0], packed[1], packed[2]);
}

// ---- RS2 Underlay 10-tile sliding window blend math ----

export function rs2BlendComponents(r: number, g: number, b: number): [number, number, number, number] {
  const rr = Math.round(clamp(r, 0, 1) * 255) / 256;
  const gg = Math.round(clamp(g, 0, 1) * 255) / 256;
  const bb = Math.round(clamp(b, 0, 1) * 255) / 256;
  const hsl = rgbToHsl(rr, gg, bb);
  const sat = Math.max(0, Math.min(255, Math.floor(hsl[1] * 256)));
  const light = Math.max(0, Math.min(255, Math.floor(hsl[2] * 256)));
  const l = hsl[2];
  const s = hsl[1];
  let luminance = Math.floor((l > 0.5 ? 1 - l : l) * s * 512);
  if (luminance < 1) luminance = 1;
  const chroma = Math.floor(hsl[0] * luminance);
  return [chroma, sat, light, luminance];
}

export function rs2BlendColor(
  chromaSum: number,
  satSum: number,
  lightSum: number,
  luminanceSum: number,
  magnitude: number
): [number, number, number] {
  const rawHue = Math.floor((chromaSum * 256) / Math.max(1, luminanceSum));
  const hue = ((rawHue % 256) + 256) % 256;
  const sat = Math.max(0, Math.min(255, Math.floor(satSum / Math.max(1, magnitude))));
  const light = Math.max(0, Math.min(255, Math.floor(lightSum / Math.max(1, magnitude))));
  return hslToRgb(hue / 256, sat / 256, light / 256);
}

// ---- TerrainLighting (exact port of TerrainLighting.java) ----

function surfaceDiffuseResponse(nx: number, ny: number, nz: number, settings: TerrainLightingSettings): number {
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-5) return settings.sunY;
  const vertical = clamp(ny / length, 0, 1);
  const sky = settings.sunY * (vertical + (1 - vertical) * SLOPE_SKY_FILL);
  const horizontalKey = (nx * settings.sunX + nz * settings.sunZ) / length;
  return sky + horizontalKey * HORIZONTAL_KEY_WEIGHT;
}

export function vertexBrightness(
  west: number,
  east: number,
  south: number,
  north: number,
  settings: TerrainLightingSettings = DEFAULT_LIGHTING
): number {
  const nx = west - east;
  const ny = 256;
  const nz = south - north;
  const length = Math.hypot(nx, ny, nz);
  const directional = (nx * settings.sunX + ny * settings.sunY + nz * settings.sunZ) / Math.max(1e-5, length);
  return clamp(settings.ambient + settings.diffuse * directional, settings.minBrightness, settings.maxBrightness);
}

export function rockFacetMultiplier(
  h00: number,
  h10: number,
  h01: number,
  h11: number,
  settings: TerrainLightingSettings = DEFAULT_LIGHTING
): number {
  const west = (h00 + h01) * 0.5;
  const east = (h10 + h11) * 0.5;
  const south = (h00 + h10) * 0.5;
  const north = (h01 + h11) * 0.5;
  const nx = west - east;
  const ny = 128;
  const nz = south - north;
  const response = surfaceDiffuseResponse(nx, ny, nz, settings);
  const ref = Math.max(0.001, settings.sunY);
  const exposure = clamp(response / ref, 0, 1);
  if (exposure < settings.rockShadowThreshold) return settings.rockShadowMultiplier;
  if (exposure < settings.rockLitThreshold) return settings.rockMiddleMultiplier;
  return settings.rockLitMultiplier;
}

/** sRGB [0..1] to linear light [0..1] (matches @pixi/3d srgbToLinear). */
export function srgbChannelToLinear(c: number): number {
  const clamped = clamp(c, 0, 1);
  return clamped <= 0.04045 ? clamped / 12.92 : Math.pow((clamped + 0.055) / 1.055, 2.4);
}
