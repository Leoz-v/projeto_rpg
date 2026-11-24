/**
 * Cave rendering helpers:
 *   1. Classification for cave-mouth assets (auto-attaching unlit dark tunnel backing)
 *      and roof/ceiling assets (playable interior Roof Cutaway layer).
 *   2. Procedural 3D vaulted dark-rock-to-pitch-black tunnel liner geometry that sits
 *      flush behind cave entrances with real 3D parallax and zero sunlight bleaching.
 */

import type { FlatMaterial} from '@pixi/3d';
import { Geometry3D, Mesh3D } from '@pixi/3d';
import { srgbChannelToLinear } from '../terrain/colorVariation';
import { classifySceneryKind, type WorldLabAssetEntry } from './modelScalePolicy';

export type RoofCutawayMode = 'hidden' | 'ghost';

export interface ProceduralMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint16Array;
}

/**
 * Returns true if the asset is a cave/mine entrance arch that benefits from an
 * automatic unlit dark interior tunnel shell behind the mouth.
 */
export function isCaveMouthEntry(entry: Pick<WorldLabAssetEntry, 'key' | 'name'>): boolean {
  const text = `${entry.key} ${entry.name}`.toLowerCase();
  return /cave_mouth|slumped_entrance|rift_entrance|cave_entrance|mine_entrance|cavern_mouth/.test(text);
}

/**
 * Returns true if the asset is a ceiling, cave roof, overhang cap, or building roof
 * that should hide/ghost when the DM activates Roof / Ceiling Cutaway.
 * Explicitly excludes floor rubble debris such as `roof_fall_blocks`.
 */
export function isRoofCutawayEntry(entry: WorldLabAssetEntry): boolean {
  const text = `${entry.key} ${entry.name}`.toLowerCase();
  if (/roof_fall|rubble|debris|floor/.test(text)) {
    return false;
  }
  if (classifySceneryKind(entry) === 'ROOF') {
    return true;
  }
  return /(_roof\b|\broof\b|ceiling_teeth|flowstone_drapery|overhang|chimney_roof|pendant_roof|thatch|shingle|spire|gable_roof)/.test(
    text
  );
}

/**
 * Builds an unlit vaulted dark-rock-to-pitch-black cave tunnel backing mesh in
 * the cave mouth's local unit space (centered horizontally at x = 0, floor at y = 0,
 * front opening facing +Z, receding cavern throat extending into -Z).
 */
export function buildCaveVoidTunnelData(
  widthUnits = 4.0,
  heightUnits = 2.35,
  depthUnits = 2.55
): ProceduralMeshData {
  const w = Math.max(1.2, widthUnits);
  const h = Math.max(1.0, heightUnits);
  const d = Math.max(1.2, depthUnits);

  // 4 vaulted arch rings receding from just behind the stone lip into pitch black
  const rings: readonly {
    z: number;
    halfW: number;
    archH: number;
    floorY: number;
    rgb: readonly [number, number, number];
  }[] = [
    { z: -0.14, halfW: w * 0.37, archH: h * 0.72, floorY: -0.06, rgb: [0.105, 0.095, 0.088] },
    { z: -0.56, halfW: w * 0.43, archH: h * 0.81, floorY: -0.10, rgb: [0.052, 0.048, 0.048] },
    { z: -d * 0.56, halfW: w * 0.34, archH: h * 0.68, floorY: -0.10, rgb: [0.022, 0.022, 0.028] },
    { z: -d, halfW: w * 0.24, archH: h * 0.52, floorY: -0.08, rgb: [0.008, 0.008, 0.014] },
  ];

  // 9-point smooth horseshoe/cave arch profile (left floor -> curved vault -> right floor)
  const archSegments = 8;
  const profileCount = archSegments + 1;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const pushVert = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    srgb: readonly [number, number, number]
  ): number => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    colors.push(
      srgbChannelToLinear(srgb[0]),
      srgbChannelToLinear(srgb[1]),
      srgbChannelToLinear(srgb[2]),
      1.0
    );
    return idx;
  };

  const ringStarts: number[] = [];
  for (const ring of rings) {
    ringStarts.push(positions.length / 3);
    for (let i = 0; i < profileCount; i++) {
      // Angle goes from PI (left base) over PI/2 (crown) to 0 (right base)
      const t = i / archSegments;
      const theta = Math.PI * (1 - t);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Slightly organic cave vault (wider at lower shoulder, softly arched at crown)
      const x = cosT * ring.halfW;
      const y = i === 0 || i === archSegments ? ring.floorY : ring.floorY + Math.pow(sinT, 0.85) * ring.archH;
      // Inward-pointing normal so interior faces read cleanly
      const nx = -cosT;
      const ny = -sinT;
      // Slightly darken upper vault relative to lower walls for recessed ceiling depth
      const crownShade = 1 - 0.35 * sinT;
      pushVert(x, y, ring.z, nx, ny, 0.15, [
        ring.rgb[0] * crownShade,
        ring.rgb[1] * crownShade,
        ring.rgb[2] * crownShade,
      ]);
    }
  }

  // Stitch tunnel wall quads between consecutive rings
  for (let r = 0; r < rings.length - 1; r++) {
    const a0 = ringStarts[r]!;
    const b0 = ringStarts[r + 1]!;
    for (let i = 0; i < archSegments; i++) {
      const i00 = a0 + i;
      const i01 = a0 + i + 1;
      const i10 = b0 + i;
      const i11 = b0 + i + 1;
      indices.push(i00, i10, i11, i00, i11, i01);
    }
  }

  // Seal deep back end of tunnel with a pitch-black vaulted back wall
  const lastRing = rings[rings.length - 1]!;
  const lastStart = ringStarts[ringStarts.length - 1]!;
  const backCenterIdx = pushVert(
    0,
    lastRing.floorY + lastRing.archH * 0.42,
    lastRing.z - 0.12,
    0,
    0,
    1,
    [0.005, 0.005, 0.01]
  );
  for (let i = 0; i < archSegments; i++) {
    indices.push(lastStart + i, backCenterIdx, lastStart + i + 1);
  }
  // Close bottom edge of back wall
  indices.push(lastStart + archSegments, backCenterIdx, lastStart);

  // Dark unlit cavern floor apron from just inside the threshold back to the rear cap
  const floorRings: readonly { z: number; halfW: number; y: number; rgb: readonly [number, number, number] }[] = [
    { z: 0.04, halfW: w * 0.34, y: 0.025, rgb: [0.095, 0.088, 0.082] },
    { z: -0.48, halfW: w * 0.42, y: 0.015, rgb: [0.042, 0.04, 0.042] },
    { z: -d * 0.56, halfW: w * 0.34, y: 0.0, rgb: [0.018, 0.018, 0.024] },
    { z: -d, halfW: w * 0.24, y: -0.02, rgb: [0.006, 0.006, 0.012] },
  ];

  const floorStart = positions.length / 3;
  for (const fr of floorRings) {
    pushVert(-fr.halfW, fr.y, fr.z, 0, 1, 0, fr.rgb);
    pushVert(fr.halfW, fr.y, fr.z, 0, 1, 0, fr.rgb);
  }
  for (let r = 0; r < floorRings.length - 1; r++) {
    const l0 = floorStart + r * 2;
    const r0 = l0 + 1;
    const l1 = l0 + 2;
    const r1 = l0 + 3;
    indices.push(l0, r0, r1, l0, r1, l1);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices),
  };
}

/** Creates an unlit PixiJS 3D Mesh3D for a cave mouth's recessed dark cavern throat. */
export function createCaveVoidMesh(
  widthUnits: number,
  heightUnits: number,
  depthUnits: number,
  material: FlatMaterial,
  label: string
): Mesh3D {
  const data = buildCaveVoidTunnelData(widthUnits, heightUnits, depthUnits);
  const geometry = new Geometry3D({
    positions: data.positions,
    normals: data.normals,
    colors: data.colors,
    indices: data.indices,
  });
  return new Mesh3D({
    geometry,
    material,
    castShadow: false,
    receiveShadow: false,
    label,
  });
}
