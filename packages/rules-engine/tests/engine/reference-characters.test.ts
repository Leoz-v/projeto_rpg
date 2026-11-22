import { describe, expect, it } from 'vitest';
import { ABILITIES, SKILLS } from '../../src/schemas/common';
import { CharacterSchema, GmAdjustmentSchema } from '../../src/schemas/character';
import { InventorySchema } from '../../src/schemas/inventory';
import { deriveSheet } from '../../src/engine/sheet';
import type { DerivedSheet } from '../../src/engine/types';
import { loadSrdCompendium } from '../../src/srd';
import dwarfFighter from '../fixtures/dwarf-fighter-5.json';
import elfWizard from '../fixtures/elf-wizard-7.json';

/**
 * Personagens de referência: a ficha esperada de cada fixture foi calculada à
 * mão pelas regras do SRD 5.2.1, sem usar o motor. O teste projeta a ficha
 * derivada no mesmo formato e exige igualdade exata.
 */

const sorted = (list: readonly string[]): string[] => [...list].sort();

function project(sheet: DerivedSheet): unknown {
  return {
    complete: sheet.complete,
    level: sheet.level,
    proficiencyBonus: sheet.proficiencyBonus,
    abilities: Object.fromEntries(ABILITIES.map((a) => [a, sheet.abilities[a].total])),
    modifiers: Object.fromEntries(ABILITIES.map((a) => [a, sheet.abilities[a].modifier])),
    hpMax: sheet.hpMax.total,
    hitDice: sheet.hitDice,
    ac: sheet.ac.total,
    initiative: { total: sheet.initiative.total, mode: sheet.initiative.roll.mode },
    speed: { walk: sheet.speed.walk.total },
    saves: Object.fromEntries(ABILITIES.map((a) => [a, sheet.saves[a].total])),
    saveProficiencies: ABILITIES.filter((a) => sheet.saves[a].proficient),
    skills: Object.fromEntries(SKILLS.map((s) => [s, sheet.skills[s].total])),
    skillModes: Object.fromEntries(SKILLS.flatMap((s) => (sheet.skills[s].roll.mode === 'normal' ? [] : [[s, sheet.skills[s].roll.mode]]))),
    passivePerception: sheet.skills.perception.passive.total,
    senses: Object.fromEntries(sheet.senses.map((s) => [s.sense, s.range])),
    resistances: sorted(sheet.defenses.resistances.map((r) => r.damageType)),
    proficiencies: {
      armor: sorted(sheet.proficiencies.armor),
      weapons: sorted(sheet.proficiencies.weapons),
      tools: sorted(sheet.proficiencies.tools.map((t) => t.id)),
      languages: sorted(sheet.proficiencies.languages),
    },
    weaponMasteries: sorted(sheet.weaponMasteries),
    feats: sorted(sheet.feats.map((f) => f.featId)),
    attacks: sheet.attacks.map((a) => ({
      itemId: a.itemId,
      attack: a.attack.total,
      damage: a.damage.dice,
      damageBonus: a.damage.bonus.total,
      damageType: a.damage.type,
      ...(a.versatileDice ? { versatileDice: a.versatileDice } : {}),
      mastery: a.mastery.property,
      masteryAvailable: a.mastery.available,
    })),
    spellcasting: {
      classes: sheet.spellcasting.classes.map((c) => ({
        classId: c.classId,
        ability: c.ability,
        saveDc: c.saveDc.total,
        attack: c.attack.total,
        preparedSpells: c.preparedSpells,
        cantrips: c.cantrips,
        spellCount: c.spells.length,
      })),
      slots: sheet.spellcasting.slots,
      granted: [...sheet.spellcasting.granted]
        .sort((a, b) => a.spellId.localeCompare(b.spellId))
        .map((g) => ({ spellId: g.spellId, ability: g.ability, saveDc: g.saveDc, attackBonus: g.attackBonus })),
    },
  };
}

describe.each([
  ['dwarf-fighter-5', dwarfFighter],
  ['elf-wizard-7', elfWizard],
])('reference character %s', (_, fixture) => {
  const sheet = deriveSheet({
    character: CharacterSchema.parse(fixture.character),
    inventory: InventorySchema.parse(fixture.inventory),
    adjustments: fixture.adjustments.map((a) => GmAdjustmentSchema.parse(a)),
    compendium: loadSrdCompendium(),
  });

  it('has no errors and no pending choices', () => {
    expect(sheet.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(sheet.pending).toEqual([]);
  });

  it('matches the hand-checked sheet exactly', () => {
    expect(project(sheet)).toEqual(fixture.expected);
  });

  it('keeps every total equal to the sum of its parts', () => {
    const stats = [sheet.hpMax, sheet.ac, sheet.initiative, ...Object.values(sheet.saves), ...Object.values(sheet.skills), ...Object.values(sheet.abilities)];
    for (const s of stats) expect(s.total).toBe(s.parts.reduce((sum, p) => sum + p.value, 0));
  });
});
