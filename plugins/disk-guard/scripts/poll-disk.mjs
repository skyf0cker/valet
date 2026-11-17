#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const homeDir = process.env.VALET_HOME_DIR || homedir();
const stateDir = process.env.VALET_PLUGIN_STATE_DIR || "/tmp/valet-disk-guard";
let cfg = {};
try {
  cfg = JSON.parse(process.env.VALET_PLUGIN_CONFIG_JSON || "{}");
} catch {
  cfg = {};
}

const thresholdPct = Number(cfg.lowSpaceThresholdPct ?? 15) || 15;

try {
  const out = execFileSync("df", ["-Pk", homeDir], { encoding: "utf8", timeout: 3000 });
  const lines = out.trim().split(/\r?\n/);
  const dataLine = lines[lines.length - 1] || "";
  const parts = dataLine.trim().split(/\s+/);
  const totalKB = Number(parts[1] || 0);
  const availKB = Number(parts[3] || 0);
  const capPctRaw = String(parts[4] || "0%").replace("%", "");
  const diskPct = Number(capPctRaw) || 0;
  const freePct = Math.max(0, 100 - diskPct);
  const diskFreeGB = Math.round((availKB / (1024 * 1024)) * 10) / 10;
  const diskTotalGB = Math.round((totalKB / (1024 * 1024)) * 10) / 10;

  let triggered = freePct < thresholdPct;
  if (triggered) {
    mkdirSync(stateDir, { recursive: true });
    const markerFile = join(stateDir, "last-alert.json");
    const now = Date.now();
    if (existsSync(markerFile)) {
      try {
        const prev = JSON.parse(readFileSync(markerFile, "utf8"));
        if (now - Number(prev.ts || 0) < 30 * 60 * 1000) {
          triggered = false;
        }
      } catch {
        // Ignore stale marker
      }
    }
    if (triggered) {
      writeFileSync(markerFile, JSON.stringify({ ts: now, diskPct, diskFreeGB }));
    }
  }

  process.stdout.write(
    JSON.stringify({
      triggered,
      payload: {
        diskPct,
        freePct,
        diskFreeGB,
        diskTotalGB,
        threshold: thresholdPct,
        sensor: "script_poll",
      },
    }),
  );
} catch {
  process.stdout.write(JSON.stringify({ triggered: false }));
}
