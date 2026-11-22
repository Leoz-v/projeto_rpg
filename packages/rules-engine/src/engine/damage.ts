import type { DamageType } from '../schemas/common';
import { type DiceRoll, type Rng, rollDice } from './dice';
import type { Defenses, SourceLabel } from './types';

/**
 * Aplicação de dano a uma criatura, na ordem do SRD 5.2.1 ("Damage Resistance
 * and Vulnerability"): imunidade zera; senão, ajustes (reduções), depois
 * Resistência (metade, para baixo), depois Vulnerabilidade (dobro). O resultado
 * traz cada passo, para o log e para o override do mestre.
 */

export interface DamageInstance {
  amount: number;
  type: DamageType;
}

export type DamageStep =
  | { kind: 'immunity'; sources: SourceLabel[]; before: number; after: 0 }
  | { kind: 'reduction'; source: SourceLabel; roll: DiceRoll; before: number; after: number }
  | { kind: 'resistance' | 'vulnerability'; sources: SourceLabel[]; before: number; after: number };

export interface AppliedDamage {
  type: DamageType;
  incoming: number;
  final: number;
  steps: DamageStep[];
}

export interface DamageResult {
  total: number;
  instances: AppliedDamage[];
}

export function applyDamage(defenses: Defenses, damage: readonly DamageInstance[], rng: Rng): DamageResult {
  const instances = damage.map(({ amount, type }): AppliedDamage => {
    const steps: DamageStep[] = [];
    const immunity = defenses.damageImmunities.find((d) => d.damageType === type);
    if (immunity) {
      steps.push({ kind: 'immunity', sources: immunity.sources, before: amount, after: 0 });
      return { type, incoming: amount, final: 0, steps };
    }
    let value = amount;
    for (const reduction of defenses.damageReductions.filter((r) => r.damageType === type)) {
      const roll = rollDice(reduction.amount, rng);
      const after = Math.max(0, value - roll.total);
      steps.push({ kind: 'reduction', source: reduction.source, roll, before: value, after });
      value = after;
    }
    const resistance = defenses.resistances.find((d) => d.damageType === type);
    if (resistance) {
      const after = Math.floor(value / 2);
      steps.push({ kind: 'resistance', sources: resistance.sources, before: value, after });
      value = after;
    }
    const vulnerability = defenses.vulnerabilities.find((d) => d.damageType === type);
    if (vulnerability) {
      const after = value * 2;
      steps.push({ kind: 'vulnerability', sources: vulnerability.sources, before: value, after });
      value = after;
    }
    return { type, incoming: amount, final: value, steps };
  });
  return { total: instances.reduce((sum, i) => sum + i.final, 0), instances };
}
