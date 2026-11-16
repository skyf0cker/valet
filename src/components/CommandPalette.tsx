import React, { useEffect, useMemo, useState } from "react";
import { useValet } from "../store/ValetContext";
import type { SettingsSectionId } from "../types/valet";
import { SearchIcon } from "./ui/Icons";

interface PaletteItem {
  id: string;
  group: string;
  title: string;
  subtitle: string;
  shortcut?: string;
  onSelect: () => void;
}

const SETTINGS_QUICK_LINKS: Array<{
  id: SettingsSectionId;
  title: string;
  subtitle: string;
}> = [
  { id: "thresholds", title: "设置 · 监控阈值", subtitle: "磁盘可用、CPU 异常、忽略进程与事件节流" },
  { id: "cleanup", title: "设置 · 清理策略", subtitle: "废纸篓还原期、受保护目录与卸载后扫描" },
  { id: "runtime", title: "设置 · 插件运行时", subtitle: "沙箱隔离、未签名本地插件与每小时上限" },
  { id: "safety", title: "设置 · 自主与安全", subtitle: "自主程度、始终确认操作清单与紧急停止" },
  { id: "models", title: "设置 · 模型与服务商", subtitle: "API Key、每日花费上限与默认模型" },
  { id: "general", title: "设置 · 通用与外观", subtitle: "深色/浅色主题、开机启动与全局快捷键" },
];

export const CommandPalette: React.FC = () => {
  const {
    state,
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveView,
    selectInboxItem,
    approveAllReversibleInboxItems,
    selectTimelineEvent,
    openPluginDetail,
    openSettingsSection,
    selectChatThread,
    createNewChat,
    togglePauseValet,
    toggleSidebarCollapsed,
    updatePreferences,
    resetOnboarding,
  } = useValet();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [commandPaletteOpen]);

  const pendingInboxItems = state.inboxItems.filter((i) => i.status === "pending");
  const reversibleCount = pendingInboxItems.filter((i) => i.reversible7d).length;

  const allItems = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      {
        id: "act-inbox",
        group: "快速动作",
        title: `打开收件箱 (${pendingInboxItems.length} 项待批)`,
        subtitle: "审核待确认的文件清理、进程结束与外发消息",
        shortcut: "⌘I",
        onSelect: () => setActiveView("inbox"),
      },
      ...(reversibleCount > 0
        ? [
            {
              id: "act-batch-inbox",
              group: "快速动作",
              title: `批准所有可撤销待办 (${reversibleCount} 项)`,
              subtitle: "一键批准支持安全撤销的待确认事项",
              onSelect: approveAllReversibleInboxItems,
            },
          ]
        : []),
      {
        id: "act-new-chat",
        group: "快速动作",
        title: "新建对话",
        subtitle: "开启一个新的 Valet 诊断或插件编写会话",
        shortcut: "⌘N",
        onSelect: createNewChat,
      },
      {
        id: "act-sidebar",
        group: "快速动作",
        title: "展开 / 收起侧边栏",
        subtitle: "在完整导航栏与 60px 紧凑图标栏之间切换",
        shortcut: "⌘\\",
        onSelect: toggleSidebarCollapsed,
      },
      {
        id: "act-toggle-pause",
        group: "快速动作",
        title: state.isPaused ? "恢复 Valet 在岗监听" : "暂停 Valet 所有后台任务",
        subtitle: "切换后台事件监控与自动执行状态",
        shortcut: "⌥⎋",
        onSelect: togglePauseValet,
      },
      {
        id: "act-theme",
        group: "快速动作",
        title:
          state.preferences.appearance === "dark"
            ? "切换外观为浅色模式"
            : "切换外观为深色模式",
        subtitle: "立即预览中性深色 / 浅色外观变化",
        shortcut: "⌘⇧D",
        onSelect: () =>
          updatePreferences({
            appearance: state.preferences.appearance === "dark" ? "light" : "dark",
          }),
      },
      {
        id: "act-onboarding",
        group: "快速动作",
        title: "重新运行新手引导",
        subtitle: "回到 5 步初始化设置流（欢迎、权限、插件、模型、体检）",
        onSelect: resetOnboarding,
      },
    ];

    const inboxPalette: PaletteItem[] = pendingInboxItems.map((it) => ({
      id: `inb-${it.id}`,
      group: "收件箱待批",
      title: it.title,
      subtitle: `${it.timeLabel} · ${it.pluginName} · ${it.approveLabel}`,
      onSelect: () => {
        setActiveView("inbox");
        selectInboxItem(it.id);
      },
    }));

    const events: PaletteItem[] = state.timelineEvents.map((evt) => ({
      id: `evt-${evt.id}`,
      group: "时间线事件",
      title: evt.title,
      subtitle: `${evt.timeLabel} · ${evt.pluginName} · ${evt.eventCode}`,
      onSelect: () => {
        setActiveView("timeline");
        selectTimelineEvent(evt.id);
      },
    }));

    const plugins: PaletteItem[] = state.plugins
      .filter((p) => p.installed)
      .map((pl) => ({
        id: `pl-${pl.id}`,
        group: "已安装插件",
        title: pl.name,
        subtitle: `${pl.tagline} (${pl.bundleId})`,
        onSelect: () => openPluginDetail(pl.id),
      }));

    const settingsItems: PaletteItem[] = SETTINGS_QUICK_LINKS.map((sec) => ({
      id: `set-${sec.id}`,
      group: "设置页",
      title: sec.title,
      subtitle: sec.subtitle,
      onSelect: () => openSettingsSection(sec.id),
    }));

    const chats: PaletteItem[] = state.chatThreads.map((ch) => ({
      id: `chat-${ch.id}`,
      group: "历史对话",
      title: ch.title,
      subtitle: `${ch.model} · ${ch.updatedAt}`,
      onSelect: () => selectChatThread(ch.id),
    }));

    return [
      ...actions,
      ...inboxPalette,
      ...events,
      ...plugins,
      ...settingsItems,
      ...chats,
    ];
  }, [
    approveAllReversibleInboxItems,
    createNewChat,
    openPluginDetail,
    openSettingsSection,
    pendingInboxItems,
    resetOnboarding,
    reversibleCount,
    selectChatThread,
    selectInboxItem,
    selectTimelineEvent,
    setActiveView,
    state.chatThreads,
    state.isPaused,
    state.plugins,
    state.preferences.appearance,
    state.timelineEvents,
    togglePauseValet,
    toggleSidebarCollapsed,
    updatePreferences,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems.slice(0, 12);
    return allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q)
    );
  }, [allItems, query]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((idx) => (filtered.length > 0 ? (idx + 1) % filtered.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((idx) =>
          filtered.length > 0 ? (idx - 1 + filtered.length) % filtered.length : 0
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const chosen = filtered[activeIndex];
        if (chosen) {
          chosen.onSelect();
          setCommandPaletteOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, commandPaletteOpen, filtered, setCommandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh] backdrop-blur-[2px]"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-valet-modal-in flex w-full max-w-[560px] flex-col overflow-hidden rounded-[14px] border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-[var(--shadow-popover)]"
      >
        <div className="flex h-[48px] items-center gap-2.5 border-b border-[var(--border-light)] px-4">
          <SearchIcon size={15} className="text-[var(--ink-subtle)]" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="搜索动作、收件箱、时间线事件、插件、设置或对话…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)]"
          />
          <kbd className="rounded-[4px] border border-[var(--border-control)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
            ESC
          </kbd>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-[var(--ink-muted)]">
              没有找到匹配的动作或记录
            </div>
          ) : (
            filtered.map((item, idx) => {
              const selected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    item.onSelect();
                    setCommandPaletteOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[9px] px-3 py-2 text-left transition-colors ${
                    selected ? "bg-[var(--bg-muted)]" : "hover:bg-[var(--bg-subtle)]"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--ink-subtle)]">
                        {item.group}
                      </span>
                      <span className="truncate text-[13px] font-medium text-[var(--ink-strong)]">
                        {item.title}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--ink-muted)]">
                      {item.subtitle}
                    </div>
                  </div>
                  {item.shortcut && (
                    <span className="shrink-0 font-mono text-[11px] text-[var(--ink-muted)]">
                      {item.shortcut}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
