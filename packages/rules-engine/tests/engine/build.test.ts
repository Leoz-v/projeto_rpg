import { describe, expect, it } from 'vitest';
import type { CharacterInput } from '../../src/schemas/character';
import { derive, errorsOf, fighterSteps, LANGUAGES, sel } from './helpers';

/** Validação da lista de escolhas: pendências, seleções inválidas e pré-requisitos. */

describe('pending choices', () => {
  it('lists every unresolved choice of the step and blocks completion', () => {
    const sheet = derive({
      steps: [
        { kind: 'species', speciesId: 'dwarf' },
        { kind: 'background', backgroundId: 'soldier', abilityIncreases: { str: 2, con: 1 } },
        { kind: 'class_level', classId: 'fighter' },
      ],
    });
    expect(sheet.complete).toBe(false);
    expect(sheet.pending.map((p) => `${p.source.id}/${p.choiceId}`)).toEqual([
      'character/languages',
      'soldier/gaming_set',
      'fighter/skills',
      'fighter/fighting_style',
      'fighter/weapon_mastery_1',
    ]);
  });

  it('is complete when everything is resolved', () => {
    const sheet = derive({});
    expect(sheet.pending).toEqual([]);
    expect(errorsOf(sheet)).toEqual([]);
    expect(sheet.complete).toBe(true);
  });

  it('asks for the subclass at Fighter level 3 and the feat at level 4', () => {
    const sheet = derive({
      steps: fighterSteps([
        { kind: 'class_level', classId: 'fighter' },
        { kind: 'class_level', classId: 'fighter' },
        { kind: 'class_level', classId: 'fighter' },
      ]),
    });
    expect(sheet.pending.map((p) => [p.stepIndex, p.choiceId])).toEqual([
      [4, 'subclass'],
      [5, 'feat_4'],
      [5, 'weapon_mastery_4'],
    ]);
  });

  it('requires the missing steps', () => {
    const sheet = derive({ steps: [] });
    expect(errorsOf(sheet)).toEqual(['missing_step', 'missing_step', 'missing_step']);
  });

  it('requires a size for species with two sizes', () => {
    const steps = fighterSteps();
    steps[0] = { kind: 'species', speciesId: 'human', selections: [LANGUAGES, sel('species', 'human', 'skillful', 'insight'), sel('species', 'human', 'versatile', 'alert')] };
    expect(errorsOf(derive({ steps }))).toEqual(['size_required']);
    steps[0] = { ...steps[0], size: 'small' };
    const sheet = derive({ steps });
    expect(errorsOf(sheet)).toEqual([]);
    expect(sheet.size).toBe('small');
  });
});

describe('invalid selections', () => {
  const withFighterSelections = (selections: readonly ReturnType<typeof sel>[]) => {
    const steps = fighterSteps();
    steps[2] = { kind: 'class_level', classId: 'fighter', selections: [...selections] };
    return derive({ steps });
  };
  const valid = [
    sel('class', 'fighter', 'skills', 'perception', 'survival'),
    sel('class', 'fighter', 'fighting_style', 'defense'),
    sel('class', 'fighter', 'weapon_mastery_1', 'longsword', 'greatsword', 'handaxe'),
  ] as const;

  it('rejects the wrong number of picks', () => {
    expect(errorsOf(withFighterSelections([sel('class', 'fighter', 'skills', 'perception'), ...valid.slice(1)]))).toEqual(['invalid_selection']);
  });

  it('rejects picks outside the allowed list', () => {
    expect(errorsOf(withFighterSelections([sel('class', 'fighter', 'skills', 'perception', 'arcana'), ...valid.slice(1)]))).toEqual(['invalid_selection']);
  });

  it('rejects repeated picks', () => {
    expect(errorsOf(withFighterSelections([sel('class', 'fighter', 'skills', 'perception', 'perception'), ...valid.slice(1)]))).toEqual(['invalid_selection']);
  });

  it('rejects a feat from the wrong category', () => {
    const sheet = withFighterSelections([valid[0], sel('class', 'fighter', 'fighting_style', 'alert'), valid[2]]);
    expect(errorsOf(sheet)).toEqual(['invalid_selection']);
  });

  it('rejects unknown weapons for mastery', () => {
    expect(errorsOf(withFighterSelections([...valid.slice(0, 2), sel('class', 'fighter', 'weapon_mastery_1', 'longsword', 'greatsword', 'lightsaber')]))).toEqual([
      'invalid_selection',
    ]);
  });

  it('rejects a selection that matches no choice in the step', () => {
    expect(errorsOf(withFighterSelections([...valid, sel('class', 'fighter', 'subclass', 'champion')]))).toEqual(['unexpected_selection']);
  });

  it('rejects background increases on abilities the background does not offer', () => {
    const steps = fighterSteps();
    steps[1] = { kind: 'background', backgroundId: 'soldier', abilityIncreases: { str: 2, wis: 1 }, selections: [sel('background', 'soldier', 'gaming_set', 'gaming_set_dice')] };
    expect(errorsOf(derive({ steps }))).toEqual(['invalid_selection']);
  });

  it('rejects increases above the cap of 20', () => {
    const steps = fighterSteps([
      { kind: 'class_level', classId: 'fighter' },
      { kind: 'class_level', classId: 'fighter', selections: [sel('class', 'fighter', 'subclass', 'champion')] },
      {
        kind: 'class_level',
        classId: 'fighter',
        selections: [
          sel('class', 'fighter', 'feat_4', 'ability_score_improvement'),
          sel('feat', 'ability_score_improvement', 'increase', 'str', 'str'),
          sel('class', 'fighter', 'weapon_mastery_4', 'dagger'),
        ],
      },
    ]);
    // FOR 15 base → 17 (Soldado) → 19 (+2): ok. Com FOR 17 base → 19 → 21: erro.
    expect(errorsOf(derive({ steps }))).toEqual([]);
    const strong = { method: 'manual' as const, scores: { str: 17, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } };
    expect(errorsOf(derive({ steps, baseScores: strong }))).toEqual(['invalid_selection']);
  });

  it('rejects a subclass of another class', () => {
    const steps = fighterSteps([
      { kind: 'class_level', classId: 'fighter' },
      { kind: 'class_level', classId: 'fighter', selections: [sel('class', 'fighter', 'subclass', 'evoker')] },
    ]);
    expect(errorsOf(derive({ steps }))).toEqual(['invalid_selection']);
  });
});

describe('feat prerequisites', () => {
  it('rejects a level 4 feat taken at level 1 (Human Versatile only offers Origin feats)', () => {
    const steps = fighterSteps();
    steps[0] = {
      kind: 'species',
      speciesId: 'human',
      size: 'medium',
      selections: [LANGUAGES, sel('species', 'human', 'skillful', 'insight'), sel('species', 'human', 'versatile', 'grappler')],
    };
    expect(errorsOf(derive({ steps }))).toEqual(['invalid_selection']);
  });

  it('rejects a non-repeatable feat taken twice', () => {
    const steps = fighterSteps();
    steps[0] = {
      kind: 'species',
      speciesId: 'human',
      size: 'medium',
      selections: [LANGUAGES, sel('species', 'human', 'skillful', 'insight'), sel('species', 'human', 'versatile', 'savage_attacker')],
    };
    // O Soldado já concede Savage Attacker.
    expect(errorsOf(derive({ steps }))).toEqual(['duplicate_feat']);
  });

  it('accepts a repeatable feat taken twice', () => {
    const steps = fighterSteps();
    steps[0] = {
      kind: 'species',
      speciesId: 'human',
      size: 'medium',
      selections: [LANGUAGES, sel('species', 'human', 'skillful', 'insight'), sel('species', 'human', 'versatile', 'skilled'), sel('feat', 'skilled', 'proficiencies', 'arcana', 'history', 'thieves_tools')],
    };
    const sheet = derive({ steps });
    expect(errorsOf(sheet)).toEqual([]);
    expect(sheet.skills.arcana.proficiency).toBe('proficient');
    expect(sheet.proficiencies.tools.map((t) => t.id)).toContain('thieves_tools');
  });

  it('rejects a Skilled pick that is neither a skill nor a compendium tool', () => {
    const steps = fighterSteps();
    steps[0] = {
      kind: 'species',
      speciesId: 'human',
      size: 'medium',
      selections: [LANGUAGES, sel('species', 'human', 'skillful', 'insight'), sel('species', 'human', 'versatile', 'skilled'), sel('feat', 'skilled', 'proficiencies', 'arcana', 'history', 'lockpicks')],
    };
    const sheet = derive({ steps });
    expect(errorsOf(sheet)).toEqual(['invalid_selection']);
    expect(sheet.issues.find((i) => i.severity === 'error')?.message).toContain('lockpicks');
    expect(sheet.proficiencies.tools.map((t) => t.id)).not.toContain('lockpicks');
  });

  it('checks ability prerequisites (Grappler: STR or DEX 13)', () => {
    const steps = fighterSteps([
      { kind: 'class_level', classId: 'fighter' },
      { kind: 'class_level', classId: 'fighter', selections: [sel('class', 'fighter', 'subclass', 'champion')] },
      {
        kind: 'class_level',
        classId: 'fighter',
        selections: [sel('class', 'fighter', 'feat_4', 'grappler'), sel('feat', 'grappler', 'ability_score_increase', 'str'), sel('class', 'fighter', 'weapon_mastery_4', 'dagger')],
      },
    ]);
    expect(errorsOf(derive({ steps }))).toEqual([]);
    const weak = { method: 'manual' as const, scores: { str: 8, dex: 10, con: 14, int: 8, wis: 12, cha: 10 } };
    // FOR 8 + 2 (Soldado) = 10 e DES 10: não atinge 13.
    expect(errorsOf(derive({ steps, baseScores: weak }))).toEqual(['prerequisite_not_met']);
  });
});

describe('multiclass', () => {
  const wizardLevel = { kind: 'class_level' as const, classId: 'wizard', selections: [sel('class', 'wizard', 'cantrips', 'fire_bolt', 'light', 'mage_hand'), sel('class', 'wizard', 'spellbook_1', 'detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'thunderwave')] };

  it('requires 13 in the primary ability of both classes', () => {
    // INT 8: não pode entrar em Mago.
    expect(errorsOf(derive({ steps: fighterSteps([wizardLevel]) }))).toEqual(['prerequisite_not_met']);
    const smart = { method: 'manual' as const, scores: { str: 15, dex: 13, con: 14, int: 13, wis: 12, cha: 10 } };
    expect(errorsOf(derive({ steps: fighterSteps([wizardLevel]), baseScores: smart }))).toEqual([]);
  });

  it('lists the classes for the next level, with the multiclass requirements', () => {
    const sheet = derive({ steps: fighterSteps() });
    const option = (id: string) => sheet.levelUp.find((o) => o.classId === id);
    expect(sheet.levelUp).toHaveLength(12);
    expect(option('fighter')).toEqual({ classId: 'fighter', multiclass: false, problems: [] });
    // INT 8: Mago fica de fora; FOR 17 dá Bárbaro (FOR 13).
    expect(option('wizard')?.multiclass).toBe(true);
    expect(option('wizard')?.problems).toEqual(['Multiclasse em Wizard exige INT 13 (Wizard).']);
    expect(option('barbarian')?.problems).toEqual([]);
  });

  it('offers no level up without a class or at level 20', () => {
    expect(derive({ steps: [{ kind: 'species', speciesId: 'dwarf', selections: [LANGUAGES] }] }).levelUp).toEqual([]);
    const twenty = fighterSteps(Array.from({ length: 19 }, () => ({ kind: 'class_level' as const, classId: 'fighter', selections: [] })));
    expect(derive({ steps: twenty }).levelUp).toEqual([]);
  });

  it('gives only the multiclass proficiencies and the fixed HP of the new class', () => {
    const smart = { method: 'manual' as const, scores: { str: 15, dex: 13, con: 14, int: 13, wis: 12, cha: 10 } };
    const sheet = derive({ steps: fighterSteps([wizardLevel]), baseScores: smart });
    // O Mago por multiclasse não dá salvaguardas de INT/SAB.
    expect(sheet.saves.int.proficient).toBe(false);
    // Guerreiro 1: 10 + CON 2; Mago 2º nível: 4 + 2; Anão: +2.
    expect(sheet.hpMax.total).toBe(10 + 2 + (4 + 2) + 2);
    expect(sheet.hitDice).toEqual([
      { die: 10, count: 1 },
      { die: 6, count: 1 },
    ]);
    expect(sheet.spellcasting.slots[0]).toBe(2);
  });
});

describe('expertise', () => {
  it('requires proficiency in the chosen skill', () => {
    const smart = { method: 'standard_array' as const, scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 } };
    const wizard = (scholar: string): CharacterInput['steps'] => [
      { kind: 'species' as const, speciesId: 'dwarf', selections: [LANGUAGES] },
      { kind: 'background' as const, backgroundId: 'soldier', abilityIncreases: { dex: 1, con: 2 }, selections: [sel('background', 'soldier', 'gaming_set', 'gaming_set_dice')] },
      {
        kind: 'class_level' as const,
        classId: 'wizard',
        selections: [sel('class', 'wizard', 'skills', 'arcana', 'history'), sel('class', 'wizard', 'cantrips', 'fire_bolt', 'light', 'mage_hand'), sel('class', 'wizard', 'spellbook_1', 'detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'thunderwave')],
      },
      { kind: 'class_level' as const, classId: 'wizard', selections: [sel('class', 'wizard', 'spellbook_2', 'burning_hands', 'find_familiar'), sel('class', 'wizard', 'scholar', scholar)] },
    ];
    expect(errorsOf(derive({ steps: wizard('arcana'), baseScores: smart }))).toEqual([]);
    expect(errorsOf(derive({ steps: wizard('nature'), baseScores: smart }))).toEqual(['invalid_selection']);
  });
});

describe('spell choices', () => {
  const smart = { method: 'standard_array' as const, scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 } };
  const wizard = (cantrips: string[], spellbook: string[]): CharacterInput['steps'] => [
    { kind: 'species', speciesId: 'dwarf', selections: [LANGUAGES] },
    { kind: 'background', backgroundId: 'soldier', abilityIncreases: { dex: 1, con: 2 }, selections: [sel('background', 'soldier', 'gaming_set', 'gaming_set_dice')] },
    {
      kind: 'class_level',
      classId: 'wizard',
      selections: [sel('class', 'wizard', 'skills', 'arcana', 'history'), sel('class', 'wizard', 'cantrips', ...cantrips), sel('class', 'wizard', 'spellbook_1', ...spellbook)],
    },
  ];
  const book = ['detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'thunderwave'];

  it('accepts valid wizard spells and records them', () => {
    const sheet = derive({ steps: wizard(['fire_bolt', 'light', 'mage_hand'], book), baseScores: smart });
    expect(errorsOf(sheet)).toEqual([]);
    expect(sheet.spellcasting.classes[0]?.cantrips).toEqual(['fire_bolt', 'light', 'mage_hand']);
    expect(sheet.spellcasting.classes[0]?.spells).toEqual(book);
  });

  it.each([
    ['an unknown spell', ['fire_bolt', 'light', 'mage_hand'], ['detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'magic_banana'], 'unknown_reference'],
    ['a spell above the allowed level', ['fire_bolt', 'light', 'mage_hand'], ['detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'fireball'], 'invalid_selection'],
    ['a level 1 spell as a cantrip', ['fire_bolt', 'light', 'magic_missile'], book, 'invalid_selection'],
    ['a spell from another class list', ['fire_bolt', 'light', 'mage_hand'], ['detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'cure_wounds'], 'invalid_selection'],
  ])('rejects %s', (_, cantrips, spellbook, code) => {
    expect(errorsOf(derive({ steps: wizard(cantrips, spellbook), baseScores: smart }))).toEqual([code]);
  });

  it('checks the school of Evocation Savant', () => {
    const steps = [
      ...wizard(['fire_bolt', 'light', 'mage_hand'], book),
      { kind: 'class_level' as const, classId: 'wizard', selections: [sel('class', 'wizard', 'spellbook_2', 'burning_hands', 'find_familiar'), sel('class', 'wizard', 'scholar', 'arcana')] },
      {
        kind: 'class_level' as const,
        classId: 'wizard',
        selections: [sel('class', 'wizard', 'subclass', 'evoker'), sel('class', 'wizard', 'spellbook_3', 'misty_step', 'web'), sel('subclass', 'evoker', 'evocation_savant', 'shatter', 'mirror_image')],
      },
    ];
    // Mirror Image é de Ilusão.
    expect(errorsOf(derive({ steps, baseScores: smart }))).toEqual(['invalid_selection']);
  });
});
