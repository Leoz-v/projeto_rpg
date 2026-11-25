import { describe, expect, it } from 'vitest';
import { availableCharges, chargedItem, itemMagicProblems, itemSpellCosts, itemSpellLevel, lastChargeOutcome, rollDice } from '../../src/engine';
import { loadSrdCompendium } from '../../src/srd';

const compendium = loadSrdCompendium();
const charged = compendium.items.flatMap((i) => chargedItem(i) ?? []);

describe('item charges (note 0075)', () => {
  it('42 SRD items have charges; a rechargeable one has its dice', () => {
    expect(charged).toHaveLength(42);
    for (const c of charged) expect(c.item.charges?.regain === undefined, c.item.id).toBe(c.regain === undefined);
    expect(charged.find((c) => c.item.id === 'staff_of_the_magi')).toMatchObject({ max: 50, regain: '4d6+2' });
  });

  it('every spell of an item exists and fits its charges', () => {
    const casting = charged.filter((c) => c.item.casting);
    expect(casting).toHaveLength(24);
    for (const { item, max } of casting) {
      for (const s of item.casting?.spells ?? []) {
        expect(compendium.spells.some((x) => x.id === s.spellId), `${item.id}: ${s.spellId}`).toBe(true);
        expect(Math.max(...itemSpellCosts(s)), item.id).toBeLessThanOrEqual(max);
      }
    }
    expect(compendium.items.filter((i) => i.kind === 'magic_item' && i.casting && !i.charges)).toEqual([]);
  });

  it('counts what is left and the level of each cost', () => {
    expect(availableCharges(7, {})).toBe(7);
    expect(availableCharges(7, { chargesSpent: 3 })).toBe(4);
    expect(availableCharges(7, { chargesSpent: 9 })).toBe(0);
    const spell = { spellId: 'fireball', charges: 1, maxCharges: 3 };
    expect(itemSpellCosts(spell)).toEqual([1, 2, 3]);
    expect(itemSpellCosts(spell).map((c) => itemSpellLevel(spell, 3, c))).toEqual([3, 4, 5]);
    expect(itemSpellLevel({ spellId: 'fireball', charges: 5, level: 5 }, 3, 5)).toBe(5);
  });

  it('asks for attunement and for the item in hand', () => {
    const wand = charged.find((c) => c.item.id === 'wand_of_fireballs')?.item;
    if (!wand) throw new Error('sem varinha');
    expect(itemMagicProblems(wand, { equipped: false, attuned: false })).toHaveLength(2);
    expect(itemMagicProblems(wand, { equipped: true, attuned: true })).toEqual([]);
  });

  it('knows what the last charge does', () => {
    expect(lastChargeOutcome('destroyed_on_1', 1)).toBe('destroyed');
    expect(lastChargeOutcome('destroyed_on_1', 20)).toBe('kept');
    expect(lastChargeOutcome('destroyed', 0)).toBe('destroyed');
    expect(lastChargeOutcome('gm', 1)).toBe('gm');
    expect(lastChargeOutcome('gm', 10)).toBe('kept');
    expect(lastChargeOutcome(undefined, 1)).toBe('kept');
  });

  it('rolls a d3', () => {
    expect(rollDice('1d3', { roll: (sides) => sides }).total).toBe(3);
  });
});
