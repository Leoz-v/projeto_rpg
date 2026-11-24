/**
 * Exact TypeScript port of WorldLab's TerrainAutoTilerShapeFitter.java.
 *
 * Evaluates all 12 classic RS2 OverlayShapes across 4 rotations (48 candidates)
 * against WorldLab's 37 topology probes (16 boundary, center, 4 quarters,
 * 16 eighth-offset interior probes that distinguish Fans from Diagonals),
 * and runs multi-pass shared-edge harmonization to eliminate mismatched seams.
 */

import { getShapeById, type TileShapeGeometry } from '../terrain/tileSurface';

export interface TopologyProbe {
  readonly u: number;
  readonly v: number;
  readonly weight: number;
  readonly boundary: boolean;
}

export interface ShapeFit {
  readonly shape: number;
  readonly rotation: number;
  readonly error: number;
}

interface ShapeCandidate {
  readonly shape: number;
  readonly rotation: number;
  readonly coverage: readonly boolean[];
  readonly overlayTriangles: number;
  /** 4-bit quarter-edge masks: [0: West, 1: East, 2: South, 3: North] */
  readonly edges: readonly [number, number, number, number];
}

interface CandidateCost {
  readonly total: number;
  readonly boundary: number;
  readonly interior: number;
  readonly spill: number;
}

export const OVERLAY_SHAPE_FULL = 1;
export const OVERLAY_SHAPE_TRAPEZOID = 6;
const SCORE_EPSILON = 1e-9;
const CENTER_PROBE_INDEX = 16;
const SHARED_EDGE_PENALTY = 140;
const MAX_EDGE_PASSES = 8;
const EDGE_INSET = 0.0001;

/**
 * Exact 37 topology probes from TerrainAutoTilerShapeFitter.TOPOLOGY_PROBES.
 */
export const TOPOLOGY_PROBES: readonly TopologyProbe[] = [
  // 16 boundary probes (corners + quarter + midpoint along all 4 edges)
  { u: 0, v: 0, weight: 7, boundary: true },
  { u: 0.25, v: 0, weight: 4, boundary: true },
  { u: 0.5, v: 0, weight: 5, boundary: true },
  { u: 0.75, v: 0, weight: 4, boundary: true },
  { u: 1, v: 0, weight: 7, boundary: true },

  { u: 1, v: 0.25, weight: 4, boundary: true },
  { u: 1, v: 0.5, weight: 5, boundary: true },
  { u: 1, v: 0.75, weight: 4, boundary: true },
  { u: 1, v: 1, weight: 7, boundary: true },

  { u: 0.75, v: 1, weight: 4, boundary: true },
  { u: 0.5, v: 1, weight: 5, boundary: true },
  { u: 0.25, v: 1, weight: 4, boundary: true },
  { u: 0, v: 1, weight: 7, boundary: true },

  { u: 0, v: 0.75, weight: 4, boundary: true },
  { u: 0, v: 0.5, weight: 5, boundary: true },
  { u: 0, v: 0.25, weight: 4, boundary: true },

  // Index 16: center probe
  { u: 0.5, v: 0.5, weight: 8, boundary: false },
  // 4 quarter probes
  { u: 0.25, v: 0.25, weight: 3, boundary: false },
  { u: 0.75, v: 0.25, weight: 3, boundary: false },
  { u: 0.75, v: 0.75, weight: 3, boundary: false },
  { u: 0.25, v: 0.75, weight: 3, boundary: false },

  // 16 eighth-offset interior probes (distinguish FAN_BIG from DIAGONAL)
  { u: 0.125, v: 0.125, weight: 2, boundary: false },
  { u: 0.125, v: 0.375, weight: 2, boundary: false },
  { u: 0.125, v: 0.625, weight: 2, boundary: false },
  { u: 0.125, v: 0.875, weight: 2, boundary: false },
  { u: 0.375, v: 0.125, weight: 2, boundary: false },
  { u: 0.375, v: 0.375, weight: 2, boundary: false },
  { u: 0.375, v: 0.625, weight: 2, boundary: false },
  { u: 0.375, v: 0.875, weight: 2, boundary: false },
  { u: 0.625, v: 0.125, weight: 2, boundary: false },
  { u: 0.625, v: 0.375, weight: 2, boundary: false },
  { u: 0.625, v: 0.625, weight: 2, boundary: false },
  { u: 0.625, v: 0.875, weight: 2, boundary: false },
  { u: 0.875, v: 0.125, weight: 2, boundary: false },
  { u: 0.875, v: 0.375, weight: 2, boundary: false },
  { u: 0.875, v: 0.625, weight: 2, boundary: false },
  { u: 0.875, v: 0.875, weight: 2, boundary: false },
];

export function shapeContainsOverlayPoint(shape: TileShapeGeometry, u: number, v: number): boolean {
  for (const tri of shape.triangles) {
    if (!tri.overlay) continue;
    const a = shape.vertices[tri.a]!;
    const b = shape.vertices[tri.b]!;
    const c = shape.vertices[tri.c]!;
    const e0 = (u - a.u) * (b.v - a.v) - (v - a.v) * (b.u - a.u);
    const e1 = (u - b.u) * (c.v - b.v) - (v - b.v) * (c.u - b.u);
    const e2 = (u - c.u) * (a.v - c.v) - (v - c.v) * (a.u - c.u);
    if ((e0 >= -1e-6 && e1 >= -1e-6 && e2 >= -1e-6) || (e0 <= 1e-6 && e1 <= 1e-6 && e2 <= 1e-6)) {
      return true;
    }
  }
  return false;
}

function computeEdgeMasks(surface: TileShapeGeometry): [number, number, number, number] {
  const edges: [number, number, number, number] = [0, 0, 0, 0];
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 4; i++) {
      const offset = (i * 2 + 1) * 0.125;
      const u = side === 0 ? EDGE_INSET : side === 1 ? 1 - EDGE_INSET : offset;
      const v = side === 2 ? EDGE_INSET : side === 3 ? 1 - EDGE_INSET : offset;
      if (shapeContainsOverlayPoint(surface, u, v)) {
        edges[side]! |= 1 << i;
      }
    }
  }
  return edges;
}

function popcount4(bits: number): number {
  let n = bits & 0xf;
  let c = 0;
  while (n !== 0) {
    c += n & 1;
    n >>= 1;
  }
  return c;
}

const EMPTY_CANDIDATE: ShapeCandidate = {
  shape: 0,
  rotation: 0,
  coverage: TOPOLOGY_PROBES.map(() => false),
  overlayTriangles: 0,
  edges: [0, 0, 0, 0],
};

const SHAPE_CANDIDATES: readonly ShapeCandidate[] = (() => {
  const out: ShapeCandidate[] = [];
  for (let shapeId = 1; shapeId <= 12; shapeId++) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const surface = getShapeById(shapeId, rotation);
      const coverage = TOPOLOGY_PROBES.map((p) => shapeContainsOverlayPoint(surface, p.u, p.v));
      let overlayTriangles = 0;
      for (const t of surface.triangles) {
        if (t.overlay) overlayTriangles++;
      }
      out.push({
        shape: shapeId,
        rotation,
        coverage,
        overlayTriangles,
        edges: computeEdgeMasks(surface),
      });
    }
  }
  return out;
})();

function candidateFor(shape: number, rotation: number): ShapeCandidate | null {
  if (shape === 0) return EMPTY_CANDIDATE;
  if (shape < 1 || shape > 12) return null;
  const idx = (shape - 1) * 4 + (rotation & 3);
  return SHAPE_CANDIDATES[idx] ?? null;
}

/**
 * Prevents the edge harmonizer from ever flipping a tile 180° backwards into empty space
 * just to dodge a shared-edge penalty. Any non-empty candidate must substantially overlap
 * the tile's actual target-positive probes.
 */
function hasMeaningfulTargetOverlap(target: readonly boolean[], cand: ShapeCandidate): boolean {
  if (cand.shape === 0) return true;
  let targetPos = 0;
  let candPos = 0;
  let overlap = 0;
  for (let i = 0; i < target.length; i++) {
    if (target[i]) targetPos++;
    if (cand.coverage[i]) {
      candPos++;
      if (target[i]) overlap++;
    }
  }
  if (targetPos === 0) return false;
  return overlap >= Math.min(targetPos, candPos) * 0.5;
}

function compareScore(a: number, b: number): number {
  if (Math.abs(a - b) <= SCORE_EPSILON) return 0;
  return a < b ? -1 : 1;
}

function computeCandidateCost(
  target: readonly boolean[],
  candidate: ShapeCandidate,
  spillCost: number,
  boundaryScale: number
): CandidateCost {
  let boundary = 0;
  let interior = 0;
  let spill = 0;
  for (let i = 0; i < target.length; i++) {
    const actual = candidate.coverage[i]!;
    if (actual === target[i]) continue;
    const probe = TOPOLOGY_PROBES[i]!;
    let penalty = probe.weight;
    if (actual) {
      penalty *= spillCost;
      spill += probe.weight;
    }
    if (probe.boundary) boundary += penalty;
    else interior += penalty;
  }
  return {
    total: boundary * boundaryScale + interior,
    boundary,
    interior,
    spill,
  };
}

function isBetterCandidate(
  cand: ShapeCandidate,
  score: number,
  boundary: number,
  interior: number,
  spill: number,
  best: ShapeCandidate | null,
  bestScore: number,
  bestBoundary: number,
  bestInterior: number,
  bestSpill: number
): boolean {
  if (!best) return true;
  let cmp = compareScore(score, bestScore);
  if (cmp !== 0) return cmp < 0;
  cmp = compareScore(boundary, bestBoundary);
  if (cmp !== 0) return cmp < 0;
  cmp = compareScore(interior, bestInterior);
  if (cmp !== 0) return cmp < 0;
  if (spill !== bestSpill) return spill < bestSpill;
  if (cand.overlayTriangles !== best.overlayTriangles) return cand.overlayTriangles < best.overlayTriangles;
  if (cand.shape !== best.shape) return cand.shape < best.shape;
  return cand.rotation < best.rotation;
}

export function sampleMaskProbes(x: number, z: number, contains: (wx: number, wz: number) => boolean): boolean[] {
  return TOPOLOGY_PROBES.map((p) => contains(x + p.u, z + p.v));
}

export function fitTopology(
  target: readonly boolean[],
  spillCost: number,
  lockCenter = false,
  boundaryScale = 16,
  excludeTrapezoid = false,
  allowEmpty = false
): ShapeFit {
  let any = false;
  let all = true;
  for (const v of target) {
    if (v) any = true;
    else all = false;
  }
  if (!any) return { shape: 0, rotation: 0, error: 0 };
  if (all) return { shape: OVERLAY_SHAPE_FULL, rotation: 0, error: 0 };

  let best: ShapeCandidate | null = null;
  let bestScore = Infinity;
  let bestBoundary = Infinity;
  let bestInterior = Infinity;
  let bestSpill = Infinity;

  const pool = allowEmpty ? [EMPTY_CANDIDATE, ...SHAPE_CANDIDATES] : SHAPE_CANDIDATES;

  for (const cand of pool) {
    if (excludeTrapezoid && cand.shape === OVERLAY_SHAPE_TRAPEZOID) {
      continue;
    }
    if (lockCenter && cand.coverage[CENTER_PROBE_INDEX] !== target[CENTER_PROBE_INDEX]) {
      continue;
    }
    if (cand.shape !== 0 && !hasMeaningfulTargetOverlap(target, cand)) {
      continue;
    }
    const cost = computeCandidateCost(target, cand, spillCost, boundaryScale);
    if (
      isBetterCandidate(
        cand,
        cost.total,
        cost.boundary,
        cost.interior,
        cost.spill,
        best,
        bestScore,
        bestBoundary,
        bestInterior,
        bestSpill
      )
    ) {
      best = cand;
      bestScore = cost.total;
      bestBoundary = cost.boundary;
      bestInterior = cost.interior;
      bestSpill = cost.spill;
    }
  }

  if (!best || best.shape === 0) {
    return { shape: 0, rotation: 0, error: 0 };
  }
  return { shape: best.shape, rotation: best.rotation, error: bestScore };
}

export function tileCoordKey(x: number, z: number): string {
  return `${x},${z}`;
}

export function parseTileCoordKey(key: string): [number, number] {
  const comma = key.indexOf(',');
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

function neighborMismatchCount(
  key: string,
  cand: ShapeCandidate,
  neighbors: readonly [string, string, string, string],
  chosen: ReadonlyMap<string, ShapeCandidate>,
  materials: ReadonlyMap<string, number>
): number {
  const mat = materials.get(key);
  if (!mat) return 0;
  let mismatch = 0;
  for (let side = 0; side < 4; side++) {
    const nextKey = neighbors[side]!;
    if (materials.get(nextKey) !== mat) continue;
    const other = chosen.get(nextKey);
    if (!other || other.shape === 0) continue;
    mismatch += popcount4(cand.edges[side]! ^ other.edges[side ^ 1]!);
  }
  return mismatch;
}

/**
 * Relaxes shared quarter-edges between adjacent tiles of the SAME overlay material.
 * Tiles present in `starting` but NOT in `targets` act as fixed boundary constraints
 * (manual locks & outer ring tiles). Already-FULL tiles stay FULL.
 *
 * Includes an overlap guard and optional EMPTY (shape=0) fallback so fringe tiles
 * never flip 180° backwards into empty space to dodge an edge penalty.
 */
export function harmonizeShapes(
  targets: ReadonlyMap<string, readonly boolean[]>,
  starting: ReadonlyMap<string, ShapeFit>,
  materials: ReadonlyMap<string, number>,
  spillCost: number,
  boundaryScale = 8,
  options: {
    excludeTrapezoid?: boolean;
    allowEmptyKeys?: ReadonlySet<string>;
  } = {}
): Map<string, ShapeFit> {
  const excludeTrapezoid = options.excludeTrapezoid ?? false;
  const allowEmptyKeys = options.allowEmptyKeys;

  const chosen = new Map<string, ShapeCandidate>();
  for (const [k, fit] of starting) {
    const cand = candidateFor(fit.shape, fit.rotation);
    if (cand) chosen.set(k, cand);
  }

  const keys = Array.from(targets.keys()).sort((a, b) => {
    const [ax, az] = parseTileCoordKey(a);
    const [bx, bz] = parseTileCoordKey(b);
    return az !== bz ? az - bz : ax - bx;
  });

  const neighborMap = new Map<string, [string, string, string, string]>();
  for (const k of keys) {
    const [x, z] = parseTileCoordKey(k);
    neighborMap.set(k, [
      tileCoordKey(x - 1, z), // 0: West
      tileCoordKey(x + 1, z), // 1: East
      tileCoordKey(x, z - 1), // 2: South
      tileCoordKey(x, z + 1), // 3: North
    ]);
  }

  // Fast path: return immediately if no shared-edge mismatch exists
  let hasMismatch = false;
  for (const k of keys) {
    const cand = chosen.get(k);
    if (!cand || cand.shape === 0) continue;
    if (neighborMismatchCount(k, cand, neighborMap.get(k)!, chosen, materials) > 0) {
      hasMismatch = true;
      break;
    }
  }
  if (!hasMismatch) {
    const stable = new Map<string, ShapeFit>();
    for (const k of keys) {
      const s = starting.get(k);
      if (s) stable.set(k, s);
    }
    return stable;
  }

  const activeCandidates = excludeTrapezoid
    ? SHAPE_CANDIDATES.filter((c) => c.shape !== OVERLAY_SHAPE_TRAPEZOID)
    : SHAPE_CANDIDATES;

  // Precompute unary costs & valid overlap masks once per editable tile
  const unaryCosts = new Map<string, CandidateCost[]>();
  const emptyCosts = new Map<string, CandidateCost>();
  const validMasks = new Map<string, boolean[]>();
  for (const k of keys) {
    const target = targets.get(k)!;
    unaryCosts.set(
      k,
      activeCandidates.map((cand) => computeCandidateCost(target, cand, spillCost, boundaryScale))
    );
    emptyCosts.set(k, computeCandidateCost(target, EMPTY_CANDIDATE, spillCost, boundaryScale));
    validMasks.set(
      k,
      activeCandidates.map((cand) => hasMeaningfulTargetOverlap(target, cand))
    );
  }

  const ordered = [...keys];
  for (let pass = 0; pass < MAX_EDGE_PASSES; pass++) {
    let changed = false;
    if (pass !== 0) ordered.reverse();

    for (const k of ordered) {
      const prev = chosen.get(k);
      if (!prev || prev.shape === OVERLAY_SHAPE_FULL) continue;
      const unary = unaryCosts.get(k)!;
      const valid = validMasks.get(k)!;
      const neighbors = neighborMap.get(k)!;

      let best: ShapeCandidate | null = null;
      let bestScore = Infinity;
      let bestBoundary = Infinity;
      let bestInterior = Infinity;
      let bestSpill = Infinity;

      // Allow non-seed fringe tiles to cleanly dissolve to empty (0) rather than forming broken stubs
      if (allowEmptyKeys?.has(k)) {
        const eCost = emptyCosts.get(k)!;
        const eTotal = eCost.total + SHARED_EDGE_PENALTY * neighborMismatchCount(k, EMPTY_CANDIDATE, neighbors, chosen, materials);
        best = EMPTY_CANDIDATE;
        bestScore = eTotal;
        bestBoundary = eCost.boundary;
        bestInterior = eCost.interior;
        bestSpill = eCost.spill;
      }

      for (let i = 0; i < activeCandidates.length; i++) {
        if (!valid[i]) continue;
        const cand = activeCandidates[i]!;
        const cost = unary[i]!;
        const total = cost.total + SHARED_EDGE_PENALTY * neighborMismatchCount(k, cand, neighbors, chosen, materials);
        if (
          isBetterCandidate(
            cand,
            total,
            cost.boundary,
            cost.interior,
            cost.spill,
            best,
            bestScore,
            bestBoundary,
            bestInterior,
            bestSpill
          )
        ) {
          best = cand;
          bestScore = total;
          bestBoundary = cost.boundary;
          bestInterior = cost.interior;
          bestSpill = cost.spill;
        }
      }

      if (best && best !== prev) {
        chosen.set(k, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const result = new Map<string, ShapeFit>();
  for (const k of keys) {
    const cand = chosen.get(k);
    const target = targets.get(k);
    if (cand && target) {
      result.set(k, {
        shape: cand.shape,
        rotation: cand.rotation,
        error: computeCandidateCost(target, cand, spillCost, boundaryScale).total,
      });
    }
  }
  return result;
}

/** Counts quarter-edge mismatches between two adjacent tiles (for tests & verification). */
export function countEdgeMismatch(first: ShapeFit, second: ShapeFit, eastWest: boolean): number {
  const a = candidateFor(first.shape, first.rotation);
  const b = candidateFor(second.shape, second.rotation);
  if (!a || !b) return 0;
  const side = eastWest ? 1 : 3;
  return popcount4(a.edges[side] ^ b.edges[side ^ 1]!);
}
