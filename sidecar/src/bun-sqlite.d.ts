declare module "bun:sqlite" {
  export interface BunSqliteRunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface BunSqliteStatement<Row = unknown> {
    run(...params: unknown[]): BunSqliteRunResult;
    get(...params: unknown[]): Row | null;
    all(...params: unknown[]): Row[];
    finalize?(): void;
  }

  export interface BunSqliteOptions {
    readonly?: boolean;
    create?: boolean;
    readwrite?: boolean;
    strict?: boolean;
  }

  export class Database {
    constructor(filename?: string, options?: BunSqliteOptions);
    exec(sql: string): this;
    prepare<Row = unknown>(sql: string): BunSqliteStatement<Row>;
    query<Row = unknown>(sql: string): BunSqliteStatement<Row>;
    close(throwOnError?: boolean): void;
  }
}

declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(
    name: string,
    fn: () => void | Promise<void>,
    options?: { timeout?: number } | number,
  ): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export const expect: {
    (value: unknown): {
      toBe(expected: unknown): void;
      toEqual(expected: unknown): void;
      toContain(expected: unknown): void;
      toBeDefined(): void;
      toBeGreaterThanOrEqual(n: number): void;
      not: {
        toContain(expected: unknown): void;
        toBe(expected: unknown): void;
      };
    };
  };
}

declare const Bun:
  | {
      version: string;
    }
  | undefined;
