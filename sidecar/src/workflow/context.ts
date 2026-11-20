import type { WorkflowDefinition, WorkflowNodeType } from "./eval.ts";

export interface PluginWorkflowTriggerInput {
  event: string;
  source?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  triggeredAt?: string;
}

export interface PluginWorkflowRunInput {
  pluginId: string;
  pluginName: string;
  workflowYaml: string;
  definition: WorkflowDefinition;
  config: Record<string, unknown>;
  trigger: PluginWorkflowTriggerInput;
  timelineEventId?: string;
}

export interface WorkflowStepInvocationMeta {
  __valetNodeId: string;
  __valetNodeType: WorkflowNodeType;
  __valetNodeName: string;
  __valetPluginId: string;
  __valetRunId?: string;
  input: unknown;
}

export interface WorkflowScriptRequest extends WorkflowStepInvocationMeta {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  parseJson?: boolean;
}

export interface WorkflowHttpRequest extends WorkflowStepInvocationMeta {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface WorkflowToolRequest extends WorkflowStepInvocationMeta {
  tool: string;
  args: Record<string, unknown>;
}

export interface WorkflowAgentRequest extends WorkflowStepInvocationMeta {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  allowTools?: boolean;
  maxSteps?: number;
}

export interface WorkflowNotifyRequest extends WorkflowStepInvocationMeta {
  title?: string;
  message: string;
  level?: "info" | "warn" | "error";
  kind?: "timeline" | "outbox" | "both";
}

export interface WorkflowApprovalQueueRequest extends WorkflowStepInvocationMeta {
  runId: string;
  hookToken: string;
  title: string;
  detail?: string;
  riskLevel?: "low" | "medium" | "high";
  approveLabel?: string;
  rejectLabel?: string;
}

export interface WorkflowApprovalQueueResult {
  queued: boolean;
  inboxId: string;
  token: string;
}

export interface WorkflowApprovalDecision {
  approved: boolean;
  comment?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface ValetWorkflowHostContext {
  executeScript(req: WorkflowScriptRequest): Promise<unknown>;
  executeHttp(req: WorkflowHttpRequest): Promise<unknown>;
  executeTool(req: WorkflowToolRequest): Promise<unknown>;
  executeAgent(req: WorkflowAgentRequest): Promise<unknown>;
  emitNotify(req: WorkflowNotifyRequest): Promise<unknown>;
  queueApproval(req: WorkflowApprovalQueueRequest): Promise<WorkflowApprovalQueueResult>;
  notifyStepEvent?(info: {
    pluginId: string;
    runId?: string;
    nodeId: string;
    phase: "start" | "finish" | "error";
  }): void;
}

const HOST_CONTEXT_SYMBOL = Symbol.for("valet.workflow.hostContext");

export function setValetWorkflowHostContext(
  ctx: ValetWorkflowHostContext | undefined,
): void {
  (globalThis as Record<symbol, unknown>)[HOST_CONTEXT_SYMBOL] = ctx;
}

export function getValetWorkflowHostContext(): ValetWorkflowHostContext {
  const ctx = (globalThis as Record<symbol, unknown>)[HOST_CONTEXT_SYMBOL] as
    | ValetWorkflowHostContext
    | undefined;
  if (!ctx) {
    throw new Error(
      "Valet workflow host context is not initialized in globalThis",
    );
  }
  return ctx;
}
