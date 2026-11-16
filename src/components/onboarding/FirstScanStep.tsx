import React, { useEffect, useRef } from "react";
import { useValet } from "../../store/ValetContext";
import { CheckIcon } from "../ui/Icons";

export const FirstScanStep: React.FC = () => {
  const { state, runFirstScan, completeOnboarding, setOnboardingStep } = useValet();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      runFirstScan();
    }
  }, [runFirstScan]);

  const { scan } = state;
  const formattedTime = `00:${String(scan.elapsedSec).padStart(2, "0")}`;

  return (
    <div className="flex h-full flex-col px-16 pt-12 pb-9 lg:px-20">
      <div className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        Step 05 / 05 — 首次体检
      </div>

      <div className="mt-3.5 flex items-baseline justify-between gap-4">
        <h2 className="font-[family-name:var(--font-serif-zh)] text-[38px] font-medium leading-[50px] tracking-[-0.01em] text-[var(--ink-strong)]">
          先让我熟悉一下这台 Mac
        </h2>
        {scan.status === "done" && (
          <button
            type="button"
            onClick={runFirstScan}
            className="cursor-pointer font-mono text-[11px] text-[var(--ink-muted)] underline underline-offset-4 hover:text-[var(--ink-strong)]"
          >
            重新扫描
          </button>
        )}
      </div>

      <div className="mt-9 flex flex-1 items-center gap-14">
        {/* Left concentric radar gauge */}
        <div className="relative flex h-[280px] w-[280px] shrink-0 items-center justify-center rounded-full border border-[var(--border-base)]">
          <div className="absolute inset-[30px] rounded-full border border-[var(--border-control)]" />
          <div className="absolute inset-[60px] rounded-full border border-[var(--border-strong)]" />

          {/* Sweeping radar gradient while running */}
          <div
            className={`absolute inset-0 rounded-full ${
              scan.status === "running" ? "animate-valet-spin" : ""
            }`}
            style={{
              backgroundImage:
                "conic-gradient(from 300deg at 50% 50%, rgba(10,10,10,0) 0%, rgba(10,10,10,0) 50%, rgba(10,10,10,0.08) 100%)",
            }}
          />

          {/* Progress ring */}
          <svg
            width="282"
            height="282"
            viewBox="0 0 282 282"
            className="pointer-events-none absolute -inset-[1px] -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="141"
              cy="141"
              r="140"
              fill="none"
              stroke="var(--ink-primary)"
              strokeWidth="2"
              strokeDasharray={2 * Math.PI * 140}
              strokeDashoffset={
                2 * Math.PI * 140 * (1 - Math.min(100, scan.progressPct) / 100)
              }
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-500 ease-[var(--ease-valet)]"
            />
          </svg>

          <div className="relative flex flex-col items-center gap-[2px]">
            <div className="font-[family-name:var(--font-serif-en)] text-[64px] leading-[64px] tracking-[-0.02em] text-[var(--ink-strong)]">
              {scan.reclaimableGB.toFixed(1)}
              <span className="text-[24px] tracking-[-0.02em]"> GB</span>
            </div>
            <div className="text-[12px] leading-[16px] text-[var(--ink-muted)]">
              可安全释放
            </div>
            <div className="pt-2 font-mono text-[10px] leading-[12px] text-[var(--ink-subtle)]">
              {scan.progressPct}% · {formattedTime}
            </div>
          </div>
        </div>

        {/* Right task checklist */}
        <div className="flex flex-1 flex-col">
          {scan.tasks.map((task, idx) => {
            const isLast = idx === scan.tasks.length - 1;
            const isSkipped = task.status === "skipped";
            return (
              <div
                key={task.id}
                className={`flex items-center gap-3.5 py-4 ${
                  !isLast ? "border-b border-[var(--border-subtle)]" : ""
                } ${isSkipped ? "opacity-45" : ""}`}
              >
                {task.status === "done" && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[var(--ink-on-primary)]">
                    <CheckIcon size={10} strokeWidth={3.5} />
                  </span>
                )}
                {task.status === "running" && (
                  <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--border-control)] border-t-[var(--ink-primary)]" />
                )}
                {task.status === "pending" && (
                  <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-[var(--border-strong)]" />
                )}
                {task.status === "skipped" && (
                  <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-dashed border-[var(--ink-faint)]" />
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <div className="text-[14px] font-semibold leading-[18px] text-[var(--ink-strong)]">
                    {task.title}
                  </div>
                  <div className="truncate text-[12px] leading-[16px] text-[var(--ink-muted)]">
                    {task.detail}
                  </div>
                </div>

                {task.status === "done" && task.sizeLabel !== "—" ? (
                  <div className="shrink-0 font-[family-name:var(--font-serif-en)] text-[22px] leading-[28px] text-[var(--ink-strong)]">
                    {task.sizeLabel}
                  </div>
                ) : (
                  <div className="shrink-0 font-mono text-[11px] leading-[14px] text-[var(--ink-subtle)]">
                    {task.sizeLabel}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border-base)] pt-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOnboardingStep(4)}
            className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] px-3 text-[13px] font-medium text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
          >
            上一步
          </button>
          <span className="text-[13px] text-[var(--ink-muted)]">
            体检只读取，不会删除任何文件。
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={completeOnboarding}
            className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] border border-[var(--border-control)] px-4 text-[14px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
          >
            稍后再看
          </button>
          <button
            type="button"
            onClick={completeOnboarding}
            className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] bg-[var(--ink-primary)] px-5 text-[14px] font-semibold text-[var(--ink-on-primary)]"
          >
            查看结果并进入 Valet
          </button>
        </div>
      </div>
    </div>
  );
};
