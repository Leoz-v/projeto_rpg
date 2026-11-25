import { ABILITY_ROLL_SETS, AbilitySchema, BaseScoresSchema, CharacterSchema, ConditionSchema, DamageTypeSchema, DiceSchema, EffectSchema, IdSchema, SpellConditionEndSchema, InventorySchema, SizeSchema, TriggerMomentSchema, WeaponMasterySchema } from 'rules-engine/schemas';
import { z } from 'zod';
import { MAX_ADJUSTMENT_EFFECTS, MAX_ADJUSTMENTS, MAX_COMBATANTS, MAX_HIT_POINTS, MAX_INITIATIVE, MAX_SAVE_TARGETS, MAX_SPELL_OPTIONS, MAX_SPELL_PARTS, MAX_TURN_TRIGGER_ITEMS, MIN_INITIATIVE } from './constants';
import { ChatTextSchema, ConcentrationSchema, ConditionSpellSchema, HitDiceSpentSchema, HitDieSchema, SpellSlotRefSchema, SpellSlotsSpentSchema, ResourcesSpentSchema, ConditionStateSchema, DeathSavesSchema, HitPointStateSchema, InstanceIdSchema, LabelSchema, TableConditionSchema, TurnExpirySchema, SheetRollTargetSchema, MapCellPxSchema, MapCellsSchema, NameSchema, PointSchema, Sha256Schema, TokenElevationSchema, TokenRotationSchema, UuidSchema } from './common';
import { MapFogSchema, VisionFeetSchema } from './fog';

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
/**
 * Uma parte da magia já calculada para quem conjurou (notas 0055 e 0056):
 * dados no círculo usado. `count`: ataques ou projéteis (ataque, dano
 * direto) ou o máximo de alvos (salvaguarda, cura, condição; sem ele, sem
 * limite).
 */
const SpellEffectDamageSchema = z.array(z.strictObject({ dice: DiceSchema, type: z.union([DamageTypeSchema, z.array(DamageTypeSchema).min(2).max(13)]) })).max(10);
const SpellEffectCountSchema = z.int().min(1).max(MAX_SAVE_TARGETS);
const SpellEffectConditionsSchema = z.array(ConditionSchema).max(15);
export const SpellEffectPartSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    label: LabelSchema.optional(),
    kind: z.literal('attack'),
    damage: SpellEffectDamageSchema,
    count: SpellEffectCountSchema,
    attackKind: z.enum(['melee', 'ranged']),
    onMiss: z.literal('half').optional(),
    onHitConditions: SpellEffectConditionsSchema,
    conditionsEnd: SpellConditionEndSchema.optional(),
  }),
  z.strictObject({
    label: LabelSchema.optional(),
    kind: z.literal('save'),
    damage: SpellEffectDamageSchema,
    count: SpellEffectCountSchema.optional(),
    ability: AbilitySchema,
    onSuccess: z.enum(['half', 'none']),
    onFailConditions: SpellEffectConditionsSchema,
    conditionChoice: z.literal(true).optional(),
    onFailEffects: z.array(EffectSchema).max(MAX_ADJUSTMENT_EFFECTS).default([]),
    options: z.array(z.strictObject({ label: LabelSchema, effects: z.array(EffectSchema).max(MAX_ADJUSTMENT_EFFECTS) })).max(MAX_SPELL_OPTIONS).default([]),
    conditionsEnd: SpellConditionEndSchema.optional(),
  }),
  z.strictObject({ label: LabelSchema.optional(), kind: z.literal('damage'), damage: SpellEffectDamageSchema, count: SpellEffectCountSchema }),
  z.strictObject({
    label: LabelSchema.optional(),
    kind: z.literal('heal'),
    count: SpellEffectCountSchema.optional(),
    /** Expressão de dados já calculada, ou `full` (todos os PV). */
    healing: z.union([DiceSchema, z.literal('full')]),
    temporary: z.literal(true).optional(),
    endConditions: SpellEffectConditionsSchema,
  }),
  z.strictObject({
    label: LabelSchema.optional(),
    kind: z.literal('condition'),
    count: SpellEffectCountSchema.optional(),
    conditions: SpellEffectConditionsSchema.min(1),
    conditionsEnd: SpellConditionEndSchema.optional(),
  }),
  z.strictObject({
    label: LabelSchema.optional(),
    kind: z.literal('buff'),
    count: SpellEffectCountSchema.optional(),
    effects: z.array(EffectSchema).max(MAX_ADJUSTMENT_EFFECTS),
    options: z.array(z.strictObject({ label: LabelSchema, effects: z.array(EffectSchema).max(MAX_ADJUSTMENT_EFFECTS) })).max(MAX_SPELL_OPTIONS),
    /** Efeitos numa arma empunhada do alvo (`weaponId` no `spell.effect`). */
    weapon: z.strictObject({ nonmagical: z.literal(true).optional(), itemIds: z.array(IdSchema).optional(), spellcastingAbility: z.literal(true).optional() }).optional(),
    effectsEnd: z.enum(['caster_turn_start', 'caster_turn_end']).optional(),
    endConditions: SpellEffectConditionsSchema,
  }),
]);
export type SpellEffectPart = z.infer<typeof SpellEffectPartSchema>;
/** Parte de magia usada por uma entrada (`spell.effect`): o `spell_cast` e o índice da parte. */
const SpellOfSchema = z.strictObject({ entryId: UuidSchema, part: z.int().min(0).max(MAX_SPELL_PARTS - 1) });
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
    /** Ataque de magia (`spell.effect`): o `spell_cast` e a parte. */
    spellOf: SpellOfSchema.optional(),
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
    /** Salvaguarda de magia (`spell.effect`): o `spell_cast` e a parte. */
    spellOf: SpellOfSchema.optional(),
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
  /** Dano de magia sem ataque nem salvaguarda (`spell.effect`, Magic Missile): cada projétil rolado e depois das defesas do alvo. */
  z.strictObject({
    kind: z.literal('spell_damage'),
    ...entryBase,
    spellOf: SpellOfSchema,
    casterName: NameSchema,
    label: LabelSchema,
    visibility: VisibilitySchema,
    results: z
      .array(
        z.strictObject({
          targetTokenId: UuidSchema,
          targetName: NameSchema,
          groups: z.array(DamageGroupSchema).min(1).max(20),
          total: z.int().nonnegative(),
          defenses: LogList,
          proposalId: UuidSchema.optional(),
        }),
      )
      .min(1)
      .max(MAX_SAVE_TARGETS),
  }),
  /**
   * Cura ou condição sem salvaguarda de uma magia (`spell.effect`, nota 0056):
   * a cura rolada uma vez para todos e, por alvo, o que mudou. As condições
   * postas ou tiradas também vão em `condition_changed`.
   */
  z.strictObject({
    kind: z.literal('spell_applied'),
    ...entryBase,
    spellOf: SpellOfSchema,
    casterName: NameSchema,
    label: LabelSchema,
    /** A cura: os dados (ausentes em `full`), o total e se são PV temporários. */
    healing: z
      .strictObject({ dice: z.string().min(1).max(100).optional(), rolls: z.array(DieSchema).max(200), total: z.int().nonnegative(), full: z.boolean(), temporary: z.boolean() })
      .optional(),
    results: z
      .array(z.strictObject({ targetTokenId: UuidSchema, targetName: NameSchema, notes: LogList }))
      .min(1)
      .max(MAX_SAVE_TARGETS),
  }),
  /** Efeito de magia que saiu da ficha (nota 0060): a Concentração acabou, ou o dono ou o mestre o tirou. */
  z.strictObject({
    kind: z.literal('spell_effect_ended'),
    ...entryBase,
    /** Ausente quando o efeito estava num token sem personagem (`tokenId`). */
    characterId: UuidSchema.optional(),
    tokenId: UuidSchema.optional(),
    /** Nome do personagem ou do token. */
    characterName: NameSchema,
    effectName: LabelSchema,
    /** `duration`: o turno chegou; `replaced`: quem conjurou usou a magia de novo. */
    reason: z.enum(['concentration', 'removed', 'duration', 'replaced']),
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
  /** Magia conjurada (nota 0053), com o texto para a mesa ler. */
  z.strictObject({
    kind: z.literal('spell_cast'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    spellName: NameSchema,
    /** Círculo da magia (0 = truque). */
    level: z.int().min(0).max(9),
    using: z.union([z.strictObject({ slot: SpellSlotRefSchema }), z.literal('free'), z.literal('ritual')]),
    castingTime: LabelSchema,
    range: LabelSchema,
    duration: LabelSchema,
    concentration: z.boolean(),
    description: z.string().min(1).max(6000),
    /** O que a conjuração gastou ("Espaço de 3º círculo (1/3)", "Misty Step (0/1)"). */
    notes: LogList,
    /**
     * Magia estruturada (nota 0055): quem conjurou e as partes calculadas no
     * círculo usado, para `spell.effect`. Ausente nas magias só de texto.
     */
    effect: z
      .strictObject({
        spellId: IdSchema,
        ability: AbilitySchema,
        saveDc: z.int().min(1).max(40),
        attackBonus: z.int().min(-20).max(40),
        parts: z.array(SpellEffectPartSchema).min(1).max(MAX_SPELL_PARTS),
      })
      .optional(),
  }),
  /** Recurso gasto ou recuperado (nota 0052). */
  z.strictObject({
    kind: z.literal('resource'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    resourceName: NameSchema,
    event: z.enum(['spent', 'restored']),
    amount: z.int().min(1).max(1000),
    /** Usos que restam depois da mudança, e o máximo. */
    available: z.int().min(0).max(1000),
    max: z.int().min(0).max(1000),
  }),
  /** Espaço de magia gasto ou recuperado (nota 0051). */
  z.strictObject({
    kind: z.literal('spell_slot'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    event: z.enum(['spent', 'restored']),
    slot: SpellSlotRefSchema,
    /** Quantos restam desse tipo depois da mudança, e o total. */
    available: z.int().min(0).max(20),
    total: z.int().min(0).max(20),
  }),
  /** Descanso que começou, terminou ou foi interrompido (nota 0050). */
  z.strictObject({
    kind: z.literal('rest'),
    ...entryBase,
    event: z.enum(['started', 'finished', 'interrupted']),
    rest: z.enum(['short', 'long']),
    characters: z.array(z.strictObject({ characterId: UuidSchema, name: NameSchema })).max(MAX_COMBATANTS),
    /** O que cada um recuperou, quem saiu do descanso e por quê. */
    notes: LogList,
  }),
  /** Dado de Vida gasto no descanso curto, rolado pelo Host. */
  z.strictObject({
    kind: z.literal('hit_die'),
    ...entryBase,
    characterId: UuidSchema,
    characterName: NameSchema,
    die: HitDieSchema,
    roll: z.int().min(1).max(12),
    conModifier: z.int(),
    healed: z.int().nonnegative(),
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
  /** SHA-256 do documento JSON de um mapa 3D (`VttMapDocument`), ou `null` (mapa 2D). */
  scene3d: Sha256Schema.nullable().default(null),
  /** Névoa de guerra manual e automática do mapa (nota 0058). */
  fog: MapFogSchema,
});
export type GameMap = z.infer<typeof MapSchema>;

/**
 * Ajuste do mestre (bênção, maldição, item caseiro): efeitos do catálogo
 * (docs/effects-spec.md) por cima do cálculo base, sem mexer nas escolhas.
 */
export const SessionAdjustmentSchema = z.strictObject({
  id: UuidSchema,
  name: NameSchema,
  effects: z.array(EffectSchema).min(1).max(MAX_ADJUSTMENT_EFFECTS),
  /** Efeito de magia (nota 0060): quem conjurou e a magia. Com Concentração, sai quando ela acaba; o dono do personagem também pode tirar. */
  spell: ConditionSpellSchema.optional(),
  /** Arma do inventário a que os efeitos pertencem (nota 0063). */
  weapon: InstanceIdSchema.optional(),
  /** Termina no início ou no fim de um turno (Shield). */
  until: TurnExpirySchema.optional(),
});
export type SessionAdjustment = z.infer<typeof SessionAdjustmentSchema>;

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
  /** Efeitos de magia sobre o token (nota 0062); vazios num token de personagem (vão nos ajustes dele). */
  spellEffects: z.array(SessionAdjustmentSchema).max(MAX_ADJUSTMENTS).default([]),
  /** Alcance de visão próprio em pés (5–300), ou `null` para usar o padrão do mapa (nota 0056). */
  visionFeet: VisionFeetSchema.nullable(),
  /** Orientação do token em graus (0..359, sentido horário). */
  rotation: TokenRotationSchema.default(0),
  /** Elevação do token em pés (−1000..1000). */
  elevation: TokenElevationSchema.default(0),
});
export type Token = z.infer<typeof TokenSchema>;

/** Descanso em andamento: o tipo e quem descansa (nota 0050). */
export const SessionRestSchema = z.strictObject({
  kind: z.enum(['short', 'long']),
  characterIds: z.array(UuidSchema).min(1).max(MAX_COMBATANTS),
});
export type SessionRest = z.infer<typeof SessionRestSchema>;

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
  /** Dados de Vida gastos por tamanho; o descanso longo devolve todos (nota 0050). */
  hitDiceSpent: HitDiceSpentSchema,
  /** Espaços de magia gastos; os descansos devolvem (nota 0051). */
  spellSlotsSpent: SpellSlotsSpentSchema,
  /** Usos gastos dos recursos da ficha; os descansos devolvem (nota 0052). */
  resourcesSpent: ResourcesSpentSchema,
});
export type SessionCharacter = z.infer<typeof SessionCharacterSchema>;

/** Dano proposto por um ataque, esperando o mestre aplicar ou descartar. Só o mestre vê. */
export const DamageProposalSchema = z.strictObject({
  id: UuidSchema,
  /** Entrada `attack_roll`, `save_roll`, `mastery_damage` ou `spell_damage` que gerou a proposta. */
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
  /** Descanso em andamento, ou `null` (nota 0050). */
  rest: SessionRestSchema.nullable(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;
