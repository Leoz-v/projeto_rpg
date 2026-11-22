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
import { ActionLimitSchema, ActionSchema } from './action';
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
export type ChallengeRating = z.infer<typeof ChallengeRatingSchema>;

export const SpeedSchema = z.strictObject({
  walk: FeetSchema.default(30),
  fly: FeetSchema.optional(),
  swim: FeetSchema.optional(),
  climb: FeetSchema.optional(),
  burrow: FeetSchema.optional(),
  hover: z.boolean().optional(),
  /** Deslocamentos condicionais, só texto (ex.: `40 ft. (wolf form only)`). */
  note: z.string().optional(),
});

export const TraitSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  /** Usos limitados (ex.: Legendary Resistance 3/Day, 4/Day no covil). */
  limit: ActionLimitSchema.optional(),
  description: TextSchema,
  effects: z.array(EffectSchema).default([]),
});

/** Equipamento listado no bloco (`Gear`). `itemId` quando o item existe no compêndio. */
export const CreatureGearSchema = z.strictObject({
  name: TextSchema,
  itemId: IdSchema.optional(),
  quantity: z.int().positive().optional(),
});

export const CreatureSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  /** Tamanho; mais de um quando o bloco oferece opções ("Medium or Small"). */
  size: z.array(SizeSchema).min(1),
  /** Enxame: tamanho de cada criatura do enxame (`Swarm of Tiny Beasts`). */
  swarmOf: SizeSchema.optional(),
  type: CreatureTypeSchema,
  /** Rótulos entre parênteses no tipo (ex.: `goblinoid`). */
  tags: z.array(IdSchema).default([]),
  alignment: z.string().optional(),
  ac: z.int().min(0),
  /** Bônus de iniciativa publicado (inclui proficiência quando o bloco a soma). */
  initiative: z.int(),
  hp: z.strictObject({ average: z.int().positive(), formula: DiceSchema }),
  speed: SpeedSchema,
  abilities: AbilityScoresSchema,
  /** Bônus totais publicados no bloco (só os que diferem do modificador). */
  saves: z.partialRecord(AbilitySchema, z.int()).default({}),
  skills: z.partialRecord(SkillSchema, z.int()).default({}),
  passivePerception: z.int().min(0),
  /** Idiomas como publicados (ex.: `Understands Common but can't speak`); ausente = nenhum. */
  languages: z.string().optional(),
  /** Telepatia em pés, quando houver. */
  telepathy: FeetSchema.positive().optional(),
  gear: z.array(CreatureGearSchema).default([]),
  cr: ChallengeRatingSchema,
  /** XP pela tabela de ND (0 ou 10 no ND 0) e, quando houver, o valor no covil. */
  xp: z.int().nonnegative(),
  lairXp: z.int().positive().optional(),
  /** Resistências, imunidades, vulnerabilidades e sentidos. */
  effects: z.array(EffectSchema).default([]),
  /** Defesas publicadas que não cabem num efeito (escolha do mestre ou condição complexa). */
  notes: z.array(TextSchema).default([]),
  traits: z.array(TraitSchema).default([]),
  /** Usos de Ação Lendária por rodada (e no covil). */
  legendaryActionUses: z.strictObject({ count: z.int().positive(), lairCount: z.int().positive().optional() }).optional(),
  actions: z.array(ActionSchema).default([]),
});
export type Creature = z.infer<typeof CreatureSchema>;
export type CreatureInput = z.input<typeof CreatureSchema>;
