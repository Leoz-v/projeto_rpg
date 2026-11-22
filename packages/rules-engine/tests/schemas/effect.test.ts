import { describe, expect, it } from 'vitest';
import { EffectSchema } from '../../src/schemas/effect';
import { PredicateSchema } from '../../src/schemas/predicate';

/** Todos os exemplos de docs/effects-spec.md devem ser aceitos. */
const SPEC_EXAMPLES: unknown[] = [
  { type: 'flat_bonus', target: 'ac', value: 1 },
  { type: 'flat_bonus', target: 'speed.walk', value: 10, when: { armorCategory: 'heavy' } },
  { type: 'flat_bonus', target: 'hp_max', value: { perLevel: 1 } },
  { type: 'set_base_ac', base: 11, abilities: ['dex'] },
  { type: 'set_base_ac', base: 14, abilities: ['dex'], dexCap: 2 },
  { type: 'set_base_ac', base: 10, abilities: ['dex', 'con'], when: { wearingArmor: false } },
  { type: 'advantage', target: 'save.all', note: 'contra magias' },
  { type: 'disadvantage', target: 'skill.stealth', when: { armorCategory: 'heavy' } },
  { type: 'resistance', damageType: 'poison' },
  { type: 'vulnerability', damageType: 'fire' },
  { type: 'immunity', damageType: 'poison' },
  { type: 'immunity', condition: 'poisoned' },
  { type: 'grant_proficiency', category: 'skill', id: 'perception' },
  { type: 'grant_proficiency', category: 'save', id: 'con' },
  { type: 'grant_proficiency', category: 'weapon', id: 'martial' },
  { type: 'grant_proficiency', category: 'skill', id: 'stealth', level: 'expertise' },
  { type: 'grant_spell', spellId: 'light', ability: 'int', uses: 'at_will' },
  { type: 'grant_spell', spellId: 'misty_step', ability: 'wis', uses: { per: 'long_rest', count: 1 } },
  {
    type: 'grant_spell',
    spellId: 'faerie_fire',
    ability: { choice: 'spellcasting_ability' },
    uses: { per: 'long_rest', count: 1, slots: true },
  },
  { type: 'grant_spell', spellId: 'speak_with_animals', ability: 'wis', uses: { per: 'long_rest', count: { proficiency: 1 }, slots: true } },
  { type: 'grant_sense', sense: 'darkvision', range: 60 },
  { type: 'set_minimum_score', ability: 'str', value: 19 },
  { type: 'weapon_mastery', weaponId: 'longsword' },
  { type: 'condition', condition: 'poisoned' },
  { type: 'condition', condition: 'exhaustion', level: 2 },
];

describe('EffectSchema', () => {
  it.each(SPEC_EXAMPLES.map((e) => [JSON.stringify(e), e]))('accepts spec example %s', (_, example) => {
    expect(EffectSchema.safeParse(example).success).toBe(true);
  });

  it.each([
    ['unknown type', { type: 'teleport' }],
    ['unknown flat_bonus target', { type: 'flat_bonus', target: 'luck', value: 1 }],
    ['invalid skill in target', { type: 'flat_bonus', target: 'skill.cooking', value: 1 }],
    ['non-integer value', { type: 'flat_bonus', target: 'ac', value: 1.5 }],
    ['extra field (closed contract)', { type: 'resistance', damageType: 'fire', amount: 5 }],
    ['unknown damage type', { type: 'resistance', damageType: 'sonic' }],
    ['immunity with both damageType and condition', { type: 'immunity', damageType: 'poison', condition: 'poisoned' }],
    ['immunity with neither', { type: 'immunity' }],
    ['expertise on save', { type: 'grant_proficiency', category: 'save', id: 'con', level: 'expertise' }],
    ['armor proficiency id outside list', { type: 'grant_proficiency', category: 'armor', id: 'mithral' }],
    ['exhaustion without level', { type: 'condition', condition: 'exhaustion' }],
    ['exhaustion level 7', { type: 'condition', condition: 'exhaustion', level: 7 }],
    ['level on non-exhaustion condition', { type: 'condition', condition: 'poisoned', level: 1 }],
    ['sense range not multiple of 5', { type: 'grant_sense', sense: 'darkvision', range: 62 }],
    ['spell uses count zero', { type: 'grant_spell', spellId: 'light', ability: 'int', uses: { per: 'long_rest', count: 0 } }],
    ['spell uses with slots: false', { type: 'grant_spell', spellId: 'light', ability: 'int', uses: { per: 'long_rest', count: 1, slots: false } }],
    ['non snake_case id', { type: 'weapon_mastery', weaponId: 'Longsword' }],
    ['advantage on damage target', { type: 'advantage', target: 'damage.melee' }],
  ])('rejects %s', (_, invalid) => {
    expect(EffectSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('PredicateSchema', () => {
  it('accepts nested all/any', () => {
    const p = { all: [{ wearingArmor: false }, { any: [{ attackKind: 'melee' }, { weaponProperty: 'finesse' }] }] };
    expect(PredicateSchema.safeParse(p).success).toBe(true);
  });

  it.each([
    ['two keys in one predicate', { wearingArmor: false, wieldingShield: true }],
    ['empty all', { all: [] }],
    ['unknown predicate', { isRaining: true }],
    ['shield is not an armor category', { armorCategory: 'shield' }],
  ])('rejects %s', (_, invalid) => {
    expect(PredicateSchema.safeParse(invalid).success).toBe(false);
  });
});
