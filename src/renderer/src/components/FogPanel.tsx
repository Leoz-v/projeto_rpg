import { useEffect, useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import { MAX_VISION_FEET, MIN_VISION_FEET } from '../../../shared/protocol';
import type { FogTool } from '../canvas/fog-render';
import { sendIntent } from '../store/table';

/**
 * Painel de névoa de guerra do mestre (nota 0056):
 * - Névoa manual (pincel, retângulo, cobrir/revelar tudo)
 * - Névoa automática (alcance padrão em pés, opção de lembrar áreas exploradas e limpar memória)
 */

interface Props {
  view: TableView;
  fogTool: FogTool;
  onFogTool: (tool: FogTool) => void;
  onError: (message: string | null) => void;
}

const TOOLS: readonly { id: Exclude<FogTool, 'none'>; label: string }[] = [
  { id: 'brush-cover', label: 'Pincel: Cobrir' },
  { id: 'brush-reveal', label: 'Pincel: Revelar' },
  { id: 'rect-cover', label: 'Retângulo: Cobrir' },
  { id: 'rect-reveal', label: 'Retângulo: Revelar' },
];

export function FogPanel({ view, fogTool, onFogTool, onError }: Props) {
  const { state } = view;
  const map = state.activeMapId !== null ? state.maps[state.activeMapId] : undefined;
  const savedVision = map ? `${map.id}:${map.fog.visionFeet}` : '';
  const [visionDraft, setVisionDraft] = useState(String(map?.fog.visionFeet ?? 60));
  const [lastSavedVision, setLastSavedVision] = useState(savedVision);
  if (savedVision !== lastSavedVision) {
    setLastSavedVision(savedVision);
    if (map) setVisionDraft(String(map.fog.visionFeet));
  }

  useEffect(() => {
    if (fogTool === 'none') return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onFogTool('none');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fogTool, onFogTool]);

  if (!map) return null;
  const { fog } = map;
  const players = Object.entries(state.players)
    .filter(([, p]) => p.role !== 'gm')
    .sort(([, a], [, b]) => a.displayName.localeCompare(b.displayName, 'pt-BR'));

  const toggleTool = (tool: Exclude<FogTool, 'none'>): void => {
    onFogTool(fogTool === tool ? 'none' : tool);
  };

  const commitVision = (): void => {
    const parsed = Math.round(Number(visionDraft));
    if (!Number.isFinite(parsed) || parsed < MIN_VISION_FEET || parsed > MAX_VISION_FEET) {
      setVisionDraft(String(fog.visionFeet));
      return;
    }
    if (parsed === fog.visionFeet) return;
    void sendIntent({ kind: 'fog.config', data: { mapId: map.id, visionFeet: parsed } }).then(onError);
  };

  return (
    <section className="panel" aria-label="Névoa de guerra">
      <h2>Névoa de guerra</h2>
      <div className="stack">
        <h3>Névoa manual</h3>
        <div className="fog-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`secondary small fog-tool${fogTool === t.id ? ' active' : ''}`}
              aria-pressed={fogTool === t.id}
              onClick={() => {
                toggleTool(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {fogTool !== 'none' && (
          <p className="hint">
            Arraste com o botão esquerdo para pintar. Botão direito/meio move a câmera; Esc sai.{' '}
            <button
              type="button"
              className="link"
              onClick={() => {
                onFogTool('none');
              }}
            >
              Sair
            </button>
          </p>
        )}
        <div className="row">
          <button
            type="button"
            className="secondary small"
            onClick={() => void sendIntent({ kind: 'fog.manual.fill', data: { mapId: map.id, mode: 'cover' } }).then(onError)}
          >
            Cobrir tudo
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => void sendIntent({ kind: 'fog.manual.fill', data: { mapId: map.id, mode: 'reveal' } }).then(onError)}
          >
            Revelar tudo
          </button>
        </div>

        <h3>Névoa automática</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={fog.autoEnabled}
            onChange={(e) => {
              void sendIntent({ kind: 'fog.config', data: { mapId: map.id, autoEnabled: e.target.checked } }).then(onError);
            }}
          />
          Ativar névoa automática (visão dos tokens)
        </label>

        {fog.autoEnabled && (
          <>
            <label>
              Visão padrão (pés)
              <input
                type="number"
                min={MIN_VISION_FEET}
                max={MAX_VISION_FEET}
                step={5}
                value={visionDraft}
                onChange={(e) => {
                  setVisionDraft(e.target.value);
                }}
                onBlur={commitVision}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitVision();
                  }
                }}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={fog.rememberExplored}
                onChange={(e) => {
                  void sendIntent({ kind: 'fog.config', data: { mapId: map.id, rememberExplored: e.target.checked } }).then(onError);
                }}
              />
              Lembrar áreas exploradas
            </label>
            <div className="stack">
              <button
                type="button"
                className="secondary small"
                disabled={Object.keys(fog.explored).length === 0}
                onClick={() => void sendIntent({ kind: 'fog.memory.clear', data: { mapId: map.id } }).then(onError)}
              >
                Limpar memória de todos
              </button>
              {players.length > 0 && (
                <ul className="fog-memory-list">
                  {players.map(([id, p]) => {
                    const hasMemory = fog.explored[id] !== undefined;
                    return (
                      <li key={id}>
                        <span>{p.displayName}</span>
                        <button
                          type="button"
                          className="link"
                          disabled={!hasMemory}
                          onClick={() => void sendIntent({ kind: 'fog.memory.clear', data: { mapId: map.id, playerId: id } }).then(onError)}
                        >
                          {hasMemory ? 'Limpar memória' : 'Sem memória'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
