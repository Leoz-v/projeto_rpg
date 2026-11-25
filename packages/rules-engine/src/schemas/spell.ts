import { z } from 'zod';
import { AbilitySchema, ConditionSchema, DamageTypeSchema, DiceSchema, IdSchema, TextSchema } from './common';
import { EffectSchema } from './effect';

/**
 * Magia do compêndio: metadados, texto e, nas magias de dano, cura e
 * condição, a resolução estruturada (notas 0054 e 0056). As demais seguem
 * como texto, classificadas no backlog de automação.
 */

export const SpellSchoolSchema = z.enum([
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
]);

/**
 * Dano de uma parte da magia, no círculo dela (ou no primeiro patamar do
 * truque). `type` com mais de um tipo: quem conjura escolhe (Chromatic Orb).
 */
export const SpellDamageSchema = z.strictObject({
  dice: DiceSchema,
  type: z.union([DamageTypeSchema, z.array(DamageTypeSchema).min(2)]),
  /** Dados somados por círculo acima do da magia ("increases by 1d6 for each spell slot level above 3"). */
  perSlot: DiceSchema.optional(),
  /** Soma o modificador do atributo de conjuração ("plus your spellcasting ability modifier"). */
  addModifier: z.literal(true).optional(),
});
export type SpellDamage = z.infer<typeof SpellDamageSchema>;

/** Nome da parte quando a magia tem mais de uma (Ice Knife: "Fragmento" e "Explosão"). */
const partLabel = { label: TextSchema.optional() };
/**
 * Quantidade e o acréscimo por círculo acima. Ataque e dano direto: ataques
 * ou projéteis (Scorching Ray: 3, +1). Salvaguarda, cura e condição: o
 * máximo de alvos (Hold Person: 1, +1); sem `count`, quantos a mesa marcar.
 */
const partCount = { count: z.strictObject({ base: z.int().positive(), perSlot: z.int().positive().optional() }).optional() };
const spellPartBase = { ...partLabel, damage: z.array(SpellDamageSchema).default([]), ...partCount };

/**
 * Até quando duram as condições que a parte impõe (nota 0056): `spell`, até
 * a magia acabar (com Concentração, caem com ela); `caster_turn_start` e
 * `caster_turn_end`, até o início ou o fim do próximo turno de quem conjura.
 * Sem o campo, ficam até alguém tirar (Caído, "for 1 minute" com
 * salvaguardas repetidas).
 */
export const SpellConditionEndSchema = z.enum(['spell', 'caster_turn_start', 'caster_turn_end']);
export type SpellConditionEnd = z.infer<typeof SpellConditionEndSchema>;

/** Ataque de magia corpo a corpo ou à distância contra a CA do alvo. */
export const SpellAttackPartSchema = z.strictObject({
  ...spellPartBase,
  kind: z.literal('attack'),
  attackKind: z.enum(['melee', 'ranged']),
  /** No erro, metade do dano (Acid Arrow). */
  onMiss: z.literal('half').optional(),
  onHitConditions: z.array(ConditionSchema).default([]),
  conditionsEnd: SpellConditionEndSchema.optional(),
});

/** Um conjunto de efeitos à escolha; `upcast`: efeitos somados por círculo acima. */
export const SpellOptionSchema = z.strictObject({ label: TextSchema, effects: z.array(EffectSchema).default([]), upcast: z.array(EffectSchema).default([]) });

/** Salvaguarda contra a CD de magia de quem conjura. */
export const SpellSavePartSchema = z.strictObject({
  ...spellPartBase,
  kind: z.literal('save'),
  ability: AbilitySchema,
  onSuccess: z.enum(['half', 'none']),
  onFailConditions: z.array(ConditionSchema).default([]),
  /** Quem conjura escolhe uma das condições da falha (Blindness/Deafness). */
  conditionChoice: z.literal(true).optional(),
  /** Efeitos do catálogo na falha, até a magia acabar (Bane, Slow; nota 0062). */
  onFailEffects: z.array(EffectSchema).default([]),
  /** Conjuntos de efeitos da falha à escolha de quem conjura (Bestow Curse). */
  options: z.array(SpellOptionSchema).default([]),
  conditionsEnd: SpellConditionEndSchema.optional(),
});

/** Dano sem rolagem de ataque nem salvaguarda (Magic Missile, Divine Smite). */
export const SpellDamagePartSchema = z.strictObject({
  ...spellPartBase,
  kind: z.literal('damage'),
  damage: z.array(SpellDamageSchema).min(1),
});

/** Quantidade de cura: dados no círculo da magia, acréscimo por círculo acima e o modificador de conjuração. */
export const SpellAmountSchema = z.strictObject({
  dice: DiceSchema,
  perSlot: DiceSchema.optional(),
  addModifier: z.literal(true).optional(),
});

/**
 * Cura aplicada direto nos PV dos alvos (decisão do usuário, nota 0054), rolada
 * uma vez para todos. `full`: todos os PV (Power Word Heal). `temporary`: PV
 * temporários (False Life). `endConditions`: condições que a cura termina (Heal).
 */
export const SpellHealPartSchema = z.strictObject({
  ...partLabel,
  ...partCount,
  kind: z.literal('heal'),
  healing: z.union([SpellAmountSchema, z.literal('full')]),
  temporary: z.literal(true).optional(),
  endConditions: z.array(ConditionSchema).default([]),
});

/** Condição imposta sem salvaguarda (Invisibility). */
export const SpellConditionPartSchema = z.strictObject({
  ...partLabel,
  ...partCount,
  kind: z.literal('condition'),
  conditions: z.array(ConditionSchema).min(1),
  conditionsEnd: SpellConditionEndSchema.optional(),
});

/**
 * Bônus ou penalidade enquanto a magia dura (nota 0060): efeitos do catálogo
 * (docs/effects-spec.md) que entram na ficha do alvo como ajuste ligado à
 * magia. `upcast`: efeitos somados por círculo acima (Aid, +5 PV). `options`:
 * quem conjura escolhe um conjunto (Protection from Energy: o tipo).
 * `endConditions`: condições que a magia termina (Protection from Poison).
 */
export const SpellBuffPartSchema = z.strictObject({
  ...partLabel,
  ...partCount,
  kind: z.literal('buff'),
  effects: z.array(EffectSchema).default([]),
  upcast: z.array(EffectSchema).default([]),
  options: z.array(SpellOptionSchema).default([]),
  /** Efeitos que trocam `effects` a partir de um círculo (`slot`) ou nível de personagem (`level`, truques); vale o último que se aplica. */
  variants: z.array(z.strictObject({ slot: z.int().min(1).max(9).optional(), level: z.int().min(1).max(20).optional(), effects: z.array(EffectSchema).min(1) })).default([]),
  /** Os efeitos são de uma arma empunhada do alvo (nota 0063). */
  weapon: z
    .strictObject({
      nonmagical: z.literal(true).optional(),
      itemIds: z.array(IdSchema).min(1).optional(),
      /** Pode atacar com o atributo de conjuração (Shillelagh). */
      spellcastingAbility: z.literal(true).optional(),
    })
    .optional(),
  /** Até quando duram os efeitos, se não até a magia acabar (Shield). */
  effectsEnd: z.enum(['caster_turn_start', 'caster_turn_end']).optional(),
  endConditions: z.array(ConditionSchema).default([]),
});

export const SpellPartSchema = z.discriminatedUnion('kind', [
  SpellAttackPartSchema,
  SpellSavePartSchema,
  SpellDamagePartSchema,
  SpellHealPartSchema,
  SpellConditionPartSchema,
  SpellBuffPartSchema,
]);
export type SpellPart = z.infer<typeof SpellPartSchema>;

export const SpellSchema = z
  .strictObject({
    id: IdSchema,
    name: TextSchema,
    /** 0 = truque. */
    level: z.int().min(0).max(9),
    school: SpellSchoolSchema,
    castingTime: TextSchema,
    range: TextSchema,
    components: z.strictObject({
      verbal: z.boolean(),
      somatic: z.boolean(),
      material: z.string().min(1).optional(),
    }),
    duration: TextSchema,
    concentration: z.boolean().default(false),
    ritual: z.boolean().default(false),
    /** Classes cuja lista inclui a magia. */
    classes: z.array(IdSchema).default([]),
    description: TextSchema,
    /**
     * Melhoria do truque nos níveis 5, 11 e 17 do personagem: `damage`
     * multiplica os dados de dano (1d10, 2d10, 3d10, 4d10) e `count`, os
     * ataques (Eldritch Blast).
     */
    cantripUpgrade: z.enum(['damage', 'count']).optional(),
    /** Partes da resolução, na ordem do texto; vazia nas magias só de texto. */
    resolution: z.array(SpellPartSchema).default([]),
  })
  .superRefine((spell, ctx) => {
    if (spell.cantripUpgrade && spell.level !== 0) ctx.addIssue({ code: 'custom', message: 'melhoria de truque numa magia de círculo' });
    if (spell.level === 0 && spell.resolution.some((p) => ('damage' in p && p.damage.some((d) => d.perSlot)) || p.count?.perSlot)) {
      ctx.addIssue({ code: 'custom', message: 'truque não escala por círculo' });
    }
    if (spell.resolution.filter((p) => !p.label).length > 1) ctx.addIssue({ code: 'custom', message: 'mais de uma parte sem nome' });
    for (const p of spell.resolution) {
      if (p.kind === 'save' && p.conditionChoice && p.onFailConditions.length < 2) ctx.addIssue({ code: 'custom', message: 'escolha de condição com menos de duas' });
      if (p.kind === 'heal' && p.healing === 'full' && p.temporary) ctx.addIssue({ code: 'custom', message: 'PV temporários não podem ser "todos"' });
      if (p.kind === 'buff' && p.effects.length === 0 && p.options.length === 0) ctx.addIssue({ code: 'custom', message: 'bônus de magia sem efeito' });
      if ((p.kind === 'buff' || p.kind === 'save') && p.options.length === 1) ctx.addIssue({ code: 'custom', message: 'escolha com uma opção só' });
      const conditions = p.kind === 'attack' ? p.onHitConditions : p.kind === 'save' ? p.onFailConditions : p.kind === 'condition' ? p.conditions : [];
      if ('conditionsEnd' in p && p.conditionsEnd && conditions.length === 0) ctx.addIssue({ code: 'custom', message: 'duração de condição numa parte sem condição' });
    }
  });
export type Spell = z.infer<typeof SpellSchema>;
