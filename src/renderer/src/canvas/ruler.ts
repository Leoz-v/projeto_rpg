import { cellDistanceFeet, FEET_PER_SQUARE, type GridCell } from 'rules-engine/space';
import { type GameMap, type Point, WORLD_UNITS_PER_CELL } from '../../../shared/protocol';

/**
 * Cálculos puros da régua de distância e área de impacto, compartilhados entre
 * o mapa 2D (`canvas`) e o mapa 3D (`canvas3d`). Sempre usa a regra de distância
 * do motor (`rules-engine/space`).
 */

/** Conversão métrica padrão de D&D 5e/2024: 1 quadrado = 5 ft = 1,5 m. */
export const METERS_PER_SQUARE = 1.5;
export const METERS_PER_FOOT = METERS_PER_SQUARE / FEET_PER_SQUARE;

export type RulerUnit = 'ft' | 'm';
export type RulerShape = 'line' | 'radius';

export interface RulerOptions {
  shape: RulerShape;
  unit: RulerUnit;
}

export const DEFAULT_RULER_OPTIONS: Readonly<RulerOptions> = {
  shape: 'line',
  unit: 'ft',
};

export interface RulerMeasurement {
  shape: RulerShape;
  /** Pontos do trajeto em células do grid (2+ pontos para `line`; `[centro, borda]` para `radius`). */
  points: readonly GridCell[];
  /** Distância total (ou raio) em pés pela regra do motor (`cellDistanceFeet`). */
  feet: number;
  /** Distância total (ou raio) em quadrados do grid (`feet / FEET_PER_SQUARE`). */
  squares: number;
  /** Diferença de elevação em pés entre início e fim (opcional, para mapas 3D), arredondada para inteiro. */
  elevationDeltaFeet?: number | undefined;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function feetToMeters(feet: number): number {
  return feet * METERS_PER_FOOT;
}

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

/** Mede um trajeto (reto ou com curvas/segmentos) somando `cellDistanceFeet` de cada trecho. */
export function measureRulerPath(points: readonly GridCell[], elevationDeltaFeet?: number): RulerMeasurement {
  let feet = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev && curr) feet += cellDistanceFeet(prev, curr);
  }
  const squares = feet / FEET_PER_SQUARE;
  const roundedElev = elevationDeltaFeet !== undefined ? Math.round(elevationDeltaFeet) : undefined;
  return {
    shape: 'line',
    points,
    feet,
    squares,
    ...(roundedElev !== undefined ? { elevationDeltaFeet: roundedElev } : {}),
  };
}

/** Mede a distância entre duas células usando a regra de distância do motor (`rules-engine/space`). */
export function measureRuler(from: GridCell, to: GridCell, elevationDeltaFeet?: number): RulerMeasurement {
  return measureRulerPath([from, to], elevationDeltaFeet);
}

/** Mede o raio de uma área circular de impacto do centro até a borda, pela mesma regra do motor. */
export function measureRulerRadius(center: GridCell, edge: GridCell, elevationDeltaFeet?: number): RulerMeasurement {
  const feet = cellDistanceFeet(center, edge);
  const squares = feet / FEET_PER_SQUARE;
  const roundedElev = elevationDeltaFeet !== undefined ? Math.round(elevationDeltaFeet) : undefined;
  return {
    shape: 'radius',
    points: [center, edge],
    feet,
    squares,
    ...(roundedElev !== undefined ? { elevationDeltaFeet: roundedElev } : {}),
  };
}

/** Formata uma medida em pés ou metros (pt-BR, sem zeros desnecessários). */
export function formatDistanceValue(feet: number, unit: RulerUnit): string {
  if (unit === 'ft') return `${feet} ft`;
  const meters = Math.round(feetToMeters(feet) * 10) / 10;
  const text = Number.isInteger(meters) ? String(meters) : meters.toFixed(1).replace('.', ',');
  return `${text} m`;
}

/** Formata o rótulo da régua em pt-BR (pés ou metros + quadrados, e `Δh` quando há variação de elevação no 3D). */
export function formatRulerLabel(measurement: RulerMeasurement, unit: RulerUnit = 'ft'): string {
  const prefix = measurement.shape === 'radius' ? 'Raio ' : '';
  const value = formatDistanceValue(measurement.feet, unit);
  const base = measurement.squares > 0 ? `${prefix}${value} (${measurement.squares} q)` : `${prefix}${value}`;
  if (measurement.elevationDeltaFeet !== undefined && measurement.elevationDeltaFeet !== 0) {
    const sign = measurement.elevationDeltaFeet > 0 ? '+' : '-';
    const elev = formatDistanceValue(Math.abs(measurement.elevationDeltaFeet), unit);
    return `${base} · Δh ${sign}${elev}`;
  }
  return base;
}
