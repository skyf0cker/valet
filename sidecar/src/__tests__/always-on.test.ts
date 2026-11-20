import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  ValetAlwaysOnStore,
  currentOccurrence,
  nextSlot,
} from "../always-on.ts";
import type { HostBridge, ValetSyncState } from "../protocol.ts";
import { ValetDurableRuntime } from "../runtime.ts";
import { openBunSqliteDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

function makeBaseState(dataDir: string): ValetSyncState {
  return {
    homeDir: dataDir,
    dataDir,
    isPaused: false,
    preferences: {
      language: "简体中文",
      models: {
        primary: "valet-steward-local",
        fast: "valet-steward-local",
        vision: "同主模型",
      },
      activeProviderId: "anthropic",
      dailySpendCurrent: 0,
      dailySpendLimit: 30,
      maxStepsPerTask: 20,
      userNickname: "tester",
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
      blockedApps: ["1Password"],
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
        protectedDirs: ["~/Documents"],
        autoScanAfterUninstall: true,
      },
      pluginRuntime: {
        sandboxIsolation: true,
        allowUnsignedLocal: true,
        maxEventsPerHour: "60 / 小时",
        quietHours: "23:30 – 08:00",
        debounceMs: 1500,
      },
      memoryEnabled: true,
      autoLearnMemory: false,
    },
    providers: [],
    plugins: [
      {
        id: "deploy-hook",
        slug: "deploy-hook",
        name: "部署告警",
        tagline: "Webhook 告警处理",
        description: "接收部署 Webhook",
        version: "0.1.0",
        bundleId: "local.valet.deploy-hook",
        source: "local",
        enabled: true,
        installed: true,
        events: [
          {
            id: "deploy.failed",
            description: "部署失败",
            policy: "ask",
            sensor: "webhook",
            count24h: 0,
          },
        ],
        config: {},
        manifestYaml: `id: local.valet.deploy-hook\nname: 部署告警\nversion: 0.1.0\ntriggers:\n  - id: deploy.failed\n    sensor: webhook\n    policy: ask\n`,
        skillMarkdown: "收到部署失败告警时，检查日志并向用户汇报。",
      },
    ],
    memories: [],
  };
}

describe("ValetAlwaysOnStore (Inbox, Batching, Timers, Outbox)", () => {
  it("deduplicates inbox events, coalesces within debounce window, and bypasses debounce for immediate sources", async () => {
    let now = 1_700_000_000_000;
    const db = await openBunSqliteDatabase(":memory:");
    const store = new ValetAlwaysOnStore(db, () => now);
    store.setDebounceMs(1_500);
    await store.ensureSchema();

    try {
      // 1. Ingest event + duplicate event_id
      const first = await store.ingestInboxEvent({
        source: "webhook",
        plugin_id: "deploy-hook",
        event_type: "deploy.failed",
        event_id: "evt-1",
        title: "API 部署失败",
        payload: JSON.stringify({ service: "api" }),
      });
      expect(first.deduplicated).toBe(false);
      expect(first.immediate).toBe(false);
      expect(first.item.trusted).toBe(false);

      const dup = await store.ingestInboxEvent({
        source: "webhook",
        plugin_id: "deploy-hook",
        event_type: "deploy.failed",
        event_id: "evt-1",
        title: "API 部署失败重复",
        payload: JSON.stringify({ service: "api" }),
      });
      expect(dup.deduplicated).toBe(true);
      expect(dup.item.id).toBe(first.item.id);

      // 2. Second event arrives 500ms later -> slides debounce window
      now += 500;
      await store.ingestInboxEvent({
        source: "webhook",
        plugin_id: "deploy-hook",
        event_type: "deploy.failed",
        event_id: "evt-2",
        title: "Worker 部署失败",
        payload: JSON.stringify({ service: "worker" }),
      });

      // Before debounce window expires, claimNextBatch returns null and computeNextAlarmAt points to newest + 1500ms
      now += 1_000; // 1500ms after first, 1000ms after second
      expect(await store.claimNextBatch()).toBe(null);
      expect(await store.computeNextAlarmAt()).toBe(1_700_000_000_000 + 500 + 1_500);

      // Advance past debounce window -> both items coalesced into a single batch
      now += 500;
      const batch = await store.claimNextBatch();
      expect(batch).not.toBe(null);
      expect(batch!.items.length).toBe(2);
      expect(batch!.run.tainted).toBe(1);
      expect(batch!.chatId).toBe("event:deploy-hook");
      expect(batch!.promptText).toContain('<inbox_batch run_id="');
      expect(batch!.promptText).toContain('count="2"');
      expect(batch!.promptText).toContain('tainted="true"');

      // Single active run invariant: cannot claim another batch while running
      expect(await store.claimNextBatch()).toBe(null);

      // Quiet-by-default: completing without notify/approval sets end_kind = "silent"
      const completed = await store.completeRun(batch!.run.id, "常规检查完毕");
      expect(completed?.end_kind).toBe("silent");

      // Immediate source (approval_answer) bypasses debounce window immediately
      const immediateRes = await store.ingestInboxEvent({
        source: "approval_answer",
        event_type: "approval.approved",
        title: "已批准执行",
        payload: "ok",
      });
      expect(immediateRes.immediate).toBe(true);
      const immediateBatch = await store.claimNextBatch();
      expect(immediateBatch).not.toBe(null);
      expect(immediateBatch!.items.length).toBe(1);
      expect(immediateBatch!.run.tainted).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("retries failed runs with backoff, dead-letters after MAX_ATTEMPTS with Outbox alert, and supports manual retry", async () => {
    let now = 1_700_000_000_000;
    const db = await openBunSqliteDatabase(":memory:");
    const store = new ValetAlwaysOnStore(db, () => now);
    store.setDebounceMs(0);
    await store.ensureSchema();

    try {
      const { item } = await store.ingestInboxEvent({
        source: "plugin",
        plugin_id: "disk-guard",
        event_type: "disk.low_space",
        title: "磁盘空间不足",
        payload: "{}",
      });

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const batch = await store.claimNextBatch();
        expect(batch).not.toBe(null);
        expect(batch!.items[0]!.attempts).toBe(attempt);

        const failed = await store.failRun(batch!.run.id, "transient_network_error");
        expect(failed?.run.status).toBe("failed");

        if (attempt < MAX_ATTEMPTS) {
          expect(failed?.deadLetters.length).toBe(0);
          const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
          expect(await store.computeNextAlarmAt()).toBe(now + delay);
          expect(await store.claimNextBatch()).toBe(null);
          now += delay;
        } else {
          expect(failed?.deadLetters.length).toBe(1);
          expect(failed?.deadLetters[0]!.kind).toBe("dead_letter");
        }
      }

      const deadItems = await store.listInbox(10, "dead");
      expect(deadItems.length).toBe(1);
      expect(deadItems[0]!.id).toBe(item.id);

      const outbox = await store.listOutbox(10);
      expect(outbox.unread_count).toBe(1);
      expect(outbox.messages[0]!.kind).toBe("dead_letter");

      // Mark read + manual retry resets attempts and requeues
      await store.markAllOutboxRead();
      expect((await store.listOutbox(10)).unread_count).toBe(0);

      const retried = await store.retryInboxItem(item.id);
      expect(retried?.status).toBe("queued");
      expect(retried?.attempts).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("fires one-shot follow_up and drift-free schedule timers into Inbox without burst duplicates", async () => {
    let now = 1_700_000_000_000;
    const db = await openBunSqliteDatabase(":memory:");
    const store = new ValetAlwaysOnStore(db, () => now);
    store.setDebounceMs(0);
    await store.ensureSchema();

    try {
      const followUp = await store.createTimer({
        kind: "follow_up",
        label: "复查 CPU",
        payload: "检查 ffmpeg 是否退出",
        delay_seconds: 30,
        created_by: "agent",
      });

      const sched = await store.createTimer({
        kind: "schedule",
        label: "每分钟巡检",
        payload: "巡检磁盘空间",
        every_seconds: 60,
        created_by: "user",
      });

      expect(await store.computeNextAlarmAt()).toBe(now + 30_000);
      expect(await store.fireDueTimers()).toBe(0);

      // Advance 30s -> follow_up fires once and transitions to done
      now += 30_000;
      expect(await store.fireDueTimers()).toBe(1);
      expect(await store.fireDueTimers()).toBe(0);

      const doneTimers = await store.listTimers("done");
      expect(doneTimers.map((t) => t.id)).toEqual([followUp.id]);

      // Advance 3.5 minutes (skipping multiple missed schedule slots) -> fires ONCE (drift-free, no burst!)
      now += 210_000;
      const expectedOccurrence = currentOccurrence(1_700_000_000_000, 60_000, now);
      const expectedNext = nextSlot(1_700_000_000_000, 60_000, now);
      expect(await store.fireDueTimers()).toBe(1);
      expect(await store.fireDueTimers()).toBe(0);

      const armed = await store.listTimers("armed");
      expect(armed.length).toBe(1);
      expect(armed[0]!.id).toBe(sched.id);
      expect(Date.parse(armed[0]!.due_at)).toBe(expectedNext);

      const inbox = await store.listInbox(10);
      expect(inbox.some((i) => i.event_id === `timer:${followUp.id}:1`)).toBe(true);
      expect(
        inbox.some((i) => i.event_id === `timer:${sched.id}:${expectedOccurrence}`),
      ).toBe(true);

      // Cancel remaining schedule timer -> computeNextAlarmAt ignores it
      await store.cancelTimer(sched.id);
      expect((await store.listTimers("armed")).length).toBe(0);
    } finally {
      await db.close();
    }
  });
});

describe("ValetDurableRuntime Always-On Integration", () => {
  it("coalesces tainted webhooks, enforces tainted write approval, and runs agent wake_me_at + notify tools", async () => {
    const dir = makeTempDir("valet-always-on-");
    let now = 1_700_000_000_000;
    const hostNotifications: Array<{ method: string; params: unknown }> = [];
    const queuedApprovals: Array<Record<string, unknown>> = [];

    const bridge: HostBridge = {
      callHost: async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
        if (method === "host.queueApproval") {
          queuedApprovals.push(params);
          return {
            inboxId: `inb-appr-${queuedApprovals.length}`,
            timelineEventId: `tl-${queuedApprovals.length}`,
          } as T;
        }
        return { ok: true } as T;
      },
      notifyHost: (method, params) => {
        hostNotifications.push({ method, params });
      },
    };

    const runtime = new ValetDurableRuntime(bridge, { nowFn: () => now });
    const state = makeBaseState(dir);
    await runtime.init({
      dbPath: join(dir, "pi-agent.sqlite"),
      state,
    });

    try {
      // 1. Ingest 2 untrusted webhook events within debounce window
      await runtime.alwaysOnIngest({
        source: "webhook",
        plugin_id: "deploy-hook",
        event_type: "deploy.failed",
        event_id: "wh-1",
        title: "部署失败 #1",
        payload: JSON.stringify({ service: "api" }),
      });
      now += 400;
      await runtime.alwaysOnIngest({
        source: "webhook",
        plugin_id: "deploy-hook",
        event_type: "deploy.failed",
        event_id: "wh-2",
        title: "部署失败 #2",
        payload: JSON.stringify({ service: "web" }),
      });

      // Advance past debounce window and script the local steward to attempt a mutating trash_files call
      now += 2_000;
      let capturedPrompt = "";
      runtime.models.setLocalStewardScript([
        async (ctx) => {
          const userMsg = ctx.messages.find((m) => m.role === "user");
          capturedPrompt =
            typeof userMsg?.content === "string"
              ? userMsg.content
              : JSON.stringify(userMsg?.content ?? "");
          return fauxAssistantMessage(
            [
              fauxToolCall("trash_files", {
                paths: [join(dir, "stale.log")],
                reason: "清理失败部署日志",
              }),
            ],
            { stopReason: "toolUse" },
          );
        },
        async () =>
          fauxAssistantMessage("已将清理请求提交收件箱等待人工审批。"),
      ]);

      const tick1 = await runtime.alwaysOnTick(true);
      expect(tick1.claimedRunId).not.toBe(null);
      expect(capturedPrompt).toContain("<inbox_batch");
      expect(capturedPrompt).toContain('count="2"');
      expect(capturedPrompt).toContain('tainted="true"');

      // Because the batch is tainted, trash_files MUST be deferred to Inbox approval under auto_review
      expect(queuedApprovals.length).toBe(1);
      expect(String(queuedApprovals[0]?.reasoning ?? "")).toContain("tainted");

      const snap1 = await runtime.alwaysOnSnapshot();
      expect(snap1.runs[0]?.end_kind).toBe("deferred");
      expect(snap1.runs[0]?.tainted).toBe(true);
      expect(snap1.stats.inbox_queued).toBe(0);

      // 2. Test agent wake_me_at -> timer fires -> agent calls notify -> Outbox + host.outboxNotify
      runtime.models.setLocalStewardScript([
        async () =>
          fauxAssistantMessage(
            [
              fauxToolCall("wake_me_at", {
                delaySeconds: 60,
                label: "60 秒后复查",
                note: "确认部署是否恢复",
              }),
            ],
            { stopReason: "toolUse" },
          ),
        async () => fauxAssistantMessage("已安排 60 秒后复查。"),
      ]);

      await runtime.sendChat({
        chatId: "chat-user-1",
        prompt: "帮我 60 秒后复查一下部署状态",
        model: "valet-steward-local",
        interactive: true,
      });

      const snapAfterTimer = await runtime.alwaysOnSnapshot();
      expect(snapAfterTimer.stats.timers_armed).toBe(1);

      // Advance clock 65s and run tick with scripted notify tool call
      now += 65_000;
      runtime.models.setLocalStewardScript([
        async () =>
          fauxAssistantMessage(
            [
              fauxToolCall("notify", {
                title: "部署已恢复",
                body: "复查完成，api 与 web 服务均已恢复正常。",
                level: "info",
              }),
            ],
            { stopReason: "toolUse" },
          ),
        async () => fauxAssistantMessage("已通知用户部署恢复。"),
      ]);

      const tick2 = await runtime.alwaysOnTick(true);
      expect(tick2.firedTimers).toBe(1);
      // Timer event enters Inbox and respects the debounce window so simultaneous timers coalesce
      expect(tick2.claimedRunId).toBe(null);
      expect(tick2.nextAlarmAt).toBe(now + 1_500);

      now += 1_500;
      const tick3 = await runtime.alwaysOnTick(true);
      expect(tick3.claimedRunId).not.toBe(null);

      const snapFinal = await runtime.alwaysOnSnapshot();
      expect(snapFinal.stats.timers_armed).toBe(0);
      expect(snapFinal.outbox.unread_count).toBe(1);
      expect(snapFinal.outbox.messages[0]?.title).toBe("部署已恢复");
      expect(snapFinal.runs[0]?.end_kind).toBe("sent");
      expect(
        hostNotifications.some((n) => n.method === "host.outboxNotify"),
      ).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});
