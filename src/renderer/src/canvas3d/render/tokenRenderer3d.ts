import { Container3D, FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';
import { Container, Graphics, ImageSource, Text, Texture } from 'pixi.js';
import type { Point, Token } from '../../../../shared/protocol';
import { stepRotation, toggleSelection } from '../../canvas/geometry';
import { type Health, healthColor } from '../../canvas/health';
import type { Scene } from '../../canvas/MapStage';
import { METERS_PER_FOOT, METERS_PER_HEIGHT_UNIT, TILE_SIZE_METERS } from '../terrain/constants';
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
  target: '#ff5a5f',
  elevation: 0x6fb6ff,
  condition: 0xffd166,
  label: 0xe8e6ef,
  tempHp: 0x6fb6ff,
};

const HEALTH_BAR_WIDTH = 56;
const HEALTH_BAR_HEIGHT = 6;
const TEX_SIZE = 256;
const DRAG_THRESHOLD_PX = 5;
const DOUBLE_CLICK_MS = 350;

export interface TokenRenderer3dEvents {
  onSelect: (tokenIds: string[]) => void;
  onMove: (tokenId: string, to: Point) => void;
  onRotate: (tokenId: string, rotation: number) => void;
  onOpenSheet: (tokenId: string) => void;
  onOpenHud: (tokenId: string, screenPos: Point) => void;
  onCloseHud: () => void;
  onToggleTarget: (tokenId: string) => void;
}

interface Token3dEntry {
  token: Token;
  signature: string;
  root: Container3D;
  /** Grupo rotacionado em torno de Y conforme `token.rotation`. */
  facingGroup: Container3D;
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
  /** Retículo vermelho de alvo no chão. */
  targetRing: Mesh3D;
  /** Textura procedural do medalhão (descartada ao atualizar/destruir). */
  medallionTex: Texture;
  /** Textura da base circular (descartada ao atualizar/destruir). */
  baseTex: Texture;
  /** HUD 2D projetada na tela (nome, PV, condições, elevação). */
  hud: Container;
  nameLabel: Text;
  condLabel: Text;
  elevLabel: Text;
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

/** Gera uma textura circular de anel (para base, seleção, turno ou retículo de alvo). */
function createRingTexture(strokeCss: string, fillCss?: string, lineWidth = 14, withFacingArrow = false, withTargetTicks = false): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = TEX_SIZE / 2;
    const r = half - lineWidth - (withTargetTicks ? 12 : 0);
    ctx.beginPath();
    ctx.arc(half, half, r, 0, Math.PI * 2);
    if (fillCss) {
      ctx.fillStyle = fillCss;
      ctx.fill();
    }
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeCss;
    ctx.stroke();

    if (withFacingArrow) {
      const tipY = half - r - 6;
      ctx.beginPath();
      ctx.moveTo(half, tipY);
      ctx.lineTo(half - 16, tipY + 24);
      ctx.lineTo(half + 16, tipY + 24);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = COLORS.outline;
      ctx.stroke();
    }

    if (withTargetTicks) {
      ctx.beginPath();
      const tick = 22;
      ctx.moveTo(half, half - r - tick / 2);
      ctx.lineTo(half, half - r + tick / 2);
      ctx.moveTo(half, half + r - tick / 2);
      ctx.lineTo(half, half + r + tick / 2);
      ctx.moveTo(half - r - tick / 2, half);
      ctx.lineTo(half - r + tick / 2, half);
      ctx.moveTo(half + r - tick / 2, half);
      ctx.lineTo(half + r + tick / 2, half);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = strokeCss;
      ctx.stroke();
    }
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
  private readonly targetRingTex: Texture;
  private readonly targetRingMat: FlatMaterial;
  private readonly entries = new Map<string, Token3dEntry>();
  private readonly imageCache = new Map<string, Promise<HTMLImageElement | null>>();
  private readonly eventAbort = new AbortController();

  private sceneState: Scene = {
    map: null,
    tokens: [],
    canDrag: () => false,
    selectedIds: [],
    targetedIds: [],
    activeId: null,
    conditions: () => [],
    health: () => null,
    viewer: { role: 'player', playerId: '' },
    fogTool: 'none',
  };

  private drag: {
    primaryId: string;
    startClient: Point;
    started: boolean;
    shiftOnDown: boolean;
    items: { id: string; originWorldX: number; originWorldZ: number; offsetX: number; offsetZ: number }[];
  } | null = null;
  private downClient: { x: number; y: number; button: number; tokenId: string | null } | null = null;
  private lastLeftClick: { time: number; tokenId: string } | null = null;
  private lastRightClick: { time: number; tokenId: string } | null = null;
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
    this.targetRingTex = createRingTexture(COLORS.target, undefined, 14, false, true);
    this.targetRingMat = new FlatMaterial({
      baseColorTexture: this.targetRingTex,
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
      this.cancelDrag();
    }
  }

  /** Encerra o estado de arrasto e devolve a câmera. */
  private endDragMode(): void {
    this.drag = null;
    this.sceneMgr.orbit.enabled = true;
    this.sceneMgr.app.canvas.style.cursor = '';
  }

  private cancelDrag(): void {
    const activeDrag = this.drag;
    if (!activeDrag) return;
    this.endDragMode();
    for (const item of activeDrag.items) {
      this.revert(item.id);
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
      if (this.drag?.items.some((item) => item.id === id)) {
        this.cancelDrag();
      }
      this.disposeEntry(entry);
      this.entries.delete(id);
    }

    const selectedSet = new Set(scene.selectedIds);
    const targetedSet = new Set(scene.targetedIds);

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

      entry.selectRing.visible = selectedSet.has(token.id);
      entry.turnRing.visible = scene.activeId === token.id;
      entry.targetRing.visible = targetedSet.has(token.id);
      entry.facingGroup.rotation.y = (-token.rotation * Math.PI) / 180;

      const condText = conditions.join(' · ');
      entry.condLabel.text = condText;
      entry.condLabel.visible = condText.length > 0;
      if (token.elevation !== 0) {
        entry.elevLabel.text = token.elevation > 0 ? `↑ ${token.elevation} ft` : `↓ ${Math.abs(token.elevation)} ft`;
        entry.elevLabel.visible = true;
      } else {
        entry.elevLabel.visible = false;
      }
      drawScreenHealthBar(entry.hpBar, scene.health(token));

      const isDragged = this.drag?.started === true && this.drag.items.some((item) => item.id === token.id);
      if (!isDragged) {
        const fp = tokenTo3dFootprint(token, this.grid);
        this.placeEntry(entry, fp.centerX, fp.groundY, fp.centerZ, fp.sideMeters);
      }
    }

    this.applyViewMode(this.sceneMgr.viewMode);
    this.syncKeyboardPanMode();
  }

  private selectedMovableTokens(): Token[] {
    const out: Token[] = [];
    for (const id of this.sceneState.selectedIds) {
      const entry = this.entries.get(id);
      if (entry && this.sceneState.canDrag(entry.token)) out.push(entry.token);
    }
    return out;
  }

  private syncKeyboardPanMode(): void {
    // Quando há ao menos um token selecionado que o usuário pode mover, WASD/Setas movem os tokens em vez do mapa.
    this.sceneMgr.setKeyboardPanEnabled(this.selectedMovableTokens().length === 0);
  }

  /** O Host recusou o movimento: devolve o token para a posição autoritativa. */
  revert(tokenId: string): void {
    const entry = this.entries.get(tokenId);
    const token = this.sceneState.tokens.find((t) => t.id === tokenId);
    if (!entry || !token) return;
    const fp = tokenTo3dFootprint(token, this.grid);
    this.placeEntry(entry, fp.centerX, fp.groundY, fp.centerZ, fp.sideMeters);
    entry.facingGroup.rotation.y = (-token.rotation * Math.PI) / 180;
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
      entry.elevLabel.position.set(topScreen.x, topScreen.y - (entry.condLabel.visible ? 18 : 4));
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.eventAbort.abort();
    if (this.drag) {
      this.drag = null;
      this.sceneMgr.orbit.enabled = true;
    }
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
    this.targetRingMat.destroy();
    this.targetRingTex.destroy(true);
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
    const baseTex = createRingTexture(fillCss, `${fillCss}38`, 18, true);

    const root = new Container3D({ label: `token_${token.id}` });
    this.tokensRoot.addChild(root);

    const facingGroup = new Container3D({ label: `token_facing_${token.id}` });

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

    facingGroup.addChild(baseMesh, topDownMesh);

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

    const targetRing = new Mesh3D({
      geometry: this.planeGeo,
      material: this.targetRingMat,
      castShadow: false,
      receiveShadow: false,
      label: `token_target_${token.id}`,
    });
    targetRing.rotation.set(-Math.PI / 2, 0, 0);
    targetRing.visible = false;

    root.addChild(turnRing, targetRing, facingGroup, selectRing, billboardMesh);

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

    const elevLabel = new Text({
      text: '',
      style: {
        fill: COLORS.elevation,
        fontSize: 11,
        fontWeight: '700',
        fontFamily: 'system-ui, sans-serif',
        stroke: { color: COLORS.background, width: 3 },
      },
      resolution: 2,
    });
    elevLabel.anchor.set(0.5, 1);
    elevLabel.visible = false;

    const hpBar = new Graphics();
    hpBar.visible = false;
    hud.addChild(hpBar, nameLabel, condLabel, elevLabel);
    this.hudContainer.addChild(hud);

    const entry: Token3dEntry = {
      token,
      signature,
      root,
      facingGroup,
      topDownMesh,
      topDownMat,
      baseMesh,
      baseMat,
      billboardMesh,
      billboardMat,
      selectRing,
      turnRing,
      targetRing,
      medallionTex,
      baseTex,
      hud,
      nameLabel,
      condLabel,
      elevLabel,
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

    entry.baseMesh.scale.set(sideMeters * 0.96, sideMeters * 0.96, 1);
    entry.baseMesh.position.set(0, 0.03, 0);

    const standeeSize = sideMeters * 0.94;
    entry.billboardMesh.scale.set(standeeSize, standeeSize, 1);
    entry.billboardMesh.position.set(0, 0.04 + standeeSize * 0.5, 0);

    entry.selectRing.scale.set(sideMeters * 1.02, sideMeters * 1.02, 1);
    entry.selectRing.position.set(0, 0.06, 0);

    entry.turnRing.scale.set(sideMeters * 1.14, sideMeters * 1.14, 1);
    entry.turnRing.position.set(0, 0.045, 0);

    entry.targetRing.scale.set(sideMeters * 1.24, sideMeters * 1.24, 1);
    entry.targetRing.position.set(0, 0.055, 0);
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

    // Roda do mouse com Ctrl/Cmd (devagar) ou Shift (rápido) gira tokens selecionados sem dar zoom.
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          const controllable = this.selectedMovableTokens();
          if (controllable.length > 0) {
            e.stopImmediatePropagation();
            e.preventDefault();
            const fast = e.shiftKey;
            for (const token of controllable) {
              const next = stepRotation(token.rotation, e.deltaY, fast);
              const entry = this.entries.get(token.id);
              if (entry) entry.facingGroup.rotation.y = (-next * Math.PI) / 180;
              if (next !== token.rotation) this.events.onRotate(token.id, next);
            }
            return;
          }
        }
        this.events.onCloseHud();
      },
      { capture: true, passive: false, signal },
    );

    // O EventSystem do PixiJS v8 registra `pointerdown` no canvas e `pointermove` no `document`
    // em fase de captura durante `app.init()`, antes do TokenRenderer3d existir. Escutar em
    // `window` na captura garante execução anterior ao PixiJS/OrbitCamera para que arrastar
    // um token nunca mova o mapa junto.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.target !== canvas) return;

        if (e.button === 1) {
          this.events.onCloseHud();
          return;
        }

        if (e.button === 2) {
          const ray = this.sceneMgr.clientPointToRay(e.clientX, e.clientY);
          const visibleTokens = Array.from(this.entries.values(), (entry) => entry.token);
          const hit = pickToken3d(ray, visibleTokens, this.grid, this.sceneMgr.viewMode);
          this.downClient = { x: e.clientX, y: e.clientY, button: 2, tokenId: hit?.id ?? null };
          return;
        }

        if (!this.interactionEnabled || e.button !== 0) return;

        this.events.onCloseHud();
        const ray = this.sceneMgr.clientPointToRay(e.clientX, e.clientY);
        const visibleTokens = Array.from(this.entries.values(), (entry) => entry.token);
        const hit = pickToken3d(ray, visibleTokens, this.grid, this.sceneMgr.viewMode);
        this.downClient = { x: e.clientX, y: e.clientY, button: 0, tokenId: hit?.id ?? null };

        if (!hit) return;

        // Bloqueia o PixiJS/OrbitCamera de receber este clique: arrastar o token nunca arrasta o mapa junto.
        e.stopImmediatePropagation();
        e.stopPropagation();
        e.preventDefault();

        // Duplo clique esquerdo abre a ficha referenciada pelo token.
        const now = performance.now();
        if (!e.shiftKey && this.lastLeftClick && this.lastLeftClick.tokenId === hit.id && now - this.lastLeftClick.time <= DOUBLE_CLICK_MS) {
          this.lastLeftClick = null;
          this.events.onSelect([hit.id]);
          this.events.onOpenSheet(hit.id);
          return;
        }
        this.lastLeftClick = { time: now, tokenId: hit.id };

        const alreadySelected = this.sceneState.selectedIds.includes(hit.id);
        if (!e.shiftKey && !alreadySelected) {
          this.events.onSelect([hit.id]);
        }

        if (this.sceneState.canDrag(hit)) {
          const terrainHit = pickTerrain(this.grid, ray);
          const groupIds = !e.shiftKey && alreadySelected ? this.sceneState.selectedIds : [hit.id];
          const items: { id: string; originWorldX: number; originWorldZ: number; offsetX: number; offsetZ: number }[] = [];
          for (const gid of groupIds) {
            const entry = this.entries.get(gid);
            if (entry && this.sceneState.canDrag(entry.token)) {
              const offsetX = terrainHit ? entry.worldX - terrainHit.worldX : 0;
              const offsetZ = terrainHit ? entry.worldZ - terrainHit.worldZ : 0;
              items.push({ id: gid, originWorldX: entry.worldX, originWorldZ: entry.worldZ, offsetX, offsetZ });
            }
          }
          if (items.length > 0) {
            this.drag = {
              primaryId: hit.id,
              startClient: { x: e.clientX, y: e.clientY },
              started: false,
              shiftOnDown: e.shiftKey,
              items,
            };
            this.sceneMgr.orbit.enabled = false;
          }
        } else if (e.shiftKey) {
          this.events.onSelect(toggleSelection(this.sceneState.selectedIds, hit.id, true));
        } else if (alreadySelected && this.sceneState.selectedIds.length > 1) {
          this.events.onSelect([hit.id]);
        }
      },
      { capture: true, signal },
    );

    window.addEventListener(
      'pointermove',
      (e) => {
        if (this.downClient?.button === 2 && Math.hypot(e.clientX - this.downClient.x, e.clientY - this.downClient.y) >= DRAG_THRESHOLD_PX) {
          this.events.onCloseHud();
        }
        if (!this.drag) return;
        e.stopImmediatePropagation();
        e.stopPropagation();
        // Apertar o direito com o esquerdo já apertado não gera `pointerdown` (Pointer Events):
        // chega como `pointermove` com o botão em `buttons`. Cancela o arrasto.
        if ((e.buttons & 2) !== 0) {
          this.cancelDrag();
          return;
        }
        if (!this.drag.started) {
          if (Math.hypot(e.clientX - this.drag.startClient.x, e.clientY - this.drag.startClient.y) < DRAG_THRESHOLD_PX) {
            return;
          }
          this.drag.started = true;
          canvas.style.cursor = 'grabbing';
        }
        const ray = this.sceneMgr.clientPointToRay(e.clientX, e.clientY);
        const terrainHit = pickTerrain(this.grid, ray);
        if (!terrainHit) return;
        for (const item of this.drag.items) {
          const entry = this.entries.get(item.id);
          if (!entry) continue;
          const worldX = terrainHit.worldX + item.offsetX;
          const worldZ = terrainHit.worldZ + item.offsetZ;
          const tileX = worldX / TILE_SIZE_METERS;
          const tileZ = worldZ / TILE_SIZE_METERS;
          const groundY =
            this.grid.sampleHeightAtTileCoord(tileX, tileZ) * METERS_PER_HEIGHT_UNIT +
            entry.token.elevation * METERS_PER_FOOT;
          this.placeEntry(entry, worldX, groundY, worldZ, entry.sideMeters);
        }
      },
      { capture: true, signal },
    );

    const endDrag = (e: PointerEvent): void => {
      const down = this.downClient;
      if (e.button === 2) {
        this.downClient = null;
        if (down?.button === 2 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_THRESHOLD_PX) {
          if (down.tokenId !== null) {
            const now = performance.now();
            if (this.lastRightClick && this.lastRightClick.tokenId === down.tokenId && now - this.lastRightClick.time <= DOUBLE_CLICK_MS) {
              this.lastRightClick = null;
              this.events.onCloseHud();
              this.events.onToggleTarget(down.tokenId);
              return;
            }
            this.lastRightClick = { time: now, tokenId: down.tokenId };
            const rect = canvas.getBoundingClientRect();
            this.events.onOpenHud(down.tokenId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
          } else {
            this.events.onCloseHud();
          }
        }
        return;
      }

      if (e.button !== 0) return;

      const activeDrag = this.drag;
      this.downClient = null;

      if (!activeDrag) {
        if (this.interactionEnabled && down?.button === 0 && down.tokenId === null && !e.shiftKey && Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_THRESHOLD_PX) {
          this.events.onSelect([]);
        }
        return;
      }

      this.endDragMode();

      if (!activeDrag.started) {
        if (activeDrag.shiftOnDown) {
          this.events.onSelect(toggleSelection(this.sceneState.selectedIds, activeDrag.primaryId, true));
        } else if (this.sceneState.selectedIds.length > 1) {
          this.events.onSelect([activeDrag.primaryId]);
        }
        return;
      }

      const map = this.sceneState.map;
      if (!map) return;
      const snapToGrid = !e.shiftKey;

      for (const item of activeDrag.items) {
        const entry = this.entries.get(item.id);
        if (!entry) continue;
        const to = world3dToTokenCorner(entry.worldX, entry.worldZ, entry.token.size, map, snapToGrid);
        const snappedFp = tokenTo3dFootprint({ position: to, size: entry.token.size, elevation: entry.token.elevation }, this.grid);
        this.placeEntry(entry, snappedFp.centerX, snappedFp.groundY, snappedFp.centerZ, snappedFp.sideMeters);

        if (to.x !== entry.token.position.x || to.y !== entry.token.position.y) {
          this.events.onMove(entry.token.id, to);
        }
      }
    };

    window.addEventListener('pointerup', endDrag, { signal });
    // O sistema interrompeu o ponteiro: volta os tokens sem aplicar o movimento.
    window.addEventListener(
      'pointercancel',
      () => {
        this.downClient = null;
        this.cancelDrag();
      },
      { signal },
    );

    window.addEventListener(
      'keydown',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
          return;
        }
        if (e.code === 'Escape' && this.sceneState.selectedIds.length > 0) {
          this.events.onSelect([]);
          return;
        }
        const tokens = this.selectedMovableTokens();
        const map = this.sceneState.map;
        if (tokens.length === 0 || !map) return;

        let forward: -1 | 0 | 1 = 0;
        let strafe: -1 | 0 | 1 = 0;
        if (e.code === 'KeyW' || e.code === 'ArrowUp') forward = 1;
        else if (e.code === 'KeyS' || e.code === 'ArrowDown') forward = -1;
        else if (e.code === 'KeyD' || e.code === 'ArrowRight') strafe = 1;
        else if (e.code === 'KeyA' || e.code === 'ArrowLeft') strafe = -1;
        else return;

        e.preventDefault();
        for (const token of tokens) {
          const to = stepTokenByCameraDirection(token, map, this.sceneMgr.orbit.azimuthAngle, forward, strafe);
          if (to.x !== token.position.x || to.y !== token.position.y) {
            this.events.onMove(token.id, to);
          }
        }
      },
      { signal },
    );
  }
}
