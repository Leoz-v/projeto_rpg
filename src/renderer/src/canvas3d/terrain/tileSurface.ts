/**
 * Exact TypeScript port of WorldLab's TileSurface.java (RS2 shaped-tile catalog).
 *
 * Shapes 0..12 match WorldLab's stable OverlayShape IDs mapped to classic RS2 geometry.
 * Shapes 13..27 represent quarter-sector coverage masks (1..15).
 *
 * Coordinate convention:
 *   u in [0, 1] along +X (West -> East)
 *   v in [0, 1] along +Z (South -> North)
 *   Corner order for weights: SW (0,0), SE (1,0), NW (0,1), NE (1,1).
 *
 * Note on winding for @pixi/3d (right-handed Y-up, CCW front faces viewed from +Y):
 *   When viewed from +Y looking down -Y, +X is right and +Z is down.
 *   A triangle (a, b, c) with cross(b - a, c - a).y > 0 faces +Y!
 *   We normalize triangle winding at build time so every triangle faces +Y cleanly.
 */

export const OVERLAY_SHAPE_NAMES = [
  'None',
  'Full',
  'Diagonal',
  'Half',
  'Corner Small',
  'Corner Big',
  'Trapezoid',
  'Left Semi-Diag Small',
  'Right Semi-Diag Small',
  'Left Semi-Diag Big',
  'Right Semi-Diag Big',
  'Fan Small',
  'Fan Big',
] as const;

export const FIRST_CLIPPED_SHAPE_ID = 13;
export const LAST_CLIPPED_SHAPE_ID = 27;

export interface TileVertexSpec {
  readonly u: number;
  readonly v: number;
  readonly code: number;
}

export interface CornerWeights {
  readonly sw: number;
  readonly se: number;
  readonly nw: number;
  readonly ne: number;
}

export interface ShapeTriangle {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly overlay: boolean;
}

export interface TileShapeGeometry {
  readonly vertices: readonly TileVertexSpec[];
  readonly triangles: readonly ShapeTriangle[];
}

const RS_SHAPE_FOR_ID: readonly number[] = [
  0, // 0: no overlay
  1, // 1: FULL
  2, // 2: DIAGONAL
  7, // 3: HALF
  8, // 4: CORNER_SMALL
  9, // 5: CORNER_BIG
  12, // 6: TRAPEZOID
  3, // 7: LEFT_SEMI_DIAGONAL_SMALL
  4, // 8: RIGHT_SEMI_DIAGONAL_SMALL
  5, // 9: LEFT_SEMI_DIAGONAL_BIG
  6, // 10: RIGHT_SEMI_DIAGONAL_BIG
  10, // 11: FAN_SMALL
  11, // 12: FAN_BIG
];

const SHAPE_POINTS: readonly (readonly number[])[] = [
  [1, 3, 5, 7],
  [1, 3, 5, 7],
  [1, 3, 5, 7],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 2, 6],
  [1, 3, 5, 7, 2, 8],
  [1, 3, 5, 7, 2, 8],
  [1, 3, 5, 7, 11, 12],
  [1, 3, 5, 7, 11, 12],
  [1, 3, 5, 7, 13, 14],
];

const SHAPE_PATHS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 0, 0, 1, 3],
  [1, 1, 2, 3, 1, 0, 1, 3],
  [0, 1, 2, 3, 1, 0, 1, 3],
  [0, 0, 1, 2, 0, 0, 2, 4, 1, 0, 4, 3],
  [0, 0, 1, 4, 0, 0, 4, 3, 1, 1, 2, 4],
  [0, 0, 4, 3, 1, 0, 1, 2, 1, 0, 2, 4],
  [0, 1, 2, 4, 1, 0, 1, 4, 1, 0, 4, 3],
  [0, 4, 1, 2, 0, 4, 2, 5, 1, 0, 4, 5, 1, 0, 5, 3],
  [0, 4, 1, 2, 0, 4, 2, 3, 0, 4, 3, 5, 1, 0, 4, 5],
  [0, 0, 4, 5, 1, 4, 1, 2, 1, 4, 2, 3, 1, 4, 3, 5],
  [0, 0, 1, 5, 0, 1, 4, 5, 0, 1, 2, 4, 1, 0, 5, 3, 1, 5, 4, 3, 1, 4, 2, 3],
  [1, 0, 1, 5, 1, 1, 4, 5, 1, 1, 2, 4, 0, 0, 5, 3, 0, 5, 4, 3, 0, 4, 2, 3],
  [1, 0, 5, 4, 1, 0, 1, 5, 0, 0, 4, 3, 0, 4, 5, 3, 0, 5, 2, 3, 0, 1, 2, 5],
];

function vertexFromCode(code: number): TileVertexSpec {
  switch (code) {
    case 1:
      return { u: 0, v: 0, code };
    case 2:
      return { u: 0.5, v: 0, code };
    case 3:
      return { u: 1, v: 0, code };
    case 4:
      return { u: 1, v: 0.5, code };
    case 5:
      return { u: 1, v: 1, code };
    case 6:
      return { u: 0.5, v: 1, code };
    case 7:
      return { u: 0, v: 1, code };
    case 8:
      return { u: 0, v: 0.5, code };
    case 9:
      return { u: 0.5, v: 0.25, code };
    case 10:
      return { u: 0.75, v: 0.5, code };
    case 11:
      return { u: 0.5, v: 0.75, code };
    case 12:
      return { u: 0.25, v: 0.5, code };
    case 13:
      return { u: 0.25, v: 0.25, code };
    case 14:
      return { u: 0.75, v: 0.25, code };
    case 15:
      return { u: 0.75, v: 0.75, code };
    case 16:
      return { u: 0.25, v: 0.75, code };
    case 17:
      return { u: 0.5, v: 0.5, code };
    default:
      throw new Error(`Unknown RS2 tile vertex code: ${code}`);
  }
}

export function cornerWeightsForCode(code: number): CornerWeights {
  switch (code) {
    case 1:
    case 13:
      return { sw: 1, se: 0, nw: 0, ne: 0 };
    case 2:
    case 9:
      return { sw: 0.5, se: 0.5, nw: 0, ne: 0 };
    case 3:
    case 14:
      return { sw: 0, se: 1, nw: 0, ne: 0 };
    case 4:
    case 10:
      return { sw: 0, se: 0.5, nw: 0, ne: 0.5 };
    case 5:
    case 15:
      return { sw: 0, se: 0, nw: 0, ne: 1 };
    case 6:
    case 11:
      return { sw: 0, se: 0, nw: 0.5, ne: 0.5 };
    case 7:
    case 16:
      return { sw: 0, se: 0, nw: 1, ne: 0 };
    case 8:
    case 12:
      return { sw: 0.5, se: 0, nw: 0.5, ne: 0 };
    case 17:
      return { sw: 0.25, se: 0.25, nw: 0.25, ne: 0.25 };
    default:
      throw new Error(`Unknown RS2 tile vertex code: ${code}`);
  }
}

export function blendCornerValues(w: CornerWeights, sw: number, se: number, nw: number, ne: number): number {
  return w.sw * sw + w.se * se + w.nw * nw + w.ne * ne;
}

/**
 * Exact RS2 shaped-tile height rule from TileSurface.height().
 * Interior quarter points inherit their associated corner rather than bilinear height.
 */
export function shapedVertexHeight(code: number, sw: number, se: number, nw: number, ne: number): number {
  switch (code) {
    case 1:
    case 13:
      return sw;
    case 2:
    case 9:
      return (sw + se) * 0.5;
    case 3:
    case 14:
      return se;
    case 4:
    case 10:
      return (se + ne) * 0.5;
    case 5:
    case 15:
      return ne;
    case 6:
    case 11:
      return (ne + nw) * 0.5;
    case 7:
    case 16:
      return nw;
    case 8:
    case 12:
      return (nw + sw) * 0.5;
    case 17:
      return (sw + se + ne + nw) * 0.25;
    default:
      throw new Error(`Unknown RS2 tile vertex code: ${code}`);
  }
}

function rotatePointCode(code: number, rotation: number): number {
  if ((code & 1) === 0 && code <= 8) {
    return ((code - rotation - rotation - 1) & 7) + 1;
  }
  if (code > 8 && code <= 12) {
    return ((code - rotation - 9) & 3) + 9;
  }
  if (code > 12 && code <= 16) {
    return ((code - rotation - 13) & 3) + 13;
  }
  return code;
}

function rotateCornerIndex(index: number, rotation: number): number {
  return index < 4 ? (index - rotation) & 3 : index;
}

function rotateQuarterMask(mask: number, rotation: number): number {
  let out = 0;
  for (let side = 0; side < 4; side++) {
    if ((mask & (1 << side)) !== 0) {
      out |= 1 << ((side - rotation + 4) & 3);
    }
  }
  return out;
}

/**
 * Ensure counter-clockwise winding when viewed from +Y (right-handed Y-up:
 * cross((b-a), (c-a)).y = (b.z - a.z)*(c.x - a.x) - (b.x - a.x)*(c.z - a.z) > 0).
 */
function ensureUpwardTriangle(
  vertices: readonly TileVertexSpec[],
  a: number,
  b: number,
  c: number,
  overlay: boolean
): ShapeTriangle {
  const va = vertices[a]!;
  const vb = vertices[b]!;
  const vc = vertices[c]!;
  const ny = (vb.v - va.v) * (vc.u - va.u) - (vb.u - va.u) * (vc.v - va.v);
  if (ny < 0) {
    return { a, b: c, c: b, overlay };
  }
  return { a, b, c, overlay };
}

function buildRsShape(rsShape: number, rotation: number): TileShapeGeometry {
  const pointCodes = SHAPE_POINTS[rsShape]!;
  const vertices: TileVertexSpec[] = pointCodes.map((orig) => vertexFromCode(rotatePointCode(orig, rotation)));
  const paths = SHAPE_PATHS[rsShape]!;
  const triangles: ShapeTriangle[] = [];
  for (let i = 0; i < paths.length; i += 4) {
    const overlay = paths[i]! !== 0;
    const a = rotateCornerIndex(paths[i + 1]!, rotation);
    const b = rotateCornerIndex(paths[i + 2]!, rotation);
    const c = rotateCornerIndex(paths[i + 3]!, rotation);
    triangles.push(ensureUpwardTriangle(vertices, a, b, c, overlay));
  }
  return { vertices, triangles };
}

function buildQuarterCoverage(mask: number): TileShapeGeometry {
  const vertices: TileVertexSpec[] = [
    vertexFromCode(1),
    vertexFromCode(3),
    vertexFromCode(5),
    vertexFromCode(7),
    vertexFromCode(17),
  ];
  const sectors: readonly [number, number, number][] = [
    [0, 4, 3],
    [3, 4, 2],
    [1, 2, 4],
    [0, 1, 4],
  ];
  const triangles: ShapeTriangle[] = [];
  for (let side = 0; side < 4; side++) {
    const [a, b, c] = sectors[side]!;
    triangles.push(ensureUpwardTriangle(vertices, a, b, c, (mask & (1 << side)) !== 0));
  }
  return { vertices, triangles };
}

const SHAPES: TileShapeGeometry[][] = [];

for (let id = 0; id <= 12; id++) {
  const rsShape = RS_SHAPE_FOR_ID[id]!;
  const rotations: TileShapeGeometry[] = [];
  for (let rot = 0; rot < 4; rot++) {
    rotations.push(buildRsShape(rsShape, rot));
  }
  SHAPES[id] = rotations;
}

for (let mask = 1; mask <= 15; mask++) {
  const rotations: TileShapeGeometry[] = [];
  for (let rot = 0; rot < 4; rot++) {
    rotations.push(buildQuarterCoverage(rotateQuarterMask(mask, rot)));
  }
  SHAPES[FIRST_CLIPPED_SHAPE_ID + mask - 1] = rotations;
}

export function getTileShape(overlayId: number, overlayShape: number, overlayRotation: number): TileShapeGeometry {
  if (overlayId === 0 || overlayShape <= 0) {
    return SHAPES[0]![0]!;
  }
  const clampedShape = Math.max(1, Math.min(LAST_CLIPPED_SHAPE_ID, overlayShape));
  const clampedRot = overlayRotation & 3;
  return SHAPES[clampedShape]![clampedRot]!;
}

export function getShapeById(shapeId: number, rotation: number): TileShapeGeometry {
  const clampedShape = Math.max(0, Math.min(LAST_CLIPPED_SHAPE_ID, shapeId));
  return SHAPES[clampedShape]![rotation & 3]!;
}
