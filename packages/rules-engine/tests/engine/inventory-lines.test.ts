import { describe, expect, it } from 'vitest';
import { baseItemOptions, inventoryEntryProblems } from '../../src/engine/items';
import { loadSrdCompendium } from '../../src/srd';
import { derive, fighterSteps } from './helpers';

const compendium = loadSrdCompendium();
const magic = (id: string) => {
  const item = compendium.items.find((i) => i.id === id);
  if (item?.kind !== 'magic_item') throw new Error(id);
  return item;
};

describe('inventory on the sheet', () => {
  it('lists entries with display names, activity and the attunement count', () => {
    const sheet = derive({
      steps: fighterSteps(),
      inventory: {
        items: [
          { instanceId: 'mail', itemId: 'chain_mail', equipped: true },
          { instanceId: 'sword', itemId: 'weapon_plus', baseItemId: 'longsword', variantId: 'plus_1', equipped: true },
          { instanceId: 'ring', itemId: 'ring_of_protection', attuned: true },
          { instanceId: 'cloak', itemId: 'cloak_of_protection' },
          { instanceId: 'rope', itemId: 'rope', quantity: 2 },
        ],
      },
    });
    const line = (id: string) => sheet.inventory.find((l) => l.instanceId === id);
    expect(line('mail')).toMatchObject({ name: 'Chain Mail', kind: 'armor', equipped: true, active: true, requiresAttunement: false });
    expect(line('sword')).toMatchObject({ name: 'Weapon, +1 (Longsword)', kind: 'weapon', active: true });
    expect(line('ring')).toMatchObject({ requiresAttunement: true, attuned: true, active: true });
    // Sem sintonizar, a capa não funciona.
    expect(line('cloak')).toMatchObject({ requiresAttunement: true, active: false });
    expect(line('rope')).toMatchObject({ quantity: 2 });
    expect(sheet.attunement).toEqual({ used: 1, limit: 3 });
  });

  it('keeps invalid entries visible by item name', () => {
    const sheet = derive({ steps: fighterSteps(), inventory: { items: [{ instanceId: 'x', itemId: 'weapon_plus' }] } });
    expect(sheet.inventory[0]).toMatchObject({ name: 'Weapon, +1, +2, or +3', active: false });
    expect(sheet.issues.some((i) => i.code === 'invalid_item')).toBe(true);
  });
});

describe('magic item helpers', () => {
  it('lists the base items a generic magic item accepts', () => {
    const weapons = baseItemOptions(magic('weapon_plus'), compendium).map((i) => i.id);
    expect(weapons).toContain('longsword');
    expect(weapons).not.toContain('chain_mail');
    expect(baseItemOptions(magic('shield_plus'), compendium).map((i) => i.id)).toEqual(['shield']);
    expect(baseItemOptions(magic('ring_of_protection'), compendium)).toEqual([]);
  });

  it('checks a new entry without the character', () => {
    expect(inventoryEntryProblems({ itemId: 'weapon_plus', baseItemId: 'longsword', variantId: 'plus_2' }, compendium)).toEqual([]);
    expect(inventoryEntryProblems({ itemId: 'weapon_plus', baseItemId: 'longsword' }, compendium)).toHaveLength(1);
    expect(inventoryEntryProblems({ itemId: 'weapon_plus', baseItemId: 'chain_mail', variantId: 'plus_1' }, compendium)).toHaveLength(1);
    expect(inventoryEntryProblems({ itemId: 'nao_existe' }, compendium)).toHaveLength(1);
    expect(inventoryEntryProblems({ itemId: 'rope' }, compendium)).toEqual([]);
  });
});
