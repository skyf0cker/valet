import { FatalError, createHook, getWorkflowMetadata, sleep } from "workflow";
import {
  evaluateCondition,
  resolveTemplate,
  type WorkflowConditionExpr,
  type WorkflowDefinition,
  type WorkflowEdgeDef,
  type WorkflowNodeDef,
} from "./eval.ts";
import {
  getValetWorkflowHostContext,
  type PluginWorkflowRunInput,
  type WorkflowAgentRequest,
  type WorkflowApprovalDecision,
  type WorkflowApprovalQueueRequest,
  type WorkflowApprovalQueueResult,
  type WorkflowHttpRequest,
  type WorkflowNotifyRequest,
  type WorkflowScriptRequest,
  type WorkflowStepInvocationMeta,
  type WorkflowToolRequest,
} from "./context.ts";

interface WorkflowTriggerStepRequest extends WorkflowStepInvocationMeta {
  trigger: PluginWorkflowRunInput["trigger"];
}

interface WorkflowTransformStepRequest extends WorkflowStepInvocationMeta {
  template: unknown;
  resolvedOutput: unknown;
}

interface WorkflowConditionStepRequest extends WorkflowStepInvocationMeta {
  expr: WorkflowConditionExpr | Record<string, unknown> | undefined;
  result: boolean;
  actual: unknown;
  expected: unknown;
}

interface WorkflowSleepStepRequest extends WorkflowStepInvocationMeta {
  duration: string | number;
}

interface WorkflowApprovalResultRequest extends WorkflowStepInvocationMeta {
  hookToken: string;
  inboxId: string;
  decision: WorkflowApprovalDecision;
}

function asFatal(err: unknown): FatalError {
  if (err instanceof FatalError) {
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new FatalError(msg);
}

async function recordTriggerStep(req: WorkflowTriggerStepRequest): Promise<unknown> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  const output = req.trigger;
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "finish",
  });
  return output;
}

async function runTransformStep(req: WorkflowTransformStepRequest): Promise<unknown> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  const output = req.resolvedOutput;
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "finish",
  });
  return output;
}

async function runConditionStep(
  req: WorkflowConditionStepRequest,
): Promise<{ result: boolean; branch: "true" | "false"; actual: unknown; expected: unknown }> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  const output = {
    result: req.result,
    branch: req.result ? ("true" as const) : ("false" as const),
    actual: req.actual,
    expected: req.expected,
  };
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "finish",
  });
  return output;
}

async function runScriptStep(req: WorkflowScriptRequest): Promise<unknown> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  try {
    const out = await host.executeScript(req);
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "finish",
    });
    return out;
  } catch (err) {
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "error",
    });
    throw asFatal(err);
  }
}

async function runHttpStep(req: WorkflowHttpRequest): Promise<unknown> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  try {
    const out = await host.executeHttp(req);
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "finish",
    });
    return out;
  } catch (err) {
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "error",
    });
    throw asFatal(err);
  }
}

async function runToolStep(req: WorkflowToolRequest): Promise<unknown> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  try {
    const out = await host.executeTool(req);
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "finish",
    });
    return out;
  } catch (err) {
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "error",
    });
    throw asFatal(err);
  }
}

async function runAgentStep(req: WorkflowAgentRequest): Promise<unknown> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  try {
    const out = await host.executeAgent(req);
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "finish",
    });
    return out;
  } catch (err) {
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "error",
    });
    throw asFatal(err);
  }
}

async function runNotifyStep(req: WorkflowNotifyRequest): Promise<unknown> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  try {
    const out = await host.emitNotify(req);
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "finish",
    });
    return out;
  } catch (err) {
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "error",
    });
    throw asFatal(err);
  }
}

async function recordSleepStartStep(req: WorkflowSleepStepRequest): Promise<unknown> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  return {
    sleeping: true,
    duration: req.duration,
    startedAt: new Date().toISOString(),
  };
}

async function recordSleepDoneStep(req: WorkflowSleepStepRequest): Promise<unknown> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "finish",
  });
  return {
    slept: true,
    duration: req.duration,
    wokeAt: new Date().toISOString(),
  };
}

async function queueApprovalStep(
  req: WorkflowApprovalQueueRequest,
): Promise<WorkflowApprovalQueueResult> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "start",
  });
  try {
    return await host.queueApproval(req);
  } catch (err) {
    host.notifyStepEvent?.({
      pluginId: req.__valetPluginId,
      runId: req.__valetRunId,
      nodeId: req.__valetNodeId,
      phase: "error",
    });
    throw asFatal(err);
  }
}

async function recordApprovalResultStep(
  req: WorkflowApprovalResultRequest,
): Promise<Record<string, unknown>> {
  "use step";
  const host = getValetWorkflowHostContext();
  host.notifyStepEvent?.({
    pluginId: req.__valetPluginId,
    runId: req.__valetRunId,
    nodeId: req.__valetNodeId,
    phase: "finish",
  });
  return {
    approved: Boolean(req.decision?.approved),
    comment: req.decision?.comment ?? "",
    decidedBy: req.decision?.decidedBy ?? "user",
    decidedAt: req.decision?.decidedAt ?? new Date().toISOString(),
    hookToken: req.hookToken,
    inboxId: req.inboxId,
  };
}

function edgeMatchesOutcome(
  edge: WorkflowEdgeDef,
  sourceNode: WorkflowNodeDef,
  output: unknown,
): boolean {
  if (!edge.when) {
    return true;
  }
  const expected = edge.when.trim().toLowerCase();
  if (!expected) {
    return true;
  }
  const rec =
    output !== null && typeof output === "object"
      ? (output as Record<string, unknown>)
      : undefined;

  if (sourceNode.type === "condition") {
    const res = Boolean(rec?.result);
    return expected === String(res);
  }
  if (sourceNode.type === "approval") {
    const approved = Boolean(rec?.approved);
    if (expected === "approved" || expected === "true") {
      return approved;
    }
    if (expected === "rejected" || expected === "false") {
      return !approved;
    }
    return false;
  }
  if (rec && "branch" in rec && rec.branch !== undefined) {
    return String(rec.branch).trim().toLowerCase() === expected;
  }
  if (rec && "result" in rec && rec.result !== undefined) {
    return String(rec.result).trim().toLowerCase() === expected;
  }
  return false;
}

function buildPredecessorSnapshot(
  nodeId: string,
  incomingEdges: WorkflowEdgeDef[],
  edgeStates: Map<string, "pending" | "taken" | "skipped">,
  stepsScope: Record<string, { output?: unknown; status?: string }>,
): Record<string, unknown> {
  const from: Record<string, unknown> = {};
  for (const edge of incomingEdges) {
    if (edgeStates.get(edge.id) === "taken") {
      from[edge.from] = stepsScope[edge.from]?.output;
    }
  }
  return from;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined && v !== null) {
      out[k] = String(v);
    }
  }
  return out;
}

function asUnknownRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function runSingleDagNode(
  node: WorkflowNodeDef,
  input: PluginWorkflowRunInput,
  workflowRunId: string,
  stepsScope: Record<string, { output?: unknown; status?: string }>,
  predecessors: Record<string, unknown>,
): Promise<unknown> {
  const scope: Record<string, unknown> = {
    trigger: input.trigger,
    config: input.config,
    steps: stepsScope,
  };
  const cfg = node.config ?? {};
  const metaBase: Omit<WorkflowStepInvocationMeta, "input"> = {
    __valetNodeId: node.id,
    __valetNodeType: node.type,
    __valetNodeName: node.name || node.id,
    __valetPluginId: input.pluginId,
    __valetRunId: workflowRunId,
  };

  switch (node.type) {
    case "trigger": {
      return await recordTriggerStep({
        ...metaBase,
        input: { trigger: input.trigger },
        trigger: input.trigger,
      });
    }
    case "transform": {
      const template = cfg.output !== undefined ? cfg.output : cfg.mapping;
      const resolvedOutput = resolveTemplate(template, scope);
      return await runTransformStep({
        ...metaBase,
        input: { template, predecessors },
        template,
        resolvedOutput,
      });
    }
    case "condition": {
      const expr = (cfg.expr ??
        (typeof cfg.path === "string"
          ? { path: cfg.path, op: cfg.op ?? "truthy", value: cfg.value }
          : undefined)) as WorkflowConditionExpr | undefined;
      const evaluated = evaluateCondition(expr, scope);
      return await runConditionStep({
        ...metaBase,
        input: {
          expr,
          actual: evaluated.actual,
          expected: evaluated.expected,
          predecessors,
        },
        expr,
        result: evaluated.result,
        actual: evaluated.actual,
        expected: evaluated.expected,
      });
    }
    case "script": {
      const command = String(resolveTemplate(cfg.command ?? "", scope) ?? "");
      const args = Array.isArray(cfg.args)
        ? cfg.args.map((a) => String(resolveTemplate(a, scope) ?? ""))
        : undefined;
      const cwd =
        typeof cfg.cwd === "string" && cfg.cwd.trim()
          ? String(resolveTemplate(cfg.cwd, scope) ?? "")
          : undefined;
      const env = asStringRecord(resolveTemplate(cfg.env, scope));
      const timeoutMs =
        typeof cfg.timeoutMs === "number" ? cfg.timeoutMs : undefined;
      const parseJson = Boolean(cfg.parseJson);
      return await runScriptStep({
        ...metaBase,
        input: { command, args, cwd, env, timeoutMs, parseJson, predecessors },
        command,
        args,
        cwd,
        env,
        timeoutMs,
        parseJson,
      });
    }
    case "http": {
      const url = String(resolveTemplate(cfg.url ?? "", scope) ?? "");
      const method =
        typeof cfg.method === "string" && cfg.method.trim()
          ? cfg.method.trim().toUpperCase()
          : "GET";
      const headers = asStringRecord(resolveTemplate(cfg.headers, scope));
      const body =
        cfg.body !== undefined ? resolveTemplate(cfg.body, scope) : undefined;
      const timeoutMs =
        typeof cfg.timeoutMs === "number" ? cfg.timeoutMs : undefined;
      return await runHttpStep({
        ...metaBase,
        input: { url, method, headers, body, timeoutMs, predecessors },
        url,
        method,
        headers,
        body,
        timeoutMs,
      });
    }
    case "tool": {
      const toolName = String(
        resolveTemplate(cfg.tool ?? cfg.name ?? "", scope) ?? "",
      );
      const args = asUnknownRecord(resolveTemplate(cfg.args ?? {}, scope));
      return await runToolStep({
        ...metaBase,
        input: { tool: toolName, args, predecessors },
        tool: toolName,
        args,
      });
    }
    case "agent": {
      const prompt = String(resolveTemplate(cfg.prompt ?? "", scope) ?? "");
      const systemPrompt =
        typeof cfg.systemPrompt === "string"
          ? String(resolveTemplate(cfg.systemPrompt, scope) ?? "")
          : undefined;
      const model = typeof cfg.model === "string" ? cfg.model : undefined;
      const allowTools =
        typeof cfg.allowTools === "boolean" ? cfg.allowTools : true;
      const maxSteps =
        typeof cfg.maxSteps === "number" ? cfg.maxSteps : undefined;
      return await runAgentStep({
        ...metaBase,
        input: { prompt, systemPrompt, model, allowTools, maxSteps, predecessors },
        prompt,
        systemPrompt,
        model,
        allowTools,
        maxSteps,
      });
    }
    case "notify": {
      const title =
        typeof cfg.title === "string"
          ? String(resolveTemplate(cfg.title, scope) ?? "")
          : input.pluginName;
      const message = String(resolveTemplate(cfg.message ?? "", scope) ?? "");
      const level =
        cfg.level === "warn" || cfg.level === "error" ? cfg.level : "info";
      const kind =
        cfg.kind === "outbox" || cfg.kind === "both" ? cfg.kind : "timeline";
      return await runNotifyStep({
        ...metaBase,
        input: { title, message, level, kind, predecessors },
        title,
        message,
        level,
        kind,
      });
    }
    case "sleep": {
      const rawDur = resolveTemplate(cfg.duration, scope);
      const duration =
        typeof rawDur === "number" ? rawDur : String(rawDur ?? "1s");
      await recordSleepStartStep({
        ...metaBase,
        input: { duration, predecessors },
        duration,
      });
      await sleep(duration as Parameters<typeof sleep>[0]);
      return await recordSleepDoneStep({
        ...metaBase,
        input: { duration, predecessors },
        duration,
      });
    }
    case "approval": {
      const title = String(
        resolveTemplate(cfg.title ?? cfg.summary ?? "工作流审批", scope) ?? "",
      );
      const detail =
        typeof cfg.detail === "string"
          ? String(resolveTemplate(cfg.detail, scope) ?? "")
          : undefined;
      const riskLevel =
        cfg.riskLevel === "high" || cfg.riskLevel === "low"
          ? cfg.riskLevel
          : "medium";
      const approveLabel =
        typeof cfg.approveLabel === "string" ? cfg.approveLabel : "批准继续";
      const rejectLabel =
        typeof cfg.rejectLabel === "string" ? cfg.rejectLabel : "拒绝并分支/中止";

      const token = `valet:${workflowRunId}:${node.id}`;
      const hook = createHook<WorkflowApprovalDecision>({
        token,
        metadata: {
          pluginId: input.pluginId,
          workflowRunId,
          nodeId: node.id,
          title,
        },
      });

      const queued = await queueApprovalStep({
        ...metaBase,
        input: {
          title,
          detail,
          riskLevel,
          hookToken: hook.token,
          predecessors,
        },
        runId: workflowRunId,
        hookToken: hook.token,
        title,
        detail,
        riskLevel,
        approveLabel,
        rejectLabel,
      });

      const decision = await hook;
      return await recordApprovalResultStep({
        ...metaBase,
        input: {
          title,
          detail,
          hookToken: hook.token,
          inboxId: queued.inboxId,
          decision,
        },
        hookToken: hook.token,
        inboxId: queued.inboxId,
        decision: decision ?? { approved: false },
      });
    }
  }
}

export interface PluginWorkflowRunResult {
  pluginId: string;
  workflowRunId: string;
  status: "completed";
  nodeStatuses: Record<string, "completed" | "skipped">;
  nodeOutputs: Record<string, unknown>;
}

/**
 * Single precompiled Vercel Workflow DAG interpreter shared by all plugins
 * configured with `execution_mode: workflow`.
 */
export async function executePluginWorkflow(
  input: PluginWorkflowRunInput,
): Promise<PluginWorkflowRunResult> {
  "use workflow";

  const meta = getWorkflowMetadata();
  const definition: WorkflowDefinition = input.definition;

  const nodeMap = new Map<string, WorkflowNodeDef>();
  const incomingMap = new Map<string, WorkflowEdgeDef[]>();
  const outgoingMap = new Map<string, WorkflowEdgeDef[]>();
  const edgeStates = new Map<string, "pending" | "taken" | "skipped">();
  const nodeState = new Map<string, "pending" | "completed" | "skipped">();

  for (const node of definition.nodes) {
    nodeMap.set(node.id, node);
    incomingMap.set(node.id, []);
    outgoingMap.set(node.id, []);
    nodeState.set(node.id, "pending");
  }
  for (const edge of definition.edges) {
    incomingMap.get(edge.to)?.push(edge);
    outgoingMap.get(edge.from)?.push(edge);
    edgeStates.set(edge.id, "pending");
  }

  const stepsScope: Record<string, { output?: unknown; status?: string }> = {};
  const nodeOutputs: Record<string, unknown> = {};

  while (true) {
    // 1. Propagate cascades of skipped nodes whose incoming edges are all skipped.
    let propagated = true;
    while (propagated) {
      propagated = false;
      for (const node of definition.nodes) {
        if (nodeState.get(node.id) !== "pending") {
          continue;
        }
        const incoming = incomingMap.get(node.id) ?? [];
        if (incoming.length === 0) {
          continue;
        }
        const allSettled = incoming.every(
          (e) => edgeStates.get(e.id) !== "pending",
        );
        if (!allSettled) {
          continue;
        }
        const anyTaken = incoming.some((e) => edgeStates.get(e.id) === "taken");
        if (!anyTaken) {
          nodeState.set(node.id, "skipped");
          stepsScope[node.id] = { status: "skipped" };
          for (const outEdge of outgoingMap.get(node.id) ?? []) {
            edgeStates.set(outEdge.id, "skipped");
          }
          propagated = true;
        }
      }
    }

    // 2. Collect all ready nodes for the next parallel wave.
    const readyNodes: WorkflowNodeDef[] = [];
    for (const node of definition.nodes) {
      if (nodeState.get(node.id) !== "pending") {
        continue;
      }
      const incoming = incomingMap.get(node.id) ?? [];
      if (incoming.length === 0) {
        readyNodes.push(node);
        continue;
      }
      const allSettled = incoming.every(
        (e) => edgeStates.get(e.id) !== "pending",
      );
      const anyTaken = incoming.some((e) => edgeStates.get(e.id) === "taken");
      if (allSettled && anyTaken) {
        readyNodes.push(node);
      }
    }

    if (readyNodes.length === 0) {
      break;
    }

    // Snapshot scope for deterministic parallel execution within this wave.
    const waveResults = await Promise.all(
      readyNodes.map(async (node) => {
        const predecessors = buildPredecessorSnapshot(
          node.id,
          incomingMap.get(node.id) ?? [],
          edgeStates,
          stepsScope,
        );
        const output = await runSingleDagNode(
          node,
          input,
          meta.workflowRunId,
          stepsScope,
          predecessors,
        );
        return { node, output };
      }),
    );

    for (const { node, output } of waveResults) {
      nodeState.set(node.id, "completed");
      nodeOutputs[node.id] = output;
      stepsScope[node.id] = { output, status: "completed" };

      for (const outEdge of outgoingMap.get(node.id) ?? []) {
        const matched = edgeMatchesOutcome(outEdge, node, output);
        edgeStates.set(outEdge.id, matched ? "taken" : "skipped");
      }
    }
  }

  const nodeStatuses: Record<string, "completed" | "skipped"> = {};
  for (const node of definition.nodes) {
    const st = nodeState.get(node.id);
    nodeStatuses[node.id] = st === "skipped" ? "skipped" : "completed";
  }

  return {
    pluginId: input.pluginId,
    workflowRunId: meta.workflowRunId,
    status: "completed",
    nodeStatuses,
    nodeOutputs,
  };
}
