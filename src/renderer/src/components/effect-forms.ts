import {
  ABILITIES,
  type Ability,
  CONDITIONS,
  type Condition,
  DAMAGE_TYPES,
  type DamageType,
  type Effect,
  EffectSchema,
  type Sense,
  SKILLS,
  type Skill,
} from 'rules-engine/schemas';
import { ABILITY_LABEL, CONDITION_LABEL, DAMAGE_LABEL, humanizeId, SENSE_LABEL, signed, SKILL_LABEL } from './sheet-labels';

/**
 * Formulário dos ajustes do mestre: os tipos de efeito mais comuns do catálogo
 * (docs/effects-spec.md) com campos guiados, e o JSON de qualquer efeito do
 * catálogo para o resto. Tudo passa pelo `EffectSchema` do motor antes de ir
 * ao Host, que valida de novo.
 */

export type EffectKind =
  | 'bonus'
  | 'advantage'
  | 'disadvantage'
  | 'resistance'
  | 'vulnerability'
  | 'immunity_damage'
  | 'immunity_condition'
  | 'proficiency_skill'
  | 'proficiency_save'
  | 'sense'
  | 'ability_increase'
  | 'condition'
  | 'extra_damage'
  | 'json';

export const EFFECT_KINDS: readonly { value: EffectKind; label: string }[] = [
  { value: 'bonus', label: 'Bônus fixo' },
  { value: 'advantage', label: 'Vantagem' },
  { value: 'disadvantage', label: 'Desvantagem' },
  { value: 'resistance', label: 'Resistência a dano' },
  { value: 'vulnerability', label: 'Vulnerabilidade a dano' },
  { value: 'immunity_damage', label: 'Imunidade a dano' },
  { value: 'immunity_condition', label: 'Imunidade a condição' },
  { value: 'proficiency_skill', label: 'Proficiência em perícia' },
  { value: 'proficiency_save', label: 'Proficiência em salvaguarda' },
  { value: 'sense', label: 'Sentido' },
  { value: 'ability_increase', label: 'Aumento de atributo' },
  { value: 'condition', label: 'Condição' },
  { value: 'extra_damage', label: 'Dano extra nos ataques' },
  { value: 'json', label: 'Outro efeito do catálogo (JSON)' },
];

export interface EffectForm {
  kind: EffectKind;
  /** Alvo de bônus ou de vantagem/desvantagem. */
  target: string;
  value: number;
  damageType: DamageType;
  condition: Condition;
  skill: Skill;
  expertise: boolean;
  ability: Ability;
  sense: Sense;
  range: number;
  max: number;
  exhaustion: number;
  dice: string;
  json: string;
}

export const DEFAULT_FORM: EffectForm = {
  kind: 'bonus',
  target: 'ac',
  value: 1,
  damageType: 'fire',
  condition: 'poisoned',
  skill: 'perception',
  expertise: false,
  ability: 'str',
  sense: 'darkvision',
  range: 60,
  max: 20,
  exhaustion: 1,
  dice: '1d6',
  json: '{ "type": "flat_bonus", "target": "ac", "value": 1 }',
};

const abilityTargets = (prefix: string, label: (a: string) => string) => ABILITIES.map((a) => ({ value: `${prefix}.${a}`, label: label(ABILITY_LABEL[a].long) }));
const skillTargets = (prefix: string, label: (s: string) => string) => SKILLS.map((s) => ({ value: `${prefix}.${s}`, label: label(SKILL_LABEL[s]) }));

/** Alvos de `flat_bonus` oferecidos no formulário. */
export const BONUS_TARGETS: readonly { value: string; label: string }[] = [
  { value: 'ac', label: 'CA' },
  { value: 'hp_max', label: 'PV máximos' },
  { value: 'initiative', label: 'Iniciativa' },
  { value: 'speed.walk', label: 'Deslocamento (ft)' },
  { value: 'save.all', label: 'Todas as salvaguardas' },
  { value: 'attack.weapon', label: 'Ataques com arma' },
  { value: 'damage.weapon', label: 'Dano com arma' },
  { value: 'attack.spell', label: 'Ataques mágicos' },
  { value: 'spell_save_dc', label: 'CD de magia' },
  { value: 'attunement_slots', label: 'Itens sintonizados (limite)' },
  ...abilityTargets('save', (a) => `Salvaguarda de ${a}`),
  ...abilityTargets('check', (a) => `Testes de ${a}`),
  ...skillTargets('skill', (s) => `Perícia: ${s}`),
];

/** Alvos de vantagem e desvantagem. */
export const ROLL_TARGETS: readonly { value: string; label: string }[] = [
  { value: 'attack.all', label: 'Todos os ataques' },
  { value: 'save.all', label: 'Todas as salvaguardas' },
  { value: 'initiative', label: 'Iniciativa' },
  { value: 'death_save', label: 'Salvaguarda contra a Morte' },
  { value: 'attack.melee', label: 'Ataques corpo a corpo' },
  { value: 'attack.ranged', label: 'Ataques à distância' },
  ...abilityTargets('save', (a) => `Salvaguarda de ${a}`),
  ...abilityTargets('check', (a) => `Testes de ${a}`),
  ...skillTargets('skill', (s) => `Perícia: ${s}`),
];

export const DAMAGE_OPTIONS = DAMAGE_TYPES.map((d) => ({ value: d, label: DAMAGE_LABEL[d] }));
export const CONDITION_OPTIONS = CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABEL[c] }));

/** Efeito montado do formulário, já validado pelo catálogo, ou a mensagem do problema. */
export function buildEffect(form: EffectForm): { ok: true; effect: Effect } | { ok: false; message: string } {
  let raw: unknown;
  switch (form.kind) {
    case 'bonus':
      raw = { type: 'flat_bonus', target: form.target, value: form.value };
      break;
    case 'advantage':
    case 'disadvantage':
      raw = { type: form.kind, target: form.target };
      break;
    case 'resistance':
    case 'vulnerability':
      raw = { type: form.kind, damageType: form.damageType };
      break;
    case 'immunity_damage':
      raw = { type: 'immunity', damageType: form.damageType };
      break;
    case 'immunity_condition':
      raw = { type: 'immunity', condition: form.condition };
      break;
    case 'proficiency_skill':
      raw = { type: 'grant_proficiency', category: 'skill', id: form.skill, ...(form.expertise ? { level: 'expertise' } : {}) };
      break;
    case 'proficiency_save':
      raw = { type: 'grant_proficiency', category: 'save', id: form.ability };
      break;
    case 'sense':
      raw = { type: 'grant_sense', sense: form.sense, range: form.range };
      break;
    case 'ability_increase':
      raw = { type: 'ability_increase', ability: form.ability, value: form.value, max: form.max };
      break;
    case 'condition':
      raw = form.condition === 'exhaustion' ? { type: 'condition', condition: 'exhaustion', level: form.exhaustion } : { type: 'condition', condition: form.condition };
      break;
    case 'extra_damage':
      raw = { type: 'extra_damage', dice: form.dice.trim(), damageType: form.damageType };
      break;
    case 'json':
      try {
        raw = JSON.parse(form.json);
      } catch {
        return { ok: false, message: 'JSON inválido' };
      }
      break;
  }
  const parsed = EffectSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: `Efeito inválido: ${parsed.error.issues[0]?.message ?? 'confira os campos'}` };
  return { ok: true, effect: parsed.data };
}

const targetLabel = (target: string, list: readonly { value: string; label: string }[]): string => list.find((t) => t.value === target)?.label ?? target;

/** Resumo do efeito em pt-BR, para a lista de ajustes. */
export function describeEffect(effect: Effect): string {
  const when = effect.note ? ` (${effect.note})` : '';
  switch (effect.type) {
    case 'flat_bonus':
      return `${typeof effect.value === 'number' ? signed(effect.value) : 'Bônus'} em ${targetLabel(effect.target, BONUS_TARGETS)}${when}`;
    case 'advantage':
      return `Vantagem em ${targetLabel(effect.target, ROLL_TARGETS)}${when}`;
    case 'disadvantage':
      return `Desvantagem em ${targetLabel(effect.target, ROLL_TARGETS)}${when}`;
    case 'resistance':
      return `Resistência a ${DAMAGE_LABEL[effect.damageType]}${when}`;
    case 'vulnerability':
      return `Vulnerabilidade a ${DAMAGE_LABEL[effect.damageType]}${when}`;
    case 'immunity':
      return `Imunidade a ${effect.damageType ? DAMAGE_LABEL[effect.damageType] : effect.condition ? CONDITION_LABEL[effect.condition] : '?'}${when}`;
    case 'grant_proficiency':
      if (effect.category === 'skill') return `${effect.level === 'expertise' ? 'Especialização' : 'Proficiência'} em ${SKILL_LABEL[effect.id]}${when}`;
      if (effect.category === 'save') return `Proficiência na salvaguarda de ${ABILITY_LABEL[effect.id].long}${when}`;
      return `Proficiência: ${humanizeId(effect.id)}${when}`;
    case 'grant_sense':
      return `${SENSE_LABEL[effect.sense]} ${effect.range} ft${when}`;
    case 'ability_increase':
      return `${ABILITY_LABEL[effect.ability].long} +${effect.value} (máx. ${effect.max})${when}`;
    case 'condition':
      return `${CONDITION_LABEL[effect.condition]}${effect.condition === 'exhaustion' ? ` nível ${effect.level}` : ''}${when}`;
    case 'extra_damage':
      return `+${effect.dice}${effect.damageType ? ` ${DAMAGE_LABEL[effect.damageType].toLowerCase()}` : ''} nos ataques${when}`;
    default:
      return `${humanizeId(effect.type)}: ${JSON.stringify(effect)}`;
  }
}
