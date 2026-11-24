import { Container3D, FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';
import { Container, Graphics, ImageSource, Text, Texture } from 'pixi.js';
import type { Point, Token } from '../../../../shared/protocol';
import { type Health, healthColor } from '../../canvas/health';
import type { Scene } from '../../canvas/MapStage';
import { METERS_PER_HEIGHT_UNIT, TILE_SIZE_METERS } from '../terrain/constants';
import { pickTerrain } from '../terrain/raycast';
import type { TerrainGrid } from '../terrain/terrainGrid';
import type { CameraViewMode, SceneManager } from './sceneManager';
import { pickToken3d, stepTokenByCameraDirection, tokenTo3dFootprint, world3dToTokenCorner } from './tokenGeometry3d';

/**
 * Renderização e interação de tokens (jogadores e NPCs) no mapa 3D:
 * - Modo `top_down`: sprites planos dimensionados pelo tamanho D&D, como no mapa 2D.
 * - Modos `perspective` e `orthographic`: sprites verticais com billboard cilíndrico
 *   sobre uma base colorida no terreno.
 * - HUD 2D sincronizada (nome, barra de PV e condições), seleção e arrasto com `token.move`.
 */

const COLORS = {
  background: 0x16151a,
  playerToken: '#8f7cf7',
  otherToken: '#c0504d',
  outline: '#14121c',
  selected: 0xffd166,
  active: 0x5fd38d,
  condition: 0xffd166,
  label: 0xe8e6ef,
  tempHp: 0x6fb6ff,
};

const HEALTH_BAR_WIDTH = 56;
const HEALTH_BAR_HEIGHT = 6;
const TEX_SIZE = 256;

export interface TokenRenderer3dEvents {
  onSelect: (tokenId: string | null) => void;
  onMove: (tokenId: string, to: Point) => void;
}

interface Token3dEntry {
  token: Token;
  signature: string;
  root: Container3D;
  /** Sprite plano no chão (visível no modo `top_down`, idêntico ao 2D). */
  topDownMesh: Mesh3D;
  topDownMat: FlatMaterial;
  /** Base colorida no chão (visível em `perspective`/`orthographic`). */
  baseMesh: Mesh3D;
  baseMat: FlatMaterial;
  /** Sprite vertical com billboard cilíndrico (visível em `perspective`/`orthographic`). */
  billboardMesh: Mesh3D;
  billboardMat: FlatMaterial;
  /** Anel dourado de seleção no chão. */
  selectRing: Mesh3D;
  /** Anel verde do combatente da vez no chão. */
  turnRing: Mesh3D;
  /** Textura procedural do medalhão (descartada ao atualizar/destruir). */
  medallionTex: Texture;
  /** Textura da base circular (descartada ao atualizar/destruir). */
  baseTex: Texture;
  /** HUD 2D projetada na tela (nome, PV, condições). */
  hud: Container;
  nameLabel: Text;
  condLabel: Text;
  hpBar: Graphics;
  /** Posição 3D atual (metros), atualizada ao arrastar. */
  worldX: number;
  worldZ: number;
  groundY: number;
  sideMeters: number;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

/** Carrega uma imagem do `AssetStore` por `<img>` (respeitando CSP). */
function loadTokenImage(sha256: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = `vtt-asset://${sha256}`;
  });
}

/** Gera a textura circular do token (medalhão colorido + retrato recortado ou iniciais). */
function createMedallionTexture(name: string, fillCss: string, img: HTMLImageElement | null): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = TEX_SIZE / 2;
    const outerR = half * 0.92;
    const innerR = half * 0.84;

    ctx.beginPath();
    ctx.arc(half, half, outerR, 0, Math.PI * 2);
    ctx.fillStyle = fillCss;
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = COLORS.outline;
    ctx.stroke();

    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(half, half, innerR, 0, Math.PI * 2);
      ctx.clip();
      const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      let drawW = innerR * 2;
      let drawH = innerR * 2;
      if (aspect > 1) drawW = drawH * aspect;
      else drawH = drawW / aspect;
      ctx.drawImage(img, half - drawW / 2, half - drawH / 2, drawW, drawH);
      ctx.restore();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 84px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initialsOf(name), half, half + 4);
    }
  }
  return new Texture({ source: new ImageSource({ resource: canvas }) });
}

/** Gera uma textura circular de anel (para base, seleção ou turno ativo). */
function createRingTexture(strokeCss: string, fillCss?: string, lineWidth = 14): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = TEX_SIZE / 2;
    const r = half - lineWidth;
    ctx.beginPath();
    ctx.arc(half, half, r, 0, Math.PI * 2);
    if (fillCss) {
      ctx.fillStyle = fillCss;
      ctx.fill();
    }
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeCss;
    ctx.stroke();
  }
  return new Texture({ source: new ImageSource({ resource: canvas }) });
}

function drawScreenHealthBar(bar: Graphics, health: Health | null): void {
  bar.clear();
  bar.visible = health !== null;
  if (!health) return;
  const x = -HEALTH_BAR_WIDTH / 2;
  const total = Math.max(health.max, health.current + health.temp);
  bar.roundRect(x - 1, -1, HEALTH_BAR_WIDTH + 2, HEALTH_BAR_HEIGHT + 2, 2).fill(0x14121c);
  if (health.current > 0) {
    bar.rect(x, 0, (HEALTH_BAR_WIDTH * health.current) / total, HEALTH_BAR_HEIGHT).fill(healthColor(health));
  }
  if (health.temp > 0) {
    bar
      .rect(x + (HEALTH_BAR_WIDTH * health.current) / total, 0, (HEALTH_BAR_WIDTH * health.temp) / total, HEALTH_BAR_HEIGHT)
      .fill(COLORS.tempHp);
  }
}

export class TokenRenderer3d {
  private readonly tokensRoot: Container3D;
  private readonly hudContainer: Container;
  private readonly planeGeo: PlaneGeometry;
  private readonly selectRingTex: Texture;
  private readonly selectRingMat: FlatMaterial;
  private readonly turnRingTex: Texture;
  private readonly turnRingMat: FlatMaterial;
  private readonly entries = new Map<string, Token3dEntry>();
  private readonly imageCache = new Map<string, Promise<HTMLImageElement | null>>();
  private readonly eventAbort = new AbortController();

  private sceneState: Scene = {
    map: null,
    tokens: [],
    canDrag: () => false,
    selectedId: null,
    activeId: null,
    conditions: () => [],
    health: () => null,
  };

  private drag: { tokenId: string; moved: boolean } | null = null;
  private downClient: { x: number; y: number } | null = null;
  private interactionEnabled = true;
  private lastViewMode: CameraViewMode;
  private destroyed = false;

  constructor(
    private readonly sceneMgr: SceneManager,
    private readonly grid: TerrainGrid,
    private readonly events: TokenRenderer3dEvents,
  ) {
    this.tokensRoot = new Container3D({ label: 'tokensRoot' });
    this.sceneMgr.worldRoot.addChild(this.tokensRoot);

    this.hudContainer = new Container();
    this.hudContainer.eventMode = 'none';
    this.sceneMgr.hudLayer.addChild(this.hudContainer);

    this.planeGeo = new PlaneGeometry({ width: 1, height: 1, flipV: true });
    this.selectRingTex = createRingTexture('#ffd166', undefined, 16);
    this.selectRingMat = new FlatMaterial({
      baseColorTexture: this.selectRingTex,
      alphaMode: 'blend',
      doubleSided: true,
    });
    this.turnRingTex = createRingTexture('#5fd38d', undefined, 16);
    this.turnRingMat = new FlatMaterial({
      baseColorTexture: this.turnRingTex,
      alphaMode: 'blend',
      doubleSided: true,
    });

    this.lastViewMode = this.sceneMgr.viewMode;
    this.attachPointerListeners();
  }

  /** Habilita ou pausa a seleção e o arrasto de tokens (ex.: durante o uso da régua). */
  setInteractionEnabled(enabled: boolean): void {
    this.interactionEnabled = enabled;
    if (!enabled && this.drag) {
      const id = this.drag.tokenId;
      this.drag = null;
      this.revert(id);
    }
  }

  /** Sincroniza os tokens 3D e a HUD com o estado atual da mesa. */
  setScene(scene: Scene): void {
    if (this.destroyed) return;
    this.sceneState = scene;
    const mapId = scene.map?.id;
    const visible = scene.tokens.filter((t) => t.mapId === mapId);
    const ids = new Set(visible.map((t) => t.id));

    for (const [id, entry] of this.entries) {
      if (ids.has(id)) continue;
      if (this.drag?.tokenId === id) {
        this.drag = null;
        this.sceneMgr.setLeftButtonAction('pan');
      }
      this.disposeEntry(entry);
      this.entries.delete(id);
    }

    for (const token of visible) {
      const conditions = scene.conditions(token);
      const signature = [token.name, token.size, token.image ?? '', token.ownerIds.length > 0].join('|');
      let entry = this.entries.get(token.id);
      if (entry?.signature !== signature) {
        if (entry) this.disposeEntry(entry);
        entry = this.createEntry(token, signature);
        this.entries.set(token.id, entry);
      } else {
        entry.token = token;
      }

      entry.selectRing.visible = scene.selectedId === token.id;
      entry.turnRing.visible = scene.activeId === token.id;

      const condText = conditions.join(' · ');
      entry.condLabel.text = condText;
      entry.condLabel.visible = condText.length > 0;
      drawScreenHealthBar(entry.hpBar, scene.health(token));

      if (this.drag?.tokenId !== token.id) {
        const fp = tokenTo3dFootprint(token, this.grid);
        this.placeEntry(entry, fp.centerX, fp.groundY, fp.centerZ, fp.sideMeters);
      }
    }

    this.applyViewMode(this.sceneMgr.viewMode);
    this.syncKeyboardPanMode();
  }

  private selectedMovableToken(): Token | null {
    const id = this.sceneState.selectedId;
    if (id === null) return null;
    const entry = this.entries.get(id);
    if (!entry) return null;
    return this.sceneState.canDrag(entry.token) ? entry.token : null;
  }

  private syncKeyboardPanMode(): void {
    // Quando há um token selecionável que o usuário pode mover, WASD/Setas movem o token em vez do mapa.
    this.sceneMgr.setKeyboardPanEnabled(this.selectedMovableToken() === null);
  }

  /** O Host recusou o movimento: devolve o token para a posição autoritativa. */
  revert(tokenId: string): void {
    const entry = this.entries.get(tokenId);
    const token = this.sceneState.tokens.find((t) => t.id === tokenId);
    if (!entry || !token) return;
    const fp = tokenTo3dFootprint(token, this.grid);
    this.placeEntry(entry, fp.centerX, fp.groundY, fp.centerZ, fp.sideMeters);
  }

  /** Atualiza visibilidade por modo de câmera e projeta rótulos/barras de PV na HUD 2D. */
  tick(): void {
    if (this.destroyed) return;
    const mode = this.sceneMgr.viewMode;
    if (mode !== this.lastViewMode) {
      this.lastViewMode = mode;
      this.applyViewMode(mode);
    }

    const isTopDown = mode === 'top_down';
    for (const entry of this.entries.values()) {
      const topY = isTopDown ? entry.groundY + 0.06 : entry.groundY + entry.sideMeters * 1.24;
      const baseScreen = this.sceneMgr.view.worldToScreen({
        x: entry.worldX,
        y: entry.groundY + 0.04,
        z: entry.worldZ + (isTopDown ? entry.sideMeters * 0.54 : 0),
      });
      const topScreen = this.sceneMgr.view.worldToScreen({
        x: entry.worldX,
        y: topY,
        z: entry.worldZ - (isTopDown ? entry.sideMeters * 0.54 : 0),
      });

      if (!baseScreen || !topScreen) {
        entry.hud.visible = false;
        continue;
      }
      entry.hud.visible = true;
      entry.hpBar.position.set(baseScreen.x, baseScreen.y + 4);
      entry.nameLabel.position.set(baseScreen.x, baseScreen.y + (entry.hpBar.visible ? HEALTH_BAR_HEIGHT + 8 : 4));
      entry.condLabel.position.set(topScreen.x, topScreen.y - 4);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.eventAbort.abort();
    this.sceneMgr.setKeyboardPanEnabled(true);
    for (const entry of this.entries.values()) {
      this.disposeEntry(entry);
    }
    this.entries.clear();
    this.sceneMgr.worldRoot.removeChild(this.tokensRoot);
    this.tokensRoot.destroy({ children: true });
    this.sceneMgr.hudLayer.removeChild(this.hudContainer);
    this.hudContainer.destroy({ children: true });
    this.planeGeo.destroy(true);
    this.selectRingMat.destroy();
    this.selectRingTex.destroy(true);
    this.turnRingMat.destroy();
    this.turnRingTex.destroy(true);
  }

  private getImage(sha256: string): Promise<HTMLImageElement | null> {
    let p = this.imageCache.get(sha256);
    if (!p) {
      p = loadTokenImage(sha256);
      this.imageCache.set(sha256, p);
    }
    return p;
  }

  private createEntry(token: Token, signature: string): Token3dEntry {
    const fillCss = token.ownerIds.length > 0 ? COLORS.playerToken : COLORS.otherToken;
    const medallionTex = createMedallionTexture(token.name, fillCss, null);
    const baseTex = createRingTexture(fillCss, `${fillCss}38`, 18);

    const root = new Container3D({ label: `token_${token.id}` });
    this.tokensRoot.addChild(root);

    const topDownMat = new FlatMaterial({
      baseColorTexture: medallionTex,
      alphaMode: 'blend',
      doubleSided: true,
    });
    const topDownMesh = new Mesh3D({
      geometry: this.planeGeo,
      material: topDownMat,
      castShadow: false,
      receiveShadow: false,
      label: `token_topdown_${token.id}`,
    });
    topDownMesh.rotation.set(-Math.PI / 2, 0, 0);

    const baseMat = new FlatMaterial({
      baseColorTexture: baseTex,
      alphaMode: 'blend',
      doubleSided: true,
    });
    const baseMesh = new Mesh3D({
      geometry: this.planeGeo,
      material: baseMat,
      castShadow: false,
      receiveShadow: false,
      label: `token_base_${token.id}`,
    });
    baseMesh.rotation.set(-Math.PI / 2, 0, 0);

    const billboardMat = new FlatMaterial({
      baseColorTexture: medallionTex,
      alphaMode: 'blend',
      doubleSided: true,
    });
    const billboardMesh = new Mesh3D({
      geometry: this.planeGeo,
      material: billboardMat,
      billboardMode: 'cylindrical',
      castShadow: false,
      receiveShadow: false,
      label: `token_billboard_${token.id}`,
    });

    const selectRing = new Mesh3D({
      geometry: this.planeGeo,
      material: this.selectRingMat,
      castShadow: false,
      receiveShadow: false,
      label: `token_select_${token.id}`,
    });
    selectRing.rotation.set(-Math.PI / 2, 0, 0);
    selectRing.visible = false;

    const turnRing = new Mesh3D({
      geometry: this.planeGeo,
      material: this.turnRingMat,
      castShadow: false,
      receiveShadow: false,
      label: `token_turn_${token.id}`,
    });
    turnRing.rotation.set(-Math.PI / 2, 0, 0);
    turnRing.visible = false;

    root.addChild(turnRing, baseMesh, topDownMesh, selectRing, billboardMesh);

    const hud = new Container();
    const nameLabel = new Text({
      text: token.name,
      style: {
        fill: COLORS.label,
        fontSize: 12,
        fontWeight: '600',
        fontFamily: 'system-ui, sans-serif',
        stroke: { color: COLORS.background, width: 3 },
      },
      resolution: 2,
    });
    nameLabel.anchor.set(0.5, 0);

    const condLabel = new Text({
      text: '',
      style: {
        fill: COLORS.condition,
        fontSize: 11,
        fontWeight: '600',
        fontFamily: 'system-ui, sans-serif',
        stroke: { color: COLORS.background, width: 3 },
      },
      resolution: 2,
    });
    condLabel.anchor.set(0.5, 1);
    condLabel.visible = false;

    const hpBar = new Graphics();
    hpBar.visible = false;
    hud.addChild(hpBar, nameLabel, condLabel);
    this.hudContainer.addChild(hud);

    const entry: Token3dEntry = {
      token,
      signature,
      root,
      topDownMesh,
      topDownMat,
      baseMesh,
      baseMat,
      billboardMesh,
      billboardMat,
      selectRing,
      turnRing,
      medallionTex,
      baseTex,
      hud,
      nameLabel,
      condLabel,
      hpBar,
      worldX: 0,
      worldZ: 0,
      groundY: 0,
      sideMeters: TILE_SIZE_METERS,
    };

    if (token.image !== null) {
      const sha = token.image;
      void this.getImage(sha).then((img) => {
        if (!img || this.destroyed || this.entries.get(token.id) !== entry) return;
        const nextTex = createMedallionTexture(token.name, fillCss, img);
        const prevTex = entry.medallionTex;
        entry.medallionTex = nextTex;
        entry.topDownMat.textures.baseColor = nextTex;
        entry.billboardMat.textures.baseColor = nextTex;
        prevTex.destroy(true);
      });
    }

    return entry;
  }

  private placeEntry(entry: Token3dEntry, worldX: number, groundY: number, worldZ: number, sideMeters: number): void {
    entry.worldX = worldX;
    entry.groundY = groundY;
    entry.worldZ = worldZ;
    entry.sideMeters = sideMeters;

    entry.root.position.set(worldX, groundY, worldZ);

    entry.topDownMesh.scale.set(sideMeters * 0.94, sideMeters * 0.94, 1);
    entry.topDownMesh.position.set(0, 0.05, 0);

    entry.baseMesh.scale.set(sideMeters * 0.92, sideMeters * 0.92, 1);
    entry.baseMesh.position.set(0, 0.03, 0);

    const standeeSize = sideMeters * 0.94;
    entry.billboardMesh.scale.set(standeeSize, standeeSize, 1);
    entry.billboardMesh.position.set(0, 0.04 + standeeSize * 0.5, 0);

    entry.selectRing.scale.set(sideMeters * 1.02, sideMeters * 1.02, 1);
    entry.selectRing.position.set(0, 0.06, 0);

    entry.turnRing.scale.set(sideMeters * 1.14, sideMeters * 1.14, 1);
    entry.turnRing.position.set(0, 0.045, 0);
  }

  private applyViewMode(mode: CameraViewMode): void {
    const isTopDown = mode === 'top_down';
    for (const entry of this.entries.values()) {
      entry.topDownMesh.visible = isTopDown;
      entry.baseMesh.visible = !isTopDown;
      entry.billboardMesh.visible = !isTopDown;
    }
  }

  private disposeEntry(entry: Token3dEntry): void {
    this.tokensRoot.removeChild(entry.root);
    entry.root.destroy({ children: true });
    entry.topDownMat.destroy();
    entry.baseMat.destroy();
    entry.billboardMat.destroy();
    entry.medallionTex.destroy(true);
    entry.baseTex.destroy(true);
    this.hudContainer.removeChild(entry.hud);
    entry.hud.destroy({ children: true });
  }

  private attachPointerListeners(): void {
    const canvas = this.sceneMgr.app.canvas;
    const { signal } = this.eventAbort;

    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); }, { signal });

    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.interactionEnabled || e.button !== 0) return;
        this.downClient = { x: e.clientX, y: e.clientY };
        const ray = this.sceneMgr.clientPointToRay(e.clientX, e.clientY);
        const visibleTokens = Array.from(this.entries.values(), (entry) => entry.token);
        const hit = pickToken3d(ray, visibleTokens, this.grid, this.sceneMgr.viewMode);
        if (!hit) return;

        // Bloqueia o OrbitCamera de receber este clique: arrastar o token nunca arrasta o mapa junto.
        e.stopImmediatePropagation();
        e.preventDefault();

        this.events.onSelect(hit.id);
        if (this.sceneState.canDrag(hit)) {
          this.drag = { tokenId: hit.id, moved: false };
          this.sceneMgr.setLeftButtonAction('none');
          canvas.style.cursor = 'grabbing';
        }
      },
      { capture: true, signal },
    );

    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.drag) return;
        e.stopImmediatePropagation();
        const entry = this.entries.get(this.drag.tokenId);
        if (!entry) return;
        const ray = this.sceneMgr.clientPointToRay(e.clientX, e.clientY);
        const terrainHit = pickTerrain(this.grid, ray);
        if (!terrainHit) return;
        this.drag.moved = true;
        const groundY = this.grid.sampleHeightAtTileCoord(terrainHit.tileFloatX, terrainHit.tileFloatZ) * METERS_PER_HEIGHT_UNIT;
        this.placeEntry(entry, terrainHit.worldX, groundY, terrainHit.worldZ, entry.sideMeters);
      },
      { capture: true, signal },
    );

    const endDrag = (e: PointerEvent): void => {
      const activeDrag = this.drag;
      const down = this.downClient;
      this.downClient = null;

      if (!activeDrag) {
        if (this.interactionEnabled && down && e.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
          const ray = this.sceneMgr.clientPointToRay(e.clientX, e.clientY);
          const visibleTokens = Array.from(this.entries.values(), (entry) => entry.token);
          if (!pickToken3d(ray, visibleTokens, this.grid, this.sceneMgr.viewMode)) {
            this.events.onSelect(null);
          }
        }
        return;
      }

      this.drag = null;
      canvas.style.cursor = '';
      this.sceneMgr.setLeftButtonAction('pan');

      const entry = this.entries.get(activeDrag.tokenId);
      const map = this.sceneState.map;
      if (!entry || !map) return;

      const to = world3dToTokenCorner(entry.worldX, entry.worldZ, entry.token.size, map);
      const snappedFp = tokenTo3dFootprint({ position: to, size: entry.token.size }, this.grid);
      this.placeEntry(entry, snappedFp.centerX, snappedFp.groundY, snappedFp.centerZ, snappedFp.sideMeters);

      if (to.x !== entry.token.position.x || to.y !== entry.token.position.y) {
        this.events.onMove(entry.token.id, to);
      }
    };

    window.addEventListener('pointerup', endDrag, { signal });
    window.addEventListener('pointercancel', endDrag, { signal });

    window.addEventListener(
      'keydown',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
          return;
        }
        if (e.code === 'Escape' && this.sceneState.selectedId !== null) {
          this.events.onSelect(null);
          return;
        }
        const token = this.selectedMovableToken();
        const map = this.sceneState.map;
        if (!token || !map) return;

        let forward: -1 | 0 | 1 = 0;
        let strafe: -1 | 0 | 1 = 0;
        if (e.code === 'KeyW' || e.code === 'ArrowUp') forward = 1;
        else if (e.code === 'KeyS' || e.code === 'ArrowDown') forward = -1;
        else if (e.code === 'KeyD' || e.code === 'ArrowRight') strafe = 1;
        else if (e.code === 'KeyA' || e.code === 'ArrowLeft') strafe = -1;
        else return;

        e.preventDefault();
        const to = stepTokenByCameraDirection(token, map, this.sceneMgr.orbit.azimuthAngle, forward, strafe);
        if (to.x !== token.position.x || to.y !== token.position.y) {
          this.events.onMove(token.id, to);
        }
      },
      { signal },
    );
  }
}
