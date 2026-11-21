import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenIcon,
  ChevronRightIcon,
  CloseIcon,
  DotRingSpinner,
  FileTextIcon,
  GlobeIcon,
  PlugIcon,
  SparklesIcon,
  TerminalIcon,
} from "../ui/Icons";
import {
  type StepCategory,
  type StepRowItem,
  buildLiveMilestones,
  classifyStepCategory,
  cleanStepDetail,
  cleanStepLabel,
  formatElapsedSeconds,
  formatWorkDuration,
  getDistinctCategories,
} from "./workTraceUtils";

export interface AgentWorkTraceProps {
  steps?: StepRowItem[];
  isStreaming?: boolean;
  phase?: "thinking" | "tools" | "streaming" | "done" | "error";
  startedAt?: number;
  workDurationMs?: number;
  hasPartialText?: boolean;
  thinkingText?: string;
  reasoningText?: string;
  hasPendingPermission?: boolean;
}

const CategoryIcon: React.FC<{
  category: StepCategory;
  size?: number;
  className?: string;
}> = ({ category, size = 14, className = "" }) => {
  switch (category) {
    case "web":
      return <GlobeIcon size={size} className={className} />;
    case "terminal":
      return <TerminalIcon size={size} className={className} />;
    case "file":
      return <FileTextIcon size={size} className={className} />;
    case "skill":
      return <BookOpenIcon size={size} className={className} />;
    case "plugin":
      return <PlugIcon size={size} className={className} />;
    case "system":
    default:
      return <SparklesIcon size={size} className={className} />;
  }
};

export const AgentWorkTrace: React.FC<AgentWorkTraceProps> = ({
  steps = [],
  isStreaming = false,
  startedAt,
  workDurationMs,
  hasPartialText = false,
  thinkingText,
  reasoningText,
  hasPendingPermission = false,
}) => {
  const fallbackStartRef = useRef<number>(Date.now());
  const effectiveStart =
    startedAt && startedAt > 0 ? startedAt : fallbackStartRef.current;

  const [elapsedSec, setElapsedSec] = useState<number>(() =>
    Math.max(1, Math.floor((Date.now() - effectiveStart) / 1000))
  );
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isStreaming) return;
    const update = () => {
      setElapsedSec(Math.max(1, Math.floor((Date.now() - effectiveStart) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [isStreaming, effectiveStart]);

  const milestones = useMemo(() => buildLiveMilestones(steps), [steps]);
  const completedMilestones = useMemo(
    () => milestones.filter((m) => m.status !== "running"),
    [milestones]
  );
  const runningMilestones = useMemo(
    () => milestones.filter((m) => m.status === "running"),
    [milestones]
  );
  const distinctCategories = useMemo(
    () => getDistinctCategories(steps),
    [steps]
  );

  const errorCount = useMemo(
    () => steps.filter((s) => s.status === "error").length,
    [steps]
  );
  const hasTraceContent = steps.length > 0 || Boolean(reasoningText?.trim());

  if (!isStreaming && !hasTraceContent) {
    return null;
  }

  const isAutoLiveBody = isStreaming && !hasPartialText;
  const showFullDetails = userExpanded === true && hasTraceContent;
  const showCompactLiveBody =
    isAutoLiveBody &&
    !showFullDetails &&
    (!hasPendingPermission || completedMilestones.length > 0);
  const showBody = showFullDetails || showCompactLiveBody;
  const isCollapsed = !showBody;

  let headerText: string;
  if (isStreaming) {
    const baseElapsed = `已工作 ${formatElapsedSeconds(elapsedSec)}`;
    headerText =
      isCollapsed && hasPartialText && steps.length > 0
        ? `${baseElapsed} · ${steps.length} 个步骤`
        : baseElapsed;
  } else if (workDurationMs && steps.length > 0) {
    headerText = `已工作 ${formatWorkDuration(workDurationMs)} · ${steps.length} 个步骤`;
  } else if (steps.length > 0) {
    headerText = `已完成 ${steps.length} 个步骤`;
  } else if (workDurationMs) {
    headerText = `已思考 ${formatWorkDuration(workDurationMs)}`;
  } else {
    headerText = "思考过程";
  }

  const idleStatusLabel =
    steps.length > 0
      ? "正在处理中"
      : thinkingText?.startsWith("等待你的")
        ? thinkingText
        : "正在思考中";

  const handleHeaderClick = () => {
    if (!hasTraceContent) return;
    setUserExpanded((prev) => {
      if (prev === null) {
        return true;
      }
      return !prev;
    });
  };

  return (
    <div className="w-full max-w-[620px]">
      <button
        type="button"
        onClick={handleHeaderClick}
        disabled={!hasTraceContent}
        className={`group inline-flex max-w-full items-center gap-2 rounded-[7px] py-0.5 pr-1.5 text-[12.5px] leading-[18px] text-[var(--ink-muted)] transition-colors ${
          hasTraceContent
            ? "cursor-pointer hover:text-[var(--ink-strong)]"
            : "cursor-default"
        }`}
      >
        <span className="tabular-nums">{headerText}</span>

        {isCollapsed && distinctCategories.length > 0 && (
          <span className="inline-flex items-center">
            {distinctCategories.map((cat) => (
              <span
                key={cat}
                className="-ml-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[var(--border-light)] bg-[var(--bg-subtle)] text-[var(--ink-muted)] first:ml-0"
              >
                <CategoryIcon category={cat} size={10.5} />
              </span>
            ))}
          </span>
        )}

        {errorCount > 0 && (
          <span className="text-[11px] text-[var(--danger)]/85 tabular-nums">
            · {errorCount} 项异常
          </span>
        )}

        {hasTraceContent && (
          <ChevronRightIcon
            size={12}
            className={`shrink-0 text-[var(--ink-subtle)] transition-transform duration-150 group-hover:text-[var(--ink-muted)] ${
              showFullDetails ? "rotate-90" : ""
            }`}
          />
        )}
      </button>

      {showBody && (
        <div className="mt-1">
          <div className="my-1.5 h-px w-full bg-[var(--border-light)]" />

          {showFullDetails ? (
            <div className="animate-valet-trace-in flex flex-col gap-3 py-1">
              {reasoningText?.trim() && (
                <div className="flex flex-col gap-1">
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                    思考摘要
                  </div>
                  <div className="max-h-[140px] overflow-y-auto whitespace-pre-wrap border-l border-[var(--border-control)] pl-3 text-[12px] leading-[19px] text-[var(--ink-muted)]">
                    {reasoningText.trim()}
                  </div>
                </div>
              )}

              {steps.length > 0 && (
                <div className="max-h-[300px] overflow-y-auto pr-1">
                  <div className="relative flex flex-col gap-1.5 pl-5 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-[var(--border-light)]">
                    {steps.map((step) => {
                      const cat = classifyStepCategory(step);
                      const isRunning =
                        step.status === "running" || step.status === "pending";
                      const isError = step.status === "error";
                      const label = cleanStepLabel(step);
                      const detail = cleanStepDetail(step.detail);
                      const detailExpanded = Boolean(expandedStepIds[step.id]);

                      return (
                        <div key={step.id} className="relative flex flex-col">
                          <span className="absolute -left-5 top-[2px] flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[var(--bg-canvas)]">
                            {isRunning ? (
                              <DotRingSpinner
                                size={13}
                                className="text-[var(--ink-secondary)]"
                              />
                            ) : isError ? (
                              <CloseIcon
                                size={11}
                                className="text-[var(--danger)]"
                              />
                            ) : (
                              <CategoryIcon
                                category={cat}
                                size={12}
                                className="text-[var(--ink-subtle)]"
                              />
                            )}
                          </span>

                          {detail ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedStepIds((prev) => ({
                                  ...prev,
                                  [step.id]: !prev[step.id],
                                }))
                              }
                              className="flex min-w-0 cursor-pointer items-baseline gap-2 rounded-[5px] py-0.5 text-left text-[12.5px] leading-[18px] transition-colors hover:bg-[var(--bg-subtle)]/60"
                            >
                              <span
                                className={`shrink-0 ${
                                  isRunning
                                    ? "valet-thinking-shimmer"
                                    : isError
                                      ? "text-[var(--danger)]"
                                      : "text-[var(--ink-secondary)]"
                                }`}
                              >
                                {label}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--ink-subtle)]">
                                {detail}
                              </span>
                            </button>
                          ) : (
                            <div className="flex min-w-0 items-baseline gap-2 py-0.5 text-[12.5px] leading-[18px]">
                              <span
                                className={`truncate ${
                                  isRunning
                                    ? "valet-thinking-shimmer"
                                    : isError
                                      ? "text-[var(--danger)]"
                                      : "text-[var(--ink-secondary)]"
                                }`}
                              >
                                {label}
                              </span>
                            </div>
                          )}

                          {detail && detailExpanded && (
                            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-[6px] bg-[var(--bg-code)]/80 px-2.5 py-1.5 font-mono text-[11px] leading-[16px] text-[var(--ink-muted)]">
                              {detail}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2 py-0.5">
              {completedMilestones.map((m) => (
                <div
                  key={m.id}
                  className="animate-valet-trace-in flex min-w-0 items-center gap-2.5 text-[13px] leading-[19px]"
                >
                  <CategoryIcon
                    category={m.category}
                    size={15}
                    className={`shrink-0 ${
                      m.status === "error"
                        ? "text-[var(--danger)]"
                        : "text-[var(--ink-subtle)]"
                    }`}
                  />
                  <span className="shrink-0 text-[var(--ink-secondary)]">
                    {m.title}
                  </span>
                  {m.countLabel && (
                    <span className="shrink-0 text-[12px] text-[var(--ink-subtle)] tabular-nums">
                      {m.countLabel}
                    </span>
                  )}
                  {m.subtitle && (
                    <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--ink-subtle)]">
                      {m.subtitle}
                    </span>
                  )}
                </div>
              ))}

              {!hasPendingPermission &&
                (runningMilestones.length > 0 ? (
                  runningMilestones.map((m) => (
                    <div
                      key={m.id}
                      className="flex min-w-0 items-center gap-2.5 text-[13px] leading-[19px]"
                    >
                      <DotRingSpinner
                        size={15}
                        className="shrink-0 text-[var(--ink-secondary)]"
                      />
                      <span className="valet-thinking-shimmer min-w-0 truncate text-[13px] font-normal">
                        {m.title}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex min-w-0 items-center gap-2.5 text-[13px] leading-[19px]">
                    <DotRingSpinner
                      size={15}
                      className="shrink-0 text-[var(--ink-secondary)]"
                    />
                    <span className="valet-thinking-shimmer truncate text-[13px] font-normal">
                      {idleStatusLabel}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
