import { GoliathError } from '../core/errors.js';
import type { SyncSqlDatabase, SyncSqlStatement, SyncStatementResult } from './sync-database.js';

export interface SyncPostgresClient {
  connectSync?(connectionString?: string): void;
  querySync(sql: string, params?: readonly any[]): any[];
  end?(): void;
}

export type SyncPostgresClientLoader = () => Promise<new () => SyncPostgresClient>;

function normalizeConnectionString(value: string): string {
  const trimmed = value.trim();
  if (!/^postgres(?:ql)?:\/\//i.test(trimmed)) {
    throw new GoliathError('INVALID_INPUT', 'PostgreSQL runtime requires a postgres:// or postgresql:// DATABASE_URL.');
  }
  return trimmed;
}

function replaceQuestionPlaceholders(sql: string): string {
  let out = '';
  let index = 0;
  let single = false;
  let double = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'" && !double) {
      out += ch;
      if (single && sql[i + 1] === "'") { out += sql[++i]!; continue; }
      single = !single;
      continue;
    }
    if (ch === '"' && !single) {
      out += ch;
      if (double && sql[i + 1] === '"') { out += sql[++i]!; continue; }
      double = !double;
      continue;
    }
    if (ch === '?' && !single && !double) out += `$${++index}`;
    else out += ch;
  }
  return out;
}

function insertIgnoreToPostgres(sql: string): string {
  if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)) return sql;
  const replaced = sql.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO\b/i, '$1INSERT INTO');
  const trimmed = replaced.trimEnd();
  const semicolon = trimmed.endsWith(';');
  const body = semicolon ? trimmed.slice(0, -1).trimEnd() : trimmed;
  return `${body} ON CONFLICT DO NOTHING${semicolon ? ';' : ''}`;
}

function appendReturning(sql: string): string {
  const trimmed = sql.trimEnd();
  if (!/^(INSERT|UPDATE|DELETE)\b/i.test(trimmed)) return sql;
  if (/\bRETURNING\b/i.test(trimmed)) return sql;
  const semicolon = trimmed.endsWith(';');
  const body = semicolon ? trimmed.slice(0, -1).trimEnd() : trimmed;
  return `${body} RETURNING 1 AS __goliath_changed${semicolon ? ';' : ''}`;
}

/** Convert the small SQLite-flavoured subset emitted by GOLIATH repositories to PostgreSQL. */
export function translateRepositorySql(sql: string): string {
  let translated = sql.replace(/\bBEGIN\s+IMMEDIATE\b/gi, 'BEGIN');
  translated = translated.replace(/\browid\b/gi, 'append_seq');
  translated = insertIgnoreToPostgres(translated);
  translated = replaceQuestionPlaceholders(translated);
  return translated;
}

function normalizeParams(params: readonly any[]): readonly any[] {
  return params.map((value) => value === undefined ? null : value);
}

class PostgresSyncStatement implements SyncSqlStatement {
  constructor(private readonly client: SyncPostgresClient, private readonly sql: string) {}

  run(...params: any[]): SyncStatementResult {
    const executable = appendReturning(this.sql);
    const rows = this.client.querySync(executable, normalizeParams(params));
    return { changes: rows.length, lastInsertRowid: 0 };
  }

  get(...params: any[]): any {
    return this.client.querySync(this.sql, normalizeParams(params))[0];
  }

  all(...params: any[]): any[] {
    return this.client.querySync(this.sql, normalizeParams(params));
  }
}

/**
 * PostgreSQL implementation of the existing synchronous repository port.
 *
 * This intentionally keeps all GOLIATH business logic in the existing repository/service layer.
 * Use this adapter only in a dedicated Node worker/process because network-backed synchronous
 * queries block that worker's event loop. Production should run multiple workers for concurrency.
 */
export class PostgresSyncDatabase implements SyncSqlDatabase {
  constructor(public readonly client: SyncPostgresClient) {}

  prepare(sql: string): SyncSqlStatement {
    return new PostgresSyncStatement(this.client, translateRepositorySql(sql));
  }

  exec(sql: string): void {
    const translated = translateRepositorySql(sql).trim();
    if (!translated) return;
    this.client.querySync(translated);
  }

  close(): void { this.client.end?.(); }
}

async function defaultClientLoader(): Promise<new () => SyncPostgresClient> {
  let imported: any;
  try { imported = await import('pg-native'); }
  catch {
    throw new GoliathError('INTEGRATION_DISABLED', 'pg-native is required for the synchronous PostgreSQL production adapter. Install production dependencies and libpq.');
  }
  const Candidate = imported.default ?? imported;
  if (typeof Candidate !== 'function') throw new GoliathError('INTEGRATION_DISABLED', 'pg-native did not expose a client constructor.');
  return Candidate as new () => SyncPostgresClient;
}

export async function connectPostgresSyncDatabase(
  connectionString: string,
  loader: SyncPostgresClientLoader = defaultClientLoader,
): Promise<PostgresSyncDatabase> {
  const url = normalizeConnectionString(connectionString);
  const Client = await loader();
  const client = new Client();
  if (typeof client.connectSync !== 'function') throw new GoliathError('INTEGRATION_DISABLED', 'Configured PostgreSQL client does not support synchronous connections.');
  client.connectSync(url);
  const db = new PostgresSyncDatabase(client);
  const version = db.prepare('SELECT current_setting(\'server_version_num\') AS server_version_num').get();
  if (!version || Number(version.server_version_num) < 140000) {
    db.close();
    throw new GoliathError('INTEGRATION_DISABLED', 'GOLIATH requires PostgreSQL 14 or newer.');
  }
  return db;
}
