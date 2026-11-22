import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ItemSchema } from '../../src/schemas/item';
import { BackgroundSchema, ClassSchema, FeatSchema, type Grant, SpeciesSchema, SubclassSchema } from '../../src/schemas/source';
import { SpellSchema } from '../../src/schemas/spell';
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
    ['spells', SpellSchema, SRD_RAW.spells],
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

  it.each(['items', 'species', 'backgrounds', 'feats', 'classes', 'subclasses', 'spells'] as const)('has unique ids in %s', (key) => {
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
    const grants = grantsAt(byId(srd.species, 'dwarf').levels, 1);
    const effects = grants.flatMap((g) => (g.kind === 'effect' ? [g.effect] : g.kind === 'feature' ? g.feature.effects : []));
    const traits = grants.flatMap((g) => (g.kind === 'feature' ? [g.feature.name] : []));
    expect(traits).toEqual(['Darkvision', 'Dwarven Resilience', 'Dwarven Toughness', 'Stonecunning']);
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

  it('models the core traits of the batch B classes (pp. 28-52)', () => {
    const core = (id: string) => {
      const cls = byId(srd.classes, id);
      const saves = cls.startingGrants.flatMap((g) =>
        g.kind === 'effect' && g.effect.type === 'grant_proficiency' && g.effect.category === 'save' ? [g.effect.id] : [],
      );
      return { hitDie: cls.hitDie, primary: cls.primaryAbilities, saves, caster: cls.spellcasting?.progression };
    };
    expect(core('barbarian')).toEqual({ hitDie: 12, primary: ['str'], saves: ['str', 'con'], caster: undefined });
    expect(core('bard')).toEqual({ hitDie: 8, primary: ['cha'], saves: ['dex', 'cha'], caster: 'full' });
    expect(core('cleric')).toEqual({ hitDie: 8, primary: ['wis'], saves: ['wis', 'cha'], caster: 'full' });
    expect(core('druid')).toEqual({ hitDie: 8, primary: ['wis'], saves: ['int', 'wis'], caster: 'full' });
    expect(core('monk')).toEqual({ hitDie: 8, primary: ['dex', 'wis'], saves: ['str', 'dex'], caster: undefined });
    // Multiclasse do Monge: só o dado de vida.
    expect(byId(srd.classes, 'monk').multiclassGrants).toEqual([]);
    // Cada classe tem a sua subclasse do SRD.
    expect(srd.subclasses.map((s) => s.classId).sort()).toEqual(['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'wizard']);
  });

  it('follows the Bard prepared spells table as level-up choices (p. 31)', () => {
    const bard = byId(srd.classes, 'bard');
    const prepared = bard.levels.flatMap((l) =>
      l.grants.flatMap((g) => (g.kind === 'choice' && g.id.startsWith('prepared_') ? [g.count] : [])),
    );
    // A soma dos ganhos por nível bate com a coluna Prepared Spells no nível 20 (22).
    expect(prepared.reduce((a, b) => a + b, 0)).toBe(22);
    expect(bard.spellcasting?.preparedSpells).toEqual([4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22]);
  });

  describe('spells (pp. 107-175)', () => {
    /** Contagens conferidas na importação contra as listas de magias de cada classe. */
    it('has every spell, by level and by class', () => {
      expect(srd.spells).toHaveLength(339);
      const perLevel = Array.from({ length: 10 }, (_, level) => srd.spells.filter((sp) => sp.level === level).length);
      expect(perLevel).toEqual([27, 57, 57, 42, 34, 38, 31, 20, 17, 16]);
      const perClass = Object.fromEntries(
        ['bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'warlock', 'wizard'].map((c) => [c, srd.spells.filter((sp) => sp.classes.includes(c)).length]),
      );
      expect(perClass).toEqual({ bard: 130, cleric: 109, druid: 124, paladin: 38, ranger: 48, sorcerer: 140, warlock: 72, wizard: 218 });
    });

    it('follows the spell entry where the SRD class lists omit it (known SRD gaps)', () => {
      expect(byId(srd.spells, 'phantasmal_force').classes).toEqual(['bard', 'sorcerer', 'wizard']);
      expect(byId(srd.spells, 'mind_spike').classes).toEqual(['sorcerer', 'warlock', 'wizard']);
    });

    it('matches the PDF entries', () => {
      expect(byId(srd.spells, 'fireball')).toMatchObject({
        level: 3,
        school: 'evocation',
        castingTime: 'Action',
        range: '150 feet',
        components: { verbal: true, somatic: true, material: 'a ball of bat guano and sulfur' },
        duration: 'Instantaneous',
        classes: ['sorcerer', 'wizard'],
      });
      expect(byId(srd.spells, 'alarm')).toMatchObject({ castingTime: '1 minute', ritual: true, components: { material: 'a bell and silver wire' } });
      expect(byId(srd.spells, 'guidance')).toMatchObject({ level: 0, concentration: true, duration: 'Concentration, up to 1 minute' });
      expect(byId(srd.spells, 'acid_splash').description).toContain('Cantrip Upgrade.');
      expect(byId(srd.spells, 'arcanists_magic_aura').name).toBe("Arcanist's Magic Aura");
    });

    it('has clean text (no page footers or broken characters)', () => {
      for (const sp of srd.spells) {
        expect(sp.description, sp.id).not.toMatch(/System Reference Document|�|−|­/);
        expect(sp.description.length, sp.id).toBeGreaterThan(40);
      }
    });

    it('resolves every spell cited by species, feats, classes and subclasses', () => {
      const ids = new Set(srd.spells.map((sp) => sp.id));
      const grants = (list: { levels?: { grants: Grant[] }[]; grants?: Grant[]; startingGrants?: Grant[] }[]): Grant[] =>
        list.flatMap((x) => [...(x.grants ?? []), ...(x.startingGrants ?? []), ...(x.levels ?? []).flatMap((l) => l.grants)]);
      const walk = (gs: Grant[]): string[] =>
        gs.flatMap((g) => {
          if (g.kind === 'effect') return g.effect.type === 'grant_spell' ? [g.effect.spellId] : [];
          if (g.kind === 'feature') return g.feature.effects.flatMap((e) => (e.type === 'grant_spell' ? [e.spellId] : []));
          if (g.kind === 'choice' && g.options.pick === 'option') {
            return walk(g.options.options.flatMap((o) => [...o.grants, ...o.levels.flatMap((l) => l.grants)]));
          }
          return [];
        });
      const cited = walk([...grants(srd.species), ...grants(srd.feats), ...grants(srd.classes), ...grants(srd.subclasses)]);
      expect(cited.length).toBeGreaterThan(20);
      expect(cited.filter((id) => !ids.has(id))).toEqual([]);
    });

    it('uses only class lists that exist in spell choices', () => {
      const lists = new Set(['bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'warlock', 'wizard']);
      const choices = [...srd.feats.flatMap((f) => f.grants), ...srd.classes.flatMap((c) => c.levels.flatMap((l) => l.grants)), ...srd.subclasses.flatMap((c) => c.levels.flatMap((l) => l.grants))];
      for (const g of choices) {
        if (g.kind === 'choice' && g.options.pick === 'spell') for (const l of g.options.lists) expect(lists.has(l), l).toBe(true);
      }
    });
  });

  it('exposes the CC-BY 4.0 attribution', () => {
    expect(SRD_ATTRIBUTION).toContain('System Reference Document 5.2.1');
    expect(SRD_ATTRIBUTION).toContain('https://creativecommons.org/licenses/by/4.0/legalcode');
  });
});
