/**
 * Salvaguardas contra a Morte (SRD 5.2.1 p. 17–18, "Dropping to 0 Hit
 * Points", "Death Saving Throws", "Stabilizing a Character"). Só para
 * personagens: um monstro a 0 PV morre (a critério do mestre).
 *
 * Funções puras sobre o estado: quem chama aplica a mudança de PV pelo
 * `applyHitPointChange` e passa o resultado aqui.
 */

import type { HitPointResult } from './hit-points';

export interface DeathSaveState {
  /** Sucessos e falhas acumulados (0 a 3); zerados ao recuperar PV ou ficar Estável. */
  successes: number;
  failures: number;
  /** Estável: não faz mais Salvaguardas contra a Morte, mas continua Inconsciente. */
  stable: boolean;
  dead: boolean;
}

export const NO_DEATH_SAVES: DeathSaveState = { successes: 0, failures: 0, stable: false, dead: false };

export const DEATH_SAVE_DC = 10;
const THREE = 3;

/** Morrendo: 0 PV, nem Estável nem morto (faz Salvaguardas contra a Morte no início do turno). */
export function isDying(currentHp: number, state: DeathSaveState): boolean {
  return currentHp === 0 && !state.stable && !state.dead;
}

/** Acrescenta falhas; na terceira, morte. */
function addFailures(state: DeathSaveState, count: number): DeathSaveState {
  const failures = Math.min(THREE, state.failures + count);
  return { ...state, failures, dead: state.dead || failures >= THREE };
}

export type DeathSaveOutcome = 'success' | 'failure' | 'two_failures' | 'revived';

/**
 * Resultado de uma Salvaguarda contra a Morte. `total` já com os
 * modificadores; `natural20` inclui o que conta como 20 (Survivor);
 * `natural1`, o 1 no dado. 20: recupera 1 PV (quem chama aplica a cura, que
 * zera a contagem). 1: duas falhas. Três sucessos: Estável, contagem zerada.
 */
export function resolveDeathSave(state: DeathSaveState, roll: { total: number; natural1: boolean; natural20: boolean }): { state: DeathSaveState; outcome: DeathSaveOutcome } {
  if (roll.natural20) return { state, outcome: 'revived' };
  if (roll.natural1) return { state: addFailures(state, 2), outcome: 'two_failures' };
  if (roll.total < DEATH_SAVE_DC) return { state: addFailures(state, 1), outcome: 'failure' };
  const successes = state.successes + 1;
  if (successes >= THREE) return { state: { ...state, successes: 0, failures: 0, stable: true }, outcome: 'success' };
  return { state: { ...state, successes }, outcome: 'success' };
}

export type DeathDamageEvent = 'none' | 'unconscious' | 'failure' | 'two_failures' | 'dead';

/**
 * Efeito de um dano já aplicado (`applyHitPointChange`) nas Salvaguardas
 * contra a Morte:
 * - cair a 0 PV: Inconsciente; com dano massivo (o que sobra ≥ PV máximos), morte;
 * - dano com 0 PV: uma falha, duas no Acerto Crítico, morte se o dano for ≥ PV máximos;
 *   um personagem Estável deixa de estar Estável.
 */
export function deathAfterDamage(state: DeathSaveState, result: HitPointResult, critical: boolean): { state: DeathSaveState; event: DeathDamageEvent } {
  if (state.dead) return { state, event: 'none' };
  if (result.droppedToZero) {
    if (result.massiveDamage) return { state: { ...state, dead: true }, event: 'dead' };
    return { state: NO_DEATH_SAVES, event: 'unconscious' };
  }
  if (!result.damagedAtZero) return { state, event: 'none' };
  if (result.massiveDamage) return { state: { ...state, stable: false, dead: true }, event: 'dead' };
  const next = addFailures({ ...state, stable: false }, critical ? 2 : 1);
  return { state: next, event: next.dead ? 'dead' : critical ? 'two_failures' : 'failure' };
}

/** Recuperar qualquer PV zera sucessos e falhas e tira o Estável (o morto continua morto). */
export function deathAfterHealing(state: DeathSaveState): DeathSaveState {
  return state.dead ? state : NO_DEATH_SAVES;
}
