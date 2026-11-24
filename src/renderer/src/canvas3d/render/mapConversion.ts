import {
  Container3D,
  DirectionalLight,
  FlatMaterial,
  Geometry3D,
  Mesh3D,
  View3D,
} from '@pixi/3d';
import { Application } from 'pixi.js';
import type { GameMap } from '../../../../shared/protocol';
import type { ImageSize } from '../../canvas/map-grid';
import {
  DEFAULT_INTERIOR_DEPTH_FEET,
  gridFromMapDocument,
  interiorGridFromMapDocument,
  parseMapDocument,
} from '../map/mapDocument';
import { TILE_SIZE_FEET, TILE_SIZE_METERS } from '../terrain/constants';
import { AssetManager } from './assetManager';
import { LightingManager, type LightingSceneHost } from './lightingSystem';
import { LiquidRenderer } from './liquidRenderer';
import './pixi3dUnsafeEval';
import { TerrainRenderer } from './terrainRenderer';

/**
 * Conversões bidirecionais entre mapas 2D e 3D:
 * - 2D → 3D: calcula as dimensões métricas exatas do plano de chão e da imagem
 *   (respeitando `cellPx`, sem distorcer) e constrói o grid plano sobreposto.
 * - 3D → 2D: calcula a resolução de tile e as dimensões da imagem de saída, e
 *   renderiza a cena 3D com câmera ortográfica de topo (`top-down`) em um
 *   `<canvas>` 2D cacheado por hash SHA-256 (`scene3d`).
 */

export const TOP_DOWN_TARGET_TILE_PX = 96;
export const TOP_DOWN_MIN_TILE_PX = 16;
export const TOP_DOWN_MAX_RENDER_DIM = 4096;

const TOP_DOWN_CAMERA_Y = 120;
const TOP_DOWN_NEAR = 1;
const TOP_DOWN_FAR = 260;
const METERS_PER_FOOT = TILE_SIZE_METERS / TILE_SIZE_FEET;

export interface Flat2dMapPlaneMetrics {
  /** Dimensões totais do mapa (grid) em metros. */
  readonly mapWidthMeters: number;
  readonly mapLengthMeters: number;
  readonly floorCenterX: number;
  readonly floorCenterZ: number;
  /** Dimensões e centro do plano da imagem em metros, ou `null` quando não há imagem. */
  readonly imagePlane: {
    readonly widthMeters: number;
    readonly lengthMeters: number;
    readonly centerX: number;
    readonly centerZ: number;
  } | null;
}

export interface TopDownRenderSpec {
  /** Dimensões do mapa em tiles. */
  readonly widthTiles: number;
  readonly lengthTiles: number;
  /** Resolução inteira por tile em pixels. */
  readonly pixelsPerTile: number;
  /** Dimensões finais da imagem 2D em pixels (múltiplo exato dos tiles). */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Dimensões do mapa no espaço 3D (metros). */
  readonly worldWidth: number;
  readonly worldLength: number;
  /** Posição e projeção da câmera ortográfica de topo. */
  readonly cameraX: number;
  readonly cameraY: number;
  readonly cameraZ: number;
  readonly orthographicSize: number;
  readonly near: number;
  readonly far: number;
}

export interface Rendered3dTopDown {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly cellPx: number;
}

/**
 * Calcula o tamanho e o posicionamento do plano 3D para abrir um mapa 2D no
 * visualizador 3D. Quando `cellPx` está definido, preserva a escala real da
 * imagem (alinhada ao canto `(0, 0)`) sem esticar bordas parciais.
 */
export function compute2dMapPlaneMetrics(
  map: Pick<GameMap, 'width' | 'height' | 'cellPx'>,
  imageSize: ImageSize | null,
): Flat2dMapPlaneMetrics {
  const mapWidthMeters = map.width * TILE_SIZE_METERS;
  const mapLengthMeters = map.height * TILE_SIZE_METERS;
  const floorCenterX = mapWidthMeters / 2;
  const floorCenterZ = mapLengthMeters / 2;

  if (imageSize === null) {
    return {
      mapWidthMeters,
      mapLengthMeters,
      floorCenterX,
      floorCenterZ,
      imagePlane: null,
    };
  }

  const imgCellsW = map.cellPx !== null ? imageSize.width / map.cellPx : map.width;
  const imgCellsH = map.cellPx !== null ? imageSize.height / map.cellPx : map.height;
  const widthMeters = imgCellsW * TILE_SIZE_METERS;
  const lengthMeters = imgCellsH * TILE_SIZE_METERS;

  return {
    mapWidthMeters,
    mapLengthMeters,
    floorCenterX,
    floorCenterZ,
    imagePlane: {
      widthMeters,
      lengthMeters,
      centerX: widthMeters / 2,
      centerZ: lengthMeters / 2,
    },
  };
}

/**
 * Calcula a resolução por tile, as dimensões em pixels e os parâmetros da
 * câmera ortográfica de topo para renderizar um mapa 3D em imagem 2D com
 * encaixe exato de 1:1 com o grid lógico.
 */
export function computeTopDownRenderSpec(
  widthTiles: number,
  lengthTiles: number,
  maxRenderDim = TOP_DOWN_MAX_RENDER_DIM,
): TopDownRenderSpec {
  const safeW = Math.max(1, Math.round(widthTiles));
  const safeL = Math.max(1, Math.round(lengthTiles));
  const maxTiles = Math.max(safeW, safeL);
  const clampedMaxDim = Math.max(TOP_DOWN_MIN_TILE_PX, Math.floor(maxRenderDim));
  const maxPxPerTile = Math.floor(clampedMaxDim / maxTiles);
  const pixelsPerTile = Math.max(1, Math.min(TOP_DOWN_TARGET_TILE_PX, maxPxPerTile));

  const pixelWidth = safeW * pixelsPerTile;
  const pixelHeight = safeL * pixelsPerTile;
  const worldWidth = safeW * TILE_SIZE_METERS;
  const worldLength = safeL * TILE_SIZE_METERS;

  return {
    widthTiles: safeW,
    lengthTiles: safeL,
    pixelsPerTile,
    pixelWidth,
    pixelHeight,
    worldWidth,
    worldLength,
    cameraX: worldWidth / 2,
    cameraY: TOP_DOWN_CAMERA_Y,
    cameraZ: worldLength / 2,
    orthographicSize: worldWidth / 2,
    near: TOP_DOWN_NEAR,
    far: TOP_DOWN_FAR,
  };
}

/**
 * Constrói uma malha leve de linhas de grid (`line-list`) sobre o plano `y = 0.008`
 * para mapas 2D abertos em 3D, evitando criar chunks de terreno 3D desnecessários.
 */
export function createFlat2dGridOverlay(widthTiles: number, lengthTiles: number): {
  mesh: Mesh3D;
  geometry: Geometry3D;
  material: FlatMaterial;
} {
  const worldW = widthTiles * TILE_SIZE_METERS;
  const worldL = lengthTiles * TILE_SIZE_METERS;
  const lineCount = widthTiles + 1 + (lengthTiles + 1);
  const positions = new Float32Array(lineCount * 2 * 3);
  const colors = new Float32Array(lineCount * 2 * 3);
  const y = 0.008;

  let pi = 0;
  let ci = 0;
  const pushLine = (x0: number, z0: number, x1: number, z1: number, isBorder: boolean): void => {
    positions[pi++] = x0;
    positions[pi++] = y;
    positions[pi++] = z0;
    positions[pi++] = x1;
    positions[pi++] = y;
    positions[pi++] = z1;

    const r = isBorder ? 0.56 : 1;
    const g = isBorder ? 0.49 : 1;
    const b = isBorder ? 0.97 : 1;
    colors[ci++] = r;
    colors[ci++] = g;
    colors[ci++] = b;
    colors[ci++] = r;
    colors[ci++] = g;
    colors[ci++] = b;
  };

  for (let x = 0; x <= widthTiles; x++) {
    const wx = x * TILE_SIZE_METERS;
    pushLine(wx, 0, wx, worldL, x === 0 || x === widthTiles);
  }
  for (let z = 0; z <= lengthTiles; z++) {
    const wz = z * TILE_SIZE_METERS;
    pushLine(0, wz, worldW, wz, z === 0 || z === lengthTiles);
  }

  const geometry = new Geometry3D({
    positions,
    colors,
    topology: 'line-list',
  });
  const material = new FlatMaterial({
    baseColor: 0xffffff,
    vertexColors: true,
    alphaMode: 'blend',
    alpha: 0.28,
  });
  const mesh = new Mesh3D({
    geometry,
    material,
    castShadow: false,
    receiveShadow: false,
    label: 'flat2dGridMesh',
  });

  return { mesh, geometry, material };
}

/** Cache em memória por hash SHA-256 do documento 3D (conteúdo imutável). */
const topDownCache = new Map<string, Promise<Rendered3dTopDown>>();

/**
 * Renderiza um mapa 3D (`scene3d`) a partir da câmera ortográfica de topo
 * (`top-down`) em um `<canvas>` 2D com dimensão e resolução por tile exatas.
 * Reutiliza o cache por SHA-256 para trocas instantâneas entre 2D e 3D.
 */
export function render3dMapTo2dCanvas(sceneHash: string, mapName: string): Promise<Rendered3dTopDown> {
  const cached = topDownCache.get(sceneHash);
  if (cached) return cached;

  const job = render3dMapTo2dCanvasUncached(sceneHash, mapName).catch((err: unknown) => {
    topDownCache.delete(sceneHash);
    throw err;
  });
  topDownCache.set(sceneHash, job);
  return job;
}

async function render3dMapTo2dCanvasUncached(sceneHash: string, mapName: string): Promise<Rendered3dTopDown> {
  const response = await fetch(`vtt-asset://${sceneHash}`);
  if (!response.ok) {
    throw new Error(`Não foi possível carregar o mapa 3D (HTTP ${response.status})`);
  }
  const raw: unknown = await response.json();
  const doc = parseMapDocument(raw, mapName);

  const surfaceGrid = gridFromMapDocument(doc);
  const interiorGrid = interiorGridFromMapDocument(doc);
  const spec = computeTopDownRenderSpec(surfaceGrid.width, surfaceGrid.length);

  const app = new Application();
  await app.init({
    width: spec.pixelWidth,
    height: spec.pixelHeight,
    resolution: 1,
    backgroundColor: 0x16151a,
    antialias: true,
    preference: 'webgl',
    preserveDrawingBuffer: true,
  });

  let assets: AssetManager | null = null;
  try {
    const view = new View3D({
      width: spec.pixelWidth,
      height: spec.pixelHeight,
      autoResize: false,
      shadowQuality: 'medium',
      toneMapping: 'none',
      environment: {
        skyColor: 0xc2d8f0,
        groundColor: 0x524839,
        intensity: 0.62,
      },
    });
    view.fog = null;
    app.stage.addChild(view);

    const worldRoot = new Container3D({ label: 'offscreenWorldRoot' });
    const surfaceRoot = new Container3D({ label: 'offscreenSurfaceRoot' });
    const terrainRoot = new Container3D({ label: 'offscreenTerrainRoot' });
    const liquidRoot = new Container3D({ label: 'offscreenLiquidRoot' });
    const propsRoot = new Container3D({ label: 'offscreenPropsRoot' });
    surfaceRoot.addChild(terrainRoot, liquidRoot, propsRoot);

    const interiorRoot = new Container3D({ label: 'offscreenInteriorRoot' });
    const interiorTerrainRoot = new Container3D({ label: 'offscreenInteriorTerrainRoot' });
    const interiorLiquidRoot = new Container3D({ label: 'offscreenInteriorLiquidRoot' });
    const interiorPropsRoot = new Container3D({ label: 'offscreenInteriorPropsRoot' });
    interiorRoot.addChild(interiorTerrainRoot, interiorLiquidRoot, interiorPropsRoot);

    const lightsRoot = new Container3D({ label: 'offscreenLightsRoot' });
    const overlayRoot = new Container3D({ label: 'offscreenOverlayRoot' });
    worldRoot.addChild(surfaceRoot, interiorRoot, lightsRoot, overlayRoot);
    view.root.addChild(worldRoot);

    const maxSpan = Math.max(spec.worldWidth, spec.worldLength);
    const sunScale = Math.max(0.6, maxSpan / 48);
    const sun = new DirectionalLight({
      color: 0xfff5e4,
      intensity: 2.7,
      castShadow: true,
    });
    sun.position.set(spec.cameraX - 24 * sunScale, 34 * sunScale, spec.cameraZ + 30 * sunScale);
    sun.lookAt({ x: spec.cameraX, y: 0, z: spec.cameraZ });
    view.root.addChild(sun);

    const surfaceRenderer = new TerrainRenderer(surfaceGrid, terrainRoot, overlayRoot);
    const interiorRenderer = new TerrainRenderer(interiorGrid, interiorTerrainRoot, overlayRoot);
    const liquids = new LiquidRenderer(liquidRoot, interiorLiquidRoot, overlayRoot, surfaceGrid, interiorGrid);
    assets = new AssetManager(surfaceGrid, propsRoot, interiorGrid, interiorPropsRoot);

    const interiorDepthFeet = doc.settings.interiorDepthFeet ?? DEFAULT_INTERIOR_DEPTH_FEET;
    const interiorOffsetY = -interiorDepthFeet * METERS_PER_FOOT;
    interiorRoot.position.y = interiorOffsetY;
    assets.setInteriorOffsetY(interiorOffsetY);

    surfaceRenderer.setShadingMode(doc.settings.shadingMode);
    interiorRenderer.setShadingMode(doc.settings.shadingMode);
    // O palco 2D já desenha o próprio grid por cima da imagem.
    surfaceRenderer.setGridVisible(false);
    interiorRenderer.setGridVisible(false);

    if (doc.settings.roofCutaway !== undefined) {
      assets.setRoofCutaway(doc.settings.roofCutaway);
    }

    if (doc.liquids && doc.liquids.length > 0) {
      liquids.loadSurfaces(doc.liquids);
    }

    const hasHoles = surfaceGrid.holes.some((h) => h !== 0);
    const hasInteriorLiquids = (doc.liquids ?? []).some((l) => l.layer === 'interior');
    const hasInteriorProps = doc.props.some((p) => p.layer === 'interior');
    interiorRoot.visible = hasHoles || hasInteriorLiquids || hasInteriorProps;

    // Aplica a iluminação salva do mapa sem habilitar neblina na captura ortográfica de topo.
    const lightingHost: LightingSceneHost = {
      sun,
      skybox: { applyLightingSettings: () => undefined },
      setEnvironmentAndAtmosphere: (opts) => {
        view.environment = {
          skyColor: opts.skyColor,
          groundColor: opts.groundColor,
          intensity: opts.ambientIntensity,
        };
        view.fog = null;
        app.renderer.background.color = opts.backdropColor;
      },
      fitSunShadows: () => {
        sun.fitShadowBounds();
      },
    };
    const lighting = new LightingManager(lightingHost, lightsRoot);
    lighting.onMoodTintChange = (tintHex) => {
      surfaceRenderer.setUnlitMoodTint(tintHex);
      interiorRenderer.setUnlitMoodTint(tintHex);
      liquids.setUnlitMoodTint(tintHex);
    };
    lighting.setMapBounds(surfaceGrid.width, surfaceGrid.length);
    if (doc.settings.lighting) {
      lighting.loadSettings(doc.settings.lighting);
    }

    await assets.loadCatalog();
    if (doc.props.length > 0) {
      await assets.loadSerializedProps(doc.props);
    }

    lighting.syncLightSources(surfaceGrid, assets.getPlacedForLayer('surface'), 0);
    sun.fitShadowBounds();

    // Câmera ortográfica exatamente de topo: -Z (Norte) aponta para cima, +X (Leste) para a direita.
    view.camera.useOrthographic(spec.orthographicSize, spec.near, spec.far);
    view.camera.zoom = 1;
    view.camera.position.set(spec.cameraX, spec.cameraY, spec.cameraZ);
    view.camera.rotation.set(-Math.PI / 2, 0, 0);

    // Dois passes garantem atualização completa das matrizes e dos shadow maps antes da cópia.
    app.renderer.render(app.stage);
    app.renderer.render(app.stage);

    const output = document.createElement('canvas');
    output.width = spec.pixelWidth;
    output.height = spec.pixelHeight;
    const ctx = output.getContext('2d');
    if (!ctx) {
      throw new Error('Não foi possível criar o contexto 2D para a imagem do mapa');
    }
    ctx.drawImage(app.canvas, 0, 0, spec.pixelWidth, spec.pixelHeight);

    return {
      canvas: output,
      width: spec.pixelWidth,
      height: spec.pixelHeight,
      cellPx: spec.pixelsPerTile,
    };
  } finally {
    assets?.destroy();
    app.destroy(true, { children: true });
  }
}
