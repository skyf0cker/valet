import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteValue,
} from "@earendil-works/chord/sqlite";
import { validateSqliteSchemaPrefix } from "@earendil-works/chord/sqlite";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";

const DEFAULT_WAL_AUTO_CHECKPOINT_PAGES = 1_000;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const STATEMENT_CACHE_LIMIT = 256;
const ignore = () => {};

/** Runs operations sequentially so concurrent database and transaction calls never interleave. */
class SerialOperationQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  run<T>(operation: () => T): Promise<T> {
    if (this.pending > 0) return this.enqueue(operation);
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  runAsync<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending > 0) return this.enqueue(operation);
    this.pending++;
    const { promise: barrier, resolve: releaseBarrier } =
      Promise.withResolvers<void>();
    this.tail = barrier;
    let started: Promise<T>;
    try {
      started = operation();
    } catch (error) {
      started = Promise.reject(error);
    }
    return started.finally(() => {
      this.pending--;
      releaseBarrier();
    });
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    this.pending++;
    const settled = this.tail.then(operation).finally(() => {
      this.pending--;
    });
    this.tail = settled.then(ignore, ignore);
    return settled;
  }
}

interface NativeSqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  finalize?(): void;
}

interface NativeSqliteDb {
  exec(sql: string): unknown;
  prepare(sql: string): NativeSqliteStatement;
  close(): void;
}

class BunSqliteExecutor implements SqliteExecutor {
  constructor(
    protected readonly database: NativeSqliteDb,
    protected readonly statements: Map<string, NativeSqliteStatement>,
  ) {}

  exec(sql: string): Promise<void> {
    return this.runOperation(() => {
      this.database.exec(sql);
    });
  }

  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.runOperation(() => {
      this.statement(sql).run(...params);
    });
  }

  runCounted(sql: string, ...params: SqliteValue[]): Promise<number> {
    return this.runOperation(() =>
      Number(this.statement(sql).run(...params).changes),
    );
  }

  get<T extends object>(
    sql: string,
    ...params: SqliteValue[]
  ): Promise<T | undefined> {
    return this.runOperation(() => {
      const row = this.statement(sql).get(...params);
      return row == null ? undefined : (row as T);
    });
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.runOperation(
      () => this.statement(sql).all(...params) as T[],
    );
  }

  protected statement(sql: string): NativeSqliteStatement {
    let stmt = this.statements.get(sql);
    if (stmt !== undefined) {
      if (this.statements.size > STATEMENT_CACHE_LIMIT / 2) {
        this.statements.delete(sql);
        this.statements.set(sql, stmt);
      }
      return stmt;
    }
    stmt = this.database.prepare(sql);
    this.statements.set(sql, stmt);
    if (this.statements.size > STATEMENT_CACHE_LIMIT) {
      const oldestKey = this.statements.keys().next().value;
      if (oldestKey !== undefined) {
        const oldest = this.statements.get(oldestKey);
        this.statements.delete(oldestKey);
        oldest?.finalize?.();
      }
    }
    return stmt;
  }

  protected runOperation<T>(operation: () => T): Promise<T> {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

class BunSqliteTransaction extends BunSqliteExecutor {
  constructor(
    database: NativeSqliteDb,
    statements: Map<string, NativeSqliteStatement>,
    private readonly scope: { active: boolean },
  ) {
    super(database, statements);
  }

  protected override async runOperation<T>(operation: () => T): Promise<T> {
    if (!this.scope.active) {
      throw new Error("SQLite transaction handle is no longer active");
    }
    return operation();
  }
}

/** Portable `SqliteDatabase` adapter over `bun:sqlite` matching Chord's contract. */
export class BunSqliteDatabase
  extends BunSqliteExecutor
  implements SqliteDatabase
{
  private readonly access = new SerialOperationQueue();
  private closed = false;

  constructor(
    database: NativeSqliteDb,
    private readonly mode: "read-write" | "read-only" = "read-write",
  ) {
    super(database, new Map());
  }

  transaction<T>(
    callback: (transaction: SqliteExecutor) => Promise<T>,
  ): Promise<T> {
    return this.access.runAsync(async () => {
      this.database.exec(
        this.mode === "read-only" ? "BEGIN" : "BEGIN IMMEDIATE",
      );
      const scope = { active: true };
      try {
        const result = await callback(
          new BunSqliteTransaction(this.database, this.statements, scope),
        );
        scope.active = false;
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        scope.active = false;
        try {
          this.database.exec("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "SQLite transaction failed and rollback failed",
          );
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.access.run(() => {
      if (this.closed) return;
      this.closed = true;
      for (const stmt of this.statements.values()) {
        stmt.finalize?.();
      }
      this.statements.clear();
      try {
        if (this.mode === "read-write") {
          this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        }
      } finally {
        this.database.close();
      }
    });
  }

  protected override runOperation<T>(operation: () => T): Promise<T> {
    return this.access.run(operation);
  }
}

export async function openBunSqliteDatabase(
  filePath: string,
  options: {
    mode?: "read-write" | "read-only";
    busyTimeoutMs?: number;
    walAutoCheckpointPages?: number;
  } = {},
): Promise<BunSqliteDatabase> {
  const { Database } = await import("bun:sqlite");
  const mode = options.mode ?? "read-write";
  const timeout = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const checkpointPages =
    options.walAutoCheckpointPages ?? DEFAULT_WAL_AUTO_CHECKPOINT_PAGES;

  if (mode === "read-only") {
    const db = new Database(filePath, { readonly: true });
    const adapter = new BunSqliteDatabase(db, "read-only");
    await adapter.exec(`PRAGMA busy_timeout = ${timeout}`);
    return adapter;
  }

  if (filePath !== ":memory:") {
    await mkdir(dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath, { create: true, readwrite: true });
  const adapter = new BunSqliteDatabase(db, "read-write");
  try {
    await adapter.exec(`PRAGMA busy_timeout = ${timeout}`);
    await adapter.exec("PRAGMA journal_mode = WAL");
    await adapter.exec("PRAGMA synchronous = NORMAL");
    await adapter.exec(`PRAGMA wal_autocheckpoint = ${checkpointPages}`);
    return adapter;
  } catch (error) {
    try {
      await adapter.close();
    } catch {
      // Preserve initial error
    }
    throw error;
  }
}

/**
 * Opens durable SQLite storage compatible with both Bun (`bun:sqlite`) and Node (`node:sqlite`).
 */
export async function openUniversalSqliteStorage(
  filePath: string,
  options: {
    prefix?: string;
    mode?: "read-write" | "read-only";
    busyTimeoutMs?: number;
  } = {},
): Promise<SqliteStorage> {
  const prefix = options.prefix ?? "pi_";
  validateSqliteSchemaPrefix(prefix);

  if (typeof Bun !== "undefined") {
    const db = await openBunSqliteDatabase(filePath, {
      mode: options.mode,
      busyTimeoutMs: options.busyTimeoutMs,
    });
    return SqliteStorage.open(db, { prefix });
  }

  // Dynamically resolve Node SQLite fallback without static bundler capture of node:sqlite.
  const nodeStorageModule = `${"@earendil-works/pi-durable"}/storage/sqlite/node`;
  const mod = (await import(nodeStorageModule)) as {
    openNodeSqliteStorage: (
      path: string,
      opts?: { prefix?: string; mode?: "read-write" | "read-only"; busyTimeoutMs?: number },
    ) => Promise<SqliteStorage>;
  };
  return mod.openNodeSqliteStorage(filePath, {
    prefix,
    mode: options.mode,
    busyTimeoutMs: options.busyTimeoutMs,
  });
}
