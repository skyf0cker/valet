import type { WorkflowNodeStatus, WorkflowNodeType, WorkflowRunStatus } from "../types/valet";

export const WORKFLOW_NODE_TYPE_META: Record<
  WorkflowNodeType,
  { label: string; short: string; toneClass: string }
> = {
  trigger: {
    label: "触发入口",
    short: "TRIG",
    toneClass: "bg-[var(--ink-primary)] text-[var(--ink-on-primary)]",
  },
  script: {
    label: "脚本",
    short: "SH",
    toneClass: "bg-[var(--bg-muted)] text-[var(--ink-strong)] border border-[var(--border-control)]",
  },
  http: {
    label: "HTTP",
    short: "HTTP",
    toneClass: "bg-[var(--bg-muted)] text-[var(--ink-strong)] border border-[var(--border-control)]",
  },
  tool: {
    label: "内置工具",
    short: "TOOL",
    toneClass: "bg-[var(--bg-muted)] text-[var(--ink-strong)] border border-[var(--border-control)]",
  },
  agent: {
    label: "Agent",
    short: "AI",
    toneClass: "bg-[var(--amber-bg)] text-[var(--amber-text)] border border-[var(--amber-border)]",
  },
  condition: {
    label: "条件分支",
    short: "IF",
    toneClass: "bg-[var(--bg-muted)] text-[var(--ink-strong)] border border-[var(--border-control)]",
  },
  transform: {
    label: "数据变换",
    short: "MAP",
    toneClass: "bg-[var(--bg-muted)] text-[var(--ink-strong)] border border-[var(--border-control)]",
  },
  sleep: {
    label: "休眠等待",
    short: "WAIT",
    toneClass: "bg-[var(--bg-muted)] text-[var(--ink-strong)] border border-[var(--border-control)]",
  },
  approval: {
    label: "人工审批",
    short: "GATE",
    toneClass: "bg-[var(--amber-bg)] text-[var(--amber-text)] border border-[var(--amber-border)]",
  },
  notify: {
    label: "结果通知",
    short: "MSG",
    toneClass: "bg-[var(--bg-muted)] text-[var(--ink-strong)] border border-[var(--border-control)]",
  },
};

export const WORKFLOW_STATUS_META: Record<
  WorkflowRunStatus | WorkflowNodeStatus,
  {
    label: string;
    dotClass: string;
    pillClass: string;
    cardBorderClass: string;
  }
> = {
  pending: {
    label: "待执行",
    dotClass: "bg-[var(--ink-faint)]",
    pillClass: "border-[var(--border-control)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]",
    cardBorderClass: "border-[var(--border-light)]",
  },
  running: {
    label: "运行中",
    dotClass: "bg-[var(--ink-primary)] animate-pulse",
    pillClass: "border-[var(--ink-primary)] bg-[var(--bg-subtle)] text-[var(--ink-strong)]",
    cardBorderClass: "border-[var(--ink-primary)] ring-1 ring-[var(--ink-primary)]/15",
  },
  waiting_approval: {
    label: "等待审批",
    dotClass: "bg-[var(--amber-icon)] animate-pulse",
    pillClass: "border-[var(--amber-border)] bg-[var(--amber-bg)] text-[var(--amber-text)]",
    cardBorderClass: "border-[var(--amber-icon)] ring-1 ring-[var(--amber-icon)]/20",
  },
  completed: {
    label: "已完成",
    dotClass: "bg-emerald-600",
    pillClass: "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300",
    cardBorderClass: "border-emerald-500/40",
  },
  failed: {
    label: "失败",
    dotClass: "bg-[var(--danger)]",
    pillClass: "border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]",
    cardBorderClass: "border-[var(--danger)]/60 ring-1 ring-[var(--danger)]/15",
  },
  skipped: {
    label: "已跳过",
    dotClass: "bg-[var(--ink-faint)]",
    pillClass: "border-dashed border-[var(--border-control)] bg-[var(--bg-canvas)] text-[var(--ink-subtle)]",
    cardBorderClass: "border-dashed border-[var(--border-control)] opacity-60",
  },
  cancelled: {
    label: "已取消",
    dotClass: "bg-[var(--ink-muted)]",
    pillClass: "border-[var(--border-control)] bg-[var(--bg-muted)] text-[var(--ink-muted)]",
    cardBorderClass: "border-[var(--border-control)] opacity-75",
  },
};

export function formatWorkflowDuration(ms?: number): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 2 : 1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min}m ${remSec}s`;
}

export function formatWorkflowTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatWorkflowJson(val: unknown): string {
  if (val === undefined) return "—";
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

export function buildDefaultWorkflowYaml(name = "plugin-workflow", eventCode = "manual"): string {
  const cleanName = name.trim() || "plugin-workflow";
  const cleanEvent = eventCode.trim() || "manual";
  return `version: 1
name: ${cleanName}
description: 声明式自动化工作流
nodes:
  - id: trigger
    type: trigger
    name: 事件触发
    config:
      event: ${cleanEvent}
  - id: prepare
    type: transform
    name: 整理上下文
    config:
      output:
        event: "{{trigger.event}}"
        summary: "{{trigger.summary}}"
        payload: "{{trigger.payload}}"
  - id: report
    type: notify
    name: 记录结果
    config:
      title: ${cleanName}
      message: "已处理事件 {{steps.prepare.output.event}}: {{steps.prepare.output.summary}}"
      level: info
      kind: timeline
edges:
  - from: trigger
    to: prepare
  - from: prepare
    to: report
`;
}
