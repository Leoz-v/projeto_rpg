import { z } from 'zod';
import { IdSchema, TextSchema } from './common';

/**
 * Magia do compêndio: só metadados e texto por enquanto. A resolução
 * (ataque, salvaguarda, dano por nível) entra na Fase 4.
 */

export const SpellSchoolSchema = z.enum([
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
]);

export const SpellSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  /** 0 = truque. */
  level: z.int().min(0).max(9),
  school: SpellSchoolSchema,
  castingTime: TextSchema,
  range: TextSchema,
  components: z.strictObject({
    verbal: z.boolean(),
    somatic: z.boolean(),
    material: z.string().min(1).optional(),
  }),
  duration: TextSchema,
  concentration: z.boolean().default(false),
  ritual: z.boolean().default(false),
  /** Classes cuja lista inclui a magia. */
  classes: z.array(IdSchema).default([]),
  description: TextSchema,
});
export type Spell = z.infer<typeof SpellSchema>;
