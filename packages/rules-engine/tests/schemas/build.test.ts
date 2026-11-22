import { describe, expect, it } from 'vitest';
import { BaseScoresSchema, CharacterSchema, GmAdjustmentSchema } from '../../src/schemas/character';
import { InventorySchema } from '../../src/schemas/inventory';
import { BackgroundSchema, ClassSchema, FeatSchema, GrantSchema, SpeciesSchema } from '../../src/schemas/source';

describe('sources', () => {
  it('accepts a species with a nested option choice', () => {
    const elf = {
      id: 'elf',
      name: 'Elf',
      sizes: ['medium'],
      speed: 30,
      levels: [
        {
          level: 1,
          grants: [
            { kind: 'effect', effect: { type: 'grant_sense', sense: 'darkvision', range: 60 } },
            { kind: 'effect', effect: { type: 'advantage', target: 'save.all', note: 'contra ser enfeitiçado' } },
            { kind: 'choice', id: 'keen_senses', count: 1, options: { pick: 'proficiency', categories: ['skill'], from: ['insight', 'perception', 'survival'] } },
            {
              kind: 'choice',
              id: 'elven_lineage',
              count: 1,
              options: {
                pick: 'option',
                options: [
                  {
                    id: 'high_elf',
                    name: 'High Elf',
                    grants: [{ kind: 'effect', effect: { type: 'grant_spell', spellId: 'prestidigitation', ability: 'int', uses: 'at_will' } }],
                  },
                  {
                    id: 'wood_elf',
                    name: 'Wood Elf',
                    grants: [{ kind: 'effect', effect: { type: 'flat_bonus', target: 'speed.walk', value: 5 } }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(SpeciesSchema.safeParse(elf).success).toBe(true);
  });

  it('rejects duplicate levels and duplicate choice ids', () => {
    const grant = { kind: 'choice', id: 'skill', count: 1, options: { pick: 'proficiency', categories: ['skill'] } };
    const base = { id: 'human', name: 'Human', sizes: ['medium', 'small'], speed: 30 };
    expect(
      SpeciesSchema.safeParse({ ...base, levels: [{ level: 1, grants: [grant] }, { level: 1, grants: [grant] }] }).success,
    ).toBe(false);
    expect(SpeciesSchema.safeParse({ ...base, levels: [{ level: 1, grants: [grant, grant] }] }).success).toBe(false);
  });

  it('accepts a background granting an origin feat', () => {
    const soldier = {
      id: 'soldier',
      name: 'Soldier',
      abilityOptions: ['str', 'dex', 'con'],
      levels: [
        {
          level: 1,
          grants: [
            { kind: 'feat', featId: 'savage_attacker' },
            { kind: 'effect', effect: { type: 'grant_proficiency', category: 'skill', id: 'athletics' } },
            { kind: 'effect', effect: { type: 'grant_proficiency', category: 'skill', id: 'intimidation' } },
          ],
        },
      ],
    };
    expect(BackgroundSchema.safeParse(soldier).success).toBe(true);
    expect(BackgroundSchema.safeParse({ ...soldier, abilityOptions: ['str', 'str', 'con'] }).success).toBe(false);
  });

  it('accepts the ASI feat as an ability_score choice', () => {
    const asi = {
      id: 'ability_score_improvement',
      name: 'Ability Score Improvement',
      category: 'general',
      prerequisite: { minLevel: 4 },
      repeatable: true,
      grants: [{ kind: 'choice', id: 'increase', count: 2, options: { pick: 'ability_score', max: 20 } }],
    };
    expect(FeatSchema.safeParse(asi).success).toBe(true);
  });

  it('accepts a class with levels, subclass and feat choices', () => {
    const fighter = {
      id: 'fighter',
      name: 'Fighter',
      hitDie: 10,
      primaryAbilities: ['str', 'dex'],
      startingGrants: [
        { kind: 'effect', effect: { type: 'grant_proficiency', category: 'save', id: 'str' } },
        { kind: 'effect', effect: { type: 'grant_proficiency', category: 'save', id: 'con' } },
        { kind: 'choice', id: 'skills', count: 2, options: { pick: 'proficiency', categories: ['skill'], from: ['acrobatics', 'athletics', 'perception'] } },
      ],
      multiclassGrants: [{ kind: 'effect', effect: { type: 'grant_proficiency', category: 'weapon', id: 'martial' } }],
      levels: [
        {
          level: 1,
          grants: [
            { kind: 'choice', id: 'fighting_style', count: 1, options: { pick: 'feat', categories: ['fighting_style'] } },
            { kind: 'choice', id: 'weapon_mastery', count: 3, options: { pick: 'weapon_mastery' } },
            { kind: 'feature', feature: { id: 'second_wind', name: 'Second Wind', description: 'Bonus action: regain 1d10 + level HP.' } },
          ],
        },
        { level: 3, grants: [{ kind: 'choice', id: 'subclass', count: 1, options: { pick: 'subclass' } }] },
        { level: 4, grants: [{ kind: 'choice', id: 'feat_4', count: 1, options: { pick: 'feat', categories: ['general'] } }] },
      ],
    };
    expect(ClassSchema.safeParse(fighter).success).toBe(true);
    expect(ClassSchema.safeParse({ ...fighter, hitDie: 7 }).success).toBe(false);
  });

  describe('source integrity', () => {
    const lineage = (abilityRef: unknown): object => ({
      id: 'elf',
      name: 'Elf',
      sizes: ['medium'],
      speed: 30,
      levels: [
        {
          level: 1,
          grants: [
            { kind: 'choice', id: 'spellcasting_ability', count: 1, options: { pick: 'ability', from: ['int', 'wis', 'cha'] } },
            {
              kind: 'choice',
              id: 'elven_lineage',
              count: 1,
              options: {
                pick: 'option',
                options: [
                  {
                    id: 'drow',
                    name: 'Drow',
                    grants: [{ kind: 'effect', effect: { type: 'grant_sense', sense: 'darkvision', range: 120 } }],
                    levels: [
                      {
                        level: 3,
                        grants: [
                          {
                            kind: 'effect',
                            effect: {
                              type: 'grant_spell',
                              spellId: 'faerie_fire',
                              ability: abilityRef,
                              uses: { per: 'long_rest', count: 1, slots: true },
                            },
                          },
                        ],
                      },
                    ],
                  },
                  { id: 'wood_elf', name: 'Wood Elf', grants: [{ kind: 'effect', effect: { type: 'flat_bonus', target: 'speed.walk', value: 5 } }] },
                ],
              },
            },
          ],
        },
      ],
    });

    it('accepts an ability reference to an ability choice of the same source, inside an option level', () => {
      expect(SpeciesSchema.safeParse(lineage({ choice: 'spellcasting_ability' })).success).toBe(true);
    });

    it('rejects a reference to a missing choice', () => {
      expect(SpeciesSchema.safeParse(lineage({ choice: 'nope' })).success).toBe(false);
    });

    it('rejects a reference to a choice that is not an ability pick', () => {
      expect(SpeciesSchema.safeParse(lineage({ choice: 'elven_lineage' })).success).toBe(false);
    });

    it('rejects a choice id repeated inside an option', () => {
      const dup = {
        id: 'x',
        name: 'X',
        category: 'origin',
        grants: [
          { kind: 'choice', id: 'pick', count: 1, options: { pick: 'subclass' } },
          {
            kind: 'choice',
            id: 'style',
            count: 1,
            options: {
              pick: 'option',
              options: [
                { id: 'a', name: 'A', grants: [{ kind: 'choice', id: 'pick', count: 1, options: { pick: 'weapon_mastery' } }] },
                { id: 'b', name: 'B' },
              ],
            },
          },
        ],
      };
      expect(FeatSchema.safeParse(dup).success).toBe(false);
    });

    it('checks references in spell choice templates (Magic Initiate)', () => {
      const magicInitiate = (ref: unknown): object => ({
        id: 'magic_initiate_wizard',
        name: 'Magic Initiate (Wizard)',
        category: 'origin',
        repeatable: true,
        grants: [
          { kind: 'choice', id: 'spellcasting_ability', count: 1, options: { pick: 'ability', from: ['int', 'wis', 'cha'] } },
          {
            kind: 'choice',
            id: 'cantrips',
            count: 2,
            options: { pick: 'spell', lists: ['wizard'], maxLevel: 0, grantAs: { ability: ref, uses: 'at_will' } },
          },
          {
            kind: 'choice',
            id: 'level_1_spell',
            count: 1,
            options: {
              pick: 'spell',
              lists: ['wizard'],
              minLevel: 1,
              maxLevel: 1,
              grantAs: { ability: ref, uses: { per: 'long_rest', count: 1, slots: true } },
            },
          },
        ],
      });
      expect(FeatSchema.safeParse(magicInitiate({ choice: 'spellcasting_ability' })).success).toBe(true);
      expect(FeatSchema.safeParse(magicInitiate({ choice: 'cantrips' })).success).toBe(false);
    });
  });

  it.each([
    ['spell choice with minLevel above maxLevel', { kind: 'choice', id: 'x', count: 1, options: { pick: 'spell', lists: ['wizard'], minLevel: 2, maxLevel: 1 } }],
    ['ability choice with a single ability', { kind: 'choice', id: 'x', count: 1, options: { pick: 'ability', from: ['int'] } }],
    ['proficiency choice without categories', { kind: 'choice', id: 'x', count: 1, options: { pick: 'proficiency', categories: [] } }],
    ['option choice with a single option', { kind: 'choice', id: 'x', count: 1, options: { pick: 'option', options: [{ id: 'a', name: 'A', grants: [] }] } }],
    ['zero count', { kind: 'choice', id: 'x', count: 0, options: { pick: 'subclass' } }],
    ['unknown pick', { kind: 'choice', id: 'x', count: 1, options: { pick: 'pet' } }],
    ['invalid nested effect', { kind: 'effect', effect: { type: 'flat_bonus', target: 'ac', value: 'a lot' } }],
  ])('rejects grant: %s', (_, grant) => {
    expect(GrantSchema.safeParse(grant).success).toBe(false);
  });
});

describe('BaseScoresSchema', () => {
  const array = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

  it('accepts the standard array in any order', () => {
    expect(BaseScoresSchema.safeParse({ method: 'standard_array', scores: { ...array, str: 8, cha: 15 } }).success).toBe(true);
  });

  it('rejects a modified standard array', () => {
    expect(BaseScoresSchema.safeParse({ method: 'standard_array', scores: { ...array, cha: 9 } }).success).toBe(false);
  });

  it('enforces point buy limits', () => {
    // 15,15,15 = 27 pontos, resto em 8.
    const max = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 };
    expect(BaseScoresSchema.safeParse({ method: 'point_buy', scores: max }).success).toBe(true);
    expect(BaseScoresSchema.safeParse({ method: 'point_buy', scores: { ...max, int: 9 } }).success).toBe(false);
    expect(BaseScoresSchema.safeParse({ method: 'point_buy', scores: { ...max, str: 16, dex: 8 } }).success).toBe(false);
  });

  it('limits rolled scores to 3–18', () => {
    expect(BaseScoresSchema.safeParse({ method: 'rolled', scores: { ...array, str: 18, cha: 3 } }).success).toBe(true);
    expect(BaseScoresSchema.safeParse({ method: 'rolled', scores: { ...array, str: 19 } }).success).toBe(false);
  });
});

describe('CharacterSchema', () => {
  const character = {
    id: 'thorin',
    name: 'Thorin',
    baseScores: { method: 'standard_array', scores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } },
    steps: [
      { kind: 'species', speciesId: 'dwarf' },
      { kind: 'background', backgroundId: 'soldier', abilityIncreases: { str: 2, con: 1 } },
      {
        kind: 'class_level',
        classId: 'fighter',
        selections: [
          { source: { kind: 'class', id: 'fighter' }, choiceId: 'skills', picks: ['athletics', 'perception'] },
          { source: { kind: 'class', id: 'fighter' }, choiceId: 'fighting_style', picks: ['defense'] },
        ],
      },
      {
        kind: 'class_level',
        classId: 'fighter',
        selections: [
          { source: { kind: 'class', id: 'fighter' }, choiceId: 'feat_4', picks: ['ability_score_improvement'] },
          { source: { kind: 'feat', id: 'ability_score_improvement' }, choiceId: 'increase', picks: ['str', 'str'] },
        ],
      },
    ],
  };

  it('accepts an ordered build', () => {
    const parsed = CharacterSchema.parse(character);
    expect(parsed.steps[0]).toEqual({ kind: 'species', speciesId: 'dwarf', selections: [] });
  });

  it.each([
    [{ str: 2, con: 2 }],
    [{ str: 1, con: 1 }],
    [{ str: 2, dex: 1, con: 1 }],
    [{ str: 2 }],
  ])('rejects background increases %j', (abilityIncreases) => {
    const steps = character.steps.map((s) => (s.kind === 'background' ? { ...s, abilityIncreases } : s));
    expect(CharacterSchema.safeParse({ ...character, steps }).success).toBe(false);
  });

  it('accepts +1/+1/+1 background increases', () => {
    const steps = character.steps.map((s) => (s.kind === 'background' ? { ...s, abilityIncreases: { str: 1, dex: 1, con: 1 } } : s));
    expect(CharacterSchema.safeParse({ ...character, steps }).success).toBe(true);
  });

  it('rejects two species', () => {
    const steps = [{ kind: 'species', speciesId: 'elf' }, ...character.steps];
    expect(CharacterSchema.safeParse({ ...character, steps }).success).toBe(false);
  });

  it('rejects the same choice resolved twice in a step', () => {
    const sel = { source: { kind: 'class', id: 'fighter' }, choiceId: 'skills', picks: ['athletics'] };
    const steps = [{ kind: 'class_level', classId: 'fighter', selections: [sel, sel] }];
    expect(CharacterSchema.safeParse({ ...character, steps }).success).toBe(false);
  });

  it('rejects more than 20 class levels', () => {
    const steps = Array.from({ length: 21 }, () => ({ kind: 'class_level', classId: 'fighter' }));
    expect(CharacterSchema.safeParse({ ...character, steps }).success).toBe(false);
  });

  it('rejects final values written into the build', () => {
    expect(CharacterSchema.safeParse({ ...character, ac: 18 }).success).toBe(false);
  });
});

describe('GmAdjustmentSchema', () => {
  it('requires at least one effect', () => {
    expect(GmAdjustmentSchema.safeParse({ id: 'blessing', name: 'Bênção do templo', effects: [] }).success).toBe(false);
    expect(
      GmAdjustmentSchema.safeParse({ id: 'blessing', name: 'Bênção do templo', effects: [{ type: 'resistance', damageType: 'necrotic' }] })
        .success,
    ).toBe(true);
  });
});

describe('InventorySchema', () => {
  const entry = (instanceId: string, attuned = false): object => ({ instanceId, itemId: 'ring_of_protection', attuned });

  it('fills defaults', () => {
    expect(InventorySchema.parse({})).toEqual({ currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [] });
  });

  it('leaves the attunement limit to the engine (it depends on features like Use Magic Device)', () => {
    expect(InventorySchema.safeParse({ items: [entry('a', true), entry('b', true), entry('c', true), entry('d', true)] }).success).toBe(true);
  });

  it('rejects duplicate instance ids and negative coins', () => {
    expect(InventorySchema.safeParse({ items: [entry('a'), entry('a')] }).success).toBe(false);
    expect(InventorySchema.safeParse({ currency: { gp: -1 } }).success).toBe(false);
  });
});
