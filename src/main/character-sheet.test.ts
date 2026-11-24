import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import type { SessionCharacter } from '../shared/protocol';
import { characterSheet, creationOptions } from './character-sheet';

const compendium = loadSrdCompendium();

const draft = (overrides: Partial<SessionCharacter> = {}): SessionCharacter => ({
  id: randomUUID(),
  ownerId: randomUUID(),
  name: 'Thorin',
  baseScores: { method: 'standard_array', scores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } },
  rolledScores: null,
  steps: [],
  inventory: { currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [] },
  hp: { damage: 0, temp: 0 },
  adjustments: [],
  conditions: { active: [], exhaustion: 0 },
  deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
  concentration: null,
  ...overrides,
});

describe('characterSheet', () => {
  it('has no sheet until the ability scores are set', () => {
    expect(characterSheet(draft({ baseScores: null }), compendium)).toEqual({ sheet: null, names: {}, details: {} });
  });

  it('derives a draft and points at what is missing', () => {
    const { sheet } = characterSheet(draft(), compendium);
    expect(sheet?.abilities.str.total).toBe(15);
    expect(sheet?.complete).toBe(false);
    expect(sheet?.issues.some((i) => i.code === 'missing_step')).toBe(true);
  });

  it('names the compendium entries the sheet cites', () => {
    const { sheet, names } = characterSheet(
      draft({ steps: [{ kind: 'species', speciesId: 'dwarf', selections: [] }, { kind: 'class_level', classId: 'fighter', selections: [] }] }),
      compendium,
    );
    expect(sheet?.level).toBe(1);
    expect(names).toMatchObject({ dwarf: 'Dwarf', fighter: 'Fighter' });
  });

  it('names and describes the candidates of pending choices', () => {
    const { sheet, names, details } = characterSheet(draft({ steps: [{ kind: 'class_level', classId: 'wizard', selections: [] }] }), compendium);
    const cantrips = sheet?.pending.find((p) => p.choiceId === 'cantrips');
    expect(cantrips?.candidates).toContain('fire_bolt');
    expect(names['fire_bolt']).toBe('Fire Bolt');
    expect(details['fire_bolt']).toMatch(/^Truque · evocation/);
  });
});

describe('characterSheet inventory', () => {
  it('uses the character inventory', () => {
    const { sheet } = characterSheet(
      draft({ inventory: { currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [{ instanceId: 'mail', itemId: 'chain_mail', quantity: 1, equipped: true, attuned: false }] } }),
      compendium,
    );
    expect(sheet?.inventory.map((l) => l.name)).toEqual(['Chain Mail']);
    expect(sheet?.ac.total).toBe(16);
  });
});

describe('characterSheet adjustments', () => {
  it('applies the GM adjustments on top of the sheet, named in the breakdown', () => {
    const { sheet } = characterSheet(draft({ adjustments: [{ id: randomUUID(), name: 'Bênção do Templo', effects: [{ type: 'flat_bonus', target: 'ac', value: 2 }] }] }), compendium);
    expect(sheet?.ac.total).toBe(13);
    expect(sheet?.ac.parts.some((p) => p.label.includes('Bênção do Templo') || p.source?.name === 'Bênção do Templo')).toBe(true);
  });
});

describe('creationOptions', () => {
  it('lists species, backgrounds and classes with what they offer', () => {
    const options = creationOptions(compendium);
    expect(options.species.find((s) => s.id === 'human')?.sizes).toEqual(['medium', 'small']);
    expect(options.backgrounds.find((b) => b.id === 'soldier')).toMatchObject({ abilityOptions: ['str', 'dex', 'con'], traits: ['Talento: Savage Attacker'] });
    expect(options.classes.find((c) => c.id === 'fighter')).toMatchObject({ hitDie: 10, primaryAbilities: ['str', 'dex'] });
    expect(options.classes).toHaveLength(12);
  });
});
