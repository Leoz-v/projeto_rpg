import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionState } from '../../shared/protocol';
import { APP_DB_SCHEMA_VERSION, AppDb } from './app-db';
import { CAMPAIGN_DB_SCHEMA_VERSION, CampaignDb, CampaignDbError } from './campaign-db';
import { CampaignLibrary, CampaignNotFoundError } from './library';
import { DatabaseTooNewError, migrate } from './migrate';
import { openDatabase, userVersion } from './sqlite';

/** Integração das migrações e dos repositórios SQLite (CLAUDE.md: testes de migração). */

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'vtt-db-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const V1 = 'CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL) STRICT;';
const V2 = 'ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;';

describe('migrate', () => {
  it('applies the missing migrations in order and records user_version', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db, [V1, V2])).toEqual({ from: 0, to: 2 });
    expect(userVersion(db)).toBe(2);
    db.prepare('INSERT INTO notes (text, pinned) VALUES (?, ?)').run('oi', 1);
    expect(migrate(db, [V1, V2])).toEqual({ from: 2, to: 2 });
    db.close();
  });

  it('backs up an existing database before changing its schema, but not a new one', () => {
    const path = join(tempDir(), 'campanha.db');
    const first = openDatabase(path);
    expect(migrate(first, [V1], path).backup).toBeUndefined();
    first.prepare('INSERT INTO notes (text) VALUES (?)').run('antes da migração');
    first.close();

    const second = openDatabase(path);
    const result = migrate(second, [V1, V2], path);
    second.close();
    expect(result).toEqual({ from: 1, to: 2, backup: `${path}.bak` });

    // O backup tem os dados e o esquema antigo.
    const backup = openDatabase(`${path}.bak`);
    expect(userVersion(backup)).toBe(1);
    expect(backup.prepare('SELECT text FROM notes').all()).toEqual([{ text: 'antes da migração' }]);
    backup.close();
  });

  it('refuses a database created by a newer app', () => {
    const db = openDatabase(':memory:');
    migrate(db, [V1, V2]);
    expect(() => migrate(db, [V1])).toThrow(DatabaseTooNewError);
    expect(() => migrate(db, [V1])).toThrow('Atualize o app');
    db.close();
  });

  it('rolls back a failing migration and keeps the previous version', () => {
    const db = openDatabase(':memory:');
    migrate(db, [V1]);
    expect(() => migrate(db, [V1, 'ALTER TABLE notes ADD COLUMN x INTEGER; SELECT * FROM tabela_que_nao_existe;'])).toThrow();
    expect(userVersion(db)).toBe(1);
    expect(db.prepare("SELECT name FROM pragma_table_info('notes') WHERE name = 'x'").all()).toEqual([]);
    db.close();
  });

  it('turns on WAL and foreign keys', () => {
    const db = openDatabase(join(tempDir(), 'x.db'));
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    db.close();
  });
});

describe('AppDb', () => {
  it('creates the schema and keeps the player id', () => {
    const app = AppDb.open(':memory:');
    expect(app.migration.to).toBe(APP_DB_SCHEMA_VERSION);
    expect(app.playerId()).toBe(app.playerId());
    app.close();
  });

  it('merges preferences and ignores a corrupted value', () => {
    const path = join(tempDir(), 'app.db');
    const app = AppDb.open(path);
    expect(app.preferences()).toEqual({});
    app.savePreferences({ displayName: 'Ana' });
    expect(app.savePreferences({ lastAddress: '100.64.0.7:47820' })).toEqual({ displayName: 'Ana', lastAddress: '100.64.0.7:47820' });
    app.close();

    const raw = openDatabase(path);
    raw.prepare("UPDATE settings SET value = '{nao é json' WHERE key = 'preferences'").run();
    raw.close();
    const reopened = AppDb.open(path);
    expect(reopened.preferences()).toEqual({});
    reopened.close();
  });

  it('lists campaigns from the most recently opened', () => {
    const app = AppDb.open(':memory:');
    app.touchCampaign({ id: 'a', name: 'Antiga', file: '/a.db' }, 1);
    app.touchCampaign({ id: 'b', name: 'Nova', file: '/b.db' }, 2);
    app.touchCampaign({ id: 'a', name: 'Antiga renomeada', file: '/a.db' }, 3);
    expect(app.campaigns().map((c) => [c.id, c.name])).toEqual([
      ['a', 'Antiga renomeada'],
      ['b', 'Nova'],
    ]);
    app.close();
  });
});

describe('CampaignDb', () => {
  const GM = randomUUID();
  const ANA = randomUUID();
  const MAP = randomUUID();
  const TOKEN = randomUUID();
  const HERO = randomUUID();

  const state = (overrides: Partial<SessionState> = {}): SessionState => ({
    campaign: { id: randomUUID(), name: 'A Mina Perdida' },
    players: { [GM]: { displayName: 'Mestre', role: 'gm', connected: true }, [ANA]: { displayName: 'Ana', role: 'player', connected: true } },
    chat: [
      { kind: 'message', id: randomUUID(), at: 1, authorId: ANA, text: 'Olá!' },
      { kind: 'roll', id: randomUUID(), at: 2, authorId: GM, formula: '1d20', visibility: 'gm', rolls: [{ sides: 20, value: 17 }], total: 17 },
      {
        kind: 'ability_roll',
        id: randomUUID(),
        at: 3,
        authorId: ANA,
        characterId: HERO,
        characterName: 'Thorin',
        sets: [
          [5, 5, 5],
          [4, 5, 5],
          [4, 4, 5],
          [4, 4, 4],
          [3, 3, 4],
          [2, 3, 3],
        ].map((kept) => ({ dice: [1, ...kept], dropped: 0, total: kept.reduce((a, b) => a + b, 0) })),
      },
    ],
    maps: { [MAP]: { id: MAP, name: 'Caverna', width: 30, height: 20, background: null, cellPx: null } },
    activeMapId: MAP,
    tokens: { [TOKEN]: { id: TOKEN, mapId: MAP, name: 'Goblin 1', position: { x: 300, y: 500 }, size: 'small', monsterId: 'goblin', image: null, ownerIds: [ANA], characterId: HERO } },
    characters: {
      [HERO]: {
        id: HERO,
        ownerId: ANA,
        name: 'Thorin',
        baseScores: { method: 'rolled', scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } },
        rolledScores: [15, 14, 13, 12, 10, 8],
        steps: [{ kind: 'class_level', classId: 'fighter', selections: [{ source: { kind: 'class', id: 'fighter' }, choiceId: 'skills', picks: ['athletics', 'perception'] }] }],
        inventory: {
          currency: { cp: 0, sp: 5, ep: 0, gp: 12, pp: 0 },
          items: [{ instanceId: randomUUID(), itemId: 'chain_mail', quantity: 1, equipped: true, attuned: false }],
        },
        adjustments: [{ id: randomUUID(), name: 'Bênção do Templo', effects: [{ type: 'flat_bonus', target: 'save.all', value: 1 }] }],
      },
    },
    ...overrides,
  });

  it('saves and loads the whole session, with nobody connected', () => {
    const s = state();
    const db = CampaignDb.create(':memory:', s.campaign, 0);
    expect(db.migration.to).toBe(CAMPAIGN_DB_SCHEMA_VERSION);
    db.save(s);
    const loaded = db.load();
    expect(loaded).toEqual({
      ...s,
      players: { [GM]: { displayName: 'Mestre', role: 'gm', connected: false }, [ANA]: { displayName: 'Ana', role: 'player', connected: false } },
    });
    db.close();
  });

  it('removes characters that left the state', () => {
    const s = state();
    const db = CampaignDb.create(':memory:', s.campaign, 0);
    db.save(s);
    db.save({ ...s, characters: {} });
    expect(db.load().characters).toEqual({});
    db.close();
  });

  it('appends only new chat entries and removes maps and tokens that left the state', () => {
    const s = state();
    const db = CampaignDb.create(':memory:', s.campaign, 0);
    db.save(s);
    const extra = { kind: 'message' as const, id: randomUUID(), at: 3, authorId: GM, text: 'Mais uma' };
    db.save({ ...s, chat: [...s.chat, extra], tokens: {}, activeMapId: null, maps: {} });
    const loaded = db.load();
    expect(loaded.chat.map((e) => e.id)).toEqual([...s.chat.map((e) => e.id), extra.id]);
    expect(loaded.tokens).toEqual({});
    expect(loaded.maps).toEqual({});
    expect(loaded.activeMapId).toBeNull();
    db.close();
  });

  it('keeps the saved state when a save fails halfway', () => {
    const s = state();
    const db = CampaignDb.create(':memory:', s.campaign, 0);
    db.save(s);
    // Token num mapa inexistente: a chave estrangeira falha e nada da transação fica.
    const orphan = { ...s.tokens[TOKEN], id: randomUUID(), mapId: randomUUID() } as SessionState['tokens'][string];
    expect(() => {
      db.save({ ...s, campaign: { ...s.campaign, name: 'Renomeada' }, tokens: { ...s.tokens, [orphan.id]: orphan } });
    }).toThrow();
    expect(db.load().campaign.name).toBe('A Mina Perdida');
    db.close();
  });

  it('refuses to create a campaign over an existing one, and to load an empty file', () => {
    const path = join(tempDir(), 'c.db');
    const s = state();
    CampaignDb.create(path, s.campaign, 0).close();
    expect(() => CampaignDb.create(path, s.campaign, 0)).toThrow(CampaignDbError);
    const empty = CampaignDb.open(join(tempDir(), 'vazio.db'));
    expect(() => empty.load()).toThrow('Arquivo sem campanha');
    empty.close();
  });

  it('migrates v3 characters with an empty inventory and tokens without a character', () => {
    const path = join(tempDir(), 'v3.db');
    const legacy = openDatabase(path);
    legacy.exec(`
      CREATE TABLE campaign (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, active_map_id TEXT) STRICT;
      CREATE TABLE players (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('gm', 'player'))) STRICT;
      CREATE TABLE maps (id TEXT PRIMARY KEY, name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, background TEXT, cell_px INTEGER) STRICT;
      CREATE TABLE tokens (id TEXT PRIMARY KEY, map_id TEXT NOT NULL REFERENCES maps (id) ON DELETE CASCADE, name TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, size TEXT NOT NULL, monster_id TEXT, image TEXT, owner_ids TEXT NOT NULL) STRICT;
      CREATE TABLE chat (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, entry TEXT NOT NULL) STRICT;
      CREATE TABLE characters (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES players (id), name TEXT NOT NULL, build TEXT NOT NULL) STRICT;
      PRAGMA user_version = 3;
    `);
    legacy.prepare('INSERT INTO campaign (id, name, created_at, active_map_id) VALUES (?, ?, ?, ?)').run(randomUUID(), 'V3', 0, MAP);
    legacy.prepare('INSERT INTO players (id, display_name, role) VALUES (?, ?, ?)').run(ANA, 'Ana', 'player');
    legacy.prepare('INSERT INTO maps (id, name, width, height, background, cell_px) VALUES (?, ?, ?, ?, ?, ?)').run(MAP, 'Caverna', 10, 10, null, null);
    legacy.prepare('INSERT INTO tokens (id, map_id, name, x, y, size, monster_id, image, owner_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(TOKEN, MAP, 'Goblin', 0, 0, 'small', 'goblin', null, '[]');
    legacy.prepare('INSERT INTO characters (id, owner_id, name, build) VALUES (?, ?, ?, ?)').run(HERO, ANA, 'Thorin', JSON.stringify({ baseScores: null, rolledScores: null, steps: [] }));
    legacy.close();

    const migrated = CampaignDb.open(path);
    expect(migrated.migration).toEqual({ from: 3, to: CAMPAIGN_DB_SCHEMA_VERSION, backup: `${path}.bak` });
    const loaded = migrated.load();
    expect(loaded.characters[HERO]?.inventory).toEqual({ currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [] });
    expect(loaded.characters[HERO]?.adjustments).toEqual([]);
    expect(loaded.tokens[TOKEN]?.characterId).toBeNull();
    migrated.close();
  });

  it('persists cellPx and migrates v1 campaign databases with cellPx = null', () => {
    const path = join(tempDir(), 'legacy.db');
    const legacy = openDatabase(path);
    legacy.exec(`
      CREATE TABLE campaign (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, active_map_id TEXT) STRICT;
      CREATE TABLE players (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('gm', 'player'))) STRICT;
      CREATE TABLE maps (id TEXT PRIMARY KEY, name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, background TEXT) STRICT;
      CREATE TABLE tokens (id TEXT PRIMARY KEY, map_id TEXT NOT NULL REFERENCES maps (id) ON DELETE CASCADE, name TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, size TEXT NOT NULL, monster_id TEXT, image TEXT, owner_ids TEXT NOT NULL) STRICT;
      CREATE TABLE chat (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, entry TEXT NOT NULL) STRICT;
      PRAGMA user_version = 1;
    `);
    const campaignId = randomUUID();
    legacy.prepare('INSERT INTO campaign (id, name, created_at, active_map_id) VALUES (?, ?, ?, ?)').run(campaignId, 'Legada', 0, MAP);
    legacy.prepare('INSERT INTO maps (id, name, width, height, background) VALUES (?, ?, ?, ?, ?)').run(MAP, 'Antigo', 20, 15, null);
    legacy.close();

    const migrated = CampaignDb.open(path);
    expect(migrated.migration).toEqual({ from: 1, to: CAMPAIGN_DB_SCHEMA_VERSION, backup: `${path}.bak` });
    const loaded = migrated.load();
    expect(loaded.maps[MAP]).toEqual({ id: MAP, name: 'Antigo', width: 20, height: 15, background: null, cellPx: null });

    const withGrid = randomUUID();
    const sha = 'a'.repeat(64);
    migrated.save({
      ...loaded,
      maps: { ...loaded.maps, [withGrid]: { id: withGrid, name: 'Calibrado', width: 30, height: 20, background: sha, cellPx: 70 } },
    });
    expect(migrated.load().maps[withGrid]).toEqual({ id: withGrid, name: 'Calibrado', width: 30, height: 20, background: sha, cellPx: 70 });
    migrated.close();
  });
});

describe('CampaignLibrary', () => {
  it('creates one file per campaign and reopens it from the index', () => {
    const dir = tempDir();
    const app = AppDb.open(join(dir, 'app.db'));
    const library = new CampaignLibrary(app, join(dir, 'campaigns'), () => 100);

    const created = library.open({ kind: 'new', name: 'A Mina Perdida' });
    expect(created.restored).toBeUndefined();
    created.close();
    const [summary] = library.list();
    expect(summary).toMatchObject({ id: created.campaign.id, name: 'A Mina Perdida', lastOpenedAt: 100 });
    expect(existsSync(summary?.file ?? '')).toBe(true);

    const reopened = library.open({ kind: 'existing', id: created.campaign.id });
    expect(reopened.restored?.campaign).toEqual(created.campaign);
    reopened.close();
    expect(() => library.open({ kind: 'existing', id: randomUUID() })).toThrow(CampaignNotFoundError);

    rmSync(summary?.file ?? '');
    expect(() => library.open({ kind: 'existing', id: created.campaign.id })).toThrow(CampaignNotFoundError);
    app.close();
  });

  it('deletes a campaign: file and backup to the trash, SQLite side files removed, out of the index', async () => {
    const dir = tempDir();
    const app = AppDb.open(join(dir, 'app.db'));
    const trashed: string[] = [];
    const library = new CampaignLibrary(app, join(dir, 'campaigns'), () => 1, (file) => {
      trashed.push(file);
      rmSync(file);
      return Promise.resolve();
    });
    const keep = library.open({ kind: 'new', name: 'Fica' });
    keep.close();
    const gone = library.open({ kind: 'new', name: 'Sai' });
    gone.close();
    const file = library.list().find((c) => c.id === gone.campaign.id)?.file ?? '';
    copyFileSync(file, `${file}.bak`);
    writeFileSync(`${file}-wal`, '');
    writeFileSync(`${file}-shm`, '');

    await library.delete(gone.campaign.id);
    expect(trashed).toEqual([file, `${file}.bak`]);
    expect([`${file}-wal`, `${file}-shm`].some((f) => existsSync(f))).toBe(false);
    expect(library.list().map((c) => c.name)).toEqual(['Fica']);
    await expect(library.delete(gone.campaign.id)).rejects.toThrow(CampaignNotFoundError);
    app.close();
  });

  it('removes from the index a campaign whose file is already gone', async () => {
    const dir = tempDir();
    const app = AppDb.open(join(dir, 'app.db'));
    const library = new CampaignLibrary(app, join(dir, 'campaigns'));
    const lost = library.open({ kind: 'new', name: 'Perdida' });
    lost.close();
    rmSync(library.list()[0]?.file ?? '');
    await library.delete(lost.campaign.id);
    expect(library.list()).toEqual([]);
    app.close();
  });
});
