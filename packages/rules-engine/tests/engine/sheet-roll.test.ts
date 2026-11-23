import { describe, expect, it } from 'vitest';
import { rollD20 } from '../../src/engine/d20';
import { type Rng } from '../../src/engine/dice';
import { deriveSheet } from '../../src/engine/sheet';
import { d20StepNotes, rollWeaponDamage, sheetD20 } from '../../src/engine/sheet-roll';
import { CharacterSchema } from '../../src/schemas/character';
import { InventorySchema } from '../../src/schemas/inventory';
import { loadSrdCompendium } from '../../src/srd';
import dwarfFighter from '../fixtures/dwarf-fighter-5.json';
import halflingBard from '../fixtures/halfling-bard-6.json';

const compendium = loadSrdCompendium();
const sheetOf = (fixture: { character: unknown; inventory?: unknown }) =>
  deriveSheet({ character: CharacterSchema.parse(fixture.character), inventory: InventorySchema.parse(fixture.inventory ?? {}), adjustments: [], compendium });
/** RNG que devolve os valores em sequência. */
const fixed = (values: number[]): Rng => {
  let i = 0;
  return { roll: () => values[i++ % values.length] ?? 1 };
};

describe('rolls from the sheet', () => {
  const fighter = sheetOf(dwarfFighter);
  const bard = sheetOf(halflingBard);

  it('uses the sheet modifier, breakdown and advantage for a skill', () => {
    const roll = sheetD20(fighter, { kind: 'skill', skill: 'athletics' });
    expect(roll?.input.modifier).toBe(fighter.skills.athletics.total);
    expect(roll?.parts).toBe(fighter.skills.athletics.parts);
    // Campeão: Remarkable Athlete dá Vantagem em Atletismo.
    expect(roll?.input.mode).toBe('advantage');
    expect(roll?.advantage).toEqual(['Champion']);
  });

  it('applies armor disadvantage on Stealth, cancelled by a declared advantage', () => {
    // Cota de malha: Desvantagem em Furtividade.
    expect(sheetD20(fighter, { kind: 'skill', skill: 'stealth' })?.input.mode).toBe('disadvantage');
    const declared = sheetD20(fighter, { kind: 'skill', skill: 'stealth' }, { advantage: true });
    expect(declared?.input.mode).toBe('normal');
    expect(declared?.advantage).toEqual(['Declarada na rolagem']);
  });

  it('carries the d20 rules and reminders of the sheet (Halfling Luck, Dwarven Resilience)', () => {
    const save = sheetD20(bard, { kind: 'save', ability: 'wis' });
    expect(save?.input.rules?.some((r) => r.rule === 'reroll' && r.on === 1)).toBe(true);
    const result = rollD20(save?.input ?? { modifier: 0, mode: 'normal' }, fixed([1, 15]));
    expect(result.die).toBe(15);
    expect(d20StepNotes(result.steps)).toEqual(['Rolou 1 de novo: 15 (Halfling)']);
    const con = sheetD20(fighter, { kind: 'save', ability: 'con' });
    expect(con?.reminders).toContain('Vantagem possível: Dwarf (contra Envenenado)');
  });

  it('uses the crit range of the Champion attack and refuses unknown attacks', () => {
    const attack = sheetD20(fighter, { kind: 'attack', instanceId: 'sword' });
    expect(attack?.input.critMin).toBe(19);
    expect(sheetD20(fighter, { kind: 'attack', instanceId: 'crossbow' })).toBeUndefined();
  });
});

describe('weapon damage', () => {
  const fighter = sheetOf(dwarfFighter);
  const sword = fighter.attacks.find((a) => a.instanceId === 'sword');
  if (!sword) throw new Error('sem espada');

  it('rolls the weapon dice plus the bonus', () => {
    const roll = rollWeaponDamage(sword, {}, fixed([5]));
    expect(roll.groups).toEqual([{ dice: '1d8', type: 'slashing', rolls: [{ sides: 8, value: 5 }], total: 5 }]);
    expect(roll.total).toBe(5 + sword.damage.bonus.total);
  });

  it('rolls the dice twice on a critical hit and uses the versatile die', () => {
    const crit = rollWeaponDamage(sword, { critical: true }, fixed([3, 6]));
    expect(crit.groups[0]?.dice).toBe('2d8');
    expect(crit.total).toBe(9 + sword.damage.bonus.total);
    expect(rollWeaponDamage(sword, { versatile: true }, fixed([10])).groups[0]?.dice).toBe('1d10');
  });
});
