import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VisionProfile } from 'rules-engine/vision';
import type { TableView } from '../../../shared/ipc';
import { extractPropLightsFrom3dMapDocument, type ExtractedPropLight, type GameMap } from '../../../shared/protocol';
import { conditionLabels, timedEffectLabels, tokenConditions } from '../canvas/conditions';
import type { FogTool } from '../canvas/fog-render';
import { tokenHealth } from '../canvas/health';
import { MapStage, type MapStageHandle, type RenderedMapBackground } from '../canvas/MapStage';
import { DEFAULT_RULER_OPTIONS, type RulerOptions } from '../canvas/ruler';
import { render3dMapTo2dCanvas } from '../canvas3d/render/mapConversion';
import { sendIntent } from '../store/table';
import { FogHudControls } from './FogHudControls';
import { Map3DView } from './Map3DView';
import { RulerOptionsBar } from './RulerControls';

/**
 * O mapa ativo: liga o `MapStage` (PixiJS 2D) ou o `Map3DView` (PixiJS 3D) ao
 * estado da mesa. Qualquer mapa (2D ou 3D) pode ser aberto em qualquer um dos
 * dois visualizadores: mapas 2D viram um plano texturizado no 3D, e mapas 3D
 * são renderizados pela câmera de topo em uma imagem 2D com resolução por tile.
 */

export type MapViewerMode = '2d' | '3d';

interface Props {
  view: TableView;
  viewerMode: MapViewerMode;
  onViewerModeChange: (mode: MapViewerMode) => void;
  selectedId: string | null;
  fogTool: FogTool;
  onFogTool: (tool: FogTool) => void;
  onSelect: (tokenId: string | null) => void;
  /** O palco pronto (2D ou 3D; `null` ao sair), para o painel do mestre saber o centro da tela. */
  onStage: (stage: MapStageHandle | null) => void;
  /** Abre o editor 3D exclusivo do mestre para o mapa informado. */
  onEdit3dMap?: (map: GameMap) => void;
}

/** PV máximos das fichas dos personagens (calculados no processo main), atualizados quando algum personagem muda. */
function useHpMaxima(characters: TableView['state']['characters']): Record<string, number> {
  const [maxima, setMaxima] = useState<Record<string, number>>({});
  useEffect(() => {
    let current = true;
    void window.vtt.characterHpMaxima().then((r) => {
      if (current && r.ok) setMaxima(r.value);
    });
    return () => {
      current = false;
    };
  }, [characters]);
  return maxima;
}

/** Perfis de visão derivados pelo processo main (ficha, monstro e condições), atualizados com tokens/personagens. */
function useTokenVisionProfiles(
  tokens: TableView['state']['tokens'],
  characters: TableView['state']['characters'],
): Record<string, VisionProfile> {
  const [profiles, setProfiles] = useState<Record<string, VisionProfile>>({});
  useEffect(() => {
    let current = true;
    void window.vtt.tokenVisionProfiles().then((r) => {
      if (current && r.ok) setProfiles(r.value);
    });
    return () => {
      current = false;
    };
  }, [tokens, characters]);
  return profiles;
}

const bakedPropLightsCache = new Map<string, ExtractedPropLight[]>();

/** Extrai e guarda em cache as tochas/braseiros embutidos em um mapa 3D pelo SHA-256 imutável. */
function useBaked3dPropLights(scene3dHash: string | null): readonly ExtractedPropLight[] {
  const [result, setResult] = useState<{ key: string; lights: ExtractedPropLight[] } | null>(null);
  useEffect(() => {
    if (scene3dHash === null) return;
    const cached = bakedPropLightsCache.get(scene3dHash);
    if (cached) return;
    let cancelled = false;
    void fetch(`vtt-asset://${scene3dHash}`)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : undefined))
      .then((doc) => {
        if (cancelled || doc === undefined) return;
        const extracted = extractPropLightsFrom3dMapDocument(doc);
        bakedPropLightsCache.set(scene3dHash, extracted);
        setResult({ key: scene3dHash, lights: extracted });
      })
      .catch(() => {
        if (!cancelled) bakedPropLightsCache.set(scene3dHash, []);
      });
    return () => {
      cancelled = true;
    };
  }, [scene3dHash]);

  if (scene3dHash === null) return [];
  const cached = bakedPropLightsCache.get(scene3dHash);
  if (cached) return cached;
  return result?.key === scene3dHash ? result.lights : [];
}

interface Map2DProps {
  view: TableView;
  maxima: Record<string, number>;
  visionProfiles: Record<string, VisionProfile>;
  selectedId: string | null;
  fogTool: FogTool;
  onFogTool: (tool: FogTool) => void;
  onSelect: (tokenId: string | null) => void;
  onStage: (stage: MapStageHandle | null) => void;
  onViewerModeChange: (mode: MapViewerMode) => void;
  onEdit3dMap?: ((map: GameMap) => void) | undefined;
}

function Map2DView({ view, maxima, visionProfiles, selectedId, fogTool, onFogTool, onSelect, onStage, onViewerModeChange, onEdit3dMap }: Map2DProps) {
  const host = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<MapStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerOptions, setRulerOptions] = useState<RulerOptions>({ ...DEFAULT_RULER_OPTIONS });
  const [fogHudOpen, setFogHudOpen] = useState(false);
  const [previewTokenVision, setPreviewTokenVision] = useState(true);
  const [renderResult, setRenderResult] = useState<
    { key: string; bg: RenderedMapBackground } | { key: string; error: string } | null
  >(null);

  // O palco é criado uma vez; os callbacks leem sempre a versão atual.
  const latest = useRef({ onSelect, onStage });
  useLayoutEffect(() => {
    latest.current = { onSelect, onStage };
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let created: MapStage | undefined;
    void MapStage.create(element, {
      onSelect: (id) => {
        latest.current.onSelect(id);
      },
      onMove: (tokenId, to) => {
        void sendIntent({ kind: 'token.move', data: { tokenId, to } }).then((refused) => {
          setError(refused);
          if (refused) created?.revert(tokenId);
        });
      },
      onFogPaint: (mapId, mode, cells) => {
        void sendIntent({ kind: 'fog.manual.paint', data: { mapId, mode, cells } }).then(setError);
      },
      onFogRect: (mapId, mode, from, to) => {
        void sendIntent({ kind: 'fog.manual.rect', data: { mapId, mode, from, to } }).then(setError);
      },
      onDoorToggle: (mapId, wallId) => {
        void sendIntent({ kind: 'door.toggle', data: { mapId, wallId } }).then(setError);
      },
      onLightToggle: (mapId, lightId) => {
        void sendIntent({ kind: 'light.toggle', data: { mapId, lightId } }).then(setError);
      },
      onPropLightToggle: (mapId, propLightId, nextState) => {
        void sendIntent({ kind: 'map_prop_light.set', data: { mapId, propLightId, state: nextState } }).then(setError);
      },
    }).then((s) => {
      // Desmontou antes de o PixiJS terminar de iniciar (StrictMode faz isso no desenvolvimento).
      if (cancelled) {
        s.destroy();
        return;
      }
      created = s;
      setStage(s);
      latest.current.onStage(s);
    });
    return () => {
      cancelled = true;
      created?.destroy();
      latest.current.onStage(null);
    };
  }, []);

  const { state, info } = view;
  const map = state.activeMapId !== null ? (state.maps[state.activeMapId] ?? null) : null;
  const isGm = info.role === 'gm';
  const selectedToken = selectedId !== null ? (state.tokens[selectedId] ?? null) : null;
  const showFogHud = isGm && (fogHudOpen || fogTool !== 'none');
  const scene3dHash = map?.scene3d ?? null;
  const mapName = map?.name ?? '';
  const bakedPropLights = useBaked3dPropLights(scene3dHash);

  // Mapa 3D aberto no visualizador 2D: renderiza a câmera de topo em uma imagem 2D.
  useEffect(() => {
    if (scene3dHash === null) return;
    let cancelled = false;
    void render3dMapTo2dCanvas(scene3dHash, mapName)
      .then((res) => {
        if (cancelled) return;
        setRenderResult({ key: scene3dHash, bg: { key: scene3dHash, source: res.canvas, cellPx: res.cellPx } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRenderResult({
          key: scene3dHash,
          error: err instanceof Error ? err.message : 'Não foi possível renderizar o mapa 3D em 2D',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [scene3dHash, mapName]);

  const activeRenderedBg =
    scene3dHash !== null && renderResult?.key === scene3dHash && 'bg' in renderResult ? renderResult.bg : null;
  const renderError =
    scene3dHash !== null && renderResult?.key === scene3dHash && 'error' in renderResult ? renderResult.error : null;
  const rendering3d = scene3dHash !== null && renderResult?.key !== scene3dHash;
  const visibleError = error ?? renderError;

  useEffect(() => {
    stage?.setScene({
      map,
      renderedBackground: activeRenderedBg,
      tokens: Object.values(state.tokens),
      canDrag: (token) => isGm || token.ownerIds.includes(info.playerId),
      selectedId,
      activeId: state.combat?.combatants[state.combat.turn]?.tokenId ?? null,
      conditions: (token) => [...conditionLabels(tokenConditions(token, state.characters)), ...timedEffectLabels(token, { combat: state.combat, tokens: state.tokens })],
      health: (token) => tokenHealth(token, state.characters, maxima),
      viewer: { role: info.role, playerId: info.playerId, previewTokenId: isGm && previewTokenVision ? selectedId : null },
      fogTool: isGm ? fogTool : 'none',
      visionProfiles,
      characters: state.characters,
      bakedPropLights,
    });
  }, [stage, map, activeRenderedBg, state.tokens, state.characters, state.combat, maxima, visionProfiles, bakedPropLights, info.role, info.playerId, isGm, selectedId, previewTokenVision, fogTool]);

  useEffect(() => {
    stage?.setRulerMode(rulerActive && fogTool === 'none' && map !== null);
  }, [stage, rulerActive, fogTool, map]);

  useEffect(() => {
    stage?.setRulerOptions(rulerOptions);
  }, [stage, rulerOptions]);

  useEffect(() => {
    if (!map) return;
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
  }, [map]);

  return (
    <section className="map" aria-label={map ? `Mapa 2D: ${map.name}` : 'Mapa'}>
      <div ref={host} className="map-canvas" />
      {map && (
        <>
          <div className="map3d-hud" role="toolbar" aria-label="Ferramentas do mapa">
            <span className="map3d-badge">2D · {map.name}</span>
            <div className="map3d-hud-group" role="group" aria-label="Visualizador">
              <button type="button" className="active" aria-pressed="true">
                2D
              </button>
              <button
                type="button"
                aria-pressed="false"
                onClick={() => {
                  onViewerModeChange('3d');
                }}
              >
                3D
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
            {isGm && onEdit3dMap && map.scene3d !== null && (
              <button
                type="button"
                className="map3d-edit-btn"
                onClick={() => {
                  onEdit3dMap(map);
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
        </>
      )}
      {!map && <p className="map-empty hint">{isGm ? 'Crie um mapa no painel ao lado para começar.' : 'O mestre ainda não mostrou um mapa.'}</p>}
      {rendering3d && <p className="map-empty hint">Renderizando vista 2D do mapa 3D…</p>}
      {visibleError && (
        <p className="map-error error" role="alert">
          {visibleError}
        </p>
      )}
    </section>
  );
}

export function MapView({ view, viewerMode, onViewerModeChange, selectedId, fogTool, onFogTool, onSelect, onStage, onEdit3dMap }: Props) {
  const { state, info } = view;
  const map = state.activeMapId !== null ? (state.maps[state.activeMapId] ?? null) : null;
  const maxima = useHpMaxima(state.characters);
  const visionProfiles = useTokenVisionProfiles(state.tokens, state.characters);
  if (map !== null && viewerMode === '3d') {
    return (
      <Map3DView
        view={view}
        map={map}
        maxima={maxima}
        visionProfiles={visionProfiles}
        selectedId={selectedId}
        fogTool={info.role === 'gm' ? fogTool : 'none'}
        onFogTool={onFogTool}
        onSelect={onSelect}
        onStage={onStage}
        isGm={info.role === 'gm'}
        onViewerModeChange={onViewerModeChange}
        onEditMap={onEdit3dMap}
      />
    );
  }
  return (
    <Map2DView
      view={view}
      maxima={maxima}
      visionProfiles={visionProfiles}
      selectedId={selectedId}
      fogTool={fogTool}
      onFogTool={onFogTool}
      onSelect={onSelect}
      onStage={onStage}
      onViewerModeChange={onViewerModeChange}
      onEdit3dMap={onEdit3dMap}
    />
  );
}
