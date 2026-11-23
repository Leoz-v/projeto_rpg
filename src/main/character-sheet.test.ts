import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import type { SessionCharacter } from '../shared/protocol';
import { characterSheet } from './character-sheet';

const compendium = loadSrdCompendium();

const draft = (overrides: Partial<SessionCharacter> = {}): SessionCharacter => ({
  id: randomUUID(),
  ownerId: randomUUID(),
  name: 'Thorin',
  baseScores: { method: 'standard_array', scores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } },
  rolledScores: null,
  steps: [],
  ...overrides,
});

describe('characterSheet', () => {
  it('has no sheet until the ability scores are set', () => {
    expect(characterSheet(draft({ baseScores: null }), compendium)).toEqual({ sheet: null, names: {} });
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
});
