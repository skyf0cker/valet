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
import type {
  AgentProviderConfig,
  AutoReviewConfig,
  ValetSyncState,
} from "./protocol.ts";

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
 * Uses only Valet's universal core tools without plugin-specific branching.
 */
function buildLocalStewardMessage(
  context: TranscriptContext,
  _availableTools: ReadonlySet<string>,
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
  let rawUserPrompt = prompt;
  for (const marker of ["\n\n[附件上下文:", "\n\n[引用事项"]) {
    const idx = rawUserPrompt.indexOf(marker);
    if (idx >= 0) {
      rawUserPrompt = rawUserPrompt.slice(0, idx);
    }
  }
  rawUserPrompt = rawUserPrompt.trim();
  const lower = rawUserPrompt.toLowerCase();
  const quoteMatch = prompt.match(
    /\[引用事项 · (收件箱事项|时间线事件)(?: id=([^\s·\]]+))? · ([^\]]+)\]/,
  );
  const quoteSource = quoteMatch
    ? quoteMatch[1] === "收件箱事项"
      ? "inbox"
      : "timeline"
    : undefined;
  const quoteId = quoteMatch?.[2]?.trim() ?? "";
  const quoteTitle = quoteMatch?.[3]?.trim() ?? "";
  const sinceUser = lastUserIdx >= 0 ? msgs.slice(lastUserIdx + 1) : msgs;
  const toolResults = sinceUser.filter(
    (m): m is ToolResultMessage => m.role === "toolResult",
  );

  if (prompt.startsWith("[INBOX_ANSWER ")) {
    const ansMatch = prompt.match(/作出了选择：「([\s\S]*?)」/);
    const chosen = ansMatch?.[1]?.trim() || "已确认";
    return fauxAssistantMessage(
      `已收到你在收件箱中的选择「${chosen}」，并按该决定完成后续处理。`,
    );
  }

  // Event-driven trigger turns from Host / Sensors / Webhooks / Crons
  if (prompt.startsWith("[EVENT_TRIGGER ")) {
    const pluginMatch = prompt.match(/plugin=([^\s\]]+)/);
    const eventMatch = prompt.match(/event=([^\s\]]+)/);
    const payloadMatch = prompt.match(/payload=(\{[\s\S]*?\})(?:\n|$)/);
    const pluginId = pluginMatch?.[1] ?? "plugin";
    const eventCode = eventMatch?.[1] ?? "custom.event";
    let eventPayload: Record<string, unknown> | undefined;
    if (payloadMatch?.[1]) {
      try {
        eventPayload = JSON.parse(payloadMatch[1]) as Record<string, unknown>;
      } catch {
        eventPayload = undefined;
      }
    }

    if (toolResults.length === 0) {
      return fauxAssistantMessage(
        [
          fauxThinking(`收到插件 ${pluginId} 事件 ${eventCode}，先采集系统实时概览与上下文。`),
          fauxToolCall("system_overview", {}),
        ],
        { stopReason: "toolUse" },
      );
    }

    const lastResult = toolResults[toolResults.length - 1];
    const lastText = lastResult ? extractToolText(lastResult) : "";
    if (lastText.includes("NEEDS_APPROVAL")) {
      return fauxAssistantMessage(
        `已响应事件 \`${eventCode}\`（${pluginId}），涉及敏感变更的操作已按策略送入**收件箱**等待你批准。`,
      );
    }

    const payloadSummary =
      typeof eventPayload?.summary === "string" && eventPayload.summary.trim()
        ? `\n\n- 传感器摘要：${eventPayload.summary.trim()}`
        : "";
    const groupLines = Array.isArray(eventPayload?.groups)
      ? (eventPayload.groups as Array<Record<string, unknown>>)
          .slice(0, 5)
          .map((g) => {
            const label = String(g.categoryLabel ?? g.category ?? "异常项");
            const count = Number(g.count ?? 1);
            const sample = String(g.sampleMessage ?? "");
            return `- **${label}**（${count} 次）：${sample}`;
          })
          .join("\n")
      : "";

    return fauxAssistantMessage(
      `已捕获并处理插件 \`${pluginId}\` 的事件 \`${eventCode}\`。${payloadSummary}${groupLines ? `\n\n${groupLines}` : ""}\n\n如需进一步诊断或处理，可在对话中直接告知需求或按插件 Skill 指引继续排查。`,
    );
  }

  // Interactive User Chat Intents
  const isSelfConfigIntent =
    lower.startsWith("/self-config") ||
    lower.includes("valet cli") ||
    lower.includes("自配置");
  const isPluginDevIntent =
    lower.startsWith("/plugin-dev") || lower.startsWith("/plugin-install");
  const isPluginIntent =
    !isPluginDevIntent &&
    !isSelfConfigIntent &&
    (lower.startsWith("/plugin") ||
      lower.includes("插件") ||
      lower.includes("规则") ||
      lower.includes(".dmg") ||
      lower.includes("截图"));
  const isCleanIntent =
    lower.startsWith("/clean") ||
    lower.includes("大文件") ||
    lower.includes("清理") ||
    lower.includes("磁盘");
  const isMemoryIntent = lower.startsWith("记住") || lower.includes("记住");
  const isAskIntent =
    lower.startsWith("/ask") ||
    lower.includes("问我") ||
    lower.includes("选一个");

  if (toolResults.length === 0) {
    if (quoteMatch && !lower.startsWith("/")) {
      const wantsRestore = lower.includes("还原") || lower.includes("恢复");
      const wantsDismiss =
        lower.includes("忽略") ||
        lower.includes("保留") ||
        lower.includes("不处理") ||
        lower.includes("取消");
      const wantsApprove =
        lower.includes("批准") ||
        lower.includes("确认执行") ||
        lower.includes("直接清理") ||
        lower.includes("帮我处理") ||
        lower.includes("移入废纸篓") ||
        lower.includes("执行清理") ||
        lower.includes("同意");

      if (quoteSource && quoteId && (wantsRestore || wantsDismiss || wantsApprove)) {
        const action = wantsRestore
          ? "restore"
          : wantsDismiss
            ? quoteSource === "inbox"
              ? "dismiss"
              : "ignore"
            : quoteSource === "inbox"
              ? "approve"
              : "execute";
        return fauxAssistantMessage(
          [
            fauxThinking(`根据用户针对引用事项「${quoteTitle}」的指令，调用 item_resolve 执行 ${action}。`),
            fauxToolCall("item_resolve", {
              source: quoteSource,
              id: quoteId,
              action,
              reason: rawUserPrompt,
            }),
          ],
          { stopReason: "toolUse" },
        );
      }

      return fauxAssistantMessage(
        [
          fauxThinking(`用户引用了${quoteMatch[1]}「${quoteTitle}」，先获取系统状态以结合上下文回答。`),
          fauxToolCall("system_overview", {}),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isSelfConfigIntent) {
      return fauxAssistantMessage(
        [
          fauxThinking("先加载内置自配置技能手册 valet-self-config。"),
          fauxToolCall("skill_load", { name: "valet-self-config" }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isPluginDevIntent) {
      return fauxAssistantMessage(
        [
          fauxThinking("先加载内置插件开发技能手册 valet-plugin-dev。"),
          fauxToolCall("skill_load", { name: "valet-plugin-dev" }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isPluginIntent) {
      const isDmg = lower.includes(".dmg") || lower.includes("dmg");
      return fauxAssistantMessage(
        [
          fauxThinking("分析用户自动化规则意图，起草 Action-less 可插拔插件 YAML 与 SKILL.md。"),
          fauxToolCall("plugin_draft_create", {
            name: isDmg ? "下载 .dmg 清扫器" : "桌面截图归档器",
            slug: isDmg ? "dmg-cleaner" : "screenshot-archiver",
            eventCode: "fs.file_created",
            sensor: "fs_watch",
            glob: isDmg ? "~/Downloads/*.dmg" : "~/Desktop/截屏*.png",
            actionSummary: isDmg ? "检查安装包并将过期 .dmg 移入废纸篓" : "整理桌面截图到 Pictures/Screenshots",
            ...(isDmg
              ? { condition: "app_installed_from(dmg)" }
              : { targetPath: "~/Pictures/Screenshots" }),
            skillMarkdown: isDmg
              ? "### 触发条件\n- `~/Downloads/*.dmg` 新增安装包。\n\n### 处理逻辑\n1. 检查 `/Applications` 对应应用是否已安装，或向用户确认。\n2. 使用 `trash_files` 将安装包移入系统废纸篓（7 天可还原）。"
              : "### 触发条件\n- `~/Desktop` 新增屏幕截图。\n\n### 处理逻辑\n1. 使用 `list_dir` 确认目标路径，再用 `bash` 将截图移动到 `~/Pictures/Screenshots`。",
          }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isCleanIntent) {
      return fauxAssistantMessage(
        [
          fauxThinking("先通过 list_dir 只读查看 ~/Downloads 中的候选文件，避开受保护目录。"),
          fauxToolCall("list_dir", { path: "~/Downloads", maxEntries: 30 }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isMemoryIntent) {
      return fauxAssistantMessage(
        [
          fauxThinking("将用户明确的偏好习惯写入本地持久化记忆。"),
          fauxToolCall("memory_remember", {
            content: rawUserPrompt.replace(/^记住[：:\s]*/, "") || rawUserPrompt,
            source: "对话学习",
          }),
        ],
        { stopReason: "toolUse" },
      );
    }

    if (isAskIntent) {
      return fauxAssistantMessage(
        [
          fauxThinking("通过 ask_user 向用户确认处理偏好。"),
          fauxToolCall("ask_user", {
            question: "希望我先执行只读诊断扫描，还是直接列出清理候选方案？",
            options: ["先只读排查", "列出候选方案"],
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

  // Turn 2 for /self-config or /plugin-dev
  if (
    isSelfConfigIntent &&
    toolResults.length === 1 &&
    toolResults[0]?.toolName === "skill_load"
  ) {
    return fauxAssistantMessage(
      [
        fauxThinking("已读取 valet-self-config 手册，通过只读命令 valet status --json 检查运行态。"),
        fauxToolCall("bash", { command: "valet status --json" }),
      ],
      { stopReason: "toolUse" },
    );
  }

  if (
    isPluginDevIntent &&
    toolResults.length === 1 &&
    toolResults[0]?.toolName === "skill_load"
  ) {
    return fauxAssistantMessage(
      [
        fauxThinking("已读取 valet-plugin-dev 手册，列举当前已安装插件状态。"),
        fauxToolCall("plugin_list", {}),
      ],
      { stopReason: "toolUse" },
    );
  }

  // Turn 2 for /clean: inspect list_dir output -> propose moving real file candidates via trash_files
  if (
    isCleanIntent &&
    toolResults.length === 1 &&
    toolResults[0]?.toolName === "list_dir" &&
    !toolResults[0].isError
  ) {
    const dirData = parseTrailingJson(extractToolText(toolResults[0]));
    const entries = Array.isArray(dirData?.entries)
      ? (dirData.entries as Array<{ path?: string; isDir?: boolean; sizeBytes?: number }>)
      : [];
    const candidatePaths = entries
      .filter((e) => typeof e.path === "string" && e.path && !e.isDir)
      .slice(0, 4)
      .map((e) => e.path as string);

    if (candidatePaths.length > 0) {
      return fauxAssistantMessage(
        [
          fauxThinking("在 ~/Downloads 检测到待清理文件，调用 trash_files 提交安全移入废纸篓审批。"),
          fauxToolCall("trash_files", {
            paths: candidatePaths,
            reason: `在 ~/Downloads 找到 ${candidatePaths.length} 个文件候选，请求移入废纸篓（7 天可还原）。`,
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
      `已按你的描述通过 \`plugin_draft_create\` 起草了纯 Skill 架构插件（仅声明传感器触发器与 \`SKILL.md\`），点击右侧**安装**即可启用。`,
    );
  }

  if (latest?.toolName === "memory_remember") {
    return fauxAssistantMessage(rawText || "已记住该偏好设置。");
  }

  if (latest?.toolName === "ask_user") {
    return fauxAssistantMessage(`已收到你的选择：${rawText}`);
  }

  if (latest?.toolName === "item_resolve") {
    if (rawText.includes("USER_DENIED")) {
      return fauxAssistantMessage(
        `已尊重你的决定，暂未改动引用事项「${quoteTitle || quoteId}」。`,
      );
    }
    if (latest.isError) {
      return fauxAssistantMessage(
        `未能处理引用事项「${quoteTitle || quoteId}」：${rawText}`,
      );
    }
    return fauxAssistantMessage(
      `已完成针对引用事项「${quoteTitle || quoteId}」的处理：${rawText}`,
    );
  }

  if (quoteMatch && !lower.startsWith("/")) {
    const excerptStart = prompt.indexOf("[引用事项 ·");
    const excerptEnd = prompt.indexOf("\n\n[引用事项交互说明]");
    const quoteSection =
      excerptStart >= 0
        ? prompt.slice(excerptStart, excerptEnd >= 0 ? excerptEnd : undefined)
        : "";
    const snippetLines = quoteSection
      .split("\n")
      .slice(1, 7)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    return fauxAssistantMessage(
      `已读取你引用的${quoteMatch[1]} **「${quoteTitle}」**${quoteId ? `（\`${quoteId}\`）` : ""} 的完整上下文：\n\n${snippetLines ? `${snippetLines}\n\n` : ""}你可以继续针对该事项的触发原因、安全影响或子项细节追问；如需直接处置，请直接回复**“批准执行”**、**“忽略保留”**或**“还原”**（当前处于本地回退模式，配置云端大模型后可进行更深入的自由推理与细粒度勾选）。`,
    );
  }

  if (isSelfConfigIntent) {
    return fauxAssistantMessage(
      `已加载 \`valet-self-config\` 技能手册并检查当前 \`valet status --json\` 状态：\n\n\`\`\`json\n${rawText.slice(0, 800)}\n\`\`\``,
    );
  }

  if (isPluginDevIntent) {
    return fauxAssistantMessage(
      `已加载 \`valet-plugin-dev\` 技能手册并查询插件列表：可使用 \`plugin_install\`、\`plugin_reload\` 与 \`plugin_trigger\` 完成 Action-less 插件编写与闭环热加载。`,
    );
  }

  if (isCleanIntent) {
    if (rawText.includes("NEEDS_APPROVAL")) {
      return fauxAssistantMessage(
        `已完成安全只读目录扫描，涉及文件移动的清理清单已按策略推送至**收件箱**与**时间线**等待确认（7 天可还原）。`,
      );
    }
    if (rawText.includes("USER_DENIED")) {
      return fauxAssistantMessage(
        `已尊重你的决定，取消清理上述文件，未对磁盘作任何修改。`,
      );
    }
    if (latest?.toolName === "trash_files" && !latest.isError) {
      return fauxAssistantMessage(`已按你的批准完成清理：${rawText}`);
    }
    return fauxAssistantMessage(
      "已检查 `~/Downloads`，当前没有发现需要立即清理的文件，亦未触碰任何受保护目录。",
    );
  }

  const topProcs = Array.isArray(parsed?.topProcesses)
    ? (parsed.topProcesses as Array<{ name: string; cpuPct: number; memLabel?: string }>)
    : [];
  if (
    topProcs.length > 0 &&
    (lower.startsWith("/ps") ||
      lower.startsWith("/scan") ||
      lower.includes("cpu") ||
      lower.includes("进程"))
  ) {
    const top = topProcs[0]!;
    return fauxAssistantMessage(
      `已完成实时进程采样：当前最高占用进程为 \`${top.name}\`（CPU **${top.cpuPct}%** · 内存 ${top.memLabel ?? "--"}），系统整体 CPU ${String(parsed?.cpuPct ?? "--")}%、内存 ${String(parsed?.memPct ?? "--")}%。你可以直接点击下方表格操作，或告诉我下一步需要处理的目标进程。`,
    );
  }

  const diskPct = parsed?.diskPct ?? "--";
  const diskFreeGB = parsed?.diskFreeGB ?? "--";
  const cpuPct = parsed?.cpuPct ?? "--";
  const memPct = parsed?.memPct ?? "--";
  const enabledCount = parsed?.enabledPlugins ?? "--";
  return fauxAssistantMessage(
    `当前 Mac 状态概览：磁盘已用 **${diskPct}%**（可用 **${diskFreeGB} GB**），CPU **${cpuPct}%**，内存 **${memPct}%**，共有 **${enabledCount}** 个插件在岗运行。\n\n你可以直接用自然语言让我排查日志、分析进程、清理指定目录，或输入 \`/plugin\` 创建可插拔插件。`,
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

  private resolveReviewProvider(
    state: ValetSyncState,
    overrideCfg?: Partial<AutoReviewConfig>,
  ): AgentProviderConfig | undefined {
    const ar = overrideCfg ?? state.preferences.autoReview;
    const requestedProviderId =
      ar?.fallbackProviderId && ar.fallbackProviderId !== "active"
        ? ar.fallbackProviderId.trim()
        : "";
    return (
      (requestedProviderId
        ? this.providerConfigs.find((p) => p.id === requestedProviderId) ??
          state.providers.find((p) => p.id === requestedProviderId)
        : undefined) ??
      this.providerConfigs.find((p) => p.id === state.preferences.activeProviderId) ??
      state.providers.find((p) => p.id === state.preferences.activeProviderId)
    );
  }

  hasLiveReviewModel(
    state: ValetSyncState,
    overrideCfg?: Partial<AutoReviewConfig>,
  ): boolean {
    const targetProvider = this.resolveReviewProvider(state, overrideCfg);
    return Boolean(targetProvider && !isMockOrEmptyKey(targetProvider));
  }

  /**
   * Resolves whether a live non-mock small LLM is available for Auto Review fallback
   * and executes a single structured review prompt without using `valet-local`.
   */
  async completeReviewPrompt(
    state: ValetSyncState,
    systemPrompt: string,
    userPrompt: string,
    overrideCfg?: Partial<AutoReviewConfig>,
  ): Promise<{
    ok: boolean;
    modelLabel: string;
    text: string;
    latencyMs: number;
    error?: string;
  }> {
    const ar = overrideCfg ?? state.preferences.autoReview;
    const targetProvider = this.resolveReviewProvider(state, overrideCfg);

    if (!targetProvider || isMockOrEmptyKey(targetProvider)) {
      return {
        ok: false,
        modelLabel: "unconfigured",
        text: "",
        latencyMs: 0,
        error: "未配置有效的审查小模型 API Key 或本地 Endpoint",
      };
    }

    const piId = toPiProviderId(targetProvider.id);
    const catalog = this.models
      .getModels(piId)
      .filter((m) => !m.id.startsWith("~"));
    if (catalog.length === 0) {
      return {
        ok: false,
        modelLabel: `${piId}/none`,
        text: "",
        latencyMs: 0,
        error: `服务商 ${targetProvider.name} 暂无可用模型`,
      };
    }

    const rawFallback = ar?.fallbackModel?.trim() ?? "";
    const requestedModelId =
      !rawFallback || rawFallback === "同快速模型"
        ? state.preferences.models.fast || state.preferences.models.primary
        : rawFallback;
    const stripped = requestedModelId.replace(/^[^/]+\//, "");
    const matched =
      catalog.find((m) => m.id === requestedModelId) ??
      catalog.find((m) => m.id === stripped) ??
      catalog.find((m) => m.id.startsWith(stripped) || m.id.includes(stripped));
    const model =
      matched ??
      (requestedModelId
        ? { ...catalog[0]!, id: requestedModelId, name: requestedModelId }
        : catalog[0]!);

    const start = Date.now();
    try {
      const msg = await this.models.completeSimple(
        model,
        {
          systemPrompt,
          messages: [
            {
              role: "user",
              content: userPrompt,
              timestamp: Date.now(),
            },
          ],
        },
        { maxTokens: 512, signal: AbortSignal.timeout(10_000) },
      );
      const latencyMs = Math.max(1, Date.now() - start);
      if (msg.stopReason === "error" || msg.errorMessage) {
        return {
          ok: false,
          modelLabel: `${model.provider}/${model.id}`,
          text: "",
          latencyMs,
          error: msg.errorMessage || "审查模型返回错误",
        };
      }
      const replyText = msg.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
        .trim();
      return {
        ok: true,
        modelLabel: `${model.provider}/${model.id}`,
        text: replyText,
        latencyMs,
      };
    } catch (err) {
      return {
        ok: false,
        modelLabel: `${model.provider}/${model.id}`,
        text: "",
        latencyMs: Math.max(1, Date.now() - start),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
