import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import { tokenHealth } from '../canvas/health';
import { conditionLabels, tokenConditions } from '../canvas/conditions';
import { MapStage } from '../canvas/MapStage';
import { sendIntent } from '../store/table';

/**
 * O mapa ativo: liga o `MapStage` (PixiJS) ao estado da mesa. Mover um token
 * vira `token.move`; se o Host recusar, o token volta e a mensagem aparece.
 */

interface Props {
  view: TableView;
  selectedId: string | null;
  onSelect: (tokenId: string | null) => void;
  /** O palco pronto (ou `null` ao sair), para o painel do mestre saber o centro da tela. */
  onStage: (stage: MapStage | null) => void;
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

export function MapView({ view, selectedId, onSelect, onStage }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<MapStage | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      conditions: (token) => conditionLabels(tokenConditions(token, state.characters)),
      health: (token) => tokenHealth(token, state.characters, maxima),
    });
  }, [stage, map, state.tokens, state.characters, state.combat, maxima, info.role, info.playerId, selectedId]);

  return (
    <section className="map" aria-label="Mapa">
      <div ref={host} className="map-canvas" />
      {!map && <p className="map-empty hint">{info.role === 'gm' ? 'Crie um mapa no painel ao lado para começar.' : 'O mestre ainda não mostrou um mapa.'}</p>}
      {error && (
        <p className="map-error error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
