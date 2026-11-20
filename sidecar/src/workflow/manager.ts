import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SqliteDatabase } from "@earendil-works/chord/sqlite";
import "@workflow/core/runtime/world-init";
import {
  cancelRun as wfCancelRun,
  resumeHook as wfResumeHook,
  setWorld,
  start as wfStart,
} from "@workflow/core/runtime";
import { createWorld, type LocalWorld } from "@workflow/world-local";
import { hydrateResourceIO, observabilityRevivers } from "workflow/observability";
import type {
  PluginState,
  WorkflowEdgeRunState,
  WorkflowGraphResponse,
  WorkflowNodeRunState,
  WorkflowNodeStatus,
  WorkflowRunDetail,
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowValidationResponse,
} from "../protocol.ts";
import {
  setValetWorkflowHostContext,
  type PluginWorkflowRunInput,
  type WorkflowAgentRequest,
  type WorkflowApprovalDecision,
  type WorkflowApprovalQueueRequest,
  type WorkflowApprovalQueueResult,
  type WorkflowHttpRequest,
  type WorkflowNotifyRequest,
  type WorkflowScriptRequest,
  type WorkflowToolRequest,
} from "./context.ts";
import type {
  WorkflowDefinition,
  WorkflowEdgeDef,
  WorkflowNodeDef,
} from "./eval.ts";
import { parseAndValidateWorkflowYaml } from "./schema.ts";

interface WorkflowManifestFile {
  version: number;
  workflowId: string;
}

interface FlowRouteModule {
  POST: (req: Request) => Promise<Response>;
  GET?: (req: Request) => Promise<Response>;
}

interface IndexedRunRow {
  run_id: string;
  plugin_id: string;
  plugin_name: string;
  trigger_event: string;
  trigger_source: string;
  status: string;
  timeline_event_id: string | null;
  graph_snapshot_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface WorkflowHostCallbacks {
  getPlugin: (pluginId: string) => PluginState | undefined;
  executeTool: (req: WorkflowToolRequest) => Promise<unknown>;
  runAgentPrompt: (req: WorkflowAgentRequest) => Promise<unknown>;
  emitNotify: (req: WorkflowNotifyRequest) => Promise<unknown>;
  queueApproval: (
    req: WorkflowApprovalQueueRequest,
  ) => Promise<WorkflowApprovalQueueResult>;
  onRunUpdated: (info: {
    pluginId: string;
    runId: string;
    status: WorkflowRunStatus;
    error?: string;
    timelineEventId?: string;
    completedNodeCount?: number;
  }) => void;
}

export interface StartPluginWorkflowOptions {
  plugin: PluginState;
  event?: string;
  source?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  timelineEventId?: string;
  waitForCompletionMs?: number;
}

const valetObservabilityRevivers = {
  ...observabilityRevivers,
  Error: (value: { message?: string; name?: string; stack?: string }) => ({
    name: value?.name ?? "Error",
    message: value?.message ?? String(value),
    stack: value?.stack,
  }),
  FatalError: (value: { message?: string; stack?: string }) => ({
    name: "FatalError",
    message: value?.message ?? String(value),
    stack: value?.stack,
  }),
  RetryableError: (value: { message?: string; stack?: string }) => ({
    name: "RetryableError",
    message: value?.message ?? String(value),
    stack: value?.stack,
  }),
};

const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_TIMEOUT_MS = 300_000;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function resolveWorkflowRuntimeDir(): Promise<string> {
  const candidates = [
    process.env.VALET_WORKFLOW_RUNTIME_DIR?.trim(),
    process.argv[1] ? join(dirname(process.argv[1]), "workflow-runtime") : "",
    resolve(__dirname, "generated"),
  ].filter((c): c is string => Boolean(c));

  for (const dir of candidates) {
    if (
      existsSync(join(dir, "flow.mjs")) &&
      existsSync(join(dir, "manifest.json"))
    ) {
      return dir;
    }
  }
  throw new Error(
    `Compiled Vercel Workflow runtime not found (checked: ${candidates.join(", ")}). Run "bun run build:workflow".`,
  );
}

function safeTryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function toIsoString(val: unknown): string | undefined {
  if (!val) return undefined;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? undefined : val.toISOString();
  }
  if (typeof val === "string") {
    return val;
  }
  return undefined;
}

function diffMs(startIso?: string, endIso?: string): number | undefined {
  if (!startIso || !endIso) return undefined;
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return undefined;
  return e - s;
}

function extractErrorMessage(errVal: unknown): string | undefined {
  if (!errVal) return undefined;
  if (typeof errVal === "string") return errVal;
  if (typeof errVal === "object") {
    const rec = errVal as Record<string, unknown>;
    if (typeof rec.message === "string" && rec.message.trim()) {
      return rec.message;
    }
    try {
      return JSON.stringify(errVal);
    } catch {
      return String(errVal);
    }
  }
  return String(errVal);
}

function edgeMatchesOutcomeForDisplay(
  edge: WorkflowEdgeDef,
  sourceNode: WorkflowNodeDef,
  output: unknown,
): boolean {
  if (!edge.when) return true;
  const expected = edge.when.trim().toLowerCase();
  if (!expected) return true;
  const rec =
    output !== null && typeof output === "object"
      ? (output as Record<string, unknown>)
      : undefined;

  if (sourceNode.type === "condition") {
    return expected === String(Boolean(rec?.result));
  }
  if (sourceNode.type === "approval") {
    const approved = Boolean(rec?.approved);
    if (expected === "approved" || expected === "true") return approved;
    if (expected === "rejected" || expected === "false") return !approved;
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

export class ValetWorkflowManager {
  private world: LocalWorld | null = null;
  private server: Server | null = null;
  private workflowId = "";
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private readonly memoryIndex = new Map<string, IndexedRunRow>();
  private readonly liveStepEvents = new Map<string, number>();

  constructor(
    private readonly dataDir: string,
    private readonly db: SqliteDatabase | null,
    private readonly callbacks: WorkflowHostCallbacks,
  ) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = this.doInit().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    const runtimeDir = await resolveWorkflowRuntimeDir();
    const manifestRaw = await readFile(join(runtimeDir, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw) as WorkflowManifestFile;
    if (!manifest.workflowId) {
      throw new Error("Compiled workflow manifest.json missing workflowId");
    }
    this.workflowId = manifest.workflowId;

    const flowMod = (await import(
      pathToFileURL(join(runtimeDir, "flow.mjs")).href
    )) as FlowRouteModule;
    if (typeof flowMod.POST !== "function") {
      throw new Error("Compiled flow.mjs missing POST handler");
    }

    const server = createServer(async (nodeReq, nodeRes) => {
      try {
        const host = nodeReq.headers.host || "127.0.0.1";
        const url = new URL(nodeReq.url || "/", `http://${host}`);
        if (url.pathname === "/healthz") {
          nodeRes.statusCode = 200;
          nodeRes.end("ok");
          return;
        }
        if (
          url.pathname === "/.well-known/workflow/v1/flow" ||
          url.pathname === "/.well-known/workflow/v1/step"
        ) {
          const chunks: Buffer[] = [];
          for await (const chunk of nodeReq) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const bodyBuf = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [k, v] of Object.entries(nodeReq.headers)) {
            if (Array.isArray(v)) {
              for (const item of v) headers.append(k, item);
            } else if (typeof v === "string") {
              headers.set(k, v);
            }
          }
          const method = nodeReq.method || "GET";
          const webReq = new Request(url.toString(), {
            method,
            headers,
            ...(method !== "GET" && method !== "HEAD" && bodyBuf.length > 0
              ? { body: bodyBuf }
              : {}),
          });
          const webRes =
            method === "POST"
              ? await flowMod.POST(webReq)
              : method === "GET" && typeof flowMod.GET === "function"
                ? await flowMod.GET(webReq)
                : new Response("Method Not Allowed", { status: 405 });
          nodeRes.statusCode = webRes.status;
          webRes.headers.forEach((val, key) => {
            nodeRes.setHeader(key, val);
          });
          const resArr = Buffer.from(await webRes.arrayBuffer());
          nodeRes.end(resArr);
          return;
        }
        nodeRes.statusCode = 404;
        nodeRes.end("Not Found");
      } catch (err) {
        nodeRes.statusCode = 500;
        nodeRes.end(err instanceof Error ? err.message : String(err));
      }
    });

    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(0, "127.0.0.1", () => res());
    });
    this.server = server;

    if (!process.env.WORKFLOW_NODE_HTTP) {
      process.env.WORKFLOW_NODE_HTTP = "1";
    }

    // Seed @workflow/world-local's packageInfo singleton so bundled sidecar runs outside node_modules
    // never fall back to version: "bundled" (which @workflow/world-local's parseVersion rejects).
    const pkgKey = Symbol.for("@workflow/world-local//packageInfo/v1");
    const g = globalThis as Record<
      symbol,
      { cached: { name: string; version: string } | null } | undefined
    >;
    const slot = g[pkgKey] ?? (g[pkgKey] = { cached: null });
    if (!slot.cached || slot.cached.version === "bundled") {
      slot.cached = { name: "@workflow/world-local", version: "5.2.1" };
    }

    const addr = server.address() as AddressInfo | null;
    const baseUrl = `http://127.0.0.1:${addr?.port ?? 0}`;
    const workflowDataDir = join(this.dataDir, "workflow-data");
    const world = createWorld({
      dataDir: workflowDataDir,
      baseUrl,
      recoverActiveRuns: false,
    });
    world.registerHandler("__wkf_workflow_", flowMod.POST);
    world.registerHandler("__wkf_step_", flowMod.POST);
    setWorld(world);
    await world.start?.();
    this.world = world;

    await this.ensureSchema();
    this.registerGlobalHostContext();
    this.initialized = true;
  }

  private async ensureSchema(): Promise<void> {
    if (!this.db) return;
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS valet_workflow_runs (
        run_id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        plugin_name TEXT NOT NULL,
        trigger_event TEXT NOT NULL,
        trigger_source TEXT NOT NULL,
        status TEXT NOT NULL,
        timeline_event_id TEXT,
        graph_snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_valet_workflow_runs_plugin
        ON valet_workflow_runs (plugin_id, created_at DESC);
    `);
  }

  private registerGlobalHostContext(): void {
    setValetWorkflowHostContext({
      executeScript: (req) => this.executeLocalScript(req),
      executeHttp: (req) => this.executeLocalHttp(req),
      executeTool: (req) => this.callbacks.executeTool(req),
      executeAgent: (req) => this.callbacks.runAgentPrompt(req),
      emitNotify: (req) => this.callbacks.emitNotify(req),
      queueApproval: async (req) => {
        const res = await this.callbacks.queueApproval(req);
        await this.updateIndexedRunStatus(req.runId, "waiting_approval");
        this.callbacks.onRunUpdated({
          pluginId: req.__valetPluginId,
          runId: req.runId,
          status: "waiting_approval",
        });
        return res;
      },
      notifyStepEvent: (info) => {
        const key = `${info.pluginId}:${info.runId ?? ""}`;
        const now = Date.now();
        const prev = this.liveStepEvents.get(key) ?? 0;
        if (now - prev >= 120 || info.phase !== "start") {
          this.liveStepEvents.set(key, now);
          this.callbacks.onRunUpdated({
            pluginId: info.pluginId,
            runId: info.runId ?? "",
            status: info.phase === "error" ? "failed" : "running",
          });
        }
      },
    });
  }

  private async executeLocalScript(req: WorkflowScriptRequest): Promise<unknown> {
    const plugin = this.callbacks.getPlugin(req.__valetPluginId);
    const pluginDir = plugin?.localDir || "";
    const stateDir = plugin ? join(this.dataDir, "plugin-state", plugin.id) : "";
    const cfgValues = plugin?.config?.values ?? {};

    const cwd = req.cwd?.trim() || pluginDir || homedir();
    const timeoutMs = Math.min(
      Math.max(req.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS, 500),
      MAX_SCRIPT_TIMEOUT_MS,
    );

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      VALET_PLUGIN_ID: req.__valetPluginId,
      ...(pluginDir ? { VALET_PLUGIN_DIR: pluginDir } : {}),
      ...(stateDir ? { VALET_PLUGIN_STATE_DIR: stateDir } : {}),
      VALET_PLUGIN_CONFIG_JSON: JSON.stringify(cfgValues),
      ...(req.env ?? {}),
    };

    const cmdBin =
      Array.isArray(req.args) && req.args.length > 0 ? req.command : "/bin/zsh";
    const cmdArgs =
      Array.isArray(req.args) && req.args.length > 0
        ? req.args
        : ["-lc", req.command];

    const startedAt = Date.now();
    const { stdout, stderr, exitCode, timedOut } = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
      timedOut: boolean;
    }>((res, rej) => {
      const child = spawn(cmdBin, cmdArgs, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let didTimeout = false;

      child.stdout?.on("data", (d: Buffer) => outChunks.push(d));
      child.stderr?.on("data", (d: Buffer) => errChunks.push(d));

      const timer = setTimeout(() => {
        didTimeout = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore kill error
        }
      }, timeoutMs);

      child.once("error", (err) => {
        clearTimeout(timer);
        rej(err);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        res({
          stdout: Buffer.concat(outChunks).toString("utf8"),
          stderr: Buffer.concat(errChunks).toString("utf8"),
          exitCode: code ?? (didTimeout ? 137 : 1),
          timedOut: didTimeout,
        });
      });
    });

    const durationMs = Date.now() - startedAt;

    if (timedOut) {
      throw new Error(`脚本执行超时 (${timeoutMs}ms): ${req.command}`);
    }
    if (exitCode !== 0) {
      const errDetail = (stderr || stdout).trim().slice(0, 600);
      throw new Error(
        `脚本退出码 ${exitCode}${errDetail ? `: ${errDetail}` : ""}`,
      );
    }

    let parsedJson: unknown;
    if (req.parseJson) {
      try {
        parsedJson = JSON.parse(stdout.trim());
      } catch (err) {
        throw new Error(
          `脚本输出无法解析为 JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      parsedJson = safeTryParseJson(stdout);
    }

    return {
      exitCode,
      stdout: stdout.trimEnd(),
      stderr: stderr.trimEnd(),
      ...(parsedJson !== undefined ? { json: parsedJson } : {}),
      durationMs,
    };
  }

  private async executeLocalHttp(req: WorkflowHttpRequest): Promise<unknown> {
    const method = (req.method || "GET").toUpperCase();
    const timeoutMs = Math.min(
      Math.max(req.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS, 500),
      MAX_SCRIPT_TIMEOUT_MS,
    );
    const headers = new Headers(req.headers ?? {});
    let bodyInit: string | undefined;
    if (req.body !== undefined && method !== "GET" && method !== "HEAD") {
      if (typeof req.body === "string") {
        bodyInit = req.body;
      } else {
        bodyInit = JSON.stringify(req.body);
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      }
    }

    const startedAt = Date.now();
    const resp = await fetch(req.url, {
      method,
      headers,
      body: bodyInit,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await resp.text();
    const durationMs = Date.now() - startedAt;
    const json = safeTryParseJson(text);

    if (!resp.ok) {
      throw new Error(
        `HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 400)}`,
      );
    }

    return {
      status: resp.status,
      ok: resp.ok,
      headers: Object.fromEntries(resp.headers.entries()),
      text,
      ...(json !== undefined ? { json } : {}),
      durationMs,
    };
  }

  validateYaml(yaml: string): WorkflowValidationResponse {
    const res = parseAndValidateWorkflowYaml(yaml);
    return {
      valid: res.valid,
      errors: res.errors,
      definition: res.workflow,
      topologicalOrder: res.topologicalOrder ?? [],
      entryNodeIds: res.entryNodeIds ?? [],
    };
  }

  getPluginGraph(plugin: PluginState): WorkflowGraphResponse {
    const yaml = plugin.workflowYaml?.trim() ?? "";
    const executionMode =
      plugin.executionMode === "workflow" ? "workflow" : "skill";

    if (!yaml) {
      return {
        pluginId: plugin.id,
        executionMode,
        workflowYaml: plugin.workflowYaml ?? "",
        valid: false,
        errors: ["workflow.yaml 尚未配置内容"],
        entryNodeIds: [],
        topologicalOrder: [],
      };
    }

    const validation = parseAndValidateWorkflowYaml(yaml);
    return {
      pluginId: plugin.id,
      executionMode,
      workflowYaml: plugin.workflowYaml ?? "",
      valid: validation.valid,
      errors: validation.errors,
      definition: validation.workflow,
      entryNodeIds: validation.entryNodeIds ?? [],
      topologicalOrder: validation.topologicalOrder ?? [],
    };
  }

  async startPluginWorkflow(
    opts: StartPluginWorkflowOptions,
  ): Promise<WorkflowRunDetail> {
    await this.init();
    const world = this.requireWorld();

    const rawYaml = opts.plugin.workflowYaml?.trim() ?? "";
    const validation = parseAndValidateWorkflowYaml(rawYaml);
    if (!validation.valid || !validation.workflow) {
      throw new Error(
        `Workflow 定义校验失败: ${validation.errors.join("; ")}`,
      );
    }

    const triggerEvent = opts.event?.trim() || "manual";
    const triggerSource = opts.source?.trim() || "manual";
    const nowIso = new Date().toISOString();

    const runInput: PluginWorkflowRunInput = {
      pluginId: opts.plugin.id,
      pluginName: opts.plugin.name,
      workflowYaml: rawYaml,
      definition: validation.workflow,
      config: { ...(opts.plugin.config?.values ?? {}) },
      trigger: {
        event: triggerEvent,
        source: triggerSource,
        summary:
          opts.summary?.trim() ||
          `${opts.plugin.name} 工作流触发 (${triggerEvent})`,
        payload: opts.payload ?? {},
        triggeredAt: nowIso,
      },
      timelineEventId: opts.timelineEventId,
    };

    const run = await wfStart(
      { workflowId: this.workflowId },
      [runInput],
      { world },
    );

    const row: IndexedRunRow = {
      run_id: run.runId,
      plugin_id: opts.plugin.id,
      plugin_name: opts.plugin.name,
      trigger_event: triggerEvent,
      trigger_source: triggerSource,
      status: "running",
      timeline_event_id: opts.timelineEventId ?? null,
      graph_snapshot_json: JSON.stringify(validation.workflow),
      created_at: nowIso,
      updated_at: nowIso,
      completed_at: null,
      error_message: null,
    };
    await this.upsertIndexedRun(row);

    this.callbacks.onRunUpdated({
      pluginId: opts.plugin.id,
      runId: run.runId,
      status: "running",
      timelineEventId: opts.timelineEventId,
    });

    const completionPromise = Promise.resolve(run.returnValue)
      .then(async (rawOut) => {
        const output = rawOut as
          | { nodeStatuses?: Record<string, string> }
          | undefined;
        const doneIso = new Date().toISOString();
        await this.updateIndexedRunStatus(run.runId, "completed", doneIso);
        const completedCount = output?.nodeStatuses
          ? Object.values(output.nodeStatuses).filter((s) => s === "completed")
              .length
          : undefined;
        this.callbacks.onRunUpdated({
          pluginId: opts.plugin.id,
          runId: run.runId,
          status: "completed",
          timelineEventId: opts.timelineEventId,
          completedNodeCount: completedCount,
        });
      })
      .catch(async (err) => {
        const latest = await world.runs
          .get(run.runId, { resolveData: "none" })
          .catch(() => null);
        const finalStatus: WorkflowRunStatus =
          latest?.status === "cancelled" ? "cancelled" : "failed";
        const errMsg =
          finalStatus === "cancelled"
            ? "工作流已取消"
            : err instanceof Error
              ? err.message
              : String(err);
        const doneIso = new Date().toISOString();
        await this.updateIndexedRunStatus(
          run.runId,
          finalStatus,
          doneIso,
          errMsg,
        );
        this.callbacks.onRunUpdated({
          pluginId: opts.plugin.id,
          runId: run.runId,
          status: finalStatus,
          error: errMsg,
          timelineEventId: opts.timelineEventId,
        });
      });

    if (opts.waitForCompletionMs && opts.waitForCompletionMs > 0) {
      await Promise.race([
        completionPromise,
        new Promise<void>((r) => setTimeout(r, opts.waitForCompletionMs)),
      ]);
    }

    return await this.getRunDetail(run.runId);
  }

  async listPluginRuns(
    pluginId: string,
    limit = 30,
  ): Promise<WorkflowRunSummary[]> {
    await this.init();
    const safeLimit = Math.min(Math.max(limit || 30, 1), 200);
    const rows = await this.fetchIndexedRuns(pluginId, safeLimit);

    const summaries: WorkflowRunSummary[] = [];
    for (const row of rows) {
      let status = (row.status || "running") as WorkflowRunStatus;
      let completedAt = row.completed_at ?? undefined;
      let errorMessage = row.error_message ?? undefined;

      if (
        this.world &&
        (status === "pending" ||
          status === "running" ||
          status === "waiting_approval")
      ) {
        try {
          const detail = await this.getRunDetail(row.run_id);
          status = detail.summary.status;
          completedAt = detail.summary.completedAt;
          errorMessage = detail.summary.errorMessage;
        } catch {
          // Preserve indexed status if run cannot be hydrated
        }
      }

      summaries.push({
        runId: row.run_id,
        pluginId: row.plugin_id,
        pluginName: row.plugin_name,
        triggerEvent: row.trigger_event,
        triggerSource: row.trigger_source,
        status,
        timelineEventId: row.timeline_event_id ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt,
        errorMessage,
        durationMs: diffMs(row.created_at, completedAt),
      });
    }
    return summaries;
  }

  async getRunDetail(runId: string): Promise<WorkflowRunDetail> {
    await this.init();
    const world = this.requireWorld();

    const row = await this.fetchIndexedRunById(runId);
    const rawRun = await world.runs.get(runId, { resolveData: "all" });
    const rawStepsPage = await world.steps.list({
      runId,
      resolveData: "all",
      pagination: { limit: 500 },
    });
    const rawHooksPage = await world.hooks.list({
      runId,
      resolveData: "all",
      pagination: { limit: 100 },
    });

    const run = hydrateResourceIO(rawRun, valetObservabilityRevivers) as Record<
      string,
      unknown
    >;
    const hydratedSteps = rawStepsPage.data.map(
      (s) =>
        hydrateResourceIO(s, valetObservabilityRevivers) as Record<
          string,
          unknown
        >,
    );
    const hydratedHooks = rawHooksPage.data.map(
      (h) =>
        hydrateResourceIO(h, valetObservabilityRevivers) as Record<
          string,
          unknown
        >,
    );

    const extractArg0 = (
      val: unknown,
    ): Record<string, unknown> | undefined => {
      if (Array.isArray(val)) {
        const first = val[0];
        return first && typeof first === "object"
          ? (first as Record<string, unknown>)
          : undefined;
      }
      if (val && typeof val === "object") {
        const rec = val as Record<string, unknown>;
        if (Array.isArray(rec.args)) {
          const first = rec.args[0];
          return first && typeof first === "object"
            ? (first as Record<string, unknown>)
            : undefined;
        }
        return rec;
      }
      return undefined;
    };

    const firstArg = extractArg0(run.input) as
      | PluginWorkflowRunInput
      | undefined;
    let definition: WorkflowDefinition | undefined = firstArg?.definition;
    if (!definition && row?.graph_snapshot_json) {
      try {
        definition = JSON.parse(row.graph_snapshot_json) as WorkflowDefinition;
      } catch {
        definition = undefined;
      }
    }
    if (!definition) {
      const fallbackPlugin = row
        ? this.callbacks.getPlugin(row.plugin_id)
        : undefined;
      if (fallbackPlugin?.workflowYaml) {
        definition =
          parseAndValidateWorkflowYaml(fallbackPlugin.workflowYaml).workflow;
      }
    }
    if (!definition) {
      definition = { version: 1, nodes: [], edges: [] };
    }

    const hookByNodeId = new Map<
      string,
      { token: string; metadata?: Record<string, unknown> }
    >();
    for (const h of hydratedHooks) {
      const meta =
        h.metadata && typeof h.metadata === "object"
          ? (h.metadata as Record<string, unknown>)
          : undefined;
      const nodeId = typeof meta?.nodeId === "string" ? meta.nodeId : "";
      const token = typeof h.token === "string" ? h.token : "";
      if (nodeId && token) {
        hookByNodeId.set(nodeId, { token, metadata: meta });
      }
    }

    // Group recorded steps by __valetNodeId in chronological order
    const stepsByNodeId = new Map<string, Array<Record<string, unknown>>>();
    for (const step of hydratedSteps) {
      const reqMeta = extractArg0(step.input);
      const nodeId =
        typeof reqMeta?.__valetNodeId === "string"
          ? reqMeta.__valetNodeId
          : "";
      if (!nodeId) continue;
      const list = stepsByNodeId.get(nodeId) ?? [];
      list.push(step);
      stepsByNodeId.set(nodeId, list);
    }

    for (const list of stepsByNodeId.values()) {
      list.sort((a, b) => {
        const aTime = Date.parse(toIsoString(a.createdAt) ?? "") || 0;
        const bTime = Date.parse(toIsoString(b.createdAt) ?? "") || 0;
        return aTime - bTime;
      });
    }

    const runRawStatus = String(run.status || "running");
    const runOutputObj =
      run.output && typeof run.output === "object"
        ? (run.output as Record<string, unknown>)
        : undefined;
    const finalStatusesMap =
      runOutputObj?.nodeStatuses &&
      typeof runOutputObj.nodeStatuses === "object"
        ? (runOutputObj.nodeStatuses as Record<string, string>)
        : undefined;

    const nodeStates: WorkflowNodeRunState[] = [];
    const nodeStateById = new Map<string, WorkflowNodeRunState>();
    let anyWaitingApproval = false;

    for (const node of definition.nodes) {
      const matchedSteps = stepsByNodeId.get(node.id) ?? [];
      const firstStep = matchedSteps[0];
      const lastStep =
        matchedSteps.length > 0
          ? matchedSteps[matchedSteps.length - 1]
          : undefined;

      const extractUserInput = (stepRec?: Record<string, unknown>): unknown => {
        if (!stepRec) return undefined;
        const reqMeta = extractArg0(stepRec.input);
        if (!reqMeta) return undefined;
        return "input" in reqMeta ? reqMeta.input : reqMeta;
      };

      const startedAt =
        toIsoString(firstStep?.startedAt) ?? toIsoString(firstStep?.createdAt);
      let completedAt = toIsoString(lastStep?.completedAt);
      let status: WorkflowNodeStatus = "pending";
      const inputVal = extractUserInput(firstStep);
      let outputVal: unknown = lastStep?.output;
      let errorVal = extractErrorMessage(lastStep?.error);
      let hookToken: string | undefined;
      let inboxId: string | undefined;

      if (matchedSteps.length === 0) {
        status =
          finalStatusesMap?.[node.id] === "skipped" ? "skipped" : "pending";
      } else if (node.type === "sleep") {
        const doneStep = matchedSteps.find((s) =>
          String(s.stepName ?? "").includes("recordSleepDoneStep"),
        );
        const startStep = matchedSteps.find((s) =>
          String(s.stepName ?? "").includes("recordSleepStartStep"),
        );
        const failedStep = matchedSteps.find((s) => s.status === "failed");
        if (failedStep) {
          status = "failed";
          errorVal = extractErrorMessage(failedStep.error);
          completedAt = toIsoString(failedStep.completedAt);
        } else if (doneStep?.status === "completed") {
          status = "completed";
          outputVal = doneStep.output;
          completedAt = toIsoString(doneStep.completedAt);
        } else if (
          runRawStatus === "cancelled" ||
          runRawStatus === "failed"
        ) {
          status = runRawStatus;
          completedAt = toIsoString(run.completedAt);
        } else if (startStep) {
          status = "running";
          outputVal = startStep.output;
          completedAt = undefined;
        }
      } else if (node.type === "approval") {
        const queueStep = matchedSteps.find((s) =>
          String(s.stepName ?? "").includes("queueApprovalStep"),
        );
        const resultStep = matchedSteps.find((s) =>
          String(s.stepName ?? "").includes("recordApprovalResultStep"),
        );
        const failedStep = matchedSteps.find((s) => s.status === "failed");
        const qOut =
          queueStep?.output && typeof queueStep.output === "object"
            ? (queueStep.output as Record<string, unknown>)
            : undefined;
        hookToken =
          (typeof qOut?.token === "string" ? qOut.token : undefined) ??
          hookByNodeId.get(node.id)?.token;
        inboxId = typeof qOut?.inboxId === "string" ? qOut.inboxId : undefined;

        if (failedStep) {
          status = "failed";
          errorVal = extractErrorMessage(failedStep.error);
          completedAt = toIsoString(failedStep.completedAt);
        } else if (resultStep?.status === "completed") {
          status = "completed";
          outputVal = resultStep.output;
          completedAt = toIsoString(resultStep.completedAt);
        } else if (
          queueStep?.status === "completed" &&
          (runRawStatus === "running" || runRawStatus === "pending")
        ) {
          status = "waiting_approval";
          anyWaitingApproval = true;
          completedAt = undefined;
          outputVal = {
            waitingApproval: true,
            hookToken,
            inboxId,
          };
        } else if (
          runRawStatus === "cancelled" ||
          runRawStatus === "failed"
        ) {
          status = runRawStatus;
          completedAt = toIsoString(run.completedAt);
        } else {
          status = "running";
        }
      } else {
        const sStatus = String(lastStep?.status ?? "pending");
        if (sStatus === "completed") status = "completed";
        else if (sStatus === "failed") status = "failed";
        else if (sStatus === "cancelled") status = "cancelled";
        else status = "running";
      }

      if (finalStatusesMap?.[node.id] === "skipped") {
        status = "skipped";
      }

      const ns: WorkflowNodeRunState = {
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name || node.id,
        status,
        attempt: typeof lastStep?.attempt === "number" ? lastStep.attempt : 0,
        startedAt,
        completedAt,
        durationMs: diffMs(startedAt, completedAt),
        ...(inputVal !== undefined ? { input: inputVal } : {}),
        ...(outputVal !== undefined ? { output: outputVal } : {}),
        ...(errorVal ? { error: errorVal } : {}),
        ...(hookToken ? { hookToken } : {}),
        ...(inboxId ? { inboxId } : {}),
      };
      nodeStates.push(ns);
      nodeStateById.set(node.id, ns);
    }

    // Reconstruct edge states (and infer skipped downstream nodes if still running)
    const nodeById = new Map<string, WorkflowNodeDef>(
      definition.nodes.map((n) => [n.id, n]),
    );
    const incomingEdgesByNode = new Map<string, WorkflowEdgeDef[]>();
    const edgeStateMap = new Map<string, "pending" | "taken" | "skipped">();
    for (const node of definition.nodes) {
      incomingEdgesByNode.set(node.id, []);
    }
    for (const edge of definition.edges) {
      incomingEdgesByNode.get(edge.to)?.push(edge);
      edgeStateMap.set(edge.id, "pending");
    }

    const computeEdgeState = (
      edge: WorkflowEdgeDef,
    ): "pending" | "taken" | "skipped" => {
      const fromState = nodeStateById.get(edge.from);
      const fromNode = nodeById.get(edge.from);
      if (!fromState || !fromNode) return "pending";
      if (fromState.status === "skipped") return "skipped";
      if (fromState.status === "completed") {
        return edgeMatchesOutcomeForDisplay(edge, fromNode, fromState.output)
          ? "taken"
          : "skipped";
      }
      return "pending";
    };

    // Propagate edge/skipped inferences iteratively along DAG
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of definition.edges) {
        const next = computeEdgeState(edge);
        if (edgeStateMap.get(edge.id) !== next) {
          edgeStateMap.set(edge.id, next);
          changed = true;
        }
      }
      for (const node of definition.nodes) {
        const st = nodeStateById.get(node.id);
        if (!st || st.status !== "pending") continue;
        const incoming = incomingEdgesByNode.get(node.id) ?? [];
        if (incoming.length === 0) continue;
        const allSkipped = incoming.every(
          (e) => edgeStateMap.get(e.id) === "skipped",
        );
        if (allSkipped) {
          st.status = "skipped";
          changed = true;
        }
      }
    }

    const edgeStates: WorkflowEdgeRunState[] = definition.edges.map((e) => ({
      edgeId: e.id,
      from: e.from,
      to: e.to,
      status: edgeStateMap.get(e.id) ?? "pending",
    }));

    let displayStatus: WorkflowRunStatus;
    if (runRawStatus === "completed") displayStatus = "completed";
    else if (runRawStatus === "failed") displayStatus = "failed";
    else if (runRawStatus === "cancelled") displayStatus = "cancelled";
    else if (anyWaitingApproval) displayStatus = "waiting_approval";
    else if (runRawStatus === "pending") displayStatus = "pending";
    else displayStatus = "running";

    const createdAt =
      toIsoString(run.createdAt) ?? row?.created_at ?? new Date().toISOString();
    const updatedAt = toIsoString(run.updatedAt) ?? row?.updated_at ?? createdAt;
    const completedAt =
      toIsoString(run.completedAt) ?? row?.completed_at ?? undefined;
    const errorMessage =
      extractErrorMessage(run.error) ?? row?.error_message ?? undefined;

    if (row && row.status !== displayStatus) {
      await this.updateIndexedRunStatus(
        runId,
        displayStatus,
        completedAt,
        errorMessage,
      );
    }

    const summary: WorkflowRunSummary = {
      runId,
      pluginId: row?.plugin_id ?? firstArg?.pluginId ?? "",
      pluginName: row?.plugin_name ?? firstArg?.pluginName ?? "",
      triggerEvent: row?.trigger_event ?? firstArg?.trigger?.event ?? "manual",
      triggerSource: row?.trigger_source ?? firstArg?.trigger?.source ?? "manual",
      status: displayStatus,
      timelineEventId: row?.timeline_event_id ?? firstArg?.timelineEventId,
      createdAt,
      updatedAt,
      completedAt,
      errorMessage,
      durationMs: diffMs(createdAt, completedAt),
    };

    return {
      summary,
      definition,
      triggerInput: firstArg?.trigger,
      nodes: nodeStates,
      edges: edgeStates,
    };
  }

  async cancelRun(runId: string): Promise<{ cancelled: boolean }> {
    await this.init();
    const world = this.requireWorld();
    const row = await this.fetchIndexedRunById(runId);
    await wfCancelRun(world, runId);
    const doneIso = new Date().toISOString();
    await this.updateIndexedRunStatus(runId, "cancelled", doneIso, "工作流已取消");
    if (row) {
      this.callbacks.onRunUpdated({
        pluginId: row.plugin_id,
        runId,
        status: "cancelled",
        error: "工作流已取消",
        timelineEventId: row.timeline_event_id ?? undefined,
      });
    }
    return { cancelled: true };
  }

  async resumeHook(
    token: string,
    payload: WorkflowApprovalDecision,
  ): Promise<{ resumed: boolean; runId?: string }> {
    await this.init();
    const world = this.requireWorld();
    const hook = await world.hooks.getByToken(token).catch(() => null);
    const res = await wfResumeHook<WorkflowApprovalDecision>(token, payload);
    const runId = hook?.runId ?? res?.runId;
    if (runId) {
      await this.updateIndexedRunStatus(runId, "running");
      const row = await this.fetchIndexedRunById(runId);
      if (row) {
        this.callbacks.onRunUpdated({
          pluginId: row.plugin_id,
          runId,
          status: "running",
          timelineEventId: row.timeline_event_id ?? undefined,
        });
      }
    }
    return { resumed: true, runId };
  }

  async close(): Promise<void> {
    setValetWorkflowHostContext(undefined);
    if (this.world) {
      await this.world.close?.();
      this.world = null;
    }
    if (this.server) {
      const srv = this.server;
      this.server = null;
      await new Promise<void>((res) => srv.close(() => res()));
    }
    this.initialized = false;
    this.initPromise = null;
  }

  private requireWorld(): LocalWorld {
    if (!this.world) {
      throw new Error("ValetWorkflowManager is not initialized");
    }
    return this.world;
  }

  private async upsertIndexedRun(row: IndexedRunRow): Promise<void> {
    this.memoryIndex.set(row.run_id, row);
    if (!this.db) return;
    await this.db.run(
      `INSERT OR REPLACE INTO valet_workflow_runs (
        run_id, plugin_id, plugin_name, trigger_event, trigger_source,
        status, timeline_event_id, graph_snapshot_json,
        created_at, updated_at, completed_at, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.run_id,
      row.plugin_id,
      row.plugin_name,
      row.trigger_event,
      row.trigger_source,
      row.status,
      row.timeline_event_id,
      row.graph_snapshot_json,
      row.created_at,
      row.updated_at,
      row.completed_at,
      row.error_message,
    );
  }

  private async updateIndexedRunStatus(
    runId: string,
    status: WorkflowRunStatus,
    completedAt?: string,
    errorMessage?: string,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const existing = this.memoryIndex.get(runId);
    if (existing) {
      existing.status = status;
      existing.updated_at = nowIso;
      if (completedAt !== undefined) existing.completed_at = completedAt;
      if (errorMessage !== undefined) existing.error_message = errorMessage;
    }
    if (!this.db) return;
    await this.db.run(
      `UPDATE valet_workflow_runs
       SET status = ?,
           updated_at = ?,
           completed_at = COALESCE(?, completed_at),
           error_message = COALESCE(?, error_message)
       WHERE run_id = ?`,
      status,
      nowIso,
      completedAt ?? null,
      errorMessage ?? null,
      runId,
    );
  }

  private async fetchIndexedRuns(
    pluginId: string,
    limit: number,
  ): Promise<IndexedRunRow[]> {
    if (!this.db) {
      return [...this.memoryIndex.values()]
        .filter((r) => !pluginId || r.plugin_id === pluginId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    }
    if (pluginId) {
      return await this.db.all<IndexedRunRow>(
        `SELECT * FROM valet_workflow_runs
         WHERE plugin_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        pluginId,
        limit,
      );
    }
    return await this.db.all<IndexedRunRow>(
      `SELECT * FROM valet_workflow_runs
       ORDER BY created_at DESC
       LIMIT ?`,
      limit,
    );
  }

  private async fetchIndexedRunById(
    runId: string,
  ): Promise<IndexedRunRow | undefined> {
    if (!this.db) {
      return this.memoryIndex.get(runId);
    }
    const row = await this.db.get<IndexedRunRow>(
      `SELECT * FROM valet_workflow_runs WHERE run_id = ?`,
      runId,
    );
    return row ?? this.memoryIndex.get(runId);
  }
}
