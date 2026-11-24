import { describe, expect, it } from 'vitest';
import { distanceFeet } from 'rules-engine/space';
import { WORLD_UNITS_PER_CELL } from '../../../shared/protocol';
import { formatRulerLabel, gridCellCenterWorld, measureRuler, worldToGridCell } from './ruler';

describe('shared ruler math', () => {
  it('maps logical world coordinates to clamped grid cells and centers', () => {
    const map = { width: 10, height: 8 };
    expect(worldToGridCell({ x: 0, y: 0 }, map)).toEqual({ x: 0, y: 0 });
    expect(worldToGridCell({ x: 250, y: 399 }, map)).toEqual({ x: 2, y: 3 });
    expect(worldToGridCell({ x: -50, y: 9999 }, map)).toEqual({ x: 0, y: 7 });
    expect(gridCellCenterWorld({ x: 2, y: 3 })).toEqual({
      x: 2.5 * WORLD_UNITS_PER_CELL,
      y: 3.5 * WORLD_UNITS_PER_CELL,
    });
  });

  it('uses the rules engine distanceFeet rule for distinct cells and 0 ft for the same cell', () => {
    expect(measureRuler({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({
      from: { x: 1, y: 1 },
      to: { x: 1, y: 1 },
      feet: 0,
      squares: 0,
    });

    const diag = measureRuler({ x: 0, y: 0 }, { x: 3, y: 3 });
    expect(diag.feet).toBe(distanceFeet({ x: 0, y: 0, size: 'medium' }, { x: 3, y: 3, size: 'medium' }));
    expect(diag.feet).toBe(15);
    expect(diag.squares).toBe(3);

    const mixed = measureRuler({ x: 1, y: 2 }, { x: 6, y: 4 }, 9.6);
    expect(mixed.feet).toBe(25);
    expect(mixed.squares).toBe(5);
    expect(mixed.elevationDeltaFeet).toBe(10);
  });

  it('formats labels in feet with optional 3D elevation delta', () => {
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 0, y: 0 }))).toBe('0 ft');
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 2, y: 1 }))).toBe('10 ft (2 q)');
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 2, y: 1 }, 0))).toBe('10 ft (2 q)');
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 2, y: 1 }, 5))).toBe('10 ft (2 q) · Δh +5 ft');
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 2, y: 1 }, -10))).toBe('10 ft (2 q) · Δh -10 ft');
  });
});
