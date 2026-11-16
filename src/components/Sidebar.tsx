import React, { useEffect, useState } from "react";
import { useValet } from "../store/ValetContext";
import type { AppView } from "../types/valet";
import { DutyPulse } from "./ui/DutyPulse";
import {
  ChatBubbleIcon,
  ClockIcon,
  InboxIcon,
  MoonIcon,
  PlugIcon,
  SidebarPanelIcon,
  SlidersIcon,
  SunIcon,
} from "./ui/Icons";
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
    nodTick,
    sidebarCollapsed,
    setActiveView,
    selectChatThread,
    selectTimelineEvent,
    togglePauseValet,
    updatePreferences,
    pushToast,
  } = useValet();

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

  const pendingInboxCount = state.inboxItems.filter(
    (i) => i.status === "pending"
  ).length;

  const activeTimelineBadgeCount = state.timelineEvents.filter(
    (e) => e.status === "running" || e.status === "pending_confirm"
  ).length;

  const runningEvent = state.timelineEvents.find((e) => e.status === "running");

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
    {
      id: "settings",
      label: "设置",
      shortcut: "⌘ ,",
      icon: <SlidersIcon size={16} />,
    },
  ];

  const { systemMetrics, preferences } = state;
  const userInitial = (preferences.userNickname.trim()[0] ?? "D").toUpperCase();

  // Compact 60px Icon-Rail Sidebar (matches Paper 21-25 小屏 · *)
  if (sidebarCollapsed) {
    return (
      <aside className="flex h-full w-[60px] shrink-0 flex-col items-center border-r border-[var(--border-base)] bg-[var(--bg-sidebar)] pt-4 pb-3.5 transition-all duration-200">
        <WindowChrome compact />

        <div className="app-drag pt-4">
          <ValetLogo size="lg" withWordmark={false} nodTick={nodTick} />
        </div>

        {/* Disk compact status pill */}
        <div className="pt-2 pb-3.5">
          <button
            type="button"
            onClick={() => setActiveView("timeline")}
            title={`磁盘使用 ${systemMetrics.diskPct}% · ${
              state.isPaused ? "已暂停" : "On Duty"
            }`}
            className="flex cursor-pointer items-center gap-[3px] rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-[5px] py-[2px] hover:border-[var(--border-strong)]"
          >
            <span
              className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                state.isPaused ? "bg-[var(--amber-icon)]" : "bg-[var(--ink-primary)]"
              }`}
            />
            <span className="font-mono text-[9px] font-semibold leading-[12px] text-[var(--ink-primary)]">
              {systemMetrics.diskPct}%
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

        {/* Bottom Theme Toggle, User Avatar & Compact Pause */}
        <div className="flex w-10 flex-col items-center gap-2 border-t border-[var(--border-base)] pt-2.5">
          <button
            type="button"
            onClick={toggleAppearanceQuick}
            title={resolvedDark ? "切换到浅色模式 (⌘⇧D)" : "切换到深色模式 (⌘⇧D)"}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)]"
            aria-label="切换深浅主题"
          >
            {resolvedDark ? <SunIcon size={14} /> : <MoonIcon size={14} />}
          </button>

          <div
            title={preferences.userNickname || "dd"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[11px] font-semibold text-[var(--ink-on-primary)]"
          >
            {userInitial}
          </div>

          <button
            type="button"
            onClick={togglePauseValet}
            title={state.isPaused ? "继续 Valet (⌥⎋)" : "暂停 Valet (⌥⎋)"}
            className="inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-surface)] font-mono text-[9px] leading-[12px] text-[var(--ink-primary)] transition-colors hover:bg-[var(--bg-subtle)]"
          >
            {state.isPaused ? "▶" : "❚❚"}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-[var(--border-base)] bg-[var(--bg-sidebar)] px-[14px] pt-5 pb-4 transition-all duration-200">
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

      {/* ON DUTY telemetry card */}
      <div className="flex flex-col gap-2.5 rounded-[10px] border border-[var(--border-card)] bg-[var(--bg-elevated)] p-3">
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

        <div className="flex items-center gap-2">
          <span className="w-[34px] shrink-0 text-[11px] text-[var(--ink-muted)]">磁盘</span>
          <div className="h-1 flex-1 overflow-hidden rounded-[2px] bg-[var(--bg-track)]">
            <div
              className="h-full rounded-[2px] bg-[var(--ink-primary)] transition-all duration-700 ease-[var(--ease-valet)]"
              style={{ width: `${systemMetrics.diskPct}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-[10px] font-semibold text-[var(--ink-strong)]">
            {systemMetrics.diskPct}%
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-[34px] shrink-0 text-[11px] text-[var(--ink-muted)]">CPU</span>
          <div className="h-1 flex-1 overflow-hidden rounded-[2px] bg-[var(--bg-track)]">
            <div
              className="h-full rounded-[2px] bg-[var(--ink-muted)] transition-all duration-500"
              style={{ width: `${systemMetrics.cpuPct}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-[10px] text-[var(--ink-body)]">
            {systemMetrics.cpuPct}%
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-[34px] shrink-0 text-[11px] text-[var(--ink-muted)]">内存</span>
          <div className="h-1 flex-1 overflow-hidden rounded-[2px] bg-[var(--bg-track)]">
            <div
              className="h-full rounded-[2px] bg-[var(--ink-muted)] transition-all duration-500"
              style={{ width: `${systemMetrics.memPct}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-[10px] text-[var(--ink-body)]">
            {systemMetrics.memPct}%
          </span>
        </div>

        {runningEvent && !state.isPaused && (
          <button
            type="button"
            onClick={() => {
              setActiveView("timeline");
              selectTimelineEvent(runningEvent.id);
            }}
            className="flex w-full cursor-pointer items-center gap-1.5 border-t border-[var(--border-card)] pt-2 text-left transition-opacity hover:opacity-75"
          >
            <svg
              width="11"
              height="11"
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
            <span className="truncate text-[12px] font-medium leading-[16px] text-[var(--ink-strong)]">
              正在清理开发缓存 · {runningEvent.progress?.pct ?? 68}%
            </span>
          </button>
        )}

        {state.isPaused && (
          <div className="flex items-center gap-1.5 border-t border-[var(--border-card)] pt-2 text-[11px] text-[var(--amber-text)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--amber-icon)]" />
            <span>已暂停监听与自动执行</span>
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
        <div className="px-2 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
          Recent chats
        </div>
        <div className="flex flex-col gap-[2px] overflow-y-auto">
          {state.chatThreads.slice(0, 6).map((thread) => {
            const active = state.activeView === "chat" && state.activeChatId === thread.id;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => selectChatThread(thread.id)}
                className={`flex h-[30px] w-full shrink-0 cursor-pointer items-center rounded-[7px] px-2.5 text-left transition-colors ${
                  active
                    ? "bg-[var(--bg-hover)] font-semibold text-[var(--ink-strong)]"
                    : "text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]/50 hover:text-[var(--ink-strong)]"
                }`}
              >
                <span className="truncate text-[13px] leading-[16px]">{thread.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom user & pause bar */}
      <div className="flex items-center gap-2.5 border-t border-[var(--border-base)] px-2 pt-2.5">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[11px] font-semibold text-[var(--ink-on-primary)]">
          {userInitial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold leading-[16px] text-[var(--ink-strong)]">
            {preferences.userNickname || "dd"}
          </div>
        </div>
        <button
          type="button"
          onClick={togglePauseValet}
          title={state.isPaused ? "继续 Valet (⌥⎋)" : "暂停 Valet (⌥⎋)"}
          className="inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-subtle)] px-2 font-mono text-[10px] leading-[12px] text-[var(--ink-strong)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          {state.isPaused ? "▶ ⌥⎋" : "❚❚ ⌥⎋"}
        </button>
      </div>
    </aside>
  );
};
