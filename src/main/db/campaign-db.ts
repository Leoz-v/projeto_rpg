import { z } from 'zod';
import { type ChatEntry, type SessionState, SessionStateSchema } from '../../shared/protocol';
import { migrate, type MigrateResult } from './migrate';
import { type Database, openDatabase, transaction } from './sqlite';

/**
 * `<campanha>.db`: arquivo portátil com tudo o que é da mesa. Hoje guarda a
 * sessão da Fase 2 (jogadores, mapas, tokens e o log do chat); personagens,
 * inventários e combate entram em migrações futuras.
 */

const MIGRATIONS = [
  `CREATE TABLE campaign (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     active_map_id TEXT
   ) STRICT;
   CREATE TABLE players (
     id TEXT PRIMARY KEY,
     display_name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('gm', 'player'))
   ) STRICT;
   CREATE TABLE maps (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     width INTEGER NOT NULL,
     height INTEGER NOT NULL,
     background TEXT
   ) STRICT;
   CREATE TABLE tokens (
     id TEXT PRIMARY KEY,
     map_id TEXT NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     x INTEGER NOT NULL,
     y INTEGER NOT NULL,
     size TEXT NOT NULL,
     monster_id TEXT,
     image TEXT,
     owner_ids TEXT NOT NULL
   ) STRICT;
   -- Entradas do log (visão do mestre), imutáveis, na ordem em que entraram.
   CREATE TABLE chat (
     seq INTEGER PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
     entry TEXT NOT NULL
   ) STRICT;`,
] as const;

export const CAMPAIGN_DB_SCHEMA_VERSION = MIGRATIONS.length;

export class CampaignDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignDbError';
  }
}

const CampaignRow = z.object({ id: z.string(), name: z.string(), active_map_id: z.string().nullable() });
const PlayerRow = z.object({ id: z.string(), display_name: z.string(), role: z.string() });
const MapRow = z.object({ id: z.string(), name: z.string(), width: z.number(), height: z.number(), background: z.string().nullable() });
const TokenRow = z.object({
  id: z.string(),
  map_id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.string(),
  monster_id: z.string().nullable(),
  image: z.string().nullable(),
  owner_ids: z.string(),
});
const ChatRow = z.object({ entry: z.string() });
const CountRow = z.object({ n: z.number() });

export class CampaignDb {
  private constructor(
    private readonly db: Database,
    readonly migration: MigrateResult,
  ) {}

  /** Cria o arquivo de uma campanha nova. */
  static create(path: string, campaign: SessionState['campaign'], now: number): CampaignDb {
    const store = CampaignDb.open(path);
    if (store.hasCampaign()) {
      store.close();
      throw new CampaignDbError('Já existe uma campanha neste arquivo');
    }
    store.db.prepare('INSERT INTO campaign (id, name, created_at, active_map_id) VALUES (?, ?, ?, NULL)').run(campaign.id, campaign.name, now);
    return store;
  }

  /** Abre (e migra, se preciso) o arquivo de uma campanha. */
  static open(path: string): CampaignDb {
    const db = openDatabase(path);
    try {
      return new CampaignDb(db, migrate(db, MIGRATIONS, path === ':memory:' ? undefined : path));
    } catch (err: unknown) {
      db.close();
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  private hasCampaign(): boolean {
    return this.db.prepare('SELECT 1 FROM campaign').get() !== undefined;
  }

  /**
   * O estado salvo, validado pelo schema do protocolo. Ninguém está conectado
   * num estado carregado: as conexões são da sessão, não da campanha.
   */
  load(): SessionState {
    const campaignRow = this.db.prepare('SELECT id, name, active_map_id FROM campaign').get();
    if (!campaignRow) throw new CampaignDbError('Arquivo sem campanha');
    const campaign = CampaignRow.parse(campaignRow);

    const players = Object.fromEntries(
      this.db
        .prepare('SELECT id, display_name, role FROM players')
        .all()
        .map((row) => {
          const p = PlayerRow.parse(row);
          return [p.id, { displayName: p.display_name, role: p.role, connected: false }];
        }),
    );
    const maps = Object.fromEntries(
      this.db
        .prepare('SELECT id, name, width, height, background FROM maps')
        .all()
        .map((row) => {
          const m = MapRow.parse(row);
          return [m.id, { id: m.id, name: m.name, width: m.width, height: m.height, background: m.background }];
        }),
    );
    const tokens = Object.fromEntries(
      this.db
        .prepare('SELECT id, map_id, name, x, y, size, monster_id, image, owner_ids FROM tokens')
        .all()
        .map((row) => {
          const t = TokenRow.parse(row);
          const ownerIds: unknown = JSON.parse(t.owner_ids);
          return [t.id, { id: t.id, mapId: t.map_id, name: t.name, position: { x: t.x, y: t.y }, size: t.size, monsterId: t.monster_id, image: t.image, ownerIds }];
        }),
    );
    const chat = this.db
      .prepare('SELECT entry FROM chat ORDER BY seq')
      .all()
      .map((row): unknown => JSON.parse(ChatRow.parse(row).entry));

    const parsed = SessionStateSchema.safeParse({ campaign: { id: campaign.id, name: campaign.name }, players, chat, maps, activeMapId: campaign.active_map_id, tokens });
    if (!parsed.success) throw new CampaignDbError(`Arquivo da campanha inválido: ${parsed.error.issues[0]?.message ?? 'erro desconhecido'}`);
    return parsed.data;
  }

  /**
   * Grava o estado da sessão numa transação. O log só cresce: entram as
   * entradas além das já gravadas. Mapas e tokens que saíram do estado são apagados.
   */
  save(state: SessionState): void {
    const { db } = this;
    transaction(db, () => {
      db.prepare('UPDATE campaign SET name = ?, active_map_id = ?').run(state.campaign.name, state.activeMapId);

      const upsertPlayer = db.prepare(
        'INSERT INTO players (id, display_name, role) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role',
      );
      for (const [id, p] of Object.entries(state.players)) upsertPlayer.run(id, p.displayName, p.role);

      // Tokens antes dos mapas: apagar um mapa apaga os tokens dele (ON DELETE CASCADE).
      this.removeMissing('tokens', Object.keys(state.tokens));
      this.removeMissing('maps', Object.keys(state.maps));
      const upsertMap = db.prepare(
        `INSERT INTO maps (id, name, width, height, background) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, width = excluded.width, height = excluded.height, background = excluded.background`,
      );
      for (const m of Object.values(state.maps)) upsertMap.run(m.id, m.name, m.width, m.height, m.background);
      const upsertToken = db.prepare(
        `INSERT INTO tokens (id, map_id, name, x, y, size, monster_id, image, owner_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET map_id = excluded.map_id, name = excluded.name, x = excluded.x, y = excluded.y, size = excluded.size,
           monster_id = excluded.monster_id, image = excluded.image, owner_ids = excluded.owner_ids`,
      );
      for (const t of Object.values(state.tokens)) {
        upsertToken.run(t.id, t.mapId, t.name, t.position.x, t.position.y, t.size, t.monsterId, t.image, JSON.stringify(t.ownerIds));
      }

      const saved = CountRow.parse(db.prepare('SELECT COUNT(*) AS n FROM chat').get()).n;
      const insertEntry = db.prepare('INSERT INTO chat (seq, id, entry) VALUES (?, ?, ?)');
      state.chat.slice(saved).forEach((entry: ChatEntry, i) => insertEntry.run(saved + i, entry.id, JSON.stringify(entry)));
    });
  }

  private removeMissing(table: 'maps' | 'tokens', keep: readonly string[]): void {
    const existing = this.db
      .prepare(`SELECT id FROM ${table}`)
      .all()
      .map((row) => z.object({ id: z.string() }).parse(row).id);
    const keepSet = new Set(keep);
    const remove = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const id of existing) if (!keepSet.has(id)) remove.run(id);
  }
}
