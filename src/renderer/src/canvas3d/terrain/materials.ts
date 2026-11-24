/**
 * WorldLab terrain material catalog ported from TerrainMaterialDefaults.java
 * and TerrainMaterialDefinition.java.
 *
 * Underlays softly blend across a 10x10 RS2 neighborhood window.
 * Overlays render sharp shaped-tile polygons (roads, stone, cliffs, floors, water).
 */

export type MaterialTransition = 'SOFT_LAND' | 'HARD_CLIP' | 'WATER' | 'VOID_CUTOUT';
export type MaterialLightingMode = 'SMOOTH' | 'FACETED';
export type MaterialLayerUsage = 'UNDERLAY' | 'OVERLAY' | 'BOTH';

/** Procedural RS2 surface pattern IDs passed into `worldlabTerrainBit` via `vSurfaceMeta.r`. */
export const SURFACE_PATTERN = {
  PLAIN: 0,
  WATER: 1,
  PLANKS: 2,
  COBBLE: 3,
  FLAGSTONE: 4,
  MARBLE: 5,
  MAGMA: 6,
} as const;

export type SurfacePatternId = (typeof SURFACE_PATTERN)[keyof typeof SURFACE_PATTERN];

export interface ColorVariation {
  macroHue: number;
  macroSaturation: number;
  macroLightness: number;
  tileHue: number;
  tileSaturation: number;
  tileLightness: number;
  vertexHue: number;
  vertexSaturation: number;
  vertexLightness: number;
  macroScaleTiles: number;
  hueSteps: number;
  saturationSteps: number;
  lightnessSteps: number;
}

export interface TerrainMaterialDefinition {
  id: number;
  key: string;
  name: string;
  hex: number;
  r: number;
  g: number;
  b: number;
  brightnessMultiplier: number;
  saturationMultiplier: number;
  opacity: number;
  transition: MaterialTransition;
  lightingMode: MaterialLightingMode;
  layerUsage: MaterialLayerUsage;
  transitionUnderlayId: number;
  surfacePattern: SurfacePatternId;
  colorVariation: ColorVariation;
}

const SOFT_LAND_VARIATION: ColorVariation = {
  macroHue: 0.018,
  macroSaturation: 0.06,
  macroLightness: 0.055,
  tileHue: 0.009,
  tileSaturation: 0.03,
  tileLightness: 0.032,
  vertexHue: 0.004,
  vertexSaturation: 0.015,
  vertexLightness: 0.018,
  macroScaleTiles: 10.0,
  hueSteps: 64,
  saturationSteps: 8,
  lightnessSteps: 128,
};

const HARD_OVERLAY_VARIATION: ColorVariation = {
  macroHue: 0.008,
  macroSaturation: 0.03,
  macroLightness: 0.035,
  tileHue: 0.006,
  tileSaturation: 0.02,
  tileLightness: 0.025,
  vertexHue: 0.003,
  vertexSaturation: 0.01,
  vertexLightness: 0.014,
  macroScaleTiles: 7.0,
  hueSteps: 64,
  saturationSteps: 8,
  lightnessSteps: 128,
};

const ROCK_VARIATION: ColorVariation = {
  macroHue: 0.01,
  macroSaturation: 0.04,
  macroLightness: 0.06,
  tileHue: 0.008,
  tileSaturation: 0.03,
  tileLightness: 0.04,
  vertexHue: 0.004,
  vertexSaturation: 0.02,
  vertexLightness: 0.02,
  macroScaleTiles: 8.5,
  hueSteps: 64,
  saturationSteps: 8,
  lightnessSteps: 128,
};

function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

function makeUnderlay(
  id: number,
  key: string,
  name: string,
  hex: number,
  variation: ColorVariation = SOFT_LAND_VARIATION
): TerrainMaterialDefinition {
  const [r, g, b] = hexToRgb(hex);
  return {
    id,
    key,
    name,
    hex,
    r,
    g,
    b,
    brightnessMultiplier: 1.0,
    saturationMultiplier: 1.0,
    opacity: 1.0,
    transition: 'SOFT_LAND',
    lightingMode: 'SMOOTH',
    layerUsage: 'UNDERLAY',
    transitionUnderlayId: 0,
    surfacePattern: SURFACE_PATTERN.PLAIN,
    colorVariation: variation,
  };
}

function makeOverlay(
  id: number,
  key: string,
  name: string,
  hex: number,
  lightingMode: MaterialLightingMode = 'SMOOTH',
  transitionUnderlayId = 0,
  variation: ColorVariation = HARD_OVERLAY_VARIATION,
  surfacePattern: SurfacePatternId = SURFACE_PATTERN.PLAIN
): TerrainMaterialDefinition {
  const [r, g, b] = hexToRgb(hex);
  return {
    id,
    key,
    name,
    hex,
    r,
    g,
    b,
    brightnessMultiplier: 1.0,
    saturationMultiplier: 1.0,
    opacity: 1.0,
    transition: 'HARD_CLIP',
    lightingMode,
    layerUsage: 'OVERLAY',
    transitionUnderlayId,
    surfacePattern,
    colorVariation: variation,
  };
}

export const TERRAIN_MATERIALS: readonly TerrainMaterialDefinition[] = [
  // ---- Underlays (exact WorldLab IDs & RGB palette) ----
  makeUnderlay(1, 'terrain.meadow_grass', 'Meadow Grass', 0x35720a),
  makeUnderlay(2, 'terrain.packed_earth', 'Packed Earth', 0x644e1e),
  makeUnderlay(3, 'terrain.warm_sand', 'Warm Sand', 0xcbba76),
  makeUnderlay(4, 'terrain.weathered_slate', 'Weathered Slate', 0x767676, ROCK_VARIATION),
  makeUnderlay(6, 'terrain.muddy_grass', 'Muddy Grass', 0x58680b),
  makeUnderlay(7, 'terrain.light_grass', 'Light Grass', 0x6cac10),
  makeUnderlay(8, 'terrain.sandy_grass', 'Sandy Grass', 0x819531),
  makeUnderlay(9, 'terrain.swamp_grass', 'Swamp Grass', 0x55520a),
  makeUnderlay(10, 'terrain.bog_green', 'Bog Green', 0x125841),
  makeUnderlay(11, 'terrain.dark_rock', 'Dark Rock', 0x4d4d4d, ROCK_VARIATION),
  makeUnderlay(12, 'terrain.snow_ice', 'Snow / Ice', 0xeeeeee),
  makeUnderlay(14, 'terrain.desert_dry', 'Dry Desert', 0xada055),
  makeUnderlay(16, 'terrain.dark_mud', 'Dark Mud', 0x3d2b0b),
  makeUnderlay(17, 'terrain.red_earth', 'Red Earth', 0x663300),
  makeUnderlay(19, 'terrain.very_dark_rock', 'Basalt Rock', 0x2e2e2e, ROCK_VARIATION),
  makeUnderlay(30, 'terrain.chalk_ground', 'Chalk Ground', 0xbfc0b2, ROCK_VARIATION),
  makeUnderlay(32, 'terrain.moss_earth', 'Moss Earth', 0x4b5d32),
  makeUnderlay(33, 'terrain.volcanic_soil', 'Volcanic Soil', 0x3a2420),
  makeUnderlay(34, 'terrain.greyvein_rock', 'Greyvein Stone', 0x7b7468, ROCK_VARIATION),
  makeUnderlay(35, 'terrain.ochre_cave_rock', 'Ochre Cave Rock', 0x8e7454, ROCK_VARIATION),
  makeUnderlay(36, 'terrain.cave_mudstone', 'Cave Mudstone', 0x4e4c49, ROCK_VARIATION),

  // ---- Overlays (shaped discrete surfaces + Lost-City procedural tactile patterns) ----
  makeOverlay(101, 'terrain.road', 'Cobble Road', 0x585652, 'SMOOTH', 0, HARD_OVERLAY_VARIATION, SURFACE_PATTERN.COBBLE),
  makeOverlay(102, 'terrain.wooden_floor', 'Wooden Floor', 0x9a754a, 'SMOOTH', 0, HARD_OVERLAY_VARIATION, SURFACE_PATTERN.PLANKS),
  makeOverlay(103, 'terrain.pebble_floor', 'Pebble Path', 0x8a8171, 'SMOOTH', 0, HARD_OVERLAY_VARIATION, SURFACE_PATTERN.COBBLE),
  makeOverlay(104, 'terrain.dark_stone', 'Dungeon Stone', 0x383a40, 'FACETED', 0, ROCK_VARIATION, SURFACE_PATTERN.FLAGSTONE),
  makeOverlay(105, 'terrain.red_tile', 'Red Floor Tile', 0x993333, 'SMOOTH', 0, HARD_OVERLAY_VARIATION, SURFACE_PATTERN.FLAGSTONE),
  makeOverlay(106, 'terrain.mud_floor', 'Mud Track', 0x4a3412, 'SMOOTH', 16),
  makeOverlay(107, 'terrain.sand_floor', 'Sand Track', 0xa67a2e, 'SMOOTH', 3),
  makeOverlay(108, 'terrain.marble', 'Temple Marble', 0xc8c6bc, 'SMOOTH', 0, HARD_OVERLAY_VARIATION, SURFACE_PATTERN.MARBLE),
  makeOverlay(109, 'terrain.cliff_light', 'Light Cliff', 0x9e9c96, 'FACETED', 0, ROCK_VARIATION),
  makeOverlay(110, 'terrain.cliff_dark', 'Dark Cliff', 0x61605d, 'FACETED', 0, ROCK_VARIATION),
  makeOverlay(111, 'terrain.sand_cliff', 'Sandstone Cliff', 0xbca663, 'FACETED', 0, ROCK_VARIATION),
  makeOverlay(112, 'terrain.old_brick', 'Mossy Brick', 0x746553, 'SMOOTH', 0, HARD_OVERLAY_VARIATION, SURFACE_PATTERN.FLAGSTONE),
  makeOverlay(113, 'terrain.brick', 'Brick Paving', 0x846b5b, 'SMOOTH', 0, HARD_OVERLAY_VARIATION, SURFACE_PATTERN.FLAGSTONE),
  makeOverlay(114, 'terrain.grass_patch', 'Grass Patch', 0x35720a, 'SMOOTH', 1),
  makeOverlay(115, 'terrain.ice_sheet', 'Ice Sheet', 0xeeeeee, 'SMOOTH', 12),
  makeOverlay(119, 'terrain.cave_scree', 'Scree / Rubble', 0x6b6760, 'FACETED', 34, ROCK_VARIATION, SURFACE_PATTERN.COBBLE),
  makeOverlay(120, 'terrain.cliff_greyvein', 'Cave Cliff Rock', 0x85755c, 'FACETED', 34, ROCK_VARIATION),
  // Lost-City 0xFF00FF Shaped Void Cutout overlay: skips overlay triangles while preserving underlay triangles
  {
    ...makeOverlay(121, 'terrain.void_cutout', 'Shaped Void (Cutout)', 0xff00ff, 'SMOOTH', 0, HARD_OVERLAY_VARIATION, SURFACE_PATTERN.PLAIN),
    transition: 'VOID_CUTOUT',
  },
];

const BY_ID = new Map<number, TerrainMaterialDefinition>();
for (const mat of TERRAIN_MATERIALS) {
  BY_ID.set(mat.id, mat);
}

export const DEFAULT_UNDERLAY_ID = 1; // Meadow grass
export const DEFAULT_OVERLAY_ID = 101; // Cobble road
export const DEFAULT_CLIFF_OVERLAY_ID = 110; // Dark cliff
export const CAVE_ROCK_UNDERLAY_ID = 34; // Greyvein stone (matched to greyvein GLBs)
export const OCHRE_CAVE_ROCK_UNDERLAY_ID = 35; // Warm ochre cave rock
export const CAVE_MUDSTONE_UNDERLAY_ID = 36; // Dark cave mudstone
export const CAVE_SCREE_OVERLAY_ID = 119; // Scree / rubble entrance debris
export const CAVE_CLIFF_OVERLAY_ID = 120; // Palette-matched faceted cave cliff rock
export const VOID_OVERLAY_ID = 121; // Lost-City 0xFF00FF transparent shaped cutout overlay

export function getMaterial(id: number): TerrainMaterialDefinition {
  return BY_ID.get(id) ?? TERRAIN_MATERIALS[0]!;
}

export function getUnderlayMaterials(): TerrainMaterialDefinition[] {
  return TERRAIN_MATERIALS.filter((m) => m.layerUsage === 'UNDERLAY' || m.layerUsage === 'BOTH');
}

export function getOverlayMaterials(): TerrainMaterialDefinition[] {
  return TERRAIN_MATERIALS.filter((m) => m.layerUsage === 'OVERLAY' || m.layerUsage === 'BOTH');
}

export function isSoftBlend(material: TerrainMaterialDefinition): boolean {
  return material.transition === 'SOFT_LAND';
}

export function isWaterLike(material: TerrainMaterialDefinition): boolean {
  return material.transition === 'WATER';
}

export function isVoidOverlay(material: TerrainMaterialDefinition): boolean {
  return material.transition === 'VOID_CUTOUT';
}
