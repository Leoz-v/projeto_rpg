import { describe, expect, it } from 'vitest';
import { availableSpellSlots, NO_SPELL_SLOTS_SPENT, spellSlotsAfterRest } from '../../src/engine/spell-slots';

/** Espaços de magia (SRD 5.2.1, "Spell Slots" e "Pact Magic"; nota 0051). */
describe('spell slots', () => {
  it('lists the slots of each existing level minus the spent ones, never below 0', () => {
    const slots = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(availableSpellSlots({ slots }, NO_SPELL_SLOTS_SPENT)).toEqual({
      levels: [
        { level: 1, total: 4, available: 4 },
        { level: 2, total: 3, available: 3 },
        { level: 3, total: 2, available: 2 },
      ],
      pact: undefined,
    });
    expect(availableSpellSlots({ slots }, { byLevel: { '1': 3, '3': 5 }, pact: 0 }).levels).toEqual([
      { level: 1, total: 4, available: 1 },
      { level: 2, total: 3, available: 3 },
      { level: 3, total: 2, available: 0 },
    ]);
  });

  it('keeps Pact Magic slots apart, all of the same level', () => {
    expect(availableSpellSlots({ slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactSlots: { count: 2, level: 3 } }, { byLevel: {}, pact: 1 }).pact).toEqual({ level: 3, total: 2, available: 1 });
  });

  it('a Long Rest restores every slot; a Short Rest only the Pact Magic ones', () => {
    const spent = { byLevel: { '1': 2 }, pact: 2 };
    expect(spellSlotsAfterRest(spent, 'long')).toEqual(NO_SPELL_SLOTS_SPENT);
    expect(spellSlotsAfterRest(spent, 'short')).toEqual({ byLevel: { '1': 2 }, pact: 0 });
  });
});
