import type { Ability, Condition, DamageType, Skill } from '../schemas/common';
import type { Predicate } from '../schemas/predicate';
import { criticalDice } from './attack';
import { CONDITION_NAME } from './names';
import type { D20RollInput, D20Step } from './d20';
import { type Rng, rollDice } from './dice';
import type { Contribution, DerivedSheet, RollState, RollStat, SourceLabel, WeaponAttack } from './types';

/**
 * Rolagens a partir da ficha calculada: o que entra no `rollD20` (modificador,
 * Vantagem/Desvantagem, regras do d20, faixa de crítico) e o dano das armas.
 * Quem rola é o Host, com o RNG dele; a ficha só diz o que vale.
 */

export type SheetRollTarget =
  | { kind: 'skill'; skill: Skill }
  | { kind: 'save'; ability: Ability }
  | { kind: 'initiative' }
  | { kind: 'death_save' }
  | { kind: 'attack'; instanceId: string };

/**
 * O que a rolagem evita (`roll.against`, nota 0006): uma condição e/ou a
 * origem. Contra uma magia, use `spell`: vale também para `against.source: magic`.
 */
export interface RollAgainst {
  condition?: Condition | undefined;
  source?: 'spell' | 'magic' | undefined;
}

/**
 * O predicado é só sobre o que a rolagem evita e bate com `against`. Outros
 * predicados (armadura, condições da criatura) continuam como lembrete: a ficha
 * não os avalia na hora.
 */
export function matchesAgainst(when: Predicate | undefined, against: RollAgainst | undefined): boolean {
  if (!when || !against) return false;
  if ('against' in when) {
    const target = when.against;
    if ('condition' in target) return against.condition === target.condition;
    return target.source === 'magic' ? against.source !== undefined : against.source === 'spell';
  }
  if ('all' in when) return when.all.every((p) => matchesAgainst(p, against));
  if ('any' in when) return when.any.some((p) => matchesAgainst(p, against));
  return false;
}

/** Vantagem ou Desvantagem declarada na hora (circunstância que a ficha não sabe, ou concedida pelo mestre). */
export interface DeclaredRoll {
  advantage?: boolean | undefined;
  disadvantage?: boolean | undefined;
}

export interface SheetD20 {
  input: D20RollInput;
  /** A conta do modificador, para o log. */
  parts: Contribution[];
  /** De onde vieram a Vantagem e a Desvantagem (incluindo a declarada). */
  advantage: string[];
  disadvantage: string[];
  /** Lembretes do que pode valer nesta rolagem e a ficha não decide sozinha. */
  reminders: string[];
}

const DECLARED = 'Declarada na rolagem';

function statFor(sheet: DerivedSheet, target: SheetRollTarget): { stat: RollStat; critMin?: number | undefined } | undefined {
  switch (target.kind) {
    case 'skill':
      return { stat: sheet.skills[target.skill] };
    case 'save':
      return { stat: sheet.saves[target.ability] };
    case 'initiative':
      return { stat: sheet.initiative };
    case 'death_save':
      return { stat: sheet.deathSave };
    case 'attack': {
      const attack = sheet.attacks.find((a) => a.instanceId === target.instanceId);
      return attack ? { stat: attack.attack, critMin: attack.critRange } : undefined;
    }
  }
}


/** "contra Envenenado", "contra magias": a circunstância de um `against`, se for só isso. */
function circumstance(when: Predicate | undefined): string | undefined {
  if (!when || !('against' in when)) return undefined;
  const { against } = when;
  if ('condition' in against) return `contra ${CONDITION_NAME[against.condition]}`;
  return against.source === 'spell' ? 'contra magias' : 'contra magia e efeitos mágicos';
}

/** Lembretes em pt-BR das Vantagens, Desvantagens e regras situacionais da rolagem. */
export function rollReminders(roll: RollState): string[] {
  const extra = (when: Predicate | undefined, note: string | undefined): string => {
    const text = note ?? circumstance(when);
    return text ? ` (${text})` : '';
  };
  return [
    ...roll.situational.map((s) => `${s.kind === 'advantage' ? 'Vantagem' : 'Desvantagem'} possível: ${s.source.name}${extra(s.when, s.note)}`),
    ...roll.situationalRules.map((r) => `Regra possível: ${r.source.name}${extra(r.when, r.note)}`),
  ];
}

/**
 * Monta o Teste d20 de uma rolagem da ficha. Vantagem e Desvantagem se anulam,
 * qualquer que seja a quantidade de cada (regra 2024). `undefined` se o alvo
 * não existe na ficha (ex.: arma que não está equipada).
 */
export function sheetD20(sheet: DerivedSheet, target: SheetRollTarget, declared: DeclaredRoll = {}, against?: RollAgainst): SheetD20 | undefined {
  const found = statFor(sheet, target);
  if (!found) return undefined;
  const { stat, critMin } = found;
  // Circunstâncias que batem com o que a rolagem evita deixam de ser lembrete e valem (Dwarven Resilience contra Envenenado).
  const applies = (s: { when?: Predicate | undefined; note?: string | undefined }): boolean => s.note === undefined && matchesAgainst(s.when, against);
  const situational = stat.roll.situational.filter(applies);
  const situationalRules = stat.roll.situationalRules.filter(applies);
  const advantage = [
    ...stat.roll.advantage.map((s) => s.name),
    ...situational.filter((s) => s.kind === 'advantage').map((s) => s.source.name),
    ...(declared.advantage ? [DECLARED] : []),
  ];
  const disadvantage = [
    ...stat.roll.disadvantage.map((s) => s.name),
    ...situational.filter((s) => s.kind === 'disadvantage').map((s) => s.source.name),
    ...(declared.disadvantage ? [DECLARED] : []),
  ];
  const mode = d20Mode(advantage.length > 0, disadvantage.length > 0);
  const rules = [...stat.roll.rules, ...situationalRules];
  const remaining = { ...stat.roll, situational: stat.roll.situational.filter((s) => !applies(s)), situationalRules: stat.roll.situationalRules.filter((r) => !applies(r)) };
  return {
    input: { modifier: stat.total, mode, rules, ...(critMin !== undefined && critMin < 20 ? { critMin } : {}) },
    parts: stat.parts,
    advantage,
    disadvantage,
    reminders: rollReminders(remaining),
  };
}

/** Vantagem e Desvantagem se anulam, qualquer que seja a quantidade (regra 2024). */
export function d20Mode(advantage: boolean, disadvantage: boolean): 'normal' | 'advantage' | 'disadvantage' {
  return advantage && !disadvantage ? 'advantage' : disadvantage && !advantage ? 'disadvantage' : 'normal';
}

const sourceName = (source: SourceLabel | undefined): string => (source ? ` (${source.name})` : '');

/** O que aconteceu no d20, em pt-BR, além da rolagem simples. */
export function d20StepNotes(steps: readonly D20Step[]): string[] {
  return steps.flatMap((step): string[] => {
    switch (step.kind) {
      case 'reroll':
        return [`Rolou ${step.from} de novo: ${step.to}${sourceName(step.source)}`];
      case 'count_as_20':
        return [`${step.value} conta como 20${sourceName(step.source)}`];
      case 'minimum_die':
        return [`d20 ${step.from} vale ${step.to}${sourceName(step.source)}`];
      case 'minimum_total':
        return [`Total ${step.from} vale ${step.to}${sourceName(step.source)}`];
      case 'auto_success':
        return [`Sucesso automático${sourceName(step.source)}`];
      case 'roll':
      case 'keep':
      case 'modifier':
        return [];
    }
  });
}

// --- Dano de arma -----------------------------------------------------------

export interface DamageOptions {
  /** Acerto Crítico: os dados de dano são rolados duas vezes (SRD 5.2.1, "Critical Hits"). */
  critical?: boolean | undefined;
  /** Arma Versatile empunhada com as duas mãos. */
  versatile?: boolean | undefined;
}

export interface DamageGroup {
  /** Expressão rolada (dados dobrados no crítico), sem o bônus. */
  dice: string;
  type: DamageType;
  /** Fonte do dano extra (Radiant Strikes), ausente no dano da arma. */
  source?: string | undefined;
  rolls: { sides: number; value: number; rolled?: number | undefined }[];
  /** Soma dos dados do grupo (o bônus entra só no primeiro, o da arma). */
  total: number;
}

export interface WeaponDamageRoll {
  groups: DamageGroup[];
  bonus: number;
  total: number;
  /** Mínimo por dado aplicado (Great Weapon Fighting), com a fonte. */
  dieMinimum?: { value: number; source: string } | undefined;
}

export function rollWeaponDamage(attack: WeaponAttack, options: DamageOptions, rng: Rng): WeaponDamageRoll {
  const versatile = options.versatile === true && attack.versatileDice !== undefined;
  const base = versatile ? (attack.versatileDice ?? attack.damage.dice) : attack.damage.dice;
  const minimum = versatile ? attack.versatileDieMinimum : attack.damage.dieMinimum;
  const dice = (expression: string): string => (options.critical ? criticalDice(expression) : expression);

  const weapon = rollDice(dice(base), rng, { minimumDie: minimum?.value });
  const groups: DamageGroup[] = [{ dice: dice(base), type: attack.damage.type, rolls: weapon.rolls, total: weapon.total }];
  for (const extra of attack.extraDamage) {
    const rolled = rollDice(dice(extra.dice), rng);
    groups.push({ dice: dice(extra.dice), type: extra.type, source: extra.source.name, rolls: rolled.rolls, total: rolled.total });
  }
  const bonus = attack.damage.bonus.total;
  const total = Math.max(0, groups.reduce((sum, g) => sum + g.total, 0) + bonus);
  return { groups, bonus, total, ...(minimum ? { dieMinimum: { value: minimum.value, source: minimum.source.name } } : {}) };
}
