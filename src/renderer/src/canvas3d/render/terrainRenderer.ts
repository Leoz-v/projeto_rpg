/**
 * PixiJS 3D (@pixi/3d) chunked terrain renderer, D&D 5ft grid overlay,
 * and live brush / ruler 3D line previews.
 */

import type {
  Container3D} from '@pixi/3d';
import {
  FlatMaterial,
  Geometry3D,
  Material3D,
  Mesh3D,
} from '@pixi/3d';
import { CHUNK_SIZE, METERS_PER_HEIGHT_UNIT, TILE_SIZE_METERS } from '../terrain/constants';
import { VOID_OVERLAY_ID } from '../terrain/materials';
import { buildChunkMesh, buildDioramaSkirt, type BuiltChunkMesh } from '../terrain/meshBuilder';
import type { TerrainGrid } from '../terrain/terrainGrid';
import { getTileShape } from '../terrain/tileSurface';
import { shapeContainsOverlayPoint } from '../tools/shapeFitter';
import { worldlabTerrainBit, worldlabTerrainEmissiveBit } from './terrainShader';

export type TerrainShadingMode = 'worldlab_flat' | 'rs2_gouraud' | 'pbr_shadows';

export interface BrushMarker {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly weight: number;
  readonly color: readonly [number, number, number];
}

export class TerrainRenderer {
  private readonly terrainRoot: Container3D;
  private readonly overlayRoot: Container3D;
  private grid: TerrainGrid;

  private readonly rs2Material: FlatMaterial;
  private readonly pbrMaterial: Material3D;
  private readonly skirtMaterial: FlatMaterial;
  private readonly gridMaterial: FlatMaterial;
  private readonly lineMaterial: FlatMaterial;

  private chunkMeshes: (Mesh3D | null)[];
  private chunkCache: (BuiltChunkMesh | null)[];

  private skirtMesh: Mesh3D | null = null;
  private gridMesh: Mesh3D | null = null;
  private holeOverlayMesh: Mesh3D | null = null;
  private brushPreviewMesh: Mesh3D | null = null;
  private rulerMesh: Mesh3D | null = null;
  private selectionRingMesh: Mesh3D | null = null;

  private shadingMode: TerrainShadingMode = 'pbr_shadows';
  private showGrid = true;
  private gridSuppressed = false;
  private ghostAlpha: number | null = null;
  private showHoleMarkers = false;
  private totalTriangles = 0;

  constructor(grid: TerrainGrid, terrainRoot: Container3D, overlayRoot: Container3D) {
    this.grid = grid;
    this.terrainRoot = terrainRoot;
    this.overlayRoot = overlayRoot;

    this.rs2Material = new FlatMaterial({
      baseColor: 0xffffff,
      vertexColors: true,
      extraBits: [worldlabTerrainBit],
    });

    this.pbrMaterial = new Material3D({
      baseColor: 0xffffff,
      vertexColors: true,
      flatShading: true,
      roughness: 0.97,
      metallic: 0.0,
      extraBits: [worldlabTerrainBit, worldlabTerrainEmissiveBit],
    });

    this.skirtMaterial = new FlatMaterial({
      baseColor: 0xffffff,
      vertexColors: true,
      doubleSided: true,
    });

    this.gridMaterial = new FlatMaterial({
      baseColor: 0xffffff,
      vertexColors: true,
      alphaMode: 'blend',
      alpha: 0.28,
    });

    this.lineMaterial = new FlatMaterial({
      baseColor: 0xffffff,
      vertexColors: true,
    });

    const totalChunks = grid.chunksX * grid.chunksZ;
    this.chunkMeshes = new Array<Mesh3D | null>(totalChunks).fill(null);
    this.chunkCache = new Array<BuiltChunkMesh | null>(totalChunks).fill(null);

    this.syncDirtyChunks();
    this.rebuildGridOverlay();
    this.rebuildSkirt();
  }

  get triangleCount(): number {
    return this.totalTriangles;
  }

  get currentShadingMode(): TerrainShadingMode {
    return this.shadingMode;
  }

  get gridVisible(): boolean {
    return this.showGrid;
  }

  setShadingMode(mode: TerrainShadingMode): void {
    if (this.shadingMode === mode) return;
    this.shadingMode = mode;
    for (let cz = 0; cz < this.grid.chunksZ; cz++) {
      for (let cx = 0; cx < this.grid.chunksX; cx++) {
        const idx = cz * this.grid.chunksX + cx;
        const cached = this.chunkCache[idx];
        if (cached) {
          this.uploadChunkMesh(idx, cached);
        }
      }
    }
  }

  setGridVisible(visible: boolean): void {
    this.showGrid = visible;
    if (this.gridMesh) {
      this.gridMesh.visible = visible && !this.gridSuppressed && this.ghostAlpha === null;
    }
  }

  /** Suppresses grid lines on an inactive layer (e.g. Interior peeked through a Surface cutout). */
  setGridSuppressed(suppressed: boolean): void {
    this.gridSuppressed = suppressed;
    if (this.gridMesh) {
      this.gridMesh.visible = this.showGrid && !this.gridSuppressed && this.ghostAlpha === null;
    }
  }

  /** Renders this terrain layer as a translucent ghost overlay (e.g. Ghost Surface roof while editing Interior). */
  setGhostOpacity(alpha: number | null): void {
    this.ghostAlpha = alpha;
    const isGhost = alpha !== null && alpha < 0.99;
    const mode = isGhost ? 'blend' : 'opaque';
    const nextAlpha = isGhost ? alpha : 1.0;

    this.pbrMaterial.alphaMode = mode;
    this.pbrMaterial.alpha = nextAlpha;
    this.rs2Material.alphaMode = mode;
    this.rs2Material.alpha = nextAlpha;
    this.skirtMaterial.alphaMode = mode;
    this.skirtMaterial.alpha = nextAlpha;

    if (this.gridMesh) {
      this.gridMesh.visible = this.showGrid && !this.gridSuppressed && !isGhost;
    }
  }

  /** Shows wireframe X markers over punched cutout tiles while the Cutout/Hole brush is active. */
  setHoleMarkersVisible(visible: boolean): void {
    if (this.showHoleMarkers === visible) return;
    this.showHoleMarkers = visible;
    this.rebuildHoleOverlay();
  }

  /** Applies dynamic mood tinting to unlit RS2 terrain & diorama skirt so all shading modes respond to lighting presets. */
  setUnlitMoodTint(tintHex: number): void {
    this.rs2Material.baseColor = tintHex;
    this.skirtMaterial.baseColor = tintHex;
  }

  /** Replaces the active TerrainGrid (including arbitrary width x length resizing) and rebuilds all chunks cleanly. */
  setGrid(nextGrid: TerrainGrid): void {
    for (const mesh of this.chunkMeshes) {
      if (!mesh) continue;
      this.terrainRoot.removeChild(mesh);
      mesh.geometry.destroy(true);
      mesh.destroy();
    }

    this.grid = nextGrid;
    const totalChunks = nextGrid.chunksX * nextGrid.chunksZ;
    this.chunkMeshes = new Array<Mesh3D | null>(totalChunks).fill(null);
    this.chunkCache = new Array<BuiltChunkMesh | null>(totalChunks).fill(null);
    this.totalTriangles = 0;

    this.setBrushPreview([], []);
    this.setRulerLine(null, null);
    this.setSelectionRing(null);

    nextGrid.markAllDirty();
    this.syncDirtyChunks();
    this.rebuildGridOverlay();
    this.rebuildHoleOverlay();
    this.rebuildSkirt();
  }

  /** Rebuilds any dirty 8x8 chunks and updates the conforming 5ft grid lines if heights changed. */
  syncDirtyChunks(): number {
    let rebuilt = 0;
    for (let cz = 0; cz < this.grid.chunksZ; cz++) {
      for (let cx = 0; cx < this.grid.chunksX; cx++) {
        if (!this.grid.isChunkDirty(cx, cz)) continue;
        const idx = cz * this.grid.chunksX + cx;
        const built = buildChunkMesh(this.grid, cx, cz);
        this.chunkCache[idx] = built;
        this.uploadChunkMesh(idx, built);
        this.grid.clearChunkDirty(cx, cz);
        rebuilt++;
      }
    }

    if (rebuilt > 0) {
      let tris = 0;
      for (const c of this.chunkCache) {
        if (c) tris += c.triangleCount;
      }
      this.totalTriangles = tris;
      this.rebuildGridOverlay();
      this.rebuildHoleOverlay();
      this.rebuildSkirt();
    }
    return rebuilt;
  }

  private uploadChunkMesh(chunkIndex: number, built: BuiltChunkMesh): void {
    const existing = this.chunkMeshes[chunkIndex];
    if (built.triangleCount === 0) {
      if (existing) {
        existing.visible = false;
      }
      return;
    }

    const colors =
      this.shadingMode === 'worldlab_flat'
        ? built.colorsFlat
        : this.shadingMode === 'rs2_gouraud'
          ? built.colorsRs2
          : built.colorsAlbedo;
    const material = this.shadingMode === 'pbr_shadows' ? this.pbrMaterial : this.rs2Material;

    const geometry = new Geometry3D({
      positions: built.positions,
      normals: built.normals,
      uvs: built.uvs,
      colors,
      colors1: built.surfaceMeta,
      indices: built.indices,
    });

    if (existing) {
      const oldGeo = existing.geometry;
      existing.geometry = geometry;
      existing.material = material;
      existing.receiveShadow = this.shadingMode === 'pbr_shadows';
      existing.visible = true;
      oldGeo.destroy(true);
    } else {
      const mesh = new Mesh3D({
        geometry,
        material,
        castShadow: false,
        receiveShadow: this.shadingMode === 'pbr_shadows',
        label: `terrain_chunk_${built.chunkX}_${built.chunkZ}`,
      });
      this.terrainRoot.addChild(mesh);
      this.chunkMeshes[chunkIndex] = mesh;
    }
  }

  private rebuildSkirt(): void {
    const skirt = buildDioramaSkirt(this.grid);
    const geometry = new Geometry3D({
      positions: skirt.positions,
      normals: skirt.normals,
      colors: skirt.colors,
      indices: skirt.indices,
    });
    if (this.skirtMesh) {
      const old = this.skirtMesh.geometry;
      this.skirtMesh.geometry = geometry;
      old.destroy(true);
    } else {
      this.skirtMesh = new Mesh3D({
        geometry,
        material: this.skirtMaterial,
        castShadow: false,
        receiveShadow: false,
        label: 'diorama_skirt',
      });
      this.terrainRoot.addChild(this.skirtMesh);
    }
  }

  /**
   * Builds a conforming 1.5 m (5 ft) D&D tactical grid line mesh draped over the
   * vertex heightfield, with slightly brighter major lines every 4 tiles (20 ft).
   */
  private rebuildGridOverlay(): void {
    const w = this.grid.width;
    const l = this.grid.length;
    const positions: number[] = [];
    const colors: number[] = [];
    const lift = 0.025;

    const pushSegment = (
      x0: number,
      y0: number,
      z0: number,
      x1: number,
      y1: number,
      z1: number,
      major: boolean
    ): void => {
      positions.push(x0, y0 + lift, z0, x1, y1 + lift, z1);
      // Dark subtle tactical grid lines (brighter accent on 8-tile chunk / 4-tile major lines)
      const c = major ? 0.22 : 0.05;
      const g = major ? 0.3 : 0.07;
      const b = major ? 0.36 : 0.08;
      colors.push(c, g, b, 1, c, g, b, 1);
    };

    const isEdgeVoid = (tx: number, tz: number, u: number, v: number): boolean => {
      if (!this.grid.inTileBounds(tx, tz)) return false;
      if (this.grid.isHole(tx, tz)) return true;
      const tile = this.grid.getTile(tx, tz);
      if (tile.overlayId !== VOID_OVERLAY_ID || tile.overlayShape <= 0) return false;
      if (tile.overlayShape === 1) return true;
      const shape = getTileShape(tile.overlayId, tile.overlayShape, tile.overlayRotation);
      return shapeContainsOverlayPoint(shape, u, v);
    };

    // Lines along X (constant Z) — skip any edge bordering a hole or fully voided shaped-cutout edge
    for (let vz = 0; vz <= l; vz++) {
      const major = vz % CHUNK_SIZE === 0;
      const z = vz * TILE_SIZE_METERS;
      for (let vx = 0; vx < w; vx++) {
        const northVoid = vz < l && isEdgeVoid(vx, vz, 0.5, 0.01);
        const southVoid = vz > 0 && isEdgeVoid(vx, vz - 1, 0.5, 0.99);
        if (northVoid || southVoid) continue;
        const x0 = vx * TILE_SIZE_METERS;
        const x1 = (vx + 1) * TILE_SIZE_METERS;
        const y0 = this.grid.getHeight(vx, vz) * METERS_PER_HEIGHT_UNIT;
        const y1 = this.grid.getHeight(vx + 1, vz) * METERS_PER_HEIGHT_UNIT;
        pushSegment(x0, y0, z, x1, y1, z, major);
      }
    }

    // Lines along Z (constant X) — skip any edge bordering a hole or voided shaped-cutout edge
    for (let vx = 0; vx <= w; vx++) {
      const major = vx % CHUNK_SIZE === 0;
      const x = vx * TILE_SIZE_METERS;
      for (let vz = 0; vz < l; vz++) {
        const eastVoid = vx < w && isEdgeVoid(vx, vz, 0.01, 0.5);
        const westVoid = vx > 0 && isEdgeVoid(vx - 1, vz, 0.99, 0.5);
        if (eastVoid || westVoid) continue;
        const z0 = vz * TILE_SIZE_METERS;
        const z1 = (vz + 1) * TILE_SIZE_METERS;
        const y0 = this.grid.getHeight(vx, vz) * METERS_PER_HEIGHT_UNIT;
        const y1 = this.grid.getHeight(vx, vz + 1) * METERS_PER_HEIGHT_UNIT;
        pushSegment(x, y0, z0, x, y1, z1, major);
      }
    }

    if (positions.length === 0) {
      if (this.gridMesh) this.gridMesh.visible = false;
      return;
    }

    const geometry = new Geometry3D({
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      topology: 'line-list',
    });

    if (this.gridMesh) {
      const old = this.gridMesh.geometry;
      this.gridMesh.geometry = geometry;
      this.gridMesh.visible = this.showGrid && !this.gridSuppressed && this.ghostAlpha === null;
      old.destroy(true);
    } else {
      this.gridMesh = new Mesh3D({
        geometry,
        material: this.gridMaterial,
        castShadow: false,
        receiveShadow: false,
        visible: this.showGrid && !this.gridSuppressed && this.ghostAlpha === null,
        label: 'dnd_5ft_grid',
      });
      this.terrainRoot.addChild(this.gridMesh);
    }
  }

  /** Renders subtle red-orange wireframe X boxes over cutout tiles only while editing cutouts. */
  private rebuildHoleOverlay(): void {
    if (!this.showHoleMarkers) {
      if (this.holeOverlayMesh) this.holeOverlayMesh.visible = false;
      return;
    }

    const positions: number[] = [];
    const colors: number[] = [];
    const lift = 0.045;
    for (let tz = 0; tz < this.grid.length; tz++) {
      for (let tx = 0; tx < this.grid.width; tx++) {
        const isHole = this.grid.isHole(tx, tz);
        const isShapedVoid = !isHole && this.grid.getTile(tx, tz).overlayId === VOID_OVERLAY_ID;
        if (!isHole && !isShapedVoid) continue;
        const x0 = tx * TILE_SIZE_METERS;
        const x1 = (tx + 1) * TILE_SIZE_METERS;
        const z0 = tz * TILE_SIZE_METERS;
        const z1 = (tz + 1) * TILE_SIZE_METERS;
        const ySW = this.grid.getHeight(tx, tz) * METERS_PER_HEIGHT_UNIT + lift;
        const ySE = this.grid.getHeight(tx + 1, tz) * METERS_PER_HEIGHT_UNIT + lift;
        const yNW = this.grid.getHeight(tx, tz + 1) * METERS_PER_HEIGHT_UNIT + lift;
        const yNE = this.grid.getHeight(tx + 1, tz + 1) * METERS_PER_HEIGHT_UNIT + lift;

        positions.push(
          x0, ySW, z0, x1, ySE, z0,
          x1, ySE, z0, x1, yNE, z1,
          x1, yNE, z1, x0, yNW, z1,
          x0, yNW, z1, x0, ySW, z0,
          x0, ySW, z0, x1, yNE, z1,
          x1, ySE, z0, x0, yNW, z1
        );
        const mr = isShapedVoid ? 0.96 : 0.95;
        const mg = isShapedVoid ? 0.28 : 0.36;
        const mb = isShapedVoid ? 0.92 : 0.22;
        for (let i = 0; i < 12; i++) {
          colors.push(mr, mg, mb, 1);
        }
      }
    }

    if (positions.length === 0) {
      if (this.holeOverlayMesh) this.holeOverlayMesh.visible = false;
      return;
    }

    const geometry = new Geometry3D({
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      topology: 'line-list',
    });

    if (this.holeOverlayMesh) {
      const old = this.holeOverlayMesh.geometry;
      this.holeOverlayMesh.geometry = geometry;
      this.holeOverlayMesh.visible = true;
      old.destroy(true);
    } else {
      this.holeOverlayMesh = new Mesh3D({
        geometry,
        material: this.lineMaterial,
        castShadow: false,
        receiveShadow: false,
        label: 'cutout_hole_markers',
      });
      this.terrainRoot.addChild(this.holeOverlayMesh);
    }
  }

  /**
   * Renders exact WorldLab-style brush footprint markers (vertex crosses or tile outlines).
   */
  setBrushPreview(
    markers: readonly BrushMarker[],
    tileOutlines: readonly { tx: number; tz: number; color: readonly [number, number, number] }[] = [],
    wallEdges: readonly {
      x0: number;
      z0: number;
      x1: number;
      z1: number;
      color: readonly [number, number, number];
    }[] = [],
    surfaceBoxes: readonly {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      y: number;
      color: readonly [number, number, number];
    }[] = []
  ): void {
    if (markers.length === 0 && tileOutlines.length === 0 && wallEdges.length === 0 && surfaceBoxes.length === 0) {
      if (this.brushPreviewMesh) {
        this.brushPreviewMesh.visible = false;
      }
      return;
    }

    const positions: number[] = [];
    const colors: number[] = [];
    const lift = 0.06;

    for (const m of markers) {
      const r = 0.14 + 0.16 * m.weight;
      const [cr, cg, cb] = m.color;
      // Diamond + vertical pin at vertex
      positions.push(
        m.x - r, m.y + lift, m.z, m.x + r, m.y + lift, m.z,
        m.x, m.y + lift, m.z - r, m.x, m.y + lift, m.z + r,
        m.x, m.y + lift, m.z, m.x, m.y + lift + 0.12 + 0.25 * m.weight, m.z
      );
      for (let i = 0; i < 6; i++) {
        colors.push(cr, cg, cb, 1);
      }
    }

    for (const outline of tileOutlines) {
      const { tx, tz, color } = outline;
      const x0 = tx * TILE_SIZE_METERS;
      const x1 = (tx + 1) * TILE_SIZE_METERS;
      const z0 = tz * TILE_SIZE_METERS;
      const z1 = (tz + 1) * TILE_SIZE_METERS;
      const ySW = this.grid.getHeight(tx, tz) * METERS_PER_HEIGHT_UNIT + lift;
      const ySE = this.grid.getHeight(tx + 1, tz) * METERS_PER_HEIGHT_UNIT + lift;
      const yNW = this.grid.getHeight(tx, tz + 1) * METERS_PER_HEIGHT_UNIT + lift;
      const yNE = this.grid.getHeight(tx + 1, tz + 1) * METERS_PER_HEIGHT_UNIT + lift;
      const [cr, cg, cb] = color;

      positions.push(
        x0, ySW, z0, x1, ySE, z0,
        x1, ySE, z0, x1, yNE, z1,
        x1, yNE, z1, x0, yNW, z1,
        x0, yNW, z1, x0, ySW, z0
      );
      for (let i = 0; i < 8; i++) {
        colors.push(cr, cg, cb, 1);
      }
    }

    for (const edge of wallEdges) {
      const wx0 = edge.x0 * TILE_SIZE_METERS;
      const wz0 = edge.z0 * TILE_SIZE_METERS;
      const wx1 = edge.x1 * TILE_SIZE_METERS;
      const wz1 = edge.z1 * TILE_SIZE_METERS;
      const y0 = this.grid.sampleHeightAtTileCoord(edge.x0, edge.z0) * METERS_PER_HEIGHT_UNIT + lift;
      const y1 = this.grid.sampleHeightAtTileCoord(edge.x1, edge.z1) * METERS_PER_HEIGHT_UNIT + lift;
      const wallH = 2.25; // 1.5 tiles (7.5 ft) visual wall-mount frame
      const [cr, cg, cb] = edge.color;
      positions.push(
        wx0, y0, wz0, wx1, y1, wz1,
        wx0, y0 + wallH, wz0, wx1, y1 + wallH, wz1,
        wx0, y0, wz0, wx0, y0 + wallH, wz0,
        wx1, y1, wz1, wx1, y1 + wallH, wz1
      );
      for (let i = 0; i < 8; i++) {
        colors.push(cr, cg, cb, 1);
      }
    }

    for (const box of surfaceBoxes) {
      const y = box.y + 0.035;
      const [cr, cg, cb] = box.color;
      // Outer rectangle + subtle center cross on the top surface of the supporting model
      const mx = (box.minX + box.maxX) * 0.5;
      const mz = (box.minZ + box.maxZ) * 0.5;
      const crLen = Math.min(0.35, Math.min(box.maxX - box.minX, box.maxZ - box.minZ) * 0.25);
      positions.push(
        box.minX, y, box.minZ, box.maxX, y, box.minZ,
        box.maxX, y, box.minZ, box.maxX, y, box.maxZ,
        box.maxX, y, box.maxZ, box.minX, y, box.maxZ,
        box.minX, y, box.maxZ, box.minX, y, box.minZ,
        mx - crLen, y, mz, mx + crLen, y, mz,
        mx, y, mz - crLen, mx, y, mz + crLen
      );
      for (let i = 0; i < 12; i++) {
        colors.push(cr, cg, cb, 1);
      }
    }

    const geometry = new Geometry3D({
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      topology: 'line-list',
    });

    if (this.brushPreviewMesh) {
      const old = this.brushPreviewMesh.geometry;
      this.brushPreviewMesh.geometry = geometry;
      this.brushPreviewMesh.visible = true;
      old.destroy(true);
    } else {
      this.brushPreviewMesh = new Mesh3D({
        geometry,
        material: this.lineMaterial,
        castShadow: false,
        receiveShadow: false,
        label: 'brush_preview',
      });
      this.overlayRoot.addChild(this.brushPreviewMesh);
    }
  }

  /** Renders a 3D D&D measurement ruler line between two world points. */
  setRulerLine(
    start: { x: number; y: number; z: number } | null,
    end: { x: number; y: number; z: number } | null
  ): void {
    if (!start || !end) {
      if (this.rulerMesh) this.rulerMesh.visible = false;
      return;
    }

    const lift = 0.25;
    const positions = new Float32Array([
      start.x, start.y + lift, start.z, end.x, end.y + lift, end.z,
      // Vertical drop ticks at both ends
      start.x, start.y, start.z, start.x, start.y + lift * 2, start.z,
      end.x, end.y, end.z, end.x, end.y + lift * 2, end.z,
    ]);
    const colors = new Float32Array([
      1.0, 0.85, 0.15, 1, 1.0, 0.85, 0.15, 1,
      0.2, 0.95, 1.0, 1, 0.2, 0.95, 1.0, 1,
      1.0, 0.45, 0.2, 1, 1.0, 0.45, 0.2, 1,
    ]);

    const geometry = new Geometry3D({
      positions,
      colors,
      topology: 'line-list',
    });

    if (this.rulerMesh) {
      const old = this.rulerMesh.geometry;
      this.rulerMesh.geometry = geometry;
      this.rulerMesh.visible = true;
      old.destroy(true);
    } else {
      this.rulerMesh = new Mesh3D({
        geometry,
        material: this.lineMaterial,
        castShadow: false,
        receiveShadow: false,
        label: 'dnd_ruler',
      });
      this.overlayRoot.addChild(this.rulerMesh);
    }
  }

  /** Renders a crisp golden selection ring around a selected placed asset. */
  setSelectionRing(ring: { x: number; y: number; z: number; radius: number } | null): void {
    if (!ring) {
      if (this.selectionRingMesh) this.selectionRingMesh.visible = false;
      return;
    }

    const segments = 32;
    const positions: number[] = [];
    const colors: number[] = [];
    const lift = 0.08;

    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      positions.push(
        ring.x + Math.cos(a0) * ring.radius,
        ring.y + lift,
        ring.z + Math.sin(a0) * ring.radius,
        ring.x + Math.cos(a1) * ring.radius,
        ring.y + lift,
        ring.z + Math.sin(a1) * ring.radius
      );
      colors.push(1.0, 0.82, 0.18, 1, 1.0, 0.82, 0.18, 1);
    }

    const geometry = new Geometry3D({
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      topology: 'line-list',
    });

    if (this.selectionRingMesh) {
      const old = this.selectionRingMesh.geometry;
      this.selectionRingMesh.geometry = geometry;
      this.selectionRingMesh.visible = true;
      old.destroy(true);
    } else {
      this.selectionRingMesh = new Mesh3D({
        geometry,
        material: this.lineMaterial,
        castShadow: false,
        receiveShadow: false,
        label: 'asset_selection_ring',
      });
      this.overlayRoot.addChild(this.selectionRingMesh);
    }
  }
}
