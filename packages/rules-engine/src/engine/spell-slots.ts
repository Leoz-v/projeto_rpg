/**
 * Espaços de magia (SRD 5.2.1, "Spell Slots" e "Pact Magic"; nota 0051). A
 * ficha dá quantos há de cada círculo; a mesa guarda só os gastos.
 * Sem dependências de valor: a tela importa por `rules-engine/spell-slots`.
 */

/** Espaços gastos: por círculo ("1" → quantos de 1º círculo) e os da Magia de Pacto. */
export interface SpellSlotsSpent {
  byLevel: Readonly<Partial<Record<string, number>>>;
  pact: number;
}

export const NO_SPELL_SLOTS_SPENT: SpellSlotsSpent = { byLevel: {}, pact: 0 };

export interface SlotPool {
  level: number;
  total: number;
  available: number;
}

/**
 * Espaços que ainda podem ser gastos: por círculo (só os que existem) e os da
 * Magia de Pacto. Gastos a mais (depois de desfazer um nível) contam como 0.
 */
export function availableSpellSlots(
  spellcasting: { slots: readonly number[]; pactSlots?: { count: number; level: number } | undefined },
  spent: SpellSlotsSpent,
): { levels: SlotPool[]; pact: SlotPool | undefined } {
  const levels = spellcasting.slots.flatMap((total, i) => {
    if (total <= 0) return [];
    const level = i + 1;
    return [{ level, total, available: Math.max(0, total - (spent.byLevel[String(level)] ?? 0)) }];
  });
  const pactSlots = spellcasting.pactSlots;
  const pact = pactSlots && pactSlots.count > 0 ? { level: pactSlots.level, total: pactSlots.count, available: Math.max(0, pactSlots.count - spent.pact) } : undefined;
  return { levels, pact };
}

/** O que cada descanso devolve: o longo, todos; o curto, os da Magia de Pacto. */
export function spellSlotsAfterRest(spent: SpellSlotsSpent, rest: 'short' | 'long'): SpellSlotsSpent {
  return rest === 'long' ? NO_SPELL_SLOTS_SPENT : { ...spent, pact: 0 };
}
