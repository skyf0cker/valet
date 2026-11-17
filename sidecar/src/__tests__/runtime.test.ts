import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { evaluateToolPolicy } from "../approval.ts";
import type {
  HostBridge,
  PluginState,
  QueueApprovalParams,
  ValetSyncState,
} from "../protocol.ts";
import { ValetDurableRuntime } from "../runtime.ts";

function makeBaseState(dataDir: string): ValetSyncState {
  const plugins: PluginState[] = [
    {
      id: "disk-guard",
      slug: "disk-guard",
      name: "磁盘守卫",
      tagline: "空间不足时自动清理缓存与垃圾",
      description: "测试磁盘守卫插件",
      version: "v1.2.0",
      bundleId: "com.valet.disk-guard",
      source: "core",
      enabled: true,
      installed: true,
      events: [
        { id: "disk.low_space", description: "low space", policy: "auto", count24h: 1 },
        { id: "disk.large_file", description: "large file", policy: "ask", count24h: 2 },
      ],
      actions: [
        { id: "disk.scan", safety: "readonly", safetyLabel: "只读" },
        { id: "disk.move_to_trash", safety: "reversible", safetyLabel: "可撤销" },
      ],
      config: {},
      manifestYaml: `id: com.valet.disk-guard
name: 磁盘守卫
version: 1.2.0
actions:
  - id: disk.scan
    tool: disk_scan
    driver: fs.scan_cleanable
    safety: readonly
    category: files
  - id: disk.move_to_trash
    tool: disk_move_to_trash
    driver: fs.trash
    event: disk.large_file
    safety: reversible
    category: files
    checklist: deleteOrOverwrite`,
    },
    {
      id: "process-sentinel",
      slug: "process-sentinel",
      name: "进程哨兵",
      tagline: "进程采样与异常终止",
      description: "测试进程哨兵插件",
      version: "v1.0.4",
      bundleId: "com.valet.process-sentinel",
      source: "core",
      enabled: true,
      installed: true,
      events: [
        { id: "process.cpu_spike", description: "cpu spike", policy: "ask", count24h: 1 },
      ],
      actions: [
        { id: "process.sample", safety: "readonly", safetyLabel: "只读" },
        { id: "process.terminate", safety: "confirm_always", safetyLabel: "每次确认" },
      ],
      config: {},
      manifestYaml: `id: com.valet.process-sentinel
name: 进程哨兵
version: 1.0.4
actions:
  - id: process.sample
    tool: process_sample
    driver: proc.sample
    safety: readonly
    category: process
    ui_card: process_table
  - id: process.terminate
    tool: process_terminate
    driver: proc.signal
    safety: confirm_always
    category: process
    checklist: runTerminalCommand`,
    },
  ];

  return {
    homeDir: "/Users/testuser",
    dataDir,
    isPaused: false,
    preferences: {
      language: "简体中文",
      models: { primary: "claude-opus-4", fast: "claude-haiku-4", vision: "同主模型" },
      activeProviderId: "anthropic",
      dailySpendCurrent: 0,
      dailySpendLimit: 30,
      maxStepsPerTask: 20,
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
      blockedApps: ["1Password", "钥匙串访问"],
      thresholds: {
        diskLowSpacePct: 15,
        cacheBloatGB: "5 GB",
        largeFileSizeGB: "2 GB",
        largeFileIdleDays: "90 天",
        cpuSpikePct: "200%",
        cpuSpikeDuration: "5 分钟",
        memoryPressureLevel: "red",
        ignoredProcesses: ["Xcode"],
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
    providers: [
      {
        id: "anthropic",
        name: "Anthropic",
        apiKey: "sk-ant-api03-mock-92a4c0e8d1b57f3a",
        baseUrl: "https://api.anthropic.com",
        endpoint: "",
        verified: true,
        models: ["claude-opus-4", "claude-haiku-4"],
        connected: true,
      },
    ],
    plugins,
    memories: [{ id: "m1", content: "禁止清理 ~/Projects", source: "测试", createdAt: "2026-11-16" }],
  };
}

class FakeHostBridge implements HostBridge {
  readonly queued: QueueApprovalParams[] = [];
  readonly recorded: Record<string, unknown>[] = [];
  readonly pluginActions: Record<string, unknown>[] = [];
  readonly streamEvents: unknown[] = [];

  async callHost<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    switch (method) {
      case "host.plugin.invoke": {
        const pluginId = String(params.pluginId ?? "");
        const actionId = String(params.actionId ?? "");
        const driver = String(params.driver ?? "");
        const args = (params.args ?? {}) as Record<string, unknown>;
        this.pluginActions.push(params);

        if (driver === "fs.scan_cleanable") {
          return {
            ok: true,
            driver,
            summary: "扫描完成",
            data: {
              cleanablePaths: ["/Users/testuser/Downloads/old.ipsw"],
              estimatedReclaimableGB: 4.2,
              items: [{ path: "/Users/testuser/Downloads/old.ipsw", sizeGB: 4.2 }],
            },
          } as T;
        }
        if (driver === "fs.trash") {
          const paths = Array.isArray(args.paths) ? args.paths : [];
          return {
            ok: true,
            driver,
            summary: "已移入废纸篓",
            movedCount: paths.length,
            reclaimedGB: Number(args.estimatedGB ?? 4.2),
            trashBatchId: "trash-test-1",
            data: { movedCount: paths.length, reclaimedGB: Number(args.estimatedGB ?? 4.2) },
          } as T;
        }
        if (driver === "proc.sample") {
          return {
            ok: true,
            driver,
            summary: "采样完成",
            rows: [
              {
                id: "p1",
                name: "vite",
                pid: 48211,
                cpuPct: 210,
                memLabel: "1.9 GB",
                sourceLabel: "Terminal",
                severity: "high",
              },
            ],
            data: { cpuPct: 48, memPct: 62 },
          } as T;
        }
        return {
          ok: true,
          driver,
          summary: `${pluginId}.${actionId} executed`,
          data: { ok: true, actionId },
        } as T;
      }
      case "host.queueApproval": {
        this.queued.push(params as unknown as QueueApprovalParams);
        return {
          inboxId: `inbox-test-${this.queued.length}`,
          timelineEventId: `evt-test-${this.queued.length}`,
        } as T;
      }
      case "host.recordTimelineEvent": {
        this.recorded.push(params);
        return { timelineEventId: `evt-rec-${this.recorded.length}` } as T;
      }
      case "host.kernel.overview":
      case "host.systemOverview":
        return {
          diskPct: 82,
          diskFreeGB: 78,
          cpuPct: 18,
          memPct: 55,
          enabledPlugins: 2,
        } as T;
      default:
        return {} as T;
    }
  }

  notifyHost(_method: string, params?: unknown): void {
    this.streamEvents.push(params);
  }
}

describe("ValetDurableRuntime", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("enforces protected directories & blocked apps in policy engine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-policy-"));
    tempDirs.push(dir);
    const state = makeBaseState(dir);

    const protectedDecision = evaluateToolPolicy(
      {
        toolName: "disk_move_to_trash",
        pluginId: "disk-guard",
        pluginName: "磁盘守卫",
        actionId: "disk.move_to_trash",
        eventCode: "disk.large_file",
        safety: "reversible",
        category: "files",
        iconKind: "disk",
        reversible7d: true,
        approveLabel: "移入废纸篓",
        dismissLabel: "保留",
      },
      { paths: ["/Users/testuser/Projects/my-repo"] },
      state,
      false,
    );
    expect(protectedDecision.outcome).toBe("deny");

    const blockedProcDecision = evaluateToolPolicy(
      {
        toolName: "process_terminate",
        pluginId: "process-sentinel",
        pluginName: "进程哨兵",
        actionId: "process.terminate",
        eventCode: "process.cpu_spike",
        safety: "confirm_always",
        category: "process",
        iconKind: "pulse",
        warningTag: "不可撤销",
        reversible7d: false,
        approveLabel: "结束进程",
        dismissLabel: "忽略",
      },
      { pid: 999, name: "1Password" },
      state,
      true,
    );
    expect(blockedProcDecision.outcome).toBe("deny");
  });

  it("blocks mutating tool via beforeTool hook -> queues Inbox approval -> executes on approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-rt-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "pi-agent.sqlite");
    const bridge = new FakeHostBridge();
    const state = makeBaseState(dir);
    const rt = new ValetDurableRuntime(bridge);

    await rt.init({ dbPath, state });

    const cleanRes = await rt.sendChat({
      chatId: "chat-clean-1",
      prompt: "/clean 清理大文件",
      model: "claude-opus-4",
      requestId: "req-clean-1",
    });

    expect(bridge.queued.length).toBe(1);
    expect(bridge.queued[0]!.toolName).toBe("disk_move_to_trash");
    expect(cleanRes.queuedInboxIds).toEqual(["inbox-test-1"]);
    expect(cleanRes.replyMessage.content).toContain("收件箱");

    // Now approve & execute via runtime.executeApprovedTool
    const execRes = await rt.executeApprovedTool({
      inboxId: "inbox-test-1",
      toolName: "disk_move_to_trash",
      toolArgs: bridge.queued[0]!.toolArgs,
    });
    expect(execRes.ok).toBe(true);
    expect(bridge.recorded.length).toBeGreaterThanOrEqual(1);

    await rt.close();
  });

  it("persists durable threads across SQLite reopen and hot-reloads custom YAML plugin tools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-reopen-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "pi-agent.sqlite");
    const bridge = new FakeHostBridge();
    const state = makeBaseState(dir);

    const rt1 = new ValetDurableRuntime(bridge);
    await rt1.init({ dbPath, state });

    const draftRes = await rt1.sendChat({
      chatId: "chat-plugin-1",
      prompt: "/plugin 帮我写个 .dmg 自动清理规则",
      model: "claude-opus-4",
    });
    expect(draftRes.replyMessage.pluginDraft).toBeDefined();
    expect(draftRes.replyMessage.pluginDraft?.manifestYaml).toContain("fs.file_created");
    await rt1.close();

    // Reopen a brand new Runtime instance against the same SQLite database + add a custom YAML plugin
    const bridge2 = new FakeHostBridge();
    const rt2 = new ValetDurableRuntime(bridge2);
    const customPlugin: PluginState = {
      id: "dmg-sweeper",
      slug: "dmg-sweeper",
      name: "dmg 清扫员",
      tagline: "自动清理 .dmg",
      description: "清理已安装应用的 dmg 文件",
      version: "v0.1.0",
      bundleId: "local.valet.dmg-sweeper",
      source: "local",
      enabled: true,
      installed: true,
      events: [
        { id: "fs.file_created", description: "dmg created", policy: "auto", count24h: 0 },
      ],
      actions: [{ id: "move_to_trash", safety: "reversible", safetyLabel: "可撤销" }],
      config: {},
      manifestYaml: `id: local.valet.dmg-sweeper
name: dmg 清扫员
triggers:
  - event: fs.file_created
actions:
  - move_to_trash`,
    };
    state.plugins.push(customPlugin);
    await rt2.init({ dbPath, state });

    const info = await rt2.inspect();
    const toolNames = info.registeredTools as string[];
    expect(toolNames).toContain("plugin_dmg_sweeper_move_to_trash");

    // Invoke custom YAML plugin tool via scripted model response & verify host bridge ran it
    rt2.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("plugin_dmg_sweeper_move_to_trash", {
              path: "/Users/testuser/Downloads/Valet.dmg",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("已通过自定义 YAML 插件触发动作。"),
    ]);

    const res2 = await rt2.sendChat({
      chatId: "chat-plugin-1", // Reuses persisted conversation ID across reopen!
      prompt: "帮我运行一下 dmg 清扫员",
      model: "claude-opus-4",
    });
    expect(res2.replyMessage.content).toContain("自定义 YAML 插件");
    expect(bridge2.pluginActions.length).toBe(1);
    expect(bridge2.pluginActions[0]?.pluginId).toBe("dmg-sweeper");

    // Disable the custom plugin and hot-sync -> tool disappears immediately
    state.plugins = state.plugins.map((p) =>
      p.id === "dmg-sweeper" ? { ...p, enabled: false } : p,
    );
    await rt2.syncState(state);
    const infoAfterDisable = await rt2.inspect();
    expect(infoAfterDisable.registeredTools as string[]).not.toContain(
      "plugin_dmg_sweeper_move_to_trash",
    );

    await rt2.close();
  });

  it("unmounts core disk tools when disk-guard disabled, resolves gemini->google keys, and connects real stdio MCP server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-mcp-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "pi-agent.sqlite");
    const mcpScript = join(dir, "echo-mcp.mjs");
    const { writeFile } = await import("node:fs/promises");

    await writeFile(
      mcpScript,
      `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  if (req.id === undefined) return;
  if (req.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "echo-mcp", version: "1.0.0" }, capabilities: {} } }) + "\\n");
  } else if (req.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { tools: [{ name: "echo_ping", description: "Return pong", inputSchema: { type: "object", properties: { msg: { type: "string" } } } }] } }) + "\\n");
  } else if (req.method === "tools/call") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "pong:" + (req.params?.arguments?.msg ?? "") }] } }) + "\\n");
  }
});
`,
      "utf8",
    );

    const bridge = new FakeHostBridge();
    const state = makeBaseState(dir);
    state.providers.push({
      id: "gemini",
      name: "Google Gemini",
      apiKey: "AIzaSyLiveRealKeyExample12345",
      baseUrl: "https://generativelanguage.googleapis.com",
      endpoint: "",
      verified: true,
      models: ["gemini-2.5-pro", "gemini-2.5-flash"],
      connected: true,
    });
    state.mcpServers = [
      {
        id: "echo",
        abbr: "ec",
        name: "EchoMCP",
        transport: "stdio",
        command: process.execPath,
        args: ["run", mcpScript],
        transportLabel: "stdio",
        toolCount: 0,
        enabled: true,
      },
    ];

    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath, state });

    // 1. Verify MCP tool was discovered and mounted in Pi Durable registry
    const info = await rt.inspect();
    expect(info.registeredTools as string[]).toContain("mcp_echo_echo_ping");

    // 2. Verify Gemini resolves to Pi AI "google" provider with non-mock key
    const geminiState = {
      ...state,
      preferences: { ...state.preferences, activeProviderId: "gemini" as const },
    };
    const resolvedGemini = rt.models.resolveModelRef("gemini-2.5-pro", geminiState);
    expect(resolvedGemini.usingLocalFallback).toBe(false);
    expect(resolvedGemini.ref.provider).toBe("google");

    // 3. Disabling core `disk-guard` unmounts disk tools cleanly
    state.plugins = state.plugins.map((p) =>
      p.id === "disk-guard" ? { ...p, enabled: false } : p,
    );
    await rt.syncState(state);
    const afterDisable = await rt.inspect();
    expect(afterDisable.registeredTools as string[]).not.toContain("disk_scan");
    expect(afterDisable.registeredTools as string[]).not.toContain("disk_move_to_trash");

    // Calling /clean while disk-guard is disabled gets polite explanation instead of phantom tool call
    const disabledCleanRes = await rt.sendChat({
      chatId: "chat-disabled-disk",
      prompt: "/clean 清理大文件",
      model: "claude-opus-4",
    });
    expect(disabledCleanRes.replyMessage.content).toContain("停用");

    await rt.close();
  });

  it("registers dynamic models for openrouter/openai-compat/anthropic/gemini and never leaks raw thinking to chatStream or replies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-models-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "pi-agent.sqlite");
    const bridge = new FakeHostBridge();
    const state = makeBaseState(dir);
    state.providers = [
      {
        id: "openrouter",
        name: "OpenRouter",
        apiKey: "sk-or-live-test-key",
        baseUrl: "https://openrouter.ai/api/v1",
        endpoint: "",
        verified: true,
        models: ["openrouter/tencent/hy4", "deepseek/deepseek-r1"],
        connected: true,
      },
      {
        id: "openai",
        name: "OpenAI",
        apiKey: "sk-custom-gw-key",
        baseUrl: "https://my-gateway.example.com",
        endpoint: "",
        verified: true,
        models: ["my-custom-gpt"],
        connected: true,
      },
      {
        id: "anthropic",
        name: "Anthropic",
        apiKey: "sk-ant-live-test-key",
        baseUrl: "https://anthropic-proxy.example.com/v1",
        endpoint: "",
        verified: true,
        models: ["claude-sonnet-4-5", "custom-claude-alias"],
        connected: true,
      },
      {
        id: "gemini",
        name: "Google Gemini",
        apiKey: "AIzaSyLiveKey123",
        baseUrl: "https://generativelanguage.googleapis.com",
        endpoint: "",
        verified: true,
        models: ["models/gemini-2.5-pro", "gemini-custom-preview"],
        connected: true,
      },
    ];

    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath, state });

    // OpenRouter registers discovered models on openai-completions and excludes ~* aliases
    const orModels = rt.models.models.getModels("openrouter");
    expect(orModels.some((m) => m.id.startsWith("~"))).toBe(false);
    const hy4 = orModels.find((m) => m.id === "openrouter/tencent/hy4");
    expect(hy4).toBeDefined();
    expect(hy4?.api).toBe("openai-completions");
    const resolvedOR = rt.models.resolveModelRef("openrouter/tencent/hy4", {
      ...state,
      preferences: { ...state.preferences, activeProviderId: "openrouter" },
    });
    expect(resolvedOR.usingLocalFallback).toBe(false);
    expect(resolvedOR.ref).toEqual({
      provider: "openrouter",
      modelId: "openrouter/tencent/hy4",
    });

    // OpenAI custom gateway uses openai-completions + /v1 and registers discovered models
    const oaModel = rt.models.models.getModel("openai", "my-custom-gpt");
    expect(oaModel?.api).toBe("openai-completions");
    expect(oaModel?.baseUrl).toBe("https://my-gateway.example.com/v1");

    // Anthropic strips /v1 so SDK appends /v1/messages cleanly & keeps custom model
    const antModel = rt.models.models.getModel("anthropic", "custom-claude-alias");
    expect(antModel?.baseUrl).toBe("https://anthropic-proxy.example.com");

    // Gemini appends /v1beta and strips models/ prefix
    const gemModel = rt.models.models.getModel("google", "gemini-2.5-pro");
    expect(gemModel?.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(rt.models.models.getModel("google", "gemini-custom-preview")).toBeDefined();

    // Switch back to mock key so sendChat uses local faux steward script to test thinking/tag stripping
    await rt.syncState({
      ...state,
      providers: state.providers.map((p) =>
        p.id === "anthropic" ? { ...p, apiKey: "sk-ant-api03-mock-test" } : p,
      ),
    });

    // Ensure raw thinking monologue & <think> tags never leak to chatStream or replyMessage
    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage([
          fauxThinking(
            "PRIVATE_MONOLOGUE_SHOULD_NOT_LEAK New files found: 163+163+159=485 let me compute internally",
          ),
          {
            type: "text",
            text: "<think>INTERNAL_TAG_THINKING_SHOULD_BE_STRIPPED</think>\n扫描完成，共发现 3 项可清理目标。",
          },
        ]),
    ]);

    const chatRes = await rt.sendChat({
      chatId: "chat-no-leak",
      prompt: "检查一下",
      model: "claude-opus-4",
    });
    expect(chatRes.replyMessage.content).toBe("扫描完成，共发现 3 项可清理目标。");
    expect(chatRes.replyMessage.content).not.toContain("INTERNAL_TAG_THINKING");
    expect(chatRes.replyMessage.content).not.toContain("PRIVATE_MONOLOGUE");

    for (const evt of bridge.streamEvents as Array<{
      thinkingText?: string;
      partialText?: string;
    }>) {
      if (evt.thinkingText) {
        expect(evt.thinkingText).not.toContain("PRIVATE_MONOLOGUE");
      }
      if (evt.partialText) {
        expect(evt.partialText).not.toContain("INTERNAL_TAG_THINKING");
      }
    }

    await rt.close();
  });

  it("enforces concrete paths in inbox_propose_approval and delivers multimodal image blocks for screen attachments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-rt-inbox-screen-"));
    tempDirs.push(dir);

    const bridge = new FakeHostBridge();
    const state = makeBaseState(dir);
    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath: join(dir, "pi.sqlite"), state });

    let invalidToolError = false;
    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("inbox_propose_approval", {
              title: "无路径提案",
              summary: "未传路径的提案应被拒绝",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      (ctx) => {
        const lastTool = [...ctx.messages]
          .reverse()
          .find((m) => m.role === "toolResult");
        if (lastTool?.role === "toolResult") {
          invalidToolError = Boolean(lastTool.isError);
        }
        return fauxAssistantMessage(
          [
            fauxToolCall("inbox_propose_approval", {
              title: "删除测试安装包",
              summary: "包含完整路径的文件清理提案",
              paths: ["/Users/testuser/Downloads/demo.dmg"],
              estimatedGB: 0.4,
            }),
          ],
          { stopReason: "toolUse" },
        );
      },
      () => fauxAssistantMessage("已将具体文件清理提案推入收件箱。"),
    ]);

    const res1 = await rt.sendChat({
      chatId: "chat-propose-1",
      prompt: "提交清理审批",
      model: "claude-opus-4",
    });
    expect(res1.replyMessage.content).toContain("收件箱");
    expect(invalidToolError).toBe(true);
    expect(bridge.queued.length).toBe(1);
    expect(bridge.queued[0]?.actionItems.length).toBe(1);
    expect(bridge.queued[0]?.actionItems[0]?.path).toBe("/Users/testuser/Downloads/demo.dmg");
    expect(bridge.queued[0]?.toolArgs.paths).toEqual(["/Users/testuser/Downloads/demo.dmg"]);

    let receivedImageBlock = false;
    rt.models.setLocalStewardScript([
      (ctx) => {
        const lastUser = [...ctx.messages]
          .reverse()
          .find((m) => m.role === "user");
        if (lastUser?.role === "user" && Array.isArray(lastUser.content)) {
          receivedImageBlock = lastUser.content.some(
            (b) =>
              b.type === "image" &&
              b.mimeType === "image/png" &&
              b.data.length > 10,
          );
        }
        return fauxAssistantMessage("已收到并分析你附加的屏幕截图。");
      },
    ]);

    const tinyPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const res2 = await rt.sendChat({
      chatId: "chat-screen-1",
      prompt: "请看下当前屏幕",
      model: "claude-opus-4",
      attachments: [
        {
          id: "scr-1",
          kind: "screen",
          name: "当前屏幕.png",
          meta: "1×1 · 1 KB",
          badge: "SCR",
          dataUrl: tinyPng,
          mimeType: "image/png",
        },
      ],
    });
    expect(receivedImageBlock).toBe(true);
    expect(res2.replyMessage.content).toContain("屏幕截图");

    await rt.close();
  });
});
