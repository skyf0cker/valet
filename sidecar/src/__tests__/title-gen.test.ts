import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ChatAttachment,
  HostBridge,
  ValetSyncState,
} from "../protocol.ts";
import {
  ValetDurableRuntime,
  deriveFallbackChatTitle,
  sanitizeGeneratedTitle,
} from "../runtime.ts";

class NoopHostBridge implements HostBridge {
  async callHost<T = unknown>(): Promise<T> {
    return {} as T;
  }
  notifyHost(): void {
    // noop
  }
}

function makeBaseState(dataDir: string): ValetSyncState {
  return {
    homeDir: "/Users/testuser",
    dataDir,
    isPaused: false,
    preferences: {
      language: "简体中文",
      models: { primary: "claude-opus-4", fast: "fast-title-model", vision: "同主模型" },
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
    plugins: [],
    memories: [],
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("session title generation helpers", () => {
  it("sanitizes thinking blocks, prefixes, quotes, punctuation, and multiline responses", () => {
    expect(
      sanitizeGeneratedTitle(
        "<think>需要总结郑州旅游主题</think>\n标题：《郑州情侣元旦旅行调研》！\n第二行说明",
      ),
    ).toBe("郑州情侣元旦旅行调研");
    expect(sanitizeGeneratedTitle('Title: "清理 Xcode 冗余缓存"。')).toBe(
      "清理 Xcode 冗余缓存",
    );
    expect(sanitizeGeneratedTitle("1. 「排查本地端口占用」？")).toBe(
      "排查本地端口占用",
    );
    expect(sanitizeGeneratedTitle("新对话")).toBe("");
    expect(sanitizeGeneratedTitle("A")).toBe("");
    expect(sanitizeGeneratedTitle("<thinking>未闭合思考")).toBe("");
    expect(
      Array.from(
        sanitizeGeneratedTitle("这是一个非常非常非常非常非常非常非常长的自动生成会话标题测试"),
      ).length,
    ).toBe(22);
  });

  it("derives deictic-aware fallback titles from notebook attachment meta or textExcerpt", () => {
    const att: ChatAttachment = {
      id: "ctx-notebook-proj-default",
      kind: "notebook_context",
      refId: "proj-default",
      badge: "Notebook",
      name: "默认项目 / 元旦旅行安排",
      meta: "第 2 行 · 调研郑州是否适合情侣元旦旅行，有哪些美食景点",
      textExcerpt: [
        "[发起定位]",
        "- 所属项目：默认项目",
        "- 所属章节：元旦旅行安排",
        "- 引用位置：第 2 行（未完成待办）",
        "- 当前引用行内容：- [ ] 调研郑州是否适合情侣元旦旅行，有哪些美食景点",
      ].join("\n"),
    };

    expect(deriveFallbackChatTitle("你去调研下这个", [att])).toBe(
      "调研郑州是否适合情侣元旦旅行，有哪些",
    );
    expect(deriveFallbackChatTitle("帮我检查 Homebrew 缓存大小？")).toBe(
      "检查 Homebrew 缓存大小",
    );
  });
});

describe("ValetDurableRuntime.generateChatTitle", () => {
  it("calls the configured fast model with Notebook [发起定位] context and sanitizes the LLM title", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-titlegen-"));
    tempDirs.push(dir);

    let capturedBody = "";
    const srv = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        capturedBody = Buffer.concat(chunks).toString("utf8");
        const pathname = (req.url ?? "").split("?")[0];
        if (pathname === "/v1/chat/completions") {
          res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
          const ts = Math.floor(Date.now() / 1000);
          const chunk1 = JSON.stringify({
            id: "chatcmpl-title-test",
            object: "chat.completion.chunk",
            created: ts,
            model: "fast-title-model",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: "<think>分析用户需求</think>标题：「郑州情侣元旦旅行调研」！",
                },
                finish_reason: null,
              },
            ],
          });
          const chunk2 = JSON.stringify({
            id: "chatcmpl-title-test",
            object: "chat.completion.chunk",
            created: ts,
            model: "fast-title-model",
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
    const port = (srv.address() as AddressInfo).port;

    const rt = new ValetDurableRuntime(new NoopHostBridge());
    try {
      const state = makeBaseState(dir);
      state.preferences.activeProviderId = "custom";
      state.preferences.models.fast = "fast-title-model";
      state.providers.push({
        id: "custom",
        name: "Custom Local",
        apiKey: "sk-live-title-test",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        endpoint: `http://127.0.0.1:${port}/v1`,
        verified: true,
        models: ["fast-title-model"],
        connected: true,
      });

      await rt.init({ dbPath: join(dir, "title.sqlite"), state });

      const notebookAtt: ChatAttachment = {
        id: "ctx-notebook-proj-default",
        kind: "notebook_context",
        refId: "proj-default",
        badge: "Notebook",
        name: "默认项目 / 元旦旅行安排",
        meta: "第 2 行 · 调研郑州是否适合情侣元旦旅行，有哪些美食景点",
        textExcerpt: [
          "[发起定位]",
          "- 所属项目：默认项目",
          "- 所属章节：元旦旅行安排",
          "- 引用位置：第 2 行（未完成待办）",
          "- 当前引用行内容：- [ ] 调研郑州是否适合情侣元旦旅行，有哪些美食景点",
          "",
          "[完整 Notebook 上下文（已标注当前引用行）]",
          "L1: # 元旦旅行安排",
          "L2: - [ ] 调研郑州是否适合情侣元旦旅行，有哪些美食景点  <<< [@valet 当前引用行]",
        ].join("\n"),
      };

      const result = await rt.generateChatTitle({
        chatId: "chat-title-1",
        prompt: "你去调研下这个",
        attachments: [notebookAtt],
      });

      expect(result.title).toBe("郑州情侣元旦旅行调研");
      expect(result.usedModel).toContain("fast-title-model");
      expect(capturedBody).toContain("fast-title-model");
      expect(capturedBody).toContain("[发起定位]");
      expect(capturedBody).toContain("调研郑州是否适合情侣元旦旅行");
    } finally {
      await rt.close();
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  it("falls back cleanly to heuristic title when no live model provider is configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valet-titlegen-fallback-"));
    tempDirs.push(dir);
    const rt = new ValetDurableRuntime(new NoopHostBridge());
    try {
      const state = makeBaseState(dir);
      await rt.init({ dbPath: join(dir, "title-fallback.sqlite"), state });

      const result = await rt.generateChatTitle({
        chatId: "chat-title-2",
        prompt: "你去调研下这个",
        attachments: [
          {
            id: "ctx-notebook-proj-default",
            kind: "notebook_context",
            refId: "proj-default",
            name: "默认项目 / 元旦旅行安排",
            meta: "第 2 行 · 调研郑州是否适合情侣元旦旅行",
          },
        ],
      });

      expect(result.title).toBe("调研郑州是否适合情侣元旦旅行");
      expect(result.usedModel).toBe("heuristic");
    } finally {
      await rt.close();
    }
  });
});
