import React, { useEffect, useState } from "react";
import { useValet } from "../store/ValetContext";
import { getDarkThemeMeta } from "../constants/themes";
import { DEFAULT_PROJECT_ID, type AppView } from "../types/valet";
import { countUnreadThreads } from "../utils/chatUnread";
import { CreateProjectModal } from "./projects/CreateProjectModal";
import { DutyPulse } from "./ui/DutyPulse";
import {
  ArchiveIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  InboxIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  ProjectGlyph,
  SettingsIcon,
  SidebarPanelIcon,
  SunIcon,
} from "./ui/Icons";
import { Modal } from "./ui/Modal";
import { ValetLogo } from "./ui/ValetLogo";
import { WindowChrome } from "./ui/WindowChrome";

export const SidebarToggleButton: React.FC<{ title?: string }> = ({ title }) => {
  const { sidebarCollapsed, toggleSidebarCollapsed } = useValet();

  return (
    <div className="app-no-drag flex items-center gap-2">
      <button
        type="button"
        onClick={toggleSidebarCollapsed}
        title={sidebarCollapsed ? "展开侧边栏 (⌘\\)" : "收起侧边栏 (⌘\\)"}
        className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
        aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
      >
        <SidebarPanelIcon size={15} />
      </button>
      {title && (
        <span className="text-[13px] font-semibold leading-[16px] text-[var(--ink-strong)]">
          {title}
        </span>
      )}
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const {
    state,
    chatStream,
    chatStreams,
    runningChatIds,
    unreadChatCounts,
    nodTick,
    sidebarCollapsed,
    setActiveView,
    openSettingsSection,
    selectProject,
    openProjectSession,
    createNewChat,
    selectChatThread,
    archiveChatThread,
    selectTimelineEvent,
    togglePauseValet,
    updatePreferences,
    pushToast,
  } = useValet();

  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(() => ({
    [DEFAULT_PROJECT_ID]: true,
  }));

  useEffect(() => {
    if (!state.activeProjectId) return;
    setExpandedProjects((prev) =>
      prev[state.activeProjectId] === false ? prev : { ...prev, [state.activeProjectId]: true }
    );
  }, [state.activeProjectId]);

  const [isSystemDark, setIsSystemDark] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) => setIsSystemDark(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const enabledPluginsCount = state.plugins.filter(
    (p) => p.installed && p.enabled
  ).length;
  const visibleProjects = state.projects.filter((p) => !p.archived);
  const activeThreads = state.chatThreads.filter((t) => !t.archived);
  const archivedThreads = state.chatThreads.filter((t) => t.archived);
  const totalUnreadChats = countUnreadThreads(unreadChatCounts, activeThreads);

  const pendingInboxCount = state.inboxItems.filter(
    (i) => i.status === "pending"
  ).length;

  const activeTimelineBadgeCount = state.timelineEvents.filter(
    (e) => e.status === "running" || e.status === "pending_confirm"
  ).length;

  const runningEvent = state.timelineEvents.find((e) => e.status === "running");

  const liveActivity: {
    title: string;
    subtitle: string;
    onClick: () => void;
  } | null = (() => {
    if (chatStream && chatStream.phase !== "done" && chatStream.phase !== "error") {
      const activeStep =
        chatStream.steps?.find((s) => s.status === "running" || s.status === "pending") ??
        chatStream.steps?.[chatStream.steps.length - 1];
      const title =
        activeStep?.label ||
        chatStream.thinkingText ||
        (chatStream.phase === "streaming" ? "正在流式生成回复…" : "正在思考与分析…");

      if (chatStream.chatId.startsWith("event:")) {
        const pluginId = chatStream.chatId.slice("event:".length);
        const pluginName =
          state.plugins.find((p) => p.id === pluginId)?.name ?? "事件响应";
        return {
          title,
          subtitle: activeStep?.detail || `响应事件 · ${pluginName}`,
          onClick: () => setActiveView("timeline"),
        };
      }
      if (chatStream.chatId.startsWith("heartbeat")) {
        return {
          title,
          subtitle: activeStep?.detail || "后台心跳巡检中",
          onClick: () => openSettingsSection("heartbeat"),
        };
      }
      const thread = state.chatThreads.find((t) => t.id === chatStream.chatId);
      return {
        title,
        subtitle: activeStep?.detail || (thread ? `对话 · ${thread.title}` : "正在处理对话指令"),
        onClick: () => selectChatThread(chatStream.chatId),
      };
    }

    const fallbackRunningChatId = Object.entries(runningChatIds).find(
      ([, n]) => n > 0
    )?.[0];
    if (fallbackRunningChatId) {
      const thread = state.chatThreads.find((t) => t.id === fallbackRunningChatId);
      return {
        title: "正在思考与调度工具…",
        subtitle: thread ? `对话 · ${thread.title}` : "正在执行指令",
        onClick: () => selectChatThread(fallbackRunningChatId),
      };
    }

    if (runningEvent && !state.isPaused) {
      return {
        title: runningEvent.title,
        subtitle: runningEvent.progress
          ? `${runningEvent.pluginName} · ${runningEvent.progress.pct}%`
          : runningEvent.pluginName,
        onClick: () => {
          setActiveView("timeline");
          selectTimelineEvent(runningEvent.id);
        },
      };
    }

    return null;
  })();

  const resolvedDark =
    state.preferences.appearance === "dark" ||
    (state.preferences.appearance === "auto" && isSystemDark);

  const toggleAppearanceQuick = () => {
    const next = resolvedDark ? "light" : "dark";
    updatePreferences({ appearance: next });
    pushToast(
      next === "dark"
        ? `已切换深色模式 · ${getDarkThemeMeta(state.preferences.darkTheme).name}`
        : "已切换浅色模式"
    );
  };

  const navItems: Array<{
    id: AppView;
    label: string;
    shortcut?: string;
    badge?: number;
    badgeTone?: "amber" | "accent" | "neutral";
    icon: React.ReactNode;
  }> = [
    {
      id: "inbox",
      label: "收件箱",
      shortcut: "⌘ I",
      badge: pendingInboxCount > 0 ? pendingInboxCount : undefined,
      badgeTone: "amber",
      icon: <InboxIcon size={16} />,
    },
    {
      id: "timeline",
      label: "时间线",
      shortcut: "⌘ 1",
      badge: activeTimelineBadgeCount > 0 ? activeTimelineBadgeCount : undefined,
      badgeTone: "neutral",
      icon: <ClockIcon size={16} />,
    },
    {
      id: "projects",
      label: "项目",
      shortcut: "⌘ 2",
      badge: totalUnreadChats > 0 ? totalUnreadChats : undefined,
      badgeTone: "accent",
      icon: <BookOpenIcon size={16} />,
    },
    {
      id: "plugins",
      label: "插件",
      shortcut: "⌘ 3",
      icon: <PlugIcon size={16} />,
    },
  ];

  const { preferences } = state;
  const userInitial = (preferences.userNickname.trim()[0] ?? "D").toUpperCase();

  // Compact 60px Icon-Rail Sidebar (matches Paper 21-25 小屏 · *)
  if (sidebarCollapsed) {
    return (
      <aside className="flex h-full w-[60px] shrink-0 flex-col items-center border-r border-[var(--border-base)] bg-[var(--bg-sidebar)] pt-4 pb-3.5 transition-all duration-200">
        <WindowChrome compact />

        <div className="app-drag pt-4">
          <ValetLogo size="lg" withWordmark={false} nodTick={nodTick} />
        </div>

        {/* Agent compact status pill */}
        <div className="pt-2 pb-3.5">
          <button
            type="button"
            onClick={liveActivity ? liveActivity.onClick : () => setActiveView("timeline")}
            title={
              liveActivity
                ? `${liveActivity.title} · ${liveActivity.subtitle}`
                : state.isPaused
                  ? "已暂停值守"
                  : "值守中 · 当前暂无执行动作"
            }
            className="flex cursor-pointer items-center gap-[3px] rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-[6px] py-[2px] hover:border-[var(--border-strong)]"
          >
            {liveActivity ? (
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                className="animate-valet-spin shrink-0 text-[var(--ink-primary)]"
                aria-hidden="true"
              >
                <path
                  d="M12 3a9 9 0 109 9"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <span
                className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                  state.isPaused ? "bg-[var(--amber-icon)]" : "bg-[var(--duty-dot)]"
                }`}
              />
            )}
            <span className="font-mono text-[9px] font-semibold leading-[12px] text-[var(--ink-primary)]">
              {state.isPaused ? "OFF" : "ON"}
            </span>
          </button>
        </div>

        {/* Vertical Icon Navigation */}
        <nav className="flex w-10 flex-col items-center gap-1.5 border-t border-[var(--border-base)] pt-2.5">
          {navItems.map((item) => {
            const active =
              state.activeView === item.id ||
              (item.id === "projects" && state.activeView === "chat");
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}`}
                className={`relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border transition-colors ${
                  active
                    ? "border-[var(--nav-active-border)] bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]"
                    : "border-transparent text-[var(--ink-nav)] hover:bg-[var(--bg-hover)]/70 hover:text-[var(--ink-strong)]"
                }`}
              >
                {item.icon}
                {item.badge !== undefined && item.id === "inbox" && (
                  <span className="absolute -top-[3px] -right-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[1.5px] border-[var(--bg-sidebar)] bg-[var(--amber-icon)] px-0.5 font-mono text-[9px] font-bold leading-[10px] text-white">
                    {item.badge}
                  </span>
                )}
                {item.badge !== undefined && item.id === "projects" && (
                  <span
                    className="absolute -top-[3px] -right-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[1.5px] border-[var(--bg-sidebar)] bg-[var(--duty-dot)] px-0.5 font-mono text-[9px] font-bold leading-[10px] text-[var(--ink-on-primary)]"
                    title={`${item.badge} 个未读会话`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Bottom Theme Toggle, User Avatar, Compact Pause & Settings */}
        <div className="flex w-10 flex-col items-center gap-1.5 border-t border-[var(--border-base)] pt-2.5">
          <button
            type="button"
            onClick={toggleAppearanceQuick}
            title={resolvedDark ? "切换到浅色模式 (⌘⇧D)" : "切换到深色模式 (⌘⇧D)"}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            aria-label="切换深浅主题"
          >
            {resolvedDark ? <SunIcon size={14} /> : <MoonIcon size={14} />}
          </button>

          <button
            type="button"
            onClick={togglePauseValet}
            title={state.isPaused ? "继续值守" : "暂停值守"}
            aria-label={state.isPaused ? "继续值守" : "暂停值守"}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] transition-colors ${
              state.isPaused
                ? "border border-[var(--amber-pill)] bg-[var(--amber-bg)] text-[var(--amber-text)]"
                : "text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            }`}
          >
            {state.isPaused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}
          </button>

          <button
            type="button"
            onClick={() => setActiveView("settings")}
            title="设置"
            aria-label="打开设置"
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] border transition-colors ${
              state.activeView === "settings"
                ? "border-[var(--nav-active-border)] bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]"
                : "border-transparent text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            }`}
          >
            <SettingsIcon size={14} />
          </button>

          <div
            title={preferences.userNickname || "dd"}
            className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-[var(--avatar-border)] bg-[var(--avatar-bg)] text-[10px] font-semibold text-[var(--avatar-fg)]"
          >
            {userInitial}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-[var(--border-base)] bg-[var(--bg-sidebar)] px-[14px] pt-5 pb-3.5 transition-all duration-200">
      <WindowChrome paddedLeft />

      <div className="app-drag flex items-center justify-between px-1.5 pt-7 pb-[22px]">
        <ValetLogo size="sm" nodTick={nodTick} />
        <button
          type="button"
          onClick={toggleAppearanceQuick}
          title={resolvedDark ? "切换到浅色模式 (⌘⇧D)" : "切换到深色模式 (⌘⇧D)"}
          className="app-no-drag flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
          aria-label="切换深浅主题"
        >
          {resolvedDark ? <SunIcon size={14} /> : <MoonIcon size={14} />}
        </button>
      </div>

      {/* ON DUTY live Agent action card */}
      <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--border-card)] bg-[var(--bg-elevated)] p-3">
        <div className="flex items-center gap-2">
          <DutyPulse active={!state.isPaused} />
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-strong)]">
            {state.isPaused ? "Paused" : "On duty"}
          </span>
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-[var(--ink-muted)]">
            {enabledPluginsCount} plugins
          </span>
        </div>

        {liveActivity ? (
          <button
            type="button"
            onClick={liveActivity.onClick}
            className="group flex w-full cursor-pointer items-start gap-2 rounded-[7px] bg-[var(--bg-subtle)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              className="animate-valet-spin mt-[2px] shrink-0 text-[var(--ink-primary)]"
              aria-hidden="true"
            >
              <path
                d="M12 3a9 9 0 109 9"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium leading-[16px] text-[var(--ink-strong)]">
                {liveActivity.title}
              </div>
              <div className="mt-0.5 truncate text-[11px] leading-[14px] text-[var(--ink-muted)]">
                {liveActivity.subtitle}
              </div>
            </div>
            <span className="mt-[1px] shrink-0 text-[11px] text-[var(--ink-subtle)] opacity-0 transition-opacity group-hover:opacity-100">
              →
            </span>
          </button>
        ) : state.isPaused ? (
          <div className="border-t border-[var(--border-card)] pt-2">
            <div className="flex items-center gap-1.5 text-[12px] font-medium leading-[16px] text-[var(--amber-text)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--amber-icon)]" />
              <span>已暂停值守</span>
            </div>
            <div className="mt-0.5 text-[11px] leading-[15px] text-[var(--ink-subtle)]">
              事件监听与自动响应已挂起
            </div>
          </div>
        ) : (
          <div className="border-t border-[var(--border-card)] pt-2">
            <div className="text-[12px] leading-[16px] text-[var(--ink-secondary)]">
              当前暂无执行动作
            </div>
            <div className="mt-0.5 text-[11px] leading-[15px] text-[var(--ink-subtle)]">
              静默监听本机事件与指令中
            </div>
          </div>
        )}
      </div>

      {/* Workspace nav */}
      <div className="flex flex-col gap-[2px] pt-5">
        <div className="px-2 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
          Workspace
        </div>

        {navItems.map((item) => {
          const active =
            state.activeView === item.id ||
            (item.id === "projects" && state.activeView === "chat");
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
              className={`flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[8px] border px-2.5 text-left transition-colors ${
                active
                  ? "border-[var(--nav-active-border)] bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]"
                  : "border-transparent text-[var(--ink-nav)] hover:bg-[var(--bg-hover)]/65 hover:text-[var(--ink-strong)]"
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              <span
                className={`flex-1 text-[13px] leading-[16px] ${
                  active ? "font-semibold" : "font-medium"
                }`}
              >
                {item.label}
              </span>
              {item.badge !== undefined && (
                <span
                  className={`inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full px-1.5 font-sans text-[11px] font-semibold leading-[14px] ${
                    active
                      ? item.badgeTone === "amber"
                        ? "border border-[var(--nav-active-amber-border)] bg-[var(--nav-active-amber-bg)] text-[var(--nav-active-amber-fg)]"
                        : "bg-[var(--nav-active-badge-bg)] text-[var(--nav-active-fg)]"
                      : item.badgeTone === "amber"
                        ? "border border-[var(--amber-pill)] bg-[var(--amber-bg)] text-[var(--amber-text)]"
                        : item.badgeTone === "accent"
                          ? "border border-[var(--core-badge-border)] bg-[var(--core-badge-bg)] text-[var(--core-badge-fg)]"
                          : "bg-[var(--bg-hover)] text-[var(--ink-body)]"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Projects tree */}
      <div className="flex min-h-0 flex-1 flex-col gap-[2px] pt-[20px]">
        <div className="flex items-center justify-between px-2 pb-1.5">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
            Projects
          </span>
          <div className="flex items-center gap-1">
            {archivedThreads.length > 0 && (
              <button
                type="button"
                onClick={() => setArchiveModalOpen(true)}
                title="查看并恢复已归档对话"
                className="cursor-pointer rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
              >
                归档 {archivedThreads.length}
              </button>
            )}
            <button
              type="button"
              onClick={() => setCreateProjectModalOpen(true)}
              title="新建项目"
              aria-label="新建项目"
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-[5px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            >
              <PlusIcon size={12} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-[2px] overflow-y-auto pr-0.5">
          {visibleProjects.map((project) => {
            const projectThreads = activeThreads.filter(
              (t) => (t.projectId || DEFAULT_PROJECT_ID) === project.id
            );
            const projectUnreadCount = countUnreadThreads(
              unreadChatCounts,
              projectThreads
            );
            const isExpanded = expandedProjects[project.id] ?? project.id === state.activeProjectId;
            const inProjectsView =
              state.activeView === "projects" || state.activeView === "chat";
            const isProjectSelected =
              inProjectsView &&
              state.activeProjectId === project.id &&
              state.activeProjectTab !== "session";

            return (
              <div key={project.id} className="flex flex-col gap-[1px]">
                <div
                  className={`group flex h-[30px] w-full shrink-0 items-center gap-1 rounded-[7px] px-1.5 transition-colors ${
                    isProjectSelected
                      ? "bg-[var(--bg-hover)] font-semibold text-[var(--ink-strong)]"
                      : "text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]/50 hover:text-[var(--ink-strong)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedProjects((prev) => ({
                        ...prev,
                        [project.id]: !isExpanded,
                      }))
                    }
                    aria-label={isExpanded ? `收起项目 ${project.title}` : `展开项目 ${project.title}`}
                    className="flex h-5 w-[14px] shrink-0 cursor-pointer items-center justify-center text-[var(--ink-subtle)] hover:text-[var(--ink-strong)]"
                  >
                    {isExpanded ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setExpandedProjects((prev) => ({ ...prev, [project.id]: true }));
                      selectProject(project.id);
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--ink-muted)]">
                      <ProjectGlyph
                        icon={project.isDefault ? "box" : project.icon}
                        size={13.5}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[16px]">
                      {project.title}
                    </span>
                  </button>

                  {project.isDefault && (
                    <span className="shrink-0 rounded-[4px] bg-[var(--bg-muted)] px-1 py-[1px] font-mono text-[9px] leading-[11px] text-[var(--ink-muted)] group-hover:hidden">
                      默认
                    </span>
                  )}

                  {projectUnreadCount > 0 ? (
                    <span
                      className="inline-flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full bg-[var(--duty-dot)] px-1 font-mono text-[9.5px] font-bold leading-none text-[var(--ink-on-primary)] group-hover:hidden"
                      title={`${projectUnreadCount} 个未读会话`}
                    >
                      {projectUnreadCount > 99 ? "99+" : projectUnreadCount}
                    </span>
                  ) : (
                    <span className="w-4 shrink-0 text-right font-mono text-[10px] text-[var(--ink-subtle)] group-hover:hidden">
                      {projectThreads.length}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedProjects((prev) => ({ ...prev, [project.id]: true }));
                      createNewChat(project.id);
                    }}
                    title={`在「${project.title}」中新建对话`}
                    aria-label={`在「${project.title}」中新建对话`}
                    className="hidden h-[20px] w-[20px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)] group-hover:flex"
                  >
                    <PlusIcon size={11} />
                  </button>
                </div>

                {isExpanded && projectThreads.length > 0 && (
                  <div className="pl-[13px]">
                    <div className="flex flex-col gap-[1px] border-l border-[var(--border-control)] pl-2">
                      {projectThreads.map((thread) => {
                        const isSessionActive =
                          inProjectsView &&
                          state.activeProjectTab === "session" &&
                          state.activeChatId === thread.id;
                        const threadStream = chatStreams[thread.id];
                        const isRunning =
                          (runningChatIds[thread.id] ?? 0) > 0 ||
                          Boolean(
                            threadStream &&
                              threadStream.phase !== "done" &&
                              threadStream.phase !== "error"
                          );
                        const hasLivePermission = Boolean(
                          threadStream?.pendingPermission
                        );
                        const hasPending = state.inboxItems.some(
                          (it) =>
                            it.status === "pending" &&
                            (it.sourceChatId === thread.id ||
                              (it.linkedTimelineEventId &&
                                thread.linkedEventIds.includes(it.linkedTimelineEventId)))
                        );
                        const unreadCount = isSessionActive
                          ? 0
                          : (unreadChatCounts[thread.id] ?? 0);
                        const isUnread = unreadCount > 0;

                        return (
                          <div
                            key={thread.id}
                            className={`group flex h-[28px] w-full shrink-0 items-center rounded-[6px] transition-colors ${
                              isSessionActive
                                ? "bg-[var(--bg-hover)] font-semibold text-[var(--ink-strong)]"
                                : isUnread
                                  ? "font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-hover)]/50"
                                  : "text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]/50 hover:text-[var(--ink-strong)]"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => openProjectSession(thread.id)}
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-left text-[12px] leading-[16px]"
                            >
                              <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                                {isRunning ? (
                                  <svg
                                    width="9"
                                    height="9"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    className="animate-valet-spin text-[var(--ink-primary)]"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M12 3a9 9 0 109 9"
                                      stroke="currentColor"
                                      strokeWidth="3.2"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                ) : hasPending || hasLivePermission ? (
                                  <span className="h-[5.5px] w-[5.5px] rounded-full bg-[var(--amber-icon)]" />
                                ) : isUnread ? (
                                  <span
                                    className="h-[6.5px] w-[6.5px] rounded-full bg-[var(--duty-dot)] shadow-[0_0_0_2.5px_var(--duty-halo)]"
                                    title={`${unreadCount} 条未读回复`}
                                  />
                                ) : (
                                  <span
                                    className={`h-[5.5px] w-[5.5px] rounded-full ${
                                      isSessionActive
                                        ? "bg-[var(--ink-primary)]"
                                        : "bg-[var(--ink-subtle)]"
                                    }`}
                                  />
                                )}
                              </span>
                              <span
                                className={`min-w-0 flex-1 truncate ${
                                  isUnread ? "font-semibold text-[var(--ink-strong)]" : ""
                                }`}
                              >
                                {thread.title}
                              </span>
                            </button>

                            {isUnread && (
                              <span
                                className="mr-1.5 inline-flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full bg-[var(--duty-dot)] px-1 font-mono text-[9.5px] font-bold leading-none text-[var(--ink-on-primary)] group-hover:hidden group-focus-within:hidden"
                                title={`${unreadCount} 条未读回复`}
                              >
                                {unreadCount > 99 ? "99+" : unreadCount}
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                archiveChatThread(thread.id, true);
                              }}
                              title="归档对话"
                              aria-label={`归档对话 ${thread.title}`}
                              className={`mr-1 h-[20px] w-[20px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-[var(--ink-subtle)] transition-opacity hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)] ${
                                isUnread
                                  ? "hidden group-hover:flex group-focus-within:flex"
                                  : "flex opacity-0 group-hover:opacity-100 focus:opacity-100"
                              }`}
                            >
                              <ArchiveIcon size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <CreateProjectModal
        open={createProjectModalOpen}
        onClose={() => setCreateProjectModalOpen(false)}
      />

      <Modal
        open={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        title="已归档对话"
        subtitle="归档后的对话会从 Recent chats 中隐藏，可随时恢复"
      >
        <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">
          {archivedThreads.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[var(--ink-muted)]">
              暂无归档对话
            </div>
          ) : (
            archivedThreads.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-[9px] border border-[var(--border-base)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[var(--ink-strong)]">
                    {t.title}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-[var(--ink-subtle)]">
                    {t.messages.length} 条消息 · {t.archivedAt ? `归档于 ${t.archivedAt}` : t.updatedAt}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    archiveChatThread(t.id, false);
                    setArchiveModalOpen(false);
                  }}
                  className="shrink-0 cursor-pointer rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                >
                  恢复对话
                </button>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Bottom user, pause & settings bar */}
      <div className="flex items-center gap-2 border-t border-[var(--border-base)] px-1.5 pt-2.5">
        <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-[var(--avatar-border)] bg-[var(--avatar-bg)] text-[10px] font-semibold text-[var(--avatar-fg)]">
          {userInitial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium leading-[16px] text-[var(--ink-secondary)]">
            {preferences.userNickname || "dd"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={togglePauseValet}
            title={state.isPaused ? "继续值守" : "暂停值守"}
            aria-label={state.isPaused ? "继续值守" : "暂停值守"}
            className={`flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] transition-colors ${
              state.isPaused
                ? "border border-[var(--amber-pill)] bg-[var(--amber-bg)] text-[var(--amber-text)]"
                : "text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            }`}
          >
            {state.isPaused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}
          </button>
          <button
            type="button"
            onClick={() => setActiveView("settings")}
            title="设置"
            aria-label="打开设置"
            className={`flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border transition-colors ${
              state.activeView === "settings"
                ? "border-[var(--nav-active-border)] bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]"
                : "border-transparent text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            }`}
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
};
