import type { Ability, CreatureType } from '../schemas/common';
import type { InventoryEntry } from '../schemas/inventory';
import type { Item } from '../schemas/item';
import type { ItemUse, ItemUsePart } from '../schemas/item-use';

/** Usar um item (nota 0074): o que o item faz, com a CD de quem usa. Quem rola e aplica é o Host. */

/** O uso do item: o da variante (cada Potion of Healing), ou o do próprio item. */
export function itemUse(item: Item, variantId: InventoryEntry['variantId']): ItemUse | undefined {
  if (item.kind === 'magic_item') return item.variants.find((v) => v.id === variantId)?.use ?? item.use;
  return item.kind === 'gear' ? item.use : undefined;
}

/** Nome da unidade usada: o da variante, se houver. */
export function usedItemName(item: Item, variantId: InventoryEntry['variantId']): string {
  return (item.kind === 'magic_item' ? item.variants.find((v) => v.id === variantId)?.name : undefined) ?? item.name;
}

/** O item é gasto ao ser usado. */
export const isConsumed = (item: Item): boolean => (item.kind === 'gear' || item.kind === 'magic_item') && item.consumable;

/** As opções à escolha de quem usa (a parte `buff` com `options`; no máximo uma por item). */
export function itemUseOptions(use: ItemUse): string[] {
  return use.parts.flatMap((p) => (p.kind === 'buff' ? p.options.map((o) => o.label) : []));
}

/** Alguma parte causa dano (precisa de um token para a proposta). */
export const itemUseDamages = (use: ItemUse): boolean => use.parts.some((p) => (p.kind === 'damage' || p.kind === 'save') && p.damage.length > 0);

/** CD da salvaguarda (SRD 5.2.1, Acid e Holy Water: 8 + modificador + bônus de proficiência). */
export function itemSaveDc(dc: Extract<ItemUsePart, { kind: 'save' }>['dc'], user: { proficiencyBonus: number; modifier: (ability: Ability) => number }): number {
  return typeof dc === 'number' ? dc : 8 + user.modifier(dc.ability) + user.proficiencyBonus;
}

/** Como o tipo da criatura muda a salvaguarda: rola, não é afetada, ou passa sem rolar. Sem tipo conhecido, rola. */
export function itemSaveApplies(part: Extract<ItemUsePart, { kind: 'save' }>, type: CreatureType | undefined): 'roll' | 'unaffected' | 'auto_success' {
  if (type === undefined) return 'roll';
  if (part.onlyTypes && !part.onlyTypes.includes(type)) return 'unaffected';
  if (part.exceptTypes?.includes(type)) return 'auto_success';
  return 'roll';
}
