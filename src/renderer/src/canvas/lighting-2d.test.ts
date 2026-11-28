import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultMapFog, defaultMapLighting, type GameMap } from '../../../shared/protocol';
import { makeToken } from '../../../shared/protocol/test-fixtures';
import { MASK_BRIGHT } from './fog-render';
import { composeSmooth2dVisionAndLight, type VisionMaskBuffer } from './lighting-2d';

const MAP_ID = '00000000-0000-4000-8000-000000000001';
const PLAYER_ID = '00000000-0000-4000-8000-000000000010';

/** Canvas da camada de cor da luz sem desenho: o teste olha só a máscara. */
function stubTintCanvas(): HTMLCanvasElement {
  const noop = (): void => undefined;
  const ctx = new Proxy(
    { createRadialGradient: () => ({ addColorStop: noop }) },
    { get: (target, key) => (key in target ? target[key as keyof typeof target] : noop), set: () => true },
  );
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

function dayMap(): GameMap {
  return {
    id: MAP_ID,
    name: 'Clareira',
    width: 4,
    height: 3,
    background: null,
    cellPx: null,
    scene3d: null,
    fog: defaultMapFog(4, 3),
    walls: [],
    lighting: defaultMapLighting(),
    lights: [],
    propLightOverrides: {},
  };
}

function pixel(mask: VisionMaskBuffer, px: number, py: number): number[] {
  const offset = (py * mask.width + px) * 4;
  return [...mask.data.slice(offset, offset + 4)];
}

describe('composeSmooth2dVisionAndLight', () => {
  // O cálculo da luz usa um canvas de rascunho; no Node basta um que não desenha.
  beforeEach(() => vi.stubGlobal('document', { createElement: stubTintCanvas }));
  afterEach(() => vi.unstubAllGlobals());

  it('writes full brightness with zero alpha into the raw mask buffer on a daytime map', () => {
    // Regressão: num <canvas> o RGB dos pixels com alfa 0 se perde, e o mapa ficava todo preto.
    const mask: VisionMaskBuffer = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    const map = dayMap();
    const hero = makeToken({ mapId: MAP_ID, name: 'Hero', ownerIds: [PLAYER_ID] });

    composeSmooth2dVisionAndLight(mask, stubTintCanvas(), map, [hero], { role: 'gm', playerId: 'gm' });
    expect(mask.width).toBeGreaterThanOrEqual(map.width);
    expect(mask.data.length).toBe(mask.width * mask.height * 4);
    expect(pixel(mask, 0, 0)).toEqual([...MASK_BRIGHT]);
    expect(pixel(mask, mask.width - 1, mask.height - 1)).toEqual([...MASK_BRIGHT]);

    composeSmooth2dVisionAndLight(mask, stubTintCanvas(), map, [hero], { role: 'player', playerId: PLAYER_ID });
    expect(pixel(mask, 0, 0)).toEqual([...MASK_BRIGHT]);
  });
});
