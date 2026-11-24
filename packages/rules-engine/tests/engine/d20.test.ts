import { describe, expect, it } from 'vitest';
import { rollD20 } from '../../src/engine/d20';
import { type Rng, rollDice } from '../../src/engine/dice';
import type { DerivedSheet, SourceLabel, WeaponAttack } from '../../src/engine/types';
import type { Grant } from '../../src/schemas/source';
import { loadSrdCompendium } from '../../src/srd';
import { derive, fighterSteps, sel } from './helpers';

/** Regras de Teste d20 e mínimo nos dados de dano (docs/effects-spec.md 3.17, 3.18 e "Rolagem d20"). */

/** RNG que devolve os valores dados, em ordem. */
const fixed = (...values: number[]): Rng => ({ roll: () => values.shift() ?? 1 });
const src = (name: string): SourceLabel => ({ kind: 'class', id: name, name });
const adjustment = (id: string, effects: unknown[]) => ({ id, name: id, effects });
const rulesOf = (state: { rules: { rule: string }[] }): string[] => state.rules.map((r) => r.rule);

describe('rollD20', () => {
  it('rolls one d20 and adds the modifier', () => {
    expect(rollD20({ modifier: 5, mode: 'normal' }, fixed(12))).toMatchObject({ dice: [12], natural: 12, die: 12, total: 17, critical: false, fumble: false });
  });

  it('keeps the higher die with Advantage and the lower with Disadvantage', () => {
    expect(rollD20({ modifier: 0, mode: 'advantage' }, fixed(4, 15))).toMatchObject({ dice: [4, 15], natural: 15 });
    expect(rollD20({ modifier: 0, mode: 'disadvantage' }, fixed(4, 15))).toMatchObject({ dice: [4, 15], natural: 4 });
  });

  it('marks natural 20 as critical, natural 1 as a fumble, and honors the critical range', () => {
    expect(rollD20({ modifier: 0, mode: 'normal' }, fixed(20))).toMatchObject({ critical: true, fumble: false });
    expect(rollD20({ modifier: 0, mode: 'normal' }, fixed(1))).toMatchObject({ critical: false, fumble: true });
    expect(rollD20({ modifier: 0, mode: 'normal', critMin: 19 }, fixed(19))).toMatchObject({ critical: true });
  });

  it('rerolls a 1 once and uses the new roll (Halfling Luck)', () => {
    const luck = { rule: 'reroll' as const, on: 1, source: src('Luck') };
    const result = rollD20({ modifier: 2, mode: 'normal', rules: [luck] }, fixed(1, 1));
    expect(result).toMatchObject({ dice: [1], natural: 1, total: 3, fumble: true });
    expect(result.steps).toContainEqual({ kind: 'reroll', index: 0, from: 1, to: 1, source: luck.source });
    // Com Vantagem, cada dado que mostrou 1 é rolado de novo, antes de escolher.
    expect(rollD20({ modifier: 0, mode: 'advantage', rules: [luck] }, fixed(1, 6, 9))).toMatchObject({ dice: [9, 6], natural: 9 });
  });

  it('treats a low d20 as the minimum after keeping, without changing the natural (Reliable Talent)', () => {
    const talent = { rule: 'minimum_die' as const, value: 10, source: src('Reliable Talent') };
    const result = rollD20({ modifier: 4, mode: 'disadvantage', rules: [talent] }, fixed(3, 15));
    expect(result).toMatchObject({ natural: 3, die: 10, total: 14 });
    expect(rollD20({ modifier: 4, mode: 'normal', rules: [talent] }, fixed(13))).toMatchObject({ die: 13, total: 17 });
  });

  it('uses the score in place of a lower total (Indomitable Might)', () => {
    const might = { rule: 'minimum_total' as const, value: 20, source: src('Indomitable Might') };
    const low = rollD20({ modifier: 5, mode: 'normal', rules: [might] }, fixed(2));
    expect(low.total).toBe(20);
    expect(low.steps).toContainEqual({ kind: 'minimum_total', from: 7, to: 20, source: might.source });
    expect(rollD20({ modifier: 5, mode: 'normal', rules: [might] }, fixed(18)).total).toBe(23);
  });

  it('keeps the strongest rule of each kind (rules do not stack)', () => {
    const rules = [
      { rule: 'minimum_die' as const, value: 8 },
      { rule: 'minimum_die' as const, value: 10 },
      { rule: 'count_as_20' as const, min: 19 },
      { rule: 'count_as_20' as const, min: 18 },
    ];
    expect(rollD20({ modifier: 0, mode: 'normal', rules }, fixed(2))).toMatchObject({ die: 10 });
    expect(rollD20({ modifier: 0, mode: 'normal', rules }, fixed(18))).toMatchObject({ critical: true });
  });

  it('counts 18-20 as a natural 20 (Survivor, on Death Saving Throws)', () => {
    const survivor = { rule: 'count_as_20' as const, min: 18, source: src('Survivor') };
    const result = rollD20({ modifier: 0, mode: 'normal', rules: [survivor] }, fixed(18));
    expect(result).toMatchObject({ natural: 18, critical: true });
    expect(result.steps).toContainEqual({ kind: 'count_as_20', value: 18, source: survivor.source });
    expect(rollD20({ modifier: 0, mode: 'normal', rules: [survivor] }, fixed(17)).critical).toBe(false);
  });

  it('compares with the DC, and auto_success always succeeds (Greater Magic Resistance)', () => {
    expect(rollD20({ modifier: 1, mode: 'normal', dc: 15 }, fixed(14)).success).toBe(true);
    expect(rollD20({ modifier: 1, mode: 'normal', dc: 15 }, fixed(13)).success).toBe(false);
    expect(rollD20({ modifier: 1, mode: 'normal' }, fixed(13)).success).toBeUndefined();
    expect(rollD20({ modifier: 1, mode: 'normal', dc: 30, rules: [{ rule: 'auto_success' }] }, fixed(1)).success).toBe(true);
  });

  it('records every step in order', () => {
    const rules = [{ rule: 'reroll' as const, on: 1 }, { rule: 'minimum_die' as const, value: 10 }, { rule: 'minimum_total' as const, value: 18 }];
    expect(rollD20({ modifier: 3, mode: 'advantage', rules, dc: 18 }, fixed(1, 4, 2)).steps.map((s) => s.kind)).toEqual([
      'roll',
      'reroll',
      'keep',
      'minimum_die',
      'modifier',
      'minimum_total',
    ]);
  });
});

describe('damage die minimum', () => {
  it('raises each damage die below the minimum and keeps the rolled value (Great Weapon Fighting)', () => {
    expect(rollDice('2d6+3', fixed(1, 5), { minimumDie: 3 })).toEqual({
      expression: '2d6+3',
      rolls: [{ sides: 6, value: 3, rolled: 1 }, { sides: 6, value: 5 }],
      total: 11,
    });
  });
});

describe('d20 rules on the sheet', () => {
  it('applies d20_test rules to every D20 Test, including the Death Saving Throw', () => {
    const sheet = derive({
      adjustments: [adjustment('luck', [{ type: 'd20_rule', rule: 'reroll', on: 1, target: 'd20_test' }])],
      inventory: { items: [{ instanceId: 'sword', itemId: 'longsword', equipped: true }] },
    });
    for (const state of [sheet.saves.wis.roll, sheet.skills.history.roll, sheet.initiative.roll, sheet.deathSave.roll, sheet.attacks[0]?.attack.roll]) {
      expect(state && rulesOf(state)).toEqual(['reroll']);
    }
  });

  it('applies check.proficient only to skills with proficiency (Reliable Talent)', () => {
    const sheet = derive({ adjustments: [adjustment('talent', [{ type: 'd20_rule', rule: 'minimum_die', value: 10, target: 'check.proficient' }])] });
    expect(sheet.skills.perception.proficiency).toBe('proficient');
    expect(rulesOf(sheet.skills.perception.roll)).toEqual(['minimum_die']);
    expect(rulesOf(sheet.skills.history.roll)).toEqual([]);
    expect(rulesOf(sheet.saves.wis.roll)).toEqual([]);
  });

  it('resolves minimum_total from the ability score on STR checks and saves (Indomitable Might)', () => {
    const sheet = derive({
      adjustments: [
        adjustment('might', [
          { type: 'd20_rule', rule: 'minimum_total', value: { score: 'str' }, target: 'check.str' },
          { type: 'd20_rule', rule: 'minimum_total', value: { score: 'str' }, target: 'save.str' },
        ]),
      ],
    });
    expect(sheet.abilities.str.total).toBe(17);
    expect(sheet.skills.athletics.roll.rules).toMatchObject([{ rule: 'minimum_total', value: 17 }]);
    expect(sheet.saves.str.roll.rules).toMatchObject([{ rule: 'minimum_total', value: 17 }]);
    expect(sheet.saves.dex.roll.rules).toEqual([]);
  });

  it('lists a rule whose condition depends on the roll as situational', () => {
    const sheet = derive({
      adjustments: [adjustment('gmr', [{ type: 'd20_rule', rule: 'auto_success', target: 'save.all', when: { against: { source: 'magic' } } }])],
    });
    expect(sheet.saves.con.roll.rules).toEqual([]);
    expect(sheet.saves.con.roll.situationalRules).toMatchObject([{ rule: 'auto_success', when: { against: { source: 'magic' } } }]);
  });

  it('gives the Death Saving Throw save.all bonuses and death_save advantage', () => {
    const sheet = derive({
      adjustments: [
        adjustment('cloak', [{ type: 'flat_bonus', target: 'save.all', value: 1 }]),
        adjustment('defy', [{ type: 'advantage', target: 'death_save' }]),
      ],
    });
    expect(sheet.deathSave.total).toBe(1);
    expect(sheet.deathSave.roll.mode).toBe('advantage');
    expect(sheet.saves.con.roll.mode).toBe('normal');
  });
});

describe('damage die minimum on the sheet (Great Weapon Fighting)', () => {
  const gwf = derive({
    steps: fighterSteps().map((s) =>
      s.kind === 'class_level'
        ? { ...s, selections: (s.selections ?? []).map((x) => (x.choiceId === 'fighting_style' ? sel('class', 'fighter', 'fighting_style', 'great_weapon_fighting') : x)) }
        : s,
    ),
    inventory: {
      items: [
        { instanceId: 'great', itemId: 'greatsword', equipped: true },
        { instanceId: 'long', itemId: 'longsword', equipped: true },
        { instanceId: 'axe', itemId: 'handaxe', equipped: true },
        { instanceId: 'bow', itemId: 'longbow', equipped: true },
      ],
    },
  });
  const attack = (sheet: DerivedSheet, id: string): WeaponAttack | undefined => sheet.attacks.find((a) => a.instanceId === id);

  it('applies to Two-Handed melee weapons and to Versatile weapons used with two hands', () => {
    expect(attack(gwf, 'great')?.damage.dieMinimum?.value).toBe(3);
    expect(attack(gwf, 'long')?.damage.dieMinimum).toBeUndefined();
    expect(attack(gwf, 'long')?.versatileDieMinimum?.value).toBe(3);
  });

  it('does not apply to one-handed or ranged weapons', () => {
    expect(attack(gwf, 'axe')?.damage.dieMinimum).toBeUndefined();
    expect(attack(gwf, 'axe')?.versatileDieMinimum).toBeUndefined();
    expect(attack(gwf, 'bow')?.damage.dieMinimum).toBeUndefined();
  });
});

describe('SRD curation (Phase 1.5, d20 rules)', () => {
  const srd = loadSrdCompendium();
  const featureIn = (grants: readonly Grant[], id: string) => grants.flatMap((g) => (g.kind === 'feature' && g.feature.id === id ? [g.feature] : []))[0];
  const levelGrants = (levels: { level: number; grants: Grant[] }[], level: number): Grant[] => levels.find((l) => l.level === level)?.grants ?? [];
  const byId = <T extends { id: string }>(list: readonly T[], id: string): T => {
    const found = list.find((x) => x.id === id);
    if (!found) throw new Error(id);
    return found;
  };

  it('declares the d20 rules of each source', () => {
    expect(featureIn(levelGrants(byId(srd.species, 'halfling').levels, 1), 'luck')?.effects).toEqual([
      { type: 'd20_rule', rule: 'reroll', on: 1, target: 'd20_test' },
    ]);
    expect(featureIn(levelGrants(byId(srd.classes, 'rogue').levels, 7), 'reliable_talent')?.effects).toEqual([
      { type: 'd20_rule', rule: 'minimum_die', value: 10, target: 'check.proficient' },
    ]);
    expect(featureIn(levelGrants(byId(srd.classes, 'barbarian').levels, 18), 'indomitable_might')?.effects).toEqual([
      { type: 'd20_rule', rule: 'minimum_total', value: { score: 'str' }, target: 'check.str' },
      { type: 'd20_rule', rule: 'minimum_total', value: { score: 'str' }, target: 'save.str' },
    ]);
    expect(featureIn(levelGrants(byId(srd.subclasses, 'champion').levels, 18), 'survivor')?.effects).toEqual([
      { type: 'advantage', target: 'death_save' },
      { type: 'd20_rule', rule: 'count_as_20', min: 18, target: 'death_save' },
      // Heroic Rally (nota 0043).
      { type: 'turn_start_heal', value: 5, ability: 'con', bloodiedOnly: true },
    ]);
    expect(featureIn(byId(srd.feats, 'great_weapon_fighting').grants, 'great_weapon_fighting')?.effects).toEqual([
      { type: 'damage_die_minimum', min: 3, when: { all: [{ attackKind: 'melee' }, { twoHanded: true }] } },
    ]);
    expect(byId(srd.creatures, 'rakshasa').traits.find((t) => t.id === 'greater_magic_resistance')?.effects).toEqual([
      { type: 'd20_rule', rule: 'auto_success', target: 'save.all', when: { against: { source: 'magic' } } },
    ]);
  });
});
