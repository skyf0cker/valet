#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { importSurgeLogs, latestSurgeLogSignal } from "./import-logs.mjs";

const homeDir = process.env.VALET_HOME_DIR || homedir();
const stateDir =
  process.env.VALET_PLUGIN_STATE_DIR || join(homeDir, ".valet-surge-state");
let cfg = {};
try {
  cfg = JSON.parse(process.env.VALET_PLUGIN_CONFIG_JSON || "{}");
} catch {
  cfg = {};
}

const windowMinutes = Number(cfg.windowMinutes ?? 60) || 60;
mkdirSync(stateDir, { recursive: true });
const mtimeFile = join(stateDir, "poll-mtime.txt");

let prevMtime = 0;
if (existsSync(mtimeFile)) {
  try {
    prevMtime = Number(readFileSync(mtimeFile, "utf8").trim()) || 0;
  } catch {
    prevMtime = 0;
  }
}

const newestMtime = latestSurgeLogSignal(homeDir);
if (!newestMtime || newestMtime <= prevMtime) {
  if (prevMtime === 0 && newestMtime > 0) {
    // Establish initial cursor baseline without flooding existing historical logs on startup
    importSurgeLogs({
      homeDir,
      stateDir,
      windowMinutes,
      onlyNew: true,
      maxEntries: 5,
      advanceCursor: true,
    });
    writeFileSync(mtimeFile, String(newestMtime));
  }
  process.stdout.write(JSON.stringify({ triggered: false }));
  process.exit(0);
}

writeFileSync(mtimeFile, String(newestMtime));
const report = importSurgeLogs({
  homeDir,
  stateDir,
  windowMinutes,
  onlyNew: true,
  maxEntries: 20,
  advanceCursor: true,
});

process.stdout.write(
  JSON.stringify({
    triggered: report.totalMatches > 0,
    payload: {
      title: `Surge 诊断：发现 ${report.totalMatches} 条新增错误/告警`,
      ...report,
      sensor: "script_poll",
    },
  }),
);
