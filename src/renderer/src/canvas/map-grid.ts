import { type GameMap, MAX_CELL_PX, MAX_MAP_CELLS, WORLD_UNITS_PER_CELL } from '../../../shared/protocol';

/**
 * Cálculos puros do grid em pixels sobre uma imagem de mapa: divisores exatos
 * recomendados, limites válidos (1..200 células), dimensões resultantes e escala
 * no mundo lógico (sem distorcer a imagem).
 */

export interface ImageSize {
  width: number;
  height: number;
}

export interface GridDimensions {
  /** Largura e altura do mapa em células inteiras (cobre a imagem inteira). */
  width: number;
  height: number;
  /** Verdadeiro quando `cellPx` divide exatamente largura e altura da imagem. */
  exact: boolean;
  /** Pixels sobrando além da última célula completa (0 quando exato). */
  remainderX: number;
  remainderY: number;
}

export interface RecommendedCellSize {
  cellPx: number;
  width: number;
  height: number;
}

export interface CellPxBounds {
  min: number;
  max: number;
}

const DEFAULT_TARGET_CELL_PX = 70;
const MIN_RECOMMENDED_CELL_PX = 8;

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/** Limites de `cellPx` para a imagem caber dentro de 1..MAX_MAP_CELLS células por lado. */
export function cellPxBounds(image: ImageSize): CellPxBounds {
  const w = Math.max(1, Math.round(image.width));
  const h = Math.max(1, Math.round(image.height));
  const min = Math.min(MAX_CELL_PX, Math.max(1, Math.ceil(Math.max(w, h) / MAX_MAP_CELLS)));
  const max = Math.min(MAX_CELL_PX, Math.max(min, Math.min(w, h)));
  return { min, max };
}

export function clampCellPx(cellPx: number, bounds: CellPxBounds): number {
  const rounded = Math.round(cellPx);
  if (!Number.isFinite(rounded)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, rounded));
}

/** Dimensões em células para a imagem com células de `cellPx` pixels. */
export function gridDimensionsForImage(image: ImageSize, cellPx: number): GridDimensions {
  const px = Math.max(1, Math.round(cellPx));
  const width = Math.ceil(image.width / px);
  const height = Math.ceil(image.height / px);
  const remainderX = image.width % px;
  const remainderY = image.height % px;
  return { width, height, exact: remainderX === 0 && remainderY === 0, remainderX, remainderY };
}

/**
 * Todos os divisores exatos em comum de `image.width` e `image.height` que
 * geram um mapa válido (1..MAX_MAP_CELLS células por lado), em ordem crescente.
 */
export function recommendedCellSizes(image: ImageSize): RecommendedCellSize[] {
  const w = Math.round(image.width);
  const h = Math.round(image.height);
  if (w < 1 || h < 1) return [];
  const { min, max } = cellPxBounds({ width: w, height: h });
  const minRecommended = Math.max(min, MIN_RECOMMENDED_CELL_PX);
  const divisor = gcd(w, h);
  const sizes: number[] = [];
  for (let d = 1; d * d <= divisor; d += 1) {
    if (divisor % d !== 0) continue;
    if (d >= minRecommended && d <= max) sizes.push(d);
    const pair = divisor / d;
    if (pair !== d && pair >= minRecommended && pair <= max) sizes.push(pair);
  }
  sizes.sort((a, b) => a - b);
  return sizes.map((cellPx) => ({ cellPx, width: w / cellPx, height: h / cellPx }));
}

/** Valor inicial ao escolher uma imagem: o divisor exato mais próximo de 70 px, ou 70 px dentro dos limites. */
export function defaultCellPx(image: ImageSize): number {
  const [first, ...rest] = recommendedCellSizes(image);
  if (first) {
    return rest.reduce(
      (best, current) =>
        Math.abs(current.cellPx - DEFAULT_TARGET_CELL_PX) < Math.abs(best.cellPx - DEFAULT_TARGET_CELL_PX) ? current : best,
      first,
    ).cellPx;
  }
  return clampCellPx(DEFAULT_TARGET_CELL_PX, cellPxBounds(image));
}

/** Tamanho da imagem de fundo em unidades do mundo lógico (`cellPx` preserva a escala real sem esticar). */
export function backgroundWorldSize(map: Pick<GameMap, 'width' | 'height' | 'cellPx'>, image: ImageSize): ImageSize {
  if (map.cellPx !== null) {
    return {
      width: (image.width / map.cellPx) * WORLD_UNITS_PER_CELL,
      height: (image.height / map.cellPx) * WORLD_UNITS_PER_CELL,
    };
  }
  return {
    width: map.width * WORLD_UNITS_PER_CELL,
    height: map.height * WORLD_UNITS_PER_CELL,
  };
}
