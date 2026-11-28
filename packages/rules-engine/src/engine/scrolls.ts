import type { Ability } from '../schemas/common';
import type { InventoryEntry } from '../schemas/inventory';
import type { Item, MagicVariant } from '../schemas/item';
import type { Spell } from '../schemas/spell';
import type { DerivedSheet } from './types';

/**
 * Pergaminhos de magia (nota 0076). SRD 5.2.1, "Spell Scroll": só lê quem tem
 * a magia na lista da sua classe; de círculo acima do que conjura, faz um
 * teste do atributo de conjuração, CD 10 + o círculo. A CD e o bônus de
 * ataque são os do pergaminho.
 */

export type Scroll = NonNullable<MagicVariant['scroll']>;

export function scrollOf(item: Item | undefined, variantId: InventoryEntry['variantId']): Scroll | undefined {
  return item?.kind === 'magic_item' ? item.variants.find((v) => v.id === variantId)?.scroll : undefined;
}

/** Magias que cabem no pergaminho: as do círculo dele. */
export const scrollSpells = (scroll: Scroll, spells: readonly Spell[]): Spell[] => spells.filter((s) => s.level === scroll.level).sort((a, b) => a.name.localeCompare(b.name, 'en'));

export interface ScrollReading {
  /** A magia está na lista de uma classe conjuradora do personagem. */
  onList: boolean;
  ability: Ability;
  modifier: number;
  /** CD do teste, quando o círculo é maior que o que o personagem conjura. */
  checkDc?: number | undefined;
}

/** Com que atributo o personagem lê o pergaminho, e se precisa do teste. */
export function scrollReading(spell: Pick<Spell, 'level' | 'classes'>, sheet: Pick<DerivedSheet, 'abilities'> & { spellcasting: Pick<DerivedSheet['spellcasting'], 'classes' | 'slots' | 'pactSlots'> }): ScrollReading {
  const { classes, slots, pactSlots } = sheet.spellcasting;
  const [best] = classes
    .filter((c) => spell.classes.includes(c.classId))
    .map((c) => ({ ability: c.ability, modifier: sheet.abilities[c.ability].modifier }))
    .sort((a, b) => b.modifier - a.modifier);
  if (!best) return { onList: false, ability: 'int', modifier: 0 };
  const highest = Math.max(slots.findLastIndex((n) => n > 0) + 1, pactSlots?.level ?? 0);
  return { onList: true, ...best, ...(spell.level > highest ? { checkDc: 10 + spell.level } : {}) };
}
