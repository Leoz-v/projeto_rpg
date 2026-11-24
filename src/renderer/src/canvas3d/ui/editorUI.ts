/**
 * WorldLab-inspired Studio UI for the standalone PixiJS 3D D&D Map Prototype.
 */

import { heightUnitsToFeet } from '../terrain/constants';
import {
  LIQUID_PRESETS,
  findAdjacentNeighbor,
  getLiquidPreset,
  type LiquidEdgeSide,
  type LiquidPresetId,
} from '../terrain/liquidSurface';
import { getMaterial, getOverlayMaterials, getUnderlayMaterials } from '../terrain/materials';
import {
  TILE_AUTO_GENERATED,
  TILE_AUTO_SEED,
  TILE_AUTO_UNDERLAY_OVERRIDE,
  TILE_MANUAL_LOCK,
} from '../terrain/terrainGrid';
import { OVERLAY_SHAPE_NAMES, getShapeById } from '../terrain/tileSurface';
import type { MapLayerId } from '../map/mapDocument';
import { describeSaveTarget } from '../map/mapStorage';
import type { AssetScalePolicy } from '../render/assetManager';
import { isCaveMouthEntry } from '../render/caveSystem';
import {
  LIGHTING_PRESET_LABELS,
  LIGHTING_PRESET_ORDER,
  type LightingPresetId,
} from '../render/lightingSystem';
import { classifyAmbientAnimation } from '../render/objectAnimator';
import type { CameraViewMode } from '../render/sceneManager';
import type { TerrainShadingMode } from '../render/terrainRenderer';
import { isWallDecorEntry, type WallDecorMode } from '../render/wallDecoration';
import { resolveAllAutoSeeds } from '../tools/autoTiler';
import type { TerrainCliffMode } from '../tools/cliffTool';
import {
  SCULPT_PRESETS,
  type SculptBrushShape,
  type SculptFalloff,
  type SculptMaskMode,
  type TerrainBrushMode,
} from '../tools/sculptKernel';
import type {
  ActiveToolId,
  AssetSubMode,
  CliffSubMode,
  HoverTelemetry,
  LiquidSubMode,
  PaintLayer,
  ToolController,
} from '../tools/toolController';
import { MapModalsController } from './mapModals';

const SCULPT_MODES: readonly TerrainBrushMode[] = [
  'RAISE',
  'LOWER',
  'SMOOTH',
  'RELAX',
  'FLATTEN',
  'TERRACE',
  'PLATEAU',
  'RIDGE',
  'VALLEY',
  'NOISE',
  'GRADE',
];

const FALLOFFS: readonly SculptFalloff[] = ['SMOOTH', 'GAUSSIAN', 'LINEAR', 'HARD'];

function hexCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function renderRs2ShapeSvg(shapeId: number, rotation: number, overlayHex: number): string {
  const geom = getShapeById(shapeId, rotation);
  const fillColor = hexCss(overlayHex);
  const polys = geom.triangles
    .map((t) => {
      const a = geom.vertices[t.a]!;
      const b = geom.vertices[t.b]!;
      const c = geom.vertices[t.c]!;
      // SVG Y grows downward, tile v grows northward (+Z); flip v so North is up
      const pts = `${(a.u * 24 + 2).toFixed(1)},${((1 - a.v) * 24 + 2).toFixed(1)} ${(b.u * 24 + 2).toFixed(1)},${((1 - b.v) * 24 + 2).toFixed(1)} ${(c.u * 24 + 2).toFixed(1)},${((1 - c.v) * 24 + 2).toFixed(1)}`;
      return `<polygon points="${pts}" fill="${t.overlay ? fillColor : '#243024'}" stroke="rgba(255,255,255,0.16)" stroke-width="0.6" />`;
    })
    .join('');
  return `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">${polys}</svg>`;
}

function describeAutoMeta(meta: number): string {
  const tags: string[] = [];
  if ((meta & TILE_AUTO_SEED) !== 0) tags.push('Seed');
  if ((meta & TILE_AUTO_GENERATED) !== 0) tags.push('Fringe');
  if ((meta & TILE_MANUAL_LOCK) !== 0) tags.push('Locked');
  if ((meta & TILE_AUTO_UNDERLAY_OVERRIDE) !== 0) tags.push('Substrate');
  return tags.length > 0 ? tags.join('+') : '';
}

export interface VttEditorBridge {
  /** Rótulo do botão principal (ex.: "Salvar na mesa"). */
  saveLabel: string;
  /** Informa se o mapa atual já existe na campanha do VTT. */
  isInCampaign: () => boolean;
  /** Salva o mapa 3D atual na campanha ativa (cria ou atualiza). */
  onSaveToTable: () => Promise<void>;
  /** Fecha o editor e volta para a mesa. */
  onClose: () => void;
}

export class EditorUI {
  private readonly controller: ToolController;
  private readonly topbarEl: HTMLElement;
  private readonly inspectorEl: HTMLElement;
  private readonly statusLeftEl: HTMLElement;
  private readonly statusRightEl: HTMLElement;
  private readonly mapModals: MapModalsController;
  private readonly vttBridge: VttEditorBridge | null = null;
  private vttSaving = false;

  private assetSearch = '';
  private assetPackFilter = 'ALL';
  private assetRoleFilter: 'ALL' | 'WALL' | 'ANIM' = 'ALL';

  constructor(
    rootEl: HTMLElement,
    controller: ToolController
  ) {
    this.controller = controller;

    rootEl.innerHTML = `
      <div class="studio-shell">
        <header class="topbar"></header>
        <aside class="inspector"></aside>
        <main class="viewport" id="viewport-host"></main>
        <footer class="statusbar">
          <div class="status-left"></div>
          <div class="status-right"></div>
        </footer>
      </div>
    `;

    this.topbarEl = rootEl.querySelector('.topbar') as HTMLElement;
    this.inspectorEl = rootEl.querySelector('.inspector') as HTMLElement;
    this.statusLeftEl = rootEl.querySelector('.status-left') as HTMLElement;
    this.statusRightEl = rootEl.querySelector('.status-right') as HTMLElement;
    this.mapModals = new MapModalsController(rootEl, controller, () => { this.render(); });

    this.controller.onStateChange = () => { this.render(); };
    this.controller.onHoverChange = (telemetry) => { this.renderStatus(telemetry); };
    this.controller.onSaveShortcut = () => {
      void this.mapModals.saveCurrentMap();
    };
    this.controller.onSaveAsShortcut = () => { this.mapModals.openSaveAsMap(); };
    this.controller.onLoadShortcut = () => { this.mapModals.openLoadMap(); };

    this.render();
    this.renderStatus({
      hit: null,
      elevationFeet: 0,
      elevationMeters: 0,
      underlayId: 0,
      overlayId: 0,
      overlayShape: 0,
      overlayRotation: 0,
      autoMetadata: 0,
      isHole: false,
      vertexShade: 0,
    });
  }

  static createShell(rootEl: HTMLElement): HTMLElement {
    rootEl.innerHTML = `
      <div class="studio-shell">
        <header class="topbar"></header>
        <aside class="inspector"></aside>
        <main class="viewport" id="viewport-host"></main>
        <footer class="statusbar">
          <div class="status-left"></div>
          <div class="status-right"></div>
        </footer>
      </div>
    `;
    return rootEl.querySelector('#viewport-host') as HTMLElement;
  }

  static mountIntoShell(rootEl: HTMLElement, controller: ToolController, vttBridge?: VttEditorBridge): EditorUI {
    const ui = Object.create(EditorUI.prototype) as EditorUI;
    Object.assign(ui, {
      controller,
      topbarEl: rootEl.querySelector('.topbar') as HTMLElement,
      inspectorEl: rootEl.querySelector('.inspector') as HTMLElement,
      statusLeftEl: rootEl.querySelector('.status-left') as HTMLElement,
      statusRightEl: rootEl.querySelector('.status-right') as HTMLElement,
      mapModals: new MapModalsController(rootEl, controller, () => { ui.render(); }),
      vttBridge: vttBridge ?? null,
      vttSaving: false,
      assetSearch: '',
      assetPackFilter: 'ALL',
      assetRoleFilter: 'ALL',
    });
    controller.onStateChange = () => { ui.render(); };
    controller.onHoverChange = (telemetry) => { ui.renderStatus(telemetry); };
    controller.onSaveShortcut = () => {
      if (vttBridge) {
        void ui.triggerVttSave();
      } else {
        void ui.mapModals.saveCurrentMap();
      }
    };
    controller.onSaveAsShortcut = () => { ui.mapModals.openSaveAsMap(); };
    controller.onLoadShortcut = () => { ui.mapModals.openLoadMap(); };
    ui.render();
    ui.renderStatus({
      hit: null,
      elevationFeet: 0,
      elevationMeters: 0,
      underlayId: 0,
      overlayId: 0,
      overlayShape: 0,
      overlayRotation: 0,
      autoMetadata: 0,
      isHole: false,
      vertexShade: 0,
    });
    return ui;
  }

  private async triggerVttSave(): Promise<void> {
    if (!this.vttBridge || this.vttSaving) return;
    this.vttSaving = true;
    this.render();
    try {
      await this.vttBridge.onSaveToTable();
    } finally {
      this.vttSaving = false;
      this.render();
    }
  }

  destroy(): void {
    this.controller.onStateChange = undefined;
    this.controller.onHoverChange = undefined;
    this.controller.onSaveShortcut = undefined;
    this.controller.onSaveAsShortcut = undefined;
    this.controller.onLoadShortcut = undefined;
  }

  render(): void {
    this.renderTopbar();
    this.renderInspector();
    this.renderRightStatus();
  }

  private renderTopbar(): void {
    const c = this.controller;
    const tools: readonly { id: ActiveToolId; label: string; key: string }[] = [
      { id: 'SCULPT', label: 'Sculpt', key: '1' },
      { id: 'PAINT', label: 'Paint', key: '2' },
      { id: 'CLIFF', label: 'Cliffs', key: '3' },
      { id: 'LIQUID', label: 'Liquid', key: '4' },
      { id: 'ASSET', label: 'Assets', key: '5' },
      { id: 'LIGHT', label: 'Light', key: '6' },
      { id: 'MEASURE', label: 'Ruler 5ft', key: '7' },
      { id: 'ORBIT', label: 'Orbit', key: '8' },
    ];

    const cliffHintBySub: Record<CliffSubMode, string> = {
      cliff: 'LMB paint faceted rock cliff faces · [ / ] radius · L switch Surface/Interior',
      hole: 'LMB punch opening (reveals Interior layer below) · Shift+LMB fill restore · [ / ] radius',
      shadow: 'LMB darken cave threshold / cliff shadow (AO) · Shift+LMB lighten · [ / ] radius',
    };

    const liquidHint =
      c.liquidTool.pickingTerrainLevel
        ? 'Click any spot on the terrain to copy its exact elevation to the liquid level'
        : c.liquidTool.subMode === 'draw'
          ? 'Drag to draw flat liquid (snaps flush to existing liquid edges & inherits level) · [ / ] level'
          : 'Click select · Drag body to move · Drag edge ◇ to resize · Shift+Drag edge to continue · [ / ] level · Alt+Click delete';

    const toolHints: Record<ActiveToolId, string> = {
      SCULPT: 'LMB sculpt · Shift invert · [ / ] radius · L switch layer · Ctrl+Z undo',
      PAINT: 'LMB paint · R rotate manual shape · [ / ] radius · L switch layer',
      CLIFF: cliffHintBySub[c.cliffSubMode],
      LIQUID: liquidHint,
      ASSET: 'LMB place/select · R rotate · [ / ] scale · Alt+Click delete · L switch layer',
      LIGHT: 'Adjust sun, mood presets & torch/brazier/lava light sources · LMB orbit',
      MEASURE: 'Drag on terrain to measure 5ft D&D distance & Δh',
      ORBIT: 'LMB/RMB orbit · WASD/MMB pan · Wheel zoom · L switch Surface/Interior',
    };

    const shading: TerrainShadingMode = c.renderer.currentShadingMode;
    const camMode: CameraViewMode = c.scene.viewMode;
    const lightPresetLabel = LIGHTING_PRESET_LABELS[c.lighting.settings.preset];
    const safeMapName = c.mapName.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const saveTargetLabel = describeSaveTarget(c.saveTarget).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const saveBtnTitle = c.saveTarget
      ? `Save directly to ${saveTargetLabel} (Ctrl+S)`
      : 'Save map to maps/ or file (Ctrl+S)';

    this.topbarEl.innerHTML = `
      <div class="topbar-row topbar-row-primary">
        <div class="topbar-cluster">
          <div class="brand">
            <span>WorldLab 3D</span>
            <span class="brand-pill">5ft / 1.5m</span>
          </div>
          <span class="topbar-divider"></span>
          <span class="topbar-kicker">Map</span>
          <button class="map-name-pill" data-action="save-as-map" title="${safeMapName} (${c.grid.width}×${c.grid.length} tiles · ${saveTargetLabel}) — Click to Save As / Rename">
            <span class="map-name-pill-title">${safeMapName}</span>${c.isDirty ? '<span class="dirty-dot">●</span>' : ''}
            <span class="map-name-pill-size">${c.grid.width}×${c.grid.length}</span>
          </button>
          <div class="toolbar-group" data-group="map">
            ${
              this.vttBridge
                ? `<button class="btn small" data-action="new-map" title="Criar novo canvas 3D (Flat, Rolling Hills ou Dungeon)">Novo</button>
                   <button class="btn small" data-action="load-map" title="Importar arquivo .vttmap.json para o editor (Ctrl+O)">Importar…</button>
                   <button class="btn small" data-action="save-as-map" title="Exportar arquivo .vttmap.json no disco (Ctrl+Shift+S)">Exportar…</button>
                   <span class="topbar-divider"></span>
                   <button class="btn small vtt-campaign-btn" data-action="vtt-save" ${this.vttSaving ? 'disabled' : ''} title="Salvar mapa 3D na lista de mapas da mesa (Ctrl+S)">${this.vttSaving ? 'Salvando…' : this.vttBridge.saveLabel}</button>
                   <button class="btn small vtt-close-btn" data-action="vtt-close" title="Fechar o editor 3D e voltar para a mesa">Voltar</button>`
                : `<button class="btn small" data-action="new-map" title="Create a new map with custom size & template">New</button>
                   <button class="btn small ${c.isDirty ? 'primary' : ''}" data-action="save-map" title="${saveBtnTitle}">Save</button>
                   <button class="btn small" data-action="save-as-map" title="Save as a new name or .vttmap.json file (Ctrl+Shift+S)">Save As</button>
                   <button class="btn small" data-action="load-map" title="Load a saved map or open .vttmap.json (Ctrl+O)">Load</button>`
            }
          </div>
        </div>

        <div class="topbar-cluster">
          <span class="topbar-kicker">Layer (L)</span>
          <div class="segmented" data-group="layer">
            <button class="btn ${c.activeLayer === 'surface' ? 'active' : ''}" data-maplayer="surface" title="Intact Surface terrain (acts naturally as the cave roof)">Surface</button>
            <button class="btn ${c.activeLayer === 'interior' ? 'active' : ''}" data-maplayer="interior" title="Subterranean Interior layer (-${c.interiorDepthFeet} ft below Surface)">Interior</button>
          </div>
          ${
            c.activeLayer === 'interior'
              ? `<button class="btn small ${c.showSurfaceGhost ? 'active' : ''}" data-action="toggle-ghost-surface" title="Show intact Surface floor faintly overhead to align cave entrances & rooms">Ghost Roof</button>`
              : ''
          }
          <span class="topbar-divider"></span>
          <span class="topbar-kicker">View</span>
          <div class="segmented" data-group="camera">
            <button class="btn ${camMode === 'perspective' ? 'active' : ''}" data-cam="perspective" title="3D Perspective View">Persp</button>
            <button class="btn ${camMode === 'orthographic' ? 'active' : ''}" data-cam="orthographic" title="3D Isometric Orthographic View">Ortho</button>
            <button class="btn ${camMode === 'top_down' ? 'active' : ''}" data-cam="top_down" title="Top-Down 2D Tactical Battlemap View">Top</button>
          </div>
          <button class="btn small" data-action="reset-cam" title="Reset Camera Framing">Reset</button>
          <span class="topbar-divider"></span>
          <div class="toolbar-group" data-group="view">
            <button class="btn small ${c.renderer.gridVisible ? 'active' : ''}" data-action="toggle-grid" title="Toggle 5ft Tactical Grid">Grid</button>
            <button class="btn small ${c.assets.animationsActive ? 'active' : ''}" data-action="toggle-anim" title="Toggle glTF & ambient object animations (torches, braziers, banners)">Anim</button>
            <button class="btn small" data-action="cycle-light" title="Cycle lighting preset: Daylight / Golden Hour / Twilight / Night / Dungeon (open 5. Light for full controls)">☀ ${lightPresetLabel}</button>
            <button class="btn small" data-action="toggle-shading" title="Cycle terrain shading: Flat + Lit / Flat RS2 / Gouraud RS2">${
              shading === 'pbr_shadows'
                ? 'Flat + Lit'
                : shading === 'worldlab_flat'
                  ? 'Flat RS2'
                  : 'Gouraud RS2'
            }</button>
          </div>
        </div>
      </div>

      <div class="topbar-row topbar-row-tools">
        <div class="topbar-cluster">
          <span class="topbar-kicker">Tools</span>
          <div class="segmented" data-group="tools">
            ${tools
              .map(
                (t) =>
                  `<button class="btn ${c.activeTool === t.id ? 'active' : ''}" data-tool="${t.id}"><span class="btn-hotkey">${t.key}</span>${t.label}</button>`
              )
              .join('')}
          </div>
          <span class="topbar-divider"></span>
          <div class="toolbar-group" data-group="history">
            <button class="btn small" data-action="undo" ${c.history.canUndo ? '' : 'disabled'} title="Undo (Ctrl+Z)">↶ Undo (${c.history.undoCount})</button>
            <button class="btn small" data-action="redo" ${c.history.canRedo ? '' : 'disabled'} title="Redo (Ctrl+Y)">↷ Redo (${c.history.redoCount})</button>
          </div>
        </div>

        <div class="topbar-cluster">
          <span class="tool-hint-inline">${toolHints[c.activeTool]}</span>
        </div>
      </div>
    `;

    this.topbarEl.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.onclick = () => { c.setActiveTool(btn.dataset.tool as ActiveToolId); };
    });
    this.topbarEl.querySelectorAll<HTMLButtonElement>('[data-maplayer]').forEach((btn) => {
      btn.onclick = () => { c.setActiveLayer(btn.dataset.maplayer as MapLayerId); };
    });
    this.topbarEl.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((btn) => {
      btn.onclick = () => {
        c.scene.setCameraViewMode(btn.dataset.cam as CameraViewMode);
        this.render();
      };
    });

    const bind = (action: string, fn: () => void): void => {
      this.topbarEl.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`).forEach((el) => {
        el.onclick = fn;
      });
    };

    bind('undo', () => { c.undo(); });
    bind('redo', () => { c.redo(); });
    bind('toggle-grid', () => {
      c.setGridVisible(!c.renderer.gridVisible);
    });
    bind('toggle-ghost-surface', () => {
      c.setShowSurfaceGhost(!c.showSurfaceGhost);
    });
    bind('toggle-anim', () => {
      c.assets.setAnimationsEnabled(!c.assets.animationsActive);
      this.render();
    });
    bind('cycle-light', () => {
      const cur = c.lighting.settings.preset;
      const idx = cur === 'custom' ? -1 : LIGHTING_PRESET_ORDER.indexOf(cur);
      const next = LIGHTING_PRESET_ORDER[(idx + 1) % LIGHTING_PRESET_ORDER.length]!;
      c.lighting.applyPreset(next);
      c.isDirty = true;
      this.render();
    });
    bind('toggle-shading', () => {
      const next: TerrainShadingMode =
        shading === 'pbr_shadows'
          ? 'worldlab_flat'
          : shading === 'worldlab_flat'
            ? 'rs2_gouraud'
            : 'pbr_shadows';
      c.setShadingMode(next);
    });
    bind('reset-cam', () => { c.scene.resetCameraToMap(c.grid.width, c.grid.length); });
    bind('vtt-save', () => {
      void this.triggerVttSave();
    });
    bind('vtt-close', () => {
      const needsConfirm = this.controller.isDirty || (this.vttBridge !== null && !this.vttBridge.isInCampaign());
      if (needsConfirm && !window.confirm('Este mapa 3D ainda não foi salvo na mesa. Voltar mesmo assim?')) {
        return;
      }
      this.vttBridge?.onClose();
    });
    bind('new-map', () => { this.mapModals.openNewMap(); });
    bind('save-map', () => {
      void this.mapModals.saveCurrentMap();
    });
    bind('save-as-map', () => { this.mapModals.openSaveAsMap(); });
    bind('load-map', () => { this.mapModals.openLoadMap(); });
  }

  private renderInspector(): void {
    const tool = this.controller.activeTool;
    if (tool === 'SCULPT') {
      this.renderSculptInspector();
    } else if (tool === 'PAINT') {
      this.renderPaintInspector();
    } else if (tool === 'CLIFF') {
      this.renderCliffInspector();
    } else if (tool === 'LIQUID') {
      this.renderLiquidInspector();
    } else if (tool === 'ASSET') {
      this.renderAssetInspector();
    } else if (tool === 'LIGHT') {
      this.renderLightingInspector();
    } else if (tool === 'MEASURE') {
      this.inspectorEl.innerHTML = `
        <div class="section">
          <div class="section-title">D&D 5ft / 1.5m Ruler</div>
          <div class="hint-box">
            Click and drag anywhere on the terrain to measure D&D tactical grid distance
            (<strong>5 ft / 1.5 m</strong> per tile) and elevation change (<strong>Δh</strong> in feet).
          </div>
        </div>
      `;
    } else {
      this.inspectorEl.innerHTML = `
        <div class="section">
          <div class="section-title">Camera Orbit Mode</div>
          <div class="hint-box">
            <strong>Left-Drag / Right-Drag:</strong> Orbit camera<br/>
            <strong>Middle-Drag / WASD / Arrows:</strong> Pan across map<br/>
            <strong>Mouse Wheel:</strong> Zoom in/out<br/><br/>
            Tip: Right-drag orbits and WASD pans even while Sculpt/Paint tools are active!
          </div>
        </div>
      `;
    }
  }

  private renderSculptInspector(): void {
    const s = this.controller.sculpt;
    const underlays = getUnderlayMaterials();
    const overlays = getOverlayMaterials();
    const terraceFt = heightUnitsToFeet(s.terraceStep).toFixed(1);
    const featureFt = heightUnitsToFeet(s.featureHeight).toFixed(1);
    const slopeFt = heightUnitsToFeet(s.maxSlope).toFixed(1);

    this.inspectorEl.innerHTML = `
      <div class="section">
        <div class="section-title">WorldLab Presets</div>
        <div class="grid-2">
          ${SCULPT_PRESETS.map(
            (p) => `<button class="btn small" data-preset="${p.id}" title="${p.description}">${p.label}</button>`
          ).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Sculpt Mode</div>
        <div class="grid-3">
          ${SCULPT_MODES.map(
            (m) => `<button class="btn small ${s.mode === m ? 'active' : ''}" data-mode="${m}">${m}</button>`
          ).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Brush Profile</div>
        <div class="grid-2">
          <button class="btn small ${s.shape === 'CIRCLE' ? 'active' : ''}" data-shape="CIRCLE">Circle</button>
          <button class="btn small ${s.shape === 'SQUARE' ? 'active' : ''}" data-shape="SQUARE">Square</button>
        </div>
        <div class="grid-2">
          ${FALLOFFS.map(
            (f) => `<button class="btn small ${s.falloff === f ? 'active' : ''}" data-falloff="${f}">${f}</button>`
          ).join('')}
        </div>

        <div class="field">
          <div class="field-row"><span>Radius ([ / ])</span><strong>${s.radius} tiles (${s.radius * 5} ft)</strong></div>
          <input type="range" id="sc-radius" min="0" max="10" step="1" value="${s.radius}" />
        </div>

        <div class="field">
          <div class="field-row"><span>Strength</span><strong>${Math.round(s.strength * 100)}%</strong></div>
          <input type="range" id="sc-strength" min="0.1" max="1.5" step="0.05" value="${s.strength}" />
        </div>

        ${
          s.mode === 'TERRACE'
            ? `
          <div class="field">
            <div class="field-row"><span>Terrace Step</span><strong>${terraceFt} ft (${s.terraceStep} u)</strong></div>
            <input type="range" id="sc-terrace-step" min="32" max="256" step="16" value="${s.terraceStep}" />
          </div>
          <div class="field">
            <div class="field-row"><span>Transition Blend</span><strong>${s.terraceTransitionPercent}%</strong></div>
            <input type="range" id="sc-terrace-trans" min="0" max="100" step="5" value="${s.terraceTransitionPercent}" />
          </div>`
            : ''
        }

        ${
          s.mode === 'PLATEAU'
            ? `
          <div class="field">
            <div class="field-row"><span>Inner Flat Width</span><strong>${s.plateauInnerPercent}%</strong></div>
            <input type="range" id="sc-plateau" min="0" max="100" step="5" value="${s.plateauInnerPercent}" />
          </div>`
            : ''
        }

        ${
          s.mode === 'RIDGE' || s.mode === 'VALLEY'
            ? `
          <div class="field">
            <div class="field-row"><span>Feature Height</span><strong>${featureFt} ft</strong></div>
            <input type="range" id="sc-feature-h" min="32" max="384" step="16" value="${s.featureHeight}" />
          </div>
          <div class="field">
            <div class="field-row"><span>Crest Width</span><strong>${s.ridgeCrestPercent}%</strong></div>
            <input type="range" id="sc-crest" min="0" max="80" step="5" value="${s.ridgeCrestPercent}" />
          </div>`
            : ''
        }

        ${
          s.mode === 'NOISE'
            ? `
          <div class="field">
            <div class="field-row"><span>Noise Amplitude</span><strong>${heightUnitsToFeet(s.noiseAmplitude).toFixed(1)} ft</strong></div>
            <input type="range" id="sc-noise-amp" min="16" max="256" step="8" value="${s.noiseAmplitude}" />
          </div>`
            : ''
        }
      </div>

      <div class="section">
        <div class="section-title">Constraints & Editable Mask</div>
        <div class="field">
          <div class="field-row"><span>Max Slope Limit</span><strong>${s.maxSlope === 0 ? 'Off' : `${slopeFt} ft/tile`}</strong></div>
          <input type="range" id="sc-max-slope" min="0" max="256" step="16" value="${s.maxSlope}" />
        </div>
        <div class="field">
          <div class="field-row"><span>Editable Mask</span></div>
          <select id="sc-mask-mode">
            <option value="ALL" ${s.maskMode === 'ALL' ? 'selected' : ''}>All Vertices</option>
            <option value="HEIGHT" ${s.maskMode === 'HEIGHT' ? 'selected' : ''}>Height Band</option>
            <option value="UNDERLAY" ${s.maskMode === 'UNDERLAY' ? 'selected' : ''}>Match Underlay</option>
            <option value="OVERLAY" ${s.maskMode === 'OVERLAY' ? 'selected' : ''}>Match Overlay</option>
          </select>
        </div>
        ${
          s.maskMode === 'UNDERLAY' || s.maskMode === 'OVERLAY'
            ? `<select id="sc-mask-mat">
                ${(s.maskMode === 'UNDERLAY' ? underlays : overlays)
                  .map((m) => `<option value="${m.id}" ${s.maskMaterialId === m.id ? 'selected' : ''}>${m.name}</option>`)
                  .join('')}
              </select>`
            : ''
        }
        <div class="hint-box">
          Hold <strong>Shift</strong> while using Raise/Lower to invert direction.
          In <strong>Grade</strong> mode, drag from start vertex to end vertex to ramp smoothly.
        </div>
      </div>
    `;

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.onclick = () => {
        const preset = SCULPT_PRESETS.find((p) => p.id === btn.dataset.preset);
        if (preset) {
          Object.assign(s, preset.patch);
          this.render();
        }
      };
    });
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      btn.onclick = () => {
        s.mode = btn.dataset.mode as TerrainBrushMode;
        this.render();
      };
    });
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach((btn) => {
      btn.onclick = () => {
        s.shape = btn.dataset.shape as SculptBrushShape;
        this.render();
      };
    });
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-falloff]').forEach((btn) => {
      btn.onclick = () => {
        s.falloff = btn.dataset.falloff as SculptFalloff;
        this.render();
      };
    });

    const bindRange = (id: string, onVal: (n: number) => void): void => {
      const el = this.inspectorEl.querySelector<HTMLInputElement>(`#${id}`);
      if (!el) return;
      el.oninput = () => {
        onVal(Number(el.value));
        this.renderInspector();
      };
    };

    bindRange('sc-radius', (n) => (s.radius = n));
    bindRange('sc-strength', (n) => (s.strength = n));
    bindRange('sc-terrace-step', (n) => (s.terraceStep = n));
    bindRange('sc-terrace-trans', (n) => (s.terraceTransitionPercent = n));
    bindRange('sc-plateau', (n) => (s.plateauInnerPercent = n));
    bindRange('sc-feature-h', (n) => (s.featureHeight = n));
    bindRange('sc-crest', (n) => (s.ridgeCrestPercent = n));
    bindRange('sc-noise-amp', (n) => (s.noiseAmplitude = n));
    bindRange('sc-max-slope', (n) => (s.maxSlope = n));

    const maskSel = this.inspectorEl.querySelector<HTMLSelectElement>('#sc-mask-mode');
    if (maskSel) {
      maskSel.onchange = () => {
        s.maskMode = maskSel.value as SculptMaskMode;
        this.renderInspector();
      };
    }
    const matSel = this.inspectorEl.querySelector<HTMLSelectElement>('#sc-mask-mat');
    if (matSel) {
      matSel.onchange = () => {
        s.maskMaterialId = Number(matSel.value);
      };
    }
  }

  private renderPaintInspector(): void {
    const p = this.controller.paint;
    const mats = p.layer === 'UNDERLAY' ? getUnderlayMaterials() : getOverlayMaterials();
    const activeMatId = p.layer === 'UNDERLAY' ? p.underlayId : p.overlayId;

    this.inspectorEl.innerHTML = `
      <div class="section">
        <div class="section-title">Paint Layer</div>
        <div class="grid-3">
          <button class="btn small ${p.layer === 'UNDERLAY' ? 'active' : ''}" data-layer="UNDERLAY">Underlay</button>
          <button class="btn small ${p.layer === 'OVERLAY' ? 'active' : ''}" data-layer="OVERLAY">Overlay</button>
          <button class="btn small ${p.layer === 'ERASE_OVERLAY' ? 'active' : ''}" data-layer="ERASE_OVERLAY">Erase</button>
        </div>
        <div class="grid-2">
          <button class="btn small ${p.brushShape === 'CIRCLE' ? 'active' : ''}" data-bshape="CIRCLE">Circle</button>
          <button class="btn small ${p.brushShape === 'SQUARE' ? 'active' : ''}" data-bshape="SQUARE">Square</button>
        </div>
        <div class="field">
          <div class="field-row"><span>Brush Radius</span><strong>${p.radius} (${p.radius === 0 ? '1 tile' : `${(p.radius * 2 + 1) * 5} ft`})</strong></div>
          <input type="range" id="pt-radius" min="0" max="6" step="1" value="${p.radius}" />
        </div>
      </div>

      ${
        p.layer === 'OVERLAY' || p.layer === 'ERASE_OVERLAY'
          ? `
        <div class="section">
          <div class="section-title">
            <span>RS2 Auto-Tiler & Shapes</span>
            <span>${p.autoTile ? 'Auto' : 'Manual Lock'}</span>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="pt-autotile" ${p.autoTile ? 'checked' : ''} />
            <span>WorldLab Spatial Auto-Tiler (37-probe + edge harmonizer)</span>
          </label>
          ${
            p.autoTile
              ? `
            <div class="hint-box">
              <strong>Lost-City RS2 Auto-Tiler:</strong> uses smooth vertex contours to generate Full, Diagonal, Half, Corner, Semi-Diagonal (2:1/1:2 slopes), and Fan curves with zero sawtooth Trapezoids or flipped corners. Uncheck for <strong>Manual Lock</strong> to hand-place all 12 RS2 shapes.
            </div>
            <button class="btn small" id="pt-resolve-all">Re-solve All Auto Shapes</button>`
              : p.layer === 'OVERLAY'
                ? `
            <div class="field-row">
              <span>${OVERLAY_SHAPE_NAMES[p.overlayShape] ?? 'Full'}</span>
              <button class="btn small" id="pt-rot-btn">Rot ${p.overlayRotation * 90}° (R)</button>
            </div>
            <div class="shape-grid">
              ${OVERLAY_SHAPE_NAMES.slice(1)
                .map((name, idx) => {
                  const sid = idx + 1;
                  const shortLabel = name
                    .replace('Left Semi-Diag ', 'L-')
                    .replace('Right Semi-Diag ', 'R-')
                    .replace('Corner ', 'Crn ')
                    .replace('Trapezoid', 'Trap');
                  return `<button class="shape-tile-btn ${p.overlayShape === sid ? 'active' : ''}" data-shape-id="${sid}" title="${name}">
                    ${renderRs2ShapeSvg(sid, p.overlayRotation, getMaterial(p.overlayId).hex)}
                    <span>${shortLabel}</span>
                  </button>`;
                })
                .join('')}
            </div>`
                : `<div class="hint-box">Manual erase removes overlay & clears manual locks directly.</div>`
          }
        </div>`
          : ''
      }

      ${
        p.layer !== 'ERASE_OVERLAY'
          ? `
        <div class="section">
          <div class="section-title">
            <span>${p.layer === 'UNDERLAY' ? 'RS2 Blended Underlays' : 'Shaped Overlays'}</span>
            <span>${mats.length}</span>
          </div>
          <div class="swatch-grid">
            ${mats
              .map(
                (m) => `
              <button class="swatch-btn ${activeMatId === m.id ? 'active' : ''}" data-mat="${m.id}" title="${m.name} (${m.key})">
                <span class="swatch-dot" style="background:${hexCss(m.hex)}"></span>
                <span class="swatch-label">${m.name}</span>
              </button>`
              )
              .join('')}
          </div>
        </div>`
          : ''
      }
    `;

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((btn) => {
      btn.onclick = () => {
        p.layer = btn.dataset.layer as PaintLayer;
        this.renderInspector();
      };
    });
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-bshape]').forEach((btn) => {
      btn.onclick = () => {
        p.brushShape = btn.dataset.bshape as 'CIRCLE' | 'SQUARE';
        this.renderInspector();
      };
    });
    const rInput = this.inspectorEl.querySelector<HTMLInputElement>('#pt-radius');
    if (rInput) {
      rInput.oninput = () => {
        p.radius = Number(rInput.value);
        this.renderInspector();
      };
    }
    const autoCb = this.inspectorEl.querySelector<HTMLInputElement>('#pt-autotile');
    if (autoCb) {
      autoCb.onchange = () => {
        p.autoTile = autoCb.checked;
        this.renderInspector();
      };
    }
    const resolveAllBtn = this.inspectorEl.querySelector<HTMLButtonElement>('#pt-resolve-all');
    if (resolveAllBtn) {
      resolveAllBtn.onclick = () => {
        resolveAllAutoSeeds(this.controller.grid);
        this.controller.renderer.syncDirtyChunks();
        this.render();
      };
    }
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-shape-id]').forEach((btn) => {
      btn.onclick = () => {
        p.overlayShape = Number(btn.dataset.shapeId);
        this.renderInspector();
      };
    });
    const rotBtn = this.inspectorEl.querySelector<HTMLButtonElement>('#pt-rot-btn');
    if (rotBtn) {
      rotBtn.onclick = () => {
        p.overlayRotation = (p.overlayRotation + 1) & 3;
        this.renderInspector();
      };
    }
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-mat]').forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.dataset.mat);
        if (p.layer === 'UNDERLAY') p.underlayId = id;
        else p.overlayId = id;
        this.controller.syncHoleMarkersVisibility();
        this.renderInspector();
      };
    });
  }

  private renderCliffInspector(): void {
    const c = this.controller;
    const sub = c.cliffSubMode;
    const cl = c.cliff;
    const hb = c.holeBrush;
    const sb = c.shadowBrush;
    const cliffMats = [120, 110, 109, 111, 104].map((id) => getMaterial(id));
    const holeCount = c.grid.countHoles();

    this.inspectorEl.innerHTML = `
      <div class="section">
        <div class="section-title">
          <span>Cliffs &amp; Openings</span>
          <span>${sub === 'cliff' ? 'Rock Faces' : sub === 'hole' ? `${holeCount} holes` : 'Vertex AO'}</span>
        </div>
        <div class="grid-3">
          <button class="btn small ${sub === 'cliff' ? 'active' : ''}" data-csub="cliff" title="Paint faceted cliff rock faces on hillsides">Cliff</button>
          <button class="btn small ${sub === 'hole' ? 'active' : ''}" data-csub="hole" title="Punch or fill terrain cutout holes (reveals Interior layer below)">Hole</button>
          <button class="btn small ${sub === 'shadow' ? 'active' : ''}" data-csub="shadow" title="Paint dark ambient shadow into cave mouths & cliff bases">Shadow</button>
        </div>
      </div>

      ${
        sub === 'cliff'
          ? `
        <div class="section">
          <div class="section-title">Cliff Face Brush</div>
          <div class="grid-3">
            ${(['DETECT', 'FORCE', 'ERASE'] as TerrainCliffMode[])
              .map((m) => `<button class="btn small ${cl.mode === m ? 'active' : ''}" data-cmode="${m}">${m}</button>`)
              .join('')}
          </div>
          <div class="field">
            <div class="field-row"><span>Brush Radius ([ / ])</span><strong>${cl.radius} tiles</strong></div>
            <input type="range" id="cl-radius" min="0" max="8" step="1" value="${cl.radius}" />
          </div>
          <div class="field">
            <div class="field-row"><span>Detect Slope Threshold</span><strong>${heightUnitsToFeet(cl.slopeThreshold).toFixed(1)} ft/tile</strong></div>
            <input type="range" id="cl-thresh" min="24" max="160" step="8" value="${cl.slopeThreshold}" />
          </div>
          <div class="swatch-grid">
            ${cliffMats
              .map(
                (m) => `
              <button class="swatch-btn ${cl.materialId === m.id ? 'active' : ''}" data-cmat="${m.id}">
                <span class="swatch-dot" style="background:${hexCss(m.hex)}"></span>
                <span class="swatch-label">${m.name}</span>
              </button>`
              )
              .join('')}
          </div>
          <div class="hint-box">
            <strong>Detect</strong> applies faceted rock only on steep slopes. Use <strong>Cave Cliff Rock</strong> to match Greyvein stone seamlessly.
          </div>
        </div>`
          : sub === 'hole'
            ? `
        <div class="section">
          <div class="section-title">
            <span>Terrain Cutout (Hole) Brush</span>
            <span>${holeCount} holes</span>
          </div>
          <div class="grid-2">
            <button class="btn small ${hb.action === 'CUTOUT' ? 'active' : ''}" data-hact="CUTOUT">Punch Hole</button>
            <button class="btn small ${hb.action === 'RESTORE' ? 'active' : ''}" data-hact="RESTORE">Fill Restore</button>
          </div>
          <div class="grid-2">
            <button class="btn small ${hb.shape === 'CIRCLE' ? 'active' : ''}" data-hshape="CIRCLE">Circle</button>
            <button class="btn small ${hb.shape === 'SQUARE' ? 'active' : ''}" data-hshape="SQUARE">Square</button>
          </div>
          <div class="field">
            <div class="field-row"><span>Brush Radius ([ / ])</span><strong>${hb.radius} (${hb.radius === 0 ? '1 tile' : `${(hb.radius * 2 + 1) * 5} ft`})</strong></div>
            <input type="range" id="hl-radius" min="0" max="6" step="1" value="${hb.radius}" />
          </div>
          <button class="btn small" id="hl-restore-all" ${holeCount === 0 ? 'disabled' : ''}>Restore All Holes (${holeCount})</button>
          <div class="hint-box">
            Punch a 1–2 tile entrance opening on <strong>Surface</strong> without changing your hill's shape — the <strong>Interior</strong> layer sits directly below (press <strong>L</strong> to switch layers). Hold <strong>Shift</strong> to fill restore.
          </div>
        </div>`
            : `
        <div class="section">
          <div class="section-title">
            <span>Vertex Shadow / AO Brush</span>
            <span>${sb.action === 'DARKEN' ? 'Darken' : 'Erase'}</span>
          </div>
          <div class="grid-2">
            <button class="btn small ${sb.action === 'DARKEN' ? 'active' : ''}" data-sact="DARKEN">Darken (AO)</button>
            <button class="btn small ${sb.action === 'LIGHTEN' ? 'active' : ''}" data-sact="LIGHTEN">Lighten / Erase</button>
          </div>
          <div class="grid-2">
            <button class="btn small ${sb.shape === 'CIRCLE' ? 'active' : ''}" data-sshape="CIRCLE">Circle</button>
            <button class="btn small ${sb.shape === 'SQUARE' ? 'active' : ''}" data-sshape="SQUARE">Square</button>
          </div>
          <div class="field">
            <div class="field-row"><span>Brush Radius ([ / ])</span><strong>${sb.radius} tiles</strong></div>
            <input type="range" id="sh-radius" min="0" max="8" step="1" value="${sb.radius}" />
          </div>
          <div class="field">
            <div class="field-row"><span>Strength</span><strong>${Math.round(sb.strength * 100)}%</strong></div>
            <input type="range" id="sh-str" min="0.1" max="1.0" step="0.05" value="${sb.strength}" />
          </div>
          <div class="field">
            <div class="field-row"><span>Max Darkness</span><strong>${Math.round(sb.maxDarkness * 100)}%</strong></div>
            <input type="range" id="sh-max" min="0.2" max="1.0" step="0.05" value="${sb.maxDarkness}" />
          </div>
          <button class="btn small" id="sh-clear-all">Clear All Painted Shadow</button>
          <div class="hint-box">
            Brush soft recessed shadow onto cave mouths, cliff bases, and under overhangs. Hold <strong>Shift</strong> to lighten.
          </div>
        </div>`
      }

      <div class="section">
        <div class="section-title">
          <span>Interior Layer</span>
          <span>${c.activeLayer === 'interior' ? 'Active' : `-${c.interiorDepthFeet} ft`}</span>
        </div>
        <div class="grid-2">
          <button class="btn small ${c.activeLayer === 'surface' ? 'active' : ''}" data-clayer="surface">Surface Floor</button>
          <button class="btn small ${c.activeLayer === 'interior' ? 'active' : ''}" data-clayer="interior">Interior Cave</button>
        </div>
        <div class="field">
          <div class="field-row"><span>Interior Depth Below Surface</span><strong>-${c.interiorDepthFeet} ft</strong></div>
          <input type="range" id="cl-int-depth" min="6" max="30" step="2" value="${c.interiorDepthFeet}" />
        </div>
        <div class="hint-box">
          Your <strong>Surface</strong> terrain keeps its exact shape and acts naturally as the cave roof. Switch to <strong>Interior</strong> (<strong>L</strong>) to sculpt, paint, and furnish caves underneath.
        </div>
      </div>
    `;

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-csub]').forEach((btn) => {
      btn.onclick = () => { c.setCliffSubMode(btn.dataset.csub as CliffSubMode); };
    });
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-clayer]').forEach((btn) => {
      btn.onclick = () => { c.setActiveLayer(btn.dataset.clayer as MapLayerId); };
    });
    const depthEl = this.inspectorEl.querySelector<HTMLInputElement>('#cl-int-depth');
    if (depthEl) {
      depthEl.oninput = () => { c.setInteriorDepthFeet(Number(depthEl.value)); };
    }

    // Cliff Brush bindings
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-cmode]').forEach((btn) => {
      btn.onclick = () => {
        cl.mode = btn.dataset.cmode as TerrainCliffMode;
        this.renderInspector();
      };
    });
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-cmat]').forEach((btn) => {
      btn.onclick = () => {
        cl.materialId = Number(btn.dataset.cmat);
        this.renderInspector();
      };
    });
    const rEl = this.inspectorEl.querySelector<HTMLInputElement>('#cl-radius');
    if (rEl) {
      rEl.oninput = () => {
        cl.radius = Number(rEl.value);
        this.renderInspector();
      };
    }
    const tEl = this.inspectorEl.querySelector<HTMLInputElement>('#cl-thresh');
    if (tEl) {
      tEl.oninput = () => {
        cl.slopeThreshold = Number(tEl.value);
        this.renderInspector();
      };
    }

    // Hole Brush bindings
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-hact]').forEach((btn) => {
      btn.onclick = () => {
        hb.action = btn.dataset.hact as 'CUTOUT' | 'RESTORE';
        this.renderInspector();
      };
    });
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-hshape]').forEach((btn) => {
      btn.onclick = () => {
        hb.shape = btn.dataset.hshape as 'CIRCLE' | 'SQUARE';
        this.renderInspector();
      };
    });
    const hlRad = this.inspectorEl.querySelector<HTMLInputElement>('#hl-radius');
    if (hlRad) {
      hlRad.oninput = () => {
        hb.radius = Number(hlRad.value);
        this.renderInspector();
      };
    }
    const hlRestore = this.inspectorEl.querySelector<HTMLButtonElement>('#hl-restore-all');
    if (hlRestore) {
      hlRestore.onclick = () => { c.restoreAllHoles(); };
    }

    // Shadow / AO Brush bindings
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-sact]').forEach((btn) => {
      btn.onclick = () => {
        sb.action = btn.dataset.sact as 'DARKEN' | 'LIGHTEN';
        this.renderInspector();
      };
    });
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-sshape]').forEach((btn) => {
      btn.onclick = () => {
        sb.shape = btn.dataset.sshape as 'CIRCLE' | 'SQUARE';
        this.renderInspector();
      };
    });
    const shRad = this.inspectorEl.querySelector<HTMLInputElement>('#sh-radius');
    if (shRad) {
      shRad.oninput = () => {
        sb.radius = Number(shRad.value);
        this.renderInspector();
      };
    }
    const shStr = this.inspectorEl.querySelector<HTMLInputElement>('#sh-str');
    if (shStr) {
      shStr.oninput = () => {
        sb.strength = Number(shStr.value);
        this.renderInspector();
      };
    }
    const shMax = this.inspectorEl.querySelector<HTMLInputElement>('#sh-max');
    if (shMax) {
      shMax.oninput = () => {
        sb.maxDarkness = Number(shMax.value);
        this.renderInspector();
      };
    }
    const shClear = this.inspectorEl.querySelector<HTMLButtonElement>('#sh-clear-all');
    if (shClear) {
      shClear.onclick = () => { c.clearAllVertexShadows(); };
    }
  }

  private renderAssetInspector(): void {
    const a = this.controller.assetTool;
    const mgr = this.controller.assets;
    const packs = mgr.getPacks();
    const query = this.assetSearch.trim().toLowerCase();
    const selectedProp = mgr.getById(a.selectedPlacedId);
    const sameTypeCount = selectedProp
      ? mgr.placedAssets.filter((p) => p.entry.key === selectedProp.entry.key).length
      : 0;

    const filtered = mgr.entries.filter((entry) => {
      if (this.assetPackFilter !== 'ALL' && entry.pack !== this.assetPackFilter) return false;
      if (this.assetRoleFilter === 'WALL' && !isWallDecorEntry(entry)) return false;
      if (this.assetRoleFilter === 'ANIM' && classifyAmbientAnimation(entry) === 'none') return false;
      if (query.length > 0 && !entry.name.toLowerCase().includes(query) && !entry.key.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });

    const visibleSlice = filtered.slice(0, 80);
    const scalePresets = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0];

    const activeLayer = this.controller.activeLayer;
    const layerLabel = activeLayer === 'interior' ? 'Interior' : 'Surface';
    const layerPlacedCount = mgr.getPlacedForLayer(activeLayer).length;

    this.inspectorEl.innerHTML = `
      <div class="section">
        <div class="section-title">
          <span>Asset Tool Mode</span>
          <span>${layerPlacedCount} on ${layerLabel}</span>
        </div>
        <div class="grid-3">
          <button class="btn small ${a.subMode === 'place' ? 'active' : ''}" data-asub="place" title="Hover shows live 3D ghost preview; click places asset">Place</button>
          <button class="btn small ${a.subMode === 'select' ? 'active' : ''}" data-asub="select" title="Click placed prop to select/resize; drag to move">Select</button>
          <button class="btn small ${a.subMode === 'replace' ? 'active' : ''}" data-asub="replace" title="Click any placed prop to swap it with the selected catalog GLB">Replace</button>
        </div>
        <div class="grid-4">
          <button class="btn small ${a.snapMode === 'center' ? 'active' : ''}" data-snap="center" title="Snap to tile/footprint center">Center</button>
          <button class="btn small ${a.snapMode === 'corner' ? 'active' : ''}" data-snap="corner" title="Snap to tile vertex corner">Corner</button>
          <button class="btn small ${a.snapMode === 'wall' ? 'active' : ''}" data-snap="wall" title="WorldLab Wall-Decoration snap: attach to wall faces or tile edges at authored mount height">Wall</button>
          <button class="btn small ${a.snapMode === 'free' ? 'active' : ''}" data-snap="free" title="Free continuous placement">Free</button>
        </div>
        ${
          a.snapMode !== 'wall'
            ? `
          <label class="checkbox-row" title="Raycast against placed models to stack towers, roofs, crates, or braziers flush on top">
            <input type="checkbox" id="as-stack" ${a.stackOnModels ? 'checked' : ''} />
            <span>Stack on Models (fit onto tops · green frame)</span>
          </label>`
            : ''
        }
        ${
          a.snapMode === 'wall'
            ? `
          <div class="field">
            <div class="field-row"><span>Wall Decor Mode</span><strong>WorldLab Mount</strong></div>
            <div class="grid-2">
              <button class="btn small ${a.wallDecorMode === 'straight_offset' ? 'active' : ''}" data-wmode="straight_offset" title="Offset outward by supporting wall thickness">Wall Offset</button>
              <button class="btn small ${a.wallDecorMode === 'straight_no_offset' ? 'active' : ''}" data-wmode="straight_no_offset" title="Flush directly on tile edge / wall face">Flush Edge</button>
              <button class="btn small ${a.wallDecorMode === 'diagonal_offset' ? 'active' : ''}" data-wmode="diagonal_offset" title="Diagonal wall outer face (+45°)">Diag Out</button>
              <button class="btn small ${a.wallDecorMode === 'diagonal_no_offset' ? 'active' : ''}" data-wmode="diagonal_no_offset" title="Diagonal wall inner face (+225°)">Diag In</button>
            </div>
          </div>
          <div class="field">
            <div class="field-row"><span>Extra Face Offset</span><strong>${a.wallOffsetFeet >= 0 ? '+' : ''}${a.wallOffsetFeet.toFixed(1)} ft</strong></div>
            <input type="range" id="as-woff" min="-1" max="2" step="0.2" value="${a.wallOffsetFeet}" />
          </div>
          <div class="hint-box">
            Hover any placed <strong>wall, tower, or passage</strong> (amber frame) or tile edge (cyan frame) to mount torches, cressets, banners, canopies, and signs at authored height.
          </div>`
            : ''
        }
      </div>

      ${
        selectedProp
          ? `
        <div class="section">
          <div class="section-title">
            <span>Selected Prop</span>
            <span>(${selectedProp.tileX.toFixed(1)}, ${selectedProp.tileZ.toFixed(1)})</span>
          </div>
          <div class="field-row">
            <strong>${selectedProp.entry.name}</strong>
            <span class="cat-badge">${selectedProp.entry.nominalWidthTiles}×${selectedProp.entry.nominalLengthTiles} (${selectedProp.entry.nominalWidthTiles * 5}×${selectedProp.entry.nominalLengthTiles * 5} ft)</span>
          </div>
          ${
            isCaveMouthEntry(selectedProp.entry) || selectedProp.caveVoidEnabled
              ? `
            <label class="checkbox-row" title="Optional unlit pitch-black receding tunnel shell for dead-end scenic entrances">
              <input type="checkbox" id="as-sel-void" ${selectedProp.caveVoidEnabled ? 'checked' : ''} />
              <span>Dark Cave Void Backing</span>
            </label>`
              : ''
          }
          <div class="grid-2">
            <button class="btn small" id="as-replace-one" ${a.selectedAsset ? '' : 'disabled'} title="Swap this prop in-place with '${a.selectedAsset?.name ?? ''}'">
              Replace w/ Pick
            </button>
            <button class="btn small" id="as-replace-all" ${a.selectedAsset ? '' : 'disabled'} title="Swap all ${sameTypeCount} '${selectedProp.entry.name}' props on the map">
              Replace All (${sameTypeCount})
            </button>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="as-keep-scale" ${a.preserveScaleOnReplace ? 'checked' : ''} />
            <span>Keep custom resize on replace</span>
          </label>
          <div class="grid-3">
            <button class="btn small" id="as-dup">Duplicate</button>
            <button class="btn small danger" id="as-del-sel">Delete</button>
            <button class="btn small" id="as-desel">Deselect</button>
          </div>
          ${
            Math.abs(selectedProp.yOffsetFeet) > 0.1
              ? `<button class="btn small" id="as-drop-ground" title="Reset elevation offset to 0 ft">Drop to Ground (currently ${selectedProp.yOffsetFeet >= 0 ? '+' : ''}${selectedProp.yOffsetFeet.toFixed(1)} ft)</button>`
              : ''
          }
        </div>`
          : ''
      }

      <div class="section">
        <div class="section-title">
          <span>Resize & Transform</span>
          <span>${selectedProp ? 'Live Edit' : 'Ghost Preview'}</span>
        </div>
        <div class="field">
          <div class="field-row"><span>Scale Policy</span></div>
          <select id="as-scale-policy">
            <option value="auto_dnd" ${a.scalePolicy === 'auto_dnd' ? 'selected' : ''}>Auto D&D (WorldLab Scale + 5ft Grid)</option>
            <option value="tile_1_5m" ${a.scalePolicy === 'tile_1_5m' ? 'selected' : ''}>Tile-Locked (1.5 m / 5 ft)</option>
            <option value="metric_1_0m" ${a.scalePolicy === 'metric_1_0m' ? 'selected' : ''}>WorldLab Native (1.0 m)</option>
          </select>
        </div>

        <div class="grid-3">
          ${scalePresets
            .map(
              (preset) =>
                `<button class="btn small ${Math.abs(a.scaleX - preset) < 0.02 && a.uniformScale ? 'active' : ''}" data-spreset="${preset}">${preset}×</button>`
            )
            .join('')}
        </div>

        <label class="checkbox-row">
          <input type="checkbox" id="as-uniform" ${a.uniformScale ? 'checked' : ''} />
          <span>Lock Uniform Scale ([ / ] or - / +)</span>
        </label>

        ${
          a.uniformScale
            ? `
          <div class="field">
            <div class="field-row"><span>Uniform Scale</span><strong>${a.scaleX.toFixed(2)}×</strong></div>
            <input type="range" id="as-scale-u" min="0.2" max="4.0" step="0.05" value="${a.scaleX}" />
          </div>`
            : `
          <div class="field">
            <div class="field-row"><span>Width (X)</span><strong>${a.scaleX.toFixed(2)}×</strong></div>
            <input type="range" id="as-scale-x" min="0.2" max="4.0" step="0.05" value="${a.scaleX}" />
          </div>
          <div class="field">
            <div class="field-row"><span>Height (Y)</span><strong>${a.scaleY.toFixed(2)}×</strong></div>
            <input type="range" id="as-scale-y" min="0.2" max="4.0" step="0.05" value="${a.scaleY}" />
          </div>
          <div class="field">
            <div class="field-row"><span>Depth (Z)</span><strong>${a.scaleZ.toFixed(2)}×</strong></div>
            <input type="range" id="as-scale-z" min="0.2" max="4.0" step="0.05" value="${a.scaleZ}" />
          </div>`
        }

        <div class="field">
          <div class="field-row"><span>Rotation (R / Shift+R)</span><strong>${Math.round(a.rotationDegrees)}°</strong></div>
          <input type="range" id="as-rot-slider" min="0" max="355" step="5" value="${Math.round(a.rotationDegrees)}" />
          <div class="grid-3">
            <button class="btn small" id="as-rot-90">+90°</button>
            <button class="btn small" id="as-rot-15">+15°</button>
            <button class="btn small" id="as-rot-0">Reset 0°</button>
          </div>
        </div>

        <div class="field">
          <div class="field-row"><span>Elevation Offset</span><strong>${(selectedProp ? selectedProp.yOffsetFeet : a.yOffsetFeet) >= 0 ? '+' : ''}${(selectedProp ? selectedProp.yOffsetFeet : a.yOffsetFeet).toFixed(1)} ft</strong></div>
          <input type="range" id="as-yoff" min="-10" max="40" step="0.5" value="${selectedProp ? selectedProp.yOffsetFeet : a.yOffsetFeet}" />
        </div>

        <div class="grid-2">
          <button class="btn small" id="as-undo">Undo Last Prop</button>
          <button class="btn small danger" id="as-clear">Clear ${layerLabel}</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">
          <span>Local GLB Library</span>
          <span>${filtered.length} / ${mgr.entries.length}</span>
        </div>
        <select id="as-pack">
          <option value="ALL" ${this.assetPackFilter === 'ALL' ? 'selected' : ''}>All Packs (${mgr.entries.length})</option>
          ${packs.map((pk) => `<option value="${pk}" ${this.assetPackFilter === pk ? 'selected' : ''}>${pk}</option>`).join('')}
        </select>
        <div class="grid-3">
          <button class="btn small ${this.assetRoleFilter === 'ALL' ? 'active' : ''}" data-arole="ALL">All</button>
          <button class="btn small ${this.assetRoleFilter === 'WALL' ? 'active' : ''}" data-arole="WALL">Wall Decor</button>
          <button class="btn small ${this.assetRoleFilter === 'ANIM' ? 'active' : ''}" data-arole="ANIM">Animated</button>
        </div>
        <input type="text" id="as-search" placeholder="Search local GLBs (wall torch, banner, arch...)" value="${this.assetSearch.replace(/"/g, '&quot;')}" />
        <div class="asset-list">
          ${
            visibleSlice.length === 0
              ? `<div class="hint-box">No matching assets in D:\\Games\\projects\\vtt-3d-proto\\assets.</div>`
              : visibleSlice
                  .map((entry) => {
                    const isWall = isWallDecorEntry(entry);
                    const animKind = classifyAmbientAnimation(entry);
                    return `
                  <button class="asset-item ${a.selectedAsset?.key === entry.key ? 'active' : ''}" data-asset-key="${entry.key}">
                    <div class="asset-item-top">
                      <span>${entry.name}</span>
                      <span class="badge-row">
                        ${isWall ? `<span class="cat-badge wall" title="Wall-mounted decoration">WALL</span>` : ''}
                        ${animKind !== 'none' ? `<span class="cat-badge anim" title="Embedded glTF animation">ANIM</span>` : ''}
                        <span class="cat-badge">${entry.category}</span>
                      </span>
                    </div>
                    <div class="asset-item-meta">
                      <span>${entry.pack}</span>
                      <span>${entry.nominalWidthTiles}×${entry.nominalLengthTiles} tile · ${entry.nominalWidthTiles * 5}×${entry.nominalLengthTiles * 5} ft</span>
                    </div>
                  </button>`;
                  })
                  .join('')
          }
        </div>
        <div class="hint-box">
          <strong>Place:</strong> live 3D ghost preview · <strong>Select:</strong> click/drag props to move & resize · <strong>Replace:</strong> click any placed prop to swap it with catalog pick · <strong>Alt+Click:</strong> delete.
        </div>
      </div>
    `;

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-asub]').forEach((btn) => {
      btn.onclick = () => {
        a.subMode = btn.dataset.asub as AssetSubMode;
        this.controller.refreshAssetPreview();
        this.renderInspector();
      };
    });
    const selVoidCb = this.inspectorEl.querySelector<HTMLInputElement>('#as-sel-void');
    if (selVoidCb && selectedProp) {
      selVoidCb.onchange = () => {
        mgr.setPlacedCaveVoid(selectedProp.id, selVoidCb.checked);
        this.controller.isDirty = true;
        this.renderInspector();
      };
    }
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-snap]').forEach((btn) => {
      btn.onclick = () => {
        a.snapMode = btn.dataset.snap as 'center' | 'corner' | 'wall' | 'free';
        this.controller.refreshAssetPreview();
        this.renderInspector();
      };
    });
    const stackCb = this.inspectorEl.querySelector<HTMLInputElement>('#as-stack');
    if (stackCb) {
      stackCb.onchange = () => {
        a.stackOnModels = stackCb.checked;
        this.controller.refreshAssetPreview();
      };
    }
    const dropGroundBtn = this.inspectorEl.querySelector<HTMLButtonElement>('#as-drop-ground');
    if (dropGroundBtn) {
      dropGroundBtn.onclick = () => {
        this.controller.setAssetElevationFeet(0);
        this.renderInspector();
      };
    }
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-wmode]').forEach((btn) => {
      btn.onclick = () => {
        a.wallDecorMode = btn.dataset.wmode as WallDecorMode;
        this.renderInspector();
      };
    });
    const woffEl = this.inspectorEl.querySelector<HTMLInputElement>('#as-woff');
    if (woffEl) {
      woffEl.oninput = () => {
        a.wallOffsetFeet = Number(woffEl.value);
        this.renderInspector();
      };
    }
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-arole]').forEach((btn) => {
      btn.onclick = () => {
        this.assetRoleFilter = btn.dataset.arole as 'ALL' | 'WALL' | 'ANIM';
        this.renderInspector();
      };
    });

    const scalePolicySel = this.inspectorEl.querySelector<HTMLSelectElement>('#as-scale-policy');
    if (scalePolicySel) {
      scalePolicySel.onchange = () => {
        a.scalePolicy = scalePolicySel.value as AssetScalePolicy;
        this.controller.applyAssetTransformChange();
      };
    }

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-spreset]').forEach((btn) => {
      btn.onclick = () => {
        const v = Number(btn.dataset.spreset);
        a.scaleX = v;
        a.scaleY = v;
        a.scaleZ = v;
        this.controller.applyAssetTransformChange();
        this.renderInspector();
      };
    });

    const uniCb = this.inspectorEl.querySelector<HTMLInputElement>('#as-uniform');
    if (uniCb) {
      uniCb.onchange = () => {
        a.uniformScale = uniCb.checked;
        if (a.uniformScale) {
          a.scaleY = a.scaleX;
          a.scaleZ = a.scaleX;
          this.controller.applyAssetTransformChange();
        }
        this.renderInspector();
      };
    }

    const bindAssetRange = (id: string, fn: (n: number) => void): void => {
      const el = this.inspectorEl.querySelector<HTMLInputElement>(`#${id}`);
      if (!el) return;
      el.oninput = () => {
        fn(Number(el.value));
        this.controller.applyAssetTransformChange();
        this.renderInspector();
      };
    };

    bindAssetRange('as-scale-u', (n) => {
      a.scaleX = n;
      a.scaleY = n;
      a.scaleZ = n;
    });
    bindAssetRange('as-scale-x', (n) => (a.scaleX = n));
    bindAssetRange('as-scale-y', (n) => (a.scaleY = n));
    bindAssetRange('as-scale-z', (n) => (a.scaleZ = n));
    bindAssetRange('as-rot-slider', (n) => (a.rotationDegrees = n));
    const yoffEl = this.inspectorEl.querySelector<HTMLInputElement>('#as-yoff');
    if (yoffEl) {
      yoffEl.oninput = () => {
        this.controller.setAssetElevationFeet(Number(yoffEl.value));
        this.renderInspector();
      };
    }

    const rot90 = this.inspectorEl.querySelector<HTMLButtonElement>('#as-rot-90');
    if (rot90) {
      rot90.onclick = () => {
        a.rotationDegrees = (a.rotationDegrees + 90) % 360;
        this.controller.applyAssetTransformChange();
        this.renderInspector();
      };
    }
    const rot15 = this.inspectorEl.querySelector<HTMLButtonElement>('#as-rot-15');
    if (rot15) {
      rot15.onclick = () => {
        a.rotationDegrees = (a.rotationDegrees + 15) % 360;
        this.controller.applyAssetTransformChange();
        this.renderInspector();
      };
    }
    const rot0 = this.inspectorEl.querySelector<HTMLButtonElement>('#as-rot-0');
    if (rot0) {
      rot0.onclick = () => {
        a.rotationDegrees = 0;
        this.controller.applyAssetTransformChange();
        this.renderInspector();
      };
    }

    const repOne = this.inspectorEl.querySelector<HTMLButtonElement>('#as-replace-one');
    if (repOne) {
      repOne.onclick = () => {
        void this.controller.replaceSelectedPlaced();
      };
    }
    const repAll = this.inspectorEl.querySelector<HTMLButtonElement>('#as-replace-all');
    if (repAll) {
      repAll.onclick = () => {
        void this.controller.replaceAllMatchingSelected();
      };
    }
    const keepScaleCb = this.inspectorEl.querySelector<HTMLInputElement>('#as-keep-scale');
    if (keepScaleCb) {
      keepScaleCb.onchange = () => {
        a.preserveScaleOnReplace = keepScaleCb.checked;
      };
    }
    const dupBtn = this.inspectorEl.querySelector<HTMLButtonElement>('#as-dup');
    if (dupBtn) {
      dupBtn.onclick = () => {
        if (!a.selectedPlacedId) return;
        void mgr.duplicateAsset(a.selectedPlacedId, 1, 0).then((copy) => {
          if (copy) {
            this.controller.isDirty = true;
            this.controller.selectPlacedProp(copy.id);
            this.controller.syncDynamicLights();
            this.controller.scene.fitSunShadows();
          }
        });
      };
    }
    const delSelBtn = this.inspectorEl.querySelector<HTMLButtonElement>('#as-del-sel');
    if (delSelBtn) {
      delSelBtn.onclick = () => {
        if (!a.selectedPlacedId) return;
        mgr.removeById(a.selectedPlacedId);
        this.controller.isDirty = true;
        this.controller.selectPlacedProp(null);
        this.controller.syncDynamicLights();
        this.controller.scene.fitSunShadows();
      };
    }
    const deselBtn = this.inspectorEl.querySelector<HTMLButtonElement>('#as-desel');
    if (deselBtn) {
      deselBtn.onclick = () => { this.controller.selectPlacedProp(null); };
    }

    const undoBtn = this.inspectorEl.querySelector<HTMLButtonElement>('#as-undo');
    if (undoBtn) {
      undoBtn.onclick = () => {
        const removed = mgr.removeLast(this.controller.activeLayer);
        if (removed && a.selectedPlacedId === removed.id) {
          this.controller.selectPlacedProp(null);
        }
        this.controller.isDirty = true;
        this.controller.syncDynamicLights();
        this.controller.scene.fitSunShadows();
        this.render();
      };
    }
    const clearBtn = this.inspectorEl.querySelector<HTMLButtonElement>('#as-clear');
    if (clearBtn) {
      clearBtn.onclick = () => {
        mgr.clearAll(this.controller.activeLayer);
        this.controller.isDirty = true;
        this.controller.selectPlacedProp(null);
        this.controller.syncDynamicLights();
        this.render();
      };
    }
    const packSel = this.inspectorEl.querySelector<HTMLSelectElement>('#as-pack');
    if (packSel) {
      packSel.onchange = () => {
        this.assetPackFilter = packSel.value;
        this.renderInspector();
      };
    }
    const searchInput = this.inspectorEl.querySelector<HTMLInputElement>('#as-search');
    if (searchInput) {
      searchInput.oninput = () => {
        this.assetSearch = searchInput.value;
        const caret = searchInput.selectionStart ?? searchInput.value.length;
        this.renderInspector();
        const nextInput = this.inspectorEl.querySelector<HTMLInputElement>('#as-search');
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(caret, caret);
        }
      };
    }
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-asset-key]').forEach((btn) => {
      btn.onclick = () => {
        const found = mgr.entries.find((e) => e.key === btn.dataset.assetKey) ?? null;
        this.controller.selectCatalogAsset(found);
        this.renderInspector();
      };
    });
  }

  private renderLightingInspector(): void {
    const lm = this.controller.lighting;
    const s = lm.settings;
    const torchFeet = Math.round((9.5 * s.pointLightRangeScale * 5) / 1.5);

    this.inspectorEl.innerHTML = `
      <div class="section">
        <div class="section-title">
          <span>Lighting Presets</span>
          <span>${LIGHTING_PRESET_LABELS[s.preset]}</span>
        </div>
        <div class="grid-2">
          ${LIGHTING_PRESET_ORDER.map(
            (id) =>
              `<button class="btn small ${s.preset === id ? 'active' : ''}" data-lpreset="${id}">${LIGHTING_PRESET_LABELS[id]}</button>`
          ).join('')}
        </div>
        ${
          this.controller.renderer.currentShadingMode !== 'pbr_shadows'
            ? `<div class="hint-box">
                Switch display to <strong>Flat + Lit</strong> for full real-time torch PointLights &amp; sun shadows on terrain.
                <button class="btn small primary" id="lt-enable-lit" style="margin-top:6px;width:100%">Switch to Flat + Lit</button>
              </div>`
            : ''
        }
      </div>

      <div class="section">
        <div class="section-title">
          <span>Dynamic Light Sources</span>
          <span>${lm.propLightCount} props · ${lm.lavaLightCount} lava</span>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="lt-pl-en" ${s.pointLightsEnabled ? 'checked' : ''} />
          <span>Enable Torch / Brazier / Cresset Lights</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="lt-lava-en" ${s.lavaGlowEnabled ? 'checked' : ''} ${s.pointLightsEnabled ? '' : 'disabled'} />
          <span>Lava &amp; Fire Pit Terrain Glow</span>
        </label>
        <div class="field">
          <div class="field-row"><span>Source Brightness</span><strong>${s.pointLightIntensity.toFixed(2)}×</strong></div>
          <input type="range" id="lt-pl-int" min="0.2" max="2.5" step="0.05" value="${s.pointLightIntensity}" />
        </div>
        <div class="field">
          <div class="field-row"><span>Light Radius</span><strong>${s.pointLightRangeScale.toFixed(2)}× (~${torchFeet} ft torch)</strong></div>
          <input type="range" id="lt-pl-rng" min="0.5" max="2.0" step="0.05" value="${s.pointLightRangeScale}" />
        </div>
        <div class="hint-box">
          Automatically creates flickering 3D point lights for <strong>Standing Torches</strong>, <strong>Wall Torches</strong>, <strong>Watch Braziers</strong>, <strong>Wall Cressets</strong>, and <strong>Magma / Lava</strong> tiles.
        </div>
      </div>

      <div class="section">
        <div class="section-title"><span>Sun / Moon Directional Light</span></div>
        <div class="field">
          <div class="field-row"><span>Sun Azimuth</span><strong>${Math.round(s.sunAzimuthDeg)}°</strong></div>
          <input type="range" id="lt-az" min="0" max="360" step="5" value="${Math.round(s.sunAzimuthDeg)}" />
        </div>
        <div class="field">
          <div class="field-row"><span>Sun Elevation</span><strong>${Math.round(s.sunElevationDeg)}°</strong></div>
          <input type="range" id="lt-el" min="8" max="85" step="2" value="${Math.round(s.sunElevationDeg)}" />
        </div>
        <div class="field">
          <div class="field-row"><span>Sun Intensity</span><strong>${s.sunIntensity.toFixed(2)}</strong></div>
          <input type="range" id="lt-sun-int" min="0" max="4" step="0.05" value="${s.sunIntensity}" />
        </div>
        <div class="color-row">
          <span>Sun / Moon Tint</span>
          <input type="color" id="lt-sun-col" value="${s.sunColor}" />
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="lt-shadows" ${s.shadowsEnabled ? 'checked' : ''} />
          <span>Cast Real-Time Sun Shadows</span>
        </label>
      </div>

      <div class="section">
        <div class="section-title"><span>Sky, Ambient &amp; Fog</span></div>
        <div class="field">
          <div class="field-row"><span>Ambient Fill</span><strong>${s.ambientIntensity.toFixed(2)}</strong></div>
          <input type="range" id="lt-amb" min="0.05" max="1.5" step="0.02" value="${s.ambientIntensity}" />
        </div>
        <div class="color-row">
          <span>Sky Hemisphere</span>
          <input type="color" id="lt-sky-col" value="${s.skyColor}" />
        </div>
        <div class="color-row">
          <span>Ground Bounce</span>
          <input type="color" id="lt-gnd-col" value="${s.groundColor}" />
        </div>
        <div class="color-row">
          <span>Backdrop Sky</span>
          <input type="color" id="lt-bg-col" value="${s.backdropColor}" />
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="lt-fog-en" ${s.fogEnabled ? 'checked' : ''} />
          <span>Atmospheric Distance Fog</span>
        </label>
        <div class="color-row">
          <span>Fog Color</span>
          <input type="color" id="lt-fog-col" value="${s.fogColor}" />
        </div>
      </div>
    `;

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-lpreset]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.lpreset as Exclude<LightingPresetId, 'custom'>;
        lm.applyPreset(id);
        this.controller.isDirty = true;
        this.render();
      };
    });

    const enableLitBtn = this.inspectorEl.querySelector<HTMLButtonElement>('#lt-enable-lit');
    if (enableLitBtn) {
      enableLitBtn.onclick = () => {
        this.controller.renderer.setShadingMode('pbr_shadows');
        this.render();
      };
    }

    const bindNum = (id: string, fn: (n: number) => void): void => {
      const el = this.inspectorEl.querySelector<HTMLInputElement>(`#${id}`);
      if (!el) return;
      el.oninput = () => {
        fn(Number(el.value));
        this.controller.isDirty = true;
        this.renderTopbar();
        this.renderInspector();
      };
    };

    const bindBool = (id: string, fn: (b: boolean) => void): void => {
      const el = this.inspectorEl.querySelector<HTMLInputElement>(`#${id}`);
      if (!el) return;
      el.onchange = () => {
        fn(el.checked);
        this.controller.isDirty = true;
        this.renderTopbar();
        this.renderInspector();
      };
    };

    const bindColor = (id: string, fn: (hex: string) => void): void => {
      const el = this.inspectorEl.querySelector<HTMLInputElement>(`#${id}`);
      if (!el) return;
      el.oninput = () => {
        fn(el.value);
        this.controller.isDirty = true;
        this.renderTopbar();
      };
    };

    bindNum('lt-az', (n) => { lm.patchSettings({ sunAzimuthDeg: n }); });
    bindNum('lt-el', (n) => { lm.patchSettings({ sunElevationDeg: n }); });
    bindNum('lt-sun-int', (n) => { lm.patchSettings({ sunIntensity: n }); });
    bindNum('lt-amb', (n) => { lm.patchSettings({ ambientIntensity: n }); });
    bindNum('lt-pl-int', (n) => { lm.patchSettings({ pointLightIntensity: n }); });
    bindNum('lt-pl-rng', (n) => { lm.patchSettings({ pointLightRangeScale: n }); });

    bindBool('lt-shadows', (b) => { lm.patchSettings({ shadowsEnabled: b }); });
    bindBool('lt-pl-en', (b) => { lm.patchSettings({ pointLightsEnabled: b }); });
    bindBool('lt-lava-en', (b) => { lm.patchSettings({ lavaGlowEnabled: b }); });
    bindBool('lt-fog-en', (b) => { lm.patchSettings({ fogEnabled: b }); });

    bindColor('lt-sun-col', (hex) => { lm.patchSettings({ sunColor: hex }); });
    bindColor('lt-sky-col', (hex) => { lm.patchSettings({ skyColor: hex }); });
    bindColor('lt-gnd-col', (hex) => { lm.patchSettings({ groundColor: hex }); });
    bindColor('lt-bg-col', (hex) => { lm.patchSettings({ backdropColor: hex }); });
    bindColor('lt-fog-col', (hex) => { lm.patchSettings({ fogColor: hex }); });
  }

  private renderStatus(telemetry: HoverTelemetry): void {
    if (!telemetry.hit) {
      this.statusLeftEl.innerHTML = `<span>Hover terrain to inspect tile/vertex · <strong>1 tile = 5 ft (1.5 m)</strong></span>`;
    } else {
      const uName = getMaterial(telemetry.underlayId).name;
      const oName = telemetry.overlayId > 0 ? getMaterial(telemetry.overlayId).name : 'None';
      const shapeName =
        telemetry.overlayId > 0
          ? `${OVERLAY_SHAPE_NAMES[telemetry.overlayShape] ?? `#${telemetry.overlayShape}`} ${telemetry.overlayRotation * 90}°`
          : '';
      const metaTag = describeAutoMeta(telemetry.autoMetadata);
      const holeBadge = telemetry.isHole ? ` <span class="status-val" style="color:#ff7855">[CUTOUT]</span>` : '';
      const aoBadge =
        telemetry.vertexShade > 0.01
          ? `<span>Shadow/AO <span class="status-val">${Math.round(telemetry.vertexShade * 100)}%</span></span>`
          : '';
      this.statusLeftEl.innerHTML = `
        <span>Tile <span class="status-val">(${telemetry.hit.tileX}, ${telemetry.hit.tileZ})</span>${holeBadge}</span>
        <span>Vertex <span class="status-val">(${telemetry.hit.vertexX}, ${telemetry.hit.vertexZ})</span></span>
        <span>Elev <span class="status-val">${telemetry.elevationFeet.toFixed(1)} ft / ${telemetry.elevationMeters.toFixed(2)} m</span></span>
        <span>Underlay <span class="status-val">${uName}</span></span>
        <span>Overlay <span class="status-val">${oName}${shapeName ? ` (${shapeName})` : ''}${metaTag ? ` [${metaTag}]` : ''}</span></span>
        ${aoBadge}
      `;
    }
    this.renderRightStatus();
  }

  private renderRightStatus(): void {
    const c = this.controller;
    const layerLabel = c.activeLayer === 'interior' ? `Interior (-${c.interiorDepthFeet} ft)` : 'Surface';
    const layerProps = c.assets.getPlacedForLayer(c.activeLayer).length;
    const layerLiquids = c.liquids.getForLayer(c.activeLayer).length;
    const liquidBadge =
      c.liquids.count > 0
        ? `<span>Liquids <span class="status-val">${layerLiquids} / ${c.liquids.count}</span></span>`
        : '';
    this.statusRightEl.innerHTML = `
      <span>Layer <span class="status-val">${layerLabel}</span></span>
      <span>Map <span class="status-val">${c.grid.width}×${c.grid.length} (${c.grid.width * 5}×${c.grid.length * 5} ft)</span></span>
      <span>Tris <span class="status-val">${c.renderer.triangleCount.toLocaleString()}</span></span>
      ${liquidBadge}
      <span>Props <span class="status-val">${layerProps} / ${c.assets.placedAssets.length}</span></span>
      <span>RMB: Orbit · WASD/MMB: Pan · Wheel: Zoom</span>
    `;
  }

  private renderLiquidInspector(): void {
    const c = this.controller;
    const lt = c.liquidTool;
    const sel = c.getSelectedLiquid();
    const layerSurfaces = c.liquids.getForLayer(c.activeLayer);
    const connectedIds = sel ? c.getConnectedLiquidIds(sel.id) : new Set<string>();
    const connectedCount = connectedIds.size;
    const adjacentNeighbor = sel ? findAdjacentNeighbor(layerSurfaces, sel) : null;
    const canMatchNeighbor =
      !!sel && !!adjacentNeighbor && Math.abs(adjacentNeighbor.levelFeet - sel.levelFeet) > 0.05;

    const activePreset = getLiquidPreset(sel?.preset ?? lt.preset);
    const activeLevel = sel ? sel.levelFeet : lt.levelFeet;
    const activeOpacity = sel?.opacity ?? lt.opacity ?? activePreset.opacity;

    this.inspectorEl.innerHTML = `
      <div class="section">
        <div class="section-title">Flat Liquid Surface</div>
        <div class="grid-2">
          <button class="btn small ${lt.subMode === 'draw' ? 'active' : ''}" data-lq-sub="draw" title="Click-drag on map to draw a flat liquid plane (snaps flush to neighbors)">Draw</button>
          <button class="btn small ${lt.subMode === 'edit' ? 'active' : ''}" data-lq-sub="edit" title="Select, move, resize edge handles, or Shift+drag edge to continue">Select / Resize</button>
        </div>
        <button class="btn small primary" style="width:100%;margin-top:6px" data-lq-action="add-center">+ Add Flat Surface at Center</button>
      </div>

      <div class="section">
        <div class="section-title">Liquid Type</div>
        <div class="swatch-grid">
          ${LIQUID_PRESETS.map((p) => {
            const isSel = (sel?.preset ?? lt.preset) === p.id;
            return `
              <button class="swatch ${isSel ? 'active' : ''}" data-lq-preset="${p.id}" title="${p.name}${p.emissive ? ' (Self-lit)' : ''}">
                <span class="swatch-dot" style="background:${hexCss(p.hex)}"></span>
                <span>${p.name}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Surface Level &amp; Opacity</div>
        <div class="control-row">
          <div class="control-label">
            <span>Level (ft)</span>
            <span class="val">${activeLevel >= 0 ? '+' : ''}${activeLevel.toFixed(2)} ft</span>
          </div>
          <input type="range" id="lq-level-range" min="-20" max="30" step="0.25" value="${Math.max(-20, Math.min(30, activeLevel))}" />
        </div>
        <div class="grid-2" style="margin-top:4px;gap:6px;align-items:center">
          <input type="number" id="lq-level-num" class="input-field" step="0.25" min="-40" max="80" value="${activeLevel}" />
          <button class="btn small ${lt.pickingTerrainLevel ? 'active' : ''}" data-lq-action="pick-terrain" title="Click any terrain spot to copy its elevation to the liquid level">${lt.pickingTerrainLevel ? 'Click Terrain...' : 'Pick Terrain'}</button>
        </div>
        <div class="grid-4" style="margin-top:6px">
          <button class="btn small" data-lq-nudge="-1">-1 ft</button>
          <button class="btn small" data-lq-nudge="-0.25">-0.25</button>
          <button class="btn small" data-lq-nudge="0.25">+0.25</button>
          <button class="btn small" data-lq-nudge="1">+1 ft</button>
        </div>

        <div class="control-row" style="margin-top:10px">
          <div class="control-label">
            <span>Opacity</span>
            <span class="val">${Math.round(activeOpacity * 100)}%</span>
          </div>
          <input type="range" id="lq-opacity" min="0.15" max="1" step="0.02" value="${activeOpacity}" />
        </div>
      </div>

      ${
        sel
          ? `
        <div class="section">
          <div class="section-title">Selected Surface (${sel.width}×${sel.length} tiles · ${Math.round(sel.width * 5)}×${Math.round(sel.length * 5)} ft)</div>
          <div class="grid-2" style="gap:6px">
            <label class="mini-field">
              <span>Width (tiles)</span>
              <input type="number" id="lq-w" class="input-field" step="${lt.snapStep}" min="0.5" max="${c.grid.width}" value="${sel.width}" />
            </label>
            <label class="mini-field">
              <span>Length (tiles)</span>
              <input type="number" id="lq-l" class="input-field" step="${lt.snapStep}" min="0.5" max="${c.grid.length}" value="${sel.length}" />
            </label>
            <label class="mini-field">
              <span>Origin X</span>
              <input type="number" id="lq-x" class="input-field" step="${lt.snapStep}" min="0" max="${c.grid.width - 0.5}" value="${sel.x}" />
            </label>
            <label class="mini-field">
              <span>Origin Z</span>
              <input type="number" id="lq-z" class="input-field" step="${lt.snapStep}" min="0" max="${c.grid.length - 0.5}" value="${sel.z}" />
            </label>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Connect &amp; Continue</div>
          <label class="check-row" title="When enabled, changing level, liquid type, or opacity updates all flush-connected segments together">
            <input type="checkbox" id="lq-link-conn" ${lt.linkConnected ? 'checked' : ''} />
            <span>Link connected segments (${connectedCount})</span>
          </label>

          <div class="control-row" style="margin-top:8px">
            <div class="control-label">
              <span>Continue Span</span>
              <span class="val">${lt.continueSpan} tiles (${lt.continueSpan * 5} ft)</span>
            </div>
            <input type="range" id="lq-cont-span" min="1" max="16" step="0.5" value="${lt.continueSpan}" />
          </div>

          <div class="continue-pad">
            <span></span>
            <button class="btn small" data-lq-continue="N" title="Spawn connected segment flush on North (-Z) edge">+ North</button>
            <span></span>
            <button class="btn small" data-lq-continue="W" title="Spawn connected segment flush on West (-X) edge">+ West</button>
            <span class="continue-pad-center">Flush</span>
            <button class="btn small" data-lq-continue="E" title="Spawn connected segment flush on East (+X) edge">+ East</button>
            <span></span>
            <button class="btn small" data-lq-continue="S" title="Spawn connected segment flush on South (+Z) edge">+ South</button>
            <span></span>
          </div>

          <div class="grid-2" style="margin-top:8px">
            <button class="btn small" data-lq-action="match-neighbor" ${canMatchNeighbor ? '' : 'disabled'} title="Snap this surface's level to an adjacent touching liquid">Match Neighbor</button>
            <button class="btn small" data-lq-action="duplicate">Duplicate</button>
          </div>
          <button class="btn small danger" style="width:100%;margin-top:6px" data-lq-action="delete-selected">Delete Selected Surface</button>
        </div>
      `
          : `
        <div class="section">
          <div class="hint-box">
            <strong>Draw mode:</strong> Drag on the map to place a flat liquid rectangle, or start near an existing liquid's edge to snap flush &amp; inherit its level.<br/><br/>
            <strong>Select / Resize:</strong> Drag edge <strong>◇</strong> handles to resize, or <strong>Shift+Drag</strong> any edge to pull out a connected continuation!
          </div>
        </div>
      `
      }

      <div class="section">
        <div class="section-title">Snapping &amp; Placement</div>
        <label class="check-row">
          <input type="checkbox" id="lq-edge-snap" ${lt.edgeSnap ? 'checked' : ''} />
          <span>Flush snap to neighbor liquid edges</span>
        </label>
        <div class="control-row" style="margin-top:6px">
          <div class="control-label"><span>Grid Snap Step</span></div>
          <div class="grid-3">
            ${([0.25, 0.5, 1] as const)
              .map(
                (step) =>
                  `<button class="btn small ${Math.abs(lt.snapStep - step) < 0.01 ? 'active' : ''}" data-lq-step="${step}">${step} tile</button>`
              )
              .join('')}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Surfaces on ${c.activeLayer === 'interior' ? 'Interior' : 'Surface'} (${layerSurfaces.length})</div>
        ${
          layerSurfaces.length === 0
            ? `<div class="hint-box">No flat liquid surfaces on this layer yet.</div>`
            : `<div class="liquid-list">
                ${layerSurfaces
                  .map((s) => {
                    const p = getLiquidPreset(s.preset);
                    const isSel = sel?.id === s.id;
                    const isLinked = !isSel && connectedIds.has(s.id);
                    return `
                      <div class="liquid-list-row ${isSel ? 'active' : isLinked ? 'linked' : ''}" data-lq-pick="${s.id}">
                        <span class="swatch-dot" style="background:${hexCss(s.colorHex ?? p.hex)}"></span>
                        <span class="liquid-list-label">${p.name} · ${s.width}×${s.length} · ${s.levelFeet >= 0 ? '+' : ''}${s.levelFeet.toFixed(1)}ft</span>
                        <button class="btn small danger liquid-list-del" data-lq-del="${s.id}" title="Delete surface">×</button>
                      </div>
                    `;
                  })
                  .join('')}
              </div>`
        }
      </div>
    `;

    // Bind events
    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-lq-sub]').forEach((btn) => {
      btn.addEventListener('click', () => { c.setLiquidSubMode(btn.dataset.lqSub as LiquidSubMode); });
    });

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-lq-preset]').forEach((btn) => {
      btn.addEventListener('click', () => { c.setLiquidPreset(btn.dataset.lqPreset as LiquidPresetId); });
    });

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-lq-nudge]').forEach((btn) => {
      btn.addEventListener('click', () => { c.nudgeLiquidLevel(Number(btn.dataset.lqNudge)); });
    });

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-lq-continue]').forEach((btn) => {
      btn.addEventListener('click', () => {
        c.continueSelectedLiquid(btn.dataset.lqContinue as LiquidEdgeSide);
      });
    });

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-lq-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        lt.snapStep = Number(btn.dataset.lqStep);
        this.renderInspector();
      });
    });

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-lq-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.lqAction;
        if (act === 'add-center') c.addLiquidAtMapCenter();
        else if (act === 'pick-terrain') {
          lt.pickingTerrainLevel = !lt.pickingTerrainLevel;
          this.render();
        } else if (act === 'match-neighbor') c.matchNeighborLiquidLevel();
        else if (act === 'duplicate') c.duplicateSelectedLiquid();
        else if (act === 'delete-selected') c.deleteSelectedLiquid();
      });
    });

    const levelRange = this.inspectorEl.querySelector<HTMLInputElement>('#lq-level-range');
    levelRange?.addEventListener('input', () => { c.setLiquidLevelFeet(Number(levelRange.value)); });

    const levelNum = this.inspectorEl.querySelector<HTMLInputElement>('#lq-level-num');
    levelNum?.addEventListener('change', () => { c.setLiquidLevelFeet(Number(levelNum.value)); });

    const opacityRange = this.inspectorEl.querySelector<HTMLInputElement>('#lq-opacity');
    opacityRange?.addEventListener('input', () => { c.setLiquidOpacity(Number(opacityRange.value)); });

    const bindRectInput = (id: string, key: 'x' | 'z' | 'width' | 'length'): void => {
      const el = this.inspectorEl.querySelector<HTMLInputElement>(`#${id}`);
      el?.addEventListener('change', () => {
        const val = Number(el.value);
        if (Number.isFinite(val)) {
          c.updateSelectedLiquidRect({ [key]: val });
        }
      });
    };
    bindRectInput('lq-w', 'width');
    bindRectInput('lq-l', 'length');
    bindRectInput('lq-x', 'x');
    bindRectInput('lq-z', 'z');

    const linkChk = this.inspectorEl.querySelector<HTMLInputElement>('#lq-link-conn');
    linkChk?.addEventListener('change', () => {
      lt.linkConnected = linkChk.checked;
      c.refreshLiquidOverlay();
      this.renderInspector();
    });

    const edgeSnapChk = this.inspectorEl.querySelector<HTMLInputElement>('#lq-edge-snap');
    edgeSnapChk?.addEventListener('change', () => {
      lt.edgeSnap = edgeSnapChk.checked;
    });

    const contSpan = this.inspectorEl.querySelector<HTMLInputElement>('#lq-cont-span');
    contSpan?.addEventListener('input', () => {
      lt.continueSpan = Number(contSpan.value);
      this.renderInspector();
    });

    this.inspectorEl.querySelectorAll<HTMLElement>('[data-lq-pick]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-lq-del]')) return;
        lt.subMode = 'edit';
        c.selectLiquid(row.dataset.lqPick ?? null);
      });
    });

    this.inspectorEl.querySelectorAll<HTMLButtonElement>('[data-lq-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.lqDel) c.deleteLiquidById(btn.dataset.lqDel);
      });
    });
  }
}
