import { describe, expect, it } from 'vitest';
import { pactMagicSlots } from '../../src/engine/math';
import { evaluatePredicate } from '../../src/engine/sheet';
import type { CharacterInput } from '../../src/schemas/character';
import { EffectSchema } from '../../src/schemas/effect';
import { GrantSchema } from '../../src/schemas/source';
import { compendiumPlus, derive, errorsOf, fighterSteps, LANGUAGES, sel } from './helpers';

/**
 * Mecânicas exigidas pelas demais classes do SRD (nota 0009). Conteúdo de teste
 * próprio, para exercitar cada mecânica isolada.
 */

const humanWith = (featId: string, featSelections: ReturnType<typeof sel>[] = []): CharacterInput['steps'] => {
  const steps = fighterSteps();
  steps[0] = {
    kind: 'species',
    speciesId: 'human',
    size: 'medium',
    selections: [LANGUAGES, sel('species', 'human', 'skillful', 'insight'), sel('species', 'human', 'versatile', featId), ...featSelections],
  };
  return steps;
};

describe('schemas', () => {
  it.each([
    [{ type: 'half_proficiency', scope: 'unproficient_skills' }],
    [{ type: 'grant_speed', speed: 'climb', value: 'walk' }],
    [{ type: 'grant_speed', speed: 'fly', value: 60 }],
    [{ type: 'attack_ability', ability: 'dex', when: { all: [{ weaponCategory: 'simple' }, { not: { hasCondition: 'incapacitated' } }] } }],
    [{ type: 'flat_bonus', target: 'save.all', value: { ability: 'cha', min: 1 } }],
    [{ type: 'flat_bonus', target: 'speed.burrow', value: 10 }],
    [{ type: 'grant_proficiency', category: 'weapon', id: 'martial', properties: ['finesse', 'light'] }],
  ])('accepts %j', (effect) => {
    expect(EffectSchema.safeParse(effect).success).toBe(true);
  });

  it.each([
    [{ type: 'half_proficiency', scope: 'everything' }],
    [{ type: 'grant_speed', speed: 'teleport', value: 30 }],
    [{ type: 'grant_speed', speed: 'fly', value: 'run' }],
    [{ type: 'grant_proficiency', category: 'weapon', id: 'longsword', properties: ['light'] }],
    [{ type: 'advantage', target: 'save.dex', when: { hasCondition: 'sleepy' } }],
  ])('rejects %j', (effect) => {
    expect(EffectSchema.safeParse(effect).success).toBe(false);
  });

  it('accepts a fixed ability increase grant', () => {
    expect(GrantSchema.safeParse({ kind: 'ability_increase', ability: 'str', amount: 4, max: 25 }).success).toBe(true);
    expect(GrantSchema.safeParse({ kind: 'ability_increase', ability: 'str', amount: 0, max: 25 }).success).toBe(false);
  });
});

describe('predicates', () => {
  const none = new Set<never>();
  const base = { armor: undefined, shield: false, conditions: none };

  it('evaluates weaponCategory only inside an attack', () => {
    expect(evaluatePredicate({ weaponCategory: 'simple' }, base)).toBeUndefined();
    expect(evaluatePredicate({ weaponCategory: 'simple' }, { ...base, roll: { attack: { kind: 'melee', properties: [], category: 'simple' } } })).toBe(true);
    expect(evaluatePredicate({ weaponCategory: 'martial' }, { ...base, roll: { attack: { kind: 'melee', properties: [], category: 'simple' } } })).toBe(false);
  });

  it('evaluates hasCondition against the current conditions', () => {
    expect(evaluatePredicate({ hasCondition: 'incapacitated' }, base)).toBe(false);
    expect(evaluatePredicate({ hasCondition: 'incapacitated' }, { ...base, conditions: new Set(['incapacitated' as const]) })).toBe(true);
  });

  it('negates with three-valued logic', () => {
    expect(evaluatePredicate({ not: { wearingArmor: true } }, base)).toBe(true);
    expect(evaluatePredicate({ not: { attackKind: 'melee' } }, base)).toBeUndefined();
  });
});

describe('derived values', () => {
  it('applies a minimum to ability-based bonuses (Aura of Protection: CHA, min +1)', () => {
    const aura = { id: 'aura', name: 'Aura', effects: [{ type: 'flat_bonus', target: 'save.all', value: { ability: 'cha', min: 1 } }] };
    // CAR 10 (+0) vira +1.
    expect(derive({ adjustments: [aura] }).saves.wis.total).toBe(derive({}).saves.wis.total + 1);
  });

  it('turns an effect off while the creature has a condition', () => {
    const aura = { id: 'aura', name: 'Aura', effects: [{ type: 'flat_bonus', target: 'save.all', value: 2, when: { not: { hasCondition: 'incapacitated' } } }] };
    const stunned = { id: 'stun', name: 'Atordoado', effects: [{ type: 'condition', condition: 'incapacitated' }] };
    expect(derive({ adjustments: [aura] }).saves.wis.total).toBe(derive({}).saves.wis.total + 2);
    expect(derive({ adjustments: [aura, stunned] }).saves.wis.total).toBe(derive({}).saves.wis.total);
  });

  it('counts perLevel in the class level for class and subclass sources', () => {
    // Subclasse de teste do Guerreiro: +1 PV por nível de Guerreiro a partir do 3.
    const tough = { id: 'tough_champion', classId: 'fighter', name: 'Tough', levels: [{ level: 3, grants: [{ kind: 'effect', effect: { type: 'flat_bonus', target: 'hp_max', value: { perLevel: 1 } } }] }] };
    const compendium = compendiumPlus({ subclasses: [tough] });
    const smart = { method: 'manual' as const, scores: { str: 15, dex: 13, con: 14, int: 13, wis: 12, cha: 10 } };
    const steps = fighterSteps([
      { kind: 'class_level', classId: 'fighter' },
      { kind: 'class_level', classId: 'fighter', selections: [sel('class', 'fighter', 'subclass', 'tough_champion')] },
      {
        kind: 'class_level',
        classId: 'wizard',
        selections: [
          sel('class', 'wizard', 'cantrips', 'fire_bolt', 'light', 'mage_hand'),
          sel('class', 'wizard', 'spellbook_1', 'detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'thunderwave'),
        ],
      },
    ]);
    const sheet = derive({ steps, baseScores: smart, compendium });
    expect(errorsOf(sheet)).toEqual([]);
    // Guerreiro 3 / Mago 1 (nível de personagem 4): conta 3, não 4. O Anão conta 4 (nível de personagem).
    const parts = sheet.hpMax.parts.filter((p) => p.source?.kind === 'subclass' || p.source?.kind === 'species').map((p) => p.value);
    expect(parts).toEqual([4, 3]);
  });
});

describe('half proficiency (Jack of All Trades)', () => {
  const jack = { id: 'jack', name: 'Jack of All Trades', effects: [{ type: 'half_proficiency', scope: 'unproficient_skills' }] };

  it('adds half the proficiency bonus (rounded down) only to skills without proficiency', () => {
    const base = derive({});
    const sheet = derive({ adjustments: [jack] });
    // PB +2 → +1. Arcanismo sem proficiência ganha; Percepção (proficiente) não.
    expect(sheet.skills.arcana.total).toBe(base.skills.arcana.total + 1);
    expect(sheet.skills.perception.total).toBe(base.skills.perception.total);
    expect(sheet.skills.arcana.passive.total).toBe(base.skills.arcana.passive.total + 1);
    // Não é perícia: salvaguardas e iniciativa não mudam.
    expect(sheet.initiative.total).toBe(base.initiative.total);
    expect(sheet.saves.int.total).toBe(base.saves.int.total);
  });
});

describe('special speeds', () => {
  it('grants a speed equal to the walking speed, without applying penalties twice', () => {
    const roving = { id: 'r', name: 'Roving', effects: [{ type: 'grant_speed', speed: 'climb', value: 'walk' }, { type: 'grant_speed', speed: 'swim', value: 'walk' }] };
    expect(derive({ adjustments: [roving] }).speed.climb.total).toBe(30);
    const tired = { id: 't', name: 'Cansaço', effects: [{ type: 'condition', condition: 'exhaustion', level: 2 }] };
    const sheet = derive({ adjustments: [roving, tired] });
    expect(sheet.speed.walk.total).toBe(20);
    expect(sheet.speed.climb.total).toBe(20);
  });

  it('keeps the largest grant and applies penalties to fixed values', () => {
    const wings = { id: 'w', name: 'Asas', effects: [{ type: 'grant_speed', speed: 'fly', value: 60 }, { type: 'grant_speed', speed: 'fly', value: 'walk' }] };
    expect(derive({ adjustments: [wings] }).speed.fly.total).toBe(60);
    const tired = { id: 't', name: 'Cansaço', effects: [{ type: 'condition', condition: 'exhaustion', level: 1 }] };
    expect(derive({ adjustments: [wings, tired] }).speed.fly.total).toBe(55);
    expect(derive({}).speed.burrow.total).toBe(0);
  });
});

describe('attack ability (Martial Arts)', () => {
  const martialArts = {
    id: 'ma',
    name: 'Martial Arts',
    effects: [
      {
        type: 'attack_ability',
        ability: 'dex',
        when: { all: [{ attackKind: 'melee' }, { any: [{ weaponCategory: 'simple' }, { weaponProperty: 'light' }] }, { wearingArmor: false }, { wieldingShield: false }] },
      },
    ],
  };
  const nimble = { method: 'manual' as const, scores: { str: 10, dex: 16, con: 14, int: 8, wis: 12, cha: 10 } };

  it('lets matching weapons use DEX when it is higher', () => {
    const sheet = derive({ baseScores: nimble, adjustments: [martialArts], inventory: { items: [{ instanceId: 'q', itemId: 'quarterstaff', equipped: true }, { instanceId: 'g', itemId: 'greatsword', equipped: true }] } });
    const [staff, sword] = sheet.attacks;
    expect(staff?.ability).toBe('dex');
    expect(sword?.ability).toBe('str'); // marcial e não Leve
  });

  it('does not apply when the predicate fails (wearing armor)', () => {
    const sheet = derive({ baseScores: nimble, adjustments: [martialArts], inventory: { items: [{ instanceId: 'q', itemId: 'quarterstaff', equipped: true }, { instanceId: 'a', itemId: 'leather_armor', equipped: true }] } });
    expect(sheet.attacks[0]?.ability).toBe('str');
  });
});

describe('weapon proficiency by property', () => {
  it('grants only the martial weapons with the listed properties', () => {
    const steps: CharacterInput['steps'] = [
      { kind: 'species', speciesId: 'dwarf', selections: [LANGUAGES] },
      { kind: 'background', backgroundId: 'soldier', abilityIncreases: { dex: 1, con: 2 }, selections: [sel('background', 'soldier', 'gaming_set', 'gaming_set_dice')] },
      {
        kind: 'class_level',
        classId: 'wizard',
        selections: [
          sel('class', 'wizard', 'skills', 'arcana', 'history'),
          sel('class', 'wizard', 'cantrips', 'fire_bolt', 'light', 'mage_hand'),
          sel('class', 'wizard', 'spellbook_1', 'detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'thunderwave'),
        ],
      },
    ];
    const rogueish = { id: 'r', name: 'Treino', effects: [{ type: 'grant_proficiency', category: 'weapon', id: 'martial', properties: ['finesse', 'light'] }] };
    const sheet = derive({ steps, adjustments: [rogueish], inventory: { items: [{ instanceId: 's', itemId: 'scimitar', equipped: true }, { instanceId: 'l', itemId: 'longsword', equipped: true }] } });
    expect(sheet.attacks.map((a) => [a.itemId, a.proficient])).toEqual([
      ['scimitar', true],
      ['longsword', false],
    ]);
  });
});

describe('fixed ability increases', () => {
  const champion = (amount: number) => ({ id: 'primal', name: 'Primal', category: 'origin', grants: [{ kind: 'ability_increase', ability: 'str', amount, max: 25 }] });

  it('applies the increase up to its own cap', () => {
    const compendium = compendiumPlus({ feats: [champion(4)] });
    // Aumentos valem na ordem dos passos: FOR 13 + 4 (talento, no passo da espécie) = 17, + 2 (Soldado) = 19.
    // Com FOR 15 seria 19 + 2 = 21, acima do teto 20 do antecedente (erro, como manda o SRD).
    const sheet = derive({ steps: humanWith('primal'), compendium, baseScores: { method: 'manual', scores: { str: 13, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } } });
    expect(errorsOf(sheet)).toEqual([]);
    expect(sheet.abilities.str.total).toBe(19);
    expect(errorsOf(derive({ steps: humanWith('primal'), compendium }))).toEqual(['invalid_selection']);
  });

  it('rejects an increase above its own cap', () => {
    // FOR 13 + 13 = 26 > 25 (teto do próprio aumento), antes mesmo do antecedente.
    const compendium = compendiumPlus({ feats: [champion(13)] });
    const sheet = derive({ steps: humanWith('primal'), compendium, baseScores: { method: 'manual', scores: { str: 13, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } } });
    expect(sheet.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toContain('FOR passaria de 25 (Primal).');
  });
});

describe('weapon mastery filters', () => {
  const masteryFeat = (filters: Record<string, boolean>) => ({
    id: 'drills',
    name: 'Drills',
    category: 'origin',
    grants: [{ kind: 'choice', id: 'mastery', count: 1, options: { pick: 'weapon_mastery', ...filters } }],
  });

  it('rejects ranged weapons when the choice is melee only', () => {
    const compendium = compendiumPlus({ feats: [masteryFeat({ melee: true })] });
    expect(errorsOf(derive({ steps: humanWith('drills', [sel('feat', 'drills', 'mastery', 'dagger')]), compendium }))).toEqual([]);
    expect(errorsOf(derive({ steps: humanWith('drills', [sel('feat', 'drills', 'mastery', 'longbow')]), compendium }))).toEqual(['invalid_selection']);
  });

  it('rejects weapons without proficiency when the choice requires it', () => {
    const compendium = compendiumPlus({ feats: [masteryFeat({ proficient: true })] });
    // O Guerreiro tem proficiência com armas marciais: ok.
    expect(errorsOf(derive({ steps: humanWith('drills', [sel('feat', 'drills', 'mastery', 'musket')]), compendium }))).toEqual([]);
    // Um Mago não tem proficiência com mosquete.
    const steps = humanWith('drills', [sel('feat', 'drills', 'mastery', 'musket')]);
    steps[2] = {
      kind: 'class_level',
      classId: 'wizard',
      selections: [
        sel('class', 'wizard', 'skills', 'arcana', 'history'),
        sel('class', 'wizard', 'cantrips', 'fire_bolt', 'light', 'mage_hand'),
        sel('class', 'wizard', 'spellbook_1', 'detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'thunderwave'),
      ],
    };
    const smart = { method: 'manual' as const, scores: { str: 10, dex: 13, con: 14, int: 15, wis: 12, cha: 10 } };
    expect(errorsOf(derive({ steps, compendium, baseScores: smart }))).toEqual(['invalid_selection']);
  });
});

describe('option groups and prerequisites (invocations)', () => {
  const invocations = {
    id: 'occult',
    name: 'Occult',
    category: 'origin',
    grants: [
      { kind: 'choice', id: 'first', count: 1, options: { pick: 'option', group: 'invocations', options: OPTIONS() } },
      { kind: 'choice', id: 'second', count: 1, options: { pick: 'option', group: 'invocations', options: OPTIONS() } },
    ],
  };
  function OPTIONS() {
    return [
      { id: 'pact_of_the_blade', name: 'Pact of the Blade' },
      { id: 'eldritch_smite', name: 'Eldritch Smite', prerequisite: { options: ['pact_of_the_blade'] } },
      { id: 'ascendant_step', name: 'Ascendant Step', prerequisite: { minLevel: 5 } },
      { id: 'agonizing_blast', name: 'Agonizing Blast', repeatable: true },
    ];
  }
  const compendium = compendiumPlus({ feats: [invocations] });
  const pick = (a: string, b: string) => derive({ steps: humanWith('occult', [sel('feat', 'occult', 'first', a), sel('feat', 'occult', 'second', b)]), compendium });

  it('accepts an option whose prerequisite option was chosen in the group', () => {
    expect(errorsOf(pick('pact_of_the_blade', 'eldritch_smite'))).toEqual([]);
  });

  it('rejects an option whose prerequisite option is missing', () => {
    expect(errorsOf(pick('agonizing_blast', 'eldritch_smite'))).toEqual(['prerequisite_not_met']);
  });

  it('rejects an option above the level requirement', () => {
    expect(errorsOf(pick('pact_of_the_blade', 'ascendant_step'))).toEqual(['prerequisite_not_met']);
  });

  it('rejects repeating an option in the same group unless repeatable', () => {
    expect(errorsOf(pick('pact_of_the_blade', 'pact_of_the_blade'))).toEqual(['invalid_selection']);
    expect(errorsOf(pick('agonizing_blast', 'agonizing_blast'))).toEqual([]);
  });
});

describe('pact magic', () => {
  it('follows the Warlock table', () => {
    expect(pactMagicSlots(1)).toEqual({ count: 1, level: 1 });
    expect(pactMagicSlots(2)).toEqual({ count: 2, level: 1 });
    expect(pactMagicSlots(5)).toEqual({ count: 2, level: 3 });
    expect(pactMagicSlots(9)).toEqual({ count: 2, level: 5 });
    expect(pactMagicSlots(11)).toEqual({ count: 3, level: 5 });
    expect(pactMagicSlots(17)).toEqual({ count: 4, level: 5 });
    expect(pactMagicSlots(0)).toBeUndefined();
  });
});

describe('attunement limit', () => {
  const ring = { id: 'test_ring', name: 'Ring', kind: 'gear' as const, activation: 'attuned' as const };
  const compendium = compendiumPlus({ items: [ring] });
  const rings = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ instanceId: `r${String(i)}`, itemId: 'test_ring', attuned: true })) });

  it('allows 3 attuned items by default and rejects a 4th', () => {
    expect(errorsOf(derive({ compendium, inventory: rings(3) }))).toEqual([]);
    expect(errorsOf(derive({ compendium, inventory: rings(4) }))).toEqual(['too_many_attuned']);
  });

  it('raises the limit with attunement_slots (Use Magic Device)', () => {
    const umd = { id: 'umd', name: 'Use Magic Device', effects: [{ type: 'flat_bonus', target: 'attunement_slots', value: 1 }] };
    expect(errorsOf(derive({ compendium, inventory: rings(4), adjustments: [umd] }))).toEqual([]);
  });
});

describe('spell use counts', () => {
  it('resolves counts by proficiency and by class level table', () => {
    const table = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];
    const hunter = { id: 'h', name: 'Marca', effects: [
      { type: 'grant_spell', spellId: 'hunters_mark', ability: 'wis', uses: { per: 'long_rest', count: { byLevel: table }, slots: true } },
      { type: 'grant_spell', spellId: 'bless', ability: 'wis', uses: { per: 'long_rest', count: { proficiency: 1 } } },
      { type: 'grant_spell', spellId: 'light', ability: 'wis', uses: 'at_will' },
    ] };
    // Ajuste do mestre: escala de personagem (nível 1 → 2 usos; PB 2).
    const sheet = derive({ adjustments: [hunter] });
    expect(sheet.spellcasting.granted.map((g) => [g.spellId, g.count])).toEqual([
      ['hunters_mark', 2],
      ['bless', 2],
      ['light', undefined],
    ]);
  });
});

describe('ritual spell choices', () => {
  const tome = {
    id: 'tome',
    name: 'Tome',
    category: 'origin',
    grants: [{ kind: 'choice', id: 'rituals', count: 1, options: { pick: 'spell', lists: ['wizard'], minLevel: 1, maxLevel: 1, ritual: true, grantAs: { ability: 'int', uses: 'slot' } } }],
  };
  const compendium = compendiumPlus({ feats: [tome] });

  it('accepts only spells with the Ritual tag', () => {
    expect(errorsOf(derive({ steps: humanWith('tome', [sel('feat', 'tome', 'rituals', 'detect_magic')]), compendium }))).toEqual([]);
    expect(errorsOf(derive({ steps: humanWith('tome', [sel('feat', 'tome', 'rituals', 'magic_missile')]), compendium }))).toEqual(['invalid_selection']);
  });
});
