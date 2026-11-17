import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
  evaluateToolPolicy,
  isReadOnlyBashCommand,
} from "../approval.ts";
import type {
  ChatStreamPayload,
  HostBridge,
  PluginState,
  QueueApprovalParams,
  ToolPolicyMeta,
  ValetSyncState,
} from "../protocol.ts";
import { ValetDurableRuntime } from "../runtime.ts";

function makeTestState(dataDir: string): ValetSyncState {
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
      autonomyLevel: "auto_review",
      confirmChecklist: {
        deleteOrOverwrite: true,
        sendMessageOrEmail: true,
        paymentOrSubscription: true,
        runTerminalCommand: true,
        modifySystemSettings: false,
      },
      blockedApps: ["1Password"],
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
        apiKey: "sk-ant-api03-mock-key",
        baseUrl: "https://api.anthropic.com",
        endpoint: "",
        verified: true,
        models: ["claude-opus-4", "claude-haiku-4"],
        connected: true,
      },
    ],
    plugins: [],
    memories: [],
  };
}

class SkillsTestBridge implements HostBridge {
  readonly queued: QueueApprovalParams[] = [];
  readonly recorded: Record<string, unknown>[] = [];
  readonly bashCalls: Record<string, unknown>[] = [];
  readonly writeCalls: Record<string, unknown>[] = [];
  readonly upserts: Record<string, unknown>[] = [];
  private streamListeners: Array<(payload: ChatStreamPayload) => void> = [];

  constructor(private readonly state: ValetSyncState) {}

  onChatStream(fn: (payload: ChatStreamPayload) => void): void {
    this.streamListeners.push(fn);
  }

  async callHost<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    switch (method) {
      case "host.plugin.upsert": {
        this.upserts.push(params);
        const slug = String(params.slug || params.id || "local-plugin");
        const id = String(params.id || slug);
        const newPlugin: PluginState = {
          id,
          slug,
          name: String(params.name || slug),
          tagline: String(params.tagline || "本地开发插件"),
          description: String(params.description || "由单元测试安装的 Action-less 插件"),
          version: "v0.1.0",
          bundleId: `local.valet.${slug}`,
          source: "local",
          enabled: params.enabled !== false,
          installed: true,
          localDir: join(this.state.dataDir, "plugins", slug),
          bundledFiles: ["manifest.yaml", "SKILL.md"],
          events: [
            {
              id: "brew.outdated",
              description: "检测到过期 Homebrew 包",
              policy: "ask",
              sensor: "script_poll",
              count24h: 0,
            },
          ],
          config: { values: {} },
          manifestYaml: String(params.manifestYaml ?? ""),
          skillMarkdown: String(params.skillMarkdown ?? ""),
        };
        this.state.plugins = [...this.state.plugins, newPlugin];
        return { plugin: newPlugin, plugins: this.state.plugins } as T;
      }
      case "host.queueApproval": {
        this.queued.push(params as unknown as QueueApprovalParams);
        return {
          inboxId: `inbox-${this.queued.length}`,
          timelineEventId: `evt-${this.queued.length}`,
        } as T;
      }
      case "host.recordTimelineEvent": {
        this.recorded.push(params);
        return { timelineEventId: `evt-rec-${this.recorded.length}` } as T;
      }
      case "host.kernel.bash": {
        this.bashCalls.push(params);
        return {
          ok: true,
          command: String(params.command ?? ""),
          cwd: String(params.cwd ?? "/Users/testuser"),
          exitCode: 0,
          durationMs: 10,
          output: "ok-bash",
          summary: "exit=0 · ok-bash",
        } as T;
      }
      case "host.kernel.writeFile": {
        this.writeCalls.push(params);
        return {
          ok: true,
          path: String(params.path ?? ""),
          bytesWritten: String(params.content ?? "").length,
        } as T;
      }
      default:
        return {} as T;
    }
  }

  notifyHost(method: string, params?: unknown): void {
    if (method === "host.chatStream" && params) {
      const payload = params as ChatStreamPayload;
      for (const listener of this.streamListeners) {
        listener(payload);
      }
    }
  }
}

describe("Valet Built-in Skills, CLI Policy & Foreground Isolation", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn().catch(() => {});
    }
  });

  it("loads built-in skills and hot-mounts an Action-less plugin via plugin_install", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-skills-cli-"));
    cleanups.push(async () => rm(dir, { recursive: true, force: true }));

    const state = makeTestState(dir);
    state.preferences.autonomyLevel = "full_access";
    const bridge = new SkillsTestBridge(state);
    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath: join(dir, "pi.sqlite"), state });
    cleanups.push(async () => rt.close());

    // Turn 1: skill_load for both built-in skills
    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("skill_load", { name: "valet-plugin-dev" }),
            fauxToolCall("skill_load", { name: "valet-self-config" }),
          ],
          { stopReason: "toolUse" },
        ),
      (ctx) => {
        const texts = ctx.messages
          .filter((m) => m.role === "toolResult")
          .map((m) =>
            m.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n"),
          )
          .join("\n---\n");
        expect(texts).toContain("script_poll");
        expect(texts).toContain("SKILL.md");
        expect(texts).toContain("valet config set");
        return fauxAssistantMessage("已加载插件开发与自配置内置手册。");
      },
    ]);

    const t1 = await rt.sendChat({
      chatId: "chat-skills-load",
      prompt: "加载插件开发和自配置 skill",
      model: "claude-opus-4",
    });
    expect(t1.replyMessage.content).toContain("内置手册");

    // Turn 2: plugin_install hot-mounts Action-less plugin without restarting runtime
    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("plugin_install", {
              slug: "brew-watch",
              name: "Brew 看守",
              manifestYaml: [
                "id: brew-watch",
                "name: Brew 看守",
                "version: 0.1.0",
                "source: local",
                "triggers:",
                "  - id: brew.outdated",
                "    sensor: script_poll",
                "    script: scripts/check-brew.mjs",
                "    interval_sec: 300",
                "    policy: ask",
              ].join("\n"),
              skillMarkdown: "当检测到过期包时使用 bash 检查 brew outdated。",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("已安装并热挂载 brew-watch 插件。"),
    ]);

    const t2 = await rt.sendChat({
      chatId: "chat-plugin-install",
      prompt: "帮我安装 brew-watch 插件",
      model: "claude-opus-4",
    });
    expect(t2.replyMessage.content).toContain("brew-watch");
    expect(bridge.upserts.length).toBe(1);
    expect(rt.getState().plugins.some((p) => p.id === "brew-watch")).toBe(true);

    const sections = rt.registry.snapshot().sections();
    expect(sections.some((s) => s.extension.name === "plugin:brew-watch")).toBe(true);

    // Subsequent dispatch immediately routes to hot-mounted brew-watch plugin without restart
    rt.models.setLocalStewardScript([
      () => fauxAssistantMessage("确认已在同会话挂载 brew-watch 技能并响应事件。"),
    ]);
    const evtRes = await rt.dispatchPluginEvent({
      pluginId: "brew-watch",
      eventCode: "brew.outdated",
      payload: { formula: "node" },
    });
    expect(evtRes.handled).toBe(true);
    expect(evtRes.replyText).toContain("brew-watch");
  });

  it("enforces valet CLI read/self_config/guardrail policies and allowUnsignedLocal", () => {
    const dir = join(tmpdir(), "valet-policy-check");
    const state = makeTestState(dir);
    state.preferences.autonomyLevel = "auto_review";
    state.preferences.confirmChecklist.modifySystemSettings = false;
    state.preferences.confirmChecklist.runTerminalCommand = true;

    const bashPolicy: ToolPolicyMeta = {
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
    };

    // Read-only valet CLI commands
    expect(isReadOnlyBashCommand("valet status --json")).toBe(true);
    expect(
      evaluateToolPolicy(bashPolicy, { command: "valet status --json" }, state, false)
        .outcome,
    ).toBe("allow");

    // Non-guardrail self-config under auto_review (modifySystemSettings=false) -> review
    expect(
      evaluateToolPolicy(
        bashPolicy,
        { command: "valet config set appearance=dark" },
        state,
        false,
      ).outcome,
    ).toBe("review");

    // Non-guardrail self-config under full_access -> allow
    const fullAccessState: ValetSyncState = {
      ...state,
      preferences: { ...state.preferences, autonomyLevel: "full_access" },
    };
    expect(
      evaluateToolPolicy(
        bashPolicy,
        { command: "valet config set appearance=dark" },
        fullAccessState,
        false,
      ).outcome,
    ).toBe("allow");

    // Non-guardrail self-config under always_ask -> ask
    const alwaysAskState: ValetSyncState = {
      ...state,
      preferences: { ...state.preferences, autonomyLevel: "always_ask" },
    };
    expect(
      evaluateToolPolicy(
        bashPolicy,
        { command: "valet config set appearance=dark" },
        alwaysAskState,
        false,
      ).outcome,
    ).toBe("ask");

    // Guardrail valet commands ALWAYS require ask under both auto_review and full_access when not pre-approved
    for (const checkState of [state, fullAccessState]) {
      for (const cmd of [
        "valet config set autonomyLevel=full_access",
        "valet provider set openai --api-key sk-123",
        "valet plugin remove foo --delete-files",
      ]) {
        const decision = evaluateToolPolicy(bashPolicy, { command: cmd }, checkState, false);
        expect(decision.outcome).toBe("ask");
      }
    }

    // Disabling allowUnsignedLocal blocks plugin_install
    const restrictedState: ValetSyncState = {
      ...state,
      preferences: {
        ...state.preferences,
        pluginRuntime: {
          ...state.preferences.pluginRuntime,
          allowUnsignedLocal: false,
        },
      },
    };
    const installPolicy: ToolPolicyMeta = {
      toolName: "plugin_install",
      pluginId: "valet-core",
      pluginName: "插件管理器",
      actionId: "plugin.install",
      eventCode: "plugin.installed",
      safety: "reversible",
      checklistKey: "modifySystemSettings",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "允许加载插件",
      dismissLabel: "取消",
    };
    expect(
      evaluateToolPolicy(installPolicy, { slug: "test" }, restrictedState, false).outcome,
    ).toBe("deny");
  });

  it("keeps foreground interactive chat tool executions and approvals out of Timeline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-fg-isolated-"));
    cleanups.push(async () => rm(dir, { recursive: true, force: true }));

    const state = makeTestState(dir);
    state.preferences.autonomyLevel = "always_ask";
    const bridge = new SkillsTestBridge(state);
    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath: join(dir, "pi.sqlite"), state });
    cleanups.push(async () => rt.close());

    const seenPermissionRequests: string[] = [];
    bridge.onChatStream((payload) => {
      if (payload.pendingPermission) {
        seenPermissionRequests.push(payload.pendingPermission.requestId);
        rt.resolvePermission({
          chatId: payload.chatId,
          requestId: payload.pendingPermission.requestId,
          decision: "allow_once",
        });
      }
    });

    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("bash", { command: "brew cleanup", reason: "清理缓存" }),
            fauxToolCall("write_file", {
              path: "/Users/testuser/note.txt",
              content: "ok",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("已完成前台清理与文件写入。"),
    ]);

    const res = await rt.sendChat({
      chatId: "chat-fg",
      prompt: "清理并写备注",
      model: "claude-opus-4",
      interactive: true,
    });

    expect(res.replyMessage.content).toContain("已完成");
    expect(seenPermissionRequests.length).toBeGreaterThanOrEqual(1);
    expect(bridge.bashCalls.length).toBe(1);
    expect(bridge.writeCalls.length).toBe(1);
    expect(bridge.queued.length).toBe(0);
    expect(bridge.recorded.length).toBe(0);
  });
});
