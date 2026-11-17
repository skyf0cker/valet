import React, { useEffect, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type { EventPolicyMode, PluginState } from "../../types/valet";
import { SidebarToggleButton } from "../Sidebar";
import { PluginBadgeIcon } from "../ui/Icons";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Slider } from "../ui/Slider";
import { TagInputList } from "../ui/TagInputList";

const POLICY_OPTIONS: Array<{ value: EventPolicyMode; label: string; widthClass: string }> = [
  { value: "auto", label: "自动处理", widthClass: "w-[70px]" },
  { value: "ask", label: "问我", widthClass: "w-[58px]" },
  { value: "record", label: "仅记录", widthClass: "w-[58px]" },
];

export const PluginDetailView: React.FC<{ plugin: PluginState }> = ({ plugin }) => {
  const {
    openPluginDetail,
    togglePluginEnabled,
    updatePluginEventPolicy,
    updatePluginConfig,
    updatePluginManifest,
    simulatePluginEvent,
    setActiveView,
    setTimelinePluginFilter,
    fixPluginAuth,
  } = useValet();

  const [editingManifest, setEditingManifest] = useState(false);
  const [draftYaml, setDraftYaml] = useState(plugin.manifestYaml);

  useEffect(() => {
    setDraftYaml(plugin.manifestYaml);
    setEditingManifest(false);
  }, [plugin.id, plugin.manifestYaml]);

  const sourceLabel =
    plugin.source === "core"
      ? "核心插件"
      : plugin.source === "local"
        ? "本地开发"
        : "社区插件";

  const total24h = plugin.events.reduce((acc, ev) => acc + ev.count24h, 0);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {/* Breadcrumb bar */}
      <header className="app-drag flex h-[52px] shrink-0 items-center gap-2 pr-7 pl-6 lg:pl-12">
        <SidebarToggleButton />
        <button
          type="button"
          onClick={() => openPluginDetail(null)}
          className="app-no-drag cursor-pointer text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
        >
          ‹ 插件
        </button>
        <span className="text-[12px] text-[var(--ink-faint)]">/</span>
        <span className="text-[12px] font-semibold text-[var(--ink-strong)]">
          {plugin.name}
        </span>

        <div className="flex-1" />

        {plugin.authError && (
          <button
            type="button"
            onClick={() => fixPluginAuth(plugin.id)}
            className="app-no-drag inline-flex h-[30px] cursor-pointer items-center rounded-[8px] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 text-[12px] font-semibold text-[var(--danger)]"
          >
            修复授权
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setTimelinePluginFilter(plugin.id);
            setActiveView("timeline");
          }}
          className="app-no-drag inline-flex h-[30px] cursor-pointer items-center rounded-[8px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
        >
          查看全部事件
        </button>

        <button
          type="button"
          onClick={() => togglePluginEnabled(plugin.id)}
          className="app-no-drag inline-flex h-[30px] cursor-pointer items-center rounded-[8px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
        >
          {plugin.enabled ? "停用" : "启用"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-10">
        {/* Hero */}
        <div className="flex flex-wrap items-center gap-[18px] border-b border-[var(--border-light)] px-12 pt-2 pb-[22px]">
          <PluginBadgeIcon plugin={plugin} size="lg" />

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h1 className="font-[family-name:var(--font-serif-zh)] text-[30px] font-medium leading-[38px] text-[var(--ink-strong)]">
              {plugin.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] leading-[14px] text-[var(--ink-muted)]">
              <span>{plugin.bundleId}</span>
              <span>·</span>
              <span>{plugin.version}</span>
              <span>·</span>
              <span className="text-[var(--ink-primary)]">{sourceLabel}</span>
              {plugin.requiredPermissionLabel && (
                <>
                  <span>·</span>
                  <span>{plugin.requiredPermissionLabel} ✓</span>
                </>
              )}
              {!plugin.enabled && (
                <>
                  <span>·</span>
                  <span className="text-[var(--amber-text)]">已停用</span>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <div className="font-[family-name:var(--font-serif-en)] text-[34px] leading-[36px] text-[var(--ink-strong)]">
              {plugin.weeklyImpactValue ?? total24h}
              {plugin.weeklyImpactUnit && (
                <span className="font-sans text-[12px] text-[var(--ink-muted)]">
                  {" "}
                  {plugin.weeklyImpactUnit}
                </span>
              )}
            </div>
            <div className="text-[11px] leading-[14px] text-[var(--ink-muted)]">
              {plugin.weeklyImpactLabel ?? "24h 内触发次数"}
            </div>
          </div>
        </div>

        {/* Body sections */}
        <div className="flex flex-col gap-[26px] px-12 pt-[22px]">
          {/* Event policies */}
          <section className="flex flex-col">
            <div className="flex items-baseline justify-between pb-2.5">
              <div className="flex items-baseline gap-2.5">
                <h2 className="font-[family-name:var(--font-serif-zh)] text-[18px] font-semibold leading-[22px] text-[var(--ink-strong)]">
                  事件与响应策略
                </h2>
                <span className="text-[12px] text-[var(--ink-muted)]">
                  插件发来事件时，Valet 该怎么做
                </span>
              </div>
              <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--ink-subtle)]">
                24H
              </span>
            </div>

            {plugin.events.map((ev, idx) => {
              const isLast = idx === plugin.events.length - 1;
              return (
                <div
                  key={ev.id}
                  className={`flex min-h-[52px] flex-wrap items-center gap-4 border-t border-[var(--border-subtle)] py-2 ${
                    isLast ? "border-b border-b-[var(--border-light)]" : ""
                  }`}
                >
                  <span className="w-[190px] shrink-0 font-mono text-[12px] font-semibold text-[var(--ink-strong)]">
                    {ev.id}
                  </span>
                  <span className="min-w-[160px] flex-1 text-[13px] text-[var(--ink-secondary)]">
                    {ev.description}
                  </span>

                  <SegmentedControl<EventPolicyMode>
                    variant="ink"
                    value={ev.policy}
                    options={POLICY_OPTIONS}
                    onChange={(next) => updatePluginEventPolicy(plugin.id, ev.id, next)}
                  />

                  <span className="w-9 shrink-0 text-right font-mono text-[12px] text-[var(--ink-strong)]">
                    {ev.count24h}
                  </span>
                  <button
                    type="button"
                    onClick={() => simulatePluginEvent(plugin.id, ev.id)}
                    className="inline-flex h-[24px] shrink-0 cursor-pointer items-center rounded-[6px] border border-[var(--border-control)] px-2 text-[11px] font-medium text-[var(--ink-muted)] hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)]"
                  >
                    测试触发
                  </button>
                </div>
              );
            })}
          </section>

          {/* Bottom 2 columns: Config & Actions */}
          <div className="flex flex-col gap-10 md:flex-row">
            {/* Left config */}
            <section className="flex flex-1 flex-col gap-3.5">
              <h2 className="font-[family-name:var(--font-serif-zh)] text-[18px] font-semibold leading-[22px] text-[var(--ink-strong)]">
                配置
              </h2>

              {plugin.config.lowSpaceThresholdPct !== undefined && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex justify-between">
                    <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                      低空间阈值
                    </span>
                    <span className="font-mono text-[12px] font-semibold text-[var(--ink-strong)]">
                      {plugin.config.lowSpaceThresholdPct}%
                    </span>
                  </div>
                  <Slider
                    min={5}
                    max={40}
                    value={plugin.config.lowSpaceThresholdPct}
                    ariaLabel="低空间阈值百分比"
                    onChange={(val) =>
                      updatePluginConfig(plugin.id, { lowSpaceThresholdPct: val })
                    }
                  />
                </div>
              )}

              {plugin.config.sampleIntervalSec !== undefined && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex justify-between">
                    <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                      进程采样间隔
                    </span>
                    <span className="font-mono text-[12px] font-semibold text-[var(--ink-strong)]">
                      {plugin.config.sampleIntervalSec} 秒
                    </span>
                  </div>
                  <Slider
                    min={2}
                    max={30}
                    value={plugin.config.sampleIntervalSec}
                    ariaLabel="进程采样间隔秒数"
                    onChange={(val) =>
                      updatePluginConfig(plugin.id, { sampleIntervalSec: val })
                    }
                  />
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div className="text-[13px] font-medium text-[var(--ink-strong)]">
                  受保护目录{" "}
                  <span className="text-[12px] font-normal text-[var(--ink-subtle)]">
                    · 永不清理
                  </span>
                </div>
                <TagInputList
                  items={plugin.config.protectedPaths ?? []}
                  onChange={(next) =>
                    updatePluginConfig(plugin.id, { protectedPaths: next })
                  }
                  mono
                  removable={false}
                  placeholder="~/Path"
                />
              </div>
            </section>

            {/* Right actions */}
            <section className="flex flex-1 flex-col gap-2.5">
              <h2 className="font-[family-name:var(--font-serif-zh)] text-[18px] font-semibold leading-[22px] text-[var(--ink-strong)]">
                提供给 Valet 的动作
              </h2>

              {plugin.actions.map((act) => (
                <div key={act.id} className="flex items-center gap-2.5 py-0.5">
                  <span className="flex-1 font-mono text-[12px] text-[var(--ink-strong)]">
                    {act.id}
                  </span>
                  {act.safety === "confirm_always" ? (
                    <span className="inline-flex h-[18px] items-center rounded-[4px] border border-[var(--amber-pill)] px-1.5 text-[10px] font-semibold text-[var(--amber-text)]">
                      {act.safetyLabel}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--ink-muted)]">
                      {act.safetyLabel}
                    </span>
                  )}
                </div>
              ))}
            </section>
          </div>

          {/* Unified Declarative Manifest (YAML) */}
          <section className="flex flex-col gap-2.5 border-t border-[var(--border-subtle)] pt-5 pb-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-2.5">
                <h2 className="font-[family-name:var(--font-serif-zh)] text-[18px] font-semibold leading-[22px] text-[var(--ink-strong)]">
                  声明式 Manifest (YAML)
                </h2>
                <span className="text-[12px] text-[var(--ink-muted)]">
                  内核与社区插件统一经由传感器与驱动编排生效
                </span>
              </div>
              <div className="flex items-center gap-2">
                {editingManifest ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftYaml(plugin.manifestYaml);
                        setEditingManifest(false);
                      }}
                      className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11px] font-medium text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updatePluginManifest(plugin.id, draftYaml);
                        setEditingManifest(false);
                      }}
                      className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-3 text-[11px] font-semibold text-[var(--ink-on-primary)]"
                    >
                      保存并热重载
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingManifest(true)}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                  >
                    编辑 Manifest
                  </button>
                )}
              </div>
            </div>

            {editingManifest ? (
              <textarea
                value={draftYaml}
                onChange={(e) => setDraftYaml(e.target.value)}
                rows={12}
                spellCheck={false}
                className="w-full rounded-[10px] border border-[var(--border-control)] bg-[var(--bg-subtle)] p-3.5 font-mono text-[12px] leading-[18px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
              />
            ) : (
              <pre className="max-h-[260px] overflow-auto rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-subtle)] p-3.5 font-mono text-[11.5px] leading-[18px] text-[var(--ink-secondary)]">
                {plugin.manifestYaml || "# 该插件尚未提供 Manifest YAML"}
              </pre>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
