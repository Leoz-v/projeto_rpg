import { describe, expect, it } from 'vitest';
import { CharacterSchema, GmAdjustmentSchema } from '../../src/schemas/character';
import { InventorySchema } from '../../src/schemas/inventory';
import { deriveSheet } from '../../src/engine/sheet';
import {
  ambientLightLevel,
  classifyPerception,
  creatureVisionProfile,
  DEFAULT_VISION_PROFILE,
  deriveVisionProfile,
  isPerceived,
  lightPresetForItem,
  lightPresetForSpell,
  maxVisionRangeFeet,
  resolveEffectiveLight,
  SRD_LIGHT_GEAR_PRESETS,
  SRD_LIGHT_SPELL_PRESETS,
  type VisionProfile,
} from '../../src/engine/vision';
import { loadSrdCompendium } from '../../src/srd';
import dwarfFighter from '../fixtures/dwarf-fighter-5.json';
import elfWizard from '../fixtures/elf-wizard-7.json';
import humanCleric from '../fixtures/human-cleric-5.json';
import { derive } from './helpers';

describe('ambientLightLevel', () => {
  it('returns darkness for interior regardless of time of day', () => {
    for (const time of ['day', 'dawn', 'dusk', 'twilight', 'night'] as const) {
      expect(ambientLightLevel('interior', time)).toBe('darkness');
    }
  });

  it('maps exterior times of day to SRD light levels', () => {
    expect(ambientLightLevel('exterior', 'day')).toBe('bright');
    expect(ambientLightLevel('exterior', 'dawn')).toBe('dim');
    expect(ambientLightLevel('exterior', 'dusk')).toBe('dim');
    expect(ambientLightLevel('exterior', 'twilight')).toBe('dim');
    expect(ambientLightLevel('exterior', 'night')).toBe('darkness');
  });

  it('respects explicit ambient override', () => {
    expect(ambientLightLevel('interior', 'day', 'bright')).toBe('bright');
    expect(ambientLightLevel('exterior', 'day', 'darkness')).toBe('darkness');
  });
});

describe('resolveEffectiveLight', () => {
  it('combines ambient and non-magical lights by taking the brightest', () => {
    expect(resolveEffectiveLight('darkness', [])).toBe('darkness');
    expect(resolveEffectiveLight('darkness', [{ kind: 'light', level: 'dim', spellLevel: null }])).toBe('dim');
    expect(
      resolveEffectiveLight('darkness', [
        { kind: 'light', level: 'dim', spellLevel: null },
        { kind: 'light', level: 'bright', spellLevel: null },
      ]),
    ).toBe('bright');
    expect(resolveEffectiveLight('dim', [])).toBe('dim');
    expect(resolveEffectiveLight('bright', [{ kind: 'light', level: 'dim', spellLevel: null }])).toBe('bright');
  });

  it('magical Darkness (lvl 2) suppresses sunlight, torches, Light cantrip (lvl 0), and Continual Flame (lvl 2)', () => {
    expect(
      resolveEffectiveLight('bright', [
        { kind: 'darkness', spellLevel: 2 },
        { kind: 'light', level: 'bright', spellLevel: null },
        { kind: 'light', level: 'bright', spellLevel: 0 },
        { kind: 'light', level: 'bright', spellLevel: 2 },
      ]),
    ).toBe('magical_darkness');
  });

  it('Daylight (lvl 3) overcomes Darkness (lvl 2)', () => {
    expect(
      resolveEffectiveLight('darkness', [
        { kind: 'darkness', spellLevel: 2 },
        { kind: 'light', level: 'bright', spellLevel: 3 },
      ]),
    ).toBe('bright');
  });

  it('higher-level Darkness (lvl 4) suppresses Daylight (lvl 3)', () => {
    expect(
      resolveEffectiveLight('bright', [
        { kind: 'darkness', spellLevel: 4 },
        { kind: 'light', level: 'bright', spellLevel: 3 },
      ]),
    ).toBe('magical_darkness');
  });
});

describe('classifyPerception', () => {
  const human: VisionProfile = { ...DEFAULT_VISION_PROFILE };
  const dwarf: VisionProfile = { ...DEFAULT_VISION_PROFILE, darkvisionFeet: 120 };
  const warlockDevilsSight: VisionProfile = { ...DEFAULT_VISION_PROFILE, magicalDarknessVisionFeet: 120 };
  const truesighter: VisionProfile = { ...DEFAULT_VISION_PROFILE, truesightFeet: 60 };
  const blindsighter: VisionProfile = { ...DEFAULT_VISION_PROFILE, blindsightFeet: 30 };
  const tremorsenser: VisionProfile = { ...DEFAULT_VISION_PROFILE, tremorsenseFeet: 60 };

  it('human sees bright/dim in color with LOS, nothing in darkness or behind walls', () => {
    expect(classifyPerception(human, { distanceFeet: 30, light: 'bright', hasLineOfSight: true })).toBe('bright_color');
    expect(classifyPerception(human, { distanceFeet: 30, light: 'dim', hasLineOfSight: true })).toBe('dim_color');
    expect(classifyPerception(human, { distanceFeet: 10, light: 'darkness', hasLineOfSight: true })).toBe('unseen');
    expect(classifyPerception(human, { distanceFeet: 10, light: 'magical_darkness', hasLineOfSight: true })).toBe('unseen');
    expect(classifyPerception(human, { distanceFeet: 10, light: 'bright', hasLineOfSight: false })).toBe('unseen');
  });

  it('darkvision treats dim light as bright color and darkness as black-and-white within range', () => {
    expect(classifyPerception(dwarf, { distanceFeet: 60, light: 'dim', hasLineOfSight: true })).toBe('bright_color');
    expect(classifyPerception(dwarf, { distanceFeet: 60, light: 'darkness', hasLineOfSight: true })).toBe('darkvision_bw');
    expect(classifyPerception(dwarf, { distanceFeet: 120, light: 'darkness', hasLineOfSight: true })).toBe('darkvision_bw');
    expect(classifyPerception(dwarf, { distanceFeet: 125, light: 'darkness', hasLineOfSight: true })).toBe('unseen');
    expect(classifyPerception(dwarf, { distanceFeet: 30, light: 'magical_darkness', hasLineOfSight: true })).toBe('unseen');
    expect(classifyPerception(dwarf, { distanceFeet: 30, light: 'darkness', hasLineOfSight: false })).toBe('unseen');
  });

  it('Devils Sight and Truesight see normally in both normal and magical darkness', () => {
    expect(classifyPerception(warlockDevilsSight, { distanceFeet: 60, light: 'magical_darkness', hasLineOfSight: true })).toBe('bright_color');
    expect(classifyPerception(warlockDevilsSight, { distanceFeet: 60, light: 'darkness', hasLineOfSight: true })).toBe('bright_color');
    expect(classifyPerception(warlockDevilsSight, { distanceFeet: 125, light: 'magical_darkness', hasLineOfSight: true })).toBe('unseen');

    expect(classifyPerception(truesighter, { distanceFeet: 60, light: 'magical_darkness', hasLineOfSight: true })).toBe('bright_color');
    expect(classifyPerception(truesighter, { distanceFeet: 65, light: 'darkness', hasLineOfSight: true })).toBe('unseen');
  });

  it('blindsight works in magical darkness and while blinded, but is blocked by walls', () => {
    expect(classifyPerception(blindsighter, { distanceFeet: 30, light: 'magical_darkness', hasLineOfSight: true })).toBe('sense_only');
    expect(classifyPerception({ ...blindsighter, blinded: true }, { distanceFeet: 20, light: 'bright', hasLineOfSight: true })).toBe('sense_only');
    expect(classifyPerception(blindsighter, { distanceFeet: 20, light: 'bright', hasLineOfSight: false })).toBe('unseen');
  });

  it('tremorsense detects grounded targets through walls/darkness, not flying targets', () => {
    expect(classifyPerception(tremorsenser, { distanceFeet: 40, light: 'darkness', hasLineOfSight: false, targetGrounded: true })).toBe('sense_only');
    expect(classifyPerception(tremorsenser, { distanceFeet: 40, light: 'darkness', hasLineOfSight: false, targetGrounded: false })).toBe('unseen');
    expect(classifyPerception(tremorsenser, { distanceFeet: 40, light: 'magical_darkness', hasLineOfSight: true, targetGrounded: false })).toBe('unseen');
  });

  it('blinded disables sight-based vision (normal, darkvision, truesight) while preserving non-sight senses', () => {
    const profile = deriveVisionProfile(
      [
        { type: 'grant_sense', sense: 'darkvision', range: 120 },
        { type: 'grant_sense', sense: 'truesight', range: 60 },
        { type: 'grant_sense', sense: 'blindsight', range: 10 },
      ],
      ['blinded'],
    );
    expect(profile.blinded).toBe(true);
    expect(profile.normalRangeFeet).toBe(0);
    expect(profile.darkvisionFeet).toBe(0);
    expect(profile.truesightFeet).toBe(0);
    expect(profile.blindsightFeet).toBe(10);
    expect(classifyPerception(profile, { distanceFeet: 30, light: 'bright', hasLineOfSight: true })).toBe('unseen');
    expect(classifyPerception(profile, { distanceFeet: 10, light: 'bright', hasLineOfSight: true })).toBe('sense_only');
  });

  it('respects configurable normalRangeFeet and maxVisionRangeFeet', () => {
    const shortSighted = deriveVisionProfile([{ type: 'vision_range', range: 60 }], []);
    expect(shortSighted.normalRangeFeet).toBe(60);
    expect(classifyPerception(shortSighted, { distanceFeet: 60, light: 'bright', hasLineOfSight: true })).toBe('bright_color');
    expect(classifyPerception(shortSighted, { distanceFeet: 65, light: 'bright', hasLineOfSight: true })).toBe('unseen');
    expect(isPerceived('darkvision_bw')).toBe(true);
    expect(isPerceived('unseen')).toBe(false);
    expect(maxVisionRangeFeet(human, 300)).toBe(300);
    expect(maxVisionRangeFeet(shortSighted, 300)).toBe(60);
    expect(maxVisionRangeFeet({ ...dwarf, normalRangeFeet: 60 }, 300)).toBe(120);
  });
});

describe('deriveVisionProfile and sheet integration', () => {
  const compendium = loadSrdCompendium();

  it('derives species darkvision on reference characters', () => {
    const deriveFixture = (fixture: { character: unknown; inventory: unknown; adjustments: unknown[] }) =>
      deriveSheet({
        character: CharacterSchema.parse(fixture.character),
        inventory: InventorySchema.parse(fixture.inventory),
        adjustments: fixture.adjustments.map((a) => GmAdjustmentSchema.parse(a)),
        compendium,
      });

    expect(deriveFixture(humanCleric).vision).toEqual({
      normalRangeFeet: null,
      darkvisionFeet: 0,
      magicalDarknessVisionFeet: 0,
      blindsightFeet: 0,
      tremorsenseFeet: 0,
      truesightFeet: 0,
      blinded: false,
    });
    expect(deriveFixture(dwarfFighter).vision.darkvisionFeet).toBe(120);
    expect(deriveFixture(elfWizard).vision.darkvisionFeet).toBe(60);
  });

  it('extends darkvision with Goggles of Night and supports vision_range set/cap adjustments', () => {
    const sheet = derive({
      adjustments: [
        { id: 'adj1', name: 'Visão Curta', effects: [{ type: 'vision_range', range: 60, mode: 'cap' }] },
        { id: 'adj2', name: 'Visão Ampla', effects: [{ type: 'vision_range', range: 120, mode: 'set' }] },
        { id: 'adj3', name: 'Olhar do Abismo', effects: [{ type: 'grant_sense', sense: 'darkvision', range: 120, magicalDarkness: true }] },
        { id: 'adj4', name: 'Extensão', effects: [{ type: 'grant_sense', sense: 'darkvision', range: 60, extend: true }] },
      ],
    });
    expect(sheet.vision.normalRangeFeet).toBe(60);
    expect(sheet.vision.darkvisionFeet).toBe(180);
    expect(sheet.vision.magicalDarknessVisionFeet).toBe(120);
  });

  it('zeroes sight ranges when character is blinded or unconscious', () => {
    const blindedSheet = derive({ conditions: { active: [{ condition: 'blinded' }], exhaustion: 0 } });
    expect(blindedSheet.vision.blinded).toBe(true);
    expect(blindedSheet.vision.darkvisionFeet).toBe(0);
    expect(blindedSheet.vision.normalRangeFeet).toBe(0);

    const unconsciousSheet = derive({ conditions: { active: [{ condition: 'unconscious' }], exhaustion: 0 } });
    expect(unconsciousSheet.vision.blinded).toBe(true);
    expect(unconsciousSheet.vision.darkvisionFeet).toBe(0);
  });

  it('derives creatureVisionProfile from SRD monsters', () => {
    const withDarkvision = compendium.creatures.find((c) => c.effects.some((e) => e.type === 'grant_sense' && e.sense === 'darkvision'));
    expect(withDarkvision).toBeDefined();
    if (withDarkvision) {
      expect(creatureVisionProfile(withDarkvision).darkvisionFeet).toBeGreaterThan(0);
    }
    const withTruesight = compendium.creatures.find((c) => c.effects.some((e) => e.type === 'grant_sense' && e.sense === 'truesight'));
    expect(withTruesight).toBeDefined();
    if (withTruesight) {
      expect(creatureVisionProfile(withTruesight).truesightFeet).toBeGreaterThan(0);
    }
  });
});

describe('SRD light gear and spell presets', () => {
  it('provides accurate SRD 5.2.1 presets for gear and spells', () => {
    expect(SRD_LIGHT_GEAR_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(SRD_LIGHT_SPELL_PRESETS.length).toBeGreaterThanOrEqual(5);

    const torch = lightPresetForItem('torch');
    expect(torch).toMatchObject({ kind: 'light', brightFeet: 20, dimFeet: 20, spellLevel: null, angleDeg: 360 });

    const bullseye = lightPresetForItem('bullseye_lantern');
    expect(bullseye).toMatchObject({ kind: 'light', brightFeet: 60, dimFeet: 60, angleDeg: 60 });

    const darkness = lightPresetForSpell('darkness');
    expect(darkness).toMatchObject({ kind: 'darkness', darknessFeet: 15, spellLevel: 2, concentration: true });

    const daylight = lightPresetForSpell('daylight');
    expect(daylight).toMatchObject({ kind: 'light', brightFeet: 60, dimFeet: 60, spellLevel: 3 });
  });
});
