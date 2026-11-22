/**
 * Partes de uma rolagem para exibir: cada dado com o sinal do termo da
 * fórmula (`1d10-1d6` → o d6 subtrai) e a soma dos termos fixos (`+3`).
 */

export interface RollPart {
  sides: number;
  value: number;
  negative: boolean;
}

export function rollParts(formula: string, rolls: readonly { sides: number; value: number }[]): { dice: RollPart[]; modifier: number } {
  const dice: RollPart[] = [];
  let modifier = 0;
  let next = 0;
  for (const [, sign, count, , flat] of formula.matchAll(/([+-]?)(?:(\d+)d(\d+)|(\d+))/g)) {
    const negative = sign === '-';
    if (flat !== undefined) {
      modifier += negative ? -Number(flat) : Number(flat);
      continue;
    }
    for (let i = 0; i < Number(count); i++) {
      const roll = rolls[next++];
      if (roll) dice.push({ ...roll, negative });
    }
  }
  return { dice, modifier };
}
