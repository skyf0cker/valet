import React from "react";
import { useValet } from "../../store/ValetContext";
import { SidebarToggleButton } from "../Sidebar";

export interface WorkspaceHeaderMetric {
  value: React.ReactNode;
  label: string;
}

export interface WorkspacePageHeaderProps {
  compactTitle: string;
  topActions?: React.ReactNode;
  kicker: React.ReactNode;
  title: React.ReactNode;
  metrics?: WorkspaceHeaderMetric[];
  filterBar: React.ReactNode;
  filterBarClassName?: string;
  dimmed?: boolean;
}

/**
 * Shared sticky workspace header containing the draggable window top bar,
 * editorial serif hero, summary metrics, and view filter/tab bar.
 */
export const WorkspacePageHeader: React.FC<WorkspacePageHeaderProps> = ({
  compactTitle,
  topActions,
  kicker,
  title,
  metrics,
  filterBar,
  filterBarClassName,
  dimmed = false,
}) => {
  const { sidebarCollapsed } = useValet();

  return (
    <div className="z-10 flex shrink-0 flex-col bg-[var(--bg-canvas)]">
      {/* Top window drag bar */}
      <header
        className={`app-drag flex shrink-0 items-center justify-between gap-2 ${
          sidebarCollapsed
            ? "h-[44px] border-b border-[var(--border-subtle)] px-[22px]"
            : "h-[52px] px-7"
        }`}
      >
        <SidebarToggleButton title={sidebarCollapsed ? compactTitle : undefined} />
        {topActions}
      </header>

      {/* Hero + Filter / Tab Bar (M4 shifts left & dims when Detail Drawer opens) */}
      <div
        className={`flex flex-col transition-all duration-300 ease-[var(--ease-valet)] ${
          dimmed ? "-translate-x-4 opacity-55" : "translate-x-0 opacity-100"
        }`}
      >
        {/* Hero */}
        <div
          className={`flex flex-wrap items-end justify-between gap-4 ${
            sidebarCollapsed ? "px-6 pt-3" : "px-6 pt-1 lg:px-12"
          }`}
        >
          <div className="flex flex-col gap-1.5 lg:gap-2.5">
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ink-muted)] lg:text-[11px]">
              {kicker}
            </div>
            <h1
              className={`font-[family-name:var(--font-serif-zh)] font-normal tracking-[-0.01em] text-[var(--ink-strong)] ${
                sidebarCollapsed
                  ? "text-[24px] leading-[32px]"
                  : "text-[26px] leading-[34px] lg:text-[34px] lg:leading-[44px]"
              }`}
            >
              {title}
            </h1>
          </div>

          {metrics && metrics.length > 0 && (
            <div className="flex items-end gap-5 pb-0.5 lg:gap-7 lg:pb-1.5">
              {metrics.map((metric, idx) => (
                <div key={idx} className="flex flex-col items-end gap-0.5">
                  <div
                    className={`font-[family-name:var(--font-serif-en)] text-[var(--ink-strong)] ${
                      sidebarCollapsed
                        ? "text-[23px] leading-[25px]"
                        : "text-[24px] leading-[26px] lg:text-[30px] lg:leading-[32px]"
                    }`}
                  >
                    {metric.value}
                  </div>
                  <div className="text-[10px] leading-[13px] text-[var(--ink-muted)] lg:text-[11px]">
                    {metric.label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filter / Tab bar */}
        <div
          className={
            filterBarClassName ??
            `flex flex-wrap items-center gap-1.5 border-b border-[var(--border-light)] ${
              sidebarCollapsed
                ? "px-6 pt-3 pb-2.5"
                : "px-6 pt-4 pb-3 lg:px-12 lg:pt-5"
            }`
          }
        >
          {filterBar}
        </div>
      </div>
    </div>
  );
};
