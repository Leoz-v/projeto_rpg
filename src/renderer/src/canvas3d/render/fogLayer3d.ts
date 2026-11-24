import { FlatMaterial, Geometry3D, Mesh3D } from '@pixi/3d';
import { CanvasSource, Texture } from 'pixi.js';
import type { FogCell, FogMode, GameMap, Token } from '../../../../shared/protocol';
import { fillFogImageData, fogSignature, type FogTool, type FogViewer } from '../../canvas/fog-render';
import { METERS_PER_HEIGHT_UNIT, TILE_SIZE_METERS } from '../terrain/constants';
import { pickTerrain } from '../terrain/raycast';
import type { TerrainGrid } from '../terrain/terrainGrid';
import type { SceneManager } from './sceneManager';

/**
 * Camada de névoa de guerra e ferramenta de pintura manual para mapas 3D (`Map3DView`).
 * Usa a mesma função `fillFogImageData` do mapa 2D numa malha que acompanha o relevo
 * do terreno, com textura `CanvasSource` 1 px por célula (`scaleMode: 'nearest'`).
 */

export interface FogLayer3dEvents {
  onFogPaint: (mapId: string, mode: FogMode, cells: FogCell[]) => void;
  onFogRect: (mapId: string, mode: FogMode, from: FogCell, to: FogCell) => void;
}

const FOG_ELEVATION_OFFSET = 0.08;

function buildFogGeometry(grid: TerrainGrid): Geometry3D {
  const { width, length } = grid;
  const cols = width + 1;
  const rows = length + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices = new Uint32Array(width * length * 6);

  let pi = 0;
  let ui = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const h = grid.sampleHeightAtTileCoord(col, row);
      positions[pi++] = col * TILE_SIZE_METERS;
      positions[pi++] = h * METERS_PER_HEIGHT_UNIT + FOG_ELEVATION_OFFSET;
      positions[pi++] = row * TILE_SIZE_METERS;
      uvs[ui++] = col / width;
      uvs[ui++] = row / length;
    }
  }

  let ii = 0;
  for (let row = 0; row < length; row++) {
    for (let col = 0; col < width; col++) {
      const v00 = row * cols + col;
      const v10 = v00 + 1;
      const v01 = v00 + cols;
      const v11 = v01 + 1;
      indices[ii++] = v00;
      indices[ii++] = v01;
      indices[ii++] = v11;
      indices[ii++] = v00;
      indices[ii++] = v11;
      indices[ii++] = v10;
    }
  }

  return new Geometry3D({ positions, uvs, indices });
}

export class FogLayer3d {
  private readonly eventAbort = new AbortController();
  private readonly fogCanvas: HTMLCanvasElement;
  private readonly fogTexture: Texture;
  private readonly material: FlatMaterial;
  private readonly mesh: Mesh3D;
  private map: GameMap | null = null;
  private tokens: readonly Token[] = [];
  private viewer: FogViewer = { role: 'player', playerId: '' };
  private fogTool: FogTool = 'none';
  private shownKey = '';
  private brush: { mapId: string; mode: FogMode; cells: Map<string, FogCell> } | undefined;
  private rect: { mapId: string; mode: FogMode; from: FogCell; to: FogCell } | undefined;
  private destroyed = false;

  constructor(
    private readonly sceneMgr: SceneManager,
    private readonly grid: TerrainGrid,
    private readonly events: FogLayer3dEvents,
  ) {
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = grid.width;
    this.fogCanvas.height = grid.length;
    this.fogTexture = new Texture({ source: new CanvasSource({ resource: this.fogCanvas, scaleMode: 'nearest' }) });
    this.material = new FlatMaterial({
      baseColorTexture: this.fogTexture,
      alphaMode: 'blend',
      doubleSided: true,
    });
    this.mesh = new Mesh3D({
      geometry: buildFogGeometry(grid),
      material: this.material,
      castShadow: false,
      receiveShadow: false,
      label: 'fog_of_war_3d',
    });
    this.sceneMgr.overlayRoot.addChild(this.mesh);
    this.attachListeners();
  }

  setScene(map: GameMap | null, tokens: readonly Token[], viewer: FogViewer): void {
    if (this.destroyed) return;
    this.map = map;
    this.tokens = tokens;
    this.viewer = viewer;
    const key = fogSignature(map, tokens, viewer);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.redrawTexture();
  }

  setTool(tool: FogTool): void {
    if (this.destroyed) return;
    this.fogTool = tool;
    const active = tool !== 'none';
    this.sceneMgr.app.canvas.style.cursor = active ? 'crosshair' : '';
    this.sceneMgr.setLeftButtonAction(active ? 'none' : 'pan');
    if (!active && (this.brush || this.rect)) {
      this.brush = undefined;
      this.rect = undefined;
      this.redrawTexture();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.eventAbort.abort();
    this.mesh.parent?.removeChild(this.mesh);
    this.mesh.geometry.destroy(true);
    this.mesh.destroy();
    this.fogTexture.destroy(true);
  }

  private redrawTexture(): void {
    const ctx2d = this.fogCanvas.getContext('2d');
    if (!ctx2d) return;
    const width = this.grid.width;
    const height = this.grid.length;
    const imageData = ctx2d.createImageData(width, height);
    if (this.map && this.map.width === width && this.map.height === height) {
      fillFogImageData(imageData.data, this.map, this.tokens, this.viewer);
    }

    // Sobrepõe pré-visualização da ferramenta ativa (pincel ou retângulo) diretamente na textura.
    if (this.brush) {
      const rgba = this.brush.mode === 'cover' ? ([108, 92, 231, 180] as const) : ([95, 211, 141, 180] as const);
      for (const cell of this.brush.cells.values()) {
        this.paintPreviewPixel(imageData.data, width, height, cell.x, cell.y, rgba);
      }
    } else if (this.rect) {
      const rgba = this.rect.mode === 'cover' ? ([108, 92, 231, 180] as const) : ([95, 211, 141, 180] as const);
      const minX = Math.min(this.rect.from.x, this.rect.to.x);
      const maxX = Math.max(this.rect.from.x, this.rect.to.x);
      const minY = Math.min(this.rect.from.y, this.rect.to.y);
      const maxY = Math.max(this.rect.from.y, this.rect.to.y);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          this.paintPreviewPixel(imageData.data, width, height, x, y, rgba);
        }
      }
    }

    ctx2d.putImageData(imageData, 0, 0);
    this.fogTexture.source.update();
  }

  private paintPreviewPixel(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    x: number,
    y: number,
    rgba: readonly [number, number, number, number],
  ): void {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  }

  private attachListeners(): void {
    const canvas = this.sceneMgr.app.canvas;
    const { signal } = this.eventAbort;

    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (this.viewer.role !== 'gm' || this.fogTool === 'none' || !this.map || e.button !== 0) return;
        const hit = pickTerrain(this.grid, this.sceneMgr.clientPointToRay(e.clientX, e.clientY));
        if (!hit) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        const cell: FogCell = { x: hit.tileX, y: hit.tileZ };
        if (this.fogTool === 'brush-cover' || this.fogTool === 'brush-reveal') {
          const mode: FogMode = this.fogTool === 'brush-cover' ? 'cover' : 'reveal';
          this.brush = { mapId: this.map.id, mode, cells: new Map([[`${cell.x},${cell.y}`, cell]]) };
        } else {
          const mode: FogMode = this.fogTool === 'rect-cover' ? 'cover' : 'reveal';
          this.rect = { mapId: this.map.id, mode, from: cell, to: cell };
        }
        this.redrawTexture();
      },
      { capture: true, signal },
    );

    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.brush && !this.rect) return;
        e.stopImmediatePropagation();
        const hit = pickTerrain(this.grid, this.sceneMgr.clientPointToRay(e.clientX, e.clientY));
        if (!hit) return;
        const cell: FogCell = { x: hit.tileX, y: hit.tileZ };
        if (this.brush) {
          const key = `${cell.x},${cell.y}`;
          if (!this.brush.cells.has(key)) {
            this.brush.cells.set(key, cell);
            this.redrawTexture();
          }
        } else if (this.rect && (this.rect.to.x !== cell.x || this.rect.to.y !== cell.y)) {
          this.rect.to = cell;
          this.redrawTexture();
        }
      },
      { capture: true, signal },
    );

    const finish = (): void => {
      if (this.brush) {
        const { mapId, mode, cells } = this.brush;
        this.brush = undefined;
        this.redrawTexture();
        if (cells.size > 0) this.events.onFogPaint(mapId, mode, [...cells.values()]);
      } else if (this.rect) {
        const { mapId, mode, from, to } = this.rect;
        this.rect = undefined;
        this.redrawTexture();
        this.events.onFogRect(mapId, mode, from, to);
      }
    };

    window.addEventListener('pointerup', finish, { signal });
    window.addEventListener('pointercancel', finish, { signal });
  }
}
