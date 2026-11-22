import { z } from 'zod';
import { AbilitySchema, ConditionSchema, DamageSchema, FeetSchema, IdSchema, RestSchema, TextSchema } from './common';

/**
 * Ações declarativas de criaturas (ataque `+5`, dano `2d6+3` cortante, teste
 * de CON CD 13, condição envenenado). O motor propõe o resultado e o mestre
 * confirma ou faz override (Fase 4).
 */

export const ActivationSchema = z.enum(['action', 'bonus_action', 'reaction', 'legendary']);
export type Activation = z.infer<typeof ActivationSchema>;

/** Limite de uso: recarga (`Recharge 5–6`) ou usos por descanso/dia. */
export const ActionLimitSchema = z.union([
  z.strictObject({ recharge: z.int().min(2).max(6) }),
  z.strictObject({ per: z.union([RestSchema, z.literal('day')]), count: z.int().positive() }),
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
  attackKind: z.enum(['melee', 'ranged']),
  toHit: z.int(),
  /** Alcance corpo a corpo (`reach`) ou distância (`range`/`longRange`) em pés. */
  reach: FeetSchema.positive().optional(),
  range: FeetSchema.positive().optional(),
  longRange: FeetSchema.positive().optional(),
  damage: z.array(DamageSchema).min(1),
  /** Condições aplicadas ao acertar. */
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
  onFailConditions: z.array(ConditionSchema).default([]),
});

/** Ação sem resolução automática: só texto para o mestre. */
export const TextActionSchema = z.strictObject({
  ...actionBase,
  kind: z.literal('text'),
  description: TextSchema,
});

export const ActionSchema = z.discriminatedUnion('kind', [AttackActionSchema, SaveActionSchema, TextActionSchema]);
export type Action = z.infer<typeof ActionSchema>;
