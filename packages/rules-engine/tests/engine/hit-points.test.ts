import { describe, expect, it } from 'vitest';
import { applyHitPointChange, clampHitPoints, currentHitPoints } from '../../src/engine/hit-points';

/** Exemplos do SRD 5.2.1 p. 17–18. */
describe('hit points', () => {
  it('heals up to the maximum (8 healing at 14/20 restores 6)', () => {
    const r = applyHitPointChange(20, { damage: 6, temp: 0 }, { kind: 'healing', amount: 8 });
    expect(r.state).toEqual({ damage: 0, temp: 0 });
    expect(r.hpChange).toBe(6);
  });

  it('loses temporary hit points first (5 temp, 7 damage: lose 2 HP)', () => {
    const r = applyHitPointChange(20, { damage: 0, temp: 5 }, { kind: 'damage', amount: 7 });
    expect(r.state).toEqual({ damage: 2, temp: 0 });
    expect(r).toMatchObject({ absorbed: 5, hpChange: -2, droppedToZero: false });
  });

  it('flags massive damage (max 12, at 6, takes 18: dies)', () => {
    const r = applyHitPointChange(12, { damage: 6, temp: 0 }, { kind: 'damage', amount: 18 });
    expect(currentHitPoints(12, r.state)).toBe(0);
    expect(r).toMatchObject({ droppedToZero: true, massiveDamage: true });
    expect(applyHitPointChange(12, { damage: 6, temp: 0 }, { kind: 'damage', amount: 17 }).massiveDamage).toBe(false);
  });

  it('flags damage taken at 0 hit points', () => {
    const r = applyHitPointChange(12, { damage: 12, temp: 0 }, { kind: 'damage', amount: 3 });
    expect(r).toMatchObject({ damagedAtZero: true, droppedToZero: false, hpChange: 0 });
    expect(r.state.damage).toBe(12);
  });

  it('replaces temporary hit points instead of stacking, and healing does not restore them', () => {
    expect(applyHitPointChange(20, { damage: 0, temp: 10 }, { kind: 'temp', amount: 12 }).state.temp).toBe(12);
    expect(applyHitPointChange(20, { damage: 4, temp: 0 }, { kind: 'healing', amount: 10 }).state).toEqual({ damage: 0, temp: 0 });
  });

  it('keeps the damage within a new maximum', () => {
    expect(clampHitPoints(10, { damage: 15, temp: 2 })).toEqual({ damage: 10, temp: 2 });
    expect(currentHitPoints(30, { damage: 10, temp: 0 })).toBe(20);
  });
});
