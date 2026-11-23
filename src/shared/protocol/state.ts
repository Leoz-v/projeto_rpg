import { ABILITY_ROLL_SETS, BaseScoresSchema, CharacterSchema, DamageTypeSchema, EffectSchema, InventorySchema, SizeSchema } from 'rules-engine/schemas';
import { z } from 'zod';
import { MAX_ADJUSTMENT_EFFECTS, MAX_ADJUSTMENTS, MAX_HIT_POINTS } from './constants';
import { ChatTextSchema, HitPointStateSchema, LabelSchema, SheetRollTargetSchema, MapCellPxSchema, MapCellsSchema, NameSchema, PointSchema, Sha256Schema, UuidSchema } from './common';

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

/** Textos curtos do log de uma rolagem (rótulos da conta, fontes, notas). */
const LogText = z.string().min(1).max(200);
const LogList = z.array(LogText).max(50);
const DieSchema = z.strictObject({ sides: z.int().positive(), value: z.int().positive(), rolled: z.int().positive().optional() });
const DamageGroupSchema = z.strictObject({
  dice: z.string().min(1).max(100),
  type: DamageTypeSchema,
  source: LogText.optional(),
  rolls: z.array(DieSchema).max(200),
  total: z.int(),
});
/** O d20 de uma rolagem, no log. */
const d20Fields = {
  mode: z.enum(['normal', 'advantage', 'disadvantage']),
  dice: z.array(z.int().min(1).max(20)).min(1).max(4),
  natural: z.int().min(1).max(20),
  modifier: z.int(),
  total: z.int(),
  critical: z.boolean(),
  fumble: z.boolean(),
  advantage: LogList,
  disadvantage: LogList,
  notes: LogList,
  reminders: LogList,
};

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
  /** Teste d20 a partir da ficha (`roll.d20`): perícia, salvaguarda, iniciativa, morte ou ataque. */
  z.strictObject({
    kind: z.literal('d20_roll'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    target: SheetRollTargetSchema,
    /** Nome do ataque (arma), quando o alvo é um ataque. */
    label: LabelSchema.optional(),
    visibility: VisibilitySchema,
    mode: z.enum(['normal', 'advantage', 'disadvantage']),
    dice: z.array(z.int().min(1).max(20)).min(1).max(4),
    natural: z.int().min(1).max(20),
    modifier: z.int(),
    total: z.int(),
    critical: z.boolean(),
    fumble: z.boolean(),
    /** A conta do modificador. */
    parts: z.array(z.strictObject({ label: LogText, value: z.int() })).max(50),
    advantage: LogList,
    disadvantage: LogList,
    /** O que as regras do d20 fizeram (rolar de novo, mínimo, conta como 20). */
    notes: LogList,
    /** O que pode valer e a ficha não decide sozinha (circunstâncias). */
    reminders: LogList,
  }),
  /** Dano de uma arma da ficha (`roll.damage`). */
  z.strictObject({
    kind: z.literal('damage_roll'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    label: LabelSchema,
    visibility: VisibilitySchema,
    critical: z.boolean(),
    groups: z.array(DamageGroupSchema).min(1).max(20),
    bonus: z.int(),
    total: z.int().nonnegative(),
    dieMinimum: z.strictObject({ value: z.int().positive(), source: LogText }).optional(),
  }),
  /** Ataque contra um token (`attack.make`): o d20 contra a CA e, no acerto, o dano depois das defesas do alvo. */
  z.strictObject({
    kind: z.literal('attack_roll'),
    ...entryBase,
    attackerName: NameSchema,
    /** Nome do ataque (arma ou ação do monstro). */
    label: LabelSchema,
    targetTokenId: UuidSchema,
    targetName: NameSchema,
    visibility: VisibilitySchema,
    ...d20Fields,
    hit: z.boolean(),
    damage: z
      .strictObject({
        groups: z.array(DamageGroupSchema).min(1).max(20),
        bonus: z.int(),
        /** Dano depois de imunidades, resistências e vulnerabilidades do alvo. */
        total: z.int().nonnegative(),
        /** O que as defesas fizeram ("Resistência a Fogo: 10 → 5"). */
        defenses: LogList,
        /** Proposta para o mestre aplicar nos PV. */
        proposalId: UuidSchema,
      })
      .optional(),
  }),
  /** Dano aplicado pelo mestre nos PV de um token (`damage.apply`). */
  z.strictObject({
    kind: z.literal('damage_applied'),
    ...entryBase,
    targetTokenId: UuidSchema,
    targetName: NameSchema,
    amount: z.int().nonnegative(),
    /** O valor proposto, quando o mestre aplicou outro. */
    proposed: z.int().nonnegative().optional(),
    /** Caiu a 0 PV, dano massivo. */
    notes: LogList,
  }),
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
  /**
   * PV do próprio token (monstros, objetos), com o máximo; `null` se não tem
   * (token de personagem: os PV são do personagem). Para jogadores que não são
   * donos do token, chega sempre `null` (seção 2.12).
   */
  hp: HitPointStateSchema.extend({ max: z.int().min(1).max(MAX_HIT_POINTS) }).nullable(),
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
  /** PV sofridos e temporários; o máximo vem da ficha. */
  hp: HitPointStateSchema,
  /** Ajustes do mestre, na ordem em que foram aplicados. */
  adjustments: z.array(SessionAdjustmentSchema).max(MAX_ADJUSTMENTS),
});
export type SessionCharacter = z.infer<typeof SessionCharacterSchema>;

/** Dano proposto por um ataque, esperando o mestre aplicar ou descartar. Só o mestre vê. */
export const DamageProposalSchema = z.strictObject({
  id: UuidSchema,
  /** Entrada `attack_roll` que gerou a proposta. */
  entryId: UuidSchema,
  targetTokenId: UuidSchema,
  targetName: NameSchema,
  amount: z.int().nonnegative(),
});
export type DamageProposal = z.infer<typeof DamageProposalSchema>;

export const SessionStateSchema = z.strictObject({
  campaign: z.strictObject({ id: UuidSchema, name: NameSchema }),
  players: z.record(UuidSchema, PlayerSchema),
  chat: z.array(ChatEntrySchema),
  maps: z.record(UuidSchema, MapSchema),
  activeMapId: UuidSchema.nullable(),
  tokens: z.record(UuidSchema, TokenSchema),
  characters: z.record(UuidSchema, SessionCharacterSchema),
  /** Danos propostos por ataques, para o mestre aplicar (estado da sessão: não é gravado na campanha). */
  proposals: z.record(UuidSchema, DamageProposalSchema),
});
export type SessionState = z.infer<typeof SessionStateSchema>;
