export interface SyncStatementResult {
  changes: number | bigint;
  lastInsertRowid?: number | bigint;
}

export interface SyncSqlStatement {
  run(...params: any[]): SyncStatementResult;
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

/**
 * Small synchronous SQL port used by GOLIATH' existing domain repositories.
 * SQLite DatabaseSync structurally implements this interface. Production
 * PostgreSQL is supplied by PostgresSyncDatabase in a dedicated runtime.
 */
export interface SyncSqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SyncSqlStatement;
  close?(): void;
}
