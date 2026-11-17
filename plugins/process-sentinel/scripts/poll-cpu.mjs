#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = process.env.VALET_PLUGIN_STATE_DIR || "/tmp/valet-process-sentinel";
let cfg = {};
try {
  cfg = JSON.parse(process.env.VALET_PLUGIN_CONFIG_JSON || "{}");
} catch {
  cfg = {};
}

const threshold = Number(cfg.cpuThresholdPct ?? 200) || 200;
const ignoredNames = ["valet", "valet-bun", "kernel_task", "windowserver"];

try {
  const out = execFileSync("ps", ["-Aceo", "pid,pcpu,rss,comm", "-r"], {
    encoding: "utf8",
    timeout: 3000,
  });
  const lines = out.trim().split(/\r?\n/).slice(1, 15);
  const rows = [];
  for (const line of lines) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const cpuPct = Math.round(Number(m[2]));
    const rssKB = Number(m[3]);
    const name = m[4].trim();
    const low = name.toLowerCase();
    if (ignoredNames.some((ig) => low.includes(ig))) continue;
    rows.push({
      pid,
      name,
      cpuPct,
      memMB: Math.round(rssKB / 1024),
    });
  }

  const offender = rows.find((r) => r.cpuPct >= threshold);
  mkdirSync(stateDir, { recursive: true });
  const stateFile = join(stateDir, "cpu-streak.json");
  let prev = { pid: 0, streak: 0 };
  if (existsSync(stateFile)) {
    try {
      prev = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      prev = { pid: 0, streak: 0 };
    }
  }

  let triggered = false;
  if (offender) {
    const nextStreak = prev.pid === offender.pid ? Number(prev.streak || 0) + 1 : 1;
    writeFileSync(stateFile, JSON.stringify({ pid: offender.pid, streak: nextStreak }));
    if (nextStreak >= 2) {
      triggered = true;
      writeFileSync(stateFile, JSON.stringify({ pid: offender.pid, streak: 0 }));
    }
  } else {
    writeFileSync(stateFile, JSON.stringify({ pid: 0, streak: 0 }));
  }

  process.stdout.write(
    JSON.stringify({
      triggered,
      payload: offender
        ? {
            pid: offender.pid,
            name: offender.name,
            cpuPct: offender.cpuPct,
            memMB: offender.memMB,
            summary: `${offender.name} (PID ${offender.pid}) CPU 持续达到 ${offender.cpuPct}%`,
            sensor: "script_poll",
          }
        : {},
    }),
  );
} catch {
  process.stdout.write(JSON.stringify({ triggered: false }));
}
