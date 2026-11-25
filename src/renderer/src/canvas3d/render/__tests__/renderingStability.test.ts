import { Container3D } from '@pixi/3d';
import { describe, expect, it } from 'vitest';
import { VOID_OVERLAY_ID } from '../../terrain/materials';
import { TerrainGrid } from '../../terrain/terrainGrid';
import { LiquidRenderer } from '../liquidRenderer';
import { TerrainRenderer } from '../terrainRenderer';

describe('TerrainGrid overlay dirty tracking', () => {
  it('does not mark heightsDirty or cutoutsDirty for non-void paint and shade edits', () => {
    const grid = new TerrainGrid(16, 16);
    grid.clearOverlayGeometryDirty();

    expect(grid.setUnderlay(4, 4, 2)).toBe(true);
    expect(grid.setOverlay(4, 4, 101, 1, 0)).toBe(true);
    expect(grid.setVertexShade(4, 4, 0.5)).toBe(true);
    expect(grid.heightsDirty).toBe(false);
    expect(grid.cutoutsDirty).toBe(false);
  });

  it('marks heightsDirty on height changes and cutoutsDirty on hole or void-overlay edits', () => {
    const grid = new TerrainGrid(16, 16);
    grid.clearOverlayGeometryDirty();

    expect(grid.setHeight(3, 3, 64)).toBe(true);
    expect(grid.heightsDirty).toBe(true);
    expect(grid.cutoutsDirty).toBe(false);

    grid.clearOverlayGeometryDirty();
    expect(grid.setHole(2, 2, true)).toBe(true);
    expect(grid.heightsDirty).toBe(false);
    expect(grid.cutoutsDirty).toBe(true);

    grid.clearOverlayGeometryDirty();
    expect(grid.setOverlay(5, 5, VOID_OVERLAY_ID, 1, 0)).toBe(true);
    expect(grid.cutoutsDirty).toBe(true);

    grid.clearOverlayGeometryDirty();
    expect(grid.setOverlay(5, 5, 0, 0, 0)).toBe(true);
    expect(grid.cutoutsDirty).toBe(true);
  });
});

describe('TerrainRenderer dynamic overlay geometries and cleanup', () => {
  it('marks frequently rebuilt overlay geometries as dynamic and skips grid/skirt rebuilds on paint-only edits', () => {
    const grid = new TerrainGrid(16, 16);
    const terrainRoot = new Container3D();
    const overlayRoot = new Container3D();
    const renderer = new TerrainRenderer(grid, terrainRoot, overlayRoot);

    const gridMeshBefore = terrainRoot.children.find((c) => c.label === 'dnd_5ft_grid') as
      | { geometry: { dynamic: boolean } }
      | undefined;
    const skirtMeshBefore = terrainRoot.children.find((c) => c.label === 'diorama_skirt') as
      | { geometry: { dynamic: boolean } }
      | undefined;

    expect(gridMeshBefore?.geometry.dynamic).toBe(true);
    expect(skirtMeshBefore?.geometry.dynamic).toBe(true);

    const gridGeoRef = gridMeshBefore?.geometry;
    const skirtGeoRef = skirtMeshBefore?.geometry;

    // Paint-only edit should rebuild dirty chunks without recreating grid or skirt geometry.
    grid.setUnderlay(2, 2, 3);
    expect(renderer.syncDirtyChunks()).toBeGreaterThan(0);
    expect(gridMeshBefore?.geometry).toBe(gridGeoRef);
    expect(skirtMeshBefore?.geometry).toBe(skirtGeoRef);

    // Sculpting height should rebuild both grid and skirt geometry.
    grid.setHeight(2, 2, 128);
    expect(renderer.syncDirtyChunks()).toBeGreaterThan(0);
    expect(gridMeshBefore?.geometry).not.toBe(gridGeoRef);
    expect(skirtMeshBefore?.geometry).not.toBe(skirtGeoRef);

    // Brush preview, ruler, and selection ring geometries must stay out of GeometryAtlas (dynamic: true).
    renderer.setBrushPreview([{ x: 1, y: 0, z: 1, weight: 1, color: [1, 1, 1] }]);
    renderer.setRulerLine({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 3 });
    renderer.setSelectionRing({ x: 2, y: 0, z: 2, radius: 1 });

    for (const label of ['brush_preview', 'dnd_ruler', 'asset_selection_ring']) {
      const mesh = overlayRoot.children.find((c) => c.label === label) as
        | { geometry: { dynamic: boolean } }
        | undefined;
      expect(mesh?.geometry.dynamic).toBe(true);
    }

    renderer.destroy();
    expect(terrainRoot.children).toHaveLength(0);
    expect(overlayRoot.children).toHaveLength(0);
  });
});

describe('LiquidRenderer dynamic overlays and material disposal', () => {
  it('marks preview/overlay geometries as dynamic and destroys materials on removeSurface and destroy', () => {
    const grid = new TerrainGrid(16, 16);
    const surfaceRoot = new Container3D();
    const interiorRoot = new Container3D();
    const overlayRoot = new Container3D();
    const liquids = new LiquidRenderer(surfaceRoot, interiorRoot, overlayRoot, grid, grid);

    const added = liquids.addSurface({
      id: 'pond_1',
      layer: 'surface',
      preset: 'clear_water',
      x: 2,
      z: 2,
      width: 4,
      length: 4,
      levelFeet: -1,
    });

    liquids.setOverlayState({
      selected: added,
      connectedNeighbors: [],
      hoveredEdge: null,
      previewRect: { x: 2, z: 2, width: 4, length: 4, levelFeet: -1, colorHex: 0x35b8e8 },
      snapLines: [],
      layerOffsetY: 0,
    });

    for (const label of ['liquid_preview_quad', 'liquid_overlay_lines']) {
      const mesh = overlayRoot.children.find((c) => c.label === label) as
        | { geometry: { dynamic: boolean } }
        | undefined;
      expect(mesh?.geometry.dynamic).toBe(true);
    }

    expect(liquids.removeSurface(added.id)).toBe(true);
    expect(surfaceRoot.children).toHaveLength(0);

    liquids.destroy();
    expect(overlayRoot.children).toHaveLength(0);
  });
});
