import { z } from 'zod';
import { AbilitySchema, ConditionSchema, DamageTypeSchema, DiceSchema, IdSchema, TextSchema } from './common';

/**
 * Magia do compêndio: metadados, texto e, nas magias de dano, a resolução
 * estruturada (nota 0054). As demais seguem como texto, classificadas no
 * backlog de automação.
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

const spellPartBase = {
  /** Nome da parte quando a magia tem mais de uma (Ice Knife: "Fragmento" e "Explosão"). */
  label: TextSchema.optional(),
  damage: z.array(SpellDamageSchema).default([]),
  /** Ataques ou projéteis: a base e o acréscimo por círculo acima (Scorching Ray: 3, +1). */
  count: z.strictObject({ base: z.int().positive(), perSlot: z.int().positive().optional() }).optional(),
};

/** Ataque de magia corpo a corpo ou à distância contra a CA do alvo. */
export const SpellAttackPartSchema = z.strictObject({
  ...spellPartBase,
  kind: z.literal('attack'),
  attackKind: z.enum(['melee', 'ranged']),
  /** No erro, metade do dano (Acid Arrow). */
  onMiss: z.literal('half').optional(),
  onHitConditions: z.array(ConditionSchema).default([]),
});

/** Salvaguarda contra a CD de magia de quem conjura. */
export const SpellSavePartSchema = z.strictObject({
  ...spellPartBase,
  kind: z.literal('save'),
  ability: AbilitySchema,
  onSuccess: z.enum(['half', 'none']),
  onFailConditions: z.array(ConditionSchema).default([]),
});

/** Dano sem rolagem de ataque nem salvaguarda (Magic Missile, Divine Smite). */
export const SpellDamagePartSchema = z.strictObject({
  ...spellPartBase,
  kind: z.literal('damage'),
  damage: z.array(SpellDamageSchema).min(1),
});

export const SpellPartSchema = z.discriminatedUnion('kind', [SpellAttackPartSchema, SpellSavePartSchema, SpellDamagePartSchema]);
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
    if (spell.level === 0 && spell.resolution.some((p) => p.damage.some((d) => d.perSlot) || p.count?.perSlot)) {
      ctx.addIssue({ code: 'custom', message: 'truque não escala por círculo' });
    }
    if (spell.resolution.filter((p) => !p.label).length > 1) ctx.addIssue({ code: 'custom', message: 'mais de uma parte sem nome' });
  });
export type Spell = z.infer<typeof SpellSchema>;
