import { z } from 'zod';
import { AbilitySchema, ConditionSchema, DamageSchema, FeetSchema, IdSchema, RestSchema, TextSchema } from './common';

/**
 * Ações declarativas de criaturas (ataque `+5`, dano `2d6+3` cortante, teste
 * de CON CD 13, condição envenenado). O motor propõe o resultado e o mestre
 * confirma ou faz override (Fase 4).
 */

export const ActivationSchema = z.enum(['action', 'bonus_action', 'reaction', 'legendary']);
export type Activation = z.infer<typeof ActivationSchema>;

/**
 * Limite de uso: recarga (`Recharge 5–6`) ou usos por descanso/dia. `lairCount`
 * é o número de usos quando a criatura está no covil (`3/Day, or 4/Day in Lair`).
 */
export const ActionLimitSchema = z.union([
  z.strictObject({ recharge: z.int().min(2).max(6) }),
  z.strictObject({
    per: z.union([RestSchema, z.literal('day')]),
    count: z.int().positive(),
    lairCount: z.int().positive().optional(),
  }),
]);

const actionBase = {
  id: IdSchema,
  name: TextSchema,
  activation: ActivationSchema.default('action'),
  limit: ActionLimitSchema.optional(),
  /** Texto original da ação, exibido na UI. */
  description: z.string().optional(),
};

export const AttackActionSchema = z.strictObject({
  ...actionBase,
  kind: z.literal('attack'),
  /** `melee_or_ranged`: arma de arremesso ou ataque mágico com alcance e distância. */
  attackKind: z.enum(['melee', 'ranged', 'melee_or_ranged']),
  toHit: z.int(),
  /** Alcance corpo a corpo (`reach`) ou distância (`range`/`longRange`) em pés. */
  reach: FeetSchema.positive().optional(),
  range: FeetSchema.positive().optional(),
  longRange: FeetSchema.positive().optional(),
  /** Dano do acerto. Vazio quando o acerto só aplica efeitos (ex.: agarrar). */
  damage: z.array(DamageSchema).default([]),
  /** Condições aplicadas ao acertar, sem ressalva (as condicionais ficam na descrição). */
  onHitConditions: z.array(ConditionSchema).default([]),
});

export const SaveActionSchema = z.strictObject({
  ...actionBase,
  kind: z.literal('save'),
  ability: AbilitySchema,
  dc: z.int().min(1),
  damage: z.array(DamageSchema).default([]),
  /** Efeito do sucesso na salvaguarda sobre o dano. */
  onSuccess: z.enum(['half', 'none']).default('none'),
  /** Condições aplicadas na falha, sem ressalva (as condicionais ficam na descrição). */
  onFailConditions: z.array(ConditionSchema).default([]),
});

/** Magia de um Spellcasting de criatura: à vontade ou N vezes por dia. */
export const CreatureSpellSchema = z.strictObject({
  spellId: IdSchema,
  uses: z.union([z.literal('at_will'), z.strictObject({ per: z.literal('day'), count: z.int().positive() })]),
  /** Nível em que é conjurada (`Fireball (level 4 version)`). */
  level: z.int().min(1).max(9).optional(),
  /** Ressalva publicada (ex.: `cast before combat`). */
  note: z.string().optional(),
});

/** Spellcasting de criatura: conjura magias do compêndio sem espaços de magia. */
export const SpellcastingActionSchema = z.strictObject({
  ...actionBase,
  kind: z.literal('spellcasting'),
  ability: AbilitySchema,
  /** CD de salvaguarda e bônus de ataque publicados (ausentes se nenhuma magia os usa). */
  dc: z.int().min(1).optional(),
  toHit: z.int().optional(),
  spells: z.array(CreatureSpellSchema).min(1),
});

/** Ação sem resolução automática: só texto para o mestre. */
export const TextActionSchema = z.strictObject({
  ...actionBase,
  kind: z.literal('text'),
  description: TextSchema,
});

export const ActionSchema = z.discriminatedUnion('kind', [
  AttackActionSchema,
  SaveActionSchema,
  SpellcastingActionSchema,
  TextActionSchema,
]);
export type Action = z.infer<typeof ActionSchema>;
