/**
 * Single-stroke undo / redo transaction history for terrain edits.
 * Mirrors WorldLab's TerrainHistory atomic commit model (heights, tiles, and auto-metadata).
 */

import type { TerrainGrid } from '../terrain/terrainGrid';

export interface HeightDelta {
  vx: number;
  vz: number;
  before: number;
  after: number;
}

export interface VertexShadeDelta {
  vx: number;
  vz: number;
  before: number;
  after: number;
}

export interface HoleDelta {
  tx: number;
  tz: number;
  before: number;
  after: number;
}

export interface TileDelta {
  tx: number;
  tz: number;
  beforeUnderlay: number;
  beforeOverlay: number;
  beforeShape: number;
  beforeRotation: number;
  beforeAutoMeta: number;
  beforeAutoBaseUnderlay: number;
  afterUnderlay: number;
  afterOverlay: number;
  afterShape: number;
  afterRotation: number;
  afterAutoMeta: number;
  afterAutoBaseUnderlay: number;
}

export interface TerrainTransaction {
  readonly label: string;
  readonly heights: readonly HeightDelta[];
  readonly tiles: readonly TileDelta[];
  readonly holes: readonly HoleDelta[];
  readonly shades: readonly VertexShadeDelta[];
}

export class TerrainHistory {
  private readonly undoStack: TerrainTransaction[] = [];
  private readonly redoStack: TerrainTransaction[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  push(tx: TerrainTransaction): void {
    if (
      tx.heights.length === 0 &&
      tx.tiles.length === 0 &&
      tx.holes.length === 0 &&
      tx.shades.length === 0
    ) {
      return;
    }
    this.undoStack.push(tx);
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  undo(grid: TerrainGrid): TerrainTransaction | null {
    const tx = this.undoStack.pop();
    if (!tx) return null;
    for (const h of tx.heights) {
      grid.setHeight(h.vx, h.vz, h.before);
    }
    for (const s of tx.shades) {
      grid.setVertexShadeByte(s.vx, s.vz, s.before);
    }
    for (const hl of tx.holes) {
      grid.setHole(hl.tx, hl.tz, hl.before !== 0);
    }
    for (const t of tx.tiles) {
      grid.setTileFull(t.tx, t.tz, {
        underlayId: t.beforeUnderlay,
        overlayId: t.beforeOverlay,
        overlayShape: t.beforeShape,
        overlayRotation: t.beforeRotation,
        autoMetadata: t.beforeAutoMeta,
        autoBaseUnderlayId: t.beforeAutoBaseUnderlay,
      });
    }
    this.redoStack.push(tx);
    return tx;
  }

  redo(grid: TerrainGrid): TerrainTransaction | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    for (const h of tx.heights) {
      grid.setHeight(h.vx, h.vz, h.after);
    }
    for (const s of tx.shades) {
      grid.setVertexShadeByte(s.vx, s.vz, s.after);
    }
    for (const hl of tx.holes) {
      grid.setHole(hl.tx, hl.tz, hl.after !== 0);
    }
    for (const t of tx.tiles) {
      grid.setTileFull(t.tx, t.tz, {
        underlayId: t.afterUnderlay,
        overlayId: t.afterOverlay,
        overlayShape: t.afterShape,
        overlayRotation: t.afterRotation,
        autoMetadata: t.afterAutoMeta,
        autoBaseUnderlayId: t.afterAutoBaseUnderlay,
      });
    }
    this.undoStack.push(tx);
    return tx;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/** Captures before/after terrain state around a stroke and produces a compact delta transaction. */
export class TerrainStrokeRecorder {
  private readonly label: string;
  private readonly beforeHeights: Int16Array;
  private readonly beforeShades: Uint8Array;
  private readonly beforeHoles: Uint8Array;
  private readonly beforeUnderlays: Int16Array;
  private readonly beforeOverlays: Int16Array;
  private readonly beforeShapes: Uint8Array;
  private readonly beforeRotations: Uint8Array;
  private readonly beforeAutoMeta: Uint8Array;
  private readonly beforeAutoBaseUnderlays: Int16Array;

  constructor(grid: TerrainGrid, label: string) {
    this.label = label;
    this.beforeHeights = Int16Array.from(grid.heights);
    this.beforeShades = Uint8Array.from(grid.vertexShade);
    this.beforeHoles = Uint8Array.from(grid.holes);
    this.beforeUnderlays = Int16Array.from(grid.underlayIds);
    this.beforeOverlays = Int16Array.from(grid.overlayIds);
    this.beforeShapes = Uint8Array.from(grid.overlayShapes);
    this.beforeRotations = Uint8Array.from(grid.overlayRotations);
    this.beforeAutoMeta = Uint8Array.from(grid.autoMetadata);
    this.beforeAutoBaseUnderlays = Int16Array.from(grid.autoBaseUnderlayIds);
  }

  get initialHeights(): Int16Array {
    return this.beforeHeights;
  }

  commit(grid: TerrainGrid): TerrainTransaction {
    const heights: HeightDelta[] = [];
    const shades: VertexShadeDelta[] = [];
    const stride = grid.width + 1;
    for (let vz = 0; vz <= grid.length; vz++) {
      for (let vx = 0; vx <= grid.width; vx++) {
        const idx = vz * stride + vx;
        const before = this.beforeHeights[idx]!;
        const after = grid.heights[idx]!;
        if (before !== after) {
          heights.push({ vx, vz, before, after });
        }
        const bShade = this.beforeShades[idx]!;
        const aShade = grid.vertexShade[idx]!;
        if (bShade !== aShade) {
          shades.push({ vx, vz, before: bShade, after: aShade });
        }
      }
    }

    const tiles: TileDelta[] = [];
    const holes: HoleDelta[] = [];
    for (let tz = 0; tz < grid.length; tz++) {
      for (let tx = 0; tx < grid.width; tx++) {
        const idx = tz * grid.width + tx;
        const bH = this.beforeHoles[idx]!;
        const aH = grid.holes[idx]!;
        if (bH !== aH) {
          holes.push({ tx, tz, before: bH, after: aH });
        }

        const bU = this.beforeUnderlays[idx]!;
        const bO = this.beforeOverlays[idx]!;
        const bS = this.beforeShapes[idx]!;
        const bR = this.beforeRotations[idx]!;
        const bM = this.beforeAutoMeta[idx]!;
        const bB = this.beforeAutoBaseUnderlays[idx]!;

        const aU = grid.underlayIds[idx]!;
        const aO = grid.overlayIds[idx]!;
        const aS = grid.overlayShapes[idx]!;
        const aR = grid.overlayRotations[idx]!;
        const aM = grid.autoMetadata[idx]!;
        const aB = grid.autoBaseUnderlayIds[idx]!;

        if (bU !== aU || bO !== aO || bS !== aS || bR !== aR || bM !== aM || bB !== aB) {
          tiles.push({
            tx,
            tz,
            beforeUnderlay: bU,
            beforeOverlay: bO,
            beforeShape: bS,
            beforeRotation: bR,
            beforeAutoMeta: bM,
            beforeAutoBaseUnderlay: bB,
            afterUnderlay: aU,
            afterOverlay: aO,
            afterShape: aS,
            afterRotation: aR,
            afterAutoMeta: aM,
            afterAutoBaseUnderlay: aB,
          });
        }
      }
    }

    return { label: this.label, heights, tiles, holes, shades };
  }
}
