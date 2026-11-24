import { ABILITY_ROLL_SETS, AbilitySchema, BaseScoresSchema, CharacterSchema, ConditionSchema, DamageTypeSchema, EffectSchema, InventorySchema, SizeSchema, TriggerMomentSchema, WeaponMasterySchema } from 'rules-engine/schemas';
import { z } from 'zod';
import { MAX_ADJUSTMENT_EFFECTS, MAX_ADJUSTMENTS, MAX_COMBATANTS, MAX_HIT_POINTS, MAX_INITIATIVE, MAX_SAVE_TARGETS, MAX_TURN_TRIGGER_ITEMS, MIN_INITIATIVE } from './constants';
import { ChatTextSchema, ConcentrationSchema, ConditionStateSchema, DeathSavesSchema, HitPointStateSchema, InstanceIdSchema, LabelSchema, TableConditionSchema, TurnExpirySchema, SheetRollTargetSchema, MapCellPxSchema, MapCellsSchema, NameSchema, PointSchema, Sha256Schema, UuidSchema } from './common';

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

/** Maestrias com ação de seguimento (`mastery.use`, nota 0038). */
export const MasteryActionSchema = z.enum(['cleave', 'graze', 'topple']);
export type MasteryActionKind = z.infer<typeof MasteryActionSchema>;

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
    /** Arma da ficha que fez o ataque (ausente em ações de monstro). */
    weapon: z.strictObject({ characterId: UuidSchema, instanceId: InstanceIdSchema }).optional(),
    /** Maestria da arma: o que ela faz agora e a ação de seguimento, se houver. */
    mastery: z.strictObject({ property: WeaponMasterySchema, action: MasteryActionSchema.optional(), notes: LogList }).optional(),
    /** Segundo ataque do Cleave: o `attack_roll` de origem. */
    masteryOf: UuidSchema.optional(),
  }),
  /** Salvaguarda forçada (`save.force`): a CD, o dano rolado uma vez e o resultado de cada alvo. */
  z.strictObject({
    kind: z.literal('save_roll'),
    ...entryBase,
    /** Quem causa o efeito (token do monstro, ou quem pediu, num efeito informado). */
    actorName: NameSchema,
    label: LabelSchema,
    ability: AbilitySchema,
    dc: z.int().min(1).max(40),
    onSuccess: z.enum(['half', 'none']),
    visibility: VisibilitySchema,
    /** Dano rolado uma vez para todos os alvos (antes de sucesso e defesas). */
    damage: z.strictObject({ groups: z.array(DamageGroupSchema).min(1).max(20), total: z.int().nonnegative() }).optional(),
    /** Condições que a falha impõe (aplicar é da Fase 5). */
    conditions: z.array(ConditionSchema).max(15),
    /** Salvaguarda do Topple: o `attack_roll` de origem. */
    masteryOf: UuidSchema.optional(),
    results: z
      .array(
        z.strictObject({
          targetTokenId: UuidSchema,
          targetName: NameSchema,
          mode: d20Fields.mode,
          dice: d20Fields.dice,
          natural: d20Fields.natural,
          modifier: z.int(),
          total: z.int(),
          success: z.boolean(),
          advantage: LogList,
          disadvantage: LogList,
          notes: LogList,
          reminders: LogList,
          damage: z.strictObject({ total: z.int().nonnegative(), defenses: LogList, proposalId: UuidSchema.optional() }).optional(),
        }),
      )
      .min(1)
      .max(MAX_SAVE_TARGETS),
  }),
  /** Dano do Graze (`mastery.use`): o modificador do ataque, mesmo errando, depois das defesas do alvo. */
  z.strictObject({
    kind: z.literal('mastery_damage'),
    ...entryBase,
    /** O `attack_roll` de origem. */
    masteryOf: UuidSchema,
    property: z.literal('graze'),
    attackerName: NameSchema,
    label: LabelSchema,
    targetTokenId: UuidSchema,
    targetName: NameSchema,
    visibility: VisibilitySchema,
    damageType: DamageTypeSchema,
    /** O modificador do atributo do ataque (o dano antes das defesas). */
    amount: z.int().positive(),
    total: z.int().nonnegative(),
    defenses: LogList,
    proposalId: UuidSchema.optional(),
  }),
  /** Iniciativa rolada pelo Host (`combat.start`, `combat.add`): o resultado de cada token. */
  z.strictObject({
    kind: z.literal('initiative_roll'),
    ...entryBase,
    results: z
      .array(
        z.strictObject({
          tokenId: UuidSchema,
          name: NameSchema,
          mode: d20Fields.mode,
          dice: d20Fields.dice,
          natural: d20Fields.natural,
          modifier: z.int(),
          total: z.int(),
          /** Surpresa, regras do d20 da ficha, token sem bônus conhecido. */
          notes: LogList,
        }),
      )
      .max(MAX_COMBATANTS),
  }),
  /** Condição posta ou tirada, ou nível de Exaustão novo (`condition.*`, `exhaustion.set`). */
  z.strictObject({
    kind: z.literal('condition_changed'),
    ...entryBase,
    /** O token ou o personagem que mudou (token de personagem grava no personagem). */
    target: z.union([z.strictObject({ characterId: UuidSchema }), z.strictObject({ tokenId: UuidSchema })]),
    targetName: NameSchema,
    change: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('added'), condition: TableConditionSchema }),
      z.strictObject({ kind: z.literal('removed'), condition: TableConditionSchema }),
      z.strictObject({ kind: z.literal('exhaustion'), from: z.int().min(0).max(6), to: z.int().min(0).max(6) }),
    ]),
    /** Imunidade ignorada pelo mestre, morte no nível 6 de Exaustão. */
    notes: LogList,
  }),
  /** Efeito temporário de maestria (Sap, Vex, Slow) que começou ou terminou. */
  z.strictObject({
    kind: z.literal('timed_effect'),
    ...entryBase,
    event: z.enum(['started', 'ended']),
    effect: z.enum(['sap', 'vex', 'slow']),
    sourceName: NameSchema,
    targetTokenId: UuidSchema,
    targetName: NameSchema,
  }),
  /** Concentração que começou, terminou ou resistiu ao dano sem salvaguarda (nota 0045). */
  z.strictObject({
    kind: z.literal('concentration'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    spellName: NameSchema,
    event: z.enum(['started', 'ended', 'kept']),
    /** Por que terminou (só em `ended`). */
    reason: z.enum(['replaced', 'ended', 'failed_save', 'incapacitated', 'dead']).optional(),
    notes: LogList,
  }),
  /** Salvaguarda de Constituição para manter a Concentração, rolada pelo Host ao sofrer dano. */
  z.strictObject({
    kind: z.literal('concentration_save'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    spellName: NameSchema,
    dc: z.int().min(10).max(30),
    mode: d20Fields.mode,
    dice: d20Fields.dice,
    natural: d20Fields.natural,
    modifier: z.int(),
    total: z.int(),
    success: z.boolean(),
    advantage: LogList,
    disadvantage: LogList,
    notes: LogList,
  }),
  /** Salvaguarda contra a Morte rolada pelo Host (início do turno, ou `roll.d20` fora do combate; nota 0044). */
  z.strictObject({
    kind: z.literal('death_save'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    mode: d20Fields.mode,
    dice: d20Fields.dice,
    natural: d20Fields.natural,
    modifier: z.int(),
    total: z.int(),
    outcome: z.enum(['success', 'failure', 'two_failures', 'revived']),
    /** O estado depois da rolagem. */
    deathSaves: DeathSavesSchema,
    /** Vantagens, regras do d20, Estável, morte. */
    notes: LogList,
  }),
  /** Mudança nas Salvaguardas contra a Morte fora da rolagem: dano, cura, Exaustão 6 ou o mestre. */
  z.strictObject({
    kind: z.literal('death_state'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    cause: z.enum(['damage', 'healing', 'gm', 'exhaustion']),
    deathSaves: DeathSavesSchema,
    notes: LogList,
  }),
  /** Lembretes e cura de um combatente num momento do combate (efeitos `reminder` e `turn_start_heal`, nota 0043). */
  z.strictObject({
    kind: z.literal('turn_trigger'),
    ...entryBase,
    on: TriggerMomentSchema,
    tokenId: UuidSchema,
    name: NameSchema,
    items: z
      .array(
        z.strictObject({
          /** A característica que gerou o item ("Heroic Rally (Champion)"). */
          source: LabelSchema,
          /** O lembrete (pt-BR); ausente na cura. */
          text: z.string().min(1).max(500).optional(),
          /** PV recuperados de fato pela cura do início do turno. */
          healed: z.int().positive().optional(),
        }),
      )
      .min(1)
      .max(MAX_TURN_TRIGGER_ITEMS),
  }),
  /** Marco do combate: começou, rodada nova, terminou. */
  z.strictObject({
    kind: z.literal('combat_event'),
    ...entryBase,
    event: z.enum(['started', 'round', 'ended']),
    round: z.int().min(1),
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
  /** Condições do token; vazias num token de personagem (valem as do personagem). */
  conditions: ConditionStateSchema,
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
  /** Condições postas na mesa e o nível de Exaustão (entram na ficha). */
  conditions: ConditionStateSchema,
  /** Salvaguardas contra a Morte (nota 0044). */
  deathSaves: DeathSavesSchema,
  /** Magia em que se concentra, ou `null` (nota 0045). */
  concentration: ConcentrationSchema.nullable(),
});
export type SessionCharacter = z.infer<typeof SessionCharacterSchema>;

/** Dano proposto por um ataque, esperando o mestre aplicar ou descartar. Só o mestre vê. */
export const DamageProposalSchema = z.strictObject({
  id: UuidSchema,
  /** Entrada `attack_roll`, `save_roll` ou `mastery_damage` que gerou a proposta. */
  entryId: UuidSchema,
  targetTokenId: UuidSchema,
  targetName: NameSchema,
  amount: z.int().nonnegative(),
});
export type DamageProposal = z.infer<typeof DamageProposalSchema>;

export const InitiativeSchema = z.int().min(MIN_INITIATIVE).max(MAX_INITIATIVE);

/** Combatente: o token e a iniciativa (`null` para quem não pode ver, seção 2.12). */
export const CombatantSchema = z.strictObject({
  tokenId: UuidSchema,
  initiative: InitiativeSchema.nullable(),
  /** Desempate: o modificador da iniciativa (`null` como a iniciativa). */
  modifier: z.int().nullable(),
});
export type Combatant = z.infer<typeof CombatantSchema>;

/** Efeito temporário de uma maestria, preso ao próximo turno do atacante (nota 0042). */
export const TimedEffectSchema = z.strictObject({
  id: UuidSchema,
  kind: z.enum(['sap', 'vex', 'slow']),
  sourceTokenId: UuidSchema,
  targetTokenId: UuidSchema,
  until: TurnExpirySchema,
});
export type TimedEffect = z.infer<typeof TimedEffectSchema>;

/** Combate em andamento: a rodada, o combatente da vez, a ordem de turnos e os efeitos temporários. */
export const CombatSchema = z
  .strictObject({
    round: z.int().min(1),
    turn: z.int().min(0),
    combatants: z.array(CombatantSchema).min(1).max(MAX_COMBATANTS),
    /** Combates gravados antes da versão 13 não têm o campo: começam sem efeitos. */
    effects: z.array(TimedEffectSchema).max(MAX_COMBATANTS * 4).default([]),
  })
  .refine((c) => c.turn < c.combatants.length, { message: 'turno fora da ordem' })
  .refine((c) => new Set(c.combatants.map((x) => x.tokenId)).size === c.combatants.length, { message: 'token repetido no combate' });
export type Combat = z.infer<typeof CombatSchema>;

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
  /** Combate em andamento, ou `null`. */
  combat: CombatSchema.nullable(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;
