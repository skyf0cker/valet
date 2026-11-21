import React, { useMemo, useRef, useState } from "react";
import { DARK_THEME_OPTIONS, getDarkThemeMeta, normalizeDarkTheme } from "../../constants/themes";
import { valetService } from "../../services/valetService";
import { useValet } from "../../store/ValetContext";
import type {
  AppearanceMode,
  AutoReviewConfig,
  AutonomyLevel,
  SettingsSectionId,
  ToneStyle,
} from "../../types/valet";
import { SidebarToggleButton } from "../Sidebar";
import { Kbd } from "../ui/Badge";
import { Checkbox } from "../ui/Checkbox";
import { BowtieSvg, CheckIcon, SearchIcon } from "../ui/Icons";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";
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
  group: "Agent" | "Steward" | "System";
  subtitle: string;
  keywords: string;
}

function parseMcpHeadersInput(raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const out: Record<string, string> = {};
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          const tk = k.trim();
          if (tk && typeof v === "string" && v.trim()) {
            out[tk] = v.trim();
          }
        }
        return Object.keys(out).length > 0 ? out : undefined;
      }
    } catch {
      // Fall through to line-by-line Key: Value parsing
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (key && val) {
      out[key] = val;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const SECTIONS: SectionMeta[] = [
  {
    id: "general",
    title: "通用",
    group: "Agent",
    subtitle: "启动、菜单栏驻留、浅色/深色多主题配色与运行中消息发送策略",
    keywords: "通用 启动 外观 深色 浅色 自动 语言 消息 引导 排队 主题 配色 午夜黑曜石 暖岩黑胡桃 深松怀表 obsidian espresso chronometer theme",
  },
  {
    id: "models",
    title: "模型与服务商",
    group: "Agent",
    subtitle: "密钥安全存于本机受保护凭据文件（0600 隔离存储），控制主/快/视觉模型、Auto Review 审查模型与每日预算",
    keywords: "模型 服务商 anthropic openai ollama gemini api key 花费 预算 jev system one auto review 审查 小模型 google decisions gemini-decision-1",
  },
  {
    id: "persona",
    title: "人格与指令",
    group: "Agent",
    subtitle: "决定 Valet 如何称呼你、使用什么语气以及常驻指令",
    keywords: "人格 称呼 语气 指令 custom instructions",
  },
  {
    id: "heartbeat",
    title: "心跳与自动化",
    group: "Agent",
    subtitle: "周期性主动值守心跳与定时事件编排，让 Valet 持续感知并响应本机事件",
    keywords: "心跳 巡检 自动化 定时 cron heartbeat 值守 事件",
  },
  {
    id: "safety",
    title: "自主与安全",
    group: "Agent",
    subtitle: "决定 Valet 权限策略（每个都询问 / Auto Review / Full Access）、动作确认与受保护路径",
    keywords: "自主 安全 确认 敏感操作 受保护目录 废纸篓 撤销 禁止 应用 紧急停止 每个都询问 auto review full access 审查",
  },
  {
    id: "thresholds",
    title: "事件感知阈值",
    group: "Steward",
    subtitle: "决定传感器何时将系统与应用状态变化作为事件呈报给 Valet",
    keywords: "监控 事件 阈值 磁盘 cpu 内存 压力 忽略 进程 日志 灵敏度 节流",
  },
  {
    id: "runtime",
    title: "插件与事件总线",
    group: "Steward",
    subtitle: "插件沙箱隔离、本地开发热重载、Webhook 事件网关与限流策略（含 MCP 服务）",
    keywords: "插件 运行时 沙箱 未签名 本地 热重载 事件 webhook 上限 安静时段 mcp",
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
  "heartbeat",
  "safety",
  "thresholds",
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
    addMemoryEntry,
    clearMemories,
    triggerHeartbeatNow,
    clearHeartbeatLogs,
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
  const [heartbeatLogModalOpen, setHeartbeatLogModalOpen] = useState(false);
  const memoryCompEndRef = useRef(0);

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
  const [mcpHeadersText, setMcpHeadersText] = useState("");

  // Inline provider credential & Auto Review state
  const [showProviderKey, setShowProviderKey] = useState(false);
  const [verifyingProvider, setVerifyingProvider] = useState(false);
  const [testingProviderMsg, setTestingProviderMsg] = useState(false);
  const [providerTestReply, setProviderTestReply] = useState<string | null>(null);
  const [showJevKey, setShowJevKey] = useState(false);
  const [testingAutoReview, setTestingAutoReview] = useState(false);
  const [autoReviewTestReply, setAutoReviewTestReply] = useState<string | null>(null);
  const [newMemoryText, setNewMemoryText] = useState("");

  const { preferences } = state;
  const activeSectionId: SettingsSectionId =
    (state.activeSettingsSection as string) === "cleanup"
      ? "heartbeat"
      : state.activeSettingsSection;
  const activeSectionMeta =
    SECTIONS.find((s) => s.id === activeSectionId) ?? SECTIONS[5]!;

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

  const autoReview: AutoReviewConfig = {
    engine: preferences.autoReview?.engine ?? "auto",
    jevEndpoint:
      preferences.autoReview?.jevEndpoint || "https://api.typesafe.ai/v1/systemone",
    jevApiKey: preferences.autoReview?.jevApiKey ?? "",
    jevApiKeyMasked: preferences.autoReview?.jevApiKeyMasked ?? "",
    jevModel: preferences.autoReview?.jevModel || "jev-latest",
    jevVerified: preferences.autoReview?.jevVerified ?? false,
    jevLatencyMs: preferences.autoReview?.jevLatencyMs,
    fallbackProviderId: preferences.autoReview?.fallbackProviderId ?? "",
    fallbackModel: preferences.autoReview?.fallbackModel || "同快速模型",
  };
  const updateAutoReview = (patch: Partial<AutoReviewConfig>) => {
    setAutoReviewTestReply(null);
    updatePreferences({
      autoReview: {
        ...autoReview,
        ...patch,
      },
    });
  };
  const fallbackProvider =
    (autoReview.fallbackProviderId
      ? state.providers.find((p) => p.id === autoReview.fallbackProviderId)
      : undefined) ?? activeProvider;
  const fallbackModelPool = Array.from(
    new Set([
      ...(fallbackProvider?.models ?? []),
      ...(activeProvider?.models ?? []),
      ...(autoReview.fallbackModel && autoReview.fallbackModel !== "同快速模型"
        ? [autoReview.fallbackModel]
        : []),
    ])
  ).filter(Boolean);
  const fallbackModelOptions = [
    { value: "同快速模型", label: `同快速模型（${preferences.models.fast}）` },
    ...fallbackModelPool.map((m) => ({ value: m, label: m })),
  ];
  const openRouterProv = state.providers.find((p) => p.id === "openrouter");
  const geminiProv = state.providers.find((p) => p.id === "gemini");
  const lowerJevEndpoint = autoReview.jevEndpoint
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "");
  const isGoogleDecisions =
    lowerJevEndpoint.includes("googleapis.com") ||
    lowerJevEndpoint.endsWith("/decisions") ||
    (!lowerJevEndpoint.includes("openrouter.ai") &&
      autoReview.jevModel
        .trim()
        .toLowerCase()
        .replace(/^(models|google)\//, "")
        .startsWith("gemini-decision"));
  const hasJevKeyConfigured =
    Boolean(autoReview.jevApiKey.trim()) ||
    (lowerJevEndpoint.includes("openrouter.ai") &&
      Boolean(openRouterProv?.apiKey?.trim())) ||
    (isGoogleDecisions && Boolean(geminiProv?.apiKey?.trim()));
  const activeReviewEngineSummary =
    autoReview.engine === "jev"
      ? hasJevKeyConfigured
        ? isGoogleDecisions
          ? `Google Decisions · ${autoReview.jevModel || "gemini-decision-1"}`
          : `Jev System One · ${autoReview.jevModel}`
        : isGoogleDecisions
          ? "仅 Google Decisions（尚未填写 Key，暂转人工确认）"
          : "仅 Jev System One（尚未填写 Key，暂转人工确认）"
      : autoReview.engine === "auto" && hasJevKeyConfigured
        ? isGoogleDecisions
          ? `Google Decisions · ${autoReview.jevModel || "gemini-decision-1"}`
          : `Jev System One · ${autoReview.jevModel}`
        : `审查小模型 · ${
            autoReview.fallbackModel === "同快速模型"
              ? preferences.models.fast
              : autoReview.fallbackModel
          }（${fallbackProvider?.name ?? preferences.activeProviderId}）`;

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

      case "heartbeat":
        return (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <SettingGroupHeader
                title="主动值守心跳（Heartbeat）"
                rightAction={
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setHeartbeatLogModalOpen(true)}
                      className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                    >
                      <span>运行记录</span>
                      {(state.heartbeatLogs ?? []).length > 0 && (
                        <span className="rounded-full bg-[var(--bg-hover)] px-1.5 font-mono text-[10px]">
                          {(state.heartbeatLogs ?? []).length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void triggerHeartbeatNow()}
                      className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 text-[11px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                    >
                      立即巡检
                    </button>
                  </div>
                }
              />
              <SettingsSectionCard noHeader>
                <SettingRow
                  first
                  label="启用周期值守心跳"
                  description="默认开启 · 按设定间隔唤醒管家检查待处理事件与系统状态（安静时段自动静默）"
                >
                  <Switch
                    checked={preferences.heartbeat?.enabled ?? true}
                    onChange={(v) =>
                      updatePreferences({
                        heartbeat: {
                          intervalMin: preferences.heartbeat?.intervalMin ?? 30,
                          prompt:
                            preferences.heartbeat?.prompt ??
                            "巡检当前待处理的系统与应用事件、收件箱待确认事项及后台服务状态；若发现需要关注的异常则按自治策略响应或汇总至收件箱，若一切平稳则静默记录心跳。",
                          lastRunAt: preferences.heartbeat?.lastRunAt,
                          initialized: true,
                          enabled: v,
                        },
                      })
                    }
                    ariaLabel="启用周期值守心跳"
                  />
                </SettingRow>

                <SettingRow label="巡检周期">
                  <SelectMenu
                    value={String(preferences.heartbeat?.intervalMin ?? 30)}
                    options={[
                      { value: "15", label: "每 15 分钟" },
                      { value: "30", label: "每 30 分钟" },
                      { value: "60", label: "每 60 分钟" },
                      { value: "120", label: "每 120 分钟" },
                    ]}
                    onChange={(v) =>
                      updatePreferences({
                        heartbeat: {
                          enabled: preferences.heartbeat?.enabled ?? true,
                          initialized: true,
                          intervalMin: Number(v) || 30,
                          prompt:
                            preferences.heartbeat?.prompt ??
                            "巡检当前待处理的系统与应用事件、收件箱待确认事项及后台服务状态；若发现需要关注的异常则按自治策略响应或汇总至收件箱，若一切平稳则静默记录心跳。",
                          lastRunAt: preferences.heartbeat?.lastRunAt,
                        },
                      })
                    }
                  />
                </SettingRow>

                <div className="flex flex-col gap-1.5 border-t border-[var(--border-light)] px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-[var(--ink-strong)]">
                      心跳指令 Prompt
                    </span>
                    <span className="font-mono text-[10.5px] text-[var(--ink-subtle)]">
                      {preferences.heartbeat?.lastRunAt
                        ? `上次巡检：${preferences.heartbeat.lastRunAt}`
                        : "已开启周期值守 · 等待首次巡检"}
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    value={
                      preferences.heartbeat?.prompt ??
                      "巡检当前待处理的系统与应用事件、收件箱待确认事项及后台服务状态；若发现需要关注的异常则按自治策略响应或汇总至收件箱，若一切平稳则静默记录心跳。"
                    }
                    onChange={(e) =>
                      updatePreferences({
                        heartbeat: {
                          enabled: preferences.heartbeat?.enabled ?? true,
                          initialized: true,
                          intervalMin: preferences.heartbeat?.intervalMin ?? 30,
                          prompt: e.target.value,
                          lastRunAt: preferences.heartbeat?.lastRunAt,
                        },
                      })
                    }
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="w-full resize-none rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 py-2 text-[12px] leading-[18px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                  />
                </div>

                <div className="flex items-center gap-3 border-t border-[var(--border-light)] px-4 py-3">
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="font-mono text-[12px] font-semibold text-[var(--ink-strong)]">
                      {(state.heartbeatLogs ?? []).length} 条心跳运行记录
                    </span>
                    <span className="truncate text-[11px] text-[var(--ink-subtle)]">
                      {preferences.heartbeat?.lastRunAt
                        ? `最近一次 ${preferences.heartbeat.lastRunAt}`
                        : "尚未产生记录"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHeartbeatLogModalOpen(true)}
                    className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] px-2.5 text-[11.5px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                  >
                    查看运行记录
                  </button>
                  {(state.heartbeatLogs ?? []).length > 0 && (
                    <button
                      type="button"
                      onClick={clearHeartbeatLogs}
                      className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-[7px] px-2 text-[11.5px] font-medium text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                    >
                      清空
                    </button>
                  )}
                </div>
              </SettingsSectionCard>
            </div>

            <div className="flex flex-col gap-2">
              <SettingGroupHeader
                title="定时与事件编排"
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

      case "general": {
        const activeDarkTheme = normalizeDarkTheme(preferences.darkTheme);
        const activeDarkMeta = getDarkThemeMeta(activeDarkTheme);
        return (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <SettingGroupHeader title="外观与主题" />
              <SettingsSectionCard noHeader>
                <SettingRow
                  first
                  label="外观模式"
                  description="跟随系统日夜自动切换，或固定使用浅色 / 深色界面"
                >
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

                <div className="border-t border-[var(--border-light)] px-4 py-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] font-medium leading-[16px] text-[var(--ink-strong)]">
                        深色主题风格
                      </span>
                      <span className="text-[11px] leading-[14px] text-[var(--ink-subtle)]">
                        深色与自动夜间模式下生效，点击卡片可立即切换预览
                      </span>
                    </div>
                    <span className="font-mono text-[10.5px] text-[var(--ink-muted)]">
                      {activeDarkMeta.enName}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {DARK_THEME_OPTIONS.map((opt) => {
                      const selected = activeDarkTheme === opt.id;
                      const p = opt.preview;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            const isCurrentlyDark =
                              document.documentElement.dataset.theme === "dark";
                            if (!isCurrentlyDark) {
                              updatePreferences({ darkTheme: opt.id, appearance: "dark" });
                              pushToast(`已切换至深色 · ${opt.name}`);
                            } else {
                              updatePreferences({ darkTheme: opt.id });
                              pushToast(`已切换深色主题 · ${opt.name}`);
                            }
                          }}
                          className={`group flex cursor-pointer flex-col overflow-hidden rounded-[10px] p-2.5 text-left transition-all ${
                            selected
                              ? "border-[1.5px] border-[var(--ink-primary)] bg-[var(--bg-subtle)]/60"
                              : "border border-[var(--border-control)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]"
                          }`}
                        >
                          {/* Miniature Valet UI swatch preview */}
                          <div
                            className="flex h-[62px] w-full overflow-hidden rounded-[7px] border"
                            style={{
                              backgroundColor: p.canvas,
                              borderColor: p.border,
                            }}
                          >
                            {/* Mini recessed sidebar */}
                            <div
                              className="flex w-[30%] shrink-0 flex-col gap-1 border-r p-1.5"
                              style={{
                                backgroundColor: p.sidebar,
                                borderRightColor: p.border,
                              }}
                            >
                              <div className="flex items-center gap-1 px-0.5">
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: p.accent }}
                                />
                                <span
                                  className="h-1 w-5 rounded-full opacity-55"
                                  style={{ backgroundColor: p.muted }}
                                />
                              </div>
                              <div
                                className="mt-0.5 h-2.5 w-full rounded-[3px] border"
                                style={{
                                  backgroundColor: p.navPill,
                                  borderColor: p.border,
                                }}
                              />
                              <div
                                className="mx-0.5 h-1.5 w-3/4 rounded-full opacity-35"
                                style={{ backgroundColor: p.muted }}
                              />
                              <div
                                className="mx-0.5 h-1.5 w-2/3 rounded-full opacity-25"
                                style={{ backgroundColor: p.muted }}
                              />
                            </div>

                            {/* Mini lifted canvas */}
                            <div className="flex min-w-0 flex-1 flex-col justify-between p-1.5">
                              <div className="flex items-center justify-between gap-1.5 px-0.5">
                                <div
                                  className="h-2 w-10 rounded-full opacity-90"
                                  style={{ backgroundColor: p.ink }}
                                />
                                <div
                                  className="h-2.5 w-5 rounded-[3px]"
                                  style={{ backgroundColor: p.ctaBg }}
                                />
                              </div>
                              <div
                                className="flex items-center justify-between rounded-[4px] border px-1.5 py-1"
                                style={{
                                  backgroundColor: p.surface,
                                  borderColor: p.border,
                                }}
                              >
                                <div className="flex flex-col gap-0.5">
                                  <div
                                    className="h-1 w-8 rounded-full opacity-80"
                                    style={{ backgroundColor: p.ink }}
                                  />
                                  <div
                                    className="h-1 w-5 rounded-full opacity-45"
                                    style={{ backgroundColor: p.muted }}
                                  />
                                </div>
                                <div
                                  className="flex h-2.5 w-4 items-center justify-end rounded-full p-[1.5px]"
                                  style={{ backgroundColor: p.switchTrack }}
                                >
                                  <span
                                    className="h-[7px] w-[7px] rounded-full"
                                    style={{ backgroundColor: p.ctaBg }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Label & check indicator */}
                          <div className="mt-2.5 flex items-start justify-between gap-2 px-0.5">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12.5px] font-semibold leading-[16px] text-[var(--ink-strong)]">
                                {opt.name}
                              </div>
                              <div className="mt-0.5 truncate font-mono text-[10px] leading-[13px] text-[var(--ink-subtle)]">
                                {opt.enName}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] leading-[14px] text-[var(--ink-muted)]">
                                {opt.tagline}
                              </div>
                            </div>
                            <span
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                selected
                                  ? "border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                                  : "border-[var(--border-control)] bg-transparent text-transparent"
                              }`}
                            >
                              <CheckIcon size={9} strokeWidth={3.2} />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </SettingsSectionCard>
            </div>

            <div className="flex flex-col gap-2">
              <SettingGroupHeader title="系统与会话" />
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
                  label="运行中发送新消息"
                  description="排队等待：先进入待发送队列依次执行；实时引导：立即注入当前轮次调整方向"
                >
                  <SegmentedControl<"queue" | "steer">
                    value={preferences.busyMessagePolicy ?? "queue"}
                    onChange={(v) => updatePreferences({ busyMessagePolicy: v })}
                    options={[
                      { value: "queue", label: "排队等待" },
                      { value: "steer", label: "实时引导" },
                    ]}
                  />
                </SettingRow>
              </SettingsSectionCard>
            </div>
          </div>
        );
      }

      case "models":
        return (
          <div className="flex flex-col gap-5">
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
                    <span className="text-[11px] text-[var(--ink-muted)]">API Key（存于本机 0600 独立凭据文件，与配置隔离）</span>
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
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
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
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
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
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
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

          <div className="flex flex-col gap-2">
            <SettingGroupHeader
              title="Auto Review 权限审查模型"
              rightAction={
                <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                  {activeReviewEngineSummary}
                </span>
              }
            />
            <SettingsSectionCard noHeader>
              <div className="flex flex-col gap-2 px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-[var(--ink-strong)]">
                    审查决策引擎
                  </span>
                  <span className="text-[11px] text-[var(--ink-muted)]">
                    参考 Claude Code Auto Mode：常规本地操作自动放行，仅拦截不可逆破坏、凭据外传等高危操作
                  </span>
                </div>
                <SegmentedControl<"auto" | "jev" | "llm">
                  fullWidth
                  value={autoReview.engine}
                  onChange={(engine) => updateAutoReview({ engine })}
                  options={[
                    { value: "auto", label: "自动（优先 Jev / Decision）" },
                    { value: "jev", label: "仅决策模型 (Jev / Google)" },
                    { value: "llm", label: "仅审查小模型" },
                  ]}
                />
              </div>

              {autoReview.engine !== "llm" && (
                <div className="flex flex-col gap-3 border-t border-[var(--border-light)] bg-[var(--bg-subtle)] px-4 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-[var(--ink-strong)]">
                      {isGoogleDecisions
                        ? "Google Gemini Decisions 决策模型（/v1beta/decisions）"
                        : "Jev System One 决策模型（/v1/systemone）"}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateAutoReview({
                            jevEndpoint: "https://api.typesafe.ai/v1/systemone",
                            jevModel: "jev-latest",
                          })
                        }
                        className="cursor-pointer rounded-[5px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[10.5px] text-[var(--ink-secondary)] hover:text-[var(--ink-strong)]"
                      >
                        TypeSafe 官方
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateAutoReview({
                            jevEndpoint: "https://openrouter.ai/api/v1/systemone",
                            jevModel: "typesafe/jev-1.14",
                          })
                        }
                        className="cursor-pointer rounded-[5px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[10.5px] text-[var(--ink-secondary)] hover:text-[var(--ink-strong)]"
                      >
                        OpenRouter
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateAutoReview({
                            jevEndpoint:
                              "https://generativelanguage.googleapis.com/v1beta/decisions",
                            jevModel: "gemini-decision-1",
                          })
                        }
                        className="cursor-pointer rounded-[5px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[10.5px] text-[var(--ink-secondary)] hover:text-[var(--ink-strong)]"
                      >
                        Google AI Studio
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowJevKey((v) => !v)}
                        className="cursor-pointer text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                      >
                        {showJevKey ? "隐藏 Key" : "显示 Key"}
                      </button>
                    </div>
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--ink-muted)]">
                      决策模型 API Key（存于本机 0600 独立凭据文件；Google / OpenRouter 端点留空时自动复用上方对应服务商 Key）
                    </span>
                    <input
                      type={showJevKey ? "text" : "password"}
                      value={autoReview.jevApiKey}
                      onChange={(e) =>
                        updateAutoReview({
                          jevApiKey: e.target.value,
                          jevApiKeyMasked: e.target.value
                            ? `${e.target.value.slice(0, 6)}••••${e.target.value.slice(-4)}`
                            : "",
                          jevVerified: false,
                        })
                      }
                      placeholder={
                        isGoogleDecisions
                          ? "AIza...（留空将复用 Google Gemini 服务商 Key）"
                          : lowerJevEndpoint.includes("openrouter.ai")
                            ? "sk-or-...（留空将复用 OpenRouter 服务商 Key）"
                            : "ts-...（留空则自动回退至下方审查小模型）"
                      }
                      className="h-[32px] rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                    />
                  </label>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        {isGoogleDecisions ? "Decisions Endpoint" : "System One Endpoint"}
                      </span>
                      <input
                        type="text"
                        value={autoReview.jevEndpoint}
                        onChange={(e) =>
                          updateAutoReview({ jevEndpoint: e.target.value, jevVerified: false })
                        }
                        placeholder={
                          isGoogleDecisions
                            ? "https://generativelanguage.googleapis.com/v1beta/decisions"
                            : "https://api.typesafe.ai/v1/systemone"
                        }
                        className="h-[30px] rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[11px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        决策模型 ID
                      </span>
                      <input
                        type="text"
                        value={autoReview.jevModel}
                        onChange={(e) =>
                          updateAutoReview({ jevModel: e.target.value, jevVerified: false })
                        }
                        placeholder="gemini-decision-1 / jev-latest / typesafe/jev-1.14"
                        className="h-[30px] rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[11px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                      />
                    </label>
                  </div>
                </div>
              )}

              {autoReview.engine !== "jev" && (
                <>
                  <SettingRow
                    label="审查小模型服务商"
                    description={
                      autoReview.engine === "auto"
                        ? "未配置决策模型时作为回退审查模型"
                        : "用于快速评估权限风险"
                    }
                    tinted
                  >
                    <SelectMenu
                      value={autoReview.fallbackProviderId || ""}
                      options={[
                        {
                          value: "",
                          label: `跟随主服务商（${activeProvider?.name ?? preferences.activeProviderId}）`,
                        },
                        ...state.providers.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                      onChange={(v) => updateAutoReview({ fallbackProviderId: v })}
                    />
                  </SettingRow>
                  <SettingRow
                    label="审查小模型"
                    description="建议使用 Haiku / Flash / Mini / 本地轻量模型以降低延迟"
                    tinted
                  >
                    <SelectMenu
                      value={autoReview.fallbackModel}
                      options={fallbackModelOptions}
                      onChange={(v) => updateAutoReview({ fallbackModel: v })}
                      mono
                      searchable={fallbackModelOptions.length > 8}
                    />
                  </SettingRow>
                </>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-light)] px-4 py-3">
                <button
                  type="button"
                  disabled={testingAutoReview}
                  onClick={async () => {
                    setTestingAutoReview(true);
                    setAutoReviewTestReply(null);
                    try {
                      const res = await valetService.testAutoReview(autoReview);
                      setAutoReviewTestReply(res.reply);
                      if (res.ok && autoReview.engine !== "llm" && hasJevKeyConfigured) {
                        updatePreferences({
                          autoReview: {
                            ...autoReview,
                            jevVerified: true,
                            jevLatencyMs: res.latencyMs,
                          },
                        });
                      }
                      pushToast(res.reply, res.ok ? "success" : "warning");
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : String(err);
                      setAutoReviewTestReply(`测试失败：${msg}`);
                      pushToast(msg, "danger");
                    } finally {
                      setTestingAutoReview(false);
                    }
                  }}
                  className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-[var(--ink-primary)] px-3 text-[11px] font-semibold text-[var(--ink-on-primary)] disabled:opacity-60"
                >
                  {testingAutoReview ? "检测中…" : "测试 Auto Review 决策"}
                </button>
                <span className="text-[11px] text-[var(--ink-subtle)]">
                  纯只读命令与受信任插件脚本 0ms 本地直通，不消耗审查额度
                </span>
              </div>

              {autoReviewTestReply && (
                <div className="border-t border-[var(--border-light)] bg-[var(--bg-subtle)] px-4 py-2.5 font-mono text-[11px] text-[var(--ink-secondary)]">
                  {autoReviewTestReply}
                </div>
              )}
            </SettingsSectionCard>
          </div>
          </div>
        );

      case "persona":
        return (
          <SettingsSectionCard noHeader>
            <SettingRow first label="称呼">
              <input
                type="text"
                value={preferences.userNickname}
                onChange={(e) => updatePreferences({ userNickname: e.target.value })}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
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
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="min-h-[104px] w-full resize-y rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 py-2.5 font-mono text-[11px] leading-[18px] text-[var(--ink-secondary)] outline-none focus:border-[var(--ink-primary)]"
              />
            </div>
          </SettingsSectionCard>
        );

      case "safety":
        return (
          <div className="flex flex-col gap-5">
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
                    { value: "always_ask", label: "每个都询问" },
                    { value: "auto_review", label: "Auto Review" },
                    { value: "full_access", label: "Full Access" },
                  ]}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px] text-[var(--ink-muted)]">
                  <span>
                    {preferences.autonomyLevel === "always_ask"
                      ? "除纯只读探测工具外，其余工具与终端命令都会请求确认。"
                      : preferences.autonomyLevel === "full_access"
                        ? "仅拦截系统硬红线（sudo / 钥匙串 / 受保护目录）与全局开关；其余全自动放行。"
                        : `常规本地操作自动放行，仅由「${activeReviewEngineSummary}」拦截高危操作（连续 3 次或累计 20 次拦截自动熔断转人工确认）。`}
                  </span>
                  {preferences.autonomyLevel === "auto_review" && (
                    <button
                      type="button"
                      onClick={() => setActiveSettingsSection("models")}
                      className="shrink-0 cursor-pointer font-medium text-[var(--ink-strong)] hover:underline"
                    >
                      配置审查模型 →
                    </button>
                  )}
                </div>
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

            <div className="flex flex-col gap-2">
              <SettingGroupHeader title="动作可逆性与受保护路径" />
              <SettingsSectionCard noHeader>
                <SettingRow
                  first
                  label="受保护路径"
                  description="任何插件与自动化任务均严禁改动以下目录"
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

                <SettingRow label="文件变更兜底方式">
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

                <SettingRow label="可撤销保留期">
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
              </SettingsSectionCard>
            </div>
          </div>
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
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
            {(["Agent", "Steward", "System"] as const).map((groupName, gIdx) => {
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
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
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

        {/* Desktop subtle draggable top bar + sticky section header */}
        {!isCompactViewport && (
          <div className="z-10 flex shrink-0 flex-col bg-[var(--bg-canvas)]">
            <header
              className={`app-drag flex h-[44px] shrink-0 items-center px-6 ${
                query.trim() ? "border-b border-[var(--border-subtle)]" : ""
              }`}
            >
              {sidebarCollapsed && <SidebarToggleButton title="设置" />}
            </header>

            {!query.trim() && (
              <div
                className={`border-b border-[var(--border-light)] pb-4 ${
                  sidebarCollapsed ? "px-6 pt-2" : "px-6 pt-2 xl:px-10"
                }`}
              >
                <div className="flex max-w-[780px] items-end justify-between gap-4">
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
              </div>
            )}
          </div>
        )}

        {/* Scrollable Detail Content */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto pb-8 ${
            isCompactViewport || sidebarCollapsed ? "px-6 pt-4" : "px-6 pt-5 xl:px-10"
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
              {/* Compact viewport detail header (desktop uses sticky header above) */}
              {isCompactViewport && (
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
              )}

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
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
        <div className="mb-3 flex items-center gap-2">
          <input
            type="text"
            value={newMemoryText}
            onChange={(e) => setNewMemoryText(e.target.value)}
            onCompositionEnd={() => {
              memoryCompEndRef.current = performance.now();
            }}
            onKeyDown={(e) => {
              if (
                e.nativeEvent.isComposing ||
                e.keyCode === 229 ||
                e.nativeEvent.keyCode === 229 ||
                performance.now() - memoryCompEndRef.current < 100
              ) {
                return;
              }
              if (e.key === "Enter" && newMemoryText.trim()) {
                e.preventDefault();
                void addMemoryEntry(newMemoryText.trim(), "手动添加");
                setNewMemoryText("");
              }
            }}
            placeholder="输入要长期记住的习惯或偏好（如：永远不要清理 ~/Work）"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="h-[34px] flex-1 rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
          />
          <button
            type="button"
            disabled={!newMemoryText.trim()}
            onClick={() => {
              if (!newMemoryText.trim()) return;
              void addMemoryEntry(newMemoryText.trim(), "手动添加");
              setNewMemoryText("");
            }}
            className="h-[34px] shrink-0 cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-3 text-[12px] font-semibold text-[var(--ink-on-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            + 添加记忆
          </button>
        </div>
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
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
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
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-[var(--ink-strong)]">
                  Endpoint URL
                </span>
                <input
                  type="text"
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                  placeholder="http://localhost:3100/mcp"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="h-[34px] rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-[var(--ink-strong)]">
                  HTTP Headers（可选，每行 Key: Value 或 JSON）
                </span>
                <textarea
                  rows={2}
                  value={mcpHeadersText}
                  onChange={(e) => setMcpHeadersText(e.target.value)}
                  placeholder={"Authorization: Bearer mcp_..."}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="resize-y rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 py-2 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
                />
              </label>
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setMcpHeadersText("");
              setMcpModalOpen(false);
            }}
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
              const headers =
                mcpTransportType === "http"
                  ? parseMcpHeadersInput(mcpHeadersText)
                  : undefined;
              addMcpServer({
                abbr: mcpName.trim().slice(0, 2).toLowerCase() || "mc",
                name: mcpName.trim() || "Custom MCP",
                transport: mcpTransportType,
                command: mcpTransportType === "stdio" ? mcpCommand.trim() : undefined,
                args: mcpTransportType === "stdio" ? args : undefined,
                url: mcpTransportType === "http" ? mcpUrl.trim() : undefined,
                headers,
                transportLabel:
                  mcpTransportType === "stdio"
                    ? `stdio · ${mcpCommand.trim() || "cmd"}`
                    : `http · ${mcpUrl.trim()}`,
                toolCount: 0,
                enabled: true,
              });
              setMcpHeadersText("");
              setMcpModalOpen(false);
            }}
            className="h-[32px] cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-3.5 text-[12px] font-semibold text-[var(--ink-on-primary)]"
          >
            接入并探测工具
          </button>
        </div>
      </Modal>

      {/* Heartbeat Run History Modal */}
      <Modal
        open={heartbeatLogModalOpen}
        onClose={() => setHeartbeatLogModalOpen(false)}
        title="心跳运行记录"
        subtitle="周期巡检记录独立保存在此处，不会写入事件时间线"
        widthClass="max-w-[560px]"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void triggerHeartbeatNow()}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 text-[11.5px] font-medium text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
          >
            立即执行一次巡检
          </button>
          {(state.heartbeatLogs ?? []).length > 0 && (
            <button
              type="button"
              onClick={clearHeartbeatLogs}
              className="inline-flex h-7 cursor-pointer items-center rounded-[7px] px-2.5 text-[11.5px] font-medium text-[var(--danger)] hover:bg-[var(--danger-bg)]"
            >
              清空记录
            </button>
          )}
        </div>
        <div className="flex max-h-[400px] flex-col gap-2.5 overflow-y-auto pr-0.5">
          {(state.heartbeatLogs ?? []).length === 0 ? (
            <div className="py-10 text-center text-[12px] text-[var(--ink-muted)]">
              暂无心跳运行记录，可等待周期触发或点击上方「立即执行一次巡检」
            </div>
          ) : (
            (state.heartbeatLogs ?? []).map((log) => (
              <div
                key={log.id}
                className="rounded-[10px] border border-[var(--border-base)] bg-[var(--bg-canvas)] p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      log.status === "error"
                        ? "bg-[var(--danger)]"
                        : "bg-emerald-500"
                    }`}
                  />
                  <span className="font-mono text-[11px] font-semibold text-[var(--ink-strong)]">
                    {log.createdAt}
                  </span>
                  {log.model && (
                    <span className="rounded-[5px] bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
                      {log.model}
                    </span>
                  )}
                  {typeof log.durationMs === "number" && log.durationMs > 0 && (
                    <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                      {(log.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-[12.5px] leading-[19px] text-[var(--ink-body)]">
                  <MarkdownRenderer text={log.detail || log.summary} />
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
};
