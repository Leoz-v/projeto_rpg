import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import type { GameMap } from '../../../shared/protocol';
import { conditionLabels, timedEffectLabels, tokenConditions } from '../canvas/conditions';
import { tokenHealth } from '../canvas/health';
import type { MapStageHandle } from '../canvas/MapStage';
import {
  DEFAULT_INTERIOR_DEPTH_FEET,
  gridFromMapDocument,
  interiorGridFromMapDocument,
  parseMapDocument,
} from '../canvas3d/map/mapDocument';
import { AssetManager } from '../canvas3d/render/assetManager';
import { LightingManager } from '../canvas3d/render/lightingSystem';
import { LiquidRenderer } from '../canvas3d/render/liquidRenderer';
import { type CameraViewMode, SceneManager } from '../canvas3d/render/sceneManager';
import { TerrainRenderer } from '../canvas3d/render/terrainRenderer';
import { cameraTargetToWorld2d } from '../canvas3d/render/tokenGeometry3d';
import { TokenRenderer3d } from '../canvas3d/render/tokenRenderer3d';
import { TILE_SIZE_FEET, TILE_SIZE_METERS } from '../canvas3d/terrain/constants';
import { sendIntent } from '../store/table';

/**
 * Visualização 3D da mesa (somente leitura do terreno): usada por jogadores e
 * pelo mestre durante a sessão, sem ferramentas de edição de mapa.
 * Tokens funcionam exatamente como no 2D (seleção, arrasto `token.move`, barras
 * de PV, condições e anel de turno): planos no modo `top_down` e com billboard
 * vertical nos modos `perspective` e `orthographic`.
 */

interface Props {
  view: TableView;
  map: GameMap;
  maxima: Record<string, number>;
  selectedId: string | null;
  onSelect: (tokenId: string | null) => void;
  onStage: (stage: MapStageHandle | null) => void;
  isGm: boolean;
  onEditMap?: ((map: GameMap) => void) | undefined;
}

interface ActiveViewer {
  scene: SceneManager;
  surfaceRenderer: TerrainRenderer;
  interiorRenderer: TerrainRenderer;
  assets: AssetManager;
  tokens3d: TokenRenderer3d;
  width: number;
  length: number;
  destroy: () => void;
}

const METERS_PER_FOOT = TILE_SIZE_METERS / TILE_SIZE_FEET;

export function Map3DView({ view, map, maxima, selectedId, onSelect, onStage, isGm, onEditMap }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ActiveViewer | null>(null);
  const [viewer, setViewer] = useState<ActiveViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [camMode, setCamMode] = useState<CameraViewMode>('perspective');
  const [gridVisible, setGridVisible] = useState(true);

  const latest = useRef({ onSelect, onStage });
  useLayoutEffect(() => {
    latest.current = { onSelect, onStage };
  });

  const sceneHash = map.scene3d;

  useEffect(() => {
    const element = hostRef.current;
    if (!element || sceneHash === null) return;

    let cancelled = false;
    const isCancelled = (): boolean => cancelled;
    let active: ActiveViewer | null = null;

    setLoading(true);
    setError(null);

    const mount = async (): Promise<void> => {
      const response = await fetch(`vtt-asset://${sceneHash}`);
      if (!response.ok) {
        throw new Error(`Não foi possível carregar o mapa 3D (HTTP ${response.status})`);
      }
      const raw: unknown = await response.json();
      const doc = parseMapDocument(raw, map.name);
      if (isCancelled()) return;

      const surfaceGrid = gridFromMapDocument(doc);
      const interiorGrid = interiorGridFromMapDocument(doc);

      const scene = await SceneManager.create(element, surfaceGrid.width, surfaceGrid.length);
      if (isCancelled()) {
        scene.destroy();
        return;
      }

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
      });

      active = {
        scene,
        surfaceRenderer,
        interiorRenderer,
        assets,
        tokens3d,
        width: surfaceGrid.width,
        length: surfaceGrid.length,
        destroy: () => {
          tokens3d.destroy();
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

      lighting.syncLightSources(surfaceGrid, assets.getPlacedForLayer('surface'), 0);
      scene.fitSunShadows();
      setLoading(false);
    };

    void mount().catch((err: unknown) => {
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
  }, [sceneHash, map.name]);

  const { state, info } = view;

  useEffect(() => {
    viewer?.tokens3d.setScene({
      map,
      tokens: Object.values(state.tokens),
      canDrag: (token) => info.role === 'gm' || token.ownerIds.includes(info.playerId),
      selectedId,
      activeId: state.combat?.combatants[state.combat.turn]?.tokenId ?? null,
      conditions: (token) => [
        ...conditionLabels(tokenConditions(token, state.characters)),
        ...timedEffectLabels(token, { combat: state.combat, tokens: state.tokens }),
      ],
      health: (token) => tokenHealth(token, state.characters, maxima),
    });
  }, [viewer, map, state.tokens, state.characters, state.combat, maxima, info.role, info.playerId, selectedId]);

  const setCamera = (mode: CameraViewMode): void => {
    const v = viewerRef.current;
    if (!v) return;
    v.scene.setCameraViewMode(mode);
    v.scene.setLeftButtonAction('pan');
    setCamMode(mode);
  };

  const toggleGrid = (): void => {
    const v = viewerRef.current;
    if (!v) return;
    const next = !gridVisible;
    v.surfaceRenderer.setGridVisible(next);
    v.interiorRenderer.setGridVisible(next);
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
        <div className="map3d-hud-group">
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
        <button type="button" className={gridVisible ? 'active' : ''} onClick={toggleGrid}>
          Grid
        </button>
        <button type="button" onClick={resetCamera}>
          Centralizar
        </button>
        {isGm && onEditMap && (
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
      {loading && <p className="map-empty hint">Carregando mapa 3D…</p>}
      {error && (
        <p className="map-error error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
