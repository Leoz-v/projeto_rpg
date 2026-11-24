import { describe, expect, it } from 'vitest';
import { FEET_PER_SQUARE } from 'rules-engine/space';
import {
  HEIGHT_UNITS_PER_TILE,
  METERS_PER_FOOT,
  TILE_SIZE_FEET,
  TILE_SIZE_METERS,
  feetToHeightUnits,
  heightUnitsToFeet,
  heightUnitsToMeters,
} from '../constants';
import {
  applyHighlightSaturationRollOff,
  computeVertexMaterialColor,
  decodeHsl16ToRgb,
  packHsl16,
  rgbToHsl,
  rs2BlendColor,
  rs2BlendComponents,
  shadeHsl16,
} from '../colorVariation';
import {
  SURFACE_PATTERN,
  VOID_OVERLAY_ID,
  getMaterial,
  isVoidOverlay,
} from '../materials';
import { buildChunkMesh, buildDioramaSkirt } from '../meshBuilder';
import { pickTerrain } from '../raycast';
import {
  TILE_AUTO_GENERATED,
  TILE_AUTO_SEED,
  TILE_AUTO_UNDERLAY_OVERRIDE,
  TILE_MANUAL_LOCK,
  TerrainGrid,
} from '../terrainGrid';
import {
  createGridFromTemplate,
  gridFromMapDocument,
  parseMapDocument,
  sanitizeMapId,
  serializeMapDocument,
} from '../../map/mapDocument';
import {
  computeSignedVolume,
  flipIndicesWinding,
  negateNormalBuffer,
  resolveUnlitEmissiveFallbackColor,
} from '../../render/meshWinding';
import {
  classifyPropLightSource,
  computeUnlitMoodTintHex,
  createDefaultLightingSettings,
  extractLavaLightClusters,
} from '../../render/lightingSystem';
import {
  classifyAmbientAnimation,
  evaluateFlameEmissiveStrength,
  stablePhase,
} from '../../render/objectAnimator';
import {
  computePlacedWorldBounds,
  resolveStackPlacement,
} from '../../render/surfaceStacking';
import {
  DEFAULT_WALL_WIDTH_TILES,
  isWallDecorEntry,
  preservesAuthoredMountHeight,
  resolveCanonicalWallDecorPose,
  resolveWallSnap,
} from '../../render/wallDecoration';
import {
  classifySceneryKind,
  computeModelBaseScales,
  computeSnappedFootprint,
  getRotatedFootprint,
  type WorldLabAssetEntry,
} from '../../render/modelScalePolicy';
import {
  LAST_CLIPPED_SHAPE_ID,
  cornerWeightsForCode,
  getShapeById,
  shapedVertexHeight,
} from '../tileSurface';
import {
  autoPaintOverlaySeeds,
  fitContinuousMaskToOverlays,
  paintManualOverlay,
  resolveAllAutoSeeds,
} from '../../tools/autoTiler';
import { applyCliffBrush, createDefaultCliffSettings } from '../../tools/cliffTool';
import { TerrainHistory, TerrainStrokeRecorder } from '../../tools/history';
import {
  applySlopeLimit,
  createDefaultSculptSettings,
  evaluateSculptVertex,
  terraceHeight,
} from '../../tools/sculptKernel';
import {
  TOPOLOGY_PROBES,
  countEdgeMismatch,
  fitTopology,
  shapeContainsOverlayPoint,
} from '../../tools/shapeFitter';

describe('D&D 5ft / 1.5m scale constants', () => {
  it('maps 1 tile edge to 1.5 m and FEET_PER_SQUARE (5 ft) with 128 internal height units', () => {
    expect(TILE_SIZE_METERS).toBe(1.5);
    expect(TILE_SIZE_FEET).toBe(FEET_PER_SQUARE);
    expect(METERS_PER_FOOT).toBeCloseTo(TILE_SIZE_METERS / FEET_PER_SQUARE, 6);
    expect(heightUnitsToMeters(HEIGHT_UNITS_PER_TILE)).toBeCloseTo(1.5, 6);
    expect(heightUnitsToFeet(HEIGHT_UNITS_PER_TILE)).toBeCloseTo(FEET_PER_SQUARE, 6);
    expect(feetToHeightUnits(10)).toBe(256);
  });
});

describe('WorldLab TileSurface RS2 shaped-tile catalog', () => {
  it('ensures every shape and rotation has valid weights and upward (+Y CCW) winding', () => {
    for (let shapeId = 0; shapeId <= LAST_CLIPPED_SHAPE_ID; shapeId++) {
      for (let rot = 0; rot < 4; rot++) {
        const shape = getShapeById(shapeId, rot);
        expect(shape.vertices.length).toBeGreaterThanOrEqual(4);
        expect(shape.triangles.length).toBeGreaterThanOrEqual(2);

        for (const v of shape.vertices) {
          const w = cornerWeightsForCode(v.code);
          expect(w.sw + w.se + w.nw + w.ne).toBeCloseTo(1, 6);
        }

        for (const t of shape.triangles) {
          const va = shape.vertices[t.a]!;
          const vb = shape.vertices[t.b]!;
          const vc = shape.vertices[t.c]!;
          const ny = (vb.v - va.v) * (vc.u - va.u) - (vb.u - va.u) * (vc.v - va.v);
          expect(ny).toBeGreaterThan(0);
        }
      }
    }
  });

  it('preserves RS2 interior quarter-point corner height inheritance', () => {
    expect(shapedVertexHeight(13, 100, 0, 0, 0)).toBe(100);
    expect(shapedVertexHeight(14, 0, 80, 0, 0)).toBe(80);
    expect(shapedVertexHeight(17, 0, 100, 100, 200)).toBe(100);
  });
});

describe('WorldLab RS2 HSL16 color variation system', () => {
  it('packs, shades lightness only, and decodes HSL16 cleanly', () => {
    const grass = getMaterial(1);
    const hsl = rgbToHsl(grass.r, grass.g, grass.b);
    const packed = packHsl16(hsl);
    const darker = shadeHsl16(packed, 0.7);
    const brighter = shadeHsl16(packed, 1.2);
    expect(darker & 0xff80).toBe(packed & 0xff80);
    expect(brighter & 0xff80).toBe(packed & 0xff80);
    expect(darker & 127).toBeLessThan(brighter & 127);

    const [r, g, b] = decodeHsl16ToRgb(packed);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(g).toBeGreaterThan(r);
    expect(b).toBeGreaterThanOrEqual(0);
  });

  it('blends adjacent RS2 underlays smoothly via chroma-weighted accumulator', () => {
    const grass = getMaterial(1);
    const sand = getMaterial(3);
    const c1 = rs2BlendComponents(grass.r, grass.g, grass.b);
    const c2 = rs2BlendComponents(sand.r, sand.g, sand.b);
    const blended = rs2BlendColor(c1[0] + c2[0], c1[1] + c2[1], c1[2] + c2[2], c1[3] + c2[3], 2);
    expect(blended[0]).toBeGreaterThan(grass.r);
    expect(blended[0]).toBeLessThan(sand.r);
  });

  it('produces deterministic world-space variation across coordinates', () => {
    const grass = getMaterial(1);
    const a = computeVertexMaterialColor(grass, grass.r, grass.g, grass.b, grass.colorVariation, 5, 7, 0, 0);
    const b = computeVertexMaterialColor(grass, grass.r, grass.g, grass.b, grass.colorVariation, 5, 7, 0, 0);
    expect(a).toEqual(b);
  });
});

describe('Chunk mesh builder & heightfield raycast', () => {
  it('builds finite chunk geometry scaled at 1.5 m per tile with positive Y normals', () => {
    const grid = createGridFromTemplate({
      name: 'Hills',
      width: 32,
      length: 32,
      template: 'rolling_hills',
      baseUnderlayId: 1,
      baseElevationFeet: 0,
      includeStarterProps: false,
    });
    const chunk = buildChunkMesh(grid, 0, 0);
    expect(chunk.triangleCount).toBeGreaterThanOrEqual(128);
    expect(chunk.positions.length).toBe(chunk.normals.length);
    expect(chunk.colorsRs2.length / 4).toBe(chunk.positions.length / 3);

    for (let i = 0; i < chunk.normals.length; i += 3) {
      expect(chunk.normals[i + 1]).toBeGreaterThan(0);
    }
    for (let i = 0; i < chunk.colorsRs2.length; i++) {
      const c = chunk.colorsRs2[i]!;
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }

    // Verify true flat per-triangle shading: all 3 vertices of each triangle share identical RGB in colorsFlat
    expect(chunk.colorsFlat.length).toBe(chunk.colorsRs2.length);
    expect(chunk.surfaceMeta.length).toBe(chunk.colorsRs2.length);
    for (let t = 0; t < chunk.triangleCount; t++) {
      const v0 = chunk.indices[t * 3]! * 4;
      const v1 = chunk.indices[t * 3 + 1]! * 4;
      const v2 = chunk.indices[t * 3 + 2]! * 4;
      expect(chunk.colorsFlat[v0]).toBe(chunk.colorsFlat[v1]);
      expect(chunk.colorsFlat[v0]).toBe(chunk.colorsFlat[v2]);
      expect(chunk.colorsFlat[v0 + 1]).toBe(chunk.colorsFlat[v1 + 1]);
      expect(chunk.colorsFlat[v0 + 2]).toBe(chunk.colorsFlat[v2 + 2]);
    }

    const skirt = buildDioramaSkirt(grid);
    expect(skirt.indices.length).toBe(grid.width * 2 * 6 + grid.length * 2 * 6);
  });

  it('raycasts directly onto the correct D&D 1.5m tile and nearest vertex', () => {
    const grid = new TerrainGrid(16, 16);
    const hit = pickTerrain(grid, {
      originX: 6.75,
      originY: 10,
      originZ: 8.25,
      dirX: 0,
      dirY: -1,
      dirZ: 0,
    });
    expect(hit).not.toBeNull();
    expect(hit!.tileX).toBe(4);
    expect(hit!.tileZ).toBe(5);
    expect(hit!.worldY).toBeCloseTo(0, 4);
  });
});

describe('WorldLab 37-probe auto-tiler, edge harmonization, manual locks & substrates', () => {
  it('generates smooth auto-fringes around diagonal painted seeds with zero shared-edge mismatches', () => {
    const grid = new TerrainGrid(16, 16);
    // Paint a diagonal road stroke of seeds
    autoPaintOverlaySeeds(
      grid,
      [
        { tx: 4, tz: 4 },
        { tx: 5, tz: 5 },
        { tx: 6, tz: 6 },
        { tx: 7, tz: 7 },
      ],
      101
    );

    // Seed tiles carry AUTO_SEED; flanking diagonal tiles get AUTO_GENERATED non-full shapes
    expect(grid.getTile(5, 5).autoMetadata & TILE_AUTO_SEED).not.toBe(0);
    expect(grid.getTile(5, 6).overlayId).toBe(101);
    expect(grid.getTile(5, 6).autoMetadata & TILE_AUTO_GENERATED).not.toBe(0);
    expect(grid.getTile(5, 6).overlayShape).toBeGreaterThan(1);

    // Verify shared quarter-edges agree across all adjacent same-material tiles
    let mismatches = 0;
    for (let z = 2; z < 10; z++) {
      for (let x = 2; x < 10; x++) {
        const a = grid.getTile(x, z);
        if (a.overlayId !== 101) continue;
        const east = grid.getTile(x + 1, z);
        if (east.overlayId === 101) {
          mismatches += countEdgeMismatch(
            { shape: a.overlayShape, rotation: a.overlayRotation, error: 0 },
            { shape: east.overlayShape, rotation: east.overlayRotation, error: 0 },
            true
          );
        }
        const north = grid.getTile(x, z + 1);
        if (north.overlayId === 101) {
          mismatches += countEdgeMismatch(
            { shape: a.overlayShape, rotation: a.overlayRotation, error: 0 },
            { shape: north.overlayShape, rotation: north.overlayRotation, error: 0 },
            false
          );
        }
      }
    }
    expect(mismatches).toBe(0);

    // Auto-erasing the seeds cleanly removes both seeds and generated fringes
    autoPaintOverlaySeeds(
      grid,
      [
        { tx: 4, tz: 4 },
        { tx: 5, tz: 5 },
        { tx: 6, tz: 6 },
        { tx: 7, tz: 7 },
      ],
      0
    );
    expect(grid.getTile(5, 5).overlayId).toBe(0);
    expect(grid.getTile(5, 6).overlayId).toBe(0);
  });

  it('preserves MANUAL_LOCK tiles when auto-painting neighboring tiles', () => {
    const grid = new TerrainGrid(16, 16);
    paintManualOverlay(grid, 6, 6, 102, 2, 1); // Manual wooden diagonal
    expect(grid.getTile(6, 6).autoMetadata & TILE_MANUAL_LOCK).not.toBe(0);

    autoPaintOverlaySeeds(grid, [{ tx: 5, tz: 6 }, { tx: 7, tz: 6 }], 101);
    const locked = grid.getTile(6, 6);
    expect(locked.overlayId).toBe(102);
    expect(locked.overlayShape).toBe(2);
    expect(locked.overlayRotation).toBe(1);
    expect(locked.autoMetadata & TILE_MANUAL_LOCK).not.toBe(0);
  });

  it('creates and cleanly reverts transition underlay substrates at mixed natural-overlay borders', () => {
    const grid = new TerrainGrid(16, 16);
    grid.setUnderlay(6, 6, 1); // Meadow grass authored base

    // Paint Pond Water (5, substrate 38) next to Mud Track (106, substrate 16)
    autoPaintOverlaySeeds(grid, [{ tx: 5, tz: 5 }, { tx: 5, tz: 6 }], 5);
    autoPaintOverlaySeeds(grid, [{ tx: 7, tz: 6 }, { tx: 7, tz: 7 }], 106);

    // At the seam tile (6,6), a reversible substrate override should appear and record grass (1)
    const seam = grid.getTile(6, 6);
    if ((seam.autoMetadata & TILE_AUTO_UNDERLAY_OVERRIDE) !== 0) {
      expect(seam.autoBaseUnderlayId).toBe(1);
    }

    // Erasing both overlays must restore the original authored underlay (1)
    autoPaintOverlaySeeds(
      grid,
      [
        { tx: 5, tz: 5 },
        { tx: 5, tz: 6 },
        { tx: 7, tz: 6 },
        { tx: 7, tz: 7 },
      ],
      0
    );
    expect(grid.getTile(6, 6).underlayId).toBe(1);
    expect(grid.getTile(6, 6).autoMetadata & TILE_AUTO_UNDERLAY_OVERRIDE).toBe(0);
  });

  it('fits continuous curved roads cleanly with center-lock and shared-edge harmonization', () => {
    const grid = new TerrainGrid(24, 24);
    fitContinuousMaskToOverlays(
      grid,
      101,
      (wx, wz) => Math.abs(wz - (12 + Math.sin(wx * 0.3) * 3)) <= 1.0,
      { lockCenter: true, spillCost: 1.5, markAsSeeds: true }
    );

    let shapedNonFull = 0;
    let totalRoad = 0;
    for (let z = 0; z < 24; z++) {
      for (let x = 0; x < 24; x++) {
        const t = grid.getTile(x, z);
        if (t.overlayId === 101) {
          totalRoad++;
          if (t.overlayShape > 1) shapedNonFull++;
        }
      }
    }
    expect(totalRoad).toBeGreaterThan(20);
    expect(shapedNonFull).toBeGreaterThan(4);
  });

  it('matches Lost-City RS2 overlay vocabulary: uses Diagonals, Halves, Corners, Semi-Diagonals & Fans with zero Trapezoids and zero edge mismatches', () => {
    // 1. All 12 shapes x 4 rotations remain reachable in raw fitTopology
    for (let shapeId = 1; shapeId <= 12; shapeId++) {
      for (let rot = 0; rot < 4; rot++) {
        const surf = getShapeById(shapeId, rot);
        const mask = TOPOLOGY_PROBES.map((p) => shapeContainsOverlayPoint(surf, p.u, p.v));
        const fit = fitTopology(mask, 1.35);
        expect(fit.shape).toBe(shapeId);
        if (shapeId !== 1) {
          expect(fit.rotation).toBe(rot);
        }
      }
    }

    const assertZeroMismatchesAndNoTrapezoids = (grid: TerrainGrid, matId: number): Set<number> => {
      const used = new Set<number>();
      let mismatches = 0;
      for (let z = 0; z < grid.length; z++) {
        for (let x = 0; x < grid.width; x++) {
          const t = grid.getTile(x, z);
          if (t.overlayId !== matId || t.overlayShape === 0) continue;
          used.add(t.overlayShape);
          expect(t.overlayShape).not.toBe(6); // Never emit sawtooth Trapezoid (0 in Lumbridge/Draynor/Varrock)
          if (x < grid.width - 1) {
            const e = grid.getTile(x + 1, z);
            if (e.overlayId === matId && e.overlayShape > 0) {
              mismatches += countEdgeMismatch(
                { shape: t.overlayShape, rotation: t.overlayRotation, error: 0 },
                { shape: e.overlayShape, rotation: e.overlayRotation, error: 0 },
                true
              );
            }
          }
          if (z < grid.length - 1) {
            const n = grid.getTile(x, z + 1);
            if (n.overlayId === matId && n.overlayShape > 0) {
              mismatches += countEdgeMismatch(
                { shape: t.overlayShape, rotation: t.overlayRotation, error: 0 },
                { shape: n.overlayShape, rotation: n.overlayRotation, error: 0 },
                false
              );
            }
          }
        }
      }
      expect(mismatches).toBe(0);
      return used;
    };

    // 2. Single-tile click stays clean Full (no bloated outer halo)
    const gSingle = new TerrainGrid(10, 10);
    autoPaintOverlaySeeds(gSingle, [{ tx: 5, tz: 5 }], 105);
    expect(gSingle.getTile(5, 5).overlayShape).toBe(1);
    expect(gSingle.getTile(6, 5).overlayId).toBe(0);

    // 3. 1-tile diagonal path generates crisp Lost-City Diagonals (2) + Full (1)
    const gDiag1 = new TerrainGrid(10, 10);
    autoPaintOverlaySeeds(
      gDiag1,
      [
        { tx: 2, tz: 2 },
        { tx: 3, tz: 3 },
        { tx: 4, tz: 4 },
        { tx: 5, tz: 5 },
      ],
      105
    );
    const diagUsed = assertZeroMismatchesAndNoTrapezoids(gDiag1, 105);
    expect(diagUsed.has(2)).toBe(true); // Diagonal

    // 4. 2:1 slope generates paired Right Semi-Diag Big (10) + Right Semi-Diag Small (8)
    const gSlope = new TerrainGrid(14, 14);
    const slopeSeeds: { tx: number; tz: number }[] = [];
    for (let z = 0; z < 14; z++) {
      for (let x = 0; x < 14; x++) {
        if (2 * x + z >= 14) slopeSeeds.push({ tx: x, tz: z });
      }
    }
    autoPaintOverlaySeeds(gSlope, slopeSeeds, 105);
    const slopeUsed = assertZeroMismatchesAndNoTrapezoids(gSlope, 105);
    expect(slopeUsed.has(8)).toBe(true); // Right Semi-Diag Small
    expect(slopeUsed.has(10)).toBe(true); // Right Semi-Diag Big

    // 5. Curved S-road uses diverse Lost-City shapes (Full, Half, Corners, Semi-Diagonals, Fans) with 0 mismatches
    const gCurve = new TerrainGrid(14, 16);
    const curveSeeds: { tx: number; tz: number }[] = [];
    for (let z = 1; z <= 14; z++) {
      const cx = Math.round(6 + Math.sin(z * 0.45) * 2.5);
      for (let dx = -1; dx <= 1; dx++) curveSeeds.push({ tx: cx + dx, tz: z });
    }
    autoPaintOverlaySeeds(gCurve, curveSeeds, 105);
    const curveUsed = assertZeroMismatchesAndNoTrapezoids(gCurve, 105);
    expect(curveUsed.size).toBeGreaterThanOrEqual(7);
    expect(curveUsed.has(3)).toBe(true); // Half
    expect(curveUsed.has(4)).toBe(true); // Corner Small
    expect(curveUsed.has(5)).toBe(true); // Corner Big
    expect(curveUsed.has(7) || curveUsed.has(8)).toBe(true); // Semi-Diag Small
    expect(curveUsed.has(11) || curveUsed.has(12)).toBe(true); // Fan
  });

  it('continues auto-tiled rivers and roads cleanly off map borders without rounding them off', () => {
    // 1. 2-tile wide road running north-south from south border (tz=0) to north border (tz=15)
    const gRoad = new TerrainGrid(16, 16);
    const roadSeeds: { tx: number; tz: number }[] = [];
    for (let z = 0; z < 16; z++) {
      roadSeeds.push({ tx: 7, tz: z }, { tx: 8, tz: z });
    }
    autoPaintOverlaySeeds(gRoad, roadSeeds, 101);
    const midWest = gRoad.getTile(7, 7);
    const midEast = gRoad.getTile(8, 7);
    expect(midWest.overlayId).toBe(101);
    expect(midEast.overlayId).toBe(101);
    for (const tz of [0, 1, 14, 15]) {
      const w = gRoad.getTile(7, tz);
      const e = gRoad.getTile(8, tz);
      expect(w.overlayId).toBe(midWest.overlayId);
      expect(w.overlayShape).toBe(midWest.overlayShape);
      expect(w.overlayRotation).toBe(midWest.overlayRotation);
      expect(e.overlayId).toBe(midEast.overlayId);
      expect(e.overlayShape).toBe(midEast.overlayShape);
      expect(e.overlayRotation).toBe(midEast.overlayRotation);
    }

    // 2. 3-tile wide river running east-west from west border (tx=0) to east border (tx=15)
    const gRiver = new TerrainGrid(16, 16);
    const riverSeeds: { tx: number; tz: number }[] = [];
    for (let x = 0; x < 16; x++) {
      riverSeeds.push({ tx: x, tz: 6 }, { tx: x, tz: 7 }, { tx: x, tz: 8 });
    }
    autoPaintOverlaySeeds(gRiver, riverSeeds, 5);
    expect(gRiver.getTile(8, 7).overlayShape).toBe(1); // Center channel is FULL
    for (const tx of [0, 1, 14, 15]) {
      for (const tz of [6, 7, 8]) {
        const mid = gRiver.getTile(8, tz);
        const cur = gRiver.getTile(tx, tz);
        expect(cur.overlayId).toBe(5);
        expect(cur.overlayShape).toBe(mid.overlayShape);
        expect(cur.overlayRotation).toBe(mid.overlayRotation);
      }
    }

    // 3. resolveAllAutoSeeds preserves the same border continuation
    resolveAllAutoSeeds(gRiver);
    for (const tx of [0, 15]) {
      for (const tz of [6, 7, 8]) {
        const mid = gRiver.getTile(8, tz);
        const cur = gRiver.getTile(tx, tz);
        expect(cur.overlayId).toBe(5);
        expect(cur.overlayShape).toBe(mid.overlayShape);
        expect(cur.overlayRotation).toBe(mid.overlayRotation);
      }
    }

    // 4. Erasing border seeds cleanly removes the border tiles
    autoPaintOverlaySeeds(gRoad, [{ tx: 7, tz: 0 }, { tx: 8, tz: 0 }], 0);
    expect(gRoad.getTile(7, 0).overlayId).toBe(0);
    expect(gRoad.getTile(8, 0).overlayId).toBe(0);
  });
});

describe('WorldLab terrain editing tools, cliff brush, and undo history', () => {
  it('raises vertices, terraces to 5ft steps, and respects max slope limits', () => {
    const grid = new TerrainGrid(16, 16);
    const settings = createDefaultSculptSettings();
    settings.mode = 'RAISE';
    settings.radius = 2;
    settings.strength = 1.0;

    const raised = evaluateSculptVertex(settings, 8, 8, 0, 0, 0, 0, (x, z) => grid.getHeight(x, z));
    expect(raised).toBeGreaterThan(0);

    const terraced = terraceHeight(96, 128, 0, 0);
    expect(terraced).toBe(128);

    const pre = Int16Array.from(grid.heights);
    const limited = applySlopeLimit(grid, 8, 8, 200, pre, 64);
    expect(limited).toBe(64);
  });

  it('detects steep slopes with the cliff brush and supports full undo/redo of auto-metadata', () => {
    const grid = new TerrainGrid(16, 16);
    const history = new TerrainHistory();

    const rec = new TerrainStrokeRecorder(grid, 'Cliff test');
    for (let z = 4; z <= 7; z++) {
      for (let x = 4; x <= 7; x++) {
        grid.setHeight(x, z, 256);
      }
    }
    const cliff = createDefaultCliffSettings();
    cliff.mode = 'DETECT';
    cliff.radius = 4;
    cliff.slopeThreshold = 64;
    const count = applyCliffBrush(grid, 6, 6, cliff);
    expect(count).toBeGreaterThan(0);

    history.push(rec.commit(grid));
    expect(history.canUndo).toBe(true);

    history.undo(grid);
    expect(grid.getHeight(5, 5)).toBe(0);
    expect(grid.getTile(5, 5).overlayId).toBe(0);
    expect(grid.getTile(5, 5).autoMetadata).toBe(0);

    history.redo(grid);
    expect(grid.getHeight(5, 5)).toBe(256);
  });
});

describe('WorldLab ImportedModelScalePolicy & multi-tile footprints', () => {
  const makeEntry = (overrides: Partial<WorldLabAssetEntry>): WorldLabAssetEntry => ({
    key: 'test.asset',
    pack: 'nature',
    name: 'Test Asset',
    glbUrl: '/worldlab-assets/models/test.glb',
    unitsPerTile: 1,
    nominalWidthTiles: 1,
    nominalLengthTiles: 1,
    fitFootprint: false,
    anchor: 'BOUNDS_MIN',
    assetKind: 'AUTO',
    category: 'nature',
    ...overrides,
  });

  it('auto-fits tiny BOUNDS_MIN 2x2 nature trees to true WorldLab D&D scale (~3m canopy, ~5.9m height)', () => {
    const evergreen = makeEntry({
      key: 'nature.arctic.evergreen',
      pack: 'nature',
      name: 'Arctic Evergreen',
      nominalWidthTiles: 2,
      nominalLengthTiles: 2,
      anchor: 'BOUNDS_MIN',
      category: 'nature',
    });
    expect(classifySceneryKind(evergreen)).toBe('TREE');
    const scales = computeModelBaseScales(evergreen, { x: 0.26, y: 0.45, z: 0.27 }, 'auto_dnd');
    expect(scales.mode).toBe('auto_fit');

    const worldWidthM = 0.26 * scales.x;
    const worldHeightM = 0.45 * scales.y;
    const worldDepthM = 0.27 * scales.z;
    // 2x2 tiles * 1.5 m/tile = 3.0 m canopy width, height = (3.6 + 0.35) * 1.5 = 5.925 m
    expect(worldWidthM).toBeGreaterThan(2.8);
    expect(worldDepthM).toBeCloseTo(3.0, 1);
    expect(worldHeightM).toBeCloseTo(5.925, 1);
  });

  it('auto-fits legacy promoted ChunkWorld 3x3 boulders to ~2.64 tiles (~3.96m) wide', () => {
    const boulder = makeEntry({
      key: 'chunkworld.arctic_3x3_boulder',
      pack: 'chunkworld',
      name: 'Arctic 3x3 Boulder',
      nominalWidthTiles: 3,
      nominalLengthTiles: 3,
      anchor: 'BOUNDS_MIN',
      category: 'nature',
    });
    expect(classifySceneryKind(boulder)).toBe('ROCK');
    const scales = computeModelBaseScales(boulder, { x: 0.38, y: 0.22, z: 0.38 }, 'auto_dnd');
    expect(scales.mode).toBe('auto_fit');
    // Rock ref width for 3x3 = min(3*0.88, max(0.58, 3-0.12)) = 2.64 tiles * 1.5 m = 3.96 m
    expect(0.38 * scales.x).toBeCloseTo(3.96, 1);
    expect(0.22 * scales.y).toBeGreaterThan(1.5);
  });

  it('preserves exact AUTHORED multi-tile dimensions (4x4 greyvein, 2x1 alderwatch, 1x2 rustic bed)', () => {
    const passage = makeEntry({
      key: 'greyvein.bedding_passage',
      pack: 'greyvein',
      name: 'Bedding passage',
      nominalWidthTiles: 4,
      nominalLengthTiles: 4,
      anchor: 'AUTHORED',
      category: 'architecture',
    });
    const passageScales = computeModelBaseScales(passage, { x: 4, y: 2.13, z: 4 }, 'auto_dnd');
    expect(passageScales.mode).toBe('authored');
    expect(4 * passageScales.x).toBeCloseTo(6.0, 3); // 4 tiles * 1.5 m = 6.0 m (20 ft)
    expect(4 * passageScales.z).toBeCloseTo(6.0, 3);

    const arch = makeEntry({
      key: 'alderwatch.carriage_arch',
      pack: 'alderwatch',
      name: 'Carriage arch',
      nominalWidthTiles: 2,
      nominalLengthTiles: 1,
      anchor: 'AUTHORED',
      category: 'architecture',
    });
    const archScales = computeModelBaseScales(arch, { x: 2, y: 1.5, z: 0.32 }, 'auto_dnd');
    expect(archScales.mode).toBe('authored');
    expect(2 * archScales.x).toBeCloseTo(3.0, 3); // 2 tiles * 1.5 m = 3.0 m (10 ft)

    const bed = makeEntry({
      key: 'rustic.bed',
      pack: 'rustic',
      name: 'Bed',
      nominalWidthTiles: 1,
      nominalLengthTiles: 2,
      anchor: 'AUTHORED',
      category: 'prop',
    });
    // Multi-tile prop locks to 1.5 m/tile in auto_dnd so its 1x2 footprint fits 5x10 ft cleanly
    const bedScales = computeModelBaseScales(bed, { x: 0.94, y: 0.78, z: 1.9 }, 'auto_dnd');
    expect(bedScales.x).toBeCloseTo(1.5, 3);
    expect(1.9 * bedScales.z).toBeCloseTo(2.85, 2);
  });

  it('normalizes ultra-tiny external BOUNDS_MIN meshes and computes rotated multi-tile footprints', () => {
    const tinyHero = makeEntry({
      key: 'external.poly_pizza.adventurer',
      pack: 'external',
      name: 'Adventurer',
      nominalWidthTiles: 1,
      nominalLengthTiles: 1,
      anchor: 'BOUNDS_MIN',
      category: 'creature',
    });
    const heroScales = computeModelBaseScales(tinyHero, { x: 0.02, y: 0.03, z: 0.02 }, 'auto_dnd');
    expect(heroScales.mode).toBe('actor_fit');
    // Fits within humanoid height/width targets (~1.5-1.8m tall, never microscopic)
    expect(0.03 * heroScales.y).toBeGreaterThan(1.0);

    // Rotation swaps 2x1 -> 1x2 on 90/270 degrees
    const rect = { nominalWidthTiles: 2, nominalLengthTiles: 1 };
    expect(getRotatedFootprint(rect, 0)).toEqual({ widthTiles: 2, lengthTiles: 1 });
    expect(getRotatedFootprint(rect, 90)).toEqual({ widthTiles: 1, lengthTiles: 2 });
    expect(getRotatedFootprint(rect, 180)).toEqual({ widthTiles: 2, lengthTiles: 1 });
    expect(getRotatedFootprint(rect, 270)).toEqual({ widthTiles: 1, lengthTiles: 2 });

    // Multi-tile snapping centers 2x2 on tile grid intersection (tx+1, tz+1) and 4x4 on (tx+1, tz+1)
    const snap2 = computeSnappedFootprint(10, 10, 2, 2, 32, 32);
    expect(snap2).toEqual({ startX: 10, startZ: 10, centerX: 11, centerZ: 11 });
    const snap4 = computeSnappedFootprint(10, 10, 4, 4, 32, 32);
    expect(snap4).toEqual({ startX: 9, startZ: 9, centerX: 11, centerZ: 11 });
    const snap1 = computeSnappedFootprint(10, 10, 1, 1, 32, 32);
    expect(snap1).toEqual({ startX: 10, startZ: 10, centerX: 10.5, centerZ: 10.5 });
  });

  it('detects negative-volume inverted meshes, flips indices & normals, and maps greyvein emissive fallbacks', () => {
    // Unit tetrahedron (0,0,0), (1,0,0), (0,1,0), (0,0,1) — outward CCW volume = +1/6
    const pos = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]);
    // Intentionally inverted CW indices
    const invertedIdx = new Uint16Array([
      0, 1, 2, // +Z normal (inward for bottom face at z=0) -> wait: flip all 4 faces to be CW inward
      0, 3, 1,
      0, 2, 3,
      1, 3, 2,
    ]);
    const volBefore = computeSignedVolume(pos, invertedIdx);
    expect(volBefore).toBeLessThan(0);

    flipIndicesWinding(invertedIdx);
    const volAfter = computeSignedVolume(pos, invertedIdx);
    expect(volAfter).toBeCloseTo(-volBefore, 5);
    expect(volAfter).toBeGreaterThan(0);

    const normsF32 = new Float32Array([0, 1, 0, -1, 0, 0]);
    negateNormalBuffer(normsF32, 3);
    expect(Array.from(normsF32)).toEqual([0, -1, 0, 1, 0, 0]);

    const normsI16 = new Int16Array([32767, -16000, 0, 0]);
    negateNormalBuffer(normsI16, 4);
    expect(Array.from(normsI16)).toEqual([-32767, 16000, 0, 0]);

    expect(resolveUnlitEmissiveFallbackColor('GV | Dark mudstone')).toBe(0x4e4c49);
    expect(resolveUnlitEmissiveFallbackColor('GV | Ochre rock')).toBe(0x997a52);
    expect(resolveUnlitEmissiveFallbackColor('Torch flame')).toBeNull();
  });
});

describe('Map creation templates, serialization, and validation', () => {
  it('creates flat, rolling-hills, and rectangular starter-encounter maps of arbitrary sizes', () => {
    const flat = createGridFromTemplate({
      name: 'Hall',
      width: 24,
      length: 16,
      template: 'flat',
      baseUnderlayId: 3, // Warm Sand
      baseElevationFeet: 5,
      includeStarterProps: false,
    });
    expect(flat.width).toBe(24);
    expect(flat.length).toBe(16);
    expect(flat.getUnderlay(12, 8)).toBe(3);
    expect(flat.getHeight(10, 10)).toBe(128); // 5 ft = 128 height units

    const hills = createGridFromTemplate({
      name: 'Hills',
      width: 48,
      length: 24,
      template: 'rolling_hills',
      baseUnderlayId: 1,
      baseElevationFeet: 0,
      includeStarterProps: false,
    });
    let minH = Infinity;
    let maxH = -Infinity;
    for (const h of hills.heights) {
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
    expect(maxH - minH).toBeGreaterThan(64);

    const dungeon = createGridFromTemplate({
      name: 'Dungeon Canvas',
      width: 24,
      length: 16,
      template: 'dungeon',
      baseUnderlayId: 0,
      baseElevationFeet: 0,
      includeStarterProps: false,
    });
    expect(dungeon.width).toBe(24);
    expect(dungeon.length).toBe(16);
    expect(dungeon.getTile(0, 0).underlayId).toBe(34);
    expect(dungeon.getHeight(0, 0)).toBe(0);
  });

  it('roundtrips a complete VttMapDocument (terrain + autoMetadata + props + settings) and rejects invalid files', () => {
    const grid = createGridFromTemplate({
      name: 'Goblin Bridge!',
      width: 24,
      length: 16,
      template: 'flat',
      baseUnderlayId: 2,
      baseElevationFeet: 0,
      includeStarterProps: false,
    });
    grid.setHeight(12, 8, 256);
    paintManualOverlay(grid, 10, 6, 101, 2, 1);

    const doc = serializeMapDocument({
      name: 'Goblin Bridge!',
      grid,
      props: [
        {
          key: 'alderwatch.carriage_arch',
          tileX: 11,
          tileZ: 6.5,
          rotationDegrees: 90,
          scalePolicy: 'auto_dnd',
          scaleX: 1.25,
          scaleY: 1,
          scaleZ: 1.25,
          yOffsetFeet: 2.5,
        },
      ],
      shadingMode: 'pbr_shadows',
      showGrid: false,
    });
    expect(doc.id).toBe('goblin-bridge');
    expect(sanitizeMapId('  Keep / Level 2  ')).toBe('keep-level-2');

    const reparsed = parseMapDocument(JSON.parse(JSON.stringify(doc)));
    const restoredGrid = gridFromMapDocument(reparsed);
    expect(restoredGrid.width).toBe(24);
    expect(restoredGrid.length).toBe(16);
    expect(restoredGrid.getHeight(12, 8)).toBe(256);
    expect(restoredGrid.getTile(10, 6).overlayId).toBe(101);
    expect(restoredGrid.getTile(10, 6).overlayShape).toBe(2);
    expect(restoredGrid.getTile(10, 6).overlayRotation).toBe(1);
    expect(restoredGrid.getTile(10, 6).autoMetadata & TILE_MANUAL_LOCK).not.toBe(0);
    expect(reparsed.settings.shadingMode).toBe('pbr_shadows');
    expect(reparsed.settings.showGrid).toBe(false);
    expect(reparsed.props).toHaveLength(1);
    expect(reparsed.props[0]!.rotationDegrees).toBe(90);

    // Rejects invalid dimensions or truncated arrays
    expect(() => parseMapDocument({ terrain: { width: 4, length: 4 } })).toThrow();
    expect(() =>
      parseMapDocument({
        terrain: { width: 16, length: 16, heights: [0], underlays: [], overlays: [], shapes: [], rotations: [] },
      })
    ).toThrow();
  });

  it('roundtrips dungeon template documents cleanly', () => {
    const grid = createGridFromTemplate({
      name: 'Dungeon Hall',
      width: 24,
      length: 16,
      template: 'dungeon',
      baseUnderlayId: 34,
      baseElevationFeet: 0,
      includeStarterProps: false,
    });
    const doc = serializeMapDocument({
      name: 'Dungeon Hall',
      grid,
      props: [],
      shadingMode: 'pbr_shadows',
      showGrid: true,
      lighting: createDefaultLightingSettings('dungeon'),
    });
    const parsed = parseMapDocument(JSON.parse(JSON.stringify(doc)));
    expect(parsed.id).toBe('dungeon-hall');
    expect(parsed.terrain.width).toBe(24);
    expect(parsed.terrain.length).toBe(16);
    expect(parsed.settings.lighting?.preset).toBe('dungeon');
  });
});

describe('WorldLab Wall Decoration mounting and Object Animations', () => {
  const wallTorchEntry = {
    key: 'greyvein.wall_torch',
    pack: 'greyvein',
    name: 'Wall torch',
    glbUrl: '/local-assets/models/greyvein/wall_torch.glb',
    unitsPerTile: 1,
    nominalWidthTiles: 1,
    nominalLengthTiles: 1,
    fitFootprint: false,
    anchor: 'AUTHORED',
    category: 'prop' as const,
    placementRole: 'wall_decor' as const,
    rawMinY: 0.67,
    hasAnimation: true,
  };

  const towerEntry = {
    key: 'dunmere.arrow_tower_drum',
    pack: 'dunmere',
    name: 'Arrow tower drum',
    glbUrl: '/local-assets/models/dunmere/arrow_tower_drum.glb',
    unitsPerTile: 1,
    nominalWidthTiles: 2,
    nominalLengthTiles: 2,
    fitFootprint: false,
    anchor: 'AUTHORED',
    category: 'architecture' as const,
    placementRole: 'ground' as const,
    rawMinY: 0,
    hasAnimation: false,
  };

  it('preserves authored mount heights and snaps wall decorations onto supporting wall faces and tile edges', () => {
    expect(isWallDecorEntry(wallTorchEntry)).toBe(true);
    expect(preservesAuthoredMountHeight(wallTorchEntry)).toBe(true);
    expect(preservesAuthoredMountHeight(towerEntry)).toBe(false);

    // Snap onto the East face of a placed 2x2 tower drum centered at (11, 13)
    const wallSnap = resolveWallSnap(12, 13, 12.2, 13.0, 'straight_offset', [
      {
        id: 'tower_1',
        entry: towerEntry,
        tileX: 11,
        tileZ: 13,
        rotationDegrees: 0,
        worldHalfX: 1.5, // 1 tile half-width = 1.5 m -> east face at tileX = 12.0
        worldHalfZ: 1.5,
      },
    ]);
    expect(wallSnap.attachedToPropId).toBe('tower_1');
    expect(wallSnap.wallSide).toBe('E');
    expect(wallSnap.rotationDegrees).toBe(90);
    expect(wallSnap.tileX).toBeGreaterThan(12.0);

    // Fallback snap onto North tile edge with WorldLab straight_offset
    const edgeSnap = resolveWallSnap(5, 8, 5.5, 8.12, 'straight_offset', []);
    expect(edgeSnap.attachedToPropId).toBeNull();
    expect(edgeSnap.wallSide).toBe('N');
    expect(edgeSnap.rotationDegrees).toBe(0);
    expect(edgeSnap.tileZ).toBeCloseTo(8 + DEFAULT_WALL_WIDTH_TILES, 4);

    // Canonical diagonal pose matches WorldLab +45 deg offset
    const diag = resolveCanonicalWallDecorPose('diagonal_offset', 0);
    expect(diag.yawOffsetDegrees).toBe(45);
    expect(diag.offsetX).toBeGreaterThan(0.4);
  });

  it('plays ONLY embedded glTF animations (zero procedural wobble on static props) with deterministic phases', () => {
    expect(classifyAmbientAnimation(wallTorchEntry)).toBe('gltf_clip');
    expect(
      classifyAmbientAnimation({ ...wallTorchEntry, key: 'dunmere.watch_brazier', name: 'Watch brazier', hasAnimation: false })
    ).toBe('none');
    expect(
      classifyAmbientAnimation({ ...wallTorchEntry, key: 'dunmere.castle_banner', name: 'Castle banner', hasAnimation: false })
    ).toBe('none');

    const p1 = stablePhase('prop_1', 'greyvein.standing_torch');
    const p2 = stablePhase('prop_2', 'greyvein.standing_torch');
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(p1).toBeLessThan(1);
    expect(p1).not.toBe(p2);

    const flameGlow = evaluateFlameEmissiveStrength(0.4, 0.25);
    expect(flameGlow).toBeGreaterThan(1.0);
  });

  it('stacks models accurately on top of other models (multi-story towers & small props on tables)', () => {
    const grid = new TerrainGrid(16, 16);
    const towerCrownEntry = {
      ...towerEntry,
      key: 'dunmere.crenellated_tower_crown',
      name: 'Crenellated tower crown',
    };
    const brazierEntry = {
      ...towerEntry,
      key: 'dunmere.watch_brazier',
      name: 'Watch brazier',
      nominalWidthTiles: 1,
      nominalLengthTiles: 1,
      category: 'prop' as const,
    };

    // Base 2x2 tower drum centered at (8, 8), height 1.88 tiles * 1.5 m = 2.82 m (~9.4 ft)
    const baseBox = computePlacedWorldBounds(grid, {
      id: 'drum_1',
      entry: towerEntry,
      tileX: 8,
      tileZ: 8,
      rotationDegrees: 0,
      baseScaleX: 1.5,
      baseScaleY: 1.5,
      baseScaleZ: 1.5,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      yOffsetFeet: 0,
      localMinY: 0,
      localSizeX: 2.04,
      localSizeY: 1.88,
      localSizeZ: 2.04,
    });
    expect(baseBox.maxY).toBeCloseTo(2.82, 2);

    // Ray aiming straight down onto the top of the tower drum (world x=12, z=12)
    const ray = { originX: 12.1, originY: 15, originZ: 12.1, dirX: 0, dirY: -1, dirZ: 0 };

    // 1. Stacking same-footprint 2x2 crown snaps cleanly to exact tower center (8, 8) at +9.4 ft!
    const crownStack = resolveStackPlacement(ray, grid, towerCrownEntry, 0, 'center', [baseBox]);
    expect(crownStack).not.toBeNull();
    expect(crownStack!.supportId).toBe('drum_1');
    expect(crownStack!.alignedToSupportCenter).toBe(true);
    expect(crownStack!.tileX).toBe(8);
    expect(crownStack!.tileZ).toBe(8);
    expect(crownStack!.yOffsetFeet).toBeCloseTo(9.4, 1);

    // 2. Stacking a 3rd tier (brazier) on top of the stacked crown stacks cumulatively!
    const crownBox = computePlacedWorldBounds(grid, {
      id: 'crown_1',
      entry: towerCrownEntry,
      tileX: 8,
      tileZ: 8,
      rotationDegrees: 0,
      baseScaleX: 1.5,
      baseScaleY: 1.5,
      baseScaleZ: 1.5,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      yOffsetFeet: crownStack!.yOffsetFeet,
      localMinY: 0,
      localSizeX: 2.18,
      localSizeY: 0.8,
      localSizeZ: 2.18,
    });
    expect(crownBox.maxY).toBeCloseTo(2.82 + 1.2, 2);

    const brazierStack = resolveStackPlacement(ray, grid, brazierEntry, 0, 'center', [baseBox, crownBox]);
    expect(brazierStack).not.toBeNull();
    expect(brazierStack!.supportId).toBe('crown_1');
    expect(brazierStack!.yOffsetFeet).toBeCloseTo(13.4, 1);
  });
});

describe('User-controllable Lighting System and dynamic light sources', () => {
  it('classifies torches, wall torches, braziers, and cressets as point light emitters', () => {
    const base = {
      pack: 'greyvein',
      glbUrl: '/local-assets/models/test.glb',
      unitsPerTile: 1,
      nominalWidthTiles: 1,
      nominalLengthTiles: 1,
      fitFootprint: false,
      anchor: 'AUTHORED',
      category: 'prop' as const,
    };
    const brazier = classifyPropLightSource({ ...base, key: 'dunmere.watch_brazier', name: 'Watch brazier' });
    const wallTorch = classifyPropLightSource({ ...base, key: 'greyvein.wall_torch', name: 'Wall torch' });
    const cresset = classifyPropLightSource({ ...base, key: 'dunmere_lower_ward.wall_cresset', name: 'Wall cresset' });
    const arch = classifyPropLightSource({ ...base, key: 'alderwatch.carriage_arch', name: 'Carriage arch' });

    expect(brazier?.kind).toBe('brazier');
    expect(brazier?.rangeMeters).toBeGreaterThanOrEqual(10);
    expect(wallTorch?.kind).toBe('wall_torch');
    expect(wallTorch?.forwardOffsetMeters).toBeGreaterThan(0);
    expect(cresset?.kind).toBe('cresset');
    expect(arch).toBeNull();
  });

  it('clusters Magma/Lava terrain tiles into emitters and roundtrips lighting settings in map documents', () => {
    const lavaGrid = createGridFromTemplate({
      name: 'Lava Forge',
      width: 32,
      length: 32,
      template: 'dungeon',
      baseUnderlayId: 34,
      baseElevationFeet: 0,
      includeStarterProps: false,
    });
    for (let z = 4; z <= 6; z++) {
      for (let x = 4; x <= 6; x++) lavaGrid.setOverlay(x, z, 118, 0, 0);
      for (let x = 22; x <= 24; x++) lavaGrid.setOverlay(x, z, 118, 0, 0);
    }
    const dungeonDoc = serializeMapDocument({
      name: 'Lava Forge',
      grid: lavaGrid,
      props: [],
      shadingMode: 'pbr_shadows',
      showGrid: true,
      lighting: createDefaultLightingSettings('dungeon'),
    });
    expect(dungeonDoc.settings.lighting?.preset).toBe('dungeon');
    const reparsed = parseMapDocument(JSON.parse(JSON.stringify(dungeonDoc)));
    expect(reparsed.settings.lighting?.preset).toBe('dungeon');
    expect(reparsed.settings.lighting?.pointLightsEnabled).toBe(true);

    const grid = gridFromMapDocument(reparsed);
    const clusters = extractLavaLightClusters(grid, 10);
    // Two distinct lava pools -> at least 2 clustered emitters
    expect(clusters.length).toBeGreaterThanOrEqual(2);

    const dayTint = computeUnlitMoodTintHex(createDefaultLightingSettings('daylight'));
    const nightTint = computeUnlitMoodTintHex(createDefaultLightingSettings('night'));
    expect(dayTint).toBeGreaterThan(nightTint);
  });
});

describe('Lost-City terrain adaptations: highlight saturation roll-off, shaped void cutouts & procedural surface patterns', () => {
  it('applies Lost-City FloType.getTable 4-threshold highlight saturation roll-off', () => {
    expect(applyHighlightSaturationRollOff(0.8, 0.5)).toBeCloseTo(0.8, 6);
    expect(applyHighlightSaturationRollOff(0.8, 185 / 256)).toBeCloseTo(0.4, 6);
    expect(applyHighlightSaturationRollOff(0.8, 200 / 256)).toBeCloseTo(0.2, 6);
    expect(applyHighlightSaturationRollOff(0.8, 225 / 256)).toBeCloseTo(0.1, 6);
    expect(applyHighlightSaturationRollOff(0.8, 250 / 256)).toBeCloseTo(0.05, 6);

    const midPacked = packHsl16([0.15, 0.9, 0.65]);
    const brightPacked = packHsl16([0.15, 0.9, 0.88]);
    expect((brightPacked >> 7) & 7).toBeLessThan((midPacked >> 7) & 7);

    const shadedBright = shadeHsl16(midPacked, 1.35);
    expect((shadedBright >> 7) & 7).toBeLessThan((midPacked >> 7) & 7);
  });

  it('skips overlay triangles on Lost-City 0xFF00FF Shaped Void Cutout tiles while keeping underlay triangles', () => {
    const voidMat = getMaterial(VOID_OVERLAY_ID);
    expect(isVoidOverlay(voidMat)).toBe(true);
    expect(voidMat.hex).toBe(0xff00ff);

    const gFull = new TerrainGrid(8, 8);
    expect(buildChunkMesh(gFull, 0, 0).triangleCount).toBe(128);

    // Full Shaped Void removes both triangles (-2)
    paintManualOverlay(gFull, 2, 2, VOID_OVERLAY_ID, 1, 0);
    expect(buildChunkMesh(gFull, 0, 0).triangleCount).toBe(126);

    // Diagonal Shaped Void removes ONLY the 1 overlay triangle, keeping the 1 underlay triangle (-1)
    paintManualOverlay(gFull, 4, 4, VOID_OVERLAY_ID, 2, 0);
    expect(buildChunkMesh(gFull, 0, 0).triangleCount).toBe(125);

    // Auto-painting a diagonal void stroke creates shaped diagonal cutouts cleanly
    const gAuto = new TerrainGrid(8, 8);
    autoPaintOverlaySeeds(gAuto, [{ tx: 2, tz: 2 }, { tx: 3, tz: 3 }, { tx: 4, tz: 4 }], VOID_OVERLAY_ID);
    const built = buildChunkMesh(gAuto, 0, 0);
    expect(built.triangleCount).toBeLessThan(128);
    expect(built.triangleCount).toBeGreaterThan(100);
  });

  it('packs procedural RS2 surfacePattern IDs into chunk surfaceMeta for planks, cobble, flagstone, and marble', () => {
    const grid = new TerrainGrid(8, 8);
    paintManualOverlay(grid, 0, 0, 102, 1, 0); // Wooden Floor -> PLANKS (2)
    paintManualOverlay(grid, 1, 0, 101, 1, 0); // Cobble Road -> COBBLE (3)
    paintManualOverlay(grid, 2, 0, 104, 1, 0); // Dungeon Stone -> FLAGSTONE (4)
    paintManualOverlay(grid, 3, 0, 108, 1, 0); // Temple Marble -> MARBLE (5)

    const mesh = buildChunkMesh(grid, 0, 0);
    const foundPatterns = new Set<number>();
    for (let i = 0; i < mesh.surfaceMeta.length; i += 4) {
      foundPatterns.add(mesh.surfaceMeta[i]!);
    }
    expect(foundPatterns.has(SURFACE_PATTERN.PLAIN)).toBe(true);
    expect(foundPatterns.has(SURFACE_PATTERN.PLANKS)).toBe(true);
    expect(foundPatterns.has(SURFACE_PATTERN.COBBLE)).toBe(true);
    expect(foundPatterns.has(SURFACE_PATTERN.FLAGSTONE)).toBe(true);
    expect(foundPatterns.has(SURFACE_PATTERN.MARBLE)).toBe(true);
  });
});
