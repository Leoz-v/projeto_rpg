/**
 * TypeScript port of WorldLab's ImportedModelScalePolicy.java adapted to D&D 5ft / 1.5m tiles.
 *
 * Authored packs (anchor = AUTHORED, unitsPerTile = 1) keep their exact exported tile proportions.
 * Uncalibrated / promoted assets (anchor = BOUNDS_MIN, unitsPerTile = 1, e.g. nature, chunkworld,
 * external poly-pizza/quaternius packs) are normalized from their actual GLB bounds against
 * WorldLab's semantic scenery/actor reference dimensions scaled by the active tile unit size.
 */

import { TILE_SIZE_METERS } from '../terrain/constants';

export type AssetCategory = 'architecture' | 'nature' | 'prop' | 'creature' | 'fx';
export type AssetScalePolicy = 'auto_dnd' | 'tile_1_5m' | 'metric_1_0m';
export type PlacementRole = 'ground' | 'wall_decor' | 'elevated';

export type SceneryKind =
  | 'TREE'
  | 'ROCK'
  | 'SHRUB'
  | 'STUMP'
  | 'GROUND_DETAIL'
  | 'WALL'
  | 'ROOF'
  | 'ENTRANCE'
  | 'DOOR'
  | 'WINDOW'
  | 'COLUMN'
  | 'BEAM'
  | 'FURNITURE'
  | 'GENERIC';

export interface WorldLabAssetEntry {
  readonly key: string;
  readonly pack: string;
  readonly name: string;
  readonly glbUrl: string;
  readonly unitsPerTile: number;
  readonly nominalWidthTiles: number;
  readonly nominalLengthTiles: number;
  readonly fitFootprint: boolean;
  readonly anchor: string;
  readonly assetKind?: string;
  readonly category: AssetCategory;
  readonly placementRole?: PlacementRole;
  readonly rawBounds?: readonly [number, number, number];
  readonly rawMinY?: number;
  readonly hasAnimation?: boolean;
  readonly animations?: readonly string[];
}

export interface Vec3Size {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ModelBaseScales {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly mode: 'authored' | 'auto_fit' | 'actor_fit' | 'fit_footprint';
  readonly kind: SceneryKind;
}

export interface RotatedFootprint {
  readonly widthTiles: number;
  readonly lengthTiles: number;
}

const VALID_SCENERY_KINDS = new Set<SceneryKind>([
  'TREE',
  'ROCK',
  'SHRUB',
  'STUMP',
  'GROUND_DETAIL',
  'WALL',
  'ROOF',
  'ENTRANCE',
  'DOOR',
  'WINDOW',
  'COLUMN',
  'BEAM',
  'FURNITURE',
  'GENERIC',
]);

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function containsToken(text: string, ...tokens: string[]): boolean {
  for (const token of tokens) {
    let from = 0;
    let at = text.indexOf(token, from);
    while (at >= 0) {
      const end = at + token.length;
      const leftOk = at === 0 || !isAsciiAlphanumeric(text.charCodeAt(at - 1));
      const rightOk = end === text.length || !isAsciiAlphanumeric(text.charCodeAt(end));
      if (leftOk && rightOk) return true;
      from = at + 1;
      at = text.indexOf(token, from);
    }
  }
  return false;
}

function containsAny(text: string, ...substrings: string[]): boolean {
  for (const sub of substrings) {
    if (text.includes(sub)) return true;
  }
  return false;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function classifyText(raw: string): SceneryKind | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;

  const normalized = key.replace(/-/g, '_').toUpperCase() as SceneryKind;
  if (VALID_SCENERY_KINDS.has(normalized)) return normalized;

  if (containsToken(key, 'stump', 'treestump')) return 'STUMP';
  if (containsToken(key, 'doorway', 'archway', 'portal', 'entrance', 'arch')) return 'ENTRANCE';
  if (containsToken(key, 'window', 'windows')) return 'WINDOW';
  if (containsToken(key, 'door', 'doors', 'gate', 'gates')) return 'DOOR';
  if (containsToken(key, 'roof', 'thatch', 'shingle', 'shingles')) return 'ROOF';
  if (containsToken(key, 'wall', 'walls', 'fence', 'fences', 'parapet')) return 'WALL';
  if (containsToken(key, 'pillar', 'column', 'chimney', 'buttress')) return 'COLUMN';
  if (containsToken(key, 'beam', 'rafter', 'joist')) return 'BEAM';
  if (
    containsToken(
      key,
      'fallen',
      'log',
      'logs',
      'pebble',
      'grass',
      'flower',
      'mushroom',
      'fungi',
      'weed',
      'debris',
      'bones'
    )
  ) {
    return 'GROUND_DETAIL';
  }
  if (containsToken(key, 'rock', 'boulder', 'rubble', 'stone', 'ice', 'crystal')) return 'ROCK';
  if (containsToken(key, 'bush', 'shrub', 'undergrowth', 'reed', 'vine')) return 'SHRUB';
  if (containsToken(key, 'tree', 'evergreen', 'willow', 'oak', 'maple', 'yew', 'pine', 'birch', 'fir')) {
    return 'TREE';
  }
  if (containsToken(key, 'table', 'chair', 'stool', 'bed', 'shelf', 'chest', 'barrel', 'desk', 'bench', 'cabinet')) {
    return 'FURNITURE';
  }
  return null;
}

export function classifySceneryKind(entry: WorldLabAssetEntry): SceneryKind {
  const explicitKind = (entry.assetKind ?? 'AUTO').trim().toUpperCase().replace(/-/g, '_') as SceneryKind;
  if (explicitKind !== ('AUTO' as string) && VALID_SCENERY_KINDS.has(explicitKind)) {
    return explicitKind;
  }
  const keyKind = classifyText(entry.key);
  if (keyKind === 'STUMP' || keyKind === 'WINDOW' || keyKind === 'ENTRANCE' || keyKind === 'DOOR') {
    return keyKind;
  }
  const nameKind = classifyText(`${entry.key} ${entry.name}`);
  if (nameKind) return nameKind;
  return keyKind ?? 'GENERIC';
}

export function resolveTileUnitMeters(entry: WorldLabAssetEntry, policy: AssetScalePolicy): number {
  if (policy === 'tile_1_5m') return TILE_SIZE_METERS;
  if (policy === 'metric_1_0m') return 1.0;

  // In Auto D&D mode, architecture, nature, and ANY multi-tile footprint asset
  // lock to the 1.5 m (5 ft) D&D grid; only 1x1 loose props/creatures stay 1.0 m.
  const isMultiTile = entry.nominalWidthTiles > 1 || entry.nominalLengthTiles > 1;
  if (entry.category === 'architecture' || entry.category === 'nature' || isMultiTile) {
    return TILE_SIZE_METERS;
  }
  return 1.0;
}

export function shouldAutoFitAsset(entry: WorldLabAssetEntry): boolean {
  const packLower = entry.pack.toLowerCase();
  const keyLower = entry.key.toLowerCase();
  // Legacy promoted ChunkWorld models always use semantic auto-fit (matches WorldLab isLegacyPromoted).
  if (packLower === 'chunkworld' || keyLower.includes('chunkworld')) {
    return true;
  }
  if (entry.fitFootprint) return false;
  const anchor = (entry.anchor || 'BOUNDS_MIN').toUpperCase();
  if (anchor !== 'BOUNDS_MIN' || Math.abs(entry.unitsPerTile - 1) > 1e-4) {
    return false;
  }
  const desc = `${entry.key} ${entry.name}`.toLowerCase();
  if (containsAny(desc, 'stair', 'ladder', 'bridge', 'ramp', 'floor', 'deck')) {
    return false;
  }
  return true;
}

interface ReferenceDims {
  width: number;
  height: number;
  length: number;
}

function sceneryReference(kind: SceneryKind, w: number, l: number): ReferenceDims {
  const kit = 1.5; // WorldLab standard 192 height units / 128 units per tile
  switch (kind) {
    case 'TREE':
      return {
        width: Math.max(w, 1.25),
        height: 3.6 + 0.35 * Math.max(0, w - 1),
        length: Math.max(l, 1.25),
      };
    case 'ROCK':
      return {
        width: Math.min(w * 0.88, Math.max(0.58, w - 0.12)),
        height: Math.min(1.25, Math.max(0.4, Math.min(w, l) * 0.78)),
        length: Math.min(l * 0.88, Math.max(0.58, l - 0.12)),
      };
    case 'SHRUB':
      return { width: Math.min(w, 0.9), height: 0.88, length: Math.min(l, 0.9) };
    case 'STUMP':
      return { width: Math.min(w, 0.72), height: 0.52, length: Math.min(l, 0.72) };
    case 'GROUND_DETAIL':
      return { width: Math.min(w, 0.6), height: 0.35, length: Math.min(l, 0.6) };
    case 'WALL':
      return { width: Math.min(w, 0.22), height: kit, length: Math.max(0.9, l) };
    case 'ROOF':
      return { width: Math.max(w, 1), height: 0.6, length: Math.max(l, 1) };
    case 'ENTRANCE':
    case 'DOOR':
    case 'WINDOW':
      return { width: Math.max(w, 0.9), height: kit, length: Math.max(l, 0.15) };
    case 'COLUMN':
      return { width: Math.min(w, 0.45), height: kit, length: Math.min(l, 0.45) };
    case 'BEAM':
      return { width: Math.max(w, 0.9), height: 0.2, length: Math.min(l, 0.25) };
    case 'FURNITURE':
      return { width: Math.min(w, 0.88), height: 0.85, length: Math.min(l, 0.88) };
    case 'GENERIC':
    default:
      return {
        width: Math.min(w, 0.88),
        height: Math.max(0.85, Math.min(w, l) * 1.1),
        length: Math.min(l, 0.88),
      };
  }
}

function effectiveReference(
  kind: SceneryKind,
  w: number,
  l: number,
  dWidth: number,
  dLength: number
): ReferenceDims {
  const ref = sceneryReference(kind, w, l);
  let x = ref.width;
  const y = ref.height;
  let z = ref.length;

  const isEdgeModule =
    kind === 'WALL' || kind === 'DOOR' || kind === 'WINDOW' || kind === 'ENTRANCE' || kind === 'BEAM';
  if (isEdgeModule && dWidth > 1e-5 && dLength > 1e-5) {
    const xThin = dWidth <= dLength * 0.6;
    const zThin = dLength <= dWidth * 0.6;
    if (xThin) {
      x = Math.min(w, 0.22);
      z = l;
    } else if (zThin) {
      x = w;
      z = Math.min(l, 0.22);
    }
  }
  return { width: x, height: y, length: z };
}

function fitWithin(
  nativeHorizontal: number,
  nativeHeight: number,
  targetHorizontal: number,
  targetHeight: number
): number {
  const h = nativeHorizontal > 1e-5 ? targetHorizontal / nativeHorizontal : Infinity;
  const v = nativeHeight > 1e-5 ? targetHeight / nativeHeight : Infinity;
  const factor = Math.min(h, v);
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return clamp(factor, 0.02, 80);
}

/**
 * Computes WorldLab-faithful (X, Y, Z) base scales in meters for a loaded GLB model.
 */
export function computeModelBaseScales(
  entry: WorldLabAssetEntry,
  localSize: Vec3Size,
  policy: AssetScalePolicy
): ModelBaseScales {
  const unitsPerTile = Math.max(0.001, entry.unitsPerTile);
  const tileUnits = resolveTileUnitMeters(entry, policy);
  const authored = tileUnits / unitsPerTile;
  const kind = classifySceneryKind(entry);

  const dWidth = Math.max(0, localSize.x) / unitsPerTile;
  const dHeight = Math.max(0, localSize.y) / unitsPerTile;
  const dLength = Math.max(0, localSize.z) / unitsPerTile;
  const dHoriz = Math.max(dWidth, dLength);
  const validBounds = Number.isFinite(dWidth) && Number.isFinite(dHeight) && Number.isFinite(dLength) && dHoriz > 1e-5 && dHeight > 1e-5;

  if (!shouldAutoFitAsset(entry)) {
    if (entry.fitFootprint && validBounds) {
      const w = Math.max(1, entry.nominalWidthTiles);
      const l = Math.max(1, entry.nominalLengthTiles);
      const fitX = clamp(w / Math.max(1e-4, dWidth), 0.25, 8);
      const fitZ = clamp(l / Math.max(1e-4, dLength), 0.25, 8);
      return {
        x: authored * fitX,
        y: authored,
        z: authored * fitZ,
        mode: 'fit_footprint',
        kind,
      };
    }
    return { x: authored, y: authored, z: authored, mode: 'authored', kind };
  }

  if (!validBounds) {
    return { x: authored, y: authored, z: authored, mode: 'authored', kind };
  }

  // Creature / character models use uniform WorldLab actor scaling to preserve proportions
  if (entry.category === 'creature') {
    const text = `${entry.key} ${entry.name}`.toLowerCase();
    let factor: number;
    if (containsToken(text, 'rat', 'mouse', 'mice')) {
      factor = fitWithin(dHoriz, dHeight, 0.42, 0.28);
    } else if (containsAny(text, 'humanoid.small', 'goblin', 'dwarf', 'halfling', 'gnome')) {
      factor = fitWithin(dHoriz, dHeight, 0.78, 1.38);
    } else if (containsAny(text, 'quadruped', 'cow', 'horse', 'deer', 'stag', 'wolf', 'bear', 'boar')) {
      factor = fitWithin(dHoriz, dHeight, 1.35, 1.08);
    } else if (containsAny(text, 'animal', 'creature', 'slime', 'spider')) {
      factor = fitWithin(dHoriz, dHeight, 0.95, 0.9);
    } else {
      factor = fitWithin(dHoriz, dHeight, 0.88, 1.78);
    }
    return {
      x: authored * factor,
      y: authored * factor,
      z: authored * factor,
      mode: 'actor_fit',
      kind,
    };
  }

  const w = Math.max(1, entry.nominalWidthTiles);
  const l = Math.max(1, entry.nominalLengthTiles);
  const target = effectiveReference(kind, w, l, dWidth, dLength);

  // Allow up to 80x for ultra-small cm/mm external exports (e.g. 0.02m poly-pizza assets),
  // matching WorldLab's [0.04, 24] range identically for all standard WorldLab meshes.
  let sx = clamp(target.width / Math.max(1e-5, dWidth), 0.02, 80);
  let sy = clamp(target.height / Math.max(1e-5, dHeight), 0.02, 80);
  let sz = clamp(target.length / Math.max(1e-5, dLength), 0.02, 80);

  const isArchitecture =
    kind === 'WALL' ||
    kind === 'ROOF' ||
    kind === 'ENTRANCE' ||
    kind === 'DOOR' ||
    kind === 'WINDOW' ||
    kind === 'COLUMN' ||
    kind === 'BEAM';

  if (!isArchitecture) {
    const proportional = Math.min(sx, sz);
    sx = proportional;
    sz = proportional;
    if (kind !== 'TREE' && kind !== 'SHRUB') {
      sy = Math.min(sy, proportional);
    }
  }

  return {
    x: authored * sx,
    y: authored * sy,
    z: authored * sz,
    mode: 'auto_fit',
    kind,
  };
}

/** Returns the footprint dimensions after rotating by `rotationDegrees` around +Y. */
export function getRotatedFootprint(
  entry: Pick<WorldLabAssetEntry, 'nominalWidthTiles' | 'nominalLengthTiles'>,
  rotationDegrees: number
): RotatedFootprint {
  const w = Math.max(1, Math.round(entry.nominalWidthTiles));
  const l = Math.max(1, Math.round(entry.nominalLengthTiles));
  const quarterTurns = ((Math.round(rotationDegrees / 90) % 4) + 4) % 4;
  return quarterTurns === 1 || quarterTurns === 3
    ? { widthTiles: l, lengthTiles: w }
    : { widthTiles: w, lengthTiles: l };
}

/**
 * Computes the tile origin (SW corner) and continuous center tile coordinate
 * for a `widthTiles x lengthTiles` footprint hovered at `(tileX, tileZ)`.
 */
export function computeSnappedFootprint(
  tileX: number,
  tileZ: number,
  widthTiles: number,
  lengthTiles: number,
  gridWidth: number,
  gridLength: number
): { startX: number; startZ: number; centerX: number; centerZ: number } {
  const w = Math.max(1, widthTiles);
  const l = Math.max(1, lengthTiles);
  const rawStartX = tileX - Math.floor((w - 1) / 2);
  const rawStartZ = tileZ - Math.floor((l - 1) / 2);
  const startX = Math.max(0, Math.min(Math.max(0, gridWidth - w), rawStartX));
  const startZ = Math.max(0, Math.min(Math.max(0, gridLength - l), rawStartZ));
  return {
    startX,
    startZ,
    centerX: startX + w * 0.5,
    centerZ: startZ + l * 0.5,
  };
}
