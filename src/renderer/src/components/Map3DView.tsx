import { FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';
import { ImageSource, Texture } from 'pixi.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VisionProfile } from 'rules-engine/vision';
import type { TableView } from '../../../shared/ipc';
import {
  extractHeightfieldFromMapDoc,
  extractPropLightsFrom3dMapDocument,
  type GameMap,
  resolveActiveLightSources,
  type SessionCharacter,
  type Token,
} from '../../../shared/protocol';
import { conditionLabels, timedEffectLabels, tokenConditions } from '../canvas/conditions';
import type { FogTool, FogViewer } from '../canvas/fog-render';
import { tokenHealth } from '../canvas/health';
import type { MapStageHandle } from '../canvas/MapStage';
import { DEFAULT_RULER_OPTIONS, type RulerOptions } from '../canvas/ruler';
import {
  DEFAULT_INTERIOR_DEPTH_FEET,
  gridFromMapDocument,
  interiorGridFromMapDocument,
  parseMapDocument,
} from '../canvas3d/map/mapDocument';
import { AssetManager } from '../canvas3d/render/assetManager';
import { FogLayer3d } from '../canvas3d/render/fogLayer3d';
import { LightingManager } from '../canvas3d/render/lightingSystem';
import { LiquidRenderer } from '../canvas3d/render/liquidRenderer';
import { compute2dMapPlaneMetrics, createFlat2dGridOverlay } from '../canvas3d/render/mapConversion';
import { RulerTool3d } from '../canvas3d/render/rulerTool3d';
import { type CameraViewMode, SceneManager } from '../canvas3d/render/sceneManager';
import { TerrainRenderer } from '../canvas3d/render/terrainRenderer';
import { cameraTargetToWorld2d } from '../canvas3d/render/tokenGeometry3d';
import { TokenRenderer3d } from '../canvas3d/render/tokenRenderer3d';
import {
  applyVisionMaskToMaterial,
  mapLightingConfigToPreset,
  visionLighting3dBit,
} from '../canvas3d/render/visionShader3d';
import { METERS_PER_FOOT, TILE_SIZE_METERS } from '../canvas3d/terrain/constants';
import { TerrainGrid } from '../canvas3d/terrain/terrainGrid';
import { sendIntent } from '../store/table';
import { FogHudControls } from './FogHudControls';
import type { MapViewerMode } from './MapView';
import { RulerOptionsBar } from './RulerControls';

/**
 * Visualização 3D da mesa (somente leitura do terreno): usada por jogadores e
 * pelo mestre durante a sessão, sem ferramentas de edição de mapa.
 * Suporta tanto mapas 3D nativos (`scene3d !== null`) quanto mapas 2D abertos
 * em 3D (convertidos em um plano texturizado com as dimensões exatas do grid).
 * Tokens funcionam exatamente como no 2D (seleção, arrasto `token.move`, barras
 * de PV, condições e anel de turno): planos no modo `top_down` e com billboard
 * vertical nos modos `perspective` e `orthographic`.
 */

interface Props {
  view: TableView;
  map: GameMap;
  maxima: Record<string, number>;
  visionProfiles?: Readonly<Record<string, VisionProfile>>;
  selectedId: string | null;
  fogTool: FogTool;
  onFogTool: (tool: FogTool) => void;
  onSelect: (tokenId: string | null) => void;
  onStage: (stage: MapStageHandle | null) => void;
  isGm: boolean;
  onViewerModeChange: (mode: MapViewerMode) => void;
  onEditMap?: ((map: GameMap) => void) | undefined;
}

interface ActiveViewer {
  scene: SceneManager;
  setGridVisible: (visible: boolean) => void;
  tokens3d: TokenRenderer3d;
  ruler3d: RulerTool3d | null;
  fog3d: FogLayer3d;
  syncLightingAndVision: (
    nextMap: GameMap,
    tokens: readonly Token[],
    viewerInfo: FogViewer,
    profiles: Readonly<Record<string, VisionProfile>> | undefined,
    characters: Readonly<Record<string, SessionCharacter>>,
  ) => void;
  width: number;
  length: number;
  destroy: () => void;
}

function runtimeLightsSignature(map: GameMap, tokens: readonly Token[]): string {
  const tokenMap = new Map(tokens.map((t) => [t.id, t]));
  const lightsPart = map.lights
    .map((l) => {
      const att =
        l.attach.kind === 'point'
          ? `p:${l.attach.x},${l.attach.y}`
          : (() => {
              const t = tokenMap.get(l.attach.tokenId);
              return t ? `t:${t.id}:${t.position.x},${t.position.y}` : `t:${l.attach.tokenId}`;
            })();
      return `${l.id}:${l.kind}:${l.enabled ? '1' : '0'}:${l.brightFeet}/${l.dimFeet}/${l.darknessFeet}:${l.color}:${l.layer}:${l.elevationFeet}:${att}`;
    })
    .join(';');
  const ovPart = Object.entries(map.propLightOverrides)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${lightsPart}|${ovPart}`;
}

function load2dBackgroundImage(sha256: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error('Não foi possível carregar a imagem do mapa 2D'));
    };
    img.src = `vtt-asset://${sha256}`;
  });
}

export function Map3DView({ view, map, maxima, visionProfiles, selectedId, fogTool, onFogTool, onSelect, onStage, isGm, onViewerModeChange, onEditMap }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ActiveViewer | null>(null);
  const [viewer, setViewer] = useState<ActiveViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [camMode, setCamMode] = useState<CameraViewMode>('perspective');
  const [gridVisible, setGridVisible] = useState(true);
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerOptions, setRulerOptions] = useState<RulerOptions>({ ...DEFAULT_RULER_OPTIONS });
  const [fogHudOpen, setFogHudOpen] = useState(false);
  const [previewTokenVision, setPreviewTokenVision] = useState(true);

  const latest = useRef({ onSelect, onStage });
  useLayoutEffect(() => {
    latest.current = { onSelect, onStage };
  });

  const sceneHash = map.scene3d;
  const bgHash = map.background;
  const cellPx = map.cellPx;
  const mapWidth = map.width;
  const mapHeight = map.height;
  const mapName = map.name;

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;

    let cancelled = false;
    const isCancelled = (): boolean => cancelled;
    let active: ActiveViewer | null = null;

    setLoading(true);
    setError(null);
    setCamMode('perspective');

    const mountFlat2dMap = async (): Promise<void> => {
      const surfaceGrid = new TerrainGrid(mapWidth, mapHeight);
      const scene = await SceneManager.create(element, mapWidth, mapHeight);
      if (isCancelled()) {
        scene.destroy();
        return;
      }

      scene.setLeftButtonAction('pan');
      scene.skybox.mesh.visible = false;
      scene.setEnvironmentAndAtmosphere({
        skyColor: 0xd0d4de,
        groundColor: 0x22212a,
        ambientIntensity: 0.9,
        backdropColor: 0x16151a,
        fogEnabled: false,
        fogColor: 0x16151a,
        fogNear: 100,
        fogFar: 200,
      });

      let bgImage: HTMLImageElement | null = null;
      if (bgHash !== null) {
        try {
          bgImage = await load2dBackgroundImage(bgHash);
        } catch (err: unknown) {
          if (!isCancelled()) {
            setError(err instanceof Error ? err.message : 'Não foi possível carregar a imagem do mapa 2D');
          }
        }
        if (isCancelled()) {
          scene.destroy();
          return;
        }
      }

      const metrics = compute2dMapPlaneMetrics(
        { width: mapWidth, height: mapHeight, cellPx },
        bgImage ? { width: bgImage.naturalWidth, height: bgImage.naturalHeight } : null,
      );

      // Piso plano cobrindo todo o grid lógico (visível sem imagem ou em bordas parciais de `cellPx`).
      const floorGeo = new PlaneGeometry({ width: metrics.mapWidthMeters, height: metrics.mapLengthMeters });
      const floorMat = new FlatMaterial({ baseColor: 0x22212a, doubleSided: true, extraBits: [visionLighting3dBit] });
      const floorMesh = new Mesh3D({
        geometry: floorGeo,
        material: floorMat,
        castShadow: false,
        receiveShadow: false,
        label: 'flat2dFloor',
      });
      floorMesh.position.set(metrics.floorCenterX, -0.004, metrics.floorCenterZ);
      floorMesh.rotation.set(-Math.PI / 2, 0, 0);
      scene.terrainRoot.addChild(floorMesh);

      let imageGeo: PlaneGeometry | null = null;
      let imageMat: FlatMaterial | null = null;
      let imageTex: Texture | null = null;
      if (bgImage && metrics.imagePlane) {
        imageTex = new Texture({ source: new ImageSource({ resource: bgImage }) });
        imageGeo = new PlaneGeometry({
          width: metrics.imagePlane.widthMeters,
          height: metrics.imagePlane.lengthMeters,
          flipV: true,
        });
        imageMat = new FlatMaterial({ baseColorTexture: imageTex, doubleSided: true, extraBits: [visionLighting3dBit] });
        const imageMesh = new Mesh3D({
          geometry: imageGeo,
          material: imageMat,
          castShadow: false,
          receiveShadow: false,
          label: 'flat2dImagePlane',
        });
        imageMesh.position.set(metrics.imagePlane.centerX, 0, metrics.imagePlane.centerZ);
        imageMesh.rotation.set(-Math.PI / 2, 0, 0);
        scene.terrainRoot.addChild(imageMesh);
      }

      const lighting = new LightingManager(scene, scene.lightsRoot);
      lighting.setMapBounds(mapWidth, mapHeight);

      const gridOverlay = createFlat2dGridOverlay(mapWidth, mapHeight);
      scene.overlayRoot.addChild(gridOverlay.mesh);
      setGridVisible(true);

      scene.configureForMap(mapWidth, mapHeight);

      const fog3d = new FogLayer3d(
        scene,
        surfaceGrid,
        {
          onFogPaint: (mapId, mode, cells) => {
            void sendIntent({ kind: 'fog.manual.paint', data: { mapId, mode, cells } }).then(setError);
          },
          onFogRect: (mapId, mode, from, to) => {
            void sendIntent({ kind: 'fog.manual.rect', data: { mapId, mode, from, to } }).then(setError);
          },
        },
        undefined,
        [],
      );

      const tokens3d = new TokenRenderer3d(scene, surfaceGrid, {
        onSelect: (id) => {
          latest.current.onSelect(id);
        },
        onMove: (tokenId, to) => {
          void sendIntent({ kind: 'token.move', data: { tokenId, to } }).then((refused) => {
            setError(refused);
            if (refused) tokens3d.revert(tokenId);
          });
        },
      });

      scene.app.ticker.add((ticker) => {
        lighting.tick(ticker.deltaMS / 1000, true);
        tokens3d.tick();
      });

      let lastFlatLightsSig = '';
      const worldW = mapWidth * TILE_SIZE_METERS;
      const worldL = mapHeight * TILE_SIZE_METERS;

      active = {
        scene,
        setGridVisible: (visible) => {
          gridOverlay.mesh.visible = visible;
        },
        tokens3d,
        ruler3d: null,
        fog3d,
        syncLightingAndVision: (nextMap, tokens, viewerInfo, profiles, characters) => {
          fog3d.setScene(nextMap, tokens, viewerInfo, {
            ...(profiles ? { visionProfiles: profiles } : {}),
            characters,
          });
          const isGmOverview = viewerInfo.role === 'gm' && !viewerInfo.previewTokenId;
          applyVisionMaskToMaterial(floorMat, fog3d.surfaceVisionTexture, worldW, worldL, true, isGmOverview);
          if (imageMat) {
            applyVisionMaskToMaterial(imageMat, fog3d.surfaceVisionTexture, worldW, worldL, true, isGmOverview);
          }
          const lightsSig = runtimeLightsSignature(nextMap, tokens);
          if (lightsSig !== lastFlatLightsSig) {
            lastFlatLightsSig = lightsSig;
            lighting.syncLightSources(surfaceGrid, [], 0, {
              layer: 'surface',
              runtimeLights: resolveActiveLightSources(nextMap, tokens, []),
              showDarknessSpheres: true,
            });
          }
        },
        width: mapWidth,
        length: mapHeight,
        destroy: () => {
          fog3d.destroy();
          tokens3d.destroy();
          lighting.destroy();
          gridOverlay.geometry.destroy(true);
          gridOverlay.material.destroy();
          floorGeo.destroy(true);
          floorMat.destroy();
          imageGeo?.destroy(true);
          imageMat?.destroy();
          imageTex?.destroy(true);
          scene.destroy();
        },
      };
      viewerRef.current = active;
      setViewer(active);
      latest.current.onStage({
        viewCenter: () => cameraTargetToWorld2d(scene.orbit.target.x, scene.orbit.target.z),
      });
      setLoading(false);
    };

    const mountNative3dMap = async (hash: string): Promise<void> => {
      const response = await fetch(`vtt-asset://${hash}`);
      if (!response.ok) {
        throw new Error(`Não foi possível carregar o mapa 3D (HTTP ${response.status})`);
      }
      const raw: unknown = await response.json();
      const doc = parseMapDocument(raw, mapName);
      if (isCancelled()) return;

      const surfaceGrid = gridFromMapDocument(doc);
      const interiorGrid = interiorGridFromMapDocument(doc);
      const heightfield = extractHeightfieldFromMapDoc(raw);
      const bakedPropLights = extractPropLightsFrom3dMapDocument(raw);

      const scene = await SceneManager.create(element, surfaceGrid.width, surfaceGrid.length);
      if (isCancelled()) {
        scene.destroy();
        return;
      }
      scene.onContextLost = () => {
        if (!isCancelled()) {
          setError('Contexto gráfico 3D (WebGL) perdido. Aguardando restauração…');
        }
      };
      scene.onContextRestored = () => {
        if (!isCancelled()) {
          setError(null);
        }
      };

      // Controles padrão de mesa 3D: botão esquerdo arrasta/faz pan (ou arrasta token), direito orbita, meio faz pan.
      scene.setLeftButtonAction('pan');

      const surfaceRenderer = new TerrainRenderer(surfaceGrid, scene.terrainRoot, scene.overlayRoot);
      const interiorRenderer = new TerrainRenderer(interiorGrid, scene.interiorTerrainRoot, scene.overlayRoot);
      const liquids = new LiquidRenderer(
        scene.liquidRoot,
        scene.interiorLiquidRoot,
        scene.overlayRoot,
        surfaceGrid,
        interiorGrid,
      );
      const assets = new AssetManager(surfaceGrid, scene.propsRoot, interiorGrid, scene.interiorPropsRoot);
      const lighting = new LightingManager(scene, scene.lightsRoot);
      lighting.onMoodTintChange = (tintHex) => {
        surfaceRenderer.setUnlitMoodTint(tintHex);
        interiorRenderer.setUnlitMoodTint(tintHex);
        liquids.setUnlitMoodTint(tintHex);
      };

      const interiorDepthFeet = doc.settings.interiorDepthFeet ?? DEFAULT_INTERIOR_DEPTH_FEET;
      const interiorOffsetY = -interiorDepthFeet * METERS_PER_FOOT;
      scene.setInteriorOffsetY(interiorOffsetY);
      assets.setInteriorOffsetY(interiorOffsetY);

      surfaceRenderer.setShadingMode(doc.settings.shadingMode);
      interiorRenderer.setShadingMode(doc.settings.shadingMode);
      surfaceRenderer.setGridVisible(doc.settings.showGrid);
      interiorRenderer.setGridVisible(doc.settings.showGrid);
      setGridVisible(doc.settings.showGrid);

      if (doc.settings.roofCutaway !== undefined) {
        assets.setRoofCutaway(doc.settings.roofCutaway);
      }

      if (doc.liquids && doc.liquids.length > 0) {
        liquids.loadSurfaces(doc.liquids);
      }

      // Mostra a camada subterrânea quando há aberturas no terreno ou elementos no interior.
      const hasHoles = surfaceGrid.holes.some((h) => h !== 0);
      const hasInteriorLiquids = (doc.liquids ?? []).some((l) => l.layer === 'interior');
      const hasInteriorProps = doc.props.some((p) => p.layer === 'interior');
      scene.interiorRoot.visible = hasHoles || hasInteriorLiquids || hasInteriorProps;

      lighting.setMapBounds(surfaceGrid.width, surfaceGrid.length);
      if (doc.settings.lighting) {
        lighting.loadSettings(doc.settings.lighting);
      }

      scene.configureForMap(surfaceGrid.width, surfaceGrid.length);

      const ruler3d = new RulerTool3d(scene, surfaceRenderer, surfaceGrid);
      const fog3d = new FogLayer3d(
        scene,
        surfaceGrid,
        {
          onFogPaint: (mapId, mode, cells) => {
            void sendIntent({ kind: 'fog.manual.paint', data: { mapId, mode, cells } }).then(setError);
          },
          onFogRect: (mapId, mode, from, to) => {
            void sendIntent({ kind: 'fog.manual.rect', data: { mapId, mode, from, to } }).then(setError);
          },
        },
        assets,
        doc.liquids ?? [],
      );
      const tokens3d = new TokenRenderer3d(scene, surfaceGrid, {
        onSelect: (id) => {
          latest.current.onSelect(id);
        },
        onMove: (tokenId, to) => {
          void sendIntent({ kind: 'token.move', data: { tokenId, to } }).then((refused) => {
            setError(refused);
            if (refused) tokens3d.revert(tokenId);
          });
        },
      });

      scene.app.ticker.add((ticker) => {
        assets.tickAnimations(ticker);
        lighting.tick(ticker.deltaMS / 1000, assets.animationsActive);
        tokens3d.tick();
        ruler3d.tick();
      });

      let lastLightingConfigSig = '';
      let lastLightsSig = '';
      let propsReady = false;
      let latestSync:
        | {
            nextMap: GameMap;
            tokens: readonly Token[];
            viewerInfo: FogViewer;
            profiles: Readonly<Record<string, VisionProfile>> | undefined;
            characters: Readonly<Record<string, SessionCharacter>>;
          }
        | undefined;
      const worldW = surfaceGrid.width * TILE_SIZE_METERS;
      const worldL = surfaceGrid.length * TILE_SIZE_METERS;

      const syncLightingAndVision = (
        nextMap: GameMap,
        tokens: readonly Token[],
        viewerInfo: FogViewer,
        profiles: Readonly<Record<string, VisionProfile>> | undefined,
        characters: Readonly<Record<string, SessionCharacter>>,
      ): void => {
        latestSync = { nextMap, tokens, viewerInfo, profiles, characters };
        const cfgSig = `${nextMap.lighting.environment}:${nextMap.lighting.timeOfDay}:${nextMap.lighting.ambientOverride ?? ''}`;
        if (cfgSig !== lastLightingConfigSig) {
          lastLightingConfigSig = cfgSig;
          lighting.applyPreset(mapLightingConfigToPreset(nextMap.lighting));
        }

        assets.applyPropLightOverrides(nextMap.propLightOverrides);
        fog3d.setScene(nextMap, tokens, viewerInfo, {
          ...(profiles ? { visionProfiles: profiles } : {}),
          characters,
          bakedPropLights,
          heightfield,
        });

        const isGmOverview = viewerInfo.role === 'gm' && !viewerInfo.previewTokenId;
        surfaceRenderer.setVisionMask(fog3d.surfaceVisionTexture, worldW, worldL, true, isGmOverview);
        interiorRenderer.setVisionMask(fog3d.interiorVisionTexture, worldW, worldL, true, isGmOverview);
        assets.setVisionMask('surface', fog3d.surfaceVisionTexture, worldW, worldL, true, isGmOverview);
        assets.setVisionMask('interior', fog3d.interiorVisionTexture, worldW, worldL, true, isGmOverview);

        const lightsSig = runtimeLightsSignature(nextMap, tokens);
        if (propsReady && lightsSig !== lastLightsSig) {
          lastLightsSig = lightsSig;
          lighting.syncLightSources(surfaceGrid, assets.getPlacedForLayer('surface'), 0, {
            layer: 'surface',
            runtimeLights: resolveActiveLightSources(nextMap, tokens, []),
            showDarknessSpheres: true,
          });
        }
        fog3d.syncPropVisibility();
      };

      active = {
        scene,
        setGridVisible: (visible) => {
          surfaceRenderer.setGridVisible(visible);
          interiorRenderer.setGridVisible(visible);
        },
        tokens3d,
        ruler3d,
        fog3d,
        syncLightingAndVision,
        width: surfaceGrid.width,
        length: surfaceGrid.length,
        destroy: () => {
          fog3d.destroy();
          ruler3d.destroy();
          tokens3d.destroy();
          lighting.destroy();
          liquids.destroy();
          surfaceRenderer.destroy();
          interiorRenderer.destroy();
          assets.destroy();
          scene.destroy();
        },
      };
      viewerRef.current = active;
      setViewer(active);
      latest.current.onStage({
        viewCenter: () => cameraTargetToWorld2d(scene.orbit.target.x, scene.orbit.target.z),
      });

      await assets.loadCatalog();
      if (isCancelled()) return;
      if (doc.props.length > 0) {
        await assets.loadSerializedProps(doc.props);
      }
      if (isCancelled()) return;

      propsReady = true;
      if (latestSync) {
        lastLightsSig = '';
        syncLightingAndVision(
          latestSync.nextMap,
          latestSync.tokens,
          latestSync.viewerInfo,
          latestSync.profiles,
          latestSync.characters,
        );
      } else {
        fog3d.syncPropVisibility();
        lighting.syncLightSources(surfaceGrid, assets.getPlacedForLayer('surface'), 0, {
          layer: 'surface',
          showDarknessSpheres: true,
        });
      }
      scene.fitSunShadows();
      setLoading(false);
    };

    const mount = sceneHash !== null ? mountNative3dMap(sceneHash) : mountFlat2dMap();
    void mount.catch((err: unknown) => {
      if (isCancelled()) return;
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o mapa 3D');
    });

    return () => {
      cancelled = true;
      viewerRef.current = null;
      setViewer(null);
      latest.current.onStage(null);
      active?.destroy();
    };
  }, [map.id, sceneHash, bgHash, cellPx, mapWidth, mapHeight, mapName]);

  const { state, info } = view;
  const selectedToken = selectedId !== null ? (state.tokens[selectedId] ?? null) : null;
  const showFogHud = isGm && (fogHudOpen || fogTool !== 'none');

  useEffect(() => {
    const tokens = Object.values(state.tokens);
    const viewerInfo = { role: info.role, playerId: info.playerId, previewTokenId: isGm && previewTokenVision ? selectedId : null };
    viewer?.tokens3d.setScene({
      map,
      tokens,
      canDrag: (token) => info.role === 'gm' || token.ownerIds.includes(info.playerId),
      selectedId,
      activeId: state.combat?.combatants[state.combat.turn]?.tokenId ?? null,
      conditions: (token) => [
        ...conditionLabels(tokenConditions(token, state.characters)),
        ...timedEffectLabels(token, { combat: state.combat, tokens: state.tokens }),
      ],
      health: (token) => tokenHealth(token, state.characters, maxima),
      viewer: viewerInfo,
      fogTool: isGm ? fogTool : 'none',
    });
    viewer?.syncLightingAndVision(map, tokens, viewerInfo, visionProfiles, state.characters);
  }, [viewer, map, state.tokens, state.characters, state.combat, maxima, visionProfiles, info.role, info.playerId, selectedId, isGm, previewTokenVision, fogTool]);

  useEffect(() => {
    if (!viewer) return;
    const activeFog = isGm && fogTool !== 'none';
    const activeRuler = rulerActive && !activeFog;
    viewer.tokens3d.setInteractionEnabled(!activeRuler && !activeFog);
    viewer.ruler3d?.setActive(activeRuler);
    if (activeFog) {
      viewer.fog3d.setTool(fogTool);
    } else {
      viewer.fog3d.setTool('none');
      // Restaura cursor/ação da régua se ela estiver ativa.
      if (activeRuler) viewer.ruler3d?.setActive(true);
    }
  }, [viewer, rulerActive, isGm, fogTool]);

  useEffect(() => {
    viewer?.ruler3d?.setOptions(rulerOptions);
  }, [viewer, rulerOptions]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setRulerActive((prev) => !prev);
      } else if (e.code === 'Escape') {
        setRulerActive(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const setCamera = (mode: CameraViewMode): void => {
    const v = viewerRef.current;
    if (!v) return;
    v.scene.setCameraViewMode(mode);
    v.scene.setLeftButtonAction(rulerActive || (isGm && fogTool !== 'none') ? 'none' : 'pan');
    setCamMode(mode);
  };

  const toggleGrid = (): void => {
    const v = viewerRef.current;
    if (!v) return;
    const next = !gridVisible;
    v.setGridVisible(next);
    setGridVisible(next);
  };

  const resetCamera = (): void => {
    const v = viewerRef.current;
    if (!v) return;
    v.scene.resetCameraToMap(v.width, v.length);
  };

  return (
    <section className="map" aria-label={`Mapa 3D: ${map.name}`}>
      <div ref={hostRef} className="map-canvas" />
      <div className="map3d-hud" role="toolbar" aria-label="Controles da câmera 3D">
        <span className="map3d-badge">3D · {map.name}</span>
        <div className="map3d-hud-group" role="group" aria-label="Visualizador">
          <button
            type="button"
            aria-pressed="false"
            onClick={() => {
              onViewerModeChange('2d');
            }}
          >
            2D
          </button>
          <button type="button" className="active" aria-pressed="true">
            3D
          </button>
        </div>
        <div className="map3d-hud-group" role="group" aria-label="Câmera">
          <button
            type="button"
            className={camMode === 'perspective' ? 'active' : ''}
            onClick={() => {
              setCamera('perspective');
            }}
          >
            3D
          </button>
          <button
            type="button"
            className={camMode === 'orthographic' ? 'active' : ''}
            onClick={() => {
              setCamera('orthographic');
            }}
          >
            Ortho
          </button>
          <button
            type="button"
            className={camMode === 'top_down' ? 'active' : ''}
            onClick={() => {
              setCamera('top_down');
            }}
          >
            Topo
          </button>
        </div>
        <button
          type="button"
          className={rulerActive ? 'active' : ''}
          aria-pressed={rulerActive}
          title="Medir distância ou área de impacto (R)"
          onClick={() => {
            setRulerActive((prev) => {
              const next = !prev;
              if (next) {
                onFogTool('none');
                setFogHudOpen(false);
              }
              return next;
            });
          }}
        >
          Régua
        </button>
        {isGm && (
          <button
            type="button"
            className={showFogHud ? 'active' : ''}
            aria-pressed={showFogHud}
            title="Controles de névoa de guerra manual e automática"
            onClick={() => {
              if (showFogHud) {
                setFogHudOpen(false);
                onFogTool('none');
              } else {
                setRulerActive(false);
                setFogHudOpen(true);
              }
            }}
          >
            Névoa
          </button>
        )}
        <button type="button" className={gridVisible ? 'active' : ''} onClick={toggleGrid}>
          Grid
        </button>
        <button type="button" onClick={resetCamera}>
          Centralizar
        </button>
        {isGm && onEditMap && map.scene3d !== null && (
          <button
            type="button"
            className="map3d-edit-btn"
            onClick={() => {
              onEditMap(map);
            }}
          >
            Editar mapa 3D
          </button>
        )}
      </div>
      {rulerActive && <RulerOptionsBar options={rulerOptions} onChange={setRulerOptions} />}
      {showFogHud && (
        <FogHudControls
          map={map}
          fogTool={fogTool}
          onFogTool={onFogTool}
          selectedToken={selectedToken}
          previewTokenVision={previewTokenVision}
          onPreviewTokenVision={setPreviewTokenVision}
          onError={setError}
        />
      )}
      {loading && <p className="map-empty hint">Carregando mapa 3D…</p>}
      {error && (
        <p className="map-error error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
