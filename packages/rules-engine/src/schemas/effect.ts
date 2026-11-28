import { z } from 'zod';
import {
  AbilitySchema,
  AttackKindSchema,
  ConditionSchema,
  CreatureTypeSchema,
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
  z.enum(['ac', 'initiative', 'hp_max', 'speed.walk', 'speed.fly', 'speed.swim', 'speed.climb', 'speed.burrow', 'save.all', 'spell_save_dc', 'attunement_slots', 'attack.weapon', 'damage.weapon', 'proficiency_bonus']),
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
  z.enum(['attack.all', 'save.all', 'initiative', 'death_save']),
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

const GrantSenseSchema = z
  .strictObject({
    type: z.literal('grant_sense'),
    sense: SenseSchema,
    range: FeetSchema.positive(),
    /** Soma ao alcance dado por outras fontes (ou concede, se não houver). */
    extend: z.literal(true).optional(),
    /** Enxerga normalmente na escuridão mágica até o alcance concedido (só `darkvision`). */
    magicalDarkness: z.literal(true).optional(),
    ...common,
  })
  .refine((e) => e.magicalDarkness === undefined || e.sense === 'darkvision', {
    message: 'magicalDarkness só vale para darkvision',
  });

// --- vision_range (3.32) ----------------------------------------------------

const VisionRangeSchema = z.strictObject({
  type: z.literal('vision_range'),
  range: z.union([FeetSchema, z.literal('unlimited')]),
  mode: z.enum(['set', 'cap']).optional(),
  ...common,
});

// --- ability_increase (3.8.1) ----------------------------------------------

const AbilityIncreaseSchema = z.strictObject({
  type: z.literal('ability_increase'),
  ability: Ability,
  value: z.int().positive(),
  /** Teto publicado pela fonte ("to a maximum of 20"). */
  max: z.int().min(1).max(30),
  ...common,
});

// --- extra_damage (3.15) / crit_range (3.16) --------------------------------

const ExtraDamageSchema = z.strictObject({
  type: z.literal('extra_damage'),
  dice: DiceSchema,
  /** Ausente: o mesmo tipo do dano da arma. */
  damageType: DamageTypeSchema.optional(),
  /** `weapon`: só nos ataques com a arma que carrega o efeito (itens). */
  scope: z.literal('weapon').optional(),
  ...common,
});

/**
 * Dano extra do ataque com arma que depende do alvo, do d20 ou da escolha de
 * quem ataca (3.29, nota 0077): Sneak Attack, Colossus Slayer, Dragon Slayer.
 */
const AttackRiderSchema = z.strictObject({
  type: z.literal('attack_rider'),
  /** O de mesmo id que vem depois substitui (Improved Divine Strike). */
  id: IdSchema,
  name: z.string().min(1).max(100),
  /** Dados, ou uma tabela pelo nível na escala da fonte (índice 0 = nível 1). */
  dice: z.union([DiceSchema, z.strictObject({ byLevel: z.array(DiceSchema).length(20) })]),
  /** Um tipo, ou os tipos à escolha; ausente, o da arma. */
  damageType: z.union([DamageTypeSchema, z.array(DamageTypeSchema).min(2)]).optional(),
  mode: z.enum(['auto', 'choice']),
  scope: z.literal('weapon').optional(),
  oncePerTurn: z.literal(true).optional(),
  ability: Ability.optional(),
  onlyTypes: z.array(CreatureTypeSchema).min(1).optional(),
  exceptTypes: z.array(CreatureTypeSchema).min(1).optional(),
  injured: z.literal(true).optional(),
  natural20: z.literal(true).optional(),
  sneak: z.literal(true).optional(),
  /** O que gasta no acerto: um uso do recurso, o espaço de Pacto (`perSlotLevel` por círculo) ou cargas da arma. */
  cost: z
    .union([
      z.strictObject({ resource: IdSchema }),
      z.strictObject({ pactSlot: z.literal(true), perSlotLevel: DiceSchema }),
      z.strictObject({ charges: z.int().positive() }),
    ])
    .optional(),
  ...common,
});

const CritRangeSchema = z.strictObject({
  type: z.literal('crit_range'),
  /** Crítico com este valor ou mais no d20. */
  min: z.int().min(2).max(20),
  ...common,
});

// --- d20_rule (3.17) / damage_die_minimum (3.18) ---------------------------

/** Alvos de `advantage` e mais: todo Teste d20, todo teste de atributo, testes com proficiência. */
export const D20RuleTargetSchema = z.union([RollTargetSchema, z.enum(['d20_test', 'check.all', 'check.proficient'])]);
export type D20RuleTarget = z.infer<typeof D20RuleTargetSchema>;

const D20Face = z.int().min(1).max(20);
const d20Rule = { type: z.literal('d20_rule'), target: D20RuleTargetSchema, ...common };

const D20RuleSchema = z.discriminatedUnion('rule', [
  /** Rola de novo cada d20 que mostrar `on` (Halfling Luck). */
  z.strictObject({ ...d20Rule, rule: z.literal('reroll'), on: D20Face }),
  /** O d20 mantido vale pelo menos `value` (Reliable Talent). */
  z.strictObject({ ...d20Rule, rule: z.literal('minimum_die'), value: D20Face }),
  /** O total vale pelo menos `value`: inteiro ou o valor do atributo (Indomitable Might). */
  z.strictObject({ ...d20Rule, rule: z.literal('minimum_total'), value: z.union([z.int(), z.strictObject({ score: Ability })]) }),
  /** Sucesso automático (Greater Magic Resistance). */
  z.strictObject({ ...d20Rule, rule: z.literal('auto_success') }),
  /** Um d20 de `min` ou mais vale como 20 natural (Survivor). */
  z.strictObject({ ...d20Rule, rule: z.literal('count_as_20'), min: z.int().min(2).max(20) }),
]);

// --- d20_bonus (3.25) --------------------------------------------------------

/**
 * Dado somado (ou subtraído, `subtract`) ao Teste d20, rolado a cada rolagem
 * (Bless: "adds 1d4 to the attack roll or save"; Guidance, numa perícia).
 */
const D20BonusSchema = z.strictObject({
  type: z.literal('d20_bonus'),
  dice: DiceSchema,
  target: D20RuleTargetSchema,
  subtract: z.literal(true).optional(),
  ...common,
});

// --- attacks_against (3.26) / minimum_ac (3.27) --------------------------------

/** Ataques contra a criatura têm Vantagem ou Desvantagem (Faerie Fire, Blur). */
const AttacksAgainstSchema = z.strictObject({
  type: z.literal('attacks_against'),
  mode: z.enum(['advantage', 'disadvantage']),
  /** Só de atacantes destes tipos (Protection from Evil and Good). */
  from: z.array(CreatureTypeSchema).min(1).optional(),
  ...common,
});

/**
 * Dano extra de quem conjurou quando acerta com uma jogada de ataque (3.28).
 * Sem `within`, o efeito fica no alvo marcado (Hex, Hunter's Mark); com ele,
 * fica em quem conjurou e vale contra alvos até essa distância.
 */
const TargetDamageSchema = z.strictObject({
  type: z.literal('target_damage'),
  dice: DiceSchema,
  damageType: DamageTypeSchema,
  within: FeetSchema.positive().optional(),
  ...common,
});

/** CA mínima, depois de fórmulas e bônus (Barkskin: 17). */
const MinimumAcSchema = z.strictObject({
  type: z.literal('minimum_ac'),
  value: z.int().min(1).max(30),
  ...common,
});

const DamageDieMinimumSchema = z.strictObject({
  type: z.literal('damage_die_minimum'),
  /** Cada dado de dano abaixo disto vale isto (Great Weapon Fighting: 3). */
  min: z.int().min(2),
  ...common,
});

// --- minimum_speed (3.19) / base_override (3.20) ---------------------------

const MinimumSpeedSchema = z.strictObject({
  type: z.literal('minimum_speed'),
  /** Deslocamento a pé mínimo, em pés (Boots of Striding and Springing: 30). */
  value: FeetSchema.positive(),
  /** A armadura com FOR não atendida não reduz o deslocamento. */
  ignoreArmorPenalty: z.literal(true).optional(),
  ...common,
});

/** Altera o item base da mesma entrada do inventário (Mithral Armor, Sun Blade). */
const BaseOverrideSchema = z
  .strictObject({
    type: z.literal('base_override'),
    removeStrength: z.literal(true).optional(),
    removeStealthDisadvantage: z.literal(true).optional(),
    addProperties: z.array(WeaponPropertySchema).min(1).optional(),
    damageType: DamageTypeSchema.optional(),
    /** Troca o dado de dano, também com as duas mãos (Shillelagh). */
    damageDice: DiceSchema.optional(),
    /** Proficiente se tiver proficiência com alguma destas armas. */
    proficiencyWith: z.array(IdSchema).min(1).optional(),
    ...common,
  })
  .refine(
    (e) =>
      e.removeStrength !== undefined ||
      e.removeStealthDisadvantage !== undefined ||
      e.addProperties !== undefined ||
      e.damageType !== undefined ||
      e.damageDice !== undefined ||
      e.proficiencyWith !== undefined,
    { message: 'base_override exige pelo menos um campo' },
  );

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
  /** Só na arma que carrega o efeito (Shillelagh). */
  scope: z.literal('weapon').optional(),
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

// --- reminder (3.21), turn_start_heal (3.22) --------------------------------

/** Momento do combate em que o Host publica um lembrete (nota 0043). */
export const TriggerMomentSchema = z.enum(['initiative', 'turn_start', 'turn_end']);
export type TriggerMoment = z.infer<typeof TriggerMomentSchema>;

const ReminderSchema = z.strictObject({
  type: z.literal('reminder'),
  on: TriggerMomentSchema,
  ...common,
  /** O texto do lembrete (pt-BR): obrigatório neste tipo. */
  note: z.string().min(1),
});

const TurnStartHealSchema = z.strictObject({
  type: z.literal('turn_start_heal'),
  value: z.int().min(0).max(100),
  /** Soma o modificador do atributo. */
  ability: Ability.optional(),
  /** Só Sangrando (metade dos PV ou menos) e com pelo menos 1 PV. */
  bloodiedOnly: z.boolean(),
  ...common,
});

// --- resource (3.24) ---------------------------------------------------------

/** Como os descansos devolvem os usos: só o longo, o curto também (todos), ou o curto 1 e o longo todos. */
export const ResourceRechargeSchema = z.enum(['long_rest', 'short_rest', 'short_rest_one']);
export type ResourceRecharge = z.infer<typeof ResourceRechargeSchema>;

/** Recurso de uso limitado que os descansos devolvem (Rage, Bardic Inspiration, Lay On Hands; nota 0052). */
const ResourceSchema = z.strictObject({
  type: z.literal('resource'),
  id: IdSchema,
  name: z.string().min(1).max(100),
  /** Um valor (3.1) ou uma tabela pelo nível na escala da fonte (índice 0 = nível 1). */
  max: z.union([BonusValueSchema, z.strictObject({ byLevel: z.array(z.int().nonnegative()).length(20) })]),
  recharge: ResourceRechargeSchema,
  ...common,
});

// --- keep_concentration (3.23) -----------------------------------------------

/** Dano não quebra a Concentração nesta magia (Relentless Hunter; nota 0045). */
const KeepConcentrationSchema = z.strictObject({
  type: z.literal('keep_concentration'),
  spellId: IdSchema,
  ...common,
});

// --- União -------------------------------------------------------------------

/** Todos os efeitos, menos os de usar características (que contêm efeitos). */
export const BaseEffectSchema = z.discriminatedUnion('type', [
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
  ExtraDamageSchema,
  AttackRiderSchema,
  CritRangeSchema,
  D20RuleSchema,
  D20BonusSchema,
  AttacksAgainstSchema,
  MinimumAcSchema,
  TargetDamageSchema,
  DamageDieMinimumSchema,
  MinimumSpeedSchema,
  BaseOverrideSchema,
  AbilityIncreaseSchema,
  SetMinimumScoreSchema,
  WeaponMasteryEffectSchema,
  ConditionEffectSchema,
  HalfProficiencySchema,
  GrantSpeedSchema,
  AttackAbilitySchema,
  ReminderSchema,
  TurnStartHealSchema,
  KeepConcentrationSchema,
  ResourceSchema,
  VisionRangeSchema,
]);
export type BaseEffect = z.infer<typeof BaseEffectSchema>;

// --- feature_use (3.30), feature_use_part (3.31) -----------------------------

const LevelDiceSchema = z.union([DiceSchema, z.strictObject({ byLevel: z.array(DiceSchema).length(20) })]);
const UntilTurnSchema = z.enum(['user_turn_start', 'user_turn_end']).optional();

export const FeatureUsePartSchema = z.discriminatedUnion('kind', [
  /** Cura (ou PV temporários): dados e bônus somados, com o mínimo. */
  z.strictObject({ kind: z.literal('heal'), dice: LevelDiceSchema.optional(), bonus: z.array(BonusValueSchema).default([]), minimum: z.int().optional(), temporary: z.literal(true).optional() }),
  /** Cura da reserva, na quantidade que quem usa escolher (Lay On Hands). */
  z.strictObject({ kind: z.literal('pool_heal') }),
  /** Condições que a reserva termina, com o custo de cada uma. */
  z.strictObject({ kind: z.literal('pool_restore'), cost: z.int().positive(), conditions: z.array(ConditionSchema.exclude(['exhaustion'])).min(1) }),
  /** Condições que terminam. */
  z.strictObject({ kind: z.literal('restore'), conditions: z.array(ConditionSchema.exclude(['exhaustion'])).min(1) }),
  z.strictObject({ kind: z.literal('condition'), conditions: z.array(ConditionSchema.exclude(['exhaustion'])).min(1), until: UntilTurnSchema }),
  /** Recupera todos os usos de outro recurso (Uncanny Metabolism). */
  z.strictObject({ kind: z.literal('regain'), resource: IdSchema }),
  /** Estado em quem usou: efeitos na ficha até ser encerrado. */
  z.strictObject({
    kind: z.literal('buff'),
    effects: z.array(BaseEffectSchema).min(1).max(20),
    until: UntilTurnSchema,
    /** O que o encerra sozinho (a morte, sempre). */
    endsOn: z.array(z.enum(['incapacitated', 'unconscious', 'heavy_armor'])).optional(),
    /** Enquanto dura, não conjura nem se concentra (Rage). */
    noSpells: z.literal(true).optional(),
    /** Os efeitos são de uma arma corpo a corpo empunhada (Sacred Weapon). */
    weapon: z.literal(true).optional(),
  }),
]);
export type FeatureUsePart = z.infer<typeof FeatureUsePartSchema>;

/** Característica que o jogador usa na mesa (nota 0078). A de mesmo id que vem depois substitui. */
const FeatureUseSchema = z.strictObject({
  type: z.literal('feature_use'),
  id: IdSchema,
  name: z.string().min(1).max(100),
  action: z.string().min(1).max(100).optional(),
  cost: z.strictObject({ resource: IdSchema, amount: z.int().positive().default(1) }).optional(),
  targets: z.enum(['self', 'one']).default('self'),
  duration: z.string().min(1).max(100).optional(),
  forbidHeavyArmor: z.literal(true).optional(),
  parts: z.array(FeatureUsePartSchema).min(1).max(6),
  ...common,
});
export type FeatureUse = z.infer<typeof FeatureUseSchema>;

/** Parte a mais de uma característica de outra fonte (Restoring Touch em Lay On Hands). */
const FeatureUseExtensionSchema = z.strictObject({ type: z.literal('feature_use_part'), use: IdSchema, part: FeatureUsePartSchema, ...common });
export type FeatureUseExtension = z.infer<typeof FeatureUseExtensionSchema>;

export const EffectSchema = z.discriminatedUnion('type', [...BaseEffectSchema.options, FeatureUseSchema, FeatureUseExtensionSchema]);
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = Effect['type'];
