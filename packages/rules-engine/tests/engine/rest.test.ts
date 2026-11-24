import { describe, expect, it } from 'vitest';
import { availableHitDice, exhaustionAfterLongRest, hitDieHealing } from '../../src/engine/rest';

/** Descansos e Dados de Vida (SRD 5.2.1, Rules Glossary; nota 0050). */
describe('rests and Hit Point Dice', () => {
  it('heals the roll plus the Constitution modifier, at least 1', () => {
    expect(hitDieHealing(7, 2)).toBe(9);
    expect(hitDieHealing(1, -2)).toBe(1);
    expect(hitDieHealing(3, -3)).toBe(1);
  });

  it('counts the dice still available by size, never below 0', () => {
    const hitDice = [
      { die: 10, count: 5 },
      { die: 8, count: 2 },
    ];
    expect(availableHitDice(hitDice, {})).toEqual([
      { die: 10, count: 5, available: 5 },
      { die: 8, count: 2, available: 2 },
    ]);
    expect(availableHitDice(hitDice, { '10': 2, '8': 3 })).toEqual([
      { die: 10, count: 5, available: 3 },
      { die: 8, count: 2, available: 0 },
    ]);
  });

  it('a Long Rest lowers Exhaustion by 1', () => {
    expect(exhaustionAfterLongRest(3)).toBe(2);
    expect(exhaustionAfterLongRest(0)).toBe(0);
  });
});
