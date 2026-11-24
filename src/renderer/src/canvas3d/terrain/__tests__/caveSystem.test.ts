import { describe, expect, it } from 'vitest';
import {
  CAVE_CLIFF_OVERLAY_ID,
  CAVE_MUDSTONE_UNDERLAY_ID,
  CAVE_ROCK_UNDERLAY_ID,
  CAVE_SCREE_OVERLAY_ID,
  OCHRE_CAVE_ROCK_UNDERLAY_ID,
  getMaterial,
  getOverlayMaterials,
  getUnderlayMaterials,
} from '../materials';
import { buildChunkMesh } from '../meshBuilder';
import { pickTerrain } from '../raycast';
import { TerrainGrid } from '../terrainGrid';
import { TILE_SIZE_METERS } from '../constants';
import { TerrainHistory, TerrainStrokeRecorder } from '../../tools/history';
import {
  buildCaveVoidTunnelData,
  isCaveMouthEntry,
} from '../../render/caveSystem';
import { preservesAuthoredMountHeight } from '../../render/wallDecoration';
import {
  DEFAULT_INTERIOR_DEPTH_FEET,
  createDefaultInteriorGrid,
  gridFromMapDocument,
  interiorGridFromMapDocument,
  parseMapDocument,
  serializeMapDocument,
} from '../../map/mapDocument';

describe('Terrain Cutout Holes & Vertex Shadow/AO', () => {
  it('skips generating terrain triangles for cutout tiles and supports includeHoles raycasting', () => {
    const grid = new TerrainGrid(16, 16);
    const fullChunk = buildChunkMesh(grid, 0, 0);
    expect(fullChunk.triangleCount).toBe(64 * 2);

    // Punch a 2x2 cave opening at (3..4, 3..4)
    expect(grid.setHole(3, 3, true)).toBe(true);
    expect(grid.setHole(4, 3, true)).toBe(true);
    expect(grid.setHole(3, 4, true)).toBe(true);
    expect(grid.setHole(4, 4, true)).toBe(true);
    expect(grid.countHoles()).toBe(4);

    const cutChunk = buildChunkMesh(grid, 0, 0);
    expect(cutChunk.triangleCount).toBe((64 - 4) * 2);

    // Ray aiming straight down onto hole tile (3, 3) passes through when includeHoles=false,
    // and hits cleanly when includeHoles=true (for Hole Restore brush)
    const ray = {
      originX: 3.5 * TILE_SIZE_METERS,
      originY: 12,
      originZ: 3.5 * TILE_SIZE_METERS,
      dirX: 0,
      dirY: -1,
      dirZ: 0,
    };
    expect(pickTerrain(grid, ray, { includeHoles: false })).toBeNull();
    const restoreHit = pickTerrain(grid, ray, { includeHoles: true });
    expect(restoreHit).not.toBeNull();
    expect(restoreHit!.tileX).toBe(3);
    expect(restoreHit!.tileZ).toBe(3);

    // Punching all 64 tiles in chunk (0,0) produces a clean 0-triangle chunk
    for (let tz = 0; tz < 8; tz++) {
      for (let tx = 0; tx < 8; tx++) {
        grid.setHole(tx, tz, true);
      }
    }
    const emptyChunk = buildChunkMesh(grid, 0, 0);
    expect(emptyChunk.triangleCount).toBe(0);
    expect(emptyChunk.indices.length).toBe(0);
  });

  it('darkens Flat, RS2 Gouraud, and PBR Albedo vertex colors when Vertex Shadow/AO is painted', () => {
    const grid = new TerrainGrid(8, 8);
    const unshaded = buildChunkMesh(grid, 0, 0);

    for (let vz = 0; vz <= 8; vz++) {
      for (let vx = 0; vx <= 8; vx++) {
        grid.setVertexShade(vx, vz, 0.9);
      }
    }
    const shaded = buildChunkMesh(grid, 0, 0);

    const avgLum = (buf: Float32Array): number => {
      let sum = 0;
      const count = buf.length / 4;
      for (let i = 0; i < buf.length; i += 4) {
        sum += buf[i]! + buf[i + 1]! + buf[i + 2]!;
      }
      return sum / (count * 3);
    };

    expect(avgLum(shaded.colorsFlat)).toBeLessThan(avgLum(unshaded.colorsFlat) * 0.25);
    expect(avgLum(shaded.colorsRs2)).toBeLessThan(avgLum(unshaded.colorsRs2) * 0.25);
    expect(avgLum(shaded.colorsAlbedo)).toBeLessThan(avgLum(unshaded.colorsAlbedo) * 0.25);
  });

  it('records, undoes, and redoes cutout holes and vertex shadow/AO atomically in TerrainHistory', () => {
    const grid = new TerrainGrid(16, 16);
    const history = new TerrainHistory();

    const rec = new TerrainStrokeRecorder(grid, 'Cutout + Shadow');
    grid.setHole(5, 5, true);
    grid.setHole(6, 5, true);
    grid.setVertexShade(5, 5, 0.85);
    grid.setVertexShade(6, 6, 0.6);
    const tx = rec.commit(grid);
    expect(tx.holes.length).toBe(2);
    expect(tx.shades.length).toBe(2);
    history.push(tx);

    expect(grid.isHole(5, 5)).toBe(true);
    expect(grid.getVertexShade(5, 5)).toBeCloseTo(0.85, 1);

    history.undo(grid);
    expect(grid.isHole(5, 5)).toBe(false);
    expect(grid.isHole(6, 5)).toBe(false);
    expect(grid.getVertexShade(5, 5)).toBe(0);
    expect(grid.getVertexShade(6, 6)).toBe(0);

    history.redo(grid);
    expect(grid.isHole(5, 5)).toBe(true);
    expect(grid.isHole(6, 5)).toBe(true);
    expect(grid.getVertexShade(5, 5)).toBeCloseTo(0.85, 1);
  });
});

describe('Greyvein-matched Cave Materials, Dark Void Shell & Ceiling Mounts', () => {
  it('exposes Greyvein cave rock underlays and scree/cave-cliff overlays', () => {
    const underlays = getUnderlayMaterials().map((m) => m.id);
    const overlays = getOverlayMaterials().map((m) => m.id);

    expect(underlays).toContain(CAVE_ROCK_UNDERLAY_ID);
    expect(underlays).toContain(OCHRE_CAVE_ROCK_UNDERLAY_ID);
    expect(underlays).toContain(CAVE_MUDSTONE_UNDERLAY_ID);
    expect(overlays).toContain(CAVE_SCREE_OVERLAY_ID);
    expect(overlays).toContain(CAVE_CLIFF_OVERLAY_ID);

    expect(getMaterial(CAVE_SCREE_OVERLAY_ID).lightingMode).toBe('FACETED');
    expect(getMaterial(CAVE_CLIFF_OVERLAY_ID).lightingMode).toBe('FACETED');
  });

  it('classifies cave mouths and ceiling-hung mounts accurately', () => {
    const makeEntry = (key: string, name: string) => ({
      key,
      pack: 'greyvein',
      name,
      glbUrl: `/local-assets/models/greyvein/${key}.glb`,
      unitsPerTile: 1,
      nominalWidthTiles: 4,
      nominalLengthTiles: 4,
      fitFootprint: false,
      anchor: 'AUTHORED',
      category: 'architecture' as const,
    });

    expect(isCaveMouthEntry(makeEntry('greyvein.weathered_cave_mouth', 'Weathered cave mouth'))).toBe(true);
    expect(isCaveMouthEntry(makeEntry('greyvein.slumped_entrance', 'Slumped entrance'))).toBe(true);
    expect(isCaveMouthEntry(makeEntry('greyvein.rift_entrance', 'Rift entrance'))).toBe(true);
    expect(isCaveMouthEntry(makeEntry('greyvein.bedded_face', 'Bedded face'))).toBe(false);

    // Stalactite/ceiling-hung pieces must preserve authored y=0 ceiling datum instead of floating up by -minY
    expect(preservesAuthoredMountHeight(makeEntry('greyvein.pendant_roof', 'Pendant roof'))).toBe(true);
    expect(preservesAuthoredMountHeight(makeEntry('greyvein.open_chimney_roof', 'Open chimney roof'))).toBe(true);
    expect(preservesAuthoredMountHeight(makeEntry('greyvein.ceiling_teeth', 'Ceiling teeth'))).toBe(true);
  });

  it('builds a valid vaulted dark-to-pitch-black procedural cave void tunnel mesh', () => {
    const data = buildCaveVoidTunnelData(4.0, 2.35, 2.55);
    expect(data.positions.length).toBeGreaterThan(90);
    expect(data.indices.length).toBeGreaterThan(120);
    expect(data.indices.length % 3).toBe(0);

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < data.positions.length; i += 3) {
      expect(Number.isFinite(data.positions[i]!)).toBe(true);
      expect(Number.isFinite(data.positions[i + 1]!)).toBe(true);
      expect(Number.isFinite(data.positions[i + 2]!)).toBe(true);
      const z = data.positions[i + 2]!;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    // Tunnel recedes deeply into -Z behind the cave mouth
    expect(minZ).toBeLessThan(-2.4);
    expect(maxZ).toBeLessThanOrEqual(0.1);
  });
});

describe('Dual-Layer Surface + Interior Architecture & Serialization', () => {
  it('initializes a flat Cave Mudstone Interior layer without altering Surface terrain', () => {
    const surface = new TerrainGrid(16, 16);
    surface.setHeight(5, 5, 160);
    surface.setHole(8, 8, true);

    const interior = createDefaultInteriorGrid(surface.width, surface.length);
    expect(interior.width).toBe(surface.width);
    expect(interior.length).toBe(surface.length);
    expect(interior.getHeight(5, 5)).toBe(0);
    expect(interior.getUnderlay(8, 8)).toBe(CAVE_MUDSTONE_UNDERLAY_ID);
    expect(interior.countHoles()).toBe(0);

    // Surface hill stays completely intact
    expect(surface.getHeight(5, 5)).toBe(160);
    expect(surface.isHole(8, 8)).toBe(true);
  });

  it('roundtrips Surface terrain, Interior terrain, interiorDepthFeet, and per-prop layer in map documents', () => {
    const surface = new TerrainGrid(16, 16);
    surface.setHeight(4, 4, 120);
    surface.setHole(4, 5, true);
    surface.setVertexShade(6, 7, 0.75);

    const interior = createDefaultInteriorGrid(16, 16);
    interior.setHeight(8, 8, 40);
    interior.setUnderlay(8, 8, CAVE_ROCK_UNDERLAY_ID);
    interior.setVertexShade(8, 8, 0.5);

    const doc = serializeMapDocument({
      name: 'Dual Layer Cave Map',
      grid: surface,
      interiorGrid: interior,
      props: [
        {
          key: 'greyvein.weathered_cave_mouth',
          tileX: 8,
          tileZ: 8,
          rotationDegrees: 0,
          scalePolicy: 'auto_dnd',
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
          yOffsetFeet: 0,
          caveVoid: false,
          layer: 'surface',
        },
        {
          key: 'greyvein.broad_chamber',
          tileX: 8,
          tileZ: 6,
          rotationDegrees: 90,
          scalePolicy: 'auto_dnd',
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
          yOffsetFeet: 0,
          layer: 'interior',
        },
      ],
      shadingMode: 'pbr_shadows',
      showGrid: true,
      interiorDepthFeet: 15,
    });

    const parsed = parseMapDocument(JSON.parse(JSON.stringify(doc)));
    expect(parsed.settings.interiorDepthFeet).toBe(15);
    expect(parsed.props[0]?.layer ?? 'surface').toBe('surface');
    expect(parsed.props[0]?.caveVoid).toBe(false);
    expect(parsed.props[1]?.layer).toBe('interior');

    const restoredSurface = gridFromMapDocument(parsed);
    expect(restoredSurface.getHeight(4, 4)).toBe(120);
    expect(restoredSurface.isHole(4, 5)).toBe(true);
    expect(restoredSurface.isHole(4, 4)).toBe(false);
    expect(restoredSurface.getVertexShade(6, 7)).toBeCloseTo(0.75, 1);

    const restoredInterior = interiorGridFromMapDocument(parsed);
    expect(restoredInterior.getHeight(8, 8)).toBe(40);
    expect(restoredInterior.getUnderlay(8, 8)).toBe(CAVE_ROCK_UNDERLAY_ID);
    expect(restoredInterior.getVertexShade(8, 8)).toBeCloseTo(0.5, 1);

    // Backward compatibility: legacy document missing interior, holes, vertexShade, and layer still parses cleanly
    const legacy = JSON.parse(JSON.stringify(doc)) as {
      interior?: unknown;
      terrain: { holes?: unknown; vertexShade?: unknown };
      settings: { interiorDepthFeet?: unknown };
      props: { layer?: unknown }[];
    };
    delete legacy.interior;
    delete legacy.terrain.holes;
    delete legacy.terrain.vertexShade;
    delete legacy.settings.interiorDepthFeet;
    if (legacy.props[0]) delete legacy.props[0].layer;
    const legacyParsed = parseMapDocument(legacy);
    expect(legacyParsed.settings.interiorDepthFeet ?? DEFAULT_INTERIOR_DEPTH_FEET).toBe(DEFAULT_INTERIOR_DEPTH_FEET);
    expect(legacyParsed.props[0]?.layer ?? 'surface').toBe('surface');

    const legacySurface = gridFromMapDocument(legacyParsed);
    expect(legacySurface.countHoles()).toBe(0);
    expect(legacySurface.getVertexShade(6, 7)).toBe(0);

    const legacyInterior = interiorGridFromMapDocument(legacyParsed);
    expect(legacyInterior.width).toBe(legacySurface.width);
    expect(legacyInterior.getUnderlay(2, 2)).toBe(CAVE_MUDSTONE_UNDERLAY_ID);
  });
});
