import React from "react";
import type { TimelineEvent } from "../../types/valet";
import { EventChip, PluginTag, StatusPill } from "../ui/Badge";
import { CheckIcon, CloseIcon, WarningTriangleIcon } from "../ui/Icons";

interface TimelineRowProps {
  event: TimelineEvent;
  isFirst: boolean;
  isLast: boolean;
  isSelected: boolean;
  index: number;
  compact?: boolean;
  onOpenDetail: () => void;
  onExecutePending: () => void;
  onFixAuth: (pluginId: string) => void;
  onRestore: () => void;
}

export const TimelineRow: React.FC<TimelineRowProps> = ({
  event,
  isFirst,
  isLast,
  isSelected,
  index,
  compact = false,
  onOpenDetail,
  onExecutePending,
  onFixAuth,
  onRestore,
}) => {
  const staggerDelay = Math.min(index, 6) * 40;

  return (
    <div
      onClick={onOpenDetail}
      style={{ animationDelay: `${staggerDelay}ms` }}
      className={`animate-valet-timeline-in group flex cursor-pointer rounded-[10px] transition-colors ${
        isSelected
          ? "bg-[var(--bg-muted)] shadow-[inset_3px_0_0_var(--ink-primary)]"
          : "hover:bg-[var(--bg-card-hover)]"
      }`}
    >
      {/* 1. Time lane */}
      <div
        className={`shrink-0 pt-4 pl-1.5 ${
          compact ? "w-[44px]" : "w-[48px] lg:w-[64px] lg:pt-5 lg:pl-2"
        }`}
      >
        <span
          className={`font-mono leading-[14px] lg:text-[12px] lg:leading-[16px] ${
            compact ? "text-[11px]" : "text-[11px] lg:text-[12px]"
          } ${
            event.status === "running" || event.status === "pending_confirm"
              ? "text-[var(--ink-primary)]"
              : "text-[var(--ink-muted)]"
          }`}
        >
          {event.timeLabel}
        </span>
      </div>

      {/* 2. Node + vertical spine lane */}
      <div
        className={`flex shrink-0 flex-col items-center ${
          compact ? "w-[22px]" : "w-[24px] lg:w-[28px]"
        }`}
      >
        <div
          className={`shrink-0 ${isFirst ? "h-[17px]" : "h-[20px]"} w-[1px] ${
            isFirst ? "bg-transparent" : "bg-[var(--border-control)]"
          }`}
        />

        {event.status === "running" && (
          <div className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)]/10">
            <span className="animate-valet-pulse absolute h-2.5 w-2.5 rounded-full border border-[var(--ink-primary)]/40" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--ink-primary)]" />
          </div>
        )}

        {event.status === "pending_confirm" && (
          <div className="h-3 w-3 shrink-0 rounded-full border-2 border-[var(--amber-icon)] bg-[var(--bg-canvas)]" />
        )}

        {event.status === "completed" && (
          <div className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[var(--ink-on-primary)]">
            <CheckIcon size={8} strokeWidth={4} />
          </div>
        )}

        {event.status === "failed" && (
          <div className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-[var(--danger)] text-white">
            <CloseIcon size={8} />
          </div>
        )}

        <div
          className="w-[1px] flex-1"
          style={{
            background: isLast
              ? "linear-gradient(180deg, var(--border-control) 0%, transparent 100%)"
              : "var(--border-control)",
          }}
        />
      </div>

      {/* 3. Main content column */}
      <div
        className={`flex min-w-0 flex-1 flex-col gap-1.5 py-3 lg:gap-2 lg:py-4 ${
          compact ? "pl-2.5" : "pl-3 lg:pl-4"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`font-semibold leading-[18px] text-[var(--ink-strong)] ${
              compact ? "text-[13.5px]" : "text-[14px] lg:text-[15px]"
            }`}
          >
            {event.title}
          </span>
          <PluginTag label={event.pluginBadge} />
          {!compact && (event.status === "running" || event.eventCode === "log.crash_loop") && (
            <span className="hidden lg:inline-flex">
              <EventChip code={event.eventCode} />
            </span>
          )}
        </div>

        {/* Summary text */}
        {event.status !== "pending_confirm" && (
          <div className="text-[13px] leading-[20px] text-[var(--ink-secondary)]">
            {event.summary}
            {event.status === "failed" && event.authFixPluginId && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (event.authFixPluginId) onFixAuth(event.authFixPluginId);
                  }}
                  className="cursor-pointer font-medium text-[var(--ink-primary)] underline underline-offset-2 hover:opacity-75"
                >
                  重新授权
                </button>
              </>
            )}
            {event.canRestore && !event.restored && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore();
                  }}
                  className="cursor-pointer font-medium text-[var(--ink-primary)] underline underline-offset-2 hover:opacity-75"
                >
                  一键还原
                </button>
              </>
            )}
          </div>
        )}

        {/* Running progress bar */}
        {event.status === "running" && event.progress && (
          <div className="flex flex-wrap items-center gap-2.5 pt-0.5 lg:gap-3">
            <div
              className={`h-1 shrink-0 overflow-hidden rounded-[2px] bg-[var(--bg-track)] ${
                compact ? "w-[160px]" : "w-[180px] lg:w-[260px]"
              }`}
            >
              <div
                className="h-full rounded-[2px] transition-all duration-500"
                style={{
                  width: `${event.progress.pct}%`,
                  backgroundImage:
                    "linear-gradient(90deg, var(--ink-primary) 0%, var(--ink-primary) 70%, var(--ink-muted) 85%, var(--ink-primary) 100%)",
                }}
              />
            </div>
            <span className="font-mono text-[10.5px] text-[var(--ink-secondary)] lg:text-[11px]">
              {event.progress.currentLabel}
            </span>
            {!compact && (
              <span className="hidden truncate font-mono text-[11px] text-[var(--ink-subtle)] lg:inline">
                → {event.progress.targetPath}
              </span>
            )}
          </div>
        )}

        {/* Pending confirmation amber action bar */}
        {event.status === "pending_confirm" && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-wrap items-center gap-3.5 rounded-[10px] border border-[var(--amber-border)] bg-[var(--amber-bg)] px-3.5 py-3"
          >
            <WarningTriangleIcon size={16} className="shrink-0 text-[var(--amber-icon)]" />
            <span className="min-w-[180px] flex-1 text-[13px] leading-[19px] text-[var(--ink-secondary)]">
              {event.confirmBannerText ?? event.summary}
            </span>
            <button
              type="button"
              onClick={onOpenDetail}
              className="inline-flex h-[28px] shrink-0 cursor-pointer items-center rounded-[7px] border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
            >
              查看清单
            </button>
            <button
              type="button"
              onClick={onExecutePending}
              className="inline-flex h-[28px] shrink-0 cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-3 text-[12px] font-semibold text-[var(--ink-on-primary)]"
            >
              清理残留
            </button>
          </div>
        )}
      </div>

      {/* 4. Right status / action lane */}
      <div
        className={`flex shrink-0 items-start justify-end pt-3.5 pr-2 lg:pt-[18px] lg:pr-3 ${
          compact ? "w-[76px]" : "w-[82px] lg:w-[108px]"
        }`}
      >
        {event.status === "running" || event.status === "pending_confirm" ? (
          <StatusPill status={event.status} />
        ) : (
          <span
            className={`text-[11px] font-medium text-[var(--ink-primary)] transition-opacity lg:text-[12px] ${
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {compact ? "详情 →" : "查看详情 →"}
          </span>
        )}
      </div>
    </div>
  );
};
