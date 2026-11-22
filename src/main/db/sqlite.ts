import { DatabaseSync } from 'node:sqlite';

/**
 * Acesso ao SQLite embutido no Node (`node:sqlite`, nota 0023). Todo o uso do
 * banco passa por este módulo e pelos repositórios ao lado, para a troca de
 * biblioteca, se um dia for preciso, ficar restrita a `src/main/db/`.
 */

export type Database = DatabaseSync;

/** Abre (ou cria) o banco com os PRAGMAs do CLAUDE.md. `:memory:` nos testes. */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Executa `run` numa transação: tudo ou nada. */
export function transaction<T>(db: Database, run: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (err: unknown) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function userVersion(db: Database): number {
  const row = db.prepare('PRAGMA user_version').get();
  const version = row?.['user_version'];
  return typeof version === 'number' ? version : 0;
}
