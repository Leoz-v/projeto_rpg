/**
 * PixiJS 3D (@pixi/3d) flat Liquid Surface renderer with a world-space pixelized /
 * stylized retro-VTT shader (OSRS HD x A Short Hike aesthetic):
 *   - World-space quantized pixel grid (~10 px / 5ft tile) — zero camera shimmer and
 *     100% seamless across flush-connected LiquidSurface segments
 *   - Stepped stop-motion animation cadence (8 fps water / 6 fps sludge)
 *   - 4x4 world-space ordered Bayer dithering between 3-4 stepped depth & wave bands
 *   - Dual-layer pixel Voronoi caustics, chunky sewer scum rafts, basalt magma cracks,
 *     popping acid bubbles, and glossy dark blood/oil ripples
 *   - CPU-baked subdivided terrain water depth (+ canal curb edge fallback over cutout
 *     holes) driving hard-stepped animated shoreline contact foam without a depth prepass
 *   - Per-pixel quantized PBR normal perturbation & stepped Fresnel sheen so sun and
 *     dungeon torches/braziers cast crisp pixelated glints across the liquid surface
 */

import type {
  Container3D} from '@pixi/3d';
import {
  FlatMaterial,
  Geometry3D,
  Material3D,
  Mesh3D,
  type ShaderBit,
} from '@pixi/3d';
import type { MapLayerId } from '../map/mapDocument';
import {
  FEET_PER_HEIGHT_UNIT,
  TILE_SIZE_FEET,
  TILE_SIZE_METERS,
} from '../terrain/constants';
import {
  clampLiquidLevelFeet,
  clampLiquidOpacity,
  feetToWorldMeters,
  getLiquidPreset,
  type LiquidEdgeSide,
  type LiquidPresetId,
  type LiquidRect,
  type LiquidSnapLine,
  type LiquidSurface,
} from '../terrain/liquidSurface';
import type { TerrainGrid } from '../terrain/terrainGrid';
import type { TerrainShadingMode } from './terrainRenderer';

/**
 * Encodes visual shader style into `aColor1.r` (`vLiquidMeta.r`):
 *   1 = Clean Water (clear_water, deep_water)
 *   2 = Murky Sewer / Swamp (swamp_water, sewer_sludge)
 *   3 = Magma / Lava (magma)
 *   4 = Toxic Acid (acid)
 *   5 = Viscous Dark / Blood / Oil (blood, oil)
 */
export function resolveLiquidStyleCode(presetId: LiquidPresetId): number {
  switch (presetId) {
    case 'clear_water':
    case 'deep_water':
      return 1;
    case 'swamp_water':
    case 'sewer_sludge':
      return 2;
    case 'magma':
      return 3;
    case 'acid':
      return 4;
    case 'blood':
    case 'oil':
      return 5;
  }
}

function hexToRgb01(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/**
 * Computes effective water depth (in feet) at a sample point `(tileX, tileZ)` on a
 * `LiquidSurface`, using the underlying `TerrainGrid` heightmap when solid, or a
 * crisp narrow-channel curb-edge fallback when the liquid rides over a cutout hole
 * (such as inside modular `blackbeck` recessed stone sewer raceways).
 */
export function sampleLiquidDepthFeet(
  surface: Pick<LiquidSurface, 'x' | 'z' | 'width' | 'length' | 'levelFeet'>,
  tileX: number,
  tileZ: number,
  grid: TerrainGrid | null
): number {
  if (!grid) return 3.2;

  const tx = Math.max(0, Math.min(grid.width - 1, Math.floor(tileX)));
  const tz = Math.max(0, Math.min(grid.length - 1, Math.floor(tileZ)));

  // Over cutout terrain holes (e.g. modular blackbeck raceway troughs), derive shallow
  // depth near the narrow canal's stone side curbs so edge scum/foam hugs the masonry!
  if (grid.isHole(tx, tz)) {
    const distW = Math.max(0, tileX - surface.x);
    const distE = Math.max(0, surface.x + surface.width - tileX);
    const distN = Math.max(0, tileZ - surface.z);
    const distS = Math.max(0, surface.z + surface.length - tileZ);

    let curbDistTiles: number;
    if (surface.width <= 2.2 && surface.length > surface.width) {
      curbDistTiles = Math.min(distW, distE);
    } else if (surface.length <= 2.2 && surface.width > surface.length) {
      curbDistTiles = Math.min(distN, distS);
    } else {
      curbDistTiles = Math.min(distW, distE, distN, distS);
    }
    return Math.max(0.05, Math.min(3.5, curbDistTiles * TILE_SIZE_FEET * 1.15));
  }

  const terrainFeet = grid.sampleHeightAtTileCoord(tileX, tileZ) * FEET_PER_HEIGHT_UNIT;
  return Math.max(-2.0, Math.min(12.0, surface.levelFeet - terrainFeet));
}

/**
 * World-space pixelized / stylized liquid shader (WebGL2 GLSL + WebGPU WGSL).
 * Shared cleanly between `Material3D` (`pbr_shadows`) and `FlatMaterial` (`worldlab_flat` / `rs2_gouraud`).
 */
export const worldlabLiquidBit: ShaderBit = {
  name: 'worldlabLiquidSurface',
  attributes: {
    aColor1: 'float32x4',
  },
  interStage: {
    vLiquidMeta: 'vec4<f32>',
  },
  gl: {
    header: /* glsl */ `
const float LQ_PX_PER_METER = 16.0; // 24 crisp pixels per 5ft (1.5m) tile (~6.25 cm texel)

float lqHash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
vec2 lqHash22(vec2 p) {
  return vec2(lqHash21(p), lqHash21(p + vec2(37.2, 17.9)));
}
float lqSmoothNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(lqHash21(i), lqHash21(i + vec2(1.0, 0.0)), f.x),
    mix(lqHash21(i + vec2(0.0, 1.0)), lqHash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
vec2 lqVoronoiEdge(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.16 + 0.68 * lqHash22(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = lqHash21(n + g);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec2(sqrt(f2) - sqrt(f1), id);
}
float lqBayer4(vec2 cell) {
  vec2 m = mod(floor(cell), 4.0);
  int ix = int(m.x);
  int iy = int(m.y);
  int idx = iy * 4 + ix;
  float v = 0.0;
  if (idx == 0) v = 0.0;
  else if (idx == 1) v = 8.0;
  else if (idx == 2) v = 2.0;
  else if (idx == 3) v = 10.0;
  else if (idx == 4) v = 12.0;
  else if (idx == 5) v = 4.0;
  else if (idx == 6) v = 14.0;
  else if (idx == 7) v = 6.0;
  else if (idx == 8) v = 3.0;
  else if (idx == 9) v = 11.0;
  else if (idx == 10) v = 1.0;
  else if (idx == 11) v = 9.0;
  else if (idx == 12) v = 15.0;
  else if (idx == 13) v = 7.0;
  else if (idx == 14) v = 13.0;
  else v = 5.0;
  return (v + 0.5) / 16.0;
}
vec3 lqLinearToSrgb(vec3 c) {
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
vec3 lqSrgbToLinear(vec3 c) {
  return pow(clamp(c, 0.0, 1.0), vec3(2.2));
}
`,
    vertex: {
      end: /* glsl */ `vLiquidMeta = aColor1;`,
    },
    fragment: {
      material: /* glsl */ `{
  float style = floor(vLiquidMeta.r + 0.5);
  float depthFt = vLiquidMeta.g;
  vec2 pCell = floor(vPosition.xz * LQ_PX_PER_METER);
  vec2 pPos = (pCell + 0.5) / LQ_PX_PER_METER;
  float bayer = lqBayer4(pCell);
  vec3 srgb = lqLinearToSrgb(albedo);

  if (style > 0.5 && style < 1.5) {
    // Style 1: Quiet Pixelized Water (Clear Water / Deep Water) — fine 6cm world texels, gentle slow drift
    float t = uTime;
    vec2 driftA = vec2(t * 0.032, -t * 0.020);
    vec2 driftB = vec2(-t * 0.018, t * 0.026);

    float swell = lqSmoothNoise(pPos * 0.58 + driftA) * 0.65 + lqSmoothNoise(pPos * 1.45 + driftB) * 0.35;
    vec2 vorA = lqVoronoiEdge(pPos * 0.95 + driftA * 1.1);
    vec2 vorB = lqVoronoiEdge(pPos * 1.32 + driftB * 0.9 + vec2(3.7, 1.9));
    float web = (1.0 - smoothstep(0.02, 0.13, vorA.x)) * 0.62 + (1.0 - smoothstep(0.02, 0.11, vorB.x)) * 0.38;

    // Subtle 3-step depth & wave bands with gentle Bayer dither at edges
    float depthT = clamp((depthFt - 0.25) / 2.6, 0.0, 1.0);
    float bandVal = clamp((1.0 - depthT) * 0.48 + swell * 0.52, 0.0, 0.999);
    float band = clamp(floor(bandVal * 3.0 + (bayer - 0.5) * 0.24) / 2.0, 0.0, 1.0);

    vec3 deepCol = srgb * 0.68;
    vec3 midCol = srgb * 1.00;
    vec3 shallowCol = min(vec3(1.0), mix(srgb * 1.18, vec3(0.56, 0.88, 0.96), 0.24));
    vec3 wCol = band < 0.5 ? mix(deepCol, midCol, band * 2.0) : mix(midCol, shallowCol, (band - 0.5) * 2.0);

    // Subtle crisp caustic lattice (calm, not overbearing)
    float causticStep = step(0.58, web + (bayer - 0.5) * 0.08);
    wCol = mix(wCol, min(vec3(1.0), shallowCol + vec3(0.16, 0.20, 0.22)), causticStep * 0.38);

    // Delicate, quiet stepped shoreline contact foam (slow 10s breath)
    float lap = sin(t * 0.65 + pPos.x * 1.2 + pPos.y * 0.95) * 0.10;
    float fBreak = lqSmoothNoise(pPos * 2.4 + driftA * 1.2) * 0.34;
    float shoreDist = depthFt + lap - fBreak;
    float innerFoam = 1.0 - step(0.28, shoreDist);
    float outerSpeck = (1.0 - step(0.62, shoreDist)) * step(0.72, bayer + (0.62 - shoreDist) * 0.45);
    float foam = clamp(innerFoam + outerSpeck, 0.0, 1.0);

    vec3 foamCol = vec3(0.86, 0.95, 0.99);
    srgb = mix(wCol, foamCol, foam * 0.74);
    // True depth-graduated transparency: clear shallows -> richer deep water, crisp foam edge
    float depthAlpha = alpha * mix(0.58, 1.06, depthT);
    alpha = clamp(mix(depthAlpha, max(alpha, 0.86), foam * 0.78), 0.18, 0.96);
  } else if (style > 1.5 && style < 2.5) {
    // Style 2: Quiet Murky Sewer Sludge / Swamp Water — very slow viscous crawl
    float t = uTime;
    vec2 drift = vec2(t * 0.020, -t * 0.014);
    float swirl = lqSmoothNoise(pPos * 0.65 + drift) * 0.6 + lqSmoothNoise(pPos * 1.55 - drift * 1.1) * 0.4;
    vec2 vor = lqVoronoiEdge(pPos * 1.15 + drift * 0.8);

    float depthT = clamp((depthFt - 0.25) / 2.2, 0.0, 1.0);
    float bandVal = clamp((1.0 - depthT) * 0.38 + swirl * 0.58, 0.0, 0.999);
    float band = clamp(floor(bandVal * 3.0 + (bayer - 0.5) * 0.24) / 2.0, 0.0, 1.0);

    vec3 deepCol = srgb * 0.64;
    vec3 midCol = srgb * 1.00;
    vec3 scumCol = min(vec3(1.0), srgb * 1.24 + vec3(0.05, 0.08, -0.02));
    vec3 wCol = band < 0.5 ? mix(deepCol, midCol, band * 2.0) : mix(midCol, scumCol, (band - 0.5) * 2.0);

    // Subtle drifting algae patches & sparse slow gas-bubble rings
    float scumPatch = step(0.72, swirl + (1.0 - depthT) * 0.10) * step(0.35, bayer);
    float bubbleRing = step(0.08, vor.x) * (1.0 - step(0.15, vor.x)) * step(0.90, fract(vor.y * 7.3 + t * 0.10));
    wCol = mix(wCol, scumCol + vec3(0.06, 0.09, 0.01), scumPatch * 0.36 + bubbleRing * 0.38);

    // Thin stepped olive scum line along stone curbs & walls
    float lap = sin(t * 0.50 + pPos.x * 1.1 - pPos.y * 0.9) * 0.08;
    float fBreak = lqSmoothNoise(pPos * 2.4 + drift * 1.2) * 0.30;
    float shoreDist = depthFt + lap - fBreak;
    float innerFroth = 1.0 - step(0.24, shoreDist);
    float speckFroth = (1.0 - step(0.56, shoreDist)) * step(0.70, bayer + (0.56 - shoreDist) * 0.45);
    float froth = clamp(innerFroth + speckFroth, 0.0, 1.0);

    vec3 frothCol = min(vec3(1.0), srgb * 1.40 + vec3(0.12, 0.17, 0.06));
    srgb = mix(wCol, frothCol, froth * 0.68);
    float depthAlpha = alpha * mix(0.68, 1.05, depthT);
    alpha = clamp(mix(depthAlpha, max(alpha, 0.88), froth * 0.72), 0.25, 0.96);
  } else if (style > 2.5 && style < 3.5) {
    // Style 3: Quiet Pixelized Molten Magma / Lava
    float t = uTime;
    vec2 flow = pPos * 0.95 + vec2(t * 0.022, -t * 0.016);
    vec2 vor = lqVoronoiEdge(flow + (lqSmoothNoise(pPos * 0.85) - 0.5) * 0.42);
    float rawCrack = 1.0 - smoothstep(0.03, 0.24, vor.x);
    float crackBand = floor(clamp(rawCrack + (bayer - 0.5) * 0.12, 0.0, 0.999) * 3.0) / 2.0;
    float pulse = 0.90 + 0.10 * sin(t * 1.1 + vor.y * 6.283);

    vec3 crust = srgb * 0.32;
    vec3 ember = vec3(0.95, 0.38, 0.06) * pulse;
    vec3 core = vec3(1.0, 0.78, 0.22) * pulse;
    float hotEdge = (1.0 - step(0.32, depthFt)) * step(0.45, bayer);
    srgb = crackBand < 0.5 ? mix(crust, ember, crackBand * 2.0) : mix(ember, core, (crackBand - 0.5) * 2.0);
    srgb = mix(srgb, ember, hotEdge * 0.50);
  } else if (style > 3.5 && style < 4.5) {
    // Style 4: Quiet Pixelized Bubbling Toxic Acid
    float t = uTime;
    vec2 drift = vec2(t * 0.026, t * 0.020);
    float swirl = lqSmoothNoise(pPos * 0.80 + drift);
    vec2 vor = lqVoronoiEdge(pPos * 1.55 - drift * 1.1);
    float band = floor(clamp(swirl + (bayer - 0.5) * 0.18, 0.0, 0.999) * 3.0) / 2.0;
    float bubble = step(0.05, 0.28 - vor.x) * step(0.65, sin(t * 1.3 + vor.y * 12.56));
    float shoreFoam = 1.0 - step(0.32, depthFt - lqSmoothNoise(pPos * 2.2) * 0.25);

    vec3 baseAcid = mix(srgb * 0.70, min(vec3(1.0), srgb * 1.22), band);
    srgb = min(vec3(1.0), baseAcid + vec3(0.75, 1.0, 0.32) * (0.30 * bubble + 0.36 * shoreFoam));
    float depthAlpha = alpha * mix(0.65, 1.04, clamp(depthFt / 2.0, 0.0, 1.0));
    alpha = clamp(mix(depthAlpha, 0.92, shoreFoam * 0.7), 0.22, 0.96);
  } else {
    // Style 5: Quiet Viscous Blood Pool / Dark Oil
    float t = uTime;
    vec2 drift = vec2(t * 0.018, -t * 0.014);
    float swell = lqSmoothNoise(pPos * 0.85 + drift) * 0.65 + lqSmoothNoise(pPos * 1.85 - drift) * 0.35;
    float band = floor(clamp(swell + (bayer - 0.5) * 0.20, 0.0, 0.999) * 3.0) / 2.0;
    float shoreEdge = 1.0 - step(0.28, depthFt - lqSmoothNoise(pPos * 2.2) * 0.24);

    vec3 wCol = mix(srgb * 0.68, min(vec3(1.0), srgb * 1.24), band);
    vec3 rimCol = min(vec3(1.0), srgb * 1.48 + vec3(0.10, 0.08, 0.12));
    srgb = mix(wCol, rimCol, shoreEdge * 0.50);
    float depthAlpha = alpha * mix(0.72, 1.04, clamp(depthFt / 2.0, 0.0, 1.0));
    alpha = clamp(depthAlpha, 0.28, 0.96);
  }

  albedo = lqSrgbToLinear(clamp(srgb, 0.0, 1.0));
}`,
    },
  },
  gpu: {
    header: /* wgsl */ `
const LQ_PX_PER_METER: f32 = 16.0;

fn lqHash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}
fn lqHash22(p: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(lqHash21(p), lqHash21(p + vec2<f32>(37.2, 17.9)));
}
fn lqSmoothNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(lqHash21(i), lqHash21(i + vec2<f32>(1.0, 0.0)), f.x),
    mix(lqHash21(i + vec2<f32>(0.0, 1.0)), lqHash21(i + vec2<f32>(1.0, 1.0)), f.x),
    f.y
  );
}
fn lqVoronoiEdge(p: vec2<f32>) -> vec2<f32> {
  let n = floor(p);
  let f = fract(p);
  var f1: f32 = 8.0;
  var f2: f32 = 8.0;
  var id: f32 = 0.0;
  for (var j: i32 = -1; j <= 1; j = j + 1) {
    for (var i: i32 = -1; i <= 1; i = i + 1) {
      let g = vec2<f32>(f32(i), f32(j));
      let o = 0.16 + 0.68 * lqHash22(n + g);
      let r = g + o - f;
      let d = dot(r, r);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = lqHash21(n + g);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec2<f32>(sqrt(f2) - sqrt(f1), id);
}
fn lqBayer4(cell: vec2<f32>) -> f32 {
  let m = floor(cell) - 4.0 * floor(floor(cell) / 4.0);
  let idx = i32(m.y) * 4 + i32(m.x);
  var v: f32 = 5.0;
  if (idx == 0) { v = 0.0; }
  else if (idx == 1) { v = 8.0; }
  else if (idx == 2) { v = 2.0; }
  else if (idx == 3) { v = 10.0; }
  else if (idx == 4) { v = 12.0; }
  else if (idx == 5) { v = 4.0; }
  else if (idx == 6) { v = 14.0; }
  else if (idx == 7) { v = 6.0; }
  else if (idx == 8) { v = 3.0; }
  else if (idx == 9) { v = 11.0; }
  else if (idx == 10) { v = 1.0; }
  else if (idx == 11) { v = 9.0; }
  else if (idx == 12) { v = 15.0; }
  else if (idx == 13) { v = 7.0; }
  else if (idx == 14) { v = 13.0; }
  return (v + 0.5) / 16.0;
}
fn lqLinearToSrgb(c: vec3<f32>) -> vec3<f32> {
  return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
}
fn lqSrgbToLinear(c: vec3<f32>) -> vec3<f32> {
  return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
}
`,
    vertex: {
      end: /* wgsl */ `output.vLiquidMeta = aColor1;`,
    },
    fragment: {
      material: /* wgsl */ `{
  let style = floor(input.vLiquidMeta.r + 0.5);
  let depthFt = input.vLiquidMeta.g;
  let pCell = floor(input.vPosition.xz * LQ_PX_PER_METER);
  let pPos = (pCell + vec2<f32>(0.5)) / LQ_PX_PER_METER;
  let bayer = lqBayer4(pCell);
  var srgb = lqLinearToSrgb(albedo);

  if (style > 0.5 && style < 1.5) {
    let t = global.uTime;
    let driftA = vec2<f32>(t * 0.032, -t * 0.020);
    let driftB = vec2<f32>(-t * 0.018, t * 0.026);

    let swell = lqSmoothNoise(pPos * 0.58 + driftA) * 0.65 + lqSmoothNoise(pPos * 1.45 + driftB) * 0.35;
    let vorA = lqVoronoiEdge(pPos * 0.95 + driftA * 1.1);
    let vorB = lqVoronoiEdge(pPos * 1.32 + driftB * 0.9 + vec2<f32>(3.7, 1.9));
    let web = (1.0 - smoothstep(0.02, 0.13, vorA.x)) * 0.62 + (1.0 - smoothstep(0.02, 0.11, vorB.x)) * 0.38;

    let depthT = clamp((depthFt - 0.25) / 2.6, 0.0, 1.0);
    let bandVal = clamp((1.0 - depthT) * 0.48 + swell * 0.52, 0.0, 0.999);
    let band = clamp(floor(bandVal * 3.0 + (bayer - 0.5) * 0.24) / 2.0, 0.0, 1.0);

    let deepCol = srgb * 0.68;
    let midCol = srgb * 1.00;
    let shallowCol = min(vec3<f32>(1.0), mix(srgb * 1.18, vec3<f32>(0.56, 0.88, 0.96), 0.24));
    var wCol = select(mix(midCol, shallowCol, (band - 0.5) * 2.0), mix(deepCol, midCol, band * 2.0), band < 0.5);

    let causticStep = step(0.58, web + (bayer - 0.5) * 0.08);
    wCol = mix(wCol, min(vec3<f32>(1.0), shallowCol + vec3<f32>(0.16, 0.20, 0.22)), causticStep * 0.38);

    let lap = sin(t * 0.65 + pPos.x * 1.2 + pPos.y * 0.95) * 0.10;
    let fBreak = lqSmoothNoise(pPos * 2.4 + driftA * 1.2) * 0.34;
    let shoreDist = depthFt + lap - fBreak;
    let innerFoam = 1.0 - step(0.28, shoreDist);
    let outerSpeck = (1.0 - step(0.62, shoreDist)) * step(0.72, bayer + (0.62 - shoreDist) * 0.45);
    let foam = clamp(innerFoam + outerSpeck, 0.0, 1.0);

    let foamCol = vec3<f32>(0.86, 0.95, 0.99);
    srgb = mix(wCol, foamCol, foam * 0.74);
    let depthAlpha = alpha * mix(0.58, 1.06, depthT);
    alpha = clamp(mix(depthAlpha, max(alpha, 0.86), foam * 0.78), 0.18, 0.96);
  } else if (style > 1.5 && style < 2.5) {
    let t = global.uTime;
    let drift = vec2<f32>(t * 0.020, -t * 0.014);
    let swirl = lqSmoothNoise(pPos * 0.65 + drift) * 0.6 + lqSmoothNoise(pPos * 1.55 - drift * 1.1) * 0.4;
    let vor = lqVoronoiEdge(pPos * 1.15 + drift * 0.8);

    let depthT = clamp((depthFt - 0.25) / 2.2, 0.0, 1.0);
    let bandVal = clamp((1.0 - depthT) * 0.38 + swirl * 0.58, 0.0, 0.999);
    let band = clamp(floor(bandVal * 3.0 + (bayer - 0.5) * 0.24) / 2.0, 0.0, 1.0);

    let deepCol = srgb * 0.64;
    let midCol = srgb * 1.00;
    let scumCol = min(vec3<f32>(1.0), srgb * 1.24 + vec3<f32>(0.05, 0.08, -0.02));
    var wCol = select(mix(midCol, scumCol, (band - 0.5) * 2.0), mix(deepCol, midCol, band * 2.0), band < 0.5);

    let scumPatch = step(0.72, swirl + (1.0 - depthT) * 0.10) * step(0.35, bayer);
    let bubbleRing = step(0.08, vor.x) * (1.0 - step(0.15, vor.x)) * step(0.90, fract(vor.y * 7.3 + t * 0.10));
    wCol = mix(wCol, scumCol + vec3<f32>(0.06, 0.09, 0.01), scumPatch * 0.36 + bubbleRing * 0.38);

    let lap = sin(t * 0.50 + pPos.x * 1.1 - pPos.y * 0.9) * 0.08;
    let fBreak = lqSmoothNoise(pPos * 2.4 + drift * 1.2) * 0.30;
    let shoreDist = depthFt + lap - fBreak;
    let innerFroth = 1.0 - step(0.24, shoreDist);
    let speckFroth = (1.0 - step(0.56, shoreDist)) * step(0.70, bayer + (0.56 - shoreDist) * 0.45);
    let froth = clamp(innerFroth + speckFroth, 0.0, 1.0);

    let frothCol = min(vec3<f32>(1.0), srgb * 1.40 + vec3<f32>(0.12, 0.17, 0.06));
    srgb = mix(wCol, frothCol, froth * 0.68);
    let depthAlpha = alpha * mix(0.68, 1.05, depthT);
    alpha = clamp(mix(depthAlpha, max(alpha, 0.88), froth * 0.72), 0.25, 0.96);
  } else if (style > 2.5 && style < 3.5) {
    let t = global.uTime;
    let flow = pPos * 0.95 + vec2<f32>(t * 0.022, -t * 0.016);
    let vor = lqVoronoiEdge(flow + (lqSmoothNoise(pPos * 0.85) - 0.5) * 0.42);
    let rawCrack = 1.0 - smoothstep(0.03, 0.24, vor.x);
    let crackBand = floor(clamp(rawCrack + (bayer - 0.5) * 0.12, 0.0, 0.999) * 3.0) / 2.0;
    let pulse = 0.90 + 0.10 * sin(t * 1.1 + vor.y * 6.283);

    let crust = srgb * 0.32;
    let ember = vec3<f32>(0.95, 0.38, 0.06) * pulse;
    let core = vec3<f32>(1.0, 0.78, 0.22) * pulse;
    let hotEdge = (1.0 - step(0.32, depthFt)) * step(0.45, bayer);
    srgb = select(mix(ember, core, (crackBand - 0.5) * 2.0), mix(crust, ember, crackBand * 2.0), crackBand < 0.5);
    srgb = mix(srgb, ember, hotEdge * 0.50);
  } else if (style > 3.5 && style < 4.5) {
    let t = global.uTime;
    let drift = vec2<f32>(t * 0.026, t * 0.020);
    let swirl = lqSmoothNoise(pPos * 0.80 + drift);
    let vor = lqVoronoiEdge(pPos * 1.55 - drift * 1.1);
    let band = floor(clamp(swirl + (bayer - 0.5) * 0.18, 0.0, 0.999) * 3.0) / 2.0;
    let bubble = step(0.05, 0.28 - vor.x) * step(0.65, sin(t * 1.3 + vor.y * 12.56));
    let shoreFoam = 1.0 - step(0.32, depthFt - lqSmoothNoise(pPos * 2.2) * 0.25);

    let baseAcid = mix(srgb * 0.70, min(vec3<f32>(1.0), srgb * 1.22), band);
    srgb = min(vec3<f32>(1.0), baseAcid + vec3<f32>(0.75, 1.0, 0.32) * (0.30 * bubble + 0.36 * shoreFoam));
    let depthAlpha = alpha * mix(0.65, 1.04, clamp(depthFt / 2.0, 0.0, 1.0));
    alpha = clamp(mix(depthAlpha, 0.92, shoreFoam * 0.7), 0.22, 0.96);
  } else {
    let t = global.uTime;
    let drift = vec2<f32>(t * 0.018, -t * 0.014);
    let swell = lqSmoothNoise(pPos * 0.85 + drift) * 0.65 + lqSmoothNoise(pPos * 1.85 - drift) * 0.35;
    let band = floor(clamp(swell + (bayer - 0.5) * 0.20, 0.0, 0.999) * 3.0) / 2.0;
    let shoreEdge = 1.0 - step(0.28, depthFt - lqSmoothNoise(pPos * 2.2) * 0.24);

    let wCol = mix(srgb * 0.68, min(vec3<f32>(1.0), srgb * 1.24), band);
    let rimCol = min(vec3<f32>(1.0), srgb * 1.48 + vec3<f32>(0.10, 0.08, 0.12));
    srgb = mix(wCol, rimCol, shoreEdge * 0.50);
    let depthAlpha = alpha * mix(0.72, 1.04, clamp(depthFt / 2.0, 0.0, 1.0));
    alpha = clamp(depthAlpha, 0.28, 0.96);
  }

  albedo = lqSrgbToLinear(clamp(srgb, vec3<f32>(0.0), vec3<f32>(1.0)));
}`,
    },
  },
};

/**
 * Companion PBR shader bit (attached ONLY to `Material3D`, never `FlatMaterial`):
 *   - Perturbs `normal` & `specularNormal` per quantized world-space pixel cell so
 *     sunlight and flickering torches/braziers cast crisp pixelated glints on ripples
 *   - Adds subtle stepped Fresnel rim highlight using `viewDir`
 *   - Drives pixel-snapped self-lit `emissive` glow on Magma & Toxic Acid in dark lighting
 */
export const worldlabLiquidEmissiveBit: ShaderBit = {
  name: 'worldlabLiquidEmissive',
  gl: {
    fragment: {
      material: /* glsl */ `{
  float style = floor(vLiquidMeta.r + 0.5);
  float depthFt = vLiquidMeta.g;
  vec2 pCell = floor(vPosition.xz * LQ_PX_PER_METER);
  vec2 pPos = (pCell + 0.5) / LQ_PX_PER_METER;
  float t = uTime;

  // Calm per-pixel wave normal perturbation -> gentle pixelated torch & sun glints
  float eps = 1.0 / LQ_PX_PER_METER;
  vec2 drift = style < 1.5 ? vec2(t * 0.032, -t * 0.020) : vec2(t * 0.020, -t * 0.014);
  float hC = lqSmoothNoise(pPos * 1.65 + drift);
  float hX = lqSmoothNoise((pPos + vec2(eps, 0.0)) * 1.65 + drift);
  float hZ = lqSmoothNoise((pPos + vec2(0.0, eps)) * 1.65 + drift);
  float tilt = style < 1.5 ? 0.22 : (style > 4.5 ? 0.24 : 0.14);
  vec3 pixN = normalize(vec3((hC - hX) * tilt / eps * 0.14, 1.0, (hC - hZ) * tilt / eps * 0.14));
  normal = pixN;
  specularNormal = pixN;

  // Subtle stepped Fresnel grazing sheen
  float ndotv = clamp(dot(pixN, viewDir), 0.0, 1.0);
  float fresStep = step(0.68, pow(1.0 - ndotv, 2.5));
  if (style < 1.5) {
    emissive += lqSrgbToLinear(vec3(0.45, 0.72, 0.90)) * (fresStep * 0.06);
    roughness = clamp(roughness + (1.0 - step(0.32, depthFt)) * 0.42, 0.05, 0.95);
  } else if (style > 1.5 && style < 2.5) {
    emissive += lqSrgbToLinear(vec3(0.28, 0.40, 0.22)) * (fresStep * 0.04);
    roughness = clamp(roughness + (1.0 - step(0.28, depthFt)) * 0.35, 0.08, 0.95);
  } else if (style > 2.5 && style < 3.5) {
    vec2 flow = pPos * 0.95 + vec2(t * 0.022, -t * 0.016);
    vec2 vor = lqVoronoiEdge(flow + (lqSmoothNoise(pPos * 0.85) - 0.5) * 0.42);
    float rawCrack = 1.0 - smoothstep(0.03, 0.24, vor.x);
    float crack = floor(clamp(rawCrack, 0.0, 0.999) * 3.0) / 2.0;
    float pulse = 0.90 + 0.10 * sin(t * 1.1 + vor.y * 6.283);
    vec3 molten = vec3(1.0, 0.44, 0.06) * pulse;
    vec3 core = vec3(1.0, 0.84, 0.32) * pulse;
    vec3 lavaLight = mix(molten * 0.22, core * 1.65, crack * crack + crack * 0.35);
    emissive += lqSrgbToLinear(clamp(lavaLight, 0.0, 1.0)) * (0.45 + 1.65 * crack);
    roughness = mix(0.85, 0.25, crack);
  } else if (style > 3.5 && style < 4.5) {
    vec2 aDrift = vec2(t * 0.026, t * 0.020);
    vec2 vor = lqVoronoiEdge(pPos * 1.55 - aDrift * 1.1);
    float bubble = step(0.05, 0.28 - vor.x) * step(0.65, sin(t * 1.3 + vor.y * 12.56));
    float shoreFoam = 1.0 - step(0.32, depthFt - lqSmoothNoise(pPos * 2.2) * 0.25);
    emissive += lqSrgbToLinear(vec3(0.45, 0.98, 0.18)) * (0.28 + 0.72 * bubble + 0.38 * shoreFoam);
  }
}`,
    },
  },
  gpu: {
    fragment: {
      material: /* wgsl */ `{
  let style = floor(input.vLiquidMeta.r + 0.5);
  let depthFt = input.vLiquidMeta.g;
  let pCell = floor(input.vPosition.xz * LQ_PX_PER_METER);
  let pPos = (pCell + vec2<f32>(0.5)) / LQ_PX_PER_METER;
  let t = global.uTime;

  let eps = 1.0 / LQ_PX_PER_METER;
  let drift = select(vec2<f32>(t * 0.020, -t * 0.014), vec2<f32>(t * 0.032, -t * 0.020), style < 1.5);
  let hC = lqSmoothNoise(pPos * 1.65 + drift);
  let hX = lqSmoothNoise((pPos + vec2<f32>(eps, 0.0)) * 1.65 + drift);
  let hZ = lqSmoothNoise((pPos + vec2<f32>(0.0, eps)) * 1.65 + drift);
  let tilt = select(select(0.14, 0.24, style > 4.5), 0.22, style < 1.5);
  let pixN = normalize(vec3<f32>((hC - hX) * tilt / eps * 0.14, 1.0, (hC - hZ) * tilt / eps * 0.14));
  normal = pixN;
  specularNormal = pixN;

  let ndotv = clamp(dot(pixN, viewDir), 0.0, 1.0);
  let fresStep = step(0.68, pow(1.0 - ndotv, 2.5));
  if (style < 1.5) {
    emissive += lqSrgbToLinear(vec3<f32>(0.45, 0.72, 0.90)) * (fresStep * 0.06);
    roughness = clamp(roughness + (1.0 - step(0.32, depthFt)) * 0.42, 0.05, 0.95);
  } else if (style > 1.5 && style < 2.5) {
    emissive += lqSrgbToLinear(vec3<f32>(0.28, 0.40, 0.22)) * (fresStep * 0.04);
    roughness = clamp(roughness + (1.0 - step(0.28, depthFt)) * 0.35, 0.08, 0.95);
  } else if (style > 2.5 && style < 3.5) {
    let flow = pPos * 0.95 + vec2<f32>(t * 0.022, -t * 0.016);
    let vor = lqVoronoiEdge(flow + (lqSmoothNoise(pPos * 0.85) - 0.5) * 0.42);
    let rawCrack = 1.0 - smoothstep(0.03, 0.24, vor.x);
    let crack = floor(clamp(rawCrack, 0.0, 0.999) * 3.0) / 2.0;
    let pulse = 0.90 + 0.10 * sin(t * 1.1 + vor.y * 6.283);
    let molten = vec3<f32>(1.0, 0.44, 0.06) * pulse;
    let core = vec3<f32>(1.0, 0.84, 0.32) * pulse;
    let lavaLight = mix(molten * 0.22, core * 1.65, crack * crack + crack * 0.35);
    emissive += lqSrgbToLinear(clamp(lavaLight, vec3<f32>(0.0), vec3<f32>(1.0))) * (0.45 + 1.65 * crack);
    roughness = mix(0.85, 0.25, crack);
  } else if (style > 3.5 && style < 4.5) {
    let aDrift = vec2<f32>(t * 0.026, t * 0.020);
    let vor = lqVoronoiEdge(pPos * 1.55 - aDrift * 1.1);
    let bubble = step(0.05, 0.28 - vor.x) * step(0.65, sin(t * 1.3 + vor.y * 12.56));
    let shoreFoam = 1.0 - step(0.32, depthFt - lqSmoothNoise(pPos * 2.2) * 0.25);
    emissive += lqSrgbToLinear(vec3<f32>(0.45, 0.98, 0.18)) * (0.28 + 0.72 * bubble + 0.38 * shoreFoam);
  }
}`,
    },
  },
};

export interface LiquidOverlayState {
  selected: LiquidSurface | null;
  connectedNeighbors: readonly LiquidSurface[];
  hoveredEdge: LiquidEdgeSide | null;
  previewRect: (LiquidRect & { levelFeet: number; colorHex: number }) | null;
  snapLines: readonly LiquidSnapLine[];
  layerOffsetY: number;
}

interface LiquidMeshRecord {
  surface: LiquidSurface;
  mesh: Mesh3D;
  pbrMaterial: Material3D;
  flatMaterial: FlatMaterial;
}

export class LiquidRenderer {
  private readonly surfaceRoot: Container3D;
  private readonly interiorRoot: Container3D;
  private readonly overlayRoot: Container3D;

  private surfaceGrid: TerrainGrid | null = null;
  private interiorGrid: TerrainGrid | null = null;

  private readonly records = new Map<string, LiquidMeshRecord>();
  private readonly lineMaterial: FlatMaterial;
  private readonly previewFillMaterial: FlatMaterial;

  private overlayLinesMesh: Mesh3D | null = null;
  private previewQuadMesh: Mesh3D | null = null;

  private shadingMode: TerrainShadingMode = 'pbr_shadows';
  private unlitMoodTint = 0xffffff;
  private surfaceGhost = false;
  private nextIdCounter = 1;

  constructor(
    surfaceLiquidRoot: Container3D,
    interiorLiquidRoot: Container3D,
    overlayRoot: Container3D,
    surfaceGrid?: TerrainGrid,
    interiorGrid?: TerrainGrid
  ) {
    this.surfaceRoot = surfaceLiquidRoot;
    this.interiorRoot = interiorLiquidRoot;
    this.overlayRoot = overlayRoot;
    this.surfaceGrid = surfaceGrid ?? null;
    this.interiorGrid = interiorGrid ?? surfaceGrid ?? null;

    this.lineMaterial = new FlatMaterial({
      baseColor: 0xffffff,
      vertexColors: true,
    });
    this.previewFillMaterial = new FlatMaterial({
      baseColor: 0x35b8e8,
      alphaMode: 'blend',
      alpha: 0.34,
      doubleSided: true,
    });
  }

  /** Attaches Surface & Interior TerrainGrids so liquid meshes bake exact shoreline water depth. */
  setTerrainGrids(surfaceGrid: TerrainGrid, interiorGrid?: TerrainGrid): void {
    this.surfaceGrid = surfaceGrid;
    this.interiorGrid = interiorGrid ?? surfaceGrid;
    this.refreshDepths();
  }

  /** Re-bakes vertex water depths on existing liquid surfaces after terrain sculpting or hole edits. */
  refreshDepths(layer?: MapLayerId): void {
    for (const rec of this.records.values()) {
      if (layer && rec.surface.layer !== layer) continue;
      const oldGeo = rec.mesh.geometry;
      rec.mesh.geometry = this.buildLiquidQuadGeometry(rec.surface);
      oldGeo.destroy(true);
    }
  }

  private gridForLayer(layer: MapLayerId): TerrainGrid | null {
    return layer === 'interior' ? this.interiorGrid : this.surfaceGrid;
  }

  allocateId(): string {
    let candidate = `liquid_${this.nextIdCounter++}`;
    while (this.records.has(candidate)) {
      candidate = `liquid_${this.nextIdCounter++}`;
    }
    return candidate;
  }

  getAll(): LiquidSurface[] {
    return Array.from(this.records.values(), (r) => r.surface);
  }

  getForLayer(layer: MapLayerId): LiquidSurface[] {
    const out: LiquidSurface[] = [];
    for (const r of this.records.values()) {
      if (r.surface.layer === layer) out.push(r.surface);
    }
    return out;
  }

  getById(id: string): LiquidSurface | null {
    return this.records.get(id)?.surface ?? null;
  }

  get count(): number {
    return this.records.size;
  }

  addSurface(surface: LiquidSurface): LiquidSurface {
    const normalized: LiquidSurface = {
      ...surface,
      id: surface.id || this.allocateId(),
      levelFeet: clampLiquidLevelFeet(surface.levelFeet),
      ...(surface.opacity !== undefined ? { opacity: clampLiquidOpacity(surface.opacity) } : {}),
    };
    if (this.records.has(normalized.id)) {
      this.removeSurface(normalized.id);
    }

    const preset = getLiquidPreset(normalized.preset);
    const opacity = normalized.opacity ?? preset.opacity;
    const pbrMaterial = new Material3D({
      baseColor: 0xffffff,
      vertexColors: true,
      roughness: preset.roughness,
      metallic: 0.04,
      alphaMode: 'blend',
      alpha: opacity,
      doubleSided: true,
      extraBits: [worldlabLiquidBit, worldlabLiquidEmissiveBit],
    });
    const flatMaterial = new FlatMaterial({
      baseColor: this.unlitMoodTint,
      vertexColors: true,
      alphaMode: 'blend',
      alpha: opacity,
      doubleSided: true,
      extraBits: [worldlabLiquidBit],
    });

    const geometry = this.buildLiquidQuadGeometry(normalized);
    const mesh = new Mesh3D({
      geometry,
      material: this.shadingMode === 'pbr_shadows' ? pbrMaterial : flatMaterial,
      castShadow: false,
      receiveShadow: this.shadingMode === 'pbr_shadows',
      label: `liquid_${normalized.id}`,
    });

    const parent = normalized.layer === 'interior' ? this.interiorRoot : this.surfaceRoot;
    parent.addChild(mesh);

    const rec: LiquidMeshRecord = {
      surface: normalized,
      mesh,
      pbrMaterial,
      flatMaterial,
    };
    this.records.set(normalized.id, rec);
    this.applyRecordAlpha(rec);
    return normalized;
  }

  updateSurface(id: string, patch: Partial<Omit<LiquidSurface, 'id'>>): LiquidSurface | null {
    const rec = this.records.get(id);
    if (!rec) return null;

    const prevLayer = rec.surface.layer;
    const next: LiquidSurface = {
      ...rec.surface,
      ...patch,
      id: rec.surface.id,
      levelFeet: clampLiquidLevelFeet(patch.levelFeet ?? rec.surface.levelFeet),
    };
    if (patch.opacity !== undefined) {
      next.opacity = clampLiquidOpacity(patch.opacity);
    }
    rec.surface = next;

    const preset = getLiquidPreset(next.preset);
    rec.pbrMaterial.roughness = preset.roughness;
    this.applyRecordAlpha(rec);

    if (next.layer !== prevLayer) {
      const oldParent = prevLayer === 'interior' ? this.interiorRoot : this.surfaceRoot;
      const newParent = next.layer === 'interior' ? this.interiorRoot : this.surfaceRoot;
      oldParent.removeChild(rec.mesh);
      newParent.addChild(rec.mesh);
    }

    const oldGeo = rec.mesh.geometry;
    rec.mesh.geometry = this.buildLiquidQuadGeometry(next);
    oldGeo.destroy(true);

    return next;
  }

  removeSurface(id: string): boolean {
    const rec = this.records.get(id);
    if (!rec) return false;
    const parent = rec.surface.layer === 'interior' ? this.interiorRoot : this.surfaceRoot;
    parent.removeChild(rec.mesh);
    rec.mesh.geometry.destroy(true);
    rec.mesh.destroy();
    this.records.delete(id);
    return true;
  }

  clear(): void {
    for (const id of Array.from(this.records.keys())) {
      this.removeSurface(id);
    }
    this.setOverlayState(null);
  }

  loadSurfaces(surfaces: readonly LiquidSurface[]): void {
    this.clear();
    for (const s of surfaces) {
      this.addSurface(s);
    }
  }

  serializeSurfaces(): LiquidSurface[] {
    return this.getAll().map((s) => ({
      id: s.id,
      layer: s.layer,
      preset: s.preset,
      x: s.x,
      z: s.z,
      width: s.width,
      length: s.length,
      levelFeet: s.levelFeet,
      ...(s.opacity !== undefined ? { opacity: s.opacity } : {}),
      ...(s.colorHex !== undefined ? { colorHex: s.colorHex } : {}),
    }));
  }

  setShadingMode(mode: TerrainShadingMode): void {
    if (this.shadingMode === mode) return;
    this.shadingMode = mode;
    for (const rec of this.records.values()) {
      rec.mesh.material = mode === 'pbr_shadows' ? rec.pbrMaterial : rec.flatMaterial;
      rec.mesh.receiveShadow = mode === 'pbr_shadows';
    }
  }

  setUnlitMoodTint(tintHex: number): void {
    this.unlitMoodTint = tintHex;
    for (const rec of this.records.values()) {
      rec.flatMaterial.baseColor = tintHex;
    }
  }

  setSurfaceGhost(ghosted: boolean): void {
    if (this.surfaceGhost === ghosted) return;
    this.surfaceGhost = ghosted;
    for (const rec of this.records.values()) {
      if (rec.surface.layer === 'surface') {
        this.applyRecordAlpha(rec);
      }
    }
  }

  private applyRecordAlpha(rec: LiquidMeshRecord): void {
    const preset = getLiquidPreset(rec.surface.preset);
    const baseAlpha = rec.surface.opacity ?? preset.opacity;
    const effectiveAlpha =
      rec.surface.layer === 'surface' && this.surfaceGhost
        ? Math.min(baseAlpha, 0.16)
        : baseAlpha;
    rec.pbrMaterial.alpha = effectiveAlpha;
    rec.flatMaterial.alpha = effectiveAlpha;
  }

  /**
   * Builds a subdivided flat horizontal mesh (`~0.5`-tile spacing, capped cleanly at 48x48)
   * with exact CPU-baked shoreline water depth in `aColor1.g` (`vLiquidMeta.g`) so every
   * bank, island, column pier, and stone canal curb receives crisp stepped shoreline foam.
   */
  private buildLiquidQuadGeometry(surface: LiquidSurface): Geometry3D {
    const y = feetToWorldMeters(surface.levelFeet);
    const preset = getLiquidPreset(surface.preset);
    const [r, g, b] = hexToRgb01(surface.colorHex ?? preset.hex);
    const styleCode = resolveLiquidStyleCode(surface.preset);
    const grid = this.gridForLayer(surface.layer);

    // Subdivide at 0.5-tile resolution (min 2 segments for narrow canals so curb->center->curb depth interpolates cleanly!)
    const segX = Math.max(2, Math.min(48, Math.ceil(surface.width * 2)));
    const segZ = Math.max(2, Math.min(48, Math.ceil(surface.length * 2)));
    const cols = segX + 1;
    const rows = segZ + 1;
    const vertCount = cols * rows;

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const colors = new Float32Array(vertCount * 4);
    const colors1 = new Float32Array(vertCount * 4);

    let p = 0;
    let u = 0;
    let c = 0;
    for (let iz = 0; iz <= segZ; iz++) {
      const fz = iz / segZ;
      const tileZ = surface.z + fz * surface.length;
      const wz = tileZ * TILE_SIZE_METERS;
      for (let ix = 0; ix <= segX; ix++) {
        const fx = ix / segX;
        const tileX = surface.x + fx * surface.width;
        const wx = tileX * TILE_SIZE_METERS;

        const depthFt = sampleLiquidDepthFeet(surface, tileX, tileZ, grid);

        positions[p] = wx;
        positions[p + 1] = y;
        positions[p + 2] = wz;
        normals[p] = 0;
        normals[p + 1] = 1;
        normals[p + 2] = 0;
        p += 3;

        uvs[u] = fx * surface.width;
        uvs[u + 1] = fz * surface.length;
        u += 2;

        colors[c] = r;
        colors[c + 1] = g;
        colors[c + 2] = b;
        colors[c + 3] = 1;

        colors1[c] = styleCode;
        colors1[c + 1] = depthFt;
        colors1[c + 2] = 0;
        colors1[c + 3] = 1;
        c += 4;
      }
    }

    const triCount = segX * segZ * 2;
    const indices = vertCount > 65535 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);
    let idx = 0;
    for (let iz = 0; iz < segZ; iz++) {
      for (let ix = 0; ix < segX; ix++) {
        const i00 = iz * cols + ix;
        const i10 = i00 + 1;
        const i01 = (iz + 1) * cols + ix;
        const i11 = i01 + 1;
        indices[idx++] = i00;
        indices[idx++] = i01;
        indices[idx++] = i11;
        indices[idx++] = i00;
        indices[idx++] = i11;
        indices[idx++] = i10;
      }
    }

    return new Geometry3D({
      positions,
      normals,
      uvs,
      colors,
      colors1,
      indices,
    });
  }

  /**
   * Updates the 3D overlay for the Liquid tool: selected outline + 4 edge handles,
   * connected neighbor outlines, draw preview quad, and snap-seam highlights.
   */
  setOverlayState(state: LiquidOverlayState | null): void {
    if (!state) {
      if (this.overlayLinesMesh) this.overlayLinesMesh.visible = false;
      if (this.previewQuadMesh) this.previewQuadMesh.visible = false;
      return;
    }

    const lift = 0.04;
    const positions: number[] = [];
    const colors: number[] = [];

    const pushSeg = (
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      r: number,
      g: number,
      b: number
    ): void => {
      positions.push(ax, ay, az, bx, by, bz);
      colors.push(r, g, b, 1, r, g, b, 1);
    };

    const pushRectOutline = (
      x: number,
      z: number,
      w: number,
      l: number,
      y: number,
      r: number,
      g: number,
      b: number
    ): void => {
      const x0 = x * TILE_SIZE_METERS;
      const z0 = z * TILE_SIZE_METERS;
      const x1 = (x + w) * TILE_SIZE_METERS;
      const z1 = (z + l) * TILE_SIZE_METERS;
      pushSeg(x0, y, z0, x1, y, z0, r, g, b);
      pushSeg(x1, y, z0, x1, y, z1, r, g, b);
      pushSeg(x1, y, z1, x0, y, z1, r, g, b);
      pushSeg(x0, y, z1, x0, y, z0, r, g, b);
    };

    const pushDiamond = (
      cx: number,
      cy: number,
      cz: number,
      radiusMeters: number,
      r: number,
      g: number,
      b: number
    ): void => {
      pushSeg(cx - radiusMeters, cy, cz, cx, cy, cz - radiusMeters, r, g, b);
      pushSeg(cx, cy, cz - radiusMeters, cx + radiusMeters, cy, cz, r, g, b);
      pushSeg(cx + radiusMeters, cy, cz, cx, cy, cz + radiusMeters, r, g, b);
      pushSeg(cx, cy, cz + radiusMeters, cx - radiusMeters, cy, cz, r, g, b);
      pushSeg(cx - radiusMeters * 0.5, cy, cz, cx + radiusMeters * 0.5, cy, cz, r, g, b);
      pushSeg(cx, cy, cz - radiusMeters * 0.5, cx, cy, cz + radiusMeters * 0.5, r, g, b);
    };

    for (const neighbor of state.connectedNeighbors) {
      const ny = feetToWorldMeters(neighbor.levelFeet) + state.layerOffsetY + lift;
      pushRectOutline(neighbor.x, neighbor.z, neighbor.width, neighbor.length, ny, 0.25, 0.88, 0.72);
    }

    if (state.selected) {
      const s = state.selected;
      const sy = feetToWorldMeters(s.levelFeet) + state.layerOffsetY + lift + 0.01;
      pushRectOutline(s.x, s.z, s.width, s.length, sy, 0.35, 0.88, 1.0);

      const handles: readonly { side: LiquidEdgeSide; hx: number; hz: number }[] = [
        { side: 'N', hx: (s.x + s.width * 0.5) * TILE_SIZE_METERS, hz: s.z * TILE_SIZE_METERS },
        { side: 'S', hx: (s.x + s.width * 0.5) * TILE_SIZE_METERS, hz: (s.z + s.length) * TILE_SIZE_METERS },
        { side: 'W', hx: s.x * TILE_SIZE_METERS, hz: (s.z + s.length * 0.5) * TILE_SIZE_METERS },
        { side: 'E', hx: (s.x + s.width) * TILE_SIZE_METERS, hz: (s.z + s.length * 0.5) * TILE_SIZE_METERS },
      ];
      for (const h of handles) {
        const hot = state.hoveredEdge === h.side;
        pushDiamond(
          h.hx,
          sy + 0.02,
          h.hz,
          hot ? 0.36 : 0.26,
          hot ? 1.0 : 0.96,
          hot ? 0.88 : 0.74,
          hot ? 0.25 : 0.22
        );
      }
    }

    if (state.previewRect) {
      const p = state.previewRect;
      const py = feetToWorldMeters(p.levelFeet) + state.layerOffsetY + lift + 0.015;
      pushRectOutline(p.x, p.z, p.width, p.length, py, 0.98, 0.85, 0.32);

      const x0 = p.x * TILE_SIZE_METERS;
      const z0 = p.z * TILE_SIZE_METERS;
      const x1 = (p.x + p.width) * TILE_SIZE_METERS;
      const z1 = (p.z + p.length) * TILE_SIZE_METERS;
      const quadGeo = new Geometry3D({
        positions: new Float32Array([x0, py - 0.01, z0, x0, py - 0.01, z1, x1, py - 0.01, z1, x1, py - 0.01, z0]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      });
      this.previewFillMaterial.baseColor = p.colorHex;
      if (!this.previewQuadMesh) {
        this.previewQuadMesh = new Mesh3D({
          geometry: quadGeo,
          material: this.previewFillMaterial,
          castShadow: false,
          receiveShadow: false,
          label: 'liquid_preview_quad',
        });
        this.overlayRoot.addChild(this.previewQuadMesh);
      } else {
        const old = this.previewQuadMesh.geometry;
        this.previewQuadMesh.geometry = quadGeo;
        old.destroy(true);
        this.previewQuadMesh.visible = true;
      }
    } else if (this.previewQuadMesh) {
      this.previewQuadMesh.visible = false;
    }

    for (const snap of state.snapLines) {
      const sy = feetToWorldMeters(snap.levelFeet) + state.layerOffsetY + lift + 0.03;
      pushSeg(
        snap.x0 * TILE_SIZE_METERS,
        sy,
        snap.z0 * TILE_SIZE_METERS,
        snap.x1 * TILE_SIZE_METERS,
        sy,
        snap.z1 * TILE_SIZE_METERS,
        0.35,
        1.0,
        0.55
      );
    }

    if (positions.length === 0) {
      if (this.overlayLinesMesh) this.overlayLinesMesh.visible = false;
      return;
    }

    const lineGeo = new Geometry3D({
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      topology: 'line-list',
    });
    if (!this.overlayLinesMesh) {
      this.overlayLinesMesh = new Mesh3D({
        geometry: lineGeo,
        material: this.lineMaterial,
        castShadow: false,
        receiveShadow: false,
        label: 'liquid_overlay_lines',
      });
      this.overlayRoot.addChild(this.overlayLinesMesh);
    } else {
      const old = this.overlayLinesMesh.geometry;
      this.overlayLinesMesh.geometry = lineGeo;
      old.destroy(true);
      this.overlayLinesMesh.visible = true;
    }
  }
}
