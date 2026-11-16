import { isMyGo } from "mygo-runtime";
import { Valet, type AgentProviderConfig as MyGoProviderConfig } from "../mygo";
import type {
  AgentProviderConfig,
  ChatAttachment,
  ChatMessage,
  InboxApprovalItem,
  PermissionId,
  PluginState,
  TimelineEvent,
} from "../types/valet";

export interface ProviderVerifyResult {
  ok: boolean;
  latencyMs: number;
  modelCount: number;
  message: string;
}

export interface TestMessageResult {
  ok: boolean;
  reply: string;
  latencyMs: number;
}

export interface SimulatedChatOutcome {
  replyMessage: ChatMessage;
  createdEvent?: TimelineEvent;
  createdInboxItem?: InboxApprovalItem;
}

export interface ValetService {
  openSystemSettings(permissionId: PermissionId): Promise<{ opened: boolean }>;
  pollPermissionStatus(permissionId: PermissionId): Promise<{ granted: boolean }>;
  verifyProvider(provider: AgentProviderConfig): Promise<ProviderVerifyResult>;
  sendTestAgentMessage(provider: AgentProviderConfig, model: string): Promise<TestMessageResult>;
  sendChatMessage(params: {
    chatId?: string;
    prompt: string;
    model: string;
    mentionPlugin: PluginState | null;
    attachments: ChatAttachment[];
  }): Promise<SimulatedChatOutcome>;
  createSimulatedPluginEvent(plugin: PluginState, eventCode: string): {
    event: TimelineEvent;
    inboxItem?: InboxApprovalItem;
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function formatNowHHMM(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export class MockValetService implements ValetService {
  async openSystemSettings(_permissionId: PermissionId): Promise<{ opened: boolean }> {
    await delay(180);
    return { opened: true };
  }

  async pollPermissionStatus(_permissionId: PermissionId): Promise<{ granted: boolean }> {
    await delay(250);
    return { granted: true };
  }

  async verifyProvider(provider: AgentProviderConfig): Promise<ProviderVerifyResult> {
    await delay(420);
    if (provider.id === "ollama") {
      return {
        ok: true,
        latencyMs: 14,
        modelCount: provider.models.length,
        message: `本地节点 ${provider.endpoint || "localhost:11434"} 已响应 · 可用 ${provider.models.length} 个模型`,
      };
    }
    const key = provider.apiKey.trim();
    if (!key && provider.id !== "custom") {
      return {
        ok: false,
        latencyMs: 0,
        modelCount: 0,
        message: "请输入有效的 API Key 后再验证",
      };
    }
    const latency = 180 + Math.floor(Math.random() * 190);
    return {
      ok: true,
      latencyMs: latency,
      modelCount: provider.availableModelCount || provider.models.length || 4,
      message: `已验证 · 延迟 ${latency}ms · 可用 ${provider.availableModelCount || provider.models.length || 4} 个模型`,
    };
  }

  async sendTestAgentMessage(provider: AgentProviderConfig, model: string): Promise<TestMessageResult> {
    await delay(500);
    const latency = 240 + Math.floor(Math.random() * 150);
    return {
      ok: true,
      latencyMs: latency,
      reply: `测试成功：${provider.name} (${model}) 已就绪，响应延迟 ${latency}ms。`,
    };
  }

  async sendChatMessage(params: {
    prompt: string;
    model: string;
    mentionPlugin: PluginState | null;
    attachments: ChatAttachment[];
  }): Promise<SimulatedChatOutcome> {
    await delay(820);
    const trimmed = params.prompt.trim();
    const lower = trimmed.toLowerCase();
    const nowTime = formatNowHHMM();

    if (lower.startsWith("/clean") || lower.includes("大文件") || lower.includes("清理")) {
      const evt: TimelineEvent = {
        id: makeId("evt"),
        timestamp: new Date().toISOString(),
        timeLabel: nowTime,
        dayGroup: "today",
        title: "对话触发深度大文件排查（发现 6.4 GB）",
        summary: "发现 2 个长期未访问的镜像与 Xcode 归档，等待你勾选确认。",
        pluginId: "disk-guard",
        pluginName: "磁盘守卫",
        pluginBadge: "磁盘守卫",
        eventCode: "disk.large_file",
        status: "pending_confirm",
        confirmBannerText: "发现 6.4 GB 闲置文件：旧版安装包与 90 天未打开的虚拟机镜像。",
        triggerLatencyLabel: `${nowTime} · 来自对话指令 /clean`,
        payload: {
          source: "chat",
          threshold_mb: 2048,
          idle_days: 90,
        },
        reasoning: "根据对话请求扫描用户目录大文件，跳过 ~/Documents 与 ~/Projects 受保护路径后定位到 2 项可安全释放资产。",
        actionItems: [
          {
            id: makeId("act"),
            label: "~/Downloads/macOS-Beta-Install.ipsw",
            path: "~/Downloads/macOS-Beta-Install.ipsw",
            sizeMB: 4800,
            sizeLabel: "4.7 GB",
            checked: true,
          },
          {
            id: makeId("act"),
            label: "~/Library/Developer/Xcode/Archives/2026-07",
            path: "~/Library/Developer/Xcode/Archives/2026-07",
            sizeMB: 1740,
            sizeLabel: "1.7 GB",
            checked: true,
          },
        ],
        traceSteps: [
          { id: "st1", time: nowTime, stage: "对话指令", detail: "收到 /clean 大文件清理请求", status: "done" },
          { id: "st2", time: nowTime, stage: "等待确认", detail: "等待你在收件箱或时间线确认移入废纸篓", status: "active" },
        ],
        logs: [
          { id: "lg1", ts: nowTime, level: "INFO", message: "Chat requested large file scan via disk-guard" },
          { id: "lg2", ts: nowTime, level: "WARN", message: "Policy=ask -> waiting for user approval" },
        ],
      };

      const inboxItem: InboxApprovalItem = {
        id: makeId("inbox"),
        timestamp: evt.timestamp,
        timeLabel: nowTime,
        ageLabel: "刚刚",
        category: "files",
        iconKind: "disk",
        title: "移出对话排查出的 2 个大文件（6.4 GB）",
        summary: "macOS-Beta-Install.ipsw（4.7 GB）与 Xcode/Archives/2026-07（1.7 GB），移入废纸篓。",
        pluginId: "disk-guard",
        pluginName: "磁盘守卫",
        pluginBadge: "磁盘守卫",
        eventCode: "disk.large_file",
        reversible7d: true,
        reclaimableGB: 6.4,
        approveLabel: "移入废纸篓",
        dismissLabel: "保留",
        status: "pending",
        linkedTimelineEventId: evt.id,
        triggerLatencyLabel: `${nowTime} · 来自对话指令 /clean`,
        payload: evt.payload,
        reasoning: evt.reasoning,
        actionItems: evt.actionItems,
        traceSteps: evt.traceSteps,
        logs: evt.logs,
      };

      return {
        replyMessage: {
          id: makeId("msg"),
          role: "assistant",
          metaLabel: `${params.model} · 磁盘守卫`,
          createdAt: nowTime,
          content:
            "我又扫了一遍超过 2 GB 且 90 天未打开的文件：共发现 **6.4 GB** 可安全释放（包括一个旧的 `.ipsw` 固件包和 7 月份的 Xcode Archive）。我已经把确认清单推到收件箱与时间线顶部，你可以直接审核后移入废纸篓。",
        },
        createdEvent: evt,
        createdInboxItem: inboxItem,
      };
    }

    if (lower.startsWith("/plugin") || lower.includes("插件") || lower.includes("规则")) {
      const idSlug = `custom-rule-${Date.now().toString(36).slice(-4)}`;
      return {
        replyMessage: {
          id: makeId("msg"),
          role: "assistant",
          metaLabel: `${params.model} · 插件生成器`,
          createdAt: nowTime,
          content: "已为你起草一份新的本地自动化插件草稿，点击右侧按钮可直接安装并生效：",
          pluginDraft: {
            id: idSlug,
            name: "桌面截图归档器",
            whenExpression: "when fs.file_created(~/Desktop/截屏*.png)",
            actionExpression: "after 15m → move_to(~/Pictures/Screenshots)",
            installed: false,
            manifestYaml: `id: local.valet.${idSlug}
name: 桌面截图归档器
version: 0.1.0
triggers:
  - event: fs.file_created
    glob: "~/Desktop/截屏*.png"
actions:
  - move_to:
      target: "~/Pictures/Screenshots"`,
          },
        },
      };
    }

    if (lower.startsWith("/ps") || lower.startsWith("/scan") || lower.includes("cpu") || lower.includes("进程") || lower.includes("卡")) {
      return {
        replyMessage: {
          id: makeId("msg"),
          role: "assistant",
          metaLabel: "实时采样 10s · 进程哨兵",
          createdAt: nowTime,
          content: "刚刚重新采样了当前系统进程状态，高占用进程如下，你可以直接操作：",
          processTable: {
            rows: [
              {
                id: makeId("proc"),
                name: "swift-frontend",
                cpuPct: 164,
                memLabel: "1.4 GB",
                sourceLabel: "Xcode 构建",
                severity: "high",
              },
              {
                id: makeId("proc"),
                name: "WindowServer",
                cpuPct: 28,
                memLabel: "620 MB",
                sourceLabel: "外接显示器",
                severity: "normal",
              },
            ],
            primaryActionDone: false,
            secondaryActionDone: false,
            autoRuleAdded: false,
          },
        },
      };
    }

    const pluginHint = params.mentionPlugin ? `（已挂载 @${params.mentionPlugin.name} 上下文）` : "";
    const attachHint =
      params.attachments.length > 0
        ? `已读取你附加的 ${params.attachments.map((a) => a.name).join("、")}。`
        : "";

    return {
      replyMessage: {
        id: makeId("msg"),
        role: "assistant",
        metaLabel: `${params.model}${pluginHint ? ` · @${params.mentionPlugin?.name}` : ""}`,
        createdAt: nowTime,
        content: `${attachHint}收到：「${trimmed}」${pluginHint}。当前为前端交互演示模式，你可以尝试输入 \`/clean\`、\`/ps\` 或 \`/plugin\` 触发诊断卡片与插件草稿，或去「时间线」「插件」「设置」体验联动状态。`,
      },
    };
  }

  createSimulatedPluginEvent(
    plugin: PluginState,
    eventCode: string
  ): { event: TimelineEvent; inboxItem?: InboxApprovalItem } {
    const nowTime = formatNowHHMM();
    const policy = plugin.events.find((e) => e.id === eventCode)?.policy ?? "ask";
    const isAuto = policy === "auto";
    const evt: TimelineEvent = {
      id: makeId("evt-sim"),
      timestamp: new Date().toISOString(),
      timeLabel: nowTime,
      dayGroup: "today",
      title: `模拟事件：${plugin.name} 捕获 ${eventCode}`,
      summary: isAuto
        ? "策略为「自动处理」，Valet 已记录并在后台静默执行安全操作。"
        : policy === "ask"
          ? "策略为「问我」，需要你在收件箱或时间线确认后执行下一步动作。"
          : "策略为「仅记录」，已归档到时间线供你随时回溯。",
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginBadge: plugin.source === "core" ? plugin.name : `${plugin.name} · 第三方`,
      eventCode,
      status: policy === "ask" ? "pending_confirm" : "completed",
      confirmBannerText:
        policy === "ask" ? `来自开发者事件模拟器的待确认动作（${eventCode}）` : undefined,
      triggerLatencyLabel: `${nowTime} · 来自开发者事件模拟器`,
      payload: {
        plugin: plugin.bundleId,
        event: eventCode,
        policy,
        simulated: true,
      },
      reasoning: `由插件「${plugin.name}」的开发者调试器手动注入事件 ${eventCode}，用于验证策略路由与时间线渲染链路。`,
      actionItems:
        policy === "ask"
          ? [
              {
                id: makeId("sim-act"),
                label: `执行 ${plugin.actions[0]?.id ?? "plugin.default_action"}`,
                path: "~/Library/Caches/ValetSimulated",
                sizeMB: 240,
                sizeLabel: "240 MB",
                checked: true,
              },
            ]
          : [],
      traceSteps: [
        { id: "s1", time: nowTime, stage: "事件注入", detail: `${eventCode} 已进入事件总线`, status: "done" },
        {
          id: "s2",
          time: nowTime,
          stage: policy === "ask" ? "等待确认" : "处理完成",
          detail: `按策略「${policy}」流转`,
          status: policy === "ask" ? "active" : "done",
        },
      ],
      logs: [
        { id: "sl1", ts: nowTime, level: "INFO", message: `Simulated trigger ${eventCode} from ${plugin.bundleId}` },
      ],
    };

    const inboxItem: InboxApprovalItem | undefined =
      policy === "ask"
        ? {
            id: makeId("inbox-sim"),
            timestamp: evt.timestamp,
            timeLabel: nowTime,
            ageLabel: "刚刚",
            category: plugin.id === "process-sentinel" ? "process" : "files",
            iconKind: plugin.id === "process-sentinel" ? "pulse" : "disk",
            title: evt.title,
            summary: evt.summary,
            pluginId: plugin.id,
            pluginName: plugin.name,
            pluginBadge: plugin.name,
            eventCode,
            reversible7d: plugin.id !== "process-sentinel",
            reclaimableGB: plugin.id === "process-sentinel" ? 0 : 0.2,
            approveLabel: "批准执行",
            dismissLabel: "忽略",
            status: "pending",
            linkedTimelineEventId: evt.id,
            triggerLatencyLabel: evt.triggerLatencyLabel,
            payload: evt.payload,
            reasoning: evt.reasoning,
            actionItems: evt.actionItems,
            traceSteps: evt.traceSteps,
            logs: evt.logs,
          }
        : undefined;

    return { event: evt, inboxItem };
  }
}

class MyGoValetService implements ValetService {
  private readonly fallback: MockValetService;

  constructor(fallback: MockValetService) {
    this.fallback = fallback;
  }

  async openSystemSettings(permissionId: PermissionId): Promise<{ opened: boolean }> {
    const opened = await Valet.openSystemSettings(permissionId);
    return { opened };
  }

  async pollPermissionStatus(permissionId: PermissionId): Promise<{ granted: boolean }> {
    const granted = await Valet.pollPermissionStatus(permissionId);
    return { granted };
  }

  async verifyProvider(provider: AgentProviderConfig): Promise<ProviderVerifyResult> {
    return Valet.verifyProvider(provider as unknown as MyGoProviderConfig);
  }

  async sendTestAgentMessage(
    provider: AgentProviderConfig,
    model: string
  ): Promise<TestMessageResult> {
    return Valet.sendTestAgentMessage(provider as unknown as MyGoProviderConfig, model);
  }

  async sendChatMessage(params: {
    chatId?: string;
    prompt: string;
    model: string;
    mentionPlugin: PluginState | null;
    attachments: ChatAttachment[];
  }): Promise<SimulatedChatOutcome> {
    const res = await Valet.sendChatMessage({
      chatId: params.chatId ?? "chat-lag",
      prompt: params.prompt,
      model: params.model,
      mentionPluginId: params.mentionPlugin?.id,
      attachments: params.attachments,
    });
    return {
      replyMessage: res.replyMessage as unknown as ChatMessage,
      createdEvent: res.createdEvent as unknown as TimelineEvent | undefined,
      createdInboxItem: res.createdInbox as unknown as InboxApprovalItem | undefined,
    };
  }

  createSimulatedPluginEvent(plugin: PluginState, eventCode: string) {
    return this.fallback.createSimulatedPluginEvent(plugin, eventCode);
  }
}

const mockService = new MockValetService();
const mygoService = new MyGoValetService(mockService);

export const valetService: ValetService = {
  openSystemSettings: (permissionId) =>
    (isMyGo() ? mygoService : mockService).openSystemSettings(permissionId),
  pollPermissionStatus: (permissionId) =>
    (isMyGo() ? mygoService : mockService).pollPermissionStatus(permissionId),
  verifyProvider: (provider) =>
    (isMyGo() ? mygoService : mockService).verifyProvider(provider),
  sendTestAgentMessage: (provider, model) =>
    (isMyGo() ? mygoService : mockService).sendTestAgentMessage(provider, model),
  sendChatMessage: (params) =>
    (isMyGo() ? mygoService : mockService).sendChatMessage(params),
  createSimulatedPluginEvent: (plugin, eventCode) =>
    (isMyGo() ? mygoService : mockService).createSimulatedPluginEvent(plugin, eventCode),
};
