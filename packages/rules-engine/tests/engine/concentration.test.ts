import { describe, expect, it } from 'vitest';
import { concentrationDc } from '../../src/engine/concentration';
import { sheetD20 } from '../../src/engine/sheet-roll';
import type { CharacterInput } from '../../src/schemas/character';
import { EffectSchema } from '../../src/schemas/effect';
import { loadSrdCompendium } from '../../src/srd';
import gnomeRanger from '../fixtures/gnome-ranger-6.json';
import { derive } from './helpers';

/** Concentração (SRD 5.2.1, Rules Glossary; nota 0045). */

const adjustment = (id: string, effects: unknown[]) => ({ id, name: id, effects });
const ranger = gnomeRanger as unknown as { character: Pick<CharacterInput, 'steps' | 'baseScores'> };
const deriveRanger = (adjustments: unknown[] = []) => derive({ steps: ranger.character.steps, baseScores: ranger.character.baseScores, adjustments });

describe('concentration', () => {
  it('the DC is 10 or half the damage (rounded down), up to 30', () => {
    expect(concentrationDc(1)).toBe(10);
    expect(concentrationDc(21)).toBe(10);
    expect(concentrationDc(22)).toBe(11);
    expect(concentrationDc(45)).toBe(22);
    expect(concentrationDc(200)).toBe(30);
  });

  it('lists the spells of the sheet that require Concentration', () => {
    const sheet = deriveRanger();
    expect(sheet.spellcasting.concentration).toEqual(expect.arrayContaining(['hunters_mark']));
    const srd = loadSrdCompendium();
    for (const id of sheet.spellcasting.concentration) expect(srd.spells.find((s) => s.id === id)?.concentration).toBe(true);
    expect(sheet.spellcasting.keepConcentration).toEqual([]);
    expect(derive({}).spellcasting.concentration).toEqual([]);
  });

  it('keep_concentration lists the spell whose Concentration damage does not break', () => {
    expect(EffectSchema.safeParse({ type: 'keep_concentration', spellId: 'hunters_mark' }).success).toBe(true);
    const sheet = deriveRanger([adjustment('relentless', [{ type: 'keep_concentration', spellId: 'hunters_mark' }])]);
    expect(sheet.spellcasting.keepConcentration).toEqual(['hunters_mark']);
  });

  it('advantage "to maintain Concentration" applies only on the Concentration save', () => {
    const sheet = derive({ adjustments: [adjustment('mind', [{ type: 'advantage', target: 'save.con', when: { against: { concentration: true } } }])] });
    const plain = sheetD20(sheet, { kind: 'save', ability: 'con' });
    expect(plain?.input.mode).toBe('normal');
    expect(plain?.reminders.join(' ')).toContain('para manter Concentração');
    const kept = sheetD20(sheet, { kind: 'save', ability: 'con' }, {}, { concentration: true });
    expect(kept?.input.mode).toBe('advantage');
    expect(kept?.advantage).toEqual(['mind']);
  });
});

describe('SRD curation (Concentration)', () => {
  const srd = loadSrdCompendium();
  const text = JSON.stringify(srd.classes);

  it('Eldritch Mind gives Advantage on Concentration saves through the predicate, not a note', () => {
    expect(text).not.toContain('Para manter Concentração.');
    expect(text).toContain('{"type":"advantage","target":"save.con","when":{"against":{"concentration":true}}}');
  });

  it("Relentless Hunter keeps the Concentration on Hunter's Mark", () => {
    expect(text).toContain('"id":"relentless_hunter"');
    expect(text).toContain('{"type":"keep_concentration","spellId":"hunters_mark"}');
  });
});
