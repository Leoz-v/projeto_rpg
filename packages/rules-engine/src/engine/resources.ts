/**
 * Recursos de uso limitado (efeito `resource`, nota 0052): quantos usos sobram
 * e o que cada descanso devolve. A ficha dá o máximo e a recarga; a mesa
 * guarda só os usos gastos. Sem dependências de valor: a tela importa por
 * `rules-engine/resources`.
 */

export type ResourceRechargeRule = 'long_rest' | 'short_rest' | 'short_rest_one';

/** Usos gastos por id do recurso. */
export type ResourcesSpent = Readonly<Record<string, number>>;

/** Usos disponíveis: o máximo menos os gastos, nunca abaixo de 0. */
export function availableUses(max: number, spent: ResourcesSpent, id: string): number {
  return Math.max(0, max - (spent[id] ?? 0));
}

/**
 * Os gastos depois de um descanso: o longo zera todos; o curto zera os
 * `short_rest` e devolve 1 de cada `short_rest_one`. Recursos que a ficha não
 * tem mais saem do registro.
 */
export function resourcesAfterRest(resources: readonly { id: string; recharge: ResourceRechargeRule }[], spent: ResourcesSpent, rest: 'short' | 'long'): Record<string, number> {
  const next: Record<string, number> = {};
  if (rest === 'long') return next;
  for (const { id, recharge } of resources) {
    const used = spent[id] ?? 0;
    const left = recharge === 'short_rest' ? 0 : recharge === 'short_rest_one' ? used - 1 : used;
    if (left > 0) next[id] = left;
  }
  return next;
}
