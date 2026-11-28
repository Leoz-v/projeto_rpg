import { z } from 'zod';
import { AbilitySchema, DamageSchema, DiceSchema, FeetSchema, IdSchema, TextSchema, WeaponMasterySchema, WeaponPropertySchema } from './common';
import { EffectSchema } from './effect';
import { ItemUseSchema } from './item-use';

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
  /** Vendido em lote: `weight` e `cost` valem para este número de unidades (ex.: 20 flechas). */
  perPurchase: z.int().min(2).optional(),
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
    /** Munição usada, obrigatória com a propriedade `ammunition` (id de item). */
    ammunition: IdSchema.optional(),
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
    if (has('ammunition') !== (w.ammunition !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['ammunition'], message: 'ammunition exige (e é exigido por) a propriedade ammunition' });
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

/**
 * Ferramenta. Cada variante (um jogo, um instrumento) exige proficiência
 * própria e é um item à parte; o id é o mesmo usado em `grant_proficiency`.
 */
export const ToolSchema = z.strictObject({
  ...itemBase,
  kind: z.literal('tool'),
  category: z.enum(['artisan', 'gaming_set', 'musical_instrument', 'other']),
  /** Atributo dos testes feitos com a ferramenta. */
  ability: AbilitySchema,
  /** Usos com a ação Utilize e suas CDs, como publicados. */
  utilize: TextSchema,
  /** O que a ferramenta permite fabricar, como publicado (nomes de item ou categorias). */
  craft: z.array(TextSchema).default([]),
});
export type Tool = z.infer<typeof ToolSchema>;

/** Qualquer outro item: equipamento de aventura, poção, item maravilhoso. */
export const GearSchema = z.strictObject({
  ...itemBase,
  kind: z.literal('gear'),
  /** Consumido ao usar (poções, pergaminhos, munição). */
  consumable: z.boolean().default(false),
  /** O que acontece ao usar (nota 0074). */
  use: ItemUseSchema.optional(),
  /** Foco de conjuração: arcano (Feiticeiro, Bruxo, Mago), druídico (Druida, Patrulheiro) ou símbolo sagrado (Clérigo, Paladino). */
  focus: z.enum(['arcane', 'druidic', 'holy_symbol']).optional(),
  /** Conteúdo de um pacote (Explorer's Pack etc.), em unidades. */
  contents: z.array(z.strictObject({ itemId: IdSchema, quantity: z.int().positive() })).default([]),
});
export type Gear = z.infer<typeof GearSchema>;

// --- Itens mágicos ----------------------------------------------------------

export const RaritySchema = z.enum(['common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact']);
export type Rarity = z.infer<typeof RaritySchema>;

export const MagicItemCategorySchema = z.enum(['armor', 'weapon', 'wondrous', 'potion', 'ring', 'rod', 'scroll', 'staff', 'wand']);

/** Quem pode sintonizar. Sem restrição: qualquer criatura. */
export const AttunementSchema = z.strictObject({
  /** Restrição como publicada ("by a Spellcaster", "by a Dwarf"), para a UI. */
  by: z.string().optional(),
  /** Classes que podem sintonizar (vazio = sem restrição de classe). */
  classes: z.array(IdSchema).default([]),
  /** Exige ser conjurador (ter Spellcasting ou Pact Magic). */
  spellcaster: z.boolean().default(false),
});

/**
 * Item base de uma arma ou armadura mágica ("Weapon (Any Simple or Martial)",
 * "Armor (Chain Mail or Chain Shirt)"). O inventário escolhe o item concreto em
 * `baseItemId`; com um único id permitido, ele é usado por padrão.
 */
export const MagicBaseSchema = z.strictObject({
  kind: z.enum(['weapon', 'armor', 'gear']),
  /** Itens permitidos; vazio = qualquer item do tipo que satisfaça os filtros abaixo. */
  ids: z.array(IdSchema).default([]),
  categories: z.array(z.enum(['simple', 'martial', 'light', 'medium', 'heavy', 'shield'])).default([]),
  attackKind: z.enum(['melee', 'ranged']).optional(),
});

/** Variante do item (+1/+2/+3, tipo de gigante, tipo de dano): o inventário escolhe em `variantId`. */
export const MagicVariantSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  rarity: RaritySchema,
  cost: CostSchema.optional(),
  /** Somados aos efeitos do item. */
  effects: z.array(EffectSchema).default([]),
  /** O uso desta variante, no lugar do uso do item. */
  use: ItemUseSchema.optional(),
  /** Pergaminho de magia (nota 0076): o círculo, a CD e o bônus de ataque. A magia fica na entrada do inventário. */
  scroll: z.strictObject({ level: z.int().min(0).max(9), saveDc: z.int().min(1).max(40), attackBonus: z.int().min(0).max(20) }).optional(),
});
export type MagicVariant = z.infer<typeof MagicVariantSchema>;

/** Magia que o item conjura (nota 0075). */
export const ItemSpellSchema = z
  .strictObject({
    spellId: IdSchema,
    /** Cargas gastas (0: à vontade). */
    charges: z.int().nonnegative(),
    /** Círculo fixado pelo item ("level 5 version"). */
    level: z.int().min(1).max(9).optional(),
    /** Até quantas cargas: cada uma a mais sobe um círculo. */
    maxCharges: z.int().positive().optional(),
    /** Ressalva do texto, como nota ("Só afeta Feras"). */
    note: TextSchema.optional(),
  })
  .refine((s) => s.maxCharges === undefined || s.maxCharges > s.charges, { message: 'maxCharges menor que charges' });
export type ItemSpell = z.infer<typeof ItemSpellSchema>;

export const MagicItemSchema = z
  .strictObject({
    ...itemBase,
    kind: z.literal('magic_item'),
    category: MagicItemCategorySchema,
    /** Ausente quando a raridade vem da variante. */
    rarity: RaritySchema.optional(),
    /** Presente quando o item exige sintonização. */
    attunement: AttunementSchema.optional(),
    base: MagicBaseSchema.optional(),
    variants: z.array(MagicVariantSchema).default([]),
    /** Cargas máximas e recuperação, como publicada (`regain`) e em dados (`regainDice`). O gasto fica no inventário. */
    charges: z
      .strictObject({
        max: z.int().positive(),
        regain: z.string().optional(),
        regainDice: DiceSchema.optional(),
        /** Ao gastar a última: destruído, destruído com 1 no d20, ou outra consequência (com 1 ou 20) que o mestre aplica. */
        lastCharge: z.enum(['destroyed', 'destroyed_on_1', 'gm']).optional(),
      })
      .optional(),
    /** Magias conjuradas com as cargas (nota 0075). `saveDc`: CD do item; ausente, a de quem o segura. `carried`: basta carregar. */
    casting: z.strictObject({ saveDc: z.int().min(1).max(40).optional(), carried: z.literal(true).optional(), spells: z.array(ItemSpellSchema).min(1) }).optional(),
    consumable: z.boolean().default(false),
    /** O que acontece ao usar (nota 0074). */
    use: ItemUseSchema.optional(),
  })
  .superRefine((m, ctx) => {
    if ((m.rarity === undefined) === (m.variants.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['rarity'], message: 'raridade no item ou nas variantes (exatamente um)' });
    }
    if ((m.attunement !== undefined) !== (m.activation === 'attuned')) {
      ctx.addIssue({ code: 'custom', path: ['activation'], message: 'activation attuned exige (e é exigida por) attunement' });
    }
    if (new Set(m.variants.map((v) => v.id)).size !== m.variants.length) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'variante repetida' });
    }
    if ((m.category === 'weapon' || m.category === 'armor') && m.base === undefined) {
      ctx.addIssue({ code: 'custom', path: ['base'], message: 'arma ou armadura mágica exige item base' });
    }
  });
export type MagicItem = z.infer<typeof MagicItemSchema>;

export const ItemSchema = z.discriminatedUnion('kind', [WeaponSchema, ArmorSchema, ToolSchema, GearSchema, MagicItemSchema]);
export type Item = z.infer<typeof ItemSchema>;
/** Item como escrito no JSON, antes dos valores padrão. */
export type ItemInput = z.input<typeof ItemSchema>;
