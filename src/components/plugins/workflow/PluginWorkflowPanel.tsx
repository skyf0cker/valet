import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useValet } from "../../../store/ValetContext";
import type {
  PluginState,
  WorkflowGraphResponse,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "../../../types/valet";
import {
  WORKFLOW_STATUS_META,
  formatWorkflowDuration,
  formatWorkflowTime,
} from "../../../utils/workflowYaml";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowNodeInspector } from "./WorkflowNodeInspector";

type PanelTab = "canvas" | "yaml";

export const PluginWorkflowPanel: React.FC<{ plugin: PluginState }> = ({
  plugin,
}) => {
  const {
    getPluginWorkflowGraph,
    listPluginWorkflowRuns,
    getWorkflowRunDetail,
    triggerPluginWorkflow,
    cancelWorkflowRun,
    resumeWorkflowHook,
    updatePluginWorkflow,
    lastWorkflowUpdate,
    pushToast,
  } = useValet();

  const [tab, setTab] = useState<PanelTab>("canvas");
  const [graph, setGraph] = useState<WorkflowGraphResponse | null>(null);
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [yamlDraft, setYamlDraft] = useState(plugin.workflowYaml ?? "");
  const [yamlErrors, setYamlErrors] = useState<string[]>([]);
  const [savingYaml, setSavingYaml] = useState(false);

  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showTriggerOpts, setShowTriggerOpts] = useState(false);
  const [triggerEvent, setTriggerEvent] = useState(
    plugin.events[0]?.id || "manual"
  );
  const [triggerPayloadText, setTriggerPayloadText] = useState(
    '{\n  "source": "manual_run"\n}'
  );

  useEffect(() => {
    setYamlDraft(plugin.workflowYaml ?? "");
    setTriggerEvent(plugin.events[0]?.id || "manual");
  }, [plugin.id, plugin.workflowYaml, plugin.events]);

  const loadGraphAndRuns = useCallback(
    async (keepRunId?: string | null) => {
      setLoading(true);
      try {
        const [g, list] = await Promise.all([
          getPluginWorkflowGraph(plugin.id),
          listPluginWorkflowRuns(plugin.id, 30),
        ]);
        setGraph(g);
        setYamlErrors(g.valid ? [] : g.errors);
        setRuns(list);

        const targetRunId =
          keepRunId !== undefined
            ? keepRunId
            : selectedRunId ?? list[0]?.runId ?? null;
        if (targetRunId) {
          setSelectedRunId(targetRunId);
          try {
            const detail = await getWorkflowRunDetail(targetRunId);
            setRunDetail(detail);
          } catch {
            setRunDetail(null);
          }
        } else {
          setSelectedRunId(null);
          setRunDetail(null);
        }

        if (g.definition?.nodes.length && !selectedNodeId) {
          setSelectedNodeId(g.definition.nodes[0]?.id ?? null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setYamlErrors([msg]);
      } finally {
        setLoading(false);
      }
    },
    [
      plugin.id,
      getPluginWorkflowGraph,
      listPluginWorkflowRuns,
      getWorkflowRunDetail,
      selectedRunId,
      selectedNodeId,
    ]
  );

  useEffect(() => {
    setSelectedRunId(null);
    setRunDetail(null);
    setSelectedNodeId(null);
    void loadGraphAndRuns(undefined);
    // Intentionally triggered on plugin switch or workflowYaml update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.id, plugin.workflowYaml]);

  // Refresh live when sidecar emits workflow:updated for this plugin
  useEffect(() => {
    if (!lastWorkflowUpdate || lastWorkflowUpdate.payload.pluginId !== plugin.id) {
      return;
    }
    const updatedRunId = lastWorkflowUpdate.payload.runId;
    void (async () => {
      try {
        const list = await listPluginWorkflowRuns(plugin.id, 30);
        setRuns(list);
        const focusRunId = selectedRunId ?? updatedRunId;
        if (focusRunId) {
          if (!selectedRunId) {
            setSelectedRunId(focusRunId);
          }
          const detail = await getWorkflowRunDetail(focusRunId);
          setRunDetail(detail);
        }
      } catch {
        // Ignore transient fetch errors during background updates
      }
    })();
  }, [
    lastWorkflowUpdate,
    plugin.id,
    selectedRunId,
    listPluginWorkflowRuns,
    getWorkflowRunDetail,
  ]);

  // Belt-and-suspenders short polling while an active run is in flight
  useEffect(() => {
    const st = runDetail?.summary.status;
    if (!selectedRunId || (st !== "running" && st !== "pending")) {
      return;
    }
    const timer = window.setInterval(() => {
      void getWorkflowRunDetail(selectedRunId)
        .then((d) => {
          setRunDetail(d);
          if (d.summary.status !== "running" && d.summary.status !== "pending") {
            void listPluginWorkflowRuns(plugin.id, 30).then(setRuns);
          }
        })
        .catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [
    selectedRunId,
    runDetail?.summary.status,
    plugin.id,
    getWorkflowRunDetail,
    listPluginWorkflowRuns,
  ]);

  const handleSelectRun = async (runId: string | null) => {
    setSelectedRunId(runId);
    if (!runId) {
      setRunDetail(null);
      return;
    }
    try {
      const detail = await getWorkflowRunDetail(runId);
      setRunDetail(detail);
      if (
        detail.definition.nodes.length > 0 &&
        (!selectedNodeId ||
          !detail.definition.nodes.some((n) => n.id === selectedNodeId))
      ) {
        setSelectedNodeId(detail.definition.nodes[0]?.id ?? null);
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "danger");
    }
  };

  const handleRunWorkflow = async () => {
    let payload: Record<string, unknown> = {};
    if (triggerPayloadText.trim()) {
      try {
        const parsed = JSON.parse(triggerPayloadText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        } else {
          payload = { value: parsed };
        }
      } catch (err) {
        pushToast(
          `触发 Payload JSON 格式错误: ${err instanceof Error ? err.message : String(err)}`,
          "danger"
        );
        return;
      }
    }

    setRunning(true);
    try {
      const detail = await triggerPluginWorkflow({
        pluginId: plugin.id,
        event: triggerEvent || plugin.events[0]?.id || "manual",
        source: "manual",
        payload,
        waitForCompletionMs: 1200,
      });
      setSelectedRunId(detail.summary.runId);
      setRunDetail(detail);
      if (
        detail.definition.nodes.length > 0 &&
        (!selectedNodeId ||
          !detail.definition.nodes.some((n) => n.id === selectedNodeId))
      ) {
        setSelectedNodeId(detail.definition.nodes[0]?.id ?? null);
      }
      const list = await listPluginWorkflowRuns(plugin.id, 30);
      setRuns(list);
      setTab("canvas");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setRunning(false);
    }
  };

  const handleCancelRun = async () => {
    if (!selectedRunId) return;
    setCancelling(true);
    try {
      const detail = await cancelWorkflowRun(selectedRunId);
      setRunDetail(detail);
      const list = await listPluginWorkflowRuns(plugin.id, 30);
      setRuns(list);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setCancelling(false);
    }
  };

  const handleResumeApproval = async (hookToken: string, approved: boolean) => {
    setResuming(true);
    try {
      const detail = await resumeWorkflowHook({
        token: hookToken,
        approved,
        decidedBy: "user",
      });
      if (detail?.summary?.runId) {
        setRunDetail(detail);
      } else if (selectedRunId) {
        const refreshed = await getWorkflowRunDetail(selectedRunId);
        setRunDetail(refreshed);
      }
      const list = await listPluginWorkflowRuns(plugin.id, 30);
      setRuns(list);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setResuming(false);
    }
  };

  const handleSaveYaml = async () => {
    setSavingYaml(true);
    try {
      await updatePluginWorkflow(plugin.id, yamlDraft);
      setYamlErrors([]);
      const g = await getPluginWorkflowGraph(plugin.id);
      setGraph(g);
      setTab("canvas");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setYamlErrors([msg]);
    } finally {
      setSavingYaml(false);
    }
  };

  const activeDefinition = runDetail?.definition ?? graph?.definition;
  const selectedNode = useMemo(() => {
    if (!activeDefinition || !selectedNodeId) return null;
    return activeDefinition.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [activeDefinition, selectedNodeId]);

  const selectedNodeRun = useMemo(() => {
    if (!runDetail || !selectedNodeId) return undefined;
    return runDetail.nodes.find((n) => n.nodeId === selectedNodeId);
  }, [runDetail, selectedNodeId]);

  const activeRunStatus = runDetail?.summary.status;
  const canCancelActiveRun =
    activeRunStatus === "running" ||
    activeRunStatus === "pending" ||
    activeRunStatus === "waiting_approval";

  return (
    <div className="flex flex-col gap-3.5">
      {/* Workflow Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="inline-flex items-center rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-subtle)] p-[2px]">
          <button
            type="button"
            onClick={() => setTab("canvas")}
            className={`cursor-pointer rounded-[6px] px-3 py-1 text-[11.5px] font-medium transition-colors ${
              tab === "canvas"
                ? "bg-[var(--bg-segment-active)] text-[var(--ink-strong)] shadow-xs"
                : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            }`}
          >
            画布与运行记录
          </button>
          <button
            type="button"
            onClick={() => setTab("yaml")}
            className={`cursor-pointer rounded-[6px] px-3 py-1 text-[11.5px] font-medium transition-colors ${
              tab === "yaml"
                ? "bg-[var(--bg-segment-active)] text-[var(--ink-strong)] shadow-xs"
                : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            }`}
          >
            编辑 workflow.yaml
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCancelActiveRun && tab === "canvas" && (
            <button
              type="button"
              disabled={cancelling}
              onClick={() => void handleCancelRun()}
              className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--danger)]/40 px-2.5 text-[11px] font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
            >
              {cancelling ? "取消中…" : "取消运行"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowTriggerOpts((v) => !v)}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11px] font-medium text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
          >
            {showTriggerOpts ? "收起触发参数" : "自定义触发参数"}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadGraphAndRuns(selectedRunId)}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)] disabled:opacity-50"
          >
            刷新
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => void handleRunWorkflow()}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-3 text-[11px] font-semibold text-[var(--ink-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {running ? "启动中…" : "运行 Workflow"}
          </button>
        </div>
      </div>

      {/* Custom trigger payload drawer */}
      {showTriggerOpts && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-subtle)] p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[11.5px] text-[var(--ink-strong)]">
              <span>事件码:</span>
              <input
                type="text"
                value={triggerEvent}
                onChange={(e) => setTriggerEvent(e.target.value)}
                className="h-7 rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
              />
            </label>
            <span className="text-[11px] text-[var(--ink-muted)]">
              在节点中使用{" "}
              <code className="font-mono">{"{{trigger.payload.*}}"}</code>{" "}
              引用以下字段
            </span>
          </div>
          <textarea
            rows={3}
            value={triggerPayloadText}
            onChange={(e) => setTriggerPayloadText(e.target.value)}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-code)] p-2 font-mono text-[11px] leading-[16px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
          />
        </div>
      )}

      {/* Validation error banner */}
      {yamlErrors.length > 0 && (
        <div className="rounded-[9px] border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-3 py-2 text-[11.5px] text-[var(--danger)]">
          <div className="font-semibold">workflow.yaml 校验未通过：</div>
          <ul className="mt-0.5 list-disc pl-4">
            {yamlErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {tab === "yaml" ? (
        <div className="flex flex-col gap-2.5">
          <textarea
            rows={15}
            value={yamlDraft}
            onChange={(e) => setYamlDraft(e.target.value)}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="定义 version / nodes / edges…"
            className="w-full rounded-[10px] border border-[var(--border-control)] bg-[var(--bg-code)] p-3.5 font-mono text-[11.5px] leading-[18px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-[var(--ink-muted)]">
              支持节点类型：trigger · script · http · tool · agent · condition · transform · sleep · approval · notify
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setYamlDraft(plugin.workflowYaml ?? "");
                  setTab("canvas");
                }}
                className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11px] font-medium text-[var(--ink-muted)]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={savingYaml}
                onClick={() => void handleSaveYaml()}
                className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-3 text-[11px] font-semibold text-[var(--ink-on-primary)] disabled:opacity-50"
              >
                {savingYaml ? "校验并保存…" : "保存 workflow.yaml"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Split Canvas (Left) + Node I/O Inspector (Right) */}
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="min-w-0 flex-1">
              <WorkflowCanvas
                definition={activeDefinition}
                nodeStates={runDetail?.nodes}
                edgeStates={runDetail?.edges}
                selectedNodeId={selectedNodeId}
                onSelectNode={(id) => setSelectedNodeId(id)}
              />
            </div>
            <div className="w-full shrink-0 lg:w-[340px]">
              <WorkflowNodeInspector
                node={selectedNode}
                nodeRun={selectedNodeRun}
                hasActiveRun={Boolean(runDetail)}
                resuming={resuming}
                onResumeApproval={handleResumeApproval}
              />
            </div>
          </div>

          {/* Execution Run History List */}
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[12.5px] font-semibold text-[var(--ink-strong)]">
                  执行记录（{runs.length}）
                </h3>
                <span className="text-[11px] text-[var(--ink-muted)]">
                  由本地 Vercel Workflow SDK 持久化驱动，点击某条记录在画布与右侧面板查看节点运行状态及输入输出
                </span>
              </div>
              {selectedRunId && (
                <button
                  type="button"
                  onClick={() => void handleSelectRun(null)}
                  className="cursor-pointer text-[11px] font-medium text-[var(--ink-muted)] underline hover:text-[var(--ink-strong)]"
                >
                  回到静态定义视图
                </button>
              )}
            </div>

            {runs.length === 0 ? (
              <div className="rounded-[9px] border border-dashed border-[var(--border-dash)] px-3.5 py-3 text-[11.5px] text-[var(--ink-subtle)]">
                尚无执行记录。点击右上角「运行 Workflow」或触发绑定事件后，此处会实时记录每次本地执行的 DAG 状态。
              </div>
            ) : (
              <div className="flex max-h-[210px] flex-col gap-1.5 overflow-y-auto pr-0.5">
                {runs.map((run) => {
                  const stMeta =
                    WORKFLOW_STATUS_META[run.status] ??
                    WORKFLOW_STATUS_META.pending;
                  const isSelected = selectedRunId === run.runId;
                  return (
                    <button
                      key={run.runId}
                      type="button"
                      onClick={() => void handleSelectRun(run.runId)}
                      className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[9px] border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "border-[var(--ink-primary)] bg-[var(--bg-subtle)]"
                          : "border-[var(--border-light)] bg-[var(--bg-surface)] hover:bg-[var(--bg-card-hover)]"
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[1px] text-[10.5px] font-medium ${stMeta.pillClass}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${stMeta.dotClass}`}
                          />
                          {stMeta.label}
                        </span>
                        <span className="truncate font-mono text-[11px] font-semibold text-[var(--ink-strong)]">
                          {run.triggerEvent}
                        </span>
                        <span className="shrink-0 rounded bg-[var(--bg-muted)] px-1.5 py-[1px] text-[10px] text-[var(--ink-muted)]">
                          {run.triggerSource}
                        </span>
                        {run.errorMessage && (
                          <span className="truncate text-[11px] text-[var(--danger)]">
                            {run.errorMessage}
                          </span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-3 font-mono text-[10.5px] text-[var(--ink-muted)]">
                        <span>{formatWorkflowDuration(run.durationMs)}</span>
                        <span>{formatWorkflowTime(run.createdAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
