import type { CreatureType, DamageType } from '../schemas/common';
import type { Effect } from '../schemas/effect';
import type { TriggerMoment } from '../schemas/effect';
import type { ConditionRoll } from './conditions';
import type { AttacksAgainst, Contribution, Defenses, SourceLabel } from './types';

/**
 * Efeitos de magia num monstro (nota 0062). O monstro não tem ficha: o bloco
 * publicado fica intacto, e os efeitos do catálogo entram por cima na CA, nas
 * defesas e nos Testes d20. O que o bloco não sabe interpretar (dano extra,
 * efeito condicional) é apontado para o mestre acompanhar.
 */

/** Um conjunto de efeitos com o nome que aparece no log ("Bane (Morg)"). */
export interface NamedEffects {
  name: string;
  effects: readonly Effect[];
}

interface Sourced {
  effect: Effect;
  source: SourceLabel;
}

/** O efeito vale no bloco sem mais contexto. */
function supported(effect: Effect): boolean {
  if (effect.when) return false;
  switch (effect.type) {
    case 'flat_bonus':
      return typeof effect.value === 'number' && (effect.target === 'ac' || effect.target === 'initiative' || effect.target.startsWith('save.') || effect.target.startsWith('attack.'));
    case 'advantage':
    case 'disadvantage':
    case 'd20_bonus':
    case 'resistance':
    case 'vulnerability':
    case 'immunity':
    case 'minimum_ac':
    case 'attacks_against':
    case 'reminder':
      return true;
    case 'target_damage':
      // A marca no alvo vale para quem conjurou; a distância dele não é do bloco.
      return effect.within === undefined;
    default:
      return false;
  }
}

/** Há efeitos que o bloco do monstro não aplica: o mestre acompanha. */
export const hasUnsupportedCreatureEffect = (effects: readonly Effect[]): boolean => effects.some((e) => !supported(e));

/** Só os efeitos que valem, com a fonte. */
const sourced = (list: readonly NamedEffects[]): Sourced[] =>
  list.flatMap(({ name, effects }) => effects.filter(supported).map((effect) => ({ effect, source: { kind: 'rule', id: 'spell_effect', name } })));

/** CA do bloco com os bônus e, por fim, o mínimo (Barkskin). */
export function creatureAc(base: number, list: readonly NamedEffects[]): number {
  let ac = base;
  let minimum = 0;
  for (const { effect } of sourced(list)) {
    if (effect.type === 'flat_bonus' && effect.target === 'ac' && typeof effect.value === 'number') ac += effect.value;
    else if (effect.type === 'minimum_ac') minimum = Math.max(minimum, effect.value);
  }
  return Math.max(ac, minimum);
}

/** Resistências, vulnerabilidades e imunidades dos efeitos, somadas às do bloco. */
export function withEffectDefenses(defenses: Defenses, list: readonly NamedEffects[]): Defenses {
  const out: Defenses = {
    ...defenses,
    resistances: [...defenses.resistances],
    vulnerabilities: [...defenses.vulnerabilities],
    damageImmunities: [...defenses.damageImmunities],
    conditionImmunities: [...defenses.conditionImmunities],
  };
  const add = (to: { damageType: DamageType; sources: SourceLabel[] }[], damageType: DamageType, source: SourceLabel): void => {
    if (!to.some((d) => d.damageType === damageType)) to.push({ damageType, sources: [source] });
  };
  for (const { effect, source } of sourced(list)) {
    if (effect.type === 'resistance') add(out.resistances, effect.damageType, source);
    else if (effect.type === 'vulnerability') add(out.vulnerabilities, effect.damageType, source);
    else if (effect.type === 'immunity') {
      const { condition } = effect;
      if (effect.damageType) add(out.damageImmunities, effect.damageType, source);
      else if (condition && !out.conditionImmunities.some((c) => c.condition === condition)) out.conditionImmunities.push({ condition, sources: [source] });
    }
  }
  return out;
}

export interface CreatureRollEffects {
  parts: Contribution[];
  advantage: SourceLabel[];
  disadvantage: SourceLabel[];
  bonusDice: { dice: string; subtract: boolean; source: SourceLabel }[];
}

/** Os alvos do catálogo que esta rolagem consulta (docs/effects-spec.md, seção 4). */
function rollTargets(roll: ConditionRoll): string[] {
  switch (roll.kind) {
    case 'attack':
      return ['d20_test', 'attack.all', 'attack.weapon', ...(roll.attackKind ? [`attack.${roll.attackKind}`] : [])];
    case 'save':
      return ['d20_test', 'save.all', ...(roll.ability ? [`save.${roll.ability}`] : [])];
    case 'initiative':
      // Iniciativa é um teste de Destreza.
      return ['d20_test', 'check.all', 'check.dex', 'initiative'];
    case 'check':
      return ['d20_test', 'check.all'];
  }
}

/** O que os efeitos fazem num Teste d20 do monstro. */
export function creatureRollEffects(list: readonly NamedEffects[], roll: ConditionRoll): CreatureRollEffects {
  const targets = rollTargets(roll);
  const out: CreatureRollEffects = { parts: [], advantage: [], disadvantage: [], bonusDice: [] };
  for (const { effect, source } of sourced(list)) {
    if (!('target' in effect) || !targets.includes(effect.target)) continue;
    if (effect.type === 'flat_bonus' && typeof effect.value === 'number') out.parts.push({ label: source.name, value: effect.value, source });
    else if (effect.type === 'advantage') out.advantage.push(source);
    else if (effect.type === 'disadvantage') out.disadvantage.push(source);
    else if (effect.type === 'd20_bonus') out.bonusDice.push({ dice: effect.dice, subtract: effect.subtract === true, source });
  }
  return out;
}

/** `attacks_against` dos efeitos de um monstro. */
export function creatureAttacksAgainst(list: readonly NamedEffects[]): AttacksAgainst[] {
  return sourced(list).flatMap(({ effect, source }) =>
    effect.type === 'attacks_against' ? [{ mode: effect.mode, ...(effect.from ? { from: effect.from } : {}), ...(effect.note !== undefined ? { note: effect.note } : {}), source }] : [],
  );
}

/** Lembretes dos efeitos de um monstro, por momento do combate. */
export function creatureReminders(list: readonly NamedEffects[], on: TriggerMoment): { source: string; text: string }[] {
  return sourced(list).flatMap(({ effect, source }) => (effect.type === 'reminder' && effect.on === on ? [{ source: source.name, text: effect.note }] : []));
}

/**
 * O que os efeitos do alvo fazem num ataque contra ele (Blur, Faerie Fire).
 * Restrito a tipos de criatura (Protection from Evil and Good), precisa do
 * tipo do atacante; sem ele, vira lembrete. `note` é a ressalva do texto, que
 * segue como lembrete junto do efeito.
 */
export function attackedByEffects(list: readonly AttacksAgainst[], attackerType: CreatureType | undefined): { advantage: string[]; disadvantage: string[]; reminders: string[] } {
  const out = { advantage: [] as string[], disadvantage: [] as string[], reminders: [] as string[] };
  for (const { mode, from, note, source } of list) {
    if (from && attackerType === undefined) {
      out.reminders.push(`${mode === 'advantage' ? 'Vantagem' : 'Desvantagem'} possível: ${source.name} (depende do tipo do atacante)`);
      continue;
    }
    if (from && attackerType !== undefined && !from.includes(attackerType)) continue;
    out[mode].push(source.name);
    if (note !== undefined) out.reminders.push(`${source.name}: ${note}`);
  }
  return out;
}
