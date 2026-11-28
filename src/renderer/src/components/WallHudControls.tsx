import type { GameMap } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import type { WallTool } from './lighting-hud-helpers';

/**
 * Barra flutuante para desenhar paredes, portas, janelas e penhascos no mapa 2D (exclusiva do mestre).
 */

interface Props {
  map: GameMap;
  wallTool: WallTool;
  onWallTool: (tool: WallTool) => void;
  onError: (message: string | null) => void;
}

const WALL_TOOLS: readonly { id: Exclude<WallTool, 'none'>; label: string; title: string }[] = [
  { id: 'wall', label: 'Parede', title: 'Traçar parede sólida (bloqueia movimento, luz e visão)' },
  { id: 'door', label: 'Porta', title: 'Traçar porta clicável (bloqueia quando fechada)' },
  { id: 'window', label: 'Janela', title: 'Traçar janela (bloqueia movimento, permite visão e luz)' },
  { id: 'terrain_wall', label: 'Penhasco', title: 'Traçar borda de terreno elevado' },
  { id: 'erase', label: 'Apagar', title: 'Clicar em um segmento existente para removê-lo' },
];

export function WallHudControls({ map, wallTool, onWallTool, onError }: Props) {
  const doors = map.walls.filter((w) => w.kind === 'door');
  const wallCount = map.walls.filter((w) => w.kind !== 'door').length;
  const manualCount = map.walls.filter((w) => w.source === 'manual').length;
  const anyClosedDoor = doors.some((d) => !d.open);

  const toggleAllDoors = (): void => {
    const targetOpen = anyClosedDoor;
    for (const d of doors) {
      if (d.open !== targetOpen) {
        void sendIntent({ kind: 'wall.update', data: { mapId: map.id, wallId: d.id, open: targetOpen } }).then(onError);
      }
    }
  };

  return (
    <div className="fog-popover" role="group" aria-label="Controles de paredes e portas">
      <div className="fog-popover-row">
        <span className="ruler-hint">Segmentos</span>
        <div className="map3d-hud-group" role="group" aria-label="Ferramenta de paredes e portas">
          {WALL_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={wallTool === t.id ? 'active' : ''}
              aria-pressed={wallTool === t.id}
              title={t.title}
              onClick={() => {
                onWallTool(wallTool === t.id ? 'none' : t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fog-popover-row">
        <span className="hint">
          {wallCount} paredes · {doors.length} portas
        </span>
        {doors.length > 0 && (
          <button type="button" onClick={toggleAllDoors}>
            {anyClosedDoor ? 'Abrir portas' : 'Fechar portas'}
          </button>
        )}
        <button
          type="button"
          disabled={manualCount === 0}
          onClick={() =>
            void sendIntent({
              kind: 'wall.replace',
              data: { mapId: map.id, scope: 'manual', walls: [] },
            }).then(onError)
          }
        >
          Limpar manuais
        </button>
      </div>

      <p className="hint" style={{ margin: 0, fontSize: '0.74rem' }}>
        Arraste para traçar segmentos no grid; clique em portas para abrir/fechar; Esc sai.
      </p>
    </div>
  );
}
