import { copyFileSync } from 'node:fs';
import { type Database, transaction, userVersion } from './sqlite';

/**
 * Migrações sequenciais por `PRAGMA user_version` (CLAUDE.md): a migração `i`
 * leva o banco da versão `i` para `i + 1`. Antes de alterar um banco que já
 * tinha dados, copia o arquivo para `<arquivo>.bak`.
 */

export class DatabaseTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`Banco criado por uma versão mais nova do app (esquema ${found}; este app conhece até ${supported}). Atualize o app.`);
    this.name = 'DatabaseTooNewError';
  }
}

export interface MigrateResult {
  from: number;
  to: number;
  /** Caminho do backup, quando houve. */
  backup?: string;
}

/**
 * Aplica as migrações que faltam, cada uma na sua transação.
 * `path` é o arquivo do banco (`undefined` em memória: sem backup).
 */
export function migrate(db: Database, migrations: readonly string[], path?: string): MigrateResult {
  const from = userVersion(db);
  const to = migrations.length;
  if (from > to) throw new DatabaseTooNewError(from, to);
  if (from === to) return { from, to };

  let backup: string | undefined;
  if (path !== undefined && from > 0) {
    // Leva o WAL para o arquivo principal, para a cópia ficar completa.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    backup = `${path}.bak`;
    copyFileSync(path, backup);
  }

  for (let version = from; version < to; version++) {
    transaction(db, () => {
      db.exec(migrations[version] ?? '');
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return { from, to, ...(backup !== undefined ? { backup } : {}) };
}
