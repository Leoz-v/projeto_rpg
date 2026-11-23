/**
 * Ordem de turnos do combate (SRD 5.2.1, "Initiative" e "Combat"): os
 * combatentes agem em ordem decrescente de iniciativa, uma rodada depois da
 * outra. No empate, o SRD deixa a ordem com o mestre; o motor propõe o maior
 * modificador primeiro e, persistindo, a ordem de entrada (o mestre ajusta
 * com um override da iniciativa).
 */

export interface InitiativeOrder {
  initiative: number;
  /** Modificador da iniciativa, para o desempate. */
  modifier: number;
}

/** Ordena por iniciativa (maior primeiro), depois pelo modificador; estável no empate total. */
export function sortByInitiative<T extends InitiativeOrder>(combatants: readonly T[]): T[] {
  return [...combatants].sort((a, b) => b.initiative - a.initiative || b.modifier - a.modifier);
}

export interface TurnPosition {
  round: number;
  /** Índice do combatente da vez. */
  turn: number;
}

/** A vez seguinte: depois do último, a próxima rodada começa no primeiro. */
export function nextTurn(position: TurnPosition, count: number): TurnPosition & { newRound: boolean } {
  if (position.turn + 1 < count) return { round: position.round, turn: position.turn + 1, newRound: false };
  return { round: position.round + 1, turn: 0, newRound: true };
}

/** A vez anterior (desfazer um `nextTurn`); no primeiro da rodada 1, fica onde está. */
export function previousTurn(position: TurnPosition, count: number): TurnPosition {
  if (position.turn > 0) return { round: position.round, turn: position.turn - 1 };
  if (position.round > 1) return { round: position.round - 1, turn: Math.max(0, count - 1) };
  return position;
}

/**
 * A vez depois de tirar o combatente `removed` da ordem: quem estava na vez
 * continua; se foi ele quem saiu, a vez passa ao seguinte (e, se era o último,
 * a próxima rodada começa). `undefined` quando não sobra ninguém.
 */
export function turnAfterRemoval(position: TurnPosition, removed: number, count: number): (TurnPosition & { newRound: boolean }) | undefined {
  const remaining = count - 1;
  if (remaining <= 0) return undefined;
  if (removed < position.turn) return { round: position.round, turn: position.turn - 1, newRound: false };
  if (removed > position.turn) return { round: position.round, turn: position.turn, newRound: false };
  // Saiu quem estava na vez: o seguinte ocupa o mesmo índice.
  if (position.turn < remaining) return { round: position.round, turn: position.turn, newRound: false };
  return { round: position.round + 1, turn: 0, newRound: true };
}
