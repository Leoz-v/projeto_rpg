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
