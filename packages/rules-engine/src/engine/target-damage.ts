import type { DamageType } from '../schemas/common';
import type { NamedEffects } from './creature-effects';

/** Dano extra contra um alvo (`target_damage`; nota 0063), com a fonte para o log. */
export interface TargetDamage {
  dice: string;
  type: DamageType;
  source: string;
}

/**
 * O dano extra de quem conjurou ao acertar o alvo: `marks` são os efeitos da
 * magia dele no alvo (Hex); `own`, os efeitos nele mesmo, que dependem da
 * distância (Conjure Minor Elementals). Sem a distância, vira lembrete.
 */
export function targetDamage(marks: readonly NamedEffects[], own: readonly NamedEffects[], distanceFt: number | undefined): { damage: TargetDamage[]; reminders: string[] } {
  const damage: TargetDamage[] = [];
  const reminders: string[] = [];
  for (const { name, effects } of marks) {
    for (const e of effects) if (e.type === 'target_damage' && e.within === undefined) damage.push({ dice: e.dice, type: e.damageType, source: name });
  }
  for (const { name, effects } of own) {
    for (const e of effects) {
      if (e.type !== 'target_damage' || e.within === undefined) continue;
      if (distanceFt === undefined) reminders.push(`+${e.dice} possível: ${name} (alvo a até ${e.within} ft)`);
      else if (distanceFt <= e.within) damage.push({ dice: e.dice, type: e.damageType, source: name });
    }
  }
  return { damage, reminders };
}
