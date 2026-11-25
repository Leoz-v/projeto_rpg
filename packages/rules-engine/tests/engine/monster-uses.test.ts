import { describe, expect, it } from 'vitest';
import { availableMonsterUses, monsterUseMax, pendingRecharges, withMonsterUse } from '../../src/engine/monster-uses';

const daily = { id: 'legendary_resistance', name: 'Legendary Resistance', limit: { per: 'day', count: 3, lairCount: 4 } };
const breath = { id: 'fire_breath', name: 'Fire Breath', limit: { recharge: 5 } };

describe('monster limited uses', () => {
  it('counts the uses per day, with one more in the lair', () => {
    expect(monsterUseMax(daily.limit, false)).toBe(3);
    expect(monsterUseMax(daily.limit, true)).toBe(4);
    expect(availableMonsterUses(daily, { spent: { legendary_resistance: 2 }, lair: false })).toBe(1);
    // Gastou 4 no covil e saiu: nunca negativo.
    expect(availableMonsterUses(daily, { spent: { legendary_resistance: 4 }, lair: false })).toBe(0);
  });

  it('a recharge action has one use and only a spent one is pending', () => {
    expect(availableMonsterUses(breath, { spent: {}, lair: false })).toBe(1);
    expect(pendingRecharges([daily, breath, { id: 'bite', name: 'Bite' }], { legendary_resistance: 1 })).toEqual([]);
    expect(pendingRecharges([daily, breath], { fire_breath: 1 })).toEqual([{ id: 'fire_breath', name: 'Fire Breath', min: 5 }]);
  });

  it('keeps only what is spent in the record', () => {
    expect(withMonsterUse({}, 'a', 1)).toEqual({ a: 1 });
    expect(withMonsterUse({ a: 1, b: 2 }, 'a', -1)).toEqual({ b: 2 });
    expect(withMonsterUse({}, 'a', -1)).toEqual({});
  });
});
