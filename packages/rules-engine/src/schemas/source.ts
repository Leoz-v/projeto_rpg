import { z } from 'zod';
import { AbilitySchema, CreatureTypeSchema, FeetSchema, IdSchema, SizeSchema, SkillSchema, TextSchema } from './common';
import { EffectSchema } from './effect';

/**
 * Fontes de construção de personagem (espécie, antecedente, talento, classe,
 * subclasse). Cada fonte declara o que concede por nível: efeitos,
 * características, talentos fixos e escolhas pendentes.
 */

export const FeatCategorySchema = z.enum(['origin', 'general', 'fighting_style', 'epic_boon']);
export type FeatCategory = z.infer<typeof FeatCategorySchema>;

/** Característica com nome e texto (ex.: Second Wind), opcionalmente com efeitos. */
export const FeatureSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  description: TextSchema,
  effects: z.array(EffectSchema).default([]),
});
export type Feature = z.infer<typeof FeatureSchema>;

/** O que uma escolha oferece. `from` ausente = qualquer opção válida da categoria. */
export type ChoiceOptions =
  | { pick: 'skill_proficiency'; from?: z.infer<typeof SkillSchema>[] }
  | { pick: 'skill_expertise' }
  | { pick: 'tool_proficiency'; from?: string[] }
  | { pick: 'language'; from?: string[] }
  | { pick: 'ability_score'; from?: z.infer<typeof AbilitySchema>[]; max: number }
  | { pick: 'feat'; categories: FeatCategory[] }
  | { pick: 'weapon_mastery' }
  | { pick: 'subclass' }
  | { pick: 'spell'; lists: string[]; maxLevel: number }
  | { pick: 'option'; options: ChoiceOption[] };

/** Opção nomeada de uma escolha genérica (ex.: linhagem élfica), com suas próprias concessões. */
export interface ChoiceOption {
  id: string;
  name: string;
  description?: string | undefined;
  grants: Grant[];
}

export type Grant =
  | { kind: 'effect'; effect: z.infer<typeof EffectSchema> }
  | { kind: 'feature'; feature: Feature }
  | { kind: 'feat'; featId: string }
  | { kind: 'choice'; id: string; count: number; options: ChoiceOptions };

const ChoiceOptionSchema: z.ZodType<ChoiceOption> = z.lazy(() =>
  z.strictObject({
    id: IdSchema,
    name: TextSchema,
    description: z.string().optional(),
    grants: z.array(GrantSchema),
  }),
);

export const ChoiceOptionsSchema: z.ZodType<ChoiceOptions> = z.lazy(() =>
  z.discriminatedUnion('pick', [
    z.strictObject({ pick: z.literal('skill_proficiency'), from: z.array(SkillSchema).min(1).optional() }),
    z.strictObject({ pick: z.literal('skill_expertise') }),
    z.strictObject({ pick: z.literal('tool_proficiency'), from: z.array(IdSchema).min(1).optional() }),
    z.strictObject({ pick: z.literal('language'), from: z.array(IdSchema).min(1).optional() }),
    z.strictObject({
      pick: z.literal('ability_score'),
      from: z.array(AbilitySchema).min(1).optional(),
      /** Teto do valor ao aplicar o aumento (20 nos talentos comuns). */
      max: z.int().min(1).max(30),
    }),
    z.strictObject({ pick: z.literal('feat'), categories: z.array(FeatCategorySchema).min(1) }),
    z.strictObject({ pick: z.literal('weapon_mastery') }),
    z.strictObject({ pick: z.literal('subclass') }),
    z.strictObject({ pick: z.literal('spell'), lists: z.array(IdSchema).min(1), maxLevel: z.int().min(0).max(9) }),
    z.strictObject({
      pick: z.literal('option'),
      options: z.array(ChoiceOptionSchema).min(2).refine(uniqueIds, { message: 'ids de opção repetidos' }),
    }),
  ]),
);

export const GrantSchema: z.ZodType<Grant> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('effect'), effect: EffectSchema }),
    z.strictObject({ kind: z.literal('feature'), feature: FeatureSchema }),
    z.strictObject({ kind: z.literal('feat'), featId: IdSchema }),
    z.strictObject({ kind: z.literal('choice'), id: IdSchema, count: z.int().positive(), options: ChoiceOptionsSchema }),
  ]),
);

function uniqueIds(list: readonly { id: string }[]): boolean {
  return new Set(list.map((x) => x.id)).size === list.length;
}

/**
 * Concessões por nível. Para espécie, antecedente e talento, `level` é o nível
 * de personagem; para classe e subclasse, o nível naquela classe.
 */
export const LevelGrantsSchema = z
  .array(z.strictObject({ level: z.int().min(1).max(20), grants: z.array(GrantSchema).min(1) }))
  .default([])
  .refine((levels) => new Set(levels.map((l) => l.level)).size === levels.length, { message: 'nível repetido' })
  .refine(
    (levels) => {
      const ids = levels.flatMap((l) => l.grants.flatMap((g) => (g.kind === 'choice' ? [g.id] : [])));
      return new Set(ids).size === ids.length;
    },
    { message: 'id de escolha repetido na mesma fonte' },
  );

const sourceBase = {
  id: IdSchema,
  name: TextSchema,
  description: z.string().optional(),
};

export const SpeciesSchema = z.strictObject({
  ...sourceBase,
  creatureType: CreatureTypeSchema.default('humanoid'),
  /** Tamanhos permitidos; com mais de um, o jogador escolhe. */
  sizes: z.array(SizeSchema).min(1),
  speed: FeetSchema.positive(),
  levels: LevelGrantsSchema,
});
export type Species = z.infer<typeof SpeciesSchema>;

/** Antecedente 2024: três atributos para os aumentos e um Talento de Origem (via `levels`). */
export const BackgroundSchema = z.strictObject({
  ...sourceBase,
  abilityOptions: z
    .tuple([AbilitySchema, AbilitySchema, AbilitySchema])
    .refine((a) => new Set(a).size === 3, { message: 'atributos repetidos' }),
  levels: LevelGrantsSchema,
});
export type Background = z.infer<typeof BackgroundSchema>;

export const FeatSchema = z.strictObject({
  ...sourceBase,
  category: FeatCategorySchema,
  prerequisite: z
    .strictObject({
      minLevel: z.int().min(1).max(20).optional(),
      /** Basta um destes atributos atingir o mínimo (ex.: FOR ou DES 13). */
      anyAbilityAtLeast: z.partialRecord(AbilitySchema, z.int().min(1).max(30)).optional(),
    })
    .optional(),
  repeatable: z.boolean().default(false),
  /** Concessões ao obter o talento. */
  grants: z.array(GrantSchema).default([]),
});
export type Feat = z.infer<typeof FeatSchema>;

export const SpellcastingProgressionSchema = z.enum(['full', 'half', 'third', 'pact']);

export const ClassSchema = z.strictObject({
  ...sourceBase,
  hitDie: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  primaryAbilities: z.array(AbilitySchema).min(1),
  spellcasting: z
    .strictObject({ ability: AbilitySchema, progression: SpellcastingProgressionSchema })
    .optional(),
  /** Concessões de nível 1 só quando é a primeira classe (salvaguardas, perícias…). */
  startingGrants: z.array(GrantSchema).default([]),
  /** Concessões de nível 1 quando entra por multiclasse. */
  multiclassGrants: z.array(GrantSchema).default([]),
  levels: LevelGrantsSchema,
});
export type Class = z.infer<typeof ClassSchema>;

export const SubclassSchema = z.strictObject({
  ...sourceBase,
  classId: IdSchema,
  levels: LevelGrantsSchema,
});
export type Subclass = z.infer<typeof SubclassSchema>;
