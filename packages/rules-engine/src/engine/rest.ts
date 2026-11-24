/**
 * Descansos e Dados de Vida (SRD 5.2.1, Rules Glossary, "Short Rest" e
 * "Long Rest"; nota 0050). O estado (quem descansa, os dados gastos) fica na
 * mesa; aqui só as regras.
 */

/** Dados de Vida gastos, pelo tamanho do dado ("10" → quantos d10 foram gastos). */
export type HitDiceSpent = Readonly<Record<string, number>>;

/** Quantos dados de cada tamanho ainda podem ser gastos (a ficha diz o total; gastos a mais, depois de desfazer um nível, contam como 0). */
export function availableHitDice(hitDice: readonly { die: number; count: number }[], spent: HitDiceSpent): { die: number; available: number; count: number }[] {
  return hitDice.map(({ die, count }) => ({ die, count, available: Math.max(0, count - (spent[String(die)] ?? 0)) }));
}

/** PV de um Dado de Vida gasto: o valor rolado mais o modificador de Constituição, no mínimo 1. */
export function hitDieHealing(roll: number, conModifier: number): number {
  return Math.max(1, roll + conModifier);
}

/** O descanso longo reduz a Exaustão em 1. */
export function exhaustionAfterLongRest(level: number): number {
  return Math.max(0, level - 1);
}

/** Para começar um descanso, curto ou longo, é preciso ter pelo menos 1 PV. */
export const MIN_HP_TO_REST = 1;
