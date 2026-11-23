import { describe, expect, it } from 'vitest';
import { fitMap, MAX_ZOOM, MIN_ZOOM, placeToken, screenToWorld, tokenSide, worldToScreen, zoomAt } from './geometry';

const MAP = { width: 10, height: 8 };

describe('camera', () => {
  const camera = { x: 50, y: 20, zoom: 0.5 };

  it('converts between world and screen', () => {
    expect(worldToScreen(camera, { x: 100, y: 200 })).toEqual({ x: 100, y: 120 });
    expect(screenToWorld(camera, { x: 100, y: 120 })).toEqual({ x: 100, y: 200 });
  });

  it('zooms around the cursor, keeping the world point under it', () => {
    const cursor = { x: 300, y: 200 };
    const before = screenToWorld(camera, cursor);
    const zoomed = zoomAt(camera, cursor, 2);
    expect(zoomed.zoom).toBe(1);
    expect(screenToWorld(zoomed, cursor)).toEqual(before);
  });

  it('limits the zoom', () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(camera, { x: 0, y: 0 }, 0.0001).zoom).toBe(MIN_ZOOM);
  });

  it('fits the whole map centered in the viewport', () => {
    const fit = fitMap(MAP, { width: 1048, height: 448 }, 24);
    // 10×8 células = 1000×800; cabe pela altura: (448 − 48) / 800 = 0,5.
    expect(fit.zoom).toBe(0.5);
    expect(worldToScreen(fit, { x: 0, y: 0 })).toEqual({ x: 274, y: 24 });
    expect(worldToScreen(fit, { x: 1000, y: 800 })).toEqual({ x: 774, y: 424 });
  });
});

describe('tokens on the grid', () => {
  it('uses the creature space from the rules engine', () => {
    expect([tokenSide('tiny'), tokenSide('medium'), tokenSide('large'), tokenSide('gargantuan')]).toEqual([50, 100, 200, 400]);
  });

  it('snaps to the grid (Tiny to half cells) and keeps the token inside the map', () => {
    expect(placeToken({ x: 140, y: 260 }, 'medium', MAP)).toEqual({ x: 100, y: 300 });
    expect(placeToken({ x: 140, y: 260 }, 'tiny', MAP)).toEqual({ x: 150, y: 250 });
    expect(placeToken({ x: -80, y: 5000 }, 'medium', MAP)).toEqual({ x: 0, y: 700 });
    expect(placeToken({ x: 960, y: 760 }, 'large', MAP)).toEqual({ x: 800, y: 600 });
  });
});
