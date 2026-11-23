import type { Ability, Damage, DamageType } from '../schemas/common';
import type { Creature } from '../schemas/creature';
import { type D20RollInput, type D20RollResult, rollD20 } from './d20';
import { applyDamage, type DamageInstance, type DamageResult } from './damage';
import { abilityModifier } from './math';
import { type Rng, rollDice } from './dice';
import type { DamageGroup } from './sheet-roll';
import type { Defenses, SourceLabel } from './types';

/**
 * Ataque contra um alvo (SRD 5.2.1, "Making an Attack" e "Critical Hits"): o
 * d20 contra a CA, com o 20 natural sempre acertando (e crítico) e o 1
 * natural sempre errando; no acerto, o dano é rolado (dados dobrados no
 * crítico) e passa pelas defesas do alvo (`applyDamage`). O resultado é uma
 * proposta: quem aplica nos PV é o mestre.
 */

/** Defesas de um monstro a partir dos efeitos do bloco de estatísticas (os condicionais ficam de fora, com lembrete). */
export function creatureDefenses(creature: Creature): { defenses: Defenses; reminders: string[] } {
  const source: SourceLabel = { kind: 'rule', id: creature.id, name: creature.name };
  const defenses: Defenses = { damageReductions: [], resistances: [], vulnerabilities: [], damageImmunities: [], conditionImmunities: [] };
  const reminders: string[] = [];
  const add = (list: { damageType: DamageType; sources: SourceLabel[] }[], damageType: DamageType): void => {
    if (!list.some((d) => d.damageType === damageType)) list.push({ damageType, sources: [source] });
  };
  for (const effect of creature.effects) {
    if (effect.type !== 'resistance' && effect.type !== 'vulnerability' && effect.type !== 'immunity') continue;
    if (effect.when || effect.note) {
      reminders.push(`${creature.name}: defesa condicional (${effect.note ?? 'veja o bloco de estatísticas'})`);
      continue;
    }
    if (effect.type === 'resistance') add(defenses.resistances, effect.damageType);
    else if (effect.type === 'vulnerability') add(defenses.vulnerabilities, effect.damageType);
    else if (effect.damageType) add(defenses.damageImmunities, effect.damageType);
    else if (effect.condition) defenses.conditionImmunities.push({ condition: effect.condition, sources: [source] });
  }
  return { defenses, reminders };
}

/** `2d6+1d4+3` → `4d6+2d4+3`: o crítico dobra os dados, não os números fixos. */
export function criticalDice(expression: string): string {
  return expression.replace(/(\d+)d(\d+)/g, (_, count: string, sides: string) => `${Number(count) * 2}d${sides}`);
}

/** Dano de uma ação de monstro: cada parte com a sua expressão (o fixo já vem nela, ex.: `1d6+2`). */
export function rollActionDamage(damage: readonly Damage[], critical: boolean, rng: Rng): DamageGroup[] {
  return damage.map((part) => {
    const dice = critical ? criticalDice(part.dice) : part.dice;
    const roll = rollDice(dice, rng);
    return { dice, type: part.type, rolls: roll.rolls, total: Math.max(0, roll.total) };
  });
}

export interface AttackInput {
  d20: D20RollInput;
  targetAc: number;
  /** Rola o dano do acerto (crítico ou não): grupos por tipo e o bônus, que soma ao primeiro grupo. */
  rollDamage: (critical: boolean) => { groups: DamageGroup[]; bonus: number };
  defenses: Defenses;
}

export interface AttackResult {
  roll: D20RollResult;
  hit: boolean;
  critical: boolean;
  damage?: { groups: DamageGroup[]; bonus: number; applied: DamageResult } | undefined;
}

export function resolveAttack(input: AttackInput, rng: Rng): AttackResult {
  const roll = rollD20(input.d20, rng);
  const critical = roll.critical;
  const hit = critical || (!roll.fumble && roll.total >= input.targetAc);
  if (!hit) return { roll, hit, critical: false };
  const { groups, bonus } = input.rollDamage(critical);
  // O bônus (modificador de atributo, arma mágica) é do dano da arma: entra no primeiro grupo.
  const instances = groups.map((g, i) => ({ amount: Math.max(0, g.total + (i === 0 ? bonus : 0)), type: g.type }));
  return { roll, hit, critical, damage: { groups, bonus, applied: applyDamage(input.defenses, instances, rng) } };
}

// --- Salvaguardas ------------------------------------------------------------

/** Bônus de salvaguarda de um monstro: o publicado no bloco ou o modificador do atributo. */
export function creatureSaveBonus(creature: Creature, ability: Ability): number {
  return creature.saves[ability] ?? abilityModifier(creature.abilities[ability]);
}

export interface SaveInput {
  d20: D20RollInput;
  dc: number;
  /** Dano já rolado (uma vez para todos os alvos, SRD 5.2.1 "Damage against Multiple Targets"), por tipo. */
  damage: readonly DamageInstance[];
  /** No sucesso: metade do dano (arredondada para baixo) ou nenhum. */
  onSuccess: 'half' | 'none';
  defenses: Defenses;
}

export interface SaveResult {
  roll: D20RollResult;
  success: boolean;
  /** Dano depois do sucesso/falha e das defesas do alvo; ausente sem dano. */
  damage?: DamageResult | undefined;
}

/**
 * Uma criatura faz a salvaguarda contra a CD. Na falha, sofre o dano todo; no
 * sucesso, metade ou nada (cada tipo pela metade, para baixo); depois, as
 * defesas do alvo. Em salvaguardas, o 20 e o 1 naturais não têm efeito especial.
 */
export function resolveSave(input: SaveInput, rng: Rng): SaveResult {
  const roll = rollD20({ ...input.d20, dc: input.dc }, rng);
  const success = roll.success === true;
  if (input.damage.length === 0) return { roll, success };
  const incoming = input.damage.map((d) => ({ type: d.type, amount: success ? (input.onSuccess === 'half' ? Math.floor(d.amount / 2) : 0) : d.amount }));
  return { roll, success, damage: applyDamage(input.defenses, incoming, rng) };
}
