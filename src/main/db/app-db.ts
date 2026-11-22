import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Preferences, PreferencesSchema } from '../../shared/ipc-schemas';
import { migrate, type MigrateResult } from './migrate';
import { type Database, openDatabase } from './sqlite';

/**
 * `app.db`: o que é desta instalação, não de uma campanha. O id do jogador
 * (estável entre execuções), as preferências da tela inicial e o índice das
 * campanhas hospedadas aqui. O compêndio continua embutido no app (JSON validado).
 */

const MIGRATIONS = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
   CREATE TABLE campaigns (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     file TEXT NOT NULL,
     last_opened_at INTEGER NOT NULL
   ) STRICT;`,
] as const;

export const APP_DB_SCHEMA_VERSION = MIGRATIONS.length;

export interface CampaignSummary {
  id: string;
  name: string;
  /** Caminho do `<campanha>.db`. */
  file: string;
  lastOpenedAt: number;
}

const SettingRow = z.object({ value: z.string() });
const CampaignRow = z.object({ id: z.string(), name: z.string(), file: z.string(), last_opened_at: z.number() });

export class AppDb {
  private constructor(
    private readonly db: Database,
    readonly migration: MigrateResult,
  ) {}

  static open(path: string): AppDb {
    const db = openDatabase(path);
    try {
      return new AppDb(db, migrate(db, MIGRATIONS, path === ':memory:' ? undefined : path));
    } catch (err: unknown) {
      db.close();
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  private setting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? SettingRow.parse(row).value : undefined;
  }

  private setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /** Id deste app no protocolo (`playerId`): criado na primeira execução e nunca mais muda. */
  playerId(): string {
    const stored = this.setting('player_id');
    if (stored !== undefined) return stored;
    const id = randomUUID();
    this.setSetting('player_id', id);
    return id;
  }

  /** Preferências da tela inicial; um valor corrompido volta ao padrão em vez de travar o app. */
  preferences(): Preferences {
    const raw = this.setting('preferences');
    if (raw === undefined) return {};
    try {
      const parsed = PreferencesSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  savePreferences(changes: Preferences): Preferences {
    const next = PreferencesSchema.parse({ ...this.preferences(), ...changes });
    this.setSetting('preferences', JSON.stringify(next));
    return next;
  }

  /** Campanhas hospedadas aqui, da usada mais recentemente para a mais antiga. */
  campaigns(): CampaignSummary[] {
    return this.db
      .prepare('SELECT id, name, file, last_opened_at FROM campaigns ORDER BY last_opened_at DESC')
      .all()
      .map((row) => {
        const r = CampaignRow.parse(row);
        return { id: r.id, name: r.name, file: r.file, lastOpenedAt: r.last_opened_at };
      });
  }

  campaign(id: string): CampaignSummary | undefined {
    return this.campaigns().find((c) => c.id === id);
  }

  /** Registra (ou atualiza) uma campanha como aberta agora. */
  touchCampaign(campaign: Omit<CampaignSummary, 'lastOpenedAt'>, now: number): void {
    this.db
      .prepare(
        `INSERT INTO campaigns (id, name, file, last_opened_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, file = excluded.file, last_opened_at = excluded.last_opened_at`,
      )
      .run(campaign.id, campaign.name, campaign.file, now);
  }
}
