import { describe, expect, it } from 'vitest';
import { deathAfterDamage, deathAfterHealing, type DeathSaveState, isDying, NO_DEATH_SAVES, resolveDeathSave } from '../../src/engine/death';
import { applyHitPointChange } from '../../src/engine/hit-points';

/** Salvaguardas contra a Morte (SRD 5.2.1 p. 17–18). */

const state = (over: Partial<DeathSaveState> = {}): DeathSaveState => ({ ...NO_DEATH_SAVES, ...over });
const roll = (total: number, extra: { natural1?: boolean; natural20?: boolean } = {}) => ({ total, natural1: extra.natural1 ?? false, natural20: extra.natural20 ?? false });
const damage = (max: number, damageTaken: number, amount: number) => applyHitPointChange(max, { damage: damageTaken, temp: 0 }, { kind: 'damage', amount });

describe('death saving throws', () => {
  it('succeeds on 10 or higher and fails below', () => {
    expect(resolveDeathSave(state(), roll(10))).toEqual({ state: state({ successes: 1 }), outcome: 'success' });
    expect(resolveDeathSave(state(), roll(9))).toEqual({ state: state({ failures: 1 }), outcome: 'failure' });
  });

  it('becomes Stable on the third success, with the counts reset', () => {
    expect(resolveDeathSave(state({ successes: 2, failures: 2 }), roll(15))).toEqual({ state: state({ stable: true }), outcome: 'success' });
  });

  it('dies on the third failure; a 1 counts as two failures', () => {
    expect(resolveDeathSave(state({ failures: 2 }), roll(3)).state).toEqual(state({ failures: 3, dead: true }));
    expect(resolveDeathSave(state(), roll(1, { natural1: true }))).toEqual({ state: state({ failures: 2 }), outcome: 'two_failures' });
    expect(resolveDeathSave(state({ failures: 2 }), roll(1, { natural1: true })).state).toEqual(state({ failures: 3, dead: true }));
  });

  it('a 20 (or what counts as 20) regains 1 HP: the caller heals, which resets the counts', () => {
    expect(resolveDeathSave(state({ failures: 2 }), roll(20, { natural20: true }))).toEqual({ state: state({ failures: 2 }), outcome: 'revived' });
    expect(deathAfterHealing(state({ successes: 1, failures: 2 }))).toEqual(NO_DEATH_SAVES);
    expect(deathAfterHealing(state({ stable: true }))).toEqual(NO_DEATH_SAVES);
  });

  it('only a creature at 0 HP that is neither Stable nor dead is dying', () => {
    expect(isDying(0, state())).toBe(true);
    expect(isDying(1, state())).toBe(false);
    expect(isDying(0, state({ stable: true }))).toBe(false);
    expect(isDying(0, state({ dead: true }))).toBe(false);
  });

  it('the dead stay dead when healed', () => {
    expect(deathAfterHealing(state({ failures: 3, dead: true }))).toEqual(state({ failures: 3, dead: true }));
  });
});

describe('damage and 0 hit points', () => {
  it('dropping to 0 makes the character Unconscious, with fresh counts', () => {
    expect(deathAfterDamage(state({ successes: 2 }), damage(20, 15, 5), false)).toEqual({ state: NO_DEATH_SAVES, event: 'unconscious' });
  });

  it('massive damage kills: the remainder equals or exceeds the HP maximum (SRD: 12 max, 6 HP, 18 damage)', () => {
    expect(deathAfterDamage(state(), damage(12, 6, 18), false)).toEqual({ state: state({ dead: true }), event: 'dead' });
    expect(deathAfterDamage(state(), damage(12, 6, 17), false).event).toBe('unconscious');
  });

  it('damage at 0 HP is one failure, two on a Critical Hit, death if it equals the maximum', () => {
    expect(deathAfterDamage(state(), damage(20, 20, 3), false)).toEqual({ state: state({ failures: 1 }), event: 'failure' });
    expect(deathAfterDamage(state(), damage(20, 20, 3), true)).toEqual({ state: state({ failures: 2 }), event: 'two_failures' });
    expect(deathAfterDamage(state({ failures: 2 }), damage(20, 20, 3), false)).toEqual({ state: state({ failures: 3, dead: true }), event: 'dead' });
    expect(deathAfterDamage(state(), damage(20, 20, 20), false)).toEqual({ state: state({ dead: true }), event: 'dead' });
  });

  it('a Stable creature that takes damage stops being Stable', () => {
    expect(deathAfterDamage(state({ stable: true }), damage(20, 20, 1), false).state).toEqual(state({ failures: 1 }));
  });

  it('damage above 0 HP, or on the dead, changes nothing', () => {
    expect(deathAfterDamage(state(), damage(20, 0, 5), false)).toEqual({ state: state(), event: 'none' });
    expect(deathAfterDamage(state({ dead: true }), damage(20, 20, 5), true)).toEqual({ state: state({ dead: true }), event: 'none' });
  });
});
