// O PixiJS gera código de shader com `new Function`, que a CSP da tela bloqueia; este módulo troca por versões prontas.
import 'pixi.js/unsafe-eval';
import { Application, Container, type FederatedPointerEvent, Graphics, ImageSource, Sprite, Text, Texture } from 'pixi.js';
import { type GameMap, type Point, type Token, WORLD_UNITS_PER_CELL } from '../../../shared/protocol';
import { type Camera, fitMap, placeToken, screenToWorld, tokenSide, zoomAt } from './geometry';
import { type Health, healthColor } from './health';
import { backgroundWorldSize } from './map-grid';

/**
 * O mapa em PixiJS v8, desacoplado do React (CLAUDE.md): a tela entrega a
 * cena (`setScene`) e recebe as intenções (`onMove`, `onSelect`). Nada aqui
 * muda o estado da campanha: soltar um token só pede o `token.move`; quem
 * decide é o Host, e a posição volta pela próxima cena.
 */

export interface Scene {
  map: GameMap | null;
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
}

export interface MapStageEvents {
  onMove: (tokenId: string, to: Point) => void;
  onSelect: (tokenId: string | null) => void;
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

export class MapStage {
  private readonly world = new Container();
  private readonly backgroundLayer = new Container();
  private readonly gridLayer = new Graphics();
  private readonly tokenLayer = new Container();
  private readonly views = new Map<string, TokenView>();
  private readonly textures = new Map<string, Promise<Texture | null>>();
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private scene: Scene = { map: null, tokens: [], canDrag: () => false, selectedId: null, activeId: null, conditions: () => [], health: () => null };
  private shownMapKey = '';
  private drag: { id: string; offset: Point } | undefined;
  private pan: { from: Point; camera: Camera } | undefined;
  private destroyed = false;

  private constructor(
    private readonly app: Application,
    private readonly events: MapStageEvents,
  ) {
    this.world.addChild(this.backgroundLayer, this.gridLayer, this.tokenLayer);
    app.stage.addChild(this.world);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', (e) => {
      this.startPan(e);
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
    const mapKey = map ? `${map.id}:${map.width}x${map.height}:${map.background ?? ''}:${map.cellPx ?? ''}` : '';
    if (mapKey !== this.shownMapKey) {
      const changedMap = map?.id !== this.shownMapKey.split(':')[0];
      this.shownMapKey = mapKey;
      this.drawMap(map);
      if (map && changedMap) this.setCamera(fitMap(map, this.app.screen));
    }
    this.syncTokens();
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
  }

  private drawMap(map: GameMap | null): void {
    this.backgroundLayer.removeChildren().forEach((child) => { child.destroy(); });
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
        view.container.cursor = this.scene.canDrag(token) ? 'grab' : 'pointer';
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
    // O clique no token não vira arrasto da câmera.
    e.stopPropagation();
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

  private startPan(e: FederatedPointerEvent): void {
    this.events.onSelect(null);
    this.pan = { from: { x: e.global.x, y: e.global.y }, camera: this.camera };
  }

  private pointerMove(e: FederatedPointerEvent): void {
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
    this.pan = undefined;
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

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.setCamera(zoomAt(this.camera, { x: e.offsetX, y: e.offsetY }, Math.exp(-e.deltaY * ZOOM_SPEED)));
  };
}
