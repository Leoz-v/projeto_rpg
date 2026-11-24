import { cellDistanceFeet, FEET_PER_SQUARE, type GridCell } from 'rules-engine/space';
import { type GameMap, type Point, WORLD_UNITS_PER_CELL } from '../../../shared/protocol';

/**
 * Cálculos puros da régua de distância, compartilhados entre o mapa 2D
 * (`canvas`) e o mapa 3D (`canvas3d`). Sempre usa a regra de distância do
 * motor (`rules-engine/space`), em pés.
 */

export interface RulerMeasurement {
  from: GridCell;
  to: GridCell;
  /** Distância em pés pela regra do motor (`cellDistanceFeet`). */
  feet: number;
  /** Distância em quadrados do grid (`feet / FEET_PER_SQUARE`). */
  squares: number;
  /** Diferença de elevação em pés (opcional, para mapas 3D), arredondada para inteiro. */
  elevationDeltaFeet?: number | undefined;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Converte um ponto no mundo lógico 2D (`1 célula = 100`) para a célula inteira do grid, limitada ao mapa. */
export function worldToGridCell(world: Point, map: Pick<GameMap, 'width' | 'height'>): GridCell {
  return {
    x: clamp(Math.floor(world.x / WORLD_UNITS_PER_CELL), 0, Math.max(0, map.width - 1)),
    y: clamp(Math.floor(world.y / WORLD_UNITS_PER_CELL), 0, Math.max(0, map.height - 1)),
  };
}

/** Centro de uma célula do grid em unidades lógicas do mundo 2D. */
export function gridCellCenterWorld(cell: GridCell): Point {
  return {
    x: (cell.x + 0.5) * WORLD_UNITS_PER_CELL,
    y: (cell.y + 0.5) * WORLD_UNITS_PER_CELL,
  };
}

/** Mede a distância entre duas células usando a regra de distância do motor (`rules-engine/space`). */
export function measureRuler(from: GridCell, to: GridCell, elevationDeltaFeet?: number): RulerMeasurement {
  const feet = cellDistanceFeet(from, to);
  const squares = feet / FEET_PER_SQUARE;
  const roundedElev = elevationDeltaFeet !== undefined ? Math.round(elevationDeltaFeet) : undefined;
  return {
    from,
    to,
    feet,
    squares,
    ...(roundedElev !== undefined ? { elevationDeltaFeet: roundedElev } : {}),
  };
}

/** Formata o rótulo da régua em pt-BR (pés + quadrados, e `Δh` quando há variação de elevação no 3D). */
export function formatRulerLabel(measurement: RulerMeasurement): string {
  const base = measurement.squares > 0 ? `${measurement.feet} ft (${measurement.squares} q)` : `${measurement.feet} ft`;
  if (measurement.elevationDeltaFeet !== undefined && measurement.elevationDeltaFeet !== 0) {
    const sign = measurement.elevationDeltaFeet > 0 ? `+${measurement.elevationDeltaFeet}` : `${measurement.elevationDeltaFeet}`;
    return `${base} · Δh ${sign} ft`;
  }
  return base;
}
