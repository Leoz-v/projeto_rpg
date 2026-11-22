import { randomInt } from 'node:crypto';
import type { Rng } from 'rules-engine';

/** RNG do Host (rolagem autoritativa): uniforme e criptográfico, via `node:crypto`. */
export const cryptoRng: Rng = {
  roll: (sides) => randomInt(1, sides + 1),
};
