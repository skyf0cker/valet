#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUERY_SECRET_RE =
  /\b(token|access_token|refresh_token|password|passwd|pwd|secret|api_key|apikey|key|auth|uuid|psk)=([^&\s,;"]+)/gi;
const BASIC_AUTH_RE = /(https?|socks5h?|socks5):\/\/([^/@\s:]+):([^/@\s]+)@/gi;
const STD_LINE_RE =
  /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})(?:\.\d+)?\s+(?:<([A-Za-z]+)>|\[([A-Za-z]+)\])\s*(?:\[([^\]]+)\])?\s*(.*)$/;
const BRACKET_PREFIX_RE = /^\[([^\]]+)\]\s*(.*)$/;

export function redactSurgeSensitiveText(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(QUERY_SECRET_RE, "$1=***REDACTED***")
    .replace(BASIC_AUTH_RE, "$1://$2:***REDACTED***@");
}

function resolveHome(homeDir) {
  return (homeDir || process.env.VALET_HOME_DIR || homedir()).replace(/\/+$/, "");
}

export function latestSurgeLogSignal(homeDir) {
  const home = resolveHome(homeDir);
  const logDir = join(home, "Library", "Logs", "Surge");
  let latestMs = 0;
  for (const dir of [logDir, join(logDir, "Scripts")]) {
    if (!existsSync(dir)) continue;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".log")) continue;
      try {
        const st = statSync(join(dir, entry.name));
        if (st.mtimeMs > latestMs) latestMs = st.mtimeMs;
      } catch {
        // ignore unreadable entry
      }
    }
  }
  return latestMs;
}

function collectRecentLogFiles(dir, maxFiles) {
  if (!existsSync(dir)) return [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".log")) continue;
    const fp = join(dir, entry.name);
    try {
      const st = statSync(fp);
      files.push({ fp, mtimeMs: st.mtimeMs });
    } catch {
      // ignore
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, maxFiles).map((f) => f.fp);
}

function parseTimestampMs(ts) {
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function classifySurgeMessage(component, level, message) {
  const lowComp = (component || "").toLowerCase();
  const lowMsg = (message || "").toLowerCase();
  const lowLevel = (level || "").toLowerCase();

  if (
    lowMsg.includes("recovering from a crash") ||
    lowMsg.includes("crash-restored") ||
    lowMsg.includes("crash") ||
    lowMsg.includes("崩溃")
  ) {
    return "crash_recovery";
  }
  if (
    lowComp.includes("profile") ||
    lowMsg.includes("update config failed") ||
    lowMsg.includes("无效配置") ||
    lowMsg.includes("配置存在错误") ||
    lowMsg.includes("#!managed-config")
  ) {
    return "profile_config";
  }
  if (
    lowComp.includes("tunnel") ||
    lowMsg.includes("tun-excluded-routes") ||
    lowMsg.includes("excluded route") ||
    lowMsg.includes("utun")
  ) {
    return "tun_route";
  }
  if (
    lowComp.includes("externalprocess") ||
    lowMsg.includes("external proxy process terminated") ||
    lowMsg.includes("reason: exit")
  ) {
    return "external_proxy";
  }
  if (
    lowComp.includes("dns") ||
    lowComp.includes("ntp") ||
    lowMsg.includes("dns") ||
    lowMsg.includes("doh") ||
    lowMsg.includes("doq") ||
    lowMsg.includes("no ntp response") ||
    lowMsg.includes("fake-ip")
  ) {
    return "dns_ntp";
  }
  if (
    lowComp.includes("geoip") ||
    lowComp.includes("externalresource") ||
    lowMsg.includes("geoip") ||
    lowMsg.includes("rule-set")
  ) {
    return "geoip_resource";
  }
  if (
    lowComp.includes("script") ||
    lowComp.includes("mitm") ||
    lowMsg.includes("$done") ||
    lowMsg.includes("syntaxerror") ||
    lowMsg.includes("typeerror") ||
    lowMsg.includes("mitm")
  ) {
    return "script_mitm";
  }
  if (lowComp.includes("outgoingselector") || lowMsg.includes("too many sub-policies")) {
    return "policy_group";
  }
  if (lowLevel === "error") return "external_proxy";
  return "profile_config";
}

const CATEGORY_META = {
  profile_config: {
    label: "配置文件或托管订阅更新异常",
    severity: "high",
    check: "核对报错行号配置（托管配置勿直接修改源文件，可通过模块覆写并执行 surge-cli --check 验证）。",
  },
  tun_route: {
    label: "增强模式 TUN 路由冲突",
    severity: "high",
    check: "检查 tun-excluded-routes 是否误写 IPv6 CIDR（仅支持 IPv4），或与 Docker/Tailscale utun 网段冲突。",
  },
  external_proxy: {
    label: "外部代理内核进程异常退出",
    severity: "medium",
    check: "区分重载配置引起的正常回收与单一内核持续崩溃，核查端口占用与内核权限。",
  },
  dns_ntp: {
    label: "DNS 解析 / 时钟同步异常",
    severity: "high",
    check: "排查 DoH/DoQ 或 UDP 123 连通性；DNS 污染或 Fake-IP 卡死时经授权执行 surge-cli flush dns。",
  },
  geoip_resource: {
    label: "GeoIP / 规则集远程更新失败",
    severity: "low",
    check: "检查 rule-set 或 geoip-maxmind-url 远程地址可用性或镜像源。",
  },
  script_mitm: {
    label: "脚本执行或 MITM 解密异常",
    severity: "medium",
    check: "检查脚本 $done() 回调与超时配置；SSL Pinning 域名需加入 [MITM] hostname-disabled。",
  },
  crash_recovery: {
    label: "Surge 崩溃后恢复重启",
    severity: "high",
    check: "核对崩溃发生时间点，并检查 DiagnosticReports 与近期配置变更。",
  },
  policy_group: {
    label: "策略组节点膨胀警告",
    severity: "low",
    check: "按地区或正则拆分子策略组，避免单组包含过多节点导致测速开销过大。",
  },
};

function parseLogFile(fp, cutoffMs) {
  let raw = "";
  try {
    raw = readFileSync(fp, "utf8");
  } catch {
    return [];
  }
  const sourceName = basename(fp);
  const out = [];
  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = STD_LINE_RE.exec(line);
    let ts = "";
    let levelRaw = "";
    let component = "";
    let msg = "";
    if (m) {
      ts = m[1];
      levelRaw = (m[2] || m[3] || "").toUpperCase();
      component = m[4] || "";
      msg = m[5] || "";
      if (!component && msg.startsWith("[")) {
        const bm = BRACKET_PREFIX_RE.exec(msg);
        if (bm) {
          component = bm[1];
          msg = bm[2];
        }
      }
    } else if (/error|warn|failed|terminated|invalid|syntaxerror|typeerror/i.test(line)) {
      ts = new Date().toISOString().slice(0, 19).replace("T", " ");
      levelRaw = /error|failed|crash|syntaxerror/i.test(line) ? "ERROR" : "WARNING";
      msg = line;
    } else {
      continue;
    }

    if (levelRaw !== "ERROR" && levelRaw !== "ERR" && levelRaw !== "WARNING" && levelRaw !== "WARN") {
      if (!/error|failed|terminated|invalid|crash/i.test(msg)) continue;
      levelRaw = "WARNING";
    }
    const normLevel = levelRaw.startsWith("ERR") ? "ERROR" : "WARNING";
    const tsMs = parseTimestampMs(ts);
    if (cutoffMs > 0 && tsMs > 0 && tsMs < cutoffMs) continue;

    out.push({
      timestamp: ts,
      level: normLevel,
      component,
      category: classifySurgeMessage(component, normLevel, msg),
      message: redactSurgeSensitiveText(msg.trim()),
      source: sourceName,
    });
  }
  return out;
}

function entrySignature(e) {
  return createHash("sha256")
    .update(`${e.timestamp}|${e.level}|${e.component}|${e.message}`)
    .digest("hex")
    .slice(0, 20);
}

function resolveSurgeCLI(homeDir) {
  const envPath = (process.env.SURGE_CLI_PATH || "").trim();
  if (envPath && existsSync(envPath)) return envPath;
  for (const cand of [
    "/Applications/Surge.app/Contents/Applications/surge-cli",
    join(homeDir, "Applications", "Surge.app", "Contents", "Applications", "surge-cli"),
  ]) {
    if (existsSync(cand)) return cand;
  }
  return "";
}

function collectSurgeStatus(homeDir) {
  const cli = resolveSurgeCLI(homeDir);
  const logDir = join(homeDir, "Library", "Logs", "Surge");
  const status = {
    installed: Boolean(cli) || existsSync(logDir),
    cliAvailable: Boolean(cli),
    running: false,
    logDir,
  };
  if (!cli) return status;
  try {
    const out = execFileSync(cli, ["status"], { encoding: "utf8", timeout: 2500 });
    status.running = true;
    status.rawSummary = out.trim().slice(0, 500);
    for (const line of out.split(/\r?\n/)) {
      const low = line.toLowerCase();
      if (low.startsWith("profile:") && !status.profile) {
        status.profile = line.slice(line.indexOf(":") + 1).trim();
      } else if (low.startsWith("profile path:")) {
        status.profilePath = line.slice(line.indexOf(":") + 1).trim();
      } else if (low.startsWith("mode:")) {
        status.mode = line.slice(line.indexOf(":") + 1).trim();
      }
    }
  } catch {
    // Surge not running
  }
  return status;
}

export function importSurgeLogs(options = {}) {
  const home = resolveHome(options.homeDir);
  const stateDir =
    options.stateDir || process.env.VALET_PLUGIN_STATE_DIR || join(home, ".valet-surge-state");
  const windowMinutes = Number(options.windowMinutes) > 0 ? Number(options.windowMinutes) : 360;
  const maxEntries = Math.min(100, Math.max(1, Number(options.maxEntries) || 30));
  const onlyNew = Boolean(options.onlyNew);
  const advanceCursor = options.advanceCursor !== false;

  const logDir = join(home, "Library", "Logs", "Surge");
  let filesToScan = [];
  let effectiveLogDir = logDir;
  const customPath = (options.customPath || "").trim();
  if (customPath) {
    const absCustom = customPath.startsWith("~/") ? join(home, customPath.slice(2)) : resolve(customPath);
    const st = statSync(absCustom);
    if (st.isDirectory()) {
      effectiveLogDir = absCustom;
      filesToScan = collectRecentLogFiles(absCustom, 10);
    } else {
      effectiveLogDir = resolve(absCustom, "..");
      filesToScan = [absCustom];
    }
  } else {
    filesToScan = [
      ...collectRecentLogFiles(logDir, 5),
      ...collectRecentLogFiles(join(logDir, "Scripts"), 10),
    ];
  }

  const cutoffMs = Date.now() - windowMinutes * 60 * 1000;
  const seen = new Set();
  const entries = [];
  for (const fp of filesToScan) {
    for (const e of parseLogFile(fp, cutoffMs)) {
      const sig = entrySignature(e);
      if (seen.has(sig)) continue;
      seen.add(sig);
      entries.push(e);
    }
  }

  entries.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
    if (a.level !== b.level) return a.level === "ERROR" ? -1 : 1;
    return a.message.localeCompare(b.message);
  });

  mkdirSync(stateDir, { recursive: true });
  const cursorFile = join(stateDir, "surge-cursor.json");
  let cursor = { lastTimestamp: "", seenAtLast: [] };
  if (existsSync(cursorFile)) {
    try {
      cursor = JSON.parse(readFileSync(cursorFile, "utf8"));
    } catch {
      cursor = { lastTimestamp: "", seenAtLast: [] };
    }
  }

  const seenSet = new Set(Array.isArray(cursor.seenAtLast) ? cursor.seenAtLast : []);
  const newEntries = entries.filter((e) => {
    if (!cursor.lastTimestamp) return true;
    if (e.timestamp > cursor.lastTimestamp) return true;
    if (e.timestamp === cursor.lastTimestamp) return !seenSet.has(entrySignature(e));
    return false;
  });

  if (advanceCursor && entries.length > 0) {
    const newestTS = entries[0].timestamp;
    const seenAtNewest = entries
      .filter((e) => e.timestamp === newestTS)
      .map((e) => entrySignature(e));
    writeFileSync(
      cursorFile,
      JSON.stringify({ lastTimestamp: newestTS, seenAtLast: seenAtNewest }),
    );
  }

  const effective = onlyNew ? newEntries : entries;
  let errorCount = 0;
  let warningCount = 0;
  const groupMap = new Map();

  for (const e of effective) {
    if (e.level === "ERROR") errorCount += 1;
    else warningCount += 1;

    const gKey = e.category;
    const prev = groupMap.get(gKey);
    const meta = CATEGORY_META[gKey] || CATEGORY_META.profile_config;
    if (!prev) {
      groupMap.set(gKey, {
        category: gKey,
        categoryLabel: meta.label,
        severity: meta.severity,
        component: e.component || "Surge",
        sampleMessage: e.message,
        count: 1,
        firstSeen: e.timestamp,
        lastSeen: e.timestamp,
        suggestedCheck: meta.check,
      });
    } else {
      prev.count += 1;
      if (e.timestamp < prev.firstSeen) prev.firstSeen = e.timestamp;
      if (e.timestamp > prev.lastSeen) prev.lastSeen = e.timestamp;
    }
  }

  const groups = [...groupMap.values()].sort((a, b) => b.count - a.count);
  const recentEntries = effective.slice(0, maxEntries);
  const status = customPath
    ? { installed: filesToScan.length > 0, cliAvailable: false, running: false, logDir: effectiveLogDir }
    : collectSurgeStatus(home);

  const summary =
    effective.length === 0
      ? onlyNew
        ? `最近 ${windowMinutes} 分钟内暂无新增 Surge 错误或告警日志（已扫描 ${filesToScan.length} 份日志）。`
        : `最近 ${windowMinutes} 分钟内未发现 Surge 错误或告警日志（已扫描 ${filesToScan.length} 份日志文件）。`
      : `已导入并脱敏 ${effective.length} 条 Surge 日志（${errorCount} 条错误、${warningCount} 条告警，归类为 ${groups.length} 组问题；本次新增 ${newEntries.length} 条）。`;

  return {
    importedAt: new Date().toISOString(),
    logDir: effectiveLogDir,
    filesScanned: filesToScan.length,
    scannedFiles: filesToScan.map((f) => basename(f)),
    errorCount,
    warningCount,
    totalMatches: effective.length,
    newSinceLast: newEntries.length,
    summary,
    status,
    groups,
    recentEntries,
  };
}

const isCLI =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isCLI) {
  const args = process.argv.slice(2);
  let minutes = 360;
  let customPath = "";
  let onlyNew = false;
  let maxEntries = 30;
  let advanceCursor = true;
  for (const arg of args) {
    if (arg.startsWith("--minutes=")) minutes = Number(arg.slice(10)) || 360;
    else if (arg.startsWith("--path=")) customPath = arg.slice(7);
    else if (arg === "--only-new") onlyNew = true;
    else if (arg.startsWith("--max-entries=")) maxEntries = Number(arg.slice(14)) || 30;
    else if (arg === "--no-advance-cursor") advanceCursor = false;
  }
  const report = importSurgeLogs({
    windowMinutes: minutes,
    customPath,
    onlyNew,
    maxEntries,
    advanceCursor,
  });
  process.stdout.write(JSON.stringify(report, null, 2));
}
