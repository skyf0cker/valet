import React from "react";
import { useValet } from "../../store/ValetContext";
import type { OnboardingStepId } from "../../types/valet";
import { CheckIcon } from "../ui/Icons";
import { ValetLogo } from "../ui/ValetLogo";
import { WindowChrome } from "../ui/WindowChrome";
import { AgentConfigStep } from "./AgentConfigStep";
import { FirstScanStep } from "./FirstScanStep";
import { PermissionsStep } from "./PermissionsStep";
import { PluginSelectStep } from "./PluginSelectStep";
import { WelcomeStep } from "./WelcomeStep";

const STEPS: Array<{ id: OnboardingStepId; label: string }> = [
  { id: 1, label: "欢迎" },
  { id: 2, label: "系统权限" },
  { id: 3, label: "选择插件" },
  { id: 4, label: "Agent 配置" },
  { id: 5, label: "首次体检" },
];

export const OnboardingFlow: React.FC = () => {
  const { state, nodTick, setOnboardingStep } = useValet();
  const currentStep = state.onboardingStep;

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--bg-canvas)]">
      {/* Left 340px step rail */}
      <aside className="flex h-full w-[340px] shrink-0 flex-col border-r border-[var(--border-base)] bg-[var(--bg-sidebar)] px-7 pt-5 pb-7">
        <WindowChrome />

        <div className="pt-11">
          <ValetLogo size="lg" nodTick={nodTick} />
        </div>

        <nav className="flex flex-col gap-1 pt-14" aria-label="设置向导步骤">
          {STEPS.map((step) => {
            const done = step.id < currentStep;
            const active = step.id === currentStep;
            const clickable = done || active;

            return (
              <button
                key={step.id}
                type="button"
                disabled={!clickable}
                onClick={() => {
                  if (clickable) setOnboardingStep(step.id);
                }}
                className={`flex h-[44px] w-full items-center gap-3.5 text-left transition-opacity ${
                  clickable ? "cursor-pointer" : "cursor-default"
                }`}
              >
                {done && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--border-light)] text-[var(--ink-primary)]">
                    <CheckIcon size={12} strokeWidth={3} />
                  </span>
                )}
                {active && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[12px] font-semibold text-[var(--ink-on-primary)]">
                    {step.id}
                  </span>
                )}
                {!done && !active && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[var(--border-dash)] text-[12px] font-semibold text-[var(--ink-muted)]">
                    {step.id}
                  </span>
                )}

                <span
                  className={`text-[14px] leading-[18px] ${
                    active
                      ? "font-semibold text-[var(--ink-nav)]"
                      : done
                        ? "font-normal text-[var(--ink-nav)]"
                        : "font-normal text-[var(--ink-muted)]"
                  }`}
                >
                  {step.label}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="text-[12px] leading-[18px] text-[var(--ink-muted)]">
          所有数据仅保存在本机。
          <br />
          Valet 0.1.0 · macOS 14+
        </div>
      </aside>

      {/* Right step content */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="app-drag absolute inset-x-0 top-0 h-8" aria-hidden="true" />
        {currentStep === 1 && <WelcomeStep />}
        {currentStep === 2 && <PermissionsStep />}
        {currentStep === 3 && <PluginSelectStep />}
        {currentStep === 4 && <AgentConfigStep />}
        {currentStep === 5 && <FirstScanStep />}
      </main>
    </div>
  );
};
