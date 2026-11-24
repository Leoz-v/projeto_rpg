import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import type { GameMap } from '../../../shared/protocol';
import { tokenHealth } from '../canvas/health';
import { conditionLabels, timedEffectLabels, tokenConditions } from '../canvas/conditions';
import { MapStage, type MapStageHandle } from '../canvas/MapStage';
import { DEFAULT_RULER_OPTIONS, type RulerOptions } from '../canvas/ruler';
import { sendIntent } from '../store/table';
import { Map3DView } from './Map3DView';
import { RulerOptionsBar } from './RulerControls';

/**
 * O mapa ativo: liga o `MapStage` (PixiJS 2D) ou o `Map3DView` (PixiJS 3D) ao
 * estado da mesa. Abrir um mapa 3D segue exatamente o mesmo fluxo dos mapas 2D.
 */

interface Props {
  view: TableView;
  selectedId: string | null;
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

function Map2DView({ view, selectedId, onSelect, onStage }: Omit<Props, 'onEdit3dMap'>) {
  const host = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<MapStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerOptions, setRulerOptions] = useState<RulerOptions>({ ...DEFAULT_RULER_OPTIONS });
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
  const maxima = useHpMaxima(state.characters);

  useEffect(() => {
    stage?.setScene({
      map,
      tokens: Object.values(state.tokens),
      canDrag: (token) => info.role === 'gm' || token.ownerIds.includes(info.playerId),
      selectedId,
      activeId: state.combat?.combatants[state.combat.turn]?.tokenId ?? null,
      conditions: (token) => [...conditionLabels(tokenConditions(token, state.characters)), ...timedEffectLabels(token, { combat: state.combat, tokens: state.tokens })],
      health: (token) => tokenHealth(token, state.characters, maxima),
    });
  }, [stage, map, state.tokens, state.characters, state.combat, maxima, info.role, info.playerId, selectedId]);

  useEffect(() => {
    stage?.setRulerMode(rulerActive && map !== null);
  }, [stage, rulerActive, map]);

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
    <section className="map" aria-label="Mapa">
      <div ref={host} className="map-canvas" />
      {map && (
        <>
          <div className="map3d-hud" role="toolbar" aria-label="Ferramentas do mapa">
            <button
              type="button"
              className={rulerActive ? 'active' : ''}
              aria-pressed={rulerActive}
              title="Medir distância ou área de impacto (R)"
              onClick={() => {
                setRulerActive((prev) => !prev);
              }}
            >
              Régua
            </button>
          </div>
          {rulerActive && <RulerOptionsBar options={rulerOptions} onChange={setRulerOptions} />}
        </>
      )}
      {!map && <p className="map-empty hint">{info.role === 'gm' ? 'Crie um mapa no painel ao lado para começar.' : 'O mestre ainda não mostrou um mapa.'}</p>}
      {error && (
        <p className="map-error error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function MapView({ view, selectedId, onSelect, onStage, onEdit3dMap }: Props) {
  const { state, info } = view;
  const map = state.activeMapId !== null ? (state.maps[state.activeMapId] ?? null) : null;
  const maxima = useHpMaxima(state.characters);
  if (map !== null && map.scene3d !== null) {
    return (
      <Map3DView
        view={view}
        map={map}
        maxima={maxima}
        selectedId={selectedId}
        onSelect={onSelect}
        onStage={onStage}
        isGm={info.role === 'gm'}
        onEditMap={onEdit3dMap}
      />
    );
  }
  return <Map2DView view={view} selectedId={selectedId} onSelect={onSelect} onStage={onStage} />;
}
