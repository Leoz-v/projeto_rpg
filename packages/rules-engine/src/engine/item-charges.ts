import type { Ability } from '../schemas/common';
import type { InventoryEntry } from '../schemas/inventory';
import type { Item, ItemSpell, MagicItem } from '../schemas/item';
import type { DerivedSheet } from './types';

/**
 * Cargas e magias de itens (nota 0075). SRD 5.2.1, "Magic Items": o item
 * recupera cargas ao amanhecer; a magia usa a CD do item ou a de quem o
 * segura, e quem não conjura usa modificador +0 com o bônus de proficiência.
 */

export interface ChargedItem {
  item: MagicItem;
  max: number;
  /** Dados recuperados ao amanhecer; ausente, o item não recupera. */
  regain?: string | undefined;
}

export function chargedItem(item: Item | undefined): ChargedItem | undefined {
  if (item?.kind !== 'magic_item' || !item.charges) return undefined;
  return { item, max: item.charges.max, regain: item.charges.regainDice };
}

/** Cargas que restam nesta cópia do item. */
export const availableCharges = (max: number, entry: Pick<InventoryEntry, 'chargesSpent'>): number => Math.max(0, max - (entry.chargesSpent ?? 0));

/** Custos possíveis de uma magia do item: um só, ou de `charges` a `maxCharges` (cada carga a mais, um círculo acima). */
export const itemSpellCosts = (spell: ItemSpell): number[] => Array.from({ length: (spell.maxCharges ?? spell.charges) - spell.charges + 1 }, (_, i) => spell.charges + i);

/** O círculo da magia com esse gasto; ausente, o da própria magia. */
export function itemSpellLevel(spell: ItemSpell, baseLevel: number, charges: number): number {
  return (spell.level ?? baseLevel) + (charges - spell.charges);
}

/** Por que o item não funciona agora: falta sintonizar, ou segurar/vestir. Vazio, funciona. */
export function itemMagicProblems(item: MagicItem, entry: Pick<InventoryEntry, 'equipped' | 'attuned'>): string[] {
  return [
    ...(item.attunement && !entry.attuned ? [`${item.name} exige sintonização`] : []),
    ...(item.casting && !item.casting.carried && !entry.equipped ? [`${item.name} precisa estar equipado (na mão ou vestido)`] : []),
  ];
}

export interface ItemCaster {
  ability: Ability;
  modifier: number;
  saveDc: number;
  attackBonus: number;
}

/** A CD e o bônus com que o personagem conjura pelo item. */
export function itemCaster(item: MagicItem, sheet: Pick<DerivedSheet, 'spellcasting' | 'abilities' | 'proficiencyBonus'>): ItemCaster {
  const [best] = sheet.spellcasting.classes
    .map((c) => ({ ability: c.ability, saveDc: c.saveDc.total, attack: c.attack.total }))
    .sort((a, b) => b.saveDc - a.saveDc || b.attack - a.attack);
  const own: ItemCaster = best
    ? { ability: best.ability, modifier: sheet.abilities[best.ability].modifier, saveDc: best.saveDc, attackBonus: best.attack }
    : { ability: 'int', modifier: 0, saveDc: 8 + sheet.proficiencyBonus, attackBonus: sheet.proficiencyBonus };
  return { ...own, saveDc: item.casting?.saveDc ?? own.saveDc };
}

/** Destino da última carga: o item é destruído, ou o texto tem outra consequência que o mestre aplica. */
export function lastChargeOutcome(rule: NonNullable<MagicItem['charges']>['lastCharge'], d20: number): 'kept' | 'destroyed' | 'gm' {
  if (rule === 'destroyed') return 'destroyed';
  if (rule === 'destroyed_on_1') return d20 === 1 ? 'destroyed' : 'kept';
  return rule === 'gm' && (d20 === 1 || d20 === 20) ? 'gm' : 'kept';
}
