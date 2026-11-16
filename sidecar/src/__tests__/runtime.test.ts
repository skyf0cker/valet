import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
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
      manifestYaml: "id: com.valet.disk-guard\nname: 磁盘守卫",
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
      manifestYaml: "id: com.valet.process-sentinel\nname: 进程哨兵",
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
      case "host.scanDisk":
        return {
          cleanablePaths: ["/Users/testuser/Downloads/old.ipsw"],
          estimatedReclaimableGB: 4.2,
          items: [{ path: "/Users/testuser/Downloads/old.ipsw", sizeGB: 4.2 }],
        } as T;
      case "host.trashItems":
        return {
          movedCount: Array.isArray(params.paths) ? params.paths.length : 0,
          reclaimedGB: Number(params.estimatedGB ?? 4.2),
          trashBatchId: "trash-test-1",
        } as T;
      case "host.sampleProcesses":
        return {
          cpuPct: 48,
          memPct: 62,
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
        } as T;
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
      case "host.executePluginAction": {
        this.pluginActions.push(params);
        return { ok: true, actionId: params.actionId } as T;
      }
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
});
