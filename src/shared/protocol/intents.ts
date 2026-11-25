import { AbilitySchema, BaseScoresSchema, CharacterSchema, ConditionSchema, DamageTypeSchema, DiceSchema, EffectSchema, IdSchema, SizeSchema } from 'rules-engine/schemas';
import { z } from 'zod';
import { ChatTextSchema, CreatureTargetSchema, DeathSavesSchema, HitDieSchema, SpellSlotRefSchema, InstanceIdSchema, TurnEdgeSchema, LabelSchema, MAX_EXHAUSTION_LEVEL, RollAgainstSchema, TableConditionSchema, SheetRollTargetSchema, MapCellPxSchema, MapCellsSchema, NameSchema, PointSchema, Sha256Schema, TokenElevationSchema, TokenRotationSchema, UuidSchema } from './common';
import { MAX_ADJUSTMENT_EFFECTS, MAX_COINS, MAX_COMBATANTS, MAX_FOG_PAINT_CELLS, MAX_FORMULA_DICE, MAX_FORMULA_LENGTH, MAX_HIT_POINTS, MAX_ITEM_QUANTITY, MAX_MULTIATTACK_STEPS, MAX_SAVE_TARGETS, MAX_SPELL_OPTIONS, MAX_SPELL_PARTS } from './constants';
import { FogCellSchema, FogModeSchema, VisionFeetSchema } from './fog';
import { InitiativeSchema, VisibilitySchema } from './state';

/** Catálogo de `Intent` (docs/network-protocol.md, seção 3). */

/** Quantidade de dados de uma fórmula (`2d6+1d4+3` → 3). */
export function countDice(formula: string): number {
  let count = 0;
  for (const [, n] of formula.matchAll(/(\d+)d\d+/g)) count += Number(n);
  return count;
}

/** Fórmula de `dice.roll`: formato de dados do motor, com limites para o Host não travar. */
export const FormulaSchema = DiceSchema.max(MAX_FORMULA_LENGTH).refine((f) => countDice(f) <= MAX_FORMULA_DICE, {
  message: `no máximo ${MAX_FORMULA_DICE} dados`,
});

const QuantitySchema = z.int().min(1).max(MAX_ITEM_QUANTITY);

/** Tokens que entram no combate, e os surpresos entre eles (Desvantagem na iniciativa). */
const CombatJoinSchema = z
  .strictObject({
    tokenIds: z
      .array(UuidSchema)
      .min(1)
      .max(MAX_COMBATANTS)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'token repetido' }),
    surprisedTokenIds: z.array(UuidSchema).max(MAX_COMBATANTS).optional(),
  })
  .refine((d) => (d.surprisedTokenIds ?? []).every((id) => d.tokenIds.includes(id)), { message: 'surpreso fora da lista de tokens' });
const CoinsSchema = z.int().min(0).max(MAX_COINS);

export const IntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('session.resync'), data: z.strictObject({}) }),
  z.strictObject({ kind: z.literal('chat.message'), data: z.strictObject({ text: ChatTextSchema }) }),
  z.strictObject({
    kind: z.literal('dice.roll'),
    data: z.strictObject({ formula: FormulaSchema, label: LabelSchema.optional(), visibility: VisibilitySchema }),
  }),
  z.strictObject({ kind: z.literal('token.move'), data: z.strictObject({ tokenId: UuidSchema, to: PointSchema }) }),
  z.strictObject({
    kind: z.literal('token.update'),
    data: z
      .strictObject({
        tokenId: UuidSchema,
        rotation: TokenRotationSchema.optional(),
        elevation: TokenElevationSchema.optional(),
      })
      .refine((d) => d.rotation !== undefined || d.elevation !== undefined, { message: 'nada para alterar' }),
  }),
  z.strictObject({
    kind: z.literal('map.create'),
    data: z.strictObject({
      name: NameSchema,
      width: MapCellsSchema,
      height: MapCellsSchema,
      background: Sha256Schema.optional(),
      cellPx: MapCellPxSchema.optional(),
      scene3d: Sha256Schema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('map.update'),
    data: z
      .strictObject({
        mapId: UuidSchema,
        name: NameSchema.optional(),
        width: MapCellsSchema.optional(),
        height: MapCellsSchema.optional(),
        scene3d: Sha256Schema.optional(),
      })
      .refine((d) => d.name !== undefined || d.width !== undefined || d.height !== undefined || d.scene3d !== undefined, { message: 'nada para alterar' }),
  }),
  z.strictObject({ kind: z.literal('map.activate'), data: z.strictObject({ mapId: UuidSchema }) }),
  z.strictObject({
    kind: z.literal('token.create'),
    data: z.strictObject({
      mapId: UuidSchema,
      name: NameSchema,
      position: PointSchema,
      size: SizeSchema,
      monsterId: z.string().min(1).optional(),
      image: Sha256Schema.optional(),
      ownerIds: z.array(UuidSchema).optional(),
      characterId: UuidSchema.optional(),
      /** PV máximos do token; sem isso, o de um monstro é a média do bloco de estatísticas. */
      hpMax: z.int().min(1).max(MAX_HIT_POINTS).optional(),
    }),
  }),
  z.strictObject({ kind: z.literal('token.remove'), data: z.strictObject({ tokenId: UuidSchema }) }),
  z.strictObject({ kind: z.literal('character.create'), data: z.strictObject({ name: NameSchema, ownerId: UuidSchema.optional() }) }),
  z.strictObject({
    kind: z.literal('character.update'),
    data: z
      .strictObject({
        characterId: UuidSchema,
        name: NameSchema.optional(),
        baseScores: BaseScoresSchema.optional(),
        steps: CharacterSchema.shape.steps.optional(),
      })
      .refine((d) => d.name !== undefined || d.baseScores !== undefined || d.steps !== undefined, { message: 'nada para alterar' }),
  }),
  z.strictObject({ kind: z.literal('character.roll_scores'), data: z.strictObject({ characterId: UuidSchema }) }),
  z.strictObject({ kind: z.literal('character.remove'), data: z.strictObject({ characterId: UuidSchema }) }),
  z.strictObject({
    kind: z.literal('inventory.add'),
    data: z.strictObject({
      characterId: UuidSchema,
      itemId: IdSchema,
      baseItemId: IdSchema.optional(),
      variantId: IdSchema.optional(),
      quantity: QuantitySchema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('inventory.remove'),
    data: z.strictObject({ characterId: UuidSchema, instanceId: InstanceIdSchema, quantity: QuantitySchema.optional() }),
  }),
  z.strictObject({
    kind: z.literal('inventory.update'),
    data: z
      .strictObject({
        characterId: UuidSchema,
        instanceId: InstanceIdSchema,
        equipped: z.boolean().optional(),
        attuned: z.boolean().optional(),
        quantity: QuantitySchema.optional(),
      })
      .refine((d) => d.equipped !== undefined || d.attuned !== undefined || d.quantity !== undefined, { message: 'nada para alterar' }),
  }),
  z.strictObject({
    kind: z.literal('inventory.currency'),
    data: z.strictObject({
      characterId: UuidSchema,
      currency: z.strictObject({ cp: CoinsSchema, sp: CoinsSchema, ep: CoinsSchema, gp: CoinsSchema, pp: CoinsSchema }),
    }),
  }),
  z.strictObject({
    kind: z.literal('adjustment.add'),
    data: z.strictObject({ characterId: UuidSchema, name: NameSchema, effects: z.array(EffectSchema).min(1).max(MAX_ADJUSTMENT_EFFECTS) }),
  }),
  z.strictObject({ kind: z.literal('monster.use'), data: z.strictObject({ tokenId: UuidSchema, featureId: IdSchema, change: z.enum(['spend', 'restore']) }) }),
  z.strictObject({ kind: z.literal('save.resolve'), data: z.strictObject({ pendingId: UuidSchema, useResistance: z.boolean() }) }),
  z.strictObject({ kind: z.literal('monster.cast'), data: z.strictObject({ tokenId: UuidSchema, spellId: IdSchema }) }),
  z.strictObject({ kind: z.literal('monster.rest'), data: z.strictObject({ tokenId: UuidSchema }) }),
  z.strictObject({ kind: z.literal('monster.lair'), data: z.strictObject({ tokenId: UuidSchema, lair: z.boolean() }) }),
  z.strictObject({ kind: z.literal('token.effect_remove'), data: z.strictObject({ tokenId: UuidSchema, effectId: UuidSchema }) }),
  z.strictObject({ kind: z.literal('adjustment.remove'), data: z.strictObject({ characterId: UuidSchema, adjustmentId: UuidSchema }) }),
  z.strictObject({
    kind: z.literal('roll.d20'),
    data: z.strictObject({
      characterId: UuidSchema,
      target: SheetRollTargetSchema,
      /** Vantagem/Desvantagem declarada na hora; anula-se com a oposta, como qualquer outra. */
      advantage: z.boolean().optional(),
      disadvantage: z.boolean().optional(),
      visibility: VisibilitySchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('roll.damage'),
    data: z.strictObject({
      characterId: UuidSchema,
      instanceId: InstanceIdSchema,
      critical: z.boolean().optional(),
      versatile: z.boolean().optional(),
      visibility: VisibilitySchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('attack.make'),
    data: z.strictObject({
      /** Arma equipada de um personagem, ou ação de ataque do monstro de um token. */
      attacker: z.union([
        z.strictObject({ characterId: UuidSchema, instanceId: InstanceIdSchema }),
        z.strictObject({ tokenId: UuidSchema, actionId: IdSchema }),
      ]),
      targetTokenId: UuidSchema,
      advantage: z.boolean().optional(),
      disadvantage: z.boolean().optional(),
      visibility: VisibilitySchema,
    }),
  }),
  /** Multiattack de um monstro: os usos em ordem, cada um com a ação e os alvos (um no ataque). */
  z.strictObject({
    kind: z.literal('attack.multi'),
    data: z.strictObject({
      tokenId: UuidSchema,
      /** Ação lendária que encadeia outras (nota 0069); ausente, o Multiattack. */
      actionId: IdSchema.optional(),
      option: z.int().min(0).max(9),
      steps: z
        .array(
          z.strictObject({
            actionId: IdSchema,
            /** Vazio numa magia: os alvos são escolhidos no chat. */
            targetTokenIds: z.array(UuidSchema).max(MAX_SAVE_TARGETS),
            advantage: z.boolean().optional(),
            disadvantage: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(MAX_MULTIATTACK_STEPS),
      visibility: VisibilitySchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('save.force'),
    data: z.strictObject({
      /** Ação de salvaguarda do monstro de um token, ou um efeito informado (magia de personagem, armadilha). */
      source: z.union([
        z.strictObject({ tokenId: UuidSchema, actionId: IdSchema }),
        z.strictObject({
          custom: z.strictObject({
            name: LabelSchema,
            ability: AbilitySchema,
            dc: z.int().min(1).max(40),
            damage: z.array(z.strictObject({ dice: FormulaSchema, type: DamageTypeSchema })).max(5),
            onSuccess: z.enum(['half', 'none']),
            conditions: z.array(ConditionSchema).max(15).optional(),
          }),
        }),
      ]),
      targetTokenIds: z
        .array(UuidSchema)
        .min(1)
        .max(MAX_SAVE_TARGETS)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'alvo repetido' }),
      /** O que a salvaguarda evita, para as Vantagens circunstanciais (sem isso, a primeira condição da falha). */
      against: RollAgainstSchema.optional(),
      visibility: VisibilitySchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('mastery.use'),
    data: z.strictObject({
      /** O `attack_roll` cuja maestria será usada. */
      entryId: UuidSchema,
      /** Cleave: o segundo alvo. */
      targetTokenId: UuidSchema.optional(),
      advantage: z.boolean().optional(),
      disadvantage: z.boolean().optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('condition.add'),
    data: z.strictObject({
      target: CreatureTargetSchema,
      condition: TableConditionSchema,
      /** Duração: até o início ou o fim do próximo turno do combatente (só com combate). */
      until: z.strictObject({ at: TurnEdgeSchema, tokenId: UuidSchema }).optional(),
    }),
  }),
  z.strictObject({ kind: z.literal('condition.remove'), data: z.strictObject({ target: CreatureTargetSchema, condition: TableConditionSchema }) }),
  z.strictObject({ kind: z.literal('exhaustion.set'), data: z.strictObject({ target: CreatureTargetSchema, level: z.int().min(0).max(MAX_EXHAUSTION_LEVEL) }) }),
  z.strictObject({
    kind: z.literal('spell.cast'),
    data: z.strictObject({
      characterId: UuidSchema,
      spellId: IdSchema,
      using: z.union([z.strictObject({ slot: SpellSlotRefSchema }), z.literal('free'), z.literal('ritual')]),
      /** Atributo de conjuração, se a magia vem de mais de uma fonte (sem isso, o de maior CD). */
      ability: AbilitySchema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('spell.effect'),
    data: z.strictObject({
      /** O `spell_cast` com a magia estruturada. */
      entryId: UuidSchema,
      /** Índice da parte em `effect.parts`. */
      part: z.int().min(0).max(MAX_SPELL_PARTS - 1),
      /** Ataque e dano direto: um alvo por ataque ou projétil (pode repetir). Salvaguarda: alvos distintos. */
      targetTokenIds: z.array(UuidSchema).min(1).max(MAX_SAVE_TARGETS),
      /** Tipo escolhido, quando a parte deixa a escolha para quem conjura (Chromatic Orb). */
      damageType: DamageTypeSchema.optional(),
      /** Condição escolhida, quando a salvaguarda deixa a escolha (Blindness/Deafness). */
      condition: TableConditionSchema.optional(),
      /** Opção escolhida de uma parte `buff` (Protection from Energy: o tipo de dano), pelo índice. */
      option: z.int().min(0).max(MAX_SPELL_OPTIONS - 1).optional(),
      /** Arma empunhada do alvo, quando a magia age numa arma (Magic Weapon). */
      weaponId: InstanceIdSchema.optional(),
      /** Ataque: Vantagem ou Desvantagem de quem ataca. Salvaguarda: dos alvos (Charm Person contra quem está lutando). */
      advantage: z.boolean().optional(),
      disadvantage: z.boolean().optional(),
    }),
  }),
  z.strictObject({ kind: z.literal('resource.spend'), data: z.strictObject({ characterId: UuidSchema, resourceId: IdSchema, amount: z.int().min(1).max(100).optional() }) }),
  z.strictObject({ kind: z.literal('resource.restore'), data: z.strictObject({ characterId: UuidSchema, resourceId: IdSchema, amount: z.int().min(1).max(100).optional() }) }),
  z.strictObject({ kind: z.literal('spell_slot.spend'), data: z.strictObject({ characterId: UuidSchema, slot: SpellSlotRefSchema }) }),
  z.strictObject({ kind: z.literal('spell_slot.restore'), data: z.strictObject({ characterId: UuidSchema, slot: SpellSlotRefSchema }) }),
  z.strictObject({ kind: z.literal('rest.start'), data: z.strictObject({ kind: z.enum(['short', 'long']), characterIds: z.array(UuidSchema).min(1).max(MAX_COMBATANTS).refine((ids) => new Set(ids).size === ids.length, { message: 'personagem repetido' }) }) }),
  z.strictObject({ kind: z.literal('rest.finish'), data: z.strictObject({}) }),
  z.strictObject({ kind: z.literal('rest.cancel'), data: z.strictObject({}) }),
  z.strictObject({ kind: z.literal('hit_dice.spend'), data: z.strictObject({ characterId: UuidSchema, die: HitDieSchema }) }),
  z.strictObject({ kind: z.literal('concentration.set'), data: z.strictObject({ characterId: UuidSchema, spellId: IdSchema }) }),
  z.strictObject({ kind: z.literal('concentration.end'), data: z.union([z.strictObject({ characterId: UuidSchema }), z.strictObject({ tokenId: UuidSchema })]) }),
  z.strictObject({ kind: z.literal('death.set'), data: z.strictObject({ characterId: UuidSchema, deathSaves: DeathSavesSchema }) }),
  z.strictObject({ kind: z.literal('combat.start'), data: CombatJoinSchema }),
  z.strictObject({ kind: z.literal('combat.add'), data: CombatJoinSchema }),
  z.strictObject({ kind: z.literal('combat.remove'), data: z.strictObject({ tokenId: UuidSchema }) }),
  z.strictObject({ kind: z.literal('combat.set_initiative'), data: z.strictObject({ tokenId: UuidSchema, initiative: InitiativeSchema }) }),
  z.strictObject({ kind: z.literal('combat.next'), data: z.strictObject({}) }),
  z.strictObject({ kind: z.literal('combat.previous'), data: z.strictObject({}) }),
  z.strictObject({ kind: z.literal('combat.end'), data: z.strictObject({}) }),
  z.strictObject({
    kind: z.literal('damage.apply'),
    data: z.strictObject({ proposalId: UuidSchema, amount: z.int().min(0).max(MAX_HIT_POINTS).optional() }),
  }),
  z.strictObject({ kind: z.literal('damage.dismiss'), data: z.strictObject({ proposalId: UuidSchema }) }),
  z.strictObject({
    kind: z.literal('hp.change'),
    data: z.strictObject({
      target: CreatureTargetSchema,
      change: z.strictObject({
        /** `max` só em tokens com PV próprios (ex.: PV rolados de um monstro). */
        kind: z.enum(['damage', 'healing', 'temp', 'max']),
        amount: z.int().min(0).max(MAX_HIT_POINTS),
      }),
    }),
  }),
  z.strictObject({
    kind: z.literal('fog.manual.paint'),
    data: z.strictObject({
      mapId: UuidSchema,
      mode: FogModeSchema,
      cells: z.array(FogCellSchema).min(1).max(MAX_FOG_PAINT_CELLS),
    }),
  }),
  z.strictObject({
    kind: z.literal('fog.manual.rect'),
    data: z.strictObject({
      mapId: UuidSchema,
      mode: FogModeSchema,
      from: FogCellSchema,
      to: FogCellSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('fog.manual.fill'),
    data: z.strictObject({
      mapId: UuidSchema,
      mode: FogModeSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal('fog.config'),
    data: z
      .strictObject({
        mapId: UuidSchema,
        autoEnabled: z.boolean().optional(),
        visionFeet: VisionFeetSchema.optional(),
        rememberExplored: z.boolean().optional(),
      })
      .refine((d) => d.autoEnabled !== undefined || d.visionFeet !== undefined || d.rememberExplored !== undefined, { message: 'nada para alterar' }),
  }),
  z.strictObject({
    kind: z.literal('fog.memory.clear'),
    data: z.strictObject({
      mapId: UuidSchema,
      playerId: UuidSchema.optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('token.vision'),
    data: z.strictObject({
      tokenId: UuidSchema,
      visionFeet: VisionFeetSchema.nullable(),
    }),
  }),
  z.strictObject({
    kind: z.literal('token.hidden'),
    data: z.strictObject({
      tokenId: UuidSchema,
      hidden: z.boolean(),
    }),
  }),
  z.strictObject({
    kind: z.literal('token.dead'),
    data: z.strictObject({
      tokenId: UuidSchema,
      dead: z.boolean(),
    }),
  }),
]);
export type Intent = z.infer<typeof IntentSchema>;
export type IntentKind = Intent['kind'];
export type IntentData<K extends IntentKind> = Extract<Intent, { kind: K }>['data'];
