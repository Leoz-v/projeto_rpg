import { describe, expect, it } from 'vitest';
import { attackedByEffects, creatureAc, creatureAttacksAgainst, creatureD20, creatureReminders, deriveSheet, hasUnsupportedCreatureEffect, type NamedEffects, rollD20, withEffectDefenses } from '../../src/engine';
import fixtureJson from '../fixtures/elf-wizard-7.json';
import { loadSrdCompendium } from '../../src/srd';
import { CharacterSchema, type Effect, InventorySchema } from '../../src/schemas';

const compendium = loadSrdCompendium();

const named = (name: string, ...effects: Effect[]): NamedEffects => ({ name, effects });
const NONE = { conditions: new Set<never>(), exhaustion: 0 };
const spell = (id: string) => compendium.spells.find((s) => s.id === id)?.resolution[0];
const saveEffects = (id: string): Effect[] => {
  const part = spell(id);
  return part?.kind === 'save' ? part.onFailEffects : [];
};

describe('spell effects on a creature', () => {
  it('Bane subtracts 1d4 from attacks and saves, not from initiative', () => {
    const bane = [named('Bane (Morg)', ...saveEffects('bane'))];
    const save = creatureD20({ label: 'Salvaguarda', modifier: 2 }, NONE, { kind: 'save', ability: 'wis' }, {}, bane);
    const rolls = [10, 3];
    const result = rollD20(save.input, { roll: () => rolls.shift() ?? 1 });
    expect(result.total).toBe(9);
    expect(creatureD20({ label: 'Ataque', modifier: 4 }, NONE, { kind: 'attack', attackKind: 'melee' }, {}, bane).input.bonusDice).toHaveLength(1);
    expect(creatureD20({ label: 'Iniciativa', modifier: 2 }, NONE, { kind: 'initiative' }, {}, bane).input.bonusDice).toBeUndefined();
  });

  it('Slow: -2 to AC and to Dexterity saves only, with reminders', () => {
    const slow = [named('Slow (Morg)', ...saveEffects('slow'))];
    expect(creatureAc(15, slow)).toBe(13);
    expect(creatureD20({ label: 'Salvaguarda', modifier: 2 }, NONE, { kind: 'save', ability: 'dex' }, {}, slow).input.modifier).toBe(0);
    expect(creatureD20({ label: 'Salvaguarda', modifier: 2 }, NONE, { kind: 'save', ability: 'con' }, {}, slow).input.modifier).toBe(2);
    expect(creatureReminders(slow, 'turn_start')).toHaveLength(1);
    expect(creatureReminders(slow, 'turn_end')).toHaveLength(1);
  });

  it('minimum AC is applied after the bonuses and never lowers the AC', () => {
    const bark = named('Barkskin', { type: 'minimum_ac', value: 17 });
    const shield = named('Shield of Faith', { type: 'flat_bonus', target: 'ac', value: 2 });
    expect(creatureAc(13, [bark, shield])).toBe(17);
    expect(creatureAc(18, [bark])).toBe(18);
    expect(creatureAc(13, [])).toBe(13);
  });

  it('adds defenses without duplicating the ones in the block', () => {
    const base = { damageReductions: [], resistances: [], vulnerabilities: [], damageImmunities: [], conditionImmunities: [] };
    const out = withEffectDefenses(base, [named('Stoneskin', { type: 'resistance', damageType: 'slashing' }, { type: 'immunity', condition: 'frightened' }), named('X', { type: 'resistance', damageType: 'slashing' })]);
    expect(out.resistances).toHaveLength(1);
    expect(out.conditionImmunities).toHaveLength(1);
    expect(base.resistances).toEqual([]);
  });

  it('conditional and unknown effects are left to the GM', () => {
    expect(hasUnsupportedCreatureEffect([{ type: 'extra_damage', dice: '1d4' }])).toBe(true);
    const conditional: Effect = { type: 'advantage', target: 'save.all', when: { against: { condition: 'poisoned' } } };
    expect(hasUnsupportedCreatureEffect([conditional])).toBe(true);
    expect(creatureD20({ label: 'Salvaguarda', modifier: 0 }, NONE, { kind: 'save', ability: 'con' }, {}, [named('P', conditional)]).input.mode).toBe('normal');
    expect(hasUnsupportedCreatureEffect(saveEffects('bane'))).toBe(false);
  });
});

describe('attacks against the target', () => {
  it('Faerie Fire gives Advantage, with the caveat as a reminder', () => {
    const out = attackedByEffects(creatureAttacksAgainst([named('Faerie Fire (Morg)', ...saveEffects('faerie_fire'))]), undefined);
    expect(out).toEqual({ advantage: ['Faerie Fire (Morg)'], disadvantage: [], reminders: ['Faerie Fire (Morg): se o atacante puder ver o alvo'] });
  });

  it('Protection from Evil and Good depends on the attacker type', () => {
    const part = spell('protection_from_evil_and_good');
    const list = creatureAttacksAgainst([named('Protection', ...(part?.kind === 'buff' ? part.effects : []))]);
    expect(attackedByEffects(list, 'fiend').disadvantage).toEqual(['Protection']);
    expect(attackedByEffects(list, 'humanoid')).toEqual({ advantage: [], disadvantage: [], reminders: [] });
    expect(attackedByEffects(list, undefined).reminders).toHaveLength(1);
  });

  it('the sheet carries attacks_against and the minimum AC', () => {
    const fixture = fixtureJson as { character: unknown };
    const sheet = deriveSheet({
      character: CharacterSchema.parse(fixture.character),
      inventory: InventorySchema.parse({}),
      adjustments: [{ id: 'bark', name: 'Barkskin', effects: [{ type: 'minimum_ac', value: 17 }, { type: 'attacks_against', mode: 'disadvantage' }] }],
      compendium,
    });
    expect(sheet.ac.total).toBe(17);
    expect(sheet.attacksAgainst).toMatchObject([{ mode: 'disadvantage' }]);
  });
});
