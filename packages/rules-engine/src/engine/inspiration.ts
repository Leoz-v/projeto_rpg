import type { SelfInspiration } from '../schemas/effect';
import type { D20RollResult } from './d20';
import { type Rng, rollDice } from './dice';
import type { SourceLabel } from './types';

/**
 * Dados de inspiração (Bardic Inspiration, Peerless Skill; nota 0079): o dado
 * é rolado depois de ver o d20 e somado ao total, podendo virar a falha em
 * sucesso. Quem decide usar é o jogador; quem rola é o Host.
 */

/** O dado no nível da escala da fonte (`byLevel`, 20 valores). */
const atLevel = (dice: string | { byLevel: string[] }, level: number): string => (typeof dice === 'string' ? dice : (dice.byLevel[Math.max(1, level) - 1] ?? '0'));

/** O tipo de Teste d20 de uma rolagem da ficha, para saber se a inspiração vale. */
export type InspirationRoll = 'check' | 'attack' | 'save';

/** Uso próprio do dado de inspiração (Peerless Skill), com os números do personagem. */
export interface SheetSelfInspiration {
  id: string;
  name: string;
  resourceId: string;
  dice: string;
  rolls: InspirationRoll[];
  /** Se a rolagem continuar falhando, o uso não é gasto. */
  keepOnFailure: boolean;
  source: SourceLabel;
}

/** Os usos próprios da ficha; o de mesmo id que vem depois substitui. */
export function resolveSelfInspirations(
  effects: readonly { effect: SelfInspiration; classId?: string | undefined; source: SourceLabel }[],
  scaleLevel: (classId: string | undefined) => number,
): SheetSelfInspiration[] {
  const found = new Map<string, SheetSelfInspiration>();
  for (const { effect, classId, source } of effects) {
    found.set(effect.id, {
      id: effect.id,
      name: effect.name,
      resourceId: effect.resource,
      dice: atLevel(effect.dice, scaleLevel(classId)),
      rolls: [...effect.rolls],
      keepOnFailure: effect.keepOnFailure === true,
      source,
    });
  }
  return [...found.values()];
}

/** O tipo de Teste d20 de um alvo de rolagem da ficha: perícia e iniciativa são testes de atributo. */
export function inspirationRollOf(target: { kind: 'skill' | 'save' | 'initiative' | 'death_save' | 'attack' }): InspirationRoll {
  if (target.kind === 'attack') return 'attack';
  if (target.kind === 'save' || target.kind === 'death_save') return 'save';
  return 'check';
}

/**
 * Soma o dado de inspiração a um d20 já rolado (SRD 5.2.1: "roll the die and
 * add the number rolled to the d20"). Com a CD, o sucesso é recalculado; a
 * falha e o sucesso automáticos continuam valendo.
 */
export function addInspirationDie(roll: D20RollResult, dice: string, source: SourceLabel, rng: Rng, dc?: number): D20RollResult {
  const rolled = rollDice(dice, rng);
  const total = roll.total + rolled.total;
  const steps = [...roll.steps, { kind: 'bonus_dice' as const, dice, subtract: false, rolls: rolled.rolls.map((r) => r.value), value: rolled.total, total, source }];
  let { success } = roll;
  if (dc !== undefined) {
    const auto = roll.steps.find((s) => s.kind === 'auto_fail' || s.kind === 'auto_success');
    success = auto ? auto.kind === 'auto_success' : total >= dc;
  }
  return { ...roll, total, steps, success };
}

/** O dado não pode mudar o resultado: falha ou sucesso automáticos (Paralisado em FOR/DES), ou o 1 e o 20 naturais do ataque. */
export function inspirationUseless(roll: Pick<D20RollResult, 'steps' | 'critical' | 'fumble'>, kind: InspirationRoll): string | undefined {
  if (roll.steps.some((s) => s.kind === 'auto_fail')) return 'Falha automática: o dado não muda o resultado';
  if (roll.steps.some((s) => s.kind === 'auto_success')) return 'Sucesso automático: não precisa do dado';
  if (kind === 'attack' && roll.fumble) return 'O 1 natural sempre erra o ataque';
  if (kind === 'attack' && roll.critical) return 'O ataque já é um Acerto Crítico';
  return undefined;
}
