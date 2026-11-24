/**
 * Unified interactive viewport tool controller.
 *
 * Tools:
 *   - SCULPT: WorldLab vertex sculpting (11 modes, masks, slope limit, Grade drag, live markers)
 *   - PAINT: WorldLab Underlay / Overlay tile paint with Organic (all 12 RS2 shapes) or Blocky auto-tiler
 *   - CLIFF: WorldLab Detect / Force / Erase faceted cliff brush with RS2 auto-shaping
 *   - ASSET: Live 3D ghost preview, uniform/axis resizing, selection, dragging, and in-place/batch replacing
 *   - MEASURE: D&D 5ft / 1.5m 3D tactical distance & elevation ruler
 *   - ORBIT: Left-drag camera orbit/pan (Right-drag always orbits in 3D or pans in Top-Down)
 */

import {
  DEFAULT_INTERIOR_DEPTH_FEET,
  clampMapDimension,
  createDefaultInteriorGrid,
  createGridFromTemplate,
  gridFromMapDocument,
  interiorGridFromMapDocument,
  sanitizeMapId,
  serializeMapDocument,
  type CreateMapOptions,
  type MapLayerId,
  type VttMapDocument,
} from '../map/mapDocument';
import type { MapSaveTarget } from '../map/mapStorage';
import type { TerrainGrid } from '../terrain/terrainGrid';
import {
  MIN_LIQUID_SIZE_TILES,
  clampLiquidLevelFeet,
  clampLiquidOpacity,
  clampLiquidRectToMap,
  createContinuedLiquid,
  feetToWorldMeters,
  findAdjacentNeighbor,
  findConnectedLiquidIds,
  getLiquidPreset,
  intersectHorizontalPlane,
  pickLiquidEdgeHandle,
  pickLiquidSurface,
  quantizeStep,
  roundCoord,
  snapLiquidRectMove,
  snapPointToLiquidEdges,
  type LiquidEdgeSide,
  type LiquidPresetId,
  type LiquidRect,
  type LiquidSnapLine,
  type LiquidSurface,
} from '../terrain/liquidSurface';
import { DEFAULT_OVERLAY_ID, DEFAULT_UNDERLAY_ID, VOID_OVERLAY_ID } from '../terrain/materials';
import {
  METERS_PER_HEIGHT_UNIT,
  TILE_SIZE_FEET,
  TILE_SIZE_METERS,
  heightUnitsToFeet,
  heightUnitsToMeters,
} from '../terrain/constants';
import { pickTerrain, type Ray3, type TerrainPickHit } from '../terrain/raycast';
import type {
  AssetManager,
  AssetScalePolicy,
  AssetTransformOptions,
  WorldLabAssetEntry,
} from '../render/assetManager';
import type { LightingManager } from '../render/lightingSystem';
import type { LiquidRenderer } from '../render/liquidRenderer';
import { computeSnappedFootprint, getRotatedFootprint } from '../render/modelScalePolicy';
import { resolveStackPlacement, type StackSnapResult } from '../render/surfaceStacking';
import {
  isWallDecorEntry,
  resolveWallSnap,
  type WallDecorMode,
  type WallSnapResult,
} from '../render/wallDecoration';
import type { SceneManager } from '../render/sceneManager';
import type { BrushMarker, TerrainRenderer } from '../render/terrainRenderer';
import { autoPaintOverlaySeeds, paintManualOverlay } from './autoTiler';
import { applyCliffBrush, createDefaultCliffSettings, type CliffSettings } from './cliffTool';
import type { TerrainHistory} from './history';
import { TerrainStrokeRecorder } from './history';
import {
  applyGradeStroke,
  applySlopeLimit,
  createDefaultSculptSettings,
  evaluateSculptVertex,
  falloffWeight,
  sculptInfluence,
  vertexMatchesMask,
  type SculptSettings,
} from './sculptKernel';

export type ActiveToolId = 'SCULPT' | 'PAINT' | 'CLIFF' | 'LIQUID' | 'ASSET' | 'LIGHT' | 'MEASURE' | 'ORBIT';
export type PaintLayer = 'UNDERLAY' | 'OVERLAY' | 'ERASE_OVERLAY';
export type AssetSubMode = 'place' | 'select' | 'replace';
export type CliffSubMode = 'cliff' | 'hole' | 'shadow';
export type LiquidSubMode = 'draw' | 'edit';

export interface LiquidToolSettings {
  subMode: LiquidSubMode;
  preset: LiquidPresetId;
  levelFeet: number;
  opacity: number | null;
  snapStep: number;
  edgeSnap: boolean;
  linkConnected: boolean;
  defaultWidth: number;
  defaultLength: number;
  continueSpan: number;
  selectedLiquidId: string | null;
  pickingTerrainLevel: boolean;
}

export interface PaintSettings {
  layer: PaintLayer;
  underlayId: number;
  overlayId: number;
  overlayShape: number; // 1..12
  overlayRotation: number; // 0..3
  autoTile: boolean;
  radius: number;
  brushShape: 'CIRCLE' | 'SQUARE';
}

export interface HoleBrushSettings {
  action: 'CUTOUT' | 'RESTORE';
  radius: number;
  shape: 'CIRCLE' | 'SQUARE';
}

export interface ShadowBrushSettings {
  action: 'DARKEN' | 'LIGHTEN';
  radius: number;
  shape: 'CIRCLE' | 'SQUARE';
  strength: number; // 0.1..1.0
  maxDarkness: number; // 0.2..1.0
}

export interface AssetToolSettings {
  subMode: AssetSubMode;
  selectedAsset: WorldLabAssetEntry | null;
  selectedPlacedId: string | null;
  rotationDegrees: number;
  scalePolicy: AssetScalePolicy;
  uniformScale: boolean;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  yOffsetFeet: number;
  snapMode: 'center' | 'corner' | 'wall' | 'free';
  stackOnModels: boolean;
  wallDecorMode: WallDecorMode;
  wallOffsetFeet: number;
  preserveScaleOnReplace: boolean;
}

export interface HoverTelemetry {
  hit: TerrainPickHit | null;
  elevationFeet: number;
  elevationMeters: number;
  underlayId: number;
  overlayId: number;
  overlayShape: number;
  overlayRotation: number;
  autoMetadata: number;
  isHole: boolean;
  vertexShade: number;
}

export class ToolController {
  surfaceGrid: TerrainGrid;
  interiorGrid: TerrainGrid;
  readonly scene: SceneManager;
  readonly surfaceRenderer: TerrainRenderer;
  readonly interiorRenderer: TerrainRenderer;
  readonly liquids: LiquidRenderer;
  readonly assets: AssetManager;
  readonly lighting: LightingManager;
  readonly surfaceHistory: TerrainHistory;
  readonly interiorHistory: TerrainHistory;

  activeLayer: MapLayerId = 'surface';
  interiorDepthFeet = DEFAULT_INTERIOR_DEPTH_FEET;
  showSurfaceGhost = false;

  mapId = 'starter-encounter';
  mapName = 'Starter Encounter';
  mapCreatedAt = new Date().toISOString();
  saveTarget: MapSaveTarget | null = null;
  isDirty = false;

  activeTool: ActiveToolId = 'SCULPT';
  readonly sculpt: SculptSettings = createDefaultSculptSettings();
  readonly paint: PaintSettings = {
    layer: 'UNDERLAY',
    underlayId: DEFAULT_UNDERLAY_ID,
    overlayId: DEFAULT_OVERLAY_ID,
    overlayShape: 1,
    overlayRotation: 0,
    autoTile: true,
    radius: 1,
    brushShape: 'CIRCLE',
  };
  cliffSubMode: CliffSubMode = 'cliff';
  readonly cliff: CliffSettings = createDefaultCliffSettings();
  readonly holeBrush: HoleBrushSettings = {
    action: 'CUTOUT',
    radius: 1,
    shape: 'CIRCLE',
  };
  readonly shadowBrush: ShadowBrushSettings = {
    action: 'DARKEN',
    radius: 2,
    shape: 'CIRCLE',
    strength: 0.45,
    maxDarkness: 0.94,
  };
  readonly liquidTool: LiquidToolSettings = {
    subMode: 'draw',
    preset: 'clear_water',
    levelFeet: -1.5,
    opacity: null,
    snapStep: 0.5,
    edgeSnap: true,
    linkConnected: true,
    defaultWidth: 4,
    defaultLength: 4,
    continueSpan: 4,
    selectedLiquidId: null,
    pickingTerrainLevel: false,
  };
  readonly assetTool: AssetToolSettings = {
    subMode: 'place',
    selectedAsset: null,
    selectedPlacedId: null,
    rotationDegrees: 0,
    scalePolicy: 'auto_dnd',
    uniformScale: true,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    yOffsetFeet: 0,
    snapMode: 'center',
    stackOnModels: true,
    wallDecorMode: 'straight_offset',
    wallOffsetFeet: 0,
    preserveScaleOnReplace: true,
  };

  onHoverChange?: (telemetry: HoverTelemetry) => void;
  onStateChange?: () => void;
  onSaveShortcut?: () => void;
  private readonly eventAbort = new AbortController();
  onSaveAsShortcut?: () => void;
  onLoadShortcut?: () => void;

  private isLeftDragging = false;
  private draggingPlacedProp = false;
  private dragActivated = false;
  private dragStartClient: { x: number; y: number } | null = null;
  private strokeRecorder: TerrainStrokeRecorder | null = null;
  private gradeStart: { vx: number; vz: number } | null = null;
  private measureStart: { x: number; y: number; z: number; tx: number; tz: number; hUnits: number } | null = null;
  private lastHoverHit: TerrainPickHit | null = null;
  private lastHoverRay: Ray3 | null = null;
  private lastPaintTile: { tx: number; tz: number } | null = null;
  private lastStampTime = 0;

  private liquidDrawStart: {
    x: number;
    z: number;
    levelFeet: number;
    preset: LiquidPresetId;
    snapLines: LiquidSnapLine[];
  } | null = null;
  private liquidDragAction:
    | { kind: 'move'; id: string; startTileX: number; startTileZ: number; origX: number; origZ: number }
    | { kind: 'resize'; id: string; side: LiquidEdgeSide; origRect: LiquidRect }
    | null = null;
  private hoveredLiquidEdge: LiquidEdgeSide | null = null;
  private activeLiquidSnapLines: LiquidSnapLine[] = [];
  private liquidPreviewRect: (LiquidRect & { levelFeet: number; colorHex: number }) | null = null;

  constructor(
    surfaceGrid: TerrainGrid,
    interiorGrid: TerrainGrid,
    scene: SceneManager,
    surfaceRenderer: TerrainRenderer,
    interiorRenderer: TerrainRenderer,
    liquids: LiquidRenderer,
    assets: AssetManager,
    lighting: LightingManager,
    surfaceHistory: TerrainHistory,
    interiorHistory: TerrainHistory
  ) {
    this.surfaceGrid = surfaceGrid;
    this.interiorGrid = interiorGrid;
    this.scene = scene;
    this.surfaceRenderer = surfaceRenderer;
    this.interiorRenderer = interiorRenderer;
    this.liquids = liquids;
    this.assets = assets;
    this.lighting = lighting;
    this.surfaceHistory = surfaceHistory;
    this.interiorHistory = interiorHistory;

    this.applyInteriorDepth();
    this.syncLayerVisibility();
    this.attachPointerListeners();
  }

  /** Active TerrainGrid for whichever layer ('surface' or 'interior') is currently selected. */
  get grid(): TerrainGrid {
    return this.activeLayer === 'interior' ? this.interiorGrid : this.surfaceGrid;
  }

  /** Active TerrainRenderer for the currently selected layer. */
  get renderer(): TerrainRenderer {
    return this.activeLayer === 'interior' ? this.interiorRenderer : this.surfaceRenderer;
  }

  /** Active Undo/Redo history stack for the currently selected layer. */
  get history(): TerrainHistory {
    return this.activeLayer === 'interior' ? this.interiorHistory : this.surfaceHistory;
  }

  /** World-space Y offset (meters) of the Interior layer below Surface y = 0. */
  get interiorOffsetY(): number {
    return -(this.interiorDepthFeet * TILE_SIZE_METERS) / TILE_SIZE_FEET;
  }

  /** World-space Y offset (meters) of the currently active layer. */
  get activeLayerOffsetY(): number {
    return this.activeLayer === 'interior' ? this.interiorOffsetY : 0;
  }

  private applyInteriorDepth(): void {
    const offsetY = this.interiorOffsetY;
    this.scene.setInteriorOffsetY(offsetY);
    this.assets.setInteriorOffsetY(offsetY);
    this.scene.overlayRoot.position.y = this.activeLayerOffsetY;
  }

  /** Adjusts vertical separation (in feet) of the subterranean Interior layer below Surface. */
  setInteriorDepthFeet(depthFeet: number): void {
    const clamped = Math.max(5, Math.min(40, Math.round(depthFeet)));
    if (clamped === this.interiorDepthFeet) return;
    const prevOffset = this.activeLayerOffsetY;
    this.interiorDepthFeet = clamped;
    this.applyInteriorDepth();
    const nextOffset = this.activeLayerOffsetY;
    if (this.activeLayer === 'interior') {
      this.scene.shiftCameraElevation(nextOffset - prevOffset);
    }
    this.syncDynamicLights();
    this.isDirty = true;
    this.onStateChange?.();
  }

  /** Switches active editing & viewing layer between intact Surface terrain and subterranean Interior terrain. */
  setActiveLayer(layer: MapLayerId): void {
    if (this.activeLayer === layer) return;
    const prevOffset = this.activeLayerOffsetY;
    this.activeLayer = layer;
    const nextOffset = this.activeLayerOffsetY;

    this.assetTool.selectedPlacedId = null;
    this.liquidTool.selectedLiquidId = null;
    this.liquidTool.pickingTerrainLevel = false;
    this.liquidDrawStart = null;
    this.liquidDragAction = null;
    this.hoveredLiquidEdge = null;
    this.activeLiquidSnapLines = [];
    this.liquidPreviewRect = null;
    this.liquids.setOverlayState(null);
    this.measureStart = null;
    this.surfaceRenderer.setRulerLine(null, null);
    this.surfaceRenderer.setSelectionRing(null);
    this.surfaceRenderer.setBrushPreview([], []);
    this.interiorRenderer.setRulerLine(null, null);
    this.interiorRenderer.setSelectionRing(null);
    this.interiorRenderer.setBrushPreview([], []);
    this.scene.setRulerLabel(null, '');
    this.assets.hideGhostPreview();

    this.assets.setActiveLayer(layer);
    this.scene.overlayRoot.position.y = nextOffset;
    this.scene.shiftCameraElevation(nextOffset - prevOffset);
    this.syncLayerVisibility();
    this.syncHoleMarkersVisibility();
    this.syncDynamicLights();
    this.scene.fitSunShadows();
    this.onStateChange?.();
  }

  /** Toggles translucent Ghost Surface overhead while editing Interior so cave entrances align effortlessly. */
  setShowSurfaceGhost(show: boolean): void {
    if (this.showSurfaceGhost === show) return;
    this.showSurfaceGhost = show;
    this.syncLayerVisibility();
    this.onStateChange?.();
  }

  private surfaceHasAnyOpenings(): boolean {
    if (this.surfaceGrid.countHoles() > 0) return true;
    for (let i = 0; i < this.surfaceGrid.overlayIds.length; i++) {
      if (this.surfaceGrid.overlayIds[i] === VOID_OVERLAY_ID) return true;
    }
    return false;
  }

  /** Synchronizes Surface & Interior visibility so intact Surface terrain serves naturally as the cave roof. */
  syncLayerVisibility(): void {
    if (this.activeLayer === 'surface') {
      this.scene.surfaceRoot.visible = true;
      this.surfaceRenderer.setGhostOpacity(null);
      this.surfaceRenderer.setGridSuppressed(false);
      this.assets.setSurfaceGhost(false);
      this.liquids.setSurfaceGhost(false);

      // Reveal the subterranean Interior layer beneath Surface whenever Surface has punched openings
      this.scene.interiorRoot.visible = this.surfaceHasAnyOpenings();
      this.interiorRenderer.setGridSuppressed(true);
    } else {
      this.scene.interiorRoot.visible = true;
      this.interiorRenderer.setGridSuppressed(false);

      // Hide intact Surface roof completely, or render as faint Ghost Roof for alignment
      this.scene.surfaceRoot.visible = this.showSurfaceGhost;
      this.surfaceRenderer.setGhostOpacity(this.showSurfaceGhost ? 0.22 : null);
      this.assets.setSurfaceGhost(this.showSurfaceGhost);
      this.liquids.setSurfaceGhost(this.showSurfaceGhost);
    }
  }

  /** Synchronizes terrain shading mode across both Surface and Interior layers. */
  setShadingMode(mode: 'worldlab_flat' | 'rs2_gouraud' | 'pbr_shadows'): void {
    this.surfaceRenderer.setShadingMode(mode);
    this.interiorRenderer.setShadingMode(mode);
    this.liquids.setShadingMode(mode);
    this.onStateChange?.();
  }

  /** Synchronizes 5ft grid visibility across both Surface and Interior layers. */
  setGridVisible(visible: boolean): void {
    this.surfaceRenderer.setGridVisible(visible);
    this.interiorRenderer.setGridVisible(visible);
    this.onStateChange?.();
  }

  /** Re-syncs all automatic prop & lava PointLights for the currently active layer. */
  syncDynamicLights(): void {
    this.lighting.syncLightSources(
      this.grid,
      this.assets.getPlacedForLayer(this.activeLayer),
      this.activeLayerOffsetY
    );
  }

  /** Builds a complete, versioned VttMapDocument containing both Surface and Interior layers. */
  buildMapDocument(overrideName?: string, overrideId?: string): VttMapDocument {
    const trimmedOverrideName = overrideName?.trim();
    const name = trimmedOverrideName || this.mapName;
    const id = overrideId?.trim()
      ? sanitizeMapId(overrideId)
      : trimmedOverrideName
        ? sanitizeMapId(trimmedOverrideName)
        : sanitizeMapId(this.mapId || name);
    return serializeMapDocument({
      id,
      name,
      createdAt: this.mapCreatedAt,
      grid: this.surfaceGrid,
      interiorGrid: this.interiorGrid,
      interiorDepthFeet: this.interiorDepthFeet,
      liquids: this.liquids.serializeSurfaces(),
      props: this.assets.serializePlacedProps(),
      shadingMode: this.surfaceRenderer.currentShadingMode,
      showGrid: this.surfaceRenderer.gridVisible,
      lighting: this.lighting.settings,
    });
  }

  markSaved(meta: {
    id: string;
    name: string;
    createdAt?: string;
    saveTarget?: MapSaveTarget | null;
  }): void {
    this.mapId = meta.id;
    this.mapName = meta.name;
    if (meta.createdAt) this.mapCreatedAt = meta.createdAt;
    if (meta.saveTarget !== undefined) this.saveTarget = meta.saveTarget;
    this.isDirty = false;
    this.onStateChange?.();
  }

  private resetTransientSessionState(): void {
    this.isLeftDragging = false;
    this.draggingPlacedProp = false;
    this.dragActivated = false;
    this.dragStartClient = null;
    this.strokeRecorder = null;
    this.gradeStart = null;
    this.measureStart = null;
    this.lastHoverHit = null;
    this.assetTool.selectedPlacedId = null;
    this.liquidTool.selectedLiquidId = null;
    this.liquidTool.pickingTerrainLevel = false;
    this.liquidDrawStart = null;
    this.liquidDragAction = null;
    this.hoveredLiquidEdge = null;
    this.activeLiquidSnapLines = [];
    this.liquidPreviewRect = null;
    this.liquids.setOverlayState(null);
    this.surfaceHistory.clear();
    this.interiorHistory.clear();
    this.surfaceRenderer.setRulerLine(null, null);
    this.surfaceRenderer.setSelectionRing(null);
    this.surfaceRenderer.setBrushPreview([], []);
    this.interiorRenderer.setRulerLine(null, null);
    this.interiorRenderer.setSelectionRing(null);
    this.interiorRenderer.setBrushPreview([], []);
    this.scene.setRulerLabel(null, '');
  }

  /** Creates a brand new map of any supported width x length and swaps both Surface & Interior layers live. */
  createNewMap(options: CreateMapOptions): Promise<void> {
    const width = clampMapDimension(options.width);
    const length = clampMapDimension(options.length);
    const nextSurface = createGridFromTemplate(options);
    const nextInterior = createDefaultInteriorGrid(width, length);

    const cleanName = options.name.trim() || 'Untitled Map';
    const now = new Date().toISOString();

    this.resetTransientSessionState();
    this.activeLayer = 'surface';
    this.showSurfaceGhost = false;
    this.interiorDepthFeet = DEFAULT_INTERIOR_DEPTH_FEET;
    this.surfaceGrid = nextSurface;
    this.interiorGrid = nextInterior;
    this.mapName = cleanName;
    this.mapId = sanitizeMapId(cleanName);
    this.mapCreatedAt = now;
    this.saveTarget = null;
    this.isDirty = false;

    this.surfaceRenderer.setGrid(nextSurface);
    this.interiorRenderer.setGrid(nextInterior);
    this.liquids.setTerrainGrids(nextSurface, nextInterior);
    this.liquids.clear();
    this.assets.setActiveLayer('surface');
    this.assets.setGrids(nextSurface, nextInterior);
    this.applyInteriorDepth();
    this.syncLayerVisibility();
    this.scene.configureForMap(nextSurface.width, nextSurface.length);
    this.lighting.setMapBounds(nextSurface.width, nextSurface.length);
    if (options.template === 'dungeon') {
      this.lighting.applyPreset('dungeon');
    } else {
      this.lighting.applyPreset('daylight');
    }
    this.syncDynamicLights();
    this.onStateChange?.();
    return Promise.resolve();
  }

  /** Loads a validated VttMapDocument (Surface + Interior layers) live into the viewport. */
  async loadMapDocument(
    doc: VttMapDocument,
    saveTarget: MapSaveTarget | null = null
  ): Promise<{ loadedProps: number; missingProps: string[] }> {
    const nextSurface = gridFromMapDocument(doc);
    const nextInterior = interiorGridFromMapDocument(doc);

    this.resetTransientSessionState();
    this.activeLayer = 'surface';
    this.showSurfaceGhost = false;
    this.interiorDepthFeet = doc.settings.interiorDepthFeet ?? DEFAULT_INTERIOR_DEPTH_FEET;
    this.surfaceGrid = nextSurface;
    this.interiorGrid = nextInterior;
    this.mapId = doc.id;
    this.mapName = doc.name;
    this.mapCreatedAt = doc.createdAt;
    this.saveTarget = saveTarget;
    this.isDirty = false;

    this.surfaceRenderer.setGrid(nextSurface);
    this.interiorRenderer.setGrid(nextInterior);
    this.liquids.setTerrainGrids(nextSurface, nextInterior);
    this.liquids.loadSurfaces(doc.liquids ?? []);
    this.setShadingMode(doc.settings.shadingMode);
    this.setGridVisible(doc.settings.showGrid);
    this.assets.setActiveLayer('surface');
    this.assets.setGrids(nextSurface, nextInterior);
    this.applyInteriorDepth();
    this.syncLayerVisibility();

    const { loaded, missing } = await this.assets.loadSerializedProps(doc.props);
    this.scene.configureForMap(nextSurface.width, nextSurface.length);
    this.lighting.setMapBounds(nextSurface.width, nextSurface.length);
    this.lighting.loadSettings(doc.settings.lighting);
    this.syncDynamicLights();
    this.onStateChange?.();
    return { loadedProps: loaded, missingProps: missing };
  }

  setActiveTool(tool: ActiveToolId): void {
    this.activeTool = tool;
    this.scene.setLeftButtonOrbitMode(tool === 'ORBIT' || tool === 'LIGHT');
    if (tool !== 'MEASURE') {
      this.measureStart = null;
      this.renderer.setRulerLine(null, null);
      this.scene.setRulerLabel(null, '');
    }
    if (tool !== 'ASSET') {
      this.assets.hideGhostPreview();
      this.renderer.setSelectionRing(null);
    } else {
      this.refreshSelectionRing();
    }
    if (tool !== 'LIQUID') {
      this.liquidTool.pickingTerrainLevel = false;
      this.liquidDrawStart = null;
      this.liquidDragAction = null;
      this.hoveredLiquidEdge = null;
      this.activeLiquidSnapLines = [];
      this.liquidPreviewRect = null;
      this.liquids.setOverlayState(null);
    } else {
      this.renderer.setBrushPreview([], []);
      this.refreshLiquidOverlay();
    }
    this.syncHoleMarkersVisibility();
    this.updatePreview(this.lastHoverHit);
    this.onStateChange?.();
  }

  setCliffSubMode(mode: CliffSubMode): void {
    this.cliffSubMode = mode;
    this.syncHoleMarkersVisibility();
    this.updatePreview(this.lastHoverHit, this.lastHoverRay);
    this.onStateChange?.();
  }

  syncHoleMarkersVisibility(): void {
    const showInCliff = this.activeTool === 'CLIFF' && this.cliffSubMode === 'hole';
    const showInPaint =
      this.activeTool === 'PAINT' &&
      (this.paint.layer === 'ERASE_OVERLAY' ||
        (this.paint.layer === 'OVERLAY' && this.paint.overlayId === VOID_OVERLAY_ID));
    const show = showInCliff || showInPaint;
    this.surfaceRenderer.setHoleMarkersVisible(show && this.activeLayer === 'surface');
    this.interiorRenderer.setHoleMarkersVisible(show && this.activeLayer === 'interior');
  }

  restoreAllHoles(): void {
    if (this.grid.countHoles() === 0) return;
    const rec = new TerrainStrokeRecorder(this.grid, 'Restore All Cutout Holes');
    for (let tz = 0; tz < this.grid.length; tz++) {
      for (let tx = 0; tx < this.grid.width; tx++) {
        this.grid.setHole(tx, tz, false);
      }
    }
    this.history.push(rec.commit(this.grid));
    this.renderer.syncDirtyChunks();
    this.syncLayerVisibility();
    this.isDirty = true;
    this.onStateChange?.();
  }

  clearAllVertexShadows(): void {
    const rec = new TerrainStrokeRecorder(this.grid, 'Clear All Vertex Shadow/AO');
    let changed = false;
    for (let vz = 0; vz <= this.grid.length; vz++) {
      for (let vx = 0; vx <= this.grid.width; vx++) {
        if (this.grid.setVertexShadeByte(vx, vz, 0)) changed = true;
      }
    }
    if (!changed) return;
    this.history.push(rec.commit(this.grid));
    this.renderer.syncDirtyChunks();
    this.isDirty = true;
    this.onStateChange?.();
  }

  private pickTerrainForActiveTool(ray: Ray3): TerrainPickHit | null {
    const offsetY = this.activeLayerOffsetY;
    const localRay: Ray3 =
      offsetY !== 0
        ? {
            originX: ray.originX,
            originY: ray.originY - offsetY,
            originZ: ray.originZ,
            dirX: ray.dirX,
            dirY: ray.dirY,
            dirZ: ray.dirZ,
          }
        : ray;
    const hit =
      this.activeTool === 'CLIFF' && this.cliffSubMode === 'hole'
        ? pickTerrain(this.grid, localRay, { includeHoles: true })
        : pickTerrain(this.grid, localRay, { includeHoles: false }) ??
          pickTerrain(this.grid, localRay, { includeHoles: true });
    if (!hit || offsetY === 0) return hit;
    return { ...hit, worldY: hit.worldY + offsetY };
  }

  selectPlacedProp(id: string | null): void {
    this.assetTool.selectedPlacedId = id;
    const p = this.assets.getById(id);
    if (p) {
      this.assetTool.rotationDegrees = p.rotationDegrees;
      this.assetTool.scalePolicy = p.scalePolicy;
      this.assetTool.scaleX = p.scaleX;
      this.assetTool.scaleY = p.scaleY;
      this.assetTool.scaleZ = p.scaleZ;
      this.assetTool.uniformScale =
        Math.abs(p.scaleX - p.scaleY) < 0.01 && Math.abs(p.scaleY - p.scaleZ) < 0.01;
    }
    this.refreshSelectionRing();
    this.onStateChange?.();
  }

  refreshSelectionRing(): void {
    if (this.activeTool !== 'ASSET') {
      this.renderer.setSelectionRing(null);
      return;
    }
    const p = this.assets.getById(this.assetTool.selectedPlacedId);
    this.renderer.setSelectionRing(p ? this.assets.getWorldRing(p) : null);
  }

  /** Refreshes ghost preview & selection ring without mutating any already-placed prop's transform. */
  refreshAssetPreview(): void {
    this.refreshSelectionRing();
    this.updatePreview(this.lastHoverHit, this.lastHoverRay);
  }

  /** Updates elevation offset on the selected prop (if any), or on the ghost preview offset when nothing is selected. */
  setAssetElevationFeet(yOffsetFeet: number): void {
    const a = this.assetTool;
    if (a.selectedPlacedId) {
      this.assets.updatePlacedTransform(a.selectedPlacedId, { yOffsetFeet });
      this.isDirty = true;
      this.refreshSelectionRing();
      this.syncDynamicLights();
      this.scene.fitSunShadows();
    } else {
      a.yOffsetFeet = yOffsetFeet;
    }
    this.updatePreview(this.lastHoverHit, this.lastHoverRay);
  }

  /** Applies rotation/scale/policy sliders/buttons to the selected placed prop (preserving its stacked elevation) & refreshes ghost preview. */
  applyAssetTransformChange(): void {
    const a = this.assetTool;
    if (a.selectedPlacedId) {
      this.assets.updatePlacedTransform(a.selectedPlacedId, {
        rotationDegrees: a.rotationDegrees,
        scalePolicy: a.scalePolicy,
        scaleX: a.scaleX,
        scaleY: a.scaleY,
        scaleZ: a.scaleZ,
      });
      this.isDirty = true;
      this.refreshSelectionRing();
      this.syncDynamicLights();
      this.scene.fitSunShadows();
    }
    this.updatePreview(this.lastHoverHit, this.lastHoverRay);
  }

  async replaceSelectedPlaced(): Promise<void> {
    const { selectedPlacedId, selectedAsset, preserveScaleOnReplace } = this.assetTool;
    if (!selectedPlacedId || !selectedAsset) return;
    await this.assets.replacePlacedAsset(selectedPlacedId, selectedAsset, preserveScaleOnReplace);
    this.isDirty = true;
    this.selectPlacedProp(selectedPlacedId);
    this.syncDynamicLights();
    this.scene.fitSunShadows();
    this.onStateChange?.();
  }

  async replaceAllMatchingSelected(): Promise<void> {
    const { selectedPlacedId, selectedAsset, preserveScaleOnReplace } = this.assetTool;
    const current = this.assets.getById(selectedPlacedId);
    if (!current || !selectedAsset) return;
    await this.assets.replaceAllOfKey(current.entry.key, selectedAsset, preserveScaleOnReplace);
    this.isDirty = true;
    this.selectPlacedProp(selectedPlacedId);
    this.syncDynamicLights();
    this.scene.fitSunShadows();
    this.onStateChange?.();
  }

  undo(): void {
    const tx = this.history.undo(this.grid);
    if (tx) {
      this.renderer.syncDirtyChunks();
      this.syncLayerVisibility();
      this.liquids.refreshDepths(this.activeLayer);
      this.assets.reseatAllOnTerrain(this.activeLayer);
      this.syncDynamicLights();
      this.scene.fitSunShadows();
      this.refreshSelectionRing();
      this.onStateChange?.();
    }
  }

  redo(): void {
    const tx = this.history.redo(this.grid);
    if (tx) {
      this.renderer.syncDirtyChunks();
      this.syncLayerVisibility();
      this.liquids.refreshDepths(this.activeLayer);
      this.assets.reseatAllOnTerrain(this.activeLayer);
      this.syncDynamicLights();
      this.refreshSelectionRing();
      this.onStateChange?.();
    }
  }

  selectCatalogAsset(entry: WorldLabAssetEntry | null): void {
    this.assetTool.selectedAsset = entry;
    if (entry && isWallDecorEntry(entry)) {
      this.assetTool.snapMode = 'wall';
    } else if (entry && this.assetTool.snapMode === 'wall') {
      this.assetTool.snapMode = 'center';
    }
    this.refreshAssetPreview();
    this.onStateChange?.();
  }

  private snapAssetCoord(
    hit: TerrainPickHit,
    entry: WorldLabAssetEntry | null = this.assetTool.selectedAsset,
    rotationDegrees = this.assetTool.rotationDegrees
  ): {
    x: number;
    z: number;
    rotationDegrees: number;
    startX: number;
    startZ: number;
    widthTiles: number;
    lengthTiles: number;
    wallSnap: WallSnapResult | null;
  } {
    if (this.assetTool.snapMode === 'wall') {
      const ws = resolveWallSnap(
        hit.tileX,
        hit.tileZ,
        hit.tileFloatX,
        hit.tileFloatZ,
        this.assetTool.wallDecorMode,
        this.assets.getWallSupportCandidates(),
        this.assetTool.wallOffsetFeet / TILE_SIZE_FEET
      );
      return {
        x: ws.tileX,
        z: ws.tileZ,
        rotationDegrees: ws.rotationDegrees,
        startX: ws.edgeTileX,
        startZ: ws.edgeTileZ,
        widthTiles: 1,
        lengthTiles: 1,
        wallSnap: ws,
      };
    }

    const rot = entry ? getRotatedFootprint(entry, rotationDegrees) : { widthTiles: 1, lengthTiles: 1 };
    const snap = computeSnappedFootprint(
      hit.tileX,
      hit.tileZ,
      rot.widthTiles,
      rot.lengthTiles,
      this.grid.width,
      this.grid.length
    );
    if (this.assetTool.snapMode === 'center') {
      return {
        x: snap.centerX,
        z: snap.centerZ,
        rotationDegrees,
        startX: snap.startX,
        startZ: snap.startZ,
        widthTiles: rot.widthTiles,
        lengthTiles: rot.lengthTiles,
        wallSnap: null,
      };
    }
    if (this.assetTool.snapMode === 'corner') {
      return {
        x: hit.vertexX,
        z: hit.vertexZ,
        rotationDegrees,
        startX: Math.round(hit.vertexX - rot.widthTiles * 0.5),
        startZ: Math.round(hit.vertexZ - rot.lengthTiles * 0.5),
        widthTiles: rot.widthTiles,
        lengthTiles: rot.lengthTiles,
        wallSnap: null,
      };
    }
    return {
      x: hit.tileFloatX,
      z: hit.tileFloatZ,
      rotationDegrees,
      startX: Math.floor(hit.tileFloatX - rot.widthTiles * 0.5 + 0.5),
      startZ: Math.floor(hit.tileFloatZ - rot.lengthTiles * 0.5 + 0.5),
      widthTiles: rot.widthTiles,
      lengthTiles: rot.lengthTiles,
      wallSnap: null,
    };
  }

  private buildFootprintOutlines(
    startX: number,
    startZ: number,
    widthTiles: number,
    lengthTiles: number,
    color: readonly [number, number, number]
  ): { tx: number; tz: number; color: readonly [number, number, number] }[] {
    const outlines: { tx: number; tz: number; color: readonly [number, number, number] }[] = [];
    for (let dz = 0; dz < lengthTiles; dz++) {
      for (let dx = 0; dx < widthTiles; dx++) {
        const tx = startX + dx;
        const tz = startZ + dz;
        if (this.grid.inTileBounds(tx, tz)) {
          outlines.push({ tx, tz, color });
        }
      }
    }
    return outlines;
  }

  private getCurrentAssetTransform(): AssetTransformOptions {
    const a = this.assetTool;
    return {
      rotationDegrees: a.rotationDegrees,
      scalePolicy: a.scalePolicy,
      scaleX: a.scaleX,
      scaleY: a.scaleY,
      scaleZ: a.scaleZ,
      yOffsetFeet: a.yOffsetFeet,
    };
  }

  private attachPointerListeners(): void {
    const canvas = this.scene.app.canvas;
    const { signal } = this.eventAbort;

    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); }, { signal });

    canvas.addEventListener('pointerleave', () => {
      this.assets.hideGhostPreview();
    }, { signal });

    canvas.addEventListener('pointermove', (e) => {
      const ray = this.scene.clientPointToRay(e.clientX, e.clientY);
      const hit = this.pickTerrainForActiveTool(ray);
      this.lastHoverRay = ray;
      this.lastHoverHit = hit;
      this.emitHover(hit);

      if (this.activeTool === 'LIQUID') {
        this.handleLiquidPointerMove(ray, hit);
        return;
      }

      if (this.activeTool === 'MEASURE' && this.measureStart && hit) {
        this.updateRuler(hit);
        return;
      }

      if (this.draggingPlacedProp && this.assetTool.selectedPlacedId) {
        if (!this.dragActivated && this.dragStartClient) {
          const distPx = Math.hypot(e.clientX - this.dragStartClient.x, e.clientY - this.dragStartClient.y);
          if (distPx < 6) {
            return;
          }
          this.dragActivated = true;
        }
        const dragged = this.assets.getById(this.assetTool.selectedPlacedId);
        const stackHit =
          this.assetTool.stackOnModels && dragged
            ? resolveStackPlacement(
                ray,
                this.grid,
                dragged.entry,
                dragged.rotationDegrees,
                this.assetTool.snapMode,
                this.assets.getStackablePropBounds(),
                dragged.id,
                this.activeLayerOffsetY
              )
            : null;

        if (stackHit) {
          this.assets.updatePlacedTransform(this.assetTool.selectedPlacedId, {
            tileX: stackHit.tileX,
            tileZ: stackHit.tileZ,
            yOffsetFeet: stackHit.yOffsetFeet,
          });
          this.renderer.setBrushPreview([], [], [], [
            { ...stackHit.surfaceBox, color: [0.35, 0.98, 0.45] },
          ]);
          this.refreshSelectionRing();
          return;
        }

        if (hit) {
          const snapped = this.snapAssetCoord(
            hit,
            dragged?.entry ?? null,
            dragged?.rotationDegrees ?? this.assetTool.rotationDegrees
          );
          this.assets.updatePlacedTransform(this.assetTool.selectedPlacedId, {
            tileX: snapped.x,
            tileZ: snapped.z,
            yOffsetFeet: 0,
          });
          this.renderer.setBrushPreview(
            [],
            this.buildFootprintOutlines(
              snapped.startX,
              snapped.startZ,
              snapped.widthTiles,
              snapped.lengthTiles,
              [0.35, 0.95, 0.5]
            )
          );
          this.refreshSelectionRing();
        }
        return;
      }

      if (this.isLeftDragging && hit) {
        this.handleDrag(hit, e);
      }
      this.updatePreview(hit, ray);
    }, { signal });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.activeTool === 'ORBIT' || this.activeTool === 'LIGHT') return;

      const ray = this.scene.clientPointToRay(e.clientX, e.clientY);
      const hit = this.pickTerrainForActiveTool(ray);
      this.lastHoverRay = ray;
      this.lastHoverHit = hit;

      if (this.activeTool === 'LIQUID') {
        this.handleLiquidPointerDown(ray, hit, e);
        return;
      }

      if (this.activeTool === 'ASSET') {
        this.handleAssetPointerDown(hit, ray, e);
        return;
      }

      if (!hit) return;

      this.isLeftDragging = true;

      if (this.activeTool === 'MEASURE') {
        const hUnits = this.grid.sampleHeightAtTileCoord(hit.tileFloatX, hit.tileFloatZ);
        this.measureStart = {
          x: (hit.tileX + 0.5) * TILE_SIZE_METERS,
          y: hUnits * METERS_PER_HEIGHT_UNIT,
          z: (hit.tileZ + 0.5) * TILE_SIZE_METERS,
          tx: hit.tileX,
          tz: hit.tileZ,
          hUnits,
        };
        this.updateRuler(hit);
        return;
      }

      if (this.activeTool === 'SCULPT') {
        if (this.sculpt.mode === 'FLATTEN' || this.sculpt.mode === 'PLATEAU') {
          this.sculpt.flattenTarget = this.grid.getHeight(hit.vertexX, hit.vertexZ);
        }
        this.strokeRecorder = new TerrainStrokeRecorder(this.grid, `Sculpt: ${this.sculpt.mode}`);
        if (this.sculpt.mode === 'GRADE') {
          this.gradeStart = { vx: hit.vertexX, vz: hit.vertexZ };
        } else {
          this.stampSculpt(hit, e.shiftKey);
        }
      } else if (this.activeTool === 'PAINT') {
        this.strokeRecorder = new TerrainStrokeRecorder(this.grid, `Paint: ${this.paint.layer}`);
        this.lastPaintTile = null;
        this.stampPaint(hit);
      } else {
        if (this.cliffSubMode === 'hole') {
          this.strokeRecorder = new TerrainStrokeRecorder(this.grid, `Cutout Hole`);
          this.lastPaintTile = null;
          this.stampHoleBrush(hit, e.shiftKey);
        } else if (this.cliffSubMode === 'shadow') {
          this.strokeRecorder = new TerrainStrokeRecorder(this.grid, `Shadow / AO`);
          this.stampShadowBrush(hit, e.shiftKey);
        } else {
          this.strokeRecorder = new TerrainStrokeRecorder(this.grid, `Cliff: ${this.cliff.mode}`);
          applyCliffBrush(this.grid, hit.tileX, hit.tileZ, this.cliff);
          this.renderer.syncDirtyChunks();
        }
      }

      this.updatePreview(hit);
      this.onStateChange?.();
    }, { signal });

    const endStroke = (): void => {
      if (this.liquidDrawStart || this.liquidDragAction) {
        this.handleLiquidPointerUp();
      }
      if (this.draggingPlacedProp) {
        const moved = this.dragActivated;
        this.draggingPlacedProp = false;
        this.dragActivated = false;
        this.dragStartClient = null;
        if (moved) {
          this.isDirty = true;
          this.syncDynamicLights();
          this.scene.fitSunShadows();
          this.onStateChange?.();
        }
      }
      if (!this.isLeftDragging) return;
      this.isLeftDragging = false;
      this.gradeStart = null;
      this.lastPaintTile = null;
      if (this.strokeRecorder) {
        const tx = this.strokeRecorder.commit(this.grid);
        this.history.push(tx);
        this.strokeRecorder = null;
        if (
          tx.heights.length > 0 ||
          tx.tiles.length > 0 ||
          tx.holes.length > 0 ||
          tx.shades.length > 0
        ) {
          this.isDirty = true;
        }
        if (tx.heights.length > 0) {
          this.assets.reseatAllOnTerrain(this.activeLayer);
          this.refreshSelectionRing();
          this.scene.fitSunShadows();
        }
        if (tx.holes.length > 0) {
          this.syncLayerVisibility();
        }
        if (tx.heights.length > 0 || tx.holes.length > 0) {
          this.liquids.refreshDepths(this.activeLayer);
        }
        if (tx.heights.length > 0 || tx.tiles.length > 0 || tx.holes.length > 0) {
          this.syncDynamicLights();
        }
        this.onStateChange?.();
      }
    };

    window.addEventListener('pointerup', endStroke, { signal });
    window.addEventListener('pointercancel', endStroke, { signal });

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault();
        if (e.shiftKey) {
          this.onSaveAsShortcut?.();
        } else {
          this.onSaveShortcut?.();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') {
        e.preventDefault();
        this.onLoadShortcut?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (e.code === 'KeyL') {
        this.setActiveLayer(this.activeLayer === 'surface' ? 'interior' : 'surface');
        return;
      }
      if (e.code === 'KeyR') {
        if (this.activeTool === 'PAINT') {
          this.paint.overlayRotation = (this.paint.overlayRotation + 1) & 3;
          this.onStateChange?.();
        } else if (this.activeTool === 'ASSET') {
          const step = e.shiftKey ? 15 : 90;
          this.assetTool.rotationDegrees = (this.assetTool.rotationDegrees + step) % 360;
          this.applyAssetTransformChange();
          this.onStateChange?.();
        }
      } else if (e.code === 'BracketLeft' || e.code === 'Minus') {
        if (this.activeTool === 'LIQUID') {
          this.nudgeLiquidLevel(e.shiftKey ? -0.25 : -0.5);
        } else if (this.activeTool === 'ASSET') {
          this.scaleAssetByFactor(0.9);
        } else if (e.code === 'BracketLeft') {
          this.adjustActiveRadius(-1);
        }
      } else if (e.code === 'BracketRight' || e.code === 'Equal') {
        if (this.activeTool === 'LIQUID') {
          this.nudgeLiquidLevel(e.shiftKey ? 0.25 : 0.5);
        } else if (this.activeTool === 'ASSET') {
          this.scaleAssetByFactor(1.1);
        } else if (e.code === 'BracketRight') {
          this.adjustActiveRadius(1);
        }
      } else if ((e.code === 'Delete' || e.code === 'Backspace') && this.activeTool === 'LIQUID') {
        this.deleteSelectedLiquid();
      } else if ((e.code === 'Delete' || e.code === 'Backspace') && this.activeTool === 'ASSET') {
        if (this.assetTool.selectedPlacedId) {
          this.assets.removeById(this.assetTool.selectedPlacedId);
          this.assetTool.selectedPlacedId = null;
          this.isDirty = true;
          this.refreshSelectionRing();
          this.syncDynamicLights();
          this.scene.fitSunShadows();
          this.onStateChange?.();
        }
      } else if (e.code === 'Digit1') {
        this.setActiveTool('SCULPT');
      } else if (e.code === 'Digit2') {
        this.setActiveTool('PAINT');
      } else if (e.code === 'Digit3') {
        this.setActiveTool('CLIFF');
      } else if (e.code === 'Digit4') {
        this.setActiveTool('LIQUID');
      } else if (e.code === 'Digit5') {
        this.setActiveTool('ASSET');
      } else if (e.code === 'Digit6') {
        this.setActiveTool('LIGHT');
      } else if (e.code === 'Digit7') {
        this.setActiveTool('MEASURE');
      } else if (e.code === 'Digit8') {
        this.setActiveTool('ORBIT');
      }
    }, { signal });
  }

  private scaleAssetByFactor(factor: number): void {
    const a = this.assetTool;
    a.scaleX = Math.max(0.2, Math.min(5, Number((a.scaleX * factor).toFixed(2))));
    a.scaleY = Math.max(0.2, Math.min(5, Number((a.scaleY * factor).toFixed(2))));
    a.scaleZ = Math.max(0.2, Math.min(5, Number((a.scaleZ * factor).toFixed(2))));
    this.applyAssetTransformChange();
    this.onStateChange?.();
  }

  private adjustActiveRadius(delta: number): void {
    if (this.activeTool === 'SCULPT') {
      this.sculpt.radius = Math.max(0, Math.min(12, this.sculpt.radius + delta));
    } else if (this.activeTool === 'PAINT') {
      this.paint.radius = Math.max(0, Math.min(8, this.paint.radius + delta));
    } else if (this.activeTool === 'CLIFF') {
      if (this.cliffSubMode === 'hole') {
        this.holeBrush.radius = Math.max(0, Math.min(6, this.holeBrush.radius + delta));
      } else if (this.cliffSubMode === 'shadow') {
        this.shadowBrush.radius = Math.max(0, Math.min(8, this.shadowBrush.radius + delta));
      } else {
        this.cliff.radius = Math.max(0, Math.min(8, this.cliff.radius + delta));
      }
    }
    this.updatePreview(this.lastHoverHit);
    this.onStateChange?.();
  }

  private emitHover(hit: TerrainPickHit | null): void {
    if (!this.onHoverChange) return;
    if (!hit) {
      this.onHoverChange({
        hit: null,
        elevationFeet: 0,
        elevationMeters: 0,
        underlayId: 0,
        overlayId: 0,
        overlayShape: 0,
        overlayRotation: 0,
        autoMetadata: 0,
        isHole: false,
        vertexShade: 0,
      });
      return;
    }
    const hUnits = this.grid.getHeight(hit.vertexX, hit.vertexZ);
    const tile = this.grid.getTile(hit.tileX, hit.tileZ);
    this.onHoverChange({
      hit,
      elevationFeet: heightUnitsToFeet(hUnits),
      elevationMeters: heightUnitsToMeters(hUnits),
      underlayId: tile.underlayId,
      overlayId: tile.overlayId,
      overlayShape: tile.overlayShape,
      overlayRotation: tile.overlayRotation,
      autoMetadata: tile.autoMetadata,
      isHole: this.grid.isHole(hit.tileX, hit.tileZ),
      vertexShade: this.grid.getVertexShade(hit.vertexX, hit.vertexZ),
    });
  }

  private handleDrag(hit: TerrainPickHit, e: PointerEvent): void {
    const now = performance.now();
    if (now - this.lastStampTime < 22) return;
    this.lastStampTime = now;

    if (this.activeTool === 'SCULPT') {
      if (this.sculpt.mode === 'GRADE' && this.gradeStart && this.strokeRecorder) {
        this.grid.heights.set(this.strokeRecorder.initialHeights);
        this.grid.markAllDirty();
        applyGradeStroke(
          this.grid,
          this.gradeStart.vx,
          this.gradeStart.vz,
          hit.vertexX,
          hit.vertexZ,
          this.sculpt,
          this.strokeRecorder.initialHeights
        );
        this.renderer.syncDirtyChunks();
      } else {
        this.stampSculpt(hit, e.shiftKey);
      }
    } else if (this.activeTool === 'PAINT') {
      this.stampPaint(hit);
    } else if (this.activeTool === 'CLIFF') {
      if (this.cliffSubMode === 'hole') {
        this.stampHoleBrush(hit, e.shiftKey);
      } else if (this.cliffSubMode === 'shadow') {
        this.stampShadowBrush(hit, e.shiftKey);
      } else {
        applyCliffBrush(this.grid, hit.tileX, hit.tileZ, this.cliff);
        this.renderer.syncDirtyChunks();
      }
    }
  }

  private stampSculpt(hit: TerrainPickHit, invertWithShift: boolean): void {
    const preStroke = this.strokeRecorder?.initialHeights ?? Int16Array.from(this.grid.heights);
    const snapshot = Int16Array.from(this.grid.heights);
    const neighborSampler = (x: number, z: number): number => {
      const cx = Math.max(0, Math.min(this.grid.width, x));
      const cz = Math.max(0, Math.min(this.grid.length, z));
      return snapshot[this.grid.vertexIndex(cx, cz)] ?? 0;
    };

    const effectiveSettings: SculptSettings =
      invertWithShift && this.sculpt.mode === 'RAISE'
        ? { ...this.sculpt, mode: 'LOWER' }
        : invertWithShift && this.sculpt.mode === 'LOWER'
          ? { ...this.sculpt, mode: 'RAISE' }
          : this.sculpt;

    const r = effectiveSettings.radius;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const vx = hit.vertexX + dx;
        const vz = hit.vertexZ + dz;
        if (!this.grid.inVertexBounds(vx, vz)) continue;
        const idx = this.grid.vertexIndex(vx, vz);
        const orig = preStroke[idx] ?? 0;
        if (!vertexMatchesMask(this.grid, vx, vz, orig, effectiveSettings)) continue;
        const cur = snapshot[idx] ?? 0;
        const next = evaluateSculptVertex(effectiveSettings, vx, vz, dx, dz, cur, orig, neighborSampler);
        const limited = applySlopeLimit(this.grid, vx, vz, next, preStroke, effectiveSettings.maxSlope);
        this.grid.setHeight(vx, vz, limited);
      }
    }
    this.renderer.syncDirtyChunks();
  }

  private stampHoleBrush(hit: TerrainPickHit, invertWithShift = false): void {
    const r = Math.max(0, this.holeBrush.radius);
    const seen = new Set<string>();
    const fromX = this.lastPaintTile ? this.lastPaintTile.tx : hit.tileX;
    const fromZ = this.lastPaintTile ? this.lastPaintTile.tz : hit.tileZ;
    const toX = hit.tileX;
    const toZ = hit.tileZ;
    this.lastPaintTile = { tx: toX, tz: toZ };

    const punch = this.holeBrush.action === 'CUTOUT' ? !invertWithShift : invertWithShift;
    const steps = Math.max(Math.abs(toX - fromX), Math.abs(toZ - fromZ));
    for (let s = 0; s <= steps; s++) {
      const cx = steps === 0 ? toX : Math.round(fromX + ((toX - fromX) * s) / steps);
      const cz = steps === 0 ? toZ : Math.round(fromZ + ((toZ - fromZ) * s) / steps);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist =
            this.holeBrush.shape === 'SQUARE' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
          if (dist > r + 0.25) continue;
          const tx = cx + dx;
          const tz = cz + dz;
          if (!this.grid.inTileBounds(tx, tz)) continue;
          const key = `${tx},${tz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          this.grid.setHole(tx, tz, punch);
        }
      }
    }
    this.renderer.syncDirtyChunks();
    this.syncLayerVisibility();
  }

  private stampShadowBrush(hit: TerrainPickHit, invertWithShift = false): void {
    const r = Math.max(0, this.shadowBrush.radius);
    const effectiveDarken = this.shadowBrush.action === 'DARKEN' ? !invertWithShift : invertWithShift;
    const strength = Math.max(0.05, Math.min(1, this.shadowBrush.strength));
    const targetMax = Math.max(0.15, Math.min(1, this.shadowBrush.maxDarkness));

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const vx = hit.vertexX + dx;
        const vz = hit.vertexZ + dz;
        if (!this.grid.inVertexBounds(vx, vz)) continue;
        const dist =
          this.shadowBrush.shape === 'SQUARE' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
        if (dist > r + 0.01) continue;
        const w = r === 0 ? 1 : falloffWeight('SMOOTH', dist / (r + 1));
        const cur = this.grid.getVertexShade(vx, vz);
        const next = effectiveDarken
          ? Math.min(targetMax, cur + (targetMax - cur) * Math.min(1, strength * 0.55 * w + 0.06 * w))
          : Math.max(0, cur - strength * 0.65 * w);
        this.grid.setVertexShade(vx, vz, next);
      }
    }
    this.renderer.syncDirtyChunks();
  }

  private stampPaint(hit: TerrainPickHit): void {
    const r = Math.max(0, this.paint.radius);
    const seen = new Set<string>();
    const coords: { tx: number; tz: number }[] = [];

    // Sweep a continuous Bresenham tile line from the previous drag tile (matching WorldLab TilePaintTool)
    const fromX = this.lastPaintTile ? this.lastPaintTile.tx : hit.tileX;
    const fromZ = this.lastPaintTile ? this.lastPaintTile.tz : hit.tileZ;
    const toX = hit.tileX;
    const toZ = hit.tileZ;
    this.lastPaintTile = { tx: toX, tz: toZ };

    const steps = Math.max(Math.abs(toX - fromX), Math.abs(toZ - fromZ));
    for (let s = 0; s <= steps; s++) {
      const cx = steps === 0 ? toX : Math.round(fromX + ((toX - fromX) * s) / steps);
      const cz = steps === 0 ? toZ : Math.round(fromZ + ((toZ - fromZ) * s) / steps);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist = this.paint.brushShape === 'SQUARE' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
          if (dist > r + 0.25) continue;
          const tx = cx + dx;
          const tz = cz + dz;
          if (!this.grid.inTileBounds(tx, tz)) continue;
          const key = `${tx},${tz}`;
          if (!seen.has(key)) {
            seen.add(key);
            coords.push({ tx, tz });
          }
        }
      }
    }

    if (coords.length === 0) return;

    if (this.paint.layer === 'UNDERLAY') {
      for (const { tx, tz } of coords) {
        this.grid.setUnderlay(tx, tz, this.paint.underlayId);
      }
    } else if (this.paint.layer === 'ERASE_OVERLAY') {
      if (this.paint.autoTile) {
        autoPaintOverlaySeeds(this.grid, coords, 0);
      } else {
        for (const { tx, tz } of coords) {
          paintManualOverlay(this.grid, tx, tz, 0, 0, 0);
        }
      }
    } else if (this.paint.autoTile) {
      autoPaintOverlaySeeds(this.grid, coords, this.paint.overlayId);
    } else {
      for (const { tx, tz } of coords) {
        paintManualOverlay(
          this.grid,
          tx,
          tz,
          this.paint.overlayId,
          this.paint.overlayShape,
          this.paint.overlayRotation
        );
      }
    }

    this.renderer.syncDirtyChunks();
  }

  private resolveAssetStack(ray: Ray3 | null, excludeId: string | null = null): StackSnapResult | null {
    if (!ray || !this.assetTool.stackOnModels) return null;
    return resolveStackPlacement(
      ray,
      this.grid,
      this.assetTool.selectedAsset,
      this.assetTool.rotationDegrees,
      this.assetTool.snapMode,
      this.assets.getStackablePropBounds(),
      excludeId,
      this.activeLayerOffsetY
    );
  }

  private handleAssetPointerDown(hit: TerrainPickHit | null, ray: Ray3, e: PointerEvent): void {
    // Alt+Click always deletes picked/nearest placed prop (raycast picks top stacked prop first!)
    if (e.altKey) {
      const target = this.assets.pickPlacedByRay(ray) ?? (hit ? this.assets.findNearest(hit.tileFloatX, hit.tileFloatZ, 1.5) : null);
      const removed = target ? this.assets.removeById(target.id) : null;
      if (removed) {
        if (this.assetTool.selectedPlacedId === removed.id) {
          this.assetTool.selectedPlacedId = null;
        }
        this.isDirty = true;
        this.refreshSelectionRing();
        this.syncDynamicLights();
        this.scene.fitSunShadows();
        this.onStateChange?.();
      }
      this.isLeftDragging = false;
      return;
    }

    // Select / Drag mode (or Ctrl+Click from Place mode) — 3D raycast selects top stacked model accurately!
    if (this.assetTool.subMode === 'select' || e.ctrlKey) {
      const picked =
        this.assets.pickPlacedByRay(ray) ??
        (hit ? this.assets.findNearest(hit.tileFloatX, hit.tileFloatZ, 1.45) : null);
      this.selectPlacedProp(picked ? picked.id : null);
      if (picked) {
        this.draggingPlacedProp = true;
        this.dragActivated = false;
        this.dragStartClient = { x: e.clientX, y: e.clientY };
      }
      this.isLeftDragging = false;
      return;
    }

    // Click-Replace mode: clicking an existing prop swaps its model in-place!
    if (this.assetTool.subMode === 'replace') {
      const target =
        this.assets.pickPlacedByRay(ray) ??
        (hit ? this.assets.findNearest(hit.tileFloatX, hit.tileFloatZ, 1.6) : null);
      const replacement = this.assetTool.selectedAsset;
      if (target && replacement) {
        void this.assets
          .replacePlacedAsset(target.id, replacement, this.assetTool.preserveScaleOnReplace)
          .then(() => {
            this.isDirty = true;
            this.selectPlacedProp(target.id);
            this.syncDynamicLights();
            this.scene.fitSunShadows();
            this.onStateChange?.();
          });
      }
      this.isLeftDragging = false;
      return;
    }

    // Place mode
    const entry = this.assetTool.selectedAsset;
    if (!entry) {
      this.isLeftDragging = false;
      return;
    }

    // Check 3D model-on-model stacking FIRST so aiming at a tower/table top stacks flush!
    const stackHit = this.resolveAssetStack(ray);
    if (stackHit) {
      void this.assets
        .placeAsset(entry, stackHit.tileX, stackHit.tileZ, {
          ...this.getCurrentAssetTransform(),
          yOffsetFeet: stackHit.yOffsetFeet + this.assetTool.yOffsetFeet,
        })
        .then((placed) => {
          this.assetTool.selectedPlacedId = placed.id;
          this.isDirty = true;
          this.refreshSelectionRing();
          this.syncDynamicLights();
          this.scene.fitSunShadows();
          this.onStateChange?.();
        })
        .catch((err: unknown) => {
          console.error('Failed to stack GLB on model:', entry.glbUrl, err);
        });
      this.isLeftDragging = false;
      return;
    }

    if (!hit) {
      this.isLeftDragging = false;
      return;
    }

    const snapped = this.snapAssetCoord(hit);
    void this.assets
      .placeAsset(entry, snapped.x, snapped.z, {
        ...this.getCurrentAssetTransform(),
        rotationDegrees: snapped.rotationDegrees,
        ...(snapped.wallSnap
          ? {
              wallDecorMode: this.assetTool.wallDecorMode,
              wallSide: snapped.wallSnap.wallSide,
            }
          : {}),
      })
      .then((placed) => {
        this.assetTool.selectedPlacedId = placed.id;
        this.isDirty = true;
        this.refreshSelectionRing();
        this.syncDynamicLights();
        this.scene.fitSunShadows();
        this.onStateChange?.();
      })
      .catch((err: unknown) => {
        console.error('Failed to place local GLB:', entry.glbUrl, err);
      });
    this.isLeftDragging = false;
  }

  private updateRuler(hit: TerrainPickHit): void {
    if (!this.measureStart) return;
    const endH = this.grid.sampleHeightAtTileCoord(hit.tileFloatX, hit.tileFloatZ);
    const end = {
      x: (hit.tileX + 0.5) * TILE_SIZE_METERS,
      y: endH * METERS_PER_HEIGHT_UNIT,
      z: (hit.tileZ + 0.5) * TILE_SIZE_METERS,
    };
    this.renderer.setRulerLine(this.measureStart, end);

    const dxTiles = Math.abs(hit.tileX - this.measureStart.tx);
    const dzTiles = Math.abs(hit.tileZ - this.measureStart.tz);
    const gridSquares = Math.max(dxTiles, dzTiles);
    const gridFeet = gridSquares * TILE_SIZE_FEET;
    const gridMeters = gridSquares * TILE_SIZE_METERS;
    const elevDeltaFeet = Math.round(heightUnitsToFeet(endH - this.measureStart.hUnits));
    const elevSign = elevDeltaFeet > 0 ? `+${elevDeltaFeet}` : `${elevDeltaFeet}`;

    const mid = {
      x: (this.measureStart.x + end.x) * 0.5,
      y: Math.max(this.measureStart.y, end.y) + this.activeLayerOffsetY + 0.75,
      z: (this.measureStart.z + end.z) * 0.5,
    };
    this.scene.setRulerLabel(
      mid,
      `${gridFeet} ft (${gridMeters.toFixed(1)} m) · ${gridSquares} sq · Δh ${elevSign} ft`
    );
  }

  private updatePreview(hit: TerrainPickHit | null, ray: Ray3 | null = this.lastHoverRay): void {
    if (this.activeTool === 'ORBIT' || this.activeTool === 'MEASURE' || this.activeTool === 'LIGHT') {
      this.renderer.setBrushPreview([], []);
      this.assets.hideGhostPreview();
      return;
    }

    if (this.activeTool === 'ASSET') {
      if (this.assetTool.subMode === 'place' && this.assetTool.selectedAsset) {
        const stackHit = this.resolveAssetStack(ray);
        if (stackHit) {
          this.assets.updateGhostPreview(this.assetTool.selectedAsset, stackHit.tileX, stackHit.tileZ, {
            ...this.getCurrentAssetTransform(),
            yOffsetFeet: stackHit.yOffsetFeet + this.assetTool.yOffsetFeet,
          });
          this.renderer.setBrushPreview([], [], [], [
            { ...stackHit.surfaceBox, color: [0.35, 0.98, 0.45] },
          ]);
          return;
        }
      }
    }

    if (!hit) {
      this.renderer.setBrushPreview([], []);
      this.assets.hideGhostPreview();
      return;
    }

    if (this.activeTool !== 'ASSET') {
      this.assets.hideGhostPreview();
    }

    if (this.activeTool === 'SCULPT') {
      const markers: BrushMarker[] = [];
      const r = this.sculpt.radius;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const vx = hit.vertexX + dx;
          const vz = hit.vertexZ + dz;
          if (!this.grid.inVertexBounds(vx, vz)) continue;
          const w = sculptInfluence(this.sculpt.shape, this.sculpt.falloff, dx, dz, r);
          if (w <= 0) continue;
          const h = this.grid.getHeight(vx, vz);
          const eligible = vertexMatchesMask(this.grid, vx, vz, h, this.sculpt);
          const color: [number, number, number] = !eligible
            ? [0.95, 0.2, 0.2]
            : this.sculpt.mode === 'LOWER' || this.sculpt.mode === 'VALLEY'
              ? [1.0, 0.62, 0.12]
              : [0.15, 0.92, 0.88];
          markers.push({
            x: vx * TILE_SIZE_METERS,
            y: h * METERS_PER_HEIGHT_UNIT,
            z: vz * TILE_SIZE_METERS,
            weight: w,
            color,
          });
        }
      }
      this.renderer.setBrushPreview(markers, []);
      return;
    }

    if (this.activeTool === 'CLIFF') {
      if (this.cliffSubMode === 'shadow') {
        const markers: BrushMarker[] = [];
        const r = Math.max(0, this.shadowBrush.radius);
        const color: [number, number, number] =
          this.shadowBrush.action === 'DARKEN' ? [0.62, 0.42, 0.98] : [1.0, 0.85, 0.35];
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const vx = hit.vertexX + dx;
            const vz = hit.vertexZ + dz;
            if (!this.grid.inVertexBounds(vx, vz)) continue;
            const dist =
              this.shadowBrush.shape === 'SQUARE' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
            if (dist > r + 0.01) continue;
            const w = r === 0 ? 1 : falloffWeight('SMOOTH', dist / (r + 1));
            const h = this.grid.getHeight(vx, vz);
            markers.push({
              x: vx * TILE_SIZE_METERS,
              y: h * METERS_PER_HEIGHT_UNIT,
              z: vz * TILE_SIZE_METERS,
              weight: w,
              color,
            });
          }
        }
        this.renderer.setBrushPreview(markers, []);
        return;
      }

      const isHole = this.cliffSubMode === 'hole';
      const r = isHole ? this.holeBrush.radius : this.cliff.radius;
      const shape = isHole ? this.holeBrush.shape : 'CIRCLE';
      const outlines: { tx: number; tz: number; color: readonly [number, number, number] }[] = [];
      const color: [number, number, number] = isHole
        ? this.holeBrush.action === 'CUTOUT'
          ? [1.0, 0.36, 0.22]
          : [0.22, 0.92, 0.85]
        : [0.95, 0.65, 0.2];

      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist = shape === 'SQUARE' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
          if (dist > r + 0.25) continue;
          const tx = hit.tileX + dx;
          const tz = hit.tileZ + dz;
          if (!this.grid.inTileBounds(tx, tz)) continue;
          outlines.push({ tx, tz, color });
        }
      }
      this.renderer.setBrushPreview([], outlines);
      return;
    }

    if (this.activeTool === 'PAINT') {
      const r = this.paint.radius;
      const shape = this.paint.brushShape;
      const outlines: { tx: number; tz: number; color: readonly [number, number, number] }[] = [];
      const color: [number, number, number] =
        this.paint.layer === 'ERASE_OVERLAY' ? [0.95, 0.25, 0.25] : [0.2, 0.95, 0.6];

      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist = shape === 'SQUARE' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
          if (dist > r + 0.25) continue;
          const tx = hit.tileX + dx;
          const tz = hit.tileZ + dz;
          if (!this.grid.inTileBounds(tx, tz)) continue;
          outlines.push({ tx, tz, color });
        }
      }
      this.renderer.setBrushPreview([], outlines);
      return;
    }

    if (this.activeTool === 'ASSET') {
      const snapped = this.snapAssetCoord(hit);
      if (this.assetTool.subMode === 'place' && this.assetTool.selectedAsset) {
        this.assets.updateGhostPreview(this.assetTool.selectedAsset, snapped.x, snapped.z, {
          ...this.getCurrentAssetTransform(),
          rotationDegrees: snapped.rotationDegrees,
        });
        const wallEdges = snapped.wallSnap
          ? [
              {
                x0: snapped.wallSnap.edgeStart.x,
                z0: snapped.wallSnap.edgeStart.z,
                x1: snapped.wallSnap.edgeEnd.x,
                z1: snapped.wallSnap.edgeEnd.z,
                color: snapped.wallSnap.attachedToPropId
                  ? ([1.0, 0.72, 0.18] as const)
                  : ([0.3, 0.92, 1.0] as const),
              },
            ]
          : [];
        this.renderer.setBrushPreview(
          [],
          this.buildFootprintOutlines(
            snapped.startX,
            snapped.startZ,
            snapped.widthTiles,
            snapped.lengthTiles,
            [0.3, 0.88, 1.0]
          ),
          wallEdges
        );
      } else {
        this.assets.hideGhostPreview();
        const nearest = this.assets.findNearest(hit.tileFloatX, hit.tileFloatZ, 1.5);
        const outlineColor: readonly [number, number, number] =
          this.assetTool.subMode === 'replace'
            ? nearest
              ? [1.0, 0.68, 0.15]
              : [0.6, 0.6, 0.65]
            : nearest
              ? [0.35, 0.95, 0.5]
              : [0.45, 0.65, 0.85];
        if (nearest) {
          const rot = getRotatedFootprint(nearest.entry, nearest.rotationDegrees);
          const startX = Math.round(nearest.tileX - rot.widthTiles * 0.5);
          const startZ = Math.round(nearest.tileZ - rot.lengthTiles * 0.5);
          this.renderer.setBrushPreview(
            [],
            this.buildFootprintOutlines(startX, startZ, rot.widthTiles, rot.lengthTiles, outlineColor)
          );
        } else {
          this.renderer.setBrushPreview([], [{ tx: hit.tileX, tz: hit.tileZ, color: outlineColor }]);
        }
      }
    }
  }

  // ---- Liquid Surface Tool API & Interactive Viewport Handlers ----

  getSelectedLiquid(): LiquidSurface | null {
    if (!this.liquidTool.selectedLiquidId) return null;
    const found = this.liquids.getById(this.liquidTool.selectedLiquidId);
    if (!found || found.layer !== this.activeLayer) return null;
    return found;
  }

  getConnectedLiquidIds(seedId?: string): Set<string> {
    const id = seedId ?? this.liquidTool.selectedLiquidId;
    if (!id) return new Set<string>();
    return findConnectedLiquidIds(this.liquids.getForLayer(this.activeLayer), id, true);
  }

  selectLiquid(id: string | null): void {
    this.liquidTool.selectedLiquidId = id;
    const sel = this.getSelectedLiquid();
    if (sel) {
      this.liquidTool.preset = sel.preset;
      this.liquidTool.levelFeet = sel.levelFeet;
      this.liquidTool.opacity = sel.opacity ?? null;
    }
    this.refreshLiquidOverlay();
    this.onStateChange?.();
  }

  setLiquidSubMode(mode: LiquidSubMode): void {
    this.liquidTool.subMode = mode;
    this.liquidTool.pickingTerrainLevel = false;
    this.liquidDrawStart = null;
    this.liquidDragAction = null;
    this.liquidPreviewRect = null;
    this.activeLiquidSnapLines = [];
    this.hoveredLiquidEdge = null;
    this.refreshLiquidOverlay();
    this.onStateChange?.();
  }

  private getTargetLiquidIdsForEdit(): string[] {
    const sel = this.getSelectedLiquid();
    if (!sel) return [];
    if (!this.liquidTool.linkConnected) return [sel.id];
    return Array.from(this.getConnectedLiquidIds(sel.id));
  }

  setLiquidPreset(preset: LiquidPresetId): void {
    this.liquidTool.preset = preset;
    this.liquidTool.opacity = null;
    const targets = this.getTargetLiquidIdsForEdit();
    if (targets.length > 0) {
      for (const id of targets) {
        this.liquids.updateSurface(id, { preset, opacity: undefined });
      }
      this.isDirty = true;
    }
    this.refreshLiquidOverlay();
    this.onStateChange?.();
  }

  setLiquidLevelFeet(levelFeet: number): void {
    const clamped = clampLiquidLevelFeet(levelFeet);
    this.liquidTool.levelFeet = clamped;
    const targets = this.getTargetLiquidIdsForEdit();
    if (targets.length > 0) {
      for (const id of targets) {
        this.liquids.updateSurface(id, { levelFeet: clamped });
      }
      this.isDirty = true;
    }
    this.refreshLiquidOverlay();
    this.onStateChange?.();
  }

  nudgeLiquidLevel(deltaFeet: number): void {
    this.setLiquidLevelFeet(this.liquidTool.levelFeet + deltaFeet);
  }

  setLiquidOpacity(opacity: number | null): void {
    const nextOpacity = opacity === null ? null : clampLiquidOpacity(opacity);
    this.liquidTool.opacity = nextOpacity;
    const targets = this.getTargetLiquidIdsForEdit();
    if (targets.length > 0) {
      for (const id of targets) {
        this.liquids.updateSurface(id, { opacity: nextOpacity ?? undefined });
      }
      this.isDirty = true;
    }
    this.onStateChange?.();
  }

  updateSelectedLiquidRect(patch: Partial<LiquidRect>): void {
    const sel = this.getSelectedLiquid();
    if (!sel) return;
    const clamped = clampLiquidRectToMap(
      {
        x: patch.x ?? sel.x,
        z: patch.z ?? sel.z,
        width: patch.width ?? sel.width,
        length: patch.length ?? sel.length,
      },
      this.grid.width,
      this.grid.length
    );
    this.liquids.updateSurface(sel.id, clamped);
    this.isDirty = true;
    this.refreshLiquidOverlay();
    this.onStateChange?.();
  }

  addLiquidAtMapCenter(): LiquidSurface {
    const w = Math.max(MIN_LIQUID_SIZE_TILES, Math.min(this.grid.width, this.liquidTool.defaultWidth));
    const l = Math.max(MIN_LIQUID_SIZE_TILES, Math.min(this.grid.length, this.liquidTool.defaultLength));
    const rect = clampLiquidRectToMap(
      {
        x: quantizeStep((this.grid.width - w) * 0.5, this.liquidTool.snapStep),
        z: quantizeStep((this.grid.length - l) * 0.5, this.liquidTool.snapStep),
        width: w,
        length: l,
      },
      this.grid.width,
      this.grid.length
    );
    const created = this.liquids.addSurface({
      id: this.liquids.allocateId(),
      layer: this.activeLayer,
      preset: this.liquidTool.preset,
      ...rect,
      levelFeet: this.liquidTool.levelFeet,
      ...(this.liquidTool.opacity !== null ? { opacity: this.liquidTool.opacity } : {}),
    });
    this.liquidTool.selectedLiquidId = created.id;
    this.liquidTool.subMode = 'edit';
    this.isDirty = true;
    this.refreshLiquidOverlay();
    this.onStateChange?.();
    return created;
  }

  continueSelectedLiquid(side: LiquidEdgeSide, extensionTiles = this.liquidTool.continueSpan): LiquidSurface | null {
    const sel = this.getSelectedLiquid();
    if (!sel) return null;
    const next = createContinuedLiquid(
      sel,
      side,
      extensionTiles,
      this.grid.width,
      this.grid.length,
      this.liquids.allocateId()
    );
    if (!next) return null;
    const added = this.liquids.addSurface(next);
    this.liquidTool.selectedLiquidId = added.id;
    this.liquidTool.levelFeet = added.levelFeet;
    this.liquidTool.preset = added.preset;
    this.isDirty = true;
    this.refreshLiquidOverlay();
    this.onStateChange?.();
    return added;
  }

  matchNeighborLiquidLevel(): void {
    const sel = this.getSelectedLiquid();
    if (!sel) return;
    const neighbor = findAdjacentNeighbor(this.liquids.getForLayer(this.activeLayer), sel);
    if (!neighbor) return;
    this.setLiquidLevelFeet(neighbor.levelFeet);
  }

  duplicateSelectedLiquid(): LiquidSurface | null {
    const sel = this.getSelectedLiquid();
    if (!sel) return null;
    const offsetRect = clampLiquidRectToMap(
      { x: sel.x + 1, z: sel.z + 1, width: sel.width, length: sel.length },
      this.grid.width,
      this.grid.length
    );
    const created = this.liquids.addSurface({
      ...sel,
      ...offsetRect,
      id: this.liquids.allocateId(),
    });
    this.liquidTool.selectedLiquidId = created.id;
    this.isDirty = true;
    this.refreshLiquidOverlay();
    this.onStateChange?.();
    return created;
  }

  deleteSelectedLiquid(): void {
    if (!this.liquidTool.selectedLiquidId) return;
    this.deleteLiquidById(this.liquidTool.selectedLiquidId);
  }

  deleteLiquidById(id: string): void {
    if (!this.liquids.removeSurface(id)) return;
    if (this.liquidTool.selectedLiquidId === id) {
      this.liquidTool.selectedLiquidId = null;
    }
    this.isDirty = true;
    this.refreshLiquidOverlay();
    this.onStateChange?.();
  }

  refreshLiquidOverlay(): void {
    if (this.activeTool !== 'LIQUID') {
      this.liquids.setOverlayState(null);
      return;
    }
    const sel = this.getSelectedLiquid();
    const layerSurfaces = this.liquids.getForLayer(this.activeLayer);
    const connectedIds = sel ? findConnectedLiquidIds(layerSurfaces, sel.id, true) : new Set<string>();
    const connectedNeighbors = sel
      ? layerSurfaces.filter((s) => s.id !== sel.id && connectedIds.has(s.id))
      : [];

    this.liquids.setOverlayState({
      selected: sel,
      connectedNeighbors,
      hoveredEdge: this.hoveredLiquidEdge,
      previewRect: this.liquidPreviewRect,
      snapLines: this.activeLiquidSnapLines,
      // overlayRoot is already positioned at activeLayerOffsetY
      layerOffsetY: 0,
    });
  }

  private sampleLiquidPlaneCoord(
    ray: Ray3,
    hit: TerrainPickHit | null,
    levelFeet: number
  ): { tileX: number; tileZ: number } | null {
    const planeHit = intersectHorizontalPlane(
      ray,
      feetToWorldMeters(levelFeet) + this.activeLayerOffsetY
    );
    if (
      planeHit &&
      planeHit.tileX >= -2 &&
      planeHit.tileX <= this.grid.width + 2 &&
      planeHit.tileZ >= -2 &&
      planeHit.tileZ <= this.grid.length + 2
    ) {
      return {
        tileX: Math.max(0, Math.min(this.grid.width, planeHit.tileX)),
        tileZ: Math.max(0, Math.min(this.grid.length, planeHit.tileZ)),
      };
    }
    if (hit) {
      return { tileX: hit.tileFloatX, tileZ: hit.tileFloatZ };
    }
    return null;
  }

  private handleLiquidPointerDown(ray: Ray3, hit: TerrainPickHit | null, e: PointerEvent): void {
    if (this.liquidTool.pickingTerrainLevel) {
      if (hit) {
        const hUnits = this.grid.sampleHeightAtTileCoord(hit.tileFloatX, hit.tileFloatZ);
        const rawFeet = heightUnitsToFeet(hUnits);
        const snappedFeet = Math.round(rawFeet * 4) / 4;
        this.liquidTool.pickingTerrainLevel = false;
        this.setLiquidLevelFeet(snappedFeet);
      }
      return;
    }

    const layerSurfaces = this.liquids.getForLayer(this.activeLayer);

    if (this.liquidTool.subMode === 'edit') {
      const picked = pickLiquidSurface(ray, layerSurfaces, this.activeLayerOffsetY);
      if (e.altKey && picked) {
        this.deleteLiquidById(picked.surface.id);
        return;
      }

      const sel = this.getSelectedLiquid();
      if (sel) {
        const edge = pickLiquidEdgeHandle(ray, sel, this.activeLayerOffsetY);
        if (edge) {
          if (e.shiftKey) {
            // Shift+drag an edge handle to pull out a new flush-connected segment!
            const continued = this.continueSelectedLiquid(edge, MIN_LIQUID_SIZE_TILES);
            if (continued) {
              this.liquidDragAction = {
                kind: 'resize',
                id: continued.id,
                side: edge,
                origRect: { x: continued.x, z: continued.z, width: continued.width, length: continued.length },
              };
            }
            return;
          }
          this.liquidDragAction = {
            kind: 'resize',
            id: sel.id,
            side: edge,
            origRect: { x: sel.x, z: sel.z, width: sel.width, length: sel.length },
          };
          return;
        }
      }

      if (picked) {
        this.selectLiquid(picked.surface.id);
        this.liquidDragAction = {
          kind: 'move',
          id: picked.surface.id,
          startTileX: picked.tileX,
          startTileZ: picked.tileZ,
          origX: picked.surface.x,
          origZ: picked.surface.z,
        };
      } else {
        this.selectLiquid(null);
      }
      return;
    }

    // Draw sub-mode
    const pt = this.sampleLiquidPlaneCoord(ray, hit, this.liquidTool.levelFeet);
    if (!pt) return;

    let startX = quantizeStep(pt.tileX, this.liquidTool.snapStep);
    let startZ = quantizeStep(pt.tileZ, this.liquidTool.snapStep);
    let drawLevel = this.liquidTool.levelFeet;
    let drawPreset = this.liquidTool.preset;
    let snapLines: LiquidSnapLine[] = [];

    if (this.liquidTool.edgeSnap && layerSurfaces.length > 0) {
      const snapped = snapPointToLiquidEdges(pt.tileX, pt.tileZ, layerSurfaces);
      if (snapped.snappedTo) {
        startX = snapped.x;
        startZ = snapped.z;
        drawLevel = snapped.snappedTo.levelFeet;
        drawPreset = snapped.snappedTo.preset;
        snapLines = snapped.snapLines;
        this.liquidTool.levelFeet = drawLevel;
        this.liquidTool.preset = drawPreset;
      }
    }

    this.liquidDrawStart = {
      x: roundCoord(Math.max(0, Math.min(this.grid.width, startX))),
      z: roundCoord(Math.max(0, Math.min(this.grid.length, startZ))),
      levelFeet: drawLevel,
      preset: drawPreset,
      snapLines,
    };
    this.activeLiquidSnapLines = snapLines;
    this.liquidPreviewRect = {
      x: this.liquidDrawStart.x,
      z: this.liquidDrawStart.z,
      width: MIN_LIQUID_SIZE_TILES,
      length: MIN_LIQUID_SIZE_TILES,
      levelFeet: drawLevel,
      colorHex: getLiquidPreset(drawPreset).hex,
    };
    this.refreshLiquidOverlay();
  }

  private handleLiquidPointerMove(ray: Ray3, hit: TerrainPickHit | null): void {
    const layerSurfaces = this.liquids.getForLayer(this.activeLayer);

    // Active drag: drawing a new liquid rectangle
    if (this.liquidDrawStart) {
      const pt = this.sampleLiquidPlaneCoord(ray, hit, this.liquidDrawStart.levelFeet);
      if (!pt) return;

      let endX = quantizeStep(pt.tileX, this.liquidTool.snapStep);
      let endZ = quantizeStep(pt.tileZ, this.liquidTool.snapStep);
      let snapLines = [...this.liquidDrawStart.snapLines];

      if (this.liquidTool.edgeSnap && layerSurfaces.length > 0) {
        const snapped = snapPointToLiquidEdges(pt.tileX, pt.tileZ, layerSurfaces);
        if (snapped.snappedTo) {
          endX = snapped.x;
          endZ = snapped.z;
          snapLines = [...snapLines, ...snapped.snapLines];
        }
      }

      const minX = Math.min(this.liquidDrawStart.x, endX);
      const minZ = Math.min(this.liquidDrawStart.z, endZ);
      const maxX = Math.max(this.liquidDrawStart.x, endX);
      const maxZ = Math.max(this.liquidDrawStart.z, endZ);
      const width = Math.max(MIN_LIQUID_SIZE_TILES, maxX - minX);
      const length = Math.max(MIN_LIQUID_SIZE_TILES, maxZ - minZ);
      const clamped = clampLiquidRectToMap(
        { x: minX, z: minZ, width, length },
        this.grid.width,
        this.grid.length
      );

      this.activeLiquidSnapLines = snapLines;
      this.liquidPreviewRect = {
        ...clamped,
        levelFeet: this.liquidDrawStart.levelFeet,
        colorHex: getLiquidPreset(this.liquidDrawStart.preset).hex,
      };
      this.refreshLiquidOverlay();
      return;
    }

    // Active drag: resizing or moving an existing liquid surface
    if (this.liquidDragAction) {
      const target = this.liquids.getById(this.liquidDragAction.id);
      if (!target) return;
      const others = layerSurfaces.filter((s) => s.id !== target.id);
      const pt = this.sampleLiquidPlaneCoord(ray, hit, target.levelFeet);
      if (!pt) return;

      if (this.liquidDragAction.kind === 'move') {
        const dx = pt.tileX - this.liquidDragAction.startTileX;
        const dz = pt.tileZ - this.liquidDragAction.startTileZ;
        let nextRect: LiquidRect = {
          x: quantizeStep(this.liquidDragAction.origX + dx, this.liquidTool.snapStep),
          z: quantizeStep(this.liquidDragAction.origZ + dz, this.liquidTool.snapStep),
          width: target.width,
          length: target.length,
        };
        let snapLines: LiquidSnapLine[] = [];
        if (this.liquidTool.edgeSnap && others.length > 0) {
          const snapped = snapLiquidRectMove(nextRect, others);
          nextRect = snapped.rect;
          snapLines = snapped.snapLines;
        }
        const clamped = clampLiquidRectToMap(nextRect, this.grid.width, this.grid.length);
        this.liquids.updateSurface(target.id, clamped);
        this.activeLiquidSnapLines = snapLines;
        this.isDirty = true;
        this.refreshLiquidOverlay();
        return;
      }

      {
        const side = this.liquidDragAction.side;
        const orig = this.liquidDragAction.origRect;
        let coordX = quantizeStep(pt.tileX, this.liquidTool.snapStep);
        let coordZ = quantizeStep(pt.tileZ, this.liquidTool.snapStep);
        let snapLines: LiquidSnapLine[] = [];

        if (this.liquidTool.edgeSnap && others.length > 0) {
          const snapped = snapPointToLiquidEdges(pt.tileX, pt.tileZ, others);
          if (snapped.snappedTo) {
            if (side === 'E' || side === 'W') {
              coordX = snapped.x;
            } else {
              coordZ = snapped.z;
            }
            snapLines = snapped.snapLines;
          }
        }

        let x = orig.x;
        let z = orig.z;
        let width = orig.width;
        let length = orig.length;

        if (side === 'E') {
          width = Math.max(MIN_LIQUID_SIZE_TILES, Math.min(this.grid.width - orig.x, coordX - orig.x));
        } else if (side === 'W') {
          const maxX = orig.x + orig.width;
          const clampedX = Math.max(0, Math.min(maxX - MIN_LIQUID_SIZE_TILES, coordX));
          x = clampedX;
          width = maxX - clampedX;
        } else if (side === 'S') {
          length = Math.max(MIN_LIQUID_SIZE_TILES, Math.min(this.grid.length - orig.z, coordZ - orig.z));
        } else {
          // 'N'
          const maxZ = orig.z + orig.length;
          const clampedZ = Math.max(0, Math.min(maxZ - MIN_LIQUID_SIZE_TILES, coordZ));
          z = clampedZ;
          length = maxZ - clampedZ;
        }

        this.liquids.updateSurface(target.id, {
          x: roundCoord(x),
          z: roundCoord(z),
          width: roundCoord(width),
          length: roundCoord(length),
        });
        this.activeLiquidSnapLines = snapLines;
        this.isDirty = true;
        this.refreshLiquidOverlay();
        return;
      }
    }

    // Hover feedback (no active drag)
    if (this.liquidTool.subMode === 'edit') {
      const sel = this.getSelectedLiquid();
      const nextHovered = sel ? pickLiquidEdgeHandle(ray, sel, this.activeLayerOffsetY) : null;
      this.liquidPreviewRect = null;
      this.activeLiquidSnapLines = [];
      if (nextHovered !== this.hoveredLiquidEdge) {
        this.hoveredLiquidEdge = nextHovered;
        this.refreshLiquidOverlay();
      }
      return;
    }

    // Hover preview in Draw mode
    this.hoveredLiquidEdge = null;
    if (this.liquidTool.pickingTerrainLevel) {
      this.liquidPreviewRect = null;
      this.activeLiquidSnapLines = [];
      this.refreshLiquidOverlay();
      return;
    }

    const pt = this.sampleLiquidPlaneCoord(ray, hit, this.liquidTool.levelFeet);
    if (!pt) {
      this.liquidPreviewRect = null;
      this.activeLiquidSnapLines = [];
      this.refreshLiquidOverlay();
      return;
    }

    const w = Math.max(MIN_LIQUID_SIZE_TILES, this.liquidTool.defaultWidth);
    const l = Math.max(MIN_LIQUID_SIZE_TILES, this.liquidTool.defaultLength);
    let previewRect: LiquidRect = {
      x: quantizeStep(pt.tileX - w * 0.5, this.liquidTool.snapStep),
      z: quantizeStep(pt.tileZ - l * 0.5, this.liquidTool.snapStep),
      width: w,
      length: l,
    };
    let previewLevel = this.liquidTool.levelFeet;
    let previewPreset = this.liquidTool.preset;
    let snapLines: LiquidSnapLine[] = [];

    if (this.liquidTool.edgeSnap && layerSurfaces.length > 0) {
      const snapped = snapLiquidRectMove(previewRect, layerSurfaces);
      if (snapped.snappedTo) {
        previewRect = snapped.rect;
        previewLevel = snapped.snappedTo.levelFeet;
        previewPreset = snapped.snappedTo.preset;
        snapLines = snapped.snapLines;
      }
    }

    this.activeLiquidSnapLines = snapLines;
    this.liquidPreviewRect = {
      ...clampLiquidRectToMap(previewRect, this.grid.width, this.grid.length),
      levelFeet: previewLevel,
      colorHex: getLiquidPreset(previewPreset).hex,
    };
    this.refreshLiquidOverlay();
  }

  private handleLiquidPointerUp(): void {
    if (this.liquidDrawStart) {
      const start = this.liquidDrawStart;
      const preview = this.liquidPreviewRect;
      this.liquidDrawStart = null;
      this.liquidPreviewRect = null;
      this.activeLiquidSnapLines = [];

      const layerSurfaces = this.liquids.getForLayer(this.activeLayer);
      let finalRect: LiquidRect;
      if (preview && (preview.width > MIN_LIQUID_SIZE_TILES + 0.05 || preview.length > MIN_LIQUID_SIZE_TILES + 0.05)) {
        finalRect = {
          x: preview.x,
          z: preview.z,
          width: preview.width,
          length: preview.length,
        };
      } else {
        // Click without drag: drop default-size liquid patch (snapped flush if near neighbor)
        const w = Math.max(MIN_LIQUID_SIZE_TILES, this.liquidTool.defaultWidth);
        const l = Math.max(MIN_LIQUID_SIZE_TILES, this.liquidTool.defaultLength);
        let dropRect: LiquidRect = {
          x: start.x - w * 0.5,
          z: start.z - l * 0.5,
          width: w,
          length: l,
        };
        if (this.liquidTool.edgeSnap && layerSurfaces.length > 0) {
          dropRect = snapLiquidRectMove(dropRect, layerSurfaces).rect;
        }
        finalRect = clampLiquidRectToMap(dropRect, this.grid.width, this.grid.length);
      }

      const created = this.liquids.addSurface({
        id: this.liquids.allocateId(),
        layer: this.activeLayer,
        preset: start.preset,
        ...finalRect,
        levelFeet: start.levelFeet,
        ...(this.liquidTool.opacity !== null ? { opacity: this.liquidTool.opacity } : {}),
      });
      this.liquidTool.selectedLiquidId = created.id;
      this.isDirty = true;
      this.refreshLiquidOverlay();
      this.onStateChange?.();
      return;
    }

    if (this.liquidDragAction) {
      this.liquidDragAction = null;
      this.activeLiquidSnapLines = [];
      this.refreshLiquidOverlay();
      this.onStateChange?.();
    }
  }

  destroy(): void {
    this.eventAbort.abort();
    this.assets.hideGhostPreview();
  }
}
