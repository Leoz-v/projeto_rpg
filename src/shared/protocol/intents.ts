import { DiceSchema, SizeSchema } from 'rules-engine/schemas';
import { z } from 'zod';
import { ChatTextSchema, LabelSchema, MapCellsSchema, NameSchema, PointSchema, Sha256Schema, UuidSchema } from './common';
import { MAX_FORMULA_DICE, MAX_FORMULA_LENGTH } from './constants';
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
    data: z.strictObject({ name: NameSchema, width: MapCellsSchema, height: MapCellsSchema, background: Sha256Schema.optional() }),
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
    }),
  }),
  z.strictObject({ kind: z.literal('token.remove'), data: z.strictObject({ tokenId: UuidSchema }) }),
]);
export type Intent = z.infer<typeof IntentSchema>;
export type IntentKind = Intent['kind'];
export type IntentData<K extends IntentKind> = Extract<Intent, { kind: K }>['data'];
