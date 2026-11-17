import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  type Extension,
  type HookApi,
  ToolTask,
  type ToolExecutionResult,
  type ToolHookCall,
  defineExtension,
  hook,
} from "@earendil-works/pi-durable";
import type { AutoReviewEvaluator } from "./auto-review.ts";
import type {
  CanonicalAutonomyLevel,
  HostBridge,
  PendingPermissionRequest,
  QueueApprovalParams,
  RecordTimelineParams,
  ResolvePermissionRequest,
  ToolPolicyMeta,
  ValetSyncState,
} from "./protocol.ts";

export interface InteractiveRequestInput {
  chatId: string;
  toolName: string;
  title: string;
  summary: string;
  command?: string;
  paths?: string[];
  targetPath?: string;
  options?: string[];
  approveLabel: string;
  allowSessionLabel?: string;
  dismissLabel: string;
}

export interface InteractiveResolution {
  approved: boolean;
  decision: "allow_once" | "allow_session" | "deny";
  note?: string;
}

const READ_ONLY_PLUGIN_SCRIPT_RE =
  /(?:^|\/)scripts\/(?:poll|import|read|inspect|scan|sample|summarize)-[a-z0-9._-]*\.(?:mjs|js|ts)$/i;

/**
 * Coordinates interactive permission prompts and ask_user turns for foreground Chat
 * sessions while keeping background sensor/heartbeat turns non-blocking via Inbox cards.
 */
export class InteractivePermissionCoordinator {
  private seq = 0;
  private readonly convToChatId = new Map<ConversationId, string>();
  private readonly interactiveChats = new Set<string>();
  private readonly streamEmitters = new Map<
    string,
    (pending?: PendingPermissionRequest) => void
  >();
  private readonly pendingByChat = new Map<
    string,
    {
      request: PendingPermissionRequest;
      resolve: (res: InteractiveResolution) => void;
    }
  >();
  private readonly sessionAllowedTools = new Map<string, Set<string>>();

  setConversationChatId(convId: ConversationId, chatId: string): void {
    this.convToChatId.set(convId, chatId);
  }

  getChatId(convId: ConversationId): string | undefined {
    return this.convToChatId.get(convId);
  }

  setInteractiveChat(chatId: string, interactive: boolean): void {
    if (
      interactive &&
      chatId &&
      !chatId.startsWith("event:") &&
      !chatId.startsWith("heartbeat:") &&
      !chatId.startsWith("automation:") &&
      !chatId.startsWith("approved:")
    ) {
      this.interactiveChats.add(chatId);
    } else {
      this.interactiveChats.delete(chatId);
    }
  }

  registerStreamEmitter(
    chatId: string,
    emitter: (pending?: PendingPermissionRequest) => void,
  ): void {
    this.streamEmitters.set(chatId, emitter);
  }

  unregisterStreamEmitter(chatId: string): void {
    this.streamEmitters.delete(chatId);
  }

  isForegroundChat(convIdOrChatId: ConversationId | string): boolean {
    const chatId =
      typeof convIdOrChatId === "string"
        ? convIdOrChatId
        : this.convToChatId.get(convIdOrChatId);
    if (!chatId) return false;
    return this.interactiveChats.has(chatId) && this.streamEmitters.has(chatId);
  }

  isSessionAllowed(convId: ConversationId, toolName: string): boolean {
    const chatId = this.convToChatId.get(convId);
    if (!chatId) return false;
    return this.sessionAllowedTools.get(chatId)?.has(toolName) ?? false;
  }

  getPending(chatId: string): PendingPermissionRequest | undefined {
    return this.pendingByChat.get(chatId)?.request;
  }

  requestInteractive(
    input: InteractiveRequestInput,
  ): Promise<InteractiveResolution> {
    const prev = this.pendingByChat.get(input.chatId);
    if (prev) {
      this.pendingByChat.delete(input.chatId);
      prev.resolve({ approved: false, decision: "deny", note: "已被新请求替换" });
    }

    const requestId = `perm-${++this.seq}-${Date.now()}`;
    const request: PendingPermissionRequest = {
      requestId,
      chatId: input.chatId,
      toolName: input.toolName,
      title: input.title,
      summary: input.summary,
      ...(input.command ? { command: input.command } : {}),
      ...(input.paths && input.paths.length > 0 ? { paths: input.paths } : {}),
      ...(input.targetPath ? { targetPath: input.targetPath } : {}),
      ...(input.options && input.options.length > 0
        ? { options: input.options }
        : {}),
      approveLabel: input.approveLabel,
      ...(input.allowSessionLabel
        ? { allowSessionLabel: input.allowSessionLabel }
        : {}),
      dismissLabel: input.dismissLabel,
    };

    return new Promise<InteractiveResolution>((resolve) => {
      this.pendingByChat.set(input.chatId, { request, resolve });
      this.streamEmitters.get(input.chatId)?.(request);
    });
  }

  resolve(req: ResolvePermissionRequest): boolean {
    const pending = this.pendingByChat.get(req.chatId);
    if (!pending) return false;
    if (req.requestId && pending.request.requestId !== req.requestId) {
      return false;
    }
    this.pendingByChat.delete(req.chatId);
    this.streamEmitters.get(req.chatId)?.(undefined);

    if (req.decision === "allow_session") {
      let set = this.sessionAllowedTools.get(req.chatId);
      if (!set) {
        set = new Set<string>();
        this.sessionAllowedTools.set(req.chatId, set);
      }
      set.add(pending.request.toolName);
    }

    const approved = req.decision !== "deny";
    pending.resolve({
      approved,
      decision: req.decision,
      note: req.note,
    });
    return true;
  }

  abortChat(chatId: string, note = "对话已停止"): void {
    const pending = this.pendingByChat.get(chatId);
    if (!pending) return;
    this.pendingByChat.delete(chatId);
    this.streamEmitters.get(chatId)?.(undefined);
    pending.resolve({ approved: false, decision: "deny", note });
  }
}

export interface TurnSideEffectTracker {
  recordInbox(
    conversationId: ConversationId,
    inboxId: string,
    eventId?: string,
  ): void;
  recordTimeline(conversationId: ConversationId, eventId: string): void;
}

export class ToolPolicyRegistry {
  private readonly entries = new Map<string, ToolPolicyMeta>();

  register(meta: ToolPolicyMeta): void {
    this.entries.set(meta.toolName, meta);
  }

  registerAll(list: readonly ToolPolicyMeta[]): void {
    for (const meta of list) {
      this.entries.set(meta.toolName, meta);
    }
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [name, meta] of this.entries) {
      if (meta.pluginId === pluginId) {
        this.entries.delete(name);
      }
    }
  }

  get(toolName: string): ToolPolicyMeta | undefined {
    return this.entries.get(toolName);
  }
}

export function normalizeAutonomyLevel(
  level?: string,
): CanonicalAutonomyLevel {
  switch ((level ?? "").trim()) {
    case "always_ask":
      return "always_ask";
    case "full_access":
    case "autonomous":
      return "full_access";
    case "auto_review":
    case "sensitive_only":
    default:
      return "auto_review";
  }
}

export type PolicyDecision =
  | { outcome: "allow" }
  | { outcome: "deny"; reason: string }
  | { outcome: "record"; reason: string }
  | { outcome: "ask"; reason: string }
  | { outcome: "review"; fallbackReason: string };

const HARD_PROTECTED_PREFIXES = [
  "/System",
  "/bin",
  "/sbin",
  "/usr",
  "~/.ssh",
  "~/.gnupg",
  "~/.aws",
  "~/Library/Keychains",
];

function expandPath(raw: string, homeDir: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "~") return homeDir;
  if (trimmed.startsWith("~/")) {
    return `${homeDir}/${trimmed.slice(2)}`;
  }
  return trimmed;
}

function matchesPrefix(target: string, prefix: string): boolean {
  if (!target || !prefix) return false;
  return target === prefix || target.startsWith(`${prefix}/`);
}

function collectCandidatePaths(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof args.path === "string") out.push(args.path);
  if (Array.isArray(args.paths)) {
    for (const p of args.paths) {
      if (typeof p === "string") out.push(p);
    }
  }
  return out;
}

const READ_ONLY_BASH_COMMANDS = new Set([
  "ls",
  "pwd",
  "cd",
  ":",
  "whoami",
  "id",
  "groups",
  "hostname",
  "hostinfo",
  "uname",
  "sw_vers",
  "arch",
  "date",
  "cal",
  "uptime",
  "df",
  "du",
  "ps",
  "pgrep",
  "vm_stat",
  "memory_pressure",
  "lsof",
  "netstat",
  "ifconfig",
  "arp",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "mdls",
  "mdfind",
  "which",
  "whereis",
  "type",
  "realpath",
  "readlink",
  "dirname",
  "basename",
  "md5",
  "shasum",
  "sha256sum",
  "cksum",
  "xxd",
  "hexdump",
  "od",
  "strings",
  "nl",
  "column",
  "paste",
  "comm",
  "cmp",
  "diff",
  "env",
  "printenv",
  "locale",
  "ulimit",
  "umask",
  "echo",
  "printf",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "awk",
  "cut",
  "sort",
  "uniq",
  "tr",
  "jq",
  "yq",
  "true",
  "false",
  "test",
  "[",
  "[[",
  "system_profiler",
]);

const STANDARD_BIN_PREFIXES = [
  "/bin/",
  "/usr/bin/",
  "/sbin/",
  "/usr/sbin/",
  "/opt/homebrew/bin/",
  "/usr/local/bin/",
];

function splitShellSegments(rawCmd: string): {
  segments: string[];
  hasUnsafeShellConstruct: boolean;
} {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < rawCmd.length; i += 1) {
    const ch = rawCmd[i]!;
    const next = rawCmd[i + 1] ?? "";

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && !inSingle) {
      escaped = true;
      current += ch;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle) {
      if ((ch === "$" && next === "(") || ch === "`") {
        return { segments: [], hasUnsafeShellConstruct: true };
      }
    }

    if (!inSingle && !inDouble) {
      if ((ch === "<" || ch === ">") && next === "(") {
        return { segments: [], hasUnsafeShellConstruct: true };
      }
      if (ch === "<") {
        const stdinNull = /^<\s*\/dev\/null(?=$|[\s;|&)])/.exec(rawCmd.slice(i));
        if (stdinNull) {
          i += stdinNull[0].length - 1;
          continue;
        }
      }
      if (ch === ">") {
        // Allow harmless `/dev/null` discards (e.g. `2>/dev/null`, `2> /dev/null`, `>/dev/null`, `1>/dev/null`) and `2>&1`.
        const prevChar = current[current.length - 1] ?? "";
        const charBeforePrev = current[current.length - 2] ?? "";
        const hasFdPrefix =
          (prevChar === "2" || prevChar === "1") &&
          (current.length === 1 || /[\s;|&(]/.test(charBeforePrev));
        if (hasFdPrefix) {
          const fdMatch = /^(?:2>(?:\s*\/dev\/null(?=$|[\s;|&)])|&1(?=$|[\s;|&)]))|1>\s*\/dev\/null(?=$|[\s;|&)]))/.exec(
            rawCmd.slice(i - 1),
          );
          if (fdMatch) {
            current = current.slice(0, -1);
            i += fdMatch[0].length - 2;
            continue;
          }
        }
        const bareNull = /^>\s*\/dev\/null(?=$|[\s;|&)])/.exec(rawCmd.slice(i));
        if (bareNull) {
          i += bareNull[0].length - 1;
          continue;
        }
        return { segments: [], hasUnsafeShellConstruct: true };
      }
      if (ch === "&") {
        const ampNull = /^&>\s*\/dev\/null(?=$|[\s;|&)])/.exec(rawCmd.slice(i));
        if (ampNull) {
          i += ampNull[0].length - 1;
          continue;
        }
      }
      if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
        segments.push(current);
        current = "";
        i += 1;
        continue;
      }
      if (ch === "&") {
        return { segments: [], hasUnsafeShellConstruct: true };
      }
      if (ch === ";" || ch === "|" || ch === "\n") {
        segments.push(current);
        current = "";
        continue;
      }
    }

    current += ch;
  }

  if (inSingle || inDouble) {
    return { segments: [], hasUnsafeShellConstruct: true };
  }
  segments.push(current);
  return { segments, hasUnsafeShellConstruct: false };
}

function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let hasToken = false;

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (escaped) {
      cur += ch;
      escaped = false;
      hasToken = true;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escaped = true;
      hasToken = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasToken = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasToken = true;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (hasToken) {
        tokens.push(cur);
        cur = "";
        hasToken = false;
      }
      continue;
    }
    cur += ch;
    hasToken = true;
  }
  if (hasToken) {
    tokens.push(cur);
  }
  return tokens;
}

function resolveBaseCommand(rawBin: string): string | null {
  if (rawBin === "valet" || rawBin.endsWith("/valet")) return "valet";
  if (!rawBin.includes("/")) return rawBin;
  for (const prefix of STANDARD_BIN_PREFIXES) {
    if (rawBin.startsWith(prefix)) {
      const rest = rawBin.slice(prefix.length);
      return rest && !rest.includes("/") ? rest : null;
    }
  }
  return null;
}

const VALET_GUARDRAIL_KEYWORDS = [
  "autonomylevel",
  "autoreview",
  "confirmchecklist",
  "protecteddirs",
  "blockedapps",
  "emergencystopshortcut",
  "sandboxisolation",
  "allowunsignedlocal",
  "deletemethod",
  "restoreretentiondays",
];

function classifyValetCliSegment(
  tokens: string[],
): "readonly" | "self_config" | "guardrail" | null {
  let idx = 0;
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx]!)) {
    idx += 1;
  }
  if (idx >= tokens.length) return null;
  if (resolveBaseCommand(tokens[idx]!) !== "valet") return null;

  const rawArgs = tokens.slice(idx + 1);
  const cmdTokens: string[] = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const t = rawArgs[i]!;
    if (t === "--") break;
    if (t === "--json" || t.startsWith("--data-dir=")) continue;
    if (t === "--data-dir") {
      i += 1;
      continue;
    }
    cmdTokens.push(t);
  }

  const c0 = cmdTokens[0] ?? "";
  const c1 = cmdTokens[1] ?? "";
  const hasClearFlag = rawArgs.includes("--clear");
  const isReadonly =
    c0 === "" ||
    c0 === "help" ||
    c0 === "--help" ||
    c0 === "-h" ||
    c0 === "version" ||
    c0 === "--version" ||
    c0 === "-v" ||
    c0 === "status" ||
    (c0 === "config" && (c1 === "show" || c1 === "get" || c1 === "schema" || c1 === "")) ||
    (c0 === "model" && (c1 === "show" || c1 === "")) ||
    (c0 === "provider" && (c1 === "list" || c1 === "")) ||
    (c0 === "heartbeat" && (c1 === "status" || c1 === "" || (c1 === "logs" && !hasClearFlag))) ||
    (c0 === "automation" && (c1 === "list" || c1 === "")) ||
    (c0 === "plugin" && (c1 === "list" || c1 === "inspect" || c1 === "validate" || c1 === "")) ||
    (c0 === "mcp" && (c1 === "list" || c1 === "")) ||
    (c0 === "memory" && (c1 === "list" || c1 === "")) ||
    (c0 === "inbox" && (c1 === "list" || c1 === "")) ||
    (c0 === "timeline" && (c1 === "list" || c1 === "" || c1.startsWith("--"))) ||
    (c0 === "skill" && (c1 === "list" || c1 === "show" || c1 === ""));

  if (isReadonly) {
    return "readonly";
  }

  if (c0 === "plugin" && c1 === "remove" && rawArgs.includes("--delete-files")) {
    return "guardrail";
  }
  for (const tok of rawArgs) {
    const low = tok.toLowerCase();
    if (tok === "--api-key" || low.startsWith("--api-key=")) {
      return "guardrail";
    }
    if (VALET_GUARDRAIL_KEYWORDS.some((kw) => low.includes(kw))) {
      return "guardrail";
    }
  }
  return "self_config";
}

function isReadOnlySegment(tokens: string[]): boolean {
  let idx = 0;
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx]!)) {
    idx += 1;
  }
  if (tokens.length > 0 && idx >= tokens.length) {
    // Pure variable assignment segment such as `f="/path/to/file"`
    return true;
  }
  const bin = resolveBaseCommand(tokens[idx]!);
  if (!bin) return false;
  const args = tokens.slice(idx + 1);

  if (bin === "command") {
    if (args.length === 0) return false;
    if (args[0] === "-v" || args[0] === "-V") return true;
    return isReadOnlySegment(args);
  }

  if (READ_ONLY_BASH_COMMANDS.has(bin)) {
    return true;
  }

  switch (bin) {
    case "hdiutil":
      return ["info", "imageinfo", "verify", "isencrypted"].includes(
        args[0] ?? "",
      );
    case "defaults":
      return ["read", "read-type", "domains", "find"].includes(args[0] ?? "");
    case "plutil":
      return args[0] === "-p" || args[0] === "-lint";
    case "xattr":
      return !args.some(
        (a) =>
          a === "-w" ||
          a === "-d" ||
          a === "-c" ||
          a.startsWith("-w") ||
          a.startsWith("-d"),
      );
    case "codesign":
      return (
        args.some((a) => ["-v", "--verify", "-d", "--display"].includes(a)) &&
        !args.some(
          (a) => a === "-s" || a === "--sign" || a === "--remove-signature",
        )
      );
    case "spctl":
      return (
        args.includes("--status") ||
        args.includes("-a") ||
        args.includes("--assess")
      );
    case "pkgutil":
      return ["--pkgs", "--pkg-info", "--files", "--volume-info"].some((f) =>
        (args[0] ?? "").startsWith(f),
      );
    case "sips":
      return args[0] === "-g" || args[0] === "--getProperty";
    case "lipo":
      return (
        args.includes("-info") ||
        args.includes("-archs") ||
        args.includes("-detailed_info")
      );
    case "csrutil":
      return args[0] === "status";
    case "sleep":
      return (
        args.length === 1 &&
        /^\d+(?:\.\d+)?$/.test(args[0]!) &&
        Number(args[0]) <= 10
      );
    case "route":
      return args.includes("get");
    case "top":
      return args.some((a) => a === "-l" || /^-l\d+$/.test(a));
    case "ping":
      return args.some((a) => a === "-c" || /^-c\d+$/.test(a));
    case "sed":
      return !args.some((a) => a === "--in-place" || /^-[a-zA-Z]*i/.test(a));
    case "find":
      return !args.some((a) =>
        ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf"].includes(a),
      );
    case "sysctl":
      return !args.some((a) => a === "-w" || a.includes("="));
    case "scutil":
      return (
        args.length > 0 &&
        ["--dns", "--nc", "--proxy", "--nwi", "--get"].includes(args[0]!)
      );
    case "networksetup":
      return (
        args.length > 0 &&
        (args[0]!.startsWith("-list") || args[0]!.startsWith("-get"))
      );
    case "pmset":
      return args[0] === "-g";
    case "launchctl":
      return args[0] === "list" || args[0] === "print";
    case "diskutil":
      return (
        args[0] === "list" ||
        args[0] === "info" ||
        (args[0] === "apfs" && args[1] === "list")
      );
    case "brew":
      return (
        ["list", "info", "doctor", "outdated", "config", "deps", "leaves"].includes(
          args[0] ?? "",
        ) ||
        (args[0] === "services" && args[1] === "list")
      );
    case "git": {
      let gIdx = 0;
      while (gIdx < args.length) {
        const tok = args[gIdx]!;
        if (tok === "-C" || tok === "-c" || tok === "--git-dir" || tok === "--work-tree") {
          gIdx += 2;
          continue;
        }
        if (tok === "--no-pager" || tok.startsWith("--git-dir=") || tok.startsWith("--work-tree=")) {
          gIdx += 1;
          continue;
        }
        break;
      }
      const sub = args[gIdx] ?? "";
      const rest = args.slice(gIdx + 1);
      if (["status", "log", "diff", "show", "rev-parse", "ls-files"].includes(sub)) {
        return true;
      }
      if (sub === "remote") {
        return rest.length === 0 || (rest.length === 1 && rest[0] === "-v");
      }
      if (sub === "branch") {
        return !rest.some((a) =>
          ["-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy"].includes(a),
        );
      }
      return false;
    }
    case "bun":
    case "valet-bun":
    case "node": {
      if (args.length === 0) return false;
      const scriptIdx = args[0] === "run" ? 1 : 0;
      const scriptArg = args[scriptIdx] ?? "";
      if (!scriptArg || scriptArg.startsWith("-")) return false;
      const restFlags = args.slice(scriptIdx + 1);
      if (restFlags.some((a) => a === "-e" || a === "--eval" || a === "-p" || a === "--print")) {
        return false;
      }
      return READ_ONLY_PLUGIN_SCRIPT_RE.test(scriptArg.replace(/\\/g, "/"));
    }
    case "valet":
      return classifyValetCliSegment(tokens) === "readonly";
    default:
      return false;
  }
}

/**
 * Returns true only when every pipeline/chain segment in `rawCmd` uses a known
 * read-only macOS/POSIX inspection command without shell redirections or command substitutions.
 */
export function isReadOnlyBashCommand(rawCmd: string): boolean {
  const trimmed = rawCmd.trim();
  if (!trimmed) return false;
  const { segments, hasUnsafeShellConstruct } = splitShellSegments(trimmed);
  if (hasUnsafeShellConstruct || segments.length === 0) return false;
  let parenDepth = 0;
  for (const seg of segments) {
    let cleanSeg = seg.trim();
    while (cleanSeg.startsWith("(")) {
      parenDepth += 1;
      cleanSeg = cleanSeg.slice(1).trimStart();
    }
    while (cleanSeg.endsWith(")") && parenDepth > 0) {
      parenDepth -= 1;
      cleanSeg = cleanSeg.slice(0, -1).trimEnd();
    }
    if (!cleanSeg) return false;
    const tokens = tokenizeSegment(cleanSeg);
    if (tokens.length === 0 || !isReadOnlySegment(tokens)) {
      return false;
    }
  }
  return parenDepth === 0;
}

/**
 * Blocks catastrophic, credential-reading, privilege-escalating, or protected-path
 * mutating shell commands before approval or execution.
 */
export function checkForbiddenBashCommand(
  rawCmd: string,
  state: ValetSyncState,
): string | null {
  const trimmed = rawCmd.trim();
  if (!trimmed) {
    return "命令不能为空。";
  }
  if (
    /(?:^|[;&|]\s*)(?:sudo|su)(?:\s|$)/.test(trimmed) ||
    /\s(?:sudo|su)\s/.test(trimmed)
  ) {
    return "安全边界拒绝：禁止通过 Valet 执行 sudo / 提权命令。";
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.includes("/.ssh") ||
    lower.includes("~/.ssh") ||
    lower.includes("/.gnupg") ||
    lower.includes("~/.gnupg") ||
    lower.includes("/.aws") ||
    lower.includes("~/.aws") ||
    lower.includes("/library/keychains") ||
    lower.includes("security find-generic-password") ||
    lower.includes("security find-internet-password") ||
    lower.includes("security dump-keychain")
  ) {
    return "安全边界拒绝：禁止读取或操作密钥与凭据目录（.ssh / .gnupg / .aws / Keychains）。";
  }

  if (
    /\brm\s+(?:-[a-zA-Z]+\s+)*(?:\/|~\/?|\$HOME\/?)(?:\s|$)/.test(trimmed) ||
    /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(?:\/\*?|~|\$HOME)(?:\s|$)/.test(trimmed) ||
    /\bmkfs(?:\.[a-z0-9]+)?\b/i.test(trimmed) ||
    /\bdd\s+.*\bof=\/dev\//.test(trimmed)
  ) {
    return "安全边界拒绝：禁止对根目录、主目录或块设备执行破坏性指令。";
  }

  const readOnly = isReadOnlyBashCommand(trimmed);
  if (!readOnly) {
    const systemProtected = ["/System", "/bin", "/sbin", "/usr"].map((d) =>
      expandPath(d, state.homeDir),
    );
    const userProtected = state.preferences.cleanupPolicy.protectedDirs.map((d) =>
      expandPath(d, state.homeDir),
    );
    const { segments } = splitShellSegments(trimmed);
    const allTokens = segments.flatMap((s) => tokenizeSegment(s).slice(1));
    const hasDestructiveVerb = /\b(?:rm|rmdir|unlink|shred|srm|mv)\b/.test(trimmed);

    for (const tok of allTokens) {
      if (tok.startsWith("-")) continue;
      const expanded = expandPath(tok, state.homeDir);
      if (!expanded.startsWith("/")) continue;
      for (const p of systemProtected) {
        if (matchesPrefix(expanded, p) && !matchesPrefix(expanded, "/usr/local")) {
          return `路径受保护：命令涉及系统受保护目录「${tok}」，Valet 已拦截该操作。`;
        }
      }
      if (hasDestructiveVerb) {
        for (const p of userProtected) {
          if (matchesPrefix(expanded, p)) {
            return `路径受保护：命令涉及受保护目录「${tok}」，Valet 已拦截该操作。`;
          }
        }
      }
    }
  }

  if (/\b(?:kill|pkill|killall)\b/i.test(trimmed)) {
    for (const blocked of state.preferences.blockedApps) {
      if (blocked && lower.includes(blocked.toLowerCase())) {
        return `受保护应用：禁止对隐私与安全拦截名单中的应用「${blocked}」执行终止命令。`;
      }
    }
  }

  return null;
}

/**
 * Evaluates a tool invocation against Valet's AutonomyLevel, SafetyConfirmationChecklist,
 * plugin per-event policy, protected directories, and blocked apps.
 */
export function evaluateToolPolicy(
  meta: ToolPolicyMeta | undefined,
  args: Record<string, unknown>,
  state: ValetSyncState,
  isPreApproved: boolean,
): PolicyDecision {
  const level = normalizeAutonomyLevel(state.preferences.autonomyLevel);

  if (meta?.toolName === "bash") {
    const rawCmd = String(args.command ?? "").trim();
    const forbidden = checkForbiddenBashCommand(rawCmd, state);
    if (forbidden) {
      return { outcome: "deny", reason: forbidden };
    }
    if (isReadOnlyBashCommand(rawCmd)) {
      return { outcome: "allow" };
    }

    const { segments, hasUnsafeShellConstruct } = splitShellSegments(rawCmd);
    if (!hasUnsafeShellConstruct && segments.length > 0) {
      let allValetOrReadonly = true;
      let sawValet = false;
      let sawGuardrail = false;
      for (const seg of segments) {
        const cleanSeg = seg.trim();
        if (!cleanSeg) {
          allValetOrReadonly = false;
          break;
        }
        const tokens = tokenizeSegment(cleanSeg);
        if (tokens.length === 0) {
          allValetOrReadonly = false;
          break;
        }
        const vClass = classifyValetCliSegment(tokens);
        if (vClass !== null) {
          sawValet = true;
          if (vClass === "guardrail") {
            sawGuardrail = true;
          }
          continue;
        }
        if (!isReadOnlySegment(tokens)) {
          allValetOrReadonly = false;
          break;
        }
      }
      if (allValetOrReadonly && sawValet) {
        if (sawGuardrail) {
          if (isPreApproved) {
            return { outcome: "allow" };
          }
          return {
            outcome: "ask",
            reason: "涉及修改 Valet 安全边界或敏感凭据配置，需经你确认后执行。",
          };
        }
        if (isPreApproved) {
          return { outcome: "allow" };
        }
        if (level === "always_ask") {
          return {
            outcome: "ask",
            reason: "当前安全级别为「每个都询问」，自配置变更需经你确认后执行。",
          };
        }
        if (
          state.preferences.confirmChecklist.modifySystemSettings &&
          level !== "full_access"
        ) {
          return {
            outcome: "ask",
            reason: "命中安全确认清单规则「修改系统或自配置」，需经你确认后执行。",
          };
        }
        if (level === "full_access") {
          return { outcome: "allow" };
        }
        return {
          outcome: "review",
          fallbackReason: "当前为 Auto Review 模式，Valet 自配置变更需经你确认后执行。",
        };
      }
    }

    if (isPreApproved) {
      return { outcome: "allow" };
    }
    if (level === "always_ask") {
      return {
        outcome: "ask",
        reason: "当前安全级别为「每个都询问」，终端命令需要你确认后执行。",
      };
    }
    if (
      state.preferences.confirmChecklist.runTerminalCommand &&
      level !== "full_access"
    ) {
      return {
        outcome: "ask",
        reason: "命中安全确认清单规则「执行终端命令」，已转入等待确认。",
      };
    }
    if (level === "full_access") {
      return { outcome: "allow" };
    }
    return {
      outcome: "review",
      fallbackReason: "当前为 Auto Review 模式，该终端命令未自动放行，请确认后执行。",
    };
  }

  const paths = collectCandidatePaths(args);
  if (paths.length > 0 && meta?.safety !== "readonly") {
    const protectedDirs = [
      ...HARD_PROTECTED_PREFIXES,
      ...state.preferences.cleanupPolicy.protectedDirs,
    ].map((d) => expandPath(d, state.homeDir));

    for (const rawPath of paths) {
      const normalized = expandPath(rawPath, state.homeDir);
      if (normalized === "" || normalized === "/" || normalized === state.homeDir) {
        return {
          outcome: "deny",
          reason: `安全边界拒绝：禁止对根目录或主目录「${rawPath}」执行清理或写入操作。`,
        };
      }
      for (const p of protectedDirs) {
        if (matchesPrefix(normalized, p)) {
          return {
            outcome: "deny",
            reason: `路径受保护：「${rawPath}」位于受保护目录内，Valet 已拦截该操作。`,
          };
        }
      }
    }
  }

  // Blocked process/app check
  if (meta?.toolName === "kill_process" || meta?.toolName === "process_terminate") {
    const targetName = String(args.name ?? args.command ?? "").toLowerCase();
    for (const blocked of state.preferences.blockedApps) {
      if (blocked && targetName.includes(blocked.toLowerCase())) {
        return {
          outcome: "deny",
          reason: `受保护应用：进程「${blocked}」位于隐私与安全拦截名单中，禁止终止。`,
        };
      }
    }
  }

  if (
    meta?.toolName === "plugin_install" &&
    !state.preferences.pluginRuntime.allowUnsignedLocal &&
    !isPreApproved
  ) {
    return {
      outcome: "deny",
      reason: "当前已关闭「允许加载未签名本地插件 (allowUnsignedLocal)」，拒绝加载本地插件。",
    };
  }

  if (!meta || meta.safety === "readonly") {
    return { outcome: "allow" };
  }

  if (isPreApproved) {
    return { outcome: "allow" };
  }

  const plugin = state.plugins.find((p) => p.id === meta.pluginId);
  const eventPolicy =
    plugin?.events.find((e) => e.id === meta.eventCode)?.policy ??
    (meta.pluginId === "valet-core" ? "auto" : "ask");
  const hasExplicitPluginAuto = Boolean(plugin && eventPolicy === "auto");

  if (eventPolicy === "record") {
    return {
      outcome: "record",
      reason: `插件「${meta.pluginName}」事件 ${meta.eventCode} 策略为「仅记录」，已存档至时间线而不执行变更。`,
    };
  }

  if (level === "always_ask") {
    return {
      outcome: "ask",
      reason: "当前安全级别为「每个都询问」，已等待用户批准。",
    };
  }

  if (
    meta.checklistKey &&
    ((meta.checklistKey === "deleteOrOverwrite" &&
      (meta.safety !== "reversible" || !hasExplicitPluginAuto)) ||
      meta.checklistKey === "sendMessageOrEmail" ||
      meta.checklistKey === "runTerminalCommand" ||
      meta.checklistKey === "paymentOrSubscription" ||
      meta.checklistKey === "modifySystemSettings") &&
    state.preferences.confirmChecklist[meta.checklistKey] &&
    level !== "full_access"
  ) {
    return {
      outcome: "ask",
      reason: `命中安全确认清单规则「${meta.checklistKey}」，需经用户确认后执行。`,
    };
  }

  if (level === "full_access") {
    return { outcome: "allow" };
  }

  if (hasExplicitPluginAuto && meta.safety === "reversible") {
    return { outcome: "allow" };
  }

  return {
    outcome: "review",
    fallbackReason: `当前为 Auto Review 模式，操作 ${meta.toolName} 需经你确认后执行。`,
  };
}

function buildApprovalPayload(
  meta: ToolPolicyMeta,
  call: ToolHookCall,
  decisionReason: string,
): QueueApprovalParams {
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  if (meta.toolName === "bash") {
    const rawCmd = String(args.command ?? "").trim();
    const shortCmd = rawCmd.length > 44 ? `${rawCmd.slice(0, 43)}…` : rawCmd;
    const rawCwd =
      typeof args.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : "~";
    const summaryText =
      typeof args.reason === "string" && args.reason.trim()
        ? args.reason.trim()
        : `将在 ${rawCwd} 下执行：${rawCmd}`;

    return {
      pluginId: meta.pluginId,
      pluginName: meta.pluginName,
      eventCode: meta.eventCode,
      category: meta.category,
      iconKind: meta.iconKind,
      title: `执行终端命令：${shortCmd || "bash"}`,
      summary: summaryText,
      reasoning: decisionReason,
      warningTag: meta.warningTag,
      reversible7d: meta.reversible7d,
      approveLabel: meta.approveLabel,
      dismissLabel: meta.dismissLabel,
      toolName: meta.toolName,
      toolArgs: { ...args },
      actionItems: [
        {
          id: `${call.id}-item-1`,
          label: rawCmd || "bash",
          path: rawCwd,
          sizeMB: 0,
          sizeLabel: "终端命令",
          checked: true,
        },
      ],
    };
  }

  const paths = collectCandidatePaths(args);
  const titleMap: Record<string, string> = {
    trash_files: `移出 ${paths.length || 1} 项文件至废纸篓`,
    write_file: `写入文件 ${String(args.path ?? "")}`,
    kill_process: `终止进程 ${String(args.name ?? "process")}（PID ${String(args.pid ?? "?")}）`,
  };

  const actionItems: QueueApprovalParams["actionItems"] =
    paths.length > 0
      ? paths.map((p, idx) => ({
          id: `${call.id}-item-${idx + 1}`,
          label: p,
          path: p,
          sizeMB: Number(args.estimatedTotalMB ?? 0) / Math.max(1, paths.length),
          sizeLabel:
            typeof args.sizeLabel === "string"
              ? args.sizeLabel
              : paths.length === 1 && args.estimatedGB
                ? `${String(args.estimatedGB)} GB`
                : "待确认项目",
          checked: true,
        }))
      : [
          {
            id: `${call.id}-item-1`,
            label:
              meta.toolName === "kill_process"
                ? `发送 ${String(args.signal ?? "SIGTERM")} 至 PID ${String(args.pid ?? "?")}`
                : `执行 ${meta.actionId}`,
            path:
              typeof args.path === "string"
                ? args.path
                : typeof args.recipient === "string"
                  ? args.recipient
                  : typeof args.repo === "string"
                    ? args.repo
                    : meta.actionId,
            sizeMB: 0,
            sizeLabel: meta.warningTag ?? "1 项",
            checked: true,
          },
        ];

  const estimatedGB =
    typeof args.estimatedGB === "number" ? args.estimatedGB : undefined;

  return {
    pluginId: meta.pluginId,
    pluginName: meta.pluginName,
    eventCode: meta.eventCode,
    category: meta.category,
    iconKind: meta.iconKind,
    title: titleMap[meta.toolName] ?? `批准执行 ${meta.pluginName} · ${meta.actionId}`,
    summary:
      typeof args.reason === "string" && args.reason
        ? args.reason
        : typeof args.draft === "string" && args.draft
          ? `草稿：「${args.draft}」，未经批准不会外发。`
          : paths.length > 0
            ? paths.slice(0, 3).join("、")
            : decisionReason,
    reasoning: decisionReason,
    warningTag: meta.warningTag,
    reversible7d: meta.reversible7d,
    reclaimableGB: estimatedGB,
    approveLabel: meta.approveLabel,
    dismissLabel: meta.dismissLabel,
    toolName: meta.toolName,
    toolArgs: { ...args },
    actionItems,
  };
}

/**
 * Installs Valet's ToolTask safety & audit extension.
 * Enforces safety policies BEFORE tool execution and records completed mutating actions in Timeline.
 */
export function createSafetyExtension(options: {
  bridge: HostBridge;
  policyRegistry: ToolPolicyRegistry;
  getState: () => ValetSyncState;
  approvedConversations: Set<ConversationId>;
  tracker?: TurnSideEffectTracker;
  permissionCoordinator?: InteractivePermissionCoordinator;
  autoReviewer?: AutoReviewEvaluator;
}): Extension {
  const {
    bridge,
    policyRegistry,
    getState,
    approvedConversations,
    tracker,
    permissionCoordinator,
    autoReviewer,
  } = options;

  return defineExtension({
    name: "valet:safety-gate",
    hooks: [
      hook(ToolTask, {
        beforeTool: async (
          call: ToolHookCall,
          api: HookApi,
          _context: Context,
        ) => {
          const state = getState();
          const meta = policyRegistry.get(call.name);
          const args = (call.arguments ?? {}) as Record<string, unknown>;
          const isPreApproved =
            approvedConversations.has(api.conversationId) ||
            (permissionCoordinator?.isSessionAllowed(
              api.conversationId,
              call.name,
            ) ??
              false);

          const decision = evaluateToolPolicy(meta, args, state, isPreApproved);
          if (decision.outcome === "allow") {
            return undefined;
          }
          if (decision.outcome === "deny") {
            return { block: decision.reason };
          }
          if (!meta) {
            return undefined;
          }

          if (decision.outcome === "record") {
            if (permissionCoordinator?.isForegroundChat(api.conversationId)) {
              return { block: decision.reason };
            }
            const rec: RecordTimelineParams = {
              pluginId: meta.pluginId,
              pluginName: meta.pluginName,
              eventCode: meta.eventCode,
              title: `${meta.pluginName} 捕获 ${meta.eventCode}（仅记录）`,
              summary: decision.reason,
              status: "completed",
              reasoning: decision.reason,
              payload: { tool: call.name, policy: "record" },
            };
            const recorded = await bridge.callHost<{ timelineEventId: string }>(
              "host.recordTimelineEvent",
              rec as unknown as Record<string, unknown>,
            );
            if (recorded?.timelineEventId) {
              tracker?.recordTimeline(
                api.conversationId,
                recorded.timelineEventId,
              );
            }
            return { block: decision.reason };
          }

          let decisionReason: string;
          if (decision.outcome === "review") {
            if (autoReviewer) {
              const reviewRes = await autoReviewer.evaluate({
                toolName: call.name,
                args,
                meta,
                state,
                isForeground:
                  permissionCoordinator?.isForegroundChat(api.conversationId) ??
                  false,
              });
              if (reviewRes.approved) {
                return undefined;
              }
              decisionReason = reviewRes.reason || decision.fallbackReason;
            } else {
              decisionReason = decision.fallbackReason;
            }
          } else {
            decisionReason = decision.reason;
          }

          const approvalReq = buildApprovalPayload(meta, call, decisionReason);

          // Foreground Chat mode: prompt inline in conversation & await user confirmation
          if (permissionCoordinator?.isForegroundChat(api.conversationId)) {
            const chatId = permissionCoordinator.getChatId(api.conversationId)!;
            const paths = collectCandidatePaths(args);
            const rawCmd =
              call.name === "bash" && typeof args.command === "string"
                ? args.command.trim()
                : undefined;
            const targetPath =
              typeof args.path === "string" && args.path.trim()
                ? args.path.trim()
                : undefined;
            const allowSessionLabel =
              meta.safety === "confirm_always" ? undefined : "本会话允许";
            const approveLabel =
              call.name === "bash" || call.name === "write_file" || call.name === "trash_files"
                ? "允许一次"
                : approvalReq.approveLabel;

            const res = await permissionCoordinator.requestInteractive({
              chatId,
              toolName: call.name,
              title: approvalReq.title,
              summary: approvalReq.summary,
              command: rawCmd,
              paths: paths.length > 0 ? paths : undefined,
              targetPath,
              approveLabel,
              allowSessionLabel,
              dismissLabel: "拒绝",
            });
            if (!res.approved) {
              return {
                block: `USER_DENIED: 用户拒绝执行工具 ${call.name}${res.note ? `（原因：${res.note}）` : ""}。请尊重用户选择，不要强行重试并告知用户。`,
              };
            }
            return undefined;
          }

          // Background mode (sensor / webhook / cron / heartbeat): queue Inbox card
          const queued = await bridge.callHost<{
            inboxId: string;
            timelineEventId: string;
          }>(
            "host.queueApproval",
            approvalReq as unknown as Record<string, unknown>,
          );
          if (queued?.inboxId) {
            tracker?.recordInbox(
              api.conversationId,
              queued.inboxId,
              queued.timelineEventId,
            );
          }
          return {
            block: `NEEDS_APPROVAL(${queued?.inboxId ?? "pending"}): 该敏感操作未直接执行，已提交至「收件箱」与「时间线」等待用户批准。请告知用户前去收件箱确认。`,
          };
        },
        afterTool: async (
          call: ToolHookCall,
          result: ToolExecutionResult,
          api: HookApi,
          _context: Context,
        ) => {
          if (result.isError) return result;
          if (permissionCoordinator?.isForegroundChat(api.conversationId)) {
            return result;
          }
          const meta = policyRegistry.get(call.name);
          if (!meta || meta.safety === "readonly") return result;
          if (call.name === "bash") {
            const rawCmd = String(
              ((call.arguments ?? {}) as Record<string, unknown>).command ?? "",
            );
            if (isReadOnlyBashCommand(rawCmd)) {
              return result;
            }
          }

          const details =
            result.details && typeof result.details === "object"
              ? (result.details as Record<string, unknown>)
              : {};
          const timelineReq: RecordTimelineParams = {
            pluginId: meta.pluginId,
            pluginName: meta.pluginName,
            eventCode: meta.eventCode,
            title:
              typeof details.timelineTitle === "string"
                ? details.timelineTitle
                : `${meta.pluginName} 已执行 ${meta.actionId}`,
            summary:
              typeof details.timelineSummary === "string"
                ? details.timelineSummary
                : `已按当前自主策略自动完成 ${call.name}。`,
            status: "completed",
            reasoning: `由工具 ${call.name} 执行完成（策略允许）。`,
            reclaimedGB:
              typeof details.reclaimedGB === "number"
                ? details.reclaimedGB
                : undefined,
            intercepted: call.name === "kill_process" ? true : undefined,
            canRestore:
              typeof details.canRestore === "boolean"
                ? details.canRestore
                : meta.reversible7d,
            payload: {
              tool: call.name,
              action: meta.actionId,
            },
          };
          const recorded = await bridge.callHost<{ timelineEventId: string }>(
            "host.recordTimelineEvent",
            timelineReq as unknown as Record<string, unknown>,
          );
          if (recorded?.timelineEventId) {
            tracker?.recordTimeline(api.conversationId, recorded.timelineEventId);
          }
          return result;
        },
      }),
    ],
  });
}
