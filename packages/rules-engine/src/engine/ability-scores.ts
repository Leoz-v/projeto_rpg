import { ABILITY_ROLL_SETS } from '../schemas/character';
import { ABILITIES, type AbilityScores } from '../schemas/common';
import type { Rng } from './dice';

/**
 * Geração aleatória dos valores de atributo (SRD 5.2.1 p. 20, "Random
 * Generation"): role 4d6 e some os três maiores; faça isso seis vezes.
 */

export const ABILITY_ROLL_DICE = 4;
export const ABILITY_ROLL_SIDES = 6;

export interface AbilityRollSet {
  /** Os quatro dados, na ordem em que saíram. */
  dice: number[];
  /** Índice do dado descartado (o menor; o primeiro, em caso de empate). */
  dropped: number;
  /** Soma dos três maiores. */
  total: number;
}

export function rollAbilityScores(rng: Rng): AbilityRollSet[] {
  return Array.from({ length: ABILITY_ROLL_SETS }, () => {
    const dice = Array.from({ length: ABILITY_ROLL_DICE }, () => rng.roll(ABILITY_ROLL_SIDES));
    const dropped = dice.indexOf(Math.min(...dice));
    const total = dice.reduce((sum, d, i) => (i === dropped ? sum : sum + d), 0);
    return { dice, dropped, total };
  });
}

/** Os seis valores distribuídos usam exatamente os números rolados (cada um uma vez). */
export function usesRolledValues(scores: AbilityScores, rolled: readonly number[]): boolean {
  const assigned = ABILITIES.map((a) => scores[a]).sort((a, b) => a - b);
  const available = [...rolled].sort((a, b) => a - b);
  return assigned.length === available.length && assigned.every((v, i) => v === available[i]);
}
