import {
  DEFAULT_RULER_OPTIONS,
  formatRulerLabel,
  measureRulerPath,
  measureRulerRadius,
  type RulerOptions,
} from '../../canvas/ruler';
import { heightUnitsToFeet, METERS_PER_HEIGHT_UNIT, TILE_SIZE_METERS } from '../terrain/constants';
import { pickTerrain, type TerrainPickHit } from '../terrain/raycast';
import type { TerrainGrid } from '../terrain/terrainGrid';
import type { SceneManager } from './sceneManager';
import type { TerrainRenderer } from './terrainRenderer';

/**
 * Ferramenta local de régua para a visualização 3D da mesa (`Map3DView`).
 * Usa a mesma regra de distância do motor (`rules-engine/space`), suportando
 * trajetos com curvas (`Shift`), área circular de impacto (`Raio`) e unidades
 * em pés (`ft`) ou metros (`m`).
 */

interface RulerEndpoint3d {
  tx: number;
  tz: number;
  hUnits: number;
  x: number;
  y: number;
  z: number;
}

function endpointFromHit(grid: TerrainGrid, hit: TerrainPickHit): RulerEndpoint3d {
  const tx = hit.tileX;
  const tz = hit.tileZ;
  const hUnits = grid.sampleHeightAtTileCoord(tx + 0.5, tz + 0.5);
  return {
    tx,
    tz,
    hUnits,
    x: (tx + 0.5) * TILE_SIZE_METERS,
    y: hUnits * METERS_PER_HEIGHT_UNIT,
    z: (tz + 0.5) * TILE_SIZE_METERS,
  };
}

export class RulerTool3d {
  private readonly eventAbort = new AbortController();
  private active = false;
  private options: RulerOptions = { ...DEFAULT_RULER_OPTIONS };
  private dragging = false;
  private points: RulerEndpoint3d[] = [];
  private label = '';
  private destroyed = false;

  constructor(
    private readonly sceneMgr: SceneManager,
    private readonly surfaceRenderer: TerrainRenderer,
    private readonly grid: TerrainGrid,
  ) {
    this.attachListeners();
  }

  setActive(active: boolean): void {
    if (this.destroyed) return;
    this.active = active;
    this.sceneMgr.app.canvas.style.cursor = active ? 'crosshair' : '';
    this.sceneMgr.setLeftButtonAction(active ? 'none' : 'pan');
    if (!active) this.clear();
  }

  setOptions(options: RulerOptions): void {
    if (this.destroyed) return;
    const shapeChanged = this.options.shape !== options.shape;
    this.options = { ...options };
    if (shapeChanged) {
      this.clear();
    } else if (this.points.length >= 2) {
      this.render();
    }
  }

  clear(): void {
    this.dragging = false;
    this.points = [];
    this.label = '';
    this.surfaceRenderer.setRulerPath(null);
    this.sceneMgr.setRulerLabel(null, '');
  }

  /** Mantém o rótulo 2D alinhado ao ponto médio 3D enquanto a câmera orbita ou faz zoom. */
  tick(): void {
    if (this.points.length < 2 || !this.label) return;
    const prev = this.points[this.points.length - 2]!;
    const curr = this.points[this.points.length - 1]!;
    const mid = {
      x: (prev.x + curr.x) * 0.5,
      y: Math.max(prev.y, curr.y) + 0.75,
      z: (prev.z + curr.z) * 0.5,
    };
    this.sceneMgr.setRulerLabel(mid, this.label);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.eventAbort.abort();
    this.clear();
  }

  private render(): void {
    if (this.points.length < 2) {
      this.clear();
      return;
    }

    const first = this.points[0]!;
    const last = this.points[this.points.length - 1]!;
    const elevDeltaFeet = heightUnitsToFeet(last.hUnits - first.hUnits);

    if (this.options.shape === 'radius') {
      const measurement = measureRulerRadius(
        { x: first.tx, y: first.tz },
        { x: last.tx, y: last.tz },
        elevDeltaFeet,
      );
      const radiusMeters =
        measurement.squares > 0 ? measurement.squares * TILE_SIZE_METERS : TILE_SIZE_METERS * 0.5;
      this.surfaceRenderer.setRulerRadius(first, last, radiusMeters);
      this.label = formatRulerLabel(measurement, this.options.unit);
    } else {
      const measurement = measureRulerPath(
        this.points.map((p) => ({ x: p.tx, y: p.tz })),
        elevDeltaFeet,
      );
      this.surfaceRenderer.setRulerPath(this.points);
      this.label = formatRulerLabel(measurement, this.options.unit);
    }

    this.tick();
  }

  private attachListeners(): void {
    const canvas = this.sceneMgr.app.canvas;
    const { signal } = this.eventAbort;

    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.active || e.button !== 0) return;
        const ray = this.sceneMgr.clientPointToRay(e.clientX, e.clientY);
        const hit = pickTerrain(this.grid, ray);
        if (!hit) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        const pt = endpointFromHit(this.grid, hit);
        if (this.options.shape === 'line' && e.shiftKey && this.points.length >= 2) {
          this.points = [...this.points, pt];
        } else {
          this.points = [pt, pt];
        }
        this.dragging = true;
        this.render();
      },
      { capture: true, signal },
    );

    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.active || !this.dragging || this.points.length < 2) return;
        e.stopImmediatePropagation();
        const ray = this.sceneMgr.clientPointToRay(e.clientX, e.clientY);
        const hit = pickTerrain(this.grid, ray);
        if (!hit) return;
        const last = this.points[this.points.length - 1]!;
        if (hit.tileX === last.tx && hit.tileZ === last.tz) return;
        this.points = [...this.points.slice(0, -1), endpointFromHit(this.grid, hit)];
        this.render();
      },
      { capture: true, signal },
    );

    const endDrag = (): void => {
      this.dragging = false;
    };

    window.addEventListener('pointerup', endDrag, { signal });
    window.addEventListener('pointercancel', endDrag, { signal });
  }
}
