import { AbilitySchema, BaseScoresSchema, CharacterSchema, ConditionSchema, DamageTypeSchema, DiceSchema, EffectSchema, IdSchema, SizeSchema } from 'rules-engine/schemas';
import { z } from 'zod';
import { ChatTextSchema, InstanceIdSchema, LabelSchema, RollAgainstSchema, SheetRollTargetSchema, MapCellPxSchema, MapCellsSchema, NameSchema, PointSchema, Sha256Schema, UuidSchema } from './common';
import { MAX_ADJUSTMENT_EFFECTS, MAX_COINS, MAX_FORMULA_DICE, MAX_FORMULA_LENGTH, MAX_HIT_POINTS, MAX_ITEM_QUANTITY, MAX_SAVE_TARGETS } from './constants';
import { VisibilitySchema } from './state';

/** Catálogo de `Intent` (docs/network-protocol.md, seção 3). */

/** Quantidade de dados de uma fórmula (`2d6+1d4+3` → 3). */
export function countDice(formula: string): number {
  let count = 0;
  for (const [, n] of formula.matchAll(/(\d+)d\d+/g)) count += Number(n);
  return count;
}

/** Fórmula de `dice.roll`: formato de dados do motor, com limites para o Host não travar. */
export const FormulaSchema = DiceSchema.max(MAX_FORMULA_LENGTH).refine((f) => countDice(f) <= MAX_FORMULA_DICE, {
  message: `no máximo ${MAX_FORMULA_DICE} dados`,
});

const QuantitySchema = z.int().min(1).max(MAX_ITEM_QUANTITY);
const CoinsSchema = z.int().min(0).max(MAX_COINS);

export const IntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('session.resync'), data: z.strictObject({}) }),
  z.strictObject({ kind: z.literal('chat.message'), data: z.strictObject({ text: ChatTextSchema }) }),
  z.strictObject({
    kind: z.literal('dice.roll'),
    data: z.strictObject({ formula: FormulaSchema, label: LabelSchema.optional(), visibility: VisibilitySchema }),
  }),
  z.strictObject({ kind: z.literal('token.move'), data: z.strictObject({ tokenId: UuidSchema, to: PointSchema }) }),
  z.strictObject({
    kind: z.literal('map.create'),
    data: z.strictObject({
      name: NameSchema,
      width: MapCellsSchema,
      height: MapCellsSchema,
      background: Sha256Schema.optional(),
      cellPx: MapCellPxSchema.optional(),
    }),
  }),
  z.strictObject({ kind: z.literal('map.activate'), data: z.strictObject({ mapId: UuidSchema }) }),
  z.strictObject({
    kind: z.literal('token.create'),
    data: z.strictObject({
      mapId: UuidSchema,
      name: NameSchema,
      position: PointSchema,
      size: SizeSchema,
      monsterId: z.string().min(1).optional(),
      image: Sha256Schema.optional(),
      ownerIds: z.array(UuidSchema).optional(),
      characterId: UuidSchema.optional(),
      /** PV máximos do token; sem isso, o de um monstro é a média do bloco de estatísticas. */
      hpMax: z.int().min(1).max(MAX_HIT_POINTS).optional(),
    }),
  }),
  z.strictObject({ kind: z.literal('token.remove'), data: z.strictObject({ tokenId: UuidSchema }) }),
  z.strictObject({ kind: z.literal('character.create'), data: z.strictObject({ name: NameSchema, ownerId: UuidSchema.optional() }) }),
  z.strictObject({
    kind: z.literal('character.update'),
    data: z
      .strictObject({
        characterId: UuidSchema,
        name: NameSchema.optional(),
        baseScores: BaseScoresSchema.optional(),
        steps: CharacterSchema.shape.steps.optional(),
      })
      .refine((d) => d.name !== undefined || d.baseScores !== undefined || d.steps !== undefined, { message: 'nada para alterar' }),
  }),
  z.strictObject({ kind: z.literal('character.roll_scores'), data: z.strictObject({ characterId: UuidSchema }) }),
  z.strictObject({ kind: z.literal('character.remove'), data: z.strictObject({ characterId: UuidSchema }) }),
  z.strictObject({
    kind: z.literal('inventory.add'),
    data: z.strictObject({
      characterId: UuidSchema,
      itemId: IdSchema,
      baseItemId: IdSchema.optional(),
      variantId: IdSchema.optional(),
      quantity: QuantitySchema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('inventory.remove'),
    data: z.strictObject({ characterId: UuidSchema, instanceId: InstanceIdSchema, quantity: QuantitySchema.optional() }),
  }),
  z.strictObject({
    kind: z.literal('inventory.update'),
    data: z
      .strictObject({
        characterId: UuidSchema,
        instanceId: InstanceIdSchema,
        equipped: z.boolean().optional(),
        attuned: z.boolean().optional(),
        quantity: QuantitySchema.optional(),
      })
      .refine((d) => d.equipped !== undefined || d.attuned !== undefined || d.quantity !== undefined, { message: 'nada para alterar' }),
  }),
  z.strictObject({
    kind: z.literal('inventory.currency'),
    data: z.strictObject({
      characterId: UuidSchema,
      currency: z.strictObject({ cp: CoinsSchema, sp: CoinsSchema, ep: CoinsSchema, gp: CoinsSchema, pp: CoinsSchema }),
    }),
  }),
  z.strictObject({
    kind: z.literal('adjustment.add'),
    data: z.strictObject({ characterId: UuidSchema, name: NameSchema, effects: z.array(EffectSchema).min(1).max(MAX_ADJUSTMENT_EFFECTS) }),
  }),
  z.strictObject({ kind: z.literal('adjustment.remove'), data: z.strictObject({ characterId: UuidSchema, adjustmentId: UuidSchema }) }),
  z.strictObject({
    kind: z.literal('roll.d20'),
    data: z.strictObject({
      characterId: UuidSchema,
      target: SheetRollTargetSchema,
      /** Vantagem/Desvantagem declarada na hora; anula-se com a oposta, como qualquer outra. */
      advantage: z.boolean().optional(),
      disadvantage: z.boolean().optional(),
      visibility: VisibilitySchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('roll.damage'),
    data: z.strictObject({
      characterId: UuidSchema,
      instanceId: InstanceIdSchema,
      critical: z.boolean().optional(),
      versatile: z.boolean().optional(),
      visibility: VisibilitySchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('attack.make'),
    data: z.strictObject({
      /** Arma equipada de um personagem, ou ação de ataque do monstro de um token. */
      attacker: z.union([
        z.strictObject({ characterId: UuidSchema, instanceId: InstanceIdSchema }),
        z.strictObject({ tokenId: UuidSchema, actionId: IdSchema }),
      ]),
      targetTokenId: UuidSchema,
      advantage: z.boolean().optional(),
      disadvantage: z.boolean().optional(),
      visibility: VisibilitySchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('save.force'),
    data: z.strictObject({
      /** Ação de salvaguarda do monstro de um token, ou um efeito informado (magia de personagem, armadilha). */
      source: z.union([
        z.strictObject({ tokenId: UuidSchema, actionId: IdSchema }),
        z.strictObject({
          custom: z.strictObject({
            name: LabelSchema,
            ability: AbilitySchema,
            dc: z.int().min(1).max(40),
            damage: z.array(z.strictObject({ dice: FormulaSchema, type: DamageTypeSchema })).max(5),
            onSuccess: z.enum(['half', 'none']),
            conditions: z.array(ConditionSchema).max(15).optional(),
          }),
        }),
      ]),
      targetTokenIds: z
        .array(UuidSchema)
        .min(1)
        .max(MAX_SAVE_TARGETS)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'alvo repetido' }),
      /** O que a salvaguarda evita, para as Vantagens circunstanciais (sem isso, a primeira condição da falha). */
      against: RollAgainstSchema.optional(),
      visibility: VisibilitySchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('mastery.use'),
    data: z.strictObject({
      /** O `attack_roll` cuja maestria será usada. */
      entryId: UuidSchema,
      /** Cleave: o segundo alvo. */
      targetTokenId: UuidSchema.optional(),
      advantage: z.boolean().optional(),
      disadvantage: z.boolean().optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('damage.apply'),
    data: z.strictObject({ proposalId: UuidSchema, amount: z.int().min(0).max(MAX_HIT_POINTS).optional() }),
  }),
  z.strictObject({ kind: z.literal('damage.dismiss'), data: z.strictObject({ proposalId: UuidSchema }) }),
  z.strictObject({
    kind: z.literal('hp.change'),
    data: z.strictObject({
      target: z.union([z.strictObject({ characterId: UuidSchema }), z.strictObject({ tokenId: UuidSchema })]),
      change: z.strictObject({
        /** `max` só em tokens com PV próprios (ex.: PV rolados de um monstro). */
        kind: z.enum(['damage', 'healing', 'temp', 'max']),
        amount: z.int().min(0).max(MAX_HIT_POINTS),
      }),
    }),
  }),
]);
export type Intent = z.infer<typeof IntentSchema>;
export type IntentKind = Intent['kind'];
export type IntentData<K extends IntentKind> = Extract<Intent, { kind: K }>['data'];
