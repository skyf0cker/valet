import React, { useMemo, useState } from "react";
import { useValet } from "../../store/ValetContext";
import { PluginTag, StatusPill } from "../ui/Badge";
import { Checkbox } from "../ui/Checkbox";
import { CloseIcon, UndoIcon } from "../ui/Icons";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";
import { SlideOverDrawer } from "../ui/Modal";
import { SegmentedControl } from "../ui/SegmentedControl";

type DrawerTab = "overview" | "chain" | "logs";

export const TimelineDetailDrawer: React.FC = () => {
  const {
    state,
    selectTimelineEvent,
    toggleTimelineActionItem,
    executeTimelineEventActions,
    ignoreTimelineEvent,
    restoreTimelineEvent,
    fixPluginAuth,
    pushToast,
  } = useValet();

  const [tab, setTab] = useState<DrawerTab>("overview");
  const [expandedItems, setExpandedItems] = useState(false);

  const event = useMemo(
    () =>
      state.selectedTimelineEventId
        ? state.timelineEvents.find((e) => e.id === state.selectedTimelineEventId) ?? null
        : null,
    [state.selectedTimelineEventId, state.timelineEvents]
  );

  const visibleItems = useMemo(() => {
    if (!event) return [];
    if (expandedItems) return event.actionItems;
    return event.actionItems.filter((item) => !item.defaultHidden);
  }, [event, expandedItems]);

  const hiddenCount = useMemo(() => {
    if (!event) return 0;
    return event.actionItems.filter((item) => item.defaultHidden).length;
  }, [event]);

  const selectedCount = event ? event.actionItems.filter((i) => i.checked).length : 0;
  const totalCount = event ? event.actionItems.length : 0;
  const selectedSizeMB = event
    ? event.actionItems.filter((i) => i.checked).reduce((acc, i) => acc + i.sizeMB, 0)
    : 0;
  const selectedSizeGB = (selectedSizeMB / 1024).toFixed(1);

  return (
    <SlideOverDrawer
      open={Boolean(event)}
      onClose={() => selectTimelineEvent(null)}
    >
      {event && (
        <>
          {/* Header */}
          <div className="flex h-[56px] shrink-0 items-center gap-2.5 border-b border-[var(--border-light)] px-5">
            <button
              type="button"
              onClick={() => selectTimelineEvent(null)}
              className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-[var(--bg-subtle)] text-[var(--ink-primary)] hover:bg-[var(--bg-hover)]"
              aria-label="关闭详情"
            >
              <CloseIcon size={14} />
            </button>

            <span className="truncate font-mono text-[11px] tracking-[0.08em] text-[var(--ink-muted)]">
              {event.triggerLatencyLabel ?? `${event.timeLabel} · ${event.eventCode}`}
            </span>

            <div className="flex-1" />

            <SegmentedControl<DrawerTab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "overview", label: "概览" },
                { value: "chain", label: "事件链" },
                { value: "logs", label: "日志" },
              ]}
            />
          </div>

          {/* Scrollable Body */}
          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-7 pt-[22px] pb-6">
            {/* Title block */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  status={event.status}
                  pendingLabel="等你确认"
                />
                <PluginTag label={event.pluginName} />
                <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                  {event.eventCode}
                </span>
              </div>
              <h3 className="font-[family-name:var(--font-serif-zh)] text-[26px] font-normal leading-[36px] tracking-[-0.01em] text-[var(--ink-strong)]">
                {event.title}
              </h3>
            </div>

            {tab === "overview" && (
              <>
                {/* 01 Event Payload */}
                <section className="flex flex-col gap-2">
                  <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                    01 · 事件
                  </div>
                  <pre className="overflow-x-auto rounded-[8px] bg-[var(--bg-code)] px-3.5 py-3 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)]">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </section>

                {/* 02 Reasoning */}
                <section className="flex flex-col gap-2">
                  <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                    02 · 判断
                  </div>
                  <MarkdownRenderer
                    text={event.reasoning}
                    className="text-[13px] leading-[21px] text-[var(--ink-body)]"
                  />
                </section>

                {/* 03 Action checklist */}
                {event.actionItems.length > 0 && (
                  <section className="flex flex-col gap-1">
                    <div className="flex items-center justify-between pb-1">
                      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                        03 · 动作
                      </span>
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        已选 {selectedCount} / {totalCount}
                        {selectedSizeMB > 0 ? ` · ${selectedSizeGB} GB` : ""}
                      </span>
                    </div>

                    {visibleItems.map((item) => {
                      const locked = event.status === "completed";
                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (!locked) toggleTimelineActionItem(event.id, item.id);
                          }}
                          className={`flex h-[32px] items-center gap-2.5 rounded-[6px] px-1 transition-colors ${
                            locked ? "cursor-default" : "cursor-pointer hover:bg-[var(--bg-subtle)]"
                          }`}
                        >
                          <Checkbox
                            checked={item.checked}
                            disabled={locked}
                            onChange={() => toggleTimelineActionItem(event.id, item.id)}
                          />
                          <div
                            className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
                              item.checked ? "text-[var(--ink-strong)]" : "text-[var(--ink-subtle)]"
                            }`}
                          >
                            {item.label}
                            {item.keepNote && (
                              <span className="font-sans text-[11px] text-[var(--ink-subtle)]">
                                {" "}
                                {item.keepNote}
                              </span>
                            )}
                          </div>
                          <span className="w-[64px] shrink-0 text-right font-mono text-[11px] text-[var(--ink-muted)]">
                            {item.sizeLabel}
                          </span>
                        </div>
                      );
                    })}

                    {hiddenCount > 0 && !expandedItems && (
                      <button
                        type="button"
                        onClick={() => setExpandedItems(true)}
                        className="mt-1 w-fit cursor-pointer text-[12px] font-medium text-[var(--ink-strong)] hover:underline"
                      >
                        + 展开其余 {hiddenCount} 项
                      </button>
                    )}
                  </section>
                )}
              </>
            )}

            {tab === "chain" && (
              <section className="flex flex-col gap-3">
                <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                  事件响应链
                </div>
                <div className="flex flex-col rounded-[10px] border border-[var(--border-base)] p-4">
                  {event.traceSteps.map((step, i) => {
                    const last = i === event.traceSteps.length - 1;
                    const dotColor =
                      step.status === "error"
                        ? "bg-[var(--danger)]"
                        : step.status === "active"
                          ? "bg-[var(--amber-icon)]"
                          : "bg-[var(--ink-primary)]";
                    return (
                      <div key={step.id} className="flex gap-3">
                        <span className="w-[62px] shrink-0 pt-0.5 font-mono text-[11px] text-[var(--ink-muted)]">
                          {step.time}
                        </span>
                        <div className="flex w-4 shrink-0 flex-col items-center">
                          <span className={`mt-1.5 h-2 w-2 rounded-full ${dotColor}`} />
                          {!last && <span className="my-1 w-[1px] flex-1 bg-[var(--border-base)]" />}
                        </div>
                        <div className="flex flex-1 flex-col gap-0.5 pb-4">
                          <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                            {step.stage}
                          </span>
                          <span className="text-[12px] text-[var(--ink-muted)]">
                            {step.detail}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {tab === "logs" && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                    执行日志 ({event.logs.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const text = event.logs
                        .map((l) => `[${l.ts}] ${l.level}: ${l.message}`)
                        .join("\n");
                      navigator.clipboard?.writeText(text);
                      pushToast("已复制日志到剪贴板", "success");
                    }}
                    className="cursor-pointer rounded-[6px] border border-[var(--border-control)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                  >
                    复制日志
                  </button>
                </div>

                <div className="flex flex-col gap-1.5 rounded-[10px] bg-[var(--bg-code)] p-3.5 font-mono text-[11px] leading-[18px]">
                  {event.logs.map((line) => (
                    <div key={line.id} className="flex gap-2">
                      <span className="shrink-0 text-[var(--ink-subtle)]">{line.ts}</span>
                      <span
                        className={`w-[38px] shrink-0 font-semibold ${
                          line.level === "ERR"
                            ? "text-[var(--danger)]"
                            : line.level === "WARN"
                              ? "text-[var(--amber-text)]"
                              : "text-[var(--ink-primary)]"
                        }`}
                      >
                        {line.level}
                      </span>
                      <span className="break-all text-[var(--ink-secondary)]">{line.message}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Sticky Footer */}
          <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-light)] px-7 py-4">
            <UndoIcon size={14} className="shrink-0 text-[var(--ink-muted)]" />
            <span className="flex-1 text-[12px] text-[var(--ink-muted)]">
              {event.canRestore || event.actionItems.some((i) => i.sizeMB > 0)
                ? "移入废纸篓 · 7 天内可一键还原"
                : "所有敏感变更均受收件箱安全策略保护"}
            </span>

            {event.status === "pending_confirm" && (
              <>
                <button
                  type="button"
                  onClick={() => ignoreTimelineEvent(event.id)}
                  className="inline-flex h-[34px] cursor-pointer items-center rounded-[8px] border border-[var(--border-control)] px-3.5 text-[13px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                >
                  忽略
                </button>
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  onClick={() => executeTimelineEventActions(event.id)}
                  className={`inline-flex h-[34px] items-center rounded-[8px] bg-[var(--ink-primary)] px-3.5 text-[13px] font-semibold text-[var(--ink-on-primary)] ${
                    selectedCount === 0 ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                  }`}
                >
                  清理 {selectedSizeMB > 0 ? `${selectedSizeGB} GB` : `${selectedCount} 项`}
                </button>
              </>
            )}

            {event.status === "failed" && event.authFixPluginId && (
              <button
                type="button"
                onClick={() => {
                  if (event.authFixPluginId) fixPluginAuth(event.authFixPluginId);
                }}
                className="inline-flex h-[34px] cursor-pointer items-center rounded-[8px] bg-[var(--ink-primary)] px-4 text-[13px] font-semibold text-[var(--ink-on-primary)]"
              >
                重新授权并重试
              </button>
            )}

            {event.status === "completed" && event.canRestore && !event.restored && (
              <button
                type="button"
                onClick={() => restoreTimelineEvent(event.id)}
                className="inline-flex h-[34px] cursor-pointer items-center rounded-[8px] border border-[var(--border-control)] px-3.5 text-[13px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
              >
                一键还原
              </button>
            )}
          </div>
        </>
      )}
    </SlideOverDrawer>
  );
};
