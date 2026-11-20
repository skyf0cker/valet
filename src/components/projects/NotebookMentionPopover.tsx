import React, { useEffect, useMemo, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type { ChatThread, NotebookBlockType } from "../../types/valet";
import {
  BowtieSvg,
  CheckSquareIcon,
  ClockIcon,
  CodeBlockIcon,
  DividerIcon,
  HashIcon,
  InboxIcon,
  ListBulletIcon,
  ListOrderedIcon,
  QuoteBlockIcon,
} from "../ui/Icons";

export type MentionAction =
  | { kind: "new_valet_session" }
  | { kind: "link_session"; thread: ChatThread }
  | { kind: "link_inbox"; itemId: string; title: string }
  | { kind: "link_timeline"; eventId: string; title: string };

export const NotebookMentionPopover: React.FC<{
  projectId: string;
  query: string;
  onSelect: (action: MentionAction) => void;
  onClose: () => void;
}> = ({ projectId, query, onSelect, onClose }) => {
  const { state, chatStreams, runningChatIds } = useValet();
  const [activeIdx, setActiveIdx] = useState(0);

  const normalizedQuery = query.trim().toLowerCase();

  const items = useMemo(() => {
    const out: Array<{
      id: string;
      section: "create" | "session" | "context";
      action: MentionAction;
      searchText: string;
    }> = [];

    if (
      !normalizedQuery ||
      "valet".includes(normalizedQuery) ||
      "新建对话".includes(normalizedQuery) ||
      "session".includes(normalizedQuery)
    ) {
      out.push({
        id: "create-valet",
        section: "create",
        action: { kind: "new_valet_session" },
        searchText: "valet 新建会话 对话",
      });
    }

    const projectSessions = state.chatThreads
      .filter((t) => !t.archived && (t.projectId || "proj-default") === projectId)
      .filter(
        (t) =>
          !normalizedQuery || t.title.toLowerCase().includes(normalizedQuery)
      )
      .slice(0, 5);

    for (const thread of projectSessions) {
      out.push({
        id: `sess-${thread.id}`,
        section: "session",
        action: { kind: "link_session", thread },
        searchText: thread.title.toLowerCase(),
      });
    }

    const pendingInbox = state.inboxItems
      .filter((it) => it.status === "pending")
      .filter(
        (it) =>
          !normalizedQuery ||
          it.title.toLowerCase().includes(normalizedQuery) ||
          "收件箱".includes(normalizedQuery)
      )
      .slice(0, 2);

    for (const it of pendingInbox) {
      out.push({
        id: `inb-${it.id}`,
        section: "context",
        action: { kind: "link_inbox", itemId: it.id, title: it.title },
        searchText: it.title.toLowerCase(),
      });
    }

    const recentEvents = state.timelineEvents
      .filter(
        (ev) =>
          !normalizedQuery ||
          ev.title.toLowerCase().includes(normalizedQuery) ||
          "时间线".includes(normalizedQuery)
      )
      .slice(0, 2);

    for (const ev of recentEvents) {
      out.push({
        id: `evt-${ev.id}`,
        section: "context",
        action: { kind: "link_timeline", eventId: ev.id, title: ev.title },
        searchText: ev.title.toLowerCase(),
      });
    }

    return out;
  }, [normalizedQuery, projectId, state.chatThreads, state.inboxItems, state.timelineEvents]);

  useEffect(() => {
    setActiveIdx(0);
  }, [normalizedQuery]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const chosen = items[activeIdx];
        if (chosen) onSelect(chosen.action);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeIdx, items, onClose, onSelect]);

  const createItems = items.filter((i) => i.section === "create");
  const sessionItems = items.filter((i) => i.section === "session");
  const contextItems = items.filter((i) => i.section === "context");

  const getSessionStatus = (thread: ChatThread) => {
    const stream = chatStreams[thread.id];
    const running =
      (runningChatIds[thread.id] ?? 0) > 0 ||
      Boolean(stream && stream.phase !== "done" && stream.phase !== "error");
    if (running) return { kind: "running" as const, label: "进行中" };
    const pending = state.inboxItems.some(
      (it) =>
        it.status === "pending" &&
        (it.sourceChatId === thread.id ||
          (it.linkedTimelineEventId &&
            thread.linkedEventIds.includes(it.linkedTimelineEventId)))
    );
    if (pending) return { kind: "pending" as const, label: "待确认" };
    return { kind: "done" as const, label: "已完成" };
  };

  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="animate-valet-modal-in z-40 mt-1.5 flex w-[396px] max-w-full flex-col overflow-hidden rounded-[12px] border border-[var(--border-control)] bg-[var(--bg-elevated)] shadow-[var(--shadow-popover)]"
    >
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-[var(--ink-muted)]">
          没有匹配「@{query}」的选项
        </div>
      ) : (
        <div className="max-h-[340px] overflow-y-auto">
          {createItems.length > 0 && (
            <div className="p-1.5">
              <div className="px-2.5 pt-1 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                新建对话 · CREATE SESSION
              </div>
              {createItems.map((entry) => {
                const idx = items.indexOf(entry);
                const selected = idx === activeIdx;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => onSelect(entry.action)}
                    className={`flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors ${
                      selected ? "bg-[var(--bg-subtle)]" : "hover:bg-[var(--bg-subtle)]/70"
                    }`}
                  >
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)]">
                      <BowtieSvg size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[13px] font-semibold text-[var(--ink-strong)]">
                          @valet
                        </span>
                        <span className="rounded-[4px] bg-[var(--ink-primary)] px-1.5 py-[1px] text-[10px] font-medium text-[var(--ink-on-primary)]">
                          新建会话
                        </span>
                      </div>
                      <div className="truncate text-[12px] text-[var(--ink-muted)]">
                        在当前位置发起新对话并自动插入引用卡片
                      </div>
                    </div>
                    <kbd className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border border-[var(--border-control)] bg-[var(--bg-canvas)] font-mono text-[11px] text-[var(--ink-secondary)]">
                      ⏎
                    </kbd>
                  </button>
                );
              })}
            </div>
          )}

          {sessionItems.length > 0 && (
            <div className="border-t border-[var(--border-light)] p-1.5">
              <div className="px-2.5 pt-1 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                引用本项目已有会话 · LINK SESSION
              </div>
              {sessionItems.map((entry) => {
                if (entry.action.kind !== "link_session") return null;
                const { thread } = entry.action;
                const idx = items.indexOf(entry);
                const selected = idx === activeIdx;
                const st = getSessionStatus(thread);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => onSelect(entry.action)}
                    className={`flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 text-left transition-colors ${
                      selected ? "bg-[var(--bg-subtle)]" : "hover:bg-[var(--bg-subtle)]/70"
                    }`}
                  >
                    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                      {st.kind === "running" ? (
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          className="animate-valet-spin text-[var(--ink-primary)]"
                          aria-hidden="true"
                        >
                          <path
                            d="M12 3a9 9 0 109 9"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                      ) : (
                        <span
                          className={`h-[7px] w-[7px] rounded-full ${
                            st.kind === "pending"
                              ? "bg-[var(--amber-icon)]"
                              : "bg-[var(--ink-primary)]"
                          }`}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink-strong)]">
                      {thread.title}
                    </span>
                    <span
                      className={`shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] ${
                        st.kind === "pending"
                          ? "border border-[var(--amber-border)] bg-[var(--amber-bg)] text-[var(--amber-text)]"
                          : "bg-[var(--bg-muted)] text-[var(--ink-muted)]"
                      }`}
                    >
                      {st.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {contextItems.length > 0 && (
            <div className="border-t border-[var(--border-light)] p-1.5">
              <div className="px-2.5 pt-1 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                引用工作区上下文 · CONTEXT
              </div>
              {contextItems.map((entry) => {
                const idx = items.indexOf(entry);
                const selected = idx === activeIdx;
                const isInbox = entry.action.kind === "link_inbox";
                const title =
                  entry.action.kind === "link_inbox" || entry.action.kind === "link_timeline"
                    ? entry.action.title
                    : "";
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => onSelect(entry.action)}
                    className={`flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 text-left transition-colors ${
                      selected ? "bg-[var(--bg-subtle)]" : "hover:bg-[var(--bg-subtle)]/70"
                    }`}
                  >
                    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[var(--ink-muted)]">
                      {isInbox ? <InboxIcon size={14} /> : <ClockIcon size={14} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink-strong)]">
                      {title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--ink-subtle)]">
                      {isInbox ? "#收件箱" : "#时间线"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-[var(--border-light)] bg-[var(--bg-subtle)]/70 px-3.5 py-2 font-mono text-[10px] text-[var(--ink-subtle)]">
        ↑↓ 选择 · ⏎ 确认 · / 切换 Markdown 块菜单
      </div>
    </div>
  );
};

export type SlashBlockChoice =
  | { kind: "valet_session" }
  | { kind: "block_type"; blockType: NotebookBlockType; label: string };

const SLASH_OPTIONS: Array<{
  id: string;
  label: string;
  desc: string;
  hint: string;
  choice: SlashBlockChoice;
  icon: React.ReactNode;
}> = [
  {
    id: "valet",
    label: "@valet 新建会话",
    desc: "在当前位置发起新对话并嵌入引用卡片",
    hint: "@valet",
    choice: { kind: "valet_session" },
    icon: <BowtieSvg size={12} />,
  },
  {
    id: "h1",
    label: "一级标题",
    desc: "大号文档章节标题",
    hint: "# ",
    choice: { kind: "block_type", blockType: "h1", label: "一级标题" },
    icon: <HashIcon size={13} />,
  },
  {
    id: "h2",
    label: "二级标题",
    desc: "中等分组小标题",
    hint: "## ",
    choice: { kind: "block_type", blockType: "h2", label: "二级标题" },
    icon: <HashIcon size={13} />,
  },
  {
    id: "h3",
    label: "三级标题",
    desc: "子段落小节标题",
    hint: "### ",
    choice: { kind: "block_type", blockType: "h3", label: "三级标题" },
    icon: <HashIcon size={13} />,
  },
  {
    id: "todo",
    label: "待办清单",
    desc: "可勾选的任务列表项",
    hint: "[ ] ",
    choice: { kind: "block_type", blockType: "todo", label: "待办清单" },
    icon: <CheckSquareIcon size={13} />,
  },
  {
    id: "bullet",
    label: "无序列表",
    desc: "项目符号条目",
    hint: "- ",
    choice: { kind: "block_type", blockType: "bullet", label: "无序列表" },
    icon: <ListBulletIcon size={13} />,
  },
  {
    id: "numbered",
    label: "有序列表",
    desc: "自动递增编号列表",
    hint: "1. ",
    choice: { kind: "block_type", blockType: "numbered", label: "有序列表" },
    icon: <ListOrderedIcon size={13} />,
  },
  {
    id: "callout",
    label: "提示框 Callout",
    desc: "突出展示背景、约束或结论",
    hint: "callout",
    choice: { kind: "block_type", blockType: "callout", label: "提示框" },
    icon: <QuoteBlockIcon size={13} />,
  },
  {
    id: "quote",
    label: "引用块",
    desc: "缩进引文或摘录",
    hint: "> ",
    choice: { kind: "block_type", blockType: "quote", label: "引用块" },
    icon: <QuoteBlockIcon size={13} />,
  },
  {
    id: "code",
    label: "代码块",
    desc: "支持 bash / json / ts 等等宽代码",
    hint: "```",
    choice: { kind: "block_type", blockType: "code", label: "代码块" },
    icon: <CodeBlockIcon size={13} />,
  },
  {
    id: "divider",
    label: "分割线",
    desc: "极细横线分隔内容区块",
    hint: "---",
    choice: { kind: "block_type", blockType: "divider", label: "分割线" },
    icon: <DividerIcon size={13} />,
  },
];

export const NotebookSlashPopover: React.FC<{
  query: string;
  onSelect: (choice: SlashBlockChoice) => void;
  onClose: () => void;
}> = ({ query, onSelect, onClose }) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return SLASH_OPTIONS;
    return SLASH_OPTIONS.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.desc.toLowerCase().includes(q) ||
        opt.hint.toLowerCase().includes(q) ||
        opt.id.includes(q)
    );
  }, [q]);

  useEffect(() => {
    setActiveIdx(0);
  }, [q]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const chosen = filtered[activeIdx];
        if (chosen) onSelect(chosen.choice);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeIdx, filtered, onClose, onSelect]);

  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="animate-valet-modal-in z-40 mt-1.5 flex w-[340px] max-w-full flex-col overflow-hidden rounded-[12px] border border-[var(--border-control)] bg-[var(--bg-elevated)] shadow-[var(--shadow-popover)]"
    >
      <div className="px-3.5 pt-2.5 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
        插入块 · BLOCKS
      </div>
      <div className="max-h-[290px] overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <div className="py-5 text-center text-[12px] text-[var(--ink-muted)]">
            没有匹配的块类型
          </div>
        ) : (
          filtered.map((opt, idx) => {
            const selected = idx === activeIdx;
            const isValet = opt.id === "valet";
            return (
              <button
                key={opt.id}
                type="button"
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => onSelect(opt.choice)}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left transition-colors ${
                  selected ? "bg-[var(--bg-subtle)]" : "hover:bg-[var(--bg-subtle)]/70"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] ${
                    isValet
                      ? "bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)]"
                      : "border border-[var(--border-control)] bg-[var(--bg-canvas)] text-[var(--ink-secondary)]"
                  }`}
                >
                  {opt.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-[var(--ink-strong)]">
                    {opt.label}
                  </div>
                  <div className="truncate text-[11px] text-[var(--ink-muted)]">{opt.desc}</div>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-[var(--ink-subtle)]">
                  {opt.hint}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
