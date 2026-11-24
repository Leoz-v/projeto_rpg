/**
 * Authoritative tile + vertex heightfield grid for the D&D 3D map.
 *
 * Mirrors WorldLab's Plane + Tile data model:
 *   - heights: Int16Array of size (width + 1) * (length + 1), stored in WorldLab internal height units
 *     (128 units = 1 tile = 1.5 m = 5 ft).
 *   - tiles: width * length tiles, storing underlayId, overlayId, overlayShape, overlayRotation,
 *     plus WorldLab persistent auto-tiling state (autoMetadata, autoBaseUnderlayId).
 *   - Chunk dirty tracking (8x8 tile chunks) with 5-tile RS2 underlay blend margin.
 */

import {
  CHUNK_SIZE,
  DEFAULT_MAP_SIZE,
  MAX_HEIGHT_UNITS,
  MIN_HEIGHT_UNITS,
  RS2_BLEND_MAX_OFFSET,
  RS2_BLEND_MIN_OFFSET,
} from './constants';
import { DEFAULT_UNDERLAY_ID } from './materials';

/** Exact WorldLab Tile.java persistent auto-authoring bit contract. */
export const TILE_AUTO_SEED = 1;
export const TILE_AUTO_GENERATED = 2;
export const TILE_MANUAL_LOCK = 4;
export const TILE_AUTO_UNDERLAY_OVERRIDE = 8;

export interface TileData {
  underlayId: number;
  overlayId: number;
  overlayShape: number;
  overlayRotation: number;
  autoMetadata: number;
  autoBaseUnderlayId: number;
}

export interface TerrainSnapshot {
  width: number;
  length: number;
  heights: number[];
  underlays: number[];
  overlays: number[];
  shapes: number[];
  rotations: number[];
  autoMetadata: number[];
  autoBaseUnderlays: number[];
  /** Optional per-tile cutout / hole flags (0 = solid, 1 = cutout hole). */
  holes?: number[];
  /** Optional per-vertex shadow / ambient occlusion paint (0 = unshaded, 255 = deep shadow). */
  vertexShade?: number[];
}

export class TerrainGrid {
  readonly width: number;
  readonly length: number;
  readonly chunksX: number;
  readonly chunksZ: number;

  /** Vertex heights: (width + 1) * (length + 1), indexed as vz * (width + 1) + vx */
  readonly heights: Int16Array;

  /** Per-vertex painted shadow / AO darkening: (width + 1) * (length + 1), 0 = none, 255 = max dark */
  readonly vertexShade: Uint8Array;

  /** Tile layers: width * length, indexed as tz * width + tx */
  readonly underlayIds: Int16Array;
  readonly overlayIds: Int16Array;
  readonly overlayShapes: Uint8Array;
  readonly overlayRotations: Uint8Array;
  readonly autoMetadata: Uint8Array;
  readonly autoBaseUnderlayIds: Int16Array;
  /** Per-tile cutout / hole mask: 0 = solid terrain, 1 = cutout (skip mesh & grid lines) */
  readonly holes: Uint8Array;

  /** Per-chunk dirty flags: chunksZ * chunksX */
  readonly dirtyChunks: Uint8Array;

  constructor(width = DEFAULT_MAP_SIZE, length = DEFAULT_MAP_SIZE) {
    this.width = width;
    this.length = length;
    this.chunksX = Math.ceil(width / CHUNK_SIZE);
    this.chunksZ = Math.ceil(length / CHUNK_SIZE);

    const tileCount = width * length;
    const vertCount = (width + 1) * (length + 1);
    this.heights = new Int16Array(vertCount);
    this.vertexShade = new Uint8Array(vertCount);
    this.underlayIds = new Int16Array(tileCount);
    this.overlayIds = new Int16Array(tileCount);
    this.overlayShapes = new Uint8Array(tileCount);
    this.overlayRotations = new Uint8Array(tileCount);
    this.autoMetadata = new Uint8Array(tileCount);
    this.autoBaseUnderlayIds = new Int16Array(tileCount);
    this.holes = new Uint8Array(tileCount);
    this.dirtyChunks = new Uint8Array(this.chunksX * this.chunksZ);

    this.underlayIds.fill(DEFAULT_UNDERLAY_ID);
    this.markAllDirty();
  }

  vertexIndex(vx: number, vz: number): number {
    return vz * (this.width + 1) + vx;
  }

  tileIndex(tx: number, tz: number): number {
    return tz * this.width + tx;
  }

  inVertexBounds(vx: number, vz: number): boolean {
    return vx >= 0 && vx <= this.width && vz >= 0 && vz <= this.length;
  }

  inTileBounds(tx: number, tz: number): boolean {
    return tx >= 0 && tx < this.width && tz >= 0 && tz < this.length;
  }

  getHeight(vx: number, vz: number): number {
    const cx = Math.max(0, Math.min(this.width, vx));
    const cz = Math.max(0, Math.min(this.length, vz));
    return this.heights[this.vertexIndex(cx, cz)] ?? 0;
  }

  setHeight(vx: number, vz: number, value: number): boolean {
    if (!this.inVertexBounds(vx, vz)) return false;
    const clamped = Math.max(MIN_HEIGHT_UNITS, Math.min(MAX_HEIGHT_UNITS, Math.round(value)));
    const idx = this.vertexIndex(vx, vz);
    if (this.heights[idx] === clamped) return false;
    this.heights[idx] = clamped;
    this.markTileRangeDirty(vx - 2, vz - 2, vx + 1, vz + 1);
    return true;
  }

  /** Returns normalized vertex shadow/AO darkening in [0..1] (0 = fully lit, 1 = deepest shadow). */
  getVertexShade(vx: number, vz: number): number {
    const cx = Math.max(0, Math.min(this.width, vx));
    const cz = Math.max(0, Math.min(this.length, vz));
    return (this.vertexShade[this.vertexIndex(cx, cz)] ?? 0) / 255;
  }

  /** Returns raw byte vertex shadow/AO in [0..255]. */
  getVertexShadeByte(vx: number, vz: number): number {
    const cx = Math.max(0, Math.min(this.width, vx));
    const cz = Math.max(0, Math.min(this.length, vz));
    return this.vertexShade[this.vertexIndex(cx, cz)] ?? 0;
  }

  setVertexShade(vx: number, vz: number, shade01: number): boolean {
    const clamped = Math.max(0, Math.min(1, shade01));
    return this.setVertexShadeByte(vx, vz, Math.round(clamped * 255));
  }

  setVertexShadeByte(vx: number, vz: number, value: number): boolean {
    if (!this.inVertexBounds(vx, vz)) return false;
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    const idx = this.vertexIndex(vx, vz);
    if (this.vertexShade[idx] === clamped) return false;
    this.vertexShade[idx] = clamped;
    this.markTileRangeDirty(vx - 1, vz - 1, vx, vz);
    return true;
  }

  /** Returns true when tile (tx, tz) is punched out as a terrain cutout / cave hole. */
  isHole(tx: number, tz: number): boolean {
    if (!this.inTileBounds(tx, tz)) return false;
    return (this.holes[this.tileIndex(tx, tz)] ?? 0) !== 0;
  }

  setHole(tx: number, tz: number, cutout: boolean): boolean {
    if (!this.inTileBounds(tx, tz)) return false;
    const idx = this.tileIndex(tx, tz);
    const next = cutout ? 1 : 0;
    if (this.holes[idx] === next) return false;
    this.holes[idx] = next;
    this.markTileRangeDirty(tx - 1, tz - 1, tx + 1, tz + 1);
    return true;
  }

  countHoles(): number {
    let count = 0;
    for (let i = 0; i < this.holes.length; i++) {
      if (this.holes[i] !== 0) count++;
    }
    return count;
  }

  /** Bilinear height sample at continuous tile coordinates (x, z) in [0..width], [0..length]. */
  sampleHeightAtTileCoord(x: number, z: number): number {
    const cx = Math.max(0, Math.min(this.width - 1e-4, x));
    const cz = Math.max(0, Math.min(this.length - 1e-4, z));
    const tx = Math.floor(cx);
    const tz = Math.floor(cz);
    const u = cx - tx;
    const v = cz - tz;
    const sw = this.getHeight(tx, tz);
    const se = this.getHeight(tx + 1, tz);
    const nw = this.getHeight(tx, tz + 1);
    const ne = this.getHeight(tx + 1, tz + 1);
    const south = sw + (se - sw) * u;
    const north = nw + (ne - nw) * u;
    return south + (north - south) * v;
  }

  getUnderlay(tx: number, tz: number): number {
    const cx = Math.max(0, Math.min(this.width - 1, tx));
    const cz = Math.max(0, Math.min(this.length - 1, tz));
    return this.underlayIds[this.tileIndex(cx, cz)] ?? DEFAULT_UNDERLAY_ID;
  }

  /** Returns the user-authored underlay, ignoring any reversible auto-tiler substrate override. */
  getAuthoredUnderlay(tx: number, tz: number): number {
    if (!this.inTileBounds(tx, tz)) return DEFAULT_UNDERLAY_ID;
    const idx = this.tileIndex(tx, tz);
    if (((this.autoMetadata[idx] ?? 0) & TILE_AUTO_UNDERLAY_OVERRIDE) !== 0) {
      return this.autoBaseUnderlayIds[idx] ?? DEFAULT_UNDERLAY_ID;
    }
    return this.underlayIds[idx] ?? DEFAULT_UNDERLAY_ID;
  }

  /**
   * Paints the authored underlay. If an auto-tiler transition substrate is currently
   * active on this tile, updates the stored `autoBaseUnderlayId` so removing the
   * overlay later restores the newly painted underlay (matching TilePaintOperation.java).
   */
  setUnderlay(tx: number, tz: number, materialId: number): boolean {
    if (!this.inTileBounds(tx, tz)) return false;
    const idx = this.tileIndex(tx, tz);
    if (((this.autoMetadata[idx] ?? 0) & TILE_AUTO_UNDERLAY_OVERRIDE) !== 0) {
      if (this.autoBaseUnderlayIds[idx] === materialId) return false;
      this.autoBaseUnderlayIds[idx] = materialId;
      return true;
    }
    if (this.underlayIds[idx] === materialId) return false;
    this.underlayIds[idx] = materialId;
    this.markTileRangeDirty(
      tx - RS2_BLEND_MAX_OFFSET,
      tz - RS2_BLEND_MAX_OFFSET,
      tx - RS2_BLEND_MIN_OFFSET,
      tz - RS2_BLEND_MIN_OFFSET
    );
    return true;
  }

  getTile(tx: number, tz: number): TileData {
    if (!this.inTileBounds(tx, tz)) {
      return {
        underlayId: DEFAULT_UNDERLAY_ID,
        overlayId: 0,
        overlayShape: 0,
        overlayRotation: 0,
        autoMetadata: 0,
        autoBaseUnderlayId: 0,
      };
    }
    const idx = this.tileIndex(tx, tz);
    return {
      underlayId: this.underlayIds[idx] ?? DEFAULT_UNDERLAY_ID,
      overlayId: this.overlayIds[idx] ?? 0,
      overlayShape: this.overlayShapes[idx] ?? 0,
      overlayRotation: this.overlayRotations[idx] ?? 0,
      autoMetadata: this.autoMetadata[idx] ?? 0,
      autoBaseUnderlayId: this.autoBaseUnderlayIds[idx] ?? 0,
    };
  }

  setOverlay(tx: number, tz: number, overlayId: number, shape = 1, rotation = 0): boolean {
    if (!this.inTileBounds(tx, tz)) return false;
    const idx = this.tileIndex(tx, tz);
    const nextShape = overlayId === 0 ? 0 : Math.max(1, shape);
    const nextRot = overlayId === 0 ? 0 : rotation & 3;
    if (
      this.overlayIds[idx] === overlayId &&
      this.overlayShapes[idx] === nextShape &&
      this.overlayRotations[idx] === nextRot
    ) {
      return false;
    }
    this.overlayIds[idx] = overlayId;
    this.overlayShapes[idx] = nextShape;
    this.overlayRotations[idx] = nextRot;
    this.markTileRangeDirty(tx, tz, tx, tz);
    return true;
  }

  /** Atomic tile write used by TerrainAutoTiler and TerrainHistory. */
  setTileFull(tx: number, tz: number, data: TileData): boolean {
    if (!this.inTileBounds(tx, tz)) return false;
    const idx = this.tileIndex(tx, tz);
    const nextShape = data.overlayId === 0 ? 0 : Math.max(1, data.overlayShape);
    const nextRot = data.overlayId === 0 ? 0 : data.overlayRotation & 3;
    const underlayChanged = this.underlayIds[idx] !== data.underlayId;
    const changed =
      underlayChanged ||
      this.overlayIds[idx] !== data.overlayId ||
      this.overlayShapes[idx] !== nextShape ||
      this.overlayRotations[idx] !== nextRot ||
      this.autoMetadata[idx] !== data.autoMetadata ||
      this.autoBaseUnderlayIds[idx] !== data.autoBaseUnderlayId;

    if (!changed) return false;

    this.underlayIds[idx] = data.underlayId;
    this.overlayIds[idx] = data.overlayId;
    this.overlayShapes[idx] = nextShape;
    this.overlayRotations[idx] = nextRot;
    this.autoMetadata[idx] = data.autoMetadata;
    this.autoBaseUnderlayIds[idx] = data.autoBaseUnderlayId;

    if (underlayChanged) {
      this.markTileRangeDirty(
        tx - RS2_BLEND_MAX_OFFSET,
        tz - RS2_BLEND_MAX_OFFSET,
        tx - RS2_BLEND_MIN_OFFSET,
        tz - RS2_BLEND_MIN_OFFSET
      );
    } else {
      this.markTileRangeDirty(tx, tz, tx, tz);
    }
    return true;
  }

  clearAllOverlays(): void {
    for (let tz = 0; tz < this.length; tz++) {
      for (let tx = 0; tx < this.width; tx++) {
        const idx = this.tileIndex(tx, tz);
        const authored = this.getAuthoredUnderlay(tx, tz);
        this.underlayIds[idx] = authored;
        this.overlayIds[idx] = 0;
        this.overlayShapes[idx] = 0;
        this.overlayRotations[idx] = 0;
        this.autoMetadata[idx] = 0;
        this.autoBaseUnderlayIds[idx] = 0;
      }
    }
    this.markAllDirty();
  }

  markTileRangeDirty(minTx: number, minTz: number, maxTx: number, maxTz: number): void {
    const cMinX = Math.max(0, Math.floor(Math.max(0, minTx) / CHUNK_SIZE));
    const cMaxX = Math.min(this.chunksX - 1, Math.floor(Math.min(this.width - 1, maxTx) / CHUNK_SIZE));
    const cMinZ = Math.max(0, Math.floor(Math.max(0, minTz) / CHUNK_SIZE));
    const cMaxZ = Math.min(this.chunksZ - 1, Math.floor(Math.min(this.length - 1, maxTz) / CHUNK_SIZE));
    for (let cz = cMinZ; cz <= cMaxZ; cz++) {
      for (let cx = cMinX; cx <= cMaxX; cx++) {
        this.dirtyChunks[cz * this.chunksX + cx] = 1;
      }
    }
  }

  markAllDirty(): void {
    this.dirtyChunks.fill(1);
  }

  clearChunkDirty(cx: number, cz: number): void {
    this.dirtyChunks[cz * this.chunksX + cx] = 0;
  }

  isChunkDirty(cx: number, cz: number): boolean {
    return this.dirtyChunks[cz * this.chunksX + cx] === 1;
  }

  toSnapshot(): TerrainSnapshot {
    return {
      width: this.width,
      length: this.length,
      heights: Array.from(this.heights),
      underlays: Array.from(this.underlayIds),
      overlays: Array.from(this.overlayIds),
      shapes: Array.from(this.overlayShapes),
      rotations: Array.from(this.overlayRotations),
      autoMetadata: Array.from(this.autoMetadata),
      autoBaseUnderlays: Array.from(this.autoBaseUnderlayIds),
      holes: Array.from(this.holes),
      vertexShade: Array.from(this.vertexShade),
    };
  }

  loadSnapshot(snap: TerrainSnapshot): void {
    if (snap.width !== this.width || snap.length !== this.length) {
      throw new Error(`Snapshot dimensions ${snap.width}x${snap.length} do not match ${this.width}x${this.length}`);
    }
    this.heights.set(snap.heights);
    this.underlayIds.set(snap.underlays);
    this.overlayIds.set(snap.overlays);
    this.overlayShapes.set(snap.shapes);
    this.overlayRotations.set(snap.rotations);
    this.autoMetadata.set(snap.autoMetadata);
    this.autoBaseUnderlayIds.set(snap.autoBaseUnderlays);
    if (snap.holes && snap.holes.length === this.holes.length) {
      this.holes.set(snap.holes);
    } else {
      this.holes.fill(0);
    }
    if (snap.vertexShade && snap.vertexShade.length === this.vertexShade.length) {
      this.vertexShade.set(snap.vertexShade);
    } else {
      this.vertexShade.fill(0);
    }
    this.markAllDirty();
  }
}
