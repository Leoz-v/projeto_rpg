import { z } from 'zod';
import { AbilitySchema, CreatureTypeSchema, FeetSchema, IdSchema, SizeSchema, SkillSchema, TextSchema } from './common';
import { type AbilityRef, AbilityRefSchema, EffectSchema, SpellUsesSchema } from './effect';
import { SpellSchoolSchema } from './spell';

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

/** Categorias de proficiência que o jogador pode escolher. */
export const ProficiencyChoiceCategorySchema = z.enum(['skill', 'tool', 'language']);

/** Configuração das magias escolhidas quando vêm como concessão fora da classe (ex.: Magic Initiate). */
export interface SpellGrantTemplate {
  ability: z.infer<typeof AbilityRefSchema>;
  uses: z.infer<typeof SpellUsesSchema>;
}

/** O que uma escolha oferece. `from` ausente = qualquer opção válida da categoria. */
export type ChoiceOptions =
  /** Proficiência em perícia, ferramenta ou idioma (ex.: Skilled: "três perícias ou ferramentas"). */
  | { pick: 'proficiency'; categories: z.infer<typeof ProficiencyChoiceCategorySchema>[]; from?: string[] | undefined }
  /** Especialização numa perícia em que já tem proficiência. */
  | { pick: 'skill_expertise'; from?: z.infer<typeof SkillSchema>[] | undefined }
  /** Escolha de um atributo (ex.: atributo de conjuração de uma linhagem), referenciada por `{ choice }`. */
  | { pick: 'ability'; from: z.infer<typeof AbilitySchema>[] }
  /** Aumento de atributo; repetir o atributo nos picks soma de novo. */
  | { pick: 'ability_score'; from?: z.infer<typeof AbilitySchema>[] | undefined; max: number }
  | { pick: 'feat'; categories: FeatCategory[] }
  /** `melee`: só armas corpo a corpo; `proficient`: só armas com que tem proficiência. */
  | { pick: 'weapon_mastery'; melee?: boolean | undefined; proficient?: boolean | undefined }
  | { pick: 'subclass' }
  /**
   * Magias de uma ou mais listas de classe, de `minLevel` a `maxLevel`. Sem
   * `grantAs`, as magias vão para a conjuração da classe (conhecidas ou
   * grimório); com `grantAs`, viram `grant_spell` com esse atributo e usos.
   */
  | {
      pick: 'spell';
      lists: string[];
      minLevel: number;
      maxLevel: number;
      school?: z.infer<typeof SpellSchoolSchema> | undefined;
      /** Só magias com a etiqueta Ritual (ex.: Pact of the Tome). */
      ritual?: boolean | undefined;
      grantAs?: SpellGrantTemplate | undefined;
    }
  /**
   * `group`: escolhas com o mesmo grupo na mesma fonte não podem repetir uma
   * opção (a menos que ela seja `repeatable`), ex.: Eldritch Invocations.
   */
  | { pick: 'option'; group?: string | undefined; options: ChoiceOption[] };

/**
 * Opção nomeada de uma escolha genérica (ex.: linhagem élfica). `grants` vale
 * ao escolher; `levels` concede mais em níveis posteriores, na mesma escala de
 * nível da fonte que declarou a escolha.
 */
export interface ChoiceOption {
  id: string;
  name: string;
  description?: string | undefined;
  grants: Grant[];
  levels: LevelGrants;
  /** Nível mínimo (na escala da fonte) e opções do mesmo grupo já escolhidas. */
  prerequisite?: { minLevel?: number | undefined; options?: string[] | undefined } | undefined;
  repeatable?: boolean | undefined;
}

export type Grant =
  | { kind: 'effect'; effect: z.infer<typeof EffectSchema> }
  | { kind: 'feature'; feature: Feature }
  | { kind: 'feat'; featId: string }
  | { kind: 'choice'; id: string; count: number; options: ChoiceOptions }
  /** Aumento fixo de atributo (ex.: Primal Champion, +4 FOR até 25). */
  | { kind: 'ability_increase'; ability: z.infer<typeof AbilitySchema>; amount: number; max: number };

export type LevelGrants = { level: number; grants: Grant[] }[];

const ChoiceOptionSchema: z.ZodType<ChoiceOption> = z.lazy(() =>
  z.strictObject({
    id: IdSchema,
    name: TextSchema,
    description: z.string().optional(),
    grants: z.array(GrantSchema).default([]),
    levels: LevelGrantsSchema,
    prerequisite: z
      .strictObject({ minLevel: z.int().min(1).max(20).optional(), options: z.array(IdSchema).min(1).optional() })
      .optional(),
    repeatable: z.boolean().optional(),
  }),
);

export const ChoiceOptionsSchema: z.ZodType<ChoiceOptions> = z.lazy(() =>
  z.discriminatedUnion('pick', [
    z.strictObject({
      pick: z.literal('proficiency'),
      categories: z.array(ProficiencyChoiceCategorySchema).min(1),
      from: z.array(IdSchema).min(1).optional(),
    }),
    z.strictObject({ pick: z.literal('skill_expertise'), from: z.array(SkillSchema).min(1).optional() }),
    z.strictObject({ pick: z.literal('ability'), from: z.array(AbilitySchema).min(2) }),
    z.strictObject({
      pick: z.literal('ability_score'),
      from: z.array(AbilitySchema).min(1).optional(),
      /** Teto do valor ao aplicar o aumento (20 nos talentos comuns). */
      max: z.int().min(1).max(30),
    }),
    z.strictObject({ pick: z.literal('feat'), categories: z.array(FeatCategorySchema).min(1) }),
    z.strictObject({ pick: z.literal('weapon_mastery'), melee: z.boolean().optional(), proficient: z.boolean().optional() }),
    z.strictObject({ pick: z.literal('subclass') }),
    z
      .strictObject({
        pick: z.literal('spell'),
        lists: z.array(IdSchema).min(1),
        minLevel: z.int().min(0).max(9).default(0),
        maxLevel: z.int().min(0).max(9),
        school: SpellSchoolSchema.optional(),
        ritual: z.boolean().optional(),
        grantAs: z.strictObject({ ability: AbilityRefSchema, uses: SpellUsesSchema }).optional(),
      })
      .refine((c) => c.minLevel <= c.maxLevel, { message: 'minLevel maior que maxLevel' }),
    z.strictObject({
      pick: z.literal('option'),
      group: IdSchema.optional(),
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
    z.strictObject({ kind: z.literal('ability_increase'), ability: AbilitySchema, amount: z.int().positive(), max: z.int().min(1).max(30) }),
  ]),
);

function uniqueIds(list: readonly { id: string }[]): boolean {
  return new Set(list.map((x) => x.id)).size === list.length;
}

/**
 * Concessões por nível. Para espécie, antecedente e talento, `level` é o nível
 * de personagem; para classe e subclasse, o nível naquela classe.
 */
export const LevelGrantsSchema: z.ZodType<LevelGrants> = z
  .array(z.strictObject({ level: z.int().min(1).max(20), grants: z.array(GrantSchema).min(1) }))
  .default([])
  .refine((levels) => new Set(levels.map((l) => l.level)).size === levels.length, { message: 'nível repetido' });

/** Todas as concessões de uma fonte, incluindo as de dentro de opções. */
function allGrants(grants: readonly Grant[]): Grant[] {
  return grants.flatMap((g) => {
    if (g.kind !== 'choice' || g.options.pick !== 'option') return [g];
    const nested = g.options.options.flatMap((o) => [...o.grants, ...o.levels.flatMap((l) => l.grants)]);
    return [g, ...allGrants(nested)];
  });
}

/**
 * Integridade de uma fonte: ids de escolha únicos (inclusive dentro de
 * opções) e toda referência `{ choice }` de atributo aponta para uma escolha
 * `ability` da própria fonte.
 */
function checkSourceIntegrity(grants: readonly Grant[], ctx: z.RefinementCtx): void {
  const all = allGrants(grants);
  const choices = all.flatMap((g) => (g.kind === 'choice' ? [g] : []));
  const seen = new Set<string>();
  for (const c of choices) {
    if (seen.has(c.id)) ctx.addIssue({ code: 'custom', message: `id de escolha repetido na fonte: ${c.id}` });
    seen.add(c.id);
  }
  const abilityChoices = new Set(choices.filter((c) => c.options.pick === 'ability').map((c) => c.id));
  const refs: AbilityRef[] = all.flatMap((g) => {
    const effects = g.kind === 'effect' ? [g.effect] : g.kind === 'feature' ? g.feature.effects : [];
    const fromEffects = effects.flatMap((e) => (e.type === 'grant_spell' ? [e.ability] : []));
    const fromTemplate = g.kind === 'choice' && g.options.pick === 'spell' && g.options.grantAs ? [g.options.grantAs.ability] : [];
    return [...fromEffects, ...fromTemplate];
  });
  for (const ref of refs) {
    if (typeof ref === 'object' && !abilityChoices.has(ref.choice)) {
      ctx.addIssue({ code: 'custom', message: `atributo referencia escolha inexistente ou que não é 'ability': ${ref.choice}` });
    }
  }
}

const levelsGrants = (levels: LevelGrants): Grant[] => levels.flatMap((l) => l.grants);

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
}).superRefine((x, ctx) => {
  checkSourceIntegrity(levelsGrants(x.levels), ctx);
});
export type Species = z.infer<typeof SpeciesSchema>;

/** Antecedente 2024: três atributos para os aumentos e um Talento de Origem (via `levels`). */
export const BackgroundSchema = z.strictObject({
  ...sourceBase,
  abilityOptions: z
    .tuple([AbilitySchema, AbilitySchema, AbilitySchema])
    .refine((a) => new Set(a).size === 3, { message: 'atributos repetidos' }),
  levels: LevelGrantsSchema,
}).superRefine((x, ctx) => {
  checkSourceIntegrity(levelsGrants(x.levels), ctx);
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
      /** Exige a característica Spellcasting ou Fighting Style. */
      feature: z.enum(['spellcasting', 'fighting_style']).optional(),
    })
    .optional(),
  repeatable: z.boolean().default(false),
  /** Concessões ao obter o talento. */
  grants: z.array(GrantSchema).default([]),
}).superRefine((x, ctx) => {
  checkSourceIntegrity(x.grants, ctx);
});
export type Feat = z.infer<typeof FeatSchema>;

/**
 * Progressão de espaços de magia: `full` conta todos os níveis da classe, `half`
 * metade arredondada para cima (SRD 5.2.1, Multiclassing). `pact` é a Magia de
 * Pacto do Bruxo, com tabela própria.
 */
export const SpellcastingProgressionSchema = z.enum(['full', 'half', 'pact']);

export const ClassSchema = z.strictObject({
  ...sourceBase,
  hitDie: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  primaryAbilities: z.array(AbilitySchema).min(1),
  /** Pré-requisito de multiclasse: 13 em `all` (todos) ou `any` (um deles) dos atributos primários. */
  primaryAbilityMode: z.enum(['all', 'any']).default('all'),
  spellcasting: z
    .strictObject({
      ability: AbilitySchema,
      progression: SpellcastingProgressionSchema,
      /** Quantidade de magias preparadas por nível de classe (índice 0 = nível 1). */
      preparedSpells: z.array(z.int().nonnegative()).length(20),
    })
    .optional(),
  /** Concessões de nível 1 só quando é a primeira classe (salvaguardas, perícias…). */
  startingGrants: z.array(GrantSchema).default([]),
  /** Concessões de nível 1 quando entra por multiclasse. */
  multiclassGrants: z.array(GrantSchema).default([]),
  levels: LevelGrantsSchema,
}).superRefine((x, ctx) => {
  checkSourceIntegrity([...x.startingGrants, ...x.multiclassGrants, ...levelsGrants(x.levels)], ctx);
});
export type Class = z.infer<typeof ClassSchema>;

export const SubclassSchema = z.strictObject({
  ...sourceBase,
  classId: IdSchema,
  levels: LevelGrantsSchema,
}).superRefine((x, ctx) => {
  checkSourceIntegrity(levelsGrants(x.levels), ctx);
});
export type Subclass = z.infer<typeof SubclassSchema>;

/**
 * Regras de criação de personagem que não vêm de nenhuma fonte (ex.: Comum +
 * dois idiomas padrão). Resolvidas no passo `species`.
 */
export const CharacterCreationSchema = z
  .strictObject({ grants: z.array(GrantSchema).min(1) })
  .superRefine((x, ctx) => {
    checkSourceIntegrity(x.grants, ctx);
  });
export type CharacterCreation = z.infer<typeof CharacterCreationSchema>;
