import { AbilitySchema, ConditionSchema, SkillSchema } from 'rules-engine/schemas';
import { z } from 'zod';
import { MAX_CELL_PX, MAX_MAP_CELLS } from './constants';

/** Ids de mensagens, jogadores, campanhas e de tudo o que o Host gera. */
export const UuidSchema = z.uuid();

/** SHA-256 de um asset: 64 caracteres hexadecimais minúsculos. */
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 inválido');

/** Posição em unidades de mundo (canto superior esquerdo do token). */
export const PointSchema = z.strictObject({ x: z.int().nonnegative(), y: z.int().nonnegative() });
export type Point = z.infer<typeof PointSchema>;

/** Id de uma entrada do inventário (gerado pelo Host). */
export const InstanceIdSchema = z.string().min(1).max(64);

/** PV sofridos e temporários (os PV atuais são o máximo menos o dano; o máximo é derivado). */
export const HitPointStateSchema = z.strictObject({ damage: z.int().nonnegative(), temp: z.int().nonnegative() });

/** Condição que se põe e tira na mesa (a Exaustão tem nível, à parte). */
export const TableConditionSchema = ConditionSchema.exclude(['exhaustion']);
export type TableCondition = z.infer<typeof TableConditionSchema>;

/** Nível máximo de Exaustão (SRD 5.2.1: no 6, a criatura morre). */
export const MAX_EXHAUSTION_LEVEL = 6;

/** Condições ativas de uma criatura na mesa e o nível de Exaustão. */
export const ConditionStateSchema = z.strictObject({
  active: z
    .array(z.strictObject({ condition: TableConditionSchema }))
    .max(TableConditionSchema.options.length)
    .refine((list) => new Set(list.map((c) => c.condition)).size === list.length, { message: 'condição repetida' }),
  exhaustion: z.int().min(0).max(MAX_EXHAUSTION_LEVEL),
});
export type ConditionState = z.infer<typeof ConditionStateSchema>;

/** Sem condições. */
export const NO_CONDITIONS: ConditionState = { active: [], exhaustion: 0 };

/** Alvo de PV e condições: um personagem, ou um token. */
export const CreatureTargetSchema = z.union([z.strictObject({ characterId: UuidSchema }), z.strictObject({ tokenId: UuidSchema })]);
export type CreatureTarget = z.infer<typeof CreatureTargetSchema>;

/** O que se rola a partir da ficha (`roll.d20`). */
export const SheetRollTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('skill'), skill: SkillSchema }),
  z.strictObject({ kind: z.literal('save'), ability: AbilitySchema }),
  z.strictObject({ kind: z.literal('initiative') }),
  z.strictObject({ kind: z.literal('death_save') }),
  z.strictObject({ kind: z.literal('attack'), instanceId: z.string().min(1).max(64) }),
]);
export type SheetRollTarget = z.infer<typeof SheetRollTargetSchema>;

/** O que uma salvaguarda evita (`roll.against` do motor): uma condição e/ou a origem mágica. */
export const RollAgainstSchema = z
  .strictObject({ condition: ConditionSchema.optional(), source: z.enum(['spell', 'magic']).optional() })
  .refine((a) => a.condition !== undefined || a.source !== undefined, { message: 'informe a condição ou a origem' });

export const NameSchema = z.string().min(1).max(100);
export const LabelSchema = z.string().min(1).max(100);
export const ChatTextSchema = z.string().min(1).max(2000);
/** Mapas têm de 1 a 200 células por lado. */
export const MapCellsSchema = z.int().min(1).max(MAX_MAP_CELLS);
/** Pixels da imagem de fundo por célula do grid. */
export const MapCellPxSchema = z.int().min(1).max(MAX_CELL_PX);
