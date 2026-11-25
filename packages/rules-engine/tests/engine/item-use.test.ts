import { describe, expect, it } from 'vitest';
import { isConsumed, itemSaveApplies, itemSaveDc, itemUse, itemUseDamages, itemUseOptions, usedItemName } from '../../src/engine';
import type { ItemUsePart } from '../../src/schemas';
import { loadSrdCompendium } from '../../src/srd';

const compendium = loadSrdCompendium();
const item = (id: string) => {
  const found = compendium.items.find((i) => i.id === id);
  if (!found) throw new Error(`sem ${id}`);
  return found;
};
const part = (id: string): Extract<ItemUsePart, { kind: 'save' }> => {
  const found = itemUse(item(id), undefined)?.parts.find((p) => p.kind === 'save');
  if (found?.kind !== 'save') throw new Error(`sem salvaguarda em ${id}`);
  return found;
};

describe('item use (note 0074)', () => {
  it('each Potion of Healing has its own dice (SRD table)', () => {
    const dice = (variant: string) => itemUse(item('potion_of_healing'), variant)?.parts;
    expect(dice('healing')).toEqual([{ kind: 'heal', dice: '2d4+2' }]);
    expect(dice('greater')).toEqual([{ kind: 'heal', dice: '4d4+4' }]);
    expect(dice('superior')).toEqual([{ kind: 'heal', dice: '8d4+8' }]);
    expect(dice('supreme')).toEqual([{ kind: 'heal', dice: '10d4+20' }]);
    expect(itemUse(item('potion_of_healing'), undefined)).toBeUndefined();
    expect(usedItemName(item('potion_of_healing'), 'greater')).toBe('Potion of Healing (greater)');
  });

  it('every Potion of Giant Strength sets the score of its giant', () => {
    const score = (variant: string) => {
      const [p] = itemUse(item('potion_of_giant_strength'), variant)?.parts ?? [];
      return p?.kind === 'buff' ? p.effects : [];
    };
    for (const [variant, value] of [['hill', 21], ['frost_or_stone', 23], ['fire', 25], ['cloud', 27], ['storm', 29]] as const) {
      expect(score(variant)).toMatchObject([{ type: 'set_minimum_score', ability: 'str', value }]);
    }
  });

  it('Potion of Resistance offers the ten damage types of the table', () => {
    const use = itemUse(item('potion_of_resistance'), undefined);
    expect(use && itemUseOptions(use)).toHaveLength(10);
  });

  it('the thrown vials use DC 8 + DEX + proficiency; fixed DCs stay', () => {
    const user = { proficiencyBonus: 3, modifier: () => 2 };
    expect(itemSaveDc(part('acid').dc, user)).toBe(13);
    expect(itemSaveDc(part('potion_of_poison').dc, user)).toBe(13);
    expect(itemSaveDc(part('bead_of_force').dc, user)).toBe(15);
  });

  it('Holy Water only affects Fiends and Undead; the dust spares the types of the text', () => {
    expect(itemSaveApplies(part('holy_water'), 'undead')).toBe('roll');
    expect(itemSaveApplies(part('holy_water'), 'humanoid')).toBe('unaffected');
    expect(itemSaveApplies(part('holy_water'), undefined)).toBe('roll');
    expect(itemSaveApplies(part('dust_of_sneezing_and_choking'), 'construct')).toBe('auto_success');
    expect(itemSaveApplies(part('dust_of_sneezing_and_choking'), 'beast')).toBe('roll');
  });

  it('every usable item of the SRD is consumable, and no item shares its id with a spell (the id links the effect)', () => {
    const usable = compendium.items.filter((i) => itemUse(i, undefined) ?? (i.kind === 'magic_item' && i.variants.some((v) => itemUse(i, v.id))));
    expect(usable).toHaveLength(21);
    for (const i of usable) expect(isConsumed(i), i.id).toBe(true);
    const spells = new Set(compendium.spells.map((s) => s.id));
    expect(usable.filter((i) => spells.has(i.id))).toEqual([]);
  });

  it('knows which uses deal damage, and has at most one part with options', () => {
    const damages = (id: string) => {
      const use = itemUse(item(id), undefined);
      return use && itemUseDamages(use);
    };
    expect(damages('potion_of_poison')).toBe(true);
    expect(damages('acid')).toBe(true);
    expect(damages('potion_of_heroism')).toBe(false);
    for (const i of compendium.items) {
      const parts = itemUse(i, undefined)?.parts ?? [];
      expect(parts.filter((p) => p.kind === 'buff' && p.options.length > 0).length, i.id).toBeLessThanOrEqual(1);
    }
  });
});
