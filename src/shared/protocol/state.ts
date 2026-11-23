import { ABILITY_ROLL_SETS, BaseScoresSchema, CharacterSchema, EffectSchema, InventorySchema, SizeSchema } from 'rules-engine/schemas';
import { z } from 'zod';
import { MAX_ADJUSTMENT_EFFECTS, MAX_ADJUSTMENTS } from './constants';
import { ChatTextSchema, LabelSchema, MapCellPxSchema, MapCellsSchema, NameSchema, PointSchema, Sha256Schema, UuidSchema } from './common';

/** `SessionState` (docs/network-protocol.md, seção 5). */

export const RoleSchema = z.enum(['gm', 'player']);
export type Role = z.infer<typeof RoleSchema>;

export const VisibilitySchema = z.enum(['public', 'gm']);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const PlayerSchema = z.strictObject({
  displayName: NameSchema,
  role: RoleSchema,
  connected: z.boolean(),
});
export type Player = z.infer<typeof PlayerSchema>;

const entryBase = { id: UuidSchema, at: z.int().nonnegative(), authorId: UuidSchema };

export const ChatEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('message'), ...entryBase, text: ChatTextSchema }),
  z.strictObject({
    kind: z.literal('roll'),
    ...entryBase,
    formula: z.string().min(1),
    label: LabelSchema.optional(),
    visibility: VisibilitySchema,
    rolls: z.array(z.strictObject({ sides: z.int().positive(), value: z.int().positive() })),
    total: z.int(),
  }),
  /** Rolagem do mestre vista por um jogador (seção 2.12): sem fórmula, rótulo nem resultado. */
  z.strictObject({ kind: z.literal('hidden_roll'), ...entryBase }),
  /** Atributos rolados pelo Host para um personagem (`character.roll_scores`): seis vezes 4d6, descartando o menor. */
  z.strictObject({
    kind: z.literal('ability_roll'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    sets: z
      .array(z.strictObject({ dice: z.array(z.int().min(1).max(6)).length(4), dropped: z.int().min(0).max(3), total: z.int().min(3).max(18) }))
      .length(ABILITY_ROLL_SETS),
  }),
]);
export type ChatEntry = z.infer<typeof ChatEntrySchema>;

export const MapSchema = z.strictObject({
  id: UuidSchema,
  name: NameSchema,
  /** Em células. */
  width: MapCellsSchema,
  height: MapCellsSchema,
  background: Sha256Schema.nullable(),
  /** Pixels da imagem de fundo por célula do grid, ou `null` (mapa sem fundo ou legado esticado). */
  cellPx: MapCellPxSchema.nullable(),
});
export type GameMap = z.infer<typeof MapSchema>;

export const TokenSchema = z.strictObject({
  id: UuidSchema,
  mapId: UuidSchema,
  name: NameSchema,
  position: PointSchema,
  size: SizeSchema,
  monsterId: z.string().min(1).nullable(),
  image: Sha256Schema.nullable(),
  ownerIds: z.array(UuidSchema),
  /** Personagem representado pelo token, ou `null` (monstro, objeto). */
  characterId: UuidSchema.nullable(),
});
export type Token = z.infer<typeof TokenSchema>;

/**
 * Ajuste do mestre (bênção, maldição, item caseiro): efeitos do catálogo
 * (docs/effects-spec.md) por cima do cálculo base, sem mexer nas escolhas.
 */
export const SessionAdjustmentSchema = z.strictObject({
  id: UuidSchema,
  name: NameSchema,
  effects: z.array(EffectSchema).min(1).max(MAX_ADJUSTMENT_EFFECTS),
});
export type SessionAdjustment = z.infer<typeof SessionAdjustmentSchema>;

/** Valor de atributo rolado (3 a 18). */
const RolledScoreSchema = z.int().min(3).max(18);

/**
 * Personagem da campanha: as escolhas de construção e o inventário (o motor
 * calcula a ficha). `baseScores` fica `null` até os atributos serem definidos;
 * `rolledScores` guarda os valores rolados pelo Host, os únicos aceitos no método `rolled`.
 */
export const SessionCharacterSchema = z.strictObject({
  id: UuidSchema,
  ownerId: UuidSchema,
  name: NameSchema,
  baseScores: BaseScoresSchema.nullable(),
  rolledScores: z.array(RolledScoreSchema).length(ABILITY_ROLL_SETS).nullable(),
  steps: CharacterSchema.shape.steps,
  /** Estado separado das escolhas: muda o tempo todo, só por `Intent` ao Host. */
  inventory: InventorySchema,
  /** Ajustes do mestre, na ordem em que foram aplicados. */
  adjustments: z.array(SessionAdjustmentSchema).max(MAX_ADJUSTMENTS),
});
export type SessionCharacter = z.infer<typeof SessionCharacterSchema>;

export const SessionStateSchema = z.strictObject({
  campaign: z.strictObject({ id: UuidSchema, name: NameSchema }),
  players: z.record(UuidSchema, PlayerSchema),
  chat: z.array(ChatEntrySchema),
  maps: z.record(UuidSchema, MapSchema),
  activeMapId: UuidSchema.nullable(),
  tokens: z.record(UuidSchema, TokenSchema),
  characters: z.record(UuidSchema, SessionCharacterSchema),
});
export type SessionState = z.infer<typeof SessionStateSchema>;
