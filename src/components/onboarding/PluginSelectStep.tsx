import React from "react";
import { useValet } from "../../store/ValetContext";
import { PluginBadgeIcon } from "../ui/Icons";
import { Switch } from "../ui/Switch";

const FUTURE_MARKET_CHIPS = ["Surge", "GitHub", "日历", "电池健康", "HomeKit", "Wi-Fi"];

export const PluginSelectStep: React.FC = () => {
  const { state, togglePluginEnabled, setOnboardingStep } = useValet();

  const corePlugins = state.plugins.filter((p) => p.source === "core");
  const enabledCount = corePlugins.filter((p) => p.enabled).length;

  return (
    <div className="flex h-full flex-col px-16 pt-12 pb-9 lg:px-20">
      <div className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        Step 03 / 05 — 选择插件
      </div>

      <h2 className="mt-3.5 font-[family-name:var(--font-serif-zh)] text-[38px] font-medium leading-[50px] tracking-[-0.01em] text-[var(--ink-strong)]">
        先从照看这台 Mac 开始
      </h2>

      <p className="mt-1.5 max-w-[600px] text-[14px] leading-[22px] text-[var(--ink-muted)]">
        每个插件都会把一类「事件」交给 Valet 处理。下面 4 个是内置核心插件，之后可以在「插件」里接入 GitHub、日历、智能家居等更多来源。
      </p>

      <div className="mt-6 grid max-w-[780px] grid-cols-1 gap-3 md:grid-cols-2">
        {corePlugins.map((plugin) => (
          <div
            key={plugin.id}
            onClick={() => togglePluginEnabled(plugin.id)}
            className={`flex cursor-pointer flex-col gap-2.5 rounded-[12px] p-4 transition-all ${
              plugin.enabled
                ? "border-[1.5px] border-[var(--ink-primary)] bg-[var(--bg-canvas)]"
                : "border border-[var(--border-control)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <PluginBadgeIcon plugin={plugin} size="md" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-[18px] text-[var(--ink-strong)]">
                  {plugin.name}
                </div>
                <div className="truncate text-[12px] leading-[16px] text-[var(--ink-muted)]">
                  {plugin.tagline}
                </div>
              </div>
              <Switch
                checked={plugin.enabled}
                onChange={() => togglePluginEnabled(plugin.id)}
                ariaLabel={`启用 ${plugin.name}`}
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {plugin.events.slice(0, 3).map((ev) => (
                <span
                  key={ev.id}
                  className={`inline-flex h-[22px] items-center rounded-[5px] px-[7px] font-mono text-[10px] leading-[12px] ${
                    plugin.enabled
                      ? "bg-[var(--bg-muted)] text-[var(--ink-strong)]"
                      : "bg-[var(--bg-sidebar)] text-[var(--ink-subtle)]"
                  }`}
                >
                  {ev.id}
                </span>
              ))}
            </div>

            <div className="text-[11px] leading-[14px] text-[var(--ink-subtle)]">
              {plugin.requiredPermissionLabel
                ? `需要：${plugin.requiredPermissionLabel}`
                : "无需额外权限"}{" "}
              · 默认：{plugin.defaultBehaviorHint}
            </div>
          </div>
        ))}

        {/* Future marketplace banner spanning full width */}
        <div className="col-span-full flex flex-wrap items-center gap-4 rounded-[12px] border border-dashed border-[var(--border-strong)] px-[18px] py-4">
          <div className="flex min-w-[200px] flex-1 flex-col gap-[3px]">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
              More events, later
            </div>
            <div className="text-[13px] font-medium leading-[16px] text-[var(--ink-strong)]">
              插件市场里还有 40+ 种事件来源
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FUTURE_MARKET_CHIPS.map((chip) => (
              <span
                key={chip}
                className="inline-flex h-[26px] items-center rounded-full bg-[var(--bg-muted)] px-2.5 text-[12px] text-[var(--ink-strong)]"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center justify-between border-t border-[var(--border-base)] pt-5">
        <button
          type="button"
          onClick={() => setOnboardingStep(2)}
          className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] px-4 text-[14px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
        >
          上一步
        </button>

        <div className="flex items-center gap-4">
          <span className="text-[13px] text-[var(--ink-muted)]">
            已启用 {enabledCount} / {corePlugins.length} · 随时可在插件页调整
          </span>
          <button
            type="button"
            onClick={() => setOnboardingStep(4)}
            className="inline-flex h-[38px] cursor-pointer items-center rounded-[9px] bg-[var(--ink-primary)] px-5 text-[14px] font-semibold text-[var(--ink-on-primary)]"
          >
            继续
          </button>
        </div>
      </div>
    </div>
  );
};
