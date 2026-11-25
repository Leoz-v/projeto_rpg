import { z } from 'zod';
import { AbilitySchema, ConditionSchema, DamageSchema, FeetSchema, IdSchema, RestSchema, SizeSchema, TextSchema } from './common';

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

/**
 * Condições que o acerto ou a falha impõe na hora (nota 0065). A primeira é a
 * principal: `while` são as que duram enquanto ela durar (Impedido enquanto
 * Agarrado). `end` é contado nos turnos do monstro (`actor`) ou do alvo.
 */
export const ImposedConditionsSchema = z.strictObject({
  conditions: z.array(ConditionSchema.exclude(['exhaustion'])).min(1),
  /** Só em alvos deste tamanho ou menores. */
  maxSize: SizeSchema.optional(),
  escapeDc: z.int().min(1).optional(),
  end: z.enum(['actor_turn_start', 'actor_turn_end', 'target_turn_start', 'target_turn_end']).optional(),
  while: z.array(ConditionSchema.exclude(['exhaustion'])).min(1).optional(),
  /** O alvo repete a salvaguarda no fim de cada turno dele (lembrete). */
  repeatSave: z.literal(true).optional(),
});
export type ImposedConditions = z.infer<typeof ImposedConditionsSchema>;

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
  imposes: z.array(ImposedConditionsSchema).default([]),
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
  imposes: z.array(ImposedConditionsSchema).default([]),
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

/**
 * Multiattack (nota 0066): opções de passos, cada passo com quantas vezes e
 * quais ações de ataque ou salvaguarda. `replace`: até `max` trocas, cada uma
 * no lugar de `cost` usos (só da ação `from`, se houver).
 */
export const MultiattackSchema = z.strictObject({
  options: z.array(z.strictObject({ steps: z.array(z.strictObject({ count: z.int().min(1).max(6), actions: z.array(IdSchema).min(1) })).min(1) })).min(1),
  replace: z.strictObject({ max: z.int().min(1).max(6), cost: z.int().min(1).max(2), actions: z.array(IdSchema).min(1), from: IdSchema.optional() }).optional(),
});
export type Multiattack = z.infer<typeof MultiattackSchema>;

/** Ação sem resolução automática: só texto para o mestre (menos o Multiattack, que encadeia as outras). */
export const TextActionSchema = z.strictObject({
  ...actionBase,
  kind: z.literal('text'),
  description: TextSchema,
  multiattack: MultiattackSchema.optional(),
});

export const ActionSchema = z.discriminatedUnion('kind', [
  AttackActionSchema,
  SaveActionSchema,
  SpellcastingActionSchema,
  TextActionSchema,
]);
export type Action = z.infer<typeof ActionSchema>;
