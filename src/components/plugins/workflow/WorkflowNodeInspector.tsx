import React from "react";
import type { WorkflowGraphNode, WorkflowNodeRunState } from "../../../types/valet";
import {
  WORKFLOW_NODE_TYPE_META,
  WORKFLOW_STATUS_META,
  formatWorkflowDuration,
  formatWorkflowJson,
  formatWorkflowTime,
} from "../../../utils/workflowYaml";

interface WorkflowNodeInspectorProps {
  node: WorkflowGraphNode | null;
  nodeRun?: WorkflowNodeRunState;
  hasActiveRun: boolean;
  resuming?: boolean;
  onResumeApproval?: (hookToken: string, approved: boolean) => Promise<void>;
}

export const WorkflowNodeInspector: React.FC<WorkflowNodeInspectorProps> = ({
  node,
  nodeRun,
  hasActiveRun,
  resuming,
  onResumeApproval,
}) => {
  if (!node) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-subtle)] px-5 text-center text-[12px] text-[var(--ink-muted)]">
        点击画布中的任意节点，在此查看该节点的运行状态、输入参数、输出结果与配置定义。
      </div>
    );
  }

  const typeMeta =
    WORKFLOW_NODE_TYPE_META[node.type] ?? WORKFLOW_NODE_TYPE_META.transform;
  const statusMeta = nodeRun
    ? WORKFLOW_STATUS_META[nodeRun.status] ?? WORKFLOW_STATUS_META.pending
    : WORKFLOW_STATUS_META.pending;

  return (
    <div className="flex h-[420px] flex-col overflow-hidden rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-surface)]">
      {/* Header */}
      <div className="flex flex-col gap-1.5 border-b border-[var(--border-light)] px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex h-[19px] items-center rounded-[5px] px-1.5 font-mono text-[10px] font-semibold ${typeMeta.toneClass}`}
          >
            {typeMeta.short} · {typeMeta.label}
          </span>
          {hasActiveRun && nodeRun ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10.5px] font-medium ${statusMeta.pillClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
              {statusMeta.label}
            </span>
          ) : (
            <span className="text-[10.5px] text-[var(--ink-subtle)]">定义视图</span>
          )}
        </div>

        <div className="truncate text-[13.5px] font-semibold text-[var(--ink-strong)]">
          {node.name?.trim() || node.id}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-[var(--ink-muted)]">
          <span>ID: {node.id}</span>
          {hasActiveRun && nodeRun && (
            <>
              <span>开始: {formatWorkflowTime(nodeRun.startedAt)}</span>
              <span>耗时: {formatWorkflowDuration(nodeRun.durationMs)}</span>
            </>
          )}
        </div>
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {node.description && (
          <div className="text-[11.5px] leading-[17px] text-[var(--ink-muted)]">
            {node.description}
          </div>
        )}

        {hasActiveRun &&
          nodeRun?.status === "waiting_approval" &&
          nodeRun.hookToken &&
          onResumeApproval && (
            <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--amber-border)] bg-[var(--amber-bg)] p-2.5">
              <div className="text-[11.5px] font-medium text-[var(--amber-text)]">
                该节点正在通过 createHook() 挂起等待人工审批
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={resuming}
                  onClick={() => void onResumeApproval(nodeRun.hookToken!, true)}
                  className="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-[6px] bg-[var(--ink-primary)] px-2.5 text-[11px] font-semibold text-[var(--ink-on-primary)] disabled:opacity-50"
                >
                  {resuming ? "提交中…" : "批准继续"}
                </button>
                <button
                  type="button"
                  disabled={resuming}
                  onClick={() => void onResumeApproval(nodeRun.hookToken!, false)}
                  className="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 text-[11px] font-medium text-[var(--ink-strong)] disabled:opacity-50"
                >
                  拒绝
                </button>
              </div>
            </div>
          )}

        {hasActiveRun && nodeRun?.error && (
          <div className="rounded-[8px] border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-2.5">
            <div className="mb-1 text-[10.5px] font-semibold text-[var(--danger)]">
              执行错误
            </div>
            <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[15px] text-[var(--danger)]">
              {nodeRun.error}
            </pre>
          </div>
        )}

        <div>
          <div className="mb-1 text-[11px] font-semibold text-[var(--ink-strong)]">
            输入 (Input)
          </div>
          {hasActiveRun && nodeRun ? (
            <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-code)] p-2.5 font-mono text-[10.5px] leading-[16px] text-[var(--ink-secondary)]">
              {nodeRun.input !== undefined
                ? formatWorkflowJson(nodeRun.input)
                : "（无输入记录）"}
            </pre>
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--border-dash)] px-2.5 py-2 text-[11px] text-[var(--ink-subtle)]">
              选择一次运行记录或点击「运行测试」后查看真实输入。
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold text-[var(--ink-strong)]">
            输出 (Output)
          </div>
          {hasActiveRun && nodeRun ? (
            <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-code)] p-2.5 font-mono text-[10.5px] leading-[16px] text-[var(--ink-secondary)]">
              {nodeRun.output !== undefined
                ? formatWorkflowJson(nodeRun.output)
                : nodeRun.status === "skipped"
                  ? "（分支未命中，节点已跳过）"
                  : nodeRun.status === "pending"
                    ? "（尚未执行）"
                    : "（无输出返回值）"}
            </pre>
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--border-dash)] px-2.5 py-2 text-[11px] text-[var(--ink-subtle)]">
              选择一次运行记录后查看节点输出结果。
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold text-[var(--ink-muted)]">
            节点配置 (workflow.yaml)
          </div>
          <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-subtle)] p-2.5 font-mono text-[10.5px] leading-[16px] text-[var(--ink-muted)]">
            {formatWorkflowJson(node.config ?? {})}
          </pre>
        </div>
      </div>
    </div>
  );
};
