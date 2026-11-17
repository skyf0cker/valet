import {
  type AssistantMessage,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type Model,
  type MutableModels,
  type Provider,
  type ToolResultMessage,
  type TranscriptContext,
  type UserMessage,
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelRef } from "@earendil-works/pi-durable";
import type { AgentProviderConfig, ValetSyncState } from "./protocol.ts";

class InMemoryCredentialStore implements CredentialStore {
  private readonly store = new Map<string, Credential>();

  async read(providerId: string): Promise<Credential | undefined> {
    return this.store.get(providerId);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [...this.store.entries()].map(([providerId, cred]) => ({
      providerId,
      type: cred.type,
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const next = await fn(this.store.get(providerId));
    if (next === undefined) return this.store.get(providerId);
    this.store.set(providerId, next);
    return next;
  }

  async delete(providerId: string): Promise<void> {
    this.store.delete(providerId);
  }

  setApiKeyDirect(providerId: string, apiKey: string): void {
    this.store.set(providerId, { type: "api_key", key: apiKey });
  }

  deleteDirect(providerId: string): void {
    this.store.delete(providerId);
  }
}

function toPiProviderId(providerId: string): string {
  if (providerId === "gemini") return "google";
  return providerId;
}

function isMockOrEmptyKey(cfg: AgentProviderConfig): boolean {
  if (cfg.id === "ollama") return !(cfg.connected || cfg.verified);
  if (cfg.id === "custom") {
    return !Boolean(cfg.baseUrl?.trim() || cfg.endpoint?.trim());
  }
  const k = cfg.apiKey.trim();
  if (!k) return true;
  if (k.includes("-mock-")) return true;
  return false;
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().trim();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h === "0.0.0.0" ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    h.startsWith("172.")
  );
}

function normalizeBaseUrl(raw: string, defaultScheme?: "http" | "https"): string {
  let s = raw.trim();
  if (!s) return "";
  if (!s.startsWith("http://") && !s.startsWith("https://")) {
    const hostPort = s.split("/", 1)[0] ?? "";
    const host = hostPort.split(":", 1)[0] ?? "";
    const scheme = defaultScheme ?? (isLocalHost(host) ? "http" : "https");
    s = `${scheme}://${s}`;
  }
  s = s.replace(/\/+$/, "");
  for (const suffix of ["/chat/completions", "/completions", "/messages", "/responses"]) {
    if (s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length).replace(/\/+$/, "");
      break;
    }
  }
  return s;
}

function hasVersionPath(base: string): boolean {
  return /\/v\d+(beta)?$/i.test(base);
}

function buildOpenAICompatModel(
  id: string,
  provider: string,
  baseUrl: string,
): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider,
    baseUrl,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  };
}

function extractUserText(content: UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function extractToolText(msg: ToolResultMessage): string {
  return msg.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function parseTrailingJson(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  try {
    return JSON.parse(text.slice(start)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Generates deterministic multi-turn tool-calling & synthesis turns for Valet's local
 * steward fallback provider when no live cloud API key is configured.
 */
function buildLocalStewardMessage(
  context: TranscriptContext,
  availableTools: ReadonlySet<string>,
): AssistantMessage {
  const msgs = context.messages;
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  const userMsg = lastUserIdx >= 0 ? (msgs[lastUserIdx] as UserMessage) : undefined;
  const prompt = userMsg ? extractUserText(userMsg.content).trim() : "";
  const lower = prompt.toLowerCase();
  const sinceUser = lastUserIdx >= 0 ? msgs.slice(lastUserIdx + 1) : msgs;
  const toolResults = sinceUser.filter(
    (m): m is ToolResultMessage => m.role === "toolResult",
  );

  // Event-driven trigger turns from Host / Plugin Simulator / Watchers
  if (prompt.startsWith("[EVENT_TRIGGER ")) {
    const pluginMatch = prompt.match(/plugin=([^\s\]]+)/);
    const eventMatch = prompt.match(/event=([^\s\]]+)/);
    const pluginId = pluginMatch?.[1] ?? "";
    const eventCode = eventMatch?.[1] ?? "";

    if (toolResults.length === 0) {
      if (pluginId === "disk-guard" || eventCode.startsWith("disk.")) {
        return fauxAssistantMessage(
          [
            fauxThinking("收到磁盘守卫事件，先执行只读磁盘扫描以确认安全候选路径。"),
            fauxToolCall("disk_scan", {
              scope: "all",
              minSizeMB: 2048,
              idleDays: 90,
            }),
          ],
          { stopReason: "toolUse" },
        );
      }
      if (pluginId === "process-sentinel" || eventCode.startsWith("process.")) {
        return fauxAssistantMessage(
          [
            fauxThinking("收到进程哨兵事件，先采样高占用进程列表。"),
            fauxToolCall("process_sample", { limit: 5 }),
          ],
          { stopReason: "toolUse" },
        );
      }
      if (pluginId === "uninstall-scrubber" || eventCode.startsWith("app.")) {
        return fauxAssistantMessage(
          [
            fauxThinking("收到卸载清道夫事件，扫描应用残留目录。"),
            fauxToolCall("app_scan_remnants", {}),
          ],
          { stopReason: "toolUse" },
        );
      }
      if (pluginId === "log-detective" || eventCode.startsWith("log.")) {
        return fauxAssistantMessage(
          [
            fauxThinking("收到日志侦探事件，读取诊断崩溃日志摘要。"),
            fauxToolCall("log_summarize_crashes", { minutes: 60 }),
          ],
          { stopReason: "toolUse" },
        );
      }
      return fauxAssistantMessage(
        [
          fauxThinking("先读取当前系统概览以响应插件事件。"),
          fauxToolCall("system_overview", {}),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (
      toolResults.length === 1 &&
      toolResults[0]?.toolName === "disk_scan" &&
      !toolResults[0].isError
    ) {
      const scanJson = parseTrailingJson(extractToolText(toolResults[0]));
      const candidates = Array.isArray(scanJson?.cleanablePaths)
        ? (scanJson.cleanablePaths as string[]).slice(0, 4)
        : [];
      const totalGB = Number(scanJson?.estimatedReclaimableGB ?? 0);
      if (candidates.length > 0) {
        return fauxAssistantMessage(
          [
            fauxThinking("已扫描到安全候选路径，按策略提交移入废纸篓动作。"),
            fauxToolCall("disk_move_to_trash", {
              paths: candidates,
              estimatedGB: totalGB,
              reason: `响应事件 ${eventCode} 的安全清理候选`,
            }),
          ],
          { stopReason: "toolUse" },
        );
      }
    }

    const lastResult = toolResults[toolResults.length - 1];
    const lastText = lastResult ? extractToolText(lastResult) : "";
    if (lastText.includes("NEEDS_APPROVAL")) {
      return fauxAssistantMessage(
        `已响应事件 \`${eventCode}\` 并完成只读扫描，涉及写操作的安全清单已提交至**收件箱**等待你批准。`,
      );
    }
    return fauxAssistantMessage(
      `已处理事件 \`${eventCode}\`：\n\n${lastText.split("\n")[0] ?? "完成检查"}。`,
    );
  }

  // Interactive User Chat Intents
  const isCleanIntent =
    lower.startsWith("/clean") ||
    lower.includes("大文件") ||
    lower.includes("清理") ||
    lower.includes("磁盘");
  const isProcessIntent =
    lower.startsWith("/ps") ||
    lower.startsWith("/scan") ||
    lower.includes("cpu") ||
    lower.includes("进程") ||
    lower.includes("卡") ||
    lower.includes("慢");
  const isPluginIntent =
    lower.startsWith("/plugin") ||
    lower.includes("插件") ||
    lower.includes("规则") ||
    lower.includes(".dmg") ||
    lower.includes("截图");
  const isOrphanIntent = lower.includes("卸载") || lower.includes("残留");
  const isLogIntent =
    lower.includes("日志") || lower.includes("崩溃") || lower.includes("crash");
  const isMemoryIntent = lower.startsWith("记住") || lower.includes("记住");

  // Turn 1: dispatch first diagnostic / steward tool call
  if (toolResults.length === 0) {
    if (isPluginIntent) {
      const isDmg = lower.includes(".dmg") || lower.includes("dmg");
      return fauxAssistantMessage(
        [
          fauxThinking("分析用户自动化规则意图，起草可执行 YAML 插件 manifest。"),
          fauxToolCall("plugin_draft_create", {
            name: isDmg ? "下载 .dmg 清扫器" : "桌面截图归档器",
            slug: isDmg ? "dmg-cleaner" : "screenshot-archiver",
            eventCode: "fs.file_created",
            glob: isDmg ? "~/Downloads/*.dmg" : "~/Desktop/截屏*.png",
            actionId: isDmg ? "move_to_trash" : "move_to",
            ...(isDmg
              ? { condition: "app_installed_from(dmg)" }
              : { targetPath: "~/Pictures/Screenshots" }),
          }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isCleanIntent) {
      if (!availableTools.has("disk_scan")) {
        return fauxAssistantMessage(
          "当前「磁盘守卫 (`disk-guard`)」插件处于停用状态，未挂载 `disk_scan` 传感器与清理工具。请前往 **插件** 页面启用「磁盘守卫」后重试。",
        );
      }
      return fauxAssistantMessage(
        [
          fauxThinking("先通过 disk_scan 对用户缓存与超过 90 天未访问的大文件执行只读安全扫描（避开受保护目录）。"),
          fauxToolCall("disk_scan", {
            scope: "all",
            minSizeMB: 2048,
            idleDays: 90,
          }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isProcessIntent) {
      if (!availableTools.has("process_sample")) {
        return fauxAssistantMessage(
          "当前「进程哨兵 (`process-sentinel`)」插件已停用，未挂载 `process_sample` 工具。启用后即可采样实时进程。",
        );
      }
      return fauxAssistantMessage(
        [
          fauxThinking("采样当前 macOS 高 CPU / 内存进程，定位异常占用源。"),
          fauxToolCall("process_sample", { limit: 5 }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isOrphanIntent) {
      if (!availableTools.has("app_scan_remnants")) {
        return fauxAssistantMessage(
          "当前「卸载清道夫 (`uninstall-scrubber`)」插件已停用，启用后即可扫描残留目录。",
        );
      }
      return fauxAssistantMessage(
        [
          fauxThinking("扫描已移除应用在 ~/Library 留下的孤儿支持目录与缓存。"),
          fauxToolCall("app_scan_remnants", {}),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isLogIntent) {
      if (!availableTools.has("log_summarize_crashes")) {
        return fauxAssistantMessage(
          "当前「日志侦探 (`log-detective`)」插件尚未启用，前往 **插件** 启用即可读取崩溃报告。",
        );
      }
      return fauxAssistantMessage(
        [
          fauxThinking("读取 DiagnosticReports 下近期崩溃报告，汇总高频异常进程。"),
          fauxToolCall("log_summarize_crashes", { minutes: 120 }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isMemoryIntent) {
      return fauxAssistantMessage(
        [
          fauxThinking("将用户明确的偏好习惯写入本地持久化记忆。"),
          fauxToolCall("memory_remember", {
            content: prompt.replace(/^记住[：:\s]*/, "") || prompt,
            source: "对话学习",
          }),
        ],
        { stopReason: "toolUse" },
      );
    }

    return fauxAssistantMessage(
      [
        fauxThinking("先读取当前实时系统指标与在岗插件状态，准备管家回复。"),
        fauxToolCall("system_overview", {}),
      ],
      { stopReason: "toolUse" },
    );
  }

  // Turn 2 for /clean: propose moving scanned candidates to Trash -> intercepted by Safety Hook!
  if (
    isCleanIntent &&
    toolResults.length === 1 &&
    toolResults[0]?.toolName === "disk_scan"
  ) {
    const scanData = parseTrailingJson(extractToolText(toolResults[0]));
    const candidates = Array.isArray(scanData?.cleanablePaths)
      ? (scanData.cleanablePaths as string[]).slice(0, 4)
      : [];
    const totalGB = Number(scanData?.estimatedReclaimableGB ?? 0);

    if (candidates.length > 0) {
      return fauxAssistantMessage(
        [
          fauxThinking("扫描发现可安全释放候选文件，调用 disk_move_to_trash 提交安全审核链路。"),
          fauxToolCall("disk_move_to_trash", {
            paths: candidates,
            estimatedGB: totalGB,
            reason: `扫描到 ${candidates.length} 项安全可清理缓存/闲置文件（预计释放 ${totalGB} GB），移入废纸篓且 7 天内可还原。`,
          }),
        ],
        { stopReason: "toolUse" },
      );
    }
  }

  // Final synthesis turn from actual committed tool results
  const latest = toolResults[toolResults.length - 1];
  const rawText = latest ? extractToolText(latest) : "";
  const parsed = parseTrailingJson(rawText);

  if (latest?.toolName === "plugin_draft_create") {
    return fauxAssistantMessage(
      `已按你的描述通过 \`plugin_draft_create\` 起草了可热加载的本地 YAML 插件规则，点击右侧**安装**即可写入 Valet 并同步加载到 Agent 插件注册表。`,
    );
  }

  if (latest?.toolName === "process_sample") {
    const rows = Array.isArray(parsed?.rows)
      ? (parsed.rows as Array<{ name: string; cpuPct: number; memLabel: string }>)
      : [];
    const top = rows[0];
    const summary = top
      ? `已完成实时进程采样：当前最高占用进程为 \`${top.name}\`（CPU **${top.cpuPct}%** · 内存 ${top.memLabel}），系统整体 CPU ${String(parsed?.cpuPct ?? "--")}%、内存 ${String(parsed?.memPct ?? "--")}%。你可以直接点击下方表格操作，或让我将特定规则加入自动策略。`
      : "已完成当前系统进程采样，未发现明显失控的高 CPU 进程。";
    return fauxAssistantMessage(summary);
  }

  if (isCleanIntent) {
    const scanRes = parseTrailingJson(extractToolText(toolResults[0]!));
    const totalGB = Number(scanRes?.estimatedReclaimableGB ?? 0);
    const itemsCount = Array.isArray(scanRes?.items) ? scanRes.items.length : 0;
    if (rawText.includes("NEEDS_APPROVAL")) {
      return fauxAssistantMessage(
        `已完成安全只读磁盘扫描：共发现 **${itemsCount} 项**可清理目标（预计可释放 **${totalGB} GB**，已严格避开受保护目录）。按照安全策略，已将确认清单推送到**收件箱**与**时间线**，确认后才会移入废纸篓（7 天内可一键还原）。`,
      );
    }
    return fauxAssistantMessage(
      itemsCount > 0
        ? `已扫描发现 **${itemsCount} 项**可清理目标（预计 **${totalGB} GB**），并已按当前自动策略安全移入废纸篓。`
        : "刚刚按阈值扫描了常用缓存与下载目录，已避开受保护路径，暂未发现超阈值可清理目标。",
    );
  }

  if (latest?.toolName === "app_scan_remnants") {
    const remnants = Array.isArray(parsed?.remnants) ? parsed.remnants.length : 0;
    return fauxAssistantMessage(
      remnants > 0
        ? `卸载残留扫描完成，共发现 ${remnants} 项疑似孤儿应用残留目录；涉及关键登录配置已自动排除默认勾选。`
        : "已扫描 `~/Library/Caches` 与 `Application Support`，暂未检测到明显孤儿应用残留。",
    );
  }

  if (latest?.toolName === "log_summarize_crashes") {
    const count = Number(parsed?.count ?? 0);
    return fauxAssistantMessage(
      count > 0
        ? `已读取 \`~/Library/Logs/DiagnosticReports\`，近期发现 **${count} 份**诊断/崩溃报告：${String(parsed?.summary ?? "")}`
        : "已检查 `~/Library/Logs/DiagnosticReports`，近期未发现新的系统或应用崩溃日志。",
    );
  }

  if (latest?.toolName === "memory_remember") {
    return fauxAssistantMessage(rawText || "已记住该偏好设置。");
  }

  // General system overview answer
  const diskPct = parsed?.diskPct ?? "--";
  const diskFreeGB = parsed?.diskFreeGB ?? "--";
  const cpuPct = parsed?.cpuPct ?? "--";
  const memPct = parsed?.memPct ?? "--";
  const enabledCount = parsed?.enabledPlugins ?? "--";
  return fauxAssistantMessage(
    `当前 Mac 状态概览：磁盘已用 **${diskPct}%**（可用 **${diskFreeGB} GB**），CPU **${cpuPct}%**，内存 **${memPct}%**，共有 **${enabledCount}** 个插件在岗运行。\n\n你可以直接让我诊断问题，或输入 \`/ps\`（采样进程）、\`/clean\`（扫描清理）、\`/plugin\`（起草自动化插件）。`,
  );
}

/**
 * Coordinates Pi AI `Models`, credentials, dynamic OpenAI-compatible endpoints,
 * and the durable local steward fallback provider.
 */
export class ValetModelManager {
  readonly credStore = new InMemoryCredentialStore();
  readonly models: MutableModels;
  private readonly fauxCore: ReturnType<typeof createFauxCore>;
  private readonly localProvider: Provider;
  private providerConfigs: AgentProviderConfig[] = [];
  private getAvailableToolNames: () => ReadonlySet<string> = () => new Set();
  private readonly initialProxyEnv = {
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
  };

  setAvailableToolProvider(fn: () => ReadonlySet<string>): void {
    this.getAvailableToolNames = fn;
  }

  constructor() {
    this.models = createModels({
      credentials: this.credStore,
      identity: {
        userAgent: { custom: "Valet/0.1.0" },
        attribution: { name: "Valet", url: "https://valet.local" },
      },
    });

    this.fauxCore = createFauxCore({
      provider: "valet-local",
      tokensPerSecond: 180,
      tokenSize: { min: 4, max: 8 },
      models: [
        {
          id: "valet-steward-local",
          name: "Valet Steward (Local)",
          reasoning: true,
          input: ["text", "image"],
        },
      ],
    });

    const core = this.fauxCore;
    this.localProvider = createProvider({
      id: "valet-local",
      name: "Valet Local Steward",
      auth: { apiKey: { name: "Local", resolve: async () => ({ auth: {} }) } },
      models: core.models,
      api: {
        stream: (m, ctx, opts) => {
          if (core.getPendingResponseCount() === 0) {
            core.appendResponses([
              async (c) => buildLocalStewardMessage(c, this.getAvailableToolNames()),
            ]);
          }
          return core.stream(m, ctx, opts);
        },
        streamSimple: (m, ctx, opts) => {
          if (core.getPendingResponseCount() === 0) {
            core.appendResponses([
              async (c) => buildLocalStewardMessage(c, this.getAvailableToolNames()),
            ]);
          }
          return core.streamSimple(m, ctx, opts);
        },
      },
    });

    this.models.setProvider(this.localProvider);
    this.models.setProvider(anthropicProvider());
    this.models.setProvider(openaiProvider());
    this.models.setProvider(googleProvider());
    this.models.setProvider(openrouterProvider());
  }

  private applyProxyForProvider(cfg?: AgentProviderConfig): void {
    const raw = cfg?.proxyUrl?.trim();
    if (raw) {
      const normalized = normalizeBaseUrl(raw, "http");
      process.env.HTTP_PROXY = normalized;
      process.env.HTTPS_PROXY = normalized;
      process.env.http_proxy = normalized;
      process.env.https_proxy = normalized;
      return;
    }
    for (const [k, v] of Object.entries(this.initialProxyEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  /** Registers an explicit scripted response handler for deterministic testing. */
  setLocalStewardScript(
    steps: Parameters<ReturnType<typeof createFauxCore>["setResponses"]>[0],
  ): void {
    this.fauxCore.setResponses(steps);
  }

  syncProviders(configs: AgentProviderConfig[], activeProviderId?: string): void {
    this.providerConfigs = configs;
    const activeCfg =
      (activeProviderId
        ? configs.find((c) => c.id === activeProviderId)
        : undefined) ?? configs.find((c) => c.connected);
    this.applyProxyForProvider(activeCfg);

    for (const cfg of configs) {
      const piId = toPiProviderId(cfg.id);
      const trimmedKey = cfg.apiKey?.trim() ?? "";
      if (trimmedKey && !trimmedKey.includes("-mock-")) {
        this.credStore.setApiKeyDirect(piId, trimmedKey);
      } else if (cfg.id !== "ollama" && cfg.id !== "custom") {
        this.credStore.deleteDirect(piId);
      }

      if (cfg.id === "openrouter") {
        let normalizedBase = normalizeBaseUrl(
          cfg.baseUrl || cfg.endpoint || "https://openrouter.ai/api/v1",
          "https",
        );
        try {
          const parsed = new URL(normalizedBase);
          if (parsed.hostname.includes("openrouter.ai")) {
            if (parsed.pathname === "" || parsed.pathname === "/") {
              normalizedBase += "/api/v1";
            } else if (parsed.pathname === "/api") {
              normalizedBase += "/v1";
            }
          }
        } catch {
          // Keep normalizedBase as-is if URL parsing fails
        }

        const base = openrouterProvider();
        const baselineMap = new Map<string, Model<"openai-completions">>();
        for (const m of base.getModels()) {
          if (m.id.startsWith("~") || baselineMap.has(m.id)) continue;
          baselineMap.set(m.id, {
            ...m,
            api: "openai-completions",
            provider: "openrouter",
            baseUrl: normalizedBase,
          });
        }

        const merged: Model<"openai-completions">[] = [];
        const seen = new Set<string>();
        for (const rawId of cfg.models) {
          const id = rawId.trim();
          if (!id || id.startsWith("~") || seen.has(id)) continue;
          seen.add(id);
          merged.push(
            baselineMap.get(id) ??
              buildOpenAICompatModel(id, "openrouter", normalizedBase),
          );
        }
        for (const [id, m] of baselineMap) {
          if (!seen.has(id)) {
            seen.add(id);
            merged.push(m);
          }
        }

        this.models.setProvider(
          createProvider<"openai-completions">({
            id: "openrouter",
            name: cfg.name || "OpenRouter",
            baseUrl: normalizedBase,
            auth: {
              apiKey: {
                name: "OpenRouter API key",
                resolve: async ({ credential }) => {
                  const key =
                    credential?.type === "api_key" && credential.key
                      ? credential.key
                      : process.env.OPENROUTER_API_KEY?.trim();
                  if (!key) return undefined;
                  return { auth: { apiKey: key, baseUrl: normalizedBase } };
                },
              },
            },
            models: merged,
            api: openAICompletionsApi(),
          }),
        );
        continue;
      }

      if (cfg.id === "anthropic") {
        let normalizedBase = normalizeBaseUrl(
          cfg.baseUrl || cfg.endpoint || "https://api.anthropic.com",
          "https",
        );
        if (normalizedBase.endsWith("/v1")) {
          normalizedBase = normalizedBase.slice(0, -3).replace(/\/+$/, "");
        }

        const base = anthropicProvider();
        const baselineMap = new Map<string, Model<"anthropic-messages">>();
        for (const m of base.getModels()) {
          if (m.id.startsWith("~") || baselineMap.has(m.id)) continue;
          baselineMap.set(m.id, {
            ...m,
            provider: "anthropic",
            baseUrl: normalizedBase,
          });
        }

        const merged: Model<"anthropic-messages">[] = [];
        const seen = new Set<string>();
        for (const rawId of cfg.models) {
          const id = rawId.trim();
          if (!id || id.startsWith("~") || seen.has(id)) continue;
          seen.add(id);
          merged.push(
            baselineMap.get(id) ?? {
              id,
              name: id,
              api: "anthropic-messages",
              provider: "anthropic",
              baseUrl: normalizedBase,
              reasoning: true,
              input: ["text", "image"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200_000,
              maxTokens: 16_384,
            },
          );
        }
        for (const [id, m] of baselineMap) {
          if (!seen.has(id)) {
            seen.add(id);
            merged.push(m);
          }
        }

        this.models.setProvider(
          createProvider<"anthropic-messages">({
            id: "anthropic",
            name: cfg.name || base.name,
            baseUrl: normalizedBase,
            headers: base.headers,
            auth: base.auth,
            models: merged,
            api: anthropicMessagesApi(),
          }),
        );
        continue;
      }

      if (cfg.id === "gemini") {
        let normalizedBase = normalizeBaseUrl(
          cfg.baseUrl || cfg.endpoint || "https://generativelanguage.googleapis.com/v1beta",
          "https",
        );
        if (!normalizedBase.endsWith("/v1beta") && !normalizedBase.endsWith("/v1")) {
          normalizedBase = `${normalizedBase}/v1beta`;
        }

        const base = googleProvider();
        const baselineMap = new Map<string, Model<"google-generative-ai">>();
        for (const m of base.getModels()) {
          if (m.id.startsWith("~") || baselineMap.has(m.id)) continue;
          baselineMap.set(m.id, {
            ...m,
            provider: "google",
            baseUrl: normalizedBase,
          });
        }

        const merged: Model<"google-generative-ai">[] = [];
        const seen = new Set<string>();
        for (const rawId of cfg.models) {
          const id = rawId.trim().replace(/^models\//, "");
          if (!id || id.startsWith("~") || seen.has(id)) continue;
          seen.add(id);
          merged.push(
            baselineMap.get(id) ?? {
              id,
              name: id,
              api: "google-generative-ai",
              provider: "google",
              baseUrl: normalizedBase,
              reasoning: true,
              input: ["text", "image"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1_048_576,
              maxTokens: 65_536,
            },
          );
        }
        for (const [id, m] of baselineMap) {
          if (!seen.has(id)) {
            seen.add(id);
            merged.push(m);
          }
        }

        this.models.setProvider(
          createProvider<"google-generative-ai">({
            id: "google",
            name: cfg.name || base.name,
            baseUrl: normalizedBase,
            headers: base.headers,
            auth: base.auth,
            models: merged,
            api: googleGenerativeAIApi(),
          }),
        );
        continue;
      }

      if (cfg.id === "openai") {
        let normalizedBase = normalizeBaseUrl(
          cfg.baseUrl || cfg.endpoint || "https://api.openai.com/v1",
          "https",
        );
        if (!hasVersionPath(normalizedBase)) {
          normalizedBase = `${normalizedBase}/v1`;
        }
        const base = openaiProvider();
        const customHeaders = cfg.orgId?.trim()
          ? { ...(base.headers ?? {}), "OpenAI-Organization": cfg.orgId.trim() }
          : base.headers;
        const isOfficial = normalizedBase === "https://api.openai.com/v1";

        if (!isOfficial) {
          const list =
            cfg.models.length > 0 ? cfg.models : ["gpt-4.1", "gpt-4.1-mini"];
          const compatModels: Model<"openai-completions">[] = [];
          const seen = new Set<string>();
          for (const rawId of list) {
            const id = rawId.trim();
            if (!id || id.startsWith("~") || seen.has(id)) continue;
            seen.add(id);
            compatModels.push(
              buildOpenAICompatModel(id, "openai", normalizedBase),
            );
          }
          this.models.setProvider(
            createProvider<"openai-completions">({
              id: "openai",
              name: cfg.name || base.name,
              baseUrl: normalizedBase,
              headers: customHeaders,
              auth: base.auth,
              models: compatModels,
              api: openAICompletionsApi(),
            }),
          );
          continue;
        }

        const baselineMap = new Map<string, Model<"openai-responses">>();
        for (const m of base.getModels()) {
          if (m.id.startsWith("~") || baselineMap.has(m.id)) continue;
          baselineMap.set(m.id, {
            ...m,
            provider: "openai",
            baseUrl: normalizedBase,
          });
        }

        const merged: Model<"openai-responses" | "openai-completions">[] = [];
        const seen = new Set<string>();
        for (const rawId of cfg.models) {
          const id = rawId.trim();
          if (!id || id.startsWith("~") || seen.has(id)) continue;
          seen.add(id);
          merged.push(
            baselineMap.get(id) ??
              buildOpenAICompatModel(id, "openai", normalizedBase),
          );
        }
        for (const [id, m] of baselineMap) {
          if (!seen.has(id)) {
            seen.add(id);
            merged.push(m);
          }
        }

        this.models.setProvider(
          createProvider<"openai-responses" | "openai-completions">({
            id: "openai",
            name: cfg.name || base.name,
            baseUrl: normalizedBase,
            headers: customHeaders,
            auth: base.auth,
            models: merged,
            api: {
              "openai-responses": openAIResponsesApi(),
              "openai-completions": openAICompletionsApi(),
            },
          }),
        );
        continue;
      }

      if (cfg.id === "ollama" || cfg.id === "custom") {
        const rawBase =
          cfg.id === "ollama"
            ? cfg.baseUrl || cfg.endpoint || "http://localhost:11434"
            : cfg.baseUrl || cfg.endpoint || "http://localhost:1234";
        let normalizedBase = normalizeBaseUrl(
          rawBase,
          cfg.id === "ollama" ? "http" : undefined,
        );
        if (!hasVersionPath(normalizedBase)) {
          normalizedBase = `${normalizedBase}/v1`;
        }
        const dynamicModels: Model<"openai-completions">[] = (
          cfg.models.length > 0 ? cfg.models : ["custom-reasoning"]
        )
          .map((id) => id.trim())
          .filter((id) => id.length > 0 && !id.startsWith("~"))
          .map((id) => buildOpenAICompatModel(id, piId, normalizedBase));

        this.credStore.setApiKeyDirect(
          piId,
          trimmedKey || (cfg.id === "ollama" ? "ollama" : "custom"),
        );

        this.models.setProvider(
          createProvider<"openai-completions">({
            id: piId,
            name: cfg.name,
            baseUrl: normalizedBase,
            auth: {
              apiKey: {
                name: `${cfg.name} key`,
                resolve: async ({ credential }) => ({
                  auth: {
                    apiKey:
                      credential?.type === "api_key" && credential.key
                        ? credential.key
                        : cfg.id === "ollama"
                          ? "ollama"
                          : "custom",
                    baseUrl: normalizedBase,
                  },
                }),
              },
            },
            models: dynamicModels,
            api: openAICompletionsApi(),
          }),
        );
      }
    }
  }

  /**
   * Resolves the UI-requested model & active provider to a valid registered Pi AI ModelRef.
   * Falls back to `valet-local/valet-steward-local` when no live credential is configured.
   */
  resolveModelRef(requestedModelId: string, state: ValetSyncState): {
    ref: ModelRef;
    usingLocalFallback: boolean;
  } {
    const activeProvider = this.providerConfigs.find(
      (p) => p.id === state.preferences.activeProviderId,
    );
    if (!activeProvider || isMockOrEmptyKey(activeProvider)) {
      return {
        ref: { provider: "valet-local", modelId: "valet-steward-local" },
        usingLocalFallback: true,
      };
    }

    const piId = toPiProviderId(activeProvider.id);
    const catalog = this.models
      .getModels(piId)
      .filter((m) => !m.id.startsWith("~"));
    if (catalog.length === 0) {
      return {
        ref: { provider: "valet-local", modelId: "valet-steward-local" },
        usingLocalFallback: true,
      };
    }

    const exact = catalog.find((m) => m.id === requestedModelId);
    if (exact) {
      return {
        ref: { provider: piId, modelId: exact.id },
        usingLocalFallback: false,
      };
    }

    const normalized = requestedModelId.replace(/^[^/]+\//, "");
    const normalizedExact = catalog.find((m) => m.id === normalized);
    if (normalizedExact) {
      return {
        ref: { provider: piId, modelId: normalizedExact.id },
        usingLocalFallback: false,
      };
    }

    for (const configuredId of activeProvider.models) {
      const configuredMatch = catalog.find((m) => m.id === configuredId);
      if (configuredMatch) {
        return {
          ref: { provider: piId, modelId: configuredMatch.id },
          usingLocalFallback: false,
        };
      }
    }

    const prefixMatch = catalog.find(
      (m) =>
        m.id.startsWith(normalized) ||
        m.id.startsWith(requestedModelId) ||
        m.id.includes(normalized),
    );
    if (prefixMatch) {
      return {
        ref: { provider: piId, modelId: prefixMatch.id },
        usingLocalFallback: false,
      };
    }

    return {
      ref: { provider: piId, modelId: catalog[0]!.id },
      usingLocalFallback: false,
    };
  }

  /** Executes a live 1-turn completion test against a configured provider & model. */
  async testProvider(
    provider: AgentProviderConfig,
    requestedModel: string,
  ): Promise<{ ok: boolean; reply: string; latencyMs: number }> {
    const trimmedModel = requestedModel.trim();
    const candidateModels =
      trimmedModel && !provider.models.includes(trimmedModel)
        ? [trimmedModel, ...provider.models]
        : provider.models;
    const candidate: AgentProviderConfig = {
      ...provider,
      models: candidateModels,
      connected: true,
      verified: true,
    };
    if (isMockOrEmptyKey(candidate)) {
      return {
        ok: false,
        latencyMs: 0,
        reply: "请先输入有效的 API Key 或 Ollama / 自定义 Endpoint 后再测试真模型对话。",
      };
    }

    this.syncProviders(
      [
        ...this.providerConfigs.filter((p) => p.id !== candidate.id),
        candidate,
      ],
      candidate.id,
    );

    const piId = toPiProviderId(candidate.id);
    const catalog = this.models
      .getModels(piId)
      .filter((m) => !m.id.startsWith("~"));
    const model =
      (trimmedModel
        ? catalog.find((m) => m.id === trimmedModel) ??
          catalog.find((m) => m.id.includes(trimmedModel))
        : undefined) ?? catalog[0];

    if (!model) {
      return {
        ok: false,
        latencyMs: 0,
        reply: `未在服务商 ${provider.name} 中找到可用模型 ${requestedModel}`,
      };
    }

    const start = Date.now();
    try {
      const msg = await this.models.completeSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: "请用简短中文回复一句话确认连通性，并说明当前模型 ID。",
              timestamp: Date.now(),
            },
          ],
        },
        { maxTokens: 120, signal: AbortSignal.timeout(15_000) },
      );
      const replyText = msg.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
        .trim();
      const latencyMs = Math.max(1, Date.now() - start);
      if (msg.stopReason === "error" || msg.errorMessage) {
        return {
          ok: false,
          latencyMs,
          reply: `调用失败：${msg.errorMessage || "未知上游错误"}`,
        };
      }
      return {
        ok: true,
        latencyMs,
        reply: replyText || `已收到 ${model.provider}/${model.id} 响应（${latencyMs}ms）。`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Math.max(1, Date.now() - start),
        reply: `请求失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
