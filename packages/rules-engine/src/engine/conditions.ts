import type { Ability, Condition, DamageType } from '../schemas/common';
import { DAMAGE_TYPES } from '../schemas/common';
import type { D20RollInput } from './d20';
import { EXHAUSTION_D20_PENALTY } from './math';
import { CONDITION_NAME } from './names';
import type { Contribution, Defenses, SourceLabel } from './types';

/**
 * Efeitos das condições nas rolagens (SRD 5.2.1, Rules Glossary, "[Condition]").
 * O que depende só da criatura é aplicado; o que depende de algo que o motor
 * não sabe (a fonte do medo à vista, quem agarra, quem enfeitiçou) vira
 * lembrete. Vale igual para a ficha do personagem e para os monstros.
 */

/** A condição como fonte de Vantagem, Desvantagem ou falha automática ("Envenenado"). */
export const conditionSource = (condition: Condition): SourceLabel => ({ kind: 'rule', id: `condition_${condition}`, name: CONDITION_NAME[condition] });

/** Condições que trazem outras junto: Paralisado, Petrificado, Atordoado e Inconsciente incapacitam; Inconsciente também derruba. */
const IMPLIED: Partial<Record<Condition, readonly Condition[]>> = {
  paralyzed: ['incapacitated'],
  petrified: ['incapacitated'],
  stunned: ['incapacitated'],
  unconscious: ['incapacitated', 'prone'],
};

/** As condições com as implícitas. */
export function effectiveConditions(conditions: Iterable<Condition>): Set<Condition> {
  const result = new Set<Condition>();
  for (const c of conditions) {
    result.add(c);
    for (const implied of IMPLIED[c] ?? []) result.add(implied);
  }
  return result;
}

/** Deslocamento 0 (Agarrado, Paralisado, Petrificado, Impedido, Inconsciente). */
export const SPEED_ZERO_CONDITIONS: readonly Condition[] = ['grappled', 'paralyzed', 'petrified', 'restrained', 'unconscious'];

/** Falham automaticamente em salvaguardas de FOR e DES. */
const AUTO_FAIL_STR_DEX: readonly Condition[] = ['paralyzed', 'petrified', 'stunned', 'unconscious'];

/** Ataques contra a criatura têm Vantagem. */
const ATTACKED_WITH_ADVANTAGE: readonly Condition[] = ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious'];

/** Acerto a até 5 ft é Acerto Crítico. */
const AUTO_CRITICAL_WITHIN_5: readonly Condition[] = ['paralyzed', 'unconscious'];

/** Distância em que o Caído e o crítico automático mudam ("within 5 feet"). */
export const CLOSE_RANGE_FT = 5;

export type ConditionRoll = { kind: 'attack' } | { kind: 'check' } | { kind: 'initiative' } | { kind: 'save'; ability?: Ability | undefined };

export interface ConditionRollEffects {
  advantage: SourceLabel[];
  disadvantage: SourceLabel[];
  /** Falha automática (a rolagem acontece, mas o resultado é falha). */
  autoFail: SourceLabel[];
  /** O que pode valer e depende do que o motor não sabe. */
  situational: { kind: 'advantage' | 'disadvantage'; source: SourceLabel; note: string }[];
}

const has = (conditions: ReadonlySet<Condition>, list: readonly Condition[]): Condition[] => list.filter((c) => conditions.has(c));

/** O que as condições da própria criatura fazem nesta rolagem. */
export function ownRollConditions(conditions: ReadonlySet<Condition>, roll: ConditionRoll): ConditionRollEffects {
  const out: ConditionRollEffects = { advantage: [], disadvantage: [], autoFail: [], situational: [] };
  const add = (list: SourceLabel[], ...cs: Condition[]): void => {
    for (const c of cs) if (conditions.has(c)) list.push(conditionSource(c));
  };
  const check = roll.kind === 'check' || roll.kind === 'initiative';
  if (roll.kind === 'attack') {
    add(out.disadvantage, 'blinded', 'poisoned', 'prone', 'restrained');
    add(out.advantage, 'invisible');
    if (conditions.has('frightened')) out.situational.push({ kind: 'disadvantage', source: conditionSource('frightened'), note: 'enquanto a fonte do medo estiver à vista' });
    if (conditions.has('grappled')) out.situational.push({ kind: 'disadvantage', source: conditionSource('grappled'), note: 'contra quem não é o agarrador' });
  }
  if (check) {
    add(out.disadvantage, 'poisoned');
    if (conditions.has('frightened')) out.situational.push({ kind: 'disadvantage', source: conditionSource('frightened'), note: 'enquanto a fonte do medo estiver à vista' });
  }
  if (roll.kind === 'initiative') {
    // "Surprised"/"Surprise" das condições: Incapacitado rola com Desvantagem, Invisível com Vantagem.
    add(out.disadvantage, 'incapacitated');
    add(out.advantage, 'invisible');
  }
  if (roll.kind === 'save' && (roll.ability === 'str' || roll.ability === 'dex')) {
    for (const c of has(conditions, AUTO_FAIL_STR_DEX)) out.autoFail.push(conditionSource(c));
  }
  if (roll.kind === 'save' && roll.ability === 'dex') add(out.disadvantage, 'restrained');
  return out;
}

export interface AttackedConditionEffects {
  advantage: SourceLabel[];
  disadvantage: SourceLabel[];
  /** O acerto vira Acerto Crítico (Paralisado, Inconsciente, a até 5 ft). */
  autoCritical: SourceLabel[];
  /** Sem a distância, o que depende dela fica como lembrete. */
  reminders: string[];
}

/**
 * O que as condições do alvo fazem num ataque contra ele. `distanceFt` é a
 * distância entre atacante e alvo; sem ela (atacante fora do mapa), Caído e
 * crítico automático viram lembrete.
 */
export function attackedConditions(conditions: ReadonlySet<Condition>, distanceFt: number | undefined): AttackedConditionEffects {
  const out: AttackedConditionEffects = { advantage: [], disadvantage: [], autoCritical: [], reminders: [] };
  for (const c of has(conditions, ATTACKED_WITH_ADVANTAGE)) out.advantage.push(conditionSource(c));
  if (conditions.has('invisible')) out.disadvantage.push(conditionSource('invisible'));
  const close = distanceFt === undefined ? undefined : distanceFt <= CLOSE_RANGE_FT;
  if (conditions.has('prone')) {
    if (close === undefined) out.reminders.push('Alvo Caído: Vantagem a até 5 ft, Desvantagem mais longe');
    else (close ? out.advantage : out.disadvantage).push(conditionSource('prone'));
  }
  for (const c of has(conditions, AUTO_CRITICAL_WITHIN_5)) {
    if (close === undefined) out.reminders.push(`Alvo ${CONDITION_NAME[c]}: acerto a até 5 ft é Acerto Crítico`);
    else if (close) out.autoCritical.push(conditionSource(c));
  }
  return out;
}

/** Petrificado: Resistência a todo dano e Imunidade a Envenenado, somadas às defesas da criatura. */
export function conditionDefenses(conditions: ReadonlySet<Condition>, defenses: Defenses): Defenses {
  if (!conditions.has('petrified')) return defenses;
  const source = conditionSource('petrified');
  const resisted = new Set<DamageType>(defenses.resistances.map((r) => r.damageType));
  return {
    ...defenses,
    resistances: [...defenses.resistances, ...DAMAGE_TYPES.filter((t) => !resisted.has(t)).map((damageType) => ({ damageType, sources: [source] }))],
    conditionImmunities: defenses.conditionImmunities.some((c) => c.condition === 'poisoned')
      ? defenses.conditionImmunities
      : [...defenses.conditionImmunities, { condition: 'poisoned', sources: [source] }],
  };
}

export interface CreatureD20 {
  input: D20RollInput;
  parts: Contribution[];
  advantage: string[];
  disadvantage: string[];
  reminders: string[];
}

/**
 * Teste d20 de um monstro (sem ficha): o bônus do bloco, a Exaustão (−2 por
 * nível) e as condições dele, mais a Vantagem/Desvantagem declarada.
 */
export function creatureD20(
  base: { label: string; modifier: number },
  state: { conditions: ReadonlySet<Condition>; exhaustion: number },
  roll: ConditionRoll,
  declared: { advantage?: boolean | undefined; disadvantage?: boolean | undefined } = {},
): CreatureD20 {
  const effects = ownRollConditions(state.conditions, roll);
  const parts: Contribution[] = [
    { label: base.label, value: base.modifier },
    ...(state.exhaustion > 0 ? [{ label: `Exaustão ${state.exhaustion}`, value: -EXHAUSTION_D20_PENALTY * state.exhaustion }] : []),
  ];
  const modifier = parts.reduce((sum, p) => sum + p.value, 0);
  const advantage = [...effects.advantage.map((s) => s.name), ...(declared.advantage ? ['Declarada na rolagem'] : [])];
  const disadvantage = [...effects.disadvantage.map((s) => s.name), ...(declared.disadvantage ? ['Declarada na rolagem'] : [])];
  const mode = advantage.length > 0 && disadvantage.length === 0 ? 'advantage' : disadvantage.length > 0 && advantage.length === 0 ? 'disadvantage' : 'normal';
  return {
    input: { modifier, mode, ...(effects.autoFail.length > 0 ? { autoFail: effects.autoFail } : {}) },
    parts,
    advantage,
    disadvantage,
    reminders: effects.situational.map((s) => `${s.kind === 'advantage' ? 'Vantagem' : 'Desvantagem'} possível: ${s.source.name} (${s.note})`),
  };
}
