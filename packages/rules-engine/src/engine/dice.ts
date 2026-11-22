import type { Dice } from '../schemas/common';

/**
 * Rolagem de dados auditável. O RNG é injetado: na sessão, o Host passa o seu
 * (rolagem autoritativa, Fase 2); nos testes, um RNG com semente. Cada rolagem
 * devolve os dados individuais, para o log e para o override do mestre.
 */

export interface Rng {
  /** Inteiro uniforme em [1, sides]. */
  roll(sides: number): number;
}

/** RNG determinístico (mulberry32) a partir de uma semente: reproduzível em testes e replays. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { roll: (sides) => 1 + Math.floor(next() * sides) };
}

export interface DiceRoll {
  expression: Dice;
  /** Cada dado rolado, na ordem da expressão; `rolled` é o valor do dado quando `minimumDie` o subiu. */
  rolls: { sides: number; value: number; rolled?: number | undefined }[];
  total: number;
}

export interface RollDiceOptions {
  /** Cada dado abaixo disto vale isto (`damage_die_minimum`, Great Weapon Fighting). */
  minimumDie?: number | undefined;
}

/** Rola uma expressão no formato do DiceSchema (`2d8`, `1d10+1d6-1`, `5`). */
export function rollDice(expression: Dice, rng: Rng, options: RollDiceOptions = {}): DiceRoll {
  const rolls: DiceRoll['rolls'] = [];
  let total = 0;
  for (const [, sign, count, sides, flat] of expression.matchAll(/([+-]?)(?:(\d+)d(\d+)|(\d+))/g)) {
    const s = sign === '-' ? -1 : 1;
    if (flat !== undefined) {
      total += s * Number(flat);
      continue;
    }
    for (let i = 0; i < Number(count); i++) {
      const rolled = rng.roll(Number(sides));
      const value = Math.max(rolled, options.minimumDie ?? rolled);
      rolls.push({ sides: Number(sides), value, ...(value !== rolled ? { rolled } : {}) });
      total += s * value;
    }
  }
  return { expression, rolls, total };
}
