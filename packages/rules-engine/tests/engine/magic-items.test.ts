import { describe, expect, it } from 'vitest';
import type { CharacterInput } from '../../src/schemas/character';
import type { ItemInput } from '../../src/schemas/item';
import { MagicItemSchema } from '../../src/schemas/item';
import { compendiumWith, derive, errorsOf, fighterSteps, LANGUAGES, sel } from './helpers';

/** Itens mágicos de teste no formato do compêndio (nota 0014). */
const plusWeapon: ItemInput = {
  id: 'magic_weapon',
  name: 'Weapon, +1, +2, or +3',
  kind: 'magic_item',
  category: 'weapon',
  base: { kind: 'weapon', categories: ['simple', 'martial'] },
  variants: [1, 2, 3].map((n) => ({
    id: `plus_${String(n)}`,
    name: `Weapon, +${String(n)}`,
    rarity: (['uncommon', 'rare', 'very_rare'] as const)[n - 1] ?? 'uncommon',
    effects: [
      { type: 'flat_bonus', target: 'attack.weapon', value: n },
      { type: 'flat_bonus', target: 'damage.weapon', value: n },
    ],
  })),
};
const plusArmor: ItemInput = {
  id: 'magic_armor',
  name: 'Armor, +1, +2, or +3',
  kind: 'magic_item',
  category: 'armor',
  base: { kind: 'armor', categories: ['light', 'medium', 'heavy'] },
  variants: [{ id: 'plus_1', name: 'Armor, +1', rarity: 'rare', effects: [{ type: 'flat_bonus', target: 'ac', value: 1 }] }],
};
const plusShield: ItemInput = {
  id: 'magic_shield',
  name: 'Shield, +1, +2, or +3',
  kind: 'magic_item',
  category: 'armor',
  base: { kind: 'armor', ids: ['shield'] },
  variants: [{ id: 'plus_2', name: 'Shield, +2', rarity: 'rare', effects: [{ type: 'flat_bonus', target: 'ac', value: 2 }] }],
};
const ringOfProtection: ItemInput = {
  id: 'ring_of_protection',
  name: 'Ring of Protection',
  kind: 'magic_item',
  category: 'ring',
  rarity: 'rare',
  attunement: {},
  activation: 'attuned',
  effects: [
    { type: 'flat_bonus', target: 'ac', value: 1 },
    { type: 'flat_bonus', target: 'save.all', value: 1 },
  ],
};
const wizardStaff: ItemInput = {
  id: 'wizard_only_staff',
  name: 'Wizard Staff',
  kind: 'magic_item',
  category: 'staff',
  rarity: 'rare',
  attunement: { by: 'by a Wizard', classes: ['wizard'] },
  activation: 'attuned',
  effects: [{ type: 'flat_bonus', target: 'spell_save_dc', value: 1 }],
};
const casterWand: ItemInput = {
  id: 'caster_wand',
  name: 'Caster Wand',
  kind: 'magic_item',
  category: 'wand',
  rarity: 'uncommon',
  attunement: { by: 'by a Spellcaster', spellcaster: true },
  activation: 'attuned',
  effects: [{ type: 'flat_bonus', target: 'attack.spell', value: 1 }],
};
const compendium = compendiumWith([plusWeapon, plusArmor, plusShield, ringOfProtection, wizardStaff, casterWand]);

describe('magic item schema', () => {
  it('requires a rarity on the item or on every variant, not both', () => {
    expect(MagicItemSchema.safeParse(ringOfProtection).success).toBe(true);
    expect(MagicItemSchema.safeParse({ ...ringOfProtection, rarity: undefined }).success).toBe(false);
    expect(MagicItemSchema.safeParse({ ...plusWeapon, rarity: 'rare' }).success).toBe(false);
  });

  it('ties attunement to the attuned activation', () => {
    expect(MagicItemSchema.safeParse({ ...ringOfProtection, activation: 'equipped' }).success).toBe(false);
    expect(MagicItemSchema.safeParse({ ...ringOfProtection, attunement: undefined }).success).toBe(false);
  });

  it('requires a base item for magic weapons and armor', () => {
    expect(MagicItemSchema.safeParse({ ...plusWeapon, base: undefined }).success).toBe(false);
  });
});

describe('magic weapons, armor and shields on the sheet', () => {
  it('adds the +N bonus only to attacks with that weapon', () => {
    const sheet = derive({
      compendium,
      inventory: {
        items: [
          { instanceId: 'sword', itemId: 'magic_weapon', baseItemId: 'longsword', variantId: 'plus_2', equipped: true },
          { instanceId: 'axe', itemId: 'handaxe', equipped: true },
        ],
      },
    });
    expect(errorsOf(sheet)).toEqual([]);
    const sword = sheet.attacks.find((a) => a.instanceId === 'sword');
    const axe = sheet.attacks.find((a) => a.instanceId === 'axe');
    // Guerreiro anão: FOR 17 (+3), proficiência +2.
    expect(sword).toMatchObject({ name: 'Weapon, +2 (Longsword)', itemId: 'longsword' });
    expect(sword?.attack.total).toBe(3 + 2 + 2);
    expect(sword?.damage.bonus.total).toBe(3 + 2);
    expect(sword?.damage.dice).toBe('1d8');
    expect(axe?.attack.total).toBe(3 + 2);
  });

  it('applies the armor and shield bonuses on top of the base AC', () => {
    const inventory = (shield: boolean) => ({
      items: [
        { instanceId: 'mail', itemId: 'magic_armor', baseItemId: 'chain_mail', variantId: 'plus_1', equipped: true },
        ...(shield ? [{ instanceId: 'shield', itemId: 'magic_shield', variantId: 'plus_2', equipped: true }] : []),
      ],
    });
    // Chain Mail 16 + Defense (+1, com armadura) + 1.
    expect(derive({ compendium, inventory: inventory(false) }).ac.total).toBe(18);
    // + Shield 2 + 2 (o item base único, `shield`, é usado sem baseItemId).
    expect(derive({ compendium, inventory: inventory(true) }).ac.total).toBe(22);
  });

  it('keeps the magic bonus off while the item is not equipped', () => {
    const sheet = derive({ compendium, inventory: { items: [{ instanceId: 'mail', itemId: 'magic_armor', baseItemId: 'chain_mail', variantId: 'plus_1' }] } });
    expect(sheet.ac.total).toBe(11); // sem armadura: 10 + DES 1
  });

  it('rejects a missing or invalid base item and a missing variant', () => {
    const one = (entry: { itemId: string; variantId?: string; baseItemId?: string }) => errorsOf(derive({ compendium, inventory: { items: [{ instanceId: 'x', equipped: true, ...entry }] } }));
    expect(one({ itemId: 'magic_weapon', variantId: 'plus_1' })).toEqual(['invalid_item']);
    expect(one({ itemId: 'magic_weapon', variantId: 'plus_1', baseItemId: 'chain_mail' })).toEqual(['invalid_item']);
    expect(one({ itemId: 'magic_weapon', baseItemId: 'longsword' })).toEqual(['invalid_item']);
    expect(one({ itemId: 'magic_shield', variantId: 'plus_2', baseItemId: 'chain_mail' })).toEqual(['invalid_item']);
    expect(one({ itemId: 'longsword', variantId: 'plus_1' })).toEqual(['invalid_item']);
  });
});

describe('attunement', () => {
  it('applies attunement items only while attuned', () => {
    const ring = (attuned: boolean) => derive({ compendium, inventory: { items: [{ instanceId: 'r', itemId: 'ring_of_protection', equipped: true, attuned }] } });
    expect(ring(false).ac.total).toBe(11);
    expect(ring(true).ac.total).toBe(12);
    expect(ring(true).saves.wis.total).toBe(ring(false).saves.wis.total + 1);
  });

  it('rejects attuning an item that does not require attunement', () => {
    const sheet = derive({ compendium, inventory: { items: [{ instanceId: 'a', itemId: 'longsword', attuned: true }] } });
    expect(errorsOf(sheet)).toEqual(['invalid_item']);
  });

  it('enforces class and spellcaster restrictions and drops the effects', () => {
    const staff = derive({ compendium, inventory: { items: [{ instanceId: 's', itemId: 'wizard_only_staff', attuned: true }] } });
    expect(errorsOf(staff)).toEqual(['attunement_restricted']);
    const wand = derive({ compendium, inventory: { items: [{ instanceId: 'w', itemId: 'caster_wand', attuned: true }] } });
    expect(errorsOf(wand)).toEqual(['attunement_restricted']);
  });

  it('accepts a spellcaster for a "by a Spellcaster" item', () => {
    const wizard: CharacterInput['steps'] = [
      { kind: 'species', speciesId: 'dwarf', selections: [LANGUAGES] },
      { kind: 'background', backgroundId: 'sage', abilityIncreases: { int: 2, con: 1 } },
      {
        kind: 'class_level',
        classId: 'wizard',
        selections: [
          sel('class', 'wizard', 'skills', 'arcana', 'investigation'),
          sel('class', 'wizard', 'cantrips', 'fire_bolt', 'light', 'mage_hand'),
          sel('class', 'wizard', 'spellbook', 'magic_missile', 'shield', 'sleep', 'detect_magic', 'mage_armor', 'burning_hands'),
          sel('class', 'wizard', 'prepared', 'magic_missile', 'shield', 'sleep', 'detect_magic'),
        ],
      },
    ];
    const sheet = derive({ steps: wizard, compendium, inventory: { items: [{ instanceId: 'w', itemId: 'caster_wand', attuned: true }] } });
    expect(sheet.issues.filter((i) => i.code === 'attunement_restricted')).toEqual([]);
  });

  it('counts magic items towards the attunement limit', () => {
    const sheet = derive({
      steps: fighterSteps(),
      compendium,
      inventory: { items: ['a', 'b', 'c', 'd'].map((id) => ({ instanceId: id, itemId: 'ring_of_protection', attuned: true })) },
    });
    expect(errorsOf(sheet)).toContain('too_many_attuned');
  });
});

describe('items granting proficiency and weapon-specific bonuses (Phase 1.5, group 3)', () => {
  const wizard: CharacterInput['steps'] = [
    { kind: 'species', speciesId: 'dwarf', selections: [LANGUAGES] },
    { kind: 'background', backgroundId: 'sage', abilityIncreases: { int: 2, con: 1 } },
    {
      kind: 'class_level',
      classId: 'wizard',
      selections: [
        sel('class', 'wizard', 'skills', 'arcana', 'investigation'),
        sel('class', 'wizard', 'cantrips', 'fire_bolt', 'light', 'mage_hand'),
        sel('class', 'wizard', 'spellbook', 'magic_missile', 'shield', 'sleep', 'detect_magic', 'mage_armor', 'burning_hands'),
        sel('class', 'wizard', 'prepared', 'magic_missile', 'shield', 'sleep', 'detect_magic'),
      ],
    },
  ];
  const codes = (sheet: ReturnType<typeof derive>) => sheet.issues.map((i) => i.code);

  it('trains the wearer with Elven Chain itself (SRD: "considered trained with this armor")', () => {
    const plain = derive({ steps: wizard, inventory: { items: [{ instanceId: 'a', itemId: 'chain_shirt', equipped: true }] } });
    expect(codes(plain)).toContain('armor_untrained');
    const elven = derive({ steps: wizard, inventory: { items: [{ instanceId: 'a', itemId: 'elven_chain', baseItemId: 'chain_shirt', equipped: true }] } });
    expect(codes(elven)).not.toContain('armor_untrained');
    expect(elven.ac.total).toBe(plain.ac.total + 1);
    // Treino só com o próprio item: não vira "armadura média" na lista de proficiências.
    expect(elven.proficiencies.armor).not.toContain('self');
    expect(elven.proficiencies.armor).not.toContain('medium');
  });

  it('grants Longbow/Shortbow proficiency and +2 damage only with them (Bracers of Archery)', () => {
    const items = (bracers: boolean) => ({
      items: [
        { instanceId: 'bow', itemId: 'longbow', equipped: true },
        { instanceId: 'xbow', itemId: 'light_crossbow', equipped: true },
        ...(bracers ? [{ instanceId: 'b', itemId: 'bracers_of_archery', equipped: true, attuned: true }] : []),
      ],
    });
    const without = derive({ steps: wizard, inventory: items(false) });
    const withBracers = derive({ steps: wizard, inventory: items(true) });
    const attack = (sheet: ReturnType<typeof derive>, id: string) => sheet.attacks.find((a) => a.instanceId === id);
    expect(attack(without, 'bow')?.proficient).toBe(false);
    expect(attack(withBracers, 'bow')?.proficient).toBe(true);
    expect(attack(withBracers, 'bow')?.damage.bonus.total).toBe((attack(without, 'bow')?.damage.bonus.total ?? 0) + 2);
    // A besta leve (arma simples, já proficiente) não ganha o +2.
    expect(attack(withBracers, 'xbow')?.damage.bonus.total).toBe(attack(without, 'xbow')?.damage.bonus.total);
    expect(withBracers.proficiencies.weapons).toEqual(expect.arrayContaining(['longbow', 'shortbow']));
  });

  it('teaches Dwarvish while the Belt of Dwarvenkind is attuned', () => {
    const human: CharacterInput['steps'] = [{ kind: 'species', speciesId: 'human', size: 'medium', selections: [] }];
    const sheet = (attuned: boolean) => derive({ steps: human, inventory: { items: [{ instanceId: 'belt', itemId: 'belt_of_dwarvenkind', equipped: true, attuned }] } });
    expect(sheet(false).proficiencies.languages).not.toContain('dwarvish');
    expect(sheet(true).proficiencies.languages).toContain('dwarvish');
    expect(sheet(true).skills.persuasion.roll.situational).toContainEqual(expect.objectContaining({ kind: 'advantage', note: 'Interagir com anões e duergar' }));
  });
});
