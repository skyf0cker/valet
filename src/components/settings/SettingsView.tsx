import React, { useMemo, useState } from "react";
import { valetService } from "../../services/valetService";
import { useValet } from "../../store/ValetContext";
import type {
  AppearanceMode,
  AutonomyLevel,
  SettingsSectionId,
  ToneStyle,
} from "../../types/valet";
import { SidebarToggleButton } from "../Sidebar";
import { Kbd } from "../ui/Badge";
import { Checkbox } from "../ui/Checkbox";
import { BowtieSvg, SearchIcon } from "../ui/Icons";
import { Modal } from "../ui/Modal";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SelectMenu } from "../ui/SelectMenu";
import { Slider } from "../ui/Slider";
import { Switch } from "../ui/Switch";
import { TagInputList } from "../ui/TagInputList";
import {
  SettingGroupHeader,
  SettingRow,
  SettingsSectionCard,
} from "./SettingsSectionCard";

interface SectionMeta {
  id: SettingsSectionId;
  title: string;
  group: "Agent" | "Care" | "System";
  subtitle: string;
  keywords: string;
}

const SECTIONS: SectionMeta[] = [
  {
    id: "general",
    title: "通用",
    group: "Agent",
    subtitle: "启动、深浅主题外观与全局唤起方式",
    keywords: "通用 启动 外观 深色 浅色 自动 语言 快捷键 全局唤起",
  },
  {
    id: "models",
    title: "模型与服务商",
    group: "Agent",
    subtitle: "密钥安全存于 macOS 钥匙串，控制模型路由与每日预算上限",
    keywords: "模型 服务商 anthropic openai ollama gemini api key 花费 预算",
  },
  {
    id: "persona",
    title: "人格与指令",
    group: "Agent",
    subtitle: "决定 Valet 如何称呼你、使用什么语气以及常驻指令",
    keywords: "人格 称呼 语气 指令 custom instructions",
  },
  {
    id: "safety",
    title: "自主与安全",
    group: "Agent",
    subtitle: "决定 Valet 什么时候必须停下来征求你的批准",
    keywords: "自主 安全 确认 敏感操作 禁止 应用 紧急停止",
  },
  {
    id: "thresholds",
    title: "监控阈值",
    group: "Care",
    subtitle: "决定插件什么时候把事件交给 Valet。越敏感，事件越多。",
    keywords: "监控 阈值 磁盘 可用空间 缓存 大文件 cpu 内存 压力 忽略 进程 日志 灵敏度 节流",
  },
  {
    id: "cleanup",
    title: "清理策略",
    group: "Care",
    subtitle: "Valet 动手清理文件时遵守的还原机制与受保护目录，以及自动化规则。",
    keywords: "清理 策略 废纸篓 撤销 保留期 受保护目录 卸载 残留 自动化 定时",
  },
  {
    id: "runtime",
    title: "插件运行时",
    group: "Care",
    subtitle: "插件的沙箱隔离、本地开发热重载与事件限流（含 MCP 服务）。",
    keywords: "插件 运行时 沙箱 未签名 本地 热重载 事件 上限 安静时段 mcp",
  },
  {
    id: "permissions",
    title: "系统权限",
    group: "System",
    subtitle: "实时检测 macOS 隐私与安全性授权状态",
    keywords: "权限 磁盘 辅助功能 屏幕录制 自动化 通知 麦克风",
  },
  {
    id: "voice",
    title: "语音",
    group: "System",
    subtitle: "按住说话按键、本地离线唤醒词与朗读设置",
    keywords: "语音 唤醒词 朗读 fn 识别语言",
  },
  {
    id: "notifications",
    title: "通知",
    group: "System",
    subtitle: "决定 Valet 什么时候通过桌面通知联系你",
    keywords: "通知 确认 完成 失败 专注 勿扰",
  },
  {
    id: "memory",
    title: "记忆",
    group: "System",
    subtitle: "让 Valet 记住你的工程与偏好习惯，仅存本机",
    keywords: "记忆 学习 清空 管理",
  },
  {
    id: "privacy",
    title: "数据与隐私",
    group: "System",
    subtitle: "时间线记录、回放脱敏与本地存储占用",
    keywords: "数据 隐私 回放 模糊 敏感 占用 导出 清除",
  },
  {
    id: "shortcuts",
    title: "快捷键",
    group: "System",
    subtitle: "全工作区键盘导航与快捷指令参考",
    keywords: "快捷键 热键 键盘",
  },
  {
    id: "about",
    title: "关于 Valet",
    group: "System",
    subtitle: "版本信息、自动更新与初始化引导",
    keywords: "关于 版本 更新 引导 反馈",
  },
];

const COMPACT_PILLS: SettingsSectionId[] = [
  "general",
  "safety",
  "thresholds",
  "cleanup",
  "permissions",
];

export const SettingsView: React.FC = () => {
  const {
    state,
    isCompactViewport,
    sidebarCollapsed,
    setActiveSettingsSection,
    updatePreferences,
    resetThresholdsToDefault,
    updateModels,
    setAutonomyLevel,
    toggleAutomation,
    addAutomationRule,
    runAutomationNow,
    deleteAutomationRule,
    toggleMcpServer,
    reconnectMcpServer,
    addMcpServer,
    deleteMcpServer,
    deleteMemory,
    clearMemories,
    setPermissionGranted,
    refreshPermissions,
    resetOnboarding,
    resetAllData,
    togglePauseValet,
    selectProvider,
    updateProvider,
    pushToast,
  } = useValet();

  const [query, setQuery] = useState("");

  // Sub-modals
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);

  // Rule creation fields
  const [ruleWhen, setRuleWhen] = useState("每天 09:30");
  const [ruleTitle, setRuleTitle] = useState("检查昨日未处理的崩溃日志");
  const [ruleCronExpr, setRuleCronExpr] = useState("30 9 * * *");
  const [rulePrompt, setRulePrompt] = useState("检查过去 24 小时的诊断崩溃日志与磁盘空间，总结异常项。");

  // MCP creation fields
  const [mcpName, setMcpName] = useState("Filesystem");
  const [mcpTransportType, setMcpTransportType] = useState<"stdio" | "http">("stdio");
  const [mcpCommand, setMcpCommand] = useState("npx");
  const [mcpArgsText, setMcpArgsText] = useState("-y @modelcontextprotocol/server-filesystem ~/Downloads");
  const [mcpUrl, setMcpUrl] = useState("http://localhost:3100/mcp");

  // Inline provider credential state
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [verifyingProvider, setVerifyingProvider] = useState(false);
  const [testingProviderMsg, setTestingProviderMsg] = useState(false);
  const [providerTestReply, setProviderTestReply] = useState<string | null>(null);

  const { preferences } = state;
  const activeSectionId = state.activeSettingsSection;
  const activeSectionMeta =
    SECTIONS.find((s) => s.id === activeSectionId) ?? SECTIONS[4]!;

  const grantedPermCount = state.permissions.filter((p) => p.granted).length;
  const totalPermCount = state.permissions.length;

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.subtitle.toLowerCase().includes(q) ||
        s.keywords.toLowerCase().includes(q) ||
        s.group.toLowerCase().includes(q)
    );
  }, [query]);

  const activeProvider =
    state.providers.find((p) => p.id === preferences.activeProviderId) ??
    state.providers[0];
  const modelOptions = (
    activeProvider?.models ?? ["claude-opus-4", "claude-haiku-4"]
  ).map((m) => ({ value: m, label: m }));

  const spendPct = Math.min(
    100,
    Math.round((preferences.dailySpendCurrent / preferences.dailySpendLimit) * 100)
  );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `valet-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    pushToast("已导出本地配置与数据快照", "success");
  };

  const renderSectionBody = (secId: SettingsSectionId) => {
    switch (secId) {
      case "thresholds":
        return (
          <div className="flex flex-col gap-5">
            {/* Disk group */}
            <div className="flex flex-col gap-2">
              <SettingGroupHeader title="磁盘" source="磁盘守卫" />
              <SettingsSectionCard noHeader>
                <SettingRow first label="可用空间低于">
                  <div className="w-[170px] sm:w-[220px]">
                    <Slider
                      min={5}
                      max={40}
                      value={preferences.thresholds.diskLowSpacePct}
                      onChange={(val) =>
                        updatePreferences({
                          thresholds: {
                            ...preferences.thresholds,
                            diskLowSpacePct: val,
                          },
                        })
                      }
                      ariaLabel="可用空间低于阈值"
                    />
                  </div>
                  <span className="w-[42px] text-right font-mono text-[12px] font-semibold text-[var(--ink-strong)]">
                    {preferences.thresholds.diskLowSpacePct}%
                  </span>
                </SettingRow>

                <SettingRow label="缓存膨胀">
                  <span className="text-[12px] text-[var(--ink-muted)]">
                    7 天内增长超过
                  </span>
                  <SelectMenu
                    value={preferences.thresholds.cacheBloatGB}
                    mono
                    options={[
                      { value: "1 GB", label: "1 GB" },
                      { value: "3 GB", label: "3 GB" },
                      { value: "5 GB", label: "5 GB" },
                      { value: "10 GB", label: "10 GB" },
                      { value: "20 GB", label: "20 GB" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        thresholds: { ...preferences.thresholds, cacheBloatGB: v },
                      })
                    }
                  />
                </SettingRow>

                <SettingRow label="大文件">
                  <span className="text-[12px] text-[var(--ink-muted)]">大于</span>
                  <SelectMenu
                    value={preferences.thresholds.largeFileSizeGB}
                    mono
                    options={[
                      { value: "500 MB", label: "500 MB" },
                      { value: "1 GB", label: "1 GB" },
                      { value: "2 GB", label: "2 GB" },
                      { value: "5 GB", label: "5 GB" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        thresholds: { ...preferences.thresholds, largeFileSizeGB: v },
                      })
                    }
                  />
                  <span className="text-[12px] text-[var(--ink-muted)]">且</span>
                  <SelectMenu
                    value={preferences.thresholds.largeFileIdleDays}
                    mono
                    options={[
                      { value: "30 天", label: "30 天" },
                      { value: "60 天", label: "60 天" },
                      { value: "90 天", label: "90 天" },
                      { value: "180 天", label: "180 天" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        thresholds: { ...preferences.thresholds, largeFileIdleDays: v },
                      })
                    }
                  />
                  <span className="text-[12px] text-[var(--ink-muted)]">未打开</span>
                </SettingRow>
              </SettingsSectionCard>
            </div>

            {/* CPU & Memory group */}
            <div className="flex flex-col gap-2">
              <SettingGroupHeader title="CPU 与内存" source="进程哨兵" />
              <SettingsSectionCard noHeader>
                <SettingRow first label="进程 CPU 异常">
                  <span className="text-[12px] text-[var(--ink-muted)]">
                    持续高于
                  </span>
                  <SelectMenu
                    value={preferences.thresholds.cpuSpikePct}
                    mono
                    options={[
                      { value: "120%", label: "120%" },
                      { value: "150%", label: "150%" },
                      { value: "200%", label: "200%" },
                      { value: "300%", label: "300%" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        thresholds: { ...preferences.thresholds, cpuSpikePct: v },
                      })
                    }
                  />
                  <span className="text-[12px] text-[var(--ink-muted)]">超过</span>
                  <SelectMenu
                    value={preferences.thresholds.cpuSpikeDuration}
                    mono
                    options={[
                      { value: "1 分钟", label: "1 分钟" },
                      { value: "3 分钟", label: "3 分钟" },
                      { value: "5 分钟", label: "5 分钟" },
                      { value: "10 分钟", label: "10 分钟" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        thresholds: { ...preferences.thresholds, cpuSpikeDuration: v },
                      })
                    }
                  />
                </SettingRow>

                <SettingRow label="内存压力提醒">
                  <SegmentedControl<"yellow" | "red">
                    value={preferences.thresholds.memoryPressureLevel}
                    onChange={(v) =>
                      updatePreferences({
                        thresholds: {
                          ...preferences.thresholds,
                          memoryPressureLevel: v,
                        },
                      })
                    }
                    options={[
                      { value: "yellow", label: "黄色" },
                      { value: "red", label: "红色" },
                    ]}
                  />
                </SettingRow>

                <SettingRow
                  label="忽略的进程"
                  description="这些进程高占用是正常的"
                >
                  <TagInputList
                    items={preferences.thresholds.ignoredProcesses}
                    mono
                    addButtonLabel="+"
                    placeholder="进程名"
                    onChange={(next) =>
                      updatePreferences({
                        thresholds: {
                          ...preferences.thresholds,
                          ignoredProcesses: next,
                        },
                      })
                    }
                  />
                </SettingRow>
              </SettingsSectionCard>
            </div>

            {/* Log & Event Throttling group */}
            <div className="flex flex-col gap-2">
              <SettingGroupHeader
                title="日志与事件节流"
                source="日志侦探 · 所有插件"
              />
              <SettingsSectionCard noHeader>
                <SettingRow first label="日志异常灵敏度">
                  <SegmentedControl<"low" | "medium" | "high">
                    value={preferences.thresholds.logSensitivity}
                    onChange={(v) =>
                      updatePreferences({
                        thresholds: { ...preferences.thresholds, logSensitivity: v },
                      })
                    }
                    options={[
                      { value: "low", label: "低" },
                      { value: "medium", label: "中" },
                      { value: "high", label: "高" },
                    ]}
                  />
                </SettingRow>

                <SettingRow
                  label="同一事件 10 分钟内只响应一次"
                  description="防止插件打出「事件风暴」消耗额度"
                >
                  <Switch
                    checked={preferences.thresholds.eventThrottle10m}
                    onChange={(v) =>
                      updatePreferences({
                        thresholds: {
                          ...preferences.thresholds,
                          eventThrottle10m: v,
                        },
                      })
                    }
                    ariaLabel="同一事件 10 分钟内只响应一次"
                  />
                </SettingRow>
              </SettingsSectionCard>
            </div>
          </div>
        );

      case "cleanup":
        return (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <SettingGroupHeader title="删除与还原" source="磁盘守卫 · 卸载清道夫" />
              <SettingsSectionCard noHeader>
                <SettingRow first label="删除方式">
                  <SelectMenu
                    value={preferences.cleanupPolicy.deleteMethod}
                    options={[
                      { value: "移入废纸篓", label: "移入废纸篓" },
                      { value: "安全移出到隔离区", label: "安全移出到隔离区" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        cleanupPolicy: {
                          ...preferences.cleanupPolicy,
                          deleteMethod: v,
                        },
                      })
                    }
                  />
                </SettingRow>

                <SettingRow label="撤销保留期">
                  <SelectMenu
                    value={preferences.cleanupPolicy.restoreRetentionDays}
                    options={[
                      { value: "3 天", label: "3 天" },
                      { value: "7 天", label: "7 天" },
                      { value: "14 天", label: "14 天" },
                      { value: "30 天", label: "30 天" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        cleanupPolicy: {
                          ...preferences.cleanupPolicy,
                          restoreRetentionDays: v,
                        },
                      })
                    }
                  />
                </SettingRow>

                <SettingRow
                  label="受保护目录"
                  description="自动扫描与一键清理都会永久跳过以下目录"
                >
                  <TagInputList
                    items={preferences.cleanupPolicy.protectedDirs}
                    mono
                    addButtonLabel="+ 添加目录"
                    placeholder="~/Path"
                    onChange={(next) =>
                      updatePreferences({
                        cleanupPolicy: {
                          ...preferences.cleanupPolicy,
                          protectedDirs: next,
                        },
                      })
                    }
                  />
                </SettingRow>

                <SettingRow
                  label="卸载后自动扫描残留"
                  description="保留含用户文件的目录"
                >
                  <Switch
                    checked={preferences.cleanupPolicy.autoScanAfterUninstall}
                    onChange={(v) =>
                      updatePreferences({
                        cleanupPolicy: {
                          ...preferences.cleanupPolicy,
                          autoScanAfterUninstall: v,
                        },
                      })
                    }
                    ariaLabel="卸载后自动扫描残留"
                  />
                </SettingRow>
              </SettingsSectionCard>
            </div>

            <div className="flex flex-col gap-2">
              <SettingGroupHeader
                title="定时与事件自动化"
                rightAction={
                  <button
                    type="button"
                    onClick={() => setRuleModalOpen(true)}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-2.5 text-[11px] font-semibold text-[var(--ink-on-primary)]"
                  >
                    + 新建规则
                  </button>
                }
              />
              <SettingsSectionCard noHeader>
                {state.automations.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12px] text-[var(--ink-muted)]">
                    暂无定时或事件自动化规则，点击右上角「+ 新建规则」创建一个真实定时任务
                  </div>
                ) : (
                  state.automations.map((rule, idx) => (
                    <div
                      key={rule.id}
                      className={`flex items-center gap-3 px-4 py-3 ${
                        idx > 0 ? "border-t border-[var(--border-light)]" : ""
                      }`}
                    >
                      <div className="w-[62px] shrink-0 font-mono text-[11px] leading-[15px] text-[var(--ink-strong)]">
                        <div>{rule.scheduleTop}</div>
                        <div>{rule.scheduleBottom}</div>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[13px] font-medium text-[var(--ink-strong)]">
                          {rule.title}
                        </span>
                        <span className="truncate text-[11px] text-[var(--ink-subtle)]">
                          {[
                            rule.cronExpr ? `cron: ${rule.cronExpr}` : "",
                            rule.subtitle ?? "",
                            rule.lastRunAt ? `上次运行 ${rule.lastRunAt}` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => runAutomationNow(rule.id)}
                        className="inline-flex h-6 shrink-0 cursor-pointer items-center rounded-[6px] border border-[var(--border-control)] px-2 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                      >
                        立即运行
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteAutomationRule(rule.id)}
                        className="inline-flex h-6 shrink-0 cursor-pointer items-center rounded-[6px] px-2 text-[11px] text-[var(--ink-muted)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                      >
                        删除
                      </button>
                      <Switch
                        checked={rule.enabled}
                        onChange={() => toggleAutomation(rule.id)}
                        ariaLabel={`切换自动化 ${rule.title}`}
                      />
                    </div>
                  ))
                )}
              </SettingsSectionCard>
            </div>
          </div>
        );

      case "runtime":
        return (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <SettingGroupHeader title="沙箱与限流" />
              <SettingsSectionCard noHeader>
                <SettingRow first label="插件沙箱隔离">
                  <Switch
                    checked={preferences.pluginRuntime.sandboxIsolation}
                    onChange={(v) =>
                      updatePreferences({
                        pluginRuntime: {
                          ...preferences.pluginRuntime,
                          sandboxIsolation: v,
                        },
                      })
                    }
                    ariaLabel="插件沙箱隔离"
                  />
                </SettingRow>

                <SettingRow
                  label="允许未签名的本地插件"
                  description="开发模式 · 支持热重载"
                >
                  <Switch
                    checked={preferences.pluginRuntime.allowUnsignedLocal}
                    onChange={(v) =>
                      updatePreferences({
                        pluginRuntime: {
                          ...preferences.pluginRuntime,
                          allowUnsignedLocal: v,
                        },
                      })
                    }
                    ariaLabel="允许未签名的本地插件"
                  />
                </SettingRow>

                <SettingRow label="单插件事件上限">
                  <SelectMenu
                    value={preferences.pluginRuntime.maxEventsPerHour}
                    mono
                    options={[
                      { value: "30 / 小时", label: "30 / 小时" },
                      { value: "60 / 小时", label: "60 / 小时" },
                      { value: "120 / 小时", label: "120 / 小时" },
                      { value: "无限制", label: "无限制" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        pluginRuntime: {
                          ...preferences.pluginRuntime,
                          maxEventsPerHour: v,
                        },
                      })
                    }
                  />
                </SettingRow>

                <SettingRow label="安静时段">
                  <SelectMenu
                    value={preferences.pluginRuntime.quietHours}
                    mono
                    options={[
                      { value: "23:30 – 08:00", label: "23:30 – 08:00" },
                      { value: "22:00 – 07:00", label: "22:00 – 07:00" },
                      { value: "00:00 – 09:00", label: "00:00 – 09:00" },
                      { value: "关闭", label: "关闭" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        pluginRuntime: {
                          ...preferences.pluginRuntime,
                          quietHours: v,
                        },
                      })
                    }
                  />
                </SettingRow>
              </SettingsSectionCard>
            </div>

            <div className="flex flex-col gap-2">
              <SettingGroupHeader
                title="MCP 服务器"
                rightAction={
                  <button
                    type="button"
                    onClick={() => setMcpModalOpen(true)}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                  >
                    + 添加服务器
                  </button>
                }
              />
              <SettingsSectionCard noHeader>
                {state.mcpServers.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12px] text-[var(--ink-muted)]">
                    暂未接入任何外部 MCP 服务器，点击右上角「+ 添加服务器」连接 stdio / HTTP MCP 工具
                  </div>
                ) : (
                  state.mcpServers.map((srv, idx) => (
                    <div
                      key={srv.id}
                      className={`flex items-center gap-2.5 px-4 py-[11px] ${
                        idx > 0 ? "border-t border-[var(--border-light)]" : ""
                      }`}
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-[var(--bg-muted)] font-mono text-[10px] text-[var(--ink-strong)]">
                        {srv.abbr}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-[var(--ink-strong)]">
                          {srv.name}
                        </div>
                        {srv.authExpired || srv.statusError ? (
                          <button
                            type="button"
                            onClick={() => reconnectMcpServer(srv.id)}
                            className="cursor-pointer font-mono text-[10px] text-[var(--danger)] hover:underline"
                          >
                            {srv.statusError ? `${srv.statusError} · 重试握手` : "连接异常 · 重新握手"}
                          </button>
                        ) : (
                          <div className="font-mono text-[10px] text-[var(--ink-subtle)]">
                            {srv.transportLabel}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteMcpServer(srv.id)}
                        className="inline-flex h-6 shrink-0 cursor-pointer items-center rounded-[6px] px-2 text-[11px] text-[var(--ink-muted)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                      >
                        删除
                      </button>
                      <Switch
                        checked={srv.enabled}
                        onChange={() => toggleMcpServer(srv.id)}
                        ariaLabel={`切换 ${srv.name}`}
                      />
                    </div>
                  ))
                )}
              </SettingsSectionCard>
            </div>
          </div>
        );

      case "general":
        return (
          <SettingsSectionCard noHeader>
            <SettingRow first label="登录时自动启动">
              <Switch
                checked={preferences.launchAtLogin}
                onChange={(v) => updatePreferences({ launchAtLogin: v })}
                ariaLabel="登录时自动启动"
              />
            </SettingRow>
            <SettingRow label="在菜单栏显示图标">
              <Switch
                checked={preferences.showMenuBarIcon}
                onChange={(v) => updatePreferences({ showMenuBarIcon: v })}
                ariaLabel="在菜单栏显示图标"
              />
            </SettingRow>
            <SettingRow label="外观">
              <SegmentedControl<AppearanceMode>
                value={preferences.appearance}
                onChange={(v) => updatePreferences({ appearance: v })}
                options={[
                  { value: "light", label: "浅色" },
                  { value: "dark", label: "深色" },
                  { value: "auto", label: "自动" },
                ]}
              />
            </SettingRow>
            <SettingRow label="语言">
              <SelectMenu
                value={preferences.language}
                onChange={(v) => updatePreferences({ language: v })}
                options={[
                  { value: "简体中文", label: "简体中文" },
                  { value: "English", label: "English" },
                ]}
              />
            </SettingRow>
            <SettingRow
              label="全局唤起"
              description="在任何应用中弹出迷你输入框"
            >
              <Kbd keys={preferences.globalHotkey} />
            </SettingRow>
          </SettingsSectionCard>
        );

      case "models":
        return (
          <SettingsSectionCard noHeader>
            {state.providers.map((prov, idx) => {
              const active = prov.id === preferences.activeProviderId;
              const configured = Boolean(prov.apiKey?.trim()) || prov.verified;
              return (
                <div
                  key={prov.id}
                  onClick={() => {
                    selectProvider(prov.id);
                    setProviderTestReply(null);
                  }}
                  className={`flex cursor-pointer items-center gap-2.5 px-4 py-[11px] hover:bg-[var(--bg-card-hover)] ${
                    idx > 0 ? "border-t border-[var(--border-light)]" : ""
                  } ${active ? "bg-[var(--bg-subtle)]" : ""}`}
                >
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] font-[family-name:var(--font-serif-en)] text-[15px] italic ${
                      active
                        ? "bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                        : "bg-[var(--bg-muted)] text-[var(--ink-strong)]"
                    }`}
                  >
                    {prov.letter}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[var(--ink-strong)]">
                      {prov.name}
                    </div>
                    <div className="truncate font-mono text-[10px] text-[var(--ink-subtle)]">
                      {prov.apiKeyMasked || prov.baseUrl || prov.endpoint || prov.subtitle}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        prov.verified
                          ? "bg-[var(--ink-primary)]"
                          : configured
                            ? "bg-[var(--amber-icon)]"
                            : "border border-[var(--ink-faint)]"
                      }`}
                    />
                    <span
                      className={
                        prov.verified || active
                          ? "text-[var(--ink-strong)]"
                          : "text-[var(--ink-subtle)]"
                      }
                    >
                      {prov.verified
                        ? `已验证${prov.latencyMs ? ` · ${prov.latencyMs}ms` : ""}`
                        : configured
                          ? "已配置 · 待验证"
                          : "待配置"}
                    </span>
                  </div>
                </div>
              );
            })}

            {activeProvider && (
              <div className="flex flex-col gap-3 border-t border-[var(--border-light)] bg-[var(--bg-subtle)] px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-[var(--ink-strong)]">
                    {activeProvider.name} · 凭据与端点配置
                  </span>
                  {activeProvider.id !== "ollama" && (
                    <button
                      type="button"
                      onClick={() => setShowProviderKey((v) => !v)}
                      className="cursor-pointer text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                    >
                      {showProviderKey ? "隐藏 Key" : "显示 Key"}
                    </button>
                  )}
                </div>

                {activeProvider.id !== "ollama" && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--ink-muted)]">API Key（写入 macOS 钥匙串）</span>
                    <input
                      type={showProviderKey ? "text" : "password"}
                      value={activeProvider.apiKey}
                      onChange={(e) =>
                        updateProvider(activeProvider.id, {
                          apiKey: e.target.value,
                          apiKeyMasked: e.target.value
                            ? `${e.target.value.slice(0, 6)}••••${e.target.value.slice(-4)}`
                            : "",
                          verified: false,
                        })
                      }
                      placeholder={
                        activeProvider.id === "anthropic"
                          ? "sk-ant-..."
                          : activeProvider.id === "openai"
                            ? "sk-..."
                            : "输入服务商 API Key"
                      }
                      className="h-[32px] rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                    />
                  </label>
                )}

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--ink-muted)]">
                      {activeProvider.id === "ollama" ? "本地节点 Endpoint" : "Base URL（可选覆写）"}
                    </span>
                    <input
                      type="text"
                      value={activeProvider.baseUrl || activeProvider.endpoint}
                      onChange={(e) =>
                        updateProvider(activeProvider.id, {
                          baseUrl: e.target.value,
                          endpoint: e.target.value,
                        })
                      }
                      placeholder={
                        activeProvider.id === "ollama"
                          ? "http://localhost:11434"
                          : "使用默认官方端点"
                      }
                      className="h-[30px] rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[11px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--ink-muted)]">Proxy / Org ID</span>
                    <input
                      type="text"
                      value={activeProvider.proxyUrl}
                      onChange={(e) =>
                        updateProvider(activeProvider.id, { proxyUrl: e.target.value })
                      }
                      placeholder="http://127.0.0.1:7890"
                      className="h-[30px] rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[11px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={verifyingProvider}
                    onClick={async () => {
                      setVerifyingProvider(true);
                      setProviderTestReply(null);
                      try {
                        const res = await valetService.verifyProvider(activeProvider);
                        if (res.ok) {
                          const discovered =
                            res.models && res.models.length > 0
                              ? res.models
                              : activeProvider.models;
                          updateProvider(activeProvider.id, {
                            verified: true,
                            connected: true,
                            latencyMs: res.latencyMs,
                            availableModelCount: res.modelCount || discovered.length,
                            models: discovered,
                          });
                        } else {
                          updateProvider(activeProvider.id, {
                            verified: false,
                            connected: false,
                            latencyMs: res.latencyMs,
                          });
                          setProviderTestReply(`验证失败：${res.message}`);
                        }
                        pushToast(res.message, res.ok ? "success" : "warning");
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        setProviderTestReply(`验证失败：${msg}`);
                        pushToast(msg, "danger");
                      } finally {
                        setVerifyingProvider(false);
                      }
                    }}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-3 text-[11px] font-semibold text-[var(--ink-on-primary)] disabled:opacity-60"
                  >
                    {verifyingProvider ? "验证中…" : "验证连接并刷新模型"}
                  </button>

                  <button
                    type="button"
                    disabled={testingProviderMsg}
                    onClick={async () => {
                      setTestingProviderMsg(true);
                      setProviderTestReply(null);
                      try {
                        const res = await valetService.sendTestAgentMessage(
                          activeProvider,
                          preferences.models.primary
                        );
                        setProviderTestReply(res.reply);
                        pushToast(res.reply, res.ok ? "success" : "warning");
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        setProviderTestReply(`测试失败：${msg}`);
                        pushToast(msg, "danger");
                      } finally {
                        setTestingProviderMsg(false);
                      }
                    }}
                    className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-card-hover)] disabled:opacity-60"
                  >
                    {testingProviderMsg ? "请求中…" : "发送测试消息"}
                  </button>
                </div>

                {providerTestReply && (
                  <div className="rounded-[7px] border border-[var(--border-light)] bg-[var(--bg-canvas)] px-3 py-2 font-mono text-[11px] text-[var(--ink-secondary)]">
                    {providerTestReply}
                  </div>
                )}
              </div>
            )}

            <SettingRow label="主模型" tinted>
              <SelectMenu
                value={preferences.models.primary}
                options={modelOptions}
                onChange={(v) => updateModels({ primary: v })}
                mono
              />
            </SettingRow>
            <SettingRow label="快速模型" tinted>
              <SelectMenu
                value={preferences.models.fast}
                options={modelOptions}
                onChange={(v) => updateModels({ fast: v })}
                mono
              />
            </SettingRow>
            <SettingRow label="视觉模型" tinted>
              <SelectMenu
                value={preferences.models.vision}
                options={[{ value: "同主模型", label: "同主模型" }, ...modelOptions]}
                onChange={(v) => updateModels({ vision: v })}
              />
            </SettingRow>

            <div className="flex flex-col gap-2.5 border-t border-[var(--border-light)] px-4 py-3.5">
              <div className="flex justify-between">
                <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                  每日花费上限
                </span>
                <span className="font-mono text-[12px] text-[var(--ink-strong)]">
                  ¥{preferences.dailySpendCurrent.toFixed(2)} / ¥
                  {preferences.dailySpendLimit}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-[2px] bg-[var(--bg-track)]">
                <div
                  className="h-full rounded-[2px] bg-[var(--ink-primary)]"
                  style={{ width: `${spendPct}%` }}
                />
              </div>
            </div>

            <SettingRow label="单任务最大步数" description="超过后暂停并询问">
              <input
                type="number"
                min={5}
                max={200}
                value={preferences.maxStepsPerTask}
                onChange={(e) =>
                  updatePreferences({
                    maxStepsPerTask: Math.max(5, Number(e.target.value) || 50),
                  })
                }
                className="h-7 w-16 rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] text-center font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
              />
            </SettingRow>
          </SettingsSectionCard>
        );

      case "persona":
        return (
          <SettingsSectionCard noHeader>
            <SettingRow first label="称呼">
              <input
                type="text"
                value={preferences.userNickname}
                onChange={(e) => updatePreferences({ userNickname: e.target.value })}
                className="h-7 w-[140px] rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2.5 text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
              />
            </SettingRow>
            <SettingRow label="语气">
              <SegmentedControl<ToneStyle>
                value={preferences.toneStyle}
                onChange={(v) => updatePreferences({ toneStyle: v })}
                options={[
                  { value: "formal", label: "严谨" },
                  { value: "concise", label: "简洁" },
                  { value: "friendly", label: "亲切" },
                ]}
              />
            </SettingRow>
            <div className="flex flex-col gap-2 border-t border-[var(--border-light)] px-4 py-3.5">
              <div className="flex justify-between">
                <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                  自定义指令
                </span>
                <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                  {preferences.customInstructions.length} / 2000
                </span>
              </div>
              <textarea
                rows={4}
                maxLength={2000}
                value={preferences.customInstructions}
                onChange={(e) =>
                  updatePreferences({ customInstructions: e.target.value })
                }
                className="min-h-[104px] w-full resize-y rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 py-2.5 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)] outline-none focus:border-[var(--ink-primary)]"
              />
            </div>
          </SettingsSectionCard>
        );

      case "safety":
        return (
          <SettingsSectionCard noHeader critical>
            <div className="flex flex-col gap-2 px-4 py-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                  自主程度
                </span>
                <span className="rounded-[4px] bg-[var(--ink-primary)] px-1.5 py-[2px] font-mono text-[9px] tracking-[0.12em] text-[var(--ink-on-primary)]">
                  CRITICAL
                </span>
              </div>
              <SegmentedControl<AutonomyLevel>
                fullWidth
                value={preferences.autonomyLevel}
                onChange={setAutonomyLevel}
                options={[
                  { value: "always_ask", label: "每步询问" },
                  { value: "sensitive_only", label: "敏感操作询问" },
                  { value: "autonomous", label: "完全自主" },
                ]}
              />
            </div>

            <div className="flex flex-col gap-[9px] border-t border-[var(--border-light)] px-4 py-3.5">
              <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                以下操作始终需要确认
              </span>
              {(
                [
                  { key: "deleteOrOverwrite", label: "删除或覆盖文件" },
                  { key: "sendMessageOrEmail", label: "发送消息、邮件" },
                  { key: "paymentOrSubscription", label: "付款、下单、订阅" },
                  { key: "runTerminalCommand", label: "执行终端命令" },
                  { key: "modifySystemSettings", label: "修改系统设置" },
                ] as const
              ).map((item) => {
                const checked = preferences.confirmChecklist[item.key];
                return (
                  <div
                    key={item.key}
                    onClick={() =>
                      updatePreferences({
                        confirmChecklist: {
                          ...preferences.confirmChecklist,
                          [item.key]: !checked,
                        },
                      })
                    }
                    className="flex cursor-pointer items-center gap-2.5"
                  >
                    <Checkbox
                      size="md"
                      checked={checked}
                      onChange={(val) =>
                        updatePreferences({
                          confirmChecklist: {
                            ...preferences.confirmChecklist,
                            [item.key]: val,
                          },
                        })
                      }
                    />
                    <span
                      className={`text-[12px] ${
                        checked
                          ? "text-[var(--ink-strong)]"
                          : "text-[var(--ink-muted)]"
                      }`}
                    >
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 border-t border-[var(--border-light)] px-4 py-3.5">
              <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                禁止操作的应用
              </span>
              <TagInputList
                items={preferences.blockedApps}
                onChange={(next) => updatePreferences({ blockedApps: next })}
                placeholder="输入应用名后回车"
              />
            </div>

            <button
              type="button"
              onClick={togglePauseValet}
              className="flex w-full cursor-pointer items-center gap-3 border-t border-[var(--border-light)] bg-[var(--ink-primary)] px-4 py-3 text-left text-[var(--ink-on-primary)] transition-opacity hover:opacity-95"
            >
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-semibold">
                  {state.isPaused ? "恢复 Valet 运行" : "紧急停止"}
                </span>
                <span className="text-[11px] opacity-65">
                  立即中止所有动作并释放鼠标键盘
                </span>
              </div>
              <Kbd keys={preferences.emergencyStopShortcut} dark />
            </button>
          </SettingsSectionCard>
        );

      case "permissions":
        return (
          <SettingsSectionCard noHeader>
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <span className="font-mono text-[12px] text-[var(--ink-muted)]">
                {grantedPermCount} / {totalPermCount} 已授权 · 实时检测
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={refreshPermissions}
                  className="cursor-pointer text-[12px] font-medium text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                >
                  重新检测
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void valetService.openSystemSettings("full_disk").then((res) => {
                      pushToast(
                        res.opened
                          ? "已打开系统设置 › 隐私与安全性"
                          : "当前环境无法唤起系统设置"
                      );
                    });
                  }}
                  className="cursor-pointer text-[12px] font-medium text-[var(--ink-strong)] hover:underline"
                >
                  打开系统设置 ↗
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 border-t border-[var(--border-light)] sm:grid-cols-2">
              {state.permissions.map((perm, idx) => {
                const isLeftCol = idx % 2 === 0;
                const isLastRow = idx >= state.permissions.length - 2;
                return (
                  <div
                    key={perm.id}
                    className={`flex items-center gap-2.5 px-4 py-3.5 ${
                      isLeftCol ? "sm:border-r sm:border-[var(--border-light)]" : ""
                    } ${!isLastRow ? "border-b border-[var(--border-light)]" : ""}`}
                  >
                    <span
                      className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                        perm.granted
                          ? "bg-[var(--ink-primary)]"
                          : perm.tier === "required"
                            ? "border-[1.5px] border-[var(--ink-faint)]"
                            : "border-[1.5px] border-[var(--amber-icon)]"
                      }`}
                    />
                    <span className="flex-1 truncate text-[12.5px] font-medium text-[var(--ink-strong)]">
                      {perm.name}
                    </span>
                    {perm.granted ? (
                      <button
                        type="button"
                        onClick={() => setPermissionGranted(perm.id, false)}
                        className="cursor-pointer text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                        title="点击模拟撤销"
                      >
                        已授权
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setPermissionGranted(perm.id, true);
                          pushToast(`已授权「${perm.name}」`, "success");
                        }}
                        className="cursor-pointer text-[11px] font-semibold text-[var(--ink-strong)] underline underline-offset-2"
                      >
                        授权
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </SettingsSectionCard>
        );

      case "voice":
        return (
          <SettingsSectionCard noHeader>
            <SettingRow first label="按住说话">
              <Kbd keys={[preferences.holdToSpeakKey]} />
            </SettingRow>
            <SettingRow
              label="唤醒词「嘿 Valet」"
              description="本地离线识别，不上传音频"
            >
              <Switch
                checked={preferences.wakeWordEnabled}
                onChange={(v) => updatePreferences({ wakeWordEnabled: v })}
                ariaLabel="唤醒词嘿 Valet"
              />
            </SettingRow>
            <SettingRow label="识别语言">
              <SelectMenu
                value={preferences.speechLanguage}
                onChange={(v) => updatePreferences({ speechLanguage: v })}
                options={[
                  { value: "中文 + English", label: "中文 + English" },
                  { value: "仅中文", label: "仅中文" },
                  { value: "English", label: "English" },
                ]}
              />
            </SettingRow>
            <SettingRow label="朗读回复">
              <SelectMenu
                value={preferences.speakReplies}
                onChange={(v) => updatePreferences({ speakReplies: v })}
                options={[
                  { value: "仅语音提问时", label: "仅语音提问时" },
                  { value: "始终朗读", label: "始终朗读" },
                  { value: "关闭", label: "关闭" },
                ]}
              />
            </SettingRow>
          </SettingsSectionCard>
        );

      case "notifications":
        return (
          <SettingsSectionCard noHeader>
            <SettingRow first label="需要确认时">
              <Switch
                checked={preferences.notifyOnConfirm}
                onChange={(v) => updatePreferences({ notifyOnConfirm: v })}
                ariaLabel="需要确认时通知"
              />
            </SettingRow>
            <SettingRow label="任务完成">
              <Switch
                checked={preferences.notifyOnComplete}
                onChange={(v) => updatePreferences({ notifyOnComplete: v })}
                ariaLabel="任务完成通知"
              />
            </SettingRow>
            <SettingRow label="任务失败">
              <Switch
                checked={preferences.notifyOnFailure}
                onChange={(v) => updatePreferences({ notifyOnFailure: v })}
                ariaLabel="任务失败通知"
              />
            </SettingRow>
            <SettingRow
              label="跟随专注模式"
              description="勿扰时仅保留「需要确认」"
            >
              <Switch
                checked={preferences.followFocusMode}
                onChange={(v) => updatePreferences({ followFocusMode: v })}
                ariaLabel="跟随专注模式"
              />
            </SettingRow>
          </SettingsSectionCard>
        );

      case "memory":
        return (
          <SettingsSectionCard noHeader>
            <SettingRow first label="启用长期记忆">
              <Switch
                checked={preferences.memoryEnabled}
                onChange={(v) => updatePreferences({ memoryEnabled: v })}
                ariaLabel="启用长期记忆"
              />
            </SettingRow>
            <SettingRow
              label="从对话中自动学习"
              description="新记忆会先征求你的同意"
            >
              <Switch
                checked={preferences.autoLearnMemory}
                onChange={(v) => updatePreferences({ autoLearnMemory: v })}
                ariaLabel="从对话中自动学习"
              />
            </SettingRow>
            <div className="flex items-center gap-3 border-t border-[var(--border-light)] px-4 py-3.5">
              <div className="flex flex-1 items-baseline gap-2">
                <span className="font-[family-name:var(--font-serif-en)] text-[26px] leading-[28px] text-[var(--ink-strong)]">
                  {state.memories.length}
                </span>
                <span className="text-[12px] text-[var(--ink-muted)]">条记忆</span>
              </div>
              <button
                type="button"
                onClick={() => setMemoryModalOpen(true)}
                className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
              >
                管理
              </button>
              <button
                type="button"
                onClick={clearMemories}
                className="inline-flex h-7 cursor-pointer items-center rounded-[7px] px-2.5 text-[12px] font-medium text-[var(--danger)] hover:bg-[var(--danger-bg)]"
              >
                清空
              </button>
            </div>
          </SettingsSectionCard>
        );

      case "privacy":
        return (
          <SettingsSectionCard noHeader>
            <SettingRow first label="记录动作回放">
              <Switch
                checked={preferences.recordActionReplay}
                onChange={(v) => updatePreferences({ recordActionReplay: v })}
                ariaLabel="记录动作回放"
              />
            </SettingRow>
            <SettingRow
              label="自动模糊敏感信息"
              description="密码、银行卡号、身份证"
            >
              <Switch
                checked={preferences.blurSensitiveInfo}
                onChange={(v) => updatePreferences({ blurSensitiveInfo: v })}
                ariaLabel="自动模糊敏感信息"
              />
            </SettingRow>
            <SettingRow label="时间线保留">
              <SelectMenu
                value={preferences.timelineRetentionDays}
                onChange={(v) => updatePreferences({ timelineRetentionDays: v })}
                options={[
                  { value: "7 天", label: "7 天" },
                  { value: "30 天", label: "30 天" },
                  { value: "90 天", label: "90 天" },
                ]}
              />
            </SettingRow>

            <div className="flex flex-col gap-2 border-t border-[var(--border-light)] px-4 py-3.5">
              <div className="flex justify-between">
                <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                  本地占用
                </span>
                <span className="font-mono text-[12px] text-[var(--ink-strong)]">
                  {state.storageStats?.totalLabel ?? "0 KB"}
                </span>
              </div>
              <div className="flex flex-wrap gap-3.5 text-[11px] text-[var(--ink-muted)]">
                <span>■ SQLite {state.storageStats?.databaseLabel ?? "0 KB"}</span>
                <span>■ 状态 {state.storageStats?.stateLabel ?? "0 KB"}</span>
                <span>■ 保险箱 {state.storageStats?.vaultLabel ?? "0 KB"}</span>
              </div>
              <div className="truncate font-mono text-[10px] text-[var(--ink-subtle)]">
                {state.storageStats?.dataDir || "~/Library/Application Support/Valet"}
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border-light)] px-4 py-3">
              <button
                type="button"
                onClick={exportJson}
                className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[12px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
              >
                导出全部数据
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={resetAllData}
                className="inline-flex h-7 cursor-pointer items-center rounded-[7px] px-2.5 text-[12px] font-medium text-[var(--danger)] hover:bg-[var(--danger-bg)]"
              >
                清除全部数据
              </button>
            </div>
          </SettingsSectionCard>
        );

      case "shortcuts":
        return (
          <SettingsSectionCard noHeader>
            {[
              { label: "新对话", keys: "⌘ N" },
              { label: "打开收件箱", keys: "⌘ I" },
              { label: "打开时间线", keys: "⌘ 1" },
              { label: "打开对话", keys: "⌘ 2" },
              { label: "打开插件", keys: "⌘ 3" },
              { label: "切换侧边栏", keys: "⌘ \\" },
              { label: "切换深色 / 浅色外观", keys: "⌘ ⇧ D" },
              { label: "命令面板", keys: "⌘ K" },
              { label: "截屏并提问", keys: "⌥ ⇧ S" },
              { label: "暂停 / 继续 Valet", keys: "⌥ ⎋" },
            ].map((sc, idx) => (
              <div
                key={sc.label}
                className={`flex items-center px-4 py-3 ${
                  idx > 0 ? "border-t border-[var(--border-light)]" : ""
                }`}
              >
                <span className="flex-1 text-[13px] text-[var(--ink-strong)]">
                  {sc.label}
                </span>
                <span className="font-mono text-[11px] text-[var(--ink-secondary)]">
                  {sc.keys}
                </span>
              </div>
            ))}
          </SettingsSectionCard>
        );

      case "about":
        return (
          <SettingsSectionCard noHeader>
            <div className="flex items-center gap-3 px-4 py-4">
              <div className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] border border-[var(--brand-icon-border)] bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)]">
                <BowtieSvg size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-[var(--ink-strong)]">
                  <span className="font-[family-name:var(--font-serif-en)] text-[18px] font-normal italic">
                    Valet
                  </span>{" "}
                  0.1.0
                </div>
                <div className="text-[11px] text-[var(--ink-subtle)]">
                  已是最新 · 自动更新已开启
                </div>
              </div>
              <button
                type="button"
                onClick={resetOnboarding}
                className="cursor-pointer rounded-[7px] border border-[var(--border-control)] px-2.5 py-1 text-[12px] font-medium text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
              >
                重新引导
              </button>
              <button
                type="button"
                onClick={() => pushToast("感谢反馈！当前为本地 MVP 版本")}
                className="cursor-pointer rounded-[7px] bg-[var(--ink-primary)] px-3 py-1 text-[12px] font-semibold text-[var(--ink-on-primary)]"
              >
                反馈
              </button>
            </div>
          </SettingsSectionCard>
        );
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden bg-[var(--bg-canvas)]">
      {/* Desktop 236px Secondary Settings Master Rail (Paper 13 & 20) */}
      {!isCompactViewport && (
        <aside className="flex h-full w-[236px] shrink-0 flex-col gap-[1px] border-r border-[var(--border-light)] bg-[var(--bg-sub-sidebar)] px-3 pt-5 pb-4">
          <div className="px-2.5 pt-4 pb-3 font-[family-name:var(--font-serif-zh)] text-[22px] font-medium leading-[28px] text-[var(--ink-strong)]">
            设置
          </div>

          <div className="flex h-[30px] shrink-0 items-center gap-2 rounded-[7px] border border-[var(--border-light)] bg-[var(--bg-subtle)] px-2.5">
            <SearchIcon size={12} className="shrink-0 text-[var(--ink-subtle)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索设置"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="cursor-pointer text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              >
                ✕
              </button>
            )}
          </div>

          <div className="mt-1 flex min-h-0 flex-1 flex-col gap-[1px] overflow-y-auto pr-0.5">
            {(["Agent", "Care", "System"] as const).map((groupName, gIdx) => {
              const groupSections = filteredSections.filter(
                (s) => s.group === groupName
              );
              if (groupSections.length === 0) return null;
              return (
                <React.Fragment key={groupName}>
                  <div
                    className={`px-2.5 pb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-subtle)] ${
                      gIdx === 0 ? "pt-3.5" : "pt-3.5"
                    }`}
                  >
                    {groupName}
                  </div>
                  {groupSections.map((sec) => {
                    const active = !query.trim() && activeSectionId === sec.id;
                    return (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setActiveSettingsSection(sec.id);
                        }}
                        className={`flex h-[30px] w-full shrink-0 cursor-pointer items-center justify-between rounded-[7px] px-2.5 text-left transition-colors ${
                          active
                            ? "bg-[var(--bg-muted)] font-semibold text-[var(--ink-strong)]"
                            : "text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                        }`}
                      >
                        <span className="truncate text-[13px] leading-[16px]">
                          {sec.title}
                        </span>
                        {sec.id === "thresholds" && active && (
                          <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--ink-primary)]" />
                        )}
                        {sec.id === "permissions" && (
                          <span className="font-mono text-[10px] text-[var(--amber-text)]">
                            {grantedPermCount}/{totalPermCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </aside>
      )}

      {/* Right Focused Detail Pane */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
        {/* Compact Responsive Top Breadcrumb & Quick-Switch Pills (Paper 25 小屏 · 设置) */}
        {isCompactViewport && (
          <div className="flex shrink-0 flex-col">
            <div className="app-drag flex h-[42px] items-center gap-2 px-[22px]">
              <SidebarToggleButton />
              <span className="text-[12px] text-[var(--ink-muted)]">设置</span>
              <span className="text-[12px] text-[var(--ink-faint)]">/</span>
              <span className="truncate text-[12px] font-semibold text-[var(--ink-strong)]">
                {activeSectionMeta.group} · {activeSectionMeta.title}
              </span>
              <div className="flex-1" />
              <div className="app-no-drag flex h-[26px] w-[140px] items-center gap-1.5 rounded-[7px] bg-[var(--bg-subtle)] px-[9px]">
                <SearchIcon size={12} className="shrink-0 text-[var(--ink-subtle)]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索设置"
                  className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)]"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border-light)] px-[22px] pb-2">
              {COMPACT_PILLS.map((pillId) => {
                const meta = SECTIONS.find((s) => s.id === pillId);
                if (!meta) return null;
                const active = !query.trim() && activeSectionId === pillId;
                return (
                  <button
                    key={pillId}
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setActiveSettingsSection(pillId);
                    }}
                    className={`inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[11px] transition-colors ${
                      active
                        ? "bg-[var(--ink-primary)] font-semibold text-[var(--ink-on-primary)]"
                        : "border border-[var(--border-control)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <span>{meta.title}</span>
                    {pillId === "permissions" && (
                      <span className="font-mono text-[10px] font-semibold text-[var(--amber-icon)]">
                        {grantedPermCount}/{totalPermCount}
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="flex-1" />
              <SelectMenu
                value={activeSectionId}
                triggerLabel={`全部 ${SECTIONS.length} 项`}
                options={SECTIONS.map((s) => ({
                  value: s.id,
                  label: s.title,
                  hint: s.group,
                }))}
                onChange={(v) => {
                  setQuery("");
                  setActiveSettingsSection(v as SettingsSectionId);
                }}
                triggerClassName="h-6 border-0 bg-transparent px-1 text-[11px] text-[var(--ink-subtle)]"
              />
            </div>
          </div>
        )}

        {/* Desktop subtle draggable top bar with optional SidebarToggle */}
        {!isCompactViewport && (
          <header className="app-drag flex h-[44px] shrink-0 items-center px-6">
            {sidebarCollapsed && <SidebarToggleButton title="设置" />}
          </header>
        )}

        {/* Scrollable Detail Content */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto pb-8 ${
            isCompactViewport || sidebarCollapsed ? "px-6 pt-3" : "px-6 pt-3 xl:px-10"
          }`}
        >
          {query.trim() ? (
            filteredSections.length === 0 ? (
              <div className="py-16 text-center text-[13px] text-[var(--ink-muted)]">
                没有匹配「{query}」的设置项
              </div>
            ) : (
              <div className="flex flex-col gap-7">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
                    Search · {filteredSections.length} matches
                  </div>
                  <h1 className="mt-1 font-[family-name:var(--font-serif-zh)] text-[24px] font-medium text-[var(--ink-strong)]">
                    搜索「{query}」
                  </h1>
                </div>

                {filteredSections.map((sec) => (
                  <div key={sec.id} className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <h2 className="font-[family-name:var(--font-serif-zh)] text-[20px] font-medium text-[var(--ink-strong)]">
                          {sec.title}
                        </h2>
                        <p className="text-[12px] text-[var(--ink-muted)]">
                          {sec.subtitle}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] uppercase text-[var(--ink-subtle)]">
                        {sec.group}
                      </span>
                    </div>
                    {renderSectionBody(sec.id)}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="flex max-w-[780px] flex-col gap-[22px]">
              {/* Detail Header */}
              <div className="flex items-end justify-between gap-4">
                <div className="flex flex-col gap-1.5">
                  <h1 className="font-[family-name:var(--font-serif-zh)] text-[22px] font-medium leading-[28px] text-[var(--ink-strong)] lg:text-[28px] lg:leading-[36px]">
                    {activeSectionMeta.title}
                  </h1>
                  <p className="text-[12px] leading-[16px] text-[var(--ink-muted)] lg:text-[13px]">
                    {activeSectionMeta.subtitle}
                  </p>
                </div>

                {activeSectionId === "thresholds" && (
                  <button
                    type="button"
                    onClick={resetThresholdsToDefault}
                    className="shrink-0 cursor-pointer text-[11px] font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)] lg:text-[12px]"
                  >
                    恢复默认
                  </button>
                )}
              </div>

              {renderSectionBody(activeSectionId)}
            </div>
          )}
        </div>
      </div>

      {/* Provider quick selector modal */}
      <Modal
        open={providerModalOpen}
        onClose={() => setProviderModalOpen(false)}
        title="切换或添加模型服务商"
        subtitle="选择一个服务商作为当前默认推理引擎"
      >
        <div className="flex flex-col gap-2">
          {state.providers.map((p) => {
            const selected = p.id === preferences.activeProviderId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  selectProvider(p.id);
                  setProviderModalOpen(false);
                  pushToast(`已切换默认服务商为 ${p.name}`, "success");
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-left ${
                  selected
                    ? "border-[var(--ink-primary)] bg-[var(--bg-subtle)]"
                    : "border-[var(--border-base)] hover:bg-[var(--bg-card-hover)]"
                }`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--ink-primary)] font-[family-name:var(--font-serif-en)] text-[16px] italic text-[var(--ink-on-primary)]">
                  {p.letter}
                </span>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-[var(--ink-strong)]">
                    {p.name}
                  </div>
                  <div className="text-[11px] text-[var(--ink-muted)]">
                    {p.subtitle}
                  </div>
                </div>
                {selected && (
                  <span className="text-[11px] font-semibold text-[var(--ink-primary)]">
                    当前使用
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Modal>

      {/* Add Automation Rule Modal */}
      <Modal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title="新建自动化规则"
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">
              触发时机（展示标签）
            </span>
            <input
              type="text"
              value={ruleWhen}
              onChange={(e) => setRuleWhen(e.target.value)}
              className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[13px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">
              Cron 表达式（分 时 日 月 周）
            </span>
            <input
              type="text"
              value={ruleCronExpr}
              onChange={(e) => setRuleCronExpr(e.target.value)}
              placeholder="30 9 * * *"
              className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">
              任务标题
            </span>
            <input
              type="text"
              value={ruleTitle}
              onChange={(e) => setRuleTitle(e.target.value)}
              className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[13px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">
              执行指令（交给 Pi Agent 执行）
            </span>
            <textarea
              value={rulePrompt}
              onChange={(e) => setRulePrompt(e.target.value)}
              rows={3}
              className="rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] p-2.5 text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setRuleModalOpen(false)}
            className="h-[32px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3.5 text-[12px]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              const parts = ruleWhen.trim().split(/\s+/);
              addAutomationRule({
                scheduleTop: parts[0] ?? "定时",
                scheduleBottom: parts[1] ?? "执行",
                title: ruleTitle.trim() || "新自动化任务",
                cronExpr: ruleCronExpr.trim() || "0 9 * * *",
                prompt: rulePrompt.trim(),
                enabled: true,
                triggerType: "cron",
              });
              setRuleModalOpen(false);
            }}
            className="h-[32px] cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-3.5 text-[12px] font-semibold text-[var(--ink-on-primary)]"
          >
            创建
          </button>
        </div>
      </Modal>

      {/* Memory Manager Modal */}
      <Modal
        open={memoryModalOpen}
        onClose={() => setMemoryModalOpen(false)}
        title="本地记忆管理"
        subtitle="以下偏好仅存储在你的 Mac 本地"
      >
        <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
          {state.memories.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[var(--ink-muted)]">
              暂无记忆条目
            </div>
          ) : (
            state.memories.map((mem) => (
              <div
                key={mem.id}
                className="flex items-start gap-3 rounded-[9px] border border-[var(--border-base)] p-3"
              >
                <div className="flex-1">
                  <div className="text-[12px] leading-[18px] text-[var(--ink-strong)]">
                    {mem.content}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-[var(--ink-subtle)]">
                    {mem.source} · {mem.createdAt}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteMemory(mem.id)}
                  className="cursor-pointer text-[11px] text-[var(--ink-muted)] hover:text-[var(--danger)]"
                >
                  删除
                </button>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Add MCP Modal */}
      <Modal
        open={mcpModalOpen}
        onClose={() => setMcpModalOpen(false)}
        title="添加 MCP 服务器"
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">
              名称
            </span>
            <input
              type="text"
              value={mcpName}
              onChange={(e) => setMcpName(e.target.value)}
              className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[13px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--ink-strong)]">
              传输类型
            </span>
            <SegmentedControl<"stdio" | "http">
              value={mcpTransportType}
              onChange={(v) => setMcpTransportType(v)}
              options={[
                { value: "stdio", label: "stdio 本地命令" },
                { value: "http", label: "HTTP / JSON-RPC" },
              ]}
            />
          </div>
          {mcpTransportType === "stdio" ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-[var(--ink-strong)]">
                  可执行命令
                </span>
                <input
                  type="text"
                  value={mcpCommand}
                  onChange={(e) => setMcpCommand(e.target.value)}
                  placeholder="npx"
                  className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-[var(--ink-strong)]">
                  参数（空格分隔）
                </span>
                <input
                  type="text"
                  value={mcpArgsText}
                  onChange={(e) => setMcpArgsText(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem ~/Downloads"
                  className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                />
              </label>
            </>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--ink-strong)]">
                Endpoint URL
              </span>
              <input
                type="text"
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                placeholder="http://localhost:3100/mcp"
                className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
              />
            </label>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setMcpModalOpen(false)}
            className="h-[32px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3.5 text-[12px]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              const args = mcpArgsText
                .trim()
                .split(/\s+/)
                .filter(Boolean);
              addMcpServer({
                abbr: mcpName.trim().slice(0, 2).toLowerCase() || "mc",
                name: mcpName.trim() || "Custom MCP",
                transport: mcpTransportType,
                command: mcpTransportType === "stdio" ? mcpCommand.trim() : undefined,
                args: mcpTransportType === "stdio" ? args : undefined,
                url: mcpTransportType === "http" ? mcpUrl.trim() : undefined,
                transportLabel:
                  mcpTransportType === "stdio"
                    ? `stdio · ${mcpCommand.trim() || "cmd"}`
                    : `http · ${mcpUrl.trim()}`,
                toolCount: 0,
                enabled: true,
              });
              setMcpModalOpen(false);
            }}
            className="h-[32px] cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-3.5 text-[12px] font-semibold text-[var(--ink-on-primary)]"
          >
            接入并探测工具
          </button>
        </div>
      </Modal>
    </div>
  );
};
