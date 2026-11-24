/**
 * Map document schema, size presets, procedural template creation,
 * serialization, and strict validation for D&D 5ft/1.5m maps.
 */

import {
  HEIGHT_UNITS_PER_TILE,
  TILE_SIZE_FEET,
  TILE_SIZE_METERS,
  feetToHeightUnits,
} from '../terrain/constants';
import { CAVE_MUDSTONE_UNDERLAY_ID, CAVE_ROCK_UNDERLAY_ID, DEFAULT_UNDERLAY_ID } from '../terrain/materials';
import {
  clampLiquidLevelFeet,
  clampLiquidOpacity,
  clampLiquidRectToMap,
  isValidLiquidPreset,
  type LiquidSurface,
} from '../terrain/liquidSurface';
import { TerrainGrid, type TerrainSnapshot } from '../terrain/terrainGrid';
import {
  createDefaultLightingSettings,
  type LightingSettings,
} from '../render/lightingSystem';
import type { AssetScalePolicy } from '../render/modelScalePolicy';
import type { TerrainShadingMode } from '../render/terrainRenderer';
import type { WallDecorMode } from '../render/wallDecoration';

export const VTT_MAP_SCHEMA_VERSION = 1;
export const MIN_MAP_TILES = 8;
export const MAX_MAP_TILES = 96;
export const DEFAULT_INTERIOR_DEPTH_FEET = 12;

export type MapLayerId = 'surface' | 'interior';
export type MapTemplateId = 'flat' | 'rolling_hills' | 'dungeon';

export interface MapSizePreset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly length: number;
}

export const MAP_SIZE_PRESETS: readonly MapSizePreset[] = [
  { id: 'skirmish', label: 'Skirmish', width: 16, length: 16 },
  { id: 'room', label: 'Tavern / Hall', width: 24, length: 16 },
  { id: 'encounter', label: 'Encounter', width: 32, length: 32 },
  { id: 'road', label: 'Road Ambush', width: 48, length: 24 },
  { id: 'battlefield', label: 'Battlefield', width: 48, length: 48 },
  { id: 'siege', label: 'Grand Siege', width: 64, length: 64 },
];

export interface CreateMapOptions {
  name: string;
  width: number;
  length: number;
  template: MapTemplateId;
  baseUnderlayId: number;
  baseElevationFeet: number;
  includeStarterProps: boolean;
}

export interface SerializedProp {
  key: string;
  /** Which map layer this prop belongs to ('surface' by default, or 'interior' for underground caves/rooms). */
  layer?: MapLayerId;
  tileX: number;
  tileZ: number;
  rotationDegrees: number;
  scalePolicy: AssetScalePolicy;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  yOffsetFeet: number;
  wallDecorMode?: WallDecorMode;
  wallSide?: 'N' | 'S' | 'E' | 'W' | 'DIAG';
  /** Optional unlit dark cave void backing behind scenic dead-end cave entrances. */
  caveVoid?: boolean;
  /** Optional roof-layer tag so roof cutaway can toggle ceilings/crowns cleanly. */
  roofLayer?: boolean;
}

export interface VttMapDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  scale: {
    tileMeters: number;
    tileFeet: number;
    heightUnitsPerTile: number;
  };
  settings: {
    shadingMode: TerrainShadingMode;
    showGrid: boolean;
    /** Whether roof/ceiling cutaway is enabled for inspecting interiors & caves. */
    roofCutaway?: boolean;
    /** Vertical separation (in feet) of the Interior layer below the Surface layer's 0 ft datum. */
    interiorDepthFeet?: number;
    lighting?: LightingSettings;
  };
  terrain: TerrainSnapshot;
  /** Optional subterranean / cave Interior terrain layer sitting cleanly beneath the intact Surface floor. */
  interior?: TerrainSnapshot;
  /** Optional independent flat liquid surface planes (water, swamp, sewer sludge, magma, acid, etc.). */
  liquids?: LiquidSurface[];
  props: SerializedProp[];
}

export interface SavedMapSummary {
  id: string;
  name: string;
  width: number;
  length: number;
  propCount: number;
  updatedAt: string;
  storage: 'disk' | 'browser';
}

export function clampMapDimension(value: number): number {
  if (!Number.isFinite(value)) return 32;
  return Math.max(MIN_MAP_TILES, Math.min(MAX_MAP_TILES, Math.round(value)));
}

export function sanitizeMapId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug.length > 0 ? slug : 'untitled-map';
}

export function createGridFromTemplate(options: CreateMapOptions): TerrainGrid {
  const width = clampMapDimension(options.width);
  const length = clampMapDimension(options.length);
  const grid = new TerrainGrid(width, length);

  const fallbackUnderlay = options.template === 'dungeon' ? CAVE_ROCK_UNDERLAY_ID : DEFAULT_UNDERLAY_ID;
  const underlayId = Number.isFinite(options.baseUnderlayId) && options.baseUnderlayId > 0
    ? Math.round(options.baseUnderlayId)
    : fallbackUnderlay;
  const baseH = feetToHeightUnits(options.baseElevationFeet || 0);

  grid.underlayIds.fill(underlayId);
  grid.clearAllOverlays();

  if (options.template === 'flat' || options.template === 'dungeon') {
    grid.heights.fill(baseH);
  } else {
    // Rolling hills: gentle multi-frequency D&D elevation waves (~0..7.5 ft)
    for (let vz = 0; vz <= length; vz++) {
      for (let vx = 0; vx <= width; vx++) {
        const nx = (vx / Math.max(1, width)) * Math.PI * 2;
        const nz = (vz / Math.max(1, length)) * Math.PI * 2;
        const wave =
          Math.sin(nx * 1.3 + 0.4) * Math.cos(nz * 1.1 - 0.3) * 64 +
          Math.sin((vx + vz) * 0.24) * 28 +
          Math.cos((vx - vz * 1.2) * 0.17) * 22;
        grid.setHeight(vx, vz, baseH + Math.round(wave));
      }
    }
  }

  grid.markAllDirty();
  return grid;
}

/** Creates a clean subterranean Cave Mudstone Interior TerrainGrid matching the map dimensions. */
export function createDefaultInteriorGrid(width: number, length: number): TerrainGrid {
  const w = clampMapDimension(width);
  const l = clampMapDimension(length);
  const grid = new TerrainGrid(w, l);
  grid.underlayIds.fill(CAVE_MUDSTONE_UNDERLAY_ID);
  grid.clearAllOverlays();
  grid.heights.fill(0);
  grid.markAllDirty();
  return grid;
}

export function serializeMapDocument(params: {
  id?: string;
  name: string;
  createdAt?: string;
  grid: TerrainGrid;
  interiorGrid?: TerrainGrid;
  interiorDepthFeet?: number;
  liquids?: readonly LiquidSurface[];
  props: readonly SerializedProp[];
  shadingMode: TerrainShadingMode;
  showGrid: boolean;
  roofCutaway?: boolean;
  lighting?: LightingSettings;
}): VttMapDocument {
  const now = new Date().toISOString();
  const cleanName = params.name.trim() || 'Untitled Map';
  const id = params.id && params.id.trim().length > 0 ? sanitizeMapId(params.id) : sanitizeMapId(cleanName);

  return {
    schemaVersion: VTT_MAP_SCHEMA_VERSION,
    id,
    name: cleanName,
    createdAt: params.createdAt ?? now,
    updatedAt: now,
    scale: {
      tileMeters: TILE_SIZE_METERS,
      tileFeet: TILE_SIZE_FEET,
      heightUnitsPerTile: HEIGHT_UNITS_PER_TILE,
    },
    settings: {
      shadingMode: params.shadingMode,
      showGrid: params.showGrid,
      ...(params.roofCutaway !== undefined ? { roofCutaway: params.roofCutaway } : {}),
      ...(params.interiorDepthFeet !== undefined ? { interiorDepthFeet: params.interiorDepthFeet } : {}),
      ...(params.lighting ? { lighting: { ...params.lighting } } : {}),
    },
    terrain: params.grid.toSnapshot(),
    ...(params.interiorGrid ? { interior: params.interiorGrid.toSnapshot() } : {}),
    ...(params.liquids && params.liquids.length > 0 ? { liquids: params.liquids.map((l) => ({ ...l })) } : {}),
    props: params.props.map((p) => ({ ...p })),
  };
}

function isNumberArray(value: unknown, expectedLen: number): value is number[] {
  return Array.isArray(value) && value.length === expectedLen && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isValidScalePolicy(v: unknown): v is AssetScalePolicy {
  return v === 'auto_dnd' || v === 'tile_1_5m' || v === 'metric_1_0m';
}

function isValidShadingMode(v: unknown): v is TerrainShadingMode {
  return v === 'worldlab_flat' || v === 'rs2_gouraud' || v === 'pbr_shadows';
}

/**
 * Strictly validates and normalizes an untrusted JSON map payload into a VttMapDocument.
 * Also accepts legacy v0 Export JSON files seamlessly.
 */
export function parseMapDocument(raw: unknown, fallbackName = 'Imported Map'): VttMapDocument {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Map file must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  const terrainRaw = obj.terrain;
  if (!terrainRaw || typeof terrainRaw !== 'object') {
    throw new Error('Map file is missing terrain data.');
  }
  const t = terrainRaw as Record<string, unknown>;
  const width = typeof t.width === 'number' ? Math.round(t.width) : NaN;
  const length = typeof t.length === 'number' ? Math.round(t.length) : NaN;

  if (!Number.isFinite(width) || !Number.isFinite(length) || width < MIN_MAP_TILES || width > MAX_MAP_TILES || length < MIN_MAP_TILES || length > MAX_MAP_TILES) {
    throw new Error(`Invalid map dimensions ${width}x${length} (allowed: ${MIN_MAP_TILES}..${MAX_MAP_TILES}).`);
  }

  const vertCount = (width + 1) * (length + 1);
  const tileCount = width * length;

  const parseTerrainLayer = (layerRaw: Record<string, unknown>, label: string): TerrainSnapshot => {
    if (!isNumberArray(layerRaw.heights, vertCount)) {
      throw new Error(`${label} heights must have ${vertCount} entries.`);
    }
    if (!isNumberArray(layerRaw.underlays, tileCount)) {
      throw new Error(`${label} underlays must have ${tileCount} entries.`);
    }
    if (!isNumberArray(layerRaw.overlays, tileCount)) {
      throw new Error(`${label} overlays must have ${tileCount} entries.`);
    }
    if (!isNumberArray(layerRaw.shapes, tileCount)) {
      throw new Error(`${label} shapes must have ${tileCount} entries.`);
    }
    if (!isNumberArray(layerRaw.rotations, tileCount)) {
      throw new Error(`${label} rotations must have ${tileCount} entries.`);
    }
    const autoMetadata = isNumberArray(layerRaw.autoMetadata, tileCount)
      ? layerRaw.autoMetadata
      : new Array<number>(tileCount).fill(0);
    const autoBaseUnderlays = isNumberArray(layerRaw.autoBaseUnderlays, tileCount)
      ? layerRaw.autoBaseUnderlays
      : new Array<number>(tileCount).fill(0);
    const holes = isNumberArray(layerRaw.holes, tileCount)
      ? layerRaw.holes.map((v) => (v !== 0 ? 1 : 0))
      : new Array<number>(tileCount).fill(0);
    const vertexShade = isNumberArray(layerRaw.vertexShade, vertCount)
      ? layerRaw.vertexShade.map((v) => Math.max(0, Math.min(255, Math.round(v))))
      : new Array<number>(vertCount).fill(0);

    return {
      width,
      length,
      heights: layerRaw.heights,
      underlays: layerRaw.underlays,
      overlays: layerRaw.overlays,
      shapes: layerRaw.shapes,
      rotations: layerRaw.rotations,
      autoMetadata,
      autoBaseUnderlays,
      holes,
      vertexShade,
    };
  };

  const surfaceTerrain = parseTerrainLayer(t, 'Terrain');
  let interiorTerrain: TerrainSnapshot | undefined;
  if (obj.interior && typeof obj.interior === 'object') {
    interiorTerrain = parseTerrainLayer(obj.interior as Record<string, unknown>, 'Interior');
  }

  const liquidsRaw: unknown[] = Array.isArray(obj.liquids) ? obj.liquids : [];
  const liquids: LiquidSurface[] = [];
  for (let idx = 0; idx < liquidsRaw.length; idx++) {
    const item: unknown = liquidsRaw[idx];
    if (!item || typeof item !== 'object') continue;
    const lq = item as Record<string, unknown>;
    const id = typeof lq.id === 'string' && lq.id.trim().length > 0 ? lq.id.trim() : `liquid_${idx + 1}`;
    const layer: MapLayerId = lq.layer === 'interior' ? 'interior' : 'surface';
    const preset = isValidLiquidPreset(lq.preset) ? lq.preset : 'clear_water';
    const rawX = typeof lq.x === 'number' && Number.isFinite(lq.x) ? lq.x : 0;
    const rawZ = typeof lq.z === 'number' && Number.isFinite(lq.z) ? lq.z : 0;
    const rawW = typeof lq.width === 'number' && Number.isFinite(lq.width) ? lq.width : 4;
    const rawL = typeof lq.length === 'number' && Number.isFinite(lq.length) ? lq.length : 4;
    const clamped = clampLiquidRectToMap({ x: rawX, z: rawZ, width: rawW, length: rawL }, width, length);
    const levelFeet = clampLiquidLevelFeet(typeof lq.levelFeet === 'number' ? lq.levelFeet : 0);
    const opacity = typeof lq.opacity === 'number' && Number.isFinite(lq.opacity) ? clampLiquidOpacity(lq.opacity) : undefined;
    const colorHex = typeof lq.colorHex === 'number' && Number.isFinite(lq.colorHex) ? (Math.round(lq.colorHex) & 0xffffff) : undefined;
    liquids.push({
      id,
      layer,
      preset,
      x: clamped.x,
      z: clamped.z,
      width: clamped.width,
      length: clamped.length,
      levelFeet,
      ...(opacity !== undefined ? { opacity } : {}),
      ...(colorHex !== undefined ? { colorHex } : {}),
    });
  }

  const propsRaw = Array.isArray(obj.props) ? obj.props : [];
  const props: SerializedProp[] = [];
  for (const item of propsRaw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (typeof p.key !== 'string' || p.key.trim().length === 0) continue;
    const tileX = typeof p.tileX === 'number' && Number.isFinite(p.tileX) ? p.tileX : 0.5;
    const tileZ = typeof p.tileZ === 'number' && Number.isFinite(p.tileZ) ? p.tileZ : 0.5;
    const rotationDegrees = typeof p.rotationDegrees === 'number' && Number.isFinite(p.rotationDegrees) ? p.rotationDegrees : 0;
    const scalePolicy: AssetScalePolicy = isValidScalePolicy(p.scalePolicy) ? p.scalePolicy : 'auto_dnd';
    const scaleX = typeof p.scaleX === 'number' && Number.isFinite(p.scaleX) ? Math.max(0.1, Math.min(8, p.scaleX)) : 1;
    const scaleY = typeof p.scaleY === 'number' && Number.isFinite(p.scaleY) ? Math.max(0.1, Math.min(8, p.scaleY)) : 1;
    const scaleZ = typeof p.scaleZ === 'number' && Number.isFinite(p.scaleZ) ? Math.max(0.1, Math.min(8, p.scaleZ)) : 1;
    const yOffsetFeet = typeof p.yOffsetFeet === 'number' && Number.isFinite(p.yOffsetFeet) ? Math.max(-20, Math.min(40, p.yOffsetFeet)) : 0;
    const wallDecorMode =
      p.wallDecorMode === 'straight_offset' ||
      p.wallDecorMode === 'straight_no_offset' ||
      p.wallDecorMode === 'diagonal_offset' ||
      p.wallDecorMode === 'diagonal_no_offset'
        ? p.wallDecorMode
        : undefined;
    const wallSide =
      p.wallSide === 'N' || p.wallSide === 'S' || p.wallSide === 'E' || p.wallSide === 'W' || p.wallSide === 'DIAG'
        ? p.wallSide
        : undefined;
    const layer: MapLayerId | undefined = p.layer === 'interior' ? 'interior' : undefined;
    props.push({
      key: p.key,
      ...(layer ? { layer } : {}),
      tileX,
      tileZ,
      rotationDegrees,
      scalePolicy,
      scaleX,
      scaleY,
      scaleZ,
      yOffsetFeet,
      ...(wallDecorMode ? { wallDecorMode } : {}),
      ...(wallSide ? { wallSide } : {}),
      ...(typeof p.caveVoid === 'boolean' ? { caveVoid: p.caveVoid } : {}),
      ...(typeof p.roofLayer === 'boolean' ? { roofLayer: p.roofLayer } : {}),
    });
  }

  const now = new Date().toISOString();
  const name = typeof obj.name === 'string' && obj.name.trim().length > 0 ? obj.name.trim() : fallbackName;
  const id = typeof obj.id === 'string' && obj.id.trim().length > 0 ? sanitizeMapId(obj.id) : sanitizeMapId(name);
  const settingsRaw = (obj.settings && typeof obj.settings === 'object' ? obj.settings : {}) as Record<string, unknown>;
  let lighting: LightingSettings | undefined;
  if (settingsRaw.lighting && typeof settingsRaw.lighting === 'object') {
    const l = settingsRaw.lighting as Record<string, unknown>;
    const validPreset =
      l.preset === 'daylight' ||
      l.preset === 'golden_hour' ||
      l.preset === 'twilight' ||
      l.preset === 'night' ||
      l.preset === 'dungeon' ||
      l.preset === 'custom'
        ? (l.preset)
        : 'daylight';
    const base = createDefaultLightingSettings(validPreset === 'custom' ? 'daylight' : validPreset);
    lighting = {
      preset: validPreset,
      sunAzimuthDeg: typeof l.sunAzimuthDeg === 'number' && Number.isFinite(l.sunAzimuthDeg) ? l.sunAzimuthDeg : base.sunAzimuthDeg,
      sunElevationDeg: typeof l.sunElevationDeg === 'number' && Number.isFinite(l.sunElevationDeg) ? l.sunElevationDeg : base.sunElevationDeg,
      sunIntensity: typeof l.sunIntensity === 'number' && Number.isFinite(l.sunIntensity) ? l.sunIntensity : base.sunIntensity,
      sunColor: typeof l.sunColor === 'string' ? l.sunColor : base.sunColor,
      ambientIntensity: typeof l.ambientIntensity === 'number' && Number.isFinite(l.ambientIntensity) ? l.ambientIntensity : base.ambientIntensity,
      skyColor: typeof l.skyColor === 'string' ? l.skyColor : base.skyColor,
      groundColor: typeof l.groundColor === 'string' ? l.groundColor : base.groundColor,
      backdropColor: typeof l.backdropColor === 'string' ? l.backdropColor : base.backdropColor,
      fogEnabled: typeof l.fogEnabled === 'boolean' ? l.fogEnabled : base.fogEnabled,
      fogColor: typeof l.fogColor === 'string' ? l.fogColor : base.fogColor,
      shadowsEnabled: typeof l.shadowsEnabled === 'boolean' ? l.shadowsEnabled : base.shadowsEnabled,
      pointLightsEnabled: typeof l.pointLightsEnabled === 'boolean' ? l.pointLightsEnabled : base.pointLightsEnabled,
      pointLightIntensity: typeof l.pointLightIntensity === 'number' && Number.isFinite(l.pointLightIntensity) ? l.pointLightIntensity : base.pointLightIntensity,
      pointLightRangeScale: typeof l.pointLightRangeScale === 'number' && Number.isFinite(l.pointLightRangeScale) ? l.pointLightRangeScale : base.pointLightRangeScale,
      lavaGlowEnabled: typeof l.lavaGlowEnabled === 'boolean' ? l.lavaGlowEnabled : base.lavaGlowEnabled,
    };
  }

  const interiorDepthFeet =
    typeof settingsRaw.interiorDepthFeet === 'number' && Number.isFinite(settingsRaw.interiorDepthFeet)
      ? Math.max(5, Math.min(40, Math.round(settingsRaw.interiorDepthFeet)))
      : undefined;

  return {
    schemaVersion: VTT_MAP_SCHEMA_VERSION,
    id,
    name,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : now,
    scale: {
      tileMeters: TILE_SIZE_METERS,
      tileFeet: TILE_SIZE_FEET,
      heightUnitsPerTile: HEIGHT_UNITS_PER_TILE,
    },
    settings: {
      shadingMode: isValidShadingMode(settingsRaw.shadingMode) ? settingsRaw.shadingMode : 'pbr_shadows',
      showGrid: typeof settingsRaw.showGrid === 'boolean' ? settingsRaw.showGrid : true,
      ...(typeof settingsRaw.roofCutaway === 'boolean' ? { roofCutaway: settingsRaw.roofCutaway } : {}),
      ...(interiorDepthFeet !== undefined ? { interiorDepthFeet } : {}),
      ...(lighting ? { lighting } : {}),
    },
    terrain: surfaceTerrain,
    ...(interiorTerrain ? { interior: interiorTerrain } : {}),
    ...(liquids.length > 0 ? { liquids } : {}),
    props,
  };
}

export function gridFromMapDocument(doc: VttMapDocument): TerrainGrid {
  const grid = new TerrainGrid(doc.terrain.width, doc.terrain.length);
  grid.loadSnapshot(doc.terrain);
  return grid;
}

export function interiorGridFromMapDocument(doc: VttMapDocument): TerrainGrid {
  if (doc.interior) {
    const grid = new TerrainGrid(doc.interior.width, doc.interior.length);
    grid.loadSnapshot(doc.interior);
    return grid;
  }
  return createDefaultInteriorGrid(doc.terrain.width, doc.terrain.length);
}
