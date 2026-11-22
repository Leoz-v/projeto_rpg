import { describe, expect, it } from 'vitest';
import { ActionSchema } from '../../src/schemas/action';
import { DiceSchema, IdSchema, SKILLS } from '../../src/schemas/common';
import { CreatureSchema } from '../../src/schemas/creature';
import { ItemSchema } from '../../src/schemas/item';
import { SpellSchema } from '../../src/schemas/spell';

describe('primitives', () => {
  it('has the 18 SRD skills', () => {
    expect(SKILLS).toHaveLength(18);
  });

  it.each(['longsword', 'sleight_of_hand', 'potion_of_healing_2'])('accepts id %s', (id) => {
    expect(IdSchema.safeParse(id).success).toBe(true);
  });

  it.each(['Longsword', 'long-sword', '_x', 'x__y', 'x_', '2x', ''])('rejects id %s', (id) => {
    expect(IdSchema.safeParse(id).success).toBe(false);
  });

  it.each(['1d8', '2d6+3', '1d10+1d6-1', '5', '1d100'])('accepts dice %s', (d) => {
    expect(DiceSchema.safeParse(d).success).toBe(true);
  });

  it.each(['d8', '1d7', '2d6 + 3', '2d6+', '1d8*2'])('rejects dice %s', (d) => {
    expect(DiceSchema.safeParse(d).success).toBe(false);
  });
});

describe('ItemSchema', () => {
  const longsword = {
    id: 'longsword',
    name: 'Longsword',
    kind: 'weapon',
    category: 'martial',
    attackKind: 'melee',
    damage: { dice: '1d8', type: 'slashing' },
    properties: ['versatile'],
    versatileDice: '1d10',
    mastery: 'sap',
    weight: 3,
    cost: { amount: 15, coin: 'gp' },
  };

  it('accepts a versatile weapon and fills defaults', () => {
    const item = ItemSchema.parse(longsword);
    expect(item.activation).toBe('equipped');
    expect(item.effects).toEqual([]);
  });

  it('requires versatileDice with versatile and vice-versa', () => {
    expect(ItemSchema.safeParse({ ...longsword, versatileDice: undefined }).success).toBe(false);
    expect(ItemSchema.safeParse({ ...longsword, properties: [] }).success).toBe(false);
  });

  it('requires range for thrown weapons', () => {
    const dagger = {
      id: 'dagger',
      name: 'Dagger',
      kind: 'weapon',
      category: 'simple',
      attackKind: 'melee',
      damage: { dice: '1d4', type: 'piercing' },
      properties: ['finesse', 'light', 'thrown'],
      mastery: 'nick',
    };
    expect(ItemSchema.safeParse(dagger).success).toBe(false);
    expect(ItemSchema.safeParse({ ...dagger, range: { normal: 20, long: 60 } }).success).toBe(true);
    expect(ItemSchema.safeParse({ ...dagger, range: { normal: 60, long: 20 } }).success).toBe(false);
  });

  it('rejects a weapon without mastery', () => {
    expect(ItemSchema.safeParse({ ...longsword, mastery: undefined }).success).toBe(false);
  });

  it('declares armor AC through effects', () => {
    const chainMail = {
      id: 'chain_mail',
      name: 'Chain Mail',
      kind: 'armor',
      category: 'heavy',
      strength: 13,
      effects: [
        { type: 'set_base_ac', base: 16, abilities: [] },
        { type: 'disadvantage', target: 'skill.stealth' },
      ],
    };
    const shield = {
      id: 'shield',
      name: 'Shield',
      kind: 'armor',
      category: 'shield',
      effects: [{ type: 'flat_bonus', target: 'ac', value: 2 }],
    };
    expect(ItemSchema.safeParse(chainMail).success).toBe(true);
    expect(ItemSchema.safeParse(shield).success).toBe(true);
  });

  it('accepts an attuned wondrous item', () => {
    const ring = {
      id: 'ring_of_protection',
      name: 'Ring of Protection',
      kind: 'gear',
      activation: 'attuned',
      effects: [
        { type: 'flat_bonus', target: 'ac', value: 1 },
        { type: 'flat_bonus', target: 'save.all', value: 1 },
      ],
    };
    expect(ItemSchema.safeParse(ring).success).toBe(true);
  });

  it('rejects invalid effects inside an item', () => {
    const bad = { id: 'x', name: 'X', kind: 'gear', effects: [{ type: 'flat_bonus', target: 'luck', value: 1 }] };
    expect(ItemSchema.safeParse(bad).success).toBe(false);
  });
});

describe('ActionSchema', () => {
  it('accepts attack, save and text actions', () => {
    expect(
      ActionSchema.safeParse({
        id: 'scimitar',
        name: 'Scimitar',
        kind: 'attack',
        attackKind: 'melee',
        toHit: 4,
        reach: 5,
        damage: [{ dice: '1d6+2', type: 'slashing' }],
      }).success,
    ).toBe(true);
    expect(
      ActionSchema.safeParse({
        id: 'poison_breath',
        name: 'Poison Breath',
        kind: 'save',
        ability: 'con',
        dc: 13,
        damage: [{ dice: '6d6', type: 'poison' }],
        onSuccess: 'half',
        limit: { recharge: 5 },
      }).success,
    ).toBe(true);
    expect(ActionSchema.safeParse({ id: 'multiattack', name: 'Multiattack', kind: 'text', description: 'Two attacks.' }).success).toBe(true);
  });

  it('accepts an attack whose hit only applies effects (e.g. a grapple)', () => {
    expect(ActionSchema.safeParse({ id: 'x', name: 'X', kind: 'attack', attackKind: 'melee', toHit: 4, damage: [] }).success).toBe(true);
  });

  it('rejects an attack without a to-hit bonus', () => {
    expect(ActionSchema.safeParse({ id: 'x', name: 'X', kind: 'attack', attackKind: 'melee', damage: [] }).success).toBe(false);
  });

  it('accepts a creature Spellcasting with at-will and per-day spells', () => {
    const spellcasting = {
      id: 'spellcasting',
      name: 'Spellcasting',
      kind: 'spellcasting',
      ability: 'int',
      dc: 14,
      spells: [
        { spellId: 'detect_magic', uses: 'at_will' },
        { spellId: 'fireball', uses: { per: 'day', count: 2 }, level: 4 },
      ],
    };
    expect(ActionSchema.safeParse(spellcasting).success).toBe(true);
    expect(ActionSchema.safeParse({ ...spellcasting, spells: [] }).success).toBe(false);
    expect(ActionSchema.safeParse({ ...spellcasting, spells: [{ spellId: 'fireball', uses: { per: 'short_rest', count: 1 } }] }).success).toBe(false);
  });

  it('accepts lair use counts on per-day limits', () => {
    expect(
      ActionSchema.safeParse({ id: 'x', name: 'X', kind: 'text', description: 'X.', limit: { per: 'day', count: 3, lairCount: 4 } }).success,
    ).toBe(true);
  });
});

describe('CreatureSchema', () => {
  const goblin = {
    id: 'goblin_warrior',
    name: 'Goblin Warrior',
    size: ['small'],
    type: 'fey',
    tags: ['goblinoid'],
    alignment: 'Chaotic Neutral',
    ac: 15,
    initiative: 2,
    hp: { average: 10, formula: '3d6' },
    speed: { walk: 30 },
    abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
    skills: { stealth: 6 },
    passivePerception: 9,
    languages: 'Common, Goblin',
    cr: 0.25,
    xp: 50,
    effects: [{ type: 'grant_sense', sense: 'darkvision', range: 60 }],
    actions: [
      {
        id: 'scimitar',
        name: 'Scimitar',
        kind: 'attack',
        attackKind: 'melee',
        toHit: 4,
        reach: 5,
        damage: [{ dice: '1d6+2', type: 'slashing' }],
      },
    ],
  };

  it('accepts a stat block', () => {
    expect(CreatureSchema.safeParse(goblin).success).toBe(true);
  });

  it.each([0.3, 31, -1])('rejects CR %s', (cr) => {
    expect(CreatureSchema.safeParse({ ...goblin, cr }).success).toBe(false);
  });

  it('rejects unknown skills', () => {
    expect(CreatureSchema.safeParse({ ...goblin, skills: { cooking: 2 } }).success).toBe(false);
  });

  it('requires at least one size', () => {
    expect(CreatureSchema.safeParse({ ...goblin, size: ['medium', 'small'] }).success).toBe(true);
    expect(CreatureSchema.safeParse({ ...goblin, size: [] }).success).toBe(false);
  });
});

describe('SpellSchema', () => {
  it('accepts a cantrip', () => {
    const light = {
      id: 'light',
      name: 'Light',
      level: 0,
      school: 'evocation',
      castingTime: 'Action',
      range: 'Touch',
      components: { verbal: true, somatic: false, material: 'a firefly or phosphorescent moss' },
      duration: '1 hour',
      classes: ['bard', 'cleric', 'sorcerer', 'wizard'],
      description: 'You touch one Large or smaller object...',
    };
    expect(SpellSchema.safeParse(light).success).toBe(true);
    expect(SpellSchema.safeParse({ ...light, level: 10 }).success).toBe(false);
  });
});
