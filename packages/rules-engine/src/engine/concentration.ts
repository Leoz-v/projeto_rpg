/**
 * Concentração (SRD 5.2.1, Rules Glossary, "Concentration"; nota 0045).
 * O estado (a magia mantida) fica na mesa; aqui só as regras.
 */

const MIN_DC = 10;
const MAX_DC = 30;

/** CD da salvaguarda de Constituição ao sofrer dano: o maior entre 10 e metade do dano (para baixo), até 30. */
export function concentrationDc(damage: number): number {
  return Math.min(MAX_DC, Math.max(MIN_DC, Math.floor(Math.max(0, damage) / 2)));
}
