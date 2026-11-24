/**
 * Custom @pixi/3d ShaderBit recreating WorldLab + Lost City RS2 terrain surface treatment
 * across both WebGL (GLSL) and WebGPU (WGSL):
 *   - Reads `aColor1` (via Geometry3D `colors1`) for per-face surface metadata:
 *       r = surfacePatternId:
 *             0 = plain organic earth / grass / sand / rock grain
 *             1 = animated RS2 rippling water & caustics
 *             2 = wooden floor planks (staggered seams & grain)
 *             3 = rounded Voronoi cobblestone / pebble / scree
 *             4 = running-bond dungeon flagstones / brick paving
 *             5 = veined temple marble tiles
 *             6 = animated glowing magma / lava crust & veins
 *       g = grainStrength (subtle tactile variation)
 *       b = grainScale (world-space frequency)
 *       a = quantizeFlag (1 = snap land to RS2 6/3/7-bit HSL16 palette with Lost-City highlight saturation roll-off)
 */

import type { ShaderBit } from '@pixi/3d';

export const worldlabTerrainBit: ShaderBit = {
  name: 'worldlabTerrainSurface',
  attributes: {
    aColor1: 'float32x4',
  },
  interStage: {
    vSurfaceMeta: 'vec4<f32>',
  },
  gl: {
    header: /* glsl */ `
float wlHash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
vec2 wlHash22(vec2 p) {
  return vec2(
    wlHash21(p),
    wlHash21(p + vec2(37.2, 17.9))
  );
}
float wlSmoothNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(wlHash21(i), wlHash21(i + vec2(1.0, 0.0)), f.x),
    mix(wlHash21(i + vec2(0.0, 1.0)), wlHash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
vec2 wlVoronoiEdge(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.15 + 0.70 * wlHash22(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wlHash21(n + g);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec2(sqrt(f2) - sqrt(f1), id);
}
vec3 wlLinearToSrgb(vec3 c) {
  vec3 cl = clamp(c, 0.0, 1.0);
  return pow(cl, vec3(1.0 / 2.2));
}
vec3 wlSrgbToLinear(vec3 c) {
  vec3 cl = clamp(c, 0.0, 1.0);
  return pow(cl, vec3(2.2));
}
vec3 wlRgbToHsl(vec3 c) {
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float d = hi - lo;
  float l = (hi + lo) * 0.5;
  float h = 0.0;
  float s = 0.0;
  if (d > 0.00001) {
    s = d / max(0.00001, 1.0 - abs(2.0 * l - 1.0));
    if (hi == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (hi == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h = fract(h / 6.0);
  }
  return vec3(h, s, l);
}
vec3 wlHslToRgb(vec3 hsl) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + hsl.x * 12.0, 12.0);
  float a = hsl.y * min(hsl.z, 1.0 - hsl.z);
  return clamp(hsl.z - a * max(vec3(-1.0), min(min(k - 3.0, 9.0 - k), vec3(1.0))), 0.0, 1.0);
}
vec3 wlQuantizeHsl16(vec3 srgb) {
  vec3 hsl = wlRgbToHsl(clamp(srgb, 0.0, 1.0));
  // Lost City FloType.getTable highlight saturation roll-off (179 / 192 / 217 / 243 out of 256)
  float l256 = hsl.z * 256.0;
  float rolledSat = hsl.y;
  if (l256 > 179.0) rolledSat *= 0.5;
  if (l256 > 192.0) rolledSat *= 0.5;
  if (l256 > 217.0) rolledSat *= 0.5;
  if (l256 > 243.0) rolledSat *= 0.5;
  float h = (min(63.0, floor(hsl.x * 64.0)) + 0.5) / 64.0;
  float s = (min(7.0, floor(rolledSat * 8.0)) + 0.5) / 8.0;
  float l = min(126.0, max(2.0, floor(hsl.z * 128.0))) / 128.0;
  return wlHslToRgb(vec3(h, s, l));
}
`,
    vertex: {
      end: /* glsl */ `vSurfaceMeta = aColor1;`,
    },
    fragment: {
      material: /* glsl */ `{
  vec2 wp = vPosition.xz;
  vec2 tileUv = wp / 1.5;
  float pat = floor(vSurfaceMeta.r + 0.5);
  float grainStrength = vSurfaceMeta.g;
  float grainFreq = max(0.5, vSurfaceMeta.b * 8.0);
  float doQuantize = step(0.5, vSurfaceMeta.a);

  vec3 srgb = wlLinearToSrgb(albedo);
  bool skipQuantize = false;

  if (pat > 0.5 && pat < 1.5) {
    // Pattern 1: Animated RS2 rippling water & caustics
    skipQuantize = true;
    vec2 driftA = vec2(uTime * 0.14, -uTime * 0.09);
    vec2 driftB = vec2(-uTime * 0.08, uTime * 0.13);
    float swell = smoothstep(0.18, 0.82, wlSmoothNoise(wp * 0.30 + driftA));
    vec3 wCol = mix(srgb * 0.86, min(vec3(1.0), srgb * 1.11), swell);
    float caustic = smoothstep(0.72, 0.95, wlSmoothNoise(wp * 1.25 + driftA * 1.7 - driftB));
    float glint = smoothstep(0.80, 0.96, wlSmoothNoise(wp * 0.62 + vec2(11.0, 5.0) + driftB));
    srgb = min(vec3(1.0), wCol + vec3(0.86, 0.95, 1.0) * (0.065 * caustic + 0.06 * glint));
  } else if (pat > 1.5 && pat < 2.5) {
    // Pattern 2: Wooden planks (4 boards per 5ft tile, staggered joints + wood grain)
    float rowF = tileUv.y * 4.0;
    float row = floor(rowF);
    float fy = fract(rowF);
    float colF = tileUv.x * 1.15 + wlHash21(vec2(row, 3.7)) * 2.7;
    float col = floor(colF);
    float fx = fract(colF);
    float boardTone = (wlHash21(vec2(col, row)) - 0.5) * 0.16;
    float woodGrain = (wlSmoothNoise(vec2(tileUv.x * 3.5, tileUv.y * 22.0)) - 0.5) * 0.08;
    float seamY = smoothstep(0.0, 0.08, fy) * smoothstep(0.0, 0.08, 1.0 - fy);
    float seamX = smoothstep(0.0, 0.035, fx) * smoothstep(0.0, 0.035, 1.0 - fx);
    float seam = mix(0.74, 1.0, min(seamY, seamX));
    srgb = clamp(srgb * (1.0 + boardTone + woodGrain) * seam, 0.0, 1.0);
  } else if (pat > 2.5 && pat < 3.5) {
    // Pattern 3: Rounded Voronoi cobblestones / pebbles / scree
    vec2 vor = wlVoronoiEdge(tileUv * 2.75);
    float mortar = smoothstep(0.03, 0.14, vor.x);
    float stoneTone = (vor.y - 0.5) * 0.16;
    float speck = (wlSmoothNoise(wp * 5.0) - 0.5) * 0.06;
    srgb = clamp(srgb * (1.0 + stoneTone + speck) * mix(0.72, 1.03, mortar), 0.0, 1.0);
  } else if (pat > 3.5 && pat < 4.5) {
    // Pattern 4: Running-bond dungeon flagstones / brick paving
    float rowF = tileUv.y * 3.0;
    float row = floor(rowF);
    float fy = fract(rowF);
    float shift = mod(row, 2.0) * 0.5;
    float colF = tileUv.x * 2.0 + shift;
    float col = floor(colF);
    float fx = fract(colF);
    float blockTone = (wlHash21(vec2(col, row)) - 0.5) * 0.14;
    float mortarY = smoothstep(0.0, 0.075, fy) * smoothstep(0.0, 0.075, 1.0 - fy);
    float mortarX = smoothstep(0.0, 0.055, fx) * smoothstep(0.0, 0.055, 1.0 - fx);
    float mortar = mix(0.72, 1.0, min(mortarX, mortarY));
    float bevel = (fy > 0.84 || fx < 0.09) ? 1.04 : 1.0;
    float grit = (wlSmoothNoise(wp * 4.5) - 0.5) * 0.05;
    srgb = clamp(srgb * (1.0 + blockTone + grit) * mortar * bevel, 0.0, 1.0);
  } else if (pat > 4.5 && pat < 5.5) {
    // Pattern 5: Veined temple marble tiles (2x2 slabs per 5ft tile)
    vec2 cell = floor(tileUv * 2.0);
    vec2 f = fract(tileUv * 2.0);
    float grout = smoothstep(0.0, 0.045, f.x) * smoothstep(0.0, 0.045, 1.0 - f.x) * smoothstep(0.0, 0.045, f.y) * smoothstep(0.0, 0.045, 1.0 - f.y);
    float n = wlSmoothNoise(wp * 1.9 + vec2(3.1, 7.4));
    float vein = smoothstep(0.84, 0.98, abs(sin(dot(tileUv, vec2(4.2, 2.9)) + n * 4.2)));
    float tileTone = (wlHash21(cell) - 0.5) * 0.06;
    srgb = clamp(srgb * (1.0 + tileTone - vein * 0.12) * mix(0.78, 1.0, grout), 0.0, 1.0);
  } else if (pat > 5.5) {
    // Pattern 6: Animated glowing magma / lava crust plates + incandescent cracks
    skipQuantize = true;
    vec2 flow = wp * 1.15 + vec2(uTime * 0.07, -uTime * 0.05);
    vec2 vor = wlVoronoiEdge(flow + (wlSmoothNoise(wp * 0.9) - 0.5) * 0.45);
    float crack = 1.0 - smoothstep(0.02, 0.22, vor.x);
    float pulse = 0.88 + 0.12 * sin(uTime * 2.2 + vor.y * 6.283);
    vec3 crust = srgb * 0.42;
    vec3 glow = vec3(1.0, 0.64, 0.14) * pulse;
    srgb = clamp(mix(crust, glow, crack), 0.0, 1.0);
  } else if (grainStrength > 0.001) {
    // Pattern 0: Subtle WorldLab organic earth / grass / cliff rock grain
    float n1 = wlSmoothNoise(wp * grainFreq);
    float n2 = wlSmoothNoise(wp * grainFreq * 2.3 + vec2(17.3, 9.1));
    float grain = (n1 * 0.65 + n2 * 0.35) * 2.0 - 1.0;
    srgb = clamp(srgb * (1.0 + grain * grainStrength), 0.0, 1.0);
  }

  if (doQuantize > 0.5 && !skipQuantize) {
    srgb = wlQuantizeHsl16(srgb);
  }

  albedo = wlSrgbToLinear(srgb);
}`,
    },
  },
  gpu: {
    header: /* wgsl */ `
fn wlHash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}
fn wlHash22(p: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    wlHash21(p),
    wlHash21(p + vec2<f32>(37.2, 17.9))
  );
}
fn wlSmoothNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(wlHash21(i), wlHash21(i + vec2<f32>(1.0, 0.0)), f.x),
    mix(wlHash21(i + vec2<f32>(0.0, 1.0)), wlHash21(i + vec2<f32>(1.0, 1.0)), f.x),
    f.y
  );
}
fn wlVoronoiEdge(p: vec2<f32>) -> vec2<f32> {
  let n = floor(p);
  let f = fract(p);
  var f1: f32 = 8.0;
  var f2: f32 = 8.0;
  var id: f32 = 0.0;
  for (var j: i32 = -1; j <= 1; j++) {
    for (var i: i32 = -1; i <= 1; i++) {
      let g = vec2<f32>(f32(i), f32(j));
      let o = 0.15 + 0.70 * wlHash22(n + g);
      let r = g + o - f;
      let d = dot(r, r);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wlHash21(n + g);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec2<f32>(sqrt(f2) - sqrt(f1), id);
}
fn wlLinearToSrgb(c: vec3<f32>) -> vec3<f32> {
  return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
}
fn wlSrgbToLinear(c: vec3<f32>) -> vec3<f32> {
  return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
}
fn wlRgbToHsl(c: vec3<f32>) -> vec3<f32> {
  let hi = max(c.r, max(c.g, c.b));
  let lo = min(c.r, min(c.g, c.b));
  let d = hi - lo;
  let l = (hi + lo) * 0.5;
  var h: f32 = 0.0;
  var s: f32 = 0.0;
  if (d > 0.00001) {
    s = d / max(0.00001, 1.0 - abs(2.0 * l - 1.0));
    if (hi == c.r) { h = ((c.g - c.b) / d) % 6.0; }
    else if (hi == c.g) { h = (c.b - c.r) / d + 2.0; }
    else { h = (c.r - c.g) / d + 4.0; }
    h = fract(h / 6.0);
  }
  return vec3<f32>(h, s, l);
}
fn wlHslToRgb(hsl: vec3<f32>) -> vec3<f32> {
  let k = (vec3<f32>(0.0, 8.0, 4.0) + hsl.x * 12.0) % 12.0;
  let a = hsl.y * min(hsl.z, 1.0 - hsl.z);
  return clamp(hsl.z - a * max(vec3<f32>(-1.0), min(min(k - 3.0, 9.0 - k), vec3<f32>(1.0))), vec3<f32>(0.0), vec3<f32>(1.0));
}
fn wlQuantizeHsl16(srgb: vec3<f32>) -> vec3<f32> {
  let hsl = wlRgbToHsl(clamp(srgb, vec3<f32>(0.0), vec3<f32>(1.0)));
  let l256 = hsl.z * 256.0;
  var rolledSat = hsl.y;
  if (l256 > 179.0) { rolledSat *= 0.5; }
  if (l256 > 192.0) { rolledSat *= 0.5; }
  if (l256 > 217.0) { rolledSat *= 0.5; }
  if (l256 > 243.0) { rolledSat *= 0.5; }
  let h = (min(63.0, floor(hsl.x * 64.0)) + 0.5) / 64.0;
  let s = (min(7.0, floor(rolledSat * 8.0)) + 0.5) / 8.0;
  let l = min(126.0, max(2.0, floor(hsl.z * 128.0))) / 128.0;
  return wlHslToRgb(vec3<f32>(h, s, l));
}
`,
    vertex: {
      end: /* wgsl */ `output.vSurfaceMeta = input.aColor1;`,
    },
    fragment: {
      material: /* wgsl */ `{
  let wp = input.vPosition.xz;
  let tileUv = wp / 1.5;
  let pat = floor(input.vSurfaceMeta.r + 0.5);
  let grainStrength = input.vSurfaceMeta.g;
  let grainFreq = max(0.5, input.vSurfaceMeta.b * 8.0);
  let doQuantize = step(0.5, input.vSurfaceMeta.a);

  var srgb = wlLinearToSrgb(albedo);
  var skipQuantize = false;

  if (pat > 0.5 && pat < 1.5) {
    skipQuantize = true;
    let driftA = vec2<f32>(global.uTime * 0.14, -global.uTime * 0.09);
    let driftB = vec2<f32>(-global.uTime * 0.08, global.uTime * 0.13);
    let swell = smoothstep(0.18, 0.82, wlSmoothNoise(wp * 0.30 + driftA));
    let wCol = mix(srgb * 0.86, min(vec3<f32>(1.0), srgb * 1.11), swell);
    let caustic = smoothstep(0.72, 0.95, wlSmoothNoise(wp * 1.25 + driftA * 1.7 - driftB));
    let glint = smoothstep(0.80, 0.96, wlSmoothNoise(wp * 0.62 + vec2<f32>(11.0, 5.0) + driftB));
    srgb = min(vec3<f32>(1.0), wCol + vec3<f32>(0.86, 0.95, 1.0) * (0.065 * caustic + 0.06 * glint));
  } else if (pat > 1.5 && pat < 2.5) {
    let rowF = tileUv.y * 4.0;
    let row = floor(rowF);
    let fy = fract(rowF);
    let colF = tileUv.x * 1.15 + wlHash21(vec2<f32>(row, 3.7)) * 2.7;
    let col = floor(colF);
    let fx = fract(colF);
    let boardTone = (wlHash21(vec2<f32>(col, row)) - 0.5) * 0.16;
    let woodGrain = (wlSmoothNoise(vec2<f32>(tileUv.x * 3.5, tileUv.y * 22.0)) - 0.5) * 0.08;
    let seamY = smoothstep(0.0, 0.08, fy) * smoothstep(0.0, 0.08, 1.0 - fy);
    let seamX = smoothstep(0.0, 0.035, fx) * smoothstep(0.0, 0.035, 1.0 - fx);
    let seam = mix(0.74, 1.0, min(seamY, seamX));
    srgb = clamp(srgb * (1.0 + boardTone + woodGrain) * seam, vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (pat > 2.5 && pat < 3.5) {
    let vor = wlVoronoiEdge(tileUv * 2.75);
    let mortar = smoothstep(0.03, 0.14, vor.x);
    let stoneTone = (vor.y - 0.5) * 0.16;
    let speck = (wlSmoothNoise(wp * 5.0) - 0.5) * 0.06;
    srgb = clamp(srgb * (1.0 + stoneTone + speck) * mix(0.72, 1.03, mortar), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (pat > 3.5 && pat < 4.5) {
    let rowF = tileUv.y * 3.0;
    let row = floor(rowF);
    let fy = fract(rowF);
    let shift = (row % 2.0) * 0.5;
    let colF = tileUv.x * 2.0 + shift;
    let col = floor(colF);
    let fx = fract(colF);
    let blockTone = (wlHash21(vec2<f32>(col, row)) - 0.5) * 0.14;
    let mortarY = smoothstep(0.0, 0.075, fy) * smoothstep(0.0, 0.075, 1.0 - fy);
    let mortarX = smoothstep(0.0, 0.055, fx) * smoothstep(0.0, 0.055, 1.0 - fx);
    let mortar = mix(0.72, 1.0, min(mortarX, mortarY));
    var bevel: f32 = 1.0;
    if (fy > 0.84 || fx < 0.09) { bevel = 1.04; }
    let grit = (wlSmoothNoise(wp * 4.5) - 0.5) * 0.05;
    srgb = clamp(srgb * (1.0 + blockTone + grit) * mortar * bevel, vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (pat > 4.5 && pat < 5.5) {
    let cell = floor(tileUv * 2.0);
    let f = fract(tileUv * 2.0);
    let grout = smoothstep(0.0, 0.045, f.x) * smoothstep(0.0, 0.045, 1.0 - f.x) * smoothstep(0.0, 0.045, f.y) * smoothstep(0.0, 0.045, 1.0 - f.y);
    let n = wlSmoothNoise(wp * 1.9 + vec2<f32>(3.1, 7.4));
    let vein = smoothstep(0.84, 0.98, abs(sin(dot(tileUv, vec2<f32>(4.2, 2.9)) + n * 4.2)));
    let tileTone = (wlHash21(cell) - 0.5) * 0.06;
    srgb = clamp(srgb * (1.0 + tileTone - vein * 0.12) * mix(0.78, 1.0, grout), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (pat > 5.5) {
    skipQuantize = true;
    let flow = wp * 1.15 + vec2<f32>(global.uTime * 0.07, -global.uTime * 0.05);
    let vor = wlVoronoiEdge(flow + (wlSmoothNoise(wp * 0.9) - 0.5) * 0.45);
    let crack = 1.0 - smoothstep(0.02, 0.22, vor.x);
    let pulse = 0.88 + 0.12 * sin(global.uTime * 2.2 + vor.y * 6.283);
    let crust = srgb * 0.42;
    let glow = vec3<f32>(1.0, 0.64, 0.14) * pulse;
    srgb = clamp(mix(crust, glow, crack), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (grainStrength > 0.001) {
    let n1 = wlSmoothNoise(wp * grainFreq);
    let n2 = wlSmoothNoise(wp * grainFreq * 2.3 + vec2<f32>(17.3, 9.1));
    let grain = (n1 * 0.65 + n2 * 0.35) * 2.0 - 1.0;
    srgb = clamp(srgb * (1.0 + grain * grainStrength), vec3<f32>(0.0), vec3<f32>(1.0));
  }

  if (doQuantize > 0.5 && !skipQuantize) {
    srgb = wlQuantizeHsl16(srgb);
  }

  albedo = wlSrgbToLinear(srgb);
}`,
    },
  },
};

/**
 * Companion ShaderBit attached ONLY to PBR `Material3D` (`pbr_shadows` mode) so
 * Pattern 6 (`Magma / Lava`) drives true self-lit `emissive` glow that shines
 * brightly even in pitch-black Dungeon and Night lighting presets!
 */
export const worldlabTerrainEmissiveBit: ShaderBit = {
  name: 'worldlabTerrainEmissive',
  gl: {
    fragment: {
      material: /* glsl */ `{
  float pat = floor(vSurfaceMeta.r + 0.5);
  if (pat > 5.5) {
    vec2 wp = vPosition.xz;
    vec2 flow = wp * 1.15 + vec2(uTime * 0.07, -uTime * 0.05);
    vec2 vor = wlVoronoiEdge(flow + (wlSmoothNoise(wp * 0.9) - 0.5) * 0.45);
    float crack = 1.0 - smoothstep(0.02, 0.24, vor.x);
    float pulse = 0.86 + 0.14 * sin(uTime * 2.2 + vor.y * 6.283);
    vec3 molten = vec3(1.0, 0.46, 0.07) * pulse;
    vec3 core = vec3(1.0, 0.84, 0.34) * pulse;
    vec3 lavaLight = mix(molten * 0.22, core * 1.65, crack * crack + crack * 0.35);
    emissive += wlSrgbToLinear(clamp(lavaLight, 0.0, 1.0)) * (0.45 + 1.65 * crack);
  }
}`,
    },
  },
  gpu: {
    fragment: {
      material: /* wgsl */ `{
  let pat = floor(input.vSurfaceMeta.r + 0.5);
  if (pat > 5.5) {
    let wp = input.vPosition.xz;
    let flow = wp * 1.15 + vec2<f32>(global.uTime * 0.07, -global.uTime * 0.05);
    let vor = wlVoronoiEdge(flow + (wlSmoothNoise(wp * 0.9) - 0.5) * 0.45);
    let crack = 1.0 - smoothstep(0.02, 0.24, vor.x);
    let pulse = 0.86 + 0.14 * sin(global.uTime * 2.2 + vor.y * 6.283);
    let molten = vec3<f32>(1.0, 0.46, 0.07) * pulse;
    let core = vec3<f32>(1.0, 0.84, 0.34) * pulse;
    let lavaLight = mix(molten * 0.22, core * 1.65, crack * crack + crack * 0.35);
    emissive += wlSrgbToLinear(clamp(lavaLight, vec3<f32>(0.0), vec3<f32>(1.0))) * (0.45 + 1.65 * crack);
  }
}`,
    },
  },
};
