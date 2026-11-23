import { describe, expect, it } from 'vitest';
import { backgroundWorldSize, cellPxBounds, clampCellPx, defaultCellPx, gridDimensionsForImage, recommendedCellSizes } from './map-grid';

describe('map grid calculations', () => {
  it('computes exact common divisors within map cell limits', () => {
    // 2100×1400: mdc = 700, limite mínimo = ceil(2100/200) = 11.
    const recommended = recommendedCellSizes({ width: 2100, height: 1400 });
    expect(recommended.map((r) => r.cellPx)).toEqual([14, 20, 25, 28, 35, 50, 70, 100, 140, 175, 350, 700]);
    expect(recommended.find((r) => r.cellPx === 70)).toEqual({ cellPx: 70, width: 30, height: 20 });
  });

  it('returns an empty recommendation list when dimensions share no valid exact divisor', () => {
    // 1921 e 1080 são coprimos (mdc = 1), mas min = ceil(1921/200) = 10.
    expect(recommendedCellSizes({ width: 1921, height: 1080 })).toEqual([]);
  });

  it('chooses the recommended divisor closest to 70 px, or falls back to clamped 70 px', () => {
    expect(defaultCellPx({ width: 2100, height: 1400 })).toBe(70);
    expect(defaultCellPx({ width: 1920, height: 1080 })).toBe(60);
    expect(defaultCellPx({ width: 1024, height: 1024 })).toBe(64);
    expect(defaultCellPx({ width: 1921, height: 1080 })).toBe(70);
    // Imagem pequena (40×40): 70 ultrapassa max (40), cai para 40.
    expect(defaultCellPx({ width: 41, height: 40 })).toBe(40);
  });

  it('calculates cell counts and remainders for exact and non-exact pixel sizes', () => {
    expect(gridDimensionsForImage({ width: 2100, height: 1400 }, 70)).toEqual({
      width: 30,
      height: 20,
      exact: true,
      remainderX: 0,
      remainderY: 0,
    });
    expect(gridDimensionsForImage({ width: 1920, height: 1080 }, 70)).toEqual({
      width: 28,
      height: 16,
      exact: false,
      remainderX: 30,
      remainderY: 30,
    });
  });

  it('clamps cellPx to the valid bounds for the image', () => {
    const bounds = cellPxBounds({ width: 4000, height: 1000 });
    expect(bounds).toEqual({ min: 20, max: 1000 });
    expect(clampCellPx(5, bounds)).toBe(20);
    expect(clampCellPx(2000, bounds)).toBe(1000);
    expect(clampCellPx(70.4, bounds)).toBe(70);
  });

  it('scales the background in world units without stretching when cellPx is set, and falls back to stretched when null', () => {
    // 1920×1080 com 70 px/célula em um mapa de 28×16 células: mantém proporção 16:9 exata.
    const scaled = backgroundWorldSize({ width: 28, height: 16, cellPx: 70 }, { width: 1920, height: 1080 });
    expect(scaled.width).toBeCloseTo((1920 / 70) * 100);
    expect(scaled.height).toBeCloseTo((1080 / 70) * 100);
    expect(scaled.width / scaled.height).toBeCloseTo(1920 / 1080);

    // Mapa legado sem cellPx: estica para preencher todas as células.
    expect(backgroundWorldSize({ width: 30, height: 20, cellPx: null }, { width: 1920, height: 1080 })).toEqual({
      width: 3000,
      height: 2000,
    });
  });
});
