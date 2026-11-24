import { describe, expect, it } from 'vitest';
import { cleaveDamageBonus, grazeDamage, type MasteryContext, masteryOutcome, timedMastery, timedMasteryNote, toppleDc } from '../../src/engine/mastery';
import { WEAPON_MASTERIES } from '../../src/schemas/common';

const base: Omit<MasteryContext, 'property'> = {
  hit: true,
  damaged: true,
  abilityModifier: 3,
  proficiencyBonus: 2,
  damageType: 'slashing',
  targetSize: 'medium',
};

describe('weapon mastery outcomes (SRD 5.2.1, Mastery Properties)', () => {
  it('Topple: DC 8 + attack ability modifier + proficiency, only on a hit', () => {
    expect(toppleDc(3, 2)).toBe(13);
    const hit = masteryOutcome({ ...base, property: 'topple' });
    expect(hit.action).toBe('topple');
    expect(hit.notes[0]).toContain('CD 13');
    expect(masteryOutcome({ ...base, property: 'topple', hit: false })).toEqual({ property: 'topple', notes: [] });
  });

  it('Graze: damage equal to the positive ability modifier, only on a miss', () => {
    expect(grazeDamage(3)).toBe(3);
    expect(grazeDamage(0)).toBe(0);
    expect(grazeDamage(-1)).toBe(0);
    const miss = masteryOutcome({ ...base, property: 'graze', hit: false });
    expect(miss.action).toBe('graze');
    expect(miss.notes[0]).toContain('3 de dano Cortante');
    expect(masteryOutcome({ ...base, property: 'graze' }).action).toBeUndefined();
    const weak = masteryOutcome({ ...base, property: 'graze', hit: false, abilityModifier: 0 });
    expect(weak.action).toBeUndefined();
    expect(weak.notes).toHaveLength(1);
  });

  it('Cleave: a second attack on a hit, without a positive ability modifier in the damage, once per turn', () => {
    expect(cleaveDamageBonus(4, 3)).toBe(1); // +3 de FOR e +1 da arma mágica: fica o +1
    expect(cleaveDamageBonus(-1, -1)).toBe(-1); // negativo continua
    expect(masteryOutcome({ ...base, property: 'cleave' }).action).toBe('cleave');
    expect(masteryOutcome({ ...base, property: 'cleave', hit: false }).action).toBeUndefined();
    expect(masteryOutcome({ ...base, property: 'cleave', fromCleave: true })).toEqual({ property: 'cleave', notes: [] });
  });

  it('Push reminds on a hit against Large or smaller', () => {
    expect(masteryOutcome({ ...base, property: 'push' }).notes[0]).toContain('10 ft');
    expect(masteryOutcome({ ...base, property: 'push', targetSize: 'large' }).notes[0]).toContain('10 ft');
    expect(masteryOutcome({ ...base, property: 'push', targetSize: 'huge' }).notes[0]).toContain('grande demais');
    expect(masteryOutcome({ ...base, property: 'push', hit: false }).notes).toEqual([]);
  });

  it('Slow and Vex need damage; Sap only a hit', () => {
    for (const property of ['slow', 'vex'] as const) {
      expect(masteryOutcome({ ...base, property }).notes).toHaveLength(1);
      expect(masteryOutcome({ ...base, property, damaged: false }).notes).toEqual([]);
    }
    expect(masteryOutcome({ ...base, property: 'sap', damaged: false }).notes).toHaveLength(1);
    expect(masteryOutcome({ ...base, property: 'sap', hit: false }).notes).toEqual([]);
  });

  it('Nick reminds on any attack; only Cleave, Graze and Topple have a follow-up action', () => {
    expect(masteryOutcome({ ...base, property: 'nick', hit: false }).notes).toHaveLength(1);
    const withAction = WEAPON_MASTERIES.filter((property) => masteryOutcome({ ...base, property }).action ?? masteryOutcome({ ...base, property, hit: false }).action);
    expect(withAction).toEqual(['cleave', 'graze', 'topple']);
  });
});

describe('timed mastery effects', () => {
  it('leaves Sap on a hit, Vex and Slow on a hit with damage', () => {
    expect(timedMastery('sap', true, false)).toBe('sap');
    expect(timedMastery('vex', true, false)).toBeUndefined();
    expect(timedMastery('vex', true, true)).toBe('vex');
    expect(timedMastery('slow', true, true)).toBe('slow');
    expect(timedMastery('slow', false, false)).toBeUndefined();
    expect(timedMastery('topple', true, true)).toBeUndefined();
  });

  it('describes the applied effect', () => {
    expect(timedMasteryNote('slow', 'Thorin', 'Goblin')).toBe('Slow: deslocamento de Goblin −10 ft até o início do próximo turno de Thorin');
  });
});
