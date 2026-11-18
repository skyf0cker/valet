import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { evaluateToolPolicy, isReadOnlyBashCommand } from "../approval.ts";
import { AutoReviewEvaluator, normalizeJevEndpoint } from "../auto-review.ts";
import type {
  ChatStreamPayload,
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
      config: { values: { lowSpaceThresholdPct: 15 } },
      manifestYaml: `id: com.valet.disk-guard
name: 磁盘守卫
version: 1.2.0
triggers:
  - id: disk.low_space
    sensor: script_poll
    script: scripts/poll-disk.mjs
    interval_sec: 60
    emit_on: json
    policy: auto`,
      skillMarkdown: "使用 list_dir 与 trash_files 处理磁盘候选文件。",
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
      config: { values: { sampleIntervalSec: 15 } },
      manifestYaml: `id: com.valet.process-sentinel
name: 进程哨兵
version: 1.0.4
triggers:
  - id: process.cpu_spike
    sensor: script_poll
    script: scripts/poll-cpu.mjs
    interval_config_key: sampleIntervalSec
    interval_sec: 15
    emit_on: json
    policy: ask`,
      skillMarkdown: "使用 system_overview 采样高占用进程，需终止时调用 kill_process。",
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
      autonomyLevel: "auto_review",
      confirmChecklist: {
        deleteOrOverwrite: false,
        sendMessageOrEmail: true,
        paymentOrSubscription: true,
        runTerminalCommand: false,
        modifySystemSettings: false,
      },
      autoReview: {
        engine: "auto",
        jevEndpoint: "https://api.typesafe.ai/v1/systemone",
        jevApiKey: "",
        jevModel: "jev-latest",
        fallbackProviderId: "",
        fallbackModel: "同快速模型",
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
  readonly bashCalls: Record<string, unknown>[] = [];
  readonly listCalls: Record<string, unknown>[] = [];
  readonly readCalls: Record<string, unknown>[] = [];
  readonly writeCalls: Record<string, unknown>[] = [];
  readonly trashCalls: Record<string, unknown>[] = [];
  readonly killCalls: Record<string, unknown>[] = [];
  readonly itemResolveCalls: Record<string, unknown>[] = [];
  readonly streamEvents: ChatStreamPayload[] = [];
  private streamListeners: Array<(payload: ChatStreamPayload) => void> = [];

  onChatStream(fn: (payload: ChatStreamPayload) => void): void {
    this.streamListeners.push(fn);
  }

  async callHost<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    switch (method) {
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
      case "host.kernel.bash": {
        this.bashCalls.push(params);
        return {
          ok: true,
          command: String(params.command ?? ""),
          cwd: String(params.cwd ?? "/Users/testuser"),
          exitCode: 0,
          durationMs: 12,
          output: "mock-bash-output",
          summary: "exit=0 · mock-bash-output",
        } as T;
      }
      case "host.kernel.listDir": {
        this.listCalls.push(params);
        return {
          path: "/Users/testuser/Downloads",
          totalCount: 1,
          entries: [
            {
              name: "old.ipsw",
              path: "/Users/testuser/Downloads/old.ipsw",
              isDir: false,
              sizeBytes: 4200000000,
              modTime: "2026-11-16T00:00:00Z",
            },
          ],
        } as T;
      }
      case "host.kernel.readFile": {
        this.readCalls.push(params);
        return {
          path: String(params.path ?? ""),
          totalLines: 2,
          startLine: 1,
          endLine: 2,
          content: "line1\nline2",
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
      case "host.kernel.trashFiles": {
        this.trashCalls.push(params);
        const paths = Array.isArray(params.paths) ? params.paths : [];
        return {
          ok: true,
          batchId: "trash-test-1",
          movedCount: paths.length,
          reclaimedGB: 4.2,
          summary: `已将 ${paths.length} 项移入废纸篓（释放约 4.20 GB，7 天内可还原）`,
        } as T;
      }
      case "host.kernel.killProcess": {
        this.killCalls.push(params);
        return {
          ok: true,
          pid: Number(params.pid ?? 0),
          name: String(params.name ?? ""),
          signal: String(params.signal ?? "SIGTERM"),
          summary: `已终止进程 ${String(params.name ?? "")}`,
        } as T;
      }
      case "host.item.resolve": {
        this.itemResolveCalls.push(params);
        return {
          ok: true,
          source: String(params.source ?? "inbox"),
          id: String(params.id ?? ""),
          action: String(params.action ?? "approve"),
          summary: `已处理事项 ${String(params.id ?? "")} (${String(params.action ?? "approve")})`,
        } as T;
      }
      case "host.kernel.overview":
      case "host.systemOverview":
        return {
          diskPct: 82,
          diskFreeGB: 78,
          cpuPct: 18,
          memPct: 55,
          enabledPlugins: 2,
          topProcesses: [
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
      default:
        return {} as T;
    }
  }

  notifyHost(method: string, params?: unknown): void {
    if (method === "host.chatStream" && params) {
      const payload = params as ChatStreamPayload;
      this.streamEvents.push(payload);
      for (const listener of this.streamListeners) {
        listener(payload);
      }
    }
  }
}

const CORE_PLUGIN_TOOLS = new Set([
  "plugin_draft_create",
  "plugin_list",
  "plugin_inspect",
  "plugin_install",
  "plugin_reload",
  "plugin_configure",
  "plugin_trigger",
  "plugin_remove",
]);

describe("ValetDurableRuntime", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("enforces protected directories, blocked apps, and read-only plugin scripts in policy engine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-policy-"));
    tempDirs.push(dir);
    const state = makeBaseState(dir);

    const protectedDecision = evaluateToolPolicy(
      {
        toolName: "trash_files",
        pluginId: "valet-core",
        pluginName: "Valet Core",
        actionId: "fs.trash",
        eventCode: "fs.cleaned",
        safety: "reversible",
        checklistKey: "deleteOrOverwrite",
        category: "files",
        iconKind: "trash",
        reversible7d: true,
        approveLabel: "移入废纸篓",
        dismissLabel: "拒绝",
      },
      { paths: ["/Users/testuser/Projects/my-repo"] },
      state,
      false,
    );
    expect(protectedDecision.outcome).toBe("deny");

    const blockedProcDecision = evaluateToolPolicy(
      {
        toolName: "kill_process",
        pluginId: "valet-core",
        pluginName: "Valet Core",
        actionId: "proc.kill",
        eventCode: "process.terminated",
        safety: "confirm_always",
        checklistKey: "runTerminalCommand",
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

    expect(
      isReadOnlyBashCommand(
        'bun "/Users/testuser/.valet/plugins/surge-doctor/scripts/import-logs.mjs" --minutes 360',
      ),
    ).toBe(true);
    expect(isReadOnlyBashCommand("surge-cli flush dns")).toBe(false);

    // Expanded macOS read-only inspection idioms & compound segments
    expect(
      isReadOnlyBashCommand(
        'ls -d /Applications/Qoder.app 2>/dev/null && pgrep -ifl qoder || echo "not running"',
      ),
    ).toBe(true);
    expect(
      isReadOnlyBashCommand(
        'ls -lh ~/Desktop/ | head -30; echo "---hidden:"; hdiutil info 2>/dev/null | grep "image-path" || true',
      ),
    ).toBe(true);
    expect(
      isReadOnlyBashCommand(
        "memory_pressure | tail -3; sysctl hw.memsize hw.ncpu machdep.cpu.brand_string 2>/dev/null",
      ),
    ).toBe(true);
    expect(
      isReadOnlyBashCommand(
        'f="/Users/testuser/Library/Application Support/Surge/Profiles/custom.conf"; sed -n "50,54p" "$f"',
      ),
    ).toBe(true);
    expect(isReadOnlyBashCommand("(cd ~/Downloads && ls -la)")).toBe(true);
    expect(isReadOnlyBashCommand("ls ~/Downloads 2> /dev/null >/dev/null")).toBe(true);
    expect(isReadOnlyBashCommand("(rm -rf /tmp/foo && ls)")).toBe(false);
    expect(isReadOnlyBashCommand("cat <(echo hi)")).toBe(false);

    // Autonomy modes: always_ask vs auto_review vs full_access (hard redlines stay deny)
    const mutatingBashMeta = {
      toolName: "bash",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "shell.bash",
      eventCode: "system.command",
      safety: "reversible" as const,
      checklistKey: "runTerminalCommand" as const,
      category: "process" as const,
      iconKind: "pulse" as const,
      reversible7d: false,
      approveLabel: "批准执行",
      dismissLabel: "拒绝",
    };
    expect(
      evaluateToolPolicy(
        mutatingBashMeta,
        { command: "brew cleanup" },
        { ...state, preferences: { ...state.preferences, autonomyLevel: "always_ask" } },
        false,
      ).outcome,
    ).toBe("ask");
    expect(
      evaluateToolPolicy(
        mutatingBashMeta,
        { command: "brew cleanup" },
        state,
        false,
      ).outcome,
    ).toBe("review");
    expect(
      evaluateToolPolicy(
        mutatingBashMeta,
        { command: "brew cleanup" },
        { ...state, preferences: { ...state.preferences, autonomyLevel: "full_access" } },
        false,
      ).outcome,
    ).toBe("allow");
    expect(
      evaluateToolPolicy(
        mutatingBashMeta,
        { command: "cat ~/.ssh/id_rsa" },
        { ...state, preferences: { ...state.preferences, autonomyLevel: "full_access" } },
        false,
      ).outcome,
    ).toBe("deny");
    expect(normalizeJevEndpoint("https://openrouter.ai/api/v1")).toBe(
      "https://openrouter.ai/api/v1/systemone",
    );
  });

  it("runs Auto Review via Jev System One and falls back to configured small LLM cleanly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-autoreview-"));
    tempDirs.push(dir);
    const bridge = new FakeHostBridge();

    let nextJevHarmful = 0.05;
    let nextLlmDecision = '{"decision":"allow","risk":"low","reason":"可安全清理"}';
    let jevCalls = 0;
    let llmCalls = 0;

    const srv = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const pathname = (req.url ?? "").split("?")[0];
        if (pathname === "/v1/systemone") {
          jevCalls += 1;
          let model = "jev-latest";
          try {
            const parsed = JSON.parse(rawBody) as { model?: string };
            if (parsed.model) model = parsed.model;
          } catch {
            // ignore
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              model,
              answers: {
                harmful: { type: "noul", noul: nextJevHarmful },
                sensitive: { type: "noul", noul: 0.02 },
                untrusted: { type: "noul", noul: 0.01 },
                obscured: { type: "noul", noul: 0.03 },
              },
            }),
          );
          return;
        }
        if (pathname === "/v1/chat/completions") {
          llmCalls += 1;
          res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
          const ts = Math.floor(Date.now() / 1000);
          const chunk1 = JSON.stringify({
            id: "chatcmpl-review-test",
            object: "chat.completion.chunk",
            created: ts,
            model: "small-reviewer",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: nextLlmDecision },
                finish_reason: null,
              },
            ],
          });
          const chunk2 = JSON.stringify({
            id: "chatcmpl-review-test",
            object: "chat.completion.chunk",
            created: ts,
            model: "small-reviewer",
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
          });
          res.end(`data: ${chunk1}\n\ndata: ${chunk2}\n\ndata: [DONE]\n\n`);
          return;
        }
        res.writeHead(404);
        res.end("not found");
      });
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const srvPort = (srv.address() as AddressInfo).port;

    try {
      const state = makeBaseState(dir);
      state.preferences.autonomyLevel = "auto_review";
      state.preferences.autoReview = {
        engine: "auto",
        jevEndpoint: `http://127.0.0.1:${srvPort}/v1/systemone`,
        jevApiKey: "ts-live-test-key",
        jevModel: "jev-latest",
        fallbackProviderId: "custom",
        fallbackModel: "small-reviewer",
      };
      state.providers.push({
        id: "custom",
        name: "Custom Local",
        apiKey: "sk-local-test-review",
        baseUrl: `http://127.0.0.1:${srvPort}/v1`,
        endpoint: `http://127.0.0.1:${srvPort}/v1`,
        verified: true,
        models: ["small-reviewer"],
        connected: true,
      });

      const rt = new ValetDurableRuntime(bridge);
      await rt.init({ dbPath: join(dir, "pi-ar.sqlite"), state });

      // 1. Jev System One low-risk scores auto-approve mutating bash command
      nextJevHarmful = 0.04;
      rt.models.setLocalStewardScript([
        () =>
          fauxAssistantMessage(
            [fauxToolCall("bash", { command: "brew cleanup --dry-run" })],
            { stopReason: "toolUse" },
          ),
        () => fauxAssistantMessage("Jev Auto Review 已自动放行并完成检查。"),
      ]);
      const lowRes = await rt.sendChat({
        chatId: "chat-jev-allow",
        prompt: "检查 brew",
        model: "claude-opus-4",
      });
      expect(jevCalls).toBe(1);
      expect(bridge.bashCalls.length).toBe(1);
      expect(lowRes.queuedInboxIds.length).toBe(0);

      // 2. Jev System One high harmful score (> 0.35) escalates to human confirmation
      nextJevHarmful = 0.88;
      rt.models.setLocalStewardScript([
        () =>
          fauxAssistantMessage(
            [fauxToolCall("bash", { command: "brew cleanup" })],
            { stopReason: "toolUse" },
          ),
        () => fauxAssistantMessage("已拦截并等待确认。"),
      ]);
      const highRes = await rt.sendChat({
        chatId: "chat-jev-ask",
        prompt: "清理 brew",
        model: "claude-opus-4",
      });
      expect(jevCalls).toBe(2);
      expect(highRes.queuedInboxIds.length).toBe(1);
      expect(bridge.queued[0]?.reasoning).toContain("harmful=0.88");

      // 3. No Jev key configured -> falls back seamlessly to small LLM
      await rt.syncState({
        ...state,
        preferences: {
          ...state.preferences,
          autoReview: {
            ...state.preferences.autoReview!,
            engine: "auto",
            jevApiKey: "",
          },
        },
      });
      nextLlmDecision = '{"decision":"allow","risk":"low","reason":"低风险本地状态操作"}';
      rt.models.setLocalStewardScript([
        () =>
          fauxAssistantMessage(
            [fauxToolCall("bash", { command: "surge-cli reload" })],
            { stopReason: "toolUse" },
          ),
        () => fauxAssistantMessage("小模型审查已放行并完成。"),
      ]);
      const llmAllowRes = await rt.sendChat({
        chatId: "chat-llm-allow",
        prompt: "重载 Surge",
        model: "claude-opus-4",
      });
      expect(llmCalls).toBe(1);
      expect(bridge.bashCalls.length).toBe(2);
      expect(llmAllowRes.queuedInboxIds.length).toBe(0);

      // 4. Small LLM says ask -> escalates to Inbox
      nextLlmDecision = '{"decision":"ask","risk":"high","reason":"会删除应用配置"}';
      rt.models.setLocalStewardScript([
        () =>
          fauxAssistantMessage(
            [fauxToolCall("bash", { command: "rm -rf /tmp/valet-risky-dir" })],
            { stopReason: "toolUse" },
          ),
        () => fauxAssistantMessage("需要确认删除。"),
      ]);
      const llmAskRes = await rt.sendChat({
        chatId: "chat-llm-ask",
        prompt: "删目录",
        model: "claude-opus-4",
      });
      expect(llmCalls).toBe(2);
      expect(llmAskRes.queuedInboxIds.length).toBe(1);
      expect(bridge.queued[1]?.reasoning).toContain("会删除应用配置");

      // 5. testConnection helper smoke check
      const probeRes = await new AutoReviewEvaluator(rt.models).testConnection(
        state.preferences.autoReview!,
        state,
      );
      expect(probeRes.ok).toBe(true);
      expect(probeRes.reply).toContain("Jev System One");

      await rt.close();
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
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
    expect(bridge.queued[0]!.toolName).toBe("trash_files");
    expect(cleanRes.queuedInboxIds).toEqual(["inbox-test-1"]);
    expect(cleanRes.replyMessage.content).toContain("收件箱");
    expect(cleanRes.replyMessage.steps?.length).toBe(2);
    expect(cleanRes.replyMessage.steps?.[0]?.name).toBe("list_dir");
    expect(cleanRes.replyMessage.steps?.[0]?.status).toBe("done");
    expect(cleanRes.replyMessage.steps?.[1]?.name).toBe("trash_files");
    expect(cleanRes.replyMessage.steps?.[1]?.status).toBe("done");
    expect(cleanRes.replyMessage.steps?.[1]?.detail).toBe("已转入收件箱等待确认");

    // Now approve & execute via runtime.executeApprovedTool
    const execRes = await rt.executeApprovedTool({
      inboxId: "inbox-test-1",
      toolName: "trash_files",
      toolArgs: bridge.queued[0]!.toolArgs,
    });
    expect(execRes.ok).toBe(true);
    expect(bridge.trashCalls.length).toBe(1);
    expect(bridge.recorded.length).toBeGreaterThanOrEqual(1);

    await rt.close();
  });

  it("persists durable threads across SQLite reopen and hot-reloads Action-less YAML plugin skills", async () => {
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
    expect(draftRes.replyMessage.pluginDraft?.manifestYaml).not.toContain("\nactions:");
    await rt1.close();

    // Reopen against same SQLite DB + add an Action-less custom YAML plugin
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
      localDir: join(dir, "plugins", "dmg-sweeper"),
      bundledFiles: ["manifest.yaml", "SKILL.md"],
      events: [
        { id: "fs.file_created", description: "dmg created", policy: "auto", count24h: 0 },
      ],
      config: { values: {} },
      manifestYaml: `id: local.valet.dmg-sweeper
name: dmg 清扫员
triggers:
  - id: fs.file_created
    sensor: fs_watch`,
      skillMarkdown: "CUSTOM_DMG_SWEEPER_SKILL: 仅调用 trash_files 清理已安装应用对应的 .dmg。",
    };
    state.plugins.push(customPlugin);
    await rt2.init({ dbPath, state });

    const info = await rt2.inspect();
    expect(info.installedExtensions as string[]).toContain("plugin:dmg-sweeper");
    // Universal core tools handle execution; no compiled plugin_* action tools
    expect(
      (info.registeredTools as string[]).some(
        (t) => t.startsWith("plugin_") && !CORE_PLUGIN_TOOLS.has(t),
      ),
    ).toBe(false);

    let sawSkillContext = false;
    rt2.models.setLocalStewardScript([
      (ctx) => {
        const serialized = JSON.stringify(ctx);
        if (
          serialized.includes("CUSTOM_DMG_SWEEPER_SKILL") &&
          serialized.includes("VALET_PLUGIN_DIR")
        ) {
          sawSkillContext = true;
        }
        return fauxAssistantMessage("已通过自定义插件 Skill 与通用工具完成处理。");
      },
    ]);

    const res2 = await rt2.sendChat({
      chatId: "chat-plugin-1",
      prompt: "帮我按 dmg 清扫员 Skill 处理一下",
      model: "claude-opus-4",
    });
    expect(sawSkillContext).toBe(true);
    expect(res2.replyMessage.content).toContain("自定义插件 Skill");

    // Disable the custom plugin and hot-sync -> extension unmounted immediately
    state.plugins = state.plugins.map((p) =>
      p.id === "dmg-sweeper" ? { ...p, enabled: false } : p,
    );
    await rt2.syncState(state);
    const infoAfterDisable = await rt2.inspect();
    expect(infoAfterDisable.installedExtensions as string[]).not.toContain(
      "plugin:dmg-sweeper",
    );

    await rt2.close();
  });

  it("mounts universal core tools, resolves gemini->google keys, and connects real stdio MCP server", async () => {
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

    // 3. Universal core tools remain available even when an individual plugin is disabled
    state.plugins = state.plugins.map((p) =>
      p.id === "disk-guard" ? { ...p, enabled: false } : p,
    );
    await rt.syncState(state);
    const afterDisable = await rt.inspect();
    const registered = afterDisable.registeredTools as string[];
    expect(registered).toContain("trash_files");
    expect(registered).toContain("read_file");
    expect(registered).toContain("list_dir");
    expect(registered).toContain("write_file");
    expect(registered).toContain("kill_process");
    expect(registered).toContain("ask_user");
    expect(afterDisable.installedExtensions as string[]).not.toContain("plugin:disk-guard");

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
    expect(chatRes.replyMessage.steps).toBe(undefined);
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

  it("mounts SKILL.md on custom event dispatch and supports abort + followUp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-skill-abort-"));
    tempDirs.push(dir);
    const bridge = new FakeHostBridge();
    const state = makeBaseState(dir);
    state.plugins.push({
      id: "webhook-ci",
      slug: "webhook-ci",
      name: "CI 失败哨兵",
      tagline: "接收 Webhook 并按 SKILL.md 分析失败日志",
      description: "Webhook 插件",
      version: "0.1.0",
      bundleId: "local.valet.webhook-ci",
      source: "local",
      enabled: true,
      installed: true,
      events: [{ id: "deploy.failed", description: "Deploy failed", policy: "auto", count24h: 0 }],
      config: { values: {} },
      manifestYaml: `id: local.valet.webhook-ci\nname: CI 失败哨兵\nversion: 0.1.0\ntriggers:\n  - id: deploy.failed\n    sensor: webhook\n`,
      skillMarkdown: "# CI Sentinel Skill\n收到 deploy.failed 时，优先定位第一个报错栈。",
    });

    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath: join(dir, "pi.sqlite"), state });

    // 1. Custom plugin SKILL.md is mounted during event dispatch
    let sawSkillTag = false;
    rt.models.setLocalStewardScript([
      (ctx) => {
        const serialized = JSON.stringify(ctx);
        if (serialized.includes("<plugin_skill") && serialized.includes("优先定位第一个报错栈")) {
          sawSkillTag = true;
        }
        return fauxAssistantMessage("已按 CI 失败哨兵 Skill 完成定位。");
      },
    ]);

    const evtRes = await rt.dispatchPluginEvent({
      pluginId: "webhook-ci",
      eventCode: "deploy.failed",
      payload: { sensor: "webhook", service: "billing-api" },
    });
    expect(sawSkillTag).toBe(true);
    expect(evtRes.handled).toBe(true);

    // 2. abortChat aborts an in-flight turn cleanly, and followUp appends cleanly
    let markToolEntered!: () => void;
    const toolEntered = new Promise<void>((resolve) => {
      markToolEntered = resolve;
    });
    const origCallHost = bridge.callHost.bind(bridge);
    bridge.callHost = async <T = unknown>(
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<T> => {
      if (method === "host.kernel.overview") {
        markToolEntered();
        await new Promise((r) => setTimeout(r, 350));
      }
      return origCallHost<T>(method, params);
    };

    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [fauxToolCall("system_overview", {})],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("如果未被中止会返回这里。"),
    ]);

    const firstTurnPromise = rt.sendChat({
      chatId: "chat-abort-followup",
      prompt: "开始一个长任务",
      model: "claude-opus-4",
      requestId: "req-abort-1",
    });

    await toolEntered;
    await rt.abortChat("chat-abort-followup");

    const abortedRes = await firstTurnPromise;
    expect(abortedRes.replyMessage.content).toContain("停止生成");

    rt.models.setLocalStewardScript([
      () => fauxAssistantMessage("已收到你的追加消息并继续处理。"),
    ]);
    const secondTurn = await rt.sendChat({
      chatId: "chat-abort-followup",
      prompt: "追加一条跟进指示",
      model: "claude-opus-4",
      requestId: "req-followup-2",
    });
    expect(secondTurn.replyMessage.content).toContain("追加消息");

    // 3. whenBusy: "steer" injects mid-run steering and yields matching deterministic msg- ID
    let markSteerToolEntered!: () => void;
    const steerToolEntered = new Promise<void>((resolve) => {
      markSteerToolEntered = resolve;
    });
    bridge.callHost = async <T = unknown>(
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<T> => {
      if (method === "host.kernel.overview") {
        markSteerToolEntered();
        await new Promise((r) => setTimeout(r, 120));
      }
      return origCallHost<T>(method, params);
    };

    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [fauxToolCall("system_overview", {})],
          { stopReason: "toolUse" },
        ),
      (ctx) => {
        const sawSteer = ctx.messages.some(
          (m) => m.role === "user" && JSON.stringify(m.content).includes("立即切换排查方向"),
        );
        return fauxAssistantMessage(
          sawSteer ? "已按实时引导调整方向并完成总结。" : "未看到引导消息。",
        );
      },
    ]);

    const steerBasePromise = rt.sendChat({
      chatId: "chat-steer-midrun",
      prompt: "开始常规巡检",
      model: "claude-opus-4",
      requestId: "req-steer-base",
    });
    await steerToolEntered;
    const steerInjectPromise = rt.sendChat({
      chatId: "chat-steer-midrun",
      prompt: "立即切换排查方向",
      model: "claude-opus-4",
      requestId: "req-steer-inject",
      whenBusy: "steer",
    });

    const [baseRes, injectRes] = await Promise.all([steerBasePromise, steerInjectPromise]);
    expect(injectRes.replyMessage.content).toContain("实时引导调整方向");
    expect(baseRes.replyMessage.id).toBe(injectRes.replyMessage.id);
    expect(baseRes.replyMessage.id.startsWith("msg-")).toBe(true);

    await rt.close();
  });

  it("supports Action-less Skill plugins, background Inbox queueing, and interactive foreground Permission/Ask", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-perm-"));
    tempDirs.push(dir);
    const bridge = new FakeHostBridge();
    const state = makeBaseState(dir);
    state.plugins.push({
      id: "surge-doctor",
      slug: "surge-doctor",
      name: "Surge 诊断",
      tagline: "通过 script_poll 与 Skill 诊断 Surge",
      description: "Action-less Surge 插件包",
      version: "v1.0.0",
      bundleId: "com.community.surge-doctor",
      source: "community",
      enabled: true,
      installed: true,
      localDir: join(dir, "plugins", "surge-doctor"),
      bundledFiles: ["manifest.yaml", "SKILL.md", "scripts/poll-errors.mjs", "scripts/import-logs.mjs"],
      events: [
        { id: "surge.error_detected", description: "surge errors", policy: "auto", count24h: 0 },
      ],
      config: { values: { pollIntervalSec: 30, windowMinutes: 60 } },
      manifestYaml: `id: com.community.surge-doctor
name: Surge 诊断
version: 1.0.0
triggers:
  - id: surge.error_detected
    sensor: script_poll
    script: scripts/poll-errors.mjs
    interval_config_key: pollIntervalSec
    interval_sec: 30
    emit_on: json
    policy: auto`,
      skillMarkdown: "INITIAL_SURGE_SKILL_V1: 先调用 read-only 脚本导入日志，再用 bash 请求确认操作。",
    });

    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath: join(dir, "pi-perm.sqlite"), state });

    // 0. Zero plugin_* static tools compiled
    const info = await rt.inspect();
    const tools = info.registeredTools as string[];
    expect(tools.some((t) => t.startsWith("plugin_") && !CORE_PLUGIN_TOOLS.has(t))).toBe(false);
    expect(tools).toContain("bash");
    expect(tools).toContain("trash_files");
    expect(tools).toContain("ask_user");

    // 1. Background dispatch queues mutating bash into Inbox without blocking
    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxThinking("后台事件检测到 DNS 异常，通过 bash 执行 surge-cli flush dns（触发收件箱审批）"),
            fauxToolCall("bash", {
              command: "surge-cli flush dns",
              reason: "检测到 DNS 解析异常，清理 Surge DNS 缓存",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("已提交刷新 Surge DNS 缓存请求至收件箱。"),
    ]);

    const bgRes = await rt.dispatchPluginEvent({
      pluginId: "surge-doctor",
      eventCode: "surge.error_detected",
      payload: { sensor: "script_poll" },
    });
    expect(bgRes.queuedInboxIds.length).toBe(1);
    expect(bridge.bashCalls.length).toBe(0);

    // Hot-reload skillMarkdown without changing manifestYaml
    await rt.syncState({
      ...state,
      plugins: state.plugins.map((p) =>
        p.id === "surge-doctor"
          ? { ...p, skillMarkdown: "HOT_RELOADED_SURGE_SKILL_V2" }
          : p,
      ),
    });

    // 2. Interactive foreground Chat: allow_once executes bash, allow_session caches for turn 2, ask_user gets answer
    const seenPermissions: NonNullable<ChatStreamPayload["pendingPermission"]>[] = [];
    bridge.onChatStream((payload) => {
      if (payload.pendingPermission) {
        seenPermissions.push(payload.pendingPermission);
        if (payload.pendingPermission.toolName === "bash") {
          rt.resolvePermission({
            chatId: payload.chatId,
            requestId: payload.pendingPermission.requestId,
            decision: "allow_session",
          });
        } else if (payload.pendingPermission.toolName === "ask_user") {
          rt.resolvePermission({
            chatId: payload.chatId,
            requestId: payload.pendingPermission.requestId,
            decision: "allow_once",
            note: "顺带清理",
          });
        } else {
          rt.resolvePermission({
            chatId: payload.chatId,
            requestId: payload.pendingPermission.requestId,
            decision: "deny",
            note: "保留文件",
          });
        }
      }
    });

    let sawHotSkill = false;
    rt.models.setLocalStewardScript([
      (ctx) => {
        if (JSON.stringify(ctx).includes("HOT_RELOADED_SURGE_SKILL_V2")) {
          sawHotSkill = true;
        }
        return fauxAssistantMessage(
          [
            fauxToolCall("bash", {
              command: "surge-cli flush dns",
              reason: "测试本会话允许",
            }),
          ],
          { stopReason: "toolUse" },
        );
      },
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("bash", {
              command: "surge-cli reload",
              reason: "同会话第二次变更命令应免弹窗直接放行",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("ask_user", {
              question: "是否需要继续执行清理？",
              options: ["仅诊断", "顺带清理"],
            }),
          ],
          { stopReason: "toolUse" },
        ),
      (ctx) => {
        const lastText = JSON.stringify(ctx.messages[ctx.messages.length - 1]);
        return fauxAssistantMessage(`收到你的回复：${lastText.includes("顺带清理") ? "顺带清理" : "未知"}`);
      },
    ]);

    const fgRes = await rt.sendChat({
      chatId: "chat-interactive-fg",
      prompt: "帮我处理 Surge 并问我偏好",
      model: "claude-opus-4",
      interactive: true,
    });
    expect(sawHotSkill).toBe(true);
    expect(seenPermissions.filter((p) => p.toolName === "bash").length).toBe(1); // 2nd bash skipped prompt via allow_session
    expect(seenPermissions.filter((p) => p.toolName === "ask_user").length).toBe(1);
    expect(bridge.bashCalls.length).toBe(2);
    expect(fgRes.replyMessage.content).toContain("顺带清理");

    // 3. Deny on trash_files preserves files cleanly
    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("trash_files", {
              paths: ["/Users/testuser/Downloads/old.ipsw"],
              reason: "请求移入废纸篓",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("已取消删除，保留文件。"),
    ]);

    const denyRes = await rt.sendChat({
      chatId: "chat-interactive-fg",
      prompt: "删掉 old.ipsw",
      model: "claude-opus-4",
      interactive: true,
    });
    expect(bridge.trashCalls.length).toBe(0);
    expect(denyRes.replyMessage.content).toContain("保留");

    await rt.close();
  });

  it("registers core bash tool: runs read-only commands directly, gates mutating commands via Inbox, and blocks forbidden commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-bash-"));
    tempDirs.push(dir);
    const bridge = new FakeHostBridge();
    const state = makeBaseState(dir);

    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath: join(dir, "pi-bash.sqlite"), state });

    const info = await rt.inspect();
    expect(info.registeredTools as string[]).toContain("bash");

    // 1. Read-only diagnostic bash commands run directly without queuing Inbox approval
    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("bash", { command: "ls -la ~/Downloads | head -n 5" }),
            fauxToolCall("bash", { command: "git status" }),
            fauxToolCall("bash", { command: "lsof -i :3000 2>/dev/null" }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("已完成只读命令排查，端口 3000 状态已获取。"),
    ]);

    const readRes = await rt.sendChat({
      chatId: "chat-bash-readonly",
      prompt: "帮我检查 Downloads 列表和 3000 端口占用",
      model: "claude-opus-4",
    });
    expect(readRes.replyMessage.content).toContain("只读命令排查");
    expect(bridge.bashCalls.length).toBe(3);
    expect(bridge.queued.length).toBe(0);
    expect(readRes.replyMessage.steps?.[0]?.label).toContain("执行命令 · ls -la ~/Downloads");

    // 2. Mutating bash commands queue an Inbox approval card and run when approved
    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("bash", {
              command: "brew cleanup",
              cwd: "~",
              reason: "清理过期 Homebrew 缓存配方",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("该变更命令已提交收件箱等待确认。"),
    ]);

    const mutateRes = await rt.sendChat({
      chatId: "chat-bash-mutate",
      prompt: "执行 brew cleanup",
      model: "claude-opus-4",
    });
    expect(mutateRes.queuedInboxIds.length).toBe(1);
    expect(bridge.queued.length).toBe(1);
    expect(bridge.queued[0]?.toolName).toBe("bash");
    expect(bridge.queued[0]?.title).toContain("执行终端命令：brew cleanup");
    expect(bridge.bashCalls.length).toBe(3);

    const execRes = await rt.executeApprovedTool({
      inboxId: "inbox-bash-1",
      toolName: "bash",
      toolArgs: bridge.queued[0]!.toolArgs,
    });
    expect(execRes.ok).toBe(true);
    expect(execRes.output).toContain("mock-bash-output");
    expect(bridge.bashCalls.length).toBe(4);
    expect(bridge.bashCalls[3]?.command).toBe("brew cleanup");

    // 3. Forbidden commands targeting ~/.ssh or sudo are hard-denied before approval or execution
    expect(
      evaluateToolPolicy(
        {
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
        { command: "cat ~/.ssh/id_rsa" },
        state,
        false,
      ).outcome,
    ).toBe("deny");

    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("bash", { command: "sudo rm -rf /tmp/x" }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("该提权命令已被安全策略拦截。"),
    ]);
    await rt.sendChat({
      chatId: "chat-bash-deny",
      prompt: "用 sudo 删掉 /tmp/x",
      model: "claude-opus-4",
    });
    expect(bridge.bashCalls.length).toBe(4);
    expect(bridge.queued.length).toBe(1);

    await rt.close();
  });

  it("injects quoted inbox/timeline context cleanly, resolves items in foreground Chat, and blocks item_resolve in background turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-quote-"));
    tempDirs.push(dir);
    const bridge = new FakeHostBridge();
    const state = makeBaseState(dir);
    state.preferences.autonomyLevel = "full_access";

    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath: join(dir, "pi-quote.sqlite"), state });

    const quoteAttachment = {
      id: "quote-inbox-inbox-quote-1",
      kind: "inbox_item" as const,
      refId: "inbox-quote-1",
      badge: "收件箱",
      name: "清理旧版磁盘安装包（4.2 GB）",
      meta: "磁盘守卫 · disk.large_file · 待批准",
      textExcerpt: [
        "- 来源：收件箱待批/审批记录",
        "- inboxId：inbox-quote-1",
        "- 摘要：检测到长期闲置的磁盘镜像安装包，建议移入废纸篓。",
        "- 判断依据：超过 90 天未访问且不在受保护目录中。",
      ].join("\n"),
    };

    // (a) Questioning a quoted item injects [引用事项 ...] without mis-triggering /clean list_dir/trash_files
    const askRes = await rt.sendChat({
      chatId: "chat-quote-1",
      prompt: "为什么建议清理这个文件？有风险吗？",
      model: "claude-opus-4",
      attachments: [quoteAttachment],
      interactive: true,
    });
    expect(bridge.listCalls.length).toBe(0);
    expect(bridge.trashCalls.length).toBe(0);
    expect(bridge.itemResolveCalls.length).toBe(0);
    expect(askRes.replyMessage.content).toContain("清理旧版磁盘安装包（4.2 GB）");
    expect(askRes.replyMessage.content).toContain("inbox-quote-1");

    // (b) Explicit approval instruction in foreground interactive Chat calls item_resolve -> host.item.resolve
    const approveRes = await rt.sendChat({
      chatId: "chat-quote-1",
      prompt: "确认没有风险，请帮我直接批准执行",
      model: "claude-opus-4",
      attachments: [quoteAttachment],
      interactive: true,
    });
    expect(bridge.itemResolveCalls.length).toBe(1);
    expect(bridge.itemResolveCalls[0]?.source).toBe("inbox");
    expect(bridge.itemResolveCalls[0]?.id).toBe("inbox-quote-1");
    expect(bridge.itemResolveCalls[0]?.action).toBe("approve");
    expect(approveRes.replyMessage.content).toContain("inbox-quote-1");

    // (c) Non-interactive background turn attempting item_resolve is blocked by safety gate
    let observedBlockedText = "";
    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("item_resolve", {
              source: "inbox",
              id: "inbox-quote-1",
              action: "approve",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      (ctx) => {
        const toolRes = ctx.messages.find((m) => m.role === "toolResult");
        observedBlockedText = toolRes ? JSON.stringify(toolRes.content) : "";
        return fauxAssistantMessage("后台任务无权自行审批收件箱事项。");
      },
    ]);

    await rt.sendChat({
      chatId: "event:disk-guard",
      prompt: "后台尝试审批 inbox-quote-1",
      model: "claude-opus-4",
      interactive: false,
    });
    expect(observedBlockedText).toContain("安全边界拒绝");
    expect(bridge.itemResolveCalls.length).toBe(1);

    await rt.close();
  });

  it("queues background ask_user options with reversible7d=false and continues source chat via answerInboxQuestion without duplicate cards", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-ask-inbox-"));
    tempDirs.push(dir);
    const bridge = new FakeHostBridge();
    const rt = new ValetDurableRuntime(bridge);
    const state = makeBaseState(dir);
    state.plugins.push({
      id: "surge-doctor",
      slug: "surge-doctor",
      name: "Surge 诊断",
      tagline: "Surge 日志诊断",
      description: "Surge 诊断插件",
      version: "1.0.0",
      bundleId: "com.community.surge-doctor",
      source: "community",
      enabled: true,
      installed: true,
      events: [
        {
          id: "surge.error_detected",
          description: "surge errors",
          policy: "ask",
          count24h: 0,
        },
      ],
      config: {},
      manifestYaml: "id: com.community.surge-doctor\nname: Surge 诊断\n",
      skillMarkdown: "检查 Surge 日志并在需要修改配置时询问用户。",
    });
    await rt.init({ dbPath: join(dir, "pi.sqlite"), state });

    const longQuestion =
      "是否现在为 Surge 配置添加 ntp-server = time.apple.com 并重载？（修改 custom.conf 后将触发 surge-cli reload）";
    const options = ["好，添加 ntp-server 并重载配置", "先不动，继续观察"];

    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxThinking("检测到 NTP 异常，通过 ask_user 向用户确认是否修改 Surge 配置。"),
            fauxToolCall("ask_user", {
              question: longQuestion,
              options,
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("已提交确认问题至收件箱。"),
    ]);

    const evRes = await rt.dispatchPluginEvent({
      pluginId: "surge-doctor",
      eventCode: "surge.error_detected",
      payload: { summary: "No NTP response" },
    });
    expect(evRes.queuedInboxIds).toEqual(["inbox-test-1"]);
    expect(bridge.queued.length).toBe(1);

    const queuedCard = bridge.queued[0]!;
    expect(queuedCard.eventCode).toBe("user.question");
    expect(queuedCard.reversible7d).toBe(false);
    expect(queuedCard.options).toEqual(options);
    expect(queuedCard.sourceChatId).toBe("event:surge-doctor");
    expect(queuedCard.pluginId).toBe("surge-doctor");
    expect(queuedCard.title).toContain("custom.conf");
    expect(queuedCard.approveLabel).toBe(options[0]);

    // Answering via answerInboxQuestion resumes the originating conversation without re-queuing ask_user
    const ansRes = await rt.answerInboxQuestion({
      inboxId: "inbox-test-1",
      question: longQuestion,
      answer: options[0]!,
      sourceChatId: "event:surge-doctor",
    });
    expect(ansRes.ok).toBe(true);
    expect(ansRes.resolvedChatId).toBe("event:surge-doctor");
    expect(ansRes.queuedInboxIds).toEqual([]);
    expect(ansRes.replyMessage.content).toContain(options[0]!);
    expect(bridge.queued.length).toBe(1);

    // Legacy fallback: omitting sourceChatId resolves event:surge-doctor by inboxId from ValetThreadsDoc
    const legacyAnsRes = await rt.answerInboxQuestion({
      inboxId: "inbox-test-1",
      question: longQuestion,
      answer: options[1]!,
    });
    expect(legacyAnsRes.ok).toBe(true);
    expect(legacyAnsRes.resolvedChatId).toBe("event:surge-doctor");
    expect(legacyAnsRes.replyMessage.content).toContain(options[1]!);
    expect(bridge.queued.length).toBe(1);

    // Calling executeApprovedTool with ask_user must never re-queue a duplicate question card
    const guardRes = await rt.executeApprovedTool({
      inboxId: "inbox-test-1",
      toolName: "ask_user",
      toolArgs: { question: longQuestion, options },
    });
    expect(guardRes.ok).toBe(true);
    expect(bridge.queued.length).toBe(1);

    await rt.close();
  });
});
