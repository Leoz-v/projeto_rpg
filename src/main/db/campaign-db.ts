import { z } from 'zod';
import { type ChatEntry, type SessionState, SessionStateSchema } from '../../shared/protocol';
import { migrate, type MigrateResult } from './migrate';
import { type Database, openDatabase, transaction } from './sqlite';

/**
 * `<campanha>.db`: arquivo portátil com tudo o que é da mesa: jogadores,
 * mapas, tokens, o log do chat e os personagens (só as escolhas de
 * construção), os inventários e o combate em andamento.
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
  `ALTER TABLE maps ADD COLUMN cell_px INTEGER;`,
  // Escolhas de construção em JSON (baseScores, rolledScores, steps), validadas pelo schema ao carregar.
  `CREATE TABLE characters (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL REFERENCES players (id),
     name TEXT NOT NULL,
     build TEXT NOT NULL
   ) STRICT;`,
  // Inventário do personagem em JSON (validado ao carregar) e o personagem de cada token.
  `ALTER TABLE characters ADD COLUMN inventory TEXT NOT NULL DEFAULT '{"currency":{"cp":0,"sp":0,"ep":0,"gp":0,"pp":0},"items":[]}';
   ALTER TABLE tokens ADD COLUMN character_id TEXT;`,
  // Ajustes do mestre de cada personagem, em JSON (validados ao carregar).
  `ALTER TABLE characters ADD COLUMN adjustments TEXT NOT NULL DEFAULT '[]';`,
  // PV: dano e temporários do personagem; do token, também o máximo (JSON, validados ao carregar).
  `ALTER TABLE characters ADD COLUMN hp TEXT NOT NULL DEFAULT '{"damage":0,"temp":0}';
   ALTER TABLE tokens ADD COLUMN hp TEXT;`,
  // Combate em andamento (ordem de turnos, rodada e vez), em JSON validado ao carregar; NULL sem combate.
  `ALTER TABLE campaign ADD COLUMN combat TEXT;`,
] as const;

export const CAMPAIGN_DB_SCHEMA_VERSION = MIGRATIONS.length;

export class CampaignDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignDbError';
  }
}

const CampaignRow = z.object({ id: z.string(), name: z.string(), active_map_id: z.string().nullable(), combat: z.string().nullable() });
const PlayerRow = z.object({ id: z.string(), display_name: z.string(), role: z.string() });
const MapRow = z.object({ id: z.string(), name: z.string(), width: z.number(), height: z.number(), background: z.string().nullable(), cell_px: z.number().nullable() });
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
  character_id: z.string().nullable(),
  hp: z.string().nullable(),
});
const ChatRow = z.object({ entry: z.string() });
const CharacterRow = z.object({ id: z.string(), owner_id: z.string(), name: z.string(), build: z.string(), inventory: z.string(), adjustments: z.string(), hp: z.string() });
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
    const campaignRow = this.db.prepare('SELECT id, name, active_map_id, combat FROM campaign').get();
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
        .prepare('SELECT id, name, width, height, background, cell_px FROM maps')
        .all()
        .map((row) => {
          const m = MapRow.parse(row);
          return [m.id, { id: m.id, name: m.name, width: m.width, height: m.height, background: m.background, cellPx: m.cell_px }];
        }),
    );
    const tokens = Object.fromEntries(
      this.db
        .prepare('SELECT id, map_id, name, x, y, size, monster_id, image, owner_ids, character_id, hp FROM tokens')
        .all()
        .map((row) => {
          const t = TokenRow.parse(row);
          const ownerIds: unknown = JSON.parse(t.owner_ids);
          return [t.id, { id: t.id, mapId: t.map_id, name: t.name, position: { x: t.x, y: t.y }, size: t.size, monsterId: t.monster_id, image: t.image, ownerIds, characterId: t.character_id, hp: t.hp === null ? null : (JSON.parse(t.hp) as unknown) }];
        }),
    );
    const characters = Object.fromEntries(
      this.db
        .prepare('SELECT id, owner_id, name, build, inventory, adjustments, hp FROM characters')
        .all()
        .map((row) => {
          const c = CharacterRow.parse(row);
          const build: unknown = JSON.parse(c.build);
          const inventory: unknown = JSON.parse(c.inventory);
          const adjustments: unknown = JSON.parse(c.adjustments);
          const hp: unknown = JSON.parse(c.hp);
          return [c.id, { id: c.id, ownerId: c.owner_id, name: c.name, ...(typeof build === 'object' ? build : {}), inventory, hp, adjustments }];
        }),
    );
    const chat = this.db
      .prepare('SELECT entry FROM chat ORDER BY seq')
      .all()
      .map((row): unknown => JSON.parse(ChatRow.parse(row).entry));

    const parsed = SessionStateSchema.safeParse({ campaign: { id: campaign.id, name: campaign.name }, players, chat, maps, activeMapId: campaign.active_map_id, tokens, characters, proposals: {}, combat: campaign.combat === null ? null : (JSON.parse(campaign.combat) as unknown) });
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
      db.prepare('UPDATE campaign SET name = ?, active_map_id = ?, combat = ?').run(state.campaign.name, state.activeMapId, state.combat === null ? null : JSON.stringify(state.combat));

      const upsertPlayer = db.prepare(
        'INSERT INTO players (id, display_name, role) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role',
      );
      for (const [id, p] of Object.entries(state.players)) upsertPlayer.run(id, p.displayName, p.role);

      // Tokens antes dos mapas: apagar um mapa apaga os tokens dele (ON DELETE CASCADE).
      this.removeMissing('tokens', Object.keys(state.tokens));
      this.removeMissing('maps', Object.keys(state.maps));
      const upsertMap = db.prepare(
        `INSERT INTO maps (id, name, width, height, background, cell_px) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, width = excluded.width, height = excluded.height, background = excluded.background, cell_px = excluded.cell_px`,
      );
      for (const m of Object.values(state.maps)) upsertMap.run(m.id, m.name, m.width, m.height, m.background, m.cellPx);
      const upsertToken = db.prepare(
        `INSERT INTO tokens (id, map_id, name, x, y, size, monster_id, image, owner_ids, character_id, hp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET map_id = excluded.map_id, name = excluded.name, x = excluded.x, y = excluded.y, size = excluded.size,
           monster_id = excluded.monster_id, image = excluded.image, owner_ids = excluded.owner_ids, character_id = excluded.character_id, hp = excluded.hp`,
      );
      for (const t of Object.values(state.tokens)) {
        upsertToken.run(t.id, t.mapId, t.name, t.position.x, t.position.y, t.size, t.monsterId, t.image, JSON.stringify(t.ownerIds), t.characterId, t.hp === null ? null : JSON.stringify(t.hp));
      }

      this.removeMissing('characters', Object.keys(state.characters));
      const upsertCharacter = db.prepare(
        `INSERT INTO characters (id, owner_id, name, build, inventory, adjustments, hp) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET owner_id = excluded.owner_id, name = excluded.name, build = excluded.build, inventory = excluded.inventory,
           adjustments = excluded.adjustments, hp = excluded.hp`,
      );
      for (const c of Object.values(state.characters)) {
        upsertCharacter.run(c.id, c.ownerId, c.name, JSON.stringify({ baseScores: c.baseScores, rolledScores: c.rolledScores, steps: c.steps }), JSON.stringify(c.inventory), JSON.stringify(c.adjustments), JSON.stringify(c.hp));
      }

      const saved = CountRow.parse(db.prepare('SELECT COUNT(*) AS n FROM chat').get()).n;
      const insertEntry = db.prepare('INSERT INTO chat (seq, id, entry) VALUES (?, ?, ?)');
      state.chat.slice(saved).forEach((entry: ChatEntry, i) => insertEntry.run(saved + i, entry.id, JSON.stringify(entry)));
    });
  }

  private removeMissing(table: 'maps' | 'tokens' | 'characters', keep: readonly string[]): void {
    const existing = this.db
      .prepare(`SELECT id FROM ${table}`)
      .all()
      .map((row) => z.object({ id: z.string() }).parse(row).id);
    const keepSet = new Set(keep);
    const remove = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const id of existing) if (!keepSet.has(id)) remove.run(id);
  }
}
