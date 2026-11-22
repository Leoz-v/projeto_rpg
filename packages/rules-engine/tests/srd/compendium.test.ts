import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ItemSchema } from '../../src/schemas/item';
import { BackgroundSchema, ClassSchema, FeatSchema, type Grant, SpeciesSchema, SubclassSchema } from '../../src/schemas/source';
import { loadSrdCompendium, SRD_ATTRIBUTION, SRD_RAW } from '../../src/srd';

/** Lista os erros de validação de cada entrada, com id e caminho, para o teste falhar com mensagem legível. */
function issuesOf(schema: z.ZodType, entries: readonly unknown[]): string[] {
  return entries.flatMap((entry) => {
    const result = schema.safeParse(entry);
    if (result.success) return [];
    const id = (entry as { id?: unknown }).id;
    return result.error.issues.map((i) => `${String(id)} @ ${i.path.join('.')}: ${i.message}`);
  });
}

describe('SRD raw data validates against the schemas', () => {
  it.each([
    ['items', ItemSchema, SRD_RAW.items],
    ['species', SpeciesSchema, SRD_RAW.species],
    ['backgrounds', BackgroundSchema, SRD_RAW.backgrounds],
    ['feats', FeatSchema, SRD_RAW.feats],
    ['classes', ClassSchema, SRD_RAW.classes],
    ['subclasses', SubclassSchema, SRD_RAW.subclasses],
  ] as const)('%s', (_, schema, entries) => {
    expect(issuesOf(schema, entries)).toEqual([]);
  });
});

describe('SRD compendium', () => {
  const srd = loadSrdCompendium();
  const byId = <T extends { id: string }>(list: readonly T[], id: string): T => {
    const found = list.find((x) => x.id === id);
    if (!found) throw new Error(`não encontrado: ${id}`);
    return found;
  };
  const grantsAt = (levels: { level: number; grants: Grant[] }[], level: number): Grant[] =>
    levels.find((l) => l.level === level)?.grants ?? [];

  it('covers the transcribed chapters completely', () => {
    expect(srd.items.filter((i) => i.kind === 'weapon')).toHaveLength(38);
    expect(srd.items.filter((i) => i.kind === 'armor')).toHaveLength(13);
    expect(srd.species.map((s) => s.id)).toEqual(['dragonborn', 'dwarf', 'elf', 'gnome', 'goliath', 'halfling', 'human', 'orc', 'tiefling']);
    expect(srd.backgrounds.map((b) => b.id)).toEqual(['acolyte', 'criminal', 'sage', 'soldier']);
    expect(srd.feats).toHaveLength(19);
  });

  it.each(['items', 'species', 'backgrounds', 'feats', 'classes', 'subclasses'] as const)('has unique ids in %s', (key) => {
    const ids = srd[key].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references only existing origin feats from backgrounds', () => {
    for (const bg of srd.backgrounds) {
      const featIds = bg.levels.flatMap((l) => l.grants.flatMap((g) => (g.kind === 'feat' ? [g.featId] : [])));
      expect(featIds, bg.id).toHaveLength(1);
      for (const id of featIds) expect(byId(srd.feats, id).category, `${bg.id} -> ${id}`).toBe('origin');
    }
  });

  it('attaches every subclass to an existing class that offers a subclass choice', () => {
    for (const sub of srd.subclasses) {
      const cls = byId(srd.classes, sub.classId);
      const offers = cls.levels.some((l) => l.grants.some((g) => g.kind === 'choice' && g.options.pick === 'subclass'));
      expect(offers, sub.id).toBe(true);
    }
  });

  it('matches the PDF weapon table (p. 91)', () => {
    expect(byId(srd.items, 'longsword')).toMatchObject({
      category: 'martial',
      damage: { dice: '1d8', type: 'slashing' },
      properties: ['versatile'],
      versatileDice: '1d10',
      mastery: 'sap',
      weight: 3,
      cost: { amount: 15, coin: 'gp' },
    });
    expect(byId(srd.items, 'heavy_crossbow')).toMatchObject({
      attackKind: 'ranged',
      properties: ['ammunition', 'range', 'heavy', 'loading', 'two_handed'],
      range: { normal: 100, long: 400 },
      mastery: 'push',
    });
    expect(byId(srd.items, 'dart')).toMatchObject({ weight: 0.25, cost: { amount: 5, coin: 'cp' } });
  });

  it('matches the PDF armor table (p. 92)', () => {
    expect(byId(srd.items, 'chain_mail')).toMatchObject({
      category: 'heavy',
      strength: 13,
      effects: [
        { type: 'set_base_ac', base: 16, abilities: [] },
        { type: 'disadvantage', target: 'skill.stealth' },
      ],
    });
    expect(byId(srd.items, 'half_plate_armor')).toMatchObject({
      effects: [{ type: 'set_base_ac', base: 15, abilities: ['dex'], dexCap: 2 }, { type: 'disadvantage' }],
    });
    expect(byId(srd.items, 'studded_leather_armor')).toMatchObject({ effects: [{ type: 'set_base_ac', base: 12, abilities: ['dex'] }] });
    expect(byId(srd.items, 'shield')).toMatchObject({ category: 'shield', effects: [{ type: 'flat_bonus', target: 'ac', value: 2 }] });
  });

  it('models the dwarf traits (p. 84)', () => {
    const effects = grantsAt(byId(srd.species, 'dwarf').levels, 1).flatMap((g) => (g.kind === 'effect' ? [g.effect] : []));
    expect(effects).toContainEqual({ type: 'grant_sense', sense: 'darkvision', range: 120 });
    expect(effects).toContainEqual({ type: 'resistance', damageType: 'poison' });
    expect(effects).toContainEqual({ type: 'flat_bonus', target: 'hp_max', value: { perLevel: 1 } });
  });

  it('gives elf lineage spells at character levels 3 and 5 with the chosen ability', () => {
    const lineage = grantsAt(byId(srd.species, 'elf').levels, 1).find((g) => g.kind === 'choice' && g.id === 'elven_lineage');
    if (lineage?.kind !== 'choice' || lineage.options.pick !== 'option') throw new Error('elven_lineage ausente');
    const drow = byId(lineage.options.options, 'drow');
    expect(drow.levels.map((l) => l.level)).toEqual([3, 5]);
    expect(grantsAt(drow.levels, 3)).toEqual([
      {
        kind: 'effect',
        effect: { type: 'grant_spell', spellId: 'faerie_fire', ability: { choice: 'spellcasting_ability' }, uses: { per: 'long_rest', count: 1, slots: true } },
      },
    ]);
  });

  it('models fighter proficiencies and progression (pp. 47-48)', () => {
    const fighter = byId(srd.classes, 'fighter');
    expect(fighter.hitDie).toBe(10);
    const saves = fighter.startingGrants.flatMap((g) =>
      g.kind === 'effect' && g.effect.type === 'grant_proficiency' && g.effect.category === 'save' ? [g.effect.id] : [],
    );
    expect(saves).toEqual(['str', 'con']);
    // Weapon Mastery: 3 no nível 1, 4 no 4, 5 no 10, 6 no 16.
    const mastery = fighter.levels.flatMap((l) =>
      l.grants.flatMap((g) => (g.kind === 'choice' && g.options.pick === 'weapon_mastery' ? [[l.level, g.count]] : [])),
    );
    expect(mastery).toEqual([[1, 3], [4, 1], [10, 1], [16, 1]]);
    const featLevels = fighter.levels.flatMap((l) => (l.grants.some((g) => g.kind === 'choice' && g.options.pick === 'feat' && g.id !== 'fighting_style') ? [l.level] : []));
    expect(featLevels).toEqual([4, 6, 8, 12, 14, 16, 19]);
  });

  it('models wizard spellcasting (pp. 77-78)', () => {
    const wizard = byId(srd.classes, 'wizard');
    expect(wizard.spellcasting).toMatchObject({ ability: 'int', progression: 'full' });
    expect(wizard.spellcasting?.preparedSpells[6]).toBe(11); // nível 7
    const spellbook = wizard.levels.flatMap((l) =>
      l.grants.flatMap((g) => (g.kind === 'choice' && g.id.startsWith('spellbook_') && g.options.pick === 'spell' ? [[l.level, g.count, g.options.maxLevel]] : [])),
    );
    expect(spellbook[0]).toEqual([1, 6, 1]);
    expect(spellbook).toContainEqual([7, 2, 4]);
    expect(spellbook).toHaveLength(20);
    const cantrips = wizard.levels.flatMap((l) =>
      l.grants.flatMap((g) => (g.kind === 'choice' && g.options.pick === 'spell' && g.options.maxLevel === 0 ? [g.count] : [])),
    );
    expect(cantrips.reduce((a, b) => a + b, 0)).toBe(5); // 3 + 1 (nível 4) + 1 (nível 10)
  });

  it('exposes the CC-BY 4.0 attribution', () => {
    expect(SRD_ATTRIBUTION).toContain('System Reference Document 5.2.1');
    expect(SRD_ATTRIBUTION).toContain('https://creativecommons.org/licenses/by/4.0/legalcode');
  });
});
