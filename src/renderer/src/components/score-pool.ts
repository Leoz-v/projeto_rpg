import { ABILITIES, type Ability, type AbilityScores } from 'rules-engine/schemas';

/**
 * Distribuição de um conjunto fixo de valores entre os seis atributos
 * (conjunto padrão ou valores rolados pelo Host): cada valor do conjunto vai
 * para um atributo só. Quem confere a regra é o Host, pelo schema do motor;
 * aqui só se evita oferecer um valor já usado.
 */

export type Assignment = Partial<Record<Ability, number>>;

/** Valores que ainda podem ir para `ability` (o que sobra do conjunto sem os outros atributos), do maior para o menor. */
export function availableValues(pool: readonly number[], assigned: Assignment, ability: Ability): number[] {
  const left = [...pool];
  for (const other of ABILITIES) {
    const value = assigned[other];
    if (other === ability || value === undefined) continue;
    const i = left.indexOf(value);
    if (i !== -1) left.splice(i, 1);
  }
  return [...new Set(left)].sort((a, b) => b - a);
}

/** Os seis atributos receberam valor. */
export function isComplete(assigned: Assignment): assigned is AbilityScores {
  return ABILITIES.every((a) => assigned[a] !== undefined);
}
