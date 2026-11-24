import { FEET_PER_SQUARE } from 'rules-engine/space';

/**
 * D&D 5e / 2024 spatial scale constants adapted from WorldLab.
 *
 * WorldLab uses 128 engine units per tile (~1 m).
 * In this D&D prototype:
 *   - 1 tile edge = 1.5 meters = `FEET_PER_SQUARE` (5 feet, from `rules-engine/space`).
 *   - Internal integer height units keep WorldLab's 128-unit granularity per tile
 *     so all WorldLab sculpt math, slope thresholds, and rock-facet normals port 1:1.
 *   - Converting internal height units -> world meters: height * (TILE_SIZE_METERS / HEIGHT_UNITS_PER_TILE).
 *     Therefore +128 height units = +1.5 m = +5 ft elevation (one full D&D cube).
 */

export const TILE_SIZE_METERS = 1.5;
export const TILE_SIZE_FEET = FEET_PER_SQUARE;
export const METERS_PER_FOOT = TILE_SIZE_METERS / TILE_SIZE_FEET;
export const HEIGHT_UNITS_PER_TILE = 128;
export const METERS_PER_HEIGHT_UNIT = TILE_SIZE_METERS / HEIGHT_UNITS_PER_TILE;
export const FEET_PER_HEIGHT_UNIT = TILE_SIZE_FEET / HEIGHT_UNITS_PER_TILE;

/** WorldLab chunk dimension in tiles (8x8 tiles per GPU mesh chunk). */
export const CHUNK_SIZE = 8;

/** Default prototype map size (32x32 tiles = 160x160 ft = 48x48 m). */
export const DEFAULT_MAP_SIZE = 32;

/** Clamped terrain height bounds in internal units (-1024..+2048 => -40ft..+80ft). */
export const MIN_HEIGHT_UNITS = -1024;
export const MAX_HEIGHT_UNITS = 2048;

/** Classic WorldLab asymmetric 10-tile RS2 underlay blend window (-4..+5). */
export const RS2_BLEND_MIN_OFFSET = -4;
export const RS2_BLEND_MAX_OFFSET = 5;

export function heightUnitsToMeters(units: number): number {
  return units * METERS_PER_HEIGHT_UNIT;
}

export function heightUnitsToFeet(units: number): number {
  return units * FEET_PER_HEIGHT_UNIT;
}

export function feetToHeightUnits(feet: number): number {
  return Math.round(feet / FEET_PER_HEIGHT_UNIT);
}

export function tileToWorldMeters(tileCoord: number): number {
  return tileCoord * TILE_SIZE_METERS;
}

export function worldMetersToTile(meters: number): number {
  return meters / TILE_SIZE_METERS;
}
