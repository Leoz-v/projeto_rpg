/**
 * Port of WorldLab's TerrainCliffMode / cliff authoring brush with RS2 auto-shaping.
 *
 * - DETECT: evaluates continuous heightfield slope across the brush footprint and
 *   fits smooth RS2 cliff overlay shapes via the 37-probe fitter + edge harmonizer.
 * - FORCE: auto-paints faceted cliff seeds inside the brush so borders shape smoothly.
 * - ERASE: auto-erases cliff seeds inside the brush.
 */

import { HEIGHT_UNITS_PER_TILE } from '../terrain/constants';
import { DEFAULT_CLIFF_OVERLAY_ID } from '../terrain/materials';
import type { TerrainGrid } from '../terrain/terrainGrid';
import { autoPaintOverlaySeeds, fitContinuousMaskToOverlays } from './autoTiler';

export type TerrainCliffMode = 'DETECT' | 'FORCE' | 'ERASE';

export interface CliffSettings {
  mode: TerrainCliffMode;
  materialId: number;
  radius: number;
  slopeThreshold: number; // height delta per tile in internal height units (default 64 = 2.5 ft/tile)
}

export function createDefaultCliffSettings(): CliffSettings {
  return {
    mode: 'DETECT',
    materialId: DEFAULT_CLIFF_OVERLAY_ID,
    radius: 3,
    slopeThreshold: 64,
  };
}

export function tileHeightSpan(grid: TerrainGrid, tx: number, tz: number): number {
  const h00 = grid.getHeight(tx, tz);
  const h10 = grid.getHeight(tx + 1, tz);
  const h01 = grid.getHeight(tx, tz + 1);
  const h11 = grid.getHeight(tx + 1, tz + 1);
  return Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
}

/** Continuous slope magnitude (in internal height units per tile) at any world tile coordinate. */
function continuousSlopeAt(grid: TerrainGrid, wx: number, wz: number): number {
  const eps = 0.25;
  const hx1 = grid.sampleHeightAtTileCoord(wx + eps, wz);
  const hx0 = grid.sampleHeightAtTileCoord(wx - eps, wz);
  const hz1 = grid.sampleHeightAtTileCoord(wx, wz + eps);
  const hz0 = grid.sampleHeightAtTileCoord(wx, wz - eps);
  const dhdx = (hx1 - hx0) / (2 * eps);
  const dhdz = (hz1 - hz0) / (2 * eps);
  return Math.hypot(dhdx, dhdz);
}

export function applyCliffBrush(grid: TerrainGrid, centerTx: number, centerTz: number, settings: CliffSettings): number {
  const r = Math.max(0, settings.radius);

  if (settings.mode === 'FORCE') {
    const seeds: { tx: number; tz: number }[] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx, dz) > r + 0.35) continue;
        const tx = centerTx + dx;
        const tz = centerTz + dz;
        if (grid.inTileBounds(tx, tz)) seeds.push({ tx, tz });
      }
    }
    return autoPaintOverlaySeeds(grid, seeds, settings.materialId);
  }

  if (settings.mode === 'ERASE') {
    const seeds: { tx: number; tz: number }[] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx, dz) > r + 0.35) continue;
        const tx = centerTx + dx;
        const tz = centerTz + dz;
        if (!grid.inTileBounds(tx, tz)) continue;
        const oId = grid.getTile(tx, tz).overlayId;
        if (oId === 109 || oId === 110 || oId === 111 || oId === 120 || oId === settings.materialId) {
          seeds.push({ tx, tz });
        }
      }
    }
    return autoPaintOverlaySeeds(grid, seeds, 0);
  }

  // DETECT mode: fit smooth RS2 cliff shapes against continuous terrain slope inside brush
  const threshold = Math.max(8, Math.min(HEIGHT_UNITS_PER_TILE * 2, settings.slopeThreshold));
  const cx = centerTx + 0.5;
  const cz = centerTz + 0.5;
  const brushRadius = r + 0.65;

  return fitContinuousMaskToOverlays(
    grid,
    settings.materialId,
    (wx, wz) => {
      if (Math.hypot(wx - cx, wz - cz) > brushRadius) return false;
      return continuousSlopeAt(grid, wx, wz) >= threshold * 0.72;
    },
    {
      minTx: centerTx - r,
      maxTx: centerTx + r,
      minTz: centerTz - r,
      maxTz: centerTz + r,
      spillCost: 1.35,
      lockCenter: false,
      markAsSeeds: true,
    }
  );
}
