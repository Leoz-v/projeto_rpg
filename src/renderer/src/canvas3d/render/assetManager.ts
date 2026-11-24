/**
 * Local GLB asset loader, live 3D ghost preview, WorldLab ImportedModelScalePolicy
 * D&D 5ft/1.5m resizing, Wall Decoration mounting, embedded glTF + procedural ambient
 * animations, automatic winding/material repair, and in-place / batch replacing.
 *
 * Reads strictly from D:\Games\projects\vtt-3d-proto\assets via the Vite local bridge
 * (/local-assets/catalog.json & /local-assets/models/...).
 */

import type {
  Container3D} from '@pixi/3d';
import {
  CylinderGeometry,
  FlatMaterial,
  Material3D,
  Mesh3D,
  Model3D,
  type BaseMaterial3D,
  type Scene3DSource,
} from '@pixi/3d';
import { Assets, Texture, type Ticker } from 'pixi.js';
import type { MapLayerId, SerializedProp } from '../map/mapDocument';
import {
  METERS_PER_FOOT,
  METERS_PER_HEIGHT_UNIT,
  TILE_SIZE_METERS,
} from '../terrain/constants';
import type { TerrainGrid } from '../terrain/terrainGrid';
import {
  normalizeSceneSourceWinding,
  resolveUnlitEmissiveFallbackColor,
} from './meshWinding';
import {
  computeModelBaseScales,
  getRotatedFootprint,
  type AssetCategory,
  type AssetScalePolicy,
  type WorldLabAssetEntry,
} from './modelScalePolicy';
import {
  classifyAmbientAnimation,
  evaluateFlameEmissiveStrength,
  stablePhase,
  type AmbientAnimKind,
} from './objectAnimator';
import {
  computePlacedWorldBounds,
  type StackablePropBounds,
} from './surfaceStacking';
import {
  isWallDecorEntry,
  preservesAuthoredMountHeight,
  type WallDecorMode,
  type WallSupportCandidate,
} from './wallDecoration';
import {
  createCaveVoidMesh,
  isCaveMouthEntry,
  isRoofCutawayEntry,
  type RoofCutawayMode,
} from './caveSystem';
import type { Ray3 } from '../terrain/raycast';

export type { AssetCategory, AssetScalePolicy, RoofCutawayMode, WorldLabAssetEntry };

export interface AssetTransformOptions {
  layer?: MapLayerId;
  rotationDegrees: number;
  scalePolicy: AssetScalePolicy;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  yOffsetFeet: number;
  wallDecorMode?: WallDecorMode;
  wallSide?: 'N' | 'S' | 'E' | 'W' | 'DIAG';
  caveVoid?: boolean;
  roofLayer?: boolean;
}

interface SavedMaterialAlpha {
  alphaMode: BaseMaterial3D['alphaMode'];
  alpha: number;
}

export interface PlacedAsset {
  readonly id: string;
  readonly layer: MapLayerId;
  entry: WorldLabAssetEntry;
  model: Model3D;
  flatMaterials: BaseMaterial3D[];
  savedMaterialAlphas: SavedMaterialAlpha[];
  flameMaterials: Material3D[];
  shadowDisc: Mesh3D | null;
  caveVoidMesh: Mesh3D | null;
  caveVoidEnabled: boolean;
  roofLayer: boolean;
  tileX: number;
  tileZ: number;
  rotationDegrees: number;
  scalePolicy: AssetScalePolicy;
  baseScaleX: number;
  baseScaleY: number;
  baseScaleZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  yOffsetFeet: number;
  localMinY: number;
  localCenterX: number;
  localCenterZ: number;
  localSizeX: number;
  localSizeY: number;
  localSizeZ: number;
  wallDecorMode?: WallDecorMode;
  wallSide?: 'N' | 'S' | 'E' | 'W' | 'DIAG';
  animKind: AmbientAnimKind;
  animPhase: number;
}

interface ModelMetrics {
  baseScaleX: number;
  baseScaleY: number;
  baseScaleZ: number;
  localMinY: number;
  localCenterX: number;
  localCenterZ: number;
  localSizeX: number;
  localSizeY: number;
  localSizeZ: number;
}

export class AssetManager {
  private readonly propsRoot: Container3D;
  private readonly interiorPropsRoot: Container3D;
  private grid: TerrainGrid;
  private interiorGrid: TerrainGrid;
  private activeLayer: MapLayerId = 'surface';
  private interiorOffsetY = -3.6;
  private surfaceGhosted = false;
  private _autoCaveVoidEnabled = true;
  private _roofCutawayManual = false;
  private _roofCutawayAutoActive = false;
  private _roofCutawayMode: RoofCutawayMode = 'hidden';
  private _autoCutawayEnabled = false;
  private _autoCutawayZoomThreshold = 18;
  private readonly sourceCache = new Map<string, Promise<Scene3DSource>>();
  private readonly placed: PlacedAsset[] = [];

  private catalog: WorldLabAssetEntry[] = [];
  private catalogRoot = '';
  private nextId = 1;

  // Animation playback state (both embedded glTF clips and WorldLab procedural ambient motion)
  private animationsEnabled = true;
  private elapsedSeconds = 0;

  // Live 3D ghost preview state
  private ghostModel: Model3D | null = null;
  private ghostParent: Container3D | null = null;
  private ghostKey: string | null = null;
  private ghostMaterials: BaseMaterial3D[] = [];
  private ghostMetrics: ModelMetrics | null = null;
  private ghostLoadToken = 0;

  // Shared grounding shadow disc & optional unlit dark cave void material
  private readonly shadowDiscGeo: CylinderGeometry;
  private readonly shadowDiscMat: FlatMaterial;
  private readonly caveVoidMat: FlatMaterial;

  constructor(
    surfaceGrid: TerrainGrid,
    surfacePropsRoot: Container3D,
    interiorGrid?: TerrainGrid,
    interiorPropsRoot?: Container3D
  ) {
    this.grid = surfaceGrid;
    this.propsRoot = surfacePropsRoot;
    this.interiorGrid = interiorGrid ?? surfaceGrid;
    this.interiorPropsRoot = interiorPropsRoot ?? surfacePropsRoot;
    this.shadowDiscGeo = new CylinderGeometry({
      radiusTop: 1,
      radiusBottom: 1,
      height: 0.02,
      radialSegments: 16,
    });
    this.shadowDiscMat = new FlatMaterial({
      baseColor: 0x0b1016,
      alphaMode: 'blend',
      alpha: 0.28,
    });
    this.caveVoidMat = new FlatMaterial({
      baseColor: 0xffffff,
      vertexColors: true,
      doubleSided: true,
    });
  }

  private gridForLayer(layer: MapLayerId): TerrainGrid {
    return layer === 'interior' ? this.interiorGrid : this.grid;
  }

  private rootForLayer(layer: MapLayerId): Container3D {
    return layer === 'interior' ? this.interiorPropsRoot : this.propsRoot;
  }

  private offsetYForLayer(layer: MapLayerId): number {
    return layer === 'interior' ? this.interiorOffsetY : 0;
  }

  get currentLayer(): MapLayerId {
    return this.activeLayer;
  }

  setActiveLayer(layer: MapLayerId): void {
    this.activeLayer = layer;
    if (this.ghostModel) {
      const targetRoot = this.rootForLayer(layer);
      if (this.ghostParent !== targetRoot) {
        this.ghostParent?.removeChild(this.ghostModel);
        targetRoot.addChild(this.ghostModel);
        this.ghostParent = targetRoot;
      }
    }
  }

  setInteriorOffsetY(offsetMeters: number): void {
    this.interiorOffsetY = offsetMeters;
  }

  get autoCaveVoidEnabled(): boolean {
    return this._autoCaveVoidEnabled;
  }

  setAutoCaveVoidEnabled(enabled: boolean): void {
    this._autoCaveVoidEnabled = enabled;
  }

  get roofCutawayManual(): boolean {
    return this._roofCutawayManual;
  }

  get roofCutawayActive(): boolean {
    return this._roofCutawayManual || this._roofCutawayAutoActive;
  }

  get roofCutawayMode(): RoofCutawayMode {
    return this._roofCutawayMode;
  }

  get autoCutawayEnabled(): boolean {
    return this._autoCutawayEnabled;
  }

  get autoCutawayZoomThreshold(): number {
    return this._autoCutawayZoomThreshold;
  }

  isRoofProp(p: PlacedAsset): boolean {
    return p.roofLayer;
  }

  countRoofProps(): number {
    let count = 0;
    for (const p of this.placed) {
      if (p.roofLayer) count++;
    }
    return count;
  }

  setRoofCutaway(enabled: boolean): void {
    if (this._roofCutawayManual === enabled) return;
    this._roofCutawayManual = enabled;
    this.refreshAllPropVisibility();
  }

  setRoofCutawayMode(mode: RoofCutawayMode): void {
    if (this._roofCutawayMode === mode) return;
    this._roofCutawayMode = mode;
    this.refreshAllPropVisibility();
  }

  setAutoCutawayOnZoom(enabled: boolean, thresholdMeters?: number): void {
    this._autoCutawayEnabled = enabled;
    if (thresholdMeters !== undefined && Number.isFinite(thresholdMeters)) {
      this._autoCutawayZoomThreshold = Math.max(8, Math.min(40, thresholdMeters));
    }
    if (!enabled && this._roofCutawayAutoActive) {
      this._roofCutawayAutoActive = false;
      this.refreshAllPropVisibility();
    }
  }

  /** Updates automatic Roof Cutaway from camera zoom / top-down state; returns true if effective cutaway changed. */
  updateCameraCutaway(orbitDistanceMeters: number, isTopDown: boolean): boolean {
    const prevActive = this.roofCutawayActive;
    const nextAuto =
      this._autoCutawayEnabled && (isTopDown || orbitDistanceMeters <= this._autoCutawayZoomThreshold);
    if (this._roofCutawayAutoActive !== nextAuto) {
      this._roofCutawayAutoActive = nextAuto;
    }
    const nextActive = this.roofCutawayActive;
    if (nextActive !== prevActive) {
      this.refreshAllPropVisibility();
      return true;
    }
    return false;
  }

  setPlacedRoofLayer(id: string, isRoof: boolean): PlacedAsset | null {
    const p = this.getById(id);
    if (!p) return null;
    p.roofLayer = isRoof;
    this.applySurfaceGhostToProp(p);
    return p;
  }

  private refreshAllPropVisibility(): void {
    for (const p of this.placed) {
      this.applySurfaceGhostToProp(p);
    }
  }

  /** Renders Surface props as a faint translucent ghost while editing the Interior layer below. */
  setSurfaceGhost(ghosted: boolean): void {
    if (this.surfaceGhosted === ghosted) return;
    this.surfaceGhosted = ghosted;
    this.refreshAllPropVisibility();
  }

  private applySurfaceGhostToProp(p: PlacedAsset): void {
    const cutRoof = p.roofLayer && this.roofCutawayActive;
    const hideProp = cutRoof && this._roofCutawayMode === 'hidden';
    const ghostProp =
      !hideProp &&
      ((cutRoof && this._roofCutawayMode === 'ghost') || (p.layer === 'surface' && this.surfaceGhosted));

    p.model.visible = !hideProp;
    if (p.caveVoidMesh) {
      p.caveVoidMesh.visible = p.caveVoidEnabled && p.model.visible;
    }

    if (ghostProp) {
      for (const mat of p.flatMaterials) {
        mat.alphaMode = 'blend';
        mat.alpha = 0.22;
      }
      if (p.shadowDisc) p.shadowDisc.visible = false;
    } else {
      for (let i = 0; i < p.flatMaterials.length; i++) {
        const mat = p.flatMaterials[i]!;
        const saved = p.savedMaterialAlphas[i];
        if (saved) {
          mat.alphaMode = saved.alphaMode;
          mat.alpha = saved.alpha;
        }
      }
      if (p.shadowDisc) p.shadowDisc.visible = !hideProp && p.yOffsetFeet <= 0.25;
    }
  }

  getPlacedForLayer(layer: MapLayerId): PlacedAsset[] {
    return this.placed.filter((p) => p.layer === layer);
  }

  get animationsActive(): boolean {
    return this.animationsEnabled;
  }

  setAnimationsEnabled(enabled: boolean): void {
    this.animationsEnabled = enabled;
    if (!enabled) {
      // Restore crisp resting base transforms immediately on pause
      for (const p of this.placed) {
        this.applyPlacedTransform(p);
      }
    }
  }

  /**
   * Advances ONLY embedded glTF animations already present in loaded GLB files
   * (e.g. morph-target torch flames) and their flame emissive pulse.
   * Non-animated solid models stay completely rigid (no procedural bobbing/scaling).
   */
  tickAnimations(ticker: Ticker): void {
    if (!this.animationsEnabled) return;
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    this.elapsedSeconds += dt;

    for (const p of this.placed) {
      if (p.model.player && p.model.player.playing) {
        p.model.player.update(ticker);
      }
      if (p.flameMaterials.length > 0) {
        const strength = evaluateFlameEmissiveStrength(this.elapsedSeconds, p.animPhase);
        for (const fm of p.flameMaterials) {
          if (fm.emissive) {
            fm.emissive.strength = strength;
          }
        }
      }
    }
  }

  /**
   * Normalizes loaded GLB materials for crisp WorldLab flat-faceted shading without inverted faces:
   *  - Opaque closed solids force `doubleSided: false` so hardware back-face culling runs cleanly.
   *  - Textured alpha-blended foliage cards upgrade to `alphaMode: 'mask'` (`depthMask = true`).
   *  - Blender emission-fallback materials (black baseColor + white emissive, e.g. greyvein)
   *    convert to lit matte stone/wood/iron colors.
   *  - Flame materials (`Flame rim`, `Flame body`, `Flame core`) receive a warm self-lit glow.
   */
  private cloneNormalizedMaterial(
    mat: BaseMaterial3D,
    ghost = false,
    flameOut?: Material3D[]
  ): BaseMaterial3D {
    const baseTex = mat.textures.baseColor;
    const hasBaseTex = baseTex !== undefined && baseTex !== Texture.WHITE;
    const isAlphaFoliage = hasBaseTex && (mat.alphaMode === 'blend' || mat.alphaMode === 'mask');
    const label = mat.label ?? '';
    const isFlameMat = /\b(flame|fire|ember|embers)\b/i.test(label);

    if (mat instanceof Material3D) {
      const hasBlackBase = !hasBaseTex && mat.baseColor === 0x000000;
      const hasEmissive = mat.emissive !== undefined && mat.emissive.color !== 0x000000 && mat.emissive.strength > 0;
      const fallbackStone = hasBlackBase && hasEmissive ? resolveUnlitEmissiveFallbackColor(label) : null;

      const copy = mat.clone({
        flatShading: true,
        roughness: 0.98,
        metallic: 0.0,
        doubleSided: isAlphaFoliage ? true : false,
        ...(isAlphaFoliage && !ghost
          ? { alphaMode: 'mask', alphaCutoff: Math.max(0.45, mat.alphaCutoff || 0.45) }
          : {}),
        ...(ghost ? { alphaMode: 'blend', alpha: 0.55 } : {}),
        ...(fallbackStone !== null
          ? { baseColor: fallbackStone, emissive: { color: 0x000000, strength: 0 } }
          : isFlameMat && !ghost
            ? { emissive: { color: mat.baseColor || 0xff7b1c, strength: 1.75 } }
            : {}),
      });
      if (isFlameMat && !ghost && flameOut && copy instanceof Material3D) {
        flameOut.push(copy);
      }
      return copy;
    }

    return mat.clone({
      flatShading: true,
      doubleSided: isAlphaFoliage ? true : false,
      ...(isAlphaFoliage && !ghost
        ? { alphaMode: 'mask', alphaCutoff: Math.max(0.45, mat.alphaCutoff || 0.45) }
        : {}),
      ...(ghost ? { alphaMode: 'blend', alpha: 0.55 } : {}),
    });
  }

  /** Applies WorldLab's crisp flat-faceted matte low-poly shading and culling repair to a Model3D. */
  private applyWorldLabFlatShading(
    model: Model3D,
    ghost = false
  ): { materials: BaseMaterial3D[]; flameMaterials: Material3D[] } {
    const materials: BaseMaterial3D[] = [];
    const flameMaterials: Material3D[] = [];
    model.materials = (mat) => {
      const copy = this.cloneNormalizedMaterial(mat, ghost, flameMaterials);
      materials.push(copy);
      return copy;
    };
    return { materials, flameMaterials };
  }

  private createShadowDisc(entry: WorldLabAssetEntry, layer: MapLayerId): Mesh3D | null {
    if (
      entry.category === 'architecture' ||
      entry.category === 'fx' ||
      isWallDecorEntry(entry) ||
      preservesAuthoredMountHeight(entry)
    ) {
      return null;
    }
    const disc = new Mesh3D({
      geometry: this.shadowDiscGeo,
      material: this.shadowDiscMat,
      castShadow: false,
      receiveShadow: false,
      label: `shadow_disc_${entry.key}`,
    });
    this.rootForLayer(layer).addChild(disc);
    return disc;
  }

  private createCaveVoidForPlaced(
    entry: WorldLabAssetEntry,
    id: string,
    localSizeX: number,
    localSizeY: number,
    layer: MapLayerId
  ): Mesh3D {
    const w = localSizeX > 0.5 ? localSizeX : Math.max(2, entry.nominalWidthTiles);
    const h = localSizeY > 0.5 ? localSizeY : 2.35;
    const mesh = createCaveVoidMesh(w, h, 2.55, this.caveVoidMat, `cave_void_${entry.key}#${id}`);
    this.rootForLayer(layer).addChild(mesh);
    return mesh;
  }

  private disposePlacedResources(p: PlacedAsset): void {
    const parent = this.rootForLayer(p.layer);
    p.model.player?.stop();
    parent.removeChild(p.model);
    p.model.destroy({ children: true });
    for (const m of p.flatMaterials) m.destroy();
    p.flatMaterials = [];
    p.savedMaterialAlphas = [];
    p.flameMaterials = [];
    if (p.shadowDisc) {
      parent.removeChild(p.shadowDisc);
      p.shadowDisc.destroy();
      p.shadowDisc = null;
    }
    if (p.caveVoidMesh) {
      parent.removeChild(p.caveVoidMesh);
      p.caveVoidMesh.geometry.destroy(true);
      p.caveVoidMesh.destroy();
      p.caveVoidMesh = null;
    }
  }

  get entries(): readonly WorldLabAssetEntry[] {
    return this.catalog;
  }

  get rootPath(): string {
    return this.catalogRoot;
  }

  get placedAssets(): readonly PlacedAsset[] {
    return this.placed;
  }

  /** Returns placed props on the active layer as wall-support candidates for Wall Decoration snapping. */
  getWallSupportCandidates(): WallSupportCandidate[] {
    return this.placed
      .filter((p) => p.layer === this.activeLayer)
      .map((p) => ({
        id: p.id,
        entry: p.entry,
        tileX: p.tileX,
        tileZ: p.tileZ,
        rotationDegrees: p.rotationDegrees,
        worldHalfX: p.localSizeX * p.baseScaleX * p.scaleX * 0.5,
        worldHalfZ: p.localSizeZ * p.baseScaleZ * p.scaleZ * 0.5,
      }));
  }

  /** Returns exact world-space bounding boxes of placed props on the active layer for 3D model-on-model stacking. */
  getStackablePropBounds(): StackablePropBounds[] {
    const grid = this.gridForLayer(this.activeLayer);
    const offsetY = this.offsetYForLayer(this.activeLayer);
    return this.placed
      .filter((p) => p.layer === this.activeLayer && p.model.visible)
      .map((p) => computePlacedWorldBounds(grid, p, offsetY));
  }

  /** Raycasts directly against placed props on the active layer (picks top stacked props cleanly). */
  pickPlacedByRay(ray: Ray3): PlacedAsset | null {
    const grid = this.gridForLayer(this.activeLayer);
    const offsetY = this.offsetYForLayer(this.activeLayer);
    let best: PlacedAsset | null = null;
    let bestT = Infinity;
    for (const p of this.placed) {
      if (p.layer !== this.activeLayer || !p.model.visible) continue;
      const b = computePlacedWorldBounds(grid, p, offsetY);
      let tMin = 0;
      let tMax = Infinity;
      const axes: readonly [number, number, number, number][] = [
        [ray.originX, ray.dirX, b.minX, b.maxX],
        [ray.originY, ray.dirY, b.minY, b.maxY],
        [ray.originZ, ray.dirZ, b.minZ, b.maxZ],
      ];
      let hit = true;
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-8) {
          if (o < lo || o > hi) {
            hit = false;
            break;
          }
          continue;
        }
        const inv = 1 / d;
        let t1 = (lo - o) * inv;
        let t2 = (hi - o) * inv;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) {
          hit = false;
          break;
        }
      }
      if (hit && tMin >= 0 && tMin < bestT) {
        bestT = tMin;
        best = p;
      }
    }
    return best;
  }

  async loadCatalog(): Promise<readonly WorldLabAssetEntry[]> {
    try {
      const res = await fetch('vtt-3d://catalog.json');
      if (!res.ok) return [];
      const data = (await res.json()) as { root?: string; assets?: WorldLabAssetEntry[] };
      this.catalogRoot = data.root ?? '';
      this.catalog = Array.isArray(data.assets) ? data.assets : [];
      return this.catalog;
    } catch {
      return [];
    }
  }

  getPacks(): string[] {
    const set = new Set<string>();
    for (const e of this.catalog) set.add(e.pack);
    return Array.from(set).sort();
  }

  private measureModel(model: Model3D, entry: WorldLabAssetEntry, policy: AssetScalePolicy): ModelMetrics {
    const bounds = model.getLocalBounds();
    const size = bounds.getSize();
    const center = bounds.getCenter();

    const localSizeX = Number.isFinite(size.x) ? Math.max(0, size.x) : 0;
    const localSizeY = Number.isFinite(size.y) ? Math.max(0, size.y) : 0;
    const localSizeZ = Number.isFinite(size.z) ? Math.max(0, size.z) : 0;

    const scales = computeModelBaseScales(
      entry,
      { x: localSizeX, y: localSizeY, z: localSizeZ },
      policy
    );

    return {
      baseScaleX: scales.x,
      baseScaleY: scales.y,
      baseScaleZ: scales.z,
      localMinY: Number.isFinite(bounds.min.y) ? bounds.min.y : 0,
      localCenterX: Number.isFinite(center.x) ? center.x : 0,
      localCenterZ: Number.isFinite(center.z) ? center.z : 0,
      localSizeX,
      localSizeY,
      localSizeZ,
    };
  }

  private loadSource(entry: WorldLabAssetEntry): Promise<Scene3DSource> {
    const existing = this.sourceCache.get(entry.glbUrl);
    if (existing) return existing;
    const promise = Assets.load<Scene3DSource>(entry.glbUrl)
      .then((source) => {
        normalizeSceneSourceWinding(source);
        return source;
      })
      .catch((err: unknown) => {
        this.sourceCache.delete(entry.glbUrl);
        throw err;
      });
    this.sourceCache.set(entry.glbUrl, promise);
    return promise;
  }

  private applyModelTransform(
    model: Model3D,
    entry: WorldLabAssetEntry,
    tileX: number,
    tileZ: number,
    rotationDegrees: number,
    baseScaleX: number,
    baseScaleY: number,
    baseScaleZ: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    yOffsetFeet: number,
    localMinY: number,
    localCenterX: number,
    localCenterZ: number,
    layer: MapLayerId = this.activeLayer
  ): void {
    const worldX = tileX * TILE_SIZE_METERS;
    const worldZ = tileZ * TILE_SIZE_METERS;
    const groundY = this.gridForLayer(layer).sampleHeightAtTileCoord(tileX, tileZ) * METERS_PER_HEIGHT_UNIT;
    const extraY = yOffsetFeet * METERS_PER_FOOT;

    const sx = baseScaleX * scaleX;
    const sy = baseScaleY * scaleY;
    const sz = baseScaleZ * scaleZ;
    const yaw = (rotationDegrees * Math.PI) / 180;

    model.scale.set(sx, sy, sz);
    model.rotation.set(0, yaw, 0);

    // Preserve authored wall/roof mount heights (e.g. wall_torch minY=0.67, wall_cresset minY=1.14)
    // instead of slamming elevated wall fixtures down to the floor!
    const keepAuthoredY = preservesAuthoredMountHeight(entry);
    const posY = keepAuthoredY ? groundY + extraY : groundY + extraY - localMinY * sy;

    // For wall decorations, keep local Z = 0 (the authored mounting backplate!) flush on the
    // wall face while centering horizontally along local X. For ground/arch assets, center both X & Z.
    const anchorX = localCenterX;
    const anchorZ = isWallDecorEntry(entry) ? 0 : localCenterZ;

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const offX = anchorX * sx * cos + anchorZ * sz * sin;
    const offZ = -anchorX * sx * sin + anchorZ * sz * cos;
    model.position.set(worldX - offX, posY, worldZ - offZ);
  }

  private startEmbeddedAnimations(model: Model3D, source: Scene3DSource, phase01: number): void {
    const clipNames = Object.keys(source.animations);
    if (clipNames.length === 0 || !model.player) return;
    const firstClip = clipNames[0]!;
    const state = model.player.play(firstClip);
    state.loop = true;
    const duration = state.animation.duration;
    if (duration > 0) {
      state.time = phase01 * duration;
    }
  }

  // ---- Live 3D Ghost Preview ----

  hideGhostPreview(): void {
    if (this.ghostModel) {
      this.ghostModel.visible = false;
    }
  }

  private destroyGhost(): void {
    if (this.ghostModel) {
      (this.ghostParent ?? this.propsRoot).removeChild(this.ghostModel);
      this.ghostModel.destroy({ children: true });
      this.ghostModel = null;
      this.ghostParent = null;
    }
    for (const mat of this.ghostMaterials) {
      mat.destroy();
    }
    this.ghostMaterials = [];
    this.ghostKey = null;
    this.ghostMetrics = null;
  }

  updateGhostPreview(
    entry: WorldLabAssetEntry | null,
    tileX: number,
    tileZ: number,
    transform: AssetTransformOptions
  ): void {
    if (!entry) {
      this.hideGhostPreview();
      return;
    }

    if (this.ghostModel && this.ghostKey === entry.key && this.ghostMetrics) {
      const scales = computeModelBaseScales(
        entry,
        {
          x: this.ghostMetrics.localSizeX,
          y: this.ghostMetrics.localSizeY,
          z: this.ghostMetrics.localSizeZ,
        },
        transform.scalePolicy
      );
      this.ghostModel.visible = true;
      this.applyModelTransform(
        this.ghostModel,
        entry,
        tileX,
        tileZ,
        transform.rotationDegrees,
        scales.x,
        scales.y,
        scales.z,
        transform.scaleX,
        transform.scaleY,
        transform.scaleZ,
        transform.yOffsetFeet,
        this.ghostMetrics.localMinY,
        this.ghostMetrics.localCenterX,
        this.ghostMetrics.localCenterZ
      );
      return;
    }

    const token = ++this.ghostLoadToken;
    this.destroyGhost();
    this.ghostKey = entry.key;

    void this.loadSource(entry)
      .then((source) => {
        if (token !== this.ghostLoadToken) return;
        const model = new Model3D({
          source,
          castShadow: false,
          receiveShadow: false,
          autoPlay: false,
          autoUpdate: false,
          label: `ghost_preview_${entry.key}`,
        });

        const { materials } = this.applyWorldLabFlatShading(model, true);
        const metrics = this.measureModel(model, entry, transform.scalePolicy);
        const targetRoot = this.rootForLayer(this.activeLayer);
        this.ghostModel = model;
        this.ghostParent = targetRoot;
        this.ghostMaterials = materials;
        this.ghostMetrics = metrics;
        targetRoot.addChild(model);

        this.applyModelTransform(
          model,
          entry,
          tileX,
          tileZ,
          transform.rotationDegrees,
          metrics.baseScaleX,
          metrics.baseScaleY,
          metrics.baseScaleZ,
          transform.scaleX,
          transform.scaleY,
          transform.scaleZ,
          transform.yOffsetFeet,
          metrics.localMinY,
          metrics.localCenterX,
          metrics.localCenterZ
        );
      })
      .catch(() => {
        if (token === this.ghostLoadToken) {
          this.ghostKey = null;
        }
      });
  }

  // ---- Placement, Selection, Resizing & Replacing ----

  async placeAsset(
    entry: WorldLabAssetEntry,
    tileX: number,
    tileZ: number,
    transform: Partial<AssetTransformOptions> = {}
  ): Promise<PlacedAsset> {
    const source = await this.loadSource(entry);
    const id = `prop_${this.nextId++}`;
    const hasEmbedded = Object.keys(source.animations).length > 0;
    const model = new Model3D({
      source,
      castShadow: true,
      receiveShadow: true,
      autoPlay: false,
      autoUpdate: false,
      label: `${entry.key}#${id}`,
    });
    const layer: MapLayerId = transform.layer ?? this.activeLayer;
    const { materials: flatMaterials, flameMaterials } = this.applyWorldLabFlatShading(model, false);
    const shadowDisc = this.createShadowDisc(entry, layer);

    const policy = transform.scalePolicy ?? 'auto_dnd';
    const metrics = this.measureModel(model, entry, policy);
    const animKind = hasEmbedded ? 'gltf_clip' : classifyAmbientAnimation(entry);
    const animPhase = stablePhase(id, entry.key);
    const savedMaterialAlphas = flatMaterials.map((m) => ({ alphaMode: m.alphaMode, alpha: m.alpha }));
    const caveVoidEnabled = transform.caveVoid ?? (this._autoCaveVoidEnabled && isCaveMouthEntry(entry));
    const roofLayer = transform.roofLayer ?? isRoofCutawayEntry(entry);
    const caveVoidMesh = caveVoidEnabled
      ? this.createCaveVoidForPlaced(entry, id, metrics.localSizeX, metrics.localSizeY, layer)
      : null;

    if (hasEmbedded) {
      this.startEmbeddedAnimations(model, source, animPhase);
    }

    const placed: PlacedAsset = {
      id,
      layer,
      entry,
      model,
      flatMaterials,
      savedMaterialAlphas,
      flameMaterials,
      shadowDisc,
      caveVoidMesh,
      caveVoidEnabled,
      roofLayer,
      tileX,
      tileZ,
      rotationDegrees: (((transform.rotationDegrees ?? 0) % 360) + 360) % 360,
      scalePolicy: policy,
      baseScaleX: metrics.baseScaleX,
      baseScaleY: metrics.baseScaleY,
      baseScaleZ: metrics.baseScaleZ,
      scaleX: transform.scaleX ?? 1,
      scaleY: transform.scaleY ?? 1,
      scaleZ: transform.scaleZ ?? 1,
      yOffsetFeet: transform.yOffsetFeet ?? 0,
      localMinY: metrics.localMinY,
      localCenterX: metrics.localCenterX,
      localCenterZ: metrics.localCenterZ,
      localSizeX: metrics.localSizeX,
      localSizeY: metrics.localSizeY,
      localSizeZ: metrics.localSizeZ,
      wallDecorMode: transform.wallDecorMode,
      wallSide: transform.wallSide,
      animKind,
      animPhase,
    };

    this.applyPlacedTransform(placed);
    this.applySurfaceGhostToProp(placed);
    this.rootForLayer(layer).addChild(model);
    this.placed.push(placed);
    return placed;
  }

  private applyPlacedTransform(p: PlacedAsset): void {
    const layerGrid = this.gridForLayer(p.layer);
    this.applyModelTransform(
      p.model,
      p.entry,
      p.tileX,
      p.tileZ,
      p.rotationDegrees,
      p.baseScaleX,
      p.baseScaleY,
      p.baseScaleZ,
      p.scaleX,
      p.scaleY,
      p.scaleZ,
      p.yOffsetFeet,
      p.localMinY,
      p.localCenterX,
      p.localCenterZ,
      p.layer
    );
    if (p.caveVoidMesh) {
      const worldX = p.tileX * TILE_SIZE_METERS;
      const worldZ = p.tileZ * TILE_SIZE_METERS;
      const groundY = layerGrid.sampleHeightAtTileCoord(p.tileX, p.tileZ) * METERS_PER_HEIGHT_UNIT;
      const extraY = p.yOffsetFeet * METERS_PER_FOOT;
      const sx = p.baseScaleX * p.scaleX;
      const sy = p.baseScaleY * p.scaleY;
      const sz = p.baseScaleZ * p.scaleZ;
      const yaw = (p.rotationDegrees * Math.PI) / 180;
      p.caveVoidMesh.position.set(worldX, groundY + extraY, worldZ);
      p.caveVoidMesh.rotation.set(0, yaw, 0);
      p.caveVoidMesh.scale.set(sx, sy, sz);
      p.caveVoidMesh.visible = p.caveVoidEnabled && p.model.visible;
    }
    if (p.shadowDisc) {
      const stackedElevated = p.yOffsetFeet > 0.25;
      p.shadowDisc.visible = !stackedElevated && !(p.layer === 'surface' && this.surfaceGhosted);
      if (!stackedElevated) {
        const groundY = layerGrid.sampleHeightAtTileCoord(p.tileX, p.tileZ) * METERS_PER_HEIGHT_UNIT;
        const worldHalfX = p.localSizeX * p.baseScaleX * p.scaleX * 0.44;
        const worldHalfZ = p.localSizeZ * p.baseScaleZ * p.scaleZ * 0.44;
        const rx = Math.max(0.45, Math.min(4.5, worldHalfX));
        const rz = Math.max(0.45, Math.min(4.5, worldHalfZ));
        const yaw = (p.rotationDegrees * Math.PI) / 180;
        p.shadowDisc.position.set(p.tileX * TILE_SIZE_METERS, groundY + 0.03, p.tileZ * TILE_SIZE_METERS);
        p.shadowDisc.rotation.set(0, yaw, 0);
        p.shadowDisc.scale.set(rx, 1, rz);
      }
    }
  }

  /** Toggles the optional unlit dark cave void backing shell on a specific placed asset. */
  setPlacedCaveVoid(id: string, enabled: boolean): PlacedAsset | null {
    const p = this.getById(id);
    if (!p) return null;
    p.caveVoidEnabled = enabled;
    if (enabled && !p.caveVoidMesh) {
      p.caveVoidMesh = this.createCaveVoidForPlaced(p.entry, p.id, p.localSizeX, p.localSizeY, p.layer);
    } else if (!enabled && p.caveVoidMesh) {
      this.rootForLayer(p.layer).removeChild(p.caveVoidMesh);
      p.caveVoidMesh.geometry.destroy(true);
      p.caveVoidMesh.destroy();
      p.caveVoidMesh = null;
    }
    this.applyPlacedTransform(p);
    return p;
  }

  getById(id: string | null): PlacedAsset | null {
    if (!id) return null;
    return this.placed.find((p) => p.id === id) ?? null;
  }

  findNearest(tileX: number, tileZ: number, maxDistTiles = 1.35): PlacedAsset | null {
    let best: PlacedAsset | null = null;
    let bestScore = Infinity;
    for (const p of this.placed) {
      if (p.layer !== this.activeLayer) continue;
      const rot = getRotatedFootprint(p.entry, p.rotationDegrees);
      const reach = Math.max(maxDistTiles, Math.hypot(rot.widthTiles * 0.5, rot.lengthTiles * 0.5) + 0.35);
      const d = Math.hypot(p.tileX - tileX, p.tileZ - tileZ);
      if (d <= reach && d < bestScore) {
        bestScore = d;
        best = p;
      }
    }
    return best;
  }

  updatePlacedTransform(
    id: string,
    patch: Partial<{
      tileX: number;
      tileZ: number;
      rotationDegrees: number;
      scalePolicy: AssetScalePolicy;
      scaleX: number;
      scaleY: number;
      scaleZ: number;
      yOffsetFeet: number;
      wallDecorMode: WallDecorMode;
      wallSide: 'N' | 'S' | 'E' | 'W' | 'DIAG';
    }>
  ): PlacedAsset | null {
    const p = this.getById(id);
    if (!p) return null;

    if (patch.tileX !== undefined) p.tileX = patch.tileX;
    if (patch.tileZ !== undefined) p.tileZ = patch.tileZ;
    if (patch.rotationDegrees !== undefined) {
      p.rotationDegrees = ((patch.rotationDegrees % 360) + 360) % 360;
    }
    if (patch.scalePolicy !== undefined && patch.scalePolicy !== p.scalePolicy) {
      const scales = computeModelBaseScales(
        p.entry,
        { x: p.localSizeX, y: p.localSizeY, z: p.localSizeZ },
        patch.scalePolicy
      );
      p.baseScaleX = scales.x;
      p.baseScaleY = scales.y;
      p.baseScaleZ = scales.z;
      p.scalePolicy = patch.scalePolicy;
    }
    if (patch.scaleX !== undefined) p.scaleX = Math.max(0.1, Math.min(8, patch.scaleX));
    if (patch.scaleY !== undefined) p.scaleY = Math.max(0.1, Math.min(8, patch.scaleY));
    if (patch.scaleZ !== undefined) p.scaleZ = Math.max(0.1, Math.min(8, patch.scaleZ));
    if (patch.yOffsetFeet !== undefined) p.yOffsetFeet = Math.max(-20, Math.min(40, patch.yOffsetFeet));
    if (patch.wallDecorMode !== undefined) p.wallDecorMode = patch.wallDecorMode;
    if (patch.wallSide !== undefined) p.wallSide = patch.wallSide;

    this.applyPlacedTransform(p);
    return p;
  }

  /**
   * Replaces a placed asset in-place with a different GLB while keeping its
   * exact tile position, rotation, Y offset, and (by default) scale multipliers.
   */
  async replacePlacedAsset(
    id: string,
    newEntry: WorldLabAssetEntry,
    preserveScaleMultipliers = true
  ): Promise<PlacedAsset | null> {
    const p = this.getById(id);
    if (!p) return null;

    const source = await this.loadSource(newEntry);
    const hasEmbedded = Object.keys(source.animations).length > 0;
    const nextModel = new Model3D({
      source,
      castShadow: true,
      receiveShadow: true,
      autoPlay: false,
      autoUpdate: false,
      label: `${newEntry.key}#${p.id}`,
    });
    const { materials: nextFlatMaterials, flameMaterials: nextFlameMaterials } =
      this.applyWorldLabFlatShading(nextModel, false);
    const metrics = this.measureModel(nextModel, newEntry, p.scalePolicy);

    this.disposePlacedResources(p);

    p.entry = newEntry;
    p.model = nextModel;
    p.flatMaterials = nextFlatMaterials;
    p.savedMaterialAlphas = nextFlatMaterials.map((m) => ({ alphaMode: m.alphaMode, alpha: m.alpha }));
    p.flameMaterials = nextFlameMaterials;
    p.shadowDisc = this.createShadowDisc(newEntry, p.layer);
    p.caveVoidMesh = p.caveVoidEnabled
      ? this.createCaveVoidForPlaced(newEntry, p.id, metrics.localSizeX, metrics.localSizeY, p.layer)
      : null;
    p.baseScaleX = metrics.baseScaleX;
    p.baseScaleY = metrics.baseScaleY;
    p.baseScaleZ = metrics.baseScaleZ;
    p.localMinY = metrics.localMinY;
    p.localCenterX = metrics.localCenterX;
    p.localCenterZ = metrics.localCenterZ;
    p.localSizeX = metrics.localSizeX;
    p.localSizeY = metrics.localSizeY;
    p.localSizeZ = metrics.localSizeZ;
    p.animKind = hasEmbedded ? 'gltf_clip' : classifyAmbientAnimation(newEntry);
    p.animPhase = stablePhase(p.id, newEntry.key);
    if (hasEmbedded) {
      this.startEmbeddedAnimations(nextModel, source, p.animPhase);
    }
    if (!preserveScaleMultipliers) {
      p.scaleX = 1;
      p.scaleY = 1;
      p.scaleZ = 1;
    }

    this.applyPlacedTransform(p);
    this.applySurfaceGhostToProp(p);
    this.rootForLayer(p.layer).addChild(nextModel);
    return p;
  }

  /** Batch-replaces every placed prop matching `oldKey` with `newEntry`. */
  async replaceAllOfKey(
    oldKey: string,
    newEntry: WorldLabAssetEntry,
    preserveScaleMultipliers = true
  ): Promise<number> {
    const targets = this.placed.filter((p) => p.entry.key === oldKey).map((p) => p.id);
    let count = 0;
    for (const id of targets) {
      const updated = await this.replacePlacedAsset(id, newEntry, preserveScaleMultipliers);
      if (updated) count++;
    }
    return count;
  }

  async duplicateAsset(id: string, offsetTilesX = 1, offsetTilesZ = 0): Promise<PlacedAsset | null> {
    const src = this.getById(id);
    if (!src) return null;
    const rot = getRotatedFootprint(src.entry, src.rotationDegrees);
    const stepX = offsetTilesX !== 0 ? Math.sign(offsetTilesX) * rot.widthTiles : 0;
    const stepZ = offsetTilesZ !== 0 ? Math.sign(offsetTilesZ) * rot.lengthTiles : 0;
    const nextX = Math.max(rot.widthTiles * 0.5, Math.min(this.grid.width - rot.widthTiles * 0.5, src.tileX + stepX));
    const nextZ = Math.max(rot.lengthTiles * 0.5, Math.min(this.grid.length - rot.lengthTiles * 0.5, src.tileZ + stepZ));
    return this.placeAsset(src.entry, nextX, nextZ, {
      layer: src.layer,
      rotationDegrees: src.rotationDegrees,
      scalePolicy: src.scalePolicy,
      scaleX: src.scaleX,
      scaleY: src.scaleY,
      scaleZ: src.scaleZ,
      yOffsetFeet: src.yOffsetFeet,
      wallDecorMode: src.wallDecorMode,
      wallSide: src.wallSide,
      caveVoid: src.caveVoidEnabled,
      roofLayer: src.roofLayer,
    });
  }

  getWorldRing(p: PlacedAsset): { x: number; y: number; z: number; radius: number } {
    const x = p.tileX * TILE_SIZE_METERS;
    const z = p.tileZ * TILE_SIZE_METERS;
    const y =
      this.gridForLayer(p.layer).sampleHeightAtTileCoord(p.tileX, p.tileZ) * METERS_PER_HEIGHT_UNIT +
      p.yOffsetFeet * METERS_PER_FOOT;
    const geomRadius = Math.hypot(
      p.localSizeX * p.baseScaleX * p.scaleX * 0.5,
      p.localSizeZ * p.baseScaleZ * p.scaleZ * 0.5
    );
    const footprintRadius =
      Math.hypot(p.entry.nominalWidthTiles * 0.5, p.entry.nominalLengthTiles * 0.5) * TILE_SIZE_METERS;
    const radius = Math.max(0.55, Math.max(geomRadius, footprintRadius * 0.9));
    return { x, y, z, radius };
  }

  /** Re-seats placed assets onto updated terrain heights after sculpting. */
  reseatAllOnTerrain(layer?: MapLayerId): void {
    for (const p of this.placed) {
      if (layer && p.layer !== layer) continue;
      this.applyPlacedTransform(p);
    }
  }

  removeById(id: string): PlacedAsset | null {
    const idx = this.placed.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const [removed] = this.placed.splice(idx, 1);
    if (!removed) return null;
    this.disposePlacedResources(removed);
    return removed;
  }

  removeLast(layer?: MapLayerId): PlacedAsset | null {
    if (!layer) {
      const last = this.placed.pop();
      if (!last) return null;
      this.disposePlacedResources(last);
      return last;
    }
    for (let i = this.placed.length - 1; i >= 0; i--) {
      if (this.placed[i]!.layer === layer) {
        const [removed] = this.placed.splice(i, 1);
        if (removed) this.disposePlacedResources(removed);
        return removed ?? null;
      }
    }
    return null;
  }

  removeNearest(tileX: number, tileZ: number, maxDistTiles = 1.25): PlacedAsset | null {
    const nearest = this.findNearest(tileX, tileZ, maxDistTiles);
    return nearest ? this.removeById(nearest.id) : null;
  }

  clearAll(layer?: MapLayerId): void {
    if (!layer) {
      for (const p of this.placed) {
        this.disposePlacedResources(p);
      }
      this.placed.length = 0;
      return;
    }
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const p = this.placed[i]!;
      if (p.layer === layer) {
        this.disposePlacedResources(p);
        this.placed.splice(i, 1);
      }
    }
  }

  /** Swaps the underlying Surface & Interior TerrainGrids when creating or loading a map of any size. */
  setGrids(nextSurfaceGrid: TerrainGrid, nextInteriorGrid?: TerrainGrid): void {
    this.clearAll();
    this.hideGhostPreview();
    this.grid = nextSurfaceGrid;
    this.interiorGrid = nextInteriorGrid ?? nextSurfaceGrid;
  }

  /** Backward-compatible alias for swapping the surface TerrainGrid. */
  setGrid(nextGrid: TerrainGrid): void {
    this.setGrids(nextGrid, nextGrid);
  }

  serializePlacedProps(): SerializedProp[] {
    return this.placed.map((p) => ({
      key: p.entry.key,
      ...(p.layer === 'interior' ? { layer: 'interior' as const } : {}),
      tileX: p.tileX,
      tileZ: p.tileZ,
      rotationDegrees: p.rotationDegrees,
      scalePolicy: p.scalePolicy,
      scaleX: p.scaleX,
      scaleY: p.scaleY,
      scaleZ: p.scaleZ,
      yOffsetFeet: p.yOffsetFeet,
      ...(p.wallDecorMode ? { wallDecorMode: p.wallDecorMode } : {}),
      ...(p.wallSide ? { wallSide: p.wallSide } : {}),
      ...(p.caveVoidEnabled ? { caveVoid: true } : {}),
      ...(p.roofLayer ? { roofLayer: true } : {}),
    }));
  }

  async loadSerializedProps(
    props: readonly SerializedProp[]
  ): Promise<{ loaded: number; missing: string[] }> {
    this.clearAll();
    const byKey = new Map<string, WorldLabAssetEntry>();
    for (const entry of this.catalog) {
      byKey.set(entry.key, entry);
    }

    let loaded = 0;
    const missing: string[] = [];
    for (const item of props) {
      const entry = byKey.get(item.key);
      if (!entry) {
        if (!missing.includes(item.key)) missing.push(item.key);
        continue;
      }
      try {
        await this.placeAsset(entry, item.tileX, item.tileZ, {
          layer: item.layer ?? 'surface',
          rotationDegrees: item.rotationDegrees,
          scalePolicy: item.scalePolicy,
          scaleX: item.scaleX,
          scaleY: item.scaleY,
          scaleZ: item.scaleZ,
          yOffsetFeet: item.yOffsetFeet,
          wallDecorMode: item.wallDecorMode,
          wallSide: item.wallSide,
          caveVoid: item.caveVoid,
          roofLayer: item.roofLayer,
        });
        loaded++;
      } catch {
        if (!missing.includes(item.key)) missing.push(item.key);
      }
    }
    return { loaded, missing };
  }

  destroy(): void {
    this.clearAll();
    this.destroyGhost();
    this.shadowDiscGeo.destroy(true);
    this.shadowDiscMat.destroy();
    this.caveVoidMat.destroy();
  }
}
