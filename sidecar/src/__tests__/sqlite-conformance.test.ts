import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { openUniversalSqliteStorage } from "../sqlite.ts";

registerStorageConformance(
  {
    describe,
    expect: expect as never,
    it: (name, testFn, timeoutMs) =>
      it(name, testFn, timeoutMs ? { timeout: timeoutMs } : undefined),
  },
  "BunSqliteDatabase + SqliteStorage",
  async (use) => {
    const dir = await mkdtemp(join(tmpdir(), "valet-pi-sqlite-"));
    const dbPath = join(dir, "conformance.sqlite");
    const storage = await openUniversalSqliteStorage(dbPath, { prefix: "pi_" });
    try {
      await use(storage);
    } finally {
      await storage.close(BACKGROUND_CONTEXT);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
