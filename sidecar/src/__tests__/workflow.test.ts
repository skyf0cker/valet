import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { PluginState, WorkflowRunDetail } from "../protocol.ts";
import { openUniversalSqliteBundle } from "../sqlite.ts";
import {
  ValetWorkflowManager,
  type WorkflowHostCallbacks,
} from "../workflow/manager.ts";
import {
  buildStarterWorkflowYaml,
  parseAndValidateWorkflowYaml,
} from "../workflow/schema.ts";

async function waitForRunDetail(
  mgr: ValetWorkflowManager,
  runId: string,
  predicate: (detail: WorkflowRunDetail) => boolean,
  timeoutMs = 15_000,
): Promise<WorkflowRunDetail> {
  const deadline = Date.now() + timeoutMs;
  let last: WorkflowRunDetail | null = null;
  while (Date.now() < deadline) {
    last = await mgr.getRunDetail(runId);
    if (predicate(last)) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(
    `Timed out waiting for run ${runId}. Last status=${last?.summary.status}, nodes=${JSON.stringify(
      last?.nodes.map((n) => ({ id: n.nodeId, status: n.status, err: n.error })),
    )}`,
  );
}

function makeWorkflowPlugin(id: string, workflowYaml: string): PluginState {
  return {
    id,
    slug: id,
    name: `Plugin ${id}`,
    tagline: "workflow test",
    description: "Workflow test plugin",
    version: "1.0.0",
    bundleId: `local.valet.${id}`,
    source: "local",
    enabled: true,
    installed: true,
    events: [{ id: "test.event", description: "Test event", policy: "auto", count24h: 0 }],
    config: { values: { threshold: 80 } },
    manifestYaml: `id: local.valet.${id}\nname: Plugin ${id}\nexecution_mode: workflow\ntriggers:\n  - id: test.event\n    sensor: manual\n`,
    executionMode: "workflow",
    workflowYaml,
  };
}

describe("workflow YAML schema validation", () => {
  it("parses valid DAG and rejects cycles, invalid refs, and bad config", () => {
    const starter = parseAndValidateWorkflowYaml(buildStarterWorkflowYaml());
    expect(starter.valid).toBe(true);
    expect(starter.topologicalOrder).toEqual(["trigger", "prepare", "report"]);
    expect(starter.entryNodeIds).toEqual(["trigger"]);

    const cyclic = parseAndValidateWorkflowYaml(`
version: 1
nodes:
  - id: a
    type: transform
    config: { output: 1 }
  - id: b
    type: transform
    config: { output: 2 }
edges:
  - from: a
    to: b
  - from: b
    to: a
`);
    expect(cyclic.valid).toBe(false);
    expect(cyclic.errors.some((e) => e.includes("环路"))).toBe(true);

    const badRef = parseAndValidateWorkflowYaml(`
version: 1
nodes:
  - id: a
    type: script
    config: {}
  - id: b
    type: bogus
    config: {}
edges:
  - from: a
    to: missing
`);
    expect(badRef.valid).toBe(false);
    expect(badRef.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ValetWorkflowManager (compiled Vercel Workflow SDK runtime)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  async function createHarness(
    plugins: PluginState[],
    overrides?: Partial<WorkflowHostCallbacks>,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "valet-wf-test-"));
    const bundle = await openUniversalSqliteBundle(join(dir, "test.sqlite"));
    const notified: unknown[] = [];
    const approvals: Array<{ runId: string; hookToken: string; title: string }> = [];
    const updates: Array<{ runId: string; status: string }> = [];

    const mgr = new ValetWorkflowManager(dir, bundle.db, {
      getPlugin: (id) => plugins.find((p) => p.id === id),
      executeTool: async (req) => ({ tool: req.tool, args: req.args }),
      runAgentPrompt: async (req) => ({ text: `mock agent: ${req.prompt}` }),
      emitNotify: async (req) => {
        notified.push(req);
        return { sent: true, message: req.message };
      },
      queueApproval: async (req) => {
        approvals.push({ runId: req.runId, hookToken: req.hookToken, title: req.title });
        return { queued: true, inboxId: "inbox-test-1", token: req.hookToken };
      },
      onRunUpdated: (info) => {
        updates.push({ runId: info.runId, status: info.status });
      },
      ...overrides,
    });
    await mgr.init();

    cleanups.push(async () => {
      await mgr.close();
      await bundle.storage.close(BACKGROUND_CONTEXT);
      await rm(dir, { recursive: true, force: true });
    });

    return { dir, mgr, notified, approvals, updates };
  }

  it("executes parallel waves, condition branching, script stdout parsing, and hydrated node I/O", async () => {
    const wfYaml = `
version: 1
name: disk-branch-test
nodes:
  - id: trig
    type: trigger
  - id: prep
    type: transform
    config:
      output:
        usage: "{{trigger.payload.usage}}"
        threshold: "{{config.threshold}}"
  - id: check
    type: condition
    config:
      expr:
        path: steps.prep.output.usage
        op: gte
        value: "{{config.threshold}}"
  - id: run_script
    type: script
    config:
      command: 'printf ''{"usage": %s, "ok": true}'' "{{steps.prep.output.usage}}"'
      parseJson: true
  - id: send_alert
    type: notify
    config:
      title: 磁盘告警
      message: "使用率达到 {{steps.prep.output.usage}}%"
      kind: timeline
  - id: skipped_ok
    type: transform
    config:
      output:
        status: healthy
edges:
  - from: trig
    to: prep
  - from: prep
    to: check
  - from: check
    when: "true"
    to: run_script
  - from: check
    when: "true"
    to: send_alert
  - from: check
    when: "false"
    to: skipped_ok
`;
    const plugin = makeWorkflowPlugin("wf-branch", wfYaml);
    const { mgr, notified } = await createHarness([plugin]);

    const initial = await mgr.startPluginWorkflow({
      plugin,
      event: "test.event",
      source: "unit-test",
      payload: { usage: 92 },
      waitForCompletionMs: 100,
    });

    const detail = await waitForRunDetail(
      mgr,
      initial.summary.runId,
      (d) => d.summary.status === "completed",
    );

    expect(detail.nodes.find((n) => n.nodeId === "trig")?.status).toBe("completed");
    expect(detail.nodes.find((n) => n.nodeId === "prep")?.output).toEqual({
      usage: 92,
      threshold: 80,
    });
    expect(
      (detail.nodes.find((n) => n.nodeId === "check")?.output as { result: boolean })
        ?.result,
    ).toBe(true);

    const scriptNode = detail.nodes.find((n) => n.nodeId === "run_script");
    expect(scriptNode?.status).toBe("completed");
    expect((scriptNode?.output as { json?: { usage: number } })?.json?.usage).toBe(92);
    expect((scriptNode?.input as { __valetNodeId?: string })?.__valetNodeId).toBe(undefined);
    expect(scriptNode?.durationMs).toBeGreaterThanOrEqual(0);

    expect(detail.nodes.find((n) => n.nodeId === "send_alert")?.status).toBe("completed");
    expect(detail.nodes.find((n) => n.nodeId === "skipped_ok")?.status).toBe("skipped");
    expect(notified.length).toBe(1);

    const edgeFalse = detail.edges.find((e) => e.to === "skipped_ok");
    const edgeTrue = detail.edges.find((e) => e.to === "run_script");
    expect(edgeFalse?.status).toBe("skipped");
    expect(edgeTrue?.status).toBe("taken");

    const list = await mgr.listPluginRuns(plugin.id);
    expect(list.length).toBe(1);
    expect(list[0]?.status).toBe("completed");
  });

  it("suspends on approval createHook() and resumes via resumeHook()", async () => {
    const wfYaml = `
version: 1
name: approval-test
nodes:
  - id: trig
    type: trigger
  - id: gate
    type: approval
    name: 确认清理
    config:
      title: 请确认是否清理
      detail: 清理临时目录
  - id: after_approve
    type: transform
    config:
      output:
        approvedBy: "{{steps.gate.output.decidedBy}}"
        comment: "{{steps.gate.output.comment}}"
  - id: after_reject
    type: transform
    config:
      output:
        rejected: true
edges:
  - from: trig
    to: gate
  - from: gate
    when: approved
    to: after_approve
  - from: gate
    when: rejected
    to: after_reject
`;
    const plugin = makeWorkflowPlugin("wf-approval", wfYaml);
    const { mgr, approvals } = await createHarness([plugin]);

    const initial = await mgr.startPluginWorkflow({
      plugin,
      event: "test.event",
      payload: {},
      waitForCompletionMs: 100,
    });

    const waiting = await waitForRunDetail(
      mgr,
      initial.summary.runId,
      (d) => d.summary.status === "waiting_approval",
    );

    const gateNode = waiting.nodes.find((n) => n.nodeId === "gate");
    expect(gateNode?.status).toBe("waiting_approval");
    expect(Boolean(gateNode?.hookToken)).toBe(true);
    expect(gateNode?.inboxId).toBe("inbox-test-1");
    expect(approvals.length).toBe(1);

    await mgr.resumeHook(gateNode!.hookToken!, {
      approved: true,
      decidedBy: "tester",
      comment: "ship it",
    });

    const done = await waitForRunDetail(
      mgr,
      initial.summary.runId,
      (d) => d.summary.status === "completed",
    );

    expect(done.nodes.find((n) => n.nodeId === "gate")?.status).toBe("completed");
    expect(done.nodes.find((n) => n.nodeId === "after_approve")?.output).toEqual({
      approvedBy: "tester",
      comment: "ship it",
    });
    expect(done.nodes.find((n) => n.nodeId === "after_reject")?.status).toBe("skipped");
  });

  it("supports durable sleep() nodes", async () => {
    const wfYaml = `
version: 1
nodes:
  - id: trig
    type: trigger
  - id: wait_a_bit
    type: sleep
    config:
      duration: 120ms
  - id: done
    type: transform
    config:
      output:
        woke: "{{steps.wait_a_bit.output.slept}}"
edges:
  - from: trig
    to: wait_a_bit
  - from: wait_a_bit
    to: done
`;
    const plugin = makeWorkflowPlugin("wf-sleep", wfYaml);
    const { mgr } = await createHarness([plugin]);

    const initial = await mgr.startPluginWorkflow({
      plugin,
      event: "test.event",
      waitForCompletionMs: 50,
    });

    const done = await waitForRunDetail(
      mgr,
      initial.summary.runId,
      (d) => d.summary.status === "completed",
    );

    expect(
      (done.nodes.find((n) => n.nodeId === "wait_a_bit")?.output as { slept?: boolean })
        ?.slept,
    ).toBe(true);
    expect(done.nodes.find((n) => n.nodeId === "done")?.output).toEqual({ woke: true });
  });

  it("surfaces node and run failure when a script exits non-zero", async () => {
    const wfYaml = `
version: 1
nodes:
  - id: trig
    type: trigger
  - id: fail_cmd
    type: script
    config:
      command: "echo boom >&2; exit 2"
  - id: unreachable
    type: transform
    config:
      output: { ok: true }
edges:
  - from: trig
    to: fail_cmd
  - from: fail_cmd
    to: unreachable
`;
    const plugin = makeWorkflowPlugin("wf-fail", wfYaml);
    const { mgr } = await createHarness([plugin]);

    const initial = await mgr.startPluginWorkflow({
      plugin,
      event: "test.event",
      waitForCompletionMs: 100,
    });

    const failed = await waitForRunDetail(
      mgr,
      initial.summary.runId,
      (d) => d.summary.status === "failed",
    );

    const failNode = failed.nodes.find((n) => n.nodeId === "fail_cmd");
    expect(failNode?.status).toBe("failed");
    expect(failNode?.error).toContain("boom");
    expect(failed.nodes.find((n) => n.nodeId === "unreachable")?.status).toBe("pending");
  });
});
