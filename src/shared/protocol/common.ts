import { AbilitySchema, ConditionSchema, IdSchema, SkillSchema } from 'rules-engine/schemas';
import { z } from 'zod';
import { MAX_CELL_PX, MAX_MAP_CELLS } from './constants';

/** Ids de mensagens, jogadores, campanhas e de tudo o que o Host gera. */
export const UuidSchema = z.uuid();

/** SHA-256 de um asset: 64 caracteres hexadecimais minúsculos. */
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 inválido');

/** Posição em unidades de mundo (canto superior esquerdo do token). */
export const PointSchema = z.strictObject({ x: z.int().nonnegative(), y: z.int().nonnegative() });
export type Point = z.infer<typeof PointSchema>;

/** Orientação do token em graus (0..359, sentido horário). */
export const TokenRotationSchema = z.int().min(0).max(359);

/** Elevação do token em pés (−1000..1000). */
export const TokenElevationSchema = z.int().min(-1000).max(1000);

/** Id de uma entrada do inventário (gerado pelo Host). */
export const InstanceIdSchema = z.string().min(1).max(64);

/** PV sofridos e temporários (os PV atuais são o máximo menos o dano; o máximo é derivado). */
export const HitPointStateSchema = z.strictObject({ damage: z.int().nonnegative(), temp: z.int().nonnegative() });

/** Condição que se põe e tira na mesa (a Exaustão tem nível, à parte). */
export const TableConditionSchema = ConditionSchema.exclude(['exhaustion']);
export type TableCondition = z.infer<typeof TableConditionSchema>;

/** Nível máximo de Exaustão (SRD 5.2.1: no 6, a criatura morre). */
export const MAX_EXHAUSTION_LEVEL = 6;

/** Início ou fim de um turno. */
export const TurnEdgeSchema = z.enum(['turn_start', 'turn_end']);

/** Até o início ou o fim do turno de um combatente numa rodada (durações por turno, nota 0042). */
export const TurnExpirySchema = z.strictObject({ at: TurnEdgeSchema, tokenId: UuidSchema, round: z.int().min(1) });
export type TurnExpiryValue = z.infer<typeof TurnExpirySchema>;

/** Condições ativas de uma criatura na mesa e o nível de Exaustão. */
/** Condição imposta por uma magia (nota 0056): quem conjurou e a magia; com Concentração, cai quando ela acaba. */
export const ConditionSpellSchema = z.union([z.strictObject({ characterId: UuidSchema, spellId: IdSchema }), z.strictObject({ tokenId: UuidSchema, spellId: IdSchema })]);
/** Quem conjurou (personagem, ou monstro pelo token; nota 0067) e a magia. */
export type SpellLink = z.infer<typeof ConditionSpellSchema>;

/** A mesma magia, conjurada por quem. */
export const sameSpellLink = (a: SpellLink | undefined, b: SpellLink): boolean => a?.spellId === b.spellId && sameCaster(a, b);

/** Conjuradas pelo mesmo personagem ou monstro. */
export function sameCaster(a: SpellLink, b: SpellLink): boolean {
  if ('characterId' in a) return 'characterId' in b && a.characterId === b.characterId;
  return 'tokenId' in b && a.tokenId === b.tokenId;
}

export const ConditionStateSchema = z.strictObject({
  active: z
    .array(z.strictObject({ condition: TableConditionSchema, until: TurnExpirySchema.optional(), spell: ConditionSpellSchema.optional(), /** Sai junto com esta (Impedido enquanto Agarrado; nota 0065). */ with: TableConditionSchema.optional(), /** Acaba se o alvo sofrer dano, menos o do uso `entryId` (Turn Undead; nota 0082). */ endsOnDamage: z.strictObject({ entryId: UuidSchema }).optional() }))
    .max(TableConditionSchema.options.length)
    .refine((list) => new Set(list.map((c) => c.condition)).size === list.length, { message: 'condição repetida' }),
  exhaustion: z.int().min(0).max(MAX_EXHAUSTION_LEVEL),
});
export type ConditionState = z.infer<typeof ConditionStateSchema>;

/** Sem condições. */
export const NO_CONDITIONS: ConditionState = { active: [], exhaustion: 0 };

/** Salvaguardas contra a Morte de um personagem (nota 0044). */
export const DeathSavesSchema = z.strictObject({
  successes: z.int().min(0).max(3),
  failures: z.int().min(0).max(3),
  stable: z.boolean(),
  dead: z.boolean(),
});
export type DeathSaves = z.infer<typeof DeathSavesSchema>;

/** Magia em que o personagem se concentra (nota 0045); o nome vem do compêndio, para o chat e a tela. */
export const ConcentrationSchema = z.strictObject({ spellId: z.string().min(1).max(64), name: z.string().min(1).max(100) });
export type Concentration = z.infer<typeof ConcentrationSchema>;

/** Tamanhos de Dado de Vida das classes. */
export const HitDieSchema = z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]);

/** Dados de Vida gastos por tamanho do dado, como texto ("10": 2) (nota 0050). */
export const HitDiceSpentSchema = z.partialRecord(z.enum(['6', '8', '10', '12']), z.int().min(1).max(20));

/** Espaços de magia gastos: por círculo ("1": 2) e os da Magia de Pacto (nota 0051). */
export const SpellSlotsSpentSchema = z.strictObject({
  byLevel: z.partialRecord(z.enum(['1', '2', '3', '4', '5', '6', '7', '8', '9']), z.int().min(1).max(20)),
  pact: z.int().min(0).max(10),
});

/** Usos gastos de cada recurso, pelo id do recurso (nota 0052). */
export const ResourcesSpentSchema = z.record(z.string().regex(/^[a-z0-9_]+$/).max(64), z.int().min(1).max(1000));

/** Um espaço de magia: de um círculo, ou da Magia de Pacto. */
export const SpellSlotRefSchema = z.union([z.strictObject({ level: z.int().min(1).max(9) }), z.literal('pact')]);
export type SpellSlotRef = z.infer<typeof SpellSlotRefSchema>;

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
