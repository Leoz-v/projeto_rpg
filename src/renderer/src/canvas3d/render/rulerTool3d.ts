import { formatRulerLabel, measureRuler } from '../../canvas/ruler';
import { heightUnitsToFeet, METERS_PER_HEIGHT_UNIT, TILE_SIZE_METERS } from '../terrain/constants';
import { pickTerrain, type TerrainPickHit } from '../terrain/raycast';
import type { TerrainGrid } from '../terrain/terrainGrid';
import type { SceneManager } from './sceneManager';
import type { TerrainRenderer } from './terrainRenderer';

/**
 * Ferramenta local de régua para a visualização 3D da mesa (`Map3DView`).
 * Usa a mesma regra de distância do motor (`rules-engine/space`) via
 * `measureRuler`/`formatRulerLabel`, desenhando a linha 3D no terreno e
 * projetando o rótulo em pés no HUD 2D a cada quadro.
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
  private dragging = false;
  private start: RulerEndpoint3d | null = null;
  private end: RulerEndpoint3d | null = null;
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

  clear(): void {
    this.dragging = false;
    this.start = null;
    this.end = null;
    this.label = '';
    this.surfaceRenderer.setRulerLine(null, null);
    this.sceneMgr.setRulerLabel(null, '');
  }

  /** Mantém o rótulo 2D alinhado ao ponto médio 3D enquanto a câmera orbita ou faz zoom. */
  tick(): void {
    if (!this.start || !this.end || !this.label) return;
    const mid = {
      x: (this.start.x + this.end.x) * 0.5,
      y: Math.max(this.start.y, this.end.y) + 0.75,
      z: (this.start.z + this.end.z) * 0.5,
    };
    this.sceneMgr.setRulerLabel(mid, this.label);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.eventAbort.abort();
    this.clear();
  }

  private updateFromEnd(end: RulerEndpoint3d): void {
    if (!this.start) return;
    this.end = end;
    this.surfaceRenderer.setRulerLine(this.start, end);
    const measurement = measureRuler(
      { x: this.start.tx, y: this.start.tz },
      { x: end.tx, y: end.tz },
      heightUnitsToFeet(end.hUnits - this.start.hUnits),
    );
    this.label = formatRulerLabel(measurement);
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
        this.start = pt;
        this.dragging = true;
        this.updateFromEnd(pt);
      },
      { capture: true, signal },
    );

    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.active || !this.dragging || !this.start) return;
        e.stopImmediatePropagation();
        const ray = this.sceneMgr.clientPointToRay(e.clientX, e.clientY);
        const hit = pickTerrain(this.grid, ray);
        if (!hit) return;
        if (this.end && hit.tileX === this.end.tx && hit.tileZ === this.end.tz) return;
        this.updateFromEnd(endpointFromHit(this.grid, hit));
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
