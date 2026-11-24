import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGridFromTemplate,
  sanitizeMapId,
  serializeMapDocument,
  type VttMapDocument,
} from '../mapDocument';
import {
  describeSaveTarget,
  saveMapToFileHandle,
  saveMapToTarget,
  type MapFileHandle,
  type MapSaveTarget,
} from '../mapStorage';

function makeSampleDoc(name = 'Goblin Ambush', id?: string): VttMapDocument {
  const grid = createGridFromTemplate({
    name,
    width: 16,
    length: 16,
    template: 'flat',
    baseUnderlayId: 1,
    baseElevationFeet: 0,
    includeStarterProps: false,
  });
  return serializeMapDocument({
    id,
    name,
    grid,
    props: [],
    shadingMode: 'pbr_shadows',
    showGrid: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mapStorage save targets & in-place saving', () => {
  it('preserves underscores in sanitizeMapId to match vite /local-maps slug rules', () => {
    expect(sanitizeMapId('goblin_camp_01')).toBe('goblin_camp_01');
    expect(sanitizeMapId('  Grand Sewer!  ')).toBe('grand-sewer');
  });

  it('formats human-readable labels for save targets', () => {
    expect(describeSaveTarget(null)).toBe('Unsaved');
    expect(describeSaveTarget({ kind: 'storage', id: 'tavern', storage: 'disk' })).toBe(
      'maps/tavern.vttmap.json'
    );
    expect(describeSaveTarget({ kind: 'storage', id: 'tavern', storage: 'browser' })).toBe(
      'browser:tavern'
    );
    const fakeHandle = { name: 'custom-map.vttmap.json' } as MapFileHandle;
    expect(
      describeSaveTarget({ kind: 'file_handle', handle: fakeHandle, fileName: 'custom-map.vttmap.json' })
    ).toBe('custom-map.vttmap.json');
  });

  it('writes directly back to an opened FileHandle in-place via saveMapToTarget', async () => {
    let writtenPayload = '';
    let closed = false;
    const handle: MapFileHandle = {
      name: 'crypt_v2.vttmap.json',
      getFile: () => Promise.resolve(new File([], 'crypt_v2.vttmap.json')),
      queryPermission: vi.fn(() => Promise.resolve('granted' as const)),
      createWritable: () =>
        Promise.resolve({
          write: (data: string) => {
            writtenPayload = data;
            return Promise.resolve();
          },
          close: () => {
            closed = true;
            return Promise.resolve();
          },
        }),
    };

    const doc = makeSampleDoc('Sunken Crypt', 'sunken-crypt');
    const target: MapSaveTarget = {
      kind: 'file_handle',
      handle,
      fileName: 'crypt_v2.vttmap.json',
    };

    const result = await saveMapToTarget(target, doc);
    expect(closed).toBe(true);
    expect(result.saveTarget).toBe(target);
    expect(result.locationLabel).toBe('crypt_v2.vttmap.json');
    expect((JSON.parse(writtenPayload) as { name: string }).name).toBe('Sunken Crypt');
  });

  it('requests readwrite permission when handle is in prompt state and throws if denied', async () => {
    const requestPermission = vi.fn(() => Promise.resolve('denied' as const));
    const handle: MapFileHandle = {
      name: 'locked.vttmap.json',
      getFile: () => Promise.resolve(new File([], 'locked.vttmap.json')),
      queryPermission: vi.fn(() => Promise.resolve('prompt' as const)),
      requestPermission,
      createWritable: vi.fn(),
    };

    await expect(saveMapToFileHandle(handle, makeSampleDoc())).rejects.toThrow(/permission denied/i);
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('overwrites the exact linked storage id when saving to a storage target', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe('/local-maps/custom_slot');
      expect(init?.method).toBe('PUT');
      const rawBody = typeof init?.body === 'string' ? init.body : '';
      const body = JSON.parse(rawBody) as VttMapDocument;
      expect(body.id).toBe('custom_slot');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            meta: {
              id: 'custom_slot',
              name: body.name,
              width: body.terrain.width,
              length: body.terrain.length,
              propCount: body.props.length,
              updatedAt: body.updatedAt,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const doc = makeSampleDoc('Renamed Display Name', 'different-id');
    const result = await saveMapToTarget(
      { kind: 'storage', id: 'custom_slot', storage: 'disk' },
      doc
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('custom_slot');
    expect(result.locationLabel).toBe('maps/custom_slot.vttmap.json');
    expect(result.saveTarget).toEqual({ kind: 'storage', id: 'custom_slot', storage: 'disk' });
  });
});
