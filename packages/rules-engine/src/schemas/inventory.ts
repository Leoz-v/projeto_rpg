import { z } from 'zod';
import { IdSchema } from './common';

/**
 * Inventário: estado separado da lista de escolhas. Referencia itens do
 * compêndio (SRD ou homebrew da campanha) por id.
 */

/** Limite padrão de itens sintonizados; efeitos `attunement_slots` aumentam (validado no motor). */
export const MAX_ATTUNED_ITEMS = 3;

export const InventoryEntrySchema = z.strictObject({
  /** Identifica esta cópia do item (duas espadas longas são duas entradas). */
  instanceId: z.string().min(1).max(64),
  itemId: IdSchema,
  /** Item base de uma arma ou armadura mágica genérica (ex.: `longsword` para Weapon, +1). */
  baseItemId: IdSchema.optional(),
  /** Variante de um item mágico (ex.: `plus_2`, `hill`). */
  variantId: IdSchema.optional(),
  quantity: z.int().positive().default(1),
  equipped: z.boolean().default(false),
  attuned: z.boolean().default(false),
  /** A magia de um pergaminho (nota 0076). */
  spellId: IdSchema.optional(),
  /** Cargas gastas desta cópia (nota 0075); ausente, nenhuma. */
  chargesSpent: z.int().nonnegative().max(1000).optional(),
});
export type InventoryEntry = z.infer<typeof InventoryEntrySchema>;

export const CurrencySchema = z.strictObject({
  cp: z.int().nonnegative().default(0),
  sp: z.int().nonnegative().default(0),
  ep: z.int().nonnegative().default(0),
  gp: z.int().nonnegative().default(0),
  pp: z.int().nonnegative().default(0),
});

export const InventorySchema = z.strictObject({
  currency: CurrencySchema.default({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }),
  items: z
    .array(InventoryEntrySchema)
    .default([])
    .refine((items) => new Set(items.map((i) => i.instanceId)).size === items.length, {
      message: 'instanceId repetido',
    }),
});
export type Inventory = z.infer<typeof InventorySchema>;
export type InventoryInput = z.input<typeof InventorySchema>;
