import { describe, expect, it } from 'vitest';
import { UNARMED_INSTANCE_ID } from '../../src/engine/sheet';
import { ABILITIES, SKILLS } from '../../src/schemas/common';
import { CharacterSchema, GmAdjustmentSchema } from '../../src/schemas/character';
import { InventorySchema } from '../../src/schemas/inventory';
import { deriveSheet } from '../../src/engine/sheet';
import type { DerivedSheet } from '../../src/engine/types';
import { loadSrdCompendium } from '../../src/srd';
import dwarfFighter from '../fixtures/dwarf-fighter-5.json';
import elfWizard from '../fixtures/elf-wizard-7.json';
import orcBarbarian from '../fixtures/orc-barbarian-5.json';
import halflingBard from '../fixtures/halfling-bard-6.json';
import humanCleric from '../fixtures/human-cleric-5.json';
import woodElfDruid from '../fixtures/wood-elf-druid-3.json';
import dwarfMonk from '../fixtures/dwarf-monk-6.json';
import dragonbornPaladin from '../fixtures/dragonborn-paladin-6.json';
import gnomeRanger from '../fixtures/gnome-ranger-6.json';
import tieflingRogue from '../fixtures/tiefling-rogue-5.json';
import humanSorcerer from '../fixtures/human-sorcerer-3.json';
import goliathWarlock from '../fixtures/goliath-warlock-5.json';

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
    // Deslocamentos especiais só aparecem quando existem.
    speed: Object.fromEntries((['walk', 'fly', 'swim', 'climb', 'burrow'] as const).flatMap((k) => (k === 'walk' || sheet.speed[k].total > 0 ? [[k, sheet.speed[k].total]] : []))),
    saves: Object.fromEntries(ABILITIES.map((a) => [a, sheet.saves[a].total])),
    saveProficiencies: ABILITIES.filter((a) => sheet.saves[a].proficient),
    saveModes: Object.fromEntries(ABILITIES.flatMap((a) => (sheet.saves[a].roll.mode === 'normal' ? [] : [[a, sheet.saves[a].roll.mode]]))),
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
    attacks: sheet.attacks.filter((a) => a.instanceId !== UNARMED_INSTANCE_ID).map((a) => ({
      itemId: a.itemId,
      attack: a.attack.total,
      damage: a.damage.dice,
      damageBonus: a.damage.bonus.total,
      damageType: a.damage.type,
      ...(a.versatileDice ? { versatileDice: a.versatileDice } : {}),
      // Só quando diferem do padrão (crítico só no 20, sem dano extra).
      ...(a.critRange !== 20 ? { critRange: a.critRange } : {}),
      ...(a.extraDamage.length ? { extraDamage: a.extraDamage.map((x) => `${x.dice} ${x.type}`) } : {}),
      mastery: a.mastery?.property,
      masteryAvailable: a.mastery?.available,
    })),
    unarmed: ((u) => u && { ability: u.ability, attack: u.attack.total, damage: u.damage.dice, damageBonus: u.damage.bonus.total })(sheet.attacks.find((a) => a.instanceId === UNARMED_INSTANCE_ID)),
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
      ...(sheet.spellcasting.pactSlots ? { pactSlots: sheet.spellcasting.pactSlots } : {}),
      granted: [...sheet.spellcasting.granted]
        .sort((a, b) => a.spellId.localeCompare(b.spellId))
        .map((g) => ({ spellId: g.spellId, ability: g.ability, saveDc: g.saveDc, attackBonus: g.attackBonus })),
    },
  };
}

describe.each([
  ['dwarf-fighter-5', dwarfFighter],
  ['elf-wizard-7', elfWizard],
  ['orc-barbarian-5', orcBarbarian],
  ['halfling-bard-6', halflingBard],
  ['human-cleric-5', humanCleric],
  ['wood-elf-druid-3', woodElfDruid],
  ['dwarf-monk-6', dwarfMonk],
  ['dragonborn-paladin-6', dragonbornPaladin],
  ['gnome-ranger-6', gnomeRanger],
  ['tiefling-rogue-5', tieflingRogue],
  ['human-sorcerer-3', humanSorcerer],
  ['goliath-warlock-5', goliathWarlock],
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

describe('reference character details not covered by the projection', () => {
  const derived = (fixture: { character: unknown; inventory: unknown }) =>
    deriveSheet({
      character: CharacterSchema.parse(fixture.character),
      inventory: InventorySchema.parse(fixture.inventory),
      adjustments: [],
      compendium: loadSrdCompendium(),
    });

  it('gnome-ranger-6 casts Hunters Mark 3 times for free at Ranger level 6 and Speak with Animals PB times', () => {
    const counts = Object.fromEntries(derived(gnomeRanger).spellcasting.granted.map((g) => [g.spellId, g.count]));
    expect(counts).toEqual({ hunters_mark: 3, minor_illusion: undefined, speak_with_animals: 3 });
  });

  it('human-sorcerer-3 adds Draconic Resilience per Sorcerer level', () => {
    const hp = derived(humanSorcerer).hpMax.parts.find((p) => p.source?.kind === 'subclass');
    expect(hp).toMatchObject({ value: 3, label: 'Draconic Resilience (Draconic Sorcery)' });
  });
});
