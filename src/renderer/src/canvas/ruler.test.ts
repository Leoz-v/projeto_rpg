import { describe, expect, it } from 'vitest';
import { distanceFeet } from 'rules-engine/space';
import { WORLD_UNITS_PER_CELL } from '../../../shared/protocol';
import {
  feetToMeters,
  formatDistanceValue,
  formatRulerLabel,
  gridCellCenterWorld,
  measureRuler,
  measureRulerPath,
  measureRulerRadius,
  METERS_PER_FOOT,
  METERS_PER_SQUARE,
  worldToGridCell,
} from './ruler';

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
      shape: 'line',
      points: [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
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

  it('sums multi-segment paths (curves / waypoints) using cellDistanceFeet per segment', () => {
    // (0,0) -> (3,0) = 15 ft (3 q), then (3,0) -> (3,2) = 10 ft (2 q), then (3,2) -> (5,4) = 10 ft (2 q) => 35 ft (7 q)
    const path = measureRulerPath([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 5, y: 4 },
    ]);
    expect(path.shape).toBe('line');
    expect(path.feet).toBe(35);
    expect(path.squares).toBe(7);
  });

  it('measures circular impact radius using the same grid distance rule', () => {
    const r = measureRulerRadius({ x: 5, y: 5 }, { x: 9, y: 7 });
    expect(r.shape).toBe('radius');
    expect(r.feet).toBe(20);
    expect(r.squares).toBe(4);
    expect(measureRulerRadius({ x: 5, y: 5 }, { x: 5, y: 5 }).feet).toBe(0);
  });

  it('converts feet to meters using the unified 1.5 m per 5 ft square scale', () => {
    expect(METERS_PER_SQUARE).toBe(1.5);
    expect(METERS_PER_FOOT).toBeCloseTo(0.3, 6);
    expect(feetToMeters(5)).toBeCloseTo(1.5, 6);
    expect(feetToMeters(30)).toBeCloseTo(9, 6);
    expect(formatDistanceValue(0, 'm')).toBe('0 m');
    expect(formatDistanceValue(5, 'm')).toBe('1,5 m');
    expect(formatDistanceValue(10, 'm')).toBe('3 m');
    expect(formatDistanceValue(15, 'm')).toBe('4,5 m');
  });

  it('formats line and radius labels in feet or meters with optional 3D elevation delta', () => {
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 0, y: 0 }), 'ft')).toBe('0 ft');
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 2, y: 1 }), 'ft')).toBe('10 ft (2 q)');
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 2, y: 1 }, 0), 'ft')).toBe('10 ft (2 q)');
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 2, y: 1 }, 5), 'ft')).toBe('10 ft (2 q) · Δh +5 ft');
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 2, y: 1 }, -10), 'ft')).toBe('10 ft (2 q) · Δh -10 ft');

    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 3, y: 1 }), 'm')).toBe('4,5 m (3 q)');
    expect(formatRulerLabel(measureRuler({ x: 0, y: 0 }, { x: 3, y: 1 }, 5), 'm')).toBe('4,5 m (3 q) · Δh +1,5 m');

    expect(formatRulerLabel(measureRulerRadius({ x: 5, y: 5 }, { x: 9, y: 7 }), 'ft')).toBe('Raio 20 ft (4 q)');
    expect(formatRulerLabel(measureRulerRadius({ x: 5, y: 5 }, { x: 9, y: 7 }), 'm')).toBe('Raio 6 m (4 q)');
    expect(formatRulerLabel(measureRulerRadius({ x: 5, y: 5 }, { x: 5, y: 5 }), 'm')).toBe('Raio 0 m');
  });
});
