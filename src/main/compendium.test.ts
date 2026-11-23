import { loadSrdCompendium } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import { searchItems, searchMonsters } from './compendium';

describe('searchMonsters (SRD compendium)', () => {
  const { creatures } = loadSrdCompendium();

  it('finds monsters by part of the name, the ones starting with it first', () => {
    const results = searchMonsters(creatures, 'goblin');
    // Os que começam com "goblin" primeiro; os Hobgoblins (que só contêm) depois.
    expect(results.map((r) => r.id)).toEqual(['goblin_boss', 'goblin_minion', 'goblin_warrior', 'hobgoblin_captain', 'hobgoblin_warrior']);
    expect(results[0]).toMatchObject({ name: 'Goblin Boss', size: 'small' });
    expect(results.every((r) => r.name.toLowerCase().includes('goblin'))).toBe(true);
    const dragons = searchMonsters(creatures, 'dragon', 100);
    expect(dragons.length).toBeGreaterThan(5);
    // Quem começa com "dragon" vem antes de "Adult Red Dragon".
    const firstContains = dragons.findIndex((r) => !r.name.toLowerCase().startsWith('dragon'));
    expect(dragons.slice(firstContains).every((r) => !r.name.toLowerCase().startsWith('dragon'))).toBe(true);
  });

  it('ignores case and accents, returns nothing for an empty query and respects the limit', () => {
    expect(searchMonsters(creatures, 'GOBLÍN').length).toBe(searchMonsters(creatures, 'goblin').length);
    expect(searchMonsters(creatures, '   ')).toEqual([]);
    expect(searchMonsters(creatures, 'a', 5)).toHaveLength(5);
  });
});

describe('searchItems (SRD compendium)', () => {
  const compendium = loadSrdCompendium();

  it('finds mundane and magic items with what the inventory needs to choose', () => {
    const rope = searchItems(compendium, 'rope').find((i) => i.id === 'rope');
    expect(rope).toEqual({ id: 'rope', name: 'Rope', kind: 'gear', attunement: false, variants: [], bases: [] });
    const weapon = searchItems(compendium, 'weapon, +').find((i) => i.id === 'weapon_plus');
    expect(weapon?.variants.map((v) => v.id)).toEqual(['plus_1', 'plus_2', 'plus_3']);
    expect(weapon?.bases.map((b) => b.id)).toContain('longsword');
    expect(weapon?.rarity).toEqual(['uncommon', 'rare', 'very_rare']);
    expect(searchItems(compendium, 'ring of protection')[0]).toMatchObject({ attunement: true });
    expect(searchItems(compendium, '   ')).toEqual([]);
  });
});
