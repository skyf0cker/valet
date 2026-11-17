import React, { useMemo, useState } from "react";
import { useValet } from "../../store/ValetContext";
import { PluginBadgeIcon, SearchIcon } from "../ui/Icons";
import { Modal } from "../ui/Modal";
import { SelectMenu } from "../ui/SelectMenu";
import { SparkBars } from "../ui/SparkBars";
import { Switch } from "../ui/Switch";
import { WorkspacePageHeader } from "../ui/WorkspacePageHeader";
import { PluginDetailView } from "./PluginDetailView";

type PluginsTab = "installed" | "discover" | "developer";

const PLUGIN_SOURCE_TEMPLATES = [
  {
    id: "webhook",
    label: "Webhook 推送",
    name: "Git 发布通知监听",
    tagline: "POST /events/<pluginId>/deploy.failed",
    yaml: `id: local.valet.deploy-guard
name: Git 发布通知监听
version: 0.1.0
triggers:
  - id: deploy.failed
    description: 外部 CI/脚本通过本地 Webhook 推送构建失败
    sensor: webhook
    policy: ask`,
    skillMarkdown: `### 事件说明
- 当部署脚本或 GitHub Actions POST 到本地 Webhook 时触发 \`deploy.failed\`。

### 处理流程
1. 读取 payload 中的 \`repo\`、\`branch\`、\`error\` 与 \`logUrl\`。
2. 如存在 \`logUrl\`，使用 \`bash\` (` + "`curl`" + `) 拉取只读构建日志并归纳失败原因。
3. 若需重试或写回仓库，执行变更命令时会自动向用户请求确认。`,
  },
  {
    id: "command_poll",
    label: "命令探针 command_poll",
    name: "Docker 失控容器巡检",
    tagline: "command_poll · 定期探针监测状态变化",
    yaml: `id: local.valet.docker-probe
name: Docker 失控容器巡检
version: 0.1.0
triggers:
  - id: docker.unhealthy
    description: 命令探针检测到容器状态变化或异常
    sensor: command_poll
    command: "docker ps --filter health=unhealthy --format '{{.Names}}'"
    interval_sec: 60
    emit_on: non_empty
    policy: ask`,
    skillMarkdown: `### 事件说明
- 每 60 秒运行 \`docker ps --filter health=unhealthy\`，输出非空时触发。

### 处理流程
1. 解析 payload 中的 \`stdout\`（异常容器名列表）。
2. 先用只读 \`docker logs --tail 50\` 查看报错日志；如需重启容器，调用 \`bash\` 请求用户批准后执行。`,
  },
  {
    id: "http_poll",
    label: "HTTP 轮询 http_poll",
    name: "本地服务健康检查",
    tagline: "http_poll · 定时拉取 HTTP/JSON 接口变化",
    yaml: `id: local.valet.service-health
name: 本地服务健康检查
version: 0.1.0
triggers:
  - id: service.status_changed
    description: HTTP 接口响应发生变化
    sensor: http_poll
    url: "http://127.0.0.1:8080/healthz"
    interval_sec: 60
    emit_on: change
    policy: record`,
    skillMarkdown: `### 处理流程
1. 检查 payload 中的 HTTP 状态码 \`status\` 与响应体 \`body\`。
2. 若状态非 200 或内容含错误关键字，使用只读诊断命令复核并提醒用户排查。`,
  },
  {
    id: "fs_watch",
    label: "文件监听 fs_watch",
    name: "下载目录安装包整理",
    tagline: "fs_watch · ~/Downloads/*.dmg",
    yaml: `id: local.valet.dmg-tidy
name: 下载目录安装包整理
version: 0.1.0
triggers:
  - id: fs.file_created
    description: 下载目录新增 .dmg 安装包
    sensor: fs_watch
    watch_dirs: [~/Downloads]
    ops: [create]
    glob: "*.dmg"
    policy: ask`,
    skillMarkdown: `### 处理流程
1. 获取触发事件中的新文件路径 \`path\`。
2. 检查 \`/Applications\` 确认对应应用是否已安装，必要时调用 \`trash_files\` 请求用户批准后移入废纸篓（7 天可还原）。`,
  },
  {
    id: "cron",
    label: "定时巡检 cron",
    name: "每日日志例行体检",
    tagline: "cron · 0 18 * * *",
    yaml: `id: local.valet.daily-check
name: 每日日志例行体检
version: 0.1.0
triggers:
  - id: daily.health_report
    description: 每日定时执行健康汇总
    sensor: cron
    schedule: "0 18 * * *"
    policy: auto`,
    skillMarkdown: `### 处理流程
1. 到达定时触发点后调用 \`system_overview\` 与 \`read_file\` 汇总当天关键诊断信息。
2. 输出简洁体检简报；如发现异常，使用 \`ask_user\` 或安全工具处理。`,
  },
];

export const PluginsView: React.FC = () => {
  const {
    state,
    sidebarCollapsed,
    openPluginDetail,
    togglePluginEnabled,
    installMarketplacePlugin,
    installCustomPlugin,
    fixPluginAuth,
    triggerCustomPluginEvent,
    pushToast,
    setActiveView,
  } = useValet();

  const [tab, setTab] = useState<PluginsTab>("installed");
  const [query, setQuery] = useState("");
  const [installModalOpen, setInstallModalOpen] = useState(false);

  // Install custom plugin form
  const defaultTemplate = PLUGIN_SOURCE_TEMPLATES[0]!;
  const [newName, setNewName] = useState(defaultTemplate.name);
  const [newTagline, setNewTagline] = useState(defaultTemplate.tagline);
  const [newYaml, setNewYaml] = useState(defaultTemplate.yaml);
  const [newSkill, setNewSkill] = useState(defaultTemplate.skillMarkdown);

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
  const [simPayloadJson, setSimPayloadJson] = useState<string>(
    '{"source":"manual_test","detail":"示例自定义负载"}'
  );
  const webhookBase = state.preferences.pluginRuntime.webhookEndpoint;

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
      {/* Sticky Workspace Header */}
      <WorkspacePageHeader
        compactTitle="插件"
        topActions={
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
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
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
        }
        kicker={`Plugins · ${installedPlugins.length} installed`}
        title={
          <>
            <span
              className={`font-[family-name:var(--font-serif-en)] font-normal italic ${
                sidebarCollapsed ? "text-[29px]" : "text-[30px] lg:text-[40px]"
              }`}
            >
              Valet
            </span>{" "}
            会响应的一切
          </>
        }
        metrics={[
          { value: totalEventsCount, label: "种事件" },
          {
            value: total24hTriggers,
            label: sidebarCollapsed ? "次 / 24h" : "次触发 / 24h",
          },
        ]}
        filterBarClassName={`flex gap-[18px] border-b border-[var(--border-light)] lg:gap-[22px] ${
          sidebarCollapsed ? "px-6 pt-3" : "px-6 pt-4 lg:px-12 lg:pt-5"
        }`}
        filterBar={
          <>
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
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {tab === "installed" && (
          <>
            {/* Sticky Table headers */}
            <div
              className={`sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/95 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-subtle)] backdrop-blur-xs lg:gap-4 ${
                sidebarCollapsed
                  ? "h-[30px] px-8"
                  : "h-9 px-8 xl:px-[60px]"
              }`}
            >
              <span className="flex-1">插件</span>
              <span className="w-[64px] shrink-0 lg:w-[72px]">类型</span>
              {!sidebarCollapsed && (
                <span className="hidden w-[92px] shrink-0 lg:inline">事件感知</span>
              )}
              <span className="w-[64px] shrink-0 lg:w-[100px]">24h 触发</span>
              <span className="w-[68px] shrink-0 text-right lg:w-[96px]">状态</span>
            </div>

            <div className={`flex flex-col ${sidebarCollapsed ? "px-6" : "px-6 xl:px-12"}`}>
              {filteredInstalled.map((plugin) => {
                return (
                  <div
                    key={plugin.id}
                    onClick={() => openPluginDetail(plugin.id)}
                    className={`group flex cursor-pointer items-center gap-3 border-t border-[var(--border-subtle)] transition-colors hover:rounded-[10px] hover:bg-[var(--bg-card-hover)] lg:gap-4 ${
                      sidebarCollapsed ? "h-[46px] px-2" : "h-[52px] px-2.5 lg:h-[58px] lg:px-3"
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
                            · {plugin.events.length} 事件
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

                    {/* Events count */}
                    {!sidebarCollapsed && (
                      <div className="hidden w-[92px] shrink-0 font-mono text-[12px] text-[var(--ink-strong)] lg:block">
                        {plugin.events.length}{" "}
                        <span className="text-[var(--ink-subtle)]">触发</span>
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
                  {`triggers:\n  - id: fs.file_created\n    sensor: fs_watch\nskill: | ...`}
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
            {/* Local Webhook Ingress Banner */}
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--border-card)] bg-[var(--bg-surface)] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-[family-name:var(--font-serif-zh)] text-[19px] font-semibold text-[var(--ink-strong)]">
                    本地事件接入网关（Webhook Ingress）
                  </h2>
                  <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
                    Git Hooks、快捷指令、外部监控或任意脚本均可向此回环端口 POST 自定义事件与 JSON Payload，触发插件 Skill 闭环执行。
                  </p>
                </div>
                {webhookBase && simPlugin && simEventId && (
                  <button
                    type="button"
                    onClick={() => {
                      const curlCmd = `curl -X POST "${webhookBase}/${simPlugin.id}/${simEventId}" -H "Content-Type: application/json" -d '${simPayloadJson || "{}"}'`;
                      void navigator.clipboard?.writeText(curlCmd);
                      pushToast("已复制 curl 事件推送命令", "success");
                    }}
                    className="h-[30px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                  >
                    复制 curl 命令
                  </button>
                )}
              </div>
              <div className="rounded-[8px] bg-[var(--bg-code)] px-3.5 py-2.5 font-mono text-[11.5px] text-[var(--ink-secondary)]">
                {webhookBase && simPlugin && simEventId
                  ? `POST ${webhookBase}/${simPlugin.id}/${simEventId}`
                  : "桌面客户端运行中将自动监听 127.0.0.1:41920/events/{pluginId}/{eventCode}"}
              </div>
            </div>

            {/* Interactive Event Simulator */}
            <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--border-card)] bg-[var(--bg-surface)] p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="font-[family-name:var(--font-serif-zh)] text-[19px] font-semibold text-[var(--ink-strong)]">
                    事件调试器（Simulator）
                  </h2>
                  <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
                    注入自定义事件与 Payload，验证插件 Skill 决策、动作执行及时间线/收件箱闭环。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInstallModalOpen(true)}
                  className="h-[30px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                >
                  + 创建自定义事件插件
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
                      hint: e.sensor ? `${e.sensor} · ${e.policy}` : e.policy,
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
                      triggerCustomPluginEvent(simPlugin.id, simEventId, simPayloadJson);
                      setActiveView("timeline");
                    }
                  }}
                  className="h-[30px] cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-4 text-[12px] font-semibold text-[var(--ink-on-primary)]"
                >
                  注入事件并前往时间线 →
                </button>
              </div>

              <label className="flex flex-col gap-1 pt-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                  自定义事件 Payload (JSON)
                </span>
                <input
                  type="text"
                  value={simPayloadJson}
                  onChange={(e) => setSimPayloadJson(e.target.value)}
                  placeholder='{"repo":"org/app","status":"failed"}'
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                />
              </label>
            </div>

            {/* valet CLI Quick Reference */}
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--border-card)] bg-[var(--bg-surface)] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-[family-name:var(--font-serif-zh)] text-[19px] font-semibold text-[var(--ink-strong)]">
                    valet CLI（插件脚手架与自配置命令行）
                  </h2>
                  <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
                    Agent 与开发者均可通过 valet CLI 创建、校验、热加载本地插件，或实时修改 Valet 配置；运行中桌面端会自动热更新。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const snippet = [
                      "valet plugin init ./my-plugin --template fs_watch",
                      "valet plugin validate ./my-plugin",
                      "valet plugin install ./my-plugin",
                      "valet plugin reload",
                      "valet plugin trigger my-plugin fs.file_created --payload '{\"path\":\"~/Downloads/test.dmg\"}'",
                      "valet config set appearance=dark heartbeat.intervalMin=15",
                    ].join("\n");
                    void navigator.clipboard?.writeText(snippet);
                    pushToast("已复制 valet CLI 示例命令", "success");
                  }}
                  className="h-[30px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                >
                  复制 CLI 示例
                </button>
              </div>
              <pre className="overflow-x-auto rounded-[10px] bg-[var(--bg-code)] p-4 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)]">
{`# 1. 初始化并校验本地插件目录（含 manifest.yaml + SKILL.md）
valet plugin init ./my-plugin --template command_poll
valet plugin validate ./my-plugin

# 2. 安装并热加载到 Valet 运行时，然后触发测试事件
valet plugin install ./my-plugin
valet plugin trigger my-plugin custom.event --payload '{"source":"cli"}'

# 3. 通过 CLI 查看与配置 Valet 自身
valet status --json
valet config show --section heartbeat
valet config set appearance=dark heartbeat.intervalMin=15`}
              </pre>
            </div>

            {/* Manifest + Skill Closed-Loop Schema */}
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--border-card)] bg-[var(--bg-surface)] p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                Pluggable Plugin Schema · Sensors + Config + Skill
              </div>
              <pre className="overflow-x-auto rounded-[10px] bg-[var(--bg-code)] p-4 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)]">
{`id: local.valet.deploy-guard
name: Git 发布守护
version: 0.1.0
triggers:
  - id: deploy.failed        # 自定义事件名（支持 fs_watch / command_poll / script_poll / http_poll / webhook / cron）
    sensor: webhook
    policy: ask
config_schema:
  - key: logWindowMin
    label: 回溯日志窗口（分钟）
    type: number
    default: 60
skill: |
  ### 处理流程（SKILL.md）
  1. 解析 webhook payload 中的 repo 与 error 摘要
  2. 使用 read_file / bash 只读排查原因；若需要修复或写入，通过统一安全门控向用户请求批准`}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Install Local Plugin Modal */}
      <Modal
        open={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        title="安装闭环自定义插件"
        subtitle="定义事件触发器（fs_watch / command_poll / script_poll / http_poll / webhook / cron）与 SKILL.md 处理逻辑"
      >
        <div className="flex max-h-[68vh] flex-col gap-3 overflow-y-auto pr-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-[var(--ink-muted)]">事件源模板：</span>
            {PLUGIN_SOURCE_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  setNewName(tpl.name);
                  setNewTagline(tpl.tagline);
                  setNewYaml(tpl.yaml);
                  setNewSkill(tpl.skillMarkdown);
                }}
                className="cursor-pointer rounded-full border border-[var(--border-control)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-strong)] hover:border-[var(--ink-primary)]"
              >
                {tpl.label}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">插件名称</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[13px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">目录 / 事件源说明</span>
            <input
              type="text"
              value={newTagline}
              onChange={(e) => setNewTagline(e.target.value)}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">
              manifest.yaml（事件触发器与配置声明）
            </span>
            <textarea
              rows={7}
              value={newYaml}
              onChange={(e) => setNewYaml(e.target.value)}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-code)] p-3 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">
              SKILL.md（Agent 处理逻辑与闭环指令）
            </span>
            <textarea
              rows={5}
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              placeholder="定义事件到来时 Agent 应如何分析 payload、调用工具并闭环处置…"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] p-3 font-mono text-[11.5px] leading-[18px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
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
                skillMarkdown: newSkill,
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
