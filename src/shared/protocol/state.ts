import { SizeSchema } from 'rules-engine';
import { z } from 'zod';
import { ChatTextSchema, LabelSchema, MapCellsSchema, NameSchema, PointSchema, Sha256Schema, UuidSchema } from './common';

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
]);
export type ChatEntry = z.infer<typeof ChatEntrySchema>;

export const MapSchema = z.strictObject({
  id: UuidSchema,
  name: NameSchema,
  /** Em células. */
  width: MapCellsSchema,
  height: MapCellsSchema,
  background: Sha256Schema.nullable(),
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
});
export type Token = z.infer<typeof TokenSchema>;

export const SessionStateSchema = z.strictObject({
  campaign: z.strictObject({ id: UuidSchema, name: NameSchema }),
  players: z.record(UuidSchema, PlayerSchema),
  chat: z.array(ChatEntrySchema),
  maps: z.record(UuidSchema, MapSchema),
  activeMapId: UuidSchema.nullable(),
  tokens: z.record(UuidSchema, TokenSchema),
});
export type SessionState = z.infer<typeof SessionStateSchema>;
