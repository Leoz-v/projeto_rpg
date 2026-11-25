import type { Ability, CreatureType, DamageType } from '../schemas/common';
import type { SourceLabel } from './types';

/**
 * Dano extra de um ataque que depende do alvo, do d20 ou de escolha (efeito
 * `attack_rider`; nota 0077). A ficha lista o que cada ataque permite; o Host
 * diz o alvo, a rolagem e o que já foi usado no turno.
 */
export interface AttackRider {
  id: string;
  name: string;
  dice: string;
  /** Os tipos entre os quais quem ataca escolhe; um só, não há escolha. */
  types: DamageType[];
  /** `auto`: entra sozinho; `choice`: quem ataca marca. */
  mode: 'auto' | 'choice';
  oncePerTurn: boolean;
  /** Só nos ataques com este atributo. */
  ability?: Ability | undefined;
  /** Só contra (ou menos contra) estes tipos de criatura. */
  onlyTypes?: CreatureType[] | undefined;
  exceptTypes?: CreatureType[] | undefined;
  /** Só se o alvo já perdeu PV (Colossus Slayer). */
  injured: boolean;
  /** Só com 20 natural. */
  natural20: boolean;
  /** A regra do Sneak Attack: Vantagem, ou aliado a até 5 ft sem Desvantagem. Sem ela, aviso. */
  sneak: boolean;
  cost?: { kind: 'resource'; resourceId: string } | { kind: 'pact_slot' } | { kind: 'charges'; amount: number } | undefined;
  note?: string | undefined;
  source: SourceLabel;
}

/** O que quem ataca marcou. */
export interface ChosenRider {
  id: string;
  damageType?: DamageType | undefined;
}

export interface RiderTarget {
  /** `undefined`: o Host não sabe (token sem bloco). */
  type: CreatureType | undefined;
  injured: boolean | undefined;
}

/** Por que o que foi marcado não pode: desconhecido, já usado no turno ou sem tipo escolhido. */
export function chosenRiderProblems(riders: readonly AttackRider[], chosen: readonly ChosenRider[], used: ReadonlySet<string>): string[] {
  if (new Set(chosen.map((c) => c.id)).size !== chosen.length) return ['Dano extra repetido'];
  return chosen.flatMap((c) => {
    const rider = riders.find((r) => r.id === c.id && r.mode === 'choice');
    if (!rider) return ['Este ataque não tem esse dano extra'];
    if (rider.oncePerTurn && used.has(rider.id)) return [`${rider.name}: só uma vez por turno`];
    if (rider.types.length > 1 && (c.damageType === undefined || !rider.types.includes(c.damageType))) return [`${rider.name}: escolha o tipo de dano`];
    return [];
  });
}

export interface AppliedRider {
  rider: AttackRider;
  type: DamageType;
}

/** O que entra no acerto: os automáticos que valem contra o alvo e os marcados. Sem saber o alvo, o automático vira lembrete. */
export function ridersOnHit(
  riders: readonly AttackRider[],
  chosen: readonly ChosenRider[],
  context: { target: RiderTarget; natural: number; used: ReadonlySet<string> },
): { applied: AppliedRider[]; reminders: string[] } {
  const applied: AppliedRider[] = [];
  const reminders: string[] = [];
  for (const rider of riders) {
    const pick = chosen.find((c) => c.id === rider.id);
    if (rider.mode === 'choice' && !pick) continue;
    if (rider.oncePerTurn && context.used.has(rider.id)) continue;
    if (rider.natural20 && context.natural !== 20) continue;
    const { type, injured } = context.target;
    if (type !== undefined && ((rider.onlyTypes && !rider.onlyTypes.includes(type)) || rider.exceptTypes?.includes(type))) continue;
    const unknown = (type === undefined && (rider.onlyTypes ?? rider.exceptTypes) !== undefined) || (rider.injured && injured === undefined);
    if (unknown) {
      reminders.push(`+${rider.dice} possível: ${rider.name}`);
      continue;
    }
    if (rider.injured && injured !== true) continue;
    const damageType = pick?.damageType !== undefined && rider.types.includes(pick.damageType) ? pick.damageType : rider.types[0];
    if (damageType === undefined) continue;
    applied.push({ rider, type: damageType });
    if (rider.note !== undefined) reminders.push(`${rider.name}: ${rider.note}`);
  }
  return { applied, reminders };
}

/** Sneak Attack (SRD 5.2.1, Rogue): Vantagem na rolagem, ou um aliado a até 5 ft do alvo e nenhuma Desvantagem. */
export function sneakAttackAllowed(roll: { mode: 'normal' | 'advantage' | 'disadvantage'; hasDisadvantage: boolean; allyNearTarget: boolean }): boolean {
  return roll.mode === 'advantage' || (roll.allyNearTarget && !roll.hasDisadvantage);
}
