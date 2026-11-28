import { describe, expect, it } from 'vitest';
import { type KeyValueStorage, readSectionOpen, writeSectionOpen } from './SidebarSection';

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('SidebarSection storage helpers', () => {
  it('falls back to defaultOpen when nothing is stored or storage is unavailable', () => {
    const store = memoryStorage();
    expect(readSectionOpen('maps', true, store)).toBe(true);
    expect(readSectionOpen('fog', false, store)).toBe(false);
    expect(readSectionOpen('maps', true, null)).toBe(true);
    expect(readSectionOpen('fog', false, null)).toBe(false);
  });

  it('persists and restores open/closed section state per id', () => {
    const store = memoryStorage();
    writeSectionOpen('maps', false, store);
    writeSectionOpen('fog', true, store);
    expect(readSectionOpen('maps', true, store)).toBe(false);
    expect(readSectionOpen('fog', false, store)).toBe(true);
  });

  it('ignores invalid stored values and storage errors gracefully', () => {
    const store = memoryStorage();
    store.setItem('vtt:sidebar:maps', 'unexpected');
    expect(readSectionOpen('maps', true, store)).toBe(true);

    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => {
      writeSectionOpen('maps', false, broken);
    }).not.toThrow();
    expect(readSectionOpen('maps', false, broken)).toBe(false);
  });
});
