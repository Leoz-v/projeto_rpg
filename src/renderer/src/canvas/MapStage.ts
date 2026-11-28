// O PixiJS gera código de shader com `new Function`, que a CSP da tela bloqueia; este módulo troca por versões prontas.
import 'pixi.js/unsafe-eval';
import { Application, BufferImageSource, CanvasSource, Container, type FederatedPointerEvent, Graphics, ImageSource, Sprite, Text, Texture } from 'pixi.js';
import type { GridCell } from 'rules-engine/space';
import type { VisionProfile } from 'rules-engine/vision';
import {
  type ExtractedPropLight,
  type FogCell,
  type FogMode,
  type GameMap,
  type NewWallSegment,
  type Point,
  pointToSegmentDistance,
  type SessionState,
  type Token,
  type WallKind,
  type WallSegment,
  WORLD_UNITS_PER_CELL,
} from '../../../shared/protocol';
import { snapWallCoord, type WallTool } from '../components/lighting-hud-helpers';
import {
  clampFogCell,
  fogSignature,
  type FogTool,
  type FogViewer,
  isViewerObserverToken,
  worldToFogCell,
} from './fog-render';
import { type Camera, fitMap, placeToken, screenToWorld, stepRotation, toggleSelection, tokenSide, worldToScreen, zoomAt } from './geometry';
import { type Health, healthColor } from './health';
import { composeSmooth2dVisionAndLight, type VisionMaskBuffer } from './lighting-2d';
import { backgroundWorldSize } from './map-grid';
import {
  DEFAULT_RULER_OPTIONS,
  formatRulerLabel,
  gridCellCenterWorld,
  measureRulerPath,
  measureRulerRadius,
  type RulerOptions,
  worldToGridCell,
} from './ruler';
import { VisionLightingFilter } from './vision-filter';

/**
 * O mapa em PixiJS v8, desacoplado do React (CLAUDE.md): a tela entrega a
 * cena (`setScene`) e recebe as intenções (`onMove`, `onSelect`). Nada aqui
 * muda o estado da campanha: soltar um token só pede o `token.move`; quem
 * decide é o Host, e a posição volta pela próxima cena.
 */

export interface RenderedMapBackground {
  /** Identificador de cache (ex.: SHA-256 do `scene3d`). */
  key: string;
  source: HTMLCanvasElement;
  cellPx: number;
}

export interface Scene {
  map: GameMap | null;
  /** Fundo 2D renderizado a partir de um mapa 3D (câmera de topo), quando aberto no visualizador 2D. */
  renderedBackground?: RenderedMapBackground | null;
  tokens: readonly Token[];
  /** O usuário pode arrastar este token (mestre, ou dono do token). */
  canDrag: (token: Token) => boolean;
  /** Tokens selecionados (Shift+clique permite múltiplos). */
  selectedIds: readonly string[];
  /** Tokens marcados como alvo (duplo clique direito). */
  targetedIds: readonly string[];
  /** Token do combatente da vez, ou `null` (sem combate). */
  activeId: string | null;
  /** Condições do token em pt-BR, para o rótulo acima dele. */
  conditions: (token: Token) => readonly string[];
  /** PV para a barra do token, ou `null` (sem barra). */
  health: (token: Token) => Health | null;
  /** Se o token deve exibir a marca visual de morto (0 PV / `deathSaves.dead` / override do mestre). */
  isDead: (token: Token) => boolean;
  /** Quem está vendo o mapa (mestre ou jogador), para a névoa de guerra. */
  viewer: FogViewer;
  /** Ferramenta de edição de névoa ativa (só para o mestre). */
  fogTool: FogTool;
  /** Ferramenta de edição de paredes/portas no 2D (só para o mestre). */
  wallTool?: WallTool;
  /** Perfis de visão por token vindos da ficha/monstro (IPC). */
  visionProfiles?: Readonly<Record<string, VisionProfile>>;
  /** Personagens da sessão, para associar dono e condições à visão. */
  characters?: SessionState['characters'];
  /** Fontes de luz embutidas no documento 3D do mapa ativo, se houver. */
  bakedPropLights?: readonly ExtractedPropLight[];
}

export interface MapStageHandle {
  /** Centro da área visível em unidades lógicas do mundo: onde o mestre coloca um token novo. */
  viewCenter(): Point;
}

export interface MapStageEvents {
  onMove: (tokenId: string, to: Point) => void;
  onSelect: (tokenIds: string[]) => void;
  onRotate: (tokenId: string, rotation: number) => void;
  onOpenSheet: (tokenId: string) => void;
  onOpenHud: (tokenId: string, screenPos: Point) => void;
  onCloseHud: () => void;
  onToggleTarget: (tokenId: string) => void;
  onFogPaint: (mapId: string, mode: FogMode, cells: FogCell[]) => void;
  onFogRect: (mapId: string, mode: FogMode, from: FogCell, to: FogCell) => void;
  onDoorToggle?: (mapId: string, wallId: string) => void;
  onLightToggle?: (mapId: string, lightId: string) => void;
  onPropLightToggle?: (mapId: string, propLightId: string, nextState: 'on' | 'off') => void;
  onWallAdd?: (mapId: string, wall: NewWallSegment) => void;
  onWallRemove?: (mapId: string, wallIds: string[]) => void;
}

const COLORS = {
  background: 0x16151a,
  mapFloor: 0x22212a,
  grid: 0xffffff,
  border: 0x8f7cf7,
  playerToken: 0x8f7cf7,
  otherToken: 0xc0504d,
  outline: 0x14121c,
  selected: 0xffd166,
  active: 0x5fd38d,
  target: 0xff5a5f,
  facing: 0xffffff,
  elevation: 0x6fb6ff,
  condition: 0xffd166,
  label: 0xe8e6ef,
  rulerLine: 0xffd166,
  rulerStart: 0x38bdf8,
  rulerEnd: 0xff7849,
  rulerArea: 0xff7849,
  rulerBadgeBg: 0x0f131a,
  deadCross: 0xff5555,
  hiddenRing: 0xa799ff,
};

const ZOOM_SPEED = 0.0015;
const HEALTH_BAR_HEIGHT = 10;
const TEMP_HP_COLOR = 0x6fb6ff;
const DRAG_THRESHOLD_PX = 5;
const DOUBLE_CLICK_MS = 350;

/** Barra de PV sob o token: fundo, PV atuais na cor do estado e os temporários em azul por cima. */
function drawHealthBar(bar: Graphics, side: number, health: Health | null): void {
  bar.clear();
  bar.visible = health !== null;
  if (!health) return;
  const width = side * 0.9;
  const x = (side - width) / 2;
  const total = Math.max(health.max, health.current + health.temp);
  bar.roundRect(x - 2, -2, width + 4, HEALTH_BAR_HEIGHT + 4, 4).fill(COLORS.outline);
  if (health.current > 0) bar.rect(x, 0, (width * health.current) / total, HEALTH_BAR_HEIGHT).fill(healthColor(health));
  if (health.temp > 0) bar.rect(x + (width * health.current) / total, 0, (width * health.temp) / total, HEALTH_BAR_HEIGHT).fill(TEMP_HP_COLOR);
}

interface TokenView {
  container: Container;
  /** Corpo rotacionável do token (disco, retrato e indicador de frente). */
  body: Container;
  /** Anel de seleção: só aparece ou some, sem redesenhar o token. */
  ring: Graphics;
  /** Anel do combatente da vez, como o de seleção. */
  turn: Graphics;
  /** Retículo de alvo (duplo clique direito). */
  targetRing: Graphics;
  /** Rótulo de elevação (visível quando `elevation !== 0`). */
  elevationLabel: Text;
  /** Barra de PV, redesenhada a cada cena (barata). */
  bar: Graphics;
  /** O que, se mudar, exige redesenhar (posição, seleção, rotação e cursor não exigem). */
  signature: string;
}

interface DragItem {
  id: string;
  origin: Point;
  offset: Point;
}

interface ActiveDrag {
  primaryId: string;
  startScreen: Point;
  started: boolean;
  shiftOnDown: boolean;
  items: DragItem[];
}

interface RightAction {
  tokenId: string | null;
  startScreen: Point;
  camera: Camera;
  panning: boolean;
}

function assetUrl(sha256: string): string {
  return `vtt-asset://${sha256}`;
}

/** Carrega a imagem por `<img>` (permitido pela CSP) e cria a textura, sem o carregador do PixiJS (que usa workers `blob:`). */
async function loadTexture(sha256: string): Promise<Texture | null> {
  const img = new Image();
  // `vtt-asset://` é outra origem para a tela (`file://`): sem CORS, a imagem fica "contaminada" e o WebGL a recusa.
  img.crossOrigin = 'anonymous';
  img.src = assetUrl(sha256);
  try {
    await img.decode();
  } catch {
    return null;
  }
  return new Texture({ source: new ImageSource({ resource: img }) });
}

export interface WorldLayers {
  world: Container;
  sceneLayer: Container;
  backgroundLayer: Container;
  gridLayer: Graphics;
  lightTintLayer: Container;
  tokenLayer: Container;
  fogLayer: Container;
  wallOverlayLayer: Container;
  lightOverlayLayer: Container;
  fogPreviewLayer: Graphics;
  rulerLayer: Graphics;
}

/**
 * Monta as camadas do mundo 2D na ordem de desenho e desativa o hit-testing nas
 * camadas não interativas (principalmente névoa e régua, acima dos tokens): com
 * `app.stage.eventMode = 'static'`, o PixiJS v8 propaga o modo para baixo e o
 * sprite da névoa engoliria os cliques nos tokens se ficasse em `'passive'`.
 */
export function createWorldLayers(): WorldLayers {
  const world = new Container();
  const sceneLayer = new Container();
  const backgroundLayer = new Container();
  const gridLayer = new Graphics();
  const lightTintLayer = new Container();
  const tokenLayer = new Container();
  const fogLayer = new Container();
  const wallOverlayLayer = new Container();
  const lightOverlayLayer = new Container();
  const fogPreviewLayer = new Graphics();
  const rulerLayer = new Graphics();
  backgroundLayer.eventMode = 'none';
  gridLayer.eventMode = 'none';
  lightTintLayer.eventMode = 'none';
  fogLayer.eventMode = 'none';
  fogPreviewLayer.eventMode = 'none';
  rulerLayer.eventMode = 'none';
  sceneLayer.addChild(backgroundLayer, gridLayer, lightTintLayer, tokenLayer);
  world.addChild(sceneLayer, fogLayer, wallOverlayLayer, lightOverlayLayer, fogPreviewLayer, rulerLayer);
  return {
    world,
    sceneLayer,
    backgroundLayer,
    gridLayer,
    lightTintLayer,
    tokenLayer,
    fogLayer,
    wallOverlayLayer,
    lightOverlayLayer,
    fogPreviewLayer,
    rulerLayer,
  };
}

export class MapStage {
  private readonly world: Container;
  private readonly sceneLayer: Container;
  private readonly backgroundLayer: Container;
  private readonly gridLayer: Graphics;
  private readonly lightTintLayer: Container;
  private readonly tokenLayer: Container;
  private readonly fogLayer: Container;
  private readonly wallOverlayLayer: Container;
  private readonly lightOverlayLayer: Container;
  private readonly fogPreviewLayer: Graphics;
  private readonly rulerLayer: Graphics;
  private readonly rulerHud = new Container();
  private readonly rulerBadgeBg = new Graphics();
  private readonly rulerBadgeText: Text;
  private readonly views = new Map<string, TokenView>();
  private readonly textures = new Map<string, Promise<Texture | null>>();
  private visionMask: VisionMaskBuffer | undefined;
  private visionMaskSprite: Sprite | undefined;
  private visionMaskTexture: Texture | undefined;
  private lightTintCanvas: HTMLCanvasElement | undefined;
  private lightTintSprite: Sprite | undefined;
  private lightTintTexture: Texture | undefined;
  private visionFilter: VisionLightingFilter | undefined;
  private shownFogKey = '';
  private renderedBgTexture: Texture | null = null;
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private scene: Scene = {
    map: null,
    tokens: [],
    canDrag: () => false,
    selectedIds: [],
    targetedIds: [],
    activeId: null,
    conditions: () => [],
    health: () => null,
    isDead: () => false,
    viewer: { role: 'player', playerId: '' },
    fogTool: 'none',
  };
  private shownMapKey = '';
  private drag: ActiveDrag | undefined;
  private pan: { from: Point; camera: Camera } | undefined;
  private rightAction: RightAction | undefined;
  private lastLeftClick: { time: number; tokenId: string } | undefined;
  private lastRightClick: { time: number; tokenId: string } | undefined;
  private rulerMode = false;
  private rulerOptions: RulerOptions = { ...DEFAULT_RULER_OPTIONS };
  private rulerDragging = false;
  private rulerPoints: GridCell[] = [];
  private fogBrush: { mapId: string; mode: FogMode; cells: Map<string, FogCell> } | undefined;
  private fogRect: { mapId: string; mode: FogMode; from: FogCell; to: FogCell } | undefined;
  private wallDraft: { mapId: string; kind: WallKind; x1: number; y1: number; x2: number; y2: number } | undefined;
  private destroyed = false;

  private constructor(
    private readonly app: Application,
    private readonly events: MapStageEvents,
  ) {
    const layers = createWorldLayers();
    this.world = layers.world;
    this.sceneLayer = layers.sceneLayer;
    this.backgroundLayer = layers.backgroundLayer;
    this.gridLayer = layers.gridLayer;
    this.lightTintLayer = layers.lightTintLayer;
    this.tokenLayer = layers.tokenLayer;
    this.fogLayer = layers.fogLayer;
    this.wallOverlayLayer = layers.wallOverlayLayer;
    this.lightOverlayLayer = layers.lightOverlayLayer;
    this.fogPreviewLayer = layers.fogPreviewLayer;
    this.rulerLayer = layers.rulerLayer;
    this.rulerBadgeText = new Text({
      text: '',
      style: {
        fill: COLORS.rulerLine,
        fontSize: 13,
        fontWeight: '700',
        fontFamily: 'system-ui, sans-serif',
      },
      resolution: 2,
    });
    this.rulerBadgeText.anchor.set(0.5, 0.5);
    this.rulerHud.addChild(this.rulerBadgeBg, this.rulerBadgeText);
    this.rulerHud.visible = false;
    this.rulerHud.eventMode = 'none';
    app.stage.addChild(this.world, this.rulerHud);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', (e) => {
      this.stageDown(e);
    });
    app.stage.on('globalpointermove', (e) => {
      this.pointerMove(e);
    });
    app.stage.on('pointerup', (e) => {
      this.pointerUp(e);
    });
    app.stage.on('pointerupoutside', (e) => {
      this.pointerUp(e);
    });
    app.stage.on('pointercancel', () => {
      this.pointerCancel();
    });
    app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    app.canvas.addEventListener('contextmenu', this.onContextMenu);
    app.renderer.on('resize', () => {
      app.stage.hitArea = app.screen;
    });
  }

  /** Cria o palco dentro de `host`, que define o tamanho (acompanha o redimensionamento). */
  static async create(host: HTMLElement, events: MapStageEvents): Promise<MapStage> {
    const app = new Application();
    await app.init({ resizeTo: host, background: COLORS.background, antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
    host.appendChild(app.canvas);
    return new MapStage(app, events);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderedBgTexture?.destroy(true);
    this.renderedBgTexture = null;
    this.sceneLayer.filters = [];
    this.visionFilter?.destroy();
    this.visionFilter = undefined;
    this.visionMaskSprite?.destroy();
    if (this.visionMaskTexture !== Texture.EMPTY) this.visionMaskTexture?.destroy(true);
    this.lightTintSprite?.destroy();
    this.lightTintTexture?.destroy(true);
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    this.app.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.app.destroy({ removeView: true }, { children: true, texture: true });
  }

  /** Centro da área visível, no mundo: onde o mestre coloca um token novo. */
  viewCenter(): Point {
    return screenToWorld(this.camera, { x: this.app.screen.width / 2, y: this.app.screen.height / 2 });
  }

  setScene(scene: Scene): void {
    if (this.destroyed) return;
    this.scene = scene;
    const map = scene.map;
    const renderedKey = scene.renderedBackground?.key ?? '';
    const mapKey = map ? `${map.id}:${map.width}x${map.height}:${map.background ?? ''}:${map.cellPx ?? ''}:${renderedKey}` : '';
    if (mapKey !== this.shownMapKey) {
      const changedMap = map?.id !== this.shownMapKey.split(':')[0];
      this.shownMapKey = mapKey;
      if (changedMap) this.clearRuler();
      this.drawMap(map, scene.renderedBackground ?? null);
      if (map && changedMap) this.setCamera(fitMap(map, this.app.screen));
    }
    this.syncTokens();
    this.syncFog();
    this.updateCursor();
  }

  private activeWallTool(): WallTool {
    return this.scene.viewer.role === 'gm' ? (this.scene.wallTool ?? 'none') : 'none';
  }

  private updateCursor(): void {
    const activeFog = this.scene.viewer.role === 'gm' && this.scene.fogTool !== 'none';
    const crosshair = this.rulerMode || activeFog || this.activeWallTool() !== 'none';
    this.app.canvas.style.cursor = crosshair ? 'crosshair' : '';
    for (const [id, view] of this.views) {
      if (this.drag?.started === true && this.drag.items.some((item) => item.id === id)) {
        view.container.cursor = 'grabbing';
        continue;
      }
      const token = this.scene.tokens.find((t) => t.id === id);
      view.container.cursor = crosshair ? 'crosshair' : token && this.scene.canDrag(token) ? 'grab' : 'pointer';
    }
  }

  /** Ativa ou desativa a ferramenta local de régua (sem `Intent`). */
  setRulerMode(active: boolean): void {
    if (this.destroyed) return;
    this.rulerMode = active;
    if (active) {
      this.cancelDrag();
      this.pan = undefined;
      this.rightAction = undefined;
    } else {
      this.clearRuler();
    }
    this.updateCursor();
  }

  /** Atualiza modo (linha/raio) e unidade (`ft`/`m`) da régua. */
  setRulerOptions(options: RulerOptions): void {
    if (this.destroyed) return;
    const shapeChanged = this.rulerOptions.shape !== options.shape;
    this.rulerOptions = { ...options };
    if (shapeChanged) {
      this.clearRuler();
    } else if (this.rulerPoints.length >= 2) {
      this.renderRuler();
    }
  }

  /** Limpa a medição atual da régua. */
  clearRuler(): void {
    this.rulerDragging = false;
    this.rulerPoints = [];
    this.rulerLayer.clear();
    this.rulerHud.visible = false;
  }

  /** O Host recusou o movimento: o token volta para onde o estado diz. */
  revert(tokenId: string): void {
    const token = this.scene.tokens.find((t) => t.id === tokenId);
    const view = this.views.get(tokenId);
    if (token && view) {
      view.container.position.set(token.position.x, token.position.y);
      view.body.rotation = (token.rotation * Math.PI) / 180;
    }
  }

  private setCamera(camera: Camera): void {
    this.camera = camera;
    this.world.position.set(camera.x, camera.y);
    this.world.scale.set(camera.zoom);
    this.positionRulerHud();
  }

  private renderRuler(): void {
    this.rulerLayer.clear();
    const firstCell = this.rulerPoints[0];
    const lastCell = this.rulerPoints[this.rulerPoints.length - 1];
    if (this.rulerPoints.length < 2 || !firstCell || !lastCell) {
      this.rulerHud.visible = false;
      return;
    }

    const centers = this.rulerPoints.map(gridCellCenterWorld);
    const first = gridCellCenterWorld(firstCell);
    const last = gridCellCenterWorld(lastCell);
    const measurement =
      this.rulerOptions.shape === 'radius'
        ? measureRulerRadius(firstCell, lastCell)
        : measureRulerPath(this.rulerPoints);

    if (this.rulerOptions.shape === 'radius') {
      const radiusWorld =
        measurement.squares > 0 ? measurement.squares * WORLD_UNITS_PER_CELL : WORLD_UNITS_PER_CELL * 0.5;
      this.rulerLayer
        .circle(first.x, first.y, radiusWorld)
        .fill({ color: COLORS.rulerArea, alpha: 0.18 })
        .stroke({ width: 6, color: COLORS.rulerEnd, alpha: 0.9 });
      if (measurement.squares > 0) {
        this.rulerLayer
          .moveTo(first.x, first.y)
          .lineTo(last.x, last.y)
          .stroke({ width: 10, color: COLORS.outline, alpha: 0.7, cap: 'round' });
        this.rulerLayer
          .moveTo(first.x, first.y)
          .lineTo(last.x, last.y)
          .stroke({ width: 5, color: COLORS.rulerLine, alpha: 0.95, cap: 'round' });
      }
      this.rulerLayer
        .circle(first.x, first.y, 12)
        .fill(COLORS.rulerStart)
        .stroke({ width: 4, color: COLORS.outline });
      if (measurement.squares > 0) {
        this.rulerLayer
          .circle(last.x, last.y, 10)
          .fill(COLORS.rulerEnd)
          .stroke({ width: 4, color: COLORS.outline });
      }
    } else {
      const hasLength = centers.some((p, i) => {
        const prev = centers[i - 1];
        return prev !== undefined && (p.x !== prev.x || p.y !== prev.y);
      });
      if (hasLength) {
        this.rulerLayer.moveTo(first.x, first.y);
        for (const pt of centers.slice(1)) {
          this.rulerLayer.lineTo(pt.x, pt.y);
        }
        this.rulerLayer.stroke({ width: 12, color: COLORS.outline, alpha: 0.75, cap: 'round', join: 'round' });

        this.rulerLayer.moveTo(first.x, first.y);
        for (const pt of centers.slice(1)) {
          this.rulerLayer.lineTo(pt.x, pt.y);
        }
        this.rulerLayer.stroke({ width: 6, color: COLORS.rulerLine, alpha: 0.95, cap: 'round', join: 'round' });
      }
      for (let i = 0; i < centers.length; i += 1) {
        const pt = centers[i];
        if (!pt) continue;
        const isFirst = i === 0;
        const isLast = i === centers.length - 1;
        const fill = isFirst ? COLORS.rulerStart : isLast ? COLORS.rulerEnd : COLORS.rulerLine;
        const r = isFirst || isLast ? 12 : 9;
        this.rulerLayer.circle(pt.x, pt.y, r).fill(fill).stroke({ width: 4, color: COLORS.outline });
      }
    }

    this.rulerBadgeText.text = formatRulerLabel(measurement, this.rulerOptions.unit);
    const padX = 10;
    const padY = 5;
    const w = this.rulerBadgeText.width + padX * 2;
    const h = this.rulerBadgeText.height + padY * 2;
    this.rulerBadgeBg
      .clear()
      .roundRect(-w / 2, -h / 2, w, h, 6)
      .fill({ color: COLORS.rulerBadgeBg, alpha: 0.9 })
      .stroke({ width: 1.5, color: COLORS.rulerLine, alpha: 0.8 });
    this.rulerHud.visible = true;
    this.positionRulerHud();
  }

  private positionRulerHud(): void {
    const prevCell = this.rulerPoints[this.rulerPoints.length - 2];
    const currCell = this.rulerPoints[this.rulerPoints.length - 1];
    if (!prevCell || !currCell || !this.rulerHud.visible) return;
    const prev = gridCellCenterWorld(prevCell);
    const curr = gridCellCenterWorld(currCell);
    const midScreen = worldToScreen(this.camera, { x: (prev.x + curr.x) / 2, y: (prev.y + curr.y) / 2 });
    this.rulerHud.position.set(midScreen.x, midScreen.y - 22);
  }

  private drawMap(map: GameMap | null, renderedBackground: RenderedMapBackground | null): void {
    this.backgroundLayer.removeChildren().forEach((child) => { child.destroy(); });
    this.renderedBgTexture?.destroy(true);
    this.renderedBgTexture = null;
    const g = this.gridLayer.clear();
    if (!map) return;
    const width = map.width * WORLD_UNITS_PER_CELL;
    const height = map.height * WORLD_UNITS_PER_CELL;
    // Piso na camada de fundo: aparece em mapas sem imagem e nas bordas parciais quando `cellPx` não divide exato.
    this.backgroundLayer.addChild(new Graphics().rect(0, 0, width, height).fill(COLORS.mapFloor));
    for (let x = 0; x <= width; x += WORLD_UNITS_PER_CELL) g.moveTo(x, 0).lineTo(x, height);
    for (let y = 0; y <= height; y += WORLD_UNITS_PER_CELL) g.moveTo(0, y).lineTo(width, y);
    g.stroke({ width: 2, color: COLORS.grid, alpha: 0.12 });
    g.rect(0, 0, width, height).stroke({ width: 4, color: COLORS.border, alpha: 0.6 });

    if (renderedBackground) {
      const texture = new Texture({ source: new ImageSource({ resource: renderedBackground.source }) });
      this.renderedBgTexture = texture;
      const size = backgroundWorldSize(
        { width: map.width, height: map.height, cellPx: renderedBackground.cellPx },
        { width: renderedBackground.source.width, height: renderedBackground.source.height },
      );
      const sprite = new Sprite(texture);
      sprite.width = size.width;
      sprite.height = size.height;
      this.backgroundLayer.addChild(sprite);
      return;
    }

    if (map.background) {
      const sha = map.background;
      const cellPx = map.cellPx;
      void this.texture(sha).then((texture) => {
        // O mapa pode ter mudado enquanto a imagem carregava.
        if (!texture || this.destroyed || this.scene.map?.id !== map.id || this.scene.map.background !== sha || this.scene.map.cellPx !== cellPx) return;
        const size = backgroundWorldSize(map, { width: texture.width, height: texture.height });
        const sprite = new Sprite(texture);
        sprite.width = size.width;
        sprite.height = size.height;
        this.backgroundLayer.addChild(sprite);
      });
    }
  }

  private texture(sha256: string): Promise<Texture | null> {
    let texture = this.textures.get(sha256);
    if (!texture) {
      texture = loadTexture(sha256);
      this.textures.set(sha256, texture);
    }
    return texture;
  }

  private syncTokens(): void {
    const mapId = this.scene.map?.id;
    const visible = this.scene.tokens.filter((t) => t.mapId === mapId);
    const ids = new Set(visible.map((t) => t.id));
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      if (this.drag?.items.some((item) => item.id === id)) this.drag = undefined;
      view.container.destroy({ children: true });
      this.views.delete(id);
    }
    const selectedSet = new Set(this.scene.selectedIds);
    const targetedSet = new Set(this.scene.targetedIds);
    for (const token of visible) {
      const conditions = this.scene.conditions(token);
      const dead = this.scene.isDead(token);
      const signature = [token.name, token.size, token.image ?? '', token.ownerIds.length > 0, token.hidden, dead, conditions.join(',')].join('|');
      let view = this.views.get(token.id);
      if (view?.signature !== signature) {
        const old = view?.container;
        view = { ...this.drawToken(token, conditions, dead), signature };
        // Redesenhado no meio de um arrasto: continua onde o ponteiro está.
        if (old && this.drag?.items.some((item) => item.id === token.id)) view.container.position.copyFrom(old.position);
        old?.destroy({ children: true });
        this.views.set(token.id, view);
        this.tokenLayer.addChild(view.container);
      }
      view.ring.visible = selectedSet.has(token.id);
      view.turn.visible = this.scene.activeId === token.id;
      view.targetRing.visible = targetedSet.has(token.id);
      view.body.rotation = (token.rotation * Math.PI) / 180;
      if (token.elevation !== 0) {
        view.elevationLabel.text = token.elevation > 0 ? `↑ ${token.elevation} ft` : `↓ ${Math.abs(token.elevation)} ft`;
        view.elevationLabel.visible = true;
      } else {
        view.elevationLabel.visible = false;
      }
      drawHealthBar(view.bar, tokenSide(token.size), this.scene.health(token));
      const isDragged = this.drag?.started === true && this.drag.items.some((item) => item.id === token.id);
      if (!isDragged) {
        view.container.cursor = this.rulerMode ? 'crosshair' : this.scene.canDrag(token) ? 'grab' : 'pointer';
        // Quem está sendo arrastado fica onde o ponteiro está, até soltar.
        view.container.position.set(token.position.x, token.position.y);
      }
    }
  }

  private drawToken(token: Token, conditions: readonly string[], dead: boolean): Omit<TokenView, 'signature'> {
    const side = tokenSide(token.size);
    const radius = side / 2;
    const container = new Container();
    const body = new Container();
    body.pivot.set(radius, radius);
    body.position.set(radius, radius);

    const color = token.ownerIds.length > 0 ? COLORS.playerToken : COLORS.otherToken;
    const disc = new Graphics()
      .circle(radius, radius, radius * 0.92)
      .fill(color)
      .stroke({ width: Math.max(3, side * 0.04), color: token.hidden ? COLORS.hiddenRing : COLORS.outline });
    if (token.hidden) body.alpha = 0.5;
    // Indicador discreto de frente no topo do disco (gira junto com o corpo do token).
    const arrowTipY = radius - radius * 0.92;
    const arrowHalfW = Math.max(6, radius * 0.16);
    const arrowDepth = Math.max(8, radius * 0.22);
    const facing = new Graphics()
      .moveTo(radius, arrowTipY - arrowDepth * 0.45)
      .lineTo(radius - arrowHalfW, arrowTipY + arrowDepth * 0.55)
      .lineTo(radius + arrowHalfW, arrowTipY + arrowDepth * 0.55)
      .closePath()
      .fill({ color: COLORS.facing, alpha: 0.9 })
      .stroke({ width: Math.max(2, side * 0.025), color: COLORS.outline });
    body.addChild(disc, facing);

    const ring = new Graphics().circle(radius, radius, radius * 0.98).stroke({ width: Math.max(4, side * 0.06), color: COLORS.selected });
    ring.visible = false;
    // Combatente da vez: um anel verde por fora do token.
    const turn = new Graphics().circle(radius, radius, radius * 1.1).stroke({ width: Math.max(4, side * 0.05), color: COLORS.active });
    turn.visible = false;

    // Retículo de alvo (duplo clique direito): anel vermelho com 4 marcas de mira.
    const targetRadius = radius * 1.16;
    const tick = Math.max(8, radius * 0.24);
    const targetRing = new Graphics()
      .circle(radius, radius, targetRadius)
      .moveTo(radius, radius - targetRadius - tick * 0.5)
      .lineTo(radius, radius - targetRadius + tick * 0.5)
      .moveTo(radius, radius + targetRadius - tick * 0.5)
      .lineTo(radius, radius + targetRadius + tick * 0.5)
      .moveTo(radius - targetRadius - tick * 0.5, radius)
      .lineTo(radius - targetRadius + tick * 0.5, radius)
      .moveTo(radius + targetRadius - tick * 0.5, radius)
      .lineTo(radius + targetRadius + tick * 0.5, radius)
      .stroke({ width: Math.max(4, side * 0.055), color: COLORS.target });
    targetRing.visible = false;

    container.addChild(turn, targetRing, body, ring);

    if (token.image) {
      const sha = token.image;
      void this.texture(sha).then((texture) => {
        if (!texture || container.destroyed) return;
        const sprite = new Sprite(texture);
        sprite.width = side * 0.84;
        sprite.height = side * 0.84;
        sprite.position.set(side * 0.08, side * 0.08);
        const mask = new Graphics().circle(radius, radius, radius * 0.84).fill(0xffffff);
        sprite.mask = mask;
        body.addChildAt(mask, 1);
        body.addChildAt(sprite, 2);
      });
    }

    if (dead) {
      const crossInset = radius * 0.45;
      const deadOverlay = new Graphics()
        .circle(radius, radius, radius * 0.88)
        .fill({ color: COLORS.outline, alpha: 0.55 })
        .moveTo(radius - crossInset, radius - crossInset)
        .lineTo(radius + crossInset, radius + crossInset)
        .moveTo(radius + crossInset, radius - crossInset)
        .lineTo(radius - crossInset, radius + crossInset)
        .stroke({ width: Math.max(10, side * 0.14), color: COLORS.outline, cap: 'round' })
        .moveTo(radius - crossInset, radius - crossInset)
        .lineTo(radius + crossInset, radius + crossInset)
        .moveTo(radius + crossInset, radius - crossInset)
        .lineTo(radius - crossInset, radius + crossInset)
        .stroke({ width: Math.max(6, side * 0.08), color: COLORS.deadCross, cap: 'round' });
      container.addChild(deadOverlay);
    }

    const label = new Text({
      text: token.hidden ? `${token.name} (oculto)` : token.name,
      style: { fill: COLORS.label, fontSize: 24, fontFamily: 'system-ui, sans-serif', stroke: { color: COLORS.background, width: 6 } },
      resolution: 2,
    });
    if (token.hidden) label.alpha = 0.7;
    label.anchor.set(0.5, 0);
    label.position.set(radius, side + 4 + HEALTH_BAR_HEIGHT + 4);
    const bar = new Graphics();
    bar.position.set(0, side + 4);

    const elevationLabel = new Text({
      text: '',
      style: { fill: COLORS.elevation, fontSize: 20, fontWeight: '700', fontFamily: 'system-ui, sans-serif', stroke: { color: COLORS.background, width: 6 } },
      resolution: 2,
    });
    elevationLabel.anchor.set(1, 0);
    elevationLabel.position.set(side, 0);
    elevationLabel.visible = false;

    container.addChild(label, bar, elevationLabel);
    if (conditions.length > 0) {
      // Condições acima do token.
      const tags = new Text({
        text: conditions.join(' · '),
        style: { fill: COLORS.condition, fontSize: 20, fontWeight: '600', fontFamily: 'system-ui, sans-serif', stroke: { color: COLORS.background, width: 6 } },
        resolution: 2,
      });
      tags.anchor.set(0.5, 1);
      tags.position.set(radius, -6);
      container.addChild(tags);
    }

    container.eventMode = 'static';
    container.on('pointerdown', (e) => {
      this.tokenDown(token.id, e);
    });
    return { container, body, ring, turn, targetRing, elevationLabel, bar };
  }

  private cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    for (const item of drag.items) {
      const view = this.views.get(item.id);
      if (view) {
        view.container.position.set(item.origin.x, item.origin.y);
      }
    }
    this.updateCursor();
  }

  /** O sistema interrompeu o ponteiro: desfaz qualquer operação em andamento sem aplicar nada. */
  private pointerCancel(): void {
    this.pan = undefined;
    this.rightAction = undefined;
    this.rulerDragging = false;
    this.fogBrush = undefined;
    this.fogRect = undefined;
    this.wallDraft = undefined;
    this.fogPreviewLayer.clear();
    this.cancelDrag();
    this.updateCursor();
  }

  private tokenDown(id: string, e: FederatedPointerEvent): void {
    // Botão do meio sempre faz pan, inclusive sobre tokens.
    if (e.button === 1) {
      e.stopPropagation();
      this.events.onCloseHud();
      this.pan = { from: { x: e.global.x, y: e.global.y }, camera: this.camera };
      return;
    }
    // Em modo régua ou com ferramenta de névoa/paredes ativa, botão esquerdo vai para a ferramenta do palco.
    if (e.button === 0 && (this.rulerMode || (this.scene.viewer.role === 'gm' && (this.scene.fogTool !== 'none' || this.activeWallTool() !== 'none')))) {
      return;
    }

    e.stopPropagation();

    // Botão direito em token: arrastar faz pan; clique curto abre HUD; duplo clique direito marca alvo.
    if (e.button === 2) {
      this.rightAction = {
        tokenId: id,
        startScreen: { x: e.global.x, y: e.global.y },
        camera: this.camera,
        panning: false,
      };
      return;
    }

    if (e.button !== 0) return;

    this.events.onCloseHud();

    // Duplo clique esquerdo abre a ficha referenciada pelo token.
    const now = performance.now();
    if (!e.shiftKey && this.lastLeftClick && this.lastLeftClick.tokenId === id && now - this.lastLeftClick.time <= DOUBLE_CLICK_MS) {
      this.lastLeftClick = undefined;
      this.events.onSelect([id]);
      this.events.onOpenSheet(id);
      return;
    }
    this.lastLeftClick = { time: now, tokenId: id };

    const token = this.scene.tokens.find((t) => t.id === id);
    const container = this.views.get(id)?.container;
    if (!token || !container) return;

    const alreadySelected = this.scene.selectedIds.includes(id);
    if (!e.shiftKey && !alreadySelected) {
      this.events.onSelect([id]);
    }

    if (this.scene.canDrag(token)) {
      const world = screenToWorld(this.camera, e.global);
      const groupIds = !e.shiftKey && alreadySelected ? this.scene.selectedIds : [id];
      const items: DragItem[] = [];
      for (const gid of groupIds) {
        const t = this.scene.tokens.find((x) => x.id === gid);
        const c = this.views.get(gid)?.container;
        if (t && c && this.scene.canDrag(t)) {
          items.push({ id: gid, origin: { x: t.position.x, y: t.position.y }, offset: { x: world.x - c.x, y: world.y - c.y } });
        }
      }
      if (items.length > 0) {
        this.drag = {
          primaryId: id,
          startScreen: { x: e.global.x, y: e.global.y },
          started: false,
          shiftOnDown: e.shiftKey,
          items,
        };
      }
    } else if (e.shiftKey) {
      this.events.onSelect(toggleSelection(this.scene.selectedIds, id, true));
    } else if (alreadySelected && this.scene.selectedIds.length > 1) {
      this.events.onSelect([id]);
    }
  }

  private stageDown(e: FederatedPointerEvent): void {
    if (e.button === 2) {
      this.rightAction = {
        tokenId: null,
        startScreen: { x: e.global.x, y: e.global.y },
        camera: this.camera,
        panning: false,
      };
      return;
    }

    // Botão do meio: mantém comportamento atual (pan da câmera).
    if (e.button === 1) {
      this.events.onCloseHud();
      this.pan = { from: { x: e.global.x, y: e.global.y }, camera: this.camera };
      return;
    }

    if (e.button !== 0) return;

    const map = this.scene.map;
    const wallTool = this.activeWallTool();
    if (map && wallTool !== 'none') {
      this.events.onCloseHud();
      const world = screenToWorld(this.camera, e.global);
      const cellX = world.x / WORLD_UNITS_PER_CELL;
      const cellY = world.y / WORLD_UNITS_PER_CELL;
      if (wallTool === 'erase') {
        let bestId: string | null = null;
        let bestDist = 0.4;
        for (const w of map.walls) {
          if (w.layer !== 'surface') continue;
          const d = pointToSegmentDistance({ x: cellX, y: cellY }, w);
          if (d <= bestDist) {
            bestDist = d;
            bestId = w.id;
          }
        }
        if (bestId !== null) this.events.onWallRemove?.(map.id, [bestId]);
        return;
      }
      const x1 = snapWallCoord(cellX, map.width);
      const y1 = snapWallCoord(cellY, map.height);
      this.wallDraft = { mapId: map.id, kind: wallTool, x1, y1, x2: x1, y2: y1 };
      this.drawWallPreview();
      return;
    }
    if (map && this.scene.viewer.role === 'gm' && this.scene.fogTool !== 'none') {
      this.events.onCloseHud();
      const world = screenToWorld(this.camera, e.global);
      if (this.scene.fogTool === 'brush-cover' || this.scene.fogTool === 'brush-reveal') {
        const mode: FogMode = this.scene.fogTool === 'brush-cover' ? 'cover' : 'reveal';
        const cells = new Map<string, FogCell>();
        const cell = worldToFogCell(world, map);
        if (cell) cells.set(`${cell.x},${cell.y}`, cell);
        this.fogBrush = { mapId: map.id, mode, cells };
        this.drawFogPreview();
        return;
      }
      const mode: FogMode = this.scene.fogTool === 'rect-cover' ? 'cover' : 'reveal';
      const cell = clampFogCell(world, map);
      this.fogRect = { mapId: map.id, mode, from: cell, to: cell };
      this.drawFogPreview();
      return;
    }
    if (this.rulerMode) {
      if (map) {
        this.events.onCloseHud();
        const cell = worldToGridCell(screenToWorld(this.camera, e.global), map);
        if (this.rulerOptions.shape === 'line' && e.shiftKey && this.rulerPoints.length >= 2) {
          this.rulerPoints = [...this.rulerPoints, cell];
        } else {
          this.rulerPoints = [cell, cell];
        }
        this.rulerDragging = true;
        this.renderRuler();
      }
      return;
    }

    // Clique esquerdo no canvas vazio: fecha HUD e limpa seleção (sem fazer pan).
    this.events.onCloseHud();
    if (!e.shiftKey && this.scene.selectedIds.length > 0) {
      this.events.onSelect([]);
    }
  }

  private pointerMove(e: FederatedPointerEvent): void {
    // Apertar o direito com o esquerdo já apertado não gera `pointerdown` (Pointer Events):
    // chega como `pointermove` com o botão em `buttons`. Cancela a operação em andamento.
    if ((e.buttons & 2) !== 0 && (this.drag || this.rulerDragging || this.fogBrush || this.fogRect || this.wallDraft)) {
      if (this.rulerDragging) this.clearRuler();
      this.pointerCancel();
      return;
    }
    if (this.wallDraft) {
      const map = this.scene.map;
      if (!map || map.id !== this.wallDraft.mapId) return;
      const world = screenToWorld(this.camera, e.global);
      const x2 = snapWallCoord(world.x / WORLD_UNITS_PER_CELL, map.width);
      const y2 = snapWallCoord(world.y / WORLD_UNITS_PER_CELL, map.height);
      if (x2 !== this.wallDraft.x2 || y2 !== this.wallDraft.y2) {
        this.wallDraft.x2 = x2;
        this.wallDraft.y2 = y2;
        this.drawWallPreview();
      }
      return;
    }
    if (this.fogBrush) {
      const map = this.scene.map;
      if (!map || map.id !== this.fogBrush.mapId) return;
      const cell = worldToFogCell(screenToWorld(this.camera, e.global), map);
      if (cell) {
        const key = `${cell.x},${cell.y}`;
        if (!this.fogBrush.cells.has(key)) {
          this.fogBrush.cells.set(key, cell);
          this.drawFogPreview();
        }
      }
      return;
    }
    if (this.fogRect) {
      const map = this.scene.map;
      if (!map || map.id !== this.fogRect.mapId) return;
      const to = clampFogCell(screenToWorld(this.camera, e.global), map);
      if (to.x !== this.fogRect.to.x || to.y !== this.fogRect.to.y) {
        this.fogRect.to = to;
        this.drawFogPreview();
      }
      return;
    }
    if (this.rulerDragging && this.rulerPoints.length >= 2 && this.scene.map) {
      const cell = worldToGridCell(screenToWorld(this.camera, e.global), this.scene.map);
      const last = this.rulerPoints[this.rulerPoints.length - 1];
      if (!last || cell.x !== last.x || cell.y !== last.y) {
        this.rulerPoints = [...this.rulerPoints.slice(0, -1), cell];
        this.renderRuler();
      }
      return;
    }
    if (this.drag) {
      if (!this.drag.started) {
        if (Math.hypot(e.global.x - this.drag.startScreen.x, e.global.y - this.drag.startScreen.y) < DRAG_THRESHOLD_PX) {
          return;
        }
        this.drag.started = true;
        for (const item of this.drag.items) {
          const c = this.views.get(item.id)?.container;
          if (c) {
            c.cursor = 'grabbing';
            this.tokenLayer.addChild(c);
          }
        }
      }
      const world = screenToWorld(this.camera, e.global);
      for (const item of this.drag.items) {
        this.views.get(item.id)?.container.position.set(world.x - item.offset.x, world.y - item.offset.y);
      }
      return;
    }
    if (this.rightAction) {
      const { startScreen, camera } = this.rightAction;
      if (!this.rightAction.panning) {
        if (Math.hypot(e.global.x - startScreen.x, e.global.y - startScreen.y) < DRAG_THRESHOLD_PX) {
          return;
        }
        this.rightAction.panning = true;
        this.events.onCloseHud();
        this.app.canvas.style.cursor = 'grabbing';
      }
      this.setCamera({ ...camera, x: camera.x + e.global.x - startScreen.x, y: camera.y + e.global.y - startScreen.y });
      return;
    }
    if (this.pan) {
      const { from, camera } = this.pan;
      this.setCamera({ ...camera, x: camera.x + e.global.x - from.x, y: camera.y + e.global.y - from.y });
    }
  }

  private pointerUp(e: FederatedPointerEvent): void {
    // O `pointerup` só vem quando o último botão é solto, seja ele qual for.
    this.pan = undefined;
    const action = this.rightAction;
    this.rightAction = undefined;
    if (e.button === 1) return;
    if (e.button === 2) {
      if (!action) return;
      if (action.panning) {
        this.updateCursor();
        return;
      }
      if (action.tokenId !== null) {
        const now = performance.now();
        if (this.lastRightClick && this.lastRightClick.tokenId === action.tokenId && now - this.lastRightClick.time <= DOUBLE_CLICK_MS) {
          this.lastRightClick = undefined;
          this.events.onCloseHud();
          this.events.onToggleTarget(action.tokenId);
          return;
        }
        this.lastRightClick = { time: now, tokenId: action.tokenId };
        const token = this.scene.tokens.find((t) => t.id === action.tokenId);
        if (token) {
          const side = tokenSide(token.size);
          const screenPos = worldToScreen(this.camera, { x: token.position.x + side, y: token.position.y + side / 2 });
          this.events.onOpenHud(token.id, screenPos);
        }
      } else {
        this.events.onCloseHud();
      }
      return;
    }

    if (e.button !== 0) return;

    this.rulerDragging = false;
    if (this.wallDraft) {
      const draft = this.wallDraft;
      this.wallDraft = undefined;
      this.fogPreviewLayer.clear();
      if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) >= 0.25) {
        this.events.onWallAdd?.(draft.mapId, {
          x1: draft.x1,
          y1: draft.y1,
          x2: draft.x2,
          y2: draft.y2,
          kind: draft.kind,
          layer: 'surface',
        });
      }
      return;
    }
    if (this.fogBrush) {
      const { mapId, mode, cells } = this.fogBrush;
      this.fogBrush = undefined;
      this.fogPreviewLayer.clear();
      if (cells.size > 0) this.events.onFogPaint(mapId, mode, [...cells.values()]);
      return;
    }
    if (this.fogRect) {
      const { mapId, mode, from, to } = this.fogRect;
      this.fogRect = undefined;
      this.fogPreviewLayer.clear();
      this.events.onFogRect(mapId, mode, from, to);
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    this.updateCursor();

    if (!drag.started) {
      // Foi clique (não arrasto): aplica Shift+seleção ou reduz seleção múltipla ao token clicado.
      if (drag.shiftOnDown) {
        this.events.onSelect(toggleSelection(this.scene.selectedIds, drag.primaryId, true));
      } else if (this.scene.selectedIds.length > 1) {
        this.events.onSelect([drag.primaryId]);
      }
      return;
    }

    const map = this.scene.map;
    if (!map) return;
    const snapToGrid = !e.shiftKey;
    for (const item of drag.items) {
      const view = this.views.get(item.id)?.container;
      const token = this.scene.tokens.find((t) => t.id === item.id);
      if (!view || !token) continue;
      const to = placeToken({ x: view.x, y: view.y }, token.size, map, snapToGrid);
      view.position.set(to.x, to.y);
      if (to.x !== token.position.x || to.y !== token.position.y) this.events.onMove(token.id, to);
    }
  }

  private syncFog(): void {
    const map = this.scene.map;
    const fogOptions = {
      ...(this.scene.visionProfiles ? { visionProfiles: this.scene.visionProfiles } : {}),
      ...(this.scene.characters ? { characters: this.scene.characters } : {}),
      ...(this.scene.bakedPropLights ? { bakedPropLights: this.scene.bakedPropLights } : {}),
    };
    const key = fogSignature(map, this.scene.tokens, this.scene.viewer, fogOptions);
    if (key === this.shownFogKey) return;
    this.shownFogKey = key;
    if (!map) {
      if (this.visionFilter) this.visionFilter.enabled = false;
      if (this.visionMaskSprite) this.visionMaskSprite.visible = false;
      if (this.lightTintSprite) this.lightTintSprite.visible = false;
      this.wallOverlayLayer.removeChildren().forEach((c) => { c.destroy({ children: true }); });
      this.lightOverlayLayer.removeChildren().forEach((c) => { c.destroy({ children: true }); });
      return;
    }

    if (!this.visionMask || !this.lightTintCanvas || !this.visionMaskSprite || !this.lightTintSprite || !this.visionMaskTexture || !this.lightTintTexture) {
      this.visionMask = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
      this.lightTintCanvas = document.createElement('canvas');
      this.lightTintCanvas.width = map.width;
      this.lightTintCanvas.height = map.height;

      this.visionMaskTexture = Texture.EMPTY;
      this.visionMaskSprite = new Sprite(this.visionMaskTexture);
      this.visionMaskSprite.renderable = false;
      this.visionMaskSprite.eventMode = 'none';
      this.fogLayer.addChild(this.visionMaskSprite);

      this.lightTintTexture = new Texture({
        source: new CanvasSource({ resource: this.lightTintCanvas, scaleMode: 'linear' }),
      });
      this.lightTintSprite = new Sprite(this.lightTintTexture);
      this.lightTintSprite.eventMode = 'none';
      this.lightTintLayer.addChild(this.lightTintSprite);

      this.visionFilter = new VisionLightingFilter(this.visionMaskSprite);
      this.sceneLayer.filters = [this.visionFilter];
    }

    const maskData = this.visionMask.data;
    const { selfUnseenTokenIds } = composeSmooth2dVisionAndLight(
      this.visionMask,
      this.lightTintCanvas,
      map,
      this.scene.tokens,
      this.scene.viewer,
      fogOptions,
    );

    const worldW = map.width * WORLD_UNITS_PER_CELL;
    const worldH = map.height * WORLD_UNITS_PER_CELL;
    if (this.visionMask.data !== maskData || this.visionMaskTexture === Texture.EMPTY) {
      // Tamanho novo: outra textura sobre o buffer novo. O filtro lê a textura do sprite a cada quadro.
      if (this.visionMaskTexture !== Texture.EMPTY) this.visionMaskTexture.destroy(true);
      this.visionMaskTexture = new Texture({
        source: new BufferImageSource({
          resource: this.visionMask.data,
          width: this.visionMask.width,
          height: this.visionMask.height,
          format: 'rgba8unorm',
          alphaMode: 'no-premultiply-alpha',
          scaleMode: 'linear',
        }),
      });
      this.visionMaskSprite.texture = this.visionMaskTexture;
    } else {
      this.visionMaskTexture.source.update();
    }
    this.lightTintTexture.source.update();
    this.visionMaskSprite.visible = true;
    this.visionMaskSprite.width = worldW;
    this.visionMaskSprite.height = worldH;
    this.lightTintSprite.visible = true;
    this.lightTintSprite.width = worldW;
    this.lightTintSprite.height = worldH;
    if (this.visionFilter) this.visionFilter.enabled = true;

    this.syncWallAndDoorOverlays(map);
    this.syncLightOverlays(map, selfUnseenTokenIds);
  }

  private isCellRevealedForPlayer(map: GameMap, cellX: number, cellY: number): boolean {
    const mask = this.visionMask;
    if (!mask || mask.width <= 0 || mask.height <= 0 || map.width <= 0 || map.height <= 0) return true;
    const px = Math.min(mask.width - 1, Math.max(0, Math.floor((cellX / map.width) * mask.width)));
    const py = Math.min(mask.height - 1, Math.max(0, Math.floor((cellY / map.height) * mask.height)));
    const offset = (py * mask.width + px) * 4;
    const bright = mask.data[offset + 1] ?? 0;
    const fogFill = mask.data[offset + 3] ?? 255;
    return bright > 0 || fogFill < 250;
  }

  private drawDashedLine(g: Graphics, x1: number, y1: number, x2: number, y2: number, color: number): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const dash = 14;
    const gap = 10;
    let t = 0;
    while (t < len) {
      const next = Math.min(len, t + dash);
      g.moveTo(x1 + (dx * t) / len, y1 + (dy * t) / len).lineTo(x1 + (dx * next) / len, y1 + (dy * next) / len);
      t += dash + gap;
    }
    g.stroke({ width: 6, color, alpha: 0.9 });
  }

  private drawWallPreview(): void {
    const g = this.fogPreviewLayer.clear();
    if (!this.wallDraft) return;
    const { kind, x1, y1, x2, y2 } = this.wallDraft;
    const color =
      kind === 'door' ? 0xfb923c : kind === 'window' ? 0x38bdf8 : kind === 'terrain_wall' ? 0xa3e635 : 0xf59e0b;
    const wx1 = x1 * WORLD_UNITS_PER_CELL;
    const wy1 = y1 * WORLD_UNITS_PER_CELL;
    const wx2 = x2 * WORLD_UNITS_PER_CELL;
    const wy2 = y2 * WORLD_UNITS_PER_CELL;
    g.circle(wx1, wy1, 10).fill({ color, alpha: 0.9 });
    g.circle(wx2, wy2, 10).fill({ color, alpha: 0.9 });
    g.moveTo(wx1, wy1).lineTo(wx2, wy2).stroke({ width: 8, color, alpha: 0.9, cap: 'round' });
  }

  private isOverlayInteractive(): boolean {
    if (this.rulerMode) return false;
    return !(this.scene.viewer.role === 'gm' && (this.scene.fogTool !== 'none' || this.activeWallTool() !== 'none'));
  }

  private syncWallAndDoorOverlays(map: GameMap): void {
    this.wallOverlayLayer.removeChildren().forEach((c) => { c.destroy({ children: true }); });
    const isGm = this.scene.viewer.role === 'gm';
    const surfaceWalls = map.walls.filter((w) => w.layer === 'surface');
    if (surfaceWalls.length === 0) return;

    if (isGm) {
      const g = new Graphics();
      g.eventMode = 'none';
      for (const w of surfaceWalls) {
        const wx1 = w.x1 * WORLD_UNITS_PER_CELL;
        const wy1 = w.y1 * WORLD_UNITS_PER_CELL;
        const wx2 = w.x2 * WORLD_UNITS_PER_CELL;
        const wy2 = w.y2 * WORLD_UNITS_PER_CELL;
        if (w.kind === 'door' && w.open) {
          this.drawDashedLine(g, wx1, wy1, wx2, wy2, 0x34d399);
          continue;
        }
        const color =
          w.kind === 'door'
            ? 0xfb923c
            : w.kind === 'window'
              ? 0x38bdf8
              : w.kind === 'terrain_wall'
                ? 0xa3e635
                : 0xf59e0b;
        g.moveTo(wx1, wy1).lineTo(wx2, wy2).stroke({ width: w.kind === 'terrain_wall' ? 4 : 6, color, alpha: 0.85 });
      }
      this.wallOverlayLayer.addChild(g);
    }

    for (const door of surfaceWalls) {
      if (door.kind !== 'door') continue;
      if (!isGm && !this.isDoorVisibleToPlayer(map, door)) continue;
      const mx = ((door.x1 + door.x2) * 0.5) * WORLD_UNITS_PER_CELL;
      const my = ((door.y1 + door.y2) * 0.5) * WORLD_UNITS_PER_CELL;
      const badge = new Container();
      badge.position.set(mx, my);
      const bg = new Graphics()
        .roundRect(-13, -13, 26, 26, 6)
        .fill({ color: door.open ? 0x123828 : door.locked ? 0x451a1a : 0x3f230d, alpha: 0.92 })
        .stroke({ width: 2.5, color: door.open ? 0x34d399 : door.locked ? 0xf87171 : 0xfb923c });
      const symbol = new Text({
        text: door.open ? '□' : door.locked ? '🔒' : '■',
        style: { fill: 0xf8fafc, fontSize: 13, fontFamily: 'system-ui, sans-serif' },
        resolution: 2,
      });
      symbol.anchor.set(0.5, 0.5);
      badge.addChild(bg, symbol);
      badge.eventMode = 'static';
      badge.cursor = 'pointer';
      badge.on('pointerdown', (e) => {
        if (e.button !== 0 || !this.isOverlayInteractive()) return;
        e.stopPropagation();
        this.events.onDoorToggle?.(map.id, door.id);
      });
      this.wallOverlayLayer.addChild(badge);
    }
  }

  private isDoorVisibleToPlayer(map: GameMap, door: WallSegment): boolean {
    const mx = (door.x1 + door.x2) * 0.5;
    const my = (door.y1 + door.y2) * 0.5;
    return (
      this.isCellRevealedForPlayer(map, mx, my) ||
      this.isCellRevealedForPlayer(map, door.x1, door.y1) ||
      this.isCellRevealedForPlayer(map, door.x2, door.y2)
    );
  }

  private syncLightOverlays(map: GameMap, selfUnseenTokenIds: ReadonlySet<string>): void {
    this.lightOverlayLayer.removeChildren().forEach((c) => { c.destroy({ children: true }); });
    const isGm = this.scene.viewer.role === 'gm';
    const tokenById = new Map(this.scene.tokens.map((t) => [t.id, t]));

    for (const light of map.lights) {
      if (light.layer !== 'surface') continue;
      if (!isGm && light.ownerId !== this.scene.viewer.playerId) continue;
      let cx: number;
      let cy: number;
      if (light.attach.kind === 'point') {
        cx = light.attach.x * WORLD_UNITS_PER_CELL;
        cy = light.attach.y * WORLD_UNITS_PER_CELL;
      } else {
        const holder = tokenById.get(light.attach.tokenId);
        if (!holder || holder.mapId !== map.id) continue;
        const side = tokenSide(holder.size);
        cx = holder.position.x + side * 0.85;
        cy = holder.position.y + side * 0.15;
      }
      const badge = this.createLightBadge(
        cx,
        cy,
        light.kind === 'darkness' ? '🌑' : '🔥',
        light.enabled,
        light.kind === 'darkness' ? 0xa855f7 : 0xffa94d,
        () => {
          this.events.onLightToggle?.(map.id, light.id);
        },
      );
      this.lightOverlayLayer.addChild(badge);
    }

    const bakedProps = this.scene.bakedPropLights ?? [];
    for (const prop of bakedProps) {
      if (prop.layer !== 'surface') continue;
      const override = map.propLightOverrides[prop.id];
      if (override === 'removed' && !isGm) continue;
      if (!isGm) {
        const nearControlled = this.scene.tokens.some((t) => {
          if (t.mapId !== map.id || !isViewerObserverToken(t, this.scene.viewer.playerId, this.scene.characters)) return false;
          const side = tokenSide(t.size);
          const tx = (t.position.x + side * 0.5) / WORLD_UNITS_PER_CELL;
          const ty = (t.position.y + side * 0.5) / WORLD_UNITS_PER_CELL;
          return Math.hypot(tx - prop.x, ty - prop.y) <= 2.5 + side / (WORLD_UNITS_PER_CELL * 2);
        });
        if (!nearControlled) continue;
      }
      const active = override === undefined;
      const badge = this.createLightBadge(
        prop.x * WORLD_UNITS_PER_CELL,
        prop.y * WORLD_UNITS_PER_CELL,
        override === 'removed' ? '✕' : '🔥',
        active,
        override === 'removed' ? 0x64748b : 0xff9442,
        () => {
          this.events.onPropLightToggle?.(map.id, prop.id, active ? 'off' : 'on');
        },
      );
      this.lightOverlayLayer.addChild(badge);
    }

    for (const tokenId of selfUnseenTokenIds) {
      const token = tokenById.get(tokenId);
      if (!token || token.mapId !== map.id) continue;
      const side = tokenSide(token.size);
      const radius = side / 2;
      const marker = new Container();
      marker.eventMode = 'none';
      marker.position.set(token.position.x, token.position.y);
      const ring = new Graphics()
        .circle(radius, radius, radius * 0.94)
        .stroke({ width: Math.max(4, side * 0.06), color: 0xa78bfa, alpha: 0.95 });
      const name = new Text({
        text: token.name,
        style: { fill: 0xe2e8f0, fontSize: 22, fontFamily: 'system-ui, sans-serif', stroke: { color: 0x0f172a, width: 5 } },
        resolution: 2,
      });
      name.anchor.set(0.5, 0);
      name.position.set(radius, side + 8);
      marker.addChild(ring, name);
      this.lightOverlayLayer.addChild(marker);
    }
  }

  private createLightBadge(
    x: number,
    y: number,
    glyph: string,
    active: boolean,
    accent: number,
    onToggle: () => void,
  ): Container {
    const c = new Container();
    c.position.set(x, y);
    const bg = new Graphics()
      .circle(0, 0, 14)
      .fill({ color: active ? 0x1e1b2e : 0x0f172a, alpha: active ? 0.92 : 0.72 })
      .stroke({ width: 2, color: active ? accent : 0x475569 });
    const icon = new Text({
      text: glyph,
      style: { fill: active ? 0xf8fafc : 0x94a3b8, fontSize: 13, fontFamily: 'system-ui, sans-serif' },
      resolution: 2,
    });
    icon.anchor.set(0.5, 0.5);
    icon.alpha = active ? 1 : 0.55;
    c.addChild(bg, icon);
    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointerdown', (e) => {
      if (e.button !== 0 || !this.isOverlayInteractive()) return;
      e.stopPropagation();
      onToggle();
    });
    return c;
  }

  private drawFogPreview(): void {
    const g = this.fogPreviewLayer.clear();
    if (this.fogBrush) {
      const color = this.fogBrush.mode === 'cover' ? 0x6c5ce7 : 0x5fd38d;
      for (const cell of this.fogBrush.cells.values()) {
        g.rect(cell.x * WORLD_UNITS_PER_CELL, cell.y * WORLD_UNITS_PER_CELL, WORLD_UNITS_PER_CELL, WORLD_UNITS_PER_CELL);
      }
      g.fill({ color, alpha: 0.35 }).stroke({ width: 3, color, alpha: 0.9 });
      return;
    }
    if (this.fogRect) {
      const color = this.fogRect.mode === 'cover' ? 0x6c5ce7 : 0x5fd38d;
      const minX = Math.min(this.fogRect.from.x, this.fogRect.to.x);
      const maxX = Math.max(this.fogRect.from.x, this.fogRect.to.x);
      const minY = Math.min(this.fogRect.from.y, this.fogRect.to.y);
      const maxY = Math.max(this.fogRect.from.y, this.fogRect.to.y);
      g.rect(
        minX * WORLD_UNITS_PER_CELL,
        minY * WORLD_UNITS_PER_CELL,
        (maxX - minX + 1) * WORLD_UNITS_PER_CELL,
        (maxY - minY + 1) * WORLD_UNITS_PER_CELL,
      )
        .fill({ color, alpha: 0.3 })
        .stroke({ width: 4, color, alpha: 0.9 });
    }
  }

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey || e.shiftKey) && this.scene.selectedIds.length > 0) {
      const controllable = this.scene.selectedIds
        .map((id) => this.scene.tokens.find((t) => t.id === id))
        .filter((t): t is Token => t !== undefined && this.scene.canDrag(t));
      if (controllable.length > 0) {
        const fast = e.shiftKey;
        for (const token of controllable) {
          const next = stepRotation(token.rotation, e.deltaY, fast);
          const view = this.views.get(token.id);
          if (view) view.body.rotation = (next * Math.PI) / 180;
          if (next !== token.rotation) this.events.onRotate(token.id, next);
        }
        return;
      }
    }
    this.events.onCloseHud();
    this.setCamera(zoomAt(this.camera, { x: e.offsetX, y: e.offsetY }, Math.exp(-e.deltaY * ZOOM_SPEED)));
  };
}
