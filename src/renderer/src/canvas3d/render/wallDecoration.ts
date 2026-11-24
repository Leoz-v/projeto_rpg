/**
 * WorldLab RS2 Wall-Decoration placement & mounting system (ported from WallDecorationPlacement.java)
 * adapted to D&D 5ft / 1.5m tiles.
 *
 * Supports:
 *  - Snapping wall-mounted fixtures (wall_torch, wall_cresset, castle_banner, sun_pennon,
 *    fish_trade_sign, bracketed_canopy, wall pipes) directly onto the nearest face of an
 *    already-placed wall/tower/passage OR onto any tile edge (N/S/E/W) or diagonal wall.
 *  - Canonical WorldLab wall-decoration modes:
 *      - straight_offset (WALLDECOR_STRAIGHT_OFFSET: outward by supporting wall thickness)
 *      - straight_no_offset (WALLDECOR_STRAIGHT_NOOFFSET: flush on tile edge)
 *      - diagonal_offset (WALLDECOR_DIAGONAL_OFFSET: +53/128, -53/128, +45 deg)
 *      - diagonal_no_offset (WALLDECOR_DIAGONAL_NOOFFSET: -45/128, +45/128, +225 deg)
 *  - Preserving authored Y mount heights (e.g. wall_torch minY=0.67, wall_cresset minY=1.14)
 *    instead of slamming wall fixtures down onto the floor.
 */

import { TILE_SIZE_METERS } from '../terrain/constants';
import type { WorldLabAssetEntry } from './modelScalePolicy';

export type WallDecorMode =
  | 'straight_offset'
  | 'straight_no_offset'
  | 'diagonal_offset'
  | 'diagonal_no_offset';

export interface WallSupportCandidate {
  readonly id: string;
  readonly entry: WorldLabAssetEntry;
  readonly tileX: number;
  readonly tileZ: number;
  readonly rotationDegrees: number;
  readonly worldHalfX: number;
  readonly worldHalfZ: number;
}

export interface WallSnapResult {
  readonly tileX: number;
  readonly tileZ: number;
  readonly rotationDegrees: number;
  readonly edgeTileX: number;
  readonly edgeTileZ: number;
  readonly wallSide: 'N' | 'S' | 'E' | 'W' | 'DIAG';
  readonly attachedToPropId: string | null;
  readonly wallOffsetTiles: number;
  /** Visual preview segment in tile coordinates along the snapped wall face. */
  readonly edgeStart: { readonly x: number; readonly z: number };
  readonly edgeEnd: { readonly x: number; readonly z: number };
}

/** Exact WorldLab WallDecorationPlacement.java constants in tile units (128 units = 1 tile). */
export const DEFAULT_WALL_WIDTH_TILES = 16 / 128; // 0.125 tiles (~0.1875 m)
export const DIAGONAL_PRIMARY_TILES = 53 / 128;
export const DIAGONAL_SECONDARY_TILES = 45 / 128;

export function isWallDecorEntry(entry: WorldLabAssetEntry | null | undefined): boolean {
  if (!entry) return false;
  if (entry.placementRole === 'wall_decor') return true;
  const text = `${entry.key} ${entry.name}`.toLowerCase();
  return /wall_torch|wall_cresset|castle_banner|sun_pennon|forktower_pennon|fish_trade_sign|bracketed_canopy|sheared_wall_pipe|socketed_wall_pipe|shutter|wall_lantern|wall_banner/.test(
    text
  );
}

export function preservesAuthoredMountHeight(entry: WorldLabAssetEntry | null | undefined): boolean {
  if (!entry) return false;
  if ((entry.anchor || '').toUpperCase() !== 'AUTHORED') return false;
  if (entry.placementRole === 'wall_decor' || entry.placementRole === 'elevated') return true;
  if (isWallDecorEntry(entry)) return true;
  // Ceiling-mounted & stalactite-hanging cave roofs have their slab datum at y = 0 with stalactites
  // hanging into negative Y (e.g. pendant_roof minY=-0.70, ceiling_teeth minY=-1.17). Preserve y = 0!
  const text = `${entry.key} ${entry.name}`.toLowerCase();
  if (/pendant_roof|open_chimney_roof|ceiling_teeth|flowstone_drapery/.test(text)) return true;
  // Recessed Blackbeck modular sewer races, culverts, penstocks, grates, and paving slabs author
  // their walkable curb/floor datum at y = 0 with stone canal troughs descending into negative Y.
  if (
    /straight_race|scoured_race|silted_race|branch_race|quarter_bend|four_way_race|blind_sump|culvert_headwall|penstock|set_paving|heaved_paving|lifting_flag|inspection_grille|torn_inspection_grille|shaft_collar|shaft_lid/.test(
      text
    )
  ) {
    return true;
  }
  return typeof entry.rawMinY === 'number' && entry.rawMinY > 0.2;
}

export function isWallSupportEntry(entry: WorldLabAssetEntry): boolean {
  if (isWallDecorEntry(entry)) return false;
  if (entry.category !== 'architecture') return false;
  const text = `${entry.key} ${entry.name}`.toLowerCase();
  return /wall|curtain|tower|drum|passage|gate|buttress|bay|arch|pillar|column|pier|vault|recess|keep|return|chamber|corner|footing|roundhouse|storey|chimney/.test(
    text
  );
}

/**
 * Computes WorldLab's canonical local wall-decoration offset and yaw adjustment
 * for a cardinal wall rotation (0=South, 1=East, 2=North, 3=West).
 */
export function resolveCanonicalWallDecorPose(
  mode: WallDecorMode,
  cardinalRotation: number,
  supportWidthTiles = DEFAULT_WALL_WIDTH_TILES
): { offsetX: number; offsetZ: number; yawOffsetDegrees: number } {
  const rot = ((cardinalRotation % 4) + 4) % 4;
  let lx = 0;
  let lz = 0;
  let yawOffset = 0;

  switch (mode) {
    case 'straight_no_offset':
      lx = 0;
      lz = 0;
      yawOffset = 0;
      break;
    case 'straight_offset':
      lx = 0;
      lz = supportWidthTiles;
      yawOffset = 0;
      break;
    case 'diagonal_offset':
      lx = DIAGONAL_PRIMARY_TILES;
      lz = -DIAGONAL_PRIMARY_TILES;
      yawOffset = 45;
      break;
    case 'diagonal_no_offset':
      lx = -DIAGONAL_SECONDARY_TILES;
      lz = DIAGONAL_SECONDARY_TILES;
      yawOffset = 225;
      break;
  }

  // Rotate (lx, lz) by cardinal rotation (0=0°, 1=90°, 2=180°, 3=270°)
  let ox = lx;
  let oz = lz;
  if (rot === 1) {
    ox = lz;
    oz = -lx;
  } else if (rot === 2) {
    ox = -lx;
    oz = -lz;
  } else if (rot === 3) {
    ox = -lz;
    oz = lx;
  }
  return { offsetX: ox, offsetZ: oz, yawOffsetDegrees: yawOffset };
}

/**
 * Snaps a cursor pick onto the nearest supporting wall face (if a wall/tower/passage
 * is nearby) or onto the nearest tile edge / diagonal wall in WorldLab fashion.
 *
 * Wall decorations authored in WorldLab have their mounting backplate at local Z = 0
 * and protrude toward local +Z:
 *   - yaw = 0°   -> protrudes +Z (South face)
 *   - yaw = 90°  -> protrudes +X (East face)
 *   - yaw = 180° -> protrudes -Z (North face)
 *   - yaw = 270° -> protrudes -X (West face)
 */
export function resolveWallSnap(
  tileX: number,
  tileZ: number,
  tileFloatX: number,
  tileFloatZ: number,
  mode: WallDecorMode,
  supports: readonly WallSupportCandidate[],
  extraOffsetTiles = 0
): WallSnapResult {
  // 1. Check nearby placed wall/tower/structure faces first for flush mounting!
  if (mode === 'straight_offset' || mode === 'straight_no_offset') {
    let bestDist = 0.85; // tiles
    let bestResult: WallSnapResult | null = null;
    const faceClearance = mode === 'straight_offset' ? 0.04 + extraOffsetTiles : extraOffsetTiles;

    for (const s of supports) {
      if (!isWallSupportEntry(s.entry)) continue;
      // Approximate axis-aligned half-extents in tile coordinates after rotation
      const rad = (s.rotationDegrees * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const halfTilesX = Math.max(0.1, (s.worldHalfX * cos + s.worldHalfZ * sin) / TILE_SIZE_METERS);
      const halfTilesZ = Math.max(0.1, (s.worldHalfX * sin + s.worldHalfZ * cos) / TILE_SIZE_METERS);

      // Quick reject if cursor is far outside bounding box + 0.85 tile reach
      if (
        Math.abs(tileFloatX - s.tileX) > halfTilesX + 0.9 ||
        Math.abs(tileFloatZ - s.tileZ) > halfTilesZ + 0.9
      ) {
        continue;
      }

      const clampX = Math.max(s.tileX - halfTilesX + 0.15, Math.min(s.tileX + halfTilesX - 0.15, tileFloatX));
      const clampZ = Math.max(s.tileZ - halfTilesZ + 0.15, Math.min(s.tileZ + halfTilesZ - 0.15, tileFloatZ));

      const faces: readonly {
        side: 'N' | 'S' | 'E' | 'W';
        fx: number;
        fz: number;
        nx: number;
        nz: number;
        yaw: number;
        start: { x: number; z: number };
        end: { x: number; z: number };
      }[] = [
        {
          side: 'S',
          fx: clampX,
          fz: s.tileZ + halfTilesZ,
          nx: 0,
          nz: 1,
          yaw: 0,
          start: { x: s.tileX - halfTilesX, z: s.tileZ + halfTilesZ },
          end: { x: s.tileX + halfTilesX, z: s.tileZ + halfTilesZ },
        },
        {
          side: 'N',
          fx: clampX,
          fz: s.tileZ - halfTilesZ,
          nx: 0,
          nz: -1,
          yaw: 180,
          start: { x: s.tileX - halfTilesX, z: s.tileZ - halfTilesZ },
          end: { x: s.tileX + halfTilesX, z: s.tileZ - halfTilesZ },
        },
        {
          side: 'E',
          fx: s.tileX + halfTilesX,
          fz: clampZ,
          nx: 1,
          nz: 0,
          yaw: 90,
          start: { x: s.tileX + halfTilesX, z: s.tileZ - halfTilesZ },
          end: { x: s.tileX + halfTilesX, z: s.tileZ + halfTilesZ },
        },
        {
          side: 'W',
          fx: s.tileX - halfTilesX,
          fz: clampZ,
          nx: -1,
          nz: 0,
          yaw: 270,
          start: { x: s.tileX - halfTilesX, z: s.tileZ - halfTilesZ },
          end: { x: s.tileX - halfTilesX, z: s.tileZ + halfTilesZ },
        },
      ];

      for (const f of faces) {
        const d = Math.hypot(tileFloatX - f.fx, tileFloatZ - f.fz);
        if (d < bestDist) {
          bestDist = d;
          bestResult = {
            tileX: f.fx + f.nx * faceClearance,
            tileZ: f.fz + f.nz * faceClearance,
            rotationDegrees: f.yaw,
            edgeTileX: tileX,
            edgeTileZ: tileZ,
            wallSide: f.side,
            attachedToPropId: s.id,
            wallOffsetTiles: faceClearance,
            edgeStart: f.start,
            edgeEnd: f.end,
          };
        }
      }
    }

    if (bestResult) return bestResult;
  }

  // 2. Fallback: snap cleanly to the nearest edge (or diagonal) of the hovered tile!
  const u = tileFloatX - tileX; // 0..1 within tile
  const v = tileFloatZ - tileZ; // 0..1 within tile

  if (mode === 'diagonal_offset' || mode === 'diagonal_no_offset') {
    const diagRot = u + v >= 1 ? 0 : 2;
    const pose = resolveCanonicalWallDecorPose(mode, diagRot);
    return {
      tileX: tileX + 0.5 + pose.offsetX,
      tileZ: tileZ + 0.5 + pose.offsetZ,
      rotationDegrees: (diagRot * 90 + pose.yawOffsetDegrees) % 360,
      edgeTileX: tileX,
      edgeTileZ: tileZ,
      wallSide: 'DIAG',
      attachedToPropId: null,
      wallOffsetTiles: Math.hypot(pose.offsetX, pose.offsetZ),
      edgeStart: { x: tileX, z: tileZ },
      edgeEnd: { x: tileX + 1, z: tileZ + 1 },
    };
  }

  // Pick nearest of the 4 tile edges and point decoration inward across the tile
  const dNorth = v; // z = tileZ (edge at North/-Z side of tile, facing +Z = 0°)
  const dSouth = 1 - v; // z = tileZ + 1 (edge at South/+Z side, facing -Z = 180°)
  const dWest = u; // x = tileX (edge at West/-X side, facing +X = 90°)
  const dEast = 1 - u; // x = tileX + 1 (edge at East/+X side, facing -X = 270°)
  const minD = Math.min(dNorth, dSouth, dWest, dEast);
  const offset = (mode === 'straight_offset' ? DEFAULT_WALL_WIDTH_TILES : 0) + extraOffsetTiles;

  if (minD === dNorth) {
    return {
      tileX: tileX + 0.5,
      tileZ: tileZ + offset,
      rotationDegrees: 0,
      edgeTileX: tileX,
      edgeTileZ: tileZ,
      wallSide: 'N',
      attachedToPropId: null,
      wallOffsetTiles: offset,
      edgeStart: { x: tileX, z: tileZ },
      edgeEnd: { x: tileX + 1, z: tileZ },
    };
  }
  if (minD === dSouth) {
    return {
      tileX: tileX + 0.5,
      tileZ: tileZ + 1 - offset,
      rotationDegrees: 180,
      edgeTileX: tileX,
      edgeTileZ: tileZ,
      wallSide: 'S',
      attachedToPropId: null,
      wallOffsetTiles: offset,
      edgeStart: { x: tileX, z: tileZ + 1 },
      edgeEnd: { x: tileX + 1, z: tileZ + 1 },
    };
  }
  if (minD === dWest) {
    return {
      tileX: tileX + offset,
      tileZ: tileZ + 0.5,
      rotationDegrees: 90,
      edgeTileX: tileX,
      edgeTileZ: tileZ,
      wallSide: 'W',
      attachedToPropId: null,
      wallOffsetTiles: offset,
      edgeStart: { x: tileX, z: tileZ },
      edgeEnd: { x: tileX, z: tileZ + 1 },
    };
  }
  return {
    tileX: tileX + 1 - offset,
    tileZ: tileZ + 0.5,
    rotationDegrees: 270,
    edgeTileX: tileX,
    edgeTileZ: tileZ,
    wallSide: 'E',
    attachedToPropId: null,
    wallOffsetTiles: offset,
    edgeStart: { x: tileX + 1, z: tileZ },
    edgeEnd: { x: tileX + 1, z: tileZ + 1 },
  };
}
