/**
 * Mesh winding normalization and material repair utilities for loaded GLB assets.
 *
 * Fixes:
 *  1. Inverted (negative-signed-volume) closed meshes (e.g. greyvein/iron_outcrop.glb)
 *     by flipping triangle winding to outward CCW and negating vertex normals once on load.
 *  2. Blender's emission-fallback materials (black baseColor + bright white emissive, e.g.
 *     greyvein cave/mine pieces) by replacing the unlit white glow with lit natural stone colors.
 */

import { getAttributeData, type Geometry3D, type Scene3DSource } from '@pixi/3d';

/**
 * Computes signed volume of a triangle mesh: V = (1/6) * sum(v0 . (v1 x v2)).
 * Outward CCW closed solids have V > 0; inside-out CW solids have V < 0.
 */
export function computeSignedVolume(
  positions: ArrayLike<number>,
  indices?: ArrayLike<number> | null
): number {
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices ? indices[t * 3]! : t * 3;
    const i1 = indices ? indices[t * 3 + 1]! : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2]! : t * 3 + 2;

    const x0 = positions[i0 * 3] ?? 0;
    const y0 = positions[i0 * 3 + 1] ?? 0;
    const z0 = positions[i0 * 3 + 2] ?? 0;
    const x1 = positions[i1 * 3] ?? 0;
    const y1 = positions[i1 * 3 + 1] ?? 0;
    const z1 = positions[i1 * 3 + 2] ?? 0;
    const x2 = positions[i2 * 3] ?? 0;
    const y2 = positions[i2 * 3 + 1] ?? 0;
    const z2 = positions[i2 * 3 + 2] ?? 0;

    vol += (x0 * (y1 * z2 - z1 * y2) + y0 * (z1 * x2 - x1 * z2) + z0 * (x1 * y2 - y1 * x2)) / 6;
  }
  return vol;
}

/** Reverses triangle winding in-place by swapping indices 1 and 2 of each triangle. */
export function flipIndicesWinding(indices: Uint16Array | Uint32Array): void {
  const triCount = Math.floor(indices.length / 3);
  for (let t = 0; t < triCount; t++) {
    const a = t * 3 + 1;
    const b = t * 3 + 2;
    const tmp = indices[a]!;
    indices[a] = indices[b]!;
    indices[b] = tmp;
  }
}

/** Negates vertex normal XYZ vectors in-place (handles float32x3 and quantized snorm16x4). */
export function negateNormalBuffer(normals: Float32Array | Int16Array, componentsPerVertex: number): void {
  if (normals instanceof Int16Array) {
    for (let i = 0; i + 2 < normals.length; i += componentsPerVertex) {
      normals[i] = Math.max(-32767, Math.min(32767, -normals[i]!));
      normals[i + 1] = Math.max(-32767, Math.min(32767, -normals[i + 1]!));
      normals[i + 2] = Math.max(-32767, Math.min(32767, -normals[i + 2]!));
    }
  } else {
    for (let i = 0; i + 2 < normals.length; i += componentsPerVertex) {
      normals[i] = normals[i] === 0 ? 0 : -normals[i]!;
      normals[i + 1] = normals[i + 1] === 0 ? 0 : -normals[i + 1]!;
      normals[i + 2] = normals[i + 2] === 0 ? 0 : -normals[i + 2]!;
    }
  }
}

function flipGeometryPrimitive(geo: Geometry3D): void {
  const idx = geo.indices;
  if (idx.length >= 3) {
    flipIndicesWinding(idx);
    geo.indices = idx;
  }

  const rawNormals = geo.normals;
  if (rawNormals instanceof Int16Array) {
    const comp = rawNormals.length === geo.vertexCount * 4 ? 4 : 3;
    negateNormalBuffer(rawNormals, comp);
    geo.normals = rawNormals;
  } else if (rawNormals instanceof Float32Array) {
    const comp = rawNormals.length === geo.vertexCount * 4 ? 4 : 3;
    negateNormalBuffer(rawNormals, comp);
    geo.normals = rawNormals;
  }

  geo.unload();
}

/**
 * Inspects every mesh in a loaded Scene3DSource. If a mesh's combined signed volume
 * is negative (inside-out CW winding), flips every primitive's winding & normals to
 * outward CCW so hardware back-face culling and flat shading work cleanly.
 */
export function normalizeSceneSourceWinding(source: Scene3DSource): number {
  let repairedMeshes = 0;

  for (const meshPrimitives of source.geometries) {
    if (meshPrimitives.length === 0) continue;

    let totalSignedVolume = 0;
    let totalTriangles = 0;
    let allIndexed = true;

    for (const geo of meshPrimitives) {
      if (!geo.attributes.aPosition) continue;
      try {
        const pos = getAttributeData(geo, 'aPosition', 3);
        const idx = geo.indices;
        const hasIndices = idx.length >= 3;
        if (!hasIndices) allIndexed = false;
        const tris = hasIndices ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9);
        if (tris <= 0) continue;
        totalTriangles += tris;
        totalSignedVolume += computeSignedVolume(pos, hasIndices ? idx : null);
      } catch {
        // Ignore exotic/interleaved buffers that cannot be read back
      }
    }

    if (allIndexed && totalTriangles >= 4 && totalSignedVolume < -1e-5) {
      for (const geo of meshPrimitives) {
        flipGeometryPrimitive(geo);
      }
      repairedMeshes++;
    }
  }

  return repairedMeshes;
}

/**
 * Derives a natural lit WorldLab stone/prop base color for materials exported from Blender
 * with black baseColorFactor + bright white emissive fallback (e.g. greyvein cave/mine pack).
 * Returns null if the material is an intentional light source (flame/fire/ember/glow).
 */
export function resolveUnlitEmissiveFallbackColor(materialLabel: string): number | null {
  const lower = materialLabel.toLowerCase();
  if (/\b(flame|fire|ember|embers|glow|lava|magic|crystal_light)\b/.test(lower)) {
    return null;
  }
  if (/dark\s*mud|mudstone|shale|basalt/.test(lower)) return 0x4e4c49;
  if (/pitch|binding|tar/.test(lower)) return 0x322b26;
  if (/pit\s*props|old\s*timber|timber|oak|wood|plank|post|beam|torch/.test(lower)) return 0x6d4f35;
  if (/ochre|clay|sandstone|rust|silt/.test(lower)) return 0x997a52;
  if (/mine\s*floor|floor|scree|gravel|cobble/.test(lower)) return 0x6b6760;
  if (/upper\s*rock|limestone|chalk/.test(lower)) return 0x8a867e;
  if (/split\s*stone|ashlar|rock|stone/.test(lower)) return 0x77736c;
  if (/calcite|dripstone|stalag|flowstone/.test(lower)) return 0xbcb39f;
  if (/iron|ore|metal|rail|track|steel/.test(lower)) return 0x5c5754;
  if (/water|pool|stream|seep|spring/.test(lower)) return 0x456e82;
  if (/moss|lichen|grass|vine/.test(lower)) return 0x596d44;
  return 0x7d7971;
}
