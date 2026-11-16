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
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
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
}

function isMockOrEmptyKey(cfg: AgentProviderConfig): boolean {
  if (cfg.id === "ollama") return !cfg.connected;
  const k = cfg.apiKey.trim();
  if (!k) return true;
  if (k.includes("-mock-")) return true;
  return !cfg.connected;
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
      return fauxAssistantMessage(
        [
          fauxThinking("采样当前 macOS 高 CPU / 内存进程，定位异常占用源。"),
          fauxToolCall("process_sample", { limit: 5 }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isOrphanIntent) {
      return fauxAssistantMessage(
        [
          fauxThinking("扫描已移除应用在 ~/Library 留下的孤儿支持目录与缓存。"),
          fauxToolCall("app_scan_remnants", {}),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isLogIntent) {
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

  constructor() {
    this.models = createModels({
      credentials: this.credStore,
      identity: { attribution: { name: "Valet", url: "https://valet.local" } },
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
              async (c) => buildLocalStewardMessage(c),
            ]);
          }
          return core.stream(m, ctx, opts);
        },
        streamSimple: (m, ctx, opts) => {
          if (core.getPendingResponseCount() === 0) {
            core.appendResponses([
              async (c) => buildLocalStewardMessage(c),
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

  /** Registers an explicit scripted response handler for deterministic testing. */
  setLocalStewardScript(
    steps: Parameters<ReturnType<typeof createFauxCore>["setResponses"]>[0],
  ): void {
    this.fauxCore.setResponses(steps);
  }

  syncProviders(configs: AgentProviderConfig[]): void {
    this.providerConfigs = configs;
    for (const cfg of configs) {
      if (cfg.apiKey && !cfg.apiKey.includes("-mock-")) {
        this.credStore.setApiKeyDirect(cfg.id, cfg.apiKey);
      }

      if (cfg.id === "ollama" || cfg.id === "custom") {
        const rawBase =
          cfg.id === "ollama"
            ? cfg.baseUrl || "http://localhost:11434"
            : cfg.baseUrl || cfg.endpoint || "http://localhost:1234";
        const normalizedBase = rawBase.replace(/\/+$/, "").endsWith("/v1")
          ? rawBase.replace(/\/+$/, "")
          : `${rawBase.replace(/\/+$/, "")}/v1`;
        const dynamicModels: Model<"openai-completions">[] = (
          cfg.models.length > 0 ? cfg.models : ["custom-reasoning"]
        ).map((id) => ({
          id,
          name: id,
          api: "openai-completions",
          provider: cfg.id,
          baseUrl: normalizedBase,
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 16_384,
        }));

        this.credStore.setApiKeyDirect(
          cfg.id,
          cfg.apiKey?.trim() || (cfg.id === "ollama" ? "ollama" : "custom"),
        );

        this.models.setProvider(
          createProvider<"openai-completions">({
            id: cfg.id,
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
                        : "ollama",
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

    const catalog = this.models.getModels(activeProvider.id);
    if (catalog.length === 0) {
      return {
        ref: { provider: "valet-local", modelId: "valet-steward-local" },
        usingLocalFallback: true,
      };
    }

    const exact = catalog.find((m) => m.id === requestedModelId);
    if (exact) {
      return {
        ref: { provider: activeProvider.id, modelId: exact.id },
        usingLocalFallback: false,
      };
    }

    const normalized = requestedModelId.replace(/^[^/]+\//, "");
    const prefixMatch = catalog.find(
      (m) =>
        m.id.startsWith(normalized) ||
        m.id.startsWith(requestedModelId) ||
        m.id.includes(normalized),
    );
    if (prefixMatch) {
      return {
        ref: { provider: activeProvider.id, modelId: prefixMatch.id },
        usingLocalFallback: false,
      };
    }

    return {
      ref: { provider: activeProvider.id, modelId: catalog[0]!.id },
      usingLocalFallback: false,
    };
  }
}
