import { describe, expect, it } from 'vitest';
import { nextTurn, previousTurn, sortByInitiative, turnAfterRemoval } from '../../src/engine/combat';

describe('turn order (SRD 5.2.1, Initiative)', () => {
  it('orders by initiative, then by the modifier, keeping the entry order on a full tie', () => {
    const order = sortByInitiative([
      { id: 'a', initiative: 12, modifier: 1 },
      { id: 'b', initiative: 18, modifier: 0 },
      { id: 'c', initiative: 12, modifier: 3 },
      { id: 'd', initiative: 12, modifier: 1 },
    ]);
    expect(order.map((c) => c.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('advances turns and starts a new round after the last combatant', () => {
    expect(nextTurn({ round: 1, turn: 0 }, 3)).toEqual({ round: 1, turn: 1, newRound: false });
    expect(nextTurn({ round: 1, turn: 2 }, 3)).toEqual({ round: 2, turn: 0, newRound: true });
    expect(nextTurn({ round: 4, turn: 0 }, 1)).toEqual({ round: 5, turn: 0, newRound: true });
  });

  it('goes back one turn, but not before the first turn of round 1', () => {
    expect(previousTurn({ round: 2, turn: 1 }, 3)).toEqual({ round: 2, turn: 0 });
    expect(previousTurn({ round: 2, turn: 0 }, 3)).toEqual({ round: 1, turn: 2 });
    expect(previousTurn({ round: 1, turn: 0 }, 3)).toEqual({ round: 1, turn: 0 });
  });

  it('keeps the current combatant when another one leaves, and passes the turn when the current one leaves', () => {
    expect(turnAfterRemoval({ round: 1, turn: 2 }, 0, 4)).toEqual({ round: 1, turn: 1, newRound: false });
    expect(turnAfterRemoval({ round: 1, turn: 1 }, 3, 4)).toEqual({ round: 1, turn: 1, newRound: false });
    expect(turnAfterRemoval({ round: 1, turn: 1 }, 1, 4)).toEqual({ round: 1, turn: 1, newRound: false });
    expect(turnAfterRemoval({ round: 3, turn: 3 }, 3, 4)).toEqual({ round: 4, turn: 0, newRound: true });
    expect(turnAfterRemoval({ round: 1, turn: 0 }, 0, 1)).toBeUndefined();
  });
});
