import { z } from 'zod';
import { DamageSchema, DiceSchema, FeetSchema, IdSchema, TextSchema, WeaponMasterySchema, WeaponPropertySchema } from './common';
import { EffectSchema } from './effect';

/**
 * Itens do compêndio (SRD ou homebrew). Um item carrega seus efeitos
 * declarativos e diz quando eles valem (`activation`), para funcionar ao ser
 * adicionado/equipado sem configuração extra.
 */

export const CoinSchema = z.enum(['cp', 'sp', 'ep', 'gp', 'pp']);
export type Coin = z.infer<typeof CoinSchema>;

export const CostSchema = z.strictObject({
  amount: z.number().nonnegative(),
  coin: CoinSchema,
});

/**
 * Quando os efeitos do item estão ativos (docs/effects-spec.md, seção 1).
 * `attuned` implica que o item exige sintonização.
 */
export const ItemActivationSchema = z.enum(['carried', 'equipped', 'attuned']);
export type ItemActivation = z.infer<typeof ItemActivationSchema>;

const itemBase = {
  id: IdSchema,
  name: TextSchema,
  description: z.string().optional(),
  weight: z.number().nonnegative().optional(),
  cost: CostSchema.optional(),
  activation: ItemActivationSchema.default('equipped'),
  effects: z.array(EffectSchema).default([]),
};

export const WeaponRangeSchema = z
  .strictObject({ normal: FeetSchema.positive(), long: FeetSchema.positive() })
  .refine((r) => r.long >= r.normal, { message: 'alcance longo menor que o normal' });

export const WeaponSchema = z
  .strictObject({
    ...itemBase,
    kind: z.literal('weapon'),
    category: z.enum(['simple', 'martial']),
    attackKind: z.enum(['melee', 'ranged']),
    damage: DamageSchema,
    properties: z.array(WeaponPropertySchema).default([]),
    /** Dano com duas mãos, obrigatório com a propriedade `versatile`. */
    versatileDice: DiceSchema.optional(),
    /** Alcance, obrigatório com `range` ou `thrown`. */
    range: WeaponRangeSchema.optional(),
    mastery: WeaponMasterySchema,
  })
  .superRefine((w, ctx) => {
    const has = (p: z.infer<typeof WeaponPropertySchema>): boolean => w.properties.includes(p);
    if (new Set(w.properties).size !== w.properties.length) {
      ctx.addIssue({ code: 'custom', path: ['properties'], message: 'propriedade repetida' });
    }
    if (has('versatile') !== (w.versatileDice !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['versatileDice'], message: 'versatileDice exige (e é exigido por) versatile' });
    }
    if ((has('range') || has('thrown')) !== (w.range !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['range'], message: 'range exige (e é exigido por) range ou thrown' });
    }
  });
export type Weapon = z.infer<typeof WeaponSchema>;

/**
 * Armadura e escudo. A CA vem dos efeitos (`set_base_ac` para armaduras,
 * `flat_bonus` em `ac` para escudos), como em docs/effects-spec.md 3.2.
 */
export const ArmorSchema = z.strictObject({
  ...itemBase,
  kind: z.literal('armor'),
  category: z.enum(['light', 'medium', 'heavy', 'shield']),
  /** Força mínima para não perder deslocamento. */
  strength: z.int().min(1).max(30).optional(),
});
export type Armor = z.infer<typeof ArmorSchema>;

/** Qualquer outro item: equipamento de aventura, ferramenta, poção, item maravilhoso. */
export const GearSchema = z.strictObject({
  ...itemBase,
  kind: z.literal('gear'),
  /** Consumido ao usar (poções, pergaminhos, munição). */
  consumable: z.boolean().default(false),
});
export type Gear = z.infer<typeof GearSchema>;

export const ItemSchema = z.discriminatedUnion('kind', [WeaponSchema, ArmorSchema, GearSchema]);
export type Item = z.infer<typeof ItemSchema>;
/** Item como escrito no JSON, antes dos valores padrão. */
export type ItemInput = z.input<typeof ItemSchema>;
