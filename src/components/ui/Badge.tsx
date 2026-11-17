import React from "react";
import type { TimelineStatus } from "../../types/valet";

export const PluginTag: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex h-[20px] shrink-0 items-center rounded-[5px] border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-[7px] text-[11px] font-normal leading-[14px] text-[var(--ink-secondary)]">
    {label}
  </span>
);

export const EventChip: React.FC<{ code: string; dashed?: boolean }> = ({
  code,
  dashed = true,
}) => (
  <span
    className={`inline-flex h-[20px] shrink-0 items-center rounded-[5px] px-[7px] font-mono text-[10px] leading-[12px] ${
      dashed
        ? "border border-dashed border-[var(--border-strong)] text-[var(--ink-muted)]"
        : "bg-[var(--bg-muted)] text-[var(--ink-strong)]"
    }`}
  >
    {code}
  </span>
);

export const StatusPill: React.FC<{
  status: TimelineStatus;
  pendingLabel?: string;
}> = ({ status, pendingLabel = "待确认" }) => {
  if (status === "running") {
    return (
      <span className="inline-flex h-[24px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--ink-primary)] px-[9px] text-[11px] font-medium text-[var(--ink-on-primary)]">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          className="animate-valet-spin shrink-0"
          aria-hidden="true"
        >
          <path d="M12 3a9 9 0 109 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span>进行中</span>
      </span>
    );
  }
  if (status === "pending_confirm") {
    return (
      <span className="inline-flex h-[24px] shrink-0 items-center rounded-full border border-[var(--amber-pill)] px-[9px] text-[11px] font-medium text-[var(--amber-text)]">
        {pendingLabel}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex h-[24px] shrink-0 items-center rounded-full border border-[var(--danger-border)] bg-[var(--danger-bg)] px-[9px] text-[11px] font-medium text-[var(--danger)]">
        失败
      </span>
    );
  }
  return (
    <span className="inline-flex h-[24px] shrink-0 items-center rounded-full border border-[var(--border-control)] px-[9px] text-[11px] font-medium text-[var(--ink-muted)]">
      已完成
    </span>
  );
};

export const Kbd: React.FC<{ keys: string[]; dark?: boolean }> = ({ keys, dark = false }) => (
  <span className="inline-flex items-center gap-[3px]">
    {keys.map((key) => (
      <kbd
        key={key}
        className={`inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-[5px] px-[7px] font-mono text-[11px] leading-[14px] ${
          dark
            ? "border border-white/30 text-white"
            : "border border-[var(--border-strong)] border-b-2 bg-[var(--bg-canvas)] text-[var(--ink-strong)]"
        }`}
      >
        {key}
      </kbd>
    ))}
  </span>
);
