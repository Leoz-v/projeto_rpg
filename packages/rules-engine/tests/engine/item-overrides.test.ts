import { describe, expect, it } from 'vitest';
import type { CharacterInput } from '../../src/schemas/character';
import type { DerivedSheet, WeaponAttack } from '../../src/engine/types';
import { evaluatePredicate } from '../../src/engine/sheet';
import { derive, fighterSteps, LANGUAGES, sel } from './helpers';

/** Último grupo da Fase 1.5: `minimum_speed`, `base_override` e o predicado `species` (docs/effects-spec.md 3.19, 3.20, seção 2). */

const LOW_STR = { method: 'standard_array' as const, scores: { str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 } };
const attack = (sheet: DerivedSheet, id: string): WeaponAttack | undefined => sheet.attacks.find((a) => a.instanceId === id);
const stealthDisadvantage = (sheet: DerivedSheet): boolean => sheet.skills.stealth.roll.disadvantage.length > 0;

/** Mago anão de nível 1 (sem proficiência com armas marciais). */
const wizardSteps: CharacterInput['steps'] = [
  ...fighterSteps().filter((s) => s.kind !== 'class_level'),
  {
    kind: 'class_level',
    classId: 'wizard',
    selections: [sel('class', 'wizard', 'cantrips', 'fire_bolt', 'light', 'mage_hand'), sel('class', 'wizard', 'spellbook_1', 'detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'thunderwave')],
  },
];
const withSpecies = (speciesId: string): CharacterInput['steps'] => fighterSteps().map((s) => (s.kind === 'species' ? { kind: 'species', speciesId, selections: [LANGUAGES] } : s));

describe('Mithral Armor (base_override on armor)', () => {
  const plate = (itemId: string) => derive({ baseScores: LOW_STR, inventory: { items: [{ instanceId: 'a', itemId, ...(itemId === 'mithral_armor' ? { baseItemId: 'plate_armor' } : {}), equipped: true }] } });

  it('removes the Strength requirement and the Stealth Disadvantage of the base armor', () => {
    const normal = plate('plate_armor');
    expect(normal.speed.walk.total).toBe(20);
    expect(stealthDisadvantage(normal)).toBe(true);
    const mithral = plate('mithral_armor');
    expect(mithral.ac.total).toBe(normal.ac.total);
    expect(mithral.speed.walk.total).toBe(30);
    expect(stealthDisadvantage(mithral)).toBe(false);
  });
});

describe('Boots of Striding and Springing (minimum_speed)', () => {
  const boots = { instanceId: 'b', itemId: 'boots_of_striding_and_springing', equipped: true, attuned: true };
  const slow = { id: 'slow', name: 'Lento', effects: [{ type: 'flat_bonus', target: 'speed.walk', value: -10 }] };

  it('raises a lower walking speed to 30 ft and keeps a higher one', () => {
    expect(derive({ adjustments: [slow] }).speed.walk.total).toBe(20);
    expect(derive({ adjustments: [slow], inventory: { items: [boots] } }).speed.walk.total).toBe(30);
    const fast = { id: 'fast', name: 'Rápido', effects: [{ type: 'flat_bonus', target: 'speed.walk', value: 10 }] };
    expect(derive({ adjustments: [fast], inventory: { items: [boots] } }).speed.walk.total).toBe(40);
  });

  it('ignores the heavy armor penalty, but not Exhaustion', () => {
    const items = [boots, { instanceId: 'a', itemId: 'plate_armor', equipped: true }];
    expect(derive({ baseScores: LOW_STR, inventory: { items } }).speed.walk.total).toBe(30);
    const tired = { id: 'tired', name: 'Cansado', effects: [{ type: 'condition', condition: 'exhaustion', level: 1 }] };
    expect(derive({ baseScores: LOW_STR, adjustments: [tired], inventory: { items } }).speed.walk.total).toBe(25);
  });

  it('needs attunement', () => {
    expect(derive({ adjustments: [slow], inventory: { items: [{ ...boots, attuned: false }] } }).speed.walk.total).toBe(20);
  });
});

describe('Sun Blade (base_override on a weapon)', () => {
  const blade = (attuned: boolean) => ({ instanceId: 's', itemId: 'sun_blade', equipped: true, attuned });

  it('functions as a Longsword with Finesse that deals Radiant damage', () => {
    const sheet = derive({ baseScores: LOW_STR, inventory: { items: [blade(true), { instanceId: 'l', itemId: 'longsword', equipped: true }] } });
    const sun = attack(sheet, 's');
    expect(sun?.itemId).toBe('longsword');
    expect(sun?.ability).toBe('dex');
    expect(sun?.damage.type).toBe('radiant');
    // A Longsword comum não muda.
    expect(attack(sheet, 'l')).toMatchObject({ ability: 'str', damage: { type: 'slashing' } });
  });

  it('is proficient through Shortsword proficiency', () => {
    const shortsword = { id: 'short', name: 'Treino', effects: [{ type: 'grant_proficiency', category: 'weapon', id: 'shortsword' }] };
    expect(attack(derive({ steps: wizardSteps, inventory: { items: [blade(true)] } }), 's')?.proficient).toBe(false);
    expect(attack(derive({ steps: wizardSteps, adjustments: [shortsword], inventory: { items: [blade(true)] } }), 's')?.proficient).toBe(true);
  });

  it('stays a plain Longsword while not attuned', () => {
    expect(attack(derive({ baseScores: LOW_STR, inventory: { items: [blade(false)] } }), 's')).toMatchObject({ ability: 'str', damage: { type: 'slashing' } });
  });
});

describe('Belt of Dwarvenkind (species predicate)', () => {
  const belt = { instanceId: 'b', itemId: 'belt_of_dwarvenkind', equipped: true, attuned: true };

  it('grants Darkvision, Poison Resistance and Advantage against Poisoned only to non-dwarves', () => {
    const halfling = derive({ steps: withSpecies('halfling'), inventory: { items: [belt] } });
    expect(halfling.senses).toMatchObject([{ sense: 'darkvision', range: 60 }]);
    expect(halfling.defenses.resistances.map((r) => r.damageType)).toEqual(['poison']);
    expect(halfling.saves.con.roll.situational.filter((x) => x.source.id === 'belt_of_dwarvenkind')).toMatchObject([
      { kind: 'advantage', when: { all: [{ not: { species: 'dwarf' } }, { against: { condition: 'poisoned' } }] } },
    ]);

    const dwarf = derive({ inventory: { items: [belt] } });
    expect(dwarf.senses.find((s) => s.sense === 'darkvision')?.source.id).toBe('dwarf');
    expect(dwarf.defenses.resistances.flatMap((r) => r.sources.map((s) => s.id))).toEqual(['dwarf']);
    expect(dwarf.saves.con.roll.situational.filter((s) => s.source.id === 'belt_of_dwarvenkind')).toEqual([]);
  });

  it('evaluates species statically, and never for creatures without species', () => {
    const ctx = { shield: false, conditions: new Set<never>() };
    expect(evaluatePredicate({ species: 'dwarf' }, { ...ctx, speciesId: 'dwarf' })).toBe(true);
    expect(evaluatePredicate({ species: 'dwarf' }, { ...ctx, speciesId: 'elf' })).toBe(false);
    expect(evaluatePredicate({ species: 'dwarf' }, ctx)).toBe(false);
  });
});
