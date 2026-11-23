import type { InventoryEntry, Inventory } from '../schemas/inventory';
import type { Item, MagicItem } from '../schemas/item';
import type { Compendium } from '../srd';
import type { Issue } from './types';

/**
 * Resolução das entradas do inventário: o item físico (o item base de uma arma
 * ou armadura mágica genérica, ou o próprio item) e a parte mágica, quando há.
 * Regras de sintonização e de item base do SRD 5.2.1 ("Magic Items", p. 103).
 */

export interface MagicPart {
  item: MagicItem;
  /** Efeitos do item somados aos da variante escolhida. */
  effects: MagicItem['effects'];
  /** Nome exibido: o da variante, se houver ("Weapon, +2"), senão o do item. */
  name: string;
  /** Falso quando a sintonização exigida não é permitida ao personagem (os efeitos não valem). */
  attunable: boolean;
}

export interface ResolvedEntry {
  entry: InventoryEntry;
  /** Item físico: arma, armadura, ferramenta, equipamento ou o item mágico sem base. */
  item: Item;
  magic?: MagicPart | undefined;
}

export interface AttunementContext {
  classIds: readonly string[];
  spellcaster: boolean;
}

const CATEGORY_OF = (item: Item): string | undefined =>
  item.kind === 'weapon' || item.kind === 'armor' ? item.category : undefined;

/** Confere se `base` satisfaz a restrição de item base do item mágico. */
export function fitsBase(magic: MagicItem, base: Item): boolean {
  const rule = magic.base;
  if (!rule || base.kind !== rule.kind) return false;
  if (rule.ids.length > 0) return rule.ids.includes(base.id);
  const category = CATEGORY_OF(base);
  if (rule.categories.length > 0 && (category === undefined || !rule.categories.includes(category as (typeof rule.categories)[number]))) return false;
  if (rule.attackKind !== undefined && (base.kind !== 'weapon' || base.attackKind !== rule.attackKind)) return false;
  return true;
}

/** Itens base que um item mágico genérico aceita (ex.: as armas de Weapon, +1), em ordem de nome. */
export function baseItemOptions(magic: MagicItem, compendium: Compendium): Item[] {
  if (!magic.base) return [];
  return compendium.items.filter((i) => i.kind !== 'magic_item' && fitsBase(magic, i)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * Problemas de uma entrada nova do inventário (item desconhecido, variante ou
 * item base faltando ou inválidos), sem olhar o personagem. Vazio = pode entrar.
 */
export function inventoryEntryProblems(entry: Pick<InventoryEntry, 'itemId' | 'baseItemId' | 'variantId'>, compendium: Compendium): string[] {
  const issues: Issue[] = [];
  resolveInventory({ currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [{ instanceId: 'check', quantity: 1, equipped: false, attuned: false, ...entry }] }, compendium, { classIds: [], spellcaster: false }, issues);
  return issues.map((i) => i.message);
}

export function resolveInventory(inventory: Inventory, compendium: Compendium, attunement: AttunementContext, issues: Issue[]): ResolvedEntry[] {
  const find = (id: string): Item | undefined => compendium.items.find((i) => i.id === id);
  const invalid = (message: string): void => {
    issues.push({ severity: 'error', code: 'invalid_item', message });
  };

  return inventory.items.flatMap((entry): ResolvedEntry[] => {
    const item = find(entry.itemId);
    if (!item) {
      issues.push({ severity: 'error', code: 'unknown_reference', message: `Item desconhecido no inventário: ${entry.itemId}.` });
      return [];
    }
    if (item.kind !== 'magic_item') {
      if (entry.baseItemId !== undefined || entry.variantId !== undefined) invalid(`${item.name} não tem item base nem variantes.`);
      // Item comum (ou homebrew sem os campos de item mágico): sintoniza se os efeitos dependem disso.
      if (entry.attuned && item.activation !== 'attuned') invalid(`${item.name} não exige sintonização.`);
      return [{ entry, item }];
    }

    // Variante.
    const variant = item.variants.find((v) => v.id === entry.variantId);
    if (item.variants.length > 0 && !variant) {
      invalid(`${item.name}: escolha a variante (${item.variants.map((v) => v.id).join(', ')}).`);
      return [];
    }
    if (item.variants.length === 0 && entry.variantId !== undefined) invalid(`${item.name} não tem variantes.`);

    // Item base.
    let physical: Item = item;
    if (item.base) {
      const baseId = entry.baseItemId ?? (item.base.ids.length === 1 ? item.base.ids[0] : undefined);
      const base = baseId === undefined ? undefined : find(baseId);
      if (!base) {
        invalid(`${item.name}: escolha o item base${baseId === undefined ? '' : ` (desconhecido: ${baseId})`}.`);
        return [];
      }
      if (!fitsBase(item, base)) {
        invalid(`${item.name} não pode ser feito de ${base.name}.`);
        return [];
      }
      physical = base;
    } else if (entry.baseItemId !== undefined) {
      invalid(`${item.name} não tem item base.`);
    }

    // Sintonização.
    let attunable = true;
    if (entry.attuned && !item.attunement) invalid(`${item.name} não exige sintonização.`);
    if (item.attunement && entry.attuned) {
      const { classes, spellcaster, by } = item.attunement;
      const classOk = classes.length === 0 || classes.some((c) => attunement.classIds.includes(c));
      const casterOk = !spellcaster || attunement.spellcaster;
      if (!classOk || !casterOk) {
        attunable = false;
        issues.push({ severity: 'error', code: 'attunement_restricted', message: `${item.name} exige sintonização ${by ?? ''}`.trim() + '.' });
      }
    }

    const name = variant?.name ?? item.name;
    return [{ entry, item: physical, magic: { item, effects: [...item.effects, ...(variant?.effects ?? [])], name, attunable } }];
  });
}
