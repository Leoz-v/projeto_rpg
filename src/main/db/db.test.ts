import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

  const state = (overrides: Partial<SessionState> = {}): SessionState => ({
    campaign: { id: randomUUID(), name: 'A Mina Perdida' },
    players: { [GM]: { displayName: 'Mestre', role: 'gm', connected: true }, [ANA]: { displayName: 'Ana', role: 'player', connected: true } },
    chat: [
      { kind: 'message', id: randomUUID(), at: 1, authorId: ANA, text: 'Olá!' },
      { kind: 'roll', id: randomUUID(), at: 2, authorId: GM, formula: '1d20', visibility: 'gm', rolls: [{ sides: 20, value: 17 }], total: 17 },
    ],
    maps: { [MAP]: { id: MAP, name: 'Caverna', width: 30, height: 20, background: null } },
    activeMapId: MAP,
    tokens: { [TOKEN]: { id: TOKEN, mapId: MAP, name: 'Goblin 1', position: { x: 300, y: 500 }, size: 'small', monsterId: 'goblin', image: null, ownerIds: [ANA] } },
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
});
