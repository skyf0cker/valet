import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { WatchHandle } from "@earendil-works/chord/watch";
import {
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
  ToolPolicyRegistry,
  createSafetyExtension,
} from "./approval.ts";
import { compilePluginExtension } from "./extensions/plugin-compiler.ts";
import { createStewardCoreExtension } from "./extensions/steward-core.ts";
import { McpClientManager } from "./mcp.ts";
import { ValetModelManager } from "./models.ts";
import type {
  ChatMessage,
  ChatStreamPayload,
  ChatStreamStep,
  DispatchPluginEventRequest,
  ExecuteApprovedToolRequest,
  HostBridge,
  PluginDraftSpec,
  ProbeMcpRequest,
  ProbeMcpResponse,
  ProcessSampleRow,
  SendChatRequest,
  SendChatResponse,
  TestProviderRequest,
  ValetSyncState,
} from "./protocol.ts";
import { openUniversalSqliteStorage } from "./sqlite.ts";

const ValetThreadsDoc = defineDoc<{ map: Record<string, ConversationId> }>({
  kind: "valet.threads",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ map: {} }),
});

const TOOL_STATUS_LABELS: Record<string, string> = {
  disk_scan: "正在扫描磁盘与缓存…",
  disk_move_to_trash: "正在提交安全清理清单…",
  disk_empty_trash: "正在检查废纸篓安全审计…",
  app_scan_remnants: "正在排查应用卸载残留…",
  app_trash_remnants: "正在提交残留清理清单…",
  process_sample: "正在采样系统进程负载…",
  process_terminate: "正在准备安全终止进程…",
  log_summarize_crashes: "正在分析崩溃诊断日志…",
  system_overview: "正在读取系统状态概览…",
  memory_remember: "正在保存本地偏好记忆…",
  plugin_draft_create: "正在起草本地插件规则…",
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
      autonomyLevel: "sensitive_only",
      confirmChecklist: {
        deleteOrOverwrite: true,
        sendMessageOrEmail: true,
        paymentOrSubscription: true,
        runTerminalCommand: true,
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
  readonly models = new ValetModelManager();
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

  constructor(private readonly bridge: HostBridge) {
    this.models.setAvailableToolProvider(
      () => new Set(this.registry.snapshot().tools().map((t) => t.tool.name)),
    );
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
    });
    const coreExt = createStewardCoreExtension({
      bridge: this.bridge,
      getState: () => this.state,
      policyRegistry: this.policyRegistry,
      tracker,
    });

    this.registry.install(safetyExt);
    this.registry.install(coreExt);

    this.syncPluginExtensions(params.state.plugins);
    await this.mcp.syncServers(
      params.state.mcpServers ?? [],
      this.policyRegistry,
      (ext) => this.registry.install(ext),
      (ext) => this.registry.uninstall(ext),
    );

    const storage = await openUniversalSqliteStorage(
      params.dbPath || join(params.state.dataDir, "pi-agent.sqlite"),
      { prefix: "pi_" },
    );
    this.storageClose = () => storage.close(BACKGROUND_CONTEXT);

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
    return { resumed: true };
  }

  private syncPluginExtensions(plugins: ValetSyncState["plugins"]): void {
    const activeIds = new Set<string>();
    for (const plugin of plugins) {
      if (!plugin.installed || !plugin.enabled) continue;
      activeIds.add(plugin.id);

      const sig = JSON.stringify({
        v: plugin.version,
        y: plugin.manifestYaml,
        e: plugin.events.map((ev) => `${ev.id}:${ev.policy}`),
        a: plugin.actions.map((ac) => `${ac.id}:${ac.safety}`),
      });
      const existing = this.installedPluginExts.get(plugin.id);
      if (existing && existing.signature === sig) continue;

      if (existing) {
        this.registry.uninstall(existing.ext);
      }

      const ext = compilePluginExtension({
        plugin,
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
    this.state = nextState;
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
    return { ok: true };
  }

  async testProvider(req: TestProviderRequest): Promise<{
    ok: boolean;
    reply: string;
    latencyMs: number;
  }> {
    return this.models.testProvider(req.provider, req.model);
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
          ? `用户在本条消息中显式 @${mentionPlugin.name}（${mentionPlugin.id}），请优先使用该插件的能力与视角回答。`
          : null,
      },
      BACKGROUND_CONTEXT,
    );

    const imageBlocks: Array<{ type: "image"; data: string; mimeType: string }> = [];
    const fileExcerpts: string[] = [];
    for (const att of req.attachments ?? []) {
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
      req.attachments && req.attachments.length > 0
        ? `\n\n[附件上下文: ${req.attachments.map((a) => `${a.name}${a.meta ? ` (${a.meta})` : ""}`).join("、")}]`
        : "";
    const excerptBlock =
      fileExcerpts.length > 0 ? `\n\n${fileExcerpts.join("\n\n")}` : "";
    const mentionPrefix = mentionPlugin ? `@${mentionPlugin.name} ` : "";
    const inputText = `${mentionPrefix}${req.prompt}${attachSummary}${excerptBlock}`;
    const submitContent =
      imageBlocks.length > 0
        ? [{ type: "text" as const, text: inputText }, ...imageBlocks]
        : inputText;

    this.turnSideEffects.set(conv.id, { inboxIds: [], timelineIds: [] });

    let watch: WatchHandle<ConversationView> | null = null;
    try {
      watch = await conv.watch(BACKGROUND_CONTEXT, { min: 10, max: 30 });
      const initialLastEntryId =
        watch.value.entries[watch.value.entries.length - 1]?.id;

      watch.start(async (call) => {
        if (call.kind !== "value") return;
        const live = call.value.docs["pi.live"] as LiveState | undefined;
        if (!live) return;

        let rawPartialText = "";
        const partialMsg = live.generation?.message;
        if (partialMsg && Array.isArray(partialMsg.content)) {
          for (const block of partialMsg.content) {
            if (block.type === "text") rawPartialText += block.text;
          }
        }

        const { cleanText: cleanPartialText } = stripThinkTags(rawPartialText);

        const steps: ChatStreamStep[] = (live.tools ?? []).map((slot) => ({
          id: slot.callId,
          name: slot.name,
          status:
            slot.status === "done"
              ? "done"
              : slot.status === "running"
                ? "running"
                : "pending",
          detail: slot.output?.slice(0, 120),
        }));

        const statusText = summarizeStreamStatus(
          steps,
          Boolean(cleanPartialText),
        );

        const payload: ChatStreamPayload = {
          chatId: req.chatId,
          phase:
            steps.some((s) => s.status === "running" || s.status === "pending")
              ? "tools"
              : cleanPartialText
                ? "streaming"
                : "thinking",
          partialText: cleanPartialText || undefined,
          thinkingText: statusText,
          steps: steps.length > 0 ? steps : undefined,
        };
        this.bridge.notifyHost("host.chatStream", payload);
      });

      const submission = await conv.submit(
        {
          type: "input",
          content: submitContent,
          whenBusy: "followUp",
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
        answerText = `本轮执行未完成（原因：${settled.reason ?? "aborted"}）。`;
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

      let processTable: ChatMessage["processTable"] | undefined;
      let pluginDraft: PluginDraftSpec | undefined;

      for (const entry of recentEntries) {
        if (initialLastEntryId && entry.id === initialLastEntryId) continue;
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
          id: `msg-${Date.now().toString(36)}`,
          role: "assistant",
          metaLabel: metaParts.join(" · "),
          createdAt: formatHHMM(),
          content: answerText || "已完成处理。",
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
      if (watch) {
        await watch.stop().catch(() => {});
      }
    }
  }

  async abortChat(chatId: string): Promise<{ aborted: boolean }> {
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

    const eventChatId = `event:${plugin.id}`;
    const res = await this.sendChat({
      chatId: eventChatId,
      prompt: `[EVENT_TRIGGER plugin=${plugin.id} event=${req.eventCode}] payload=${JSON.stringify(req.payload ?? {})}`,
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
    const conv = await this.ensureConversation(`approved:${req.inboxId}`);
    const snap = this.registry.snapshot();
    const matched = snap.tools().find((entry) => entry.tool.name === req.toolName);
    if (!matched) {
      return { ok: false, output: `Tool not registered: ${req.toolName}` };
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
    const savedResponses = undefined;
    void savedResponses;

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
                    fauxThinking(`执行已人工批准的工具 ${req.toolName}`),
                    fauxToolCall(req.toolName, effectiveArgs as never),
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

  async inspect(): Promise<Record<string, unknown>> {
    const harness = this.requireHarness();
    const state = await harness.inspect(BACKGROUND_CONTEXT);
    const usage = await harness.usage(BACKGROUND_CONTEXT);
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
      usage,
    };
  }

  async close(): Promise<void> {
    await this.mcp.closeAll();
    if (this.harness) {
      await this.harness.close(BACKGROUND_CONTEXT);
      this.harness = null;
    }
    if (this.storageClose) {
      await this.storageClose();
      this.storageClose = null;
    }
  }
}

export type { EntryId };
