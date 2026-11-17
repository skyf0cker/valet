import type { ValetModelManager } from "./models.ts";
import type {
  AutoReviewConfig,
  ToolPolicyMeta,
  ValetSyncState,
} from "./protocol.ts";

export interface AutoReviewEvaluationInput {
  toolName: string;
  args: Record<string, unknown>;
  meta?: ToolPolicyMeta;
  state: ValetSyncState;
  isForeground: boolean;
  overrideConfig?: Partial<AutoReviewConfig>;
  bypassCache?: boolean;
}

export interface AutoReviewEvaluationResult {
  approved: boolean;
  engine: "jev" | "llm" | "none";
  model: string;
  reason: string;
  latencyMs: number;
  scores?: Record<string, number>;
}

interface CacheEntry {
  result: AutoReviewEvaluationResult;
  expiresAt: number;
}

export const JEV_RISK_THRESHOLDS = {
  harmful: 0.35,
  sensitive: 0.5,
  untrusted: 0.5,
  obscured: 0.5,
} as const;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

export function normalizeJevEndpoint(raw?: string): string {
  let base = (raw ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    return "https://api.typesafe.ai/v1/systemone";
  }
  if (!base.startsWith("http://") && !base.startsWith("https://")) {
    base = `https://${base}`;
  }
  if (base.endsWith("/systemone") || base.endsWith("/decisions")) {
    return base;
  }
  try {
    const parsed = new URL(base);
    if (parsed.hostname.includes("openrouter.ai")) {
      if (parsed.pathname === "" || parsed.pathname === "/") {
        return `${base}/api/v1/systemone`;
      }
      if (parsed.pathname === "/api") {
        return `${base}/v1/systemone`;
      }
      if (parsed.pathname === "/api/v1") {
        return `${base}/systemone`;
      }
      return base;
    }
  } catch {
    // Fall back to standard suffix completion if URL parsing fails
  }
  if (/\/v\d+(beta)?$/i.test(base)) {
    return `${base}/systemone`;
  }
  return `${base}/v1/systemone`;
}

function isMockKey(key: string): boolean {
  const trimmed = key.trim();
  return !trimmed || trimmed.includes("-mock-");
}

export function resolveEffectiveAutoReviewConfig(
  state: ValetSyncState,
  overrideCfg?: Partial<AutoReviewConfig>,
): AutoReviewConfig {
  const base = state.preferences.autoReview;
  return {
    engine: overrideCfg?.engine ?? base?.engine ?? "auto",
    jevEndpoint:
      overrideCfg?.jevEndpoint ??
      base?.jevEndpoint ??
      "https://api.typesafe.ai/v1/systemone",
    jevApiKey: overrideCfg?.jevApiKey ?? base?.jevApiKey ?? "",
    jevApiKeyMasked: overrideCfg?.jevApiKeyMasked ?? base?.jevApiKeyMasked,
    jevModel: overrideCfg?.jevModel ?? base?.jevModel ?? "jev-latest",
    jevVerified: overrideCfg?.jevVerified ?? base?.jevVerified,
    jevLatencyMs: overrideCfg?.jevLatencyMs ?? base?.jevLatencyMs,
    fallbackProviderId:
      overrideCfg?.fallbackProviderId ?? base?.fallbackProviderId ?? "",
    fallbackModel: overrideCfg?.fallbackModel ?? base?.fallbackModel ?? "同快速模型",
  };
}

function resolveJevKey(
  cfg: AutoReviewConfig,
  endpoint: string,
  state: ValetSyncState,
): string {
  const explicit = (cfg.jevApiKey ?? "").trim();
  if (!isMockKey(explicit)) {
    return explicit;
  }
  if (endpoint.toLowerCase().includes("openrouter.ai")) {
    const orKey =
      state.providers.find((p) => p.id === "openrouter")?.apiKey?.trim() ?? "";
    if (!isMockKey(orKey)) {
      return orKey;
    }
  }
  return "";
}

function resolveJevModel(cfg: AutoReviewConfig, endpoint: string): string {
  const configured = (cfg.jevModel ?? "").trim();
  if (endpoint.toLowerCase().includes("openrouter.ai")) {
    if (!configured || configured === "jev-latest") {
      return "typesafe/jev-1.14";
    }
    return configured.includes("/") ? configured : `typesafe/${configured}`;
  }
  return configured || "jev-latest";
}

function buildReviewSubjectSummary(input: AutoReviewEvaluationInput): {
  subject: string;
  serializedState: string;
} {
  const { toolName, args, meta, state } = input;
  let subject = `${toolName}`;
  if (toolName === "bash") {
    subject = `bash command: ${String(args.command ?? "").trim()}`;
  } else if (Array.isArray(args.paths) && args.paths.length > 0) {
    subject = `${toolName} on paths: ${(args.paths as unknown[]).slice(0, 8).map(String).join(", ")}`;
  } else if (typeof args.path === "string" && args.path) {
    subject = `${toolName} on path: ${args.path}`;
  } else if (toolName === "kill_process") {
    subject = `kill_process pid=${String(args.pid ?? "?")} name=${String(args.name ?? "?")} signal=${String(args.signal ?? "SIGTERM")}`;
  }

  const payload = {
    os: "macOS",
    mode: input.isForeground ? "foreground_chat" : "background_automation",
    tool: toolName,
    plugin: meta?.pluginName ?? "Valet Core",
    actionId: meta?.actionId ?? toolName,
    safetyTag: meta?.safety ?? "reversible",
    subject,
    args,
    protectedDirs: state.preferences.cleanupPolicy.protectedDirs,
  };
  return {
    subject,
    serializedState: JSON.stringify(payload, null, 2),
  };
}

function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Evaluates non-trivial tool calls in `auto_review` mode using:
 * 1) TypeSafe AI Jev System One (`POST /v1/systemone`) when configured, or
 * 2) The configured fallback small LLM via `ValetModelManager.completeReviewPrompt`.
 * Always fails safe to `approved: false` (escalate to human `ask`) if unconfigured or errored.
 */
export class AutoReviewEvaluator {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly models: ValetModelManager,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  clearCache(): void {
    this.cache.clear();
  }

  private getCached(key: string): AutoReviewEvaluationResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.result;
  }

  private setCached(key: string, result: AutoReviewEvaluationResult): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  private async evaluateWithJev(
    input: AutoReviewEvaluationInput,
    cfg: AutoReviewConfig,
    endpoint: string,
    apiKey: string,
  ): Promise<AutoReviewEvaluationResult> {
    const model = resolveJevModel(cfg, endpoint);
    const { serializedState } = buildReviewSubjectSummary(input);
    const body = {
      model,
      state: serializedState,
      questions: {
        harmful: {
          type: "noul",
          instructions:
            "Could this macOS agent tool invocation cause destructive harm, unintended loss of user files/apps/configurations, or irreversible system modification that deserves human confirmation?",
          criteria: {
            false:
              "Read-only inspection, benign diagnostics, status checks, or low-risk reversible housekeeping.",
            true: "Deletes/trashes user files or apps, overwrites files, kills processes, alters system/network configs, or causes irreversible side effects.",
          },
        },
        sensitive: {
          type: "noul",
          instructions:
            "Does this action risk exposing, modifying, or exfiltrating credentials, private personal data, SSH/Keychain secrets, or security-sensitive system settings?",
        },
        untrusted: {
          type: "noul",
          instructions:
            "Does this action download, install, overwrite, or execute untrusted, remote, or dynamically generated code or binaries?",
        },
        obscured: {
          type: "noul",
          instructions:
            "Is the shell command or tool action obfuscated, encoded, indirect, or materially uncertain in its side effects?",
        },
      },
    };

    const start = Date.now();
    try {
      const resp = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(endpoint.toLowerCase().includes("openrouter.ai")
            ? {
                "HTTP-Referer": "https://valet.local",
                "X-OpenRouter-Title": "Valet",
              }
            : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
      const latencyMs = Math.max(1, Date.now() - start);
      if (!resp.ok) {
        const errText = (await resp.text().catch(() => "")).slice(0, 160);
        return {
          approved: false,
          engine: "jev",
          model,
          latencyMs,
          reason: `Auto Review (Jev) 请求失败（HTTP ${resp.status}${errText ? ` · ${errText}` : ""}），已安全回退为人工确认。`,
        };
      }

      const data = (await resp.json()) as {
        model?: string;
        answers?: Record<string, { type?: string; noul?: unknown }>;
      };
      const answers = data?.answers ?? {};
      const scores: Record<string, number> = {};
      const exceeded: string[] = [];

      for (const [qKey, threshold] of Object.entries(JEV_RISK_THRESHOLDS)) {
        const val = answers[qKey]?.noul;
        if (typeof val !== "number" || !Number.isFinite(val)) {
          return {
            approved: false,
            engine: "jev",
            model: data?.model || model,
            latencyMs,
            reason: `Auto Review (Jev) 响应缺少 ${qKey} 评分，已安全回退为人工确认。`,
          };
        }
        scores[qKey] = val;
        if (val > threshold) {
          exceeded.push(`${qKey}=${val.toFixed(2)}>${threshold.toFixed(2)}`);
        }
      }

      const resolvedModel = data?.model || model;
      if (exceeded.length === 0) {
        return {
          approved: true,
          engine: "jev",
          model: resolvedModel,
          latencyMs,
          scores,
          reason: `Auto Review (Jev · ${resolvedModel}) 判定低风险自动放行（${Object.entries(scores)
            .map(([k, v]) => `${k}=${v.toFixed(2)}`)
            .join(", ")}）`,
        };
      }

      return {
        approved: false,
        engine: "jev",
        model: resolvedModel,
        latencyMs,
        scores,
        reason: `Auto Review (Jev · ${resolvedModel}) 评估存在风险（${exceeded.join(", ")}），需经你确认后执行。`,
      };
    } catch (err) {
      return {
        approved: false,
        engine: "jev",
        model,
        latencyMs: Math.max(1, Date.now() - start),
        reason: `Auto Review (Jev) 调用异常（${err instanceof Error ? err.message : String(err)}），已安全回退为人工确认。`,
      };
    }
  }

  private async evaluateWithSmallModel(
    input: AutoReviewEvaluationInput,
    cfg: AutoReviewConfig,
  ): Promise<AutoReviewEvaluationResult> {
    const { serializedState } = buildReviewSubjectSummary(input);
    const systemPrompt = [
      "你是 macOS 智能管家 Valet 的 Auto Review 权限安全审查器（仅做风险判断，不聊天）。",
      "请判断接下来这次工具调用是否可以安全自动放行（allow），还是必须弹出权限卡片请用户人工确认（ask）。",
      "判放行 (allow) 的典型情况：",
      "- 只读探测、信息采集、进程/网络/日志状态检查、不修改系统或用户文件的常规只读命令与诊断脚本。",
      "- 明确无破坏性的只读状态查询（即使组合了多个只读步骤）。",
      "判询问 (ask) 的严格红线（宁可多问，不可漏放）：",
      "- 删除/移入废纸篓（trash_files / rm / rmdir）、卸载 /Applications/*.app、清理个人数据或配置文件。",
      "- 写入/修改/覆盖本地文件（write_file、重定向写文件、sed -i）、修改系统/网络/LaunchAgent 配置。",
      "- 终止进程（kill_process / kill / pkill / killall）、安装或卸载软件包（brew install/uninstall）。",
      "- 发送外部网络请求修改远端状态、执行模糊或不确定副作用的脚本/命令。",
      '仅输出一行合法 JSON，不要包含 Markdown 代码块或其他解释：{"decision":"allow"|"ask","risk":"low"|"medium"|"high","reason":"20字以内简短中文原因"}',
    ].join("\n");

    const res = await this.models.completeReviewPrompt(
      input.state,
      systemPrompt,
      `待审查的工具调用：\n${serializedState}`,
      cfg,
    );

    if (!res.ok) {
      return {
        approved: false,
        engine: "llm",
        model: res.modelLabel,
        latencyMs: res.latencyMs,
        reason: res.error
          ? `Auto Review (${res.error})，已转入人工确认。`
          : "Auto Review 审查小模型不可用，已安全转入人工确认。",
      };
    }

    const parsed = extractFirstJsonObject(res.text);
    const decision =
      typeof parsed?.decision === "string"
        ? parsed.decision.trim().toLowerCase()
        : "";
    const risk =
      typeof parsed?.risk === "string" ? parsed.risk.trim().toLowerCase() : "unknown";
    const reasonText =
      typeof parsed?.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "";

    if (decision === "allow") {
      return {
        approved: true,
        engine: "llm",
        model: res.modelLabel,
        latencyMs: res.latencyMs,
        reason: `Auto Review (小模型 · ${res.modelLabel}) 放行：${reasonText || "只读低风险操作"}`,
      };
    }

    if (decision === "ask") {
      return {
        approved: false,
        engine: "llm",
        model: res.modelLabel,
        latencyMs: res.latencyMs,
        reason: `Auto Review (小模型 · ${res.modelLabel} · ${risk}) 建议确认：${reasonText || "涉及敏感或变更操作"}`,
      };
    }

    return {
      approved: false,
      engine: "llm",
      model: res.modelLabel,
      latencyMs: res.latencyMs,
      reason: `Auto Review 审查小模型返回格式不可解析，已安全回退为人工确认。`,
    };
  }

  async evaluate(
    input: AutoReviewEvaluationInput,
  ): Promise<AutoReviewEvaluationResult> {
    const cfg = resolveEffectiveAutoReviewConfig(input.state, input.overrideConfig);
    const endpoint = normalizeJevEndpoint(cfg.jevEndpoint);
    const jevKey = resolveJevKey(cfg, endpoint, input.state);

    const cacheKey = JSON.stringify({
      engine: cfg.engine,
      endpoint: jevKey ? endpoint : "",
      jevModel: jevKey ? resolveJevModel(cfg, endpoint) : "",
      fallbackProvider: cfg.fallbackProviderId || input.state.preferences.activeProviderId,
      fallbackModel:
        cfg.fallbackModel === "同快速模型"
          ? input.state.preferences.models.fast
          : cfg.fallbackModel,
      tool: input.toolName,
      args: input.args,
    });

    if (!input.bypassCache) {
      const cached = this.getCached(cacheKey);
      if (cached) return cached;
    }

    let result: AutoReviewEvaluationResult;
    if (cfg.engine === "jev") {
      if (!jevKey) {
        result = {
          approved: false,
          engine: "none",
          model: resolveJevModel(cfg, endpoint),
          latencyMs: 0,
          reason: "Auto Review 已设为「仅 Jev System One」，但尚未配置 Jev API Key，已转入人工确认。",
        };
      } else {
        result = await this.evaluateWithJev(input, cfg, endpoint, jevKey);
      }
    } else if (cfg.engine === "llm") {
      result = await this.evaluateWithSmallModel(input, cfg);
    } else {
      // engine === "auto": use Jev System One when configured, otherwise fall back to configured small LLM
      if (jevKey) {
        result = await this.evaluateWithJev(input, cfg, endpoint, jevKey);
      } else {
        result = await this.evaluateWithSmallModel(input, cfg);
      }
    }

    if (!input.bypassCache && (result.engine !== "none" || result.approved)) {
      this.setCached(cacheKey, result);
    }
    return result;
  }

  async testConnection(
    cfg: AutoReviewConfig,
    state: ValetSyncState,
  ): Promise<{ ok: boolean; reply: string; latencyMs: number }> {
    const mergedCfg = resolveEffectiveAutoReviewConfig(state, cfg);
    const endpoint = normalizeJevEndpoint(mergedCfg.jevEndpoint);
    const jevKey = resolveJevKey(mergedCfg, endpoint, state);

    if (mergedCfg.engine === "jev" && !jevKey) {
      return {
        ok: false,
        latencyMs: 0,
        reply: "当前策略为「仅 Jev System One」，请先输入 Jev (或 OpenRouter) API Key。",
      };
    }

    const res = await this.evaluate({
      toolName: "bash",
      args: {
        command: "ls -la ~/Downloads && pgrep -ifl Finder",
        reason: "只读检查下载目录与 Finder 运行状态（Auto Review 连通性探针）",
      },
      meta: {
        toolName: "bash",
        pluginId: "valet-core",
        pluginName: "Valet Core",
        actionId: "shell.bash",
        eventCode: "system.command",
        safety: "reversible",
        checklistKey: "runTerminalCommand",
        category: "process",
        iconKind: "pulse",
        reversible7d: false,
        approveLabel: "批准执行",
        dismissLabel: "拒绝",
      },
      state,
      isForeground: true,
      overrideConfig: mergedCfg,
      bypassCache: true,
    });

    if (res.engine === "none" || res.model === "unconfigured") {
      return {
        ok: false,
        latencyMs: res.latencyMs,
        reply: res.reason,
      };
    }

    if (
      res.reason.includes("请求失败") ||
      res.reason.includes("调用异常") ||
      res.reason.includes("缺少") ||
      res.reason.includes("不可用") ||
      res.reason.includes("未配置有效的") ||
      res.reason.includes("不可解析")
    ) {
      return {
        ok: false,
        latencyMs: res.latencyMs,
        reply: res.reason,
      };
    }

    const modeTag =
      res.engine === "jev"
        ? `Jev System One (${res.model})`
        : mergedCfg.engine === "auto"
          ? `未配置 Jev Key · 已回退审查小模型 (${res.model})`
          : `审查小模型 (${res.model})`;
    return {
      ok: true,
      latencyMs: res.latencyMs,
      reply: `${modeTag} 连通正常（${res.latencyMs}ms）· 探针结果：${res.approved ? "allow" : "ask"} · ${res.reason}`,
    };
  }
}
