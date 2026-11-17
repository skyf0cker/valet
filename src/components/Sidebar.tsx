import React, { useEffect, useState } from "react";
import { useValet } from "../store/ValetContext";
import type { AppView } from "../types/valet";
import { DutyPulse } from "./ui/DutyPulse";
import {
  ArchiveIcon,
  ChatBubbleIcon,
  ClockIcon,
  InboxIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  PlugIcon,
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
    runningChatIds,
    nodTick,
    sidebarCollapsed,
    setActiveView,
    openSettingsSection,
    selectChatThread,
    archiveChatThread,
    selectTimelineEvent,
    togglePauseValet,
    updatePreferences,
    pushToast,
  } = useValet();

  const [archiveModalOpen, setArchiveModalOpen] = useState(false);

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
  const recentThreads = state.chatThreads.filter((t) => !t.archived).slice(0, 6);
  const archivedThreads = state.chatThreads.filter((t) => t.archived);

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
    pushToast(next === "dark" ? "已切换深色模式" : "已切换浅色模式");
  };

  const navItems: Array<{
    id: AppView;
    label: string;
    shortcut?: string;
    badge?: number;
    badgeTone?: "amber" | "neutral";
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
      id: "chat",
      label: "对话",
      shortcut: "⌘ 2",
      icon: <ChatBubbleIcon size={16} />,
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
                  state.isPaused ? "bg-[var(--amber-icon)]" : "bg-[var(--ink-primary)]"
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
            const active = state.activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}`}
                className={`relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] transition-colors ${
                  active
                    ? "bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                    : "text-[var(--ink-primary)] hover:bg-[var(--bg-hover)]/70"
                }`}
              >
                {item.icon}
                {item.badge !== undefined && item.id === "inbox" && (
                  <span className="absolute -top-[3px] -right-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[1.5px] border-[var(--bg-sidebar)] bg-[var(--amber-icon)] px-0.5 font-mono text-[9px] font-bold leading-[10px] text-white">
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
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] transition-colors ${
              state.activeView === "settings"
                ? "bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                : "text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            }`}
          >
            <SettingsIcon size={14} />
          </button>

          <div
            title={preferences.userNickname || "dd"}
            className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[10px] font-semibold text-[var(--ink-on-primary)]"
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
          const active = state.activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
              className={`flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-left transition-colors ${
                active
                  ? "bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                  : "text-[var(--ink-nav)] hover:bg-[var(--bg-hover)]/65 hover:text-[var(--ink-strong)]"
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
                      ? "bg-[var(--ink-on-primary)]/16 text-[var(--ink-on-primary)]"
                      : item.badgeTone === "amber"
                        ? "border border-[var(--amber-pill)] bg-[var(--amber-bg)] text-[var(--amber-text)]"
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

      {/* Recent chats */}
      <div className="flex min-h-0 flex-1 flex-col gap-[2px] pt-[22px]">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
            Recent chats
          </span>
          {archivedThreads.length > 0 && (
            <button
              type="button"
              onClick={() => setArchiveModalOpen(true)}
              title="查看并恢复已归档对话"
              className="cursor-pointer rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            >
              已归档 {archivedThreads.length}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-[2px] overflow-y-auto">
          {recentThreads.map((thread) => {
            const active = state.activeView === "chat" && state.activeChatId === thread.id;
            return (
              <div
                key={thread.id}
                className={`group flex h-[30px] w-full shrink-0 items-center rounded-[7px] transition-colors ${
                  active
                    ? "bg-[var(--bg-hover)] font-semibold text-[var(--ink-strong)]"
                    : "text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]/50 hover:text-[var(--ink-strong)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectChatThread(thread.id)}
                  className="min-w-0 flex-1 cursor-pointer truncate px-2.5 text-left text-[13px] leading-[16px]"
                >
                  {thread.title}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    archiveChatThread(thread.id, true);
                  }}
                  title="归档对话"
                  aria-label={`归档对话 ${thread.title}`}
                  className="mr-1.5 flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-[var(--ink-subtle)] opacity-0 transition-opacity hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)] group-hover:opacity-100 focus:opacity-100"
                >
                  <ArchiveIcon size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

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
        <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[10px] font-semibold text-[var(--ink-on-primary)]">
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
            className={`flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] transition-colors ${
              state.activeView === "settings"
                ? "bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                : "text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            }`}
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
};
