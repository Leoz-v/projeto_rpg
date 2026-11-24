import { useState } from 'react';
import { type GameMap, MAX_VISION_FEET, MIN_VISION_FEET, type Token } from '../../../shared/protocol';
import type { FogTool } from '../canvas/fog-render';
import { sendIntent } from '../store/table';

/**
 * Barra flutuante de névoa de guerra na HUD do mapa (compartilhada entre 2D e 3D,
 * exclusiva do mestre): ferramentas manuais, névoa automática, memória explorada
 * e pré-visualização da visão do token selecionado.
 */

interface Props {
  map: GameMap;
  fogTool: FogTool;
  onFogTool: (tool: FogTool) => void;
  selectedToken: Token | null;
  previewTokenVision: boolean;
  onPreviewTokenVision: (next: boolean) => void;
  onError: (message: string | null) => void;
}

const TOOLS: readonly { id: Exclude<FogTool, 'none'>; label: string; title: string }[] = [
  { id: 'brush-cover', label: 'Pincel +', title: 'Pincel: cobrir células com névoa manual' },
  { id: 'brush-reveal', label: 'Pincel −', title: 'Pincel: revelar névoa manual' },
  { id: 'rect-cover', label: 'Ret. +', title: 'Retângulo: cobrir área com névoa manual' },
  { id: 'rect-reveal', label: 'Ret. −', title: 'Retângulo: revelar área da névoa manual' },
];

export function FogHudControls({
  map,
  fogTool,
  onFogTool,
  selectedToken,
  previewTokenVision,
  onPreviewTokenVision,
  onError,
}: Props) {
  const { fog } = map;
  const savedVision = `${map.id}:${fog.visionFeet}`;
  const [visionDraft, setVisionDraft] = useState(String(fog.visionFeet));
  const [lastSaved, setLastSaved] = useState(savedVision);
  if (savedVision !== lastSaved) {
    setLastSaved(savedVision);
    setVisionDraft(String(fog.visionFeet));
  }

  const toggleTool = (tool: Exclude<FogTool, 'none'>): void => {
    onFogTool(fogTool === tool ? 'none' : tool);
  };

  const commitVision = (): void => {
    const parsed = Math.round(Number(visionDraft));
    if (!Number.isFinite(parsed) || parsed < MIN_VISION_FEET || parsed > MAX_VISION_FEET) {
      setVisionDraft(String(fog.visionFeet));
      return;
    }
    if (parsed !== fog.visionFeet) {
      void sendIntent({ kind: 'fog.config', data: { mapId: map.id, visionFeet: parsed } }).then(onError);
    }
  };

  const selectedMemoryKey = selectedToken ? (selectedToken.ownerIds[0] ?? selectedToken.id) : undefined;
  const selectedHasMemory = selectedMemoryKey !== undefined && fog.explored[selectedMemoryKey] !== undefined;

  return (
    <div className="fog-popover" role="group" aria-label="Controles de névoa de guerra">
      <div className="fog-popover-row">
        <span className="ruler-hint">Manual</span>
        <div className="map3d-hud-group" role="group" aria-label="Ferramentas de névoa manual">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={fogTool === t.id ? 'active' : ''}
              aria-pressed={fogTool === t.id}
              title={t.title}
              onClick={() => {
                toggleTool(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          title="Cobrir o mapa inteiro com névoa manual"
          onClick={() => void sendIntent({ kind: 'fog.manual.fill', data: { mapId: map.id, mode: 'cover' } }).then(onError)}
        >
          Cobrir tudo
        </button>
        <button
          type="button"
          title="Revelar toda a névoa manual do mapa"
          onClick={() => void sendIntent({ kind: 'fog.manual.fill', data: { mapId: map.id, mode: 'reveal' } }).then(onError)}
        >
          Revelar tudo
        </button>
      </div>

      <div className="fog-popover-row">
        <span className="ruler-hint">Automática</span>
        <button
          type="button"
          className={fog.autoEnabled ? 'active' : ''}
          aria-pressed={fog.autoEnabled}
          title="Ativar ou desativar névoa automática baseada na visão dos tokens"
          onClick={() => void sendIntent({ kind: 'fog.config', data: { mapId: map.id, autoEnabled: !fog.autoEnabled } }).then(onError)}
        >
          {fog.autoEnabled ? 'Ativa' : 'Desligada'}
        </button>
        {fog.autoEnabled && (
          <>
            <label className="fog-hud-vision" title="Alcance de visão padrão em pés">
              Visão
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
              ft
            </label>
            <button
              type="button"
              className={fog.rememberExplored ? 'active' : ''}
              aria-pressed={fog.rememberExplored}
              title="Jogadores lembram das células já vistas (véu sombreado fora da visão atual)"
              onClick={() => void sendIntent({ kind: 'fog.config', data: { mapId: map.id, rememberExplored: !fog.rememberExplored } }).then(onError)}
            >
              Lembrar
            </button>
            <button
              type="button"
              disabled={Object.keys(fog.explored).length === 0}
              title="Limpar a memória explorada de todos os jogadores neste mapa"
              onClick={() => void sendIntent({ kind: 'fog.memory.clear', data: { mapId: map.id } }).then(onError)}
            >
              Limpar memória
            </button>
            {selectedToken && selectedMemoryKey !== undefined && (
              <button
                type="button"
                disabled={!selectedHasMemory}
                title={`Limpar memória explorada de ${selectedToken.name}`}
                onClick={() => void sendIntent({ kind: 'fog.memory.clear', data: { mapId: map.id, playerId: selectedMemoryKey } }).then(onError)}
              >
                Limpar ({selectedToken.name})
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className={previewTokenVision ? 'active' : ''}
          aria-pressed={previewTokenVision}
          title="Ao clicar em um token, mostrar a visão e o mapa desbloqueado daquele token"
          onClick={() => {
            onPreviewTokenVision(!previewTokenVision);
          }}
        >
          {selectedToken && previewTokenVision ? `Visão: ${selectedToken.name}` : 'Visão do token'}
        </button>
      </div>
    </div>
  );
}
