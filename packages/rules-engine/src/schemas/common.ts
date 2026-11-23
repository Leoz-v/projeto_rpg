import { z } from 'zod';

/**
 * Primitivos compartilhados por todos os schemas de conteúdo.
 * Listas fechadas seguem o SRD 5.2.1 e `docs/effects-spec.md`.
 */

/** Identificador de conteúdo: `snake_case` em inglês (ex.: `longsword`, `sleight_of_hand`). */
export const IdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'id deve ser snake_case');
export type Id = z.infer<typeof IdSchema>;

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export const AbilitySchema = z.enum(ABILITIES);
export type Ability = z.infer<typeof AbilitySchema>;

/** As 18 perícias do SRD e o atributo de cada uma. */
export const SKILL_ABILITY = {
  acrobatics: 'dex',
  animal_handling: 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  sleight_of_hand: 'dex',
  stealth: 'dex',
  survival: 'wis',
} as const satisfies Record<string, Ability>;

export type Skill = keyof typeof SKILL_ABILITY;
export const SKILLS = Object.keys(SKILL_ABILITY) as [Skill, ...Skill[]];
export const SkillSchema = z.enum(SKILLS);

export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;
export const DamageTypeSchema = z.enum(DAMAGE_TYPES);
export type DamageType = z.infer<typeof DamageTypeSchema>;

export const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;
export const ConditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof ConditionSchema>;

export const ArmorCategorySchema = z.enum(['light', 'medium', 'heavy']);
export type ArmorCategory = z.infer<typeof ArmorCategorySchema>;

export const AttackKindSchema = z.enum(['melee', 'ranged', 'spell']);
export type AttackKind = z.infer<typeof AttackKindSchema>;

export const WEAPON_PROPERTIES = [
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'loading',
  'range',
  'reach',
  'thrown',
  'two_handed',
  'versatile',
] as const;
export const WeaponPropertySchema = z.enum(WEAPON_PROPERTIES);
export type WeaponProperty = z.infer<typeof WeaponPropertySchema>;

export const WEAPON_MASTERIES = ['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'] as const;
export const WeaponMasterySchema = z.enum(WEAPON_MASTERIES);
export type WeaponMastery = z.infer<typeof WeaponMasterySchema>;

export const SizeSchema = z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);
export type Size = z.infer<typeof SizeSchema>;

export const CREATURE_TYPES = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;
export const CreatureTypeSchema = z.enum(CREATURE_TYPES);
export type CreatureType = z.infer<typeof CreatureTypeSchema>;

/** Idiomas padrão além do Comum e idiomas raros (SRD 5.2.1 p. 20), para escolhas de idioma sem lista própria. */
export const STANDARD_LANGUAGES = ['common_sign_language', 'draconic', 'dwarvish', 'elvish', 'giant', 'gnomish', 'goblin', 'halfling', 'orc'] as const;
export const RARE_LANGUAGES = ['abyssal', 'celestial', 'deep_speech', 'druidic', 'infernal', 'primordial', 'sylvan', 'thieves_cant', 'undercommon'] as const;

export const SenseSchema = z.enum(['darkvision', 'blindsight', 'tremorsense', 'truesight']);
export type Sense = z.infer<typeof SenseSchema>;

export const RestSchema = z.enum(['short_rest', 'long_rest']);
export type Rest = z.infer<typeof RestSchema>;

/** Valor de atributo (1–30 no SRD). */
export const AbilityScoreSchema = z.int().min(1).max(30);

/** Os seis valores de atributo, todos obrigatórios. */
export const AbilityScoresSchema = z.strictObject({
  str: AbilityScoreSchema,
  dex: AbilityScoreSchema,
  con: AbilityScoreSchema,
  int: AbilityScoreSchema,
  wis: AbilityScoreSchema,
  cha: AbilityScoreSchema,
});
export type AbilityScores = z.infer<typeof AbilityScoresSchema>;

/** Distância em pés (múltiplo de 5, como no grid). */
export const FeetSchema = z.int().nonnegative().multipleOf(5);

/**
 * Expressão de dados: termos `NdM` ou inteiros unidos por `+`/`-`, sem espaços.
 * Ex.: `1d8`, `2d6+3`, `1d10+1d6-1`.
 */
const DIE = '(?:\\d+d(?:4|6|8|10|12|20|100)|\\d+)';
export const DiceSchema = z.string().regex(new RegExp(`^${DIE}(?:[+-]${DIE})*$`), 'expressão de dados inválida');
export type Dice = z.infer<typeof DiceSchema>;

export const DamageSchema = z.strictObject({
  dice: DiceSchema,
  type: DamageTypeSchema,
});
export type Damage = z.infer<typeof DamageSchema>;

/** Texto exibido na UI. Conteúdo do SRD vem em inglês; tradução é feita depois. */
export const TextSchema = z.string().min(1);
