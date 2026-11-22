import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CreatureSchema } from '../../src/schemas/creature';
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
    ['creatures', CreatureSchema, SRD_RAW.creatures],
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
    // As 12 classes do SRD, cada uma com a sua subclasse.
    expect(srd.classes).toHaveLength(12);
    expect(srd.subclasses.map((s) => s.classId).sort()).toEqual(srd.classes.map((c) => c.id).sort());
  });

  it('models the core traits of the batch C classes (pp. 53-76)', () => {
    const core = (id: string) => {
      const cls = byId(srd.classes, id);
      const saves = cls.startingGrants.flatMap((g) =>
        g.kind === 'effect' && g.effect.type === 'grant_proficiency' && g.effect.category === 'save' ? [g.effect.id] : [],
      );
      return { hitDie: cls.hitDie, primary: cls.primaryAbilities, saves, caster: cls.spellcasting?.progression };
    };
    expect(core('paladin')).toEqual({ hitDie: 10, primary: ['str', 'cha'], saves: ['wis', 'cha'], caster: 'half' });
    expect(core('ranger')).toEqual({ hitDie: 10, primary: ['dex', 'wis'], saves: ['str', 'dex'], caster: 'half' });
    expect(core('rogue')).toEqual({ hitDie: 8, primary: ['dex'], saves: ['dex', 'int'], caster: undefined });
    expect(core('sorcerer')).toEqual({ hitDie: 6, primary: ['cha'], saves: ['con', 'cha'], caster: 'full' });
    expect(core('warlock')).toEqual({ hitDie: 8, primary: ['cha'], saves: ['wis', 'cha'], caster: 'pact' });
    // Rogue ganha talento também no nível 10.
    const rogueFeats = byId(srd.classes, 'rogue').levels.flatMap((l) => (l.grants.some((g) => g.kind === 'choice' && g.id.startsWith('feat_')) ? [l.level] : []));
    expect(rogueFeats).toEqual([4, 8, 10, 12, 16]);
    // Invocações: 1 no nível 1 e 10 no total (Invocations column).
    const invocations = byId(srd.classes, 'warlock').levels.flatMap((l) =>
      l.grants.flatMap((g) => (g.kind === 'choice' && g.id.startsWith('invocations_') ? [g.count] : [])),
    );
    expect(invocations).toEqual([1, 2, 2, 1, 1, 1, 1, 1]);
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

  describe('monsters (pp. 258-364)', () => {
    /** Tabela de ND do SRD 5.2.1 (p. 256): XP e bônus de proficiência. */
    const CR_TABLE = new Map<number, [number, number]>([
      [0, [10, 2]], [0.125, [25, 2]], [0.25, [50, 2]], [0.5, [100, 2]], [1, [200, 2]], [2, [450, 2]], [3, [700, 2]],
      [4, [1100, 2]], [5, [1800, 3]], [6, [2300, 3]], [7, [2900, 3]], [8, [3900, 3]], [9, [5000, 4]], [10, [5900, 4]],
      [11, [7200, 4]], [12, [8400, 4]], [13, [10000, 5]], [14, [11500, 5]], [15, [13000, 5]], [16, [15000, 5]],
      [17, [18000, 6]], [18, [20000, 6]], [19, [22000, 6]], [20, [25000, 6]], [21, [33000, 7]], [22, [41000, 7]],
      [23, [50000, 7]], [24, [62000, 7]], [25, [75000, 8]], [26, [90000, 8]], [27, [105000, 8]], [28, [120000, 8]],
      [29, [135000, 8]], [30, [155000, 9]],
    ]);
    const mod = (score: number): number => Math.floor((score - 10) / 2);
    /** Média de uma expressão de dados, arredondada para baixo, como o SRD publica. */
    const average = (dice: string): number => {
      let total = 0;
      for (const [, sign, n, m, flat] of dice.matchAll(/([+-]?)(?:(\d+)d(\d+)|(\d+))/g)) {
        const s = sign === '-' ? -1 : 1;
        total += s * (flat !== undefined ? Number(flat) : (Number(n) * (Number(m) + 1)) / 2);
      }
      return Math.floor(total);
    };

    it('has every stat block (Monsters A-Z and Animals)', () => {
      expect(srd.creatures).toHaveLength(330);
      const perType = Object.fromEntries(
        [...new Set(srd.creatures.map((c) => c.type))].sort().map((t) => [t, srd.creatures.filter((c) => c.type === t).length]),
      );
      expect(perType).toEqual({
        aberration: 9, beast: 90, celestial: 13, construct: 10, dragon: 45, elemental: 17, fey: 15, fiend: 29,
        giant: 10, humanoid: 26, monstrosity: 37, ooze: 4, plant: 6, undead: 19,
      });
      const ids = srd.creatures.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('matches the PDF stat blocks', () => {
      expect(byId(srd.creatures, 'goblin_warrior')).toMatchObject({
        size: ['small'],
        type: 'fey',
        tags: ['goblinoid'],
        alignment: 'Chaotic Neutral',
        ac: 15,
        initiative: 2,
        hp: { average: 10, formula: '3d6' },
        speed: { walk: 30 },
        abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
        saves: {},
        skills: { stealth: 6 },
        passivePerception: 9,
        languages: 'Common, Goblin',
        gear: [
          { name: 'Leather Armor', itemId: 'leather_armor' },
          { name: 'Scimitar', itemId: 'scimitar' },
          { name: 'Shield', itemId: 'shield' },
          { name: 'Shortbow', itemId: 'shortbow' },
        ],
        cr: 0.25,
        xp: 50,
        effects: [{ type: 'grant_sense', sense: 'darkvision', range: 60 }],
      });
      const goblin = byId(srd.creatures, 'goblin_warrior');
      expect(goblin.actions.map((a) => [a.id, a.kind, a.activation])).toEqual([
        ['scimitar', 'attack', 'action'],
        ['shortbow', 'attack', 'action'],
        ['nimble_escape', 'text', 'bonus_action'],
      ]);
      // O dano extra com Vantagem é condicional: fica na descrição, não no dano automático.
      expect(goblin.actions[1]).toMatchObject({ attackKind: 'ranged', toHit: 4, range: 80, longRange: 320, damage: [{ dice: '1d6+2', type: 'piercing' }] });

      const red = byId(srd.creatures, 'adult_red_dragon');
      expect(red).toMatchObject({
        size: ['huge'],
        tags: ['chromatic'],
        ac: 19,
        initiative: 12,
        hp: { average: 256, formula: '19d12+133' },
        speed: { walk: 40, climb: 40, fly: 80 },
        saves: { dex: 6, wis: 7 },
        skills: { perception: 13, stealth: 6 },
        passivePerception: 23,
        cr: 17,
        xp: 18000,
        lairXp: 20000,
        legendaryActionUses: { count: 3, lairCount: 4 },
      });
      expect(red.traits[0]).toMatchObject({ id: 'legendary_resistance', limit: { per: 'day', count: 3, lairCount: 4 } });
      expect(red.actions.find((a) => a.id === 'rend')).toMatchObject({
        kind: 'attack',
        toHit: 14,
        reach: 10,
        damage: [{ dice: '1d10+8', type: 'slashing' }, { dice: '2d4', type: 'fire' }],
      });
      expect(red.actions.find((a) => a.id === 'fire_breath')).toMatchObject({
        kind: 'save',
        ability: 'dex',
        dc: 21,
        limit: { recharge: 5 },
        damage: [{ dice: '17d6', type: 'fire' }],
        onSuccess: 'half',
      });

      // Pares modificador/salvaguarda separados do valor no PDF; enxame de criaturas Miúdas.
      expect(byId(srd.creatures, 'swarm_of_rats')).toMatchObject({
        size: ['medium'],
        swarmOf: 'tiny',
        type: 'beast',
        hp: { average: 14, formula: '4d8-4' },
        abilities: { str: 9, dex: 11, con: 9, int: 2, wis: 10, cha: 3 },
        saves: { dex: 2 },
      });
      expect(byId(srd.creatures, 'gelatinous_cube').abilities).toMatchObject({ dex: 3, wis: 6 });
      expect(byId(srd.creatures, 'werewolf').speed).toEqual({ walk: 30, note: '40 ft. (wolf form only)' });
    });

    it('models defenses and senses as effects', () => {
      const lich = byId(srd.creatures, 'lich');
      expect(lich.effects).toEqual(
        expect.arrayContaining([
          { type: 'resistance', damageType: 'cold' },
          { type: 'immunity', damageType: 'necrotic' },
          { type: 'immunity', condition: 'paralyzed' },
          { type: 'grant_sense', sense: 'truesight', range: 120 },
        ]),
      );
      expect(byId(srd.creatures, 'archmage').effects).toContainEqual({ type: 'immunity', condition: 'charmed', note: 'with Mind Blank' });
      // Defesas que dependem de escolha ou de condição fora do catálogo ficam como texto para o mestre.
      expect(byId(srd.creatures, 'half_dragon').notes).toHaveLength(1);
      expect(byId(srd.creatures, 'rakshasa').notes[0]).toContain('Bless');
    });

    it('models creature Spellcasting with compendium spells', () => {
      const lich = byId(srd.creatures, 'lich');
      const spellcasting = lich.actions.find((a) => a.kind === 'spellcasting');
      expect(spellcasting).toMatchObject({ ability: 'int', dc: 20 });
      expect(spellcasting?.kind === 'spellcasting' && spellcasting.spells).toEqual(
        expect.arrayContaining([
          { spellId: 'detect_magic', uses: 'at_will' },
          { spellId: 'power_word_kill', uses: { per: 'day', count: 1 } },
        ]),
      );
      const mage = byId(srd.creatures, 'mage').actions.find((a) => a.kind === 'spellcasting');
      expect(mage?.kind === 'spellcasting' && mage.spells).toContainEqual({ spellId: 'fireball', uses: { per: 'day', count: 2 }, level: 4 });
    });

    it('agrees with its own redundant numbers (XP, HP, modifiers, passive Perception, damage)', () => {
      const problems: string[] = [];
      for (const c of srd.creatures) {
        const row = CR_TABLE.get(c.cr);
        if (!row) {
          problems.push(`${c.id}: ND ${String(c.cr)}`);
          continue;
        }
        const [xp, pb] = row;
        if (c.xp !== xp && !(c.cr === 0 && c.xp === 0)) problems.push(`${c.id}: XP ${String(c.xp)}`);
        if (average(c.hp.formula) !== c.hp.average) problems.push(`${c.id}: PV ${c.hp.formula}`);
        const perception = c.skills.perception ?? mod(c.abilities.wis);
        if (c.passivePerception !== 10 + perception) problems.push(`${c.id}: Percepção passiva`);
        for (const [ab, save] of Object.entries(c.saves)) {
          if (save !== mod(c.abilities[ab as keyof typeof c.abilities]) + pb) problems.push(`${c.id}: salvaguarda ${ab}`);
        }
        for (const a of c.actions) {
          if ((a.kind === 'attack' || a.kind === 'save') && a.description) {
            // O texto publica "média (dados)": "13 (1d10 + 8) Slashing damage".
            for (const d of a.damage) {
              const shown = d.dice.includes('d') ? `${String(average(d.dice))} (${d.dice.replace(/([+-])/g, ' $1 ')})` : d.dice;
              if (!a.description.includes(shown)) problems.push(`${c.id}/${a.id}: dano ${d.dice}`);
            }
          }
        }
      }
      expect(problems).toEqual([]);
    });

    it('follows the CR table for XP where the SRD misprints it (Archmage)', () => {
      expect(byId(srd.creatures, 'archmage')).toMatchObject({ cr: 12, xp: 8400 });
    });

    it('resolves every spell and item cited by stat blocks', () => {
      const spells = new Map(srd.spells.map((sp) => [sp.id, sp]));
      const items = new Set(srd.items.map((i) => i.id));
      const missing: string[] = [];
      let cited = 0;
      for (const c of srd.creatures) {
        for (const g of c.gear) if (g.itemId !== undefined && !items.has(g.itemId)) missing.push(`${c.id}: item ${g.itemId}`);
        for (const a of c.actions) {
          if (a.kind !== 'spellcasting') continue;
          for (const s of a.spells) {
            cited++;
            const spell = spells.get(s.spellId);
            if (!spell) missing.push(`${c.id}: magia ${s.spellId}`);
            else if (s.level !== undefined && s.level <= spell.level) missing.push(`${c.id}: ${s.spellId} no nível ${String(s.level)}`);
          }
        }
      }
      expect(cited).toBeGreaterThan(200);
      expect(missing).toEqual([]);
    });

    it('has clean text (no page footers or broken characters)', () => {
      for (const c of srd.creatures) {
        for (const e of [...c.traits, ...c.actions]) {
          expect(e.description ?? '', `${c.id}/${e.id}`).not.toMatch(/System Reference Document|�|−|­|MOD SAVE/);
          expect((e.description ?? '').length, `${c.id}/${e.id}`).toBeGreaterThan(10);
        }
      }
    });
  });

  it('exposes the CC-BY 4.0 attribution', () => {
    expect(SRD_ATTRIBUTION).toContain('System Reference Document 5.2.1');
    expect(SRD_ATTRIBUTION).toContain('https://creativecommons.org/licenses/by/4.0/legalcode');
  });
});
