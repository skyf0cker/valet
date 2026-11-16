import React, { useMemo, useState } from "react";
import { useValet } from "../../store/ValetContext";
import { SidebarToggleButton } from "../Sidebar";
import { PluginBadgeIcon, SearchIcon } from "../ui/Icons";
import { Modal } from "../ui/Modal";
import { SelectMenu } from "../ui/SelectMenu";
import { SparkBars } from "../ui/SparkBars";
import { Switch } from "../ui/Switch";
import { PluginDetailView } from "./PluginDetailView";

type PluginsTab = "installed" | "discover" | "developer";

export const PluginsView: React.FC = () => {
  const {
    state,
    sidebarCollapsed,
    openPluginDetail,
    togglePluginEnabled,
    installMarketplacePlugin,
    installCustomPlugin,
    fixPluginAuth,
    simulatePluginEvent,
    setActiveView,
  } = useValet();

  const [tab, setTab] = useState<PluginsTab>("installed");
  const [query, setQuery] = useState("");
  const [installModalOpen, setInstallModalOpen] = useState(false);

  // Install custom plugin form
  const [newName, setNewName] = useState("截图自动归档");
  const [newTagline, setNewTagline] = useState("~/Valet/plugins/screenshot-tidy · 热重载中");
  const [newYaml, setNewYaml] = useState(`events:
  - id: fs.file_created
actions:
  - id: move_to_trash`);

  // Developer event simulator state
  const installedPlugins = useMemo(
    () => state.plugins.filter((p) => p.installed),
    [state.plugins]
  );
  const [simPluginId, setSimPluginId] = useState<string>(
    installedPlugins[0]?.id ?? "disk-guard"
  );
  const simPlugin =
    installedPlugins.find((p) => p.id === simPluginId) ?? installedPlugins[0];
  const [simEventId, setSimEventId] = useState<string>(
    simPlugin?.events[0]?.id ?? "disk.low_space"
  );

  // If a plugin detail is active, render detail view
  const detailPlugin = state.activePluginDetailId
    ? state.plugins.find((p) => p.id === state.activePluginDetailId) ?? null
    : null;

  if (detailPlugin) {
    return <PluginDetailView plugin={detailPlugin} />;
  }

  const discoverPlugins = state.plugins.filter((p) => !p.installed || p.source === "community");
  const totalEventsCount = installedPlugins.reduce((acc, p) => acc + p.events.length, 0);
  const total24hTriggers =
    312 +
    installedPlugins.reduce(
      (acc, p) => acc + p.events.reduce((s, e) => s + e.count24h, 0),
      0
    ) -
    17;

  const q = query.trim().toLowerCase();
  const filteredInstalled = q
    ? installedPlugins.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.tagline.toLowerCase().includes(q) ||
          p.events.some((e) => e.id.toLowerCase().includes(q))
      )
    : installedPlugins;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {/* Top Search & Action */}
      <header
        className={`app-drag flex shrink-0 items-center justify-between gap-2 ${
          sidebarCollapsed
            ? "h-[44px] border-b border-[var(--border-subtle)] px-[22px]"
            : "h-[52px] px-7"
        }`}
      >
        <SidebarToggleButton title={sidebarCollapsed ? "插件" : undefined} />

        <div className="flex items-center gap-2">
          <div
            className={`app-no-drag flex items-center gap-2 rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-subtle)] ${
              sidebarCollapsed ? "h-[26px] w-[144px] px-[9px]" : "h-[30px] w-[200px] px-2.5"
            }`}
          >
            <SearchIcon size={13} className="shrink-0 text-[var(--ink-subtle)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={sidebarCollapsed ? "搜索插件" : "搜索插件或事件"}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)]"
            />
          </div>

          <button
            type="button"
            onClick={() => setInstallModalOpen(true)}
            className={`app-no-drag inline-flex cursor-pointer items-center bg-[var(--ink-primary)] font-semibold text-[var(--ink-on-primary)] ${
              sidebarCollapsed
                ? "h-[26px] rounded-[7px] px-2.5 text-[11px]"
                : "h-[30px] rounded-[8px] px-3 text-[12px]"
            }`}
          >
            + 安装插件
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {/* Hero */}
        <div
          className={`flex flex-wrap items-end justify-between gap-4 ${
            sidebarCollapsed ? "px-6 pt-3" : "px-6 pt-1 lg:px-12"
          }`}
        >
          <div className="flex flex-col gap-1.5 lg:gap-2.5">
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ink-muted)] lg:text-[11px]">
              Plugins · {installedPlugins.length} installed
            </div>
            <h1
              className={`font-[family-name:var(--font-serif-zh)] font-medium tracking-[-0.01em] text-[var(--ink-strong)] ${
                sidebarCollapsed
                  ? "text-[24px] leading-[32px]"
                  : "text-[26px] leading-[34px] lg:text-[34px] lg:leading-[44px]"
              }`}
            >
              <span
                className={`font-[family-name:var(--font-serif-en)] font-normal italic ${
                  sidebarCollapsed ? "text-[29px]" : "text-[30px] lg:text-[40px]"
                }`}
              >
                Valet
              </span>{" "}
              会响应的一切
            </h1>
          </div>

          <div className="flex items-end gap-5 pb-0.5 lg:gap-7 lg:pb-1.5">
            <div className="flex flex-col items-end gap-0.5">
              <div
                className={`font-[family-name:var(--font-serif-en)] text-[var(--ink-strong)] ${
                  sidebarCollapsed
                    ? "text-[23px] leading-[25px]"
                    : "text-[24px] leading-[26px] lg:text-[30px] lg:leading-[32px]"
                }`}
              >
                {totalEventsCount}
              </div>
              <div className="text-[10px] leading-[13px] text-[var(--ink-muted)] lg:text-[11px]">
                种事件
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <div
                className={`font-[family-name:var(--font-serif-en)] text-[var(--ink-strong)] ${
                  sidebarCollapsed
                    ? "text-[23px] leading-[25px]"
                    : "text-[24px] leading-[26px] lg:text-[30px] lg:leading-[32px]"
                }`}
              >
                {total24hTriggers}
              </div>
              <div className="text-[10px] leading-[13px] text-[var(--ink-muted)] lg:text-[11px]">
                {sidebarCollapsed ? "次 / 24h" : "次触发 / 24h"}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          className={`flex gap-[18px] border-b border-[var(--border-light)] lg:gap-[22px] ${
            sidebarCollapsed ? "px-6 pt-3" : "px-6 pt-4 lg:px-12 lg:pt-5"
          }`}
        >
          {[
            { id: "installed" as const, label: "已安装", count: installedPlugins.length },
            { id: "discover" as const, label: "发现" },
            { id: "developer" as const, label: "开发者" },
          ].map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`cursor-pointer border-b-2 transition-colors ${
                  sidebarCollapsed ? "pb-2 text-[12px]" : "pb-2.5 text-[13px]"
                } ${
                  active
                    ? "border-[var(--ink-primary)] font-semibold text-[var(--ink-strong)]"
                    : "border-transparent font-normal text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                }`}
              >
                {item.label}
                {item.count !== undefined && (
                  <span className="ml-1.5 font-mono text-[10.5px] text-[var(--ink-muted)] lg:text-[11px]">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "installed" && (
          <>
            {/* Table headers */}
            <div
              className={`flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-subtle)] lg:gap-4 ${
                sidebarCollapsed
                  ? "h-[30px] px-8"
                  : "h-9 px-8 xl:px-[60px]"
              }`}
            >
              <span className="flex-1">插件</span>
              <span className="w-[64px] shrink-0 lg:w-[72px]">类型</span>
              {!sidebarCollapsed && (
                <span className="hidden w-[92px] shrink-0 lg:inline">事件 / 动作</span>
              )}
              <span className="w-[64px] shrink-0 lg:w-[100px]">24h 触发</span>
              <span className="w-[68px] shrink-0 text-right lg:w-[96px]">状态</span>
            </div>

            <div className={`flex flex-col ${sidebarCollapsed ? "px-6" : "px-6 xl:px-12"}`}>
              {filteredInstalled.map((plugin, idx) => {
                const isFirst = idx === 0;
                return (
                  <div
                    key={plugin.id}
                    onClick={() => openPluginDetail(plugin.id)}
                    className={`group flex cursor-pointer items-center gap-3 border-t border-[var(--border-subtle)] transition-colors lg:gap-4 ${
                      sidebarCollapsed ? "h-[46px] px-2" : "h-[52px] px-2.5 lg:h-[58px] lg:px-3"
                    } ${
                      isFirst
                        ? "rounded-[10px] bg-[var(--bg-card-hover)]"
                        : "hover:rounded-[10px] hover:bg-[var(--bg-card-hover)]"
                    }`}
                  >
                    {/* Name & subtitle */}
                    <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:gap-3">
                      <PluginBadgeIcon
                        plugin={plugin}
                        size={sidebarCollapsed ? "sm" : "md"}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate font-semibold text-[var(--ink-strong)] ${
                            sidebarCollapsed
                              ? "text-[12.5px] leading-[16px]"
                              : "text-[13.5px] leading-[17px] lg:text-[14px] lg:leading-[18px]"
                          }`}
                        >
                          {plugin.name}
                          <span
                            className={`ml-1.5 font-mono text-[10px] font-normal text-[var(--ink-subtle)] ${
                              sidebarCollapsed ? "inline" : "lg:hidden"
                            }`}
                          >
                            · {plugin.events.length}/{plugin.actions.length}
                          </span>
                        </div>
                        <div
                          className={`truncate ${
                            sidebarCollapsed ? "text-[11px] leading-[14px]" : "text-[11.5px] leading-[15px] lg:text-[12px] lg:leading-[16px]"
                          } ${
                            plugin.authError
                              ? "text-[var(--danger)]"
                              : plugin.source === "local"
                                ? "font-mono text-[10.5px] text-[var(--ink-muted)] lg:text-[11px]"
                                : plugin.statusSubtitle?.includes("待你确认")
                                  ? "text-[var(--amber-text)]"
                                  : "text-[var(--ink-muted)]"
                          }`}
                        >
                          {plugin.authError ?? plugin.statusSubtitle ?? plugin.tagline}
                        </div>
                      </div>
                    </div>

                    {/* Type badge */}
                    <div className="w-[64px] shrink-0 lg:w-[72px]">
                      {plugin.source === "core" && (
                        <span className="inline-flex h-[18px] items-center rounded-[5px] bg-[var(--ink-primary)] px-[6px] text-[10px] font-semibold text-[var(--ink-on-primary)] lg:h-[20px] lg:px-[7px] lg:text-[11px]">
                          核心
                        </span>
                      )}
                      {plugin.source === "community" && (
                        <span className="inline-flex h-[18px] items-center rounded-[5px] border border-[var(--border-strong)] px-[6px] text-[10px] font-medium text-[var(--ink-strong)] lg:h-[20px] lg:px-[7px] lg:text-[11px]">
                          社区
                        </span>
                      )}
                      {plugin.source === "local" && (
                        <span className="inline-flex h-[18px] items-center rounded-[5px] border border-dashed border-[var(--border-dash)] px-[6px] text-[10px] font-medium text-[var(--ink-strong)] lg:h-[20px] lg:px-[7px] lg:text-[11px]">
                          {sidebarCollapsed ? "开发" : "本地开发"}
                        </span>
                      )}
                    </div>

                    {/* Events / Actions count */}
                    {!sidebarCollapsed && (
                      <div className="hidden w-[92px] shrink-0 font-mono text-[12px] text-[var(--ink-strong)] lg:block">
                        {plugin.events.length}{" "}
                        <span className="text-[var(--ink-subtle)]">
                          / {plugin.actions.length}
                        </span>
                      </div>
                    )}

                    {/* 24h SparkBars */}
                    <div className="w-[64px] shrink-0 lg:w-[100px]">
                      <span className="lg:hidden">
                        <SparkBars values={plugin.triggers24h} muted={!plugin.enabled} compact />
                      </span>
                      <span className="hidden lg:block">
                        <SparkBars
                          values={plugin.triggers24h}
                          muted={!plugin.enabled}
                          compact={sidebarCollapsed}
                        />
                      </span>
                    </div>

                    {/* Status / Control */}
                    <div className="flex w-[68px] shrink-0 items-center justify-end gap-2.5 lg:w-[96px]">
                      {plugin.authError ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            fixPluginAuth(plugin.id);
                          }}
                          className="inline-flex h-[24px] cursor-pointer items-center rounded-[7px] border border-[var(--ink-primary)] bg-[var(--bg-elevated)] px-2 text-[11px] font-semibold text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)] lg:h-[26px] lg:px-2.5 lg:text-[12px]"
                        >
                          修复
                        </button>
                      ) : isFirst ? (
                        <span className="text-[11px] font-medium text-[var(--ink-strong)] lg:text-[12px]">
                          配置 →
                        </span>
                      ) : (
                        <Switch
                          checked={plugin.enabled}
                          size={sidebarCollapsed ? "sm" : "md"}
                          onChange={() => togglePluginEnabled(plugin.id)}
                          ariaLabel={`切换 ${plugin.name}`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Bottom developer banner (Paper 05 & 19 Dark) */}
              <div
                className="mt-4 flex flex-wrap items-center gap-3 rounded-[12px] border px-4 py-3 lg:gap-4 lg:py-3.5"
                style={{
                  backgroundColor: "var(--banner-bg)",
                  borderColor: "var(--banner-border)",
                  color: "var(--banner-fg)",
                }}
              >
                <pre
                  className="font-mono text-[10px] leading-[15px] lg:text-[11px] lg:leading-[17px]"
                  style={{ color: "var(--banner-muted)" }}
                >
                  {`events:\n  - id: fs.file_created\nactions:\n  - id: move_to_trash`}
                </pre>
                <div className="min-w-[180px] flex-1">
                  <div className="text-[13px] font-semibold leading-[17px] lg:text-[14px] lg:leading-[18px]">
                    用一份 manifest，教{" "}
                    <span className="font-[family-name:var(--font-serif-en)] text-[16px] font-normal italic lg:text-[17px]">
                      Valet
                    </span>{" "}
                    响应新事件
                  </div>
                  <div
                    className="mt-0.5 text-[11px] leading-[15px] lg:text-[12px] lg:leading-[16px]"
                    style={{ color: "var(--banner-muted)" }}
                  >
                    {sidebarCollapsed
                      ? "或在对话里说「帮我做个插件」"
                      : "也可以直接在对话里说「帮我做个插件」。支持在开发者页即时模拟事件触发。"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTab("developer")}
                  className="inline-flex h-[28px] shrink-0 cursor-pointer items-center rounded-[8px] px-3 text-[11.5px] font-semibold lg:h-[30px] lg:text-[12px]"
                  style={{
                    backgroundColor: "var(--banner-btn-bg)",
                    color: "var(--banner-btn-fg)",
                  }}
                >
                  开发文档
                </button>
              </div>
            </div>
          </>
        )}

        {tab === "discover" && (
          <div className="grid grid-cols-1 gap-4 px-6 pt-6 md:grid-cols-2 lg:px-12">
            {discoverPlugins.map((pl) => (
              <div
                key={pl.id}
                className="flex flex-col justify-between gap-4 rounded-[12px] border border-[var(--border-card)] bg-[var(--bg-surface)] p-4"
              >
                <div className="flex items-start gap-3">
                  <PluginBadgeIcon plugin={pl} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-[var(--ink-strong)]">
                        {pl.name}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                        {pl.version}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-[18px] text-[var(--ink-muted)]">
                      {pl.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                  <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                    {pl.events.map((e) => e.id).join(" · ")}
                  </span>
                  {pl.installed ? (
                    <button
                      type="button"
                      onClick={() => openPluginDetail(pl.id)}
                      className="h-[28px] cursor-pointer rounded-[7px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                    >
                      已安装 · 配置
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => installMarketplacePlugin(pl.id)}
                      className="h-[28px] cursor-pointer rounded-[7px] bg-[var(--ink-primary)] px-3 text-[12px] font-semibold text-[var(--ink-on-primary)]"
                    >
                      + 安装插件
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "developer" && (
          <div className="flex flex-col gap-6 px-6 pt-6 lg:px-12">
            {/* Interactive Event Simulator */}
            <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--border-card)] bg-[var(--bg-surface)] p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="font-[family-name:var(--font-serif-zh)] text-[19px] font-semibold text-[var(--ink-strong)]">
                    事件调试器（Simulator）
                  </h2>
                  <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
                    向 Valet 事件总线注入一条真实模拟事件，触发 M8 抵达提示并同步至收件箱与时间线。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInstallModalOpen(true)}
                  className="h-[30px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                >
                  + 导入本地 Manifest
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--ink-muted)]">来源插件</span>
                  <SelectMenu
                    value={simPlugin?.id ?? ""}
                    options={installedPlugins.map((p) => ({ value: p.id, label: p.name }))}
                    onChange={(pid) => {
                      setSimPluginId(pid);
                      const next = installedPlugins.find((p) => p.id === pid);
                      if (next?.events[0]) setSimEventId(next.events[0].id);
                    }}
                    align="left"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--ink-muted)]">事件名</span>
                  <SelectMenu
                    value={simEventId}
                    options={(simPlugin?.events ?? []).map((e) => ({
                      value: e.id,
                      label: e.id,
                      hint: e.policy,
                    }))}
                    onChange={setSimEventId}
                    mono
                    align="left"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (simPlugin && simEventId) {
                      simulatePluginEvent(simPlugin.id, simEventId);
                      setActiveView("timeline");
                    }
                  }}
                  className="h-[30px] cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-4 text-[12px] font-semibold text-[var(--ink-on-primary)]"
                >
                  触发事件并前往时间线 →
                </button>
              </div>
            </div>

            {/* Manifest Spec */}
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--border-card)] bg-[var(--bg-surface)] p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                Manifest Schema · v0.1
              </div>
              <pre className="overflow-x-auto rounded-[10px] bg-[var(--bg-code)] p-4 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)]">
{`id: local.valet.dmg-sweeper
name: dmg 清扫员
version: 0.1.0
permissions: [full_disk]
events:
  - id: fs.file_created
    glob: "~/Downloads/*.dmg"
actions:
  - id: move_to_trash
    safety: reversible`}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Install Local Plugin Modal */}
      <Modal
        open={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        title="安装本地插件"
        subtitle="通过 Manifest YAML 创建并挂载一个本地事件监听器"
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">插件名称</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[13px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">目录 / 说明</span>
            <input
              type="text"
              value={newTagline}
              onChange={(e) => setNewTagline(e.target.value)}
              className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">
              manifest.yaml
            </span>
            <textarea
              rows={5}
              value={newYaml}
              onChange={(e) => setNewYaml(e.target.value)}
              className="rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-code)] p-3 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setInstallModalOpen(false)}
            className="h-[34px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-4 text-[13px] font-medium text-[var(--ink-strong)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              installCustomPlugin({
                name: newName,
                tagline: newTagline,
                yaml: newYaml,
              });
              setInstallModalOpen(false);
              setTab("installed");
            }}
            className="h-[34px] cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-4 text-[13px] font-semibold text-[var(--ink-on-primary)]"
          >
            安装并启用
          </button>
        </div>
      </Modal>
    </div>
  );
};
