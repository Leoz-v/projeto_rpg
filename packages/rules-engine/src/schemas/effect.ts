import { z } from 'zod';
import {
  AbilitySchema,
  AttackKindSchema,
  ConditionSchema,
  DamageTypeSchema,
  DiceSchema,
  FeetSchema,
  IdSchema,
  RestSchema,
  SenseSchema,
  SkillSchema,
  WeaponPropertySchema,
} from './common';
import { PredicateSchema } from './predicate';

/**
 * Catálogo fechado de efeitos (docs/effects-spec.md). Para criar um tipo novo,
 * atualize primeiro o documento, depois este arquivo, o interpretador e os testes.
 */

/** Campos comuns a todo efeito (seção 1). */
const common = {
  when: PredicateSchema.optional(),
  note: z.string().min(1).optional(),
};

const Ability = AbilitySchema;
const AttackKind = AttackKindSchema;

// --- flat_bonus (3.1) -------------------------------------------------------

export const FlatBonusTargetSchema = z.union([
  z.enum(['ac', 'initiative', 'hp_max', 'speed.walk', 'speed.fly', 'speed.swim', 'speed.climb', 'speed.burrow', 'save.all', 'spell_save_dc', 'attunement_slots', 'attack.weapon', 'damage.weapon']),
  z.templateLiteral(['attack.', AttackKind]),
  z.templateLiteral(['damage.', AttackKind]),
  z.templateLiteral(['save.', Ability]),
  z.templateLiteral(['check.', Ability]),
  z.templateLiteral(['skill.', SkillSchema]),
  z.templateLiteral(['passive.', SkillSchema]),
]);
export type FlatBonusTarget = z.infer<typeof FlatBonusTargetSchema>;

export const BonusValueSchema = z.union([
  z.int(),
  /** Modificador do atributo; `min` é o piso ("mínimo +1"). */
  z.strictObject({ ability: Ability, min: z.int().optional() }),
  z.strictObject({ proficiency: z.int().positive() }),
  z.strictObject({ perLevel: z.int() }),
]);
export type BonusValue = z.infer<typeof BonusValueSchema>;

const FlatBonusSchema = z.strictObject({
  type: z.literal('flat_bonus'),
  target: FlatBonusTargetSchema,
  value: BonusValueSchema,
  ...common,
});

// --- set_base_ac (3.2) ------------------------------------------------------

const SetBaseAcSchema = z.strictObject({
  type: z.literal('set_base_ac'),
  base: z.int().nonnegative(),
  abilities: z.array(Ability),
  dexCap: z.int().nonnegative().optional(),
  ...common,
});

// --- advantage / disadvantage (3.3) -----------------------------------------

export const RollTargetSchema = z.union([
  z.enum(['attack.all', 'save.all', 'initiative']),
  z.templateLiteral(['attack.', AttackKind]),
  z.templateLiteral(['save.', Ability]),
  z.templateLiteral(['check.', Ability]),
  z.templateLiteral(['skill.', SkillSchema]),
]);
export type RollTarget = z.infer<typeof RollTargetSchema>;

const AdvantageSchema = z.strictObject({ type: z.literal('advantage'), target: RollTargetSchema, ...common });
const DisadvantageSchema = z.strictObject({ type: z.literal('disadvantage'), target: RollTargetSchema, ...common });

// --- resistance / vulnerability / immunity (3.4) ----------------------------

const ResistanceSchema = z.strictObject({ type: z.literal('resistance'), damageType: DamageTypeSchema, ...common });
const VulnerabilitySchema = z.strictObject({ type: z.literal('vulnerability'), damageType: DamageTypeSchema, ...common });
/** `immunity` aceita `damageType` ou `condition`, exatamente um. */
const ImmunitySchema = z
  .strictObject({
    type: z.literal('immunity'),
    damageType: DamageTypeSchema.optional(),
    condition: ConditionSchema.optional(),
    ...common,
  })
  .refine((e) => (e.damageType === undefined) !== (e.condition === undefined), {
    message: 'immunity exige exatamente um entre damageType e condition',
  });

// --- grant_proficiency (3.5) ------------------------------------------------

const ExpertiseLevelSchema = z.enum(['proficient', 'expertise']);
const grantProficiency = { type: z.literal('grant_proficiency'), ...common };

const GrantProficiencySchema = z.discriminatedUnion('category', [
  z.strictObject({ ...grantProficiency, category: z.literal('skill'), id: SkillSchema, level: ExpertiseLevelSchema.optional() }),
  z.strictObject({ ...grantProficiency, category: z.literal('tool'), id: IdSchema, level: ExpertiseLevelSchema.optional() }),
  z.strictObject({ ...grantProficiency, category: z.literal('save'), id: Ability }),
  /** `self`: treinado com o próprio item que carrega o efeito (Elven Chain), não com a categoria. */
  z.strictObject({ ...grantProficiency, category: z.literal('armor'), id: z.enum(['light', 'medium', 'heavy', 'shield', 'self']) }),
  z
    .strictObject({
      ...grantProficiency,
      category: z.literal('weapon'),
      id: IdSchema,
      /** Só armas da categoria com alguma destas propriedades (ex.: marciais Leves, para o Monge). */
      properties: z.array(WeaponPropertySchema).min(1).optional(),
    })
    .refine((e) => e.properties === undefined || e.id === 'simple' || e.id === 'martial', {
      message: 'properties só vale para as categorias simple e martial',
    }),
  z.strictObject({ ...grantProficiency, category: z.literal('language'), id: IdSchema }),
]);

// --- grant_spell (3.6) ------------------------------------------------------

export const SpellUsesSchema = z.union([
  z.literal('at_will'),
  z.literal('slot'),
  /** `slots: true`: também pode ser conjurada com espaços de magia. */
  z.strictObject({
    per: RestSchema,
    /** Inteiro ou múltiplo do bônus de proficiência. */
    count: z.union([
      z.int().positive(),
      z.strictObject({ proficiency: z.int().positive() }),
      /** Tabela pelo nível na escala da fonte (índice 0 = nível 1). */
      z.strictObject({ byLevel: z.array(z.int().nonnegative()).length(20) }),
    ]),
    slots: z.literal(true).optional(),
  }),
]);

/** Atributo fixo ou o escolhido numa escolha `ability` da mesma fonte. */
export const AbilityRefSchema = z.union([Ability, z.strictObject({ choice: IdSchema })]);
export type AbilityRef = z.infer<typeof AbilityRefSchema>;

const GrantSpellSchema = z.strictObject({
  type: z.literal('grant_spell'),
  spellId: IdSchema,
  ability: AbilityRefSchema,
  uses: SpellUsesSchema,
  ...common,
});

// --- grant_sense (3.7) ------------------------------------------------------

const GrantSenseSchema = z.strictObject({
  type: z.literal('grant_sense'),
  sense: SenseSchema,
  range: FeetSchema.positive(),
  /** Soma ao alcance dado por outras fontes (ou concede, se não houver). */
  extend: z.literal(true).optional(),
  ...common,
});

// --- damage_reduction (3.14) ------------------------------------------------

const DamageReductionSchema = z.strictObject({
  type: z.literal('damage_reduction'),
  damageType: DamageTypeSchema,
  /** Dados ou inteiro, rolados a cada dano recebido do tipo. */
  amount: DiceSchema,
  ...common,
});

// --- set_minimum_score (3.8) ------------------------------------------------

const SetMinimumScoreSchema = z.strictObject({
  type: z.literal('set_minimum_score'),
  ability: Ability,
  value: z.int().min(1).max(30),
  ...common,
});

// --- weapon_mastery (3.9) ---------------------------------------------------

// --- half_proficiency (3.11), grant_speed (3.12), attack_ability (3.13) -----

const HalfProficiencySchema = z.strictObject({
  type: z.literal('half_proficiency'),
  scope: z.literal('unproficient_skills'),
  ...common,
});

export const SpecialSpeedSchema = z.enum(['fly', 'swim', 'climb', 'burrow']);

const GrantSpeedSchema = z.strictObject({
  type: z.literal('grant_speed'),
  speed: SpecialSpeedSchema,
  /** Pés, ou `walk` = igual ao deslocamento a pé. */
  value: z.union([FeetSchema.positive(), z.literal('walk')]),
  ...common,
});

const AttackAbilitySchema = z.strictObject({
  type: z.literal('attack_ability'),
  ability: Ability,
  ...common,
});

const WeaponMasteryEffectSchema = z.strictObject({
  type: z.literal('weapon_mastery'),
  weaponId: IdSchema,
  ...common,
});

// --- condition (3.10) -------------------------------------------------------

const ConditionEffectSchema = z.discriminatedUnion('condition', [
  z.strictObject({ type: z.literal('condition'), condition: z.literal('exhaustion'), level: z.int().min(1).max(6), ...common }),
  z.strictObject({ type: z.literal('condition'), condition: ConditionSchema.exclude(['exhaustion']), ...common }),
]);

// --- União -------------------------------------------------------------------

export const EffectSchema = z.discriminatedUnion('type', [
  FlatBonusSchema,
  SetBaseAcSchema,
  AdvantageSchema,
  DisadvantageSchema,
  ResistanceSchema,
  VulnerabilitySchema,
  ImmunitySchema,
  GrantProficiencySchema,
  GrantSpellSchema,
  GrantSenseSchema,
  DamageReductionSchema,
  SetMinimumScoreSchema,
  WeaponMasteryEffectSchema,
  ConditionEffectSchema,
  HalfProficiencySchema,
  GrantSpeedSchema,
  AttackAbilitySchema,
]);
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = Effect['type'];
