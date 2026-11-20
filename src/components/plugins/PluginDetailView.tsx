import React, { useEffect, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type {
  EventPolicyMode,
  PluginConfigField,
  PluginExecutionMode,
  PluginState,
} from "../../types/valet";
import { SidebarToggleButton } from "../Sidebar";
import { PluginBadgeIcon } from "../ui/Icons";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Slider } from "../ui/Slider";
import { Switch } from "../ui/Switch";
import { TagInputList } from "../ui/TagInputList";
import { PluginWorkflowPanel } from "./workflow/PluginWorkflowPanel";

const POLICY_OPTIONS: Array<{ value: EventPolicyMode; label: string; widthClass: string }> = [
  { value: "auto", label: "自动处理", widthClass: "w-[70px]" },
  { value: "ask", label: "问我", widthClass: "w-[58px]" },
  { value: "record", label: "仅记录", widthClass: "w-[58px]" },
];

export const PluginDetailView: React.FC<{ plugin: PluginState }> = ({ plugin }) => {
  const {
    state,
    openPluginDetail,
    togglePluginEnabled,
    uninstallPlugin,
    updatePluginEventPolicy,
    updatePluginConfig,
    updatePluginManifest,
    updatePluginSkill,
    updatePluginExecutionMode,
    reloadPlugin,
    simulatePluginEvent,
    setActiveView,
    setTimelinePluginFilter,
    fixPluginAuth,
    pushToast,
  } = useValet();

  const [editingManifest, setEditingManifest] = useState(false);
  const [draftYaml, setDraftYaml] = useState(plugin.manifestYaml);
  const [editingSkill, setEditingSkill] = useState(false);
  const [draftSkill, setDraftSkill] = useState(plugin.skillMarkdown ?? "");

  useEffect(() => {
    setDraftYaml(plugin.manifestYaml);
    setEditingManifest(false);
    setDraftSkill(plugin.skillMarkdown ?? "");
    setEditingSkill(false);
  }, [plugin.id, plugin.manifestYaml, plugin.skillMarkdown]);

  const webhookBase = state.preferences.pluginRuntime.webhookEndpoint;

  const sourceLabel =
    plugin.source === "core"
      ? "核心插件"
      : plugin.source === "local"
        ? "本地开发"
        : "社区插件";

  const total24h = plugin.events.reduce((acc, ev) => acc + ev.count24h, 0);
  const schemaFields: PluginConfigField[] = plugin.configSchema ?? [];
  const configValues: Record<string, unknown> = plugin.config.values ?? {};

  const readFieldValue = (field: PluginConfigField): unknown => {
    if (field.key in configValues && configValues[field.key] !== undefined) {
      return configValues[field.key];
    }
    if (field.key === "lowSpaceThresholdPct" && plugin.config.lowSpaceThresholdPct !== undefined) {
      return plugin.config.lowSpaceThresholdPct;
    }
    if (field.key === "sampleIntervalSec" && plugin.config.sampleIntervalSec !== undefined) {
      return plugin.config.sampleIntervalSec;
    }
    if (field.key === "protectedPaths" && plugin.config.protectedPaths !== undefined) {
      return plugin.config.protectedPaths;
    }
    return field.default;
  };

  const updateFieldValue = (key: string, value: unknown) => {
    const nextValues = { ...configValues, [key]: value };
    const patch: Partial<PluginState["config"]> = { values: nextValues };
    if (key === "lowSpaceThresholdPct" && typeof value === "number") {
      patch.lowSpaceThresholdPct = value;
    } else if (key === "sampleIntervalSec" && typeof value === "number") {
      patch.sampleIntervalSec = value;
    } else if (key === "protectedPaths" && Array.isArray(value)) {
      patch.protectedPaths = value.map(String);
    }
    updatePluginConfig(plugin.id, patch);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {/* Sticky Breadcrumb + Hero Header */}
      <div className="z-10 flex shrink-0 flex-col bg-[var(--bg-canvas)]">
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

          {(plugin.localDir || plugin.source === "local") && (
            <button
              type="button"
              onClick={() => reloadPlugin(plugin.id)}
              className="app-no-drag inline-flex h-[30px] cursor-pointer items-center rounded-[8px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
            >
              热重载
            </button>
          )}

          <button
            type="button"
            onClick={() => togglePluginEnabled(plugin.id)}
            className="app-no-drag inline-flex h-[30px] cursor-pointer items-center rounded-[8px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
          >
            {plugin.enabled ? "停用" : "启用"}
          </button>

          <button
            type="button"
            onClick={() => uninstallPlugin(plugin.id)}
            className="app-no-drag inline-flex h-[30px] cursor-pointer items-center rounded-[8px] border border-[var(--danger-border)] bg-[var(--danger-bg)]/60 px-3 text-[12px] font-medium text-[var(--danger)] hover:bg-[var(--danger-bg)]"
          >
            卸载
          </button>
        </header>

        {/* Hero */}
        <div className="flex flex-wrap items-center gap-[18px] border-b border-[var(--border-light)] px-6 pt-2 pb-[22px] lg:px-12">
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
              {plugin.localDir && (
                <>
                  <span>·</span>
                  <span className="max-w-[360px] truncate" title={plugin.localDir}>
                    {plugin.localDir}
                  </span>
                </>
              )}
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-10">
        {/* Body sections */}
        <div className="flex flex-col gap-[26px] px-6 pt-[22px] lg:px-12">
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
              const webhookUrl = webhookBase ? `${webhookBase}/${plugin.id}/${ev.id}` : "";
              return (
                <div
                  key={ev.id}
                  className={`flex min-h-[56px] flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-[var(--border-subtle)] py-3 ${
                    isLast ? "border-b border-b-[var(--border-light)]" : ""
                  }`}
                >
                  <div className="flex w-full min-w-0 shrink-0 flex-col gap-1 overflow-hidden lg:w-[280px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="break-all font-mono text-[12px] font-semibold leading-[16px] text-[var(--ink-strong)]">
                        {ev.id}
                      </span>
                      {ev.sensor && (
                        <span className="shrink-0 rounded-[4px] border border-[var(--border-control)] bg-[var(--bg-subtle)] px-1.5 py-[1px] font-mono text-[9.5px] leading-[14px] text-[var(--ink-muted)]">
                          {ev.sensor}
                        </span>
                      )}
                    </div>
                    {ev.sourceSummary && (
                      <div
                        title={ev.sourceSummary}
                        className="truncate font-mono text-[10px] leading-[14px] text-[var(--ink-subtle)]"
                      >
                        {ev.sourceSummary}
                      </div>
                    )}
                  </div>
                  <span className="min-w-[180px] flex-1 text-[13px] leading-[19px] text-[var(--ink-secondary)]">
                    {ev.description}
                  </span>

                  <div className="ml-auto flex shrink-0 items-center gap-2.5">
                    <SegmentedControl<EventPolicyMode>
                      variant="ink"
                      value={ev.policy}
                      options={POLICY_OPTIONS}
                      onChange={(next) => updatePluginEventPolicy(plugin.id, ev.id, next)}
                    />

                    <span className="w-8 shrink-0 text-right font-mono text-[12px] text-[var(--ink-strong)]">
                      {ev.count24h}
                    </span>
                    {webhookUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(webhookUrl);
                          pushToast(`已复制事件推送端点 ${webhookUrl}`, "success");
                        }}
                        title={webhookUrl}
                        className="inline-flex h-[24px] shrink-0 cursor-pointer items-center rounded-[6px] border border-[var(--border-control)] px-2 font-mono text-[10px] text-[var(--ink-muted)] hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)]"
                      >
                        Webhook
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => simulatePluginEvent(plugin.id, ev.id)}
                      className="inline-flex h-[24px] shrink-0 cursor-pointer items-center rounded-[6px] border border-[var(--border-control)] px-2 text-[11px] font-medium text-[var(--ink-muted)] hover:border-[var(--border-strong)] hover:text-[var(--ink-strong)]"
                    >
                      测试触发
                    </button>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Mutually Exclusive Execution Logic: Skill (SKILL.md) OR Workflow (workflow.yaml) */}
          <section className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 className="font-[family-name:var(--font-serif-zh)] text-[18px] font-semibold leading-[22px] text-[var(--ink-strong)]">
                  {plugin.executionMode === "workflow"
                    ? "Workflow 编排与执行（workflow.yaml）"
                    : "Skill 处理逻辑（SKILL.md）"}
                </h2>
                <span className="text-[12px] text-[var(--ink-muted)]">
                  {plugin.executionMode === "workflow"
                    ? "与 SKILL.md 互斥二选一：事件触发后由本地 Vercel Workflow SDK 按 DAG 执行并可查看运行轨迹与节点输入输出"
                    : "与 Workflow 互斥二选一：定义事件触发或 @该插件 时，Agent 如何借助核心通用工具排查与处理"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <SegmentedControl<PluginExecutionMode>
                  size="sm"
                  value={plugin.executionMode === "workflow" ? "workflow" : "skill"}
                  onChange={(mode) => {
                    if (mode !== (plugin.executionMode === "workflow" ? "workflow" : "skill")) {
                      setEditingSkill(false);
                      void updatePluginExecutionMode(plugin.id, mode);
                    }
                  }}
                  options={[
                    { value: "skill", label: "Skill 模式", widthClass: "w-[74px]" },
                    { value: "workflow", label: "Workflow 模式", widthClass: "w-[92px]" },
                  ]}
                />

                {plugin.executionMode !== "workflow" && (
                  <div className="flex items-center gap-2">
                    {editingSkill ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setDraftSkill(plugin.skillMarkdown ?? "");
                            setEditingSkill(false);
                          }}
                          className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11px] font-medium text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            updatePluginSkill(plugin.id, draftSkill);
                            setEditingSkill(false);
                          }}
                          className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-3 text-[11px] font-semibold text-[var(--ink-on-primary)]"
                        >
                          保存并热重载
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingSkill(true)}
                        className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                      >
                        编辑 Skill
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {plugin.executionMode === "workflow" ? (
              <PluginWorkflowPanel plugin={plugin} />
            ) : editingSkill ? (
              <textarea
                value={draftSkill}
                onChange={(e) => setDraftSkill(e.target.value)}
                rows={8}
                placeholder="使用 Markdown 描述触发条件、Payload 字段含义、工具调用步骤与安全边界…"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full rounded-[10px] border border-[var(--border-control)] bg-[var(--bg-subtle)] p-3.5 font-mono text-[12px] leading-[18px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
              />
            ) : plugin.skillMarkdown ? (
              <div className="rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-subtle)] p-4 text-[13px] leading-[20px] text-[var(--ink-body)]">
                <MarkdownRenderer text={plugin.skillMarkdown} />
              </div>
            ) : (
              <div className="rounded-[10px] border border-dashed border-[var(--border-dash)] px-4 py-3 text-[12px] text-[var(--ink-subtle)]">
                尚未配置 Skill 说明，点击右上角「编辑 Skill」补充处理逻辑，或切换为「Workflow 模式」使用 DAG 编排。
              </div>
            )}
          </section>

          {/* Bottom 2 columns: Dynamic Config & Bundle Files */}
          <div className="flex flex-col gap-10 md:flex-row">
            {/* Left config */}
            <section className="flex flex-1 flex-col gap-3.5">
              <h2 className="font-[family-name:var(--font-serif-zh)] text-[18px] font-semibold leading-[22px] text-[var(--ink-strong)]">
                配置
              </h2>

              {schemaFields.map((field) => {
                const val = readFieldValue(field);
                if (field.type === "slider" || field.type === "number") {
                  const fallbackNum =
                    typeof field.default === "number"
                      ? field.default
                      : (field.min ?? 1);
                  const numVal =
                    typeof val === "number" && Number.isFinite(val)
                      ? val
                      : Number(val ?? fallbackNum) || fallbackNum;
                  return (
                    <div key={field.key} className="flex flex-col gap-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                            {field.label}
                          </span>
                          {field.description && (
                            <div className="text-[11px] text-[var(--ink-subtle)]">
                              {field.description}
                            </div>
                          )}
                        </div>
                        <span className="font-mono text-[12px] font-semibold text-[var(--ink-strong)]">
                          {numVal}
                        </span>
                      </div>
                      <Slider
                        min={field.min ?? 1}
                        max={field.max ?? 120}
                        step={1}
                        value={numVal}
                        ariaLabel={field.label}
                        onChange={(nextVal) => updateFieldValue(field.key, nextVal)}
                      />
                    </div>
                  );
                }

                if (field.type === "boolean") {
                  return (
                    <div key={field.key} className="flex items-center justify-between gap-3 py-1">
                      <div>
                        <div className="text-[13px] font-medium text-[var(--ink-strong)]">
                          {field.label}
                        </div>
                        {field.description && (
                          <div className="text-[11px] text-[var(--ink-subtle)]">
                            {field.description}
                          </div>
                        )}
                      </div>
                      <Switch
                        checked={Boolean(val)}
                        onChange={(nextVal) => updateFieldValue(field.key, nextVal)}
                        ariaLabel={field.label}
                      />
                    </div>
                  );
                }

                return (
                  <label key={field.key} className="flex flex-col gap-1">
                    <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                      {field.label}
                    </span>
                    {field.description && (
                      <span className="text-[11px] text-[var(--ink-subtle)]">
                        {field.description}
                      </span>
                    )}
                    <input
                      type="text"
                      value={String(val ?? "")}
                      onChange={(e) => updateFieldValue(field.key, e.target.value)}
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className="h-[32px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-subtle)] px-2.5 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                    />
                  </label>
                );
              })}

              {schemaFields.length === 0 && plugin.config.lowSpaceThresholdPct !== undefined && (
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
                    onChange={(val) => updateFieldValue("lowSpaceThresholdPct", val)}
                  />
                </div>
              )}

              {schemaFields.length === 0 && plugin.config.sampleIntervalSec !== undefined && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex justify-between">
                    <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                      采样间隔
                    </span>
                    <span className="font-mono text-[12px] font-semibold text-[var(--ink-strong)]">
                      {plugin.config.sampleIntervalSec} 秒
                    </span>
                  </div>
                  <Slider
                    min={2}
                    max={60}
                    value={plugin.config.sampleIntervalSec}
                    ariaLabel="采样间隔秒数"
                    onChange={(val) => updateFieldValue("sampleIntervalSec", val)}
                  />
                </div>
              )}

              {plugin.config.protectedPaths !== undefined && (
                <div className="flex flex-col gap-2">
                  <div className="text-[13px] font-medium text-[var(--ink-strong)]">
                    受保护目录{" "}
                    <span className="text-[12px] font-normal text-[var(--ink-subtle)]">
                      · 严禁改动
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
              )}

              {schemaFields.length === 0 &&
                plugin.config.lowSpaceThresholdPct === undefined &&
                plugin.config.sampleIntervalSec === undefined &&
                plugin.config.protectedPaths === undefined && (
                  <div className="rounded-[10px] border border-dashed border-[var(--border-dash)] px-3.5 py-2.5 text-[12px] text-[var(--ink-subtle)]">
                    该插件暂无可调参数，所有行为由 Skill 与事件策略控制。
                  </div>
                )}
            </section>

            {/* Right: Self-contained plugin bundle files */}
            <section className="flex flex-1 flex-col gap-2.5">
              <h2 className="font-[family-name:var(--font-serif-zh)] text-[18px] font-semibold leading-[22px] text-[var(--ink-strong)]">
                插件包目录与文件
              </h2>

              <div className="rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-subtle)] p-3 font-mono text-[11.5px] leading-[18px] text-[var(--ink-secondary)]">
                <div className="truncate text-[var(--ink-strong)]">
                  {plugin.localDir || `plugins/${plugin.slug || plugin.id}/`}
                </div>
                <div className="mt-1 text-[10.5px] text-[var(--ink-subtle)]">
                  运行时由 Valet 注入 VALET_PLUGIN_DIR / VALET_PLUGIN_STATE_DIR，无需宿主特化代码。
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(plugin.bundledFiles && plugin.bundledFiles.length > 0
                  ? plugin.bundledFiles
                  : ["manifest.yaml", "SKILL.md"]
                ).map((file) => (
                  <span
                    key={file}
                    className="inline-flex h-[24px] items-center rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] text-[var(--ink-strong)]"
                  >
                    {file}
                  </span>
                ))}
              </div>
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
                  插件包统一仅声明传感器、配置项与 Skill，执行由核心通用工具完成
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
                autoCorrect="off"
                autoCapitalize="off"
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
