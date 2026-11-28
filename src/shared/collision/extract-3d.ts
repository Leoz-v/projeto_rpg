import { MAX_MAP_WALLS } from '../protocol/constants';
import { extractHeightfieldFromMapDoc } from './heightfield';
import type { MapLayer, WallKind, WallSegment } from './types';

/**
 * Extrator puro de paredes, portas, janelas e penhascos a partir do JSON de um mapa 3D (`VttMapDocument`),
 * sem dependências de Node, PixiJS ou `canvas3d` (nota 0081).
 */

interface RawSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: WallKind;
  open: boolean;
  locked: boolean;
  layer: MapLayer;
  heightFeet?: number;
  source: 'baked_3d';
}

function deterministicUuid(index: number): string {
  const hex = Math.max(0, Math.floor(index)).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function isDecorOrNonWall(lowerKey: string): boolean {
  if (
    /wall_torch|wall_cresset|wall_lantern|wall_banner|castle_banner|pennon|sign|canopy|pipe|shutter|standing_torch|torch|brazier|lantern|lamp|campfire|hearth|fireplace/.test(
      lowerKey,
    )
  ) {
    return true;
  }
  if (
    /floor|slab|paving|flag|board|deck|stair|ramp|ladder|bridge|footbridge|race|sump|collar|lid|table|chair|stool|bench|bed|crate|barrel|chest|shelf|cabinet|tree|pine|oak|birch|willow|bush|shrub|rock|boulder|stump|log|mushroom|fungi|grass|flower|cave_mouth/.test(
      lowerKey,
    )
  ) {
    return true;
  }
  return false;
}

function classifyPropKind(lowerKey: string): 'door' | 'window' | 'pillar' | 'wall' | null {
  if (isDecorOrNonWall(lowerKey)) return null;
  if (/doorway|archway|door_opening|open_arch/.test(lowerKey)) return null;
  if (/door|gate|penstock|grille|hatch/.test(lowerKey)) return 'door';
  if (/window|casement/.test(lowerKey)) return 'window';
  if (/pillar|column|pier|buttress/.test(lowerKey)) return 'pillar';
  if (/wall|curtain|parapet|headwall|retaining|spring_line|diagonal_bay|lime_bay|return|recess|keep|tower|drum|chamber/.test(lowerKey)) {
    return 'wall';
  }
  return null;
}

function propWidthTiles(lowerKey: string): number {
  const dim = /(?:^|[_.-])(\d+)x(\d+)(?:$|[_.-])/.exec(lowerKey);
  if (dim?.[1]) {
    const w = Number(dim[1]);
    if (w >= 1 && w <= 16) return w;
  }
  if (/retaining_wall|spring_line_wall|curtain_wall|culvert_headwall|burial_recess|diagonal_bay|lime_bay/.test(lowerKey)) {
    return 2;
  }
  return 1;
}

function mergeCollinearSegments(segments: readonly RawSegment[]): RawSegment[] {
  const groups = new Map<string, RawSegment[]>();
  for (const seg of segments) {
    const k = `${seg.layer}|${seg.kind}|${seg.open ? '1' : '0'}|${seg.locked ? '1' : '0'}|${seg.source}`;
    const list = groups.get(k);
    if (list) list.push(seg);
    else groups.set(k, [seg]);
  }

  const out: RawSegment[] = [];
  for (const list of groups.values()) {
    interface LineSeg {
      ux: number;
      uy: number;
      nx: number;
      ny: number;
      d: number;
      minP: number;
      maxP: number;
      sample: RawSegment;
    }

    const lines: LineSeg[] = [];
    for (const s of list) {
      let dx = s.x2 - s.x1;
      let dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      if (dx < -1e-5 || (Math.abs(dx) <= 1e-5 && dy < 0)) {
        dx = -dx;
        dy = -dy;
      }
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const d = s.x1 * nx + s.y1 * ny;
      const p1 = s.x1 * ux + s.y1 * uy;
      const p2 = s.x2 * ux + s.y2 * uy;
      lines.push({
        ux,
        uy,
        nx,
        ny,
        d,
        minP: Math.min(p1, p2),
        maxP: Math.max(p1, p2),
        sample: s,
      });
    }

    const merged: LineSeg[] = [];
    // Ordena por direção e projeção para fundir sequencialmente.
    lines.sort((a, b) => a.d - b.d || a.minP - b.minP);

    for (const seg of lines) {
      let joined = false;
      for (const m of merged) {
        const cross = Math.abs(m.ux * seg.uy - m.uy * seg.ux);
        if (cross > 0.015) continue;
        const dot = m.ux * seg.ux + m.uy * seg.uy;
        if (dot < 0.99) continue;
        const perpDist = Math.abs(m.d - seg.d);
        if (perpDist > 0.08) continue;
        if (seg.maxP < m.minP - 0.12 || seg.minP > m.maxP + 0.12) continue;

        m.minP = Math.min(m.minP, seg.minP);
        m.maxP = Math.max(m.maxP, seg.maxP);
        joined = true;
        break;
      }
      if (!joined) merged.push({ ...seg });
    }

    for (const m of merged) {
      const cx = m.nx * m.d;
      const cy = m.ny * m.d;
      out.push({
        ...m.sample,
        x1: roundCoord(cx + m.ux * m.minP),
        y1: roundCoord(cy + m.uy * m.minP),
        x2: roundCoord(cx + m.ux * m.maxP),
        y2: roundCoord(cy + m.uy * m.maxP),
      });
    }
  }
  return out;
}

const CLIFF_THRESHOLD_UNITS = 192; // 7.5 ft de desnível entre tiles adjacentes

function extractTerrainCliffWalls(
  heights: readonly number[],
  holes: readonly number[],
  width: number,
  length: number,
  layer: MapLayer,
): RawSegment[] {
  const avgHeight = (tx: number, tz: number): number => {
    const stride = width + 1;
    return (
      ((heights[tz * stride + tx] ?? 0) +
        (heights[tz * stride + tx + 1] ?? 0) +
        (heights[(tz + 1) * stride + tx] ?? 0) +
        (heights[(tz + 1) * stride + tx + 1] ?? 0)) *
      0.25
    );
  };
  const isHole = (tx: number, tz: number): boolean => (holes[tz * width + tx] ?? 0) !== 0;

  const segs: RawSegment[] = [];
  for (let tz = 0; tz < length; tz++) {
    for (let tx = 0; tx < width; tx++) {
      if (isHole(tx, tz)) continue;
      const h = avgHeight(tx, tz);
      if (tx + 1 < width && !isHole(tx + 1, tz)) {
        const he = avgHeight(tx + 1, tz);
        if (Math.abs(h - he) >= CLIFF_THRESHOLD_UNITS) {
          segs.push({ x1: tx + 1, y1: tz, x2: tx + 1, y2: tz + 1, kind: 'terrain_wall', open: false, locked: false, layer, source: 'baked_3d' });
        }
      }
      if (tz + 1 < length && !isHole(tx, tz + 1)) {
        const hs = avgHeight(tx, tz + 1);
        if (Math.abs(h - hs) >= CLIFF_THRESHOLD_UNITS) {
          segs.push({ x1: tx, y1: tz + 1, x2: tx + 1, y2: tz + 1, kind: 'terrain_wall', open: false, locked: false, layer, source: 'baked_3d' });
        }
      }
    }
  }
  return segs;
}

/**
 * Extrai segmentos iniciais de colisão e oclusão (`source: 'baked_3d'`) a partir de um
 * documento 3D (`VttMapDocument`), combinando paredes colineares e respeitando `MAX_MAP_WALLS`.
 */
export function extractWallsFrom3dMapDocument(raw: unknown, newId?: () => string): WallSegment[] {
  const hf = extractHeightfieldFromMapDoc(raw);
  if (!hf) return [];

  const doc = raw as Record<string, unknown>;
  const propsRaw = Array.isArray(doc['props']) ? doc['props'] : [];
  const rawSegments: RawSegment[] = [];

  for (const item of propsRaw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (typeof p['key'] !== 'string' || p['roofLayer'] === true) continue;
    const lowerKey = p['key'].toLowerCase();
    const kind = classifyPropKind(lowerKey);
    if (!kind) continue;

    const tileX = typeof p['tileX'] === 'number' && Number.isFinite(p['tileX']) ? p['tileX'] : 0;
    const tileZ = typeof p['tileZ'] === 'number' && Number.isFinite(p['tileZ']) ? p['tileZ'] : 0;
    const rotationDegrees = typeof p['rotationDegrees'] === 'number' && Number.isFinite(p['rotationDegrees']) ? p['rotationDegrees'] : 0;
    const scaleX = typeof p['scaleX'] === 'number' && Number.isFinite(p['scaleX']) ? Math.max(0.1, Math.min(8, p['scaleX'])) : 1;
    const scaleZ = typeof p['scaleZ'] === 'number' && Number.isFinite(p['scaleZ']) ? Math.max(0.1, Math.min(8, p['scaleZ'])) : 1;
    const layer: MapLayer = p['layer'] === 'interior' ? 'interior' : 'surface';

    const rad = (rotationDegrees * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);

    if (kind === 'pillar') {
      const half = 0.22 * Math.max(scaleX, scaleZ);
      rawSegments.push(
        {
          x1: clamp(tileX - half, 0, hf.width),
          y1: clamp(tileZ, 0, hf.length),
          x2: clamp(tileX + half, 0, hf.width),
          y2: clamp(tileZ, 0, hf.length),
          kind: 'wall',
          open: false,
          locked: false,
          layer,
          source: 'baked_3d',
        },
        {
          x1: clamp(tileX, 0, hf.width),
          y1: clamp(tileZ - half, 0, hf.length),
          x2: clamp(tileX, 0, hf.width),
          y2: clamp(tileZ + half, 0, hf.length),
          kind: 'wall',
          open: false,
          locked: false,
          layer,
          source: 'baked_3d',
        },
      );
      continue;
    }

    const span = propWidthTiles(lowerKey) * scaleX;
    const half = span * 0.5;
    const x1 = clamp(tileX - ux * half, 0, hf.width);
    const y1 = clamp(tileZ - uy * half, 0, hf.length);
    const x2 = clamp(tileX + ux * half, 0, hf.width);
    const y2 = clamp(tileZ + uy * half, 0, hf.length);
    if (Math.hypot(x2 - x1, y2 - y1) < 0.05) continue;

    rawSegments.push({
      x1,
      y1,
      x2,
      y2,
      kind,
      open: false,
      locked: false,
      layer,
      source: 'baked_3d',
    });
  }

  rawSegments.push(...extractTerrainCliffWalls(hf.heights, hf.holes, hf.width, hf.length, 'surface'));
  if (hf.interior) {
    rawSegments.push(...extractTerrainCliffWalls(hf.interior.heights, hf.interior.holes, hf.width, hf.length, 'interior'));
  }

  const merged = mergeCollinearSegments(rawSegments);
  const limited = merged.slice(0, MAX_MAP_WALLS);
  return limited.map((s, idx) => ({
    id: newId ? newId() : deterministicUuid(idx + 1),
    x1: clamp(s.x1, 0, hf.width),
    y1: clamp(s.y1, 0, hf.length),
    x2: clamp(s.x2, 0, hf.width),
    y2: clamp(s.y2, 0, hf.length),
    kind: s.kind,
    open: s.open,
    locked: s.locked,
    layer: s.layer,
    source: s.source,
  }));
}
