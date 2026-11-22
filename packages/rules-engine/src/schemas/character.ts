import { z } from 'zod';
import { AbilitySchema, AbilityScoresSchema, ABILITIES, IdSchema, TextSchema } from './common';
import { EffectSchema } from './effect';

/**
 * Personagem = lista ordenada de escolhas de construção. Nada aqui é valor
 * final: a ficha é sempre calculada pelo motor a partir destes dados, do
 * inventário e dos ajustes do mestre.
 *
 * O schema valida a estrutura. Se a construção está completa (sem escolhas
 * pendentes) e se cada escolha é permitida pela fonte, quem decide é o motor.
 */

// --- Valores base dos atributos --------------------------------------------

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

/** Custo de cada valor na compra de pontos (SRD 5.2.1). Orçamento: 27. */
export const POINT_BUY_COST: Readonly<Record<number, number>> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;

export const AbilityScoreMethodSchema = z.enum(['standard_array', 'point_buy', 'rolled', 'manual']);

export const BaseScoresSchema = z
  .strictObject({ method: AbilityScoreMethodSchema, scores: AbilityScoresSchema })
  .superRefine(({ method, scores }, ctx) => {
    const values = ABILITIES.map((a) => scores[a]);
    if (method === 'standard_array') {
      const sorted = [...values].sort((a, b) => b - a);
      if (sorted.some((v, i) => v !== STANDARD_ARRAY[i])) {
        ctx.addIssue({ code: 'custom', path: ['scores'], message: 'valores não correspondem ao conjunto padrão' });
      }
    } else if (method === 'point_buy') {
      const costs = values.map((v) => POINT_BUY_COST[v]);
      if (costs.some((c) => c === undefined)) {
        ctx.addIssue({ code: 'custom', path: ['scores'], message: 'compra de pontos aceita só valores de 8 a 15' });
      } else if (costs.reduce<number>((sum, c) => sum + (c ?? 0), 0) > POINT_BUY_BUDGET) {
        ctx.addIssue({ code: 'custom', path: ['scores'], message: `compra de pontos acima de ${POINT_BUY_BUDGET}` });
      }
    } else if (method === 'rolled' && values.some((v) => v < 3 || v > 18)) {
      ctx.addIssue({ code: 'custom', path: ['scores'], message: 'valores rolados vão de 3 a 18' });
    }
  });
export type BaseScores = z.infer<typeof BaseScoresSchema>;

// --- Seleções de escolhas pendentes ----------------------------------------

export const SourceKindSchema = z.enum(['species', 'background', 'class', 'subclass', 'feat', 'option']);

/** Resolução de uma escolha declarada por uma fonte (`Grant` do tipo `choice`). */
export const SelectionSchema = z.strictObject({
  source: z.strictObject({ kind: SourceKindSchema, id: IdSchema }),
  choiceId: IdSchema,
  /** Ids escolhidos. Em `ability_score`, repetir um atributo = aumento de +2. */
  picks: z.array(IdSchema).min(1),
});
export type Selection = z.infer<typeof SelectionSchema>;

const selections = z
  .array(SelectionSchema)
  .default([])
  .refine((list) => new Set(list.map((s) => `${s.source.kind}:${s.source.id}:${s.choiceId}`)).size === list.length, {
    message: 'escolha resolvida mais de uma vez no mesmo passo',
  });

// --- Passos de construção ---------------------------------------------------

/** Aumentos do antecedente: +2/+1 em dois atributos ou +1 em três. */
export const BackgroundIncreasesSchema = z
  .partialRecord(AbilitySchema, z.union([z.literal(1), z.literal(2)]))
  .refine(
    (inc) => {
      const v = Object.values(inc).sort();
      return (v.length === 2 && v[0] === 1 && v[1] === 2) || (v.length === 3 && v.every((x) => x === 1));
    },
    { message: 'aumentos do antecedente devem ser +2/+1 ou +1/+1/+1' },
  );

/**
 * Cada passo resolve as escolhas que ficam pendentes nele, de qualquer fonte
 * (ex.: um `class_level` resolve as escolhas da classe naquele nível e as da
 * espécie, do antecedente e dos talentos naquele nível de personagem).
 */
export const BuildStepSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('species'), speciesId: IdSchema, selections }),
  z.strictObject({
    kind: z.literal('background'),
    backgroundId: IdSchema,
    abilityIncreases: BackgroundIncreasesSchema,
    selections,
  }),
  z.strictObject({ kind: z.literal('class_level'), classId: IdSchema, selections }),
]);
export type BuildStep = z.infer<typeof BuildStepSchema>;

export const MAX_CHARACTER_LEVEL = 20;

export const CharacterSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  baseScores: BaseScoresSchema,
  steps: z
    .array(BuildStepSchema)
    .refine((s) => s.filter((x) => x.kind === 'species').length <= 1, { message: 'mais de uma espécie' })
    .refine((s) => s.filter((x) => x.kind === 'background').length <= 1, { message: 'mais de um antecedente' })
    .refine((s) => s.filter((x) => x.kind === 'class_level').length <= MAX_CHARACTER_LEVEL, {
      message: `mais de ${MAX_CHARACTER_LEVEL} níveis`,
    }),
});
export type Character = z.infer<typeof CharacterSchema>;
export type CharacterInput = z.input<typeof CharacterSchema>;

// --- Ajustes do mestre ------------------------------------------------------

/** Camada de efeitos por cima do cálculo base (bênçãos, maldições, itens caseiros). */
export const GmAdjustmentSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  effects: z.array(EffectSchema).min(1),
});
export type GmAdjustment = z.infer<typeof GmAdjustmentSchema>;
