import { z } from 'zod';
import {
  AbilitySchema,
  AbilityScoresSchema,
  CreatureTypeSchema,
  DiceSchema,
  FeetSchema,
  IdSchema,
  SizeSchema,
  SkillSchema,
  TextSchema,
} from './common';
import { ActionSchema } from './action';
import { EffectSchema } from './effect';

/**
 * Bloco de estatísticas de criatura (monstros e PdMs do compêndio). Os números
 * vêm do SRD como publicados; resistências, imunidades e sentidos são efeitos,
 * interpretados pelo mesmo motor usado nos personagens. O token nasce daqui.
 */

/** Nível de desafio: 0, 1/8, 1/4, 1/2 ou 1–30. */
export const ChallengeRatingSchema = z.union([
  z.literal(0),
  z.literal(0.125),
  z.literal(0.25),
  z.literal(0.5),
  z.int().min(1).max(30),
]);

export const SpeedSchema = z.strictObject({
  walk: FeetSchema.default(30),
  fly: FeetSchema.optional(),
  swim: FeetSchema.optional(),
  climb: FeetSchema.optional(),
  burrow: FeetSchema.optional(),
  hover: z.boolean().optional(),
});

export const TraitSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  description: TextSchema,
  effects: z.array(EffectSchema).default([]),
});

export const CreatureSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  size: SizeSchema,
  type: CreatureTypeSchema,
  /** Rótulos entre parênteses no tipo (ex.: `goblinoid`). */
  tags: z.array(IdSchema).default([]),
  alignment: z.string().optional(),
  ac: z.int().min(0),
  hp: z.strictObject({ average: z.int().positive(), formula: DiceSchema }),
  speed: SpeedSchema,
  abilities: AbilityScoresSchema,
  /** Bônus totais publicados no bloco (só os que diferem do modificador). */
  saves: z.partialRecord(AbilitySchema, z.int()).default({}),
  skills: z.partialRecord(SkillSchema, z.int()).default({}),
  languages: z.array(IdSchema).default([]),
  /** Telepatia em pés, quando houver. */
  telepathy: FeetSchema.positive().optional(),
  cr: ChallengeRatingSchema,
  /** Resistências, imunidades, vulnerabilidades e sentidos. */
  effects: z.array(EffectSchema).default([]),
  traits: z.array(TraitSchema).default([]),
  actions: z.array(ActionSchema).default([]),
});
export type Creature = z.infer<typeof CreatureSchema>;
export type CreatureInput = z.input<typeof CreatureSchema>;
