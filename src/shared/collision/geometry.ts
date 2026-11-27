import { type MapLayer, type WallSegment, wallBlocksLight, wallBlocksMovement, wallBlocksVision } from './types';

/**
 * Geometria 2D de oclusão e colisão em coordenadas de células do grid (nota 0061).
 * Módulo puro sem dependências de UI, PixiJS, Electron ou Node.
 */

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface SegmentHit {
  readonly t: number;
  readonly u: number;
  readonly x: number;
  readonly y: number;
}

const DEFAULT_EPS = 1e-6;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Interseção paramétrica entre dois segmentos `a1→a2` e `b1→b2`. */
export function segmentIntersectsSegment(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
  eps = DEFAULT_EPS,
): SegmentHit | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;

  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) <= 1e-10) return null;

  const qpx = b1.x - a1.x;
  const qpy = b1.y - a1.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;

  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;

  const tc = clamp01(t);
  const uc = clamp01(u);
  return {
    t: tc,
    u: uc,
    x: a1.x + rx * tc,
    y: a1.y + ry * tc,
  };
}

/** Distância `t` em `[0, maxDist]` onde o raio `origin + dir * t` (`dir` unitário) cruza `seg`, ou `null`. */
export function rayIntersectsSegment(
  origin: Point2D,
  dir: Point2D,
  seg: Pick<WallSegment, 'x1' | 'y1' | 'x2' | 'y2'>,
  maxDist: number,
  eps = DEFAULT_EPS,
): number | null {
  const sx = seg.x2 - seg.x1;
  const sy = seg.y2 - seg.y1;
  const denom = dir.x * sy - dir.y * sx;
  if (Math.abs(denom) <= 1e-10) return null;

  const qpx = seg.x1 - origin.x;
  const qpy = seg.y1 - origin.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * dir.y - qpy * dir.x) / denom;

  if (t < -eps || t > maxDist + eps || u < -eps || u > 1 + eps) return null;
  return Math.max(0, Math.min(maxDist, t));
}

/** Distância euclidiana mínima em células entre o ponto `p` e o segmento `seg`. */
export function pointToSegmentDistance(p: Point2D, seg: Pick<WallSegment, 'x1' | 'y1' | 'x2' | 'y2'>): number {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return Math.hypot(p.x - seg.x1, p.y - seg.y1);
  const t = clamp01(((p.x - seg.x1) * dx + (p.y - seg.y1) * dy) / lenSq);
  return Math.hypot(p.x - (seg.x1 + dx * t), p.y - (seg.y1 + dy * t));
}

/**
 * Linha de visão 2D (ou propagação de luz) entre `from` e `to`:
 * - `wall` e `door` fechada bloqueiam imediatamente;
 * - `terrain_wall` permite ver a face (1 cruzamento), bloqueando apenas ao atravessar para o outro lado (>= 2 cruzamentos distintos).
 */
export function hasLineOfSight2D(
  from: Point2D,
  to: Point2D,
  walls: readonly WallSegment[],
  options?: { layer?: MapLayer; mode?: 'vision' | 'light' },
): boolean {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-5) return true;
  const layer = options?.layer ?? 'surface';
  const mode = options?.mode ?? 'vision';
  const terrainHits: number[] = [];

  for (const w of walls) {
    if (w.layer !== layer) continue;
    const blocks = mode === 'light' ? wallBlocksLight(w) : wallBlocksVision(w);
    if (!blocks) continue;
    const hit = segmentIntersectsSegment(from, to, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
    if (!hit || hit.t <= 1e-4 || hit.t >= 1 - 1e-4) continue;
    if (w.kind !== 'terrain_wall') return false;
    if (!terrainHits.some((prev) => Math.abs(prev - hit.t) < 1e-3)) {
      terrainHits.push(hit.t);
      if (terrainHits.length >= 2) return false;
    }
  }
  return true;
}

/** Primeiro segmento que bloqueia o movimento de um token de `fromCenter` até `toCenter`, ou `null`. */
export function isMovementBlocked(
  fromCenter: Point2D,
  toCenter: Point2D,
  walls: readonly WallSegment[],
  layer: MapLayer = 'surface',
): WallSegment | null {
  if (Math.hypot(toCenter.x - fromCenter.x, toCenter.y - fromCenter.y) < 1e-5) return null;
  for (const w of walls) {
    if (w.layer !== layer || !wallBlocksMovement(w)) continue;
    const hit = segmentIntersectsSegment(fromCenter, toCenter, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
    if (hit && hit.t > 1e-4 && hit.t <= 1 - 1e-4) {
      return w;
    }
  }
  return null;
}

function normalizeAngleRad(rad: number): number {
  const twoPi = Math.PI * 2;
  const mod = rad % twoPi;
  return mod < 0 ? mod + twoPi : mod;
}

function castVisibilityDistance(
  origin: Point2D,
  dir: Point2D,
  maxRadius: number,
  walls: readonly WallSegment[],
): number {
  let best = maxRadius;
  const terrainHits: number[] = [];

  for (const w of walls) {
    const t = rayIntersectsSegment(origin, dir, w, best);
    if (t === null || t <= 1e-4) continue;
    if (w.kind !== 'terrain_wall') {
      if (t < best) best = t;
    } else if (!terrainHits.some((prev) => Math.abs(prev - t) < 1e-3)) {
      terrainHits.push(t);
    }
  }

  if (terrainHits.length >= 2) {
    terrainHits.sort((a, b) => a - b);
    const second = terrainHits[1];
    if (second !== undefined && second < best) best = second;
  }
  return best;
}

/**
 * Calcula o polígono de visibilidade/iluminação 2D em torno de `origin`,
 * suportando círculo completo (`360°`) ou cone direcional (`angleDeg < 360` centrado em `directionDeg`).
 */
export function computeVisibilityPolygon(
  origin: Point2D,
  maxRadiusCells: number,
  walls: readonly WallSegment[],
  options?: {
    layer?: MapLayer;
    mode?: 'vision' | 'light';
    bounds?: { width: number; height: number };
    circleSegments?: number;
    angleDeg?: number;
    directionDeg?: number;
  },
): Point2D[] {
  if (maxRadiusCells <= 0) return [];
  const layer = options?.layer ?? 'surface';
  const mode = options?.mode ?? 'vision';
  const circleSegments = Math.max(12, options?.circleSegments ?? 64);
  const angleDeg = Math.max(1, Math.min(360, options?.angleDeg ?? 360));
  const isCone = angleDeg < 359.9;
  const halfConeRad = ((angleDeg * 0.5) * Math.PI) / 180;
  const dirRad = normalizeAngleRad(((options?.directionDeg ?? 0) * Math.PI) / 180);

  const activeWalls: WallSegment[] = walls.filter((w) => {
    if (w.layer !== layer) return false;
    const blocks = mode === 'light' ? wallBlocksLight(w) : wallBlocksVision(w);
    if (!blocks) return false;
    return pointToSegmentDistance(origin, w) <= maxRadiusCells + 0.05;
  });

  if (options?.bounds) {
    const { width, height } = options.bounds;
    const boundary = (x1: number, y1: number, x2: number, y2: number): WallSegment => ({
      id: '00000000-0000-4000-8000-000000000000',
      x1,
      y1,
      x2,
      y2,
      kind: 'wall',
      open: false,
      locked: false,
      layer,
      source: 'manual',
    });
    activeWalls.push(
      boundary(0, 0, width, 0),
      boundary(width, 0, width, height),
      boundary(width, height, 0, height),
      boundary(0, height, 0, 0),
    );
  }

  const startAngle = isCone ? dirRad - halfConeRad : 0;
  const sweep = isCone ? halfConeRad * 2 : Math.PI * 2;
  const inArc = (rel: number): boolean => !isCone || (rel >= -1e-6 && rel <= sweep + 1e-6);

  const angles: number[] = [];
  const pushAngle = (raw: number): void => {
    const rel = normalizeAngleRad(raw - startAngle);
    if (inArc(rel)) angles.push(rel);
  };

  const arcSteps = isCone ? Math.max(8, Math.ceil((circleSegments * angleDeg) / 360)) : circleSegments;
  for (let i = 0; i <= arcSteps; i++) {
    if (!isCone && i === arcSteps) continue;
    angles.push((sweep * i) / arcSteps);
  }

  for (const w of activeWalls) {
    for (const pt of [
      { x: w.x1, y: w.y1 },
      { x: w.x2, y: w.y2 },
    ]) {
      const dx = pt.x - origin.x;
      const dy = pt.y - origin.y;
      if (dx * dx + dy * dy > (maxRadiusCells + 1) * (maxRadiusCells + 1)) continue;
      const a = Math.atan2(dy, dx);
      pushAngle(a - 1e-4);
      pushAngle(a);
      pushAngle(a + 1e-4);
    }
  }

  angles.sort((a, b) => a - b);

  // Deduplica ângulos quase idênticos mantendo ordem angular crescente.
  const deduped: number[] = [];
  for (const a of angles) {
    const last = deduped[deduped.length - 1];
    if (last === undefined || a - last > 1e-5) deduped.push(a);
  }

  const pts: Point2D[] = [];
  if (isCone) pts.push({ x: origin.x, y: origin.y });

  for (const rel of deduped) {
    const angle = startAngle + rel;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const dist = castVisibilityDistance(origin, dir, maxRadiusCells, activeWalls);
    pts.push({ x: origin.x + dir.x * dist, y: origin.y + dir.y * dist });
  }
  return pts;
}
