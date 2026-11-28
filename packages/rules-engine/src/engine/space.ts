import type { Size } from '../schemas/common';

/**
 * Espaço que uma criatura ocupa no grid, pelo tamanho (SRD 5.2.1, p. 14,
 * "Creature Size and Space"): Tiny "2½ by 2½ feet" (4 por quadrado), Small e
 * Medium "5 by 5 feet" (1 quadrado), Large "10 by 10 feet" (2 por 2), Huge
 * "15 by 15 feet" (3 por 3), Gargantuan "20 by 20 feet" (4 por 4).
 *
 * Sem dependências: a tela (mapa) importa este módulo por `rules-engine/space`,
 * sem trazer o compêndio.
 */

export const SPACE_FEET: Readonly<Record<Size, number>> = {
  tiny: 2.5,
  small: 5,
  medium: 5,
  large: 10,
  huge: 15,
  gargantuan: 20,
};

/** Pés por quadrado do grid. */
export const FEET_PER_SQUARE = 5;

/** Lado do espaço em quadrados (Tiny = 0,5). */
export function spaceSquares(size: Size): number {
  return SPACE_FEET[size] / FEET_PER_SQUARE;
}

/** Onde a criatura está no grid: o canto superior esquerdo, em quadrados, e o tamanho. */
export interface Footprint {
  x: number;
  y: number;
  size: Size;
}

/** Coordenada de uma célula inteira no grid (0-based). */
export interface GridCell {
  x: number;
  y: number;
}

/**
 * Distância entre duas criaturas em pés, contando os quadrados entre os
 * espaços delas, com a diagonal valendo 5 ft (SRD 5.2.1, grid): vizinhas
 * (inclusive na diagonal) ficam a 5 ft; espaços sobrepostos também contam 5 ft.
 */
export function distanceFeet(a: Footprint, b: Footprint): number {
  const sideA = spaceSquares(a.size);
  const sideB = spaceSquares(b.size);
  const gapX = Math.max(0, b.x - (a.x + sideA), a.x - (b.x + sideB));
  const gapY = Math.max(0, b.y - (a.y + sideA), a.y - (b.y + sideB));
  return (Math.ceil(Math.max(gapX, gapY)) + 1) * FEET_PER_SQUARE;
}

/**
 * Distância entre duas células do grid em pés, usando a mesma regra de
 * `distanceFeet` (diagonal = 5 ft, SRD 5.2.1): a própria célula mede 0 ft;
 * células vizinhas (inclusive na diagonal) medem 5 ft.
 */
export function cellDistanceFeet(from: GridCell, to: GridCell): number {
  if (from.x === to.x && from.y === to.y) return 0;
  return distanceFeet({ x: from.x, y: from.y, size: 'medium' }, { x: to.x, y: to.y, size: 'medium' });
}

/** Tamanhos do menor ao maior (SRD 5.2.1, "Size"). */
const SIZE_ORDER: readonly Size[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];

/** O alvo é do tamanho `max` ou menor. */
export const sizeAtMost = (size: Size, max: Size): boolean => SIZE_ORDER.indexOf(size) <= SIZE_ORDER.indexOf(max);
