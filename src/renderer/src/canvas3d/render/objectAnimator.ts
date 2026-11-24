/**
 * Embedded glTF animation playback helpers.
 *
 * Plays ONLY real animations already authored inside the loaded GLB files
 * (e.g. greyvein/standing_torch & greyvein/wall_torch morph-target flames),
 * with deterministic randomized starting phase offsets per placement so
 * adjacent animated props do not move in lockstep.
 *
 * Non-animated models stay strictly static (no procedural bobbing/squashing/swaying).
 */

import type { WorldLabAssetEntry } from './modelScalePolicy';

export type AmbientAnimKind = 'none' | 'gltf_clip';

/** Deterministic [0, 1) phase hash per placement ID so neighboring animated props are staggered. */
export function stablePhase(id: string, salt = ''): number {
  let h = 2166136261;
  const text = `${id}:${salt}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Returns `'gltf_clip'` only when the GLB actually contains embedded animation clips. */
export function classifyAmbientAnimation(entry: WorldLabAssetEntry): AmbientAnimKind {
  return entry.hasAnimation ? 'gltf_clip' : 'none';
}

/** Computes a subtle emissive glow pulse strictly for glowing flame materials on animated torches. */
export function evaluateFlameEmissiveStrength(elapsedSeconds: number, phase01: number): number {
  const t = elapsedSeconds * 5.2 + phase01 * Math.PI * 2;
  const flicker = Math.sin(t) * 0.2 + Math.sin(t * 2.3 + 1.1) * 0.12;
  return 1.7 + flicker;
}
