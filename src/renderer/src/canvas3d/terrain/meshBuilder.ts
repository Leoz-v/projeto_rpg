/**
 * WorldLab chunk mesh builder ported from TerrainMeshBuilder.java.
 *
 * Key visual fidelity details matching WorldLab & RS2:
 *   1. ONE blended HSL16 underlay identity per tile (sampled at the tile anchor
 *      via the 10x10 RS2 sliding window), not 4 overlapping corner blends.
 *   2. Crisp flat-face vertex shading (`colorsFlat`, default) where every triangle
 *      gets a true flat geometric face normal + directional sun + AO + rock-facet
 *      HSL16 shading — eliminating blurry smooth gradients across slopes.
 *   3. Classic corner-lit RS2 Gouraud buffer (`colorsRs2`) and unlit albedo buffer
 *      (`colorsAlbedo`) for PBR Shadows mode, plus `surfaceMeta` (`aColor1`) for
 *      procedural ground grain, animated water drift, and HSL16 palette stepping.
 *   4. Tabletop diorama border skirt around the outer map edges.
 */

import {
  CHUNK_SIZE,
  HEIGHT_UNITS_PER_TILE,
  METERS_PER_HEIGHT_UNIT,
  RS2_BLEND_MAX_OFFSET,
  RS2_BLEND_MIN_OFFSET,
  TILE_SIZE_METERS,
} from './constants';
import {
  DEFAULT_LIGHTING,
  computeVertexMaterialColor,
  decodeHsl16ToRgb,
  packPreparedRgbToHsl16,
  rockFacetMultiplier,
  rs2BlendColor,
  rs2BlendComponents,
  shadeHsl16,
  srgbChannelToLinear,
  vertexBrightness,
  type TerrainFormPlane,
  type TerrainLightingSettings,
} from './colorVariation';
import {
  getMaterial,
  isSoftBlend,
  isVoidOverlay,
  isWaterLike,
  type ColorVariation,
  type TerrainMaterialDefinition,
} from './materials';
import type { TerrainGrid } from './terrainGrid';
import { blendCornerValues, cornerWeightsForCode, getTileShape, shapedVertexHeight } from './tileSurface';

export interface BuiltChunkMesh {
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  /** Flat-faceted per-triangle WorldLab/RS2 HSL16 shaded vertex colors (linear RGBA). */
  readonly colorsFlat: Float32Array;
  /** Classic corner-lit RS2 Gouraud shaded vertex colors (linear RGBA). */
  readonly colorsRs2: Float32Array;
  /** Unlit pigment colors for PBR + dynamic sun shadow mode (linear RGBA). */
  readonly colorsAlbedo: Float32Array;
  /** Per-vertex surface metadata passed to `aColor1`: [waterMask, grainStrength, grainScale, quantize]. */
  readonly surfaceMeta: Float32Array;
  readonly indices: Uint16Array;
  readonly triangleCount: number;
}

interface BlendedUnderlay {
  r: number;
  g: number;
  b: number;
  variation: ColorVariation;
}

function computeCornerOcclusion(grid: TerrainGrid, vx: number, vz: number): number {
  const center = grid.getHeight(vx, vz);
  let horizon = 0;
  let totalWeight = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const dist = dx !== 0 && dz !== 0 ? 1.41421356 : 1;
      const rise = grid.getHeight(vx + dx, vz + dz) - center;
      if (rise > 0) {
        horizon += Math.min(1, rise / (HEIGHT_UNITS_PER_TILE * dist));
      }
      totalWeight += 1;
    }
  }
  const occlusion = 1 - 0.44 * (horizon / totalWeight);
  return Math.max(0.76, Math.min(1, occlusion));
}

function computeCornerBrightness(
  grid: TerrainGrid,
  vx: number,
  vz: number,
  lighting: TerrainLightingSettings
): number {
  return vertexBrightness(
    grid.getHeight(vx - 1, vz),
    grid.getHeight(vx + 1, vz),
    grid.getHeight(vx, vz - 1),
    grid.getHeight(vx, vz + 1),
    lighting
  );
}

/**
 * Geometric face brightness for one triangle (exact WorldLab TerrainLighting.triangleBrightness
 * adapted for crisp flat-shaded low-poly facets).
 */
function computeFlatTriangleBrightness(
  nx: number,
  ny: number,
  nz: number,
  lighting: TerrainLightingSettings
): number {
  const vertical = Math.max(0, Math.min(1, ny));
  const ambientSlope = lighting.slopeFloor + (1 - lighting.slopeFloor) * vertical * vertical;
  const sunDot = nx * lighting.sunX + ny * lighting.sunY + nz * lighting.sunZ;
  // Grounded daylight exposure: flat ground sits right around ~0.92 so earthy RS2 pigments never blow out
  const raw = lighting.ambient * ambientSlope * 0.92 + lighting.diffuse * 0.72 * Math.max(-0.25, sunDot);
  return Math.max(lighting.minBrightness, Math.min(1.16, raw));
}

function classifyFormPlane(grid: TerrainGrid, tx: number, tz: number): TerrainFormPlane {
  const sw = grid.getHeight(tx, tz);
  const se = grid.getHeight(tx + 1, tz);
  const nw = grid.getHeight(tx, tz + 1);
  const ne = grid.getHeight(tx + 1, tz + 1);
  const dhdx = ((se - sw) + (ne - nw)) * 0.5 / HEIGHT_UNITS_PER_TILE;
  const dhdz = ((nw - sw) + (ne - se)) * 0.5 / HEIGHT_UNITS_PER_TILE;
  const slope = Math.hypot(dhdx, dhdz);
  if (slope < 0.35) return 'PLAIN';
  const center = (sw + se + nw + ne) * 0.25;
  const avgNeighbor =
    (grid.getHeight(tx - 1, tz) +
      grid.getHeight(tx + 2, tz) +
      grid.getHeight(tx, tz - 1) +
      grid.getHeight(tx, tz + 2)) *
    0.25;
  if (center > avgNeighbor + 28) return 'CAP';
  if (center < avgNeighbor - 28) return 'FOOT';
  return 'FACE';
}

/**
 * Exact WorldLab 10-tile sliding window RS2 underlay blend (-4..+5 on X and Z),
 * sampled once per tile anchor (matching TerrainMeshBuilder.java lines 408-415).
 */
function computeBlendedUnderlay(grid: TerrainGrid, tx: number, tz: number, centerId: number): BlendedUnderlay {
  const center = getMaterial(centerId);
  if (!isSoftBlend(center)) {
    return { r: center.r, g: center.g, b: center.b, variation: center.colorVariation };
  }

  let chroma = 0;
  let sat = 0;
  let light = 0;
  let luminance = 0;
  let magnitude = 0;

  let macroHue = 0;
  let macroSat = 0;
  let macroLight = 0;
  let tileHue = 0;
  let tileSat = 0;
  let tileLight = 0;
  let vertexHue = 0;
  let vertexSat = 0;
  let vertexLight = 0;
  let macroScale = 0;
  let hueSteps = 0;
  let satSteps = 0;
  let lightSteps = 0;

  for (let dx = RS2_BLEND_MIN_OFFSET; dx <= RS2_BLEND_MAX_OFFSET; dx++) {
    for (let dz = RS2_BLEND_MIN_OFFSET; dz <= RS2_BLEND_MAX_OFFSET; dz++) {
      const sx = tx + dx;
      const sz = tz + dz;
      if (!grid.inTileBounds(sx, sz)) continue;
      // Use authored underlay for neighborhood blending (matching TerrainMeshBuilder.java line 350)
      const mat = getMaterial(grid.getAuthoredUnderlay(sx, sz));
      if (!isSoftBlend(mat)) continue;
      const [c, s, l, lum] = rs2BlendComponents(mat.r, mat.g, mat.b);
      chroma += c;
      sat += s;
      light += l;
      luminance += lum;

      const cv = mat.colorVariation;
      macroHue += cv.macroHue;
      macroSat += cv.macroSaturation;
      macroLight += cv.macroLightness;
      tileHue += cv.tileHue;
      tileSat += cv.tileSaturation;
      tileLight += cv.tileLightness;
      vertexHue += cv.vertexHue;
      vertexSat += cv.vertexSaturation;
      vertexLight += cv.vertexLightness;
      macroScale += cv.macroScaleTiles;
      hueSteps += cv.hueSteps;
      satSteps += cv.saturationSteps;
      lightSteps += cv.lightnessSteps;
      magnitude++;
    }
  }

  if (magnitude === 0) {
    return { r: center.r, g: center.g, b: center.b, variation: center.colorVariation };
  }

  const [r, g, b] = rs2BlendColor(chroma, sat, light, luminance, magnitude);
  const inv = 1 / magnitude;
  return {
    r,
    g,
    b,
    variation: {
      macroHue: macroHue * inv,
      macroSaturation: macroSat * inv,
      macroLightness: macroLight * inv,
      tileHue: tileHue * inv,
      tileSaturation: tileSat * inv,
      tileLightness: tileLight * inv,
      vertexHue: vertexHue * inv,
      vertexSaturation: vertexSat * inv,
      vertexLightness: vertexLight * inv,
      macroScaleTiles: macroScale * inv,
      hueSteps: Math.round(hueSteps * inv),
      saturationSteps: Math.round(satSteps * inv),
      lightnessSteps: Math.round(lightSteps * inv),
    },
  };
}

/**
 * Computes ONE crisp WorldLab RS2 tile pigment per tile (at tile anchor tx+0.5, tz+0.5).
 * Eliminates mushy 4-corner RGB smearing inside each tile!
 */
function computeTilePigment(
  grid: TerrainGrid,
  material: TerrainMaterialDefinition,
  tx: number,
  tz: number,
  isUnderlayLayer: boolean
): [number, number, number] {
  const plane = classifyFormPlane(grid, tx, tz);
  if (isUnderlayLayer && isSoftBlend(material)) {
    const blended = computeBlendedUnderlay(grid, tx, tz, material.id);
    return computeVertexMaterialColor(
      material,
      blended.r,
      blended.g,
      blended.b,
      blended.variation,
      tx,
      tz,
      0.5,
      0.5,
      plane
    );
  }
  return computeVertexMaterialColor(
    material,
    material.r,
    material.g,
    material.b,
    material.colorVariation,
    tx,
    tz,
    0.5,
    0.5,
    plane
  );
}

function surfaceGrainParams(mat: TerrainMaterialDefinition): [number, number] {
  if (isWaterLike(mat)) return [0, 0.25];
  if (mat.lightingMode === 'FACETED') return [0.11, 0.32]; // Rock/cliff coarse grain
  if (mat.key.includes('sand') || mat.key.includes('desert')) return [0.06, 0.45];
  if (mat.key.includes('road') || mat.key.includes('brick') || mat.key.includes('pebble')) return [0.09, 0.55];
  if (mat.key.includes('wood') || mat.key.includes('marble') || mat.key.includes('ice')) return [0.04, 0.4];
  return [0.075, 0.36]; // Meadow grass / earth / mud
}

function shadePigmentHsl16(
  baseRgb: readonly [number, number, number],
  brightness: number,
  isWater: boolean,
  lighting: TerrainLightingSettings
): [number, number, number] {
  if (isWater) {
    const wLight = 0.78 + 0.22 * brightness;
    return [
      Math.min(1, baseRgb[0] * wLight),
      Math.min(1, baseRgb[1] * wLight),
      Math.min(1, baseRgb[2] * wLight * 1.03),
    ];
  }
  const packed = packPreparedRgbToHsl16(baseRgb);
  const shaded = shadeHsl16(packed, brightness);
  const lit = decodeHsl16ToRgb(shaded);
  // Subtle warm sun / cool shadow atmospheric key tint (restrained, like WorldLab TerrainShaderSource)
  const light01 = Math.max(
    0,
    Math.min(1, (brightness - lighting.minBrightness) / (1.16 - lighting.minBrightness))
  );
  const tintR = 0.93 + 0.09 * light01;
  const tintG = 0.95 + 0.05 * light01;
  const tintB = 1.04 - 0.07 * light01;
  return [Math.min(1, lit[0] * tintR), Math.min(1, lit[1] * tintG), Math.min(1, lit[2] * tintB)];
}

export function buildChunkMesh(
  grid: TerrainGrid,
  chunkX: number,
  chunkZ: number,
  lighting: TerrainLightingSettings = DEFAULT_LIGHTING
): BuiltChunkMesh {
  const startTx = chunkX * CHUNK_SIZE;
  const startTz = chunkZ * CHUNK_SIZE;
  const endTx = Math.min(grid.width, startTx + CHUNK_SIZE);
  const endTz = Math.min(grid.length, startTz + CHUNK_SIZE);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colorsFlat: number[] = [];
  const colorsRs2: number[] = [];
  const colorsAlbedo: number[] = [];
  const surfaceMeta: number[] = [];
  const indices: number[] = [];

  for (let tz = startTz; tz < endTz; tz++) {
    for (let tx = startTx; tx < endTx; tx++) {
      // Skip generating terrain triangles on punched cutout / cave hole tiles
      if (grid.isHole(tx, tz)) continue;

      const tile = grid.getTile(tx, tz);
      const underlayMat = getMaterial(tile.underlayId);
      const hasOverlay = tile.overlayId !== 0;
      const overlayMat = hasOverlay ? getMaterial(tile.overlayId) : null;

      const hSW = grid.getHeight(tx, tz);
      const hSE = grid.getHeight(tx + 1, tz);
      const hNW = grid.getHeight(tx, tz + 1);
      const hNE = grid.getHeight(tx + 1, tz + 1);

      const occSW = computeCornerOcclusion(grid, tx, tz);
      const occSE = computeCornerOcclusion(grid, tx + 1, tz);
      const occNW = computeCornerOcclusion(grid, tx, tz + 1);
      const occNE = computeCornerOcclusion(grid, tx + 1, tz + 1);

      // Per-vertex painted Shadow / Ambient Occlusion multiplier (1.0 = unshaded, ~0.09 = deep cave recess)
      const paintAoSW = 1 - grid.getVertexShade(tx, tz) * 0.91;
      const paintAoSE = 1 - grid.getVertexShade(tx + 1, tz) * 0.91;
      const paintAoNW = 1 - grid.getVertexShade(tx, tz + 1) * 0.91;
      const paintAoNE = 1 - grid.getVertexShade(tx + 1, tz + 1) * 0.91;

      const lightSW = computeCornerBrightness(grid, tx, tz, lighting) * occSW;
      const lightSE = computeCornerBrightness(grid, tx + 1, tz, lighting) * occSE;
      const lightNW = computeCornerBrightness(grid, tx, tz + 1, lighting) * occNW;
      const lightNE = computeCornerBrightness(grid, tx + 1, tz + 1, lighting) * occNE;

      // WorldLab single-tile HSL16 pigment identity (no blurry 4-corner RGB smearing)
      const underlayPigment = computeTilePigment(grid, underlayMat, tx, tz, true);
      const overlayPigment = overlayMat ? computeTilePigment(grid, overlayMat, tx, tz, false) : null;

      const shape = getTileShape(tile.overlayId, tile.overlayShape, tile.overlayRotation);

      // Detect water-land shared edges inside this shaped tile for WorldLab's wet shoreline rim
      const waterShoreRim = overlayMat !== null && isWaterLike(overlayMat) && !isWaterLike(underlayMat);
      const shoreEdges: { pu: number; pv: number; qu: number; qv: number }[] = [];
      if (waterShoreRim) {
        for (const land of shape.triangles) {
          if (land.overlay) continue;
          const li = [land.a, land.b, land.c] as const;
          for (let e = 0; e < 3; e++) {
            const f = li[e]!;
            const s = li[(e + 1) % 3]!;
            const shared = shape.triangles.some((w) => {
              if (!w.overlay) return false;
              const wi = [w.a, w.b, w.c] as const;
              for (let k = 0; k < 3; k++) {
                const wa = wi[k]!;
                const wb = wi[(k + 1) % 3]!;
                if ((wa === f && wb === s) || (wa === s && wb === f)) return true;
              }
              return false;
            });
            if (shared) {
              const vp = shape.vertices[f]!;
              const vq = shape.vertices[s]!;
              shoreEdges.push({ pu: vp.u, pv: vp.v, qu: vq.u, qv: vq.v });
            }
          }
        }
      }

      for (const tri of shape.triangles) {
        const useOverlay = tri.overlay && overlayMat !== null && overlayPigment !== null;
        // Lost-City 0xFF00FF Shaped Void Cutout: omit overlay triangles while keeping underlay triangles!
        if (useOverlay && isVoidOverlay(overlayMat)) {
          continue;
        }
        const faceMat = useOverlay ? overlayMat : underlayMat;
        const basePigment = useOverlay ? overlayPigment : underlayPigment;
        const water = isWaterLike(faceMat);
        const faceted = faceMat.lightingMode === 'FACETED';
        const facetMult = faceted ? rockFacetMultiplier(hSW, hSE, hNW, hNE, lighting) : 1;
        const [grainStrength, grainScale] = surfaceGrainParams(faceMat);

        const triVertSpecs = [shape.vertices[tri.a]!, shape.vertices[tri.b]!, shape.vertices[tri.c]!];
        const triPos: [number, number, number][] = [];

        for (const spec of triVertSpecs) {
          const hUnits = shapedVertexHeight(spec.code, hSW, hSE, hNW, hNE);
          const wx = (tx + spec.u) * TILE_SIZE_METERS;
          const wy = hUnits * METERS_PER_HEIGHT_UNIT;
          const wz = (tz + spec.v) * TILE_SIZE_METERS;
          triPos.push([wx, wy, wz]);
        }

        // True flat face normal for every triangle (gives crisp low-poly WorldLab facets!)
        const [ax, ay, az] = triPos[0]!;
        const [bx, by, bz] = triPos[1]!;
        const [cx, cy, cz] = triPos[2]!;
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        let flatNx = aby * acz - abz * acy;
        let flatNy = abz * acx - abx * acz;
        let flatNz = abx * acy - aby * acx;
        if (flatNy < 0) {
          flatNx = -flatNx;
          flatNy = -flatNy;
          flatNz = -flatNz;
        }
        const nLen = Math.hypot(flatNx, flatNy, flatNz);
        if (nLen > 1e-6) {
          flatNx /= nLen;
          flatNy /= nLen;
          flatNz /= nLen;
        } else {
          flatNx = 0;
          flatNy = 1;
          flatNz = 0;
        }

        // Triangle average AO + flat directional face brightness (identical for all 3 vertices -> true flat shading!)
        let avgOcc = 0;
        let avgPaintAo = 0;
        for (const spec of triVertSpecs) {
          const w = cornerWeightsForCode(spec.code);
          avgOcc += blendCornerValues(w, occSW, occSE, occNW, occNE);
          avgPaintAo += blendCornerValues(w, paintAoSW, paintAoSE, paintAoNW, paintAoNE);
        }
        avgOcc /= 3;
        avgPaintAo /= 3;

        // Wet shoreline rim darkening on land triangles touching water
        let faceWetShade = 1.0;
        let facePigment: [number, number, number] = [basePigment[0], basePigment[1], basePigment[2]];
        if (!useOverlay && shoreEdges.length > 0) {
          const cu = (triVertSpecs[0]!.u + triVertSpecs[1]!.u + triVertSpecs[2]!.u) / 3;
          const cv = (triVertSpecs[0]!.v + triVertSpecs[1]!.v + triVertSpecs[2]!.v) / 3;
          let minDist = Infinity;
          for (const edge of shoreEdges) {
            const edx = edge.qu - edge.pu;
            const edz = edge.qv - edge.pv;
            const lenSq = edx * edx + edz * edz;
            const t =
              lenSq > 1e-8 ? Math.max(0, Math.min(1, ((cu - edge.pu) * edx + (cv - edge.pv) * edz) / lenSq)) : 0;
            const d = Math.hypot(cu - (edge.pu + t * edx), cv - (edge.pv + t * edz));
            if (d < minDist) minDist = d;
          }
          const wet = Math.max(0, 1 - minDist / 0.35);
          const smoothWet = wet * wet * (3 - 2 * wet);
          faceWetShade = 1 - 0.14 * smoothWet;
          facePigment = [
            facePigment[0] * (1 - 0.1 * smoothWet),
            facePigment[1] * (1 - 0.12 * smoothWet),
            facePigment[2] * (1 - 0.13 * smoothWet),
          ];
        }

        const flatFaceBright =
          computeFlatTriangleBrightness(flatNx, flatNy, flatNz, lighting) * avgOcc * facetMult * faceWetShade;
        const flatRgbRaw = shadePigmentHsl16(facePigment, flatFaceBright, water, lighting);
        const flatRgb: [number, number, number] = [
          flatRgbRaw[0] * avgPaintAo,
          flatRgbRaw[1] * avgPaintAo,
          flatRgbRaw[2] * avgPaintAo,
        ];
        const flatLinR = srgbChannelToLinear(flatRgb[0]);
        const flatLinG = srgbChannelToLinear(flatRgb[1]);
        const flatLinB = srgbChannelToLinear(flatRgb[2]);

        const baseVertex = positions.length / 3;

        for (let k = 0; k < 3; k++) {
          const spec = triVertSpecs[k]!;
          const [wx, wy, wz] = triPos[k]!;
          const weights = cornerWeightsForCode(spec.code);
          const cornerPaintAo = blendCornerValues(weights, paintAoSW, paintAoSE, paintAoNW, paintAoNE);

          positions.push(wx, wy, wz);
          // Flat face normals on every vertex so even PBR + Shadows mode renders crisp low-poly facets!
          normals.push(flatNx, flatNy, flatNz);
          uvs.push(tx + spec.u, tz + spec.v);

          // 1. Flat-shaded per-triangle WorldLab vertex color (modulated per-vertex when AO is painted for smooth cave threshold falloff)
          if (Math.abs(cornerPaintAo - avgPaintAo) > 0.002) {
            colorsFlat.push(
              srgbChannelToLinear(flatRgbRaw[0] * cornerPaintAo),
              srgbChannelToLinear(flatRgbRaw[1] * cornerPaintAo),
              srgbChannelToLinear(flatRgbRaw[2] * cornerPaintAo),
              1.0
            );
          } else {
            colorsFlat.push(flatLinR, flatLinG, flatLinB, 1.0);
          }

          // 2. Classic RS2 corner-lit Gouraud color (one tile hue/sat, lit corners + painted AO)
          const rawBright = blendCornerValues(
            weights,
            lightSW * facetMult,
            lightSE * facetMult,
            lightNW * facetMult,
            lightNE * facetMult
          );
          const cornerBright = Math.max(lighting.minBrightness, Math.min(1.16, rawBright * 0.92)) * faceWetShade;
          const rs2Rgb = shadePigmentHsl16(facePigment, cornerBright, water, lighting);
          colorsRs2.push(
            srgbChannelToLinear(rs2Rgb[0] * cornerPaintAo),
            srgbChannelToLinear(rs2Rgb[1] * cornerPaintAo),
            srgbChannelToLinear(rs2Rgb[2] * cornerPaintAo),
            1.0
          );

          // 3. Albedo for PBR + real-time shadow mode (preserve subtle AO + facet tint + painted vertex shadow/AO)
          const pbrMod = (faceted ? 0.85 + 0.15 * facetMult : 1.0) * (0.85 + 0.15 * avgOcc) * cornerPaintAo;
          colorsAlbedo.push(
            srgbChannelToLinear(Math.min(1, facePigment[0] * pbrMod)),
            srgbChannelToLinear(Math.min(1, facePigment[1] * pbrMod)),
            srgbChannelToLinear(Math.min(1, facePigment[2] * pbrMod)),
            1.0
          );

          // 4. Surface metadata for worldlabTerrainBit: [surfacePatternId, grainStrength, grainScale, quantizeHsl16]
          surfaceMeta.push(faceMat.surfacePattern, grainStrength, grainScale, 1.0);
        }

        indices.push(baseVertex, baseVertex + 1, baseVertex + 2);
      }
    }
  }

  return {
    chunkX,
    chunkZ,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colorsFlat: new Float32Array(colorsFlat),
    colorsRs2: new Float32Array(colorsRs2),
    colorsAlbedo: new Float32Array(colorsAlbedo),
    surfaceMeta: new Float32Array(surfaceMeta),
    indices: new Uint16Array(indices),
    triangleCount: indices.length / 3,
  };
}

/**
 * Builds a clean dark-earth tabletop diorama skirt around the 4 outer edges
 * of the map so the 3D battlemap reads as a solid physical diorama block.
 */
export function buildDioramaSkirt(grid: TerrainGrid): {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
} {
  const w = grid.width;
  const l = grid.length;
  let minH = 0;
  for (let i = 0; i < grid.heights.length; i++) {
    const h = grid.heights[i] ?? 0;
    if (h < minH) minH = h;
  }
  const bottomY = minH * METERS_PER_HEIGHT_UNIT - 2.2;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const topR = srgbChannelToLinear(0.24);
  const topG = srgbChannelToLinear(0.2);
  const topB = srgbChannelToLinear(0.16);
  const botR = srgbChannelToLinear(0.11);
  const botG = srgbChannelToLinear(0.1);
  const botB = srgbChannelToLinear(0.09);

  const pushQuad = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    nx: number,
    nz: number,
    shade: number
  ): void => {
    const base = positions.length / 3;
    positions.push(
      x0, y0, z0,
      x1, y1, z1,
      x1, bottomY, z1,
      x0, bottomY, z0
    );
    for (let i = 0; i < 4; i++) normals.push(nx, 0, nz);
    colors.push(
      topR * shade, topG * shade, topB * shade, 1,
      topR * shade, topG * shade, topB * shade, 1,
      botR * shade, botG * shade, botB * shade, 1,
      botR * shade, botG * shade, botB * shade, 1
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // South edge (z = 0, facing -Z)
  for (let vx = 0; vx < w; vx++) {
    pushQuad(
      vx * TILE_SIZE_METERS,
      grid.getHeight(vx, 0) * METERS_PER_HEIGHT_UNIT,
      0,
      (vx + 1) * TILE_SIZE_METERS,
      grid.getHeight(vx + 1, 0) * METERS_PER_HEIGHT_UNIT,
      0,
      0,
      -1,
      0.85
    );
  }
  // North edge (z = l, facing +Z)
  for (let vx = w; vx > 0; vx--) {
    pushQuad(
      vx * TILE_SIZE_METERS,
      grid.getHeight(vx, l) * METERS_PER_HEIGHT_UNIT,
      l * TILE_SIZE_METERS,
      (vx - 1) * TILE_SIZE_METERS,
      grid.getHeight(vx - 1, l) * METERS_PER_HEIGHT_UNIT,
      l * TILE_SIZE_METERS,
      0,
      1,
      1.0
    );
  }
  // West edge (x = 0, facing -X)
  for (let vz = l; vz > 0; vz--) {
    pushQuad(
      0,
      grid.getHeight(0, vz) * METERS_PER_HEIGHT_UNIT,
      vz * TILE_SIZE_METERS,
      0,
      grid.getHeight(0, vz - 1) * METERS_PER_HEIGHT_UNIT,
      (vz - 1) * TILE_SIZE_METERS,
      -1,
      0,
      0.72
    );
  }
  // East edge (x = w, facing +X)
  for (let vz = 0; vz < l; vz++) {
    pushQuad(
      w * TILE_SIZE_METERS,
      grid.getHeight(w, vz) * METERS_PER_HEIGHT_UNIT,
      vz * TILE_SIZE_METERS,
      w * TILE_SIZE_METERS,
      grid.getHeight(w, vz + 1) * METERS_PER_HEIGHT_UNIT,
      (vz + 1) * TILE_SIZE_METERS,
      1,
      0,
      0.92
    );
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices),
  };
}
