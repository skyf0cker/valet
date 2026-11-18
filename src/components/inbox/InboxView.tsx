import React, { useEffect, useMemo, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type { AutonomyLevel, InboxCategory } from "../../types/valet";
import {
  getInboxQuestionOptions,
  isQuestionInboxItem,
  isReversibleTrashInboxItem,
} from "../../utils/inbox";
import { findLinkedTimelineEvent } from "../../utils/timelineLinks";
import { EventChip, PluginTag } from "../ui/Badge";
import { Checkbox } from "../ui/Checkbox";
import {
  ArrowUpRightIcon,
  ChatQuoteIcon,
  ClockIcon,
  DoubleCheckIcon,
  DriveIcon,
  MailIcon,
  PulseWaveIcon,
  SearchIcon,
  TrashIcon,
} from "../ui/Icons";
import { WorkspacePageHeader } from "../ui/WorkspacePageHeader";
import { InboxDetailDrawer } from "./InboxDetailDrawer";

type InboxFilter = "pending" | InboxCategory | "processed";

const AUTONOMY_NAMES: Record<AutonomyLevel, string> = {
  always_ask: "每个都询问",
  auto_review: "Auto Review",
  full_access: "Full Access",
};

export const InboxView: React.FC = () => {
  const {
    state,
    sidebarCollapsed,
    commandPaletteOpen,
    setCommandPaletteOpen,
    openSettingsSection,
    selectInboxItem,
    toggleInboxActionItem,
    approveInboxItem,
    answerInboxQuestion,
    dismissInboxItem,
    approveAllReversibleInboxItems,
    restoreApprovedInboxItem,
    quoteInboxItemToChat,
    openInboxItemInTimeline,
  } = useValet();

  const [filter, setFilter] = useState<InboxFilter>("pending");
  const [focusedIndex, setFocusedIndex] = useState(0);

  const pendingItems = useMemo(
    () => state.inboxItems.filter((i) => i.status === "pending"),
    [state.inboxItems]
  );

  const processedItems = useMemo(
    () => state.inboxItems.filter((i) => i.status !== "pending"),
    [state.inboxItems]
  );

  const reversiblePendingCount = useMemo(
    () => pendingItems.filter((i) => isReversibleTrashInboxItem(i)).length,
    [pendingItems]
  );

  const counts = useMemo(
    () => ({
      pending: pendingItems.length,
      files: pendingItems.filter((i) => i.category === "files").length,
      process: pendingItems.filter((i) => i.category === "process").length,
      outbound: pendingItems.filter((i) => i.category === "outbound").length,
      processed: state.inboxProcessedHistoryCount,
    }),
    [pendingItems, state.inboxProcessedHistoryCount]
  );

  const visibleItems = useMemo(() => {
    if (filter === "pending") return pendingItems;
    if (filter === "processed") return processedItems;
    return pendingItems.filter((i) => i.category === filter);
  }, [filter, pendingItems, processedItems]);

  // Keep focusedIndex in bounds
  useEffect(() => {
    setFocusedIndex((idx) =>
      visibleItems.length === 0 ? 0 : Math.min(idx, visibleItems.length - 1)
    );
  }, [visibleItems.length]);

  // Keyboard navigation: ↑/↓ focus, Enter approve, Backspace dismiss, Space inspect drawer, Q quote to chat
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (state.selectedInboxItemId || commandPaletteOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (visibleItems.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((idx) => (idx + 1) % visibleItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((idx) => (idx - 1 + visibleItems.length) % visibleItems.length);
      } else if (e.key === " ") {
        e.preventDefault();
        const focused = visibleItems[focusedIndex];
        if (focused) selectInboxItem(focused.id);
      } else if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === "q"
      ) {
        const focused = visibleItems[focusedIndex];
        if (focused) {
          e.preventDefault();
          quoteInboxItemToChat(focused.id);
        }
      } else if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === "t"
      ) {
        const focused = visibleItems[focusedIndex];
        if (focused) {
          e.preventDefault();
          openInboxItemInTimeline(focused.id);
        }
      } else if (e.key === "Enter") {
        const focused = visibleItems[focusedIndex];
        if (focused && focused.status === "pending") {
          e.preventDefault();
          if (isQuestionInboxItem(focused)) {
            const opts = getInboxQuestionOptions(focused);
            if (opts.length === 1) {
              answerInboxQuestion(focused.id, opts[0]!);
            } else {
              selectInboxItem(focused.id);
            }
          } else {
            approveInboxItem(focused.id);
          }
        }
      } else if (e.key === "Backspace") {
        const focused = visibleItems[focusedIndex];
        if (focused && focused.status === "pending") {
          e.preventDefault();
          dismissInboxItem(focused.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    answerInboxQuestion,
    approveInboxItem,
    commandPaletteOpen,
    dismissInboxItem,
    focusedIndex,
    openInboxItemInTimeline,
    quoteInboxItemToChat,
    selectInboxItem,
    state.selectedInboxItemId,
    visibleItems,
  ]);

  const filterChips: Array<{
    id: InboxFilter;
    label: string;
    compactLabel: string;
    count: number;
    dotClass?: string;
  }> = [
    { id: "pending", label: "待批准", compactLabel: "待批准", count: counts.pending },
    {
      id: "files",
      label: "文件与空间",
      compactLabel: "文件",
      count: counts.files,
      dotClass: "bg-[var(--amber-icon)]",
    },
    {
      id: "process",
      label: "进程与命令",
      compactLabel: "进程",
      count: counts.process,
      dotClass: "bg-[var(--duty-dot)]",
    },
    { id: "outbound", label: "外发动作", compactLabel: "外发", count: counts.outbound },
    { id: "processed", label: "已处理", compactLabel: "已处理", count: counts.processed },
  ];

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {/* Sticky Workspace Header */}
      <WorkspacePageHeader
        compactTitle="收件箱"
        dimmed={Boolean(state.selectedInboxItemId)}
        topActions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className={`app-no-drag flex cursor-pointer items-center gap-2 bg-[var(--bg-subtle)] text-left transition-colors hover:bg-[var(--bg-hover)] ${
                sidebarCollapsed
                  ? "h-[26px] w-[144px] rounded-[7px] px-[9px]"
                  : "h-[30px] w-[220px] rounded-[8px] px-2.5"
              }`}
            >
              <SearchIcon size={13} className="shrink-0 text-[var(--ink-subtle)]" />
              <span className="flex-1 truncate text-[11.5px] text-[var(--ink-subtle)]">
                {sidebarCollapsed ? "搜索事项" : "搜索待批事项、插件"}
              </span>
              <span className="font-mono text-[10px] text-[var(--ink-subtle)]">⌘K</span>
            </button>

            <button
              type="button"
              disabled={reversiblePendingCount === 0}
              onClick={approveAllReversibleInboxItems}
              className={`app-no-drag inline-flex items-center gap-1.5 border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-primary)] transition-colors ${
                sidebarCollapsed
                  ? "h-[26px] rounded-[7px] px-[9px] text-[11px] font-medium"
                  : "h-[30px] rounded-[8px] px-3 text-[12px] font-medium"
              } ${
                reversiblePendingCount === 0
                  ? "cursor-not-allowed opacity-40"
                  : "cursor-pointer hover:bg-[var(--bg-subtle)]"
              }`}
            >
              <DoubleCheckIcon size={13} className="shrink-0" />
              <span className="hidden sm:inline">
                {sidebarCollapsed ? "批准可撤销" : "批准可撤销项"} · {reversiblePendingCount}
              </span>
              <span className="sm:hidden">批可撤销 · {reversiblePendingCount}</span>
            </button>
          </div>
        }
        kicker={`INBOX · ${pendingItems.length} AWAITING APPROVAL`}
        title={
          pendingItems.length > 0 ? (
            <>
              有 {pendingItems.length} 件事，
              <span
                className={`font-[family-name:var(--font-serif-en)] font-normal italic ${
                  sidebarCollapsed ? "text-[29px]" : "text-[30px] lg:text-[40px]"
                }`}
              >
                Valet
              </span>{" "}
              想先问过你
            </>
          ) : (
            <>
              所有待批事项，
              <span
                className={`font-[family-name:var(--font-serif-en)] font-normal italic ${
                  sidebarCollapsed ? "text-[29px]" : "text-[30px] lg:text-[40px]"
                }`}
              >
                Valet
              </span>{" "}
              已按你指示处理
            </>
          )
        }
        metrics={[
          {
            value: (
              <>
                {reversiblePendingCount}
                <span className="font-sans text-[11px] text-[var(--ink-muted)] lg:text-[12px]">
                  {" "}
                  / {pendingItems.length}
                </span>
              </>
            ),
            label: "可安全撤销",
          },
          { value: counts.processed, label: "今日已处理" },
        ]}
        filterBarClassName={`flex flex-wrap items-center gap-1.5 border-b border-[var(--border-light)] ${
          sidebarCollapsed
            ? "px-6 pt-3 pb-2.5"
            : "px-6 pt-4 pb-3 lg:px-12 lg:pt-5"
        }`}
        filterBar={
          <>
            {filterChips.map((chip) => {
              const active = filter === chip.id;
              const mutedProcessed = chip.id === "processed" && !active;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => {
                    setFilter(chip.id);
                    setFocusedIndex(0);
                  }}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full transition-colors ${
                    sidebarCollapsed
                      ? "h-[25px] px-2.5 text-[11px]"
                      : "h-[28px] px-3 text-[12px]"
                  } ${
                    active
                      ? "bg-[var(--ink-primary)] font-medium text-[var(--ink-on-primary)]"
                      : `border border-[var(--border-control)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] ${
                          mutedProcessed ? "text-[var(--ink-muted)]" : "text-[var(--ink-strong)]"
                        }`
                  }`}
                >
                  {chip.dotClass && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        active ? "bg-[var(--ink-on-primary)]" : chip.dotClass
                      }`}
                    />
                  )}
                  <span>
                    {sidebarCollapsed ? chip.compactLabel : chip.label} {chip.count}
                  </span>
                </button>
              );
            })}

            <div className="flex-1" />

            <div className="hidden font-mono text-[10px] text-[var(--ink-subtle)] sm:block lg:text-[11px]">
              ⏎ 批准{"  "}·{"  "}⌫ 忽略
              {!sidebarCollapsed && <>{"  "}·{"  "}Space 详情{"  "}·{"  "}Q 引用{"  "}·{"  "}T 时间线</>}
            </div>
          </>
        }
      />

      {/* Scrollable Queue Body (M4 shifts left & dims when Detail Canvas opens) */}
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto pt-1 transition-all duration-300 ease-[var(--ease-valet)] ${
          sidebarCollapsed ? "px-6" : "px-6 lg:px-12"
        } ${
          state.selectedInboxItemId ? "-translate-x-4 opacity-55" : "translate-x-0 opacity-100"
        }`}
      >
        {visibleItems.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
            <div className="font-[family-name:var(--font-serif-zh)] text-[18px] text-[var(--ink-strong)]">
              {filter === "processed"
                ? "本次会话暂无可展示的已处理动作"
                : "当前分类下暂无待你批准的事项"}
            </div>
            <p className="text-[12px] text-[var(--ink-muted)]">
              当插件命中敏感策略（例如删除大文件、终止进程或外发消息）时，会自动汇集到这里。
            </p>
            {filter !== "pending" && (
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className="mt-2 h-[28px] cursor-pointer rounded-[7px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
              >
                回到待批准视图
              </button>
            )}
          </div>
        ) : (
          visibleItems.map((item, idx) => {
            const isFocused = focusedIndex === idx && !state.selectedInboxItemId;
            const isSelected = state.selectedInboxItemId === item.id;
            const linkedTimelineEvent = findLinkedTimelineEvent(item, state.timelineEvents);
            const isQuestion = isQuestionInboxItem(item);
            const questionOptions = isQuestion ? getInboxQuestionOptions(item) : [];
            const isTrashReversible = isReversibleTrashInboxItem(item);
            const checkedCount = item.actionItems.filter((a) => a.checked).length;
            const totalCount = item.actionItems.length;
            const previewItems = item.actionItems.slice(0, sidebarCollapsed ? 2 : 3);

            const renderCategoryIcon = () => {
              if (item.iconKind === "trash") {
                return (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-[var(--amber-pill)] bg-[var(--amber-bg)] text-[var(--amber-icon)]">
                    <TrashIcon size={14} />
                  </div>
                );
              }
              return (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--bg-subtle)] text-[var(--ink-primary)]">
                  {item.iconKind === "disk" && <DriveIcon size={14} />}
                  {item.iconKind === "pulse" && <PulseWaveIcon size={14} />}
                  {item.iconKind === "mail" && <MailIcon size={14} />}
                </div>
              );
            };

            return (
              <div
                key={item.id}
                onClick={() => {
                  setFocusedIndex(idx);
                  selectInboxItem(item.id);
                }}
                className={`flex cursor-pointer transition-colors ${
                  idx > 0 ? "border-t border-[var(--border-light)]" : ""
                } ${
                  sidebarCollapsed ? "py-[11px]" : "py-[14px]"
                } ${
                  isSelected
                    ? "rounded-[10px] bg-[var(--bg-muted)] px-2 -mx-2"
                    : isFocused
                      ? "rounded-[10px] bg-[var(--bg-card-hover)]/75 px-2 -mx-2"
                      : "hover:rounded-[10px] hover:bg-[var(--bg-card-hover)]/60 hover:px-2 hover:-mx-2"
                }`}
              >
                {/* Desktop time column */}
                {!sidebarCollapsed && (
                  <div className="hidden w-[64px] shrink-0 flex-col gap-0.5 pt-0.5 lg:flex">
                    <span
                      className={`font-mono text-[12px] leading-[16px] ${
                        item.ageLabel
                          ? "text-[var(--ink-primary)]"
                          : "text-[var(--ink-muted)]"
                      }`}
                    >
                      {item.timeLabel}
                    </span>
                    {item.ageLabel && (
                      <span className="font-mono text-[10px] leading-[12px] text-[var(--amber-text)]">
                        {item.ageLabel}
                      </span>
                    )}
                  </div>
                )}

                {/* Category Icon */}
                <div className="flex w-[32px] shrink-0 items-start pt-0.5">
                  {renderCategoryIcon()}
                </div>

                {/* Main Body */}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 pl-2.5 pr-3 lg:gap-2 lg:pl-3.5 lg:pr-5">
                  <div className="flex flex-wrap items-center gap-1.5 lg:gap-2">
                    <span
                      className={`font-[460] text-[var(--ink-strong)] ${
                        sidebarCollapsed
                          ? "text-[13.5px] leading-[19px]"
                          : "text-[14px] leading-[20px] lg:text-[15px]"
                      }`}
                    >
                      {item.title}
                    </span>

                    <PluginTag label={item.pluginBadge} />

                    {!sidebarCollapsed && (
                      <span className="hidden lg:inline-flex">
                        <EventChip code={item.eventCode} />
                      </span>
                    )}

                    {item.warningTag && (
                      <span className="inline-flex h-[18px] shrink-0 items-center rounded-full border border-[var(--amber-pill)] px-[6px] text-[9.5px] font-medium text-[var(--amber-text)] lg:h-[20px] lg:px-[7px] lg:text-[10px]">
                        {item.warningTag}
                      </span>
                    )}

                    {linkedTimelineEvent && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openInboxItemInTimeline(item.id);
                        }}
                        title={`在时间线中查看：${linkedTimelineEvent.title} (${linkedTimelineEvent.timeLabel})`}
                        aria-label={`跳转到关联时间线事件：${linkedTimelineEvent.title}`}
                        className="inline-flex h-[20px] shrink-0 cursor-pointer items-center gap-1 rounded-[5px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-[6px] text-[10.5px] font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                      >
                        <ClockIcon size={10.5} className="shrink-0 text-[var(--ink-muted)]" />
                        <span>{sidebarCollapsed ? "时间线" : "关联时间线"}</span>
                        <ArrowUpRightIcon size={10} className="shrink-0 text-[var(--ink-muted)]" />
                      </button>
                    )}

                    {(sidebarCollapsed || !item.warningTag) && item.ageLabel && (
                      <span
                        className={`font-mono text-[10px] text-[var(--amber-text)] ${
                          sidebarCollapsed ? "inline" : "lg:hidden"
                        }`}
                      >
                        {item.timeLabel} · {item.ageLabel.replace(" 前", "")}
                      </span>
                    )}
                  </div>

                  <p
                    className={`text-[var(--ink-secondary)] ${
                      sidebarCollapsed
                        ? "text-[12px] leading-[17px]"
                        : "text-[12.5px] leading-[18px] lg:text-[13px] lg:leading-[19px]"
                    }`}
                  >
                    {item.summary}
                  </p>

                  {isQuestion && questionOptions.length > 0 && item.status === "pending" && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 flex flex-wrap gap-1.5"
                    >
                      {questionOptions.map((opt, optIdx) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => answerInboxQuestion(item.id, opt)}
                          className={`inline-flex cursor-pointer items-center rounded-[7px] border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                            optIdx === 0
                              ? "border-[var(--ink-primary)] bg-[var(--ink-primary)]/5 text-[var(--ink-strong)] hover:bg-[var(--ink-primary)]/10"
                              : "border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--ink-strong)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Inline Checklist Preview (e.g. Docker 12 remnants) */}
                  {item.actionItems.length > 2 && item.status === "pending" && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 flex flex-col gap-1 rounded-[9px] border border-[var(--amber-border)] bg-[var(--amber-bg)] px-3 py-2 lg:gap-1.5 lg:px-3.5 lg:py-2.5"
                    >
                      {previewItems.map((act) => (
                        <div
                          key={act.id}
                          onClick={() => toggleInboxActionItem(item.id, act.id)}
                          className="flex h-[20px] cursor-pointer items-center gap-2 lg:h-[22px] lg:gap-2.5"
                        >
                          <Checkbox
                            checked={act.checked}
                            onChange={() => toggleInboxActionItem(item.id, act.id)}
                          />
                          <span
                            className={`min-w-0 flex-1 truncate font-mono text-[10.5px] lg:text-[11px] ${
                              act.checked
                                ? "text-[var(--ink-strong)]"
                                : "text-[var(--ink-subtle)]"
                            }`}
                          >
                            {act.label}
                            {act.keepNote && (
                              <span className="font-sans text-[10.5px] text-[var(--ink-subtle)]">
                                {" "}
                                {act.keepNote}
                              </span>
                            )}
                          </span>
                          <span className="w-[54px] shrink-0 text-right font-mono text-[10.5px] text-[var(--ink-muted)] lg:w-[64px] lg:text-[11px]">
                            {act.sizeLabel}
                          </span>
                        </div>
                      ))}

                      <div className="flex items-center justify-between border-t border-[var(--amber-divider)] pt-1.5">
                        <span className="text-[10.5px] text-[var(--ink-muted)] lg:text-[11px]">
                          已选 {checkedCount} / {totalCount} 项 ·{" "}
                          {sidebarCollapsed
                            ? "7 天内可还原"
                            : "移入废纸篓 7 天内可还原"}
                        </span>
                        <button
                          type="button"
                          onClick={() => selectInboxItem(item.id)}
                          className="cursor-pointer text-[10.5px] font-medium text-[var(--ink-strong)] hover:underline lg:text-[11px]"
                        >
                          {sidebarCollapsed ? "清单 →" : "查看完整清单 →"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Action Buttons */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex shrink-0 items-start justify-end gap-1.5 pt-0.5 lg:gap-2"
                >
                  <button
                    type="button"
                    onClick={() => quoteInboxItemToChat(item.id)}
                    title="引用到对话 (Q)"
                    aria-label={`引用「${item.title}」到对话`}
                    className={`inline-flex cursor-pointer items-center gap-1 rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)] ${
                      sidebarCollapsed
                        ? "h-[26px] px-2 text-[11px]"
                        : "h-[28px] px-2.5 text-[12px]"
                    }`}
                  >
                    <ChatQuoteIcon size={sidebarCollapsed ? 11.5 : 12.5} className="shrink-0 text-[var(--ink-muted)]" />
                    <span>引用</span>
                  </button>

                  {item.status === "pending" ? (
                    isQuestion ? (
                      <>
                        <button
                          type="button"
                          onClick={() => dismissInboxItem(item.id)}
                          className={`inline-flex cursor-pointer items-center rounded-[7px] border border-[var(--border-strong)] bg-[var(--bg-surface)] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)] ${
                            sidebarCollapsed
                              ? "h-[26px] px-2.5 text-[11px]"
                              : "h-[28px] px-3 text-[12px]"
                          }`}
                        >
                          {item.dismissLabel || "忽略"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (questionOptions.length === 1) {
                              answerInboxQuestion(item.id, questionOptions[0]!);
                            } else {
                              selectInboxItem(item.id);
                            }
                          }}
                          className={`inline-flex cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] font-semibold text-[var(--ink-on-primary)] transition-opacity hover:opacity-90 ${
                            sidebarCollapsed
                              ? "h-[26px] px-2.5 text-[11px]"
                              : "h-[28px] px-3 text-[12px]"
                          }`}
                        >
                          {questionOptions.length === 1 ? questionOptions[0] : "选择方案"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => dismissInboxItem(item.id)}
                          className={`inline-flex cursor-pointer items-center rounded-[7px] border border-[var(--border-strong)] bg-[var(--bg-surface)] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)] ${
                            sidebarCollapsed
                              ? "h-[26px] px-2.5 text-[11px]"
                              : "h-[28px] px-3 text-[12px]"
                          }`}
                        >
                          {item.dismissLabel}
                        </button>
                        <button
                          type="button"
                          onClick={() => approveInboxItem(item.id)}
                          className={`inline-flex cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] font-semibold text-[var(--ink-on-primary)] transition-opacity hover:opacity-90 ${
                            sidebarCollapsed
                              ? "h-[26px] px-2.5 text-[11px]"
                              : "h-[28px] px-3 text-[12px]"
                          }`}
                        >
                          {item.approveLabel}
                        </button>
                      </>
                    )
                  ) : (
                    <div className="flex items-center gap-2">
                      {item.status === "approved" && isTrashReversible && !item.restored && (
                        <button
                          type="button"
                          onClick={() => restoreApprovedInboxItem(item.id)}
                          className="inline-flex h-[26px] cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                        >
                          一键还原
                        </button>
                      )}
                      <span className="font-mono text-[11px] text-[var(--ink-muted)]">
                        {item.restored
                          ? "已还原"
                          : item.status === "approved"
                            ? `${isQuestion ? "已回复" : "已批准"}${item.processedAt ? ` · ${item.processedAt}` : ""}`
                            : `已忽略${item.processedAt ? ` · ${item.processedAt}` : ""}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Sticky POLICY Bar */}
      <div
        className={`flex shrink-0 items-center gap-3 bg-[var(--bg-canvas)] pt-2.5 pb-3.5 transition-all duration-300 ease-[var(--ease-valet)] ${
          sidebarCollapsed ? "px-6" : "px-6 lg:px-12"
        } ${
          state.selectedInboxItemId ? "-translate-x-4 opacity-55" : "translate-x-0 opacity-100"
        }`}
      >
        <span className="w-[56px] shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--ink-subtle)] lg:w-[64px] lg:text-[10px]">
          POLICY
        </span>
        <div className="h-[1px] flex-1 bg-[var(--border-light)]" />
        <div className="shrink-0 text-[11px] text-[var(--ink-muted)] lg:text-[12px]">
          今日已处理 {counts.processed} 项 ·{" "}
          <span className="hidden sm:inline">当前安全级别：</span>
          <button
            type="button"
            onClick={() => openSettingsSection("safety")}
            className="cursor-pointer font-medium text-[var(--ink-strong)] hover:underline"
          >
            {AUTONOMY_NAMES[state.preferences.autonomyLevel]} →
          </button>
        </div>
      </div>

      {/* M4 Detail Canvas Drawer */}
      <InboxDetailDrawer />
    </div>
  );
};
