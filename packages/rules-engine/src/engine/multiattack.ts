import type { Multiattack } from '../schemas/action';

/**
 * Multiattack de um monstro (nota 0066). Sem dependências de valor: a tela
 * importa por `rules-engine/multiattack`.
 */

/** Um uso do Multiattack: as ações permitidas nele, contando as trocas. */
export interface MultiattackSlot {
  actions: string[];
  /** As que são trocas (Tail no lugar de um Rend). */
  replacements: string[];
}

/** Os usos de uma opção, na ordem do texto. */
export function multiattackSlots(multiattack: Multiattack, option: number): MultiattackSlot[] {
  const { replace } = multiattack;
  return (multiattack.options[option]?.steps ?? []).flatMap((step) => {
    const replacements = replace && (replace.from === undefined || step.actions.includes(replace.from)) ? replace.actions.filter((id) => !step.actions.includes(id)) : [];
    return Array.from({ length: step.count }, () => ({ actions: [...step.actions], replacements }));
  });
}

/**
 * As ações escolhidas cabem na opção: cada uma num uso que a permite, com as
 * trocas no limite. Pode usar menos que o total. Uma ação que também é troca
 * conta como troca só se não couber num uso normal.
 */
export function multiattackFits(multiattack: Multiattack, option: number, chosen: readonly string[]): boolean {
  const slots = multiattackSlots(multiattack, option);
  const { replace } = multiattack;
  const fit = (index: number, free: readonly number[], swaps: number): boolean => {
    const id = chosen[index];
    if (id === undefined) return true;
    for (const s of free) if (slots[s]?.actions.includes(id) && fit(index + 1, free.filter((x) => x !== s), swaps)) return true;
    if (!replace || swaps >= replace.max || !replace.actions.includes(id)) return false;
    const replaceable = free.filter((s) => slots[s]?.replacements.includes(id));
    if (replaceable.length < replace.cost) return false;
    // Quais usos a troca ocupa: `cost` quaisquer entre os que a aceitam.
    const pick = (start: number, taken: readonly number[]): boolean => {
      if (taken.length === replace.cost) return fit(index + 1, free.filter((x) => !taken.includes(x)), swaps + 1);
      return replaceable.some((s, i) => i >= start && pick(i + 1, [...taken, s]));
    };
    return pick(0, []);
  };
  return chosen.length > 0 && fit(0, slots.map((_, i) => i), 0);
}
