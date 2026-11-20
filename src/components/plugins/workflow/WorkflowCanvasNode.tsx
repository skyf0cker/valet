import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { WorkflowNodeRunState, WorkflowNodeType } from "../../../types/valet";
import {
  WORKFLOW_NODE_TYPE_META,
  WORKFLOW_STATUS_META,
  formatWorkflowDuration,
} from "../../../utils/workflowYaml";

export interface ValetCanvasNodeData extends Record<string, unknown> {
  nodeId: string;
  nodeType: WorkflowNodeType;
  label: string;
  description?: string;
  runState?: WorkflowNodeRunState;
  hasActiveRun: boolean;
}

export const WorkflowCanvasNode: React.FC<NodeProps> = memo(({ data, selected }) => {
  const nodeData = data as ValetCanvasNodeData;
  const typeMeta =
    WORKFLOW_NODE_TYPE_META[nodeData.nodeType] ?? WORKFLOW_NODE_TYPE_META.transform;
  const runState = nodeData.runState;
  const statusMeta = runState
    ? WORKFLOW_STATUS_META[runState.status] ?? WORKFLOW_STATUS_META.pending
    : WORKFLOW_STATUS_META.pending;

  return (
    <div
      className={`w-[216px] rounded-[10px] border bg-[var(--bg-surface)] px-3 py-2.5 transition-all ${
        selected
          ? "border-[var(--ink-primary)] ring-2 ring-[var(--ink-primary)]/20 shadow-sm"
          : nodeData.hasActiveRun
            ? statusMeta.cardBorderClass
            : "border-[var(--border-light)] hover:border-[var(--border-control)]"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-2 !w-2 !border-[var(--bg-surface)] !bg-[var(--border-strong)]"
      />

      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex h-[18px] items-center rounded-[5px] px-1.5 font-mono text-[9.5px] font-semibold tracking-tight ${typeMeta.toneClass}`}
        >
          {typeMeta.short} · {typeMeta.label}
        </span>

        {nodeData.hasActiveRun && runState && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10px] font-medium ${statusMeta.pillClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
            {statusMeta.label}
          </span>
        )}
      </div>

      <div className="mt-2 truncate text-[12.5px] font-semibold leading-[17px] text-[var(--ink-strong)]">
        {nodeData.label}
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-[10.5px] text-[var(--ink-muted)]">
        <span className="truncate font-mono">{nodeData.nodeId}</span>
        {nodeData.hasActiveRun && runState?.durationMs !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--ink-subtle)]">
            {formatWorkflowDuration(runState.durationMs)}
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-2 !w-2 !border-[var(--bg-surface)] !bg-[var(--border-strong)]"
      />
    </div>
  );
});

WorkflowCanvasNode.displayName = "WorkflowCanvasNode";
