import React from "react";

interface SettingsSectionCardProps {
  id?: string;
  num?: string;
  title?: string;
  subtitle?: string;
  badge?: string;
  critical?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  noHeader?: boolean;
}

export const SettingsSectionCard: React.FC<SettingsSectionCardProps> = ({
  id,
  num,
  title,
  subtitle,
  badge,
  critical = false,
  headerRight,
  children,
  noHeader = false,
}) => (
  <section
    id={id}
    className={`flex flex-col overflow-hidden rounded-[12px] bg-[var(--bg-surface)] ${
      critical
        ? "border-[1.5px] border-[var(--ink-primary)]"
        : "border border-[var(--border-card)]"
    }`}
  >
    {!noHeader && title && (
      <div className="flex items-end gap-2.5 px-[18px] pt-[16px] pb-3">
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-baseline gap-2.5">
            {num && (
              <span className="font-mono text-[11px] leading-[14px] text-[var(--ink-faint)]">
                {num}
              </span>
            )}
            <h2 className="font-[family-name:var(--font-serif-zh)] text-[18px] font-semibold leading-[24px] text-[var(--ink-strong)]">
              {title}
            </h2>
            {badge && (
              <span className="self-center rounded-[4px] bg-[var(--ink-primary)] px-1.5 py-[2px] font-mono text-[9px] tracking-[0.12em] text-[var(--ink-on-primary)]">
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-[12px] leading-[16px] text-[var(--ink-muted)]">{subtitle}</p>
          )}
        </div>
        {headerRight}
      </div>
    )}
    {children}
  </section>
);

export const SettingGroupHeader: React.FC<{
  title: string;
  source?: string;
  rightAction?: React.ReactNode;
}> = ({ title, source, rightAction }) => (
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
        {title}
      </span>
      {source && (
        <span className="text-[11px] text-[var(--ink-subtle)]">→ {source}</span>
      )}
    </div>
    {rightAction}
  </div>
);

export const SettingRow: React.FC<{
  label: string;
  description?: string;
  tinted?: boolean;
  first?: boolean;
  children: React.ReactNode;
}> = ({ label, description, tinted = false, first = false, children }) => (
  <div
    className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
      first ? "" : "border-t border-[var(--border-light)]"
    } ${tinted ? "bg-[var(--bg-card-hover)]" : ""}`}
  >
    <div className="flex min-w-[140px] flex-1 flex-col gap-0.5">
      <span className="text-[13px] font-medium leading-[16px] text-[var(--ink-strong)]">
        {label}
      </span>
      {description && (
        <span className="text-[11px] leading-[14px] text-[var(--ink-subtle)]">
          {description}
        </span>
      )}
    </div>
    <div className="flex shrink-0 items-center gap-2">{children}</div>
  </div>
);
