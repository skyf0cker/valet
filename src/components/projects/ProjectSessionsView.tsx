import React, { useMemo, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type { ChatThread, Project } from "../../types/valet";
import { extractThreadSummary } from "../../utils/notebook";
import { ArchiveIcon, BookOpenIcon, PlusIcon, SearchIcon } from "../ui/Icons";
import { SelectMenu } from "../ui/SelectMenu";

type SessionFilter = "all" | "unread" | "running" | "pending" | "archived";

export const ProjectSessionsView: React.FC<{ project: Project }> = ({ project }) => {
  const {
    state,
    chatStreams,
    runningChatIds,
    unreadChatCounts,
    markAllChatsRead,
    openProjectSession,
    createNewChat,
    moveChatThreadToProject,
    archiveChatThread,
    setProjectTab,
  } = useValet();

  const [filter, setFilter] = useState<SessionFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const projectThreads = useMemo(
    () => state.chatThreads.filter((t) => (t.projectId || "proj-default") === project.id),
    [project.id, state.chatThreads]
  );

  const otherProjects = useMemo(
    () => state.projects.filter((p) => !p.archived && p.id !== project.id),
    [project.id, state.projects]
  );

  const isThreadRunning = (t: ChatThread) => {
    const stream = chatStreams[t.id];
    return (
      (runningChatIds[t.id] ?? 0) > 0 ||
      Boolean(stream && stream.phase !== "done" && stream.phase !== "error")
    );
  };

  const getThreadPendingCount = (t: ChatThread) =>
    state.inboxItems.filter(
      (it) =>
        it.status === "pending" &&
        (it.sourceChatId === t.id ||
          (it.linkedTimelineEventId && t.linkedEventIds.includes(it.linkedTimelineEventId)))
    ).length;

  const activeThreads = projectThreads.filter((t) => !t.archived);
  const archivedThreads = projectThreads.filter((t) => Boolean(t.archived));
  const unreadThreadCount = activeThreads.filter(
    (t) => (unreadChatCounts[t.id] ?? 0) > 0
  ).length;
  const runningCount = activeThreads.filter(isThreadRunning).length;
  const pendingThreadCount = activeThreads.filter((t) => getThreadPendingCount(t) > 0).length;

  const filteredThreads = useMemo(() => {
    const base =
      filter === "archived"
        ? archivedThreads
        : activeThreads.filter((t) => {
            if (filter === "unread") return (unreadChatCounts[t.id] ?? 0) > 0;
            if (filter === "running") return isThreadRunning(t);
            if (filter === "pending") return getThreadPendingCount(t) > 0;
            return true;
          });

    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((t) => {
      if (t.title.toLowerCase().includes(q)) return true;
      const summary = extractThreadSummary(t).toLowerCase();
      if (summary.includes(q)) return true;
      return t.messages.some((m) => m.content.toLowerCase().includes(q));
    });
  }, [
    activeThreads,
    archivedThreads,
    filter,
    searchQuery,
    chatStreams,
    runningChatIds,
    unreadChatCounts,
    state.inboxItems,
  ]);

  const filterPills: Array<{
    id: SessionFilter;
    label: string;
    count: number;
    dotAmber?: boolean;
    dotAccent?: boolean;
  }> = [
    { id: "all", label: "全部", count: activeThreads.length },
    {
      id: "unread",
      label: "未读",
      count: unreadThreadCount,
      dotAccent: unreadThreadCount > 0,
    },
    { id: "running", label: "进行中", count: runningCount },
    { id: "pending", label: "待批事项", count: pendingThreadCount, dotAmber: pendingThreadCount > 0 },
    { id: "archived", label: "已归档", count: archivedThreads.length },
  ];

  return (
    <div className="mx-auto w-full max-w-[820px] px-8 pt-8 pb-20 lg:px-12">
      {/* Editorial Container Header */}
      <div className="flex flex-col gap-2 pb-5">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
          {project.isDefault
            ? "DEFAULT PROJECT · SESSION CONTAINER"
            : "PROJECT · SESSION CONTAINER"}
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="font-[family-name:var(--font-serif-zh)] text-[28px] font-semibold leading-[36px] tracking-[-0.02em] text-[var(--ink-strong)]">
            {project.title}
          </h1>
          <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--ink-muted)]">
            {unreadThreadCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => markAllChatsRead(project.id)}
                  className="cursor-pointer font-sans text-[11.5px] font-medium text-[var(--ink-secondary)] underline-offset-2 hover:text-[var(--ink-strong)] hover:underline"
                >
                  全部标为已读
                </button>
                <span className="text-[var(--ink-subtle)]">/</span>
              </>
            )}
            <span>{activeThreads.length} 活跃会话</span>
            <span className="text-[var(--ink-subtle)]">/</span>
            <span>{archivedThreads.length} 已归档</span>
          </div>
        </div>

        <p className="text-[13px] leading-[20px] text-[var(--ink-muted)]">
          {project.description ||
            "管理本项目下的全部 Agent 对话，支持筛选状态、归档与跨项目归类。"}
        </p>
      </div>

      {/* Filter Pills + Search */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterPills.map((pill) => {
            const active = filter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setFilter(pill.id)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors ${
                  active
                    ? "border-[var(--ink-primary)] bg-[var(--ink-primary)] font-medium text-[var(--ink-on-primary)]"
                    : "border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)]"
                }`}
              >
                {pill.dotAmber && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      active ? "bg-[var(--ink-on-primary)]" : "bg-[var(--amber-icon)]"
                    }`}
                  />
                )}
                {pill.dotAccent && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      active ? "bg-[var(--ink-on-primary)]" : "bg-[var(--duty-dot)]"
                    }`}
                  />
                )}
                <span>{pill.label}</span>
                <span
                  className={`font-mono text-[10.5px] ${
                    active ? "opacity-80" : "text-[var(--ink-subtle)]"
                  }`}
                >
                  {pill.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex h-[32px] w-full max-w-[240px] items-center gap-2 rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5">
          <SearchIcon size={12.5} className="shrink-0 text-[var(--ink-subtle)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="cursor-pointer text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              aria-label="清空搜索"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Hairline-divided Session List */}
      <div className="border-t border-[var(--border-light)]">
        {filteredThreads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 border-b border-[var(--border-light)] py-14 text-center">
            <p className="text-[13px] text-[var(--ink-muted)]">
              {searchQuery
                ? `没有匹配「${searchQuery}」的会话`
                : filter === "archived"
                  ? "暂无已归档会话"
                  : filter === "unread"
                    ? "当前没有未读回复的会话"
                    : filter === "running"
                      ? "当前没有正在运行中的会话"
                      : filter === "pending"
                        ? "暂无待你确认的会话事项"
                        : "当前项目下还没有会话"}
            </p>
            {filter === "all" && !searchQuery && (
              <button
                type="button"
                onClick={() => createNewChat(project.id)}
                className="inline-flex h-[32px] cursor-pointer items-center gap-1.5 rounded-[8px] bg-[var(--ink-primary)] px-3.5 text-[12px] font-medium text-[var(--ink-on-primary)] hover:opacity-90"
              >
                <PlusIcon size={12} />
                <span>新建对话</span>
              </button>
            )}
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const running = isThreadRunning(thread);
            const pendingCount = getThreadPendingCount(thread);
            const unreadCount = thread.archived
              ? 0
              : (unreadChatCounts[thread.id] ?? 0);
            const summary =
              extractThreadSummary(thread) ||
              thread.messages[0]?.content ||
              "空会话，点击继续对话…";

            return (
              <div
                key={thread.id}
                className="-mx-2 flex items-start gap-3 rounded-[8px] border-b border-[var(--border-light)] px-2 py-3.5 transition-colors hover:bg-[var(--bg-subtle)]/55"
              >
                {/* Status Indicator Slot */}
                <div className="flex w-5 shrink-0 justify-center pt-[5px]">
                  {running ? (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="animate-valet-spin text-[var(--ink-primary)]"
                      aria-label="运行中"
                    >
                      <path
                        d="M12 3a9 9 0 109 9"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : pendingCount > 0 ? (
                    <span
                      className="h-2 w-2 rounded-full bg-[var(--amber-icon)]"
                      title={`${pendingCount} 项待批`}
                    />
                  ) : unreadCount > 0 ? (
                    <span
                      className="h-2 w-2 rounded-full bg-[var(--duty-dot)] shadow-[0_0_0_3px_var(--duty-halo)]"
                      title={`${unreadCount} 条未读`}
                    />
                  ) : (
                    <span
                      className={`h-2 w-2 rounded-full ${
                        thread.archived ? "bg-[var(--ink-subtle)]" : "bg-[var(--ink-primary)]"
                      }`}
                    />
                  )}
                </div>

                {/* Clickable Content Area */}
                <button
                  type="button"
                  onClick={() => openProjectSession(thread.id)}
                  className="min-w-0 flex-1 cursor-pointer text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`truncate text-[14px] text-[var(--ink-strong)] ${
                        unreadCount > 0 ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {thread.title}
                    </span>

                    {unreadCount > 0 && (
                      <span className="rounded-full border border-[var(--core-badge-border)] bg-[var(--core-badge-bg)] px-2 py-[1px] text-[10.5px] font-medium text-[var(--core-badge-fg)]">
                        {unreadCount} 条未读
                      </span>
                    )}

                    {pendingCount > 0 && (
                      <span className="rounded-full border border-[var(--amber-pill)] bg-[var(--amber-bg)] px-2 py-[1px] text-[10.5px] font-medium text-[var(--amber-text)]">
                        {pendingCount} 待批
                      </span>
                    )}

                    {thread.originBlockId && (
                      <span className="rounded-[5px] border border-[var(--border-light)] bg-[var(--bg-subtle)] px-1.5 py-[1px] font-mono text-[10px] text-[var(--ink-muted)]">
                        Notebook 引用
                      </span>
                    )}

                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--ink-subtle)]">
                      {thread.messages.length} 条消息
                      {thread.timelineActionCount > 0
                        ? ` · ${thread.timelineActionCount} 个时间线动作`
                        : ""}{" "}
                      · {thread.updatedAt}
                    </span>
                  </div>

                  <p className="mt-1 line-clamp-1 text-[12.5px] leading-[19px] text-[var(--ink-muted)]">
                    {summary}
                  </p>
                </button>

                {/* Trailing Aligned Controls */}
                <div
                  className="flex shrink-0 items-center gap-1.5 pt-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {otherProjects.length > 0 && (
                    <SelectMenu
                      value={project.id}
                      triggerLabel="移至项目"
                      options={otherProjects.map((p) => ({
                        value: p.id,
                        label: p.title,
                        hint: p.isDefault ? "默认" : undefined,
                      }))}
                      onChange={(targetId) => moveChatThreadToProject(thread.id, targetId)}
                      align="right"
                      compact
                      triggerClassName="max-w-[120px] text-[11.5px] text-[var(--ink-secondary)]"
                    />
                  )}

                  <button
                    type="button"
                    title={thread.archived ? "恢复会话" : "归档会话"}
                    onClick={() => archiveChatThread(thread.id, !thread.archived)}
                    className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)]"
                  >
                    <ArchiveIcon size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Notebook Bridge Banner */}
      <div className="mt-8 flex items-center gap-3.5 rounded-[10px] border border-[var(--border-card)] bg-[var(--bg-subtle)]/70 px-4 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-strong)]">
          <BookOpenIcon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[var(--ink-strong)]">
            {project.title} · Notebook
          </div>
          <div className="mt-0.5 truncate text-[12px] text-[var(--ink-muted)]">
            使用 Markdown 整理思路，并随时输入 @valet 发起带上下文的新会话
          </div>
        </div>
        <button
          type="button"
          onClick={() => setProjectTab("notebook")}
          className="shrink-0 cursor-pointer rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink-strong)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
        >
          打开 Notebook →
        </button>
      </div>
    </div>
  );
};
