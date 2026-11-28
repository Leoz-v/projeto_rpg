import type { MapLayer } from './types';

/**
 * Oclusão por terreno e altura 3D (penhascos, laje entre superfície e interior, aberturas/holes).
 * Módulo puro sem dependências de Node, Electron, React ou PixiJS (nota 0061).
 */

export const HEIGHT_UNITS_PER_TILE = 128;
export const FEET_PER_HEIGHT_UNIT = 5 / HEIGHT_UNITS_PER_TILE;
export const DEFAULT_INTERIOR_DEPTH_FEET = 12;

export interface TerrainHeightfield {
  width: number;
  length: number;
  heights: readonly number[];
  holes: readonly number[];
  interior?: { heights: readonly number[]; holes: readonly number[] } | undefined;
  interiorDepthFeet: number;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function getVertexHeightUnits(heights: readonly number[], width: number, length: number, vx: number, vz: number): number {
  const cx = clamp(vx, 0, width);
  const cz = clamp(vz, 0, length);
  return heights[cz * (width + 1) + cx] ?? 0;
}

/** Altura bilinear do terreno em pés na coordenada contínua `(x, y)` (em células) da camada informada. */
export function sampleHeightFeet(hf: TerrainHeightfield, x: number, y: number, layer: MapLayer = 'surface'): number {
  const heights = layer === 'interior' && hf.interior ? hf.interior.heights : hf.heights;
  const cx = clamp(x, 0, Math.max(0, hf.width - 1e-4));
  const cy = clamp(y, 0, Math.max(0, hf.length - 1e-4));
  const tx = Math.floor(cx);
  const ty = Math.floor(cy);
  const u = cx - tx;
  const v = cy - ty;

  const h00 = getVertexHeightUnits(heights, hf.width, hf.length, tx, ty);
  const h10 = getVertexHeightUnits(heights, hf.width, hf.length, tx + 1, ty);
  const h01 = getVertexHeightUnits(heights, hf.width, hf.length, tx, ty + 1);
  const h11 = getVertexHeightUnits(heights, hf.width, hf.length, tx + 1, ty + 1);

  const south = h00 + (h10 - h00) * u;
  const north = h01 + (h11 - h01) * u;
  const heightFeet = (south + (north - south) * v) * FEET_PER_HEIGHT_UNIT;
  return layer === 'interior' ? heightFeet - hf.interiorDepthFeet : heightFeet;
}

/** Verdadeiro quando o tile da superfície em `(x, y)` é uma abertura (cutout/hole) para o interior. */
export function isSurfaceHole(hf: TerrainHeightfield, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || tx >= hf.width || ty < 0 || ty >= hf.length) return false;
  return (hf.holes[ty * hf.width + tx] ?? 0) !== 0;
}

/**
 * Linha de visão 3D contra relevo e laje entre superfície e interior:
 * - raios entre `surface` e `interior` só atravessam se cruzarem o plano da superfície por uma abertura (`hole`);
 * - na mesma camada, elevações de terreno acima da linha do raio (+0.5 ft de tolerância) bloqueiam.
 */
export function hasTerrainLineOfSight3D(
  hf: TerrainHeightfield,
  from: { x: number; y: number; elevationFeet: number; layer: MapLayer },
  to: { x: number; y: number; elevationFeet: number; layer: MapLayer },
): boolean {
  const fromAlt = sampleHeightFeet(hf, from.x, from.y, from.layer) + from.elevationFeet;
  const toAlt = sampleHeightFeet(hf, to.x, to.y, to.layer) + to.elevationFeet;
  const distCells = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(4, Math.ceil(distCells * 4));

  if (from.layer !== to.layer) {
    let prevDiff = fromAlt - sampleHeightFeet(hf, from.x, from.y, 'surface');
    let crossedThroughSolidGround = false;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = from.x + (to.x - from.x) * t;
      const sy = from.y + (to.y - from.y) * t;
      const rayAlt = fromAlt + (toAlt - fromAlt) * t;
      const surfaceAlt = sampleHeightFeet(hf, sx, sy, 'surface');
      const diff = rayAlt - surfaceAlt;
      if ((prevDiff >= 0 && diff <= 0) || (prevDiff <= 0 && diff >= 0)) {
        if (!isSurfaceHole(hf, sx, sy)) {
          crossedThroughSolidGround = true;
          break;
        }
      }
      prevDiff = diff;
    }
    if (crossedThroughSolidGround) return false;
    return true;
  }

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const sx = from.x + (to.x - from.x) * t;
    const sy = from.y + (to.y - from.y) * t;
    if (from.layer === 'surface' && isSurfaceHole(hf, sx, sy)) continue;
    const rayAlt = fromAlt + (toAlt - fromAlt) * t;
    const groundAlt = sampleHeightFeet(hf, sx, sy, from.layer);
    if (groundAlt > rayAlt + 0.5) return false;
  }
  return true;
}

function isNumberArray(v: unknown, len: number): v is number[] {
  return Array.isArray(v) && v.length === len && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Extrai com segurança o `TerrainHeightfield` de um JSON `VttMapDocument` sem importar `canvas3d`. */
export function extractHeightfieldFromMapDoc(raw: unknown): TerrainHeightfield | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  const terrain = doc['terrain'];
  if (!terrain || typeof terrain !== 'object') return null;
  const t = terrain as Record<string, unknown>;
  const width = typeof t['width'] === 'number' ? Math.round(t['width']) : NaN;
  const length = typeof t['length'] === 'number' ? Math.round(t['length']) : NaN;
  if (!Number.isFinite(width) || !Number.isFinite(length) || width <= 0 || length <= 0) return null;

  const vertCount = (width + 1) * (length + 1);
  const tileCount = width * length;
  if (!isNumberArray(t['heights'], vertCount)) return null;
  const holes = isNumberArray(t['holes'], tileCount) ? t['holes'] : new Array<number>(tileCount).fill(0);

  let interior: { heights: readonly number[]; holes: readonly number[] } | undefined;
  const intRaw = doc['interior'];
  if (intRaw && typeof intRaw === 'object') {
    const ir = intRaw as Record<string, unknown>;
    if (isNumberArray(ir['heights'], vertCount)) {
      interior = {
        heights: ir['heights'],
        holes: isNumberArray(ir['holes'], tileCount) ? ir['holes'] : new Array<number>(tileCount).fill(0),
      };
    }
  }

  const settings = doc['settings'];
  const depthRaw =
    settings && typeof settings === 'object' ? (settings as Record<string, unknown>)['interiorDepthFeet'] : undefined;
  const interiorDepthFeet =
    typeof depthRaw === 'number' && Number.isFinite(depthRaw) ? Math.max(5, Math.min(40, Math.round(depthRaw))) : DEFAULT_INTERIOR_DEPTH_FEET;

  return {
    width,
    length,
    heights: t['heights'],
    holes,
    interior,
    interiorDepthFeet,
  };
}
