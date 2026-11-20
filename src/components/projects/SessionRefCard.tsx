import React from "react";
import { useValet } from "../../store/ValetContext";
import type { ChatThread } from "../../types/valet";
import { extractThreadSummary } from "../../utils/notebook";
import { BowtieSvg, CloseIcon } from "../ui/Icons";

type SessionStatusKind = "running" | "pending" | "completed" | "idle";

function useSessionLiveStatus(thread: ChatThread | undefined) {
  const { state, chatStreams, runningChatIds } = useValet();

  if (!thread) {
    return {
      kind: "idle" as SessionStatusKind,
      label: "已归档或不存在",
      liveDetail: "",
      pendingCount: 0,
    };
  }

  const stream = chatStreams[thread.id];
  const isRunning =
    (runningChatIds[thread.id] ?? 0) > 0 ||
    Boolean(stream && stream.phase !== "done" && stream.phase !== "error");

  const pendingInbox = state.inboxItems.filter(
    (it) =>
      it.status === "pending" &&
      (it.sourceChatId === thread.id ||
        (it.linkedTimelineEventId &&
          thread.linkedEventIds.includes(it.linkedTimelineEventId)))
  );

  if (isRunning) {
    const activeStep =
      stream?.steps?.find((s) => s.status === "running" || s.status === "pending") ??
      stream?.steps?.[stream.steps.length - 1];
    return {
      kind: "running" as SessionStatusKind,
      label: activeStep?.label ? `进行中 · ${activeStep.label}` : "进行中",
      liveDetail:
        activeStep?.detail ||
        stream?.thinkingText ||
        (stream?.partialText ? extractThreadSummary({ ...thread, messages: [{ id: "tmp", role: "assistant", content: stream.partialText, createdAt: "" }] }) : "") ||
        "正在分析上下文并调度工具…",
      pendingCount: pendingInbox.length,
    };
  }

  if (pendingInbox.length > 0) {
    return {
      kind: "pending" as SessionStatusKind,
      label: `待你确认 · ${pendingInbox.length} 项待批`,
      liveDetail: "",
      pendingCount: pendingInbox.length,
    };
  }

  const hasAssistantReply = thread.messages.some((m) => m.role === "assistant");
  return {
    kind: (hasAssistantReply ? "completed" : "idle") as SessionStatusKind,
    label: hasAssistantReply ? "已完成" : "待发起",
    liveDetail: "",
    pendingCount: 0,
  };
}

export const InlineSessionChip: React.FC<{
  sessionId: string;
  onRemove?: () => void;
}> = ({ sessionId, onRemove }) => {
  const { state, openProjectSession, pushToast } = useValet();
  const thread = state.chatThreads.find((t) => t.id === sessionId);
  const status = useSessionLiveStatus(thread);

  const shortStatus =
    status.kind === "running"
      ? "进行中"
      : status.kind === "pending"
        ? "待确认"
        : status.kind === "completed"
          ? "已完成"
          : "未找到";

  return (
    <span
      data-inline-interactive="true"
      className={`mx-1 inline-flex items-center overflow-hidden rounded-[6px] border align-baseline text-[12px] leading-[16px] transition-colors ${
        status.kind === "pending"
          ? "border-[var(--amber-border)] bg-[var(--amber-bg)] text-[var(--ink-strong)] hover:border-[var(--amber-pill)]"
          : "border-[var(--border-control)] bg-[var(--bg-subtle)] text-[var(--ink-strong)] hover:border-[var(--border-strong)]"
      }`}
    >
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!thread) {
            pushToast("未找到关联会话，可能已被移除", "warning");
            return;
          }
          openProjectSession(thread.id);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Backspace" || e.key === "Delete") && onRemove) {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }
        }}
        title={thread ? `点击跳转到会话：${thread.title}` : "会话不存在"}
        className="inline-flex cursor-pointer items-center gap-1.5 px-2 py-[1.5px] transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:bg-[var(--bg-hover)]"
      >
        <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[4px] bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)]">
          <BowtieSvg size={10} />
        </span>
        <span className="max-w-[200px] truncate font-medium">
          {thread?.title ?? "已移除会话"}
        </span>
        <span
          className={`shrink-0 font-mono text-[10px] ${
            status.kind === "pending"
              ? "text-[var(--amber-text)]"
              : status.kind === "running"
                ? "text-[var(--ink-primary)]"
                : "text-[var(--ink-muted)]"
          }`}
        >
          {shortStatus}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--ink-subtle)]">↗</span>
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label="移除引用"
          title="移除引用"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="inline-flex cursor-pointer items-center self-stretch border-l border-[var(--border-light)] px-1 text-[var(--ink-subtle)]/75 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
        >
          <CloseIcon size={10} />
        </button>
      )}
    </span>
  );
};

export const SessionRefBlockCard: React.FC<{
  sessionId: string;
  fallbackTitle?: string;
  fallbackSummary?: string;
  onRemove?: () => void;
}> = ({ sessionId, fallbackTitle, fallbackSummary, onRemove }) => {
  const { state, openProjectSession, pushToast } = useValet();
  const thread = state.chatThreads.find((t) => t.id === sessionId);
  const status = useSessionLiveStatus(thread);

  const title = thread?.title || fallbackTitle || "关联会话";
  const summaryText =
    status.liveDetail ||
    fallbackSummary ||
    (thread ? extractThreadSummary(thread) : "") ||
    (thread?.messages[0]?.content ?? "点击进入查看完整对话与执行详情。");

  const accentBorder =
    status.kind === "pending"
      ? "border-l-[3px] border-l-[var(--amber-icon)]"
      : "border-l-[3px] border-l-[var(--ink-primary)]";

  return (
    <div
      onClick={() => {
        if (!thread) {
          pushToast("未找到关联会话，可能已被移除", "warning");
          return;
        }
        openProjectSession(thread.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === "Backspace" || e.key === "Delete") && onRemove) {
          e.preventDefault();
          onRemove();
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (thread) openProjectSession(thread.id);
        }
      }}
      className={`group relative flex cursor-pointer flex-col gap-2 rounded-[10px] border border-[var(--border-card)] bg-[var(--bg-subtle)]/65 px-4 py-3.5 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)] ${accentBorder}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border border-[var(--brand-icon-border)] bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)]">
          <BowtieSvg size={12} />
        </span>

        <span className="min-w-0 truncate text-[13px] font-semibold leading-[18px] text-[var(--ink-strong)]">
          {title}
        </span>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-[14px] ${
            status.kind === "pending"
              ? "border-[var(--amber-pill)] bg-[var(--amber-bg)] text-[var(--amber-text)]"
              : status.kind === "running"
                ? "border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-strong)]"
                : "border-[var(--border-light)] bg-[var(--bg-surface)] text-[var(--ink-muted)]"
          }`}
        >
          {status.kind === "running" && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              className="animate-valet-spin shrink-0 text-[var(--ink-primary)]"
              aria-hidden="true"
            >
              <path
                d="M12 3a9 9 0 109 9"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          )}
          <span>{status.label}</span>
        </span>

        <div className="flex-1" />

        {onRemove && (
          <button
            type="button"
            title="移除引用卡片（保留会话）"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="hidden h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--ink-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)] group-hover:flex"
          >
            <CloseIcon size={12} />
          </button>
        )}

        <span className="shrink-0 rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 py-1 text-[12px] font-medium leading-[16px] text-[var(--ink-strong)] transition-colors group-hover:border-[var(--border-strong)]">
          {status.kind === "running" ? "查看实时进展 →" : "进入对话 →"}
        </span>
      </div>

      {summaryText && (
        <div
          className={`line-clamp-2 text-[12.5px] leading-[19px] ${
            status.kind === "running"
              ? "font-mono text-[11.5px] text-[var(--ink-muted)]"
              : "text-[var(--ink-secondary)]"
          }`}
        >
          {status.kind === "running" ? `▸ ${summaryText}` : summaryText}
        </div>
      )}

      <div className="flex items-center gap-2 font-mono text-[10px] leading-[14px] text-[var(--ink-subtle)]">
        <span>@valet 发起</span>
        <span>·</span>
        <span>{thread ? `${thread.messages.length} 条消息` : "已归档"}</span>
        {thread?.updatedAt && (
          <>
            <span>·</span>
            <span>{thread.updatedAt}</span>
          </>
        )}
        <span>·</span>
        <span>点击卡片跳转完整会话</span>
      </div>
    </div>
  );
};
