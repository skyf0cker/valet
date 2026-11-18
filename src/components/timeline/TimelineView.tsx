import React, { useEffect, useMemo, useRef, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type { TimelineStatus } from "../../types/valet";
import { SearchIcon } from "../ui/Icons";
import { SelectMenu } from "../ui/SelectMenu";
import { WorkspacePageHeader } from "../ui/WorkspacePageHeader";
import { TimelineDetailDrawer } from "./TimelineDetailDrawer";
import { TimelineRow } from "./TimelineRow";

type StatusFilter = "all" | TimelineStatus;

let lastConsumedTimelineFocusTick = 0;

export const TimelineView: React.FC = () => {
  const {
    state,
    sidebarCollapsed,
    arrivalNotice,
    clearArrivalNotice,
    setCommandPaletteOpen,
    timelineFocusSignal,
    selectTimelineEvent,
    setTimelinePluginFilter,
    executeTimelineEventActions,
    fixPluginAuth,
    restoreTimelineEvent,
    quoteTimelineEventToChat,
  } = useValet();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showEarlier, setShowEarlier] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pendingScrollEventIdRef = useRef<string | null>(null);

  const todayEvents = useMemo(
    () => state.timelineEvents.filter((e) => e.dayGroup === "today"),
    [state.timelineEvents]
  );

  const earlierEvents = useMemo(
    () => state.timelineEvents.filter((e) => e.dayGroup === "earlier"),
    [state.timelineEvents]
  );

  const counts = useMemo(() => {
    const base = state.timelineEvents;
    const earlierOffset = state.earlierCountLabel ? 9 : 0;
    return {
      all: base.length + earlierOffset,
      rawAll: base.length,
      running: base.filter((e) => e.status === "running").length,
      pending_confirm: base.filter((e) => e.status === "pending_confirm").length,
      completed: base.filter((e) => e.status === "completed").length,
      failed: base.filter((e) => e.status === "failed").length,
    };
  }, [state.timelineEvents, state.earlierCountLabel]);

  const autoCompletedCount = counts.completed + (state.earlierCountLabel ? 9 : 0);

  const interceptedCount = useMemo(
    () => state.timelineEvents.filter((e) => e.intercepted).length + (state.earlierCountLabel ? 1 : 0),
    [state.timelineEvents, state.earlierCountLabel]
  );

  const todayHeaderLabel = useMemo(() => {
    const d = new Date();
    const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
    const day = String(d.getDate()).padStart(2, "0");
    const month = d.toLocaleDateString("en-US", { month: "short" });
    return `${weekday} · ${day} ${month} ${d.getFullYear()}`;
  }, []);

  const pluginFilterOptions = useMemo(() => {
    const installed = state.plugins.filter((p) => p.installed);
    return [
      { value: "all", label: "全部插件" },
      ...installed.map((p) => ({ value: p.id, label: p.name })),
    ];
  }, [state.plugins]);

  const applyFilter = (list: typeof state.timelineEvents) =>
    list.filter((evt) => {
      if (statusFilter !== "all" && evt.status !== statusFilter) return false;
      if (state.timelinePluginFilter !== "all" && evt.pluginId !== state.timelinePluginFilter) {
        return false;
      }
      return true;
    });

  const filteredToday = useMemo(
    () => applyFilter(todayEvents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayEvents, statusFilter, state.timelinePluginFilter]
  );

  const filteredEarlier = useMemo(
    () => applyFilter(earlierEvents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [earlierEvents, statusFilter, state.timelinePluginFilter]
  );

  useEffect(() => {
    if (!timelineFocusSignal || timelineFocusSignal.tick === lastConsumedTimelineFocusTick) {
      return;
    }
    const targetEvt = state.timelineEvents.find((e) => e.id === timelineFocusSignal.eventId);
    if (!targetEvt) return;
    lastConsumedTimelineFocusTick = timelineFocusSignal.tick;
    pendingScrollEventIdRef.current = targetEvt.id;

    if (statusFilter !== "all" && statusFilter !== targetEvt.status) {
      setStatusFilter("all");
    }
    if (targetEvt.dayGroup === "earlier") {
      setShowEarlier(true);
    }
  }, [state.timelineEvents, statusFilter, timelineFocusSignal]);

  useEffect(() => {
    const targetId = pendingScrollEventIdRef.current;
    const container = scrollContainerRef.current;
    if (!targetId || !container) return;

    const rows = container.querySelectorAll<HTMLElement>("[data-timeline-event-id]");
    let matched: HTMLElement | null = null;
    for (const row of rows) {
      if (row.dataset.timelineEventId === targetId) {
        matched = row;
        break;
      }
    }
    if (!matched) return;
    pendingScrollEventIdRef.current = null;
    const raf = window.requestAnimationFrame(() => {
      matched.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [filteredEarlier, filteredToday, showEarlier, statusFilter, timelineFocusSignal]);

  const filterChips: Array<{
    id: StatusFilter;
    label: string;
    count: number;
    dotColor?: string;
  }> = [
    { id: "all", label: "全部", count: counts.rawAll },
    { id: "running", label: "进行中", count: counts.running, dotColor: "bg-[var(--ink-primary)]" },
    {
      id: "pending_confirm",
      label: "待确认",
      count: counts.pending_confirm,
      dotColor: "bg-[var(--amber-icon)]",
    },
    { id: "completed", label: "已完成", count: counts.completed },
    { id: "failed", label: "失败", count: counts.failed },
  ];

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {/* Sticky Workspace Header */}
      <WorkspacePageHeader
        compactTitle="时间线"
        dimmed={Boolean(state.selectedTimelineEventId)}
        topActions={
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className={`app-no-drag flex cursor-pointer items-center gap-2 bg-[var(--bg-subtle)] text-left transition-colors hover:bg-[var(--bg-hover)] ${
              sidebarCollapsed
                ? "h-[26px] w-[176px] rounded-[7px] px-[9px]"
                : "h-[30px] w-[220px] rounded-[8px] px-2.5"
            }`}
          >
            <SearchIcon size={13} className="shrink-0 text-[var(--ink-subtle)]" />
            <span className="flex-1 truncate text-[11.5px] text-[var(--ink-subtle)]">
              {sidebarCollapsed ? "搜索动作、文件" : "搜索动作、应用、文件"}
            </span>
            <span className="font-mono text-[10px] text-[var(--ink-subtle)]">⌘K</span>
          </button>
        }
        kicker={todayHeaderLabel}
        title={
          <>
            今天，
            <span
              className={`font-[family-name:var(--font-serif-en)] font-normal italic ${
                sidebarCollapsed ? "text-[29px]" : "text-[30px] lg:text-[40px]"
              }`}
            >
              Valet
            </span>{" "}
            处理了 {counts.all} 个事件
          </>
        }
        metrics={[
          { value: autoCompletedCount, label: "自动完成" },
          { value: interceptedCount, label: "拦截异常" },
        ]}
        filterBarClassName={`flex flex-wrap items-center gap-1.5 border-b border-[var(--border-light)] ${
          sidebarCollapsed
            ? "px-6 pt-3 pb-2.5"
            : "px-6 pt-4 pb-3 lg:px-12 lg:pt-[22px] lg:pb-3.5"
        }`}
        filterBar={
          <>
            {filterChips.map((chip) => {
              const active = statusFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setStatusFilter(chip.id)}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full transition-colors ${
                    sidebarCollapsed
                      ? "h-[25px] px-2.5 text-[11px]"
                      : "h-[28px] px-3 text-[12px]"
                  } ${
                    active
                      ? "bg-[var(--ink-primary)] font-medium text-[var(--ink-on-primary)]"
                      : "border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-strong)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  {chip.dotColor && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        active ? "bg-[var(--ink-on-primary)]" : chip.dotColor
                      }`}
                    />
                  )}
                  <span>
                    {chip.label} {chip.count}
                  </span>
                </button>
              );
            })}

            <div className="flex-1" />

            <SelectMenu
              value={state.timelinePluginFilter}
              options={pluginFilterOptions}
              onChange={setTimelinePluginFilter}
              triggerClassName="border-0 bg-transparent text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            />
          </>
        }
      />

      {/* Scrollable list container */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* M8 New Event Arrival Floating Pill */}
        {arrivalNotice && (
          <button
            type="button"
            onClick={() => {
              scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              clearArrivalNotice();
            }}
            className="animate-valet-pill-drop absolute top-3 left-1/2 z-20 flex h-[30px] cursor-pointer items-center gap-2 rounded-full bg-[var(--ink-primary)] px-3.5 text-[12px] font-medium text-[var(--ink-on-primary)] shadow-[var(--shadow-popover)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--ink-on-primary)]" />
            <span>1 个新事件 · {arrivalNotice.pluginName} ↑</span>
          </button>
        )}

        {/* Scrollable timeline list (M4 shift & dim when Drawer opens) */}
        <div
          ref={scrollContainerRef}
          className={`min-h-0 flex-1 overflow-y-auto pb-10 transition-all duration-300 ease-[var(--ease-valet)] ${
            state.selectedTimelineEventId ? "-translate-x-4 opacity-55" : "translate-x-0 opacity-100"
          }`}
        >
          {/* Timeline list */}
          <div
            className={`flex flex-col pt-2 ${
              sidebarCollapsed ? "px-6" : "px-6 lg:px-12"
            }`}
          >
            {filteredToday.length === 0 ? (
              <div className="py-12 text-center text-[13px] text-[var(--ink-muted)]">
                当前筛选条件下暂无今日事件
              </div>
            ) : (
              filteredToday.map((evt, idx) => (
                <TimelineRow
                  key={evt.id}
                  event={evt}
                  index={idx}
                  compact={sidebarCollapsed}
                  isFirst={idx === 0}
                  isLast={idx === filteredToday.length - 1 && !showEarlier}
                  isSelected={state.selectedTimelineEventId === evt.id}
                  onOpenDetail={() => selectTimelineEvent(evt.id)}
                  onExecutePending={() => executeTimelineEventActions(evt.id)}
                  onFixAuth={(pid) => fixPluginAuth(pid)}
                  onRestore={() => restoreTimelineEvent(evt.id)}
                  onQuoteToChat={() => quoteTimelineEventToChat(evt.id)}
                />
              ))
            )}

            {/* EARLIER separator */}
            {Boolean(state.earlierCountLabel) && (
              <>
                <div className="flex items-center gap-3.5 pt-[22px]">
                  <span className="w-[44px] shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ink-subtle)] lg:w-[64px]">
                    Earlier
                  </span>
                  <div className="h-[1px] flex-1 bg-[var(--border-light)]" />
                  <button
                    type="button"
                    onClick={() => setShowEarlier((s) => !s)}
                    className="cursor-pointer text-[11.5px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)] lg:text-[12px]"
                  >
                    {showEarlier ? "收起昨天动作 ↑" : state.earlierCountLabel}
                  </button>
                </div>

                {showEarlier && (
                  <div className="pt-2">
                    {filteredEarlier.map((evt, idx) => (
                      <TimelineRow
                        key={evt.id}
                        event={evt}
                        index={idx}
                        compact={sidebarCollapsed}
                        isFirst={idx === 0}
                        isLast={idx === filteredEarlier.length - 1}
                        isSelected={state.selectedTimelineEventId === evt.id}
                        onOpenDetail={() => selectTimelineEvent(evt.id)}
                        onExecutePending={() => executeTimelineEventActions(evt.id)}
                        onFixAuth={(pid) => fixPluginAuth(pid)}
                        onRestore={() => restoreTimelineEvent(evt.id)}
                        onQuoteToChat={() => quoteTimelineEventToChat(evt.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right 580px detail Canvas drawer */}
      <TimelineDetailDrawer />
    </div>
  );
};
