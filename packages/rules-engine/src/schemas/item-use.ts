import { z } from 'zod';
import { AbilitySchema, ConditionSchema, CreatureTypeSchema, DamageSchema, DiceSchema, TextSchema } from './common';
import { EffectSchema } from './effect';

/**
 * Usar um item consumível (nota 0074): o que acontece com os alvos, em
 * partes que o Host resolve na ordem. O que não cabe aqui fica no texto do
 * item, que vai para o chat.
 */

/** CD fixa do item, ou 8 + modificador + bônus de proficiência de quem usa (Acid, Holy Water). */
export const ItemDcSchema = z.union([z.int().min(1).max(40), z.strictObject({ ability: AbilitySchema })]);

export const ItemUsePartSchema = z.discriminatedUnion('kind', [
  /** Cura, ou PV temporários, rolados pelo Host e aplicados direto. */
  z.strictObject({ kind: z.literal('heal'), dice: DiceSchema, temporary: z.literal(true).optional() }),
  /** Condições que terminam, e a Exaustão (Elixir of Health, Potion of Vitality). */
  z.strictObject({ kind: z.literal('restore'), conditions: z.array(ConditionSchema.exclude(['exhaustion'])).default([]), exhaustion: z.literal(true).optional() }),
  /** Condição sem salvaguarda (Potion of Invisibility). */
  z.strictObject({ kind: z.literal('condition'), conditions: z.array(ConditionSchema.exclude(['exhaustion'])).min(1) }),
  /** Efeitos do catálogo, ou um conjunto à escolha de quem usa (Potion of Resistance). */
  z.strictObject({
    kind: z.literal('buff'),
    effects: z.array(EffectSchema).default([]),
    options: z.array(z.strictObject({ label: TextSchema, effects: z.array(EffectSchema).min(1) })).default([]),
  }),
  /** Dano sem salvaguarda: proposta para o mestre. */
  z.strictObject({ kind: z.literal('damage'), damage: z.array(DamageSchema).min(1) }),
  /** Salvaguarda dos alvos: o dano vira proposta, as condições entram direto na falha. */
  z.strictObject({
    kind: z.literal('save'),
    ability: AbilitySchema,
    dc: ItemDcSchema,
    damage: z.array(DamageSchema).default([]),
    onSuccess: z.enum(['half', 'none']).default('none'),
    onFailConditions: z.array(ConditionSchema.exclude(['exhaustion'])).default([]),
    /** Só afeta estes tipos (Holy Water: Fiend e Undead). */
    onlyTypes: z.array(CreatureTypeSchema).min(1).optional(),
    /** Estes tipos passam sem rolar (Dust of Sneezing and Choking). */
    exceptTypes: z.array(CreatureTypeSchema).min(1).optional(),
  }),
]);
export type ItemUsePart = z.infer<typeof ItemUsePartSchema>;

export const ItemUseSchema = z.strictObject({
  /** Quantos alvos: um (poção, frasco arremessado) ou quantos a mesa marcar (área). */
  targets: z.enum(['one', 'many']).default('one'),
  /** Duração para a mesa acompanhar ("1 hora"). */
  duration: TextSchema.optional(),
  parts: z.array(ItemUsePartSchema).min(1).max(5),
});
export type ItemUse = z.infer<typeof ItemUseSchema>;
