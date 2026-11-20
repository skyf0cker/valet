import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { WatchHandle } from "@earendil-works/chord/watch";
import {
  type AssistantMessage,
  type ToolResultMessage,
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  type Conversation,
  type ConversationId,
  type ConversationView,
  type EntryId,
  type EntryRecord,
  type Extension,
  Harness,
  type LiveState,
  ToolResultEntry,
  UsageDoc,
  createRegistry,
  defineDoc,
} from "@earendil-works/pi-durable";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type AlwaysOnInboxStatus,
  type AlwaysOnOutboxMessage,
  type AlwaysOnRunRecord,
  type AlwaysOnStats,
  type AlwaysOnTimerRecord,
  type AlwaysOnTimerStatus,
  type ClaimedBatch,
  type CreateTimerInput,
  type IngestInboxInput,
  ValetAlwaysOnStore,
} from "./always-on.ts";
import {
  InteractivePermissionCoordinator,
  ToolPolicyRegistry,
  createSafetyExtension,
} from "./approval.ts";
import { AutoReviewEvaluator } from "./auto-review.ts";
import { compilePluginExtension } from "./extensions/plugin-compiler.ts";
import { createBuiltinSkillsExtension } from "./extensions/builtin-skills.ts";
import { createStewardCoreExtension } from "./extensions/steward-core.ts";
import { McpClientManager } from "./mcp.ts";
import { ValetModelManager } from "./models.ts";
import type {
  AnswerInboxQuestionRequest,
  AnswerInboxQuestionResponse,
  ChatMessage,
  ChatStreamPayload,
  ChatStreamStep,
  DispatchPluginEventRequest,
  ExecuteApprovedToolRequest,
  HostBridge,
  PendingPermissionRequest,
  PluginDraftSpec,
  ProbeMcpRequest,
  ProbeMcpResponse,
  ProcessSampleRow,
  ResolvePermissionRequest,
  ResumeWorkflowHookRequest,
  SendChatRequest,
  SendChatResponse,
  StartWorkflowRequest,
  TestAutoReviewRequest,
  TestProviderRequest,
  ValetSyncState,
  WorkflowGraphResponse,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowValidationResponse,
} from "./protocol.ts";
import { openUniversalSqliteBundle } from "./sqlite.ts";
import { ValetWorkflowManager } from "./workflow/manager.ts";

const ValetThreadsDoc = defineDoc<{ map: Record<string, ConversationId> }>({
  kind: "valet.threads",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ map: {} }),
});

const TOOL_STATUS_LABELS: Record<string, string> = {
  system_overview: "正在读取系统状态概览…",
  read_file: "正在读取本地文件…",
  list_dir: "正在扫描目录列表…",
  write_file: "正在写入本地文件…",
  trash_files: "正在移入废纸篓…",
  kill_process: "正在处理目标进程…",
  bash: "正在执行终端命令…",
  ask_user: "正在等待你的选择或确认…",
  memory_remember: "正在保存本地偏好记忆…",
  plugin_draft_create: "正在起草本地插件规则…",
  inbox_propose_approval: "正在提交收件箱待批事项…",
  skill_load: "正在加载内置 Skill 手册…",
  plugin_list: "正在读取插件列表…",
  plugin_inspect: "正在检查插件详情…",
  plugin_install: "正在写入并热加载插件…",
  plugin_reload: "正在热重载插件…",
  plugin_configure: "正在更新插件策略与配置…",
  plugin_trigger: "正在注入插件测试事件…",
  plugin_remove: "正在卸载/移除插件…",
  item_resolve: "正在处理引用的事项…",
  wake_me_at: "正在创建自唤醒定时器…",
  cancel_wake: "正在取消定时器…",
  list_timers: "正在查询定时器列表…",
  notify: "正在发送 Outbox 通知…",
};

export function stripThinkTags(raw: string): {
  cleanText: string;
  hadThink: boolean;
} {
  if (!raw) return { cleanText: "", hadThink: false };
  let hadThink = false;
  let clean = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, () => {
    hadThink = true;
    return "";
  });
  if (/<think(?:ing)?>/i.test(clean)) {
    hadThink = true;
    clean = clean.replace(/<think(?:ing)?>[\s\S]*$/i, "");
  }
  return {
    cleanText: clean.replace(/^\s+/, ""),
    hadThink,
  };
}

export function summarizeStreamStatus(
  steps: ChatStreamStep[],
  hasPartialText: boolean,
): string {
  const runningStep = steps.find(
    (s) => s.status === "running" || s.status === "pending",
  );
  if (runningStep) {
    return (
      TOOL_STATUS_LABELS[runningStep.name] ??
      `正在调用工具 ${runningStep.name}…`
    );
  }
  if (hasPartialText) {
    return "正在生成回复…";
  }
  return "正在思考与分析…";
}

function humanizeToolStepLabel(
  name: string,
  args?: Record<string, unknown>,
): string {
  switch (name) {
    case "bash": {
      const rawCmd =
        typeof args?.command === "string"
          ? args.command.trim().replace(/\s+/g, " ")
          : "";
      if (!rawCmd) return "执行终端命令";
      const shortCmd = rawCmd.length > 28 ? `${rawCmd.slice(0, 27)}…` : rawCmd;
      return `执行命令 · ${shortCmd}`;
    }
    case "read_file": {
      const p = typeof args?.path === "string" ? args.path : "";
      return p ? `读取 · ${p.split("/").pop() || p}` : "读取文件";
    }
    case "list_dir": {
      const p = typeof args?.path === "string" ? args.path : "";
      return p ? `浏览目录 · ${p}` : "浏览目录";
    }
    case "write_file": {
      const p = typeof args?.path === "string" ? args.path : "";
      return p ? `写入 · ${p.split("/").pop() || p}` : "写入文件";
    }
    case "trash_files":
      return "移入废纸篓（7 天可还原）";
    case "kill_process":
      return `终止进程 ${args?.name ? String(args.name) : ""}`.trim();
    case "ask_user":
      return "询问用户确认";
    case "system_overview":
      return "读取系统概览";
    case "memory_remember":
      return "保存偏好记忆";
    case "plugin_draft_create":
      return "生成本地插件草稿";
    case "inbox_propose_approval":
      return "提交收件箱待批项";
    case "skill_load":
      return args?.name ? `加载 Skill · ${String(args.name)}` : "加载内置 Skill";
    case "plugin_list":
      return "读取插件列表";
    case "plugin_inspect":
      return args?.id ? `检查插件 · ${String(args.id)}` : "检查插件详情";
    case "plugin_install":
      return args?.name || args?.slug
        ? `安装并热加载 · ${String(args.name ?? args.slug)}`
        : "写入并热加载插件";
    case "plugin_reload":
      return args?.id ? `热重载插件 · ${String(args.id)}` : "热重载本地插件";
    case "plugin_configure":
      return args?.id ? `配置插件 · ${String(args.id)}` : "更新插件配置";
    case "plugin_trigger":
      return args?.eventId ? `触发测试 · ${String(args.eventId)}` : "触发插件事件";
    case "plugin_remove":
      return args?.id ? `移除插件 · ${String(args.id)}` : "移除插件";
    case "item_resolve":
      return args?.id
        ? `处理事项 · ${String(args.id)}`
        : "处理引用的事项";
    case "wake_me_at":
      return args?.label
        ? `创建定时唤醒 · ${String(args.label)}`
        : "创建自唤醒定时器";
    case "cancel_wake":
      return args?.timerId
        ? `取消定时器 · ${String(args.timerId)}`
        : "取消定时器";
    case "list_timers":
      return "查询定时器列表";
    case "notify":
      return args?.title
        ? `发送通知 · ${String(args.title)}`
        : "发送 Outbox 通知";
    default:
      return name.replace(/^(plugin_|mcp_)/, "").replace(/_/g, " ");
  }
}

function summarizeToolOutput(rawText: string): string | undefined {
  const trimmed = rawText.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("NEEDS_APPROVAL(")) {
    return "已转入收件箱等待确认";
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const picked =
    lines.find((l) => !l.startsWith("{") && !l.startsWith("[")) ?? lines[0];
  if (!picked) return undefined;
  const singleLine = picked.replace(/\s+/g, " ");
  return singleLine.length > 64 ? `${singleLine.slice(0, 63)}…` : singleLine;
}

function formatHHMM(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function emptySyncState(): ValetSyncState {
  return {
    homeDir: process.env.HOME || "/tmp",
    dataDir: process.env.TMPDIR || "/tmp",
    isPaused: false,
    preferences: {
      language: "简体中文",
      models: {
        primary: "claude-opus-4",
        fast: "claude-haiku-4",
        vision: "同主模型",
      },
      activeProviderId: "anthropic",
      dailySpendCurrent: 0,
      dailySpendLimit: 30,
      maxStepsPerTask: 50,
      userNickname: "dd",
      toneStyle: "concise",
      customInstructions: "",
      autonomyLevel: "auto_review",
      confirmChecklist: {
        deleteOrOverwrite: false,
        sendMessageOrEmail: true,
        paymentOrSubscription: true,
        runTerminalCommand: false,
        modifySystemSettings: false,
      },
      blockedApps: ["钥匙串访问", "1Password"],
      thresholds: {
        diskLowSpacePct: 15,
        cacheBloatGB: "5 GB",
        largeFileSizeGB: "2 GB",
        largeFileIdleDays: "90 天",
        cpuSpikePct: "200%",
        cpuSpikeDuration: "5 分钟",
        memoryPressureLevel: "red",
        ignoredProcesses: ["Xcode", "ffmpeg", "Docker"],
        logSensitivity: "medium",
        eventThrottle10m: true,
      },
      cleanupPolicy: {
        deleteMethod: "移入废纸篓",
        restoreRetentionDays: "7 天",
        protectedDirs: ["~/Documents", "~/Projects"],
        autoScanAfterUninstall: true,
      },
      pluginRuntime: {
        sandboxIsolation: true,
        allowUnsignedLocal: true,
        maxEventsPerHour: "60 / 小时",
        quietHours: "23:30 – 08:00",
      },
      memoryEnabled: true,
      autoLearnMemory: true,
    },
    providers: [],
    plugins: [],
    memories: [],
  };
}

export class ValetDurableRuntime {
  private harness: Harness | null = null;
  private storageClose: (() => Promise<void>) | null = null;
  readonly policyRegistry = new ToolPolicyRegistry();
  readonly permissionCoordinator = new InteractivePermissionCoordinator();
  readonly models = new ValetModelManager();
  readonly autoReviewer = new AutoReviewEvaluator(this.models);
  readonly mcp = new McpClientManager();
  readonly registry = createRegistry();
  private readonly approvedConversations = new Set<ConversationId>();
  private readonly installedPluginExts = new Map<
    string,
    { signature: string; ext: Extension }
  >();
  private state: ValetSyncState = emptySyncState();
  private activeConversationHandles = new Map<string, Conversation>();
  private turnSideEffects = new Map<
    ConversationId,
    { inboxIds: string[]; timelineIds: string[] }
  >();
  private alwaysOn: ValetAlwaysOnStore | null = null;
  private workflows: ValetWorkflowManager | null = null;
  private fauxScriptQueue: Promise<unknown> = Promise.resolve();
  private activeRunId: string | null = null;
  private activeRunChatId: string | null = null;
  private activeRunPromise: Promise<void> | null = null;
  private wakeupTimer: ReturnType<typeof setTimeout> | null = null;
  private tickInFlight: Promise<void> | null = null;
  private tickRequested = false;
  private readonly nowFn: () => number;

  constructor(
    private readonly bridge: HostBridge,
    options?: { nowFn?: () => number },
  ) {
    this.nowFn = options?.nowFn ?? (() => Date.now());
    this.models.setAvailableToolProvider(
      () => new Set(this.registry.snapshot().tools().map((t) => t.tool.name)),
    );
  }

  getAlwaysOnStore(): ValetAlwaysOnStore | null {
    return this.alwaysOn;
  }

  getState(): ValetSyncState {
    return this.state;
  }

  async init(params: {
    dbPath: string;
    state: ValetSyncState;
  }): Promise<{ resumed: boolean }> {
    if (this.harness) {
      await this.syncState(params.state);
      return { resumed: false };
    }

    this.state = params.state;
    this.models.syncProviders(
      params.state.providers,
      params.state.preferences.activeProviderId,
    );

    const tracker = {
      recordInbox: (
        conversationId: ConversationId,
        inboxId: string,
        eventId?: string,
      ) => {
        const entry = this.turnSideEffects.get(conversationId);
        if (!entry) return;
        if (!entry.inboxIds.includes(inboxId)) entry.inboxIds.push(inboxId);
        if (eventId && !entry.timelineIds.includes(eventId)) {
          entry.timelineIds.push(eventId);
        }
      },
      recordTimeline: (conversationId: ConversationId, eventId: string) => {
        const entry = this.turnSideEffects.get(conversationId);
        if (!entry) return;
        if (!entry.timelineIds.includes(eventId)) entry.timelineIds.push(eventId);
      },
    };

    const safetyExt = createSafetyExtension({
      bridge: this.bridge,
      policyRegistry: this.policyRegistry,
      getState: () => this.state,
      approvedConversations: this.approvedConversations,
      tracker,
      permissionCoordinator: this.permissionCoordinator,
      autoReviewer: this.autoReviewer,
    });
    const coreExt = createStewardCoreExtension({
      bridge: this.bridge,
      getState: () => this.state,
      policyRegistry: this.policyRegistry,
      tracker,
      permissionCoordinator: this.permissionCoordinator,
      alwaysOn: {
        getResidentState: async () =>
          this.alwaysOn ? this.alwaysOn.buildResidentStateSummary() : null,
        wakeMeAt: async (p) => {
          if (!this.alwaysOn) {
            throw new Error("Always-On 定时器存储未初始化");
          }
          const isSchedule =
            typeof p.everySeconds === "number" && Number.isFinite(p.everySeconds);
          const timer = await this.alwaysOn.createTimer({
            kind: isSchedule ? "schedule" : "follow_up",
            label: p.label?.trim() || p.note.trim().slice(0, 40) || "定时唤醒",
            payload: p.note,
            delay_seconds: p.delaySeconds,
            at_iso: p.atIso,
            every_seconds: p.everySeconds,
            start_at_iso: p.startAtIso,
            created_by: "agent",
          });
          await this.recomputeWakeup();
          this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "timers" });
          return timer;
        },
        cancelWake: async (timerId) => {
          if (!this.alwaysOn) return null;
          const timer = await this.alwaysOn.cancelTimer(timerId);
          if (timer) {
            await this.recomputeWakeup();
            this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "timers" });
          }
          return timer;
        },
        listTimers: async (status) => {
          if (!this.alwaysOn) return [];
          return this.alwaysOn.listTimers(status);
        },
        notify: async (p) => {
          if (!this.alwaysOn) {
            throw new Error("Always-On Outbox 存储未初始化");
          }
          const dedupeKey =
            p.dedupeKey?.trim() ||
            (p.callId
              ? `notify:${this.activeRunId ?? "direct"}:${p.callId}`
              : null);
          const firstLine = p.body
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find(Boolean);
          const title =
            p.title?.trim() ||
            (firstLine ? firstLine.slice(0, 60) : "Valet 通知");
          const msg = await this.alwaysOn.appendOutbox({
            run_id: this.activeRunId,
            kind: "message",
            title,
            body: p.body,
            detail: { level: p.level ?? "info" },
            dedupe_key: dedupeKey,
          });
          this.bridge.notifyHost("host.outboxNotify", {
            message: msg,
            level: p.level ?? "info",
          });
          this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "outbox" });
          return msg;
        },
      },
    });

    const builtinSkillsExt = createBuiltinSkillsExtension({
      bridge: this.bridge,
      getState: () => this.state,
      policyRegistry: this.policyRegistry,
      onPluginsUpdated: (plugins) => {
        this.state = { ...this.state, plugins };
        this.syncPluginExtensions(plugins);
      },
    });

    this.registry.install(safetyExt);
    this.registry.install(coreExt);
    this.registry.install(builtinSkillsExt);

    this.syncPluginExtensions(params.state.plugins);
    await this.mcp.syncServers(
      params.state.mcpServers ?? [],
      this.policyRegistry,
      (ext) => this.registry.install(ext),
      (ext) => this.registry.uninstall(ext),
    );

    const { storage, db } = await openUniversalSqliteBundle(
      params.dbPath || join(params.state.dataDir, "pi-agent.sqlite"),
      { prefix: "pi_" },
    );
    this.storageClose = () => storage.close(BACKGROUND_CONTEXT);

    if (db) {
      this.alwaysOn = new ValetAlwaysOnStore(db, this.nowFn);
      this.alwaysOn.setDebounceMs(
        params.state.preferences.pluginRuntime?.debounceMs,
      );
      await this.alwaysOn.ensureSchema();
    }

    this.workflows = new ValetWorkflowManager(
      params.state.dataDir,
      db,
      {
        getPlugin: (pluginId) =>
          this.state.plugins.find((p) => p.id === pluginId),
        executeTool: async (req) => {
          return await this.runWorkflowToolSafely({
            conversationKey: `workflow:${req.__valetPluginId}:${req.__valetRunId ?? "run"}:${req.__valetNodeId}`,
            toolName: req.tool,
            toolArgs: req.args,
          });
        },
        runAgentPrompt: async (req) => {
          const model =
            req.model?.trim() ||
            this.state.preferences.models.fast ||
            this.state.preferences.models.primary;
          const prompt = req.systemPrompt?.trim()
            ? `${req.systemPrompt.trim()}\n\n${req.prompt}`
            : req.prompt;
          const res = await this.sendChat({
            chatId: `wf-agent:${req.__valetPluginId}:${req.__valetRunId ?? "run"}`,
            prompt,
            model,
            interactive: false,
          });
          return {
            text: res.replyMessage.content,
            queuedInboxIds: res.queuedInboxIds,
            timelineEventIds: res.timelineEventIds,
            providerUsed: res.providerUsed,
          };
        },
        emitNotify: async (req) => {
          const plugin = this.state.plugins.find(
            (p) => p.id === req.__valetPluginId,
          );
          const kind = req.kind ?? "timeline";
          let timelineEventId: string | undefined;
          let outboxId: string | undefined;

          if (kind === "outbox" || kind === "both") {
            if (this.alwaysOn) {
              const msg = await this.alwaysOn.appendOutbox({
                run_id: req.__valetRunId ?? null,
                kind: "message",
                title: req.title?.trim() || plugin?.name || "Workflow 通知",
                body: req.message,
                detail: {
                  level: req.level ?? "info",
                  pluginId: req.__valetPluginId,
                  nodeId: req.__valetNodeId,
                },
                dedupe_key: `wf:${req.__valetRunId ?? "direct"}:${req.__valetNodeId}`,
              });
              outboxId = msg.id;
              this.bridge.notifyHost("host.outboxNotify", {
                message: msg,
                level: req.level ?? "info",
              });
              this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "outbox" });
            }
          }

          if (kind === "timeline" || kind === "both") {
            const rec = await this.bridge.callHost<{ timelineEventId: string }>(
              "host.recordTimelineEvent",
              {
                pluginId: req.__valetPluginId,
                pluginName: plugin?.name ?? req.__valetPluginId,
                eventCode: "workflow.notify",
                title: req.title?.trim() || plugin?.name || "Workflow 通知",
                summary: req.message,
                status: req.level === "error" ? "failed" : "completed",
                reasoning: req.message,
                workflowRunId: req.__valetRunId,
                payload: {
                  level: req.level ?? "info",
                  nodeId: req.__valetNodeId,
                  workflowRunId: req.__valetRunId ?? "",
                },
              },
            );
            timelineEventId = rec?.timelineEventId;
          }

          return {
            notified: true,
            kind,
            ...(timelineEventId ? { timelineEventId } : {}),
            ...(outboxId ? { outboxId } : {}),
          };
        },
        queueApproval: async (req) => {
          const plugin = this.state.plugins.find(
            (p) => p.id === req.__valetPluginId,
          );
          const res = await this.bridge.callHost<{ inboxId: string }>(
            "host.queueApproval",
            {
              pluginId: req.__valetPluginId,
              pluginName: plugin?.name ?? req.__valetPluginId,
              eventCode: "workflow.approval",
              category: "process",
              iconKind: "pulse",
              title: req.title,
              summary:
                req.detail?.trim() ||
                `工作流节点「${req.__valetNodeName}」等待人工审批后继续`,
              reasoning: `Vercel Workflow durable hook 等待审批 (runId=${req.runId}, token=${req.hookToken})`,
              reversible7d: false,
              approveLabel: req.approveLabel || "批准继续",
              dismissLabel: req.rejectLabel || "拒绝",
              toolName: "workflow_resume_hook",
              toolArgs: {
                runId: req.runId,
                hookToken: req.hookToken,
                nodeId: req.__valetNodeId,
                nodeName: req.__valetNodeName,
                pluginId: req.__valetPluginId,
              },
              actionItems: [],
            },
          );
          return {
            queued: true,
            inboxId: res?.inboxId ?? "",
            token: req.hookToken,
          };
        },
        onRunUpdated: (info) => {
          this.bridge.notifyHost("host.workflowUpdate", info);
        },
      },
    );
    await this.workflows.init();

    this.harness = await Harness.open(
      storage,
      {
        models: this.models.models,
        registry: this.registry,
        identity: {
          userAgent: { custom: "Valet/0.1.0" },
          attribution: { name: "Valet", url: "https://valet.local" },
        },
        settings: {
          toolExecution: "sequential",
          progress: {
            partialIntervalMs: 80,
            outputIntervalMs: 80,
            persistWithinMs: 1000,
          },
        },
        onReport: (report) => {
          console.error(
            `[pi-durable report] kind=${report.kind}`,
            report.error instanceof Error ? report.error.message : String(report.error),
          );
        },
      },
      BACKGROUND_CONTEXT,
    );

    this.harness.resume();
    await this.recomputeWakeup();
    return { resumed: true };
  }

  private syncPluginExtensions(plugins: ValetSyncState["plugins"]): void {
    const activeIds = new Set<string>();
    for (const plugin of plugins) {
      if (!plugin.installed || !plugin.enabled) continue;
      activeIds.add(plugin.id);

      const sig = JSON.stringify({
        v: plugin.version,
        m: plugin.executionMode ?? "skill",
        y: plugin.manifestYaml,
        s: plugin.skillMarkdown ?? "",
        w: plugin.workflowYaml ?? "",
        e: plugin.events.map((ev) => `${ev.id}:${ev.policy}`),
        l: plugin.localDir ?? "",
        c: plugin.config?.values ?? {},
        f: plugin.bundledFiles ?? [],
      });
      const existing = this.installedPluginExts.get(plugin.id);
      if (existing && existing.signature === sig) continue;

      if (existing) {
        this.registry.uninstall(existing.ext);
      }

      const ext = compilePluginExtension({
        plugin,
        dataDir: this.state.dataDir,
        bridge: this.bridge,
        policyRegistry: this.policyRegistry,
      });
      this.registry.install(ext);
      this.installedPluginExts.set(plugin.id, { signature: sig, ext });
    }

    for (const [pluginId, entry] of [...this.installedPluginExts.entries()]) {
      if (!activeIds.has(pluginId)) {
        this.registry.uninstall(entry.ext);
        this.policyRegistry.unregisterByPlugin(pluginId);
        this.installedPluginExts.delete(pluginId);
      }
    }
  }

  async syncState(nextState: ValetSyncState): Promise<{ ok: true }> {
    const wasPaused = this.state.isPaused;
    this.state = nextState;
    this.alwaysOn?.setDebounceMs(
      nextState.preferences.pluginRuntime?.debounceMs,
    );
    this.autoReviewer.clearCache();
    this.models.syncProviders(
      nextState.providers,
      nextState.preferences.activeProviderId,
    );
    this.syncPluginExtensions(nextState.plugins);
    await this.mcp.syncServers(
      nextState.mcpServers ?? [],
      this.policyRegistry,
      (ext) => this.registry.install(ext),
      (ext) => this.registry.uninstall(ext),
    );
    if (wasPaused && !nextState.isPaused) {
      void this.alwaysOnTick();
    } else {
      await this.recomputeWakeup();
    }
    return { ok: true };
  }

  async testProvider(req: TestProviderRequest): Promise<{
    ok: boolean;
    reply: string;
    latencyMs: number;
  }> {
    return this.models.testProvider(req.provider, req.model);
  }

  async testAutoReview(req: TestAutoReviewRequest): Promise<{
    ok: boolean;
    reply: string;
    latencyMs: number;
  }> {
    return this.autoReviewer.testConnection(req.autoReview, this.state);
  }

  async probeMcpServer(req: ProbeMcpRequest): Promise<ProbeMcpResponse> {
    return this.mcp.probeServer(req.server);
  }

  private requireHarness(): Harness {
    if (!this.harness) {
      throw new Error("ValetDurableRuntime is not initialized yet");
    }
    return this.harness;
  }

  private async ensureConversation(
    chatId: string,
    agentOptions?: { instructions?: string },
  ): Promise<Conversation> {
    const harness = this.requireHarness();
    const threads = await harness.snapshot(ValetThreadsDoc, BACKGROUND_CONTEXT);
    const existingConvId = threads?.map[chatId];
    if (existingConvId !== undefined) {
      const conv = await harness.conversation(
        existingConvId,
        BACKGROUND_CONTEXT,
      );
      if (conv) {
        this.activeConversationHandles.set(chatId, conv);
        this.permissionCoordinator.setConversationChatId(conv.id, chatId);
        return conv;
      }
    }

    const created = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: agentOptions,
      },
      BACKGROUND_CONTEXT,
    );
    await harness.commit(async (tx) => {
      const doc = await tx.doc(ValetThreadsDoc);
      doc.map[chatId] = created.id;
    }, BACKGROUND_CONTEXT);
    this.activeConversationHandles.set(chatId, created);
    this.permissionCoordinator.setConversationChatId(created.id, chatId);
    return created;
  }

  async sendChat(req: SendChatRequest): Promise<SendChatResponse> {
    const harness = this.requireHarness();
    const conv = await this.ensureConversation(req.chatId);

    const { ref, usingLocalFallback } = this.models.resolveModelRef(
      req.model,
      this.state,
    );
    const mentionPlugin = req.mentionPluginId
      ? this.state.plugins.find((p) => p.id === req.mentionPluginId)
      : undefined;

    await conv.configure(
      {
        model: ref,
        thinkingLevel: "low",
        maxTurns: Math.max(1, this.state.preferences.maxStepsPerTask || 25),
        cwd: this.state.homeDir,
        instructions: mentionPlugin
          ? [
              `用户在本条消息中显式 @${mentionPlugin.name}（${mentionPlugin.id}），请优先使用该插件的能力与视角回答。`,
              mentionPlugin.skillMarkdown?.trim()
                ? `\n\n请遵循该插件的 Skill 处理逻辑：\n${mentionPlugin.skillMarkdown.trim()}`
                : "",
            ]
              .filter(Boolean)
              .join("")
          : null,
      },
      BACKGROUND_CONTEXT,
    );

    const imageBlocks: Array<{ type: "image"; data: string; mimeType: string }> = [];
    const fileExcerpts: string[] = [];
    const quoteExcerpts: string[] = [];
    const nonQuoteAttachments: typeof req.attachments = [];
    for (const att of req.attachments ?? []) {
      if (att.kind === "inbox_item" || att.kind === "timeline_event" || att.kind === "notebook_context") {
        const kindLabel =
          att.kind === "inbox_item"
            ? "收件箱事项"
            : att.kind === "timeline_event"
              ? "时间线事件"
              : "项目 Notebook 上下文";
        const idTag = att.refId ? ` id=${att.refId}` : "";
        const quoteBody = (att.textExcerpt?.trim() || att.meta || "").slice(0, 12_000);
        quoteExcerpts.push(
          `[引用事项 · ${kindLabel}${idTag} · ${att.name}]${quoteBody ? `\n${quoteBody}` : ""}`,
        );
        continue;
      }
      nonQuoteAttachments.push(att);
      if (att.kind === "image" || att.kind === "screen") {
        let base64Data = "";
        let mimeType = att.mimeType || "image/png";
        if (att.dataUrl) {
          const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(
            att.dataUrl.trim(),
          );
          if (match?.[1] && match?.[2]) {
            mimeType = match[1];
            base64Data = match[2];
          }
        } else if (att.path && existsSync(att.path)) {
          try {
            const st = statSync(att.path);
            if (st.isFile() && st.size > 0 && st.size <= 3.2 * 1024 * 1024) {
              base64Data = readFileSync(att.path).toString("base64");
              if (!att.mimeType) {
                mimeType = /\.(jpe?g)$/i.test(att.path)
                  ? "image/jpeg"
                  : "image/png";
              }
            }
          } catch {
            // Ignore unreadable local image path
          }
        }
        if (base64Data) {
          imageBlocks.push({
            type: "image",
            data: base64Data,
            mimeType,
          });
        }
      } else if (att.kind === "file") {
        let excerpt = att.textExcerpt?.trim() ?? "";
        if (!excerpt && att.path && existsSync(att.path)) {
          try {
            const st = statSync(att.path);
            if (st.isFile() && st.size > 0 && st.size <= 64 * 1024) {
              excerpt = readFileSync(att.path, "utf8").slice(0, 12_000).trim();
            }
          } catch {
            // Ignore unreadable file path
          }
        }
        if (excerpt) {
          fileExcerpts.push(`[文件内容 · ${att.name}]\n${excerpt.slice(0, 12_000)}`);
        }
      }
    }

    const attachSummary =
      nonQuoteAttachments.length > 0
        ? `\n\n[附件上下文: ${nonQuoteAttachments.map((a) => `${a.name}${a.meta ? ` (${a.meta})` : ""}`).join("、")}]`
        : "";
    const excerptBlock =
      fileExcerpts.length > 0 ? `\n\n${fileExcerpts.join("\n\n")}` : "";
    const quoteBlock =
      quoteExcerpts.length > 0
        ? `\n\n${quoteExcerpts.join("\n\n")}\n\n[引用事项交互说明]\n以上是用户从收件箱或时间线引用的具体事项详情。若用户在提问或核实细节，请直接结合以上载荷、判断依据与只读探测工具解答；若用户明确指示批准、执行（含指定部分子项）、忽略或还原该事项，请调用 \`item_resolve\` 工具完成处理。`
        : "";
    const mentionPrefix = mentionPlugin ? `@${mentionPlugin.name} ` : "";
    const inputText = `${mentionPrefix}${req.prompt}${attachSummary}${excerptBlock}${quoteBlock}`;
    const submitContent =
      imageBlocks.length > 0
        ? [{ type: "text" as const, text: inputText }, ...imageBlocks]
        : inputText;

    this.turnSideEffects.set(conv.id, { inboxIds: [], timelineIds: [] });

    const stepMap = new Map<string, ChatStreamStep>();
    const baselineEntryIds = new Set<EntryId>();
    let lastStreamSig = "";
    let lastPartialText = "";
    let lastThinkingText = "正在思考与分析…";
    let lastPhase: ChatStreamPayload["phase"] = "thinking";

    const emitStream = (pending?: PendingPermissionRequest) => {
      const steps = [...stepMap.values()];
      const activePending =
        pending !== undefined
          ? pending
          : this.permissionCoordinator.getPending(req.chatId);
      const payload: ChatStreamPayload = {
        chatId: req.chatId,
        phase: activePending ? "tools" : lastPhase,
        partialText: lastPartialText || undefined,
        thinkingText: activePending
          ? activePending.toolName === "ask_user"
            ? "等待你的回答或确认…"
            : "等待你的权限批准…"
          : lastThinkingText,
        steps: steps.length > 0 ? steps : undefined,
        ...(activePending ? { pendingPermission: activePending } : {}),
      };
      const sig = JSON.stringify(payload);
      if (sig !== lastStreamSig) {
        lastStreamSig = sig;
        this.bridge.notifyHost("host.chatStream", payload);
      }
    };

    this.permissionCoordinator.setInteractiveChat(
      req.chatId,
      Boolean(req.interactive),
    );
    this.permissionCoordinator.registerStreamEmitter(req.chatId, (pending) => {
      emitStream(pending);
    });

    const collectEntriesIntoStepMap = (entries: readonly EntryRecord[]) => {
      for (const entry of entries) {
        if (baselineEntryIds.has(entry.id)) continue;
        if (AssistantEntry.is(entry)) {
          const msg = entry.model?.[0] as AssistantMessage | undefined;
          if (!msg || !Array.isArray(msg.content)) continue;
          for (const block of msg.content) {
            if (block.type !== "toolCall") continue;
            const prev = stepMap.get(block.id);
            const args =
              block.arguments && typeof block.arguments === "object"
                ? (block.arguments as Record<string, unknown>)
                : undefined;
            stepMap.set(block.id, {
              id: block.id,
              name: block.name,
              label: prev?.label || humanizeToolStepLabel(block.name, args),
              status:
                prev?.status === "done" || prev?.status === "error"
                  ? prev.status
                  : "running",
              detail: prev?.detail,
            });
          }
        } else if (ToolResultEntry.is(entry)) {
          const toolMsg = entry.model?.[0] as ToolResultMessage | undefined;
          if (!toolMsg || !toolMsg.toolCallId) continue;
          const rawText = (toolMsg.content ?? [])
            .map((b) => (b.type === "text" ? b.text : ""))
            .filter(Boolean)
            .join("\n");
          const isApproval = rawText.includes("NEEDS_APPROVAL(");
          const prev = stepMap.get(toolMsg.toolCallId);
          stepMap.set(toolMsg.toolCallId, {
            id: toolMsg.toolCallId,
            name: prev?.name || toolMsg.toolName,
            label: prev?.label || humanizeToolStepLabel(toolMsg.toolName),
            status: isApproval ? "done" : toolMsg.isError ? "error" : "done",
            detail: summarizeToolOutput(rawText) ?? prev?.detail,
          });
        }
      }
    };

    let watch: WatchHandle<ConversationView> | null = null;
    try {
      watch = await conv.watch(BACKGROUND_CONTEXT, { min: 20, max: 60 });
      for (const e of watch.value.entries) {
        baselineEntryIds.add(e.id);
      }
      const initialLastEntryId =
        watch.value.entries[watch.value.entries.length - 1]?.id;

      watch.start(async (call) => {
        if (call.kind !== "value") return;
        try {
          const prevStepCount = stepMap.size;
          collectEntriesIntoStepMap(call.value.entries);

          const live = call.value.docs["pi.live"] as LiveState | undefined;
          if (!live && stepMap.size === prevStepCount && stepMap.size === 0 && !lastPartialText) {
            return;
          }

          let rawPartialText = "";
          const partialMsg = live?.generation?.message;
          if (partialMsg && Array.isArray(partialMsg.content)) {
            for (const block of partialMsg.content) {
              if (block.type === "text") rawPartialText += block.text;
            }
          }

          const { cleanText: cleanPartialText } = stripThinkTags(rawPartialText);
          if (cleanPartialText) {
            lastPartialText = cleanPartialText;
          }

          for (const slot of live?.tools ?? []) {
            const prev = stepMap.get(slot.callId);
            const status =
              prev?.status === "done" || prev?.status === "error"
                ? prev.status
                : slot.status === "done"
                  ? "done"
                  : slot.status === "running"
                    ? "running"
                    : "pending";
            stepMap.set(slot.callId, {
              id: slot.callId,
              name: slot.name,
              label: prev?.label || humanizeToolStepLabel(slot.name),
              status,
              detail:
                prev?.detail ||
                (slot.output ? summarizeToolOutput(slot.output) : undefined),
            });
          }

          const steps = [...stepMap.values()];
          const hasText = Boolean(cleanPartialText || lastPartialText);
          lastThinkingText = summarizeStreamStatus(steps, hasText);
          lastPhase = steps.some(
            (s) => s.status === "running" || s.status === "pending",
          )
            ? "tools"
            : hasText
              ? "streaming"
              : "thinking";
          emitStream();
        } catch (err) {
          console.error("[sidecar] watch stream error:", err);
        }
      });

      this.permissionCoordinator.recordUserIntent(req.chatId, req.prompt);

      const submission = await conv.submit(
        {
          type: "input",
          content: submitContent,
          whenBusy: req.whenBusy === "steer" ? "steer" : "followUp",
          requestId: req.requestId,
        },
        BACKGROUND_CONTEXT,
      );

      const settled = await submission.wait(BACKGROUND_CONTEXT);
      let answerText = "";
      if (settled.status === "done" && settled.type === "input") {
        const answerEntry = await conv.commit(
          (tx) => tx.entry(AssistantEntry, settled.answer),
          BACKGROUND_CONTEXT,
        );
        const assistantMsg = answerEntry?.model?.[0];
        if (assistantMsg && assistantMsg.role === "assistant") {
          for (const block of assistantMsg.content) {
            if (block.type === "text") {
              answerText += block.text;
            }
          }
          answerText = stripThinkTags(answerText).cleanText.trim();
        }
      } else if (settled.status === "unanswered") {
        if (settled.reason === "aborted") {
          answerText = lastPartialText
            ? `${lastPartialText}\n\n*(已停止生成)*`
            : "已按你的要求停止生成。";
        } else {
          answerText = `本轮执行未完成（原因：${settled.reason ?? "unknown"}）。`;
        }
      }

      // Inspect newly committed entries for rich card details (`processTable`, `pluginDraft`)
      const { items: recentEntries } = await conv.entries(
        {
          order: "descending",
          ...(initialLastEntryId ? { minEntryId: initialLastEntryId } : {}),
        },
        30,
        undefined,
        BACKGROUND_CONTEXT,
      );

      const newEntries = recentEntries.filter(
        (e) => !(initialLastEntryId && e.id === initialLastEntryId),
      );
      collectEntriesIntoStepMap([...newEntries].reverse());

      const finalSteps: ChatStreamStep[] = [...stepMap.values()].map((s) =>
        s.status === "running" || s.status === "pending"
          ? { ...s, status: "done" }
          : s,
      );

      let processTable: ChatMessage["processTable"] | undefined;
      let pluginDraft: PluginDraftSpec | undefined;

      for (const entry of newEntries) {
        const toolMsg = entry.model?.[0];
        if (ToolResultEntry.is(entry) && toolMsg && toolMsg.role === "toolResult") {
          const det = toolMsg.details as
            | Record<string, unknown>
            | undefined;
          if (det?.processTable && !processTable) {
            processTable = det.processTable as {
              rows: ProcessSampleRow[];
              primaryActionDone?: boolean;
              secondaryActionDone?: boolean;
              autoRuleAdded?: boolean;
            };
          }
          if (det?.pluginDraft && !pluginDraft) {
            pluginDraft = det.pluginDraft as PluginDraftSpec;
          }
        }
      }

      const usage = await harness.snapshot(
        UsageDoc,
        conv.id,
        BACKGROUND_CONTEXT,
      );
      const totalCost = Object.values(usage?.models ?? {}).reduce(
        (acc, u) => acc + (u.cost?.total ?? 0),
        0,
      );

      const effects = this.turnSideEffects.get(conv.id) ?? {
        inboxIds: [],
        timelineIds: [],
      };
      this.turnSideEffects.delete(conv.id);

      const donePayload: ChatStreamPayload = {
        chatId: req.chatId,
        phase: "done",
      };
      this.bridge.notifyHost("host.chatStream", donePayload);

      const metaParts = [
        usingLocalFallback ? "本地管家引擎" : `${ref.provider} · ${ref.modelId}`,
      ];
      if (mentionPlugin) metaParts.push(`@${mentionPlugin.name}`);

      return {
        replyMessage: {
          id:
            settled.status === "done" && settled.type === "input"
              ? `msg-${settled.answer}`
              : `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          role: "assistant",
          metaLabel: metaParts.join(" · "),
          createdAt: formatHHMM(),
          content: answerText || "已完成处理。",
          ...(finalSteps.length > 0 ? { steps: finalSteps } : {}),
          ...(processTable ? { processTable } : {}),
          ...(pluginDraft ? { pluginDraft } : {}),
        },
        queuedInboxIds: effects.inboxIds,
        timelineEventIds: effects.timelineIds,
        usageCostDelta: Number(totalCost.toFixed(4)),
        providerUsed: `${ref.provider}/${ref.modelId}`,
      };
    } catch (error) {
      this.turnSideEffects.delete(conv.id);
      this.bridge.notifyHost("host.chatStream", {
        chatId: req.chatId,
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      } satisfies ChatStreamPayload);
      throw error;
    } finally {
      this.permissionCoordinator.abortChat(req.chatId, "回合已结束");
      this.permissionCoordinator.setInteractiveChat(req.chatId, false);
      this.permissionCoordinator.unregisterStreamEmitter(req.chatId);
      if (watch) {
        await watch.stop().catch(() => {});
      }
    }
  }

  resolvePermission(req: ResolvePermissionRequest): { resolved: boolean } {
    return { resolved: this.permissionCoordinator.resolve(req) };
  }

  async abortChat(chatId: string): Promise<{ aborted: boolean }> {
    this.permissionCoordinator.abortChat(chatId, "已停止生成");
    const conv = this.activeConversationHandles.get(chatId);
    if (!conv) return { aborted: false };
    await conv.abort(BACKGROUND_CONTEXT);
    return { aborted: true };
  }

  async dispatchPluginEvent(req: DispatchPluginEventRequest): Promise<{
    handled: boolean;
    policy: string;
    replyText: string;
    queuedInboxIds: string[];
    timelineEventIds: string[];
    workflowRunId?: string;
  }> {
    const plugin = this.state.plugins.find((p) => p.id === req.pluginId);
    if (!plugin || !plugin.installed || !plugin.enabled) {
      return {
        handled: false,
        policy: "disabled",
        replyText: "插件未启用",
        queuedInboxIds: [],
        timelineEventIds: [],
      };
    }

    const policy =
      plugin.events.find((e) => e.id === req.eventCode)?.policy ?? "ask";
    if (policy === "record") {
      const recorded = await this.bridge.callHost<{ timelineEventId: string }>(
        "host.recordTimelineEvent",
        {
          pluginId: plugin.id,
          pluginName: plugin.name,
          eventCode: req.eventCode,
          title: `${req.simulated ? "模拟事件：" : ""}${plugin.name} 捕获 ${req.eventCode}`,
          summary: "策略为「仅记录」，已归档到时间线供你随时回溯。",
          status: "completed",
          reasoning: `事件 ${req.eventCode} 策略配置为 record，仅写入时间线。`,
          payload: { ...(req.payload ?? {}), policy: "record" },
        },
      );
      return {
        handled: true,
        policy,
        replyText: "已按「仅记录」策略归档。",
        queuedInboxIds: [],
        timelineEventIds: recorded?.timelineEventId
          ? [recorded.timelineEventId]
          : [],
      };
    }

    if (plugin.executionMode === "workflow") {
      const wf = this.requireWorkflows();
      const detail = await wf.startPluginWorkflow({
        plugin,
        event: req.eventCode,
        source: req.simulated ? "simulate" : "event",
        payload: req.payload ?? {},
        waitForCompletionMs: 4000,
      });
      const tlStatus =
        detail.summary.status === "failed" ||
        detail.summary.status === "cancelled"
          ? "failed"
          : detail.summary.status === "waiting_approval"
            ? "pending_confirm"
            : detail.summary.status === "completed"
              ? "completed"
              : "running";
      const summary =
        detail.summary.errorMessage ||
        `工作流运行状态：${detail.summary.status} (${detail.summary.runId})`;
      const recorded = await this.bridge.callHost<{ timelineEventId: string }>(
        "host.recordTimelineEvent",
        {
          pluginId: plugin.id,
          pluginName: plugin.name,
          eventCode: req.eventCode,
          title: `${req.simulated ? "模拟事件：" : ""}${plugin.name} 工作流 (${req.eventCode})`,
          summary,
          status: tlStatus,
          reasoning: `通过 Workflow 模式本地执行 DAG (${detail.summary.runId})`,
          workflowRunId: detail.summary.runId,
          payload: {
            workflowRunId: detail.summary.runId,
            status: detail.summary.status,
          },
        },
      );
      return {
        handled: true,
        policy,
        replyText: summary,
        queuedInboxIds: [],
        timelineEventIds: recorded?.timelineEventId
          ? [recorded.timelineEventId]
          : [],
        workflowRunId: detail.summary.runId,
      };
    }

    const skillNote = plugin.skillMarkdown?.trim()
      ? `\n\n请严格按照该插件的 Skill 处理逻辑闭环执行：\n${plugin.skillMarkdown.trim()}`
      : "";
    const eventChatId = `event:${plugin.id}`;
    const res = await this.sendChat({
      chatId: eventChatId,
      prompt: `[EVENT_TRIGGER plugin=${plugin.id} event=${req.eventCode} policy=${policy}] payload=${JSON.stringify(req.payload ?? {})}${skillNote}`,
      model: this.state.preferences.models.fast,
    });

    return {
      handled: true,
      policy,
      replyText: res.replyMessage.content,
      queuedInboxIds: res.queuedInboxIds,
      timelineEventIds: res.timelineEventIds,
    };
  }

  async executeApprovedTool(req: ExecuteApprovedToolRequest): Promise<{
    ok: boolean;
    output: string;
  }> {
    const effectiveToolName =
      req.toolName === "disk_move_to_trash" || req.toolName === "app_trash_remnants"
        ? "trash_files"
        : req.toolName === "process_terminate"
          ? "kill_process"
          : req.toolName;
    if (effectiveToolName === "ask_user") {
      return { ok: true, output: "已记录你的确认回复。" };
    }
    const conv = await this.ensureConversation(`approved:${req.inboxId}`);
    const snap = this.registry.snapshot();
    const matched = snap.tools().find((entry) => entry.tool.name === effectiveToolName);
    if (!matched) {
      return { ok: false, output: `Tool not registered: ${effectiveToolName}` };
    }

    const effectiveArgs: Record<string, unknown> = { ...req.toolArgs };
    if (req.checkedPaths && req.checkedPaths.length > 0 && "paths" in effectiveArgs) {
      effectiveArgs.paths = req.checkedPaths;
    }

    const { ref } = this.models.resolveModelRef(
      this.state.preferences.models.fast,
      this.state,
    );
    await conv.configure({ model: ref, maxTurns: 3 }, BACKGROUND_CONTEXT);

    // Approve one-shot tool execution for this internal approved conversation
    this.approvedConversations.add(conv.id);

    const approvalFaux = this.models;
    const resultPromise = new Promise<{ ok: boolean; output: string }>(
      async (resolve) => {
        try {
          // Run tool deterministically inside a local faux step bound cleanly to this turn
          let calledTool = false;
          let finalOut = "";
          approvalFaux.setLocalStewardScript([
            async (ctx) => {
              const msgs = ctx.messages;
              const last = msgs[msgs.length - 1];
              if (!calledTool && last?.role === "user") {
                calledTool = true;
                return fauxAssistantMessage(
                  [
                    fauxThinking(`执行已人工批准的工具 ${effectiveToolName}`),
                    fauxToolCall(effectiveToolName, effectiveArgs as never),
                  ],
                  { stopReason: "toolUse" },
                );
              }
              if (last?.role === "toolResult") {
                finalOut = last.content
                  .map((b) => (b.type === "text" ? b.text : ""))
                  .join("\n");
              }
              return fauxAssistantMessage(finalOut || "已执行批准动作。");
            },
            async (ctx) => {
              const last = ctx.messages[ctx.messages.length - 1];
              if (last?.role === "toolResult") {
                finalOut = last.content
                  .map((b) => (b.type === "text" ? b.text : ""))
                  .join("\n");
              }
              return fauxAssistantMessage(finalOut || "已执行批准动作。");
            },
          ]);

          const forceLocalRef = {
            provider: "valet-local",
            modelId: "valet-steward-local",
          };
          await conv.configure({ model: forceLocalRef }, BACKGROUND_CONTEXT);

          const sub = await conv.submit(
            {
              type: "input",
              content: `Execute approved inbox=${req.inboxId} tool=${req.toolName}`,
              requestId: `approved:${req.inboxId}`,
            },
            BACKGROUND_CONTEXT,
          );
          await sub.wait(BACKGROUND_CONTEXT);
          resolve({ ok: true, output: finalOut || "已执行" });
        } catch (err) {
          resolve({
            ok: false,
            output: err instanceof Error ? err.message : String(err),
          });
        } finally {
          this.approvedConversations.delete(conv.id);
          approvalFaux.setLocalStewardScript([]);
        }
      },
    );

    return resultPromise;
  }

  private async resolveQuestionSourceChatId(
    inboxId: string,
    explicitChatId?: string,
  ): Promise<string> {
    if (explicitChatId?.trim()) {
      return explicitChatId.trim();
    }
    const harness = this.requireHarness();
    const threads = await harness.snapshot(ValetThreadsDoc, BACKGROUND_CONTEXT);
    for (const [chatId, convId] of Object.entries(threads?.map ?? {})) {
      if (chatId.startsWith("approved:")) continue;
      const conv = await harness.conversation(convId, BACKGROUND_CONTEXT);
      if (!conv) continue;
      const { items } = await conv.entries(
        { order: "descending" },
        25,
        undefined,
        BACKGROUND_CONTEXT,
      );
      for (const entry of items) {
        if (!ToolResultEntry.is(entry)) continue;
        const toolMsg = entry.model?.[0] as ToolResultMessage | undefined;
        if (!toolMsg) continue;
        const det = toolMsg.details as
          | { queued?: { inboxId?: string } }
          | undefined;
        if (det?.queued?.inboxId === inboxId) {
          return chatId;
        }
        const text = (toolMsg.content ?? [])
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("\n");
        if (inboxId && text.includes(inboxId)) {
          return chatId;
        }
      }
    }
    return "heartbeat:system";
  }

  async answerInboxQuestion(
    req: AnswerInboxQuestionRequest,
  ): Promise<AnswerInboxQuestionResponse> {
    const resolvedChatId = await this.resolveQuestionSourceChatId(
      req.inboxId,
      req.sourceChatId,
    );
    const model =
      resolvedChatId.startsWith("event:") ||
      resolvedChatId.startsWith("heartbeat:")
        ? this.state.preferences.models.fast ||
          this.state.preferences.models.primary
        : this.state.preferences.models.primary ||
          this.state.preferences.models.fast;
    const prompt = `[INBOX_ANSWER inbox=${req.inboxId}] 用户在收件箱对问题「${req.question}」作出了选择：「${req.answer}」。请严格按用户的这一决定继续处理后续步骤（若用户选择暂不处理、取消或继续观察，仅简短确认即可，不要执行任何修改；也不要再次调用 ask_user 重复提交相同的问题）。`;
    const res = await this.sendChat({
      chatId: resolvedChatId,
      prompt,
      model,
      interactive: false,
    });
    return {
      ok: true,
      resolvedChatId,
      ...res,
    };
  }

  private requireAlwaysOn(): ValetAlwaysOnStore {
    if (!this.alwaysOn) {
      throw new Error("Always-On store is not initialized");
    }
    return this.alwaysOn;
  }

  private buildPluginSkillsMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of this.state.plugins) {
      if (p.installed && p.enabled && p.skillMarkdown?.trim()) {
        out[p.id] = p.skillMarkdown.trim();
      }
    }
    return out;
  }

  private clearWakeupTimer(): void {
    if (this.wakeupTimer !== null) {
      clearTimeout(this.wakeupTimer);
      this.wakeupTimer = null;
    }
  }

  async recomputeWakeup(): Promise<number | null> {
    this.clearWakeupTimer();
    if (!this.alwaysOn || !this.harness || this.state.isPaused) {
      return null;
    }
    const nextAt = await this.alwaysOn.computeNextAlarmAt();
    if (nextAt === null) {
      return null;
    }
    const delayMs = Math.max(0, Math.min(2_147_483_647, nextAt - this.nowFn()));
    this.wakeupTimer = setTimeout(() => {
      this.wakeupTimer = null;
      void this.alwaysOnTick().catch((err) => {
        console.error("[always-on] wakeup tick failed:", err);
      });
    }, delayMs);
    if (typeof this.wakeupTimer === "object" && "unref" in this.wakeupTimer) {
      this.wakeupTimer.unref();
    }
    return nextAt;
  }

  async alwaysOnTick(waitForRun = false): Promise<{
    firedTimers: number;
    claimedRunId: string | null;
    nextAlarmAt: number | null;
  }> {
    let lastFired = 0;
    let lastClaimedRunId: string | null = null;

    this.tickRequested = true;
    if (!this.tickInFlight) {
      this.tickInFlight = (async () => {
        while (this.tickRequested) {
          this.tickRequested = false;
          const res = await this.runAlwaysOnTick();
          lastFired += res.firedTimers;
          if (res.claimedRunId) {
            lastClaimedRunId = res.claimedRunId;
          }
        }
      })().finally(() => {
        this.tickInFlight = null;
      });
    }
    await this.tickInFlight;

    if (waitForRun && this.activeRunPromise) {
      await this.activeRunPromise;
    }
    const nextAlarmAt = await this.recomputeWakeup();
    return {
      firedTimers: lastFired,
      claimedRunId: lastClaimedRunId,
      nextAlarmAt,
    };
  }

  private async runAlwaysOnTick(): Promise<{
    firedTimers: number;
    claimedRunId: string | null;
  }> {
    if (!this.alwaysOn || !this.harness) {
      return { firedTimers: 0, claimedRunId: null };
    }

    // 1. Fire due timers atomically into Event Inbox
    const firedTimers = await this.alwaysOn.fireDueTimers();
    if (firedTimers > 0) {
      this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "timers" });
    }

    // 2. Check active run lease / crash recovery
    const activeRun = await this.alwaysOn.getActiveRun();
    if (activeRun) {
      const orphanedFromPreviousProcess =
        this.activeRunId !== activeRun.id && this.activeRunPromise === null;
      const leaseExpired = this.nowFn() >= activeRun.lease_until;
      if (orphanedFromPreviousProcess || leaseExpired) {
        if (this.activeRunChatId) {
          await this.abortChat(this.activeRunChatId).catch(() => {});
        }
        const reason = orphanedFromPreviousProcess
          ? "run_interrupted_on_restart"
          : "run_lease_expired";
        const failed = await this.alwaysOn.failRun(activeRun.id, reason);
        for (const dl of failed?.deadLetters ?? []) {
          this.bridge.notifyHost("host.outboxNotify", {
            message: dl,
            level: "warn",
          });
        }
        this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "runs" });
      }
    }

    // 3. Claim next ready coalesced batch if worker is idle and not paused
    let claimedRunId: string | null = null;
    if (!this.state.isPaused && !(await this.alwaysOn.getActiveRun())) {
      const claimed = await this.alwaysOn.claimNextBatch({
        pluginSkills: this.buildPluginSkillsMap(),
      });
      if (claimed) {
        claimedRunId = claimed.run.id;
        this.activeRunId = claimed.run.id;
        this.activeRunChatId = claimed.chatId;
        this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "runs" });
        this.activeRunPromise = this.executeClaimedBatch(claimed).finally(() => {
          this.activeRunPromise = null;
        });
      }
    }

    await this.recomputeWakeup();
    return { firedTimers, claimedRunId };
  }

  private async executeClaimedBatch(claimed: ClaimedBatch): Promise<void> {
    const store = this.alwaysOn;
    if (!store) return;

    const conv = await this.ensureConversation(claimed.chatId);
    this.permissionCoordinator.setConversationTainted(
      conv.id,
      claimed.run.tainted === 1,
    );

    const model =
      this.state.preferences.models.fast ||
      this.state.preferences.models.primary;

    try {
      const res = await this.sendChat({
        chatId: claimed.chatId,
        prompt: claimed.promptText,
        model,
        interactive: false,
        requestId: `run:${claimed.run.id}`,
      });
      await store.completeRun(claimed.run.id, res.replyMessage.content, {
        deferredCount: res.queuedInboxIds.length,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const failed = await store.failRun(claimed.run.id, errMsg);
      for (const dl of failed?.deadLetters ?? []) {
        this.bridge.notifyHost("host.outboxNotify", {
          message: dl,
          level: "warn",
        });
      }
    } finally {
      this.permissionCoordinator.setConversationTainted(conv.id, false);
      this.activeRunId = null;
      this.activeRunChatId = null;
      this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "runs" });
      if (this.harness) {
        void this.alwaysOnTick().catch((err) => {
          console.error("[always-on] post-run tick failed:", err);
        });
      }
    }
  }

  async alwaysOnIngest(input: IngestInboxInput): Promise<{
    item: Awaited<ReturnType<ValetAlwaysOnStore["ingestInboxEvent"]>>["item"];
    deduplicated: boolean;
    immediate: boolean;
  }> {
    const store = this.requireAlwaysOn();
    const res = await store.ingestInboxEvent(input);
    if (!res.deduplicated) {
      this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "inbox" });
      if (res.immediate && !this.state.isPaused && !(await store.getActiveRun())) {
        void this.alwaysOnTick().catch((err) => {
          console.error("[always-on] immediate tick failed:", err);
        });
      } else {
        await this.recomputeWakeup();
      }
    }
    return res;
  }

  async alwaysOnSnapshot(opts?: {
    inboxLimit?: number;
    runsLimit?: number;
    timersLimit?: number;
    outboxLimit?: number;
    inboxStatus?: AlwaysOnInboxStatus;
    timerStatus?: AlwaysOnTimerStatus;
  }): Promise<{
    stats: AlwaysOnStats;
    activeRun: AlwaysOnRunRecord | null;
    inbox: Awaited<ReturnType<ValetAlwaysOnStore["listInbox"]>>;
    runs: AlwaysOnRunRecord[];
    timers: AlwaysOnTimerRecord[];
    outbox: { messages: AlwaysOnOutboxMessage[]; unread_count: number };
  }> {
    const store = this.requireAlwaysOn();
    const [stats, activeRunRow, inbox, runs, timers, outbox] = await Promise.all([
      store.getStats(),
      store.getActiveRun(),
      store.listInbox(opts?.inboxLimit ?? 50, opts?.inboxStatus),
      store.listRuns(opts?.runsLimit ?? 30),
      store.listTimers(opts?.timerStatus, opts?.timersLimit ?? 50),
      store.listOutbox(opts?.outboxLimit ?? 50),
    ]);
    const activeRun = activeRunRow
      ? runs.find((r) => r.id === activeRunRow.id) ?? null
      : null;
    return { stats, activeRun, inbox, runs, timers, outbox };
  }

  async alwaysOnRetryInbox(itemId: string) {
    const store = this.requireAlwaysOn();
    const item = await store.retryInboxItem(itemId);
    if (item) {
      this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "inbox" });
      if (!this.state.isPaused && !(await store.getActiveRun())) {
        void this.alwaysOnTick().catch(() => {});
      } else {
        await this.recomputeWakeup();
      }
    }
    return item;
  }

  async alwaysOnCreateTimer(input: CreateTimerInput): Promise<AlwaysOnTimerRecord> {
    const store = this.requireAlwaysOn();
    const timer = await store.createTimer({
      ...input,
      created_by: input.created_by ?? "user",
    });
    await this.recomputeWakeup();
    this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "timers" });
    return timer;
  }

  async alwaysOnCancelTimer(timerId: string): Promise<AlwaysOnTimerRecord | null> {
    const store = this.requireAlwaysOn();
    const timer = await store.cancelTimer(timerId);
    if (timer) {
      await this.recomputeWakeup();
      this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "timers" });
    }
    return timer;
  }

  async alwaysOnMarkOutboxRead(msgId: string): Promise<AlwaysOnOutboxMessage | null> {
    const store = this.requireAlwaysOn();
    const msg = await store.markOutboxRead(msgId);
    if (msg) {
      this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "outbox" });
    }
    return msg;
  }

  async alwaysOnMarkAllOutboxRead(): Promise<{ cleared: number }> {
    const store = this.requireAlwaysOn();
    const cleared = await store.markAllOutboxRead();
    if (cleared > 0) {
      this.bridge.notifyHost("host.alwaysOnUpdate", { scope: "outbox" });
    }
    return { cleared };
  }

  async inspect(): Promise<Record<string, unknown>> {
    const harness = this.requireHarness();
    const state = await harness.inspect(BACKGROUND_CONTEXT);
    const usage = await harness.usage(BACKGROUND_CONTEXT);
    const alwaysOnStats = this.alwaysOn ? await this.alwaysOn.getStats() : null;
    return {
      installedExtensions: this.registry
        .snapshot()
        .installed()
        .map((e) => e.name),
      registeredTools: this.registry
        .snapshot()
        .tools()
        .map((t) => t.tool.name),
      tasksCount: state.tasks.length,
      alwaysOn: alwaysOnStats,
      usage,
    };
  }

  private requireWorkflows(): ValetWorkflowManager {
    if (!this.workflows) {
      throw new Error("ValetWorkflowManager is not initialized");
    }
    return this.workflows;
  }

  private async runWorkflowToolSafely(opts: {
    conversationKey: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
  }): Promise<unknown> {
    const effectiveToolName =
      opts.toolName === "disk_move_to_trash" ||
      opts.toolName === "app_trash_remnants"
        ? "trash_files"
        : opts.toolName === "process_terminate"
          ? "kill_process"
          : opts.toolName;

    const snap = this.registry.snapshot();
    const matched = snap.tools().find((entry) => entry.tool.name === effectiveToolName);
    if (!matched) {
      throw new Error(`Tool not registered: ${effectiveToolName}`);
    }

    const execTask = async () => {
      const conv = await this.ensureConversation(opts.conversationKey);
      let calledTool = false;
      let finalOut = "";
      let toolIsError = false;

      this.models.setLocalStewardScript([
        async (ctx) => {
          const last = ctx.messages[ctx.messages.length - 1];
          if (!calledTool && last?.role === "user") {
            calledTool = true;
            return fauxAssistantMessage(
              [
                fauxThinking(`Workflow 调用内置工具 ${effectiveToolName}`),
                fauxToolCall(effectiveToolName, opts.toolArgs as never),
              ],
              { stopReason: "toolUse" },
            );
          }
          if (last?.role === "toolResult") {
            toolIsError = Boolean(last.isError);
            finalOut = last.content
              .map((b) => (b.type === "text" ? b.text : ""))
              .join("\n");
          }
          return fauxAssistantMessage(finalOut || "done");
        },
        async (ctx) => {
          const last = ctx.messages[ctx.messages.length - 1];
          if (last?.role === "toolResult") {
            toolIsError = Boolean(last.isError);
            finalOut = last.content
              .map((b) => (b.type === "text" ? b.text : ""))
              .join("\n");
          }
          return fauxAssistantMessage(finalOut || "done");
        },
      ]);

      try {
        await conv.configure(
          {
            model: { provider: "valet-local", modelId: "valet-steward-local" },
            maxTurns: 3,
          },
          BACKGROUND_CONTEXT,
        );
        const sub = await conv.submit(
          {
            type: "input",
            content: `Workflow tool step: ${effectiveToolName}`,
            requestId: `${opts.conversationKey}:${Date.now()}`,
          },
          BACKGROUND_CONTEXT,
        );
        await sub.wait(BACKGROUND_CONTEXT);
      } finally {
        this.models.setLocalStewardScript([]);
      }

      if (toolIsError) {
        throw new Error(finalOut || `Tool ${effectiveToolName} failed`);
      }

      let parsedJson: unknown;
      const trimmed = finalOut.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          parsedJson = undefined;
        }
      }

      return {
        tool: effectiveToolName,
        output: finalOut,
        ...(parsedJson !== undefined ? { json: parsedJson } : {}),
      };
    };

    const next = this.fauxScriptQueue.then(execTask, execTask);
    this.fauxScriptQueue = next.catch(() => undefined);
    return await next;
  }

  workflowValidate(yaml: string): WorkflowValidationResponse {
    if (!this.workflows) {
      // Pure schema validation works even before harness init
      const temp = new ValetWorkflowManager(
        this.state.dataDir,
        null,
        {
          getPlugin: (id) => this.state.plugins.find((p) => p.id === id),
          executeTool: async () => undefined,
          runAgentPrompt: async () => undefined,
          emitNotify: async () => undefined,
          queueApproval: async () => ({ queued: false, inboxId: "", token: "" }),
          onRunUpdated: () => undefined,
        },
      );
      return temp.validateYaml(yaml);
    }
    return this.workflows.validateYaml(yaml);
  }

  workflowGetGraph(pluginId: string): WorkflowGraphResponse {
    const plugin = this.state.plugins.find((p) => p.id === pluginId);
    if (!plugin) {
      throw new Error(`插件不存在: ${pluginId}`);
    }
    if (!this.workflows) {
      const temp = new ValetWorkflowManager(
        this.state.dataDir,
        null,
        {
          getPlugin: (id) => this.state.plugins.find((p) => p.id === id),
          executeTool: async () => undefined,
          runAgentPrompt: async () => undefined,
          emitNotify: async () => undefined,
          queueApproval: async () => ({ queued: false, inboxId: "", token: "" }),
          onRunUpdated: () => undefined,
        },
      );
      return temp.getPluginGraph(plugin);
    }
    return this.workflows.getPluginGraph(plugin);
  }

  async workflowStart(req: StartWorkflowRequest): Promise<WorkflowRunDetail> {
    const plugin = this.state.plugins.find((p) => p.id === req.pluginId);
    if (!plugin) {
      throw new Error(`插件不存在: ${req.pluginId}`);
    }
    const wf = this.requireWorkflows();
    return await wf.startPluginWorkflow({
      plugin,
      event: req.event,
      source: req.source,
      summary: req.summary,
      payload: req.payload,
      waitForCompletionMs: req.waitForCompletionMs ?? 1500,
    });
  }

  async workflowListRuns(
    pluginId: string,
    limit?: number,
  ): Promise<WorkflowRunSummary[]> {
    return await this.requireWorkflows().listPluginRuns(pluginId, limit);
  }

  async workflowGetRun(runId: string): Promise<WorkflowRunDetail> {
    return await this.requireWorkflows().getRunDetail(runId);
  }

  async workflowCancelRun(runId: string): Promise<{ cancelled: boolean }> {
    return await this.requireWorkflows().cancelRun(runId);
  }

  async workflowResumeHook(
    req: ResumeWorkflowHookRequest,
  ): Promise<{ resumed: boolean; runId?: string }> {
    return await this.requireWorkflows().resumeHook(req.token, {
      approved: Boolean(req.approved),
      comment: req.comment,
      decidedBy: req.decidedBy || "user",
      decidedAt: new Date().toISOString(),
    });
  }

  async close(): Promise<void> {
    this.clearWakeupTimer();
    await this.workflows?.close();
    this.workflows = null;
    await this.mcp.closeAll();
    if (this.harness) {
      await this.harness.close(BACKGROUND_CONTEXT);
      this.harness = null;
    }
    this.alwaysOn = null;
    if (this.storageClose) {
      await this.storageClose();
      this.storageClose = null;
    }
  }
}

export type { EntryId };
