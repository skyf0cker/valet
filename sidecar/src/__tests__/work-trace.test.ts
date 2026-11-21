import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  ChatStreamPayload,
  HostBridge,
  ValetSyncState,
} from "../protocol.ts";
import {
  ValetDurableRuntime,
  extractThinkingFromMessage,
  humanizeToolStepLabel,
  summarizeToolOutput,
} from "../runtime.ts";

class TraceFakeBridge implements HostBridge {
  readonly streamEvents: ChatStreamPayload[] = [];

  async callHost<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (method === "host.kernel.bash") {
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
    return {} as T;
  }

  notifyHost(method: string, params?: unknown): void {
    if (method === "host.chatStream" && params) {
      this.streamEvents.push(params as ChatStreamPayload);
    }
  }
}

function makeBaseState(dataDir: string): ValetSyncState {
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
      blockedApps: [],
      thresholds: {
        diskLowSpacePct: 15,
        cacheBloatGB: "5 GB",
        largeFileSizeGB: "2 GB",
        largeFileIdleDays: "90 天",
        cpuSpikePct: "200%",
        cpuSpikeDuration: "5 分钟",
        memoryPressureLevel: "red",
        ignoredProcesses: [],
        logSensitivity: "medium",
        eventThrottle10m: true,
      },
      cleanupPolicy: {
        deleteMethod: "移入废纸篓",
        restoreRetentionDays: "7 天",
        protectedDirs: [],
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

describe("work trace helpers and runtime metadata", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("humanizes MCP web fetch/search and bash labels cleanly", () => {
    expect(
      humanizeToolStepLabel("mcp_mcp_mwpanbak_web_fetch_exa", {
        urls: ["https://exa.ai/auth.md"],
      }),
    ).toBe("读取网页 · exa.ai/auth.md");

    expect(
      humanizeToolStepLabel("mcp_mcp_mwpanbak_web_search_exa", {
        query: "Exa MCP server API key URL",
      }),
    ).toBe("搜索网络 · Exa MCP server API key URL");

    expect(
      humanizeToolStepLabel("bash", {
        command: "which valet; readlink -f $(which valet)",
        reason: "定位 valet CLI 与 App 位置",
      }),
    ).toBe("定位 valet CLI 与 App 位置");

    expect(
      humanizeToolStepLabel("bash", {
        command: "ls -la ~/Downloads",
      }),
    ).toBe("执行命令 · ls -la ~/Downloads");
  });

  it("unwraps MCP JSON content blocks and filters noisy structural lines in summarizeToolOutput", () => {
    const mcpJson = JSON.stringify({
      content: [
        {
          type: "text",
          text: "# Exa authentication for agents\nURL: https://exa.ai/auth.md",
        },
      ],
    });
    expect(summarizeToolOutput(mcpJson)).toBe("# Exa authentication for agents");

    expect(summarizeToolOutput("---")).toBe(undefined);
    expect(summarizeToolOutput("82")).toBe(undefined);
    expect(summarizeToolOutput('"content": [')).toBe(undefined);
    expect(summarizeToolOutput("[exit=0, cwd=/Users/dd]\n---\n82\n== MacOS/Valet")).toBe(undefined);
    expect(
      summarizeToolOutput("[exit=0, cwd=/Users/dd]\n---\n/Applications/Valet.app/Contents/Resources/bin/valet"),
    ).toBe("/Applications/Valet.app/Contents/Resources/bin/valet");
  });

  it("extracts thinking from structured thinking blocks and <think> tags", () => {
    expect(
      extractThinkingFromMessage([
        { type: "thinking", thinking: "先检查本地配置" },
        { type: "text", text: "正文回答" },
      ]),
    ).toBe("先检查本地配置");

    expect(
      extractThinkingFromMessage(undefined, "<think>分析用户需求\n准备调用 bash</think>最终结论"),
    ).toBe("分析用户需求\n准备调用 bash");
  });

  it("emits startedAt on stream events and attaches workDurationMs & thinkingSummary on replyMessage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-trace-"));
    tempDirs.push(dir);
    const bridge = new TraceFakeBridge();
    const rt = new ValetDurableRuntime(bridge);
    await rt.init({ dbPath: join(dir, "pi-trace.sqlite"), state: makeBaseState(dir) });

    rt.models.setLocalStewardScript([
      () =>
        fauxAssistantMessage(
          [
            fauxThinking("先查看本地目录确认文件状态"),
            fauxToolCall("bash", {
              command: "ls -la ~/Downloads",
              reason: "检查下载目录",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("已完成本地目录检查。"),
    ]);

    const res = await rt.sendChat({
      chatId: "chat-trace-1",
      prompt: "检查一下下载目录",
      model: "claude-opus-4",
    });

    expect(res.replyMessage.workDurationMs ?? 0).toBeGreaterThanOrEqual(1);
    expect(res.replyMessage.thinkingSummary).toContain("先查看本地目录确认文件状态");
    expect(res.replyMessage.steps?.[0]?.label).toBe("检查下载目录");

    const nonDoneEvents = bridge.streamEvents.filter((e) => e.phase !== "done");
    expect(nonDoneEvents.length).toBeGreaterThanOrEqual(1);
    expect(nonDoneEvents[0]?.startedAt ?? 0).toBeGreaterThanOrEqual(1);

    await rt.close();
  });
});
