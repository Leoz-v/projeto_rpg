import type { RulerOptions } from '../canvas/ruler';

/**
 * Barra secundária compacta da régua, exibida apenas enquanto a régua está ativa
 * (sem adicionar botões extras à barra principal do mapa). Compartilhada entre
 * `MapView` (2D) e `Map3DView` (3D).
 */

interface Props {
  options: RulerOptions;
  onChange: (next: RulerOptions) => void;
}

export function RulerOptionsBar({ options, onChange }: Props) {
  return (
    <div className="ruler-popover" role="group" aria-label="Opções da régua">
      <div className="map3d-hud-group" role="group" aria-label="Modo da régua">
        <button
          type="button"
          className={options.shape === 'line' ? 'active' : ''}
          aria-pressed={options.shape === 'line'}
          title="Linha (segure Shift para encadear curvas)"
          onClick={() => {
            onChange({ ...options, shape: 'line' });
          }}
        >
          Linha
        </button>
        <button
          type="button"
          className={options.shape === 'radius' ? 'active' : ''}
          aria-pressed={options.shape === 'radius'}
          title="Área circular de impacto (centro até a borda)"
          onClick={() => {
            onChange({ ...options, shape: 'radius' });
          }}
        >
          Raio
        </button>
      </div>
      <div className="map3d-hud-group" role="group" aria-label="Unidade da régua">
        <button
          type="button"
          className={options.unit === 'ft' ? 'active' : ''}
          aria-pressed={options.unit === 'ft'}
          title="Medir em pés (5 ft por quadrado)"
          onClick={() => {
            onChange({ ...options, unit: 'ft' });
          }}
        >
          ft
        </button>
        <button
          type="button"
          className={options.unit === 'm' ? 'active' : ''}
          aria-pressed={options.unit === 'm'}
          title="Medir em metros (1,5 m por quadrado)"
          onClick={() => {
            onChange({ ...options, unit: 'm' });
          }}
        >
          m
        </button>
      </div>
      <span className="ruler-hint">{options.shape === 'line' ? 'Shift: curva' : 'Centro → borda'}</span>
    </div>
  );
}
