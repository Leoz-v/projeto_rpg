// O PixiJS gera código de shader com `new Function`, que a CSP da tela bloqueia; este módulo troca por versões prontas.
import 'pixi.js/unsafe-eval';
import { Application, CanvasSource, Container, type FederatedPointerEvent, Graphics, ImageSource, Sprite, Text, Texture } from 'pixi.js';
import type { GridCell } from 'rules-engine/space';
import type { VisionProfile } from 'rules-engine/vision';
import {
  type ExtractedPropLight,
  type FogCell,
  type FogMode,
  type GameMap,
  type Point,
  type SessionState,
  type Token,
  type WallSegment,
  WORLD_UNITS_PER_CELL,
} from '../../../shared/protocol';
import {
  clampFogCell,
  fogSignature,
  type FogTool,
  type FogViewer,
  isViewerObserverToken,
  worldToFogCell,
} from './fog-render';
import { type Camera, fitMap, placeToken, screenToWorld, tokenSide, worldToScreen, zoomAt } from './geometry';
import { type Health, healthColor } from './health';
import { composeSmooth2dVisionAndLight } from './lighting-2d';
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
  selectedId: string | null;
  /** Token do combatente da vez, ou `null` (sem combate). */
  activeId: string | null;
  /** Condições do token em pt-BR, para o rótulo acima dele. */
  conditions: (token: Token) => readonly string[];
  /** PV para a barra do token, ou `null` (sem barra). */
  health: (token: Token) => Health | null;
  /** Quem está vendo o mapa (mestre ou jogador), para a névoa de guerra. */
  viewer: FogViewer;
  /** Ferramenta de edição de névoa ativa (só para o mestre). */
  fogTool: FogTool;
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
  onSelect: (tokenId: string | null) => void;
  onFogPaint: (mapId: string, mode: FogMode, cells: FogCell[]) => void;
  onFogRect: (mapId: string, mode: FogMode, from: FogCell, to: FogCell) => void;
  onDoorToggle?: (mapId: string, wallId: string) => void;
  onLightToggle?: (mapId: string, lightId: string) => void;
  onPropLightToggle?: (mapId: string, propLightId: string, nextState: 'on' | 'off') => void;
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
  condition: 0xffd166,
  label: 0xe8e6ef,
  rulerLine: 0xffd166,
  rulerStart: 0x38bdf8,
  rulerEnd: 0xff7849,
  rulerArea: 0xff7849,
  rulerBadgeBg: 0x0f131a,
};

const ZOOM_SPEED = 0.0015;
const HEALTH_BAR_HEIGHT = 10;
const TEMP_HP_COLOR = 0x6fb6ff;

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
  /** Anel de seleção: só aparece ou some, sem redesenhar o token. */
  ring: Graphics;
  /** Anel do combatente da vez, como o de seleção. */
  turn: Graphics;
  /** Barra de PV, redesenhada a cada cena (barata). */
  bar: Graphics;
  /** O que, se mudar, exige redesenhar (posição, seleção e cursor não exigem). */
  signature: string;
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
  private visionMaskCanvas: HTMLCanvasElement | undefined;
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
    selectedId: null,
    activeId: null,
    conditions: () => [],
    health: () => null,
    viewer: { role: 'player', playerId: '' },
    fogTool: 'none',
  };
  private shownMapKey = '';
  private drag: { id: string; offset: Point } | undefined;
  private pan: { from: Point; camera: Camera } | undefined;
  private rulerMode = false;
  private rulerOptions: RulerOptions = { ...DEFAULT_RULER_OPTIONS };
  private rulerDragging = false;
  private rulerPoints: GridCell[] = [];
  private fogBrush: { mapId: string; mode: FogMode; cells: Map<string, FogCell> } | undefined;
  private fogRect: { mapId: string; mode: FogMode; from: FogCell; to: FogCell } | undefined;
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
    app.stage.on('pointerup', () => {
      this.pointerUp();
    });
    app.stage.on('pointerupoutside', () => {
      this.pointerUp();
    });
    app.stage.on('pointercancel', () => {
      this.pointerUp();
    });
    app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
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
    this.visionMaskTexture?.destroy(true);
    this.lightTintSprite?.destroy();
    this.lightTintTexture?.destroy(true);
    this.app.canvas.removeEventListener('wheel', this.onWheel);
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

  private updateCursor(): void {
    const activeFog = this.scene.viewer.role === 'gm' && this.scene.fogTool !== 'none';
    const crosshair = this.rulerMode || activeFog;
    this.app.canvas.style.cursor = crosshair ? 'crosshair' : '';
    for (const [id, view] of this.views) {
      if (this.drag?.id === id) {
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
      this.drag = undefined;
      this.pan = undefined;
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
    if (token && view) view.container.position.set(token.position.x, token.position.y);
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
      if (this.drag?.id === id) this.drag = undefined;
      view.container.destroy({ children: true });
      this.views.delete(id);
    }
    for (const token of visible) {
      const conditions = this.scene.conditions(token);
      const signature = [token.name, token.size, token.image ?? '', token.ownerIds.length > 0, conditions.join(',')].join('|');
      let view = this.views.get(token.id);
      if (view?.signature !== signature) {
        const old = view?.container;
        view = { ...this.drawToken(token, conditions), signature };
        // Redesenhado no meio de um arrasto: continua onde o ponteiro está.
        if (old && this.drag?.id === token.id) view.container.position.copyFrom(old.position);
        old?.destroy({ children: true });
        this.views.set(token.id, view);
        this.tokenLayer.addChild(view.container);
      }
      view.ring.visible = this.scene.selectedId === token.id;
      view.turn.visible = this.scene.activeId === token.id;
      drawHealthBar(view.bar, tokenSide(token.size), this.scene.health(token));
      if (this.drag?.id !== token.id) {
        view.container.cursor = this.rulerMode ? 'crosshair' : this.scene.canDrag(token) ? 'grab' : 'pointer';
        // Quem está sendo arrastado fica onde o ponteiro está, até soltar.
        view.container.position.set(token.position.x, token.position.y);
      }
    }
  }

  private drawToken(token: Token, conditions: readonly string[]): { container: Container; ring: Graphics; turn: Graphics; bar: Graphics } {
    const side = tokenSide(token.size);
    const radius = side / 2;
    const container = new Container();
    const color = token.ownerIds.length > 0 ? COLORS.playerToken : COLORS.otherToken;
    const disc = new Graphics()
      .circle(radius, radius, radius * 0.92)
      .fill(color)
      .stroke({ width: Math.max(3, side * 0.04), color: COLORS.outline });
    const ring = new Graphics().circle(radius, radius, radius * 0.98).stroke({ width: Math.max(4, side * 0.06), color: COLORS.selected });
    ring.visible = false;
    // Combatente da vez: um anel verde por fora do token.
    const turn = new Graphics().circle(radius, radius, radius * 1.1).stroke({ width: Math.max(4, side * 0.05), color: COLORS.active });
    turn.visible = false;
    container.addChild(turn, disc, ring);

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
        container.addChild(mask, sprite);
      });
    }

    const label = new Text({
      text: token.name,
      style: { fill: COLORS.label, fontSize: 24, fontFamily: 'system-ui, sans-serif', stroke: { color: COLORS.background, width: 6 } },
      resolution: 2,
    });
    label.anchor.set(0.5, 0);
    label.position.set(radius, side + 4 + HEALTH_BAR_HEIGHT + 4);
    const bar = new Graphics();
    bar.position.set(0, side + 4);
    container.addChild(label, bar);
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
    return { container, ring, turn, bar };
  }

  private tokenDown(id: string, e: FederatedPointerEvent): void {
    // Apenas botão esquerdo seleciona e arrasta tokens; botão do meio/direito continua fazendo pan do mapa.
    if (e.button !== 0) return;
    // Em modo régua ou com ferramenta de névoa ativa, cliques não arrastam tokens.
    if (this.rulerMode) return;
    if (this.scene.viewer.role === 'gm' && this.scene.fogTool !== 'none') return;
    // O clique no token não vira arrasto da câmera.
    e.stopPropagation();
    this.pan = undefined;
    // Permissão conferida na hora (a cena pode ter mudado desde que o token foi desenhado).
    const token = this.scene.tokens.find((t) => t.id === id);
    const container = this.views.get(id)?.container;
    if (token && container && this.scene.canDrag(token)) {
      const world = screenToWorld(this.camera, e.global);
      this.drag = { id, offset: { x: world.x - container.x, y: world.y - container.y } };
      container.cursor = 'grabbing';
      // Por cima dos outros enquanto arrasta.
      this.tokenLayer.addChild(container);
    }
    this.events.onSelect(id);
  }

  private stageDown(e: FederatedPointerEvent): void {
    if (this.drag) return;
    const map = this.scene.map;
    if (map && this.scene.viewer.role === 'gm' && this.scene.fogTool !== 'none' && e.button === 0) {
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
      if (e.button === 0 && map) {
        const cell = worldToGridCell(screenToWorld(this.camera, e.global), map);
        if (this.rulerOptions.shape === 'line' && e.shiftKey && this.rulerPoints.length >= 2) {
          this.rulerPoints = [...this.rulerPoints, cell];
        } else {
          this.rulerPoints = [cell, cell];
        }
        this.rulerDragging = true;
        this.renderRuler();
        return;
      }
      if (e.button === 1) {
        this.pan = { from: { x: e.global.x, y: e.global.y }, camera: this.camera };
      }
      return;
    }
    if (e.button === 0) this.events.onSelect(null);
    this.pan = { from: { x: e.global.x, y: e.global.y }, camera: this.camera };
  }

  private pointerMove(e: FederatedPointerEvent): void {
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
      const world = screenToWorld(this.camera, e.global);
      this.views.get(this.drag.id)?.container.position.set(world.x - this.drag.offset.x, world.y - this.drag.offset.y);
      return;
    }
    if (this.pan) {
      const { from, camera } = this.pan;
      this.setCamera({ ...camera, x: camera.x + e.global.x - from.x, y: camera.y + e.global.y - from.y });
    }
  }

  private pointerUp(): void {
    this.rulerDragging = false;
    this.pan = undefined;
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
    const view = this.views.get(drag.id)?.container;
    const token = this.scene.tokens.find((t) => t.id === drag.id);
    const map = this.scene.map;
    if (!view || !token || !map) return;
    view.cursor = 'grab';
    const to = placeToken({ x: view.x, y: view.y }, token.size, map);
    view.position.set(to.x, to.y);
    if (to.x !== token.position.x || to.y !== token.position.y) this.events.onMove(token.id, to);
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

    if (!this.visionMaskCanvas || !this.lightTintCanvas || !this.visionMaskSprite || !this.lightTintSprite || !this.visionMaskTexture || !this.lightTintTexture) {
      this.visionMaskCanvas = document.createElement('canvas');
      this.lightTintCanvas = document.createElement('canvas');
      this.visionMaskCanvas.width = map.width;
      this.visionMaskCanvas.height = map.height;
      this.lightTintCanvas.width = map.width;
      this.lightTintCanvas.height = map.height;

      this.visionMaskTexture = new Texture({
        source: new CanvasSource({ resource: this.visionMaskCanvas, scaleMode: 'linear' }),
      });
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

    const { selfUnseenTokenIds } = composeSmooth2dVisionAndLight(
      this.visionMaskCanvas,
      this.lightTintCanvas,
      map,
      this.scene.tokens,
      this.scene.viewer,
      fogOptions,
    );

    const worldW = map.width * WORLD_UNITS_PER_CELL;
    const worldH = map.height * WORLD_UNITS_PER_CELL;
    this.visionMaskTexture.source.update();
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
    const mask = this.visionMaskCanvas;
    if (!mask) return true;
    const ctx2d = mask.getContext('2d');
    if (!ctx2d || map.width <= 0 || map.height <= 0) return true;
    const px = Math.min(mask.width - 1, Math.max(0, Math.floor((cellX / map.width) * mask.width)));
    const py = Math.min(mask.height - 1, Math.max(0, Math.floor((cellY / map.height) * mask.height)));
    const pixel = ctx2d.getImageData(px, py, 1, 1).data;
    const bright = pixel[1] ?? 0;
    const fogFill = pixel[3] ?? 255;
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

  private isOverlayInteractive(): boolean {
    if (this.rulerMode) return false;
    return !(this.scene.viewer.role === 'gm' && this.scene.fogTool !== 'none');
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

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.setCamera(zoomAt(this.camera, { x: e.offsetX, y: e.offsetY }, Math.exp(-e.deltaY * ZOOM_SPEED)));
  };
}
