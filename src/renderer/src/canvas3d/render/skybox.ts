/**
 * Stylized Procedural Skybox for the PixiJS 3D (@pixi/3d) VTT Prototype.
 *
 * Inspired by REDEMO_H747's "Procedural Night Sky - Clouds, Moon & Stars"
 * (https://godotshaders.com/shader/procedural-night-sky-clouds-moon-stars/),
 * adapted into a lightweight, stylized, non-photorealistic sky dome across
 * WebGL (GLSL) and WebGPU (WGSL) that dynamically adapts to all lighting presets:
 *  - Daylight, Golden Hour, Twilight, Night, Dungeon, and Custom
 *
 * Features:
 *  - Smooth 3-stop stylized sky gradient + horizon glow + below-horizon nadir blend
 *  - Lightweight dome-projected procedural clouds (3-octave stylized FBM, cel-shaded
 *    lit rim vs shadowed belly reacting to the active sun/moon direction)
 *  - Procedural stylized Sun (Daylight / Golden Hour) or cratered Moon with halo
 *    (Twilight / Night) positioned directly from LightingSettings azimuth & elevation
 *  - Uniform 3D-grid hashed twinkling star field (zero polar pinching, occluded by clouds)
 */

import {
  BaseMaterial3D,
  type BaseMaterial3DOptions,
  type ColorSpace,
  type MaterialData,
  Mesh3D,
  type ShaderBit,
  SphereGeometry,
} from '@pixi/3d';
import type { LightingPresetId, LightingSettings } from './lightingSystem';

export interface SkyboxPalette {
  zenithColor: string;
  midSkyColor: string;
  horizonColor: string;
  nadirColor: string;
  cloudLitColor: string;
  cloudDarkColor: string;
  celestialColor: string;
  haloColor: string;
  starVisibility: number;
  starDensity: number;
  horizonGlowStrength: number;
  cloudCoverage: number;
  cloudDensity: number;
  cloudSpeed: number;
  celestialRadius: number;
  haloStrength: number;
  /** 0 = stylized sun, 1 = stylized cratered moon, -1 = hidden (e.g. dungeon) */
  moonFactor: number;
  cloudScale: number;
  twinkleSpeed: number;
  craterStrength: number;
}

export const SKYBOX_PRESETS: Record<Exclude<LightingPresetId, 'custom'>, SkyboxPalette> = {
  daylight: {
    zenithColor: '#3a78c2',
    midSkyColor: '#7eb4e6',
    horizonColor: '#c8dff2',
    nadirColor: '#7d99b8',
    cloudLitColor: '#fffaf0',
    cloudDarkColor: '#8ea9cc',
    celestialColor: '#fff8dc',
    haloColor: '#ffeeb8',
    starVisibility: 0.0,
    starDensity: 0.0,
    horizonGlowStrength: 0.45,
    cloudCoverage: 0.5,
    cloudDensity: 0.85,
    cloudSpeed: 0.018,
    celestialRadius: 0.052,
    haloStrength: 0.55,
    moonFactor: 0.0,
    cloudScale: 1.55,
    twinkleSpeed: 2.0,
    craterStrength: 0.0,
  },
  golden_hour: {
    zenithColor: '#36436e',
    midSkyColor: '#c46c5e',
    horizonColor: '#f5a65b',
    nadirColor: '#75493b',
    cloudLitColor: '#ffd18a',
    cloudDarkColor: '#5c3f54',
    celestialColor: '#ffdfa0',
    haloColor: '#ff8f3f',
    starVisibility: 0.16,
    starDensity: 0.4,
    horizonGlowStrength: 1.15,
    cloudCoverage: 0.56,
    cloudDensity: 0.88,
    cloudSpeed: 0.022,
    celestialRadius: 0.072,
    haloStrength: 1.1,
    moonFactor: 0.0,
    cloudScale: 1.65,
    twinkleSpeed: 2.2,
    craterStrength: 0.0,
  },
  twilight: {
    zenithColor: '#121b38',
    midSkyColor: '#2c3f6b',
    horizonColor: '#5c6894',
    nadirColor: '#1d2538',
    cloudLitColor: '#9cb2db',
    cloudDarkColor: '#1f2a47',
    celestialColor: '#dce8ff',
    haloColor: '#6c8fd4',
    starVisibility: 0.72,
    starDensity: 0.65,
    horizonGlowStrength: 0.55,
    cloudCoverage: 0.48,
    cloudDensity: 0.72,
    cloudSpeed: 0.016,
    celestialRadius: 0.068,
    haloStrength: 0.68,
    moonFactor: 1.0,
    cloudScale: 1.5,
    twinkleSpeed: 2.6,
    craterStrength: 0.55,
  },
  night: {
    zenithColor: '#060b1a',
    midSkyColor: '#0f1d3a',
    horizonColor: '#1e3154',
    nadirColor: '#0a101d',
    cloudLitColor: '#7a9cd1',
    cloudDarkColor: '#0c1529',
    celestialColor: '#eef4ff',
    haloColor: '#5b84c7',
    starVisibility: 1.0,
    starDensity: 0.82,
    horizonGlowStrength: 0.4,
    cloudCoverage: 0.46,
    cloudDensity: 0.78,
    cloudSpeed: 0.015,
    celestialRadius: 0.076,
    haloStrength: 0.85,
    moonFactor: 1.0,
    cloudScale: 1.45,
    twinkleSpeed: 2.9,
    craterStrength: 0.68,
  },
  dungeon: {
    zenithColor: '#090c12',
    midSkyColor: '#131822',
    horizonColor: '#1f2633',
    nadirColor: '#0b0e14',
    cloudLitColor: '#2a3342',
    cloudDarkColor: '#10141c',
    celestialColor: '#1f2633',
    haloColor: '#222b3a',
    starVisibility: 0.0,
    starDensity: 0.0,
    horizonGlowStrength: 0.12,
    cloudCoverage: 0.36,
    cloudDensity: 0.32,
    cloudSpeed: 0.008,
    celestialRadius: 0.0,
    haloStrength: 0.0,
    moonFactor: -1.0,
    cloudScale: 1.8,
    twinkleSpeed: 1.0,
    craterStrength: 0.0,
  },
};

function parseHexRgb01(hex: string, fallback: [number, number, number]): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
  const n = parseInt(clean, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function rgb01ToHex(r: number, g: number, b: number): string {
  const ir = Math.max(0, Math.min(255, Math.round(r * 255)));
  const ig = Math.max(0, Math.min(255, Math.round(g * 255)));
  const ib = Math.max(0, Math.min(255, Math.round(b * 255)));
  return `#${((ir << 16) | (ig << 8) | ib).toString(16).padStart(6, '0')}`;
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function rgbLuminance(rgb: [number, number, number]): number {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

/**
 * Resolves a stylized SkyboxPalette from any LightingSettings (preset or custom).
 * For built-in presets, returns the hand-tuned preset palette; for `custom`,
 * derives cohesive sky, cloud, star, and celestial parameters from the user's lighting.
 */
export function resolveSkyboxPalette(settings: LightingSettings): SkyboxPalette {
  if (settings.preset !== 'custom' && settings.preset in SKYBOX_PRESETS) {
    return SKYBOX_PRESETS[settings.preset];
  }

  const skyRgb = parseHexRgb01(settings.skyColor, [0.45, 0.65, 0.85]);
  const backdropRgb = parseHexRgb01(settings.backdropColor, [0.35, 0.5, 0.65]);
  const fogRgb = parseHexRgb01(settings.fogColor, backdropRgb);
  const sunRgb = parseHexRgb01(settings.sunColor, [1.0, 0.95, 0.88]);
  const groundRgb = parseHexRgb01(settings.groundColor, [0.15, 0.15, 0.18]);

  const skyLum = rgbLuminance(skyRgb);
  const isNightLike = skyLum < 0.24 || settings.sunIntensity < 0.85;
  const isWarmDusk = !isNightLike && settings.sunElevationDeg < 28;

  const zenithRgb = mixRgb(skyRgb, [0.03, 0.06, 0.14], isNightLike ? 0.62 : 0.38);
  const midRgb = mixRgb(skyRgb, backdropRgb, 0.35);
  const horizonRgb = mixRgb(fogRgb, sunRgb, isWarmDusk ? 0.35 : 0.14);
  const nadirRgb = mixRgb(backdropRgb, groundRgb, 0.55);

  const cloudLitRgb = isNightLike
    ? mixRgb(skyRgb, [0.75, 0.86, 1.0], 0.45)
    : mixRgb(sunRgb, [1.0, 0.98, 0.94], 0.45);
  const cloudDarkRgb = mixRgb(midRgb, zenithRgb, 0.55);

  const starVis = isNightLike
    ? Math.max(0.25, Math.min(1.0, (0.28 - skyLum) * 4.2))
    : isWarmDusk
      ? 0.14
      : 0.0;

  return {
    zenithColor: rgb01ToHex(...zenithRgb),
    midSkyColor: rgb01ToHex(...midRgb),
    horizonColor: rgb01ToHex(...horizonRgb),
    nadirColor: rgb01ToHex(...nadirRgb),
    cloudLitColor: rgb01ToHex(...cloudLitRgb),
    cloudDarkColor: rgb01ToHex(...cloudDarkRgb),
    celestialColor: rgb01ToHex(...mixRgb(sunRgb, [1.0, 0.98, 0.95], 0.35)),
    haloColor: rgb01ToHex(...sunRgb),
    starVisibility: starVis,
    starDensity: isNightLike ? 0.75 : 0.35,
    horizonGlowStrength: isWarmDusk ? 0.95 : isNightLike ? 0.42 : 0.5,
    cloudCoverage: 0.48,
    cloudDensity: isNightLike ? 0.72 : 0.82,
    cloudSpeed: 0.016,
    celestialRadius: isNightLike ? 0.07 : 0.058,
    haloStrength: isWarmDusk ? 0.95 : isNightLike ? 0.72 : 0.55,
    moonFactor: isNightLike ? 1.0 : 0.0,
    cloudScale: 1.55,
    twinkleSpeed: 2.6,
    craterStrength: isNightLike ? 0.6 : 0.0,
  };
}

/**
 * Converts LightingSettings sun azimuth/elevation into a unit sky direction vector
 * matching the directional sun position in LightingManager.
 */
export function computeCelestialDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const azRad = (azimuthDeg * Math.PI) / 180;
  const elRad = (Math.max(4, Math.min(88, elevationDeg)) * Math.PI) / 180;
  const cosEl = Math.cos(elRad);
  return [Math.sin(azRad) * cosEl, Math.sin(elRad), Math.cos(azRad) * cosEl];
}

interface SkyboxMaterialData extends MaterialData {
  baseColor: Float32Array;
  displayBaseColor: Float32Array;
  zenithColor: Float32Array;
  midSkyColor: Float32Array;
  horizonColor: Float32Array;
  nadirColor: Float32Array;
  cloudLitColor: Float32Array;
  cloudDarkColor: Float32Array;
  celestialColor: Float32Array;
  haloColor: Float32Array;
  sunDir: Float32Array;
  skyParams: Float32Array;
}

/**
 * Stylized procedural sky ShaderBit (WebGL GLSL + WebGPU WGSL).
 * Inspired by REDEMO_H747's Procedural Night Sky (clouds, moon, stars) on GodotShaders,
 * with cel/painterly stylized clouds, crisp cratered moon or sun, and uniform 3D-cell stars.
 */
export const stylizedSkyboxBit: ShaderBit = {
  name: 'stylizedProceduralSkybox',
  attributes: {
    aPosition: 'float32x3',
  },
  interStage: {
    vSkyDir: 'vec3<f32>',
  },
  bindings: {
    material: {
      baseColor: 'vec4<f32>',
      displayBaseColor: 'vec4<f32>',
      zenithColor: 'vec4<f32>',
      midSkyColor: 'vec4<f32>',
      horizonColor: 'vec4<f32>',
      nadirColor: 'vec4<f32>',
      cloudLitColor: 'vec4<f32>',
      cloudDarkColor: 'vec4<f32>',
      celestialColor: 'vec4<f32>',
      haloColor: 'vec4<f32>',
      sunDir: 'vec4<f32>',
      skyParams: 'vec4<f32>',
    },
  },
  gl: {
    header: /* glsl */ `
float skyHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float skyHash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 skyHash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float skyValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = skyHash21(i);
  float b = skyHash21(i + vec2(1.0, 0.0));
  float c = skyHash21(i + vec2(0.0, 1.0));
  float d = skyHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Lightweight 3-octave stylized FBM (no heavy raymarching)
float skyCloudFbm(vec2 p) {
  float v = 0.0;
  float amp = 0.54;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    v += amp * skyValueNoise(p);
    p = rot * p * 2.08 + vec2(13.7, 7.3);
    amp *= 0.48;
  }
  return v;
}

// Uniform 3D spherical-cell twinkling star field (early-out hash, no pole pinching)
vec3 skyStars(vec3 dir, float density, float timeVal, float twinkleSpeed) {
  vec3 gridPos = dir * 135.0;
  vec3 cell = floor(gridPos);
  vec3 local = fract(gridPos) - 0.5;

  float rnd = skyHash31(cell);
  float threshold = mix(0.994, 0.962, clamp(density, 0.0, 1.0));
  if (rnd < threshold) {
    return vec3(0.0);
  }

  vec3 jitter = (skyHash33(cell) - 0.5) * 0.62;
  float dist = length(local - jitter);
  float starSize = mix(0.07, 0.17, fract(rnd * 73.1));
  float core = 1.0 - smoothstep(starSize * 0.35, starSize, dist);

  float twinkle = 0.62 + 0.38 * sin(timeVal * twinkleSpeed + rnd * 62.8318);
  float bright = core * twinkle * mix(0.55, 1.15, fract(rnd * 19.7));

  // Subtle warm-gold to cool-blue stylized star tint
  vec3 tint = mix(vec3(0.76, 0.87, 1.0), vec3(1.0, 0.94, 0.82), fract(rnd * 41.3));
  return tint * bright;
}
`,
    vertex: {
      end: /* glsl */ `vSkyDir = aPosition;`,
    },
    fragment: {
      material: /* glsl */ `{
  vec3 dir = normalize(vSkyDir);
  float up = dir.y;

  vec3 zenithCol = material.zenithColor.rgb;
  float starVis = material.zenithColor.a;
  vec3 midCol = material.midSkyColor.rgb;
  float starDensity = material.midSkyColor.a;
  vec3 horizonCol = material.horizonColor.rgb;
  float horizonGlow = material.horizonColor.a;
  vec3 nadirCol = material.nadirColor.rgb;
  float cloudCoverage = material.nadirColor.a;

  vec3 cloudLit = material.cloudLitColor.rgb;
  float cloudDensity = material.cloudLitColor.a;
  vec3 cloudDark = material.cloudDarkColor.rgb;
  float cloudSpeed = material.cloudDarkColor.a;

  vec3 celCol = material.celestialColor.rgb;
  float celRadius = material.celestialColor.a;
  vec3 haloCol = material.haloColor.rgb;
  float haloStrength = material.haloColor.a;

  vec3 sunDir = normalize(material.sunDir.xyz);
  float moonFactor = material.sunDir.w;

  float cloudScale = material.skyParams.y;
  float twinkleSpeed = material.skyParams.z;
  float craterStrength = material.skyParams.w;

  // 1. Stylized 3-stop sky gradient + smooth below-horizon nadir
  float upperT = clamp(up, 0.0, 1.0);
  vec3 skyCol = mix(horizonCol, midCol, smoothstep(0.0, 0.34, upperT));
  skyCol = mix(skyCol, zenithCol, smoothstep(0.22, 0.85, upperT));

  // Soft horizon atmospheric scatter toward sun/moon
  float sunDot = dot(dir, sunDir);
  float horizonBand = exp(-abs(up) * 7.5);
  float scatterDir = pow(max(sunDot * 0.5 + 0.5, 0.0), 3.0);
  skyCol += haloCol * horizonBand * scatterDir * horizonGlow * 0.34;

  // Blend smoothly into nadir below horizon so top-down & low orbits look clean
  float belowT = smoothstep(0.02, -0.26, up);
  skyCol = mix(skyCol, nadirCol, belowT);

  // 2. Stylized Sun or Cratered Moon + Halo
  float celestialMask = 0.0;
  if (moonFactor > -0.5 && celRadius > 0.001) {
    float angDist = acos(clamp(sunDot, -1.0, 1.0));

    // Layered atmospheric halo
    float haloOuter = exp(-angDist * 5.2) * 0.36;
    float haloInner = exp(-angDist * 15.0) * 0.52;
    skyCol += haloCol * (haloOuter + haloInner) * haloStrength * smoothstep(-0.08, 0.08, up);

    // Crisp stylized disc
    float disc = 1.0 - smoothstep(celRadius * 0.90, celRadius * 1.04, angDist);
    celestialMask = disc;

    if (disc > 0.001) {
      vec3 bodyCol = celCol;
      if (moonFactor > 0.5) {
        // Local tangent frame on the moon face for stylized craters & crescent shade
        vec3 refUp = abs(sunDir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 mRight = normalize(cross(refUp, sunDir));
        vec3 mUp = cross(sunDir, mRight);
        vec2 mUv = vec2(dot(dir, mRight), dot(dir, mUp)) / max(celRadius, 0.001);

        float c1 = skyValueNoise(mUv * 2.6 + vec2(4.1, 2.3));
        float c2 = skyValueNoise(mUv * 5.4 + vec2(9.7, 1.8));
        // Stepped/stylized crater patches
        float crater = smoothstep(0.46, 0.72, c1 * 0.68 + c2 * 0.32);
        vec3 moonShade = mix(celCol, celCol * vec3(0.68, 0.74, 0.86), crater * craterStrength);

        // Subtle stylized limb & crescent shading on one side
        float limb = clamp(1.0 - dot(mUv, mUv), 0.0, 1.0);
        float crescent = smoothstep(-0.55, 0.35, mUv.x * 0.85 + mUv.y * 0.35);
        bodyCol = mix(moonShade * 0.76, moonShade * (0.94 + 0.10 * sqrt(limb)), crescent);
      }
      skyCol = mix(skyCol, bodyCol, disc * smoothstep(-0.04, 0.04, up));
    }
  }

  // 3. Procedural Stylized Clouds (dome-projected, cel-banded lit/shadow, horizon-faded)
  float cloudMask = 0.0;
  if (up > 0.005 && cloudDensity > 0.01) {
    vec2 domeUv = (dir.xz / (up + 0.24)) * cloudScale;
    vec2 drift = vec2(uTime * cloudSpeed, uTime * cloudSpeed * 0.42);
    float nBase = skyCloudFbm(domeUv + drift);
    float nDetail = skyCloudFbm(domeUv * 1.9 - drift * 0.65 + vec2(5.2, 3.1));
    float rawCloud = nBase * 0.72 + nDetail * 0.28;

    float cutoff = 1.0 - cloudCoverage;
    // Crisp stylized cloud silhouette
    float shape = smoothstep(cutoff - 0.08, cutoff + 0.14, rawCloud);
    // Stylized 2-tone cel puff shading
    float puffStep = smoothstep(cutoff + 0.05, cutoff + 0.24, rawCloud);
    float horizonFade = smoothstep(0.01, 0.26, up);
    cloudMask = shape * cloudDensity * horizonFade;

    // Directional sun/moon rim lighting on cloud edges
    float rimGlow = pow(max(sunDot * 0.5 + 0.5, 0.0), 4.0) * (1.0 - puffStep * 0.55);
    vec3 shadedCloud = mix(cloudDark, cloudLit, clamp(0.28 + puffStep * 0.58 + rimGlow * 0.42, 0.0, 1.0));
    shadedCloud += haloCol * rimGlow * haloStrength * 0.22;

    skyCol = mix(skyCol, shadedCloud, cloudMask);
  }

  // 4. Twinkling Procedural Star Field (occluded by clouds & moon/sun)
  if (starVis > 0.01 && up > 0.02) {
    vec3 stars = skyStars(dir, starDensity, uTime, twinkleSpeed);
    float starHorizon = smoothstep(0.03, 0.28, up);
    float starOcc = (1.0 - clamp(cloudMask * 1.15, 0.0, 1.0)) * (1.0 - celestialMask);
    skyCol += stars * starVis * starHorizon * starOcc;
  }

  albedo = clamp(skyCol, 0.0, 1.0);
  alpha = 1.0;
}`,
    },
  },
  gpu: {
    header: /* wgsl */ `
fn skyHash21(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(123.34, 456.21));
  p += vec2<f32>(dot(p, p + vec2<f32>(45.32)));
  return fract(p.x * p.y);
}

fn skyHash31(pIn: vec3<f32>) -> f32 {
  var p = fract(pIn * 0.1031);
  p += vec3<f32>(dot(p, p.yzx + vec3<f32>(33.33)));
  return fract((p.x + p.y) * p.z);
}

fn skyHash33(pIn: vec3<f32>) -> vec3<f32> {
  var p = fract(pIn * vec3<f32>(0.1031, 0.1030, 0.0973));
  p += vec3<f32>(dot(p, p.yxz + vec3<f32>(33.33)));
  return fract((p.xxy + p.yxx) * p.zyx);
}

fn skyValueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = skyHash21(i);
  let b = skyHash21(i + vec2<f32>(1.0, 0.0));
  let c = skyHash21(i + vec2<f32>(0.0, 1.0));
  let d = skyHash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn skyCloudFbm(pIn: vec2<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var amp: f32 = 0.54;
  let rot = mat2x2<f32>(0.80, -0.60, 0.60, 0.80);
  for (var i: i32 = 0; i < 3; i = i + 1) {
    v += amp * skyValueNoise(p);
    p = rot * p * 2.08 + vec2<f32>(13.7, 7.3);
    amp *= 0.48;
  }
  return v;
}

fn skyStars(dir: vec3<f32>, density: f32, timeVal: f32, twinkleSpeed: f32) -> vec3<f32> {
  let gridPos = dir * 135.0;
  let cell = floor(gridPos);
  let local = fract(gridPos) - vec3<f32>(0.5);

  let rnd = skyHash31(cell);
  let threshold = mix(0.994, 0.962, clamp(density, 0.0, 1.0));
  if (rnd < threshold) {
    return vec3<f32>(0.0);
  }

  let jitter = (skyHash33(cell) - vec3<f32>(0.5)) * 0.62;
  let dist = length(local - jitter);
  let starSize = mix(0.07, 0.17, fract(rnd * 73.1));
  let core = 1.0 - smoothstep(starSize * 0.35, starSize, dist);

  let twinkle = 0.62 + 0.38 * sin(timeVal * twinkleSpeed + rnd * 62.8318);
  let bright = core * twinkle * mix(0.55, 1.15, fract(rnd * 19.7));

  let tint = mix(vec3<f32>(0.76, 0.87, 1.0), vec3<f32>(1.0, 0.94, 0.82), fract(rnd * 41.3));
  return tint * bright;
}
`,
    vertex: {
      end: /* wgsl */ `output.vSkyDir = input.aPosition;`,
    },
    fragment: {
      material: /* wgsl */ `{
  let dir = normalize(input.vSkyDir);
  let up = dir.y;

  let zenithCol = material.zenithColor.rgb;
  let starVis = material.zenithColor.a;
  let midCol = material.midSkyColor.rgb;
  let starDensity = material.midSkyColor.a;
  let horizonCol = material.horizonColor.rgb;
  let horizonGlow = material.horizonColor.a;
  let nadirCol = material.nadirColor.rgb;
  let cloudCoverage = material.nadirColor.a;

  let cloudLit = material.cloudLitColor.rgb;
  let cloudDensity = material.cloudLitColor.a;
  let cloudDark = material.cloudDarkColor.rgb;
  let cloudSpeed = material.cloudDarkColor.a;

  let celCol = material.celestialColor.rgb;
  let celRadius = material.celestialColor.a;
  let haloCol = material.haloColor.rgb;
  let haloStrength = material.haloColor.a;

  let sunDir = normalize(material.sunDir.xyz);
  let moonFactor = material.sunDir.w;

  let cloudScale = material.skyParams.y;
  let twinkleSpeed = material.skyParams.z;
  let craterStrength = material.skyParams.w;

  let upperT = clamp(up, 0.0, 1.0);
  var skyCol = mix(horizonCol, midCol, smoothstep(0.0, 0.34, upperT));
  skyCol = mix(skyCol, zenithCol, smoothstep(0.22, 0.85, upperT));

  let sunDot = dot(dir, sunDir);
  let horizonBand = exp(-abs(up) * 7.5);
  let scatterDir = pow(max(sunDot * 0.5 + 0.5, 0.0), 3.0);
  skyCol += haloCol * horizonBand * scatterDir * horizonGlow * 0.34;

  let belowT = smoothstep(0.02, -0.26, up);
  skyCol = mix(skyCol, nadirCol, belowT);

  var celestialMask: f32 = 0.0;
  if (moonFactor > -0.5 && celRadius > 0.001) {
    let angDist = acos(clamp(sunDot, -1.0, 1.0));

    let haloOuter = exp(-angDist * 5.2) * 0.36;
    let haloInner = exp(-angDist * 15.0) * 0.52;
    skyCol += haloCol * (haloOuter + haloInner) * haloStrength * smoothstep(-0.08, 0.08, up);

    let disc = 1.0 - smoothstep(celRadius * 0.90, celRadius * 1.04, angDist);
    celestialMask = disc;

    if (disc > 0.001) {
      var bodyCol = celCol;
      if (moonFactor > 0.5) {
        var refUp = vec3<f32>(0.0, 1.0, 0.0);
        if (abs(sunDir.y) > 0.95) {
          refUp = vec3<f32>(1.0, 0.0, 0.0);
        }
        let mRight = normalize(cross(refUp, sunDir));
        let mUp = cross(sunDir, mRight);
        let mUv = vec2<f32>(dot(dir, mRight), dot(dir, mUp)) / max(celRadius, 0.001);

        let c1 = skyValueNoise(mUv * 2.6 + vec2<f32>(4.1, 2.3));
        let c2 = skyValueNoise(mUv * 5.4 + vec2<f32>(9.7, 1.8));
        let crater = smoothstep(0.46, 0.72, c1 * 0.68 + c2 * 0.32);
        let moonShade = mix(celCol, celCol * vec3<f32>(0.68, 0.74, 0.86), crater * craterStrength);

        let limb = clamp(1.0 - dot(mUv, mUv), 0.0, 1.0);
        let crescent = smoothstep(-0.55, 0.35, mUv.x * 0.85 + mUv.y * 0.35);
        bodyCol = mix(moonShade * 0.76, moonShade * (0.94 + 0.10 * sqrt(limb)), crescent);
      }
      skyCol = mix(skyCol, bodyCol, disc * smoothstep(-0.04, 0.04, up));
    }
  }

  var cloudMask: f32 = 0.0;
  if (up > 0.005 && cloudDensity > 0.01) {
    let domeUv = (dir.xz / (up + 0.24)) * cloudScale;
    let drift = vec2<f32>(global.uTime * cloudSpeed, global.uTime * cloudSpeed * 0.42);
    let nBase = skyCloudFbm(domeUv + drift);
    let nDetail = skyCloudFbm(domeUv * 1.9 - drift * 0.65 + vec2<f32>(5.2, 3.1));
    let rawCloud = nBase * 0.72 + nDetail * 0.28;

    let cutoff = 1.0 - cloudCoverage;
    let shape = smoothstep(cutoff - 0.08, cutoff + 0.14, rawCloud);
    let puffStep = smoothstep(cutoff + 0.05, cutoff + 0.24, rawCloud);
    let horizonFade = smoothstep(0.01, 0.26, up);
    cloudMask = shape * cloudDensity * horizonFade;

    let rimGlow = pow(max(sunDot * 0.5 + 0.5, 0.0), 4.0) * (1.0 - puffStep * 0.55);
    var shadedCloud = mix(cloudDark, cloudLit, clamp(0.28 + puffStep * 0.58 + rimGlow * 0.42, 0.0, 1.0));
    shadedCloud += haloCol * rimGlow * haloStrength * 0.22;

    skyCol = mix(skyCol, shadedCloud, cloudMask);
  }

  if (starVis > 0.01 && up > 0.02) {
    let stars = skyStars(dir, starDensity, global.uTime, twinkleSpeed);
    let starHorizon = smoothstep(0.03, 0.28, up);
    let starOcc = (1.0 - clamp(cloudMask * 1.15, 0.0, 1.0)) * (1.0 - celestialMask);
    skyCol += stars * starVis * starHorizon * starOcc;
  }

  albedo = clamp(skyCol, vec3<f32>(0.0), vec3<f32>(1.0));
  alpha = 1.0;
}`,
    },
  },
};

export class StylizedSkyboxMaterial extends BaseMaterial3D<SkyboxMaterialData> {
  public override colorSpace: ColorSpace = 'display';
  public override lit = false;

  constructor(options: BaseMaterial3DOptions = {}) {
    super({
      ...options,
      label: options.label ?? 'StylizedSkyboxMaterial',
      fog: false,
      doubleSided: true,
      descriptor: {
        bitsGpu: [stylizedSkyboxBit],
        bitsGl: [stylizedSkyboxBit],
      },
    });
    // Skybox is rendered behind the world; never write to the depth buffer
    this.state.depthMask = false;
  }

  applyPalette(palette: SkyboxPalette, sunDirection: [number, number, number]): void {
    const zenith = parseHexRgb01(palette.zenithColor, [0.1, 0.2, 0.4]);
    const mid = parseHexRgb01(palette.midSkyColor, [0.3, 0.5, 0.75]);
    const horizon = parseHexRgb01(palette.horizonColor, [0.6, 0.75, 0.9]);
    const nadir = parseHexRgb01(palette.nadirColor, [0.2, 0.25, 0.35]);
    const cloudLit = parseHexRgb01(palette.cloudLitColor, [1.0, 0.98, 0.94]);
    const cloudDark = parseHexRgb01(palette.cloudDarkColor, [0.45, 0.55, 0.7]);
    const cel = parseHexRgb01(palette.celestialColor, [1.0, 0.98, 0.9]);
    const halo = parseHexRgb01(palette.haloColor, [0.8, 0.85, 1.0]);

    const len = Math.hypot(sunDirection[0], sunDirection[1], sunDirection[2]) || 1;
    const sx = sunDirection[0] / len;
    const sy = sunDirection[1] / len;
    const sz = sunDirection[2] / len;

    this.data.zenithColor = new Float32Array([zenith[0], zenith[1], zenith[2], palette.starVisibility]);
    this.data.midSkyColor = new Float32Array([mid[0], mid[1], mid[2], palette.starDensity]);
    this.data.horizonColor = new Float32Array([horizon[0], horizon[1], horizon[2], palette.horizonGlowStrength]);
    this.data.nadirColor = new Float32Array([nadir[0], nadir[1], nadir[2], palette.cloudCoverage]);
    this.data.cloudLitColor = new Float32Array([cloudLit[0], cloudLit[1], cloudLit[2], palette.cloudDensity]);
    this.data.cloudDarkColor = new Float32Array([cloudDark[0], cloudDark[1], cloudDark[2], palette.cloudSpeed]);
    this.data.celestialColor = new Float32Array([cel[0], cel[1], cel[2], palette.celestialRadius]);
    this.data.haloColor = new Float32Array([halo[0], halo[1], halo[2], palette.haloStrength]);
    this.data.sunDir = new Float32Array([sx, sy, sz, palette.moonFactor]);
    this.data.skyParams = new Float32Array([
      1.0,
      palette.cloudScale,
      palette.twinkleSpeed,
      palette.craterStrength,
    ]);
  }
}

/**
 * Self-contained stylized sky dome mesh that follows the active camera
 * and updates its procedural shader parameters whenever lighting settings change.
 */
export class StylizedSkybox {
  readonly mesh: Mesh3D;
  readonly material: StylizedSkyboxMaterial;
  readonly geometry: SphereGeometry;

  constructor(initialRadius = 260) {
    this.geometry = new SphereGeometry({
      radius: 1,
      widthSegments: 32,
      heightSegments: 20,
    });
    this.material = new StylizedSkyboxMaterial();
    this.mesh = new Mesh3D({
      label: 'stylizedSkybox',
      geometry: this.geometry,
      material: this.material,
      castShadow: false,
      receiveShadow: false,
    });
    this.setRadius(initialRadius);
    this.material.applyPalette(SKYBOX_PRESETS.daylight, computeCelestialDirection(320, 48));
  }

  setRadius(radius: number): void {
    const r = Math.max(80, radius);
    this.mesh.scale.set(r, r, r);
  }

  /** Centers the sky dome on the camera so it stays at infinite visual distance. */
  syncToCamera(cameraPosition: { x: number; y: number; z: number }, cameraFar: number): void {
    this.mesh.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    const targetRadius = Math.max(120, cameraFar * 0.8);
    if (Math.abs(this.mesh.scale.x - targetRadius) > 1) {
      this.mesh.scale.set(targetRadius, targetRadius, targetRadius);
    }
  }

  applyLightingSettings(settings: LightingSettings): void {
    const palette = resolveSkyboxPalette(settings);
    const sunDir = computeCelestialDirection(settings.sunAzimuthDeg, settings.sunElevationDeg);
    this.material.applyPalette(palette, sunDir);
  }

  destroy(): void {
    this.mesh.destroy();
    this.geometry.destroy();
    this.material.destroy();
  }
}
