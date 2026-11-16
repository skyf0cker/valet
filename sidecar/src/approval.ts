import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  type Extension,
  type HookApi,
  ToolTask,
  type ToolExecutionResult,
  type ToolHookCall,
  defineExtension,
  hook,
} from "@earendil-works/pi-durable";
import type {
  HostBridge,
  QueueApprovalParams,
  RecordTimelineParams,
  ToolPolicyMeta,
  ValetSyncState,
} from "./protocol.ts";

export interface TurnSideEffectTracker {
  recordInbox(
    conversationId: ConversationId,
    inboxId: string,
    eventId?: string,
  ): void;
  recordTimeline(conversationId: ConversationId, eventId: string): void;
}

export class ToolPolicyRegistry {
  private readonly entries = new Map<string, ToolPolicyMeta>();

  register(meta: ToolPolicyMeta): void {
    this.entries.set(meta.toolName, meta);
  }

  registerAll(list: readonly ToolPolicyMeta[]): void {
    for (const meta of list) {
      this.entries.set(meta.toolName, meta);
    }
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [name, meta] of this.entries) {
      if (meta.pluginId === pluginId) {
        this.entries.delete(name);
      }
    }
  }

  get(toolName: string): ToolPolicyMeta | undefined {
    return this.entries.get(toolName);
  }
}

export type PolicyDecision =
  | { outcome: "allow" }
  | { outcome: "deny"; reason: string }
  | { outcome: "record"; reason: string }
  | { outcome: "ask"; reason: string };

const HARD_PROTECTED_PREFIXES = [
  "/System",
  "/bin",
  "/sbin",
  "/usr",
  "~/.ssh",
  "~/.gnupg",
  "~/.aws",
  "~/Library/Keychains",
];

function expandPath(raw: string, homeDir: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "~") return homeDir;
  if (trimmed.startsWith("~/")) {
    return `${homeDir}/${trimmed.slice(2)}`;
  }
  return trimmed;
}

function matchesPrefix(target: string, prefix: string): boolean {
  if (!target || !prefix) return false;
  return target === prefix || target.startsWith(`${prefix}/`);
}

function collectCandidatePaths(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof args.path === "string") out.push(args.path);
  if (Array.isArray(args.paths)) {
    for (const p of args.paths) {
      if (typeof p === "string") out.push(p);
    }
  }
  return out;
}

/**
 * Evaluates a tool invocation against Valet's AutonomyLevel, SafetyConfirmationChecklist,
 * plugin per-event policy, protected directories, and blocked apps.
 */
export function evaluateToolPolicy(
  meta: ToolPolicyMeta | undefined,
  args: Record<string, unknown>,
  state: ValetSyncState,
  isPreApproved: boolean,
): PolicyDecision {
  const paths = collectCandidatePaths(args);
  if (paths.length > 0 && meta?.safety !== "readonly") {
    const protectedDirs = [
      ...HARD_PROTECTED_PREFIXES,
      ...state.preferences.cleanupPolicy.protectedDirs,
    ].map((d) => expandPath(d, state.homeDir));

    for (const rawPath of paths) {
      const normalized = expandPath(rawPath, state.homeDir);
      if (normalized === "" || normalized === "/" || normalized === state.homeDir) {
        return {
          outcome: "deny",
          reason: `安全边界拒绝：禁止对根目录或主目录「${rawPath}」执行清理或写入操作。`,
        };
      }
      for (const p of protectedDirs) {
        if (matchesPrefix(normalized, p)) {
          return {
            outcome: "deny",
            reason: `路径受保护：「${rawPath}」位于受保护目录内，Valet 已拦截该操作。`,
          };
        }
      }
    }
  }

  // Blocked process/app check
  if (meta?.toolName === "process_terminate") {
    const targetName = String(args.name ?? args.command ?? "").toLowerCase();
    for (const blocked of state.preferences.blockedApps) {
      if (blocked && targetName.includes(blocked.toLowerCase())) {
        return {
          outcome: "deny",
          reason: `受保护应用：进程「${blocked}」位于隐私与安全拦截名单中，禁止终止。`,
        };
      }
    }
  }

  if (!meta || meta.safety === "readonly") {
    return { outcome: "allow" };
  }

  if (isPreApproved) {
    return { outcome: "allow" };
  }

  const plugin = state.plugins.find((p) => p.id === meta.pluginId);
  const eventPolicy =
    plugin?.events.find((e) => e.id === meta.eventCode)?.policy ?? "ask";

  if (eventPolicy === "record") {
    return {
      outcome: "record",
      reason: `插件「${meta.pluginName}」事件 ${meta.eventCode} 策略为「仅记录」，已存档至时间线而不执行变更。`,
    };
  }

  if (meta.safety === "confirm_always") {
    return {
      outcome: "ask",
      reason: `操作安全等级为「每次确认」（${meta.warningTag ?? "高影响动作"}），需在收件箱批准后执行。`,
    };
  }

  if (state.preferences.autonomyLevel === "always_ask") {
    return {
      outcome: "ask",
      reason: "当前安全级别为「每次都先问我」，已加入收件箱等待批准。",
    };
  }

  if (
    (meta.checklistKey === "sendMessageOrEmail" ||
      meta.checklistKey === "runTerminalCommand" ||
      meta.checklistKey === "paymentOrSubscription" ||
      meta.checklistKey === "modifySystemSettings") &&
    state.preferences.confirmChecklist[meta.checklistKey] &&
    state.preferences.autonomyLevel !== "autonomous"
  ) {
    return {
      outcome: "ask",
      reason: `命中安全确认清单规则「${meta.checklistKey}」，已转入收件箱等待确认。`,
    };
  }

  if (
    state.preferences.autonomyLevel === "sensitive_only" &&
    eventPolicy === "ask"
  ) {
    return {
      outcome: "ask",
      reason: `事件 ${meta.eventCode} 的响应策略为「问我」，已推入收件箱等待批准。`,
    };
  }

  return { outcome: "allow" };
}

function buildApprovalPayload(
  meta: ToolPolicyMeta,
  call: ToolHookCall,
  decisionReason: string,
): QueueApprovalParams {
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const paths = collectCandidatePaths(args);
  const titleMap: Record<string, string> = {
    disk_move_to_trash: `移出 ${paths.length || 1} 项磁盘文件至废纸篓`,
    disk_empty_trash: "清倒系统废纸篓（不可撤销）",
    app_trash_remnants: `清理卸载应用残留（${paths.length || 1} 项）`,
    app_unload_agent: `卸载后台服务 ${String(args.label ?? "LaunchAgent")}`,
    process_terminate: `终止进程 ${String(args.name ?? "process")}（PID ${String(args.pid ?? "?")}）`,
    github_rerun_job: `重新运行 GitHub 工作流 ${String(args.repo ?? "")}`,
    github_post_comment: `向 GitHub 提交评论（${String(args.repo ?? "")}）`,
    calendar_send_conflict_reply: `向「${String(args.meeting ?? "参会者")}」发送日程回复`,
  };

  const actionItems: QueueApprovalParams["actionItems"] =
    paths.length > 0
      ? paths.map((p, idx) => ({
          id: `${call.id}-item-${idx + 1}`,
          label: p,
          path: p,
          sizeMB: Number(args.estimatedTotalMB ?? 0) / Math.max(1, paths.length),
          sizeLabel:
            typeof args.sizeLabel === "string"
              ? args.sizeLabel
              : paths.length === 1 && args.estimatedGB
                ? `${String(args.estimatedGB)} GB`
                : "待确认项目",
          checked: true,
        }))
      : [
          {
            id: `${call.id}-item-1`,
            label:
              meta.toolName === "process_terminate"
                ? `发送 ${String(args.signal ?? "SIGTERM")} 至 PID ${String(args.pid ?? "?")}`
                : `执行 ${meta.actionId}`,
            path:
              typeof args.recipient === "string"
                ? args.recipient
                : typeof args.repo === "string"
                  ? args.repo
                  : meta.actionId,
            sizeMB: 0,
            sizeLabel: meta.warningTag ?? "1 项",
            checked: true,
          },
        ];

  const estimatedGB =
    typeof args.estimatedGB === "number" ? args.estimatedGB : undefined;

  return {
    pluginId: meta.pluginId,
    pluginName: meta.pluginName,
    eventCode: meta.eventCode,
    category: meta.category,
    iconKind: meta.iconKind,
    title: titleMap[meta.toolName] ?? `批准执行 ${meta.pluginName} · ${meta.actionId}`,
    summary:
      typeof args.reason === "string" && args.reason
        ? args.reason
        : typeof args.draft === "string" && args.draft
          ? `草稿：「${args.draft}」，未经批准不会外发。`
          : paths.length > 0
            ? paths.slice(0, 3).join("、")
            : decisionReason,
    reasoning: decisionReason,
    warningTag: meta.warningTag,
    reversible7d: meta.reversible7d,
    reclaimableGB: estimatedGB,
    approveLabel: meta.approveLabel,
    dismissLabel: meta.dismissLabel,
    toolName: meta.toolName,
    toolArgs: { ...args },
    actionItems,
  };
}

/**
 * Installs Valet's ToolTask safety & audit extension.
 * Enforces safety policies BEFORE tool execution and records completed mutating actions in Timeline.
 */
export function createSafetyExtension(options: {
  bridge: HostBridge;
  policyRegistry: ToolPolicyRegistry;
  getState: () => ValetSyncState;
  approvedConversations: Set<ConversationId>;
  tracker?: TurnSideEffectTracker;
}): Extension {
  const { bridge, policyRegistry, getState, approvedConversations, tracker } =
    options;

  return defineExtension({
    name: "valet:safety-gate",
    hooks: [
      hook(ToolTask, {
        beforeTool: async (
          call: ToolHookCall,
          api: HookApi,
          _context: Context,
        ) => {
          const state = getState();
          const meta = policyRegistry.get(call.name);
          const args = (call.arguments ?? {}) as Record<string, unknown>;
          const isPreApproved = approvedConversations.has(api.conversationId);

          const decision = evaluateToolPolicy(meta, args, state, isPreApproved);
          if (decision.outcome === "allow") {
            return undefined;
          }
          if (decision.outcome === "deny") {
            return { block: decision.reason };
          }
          if (!meta) {
            return undefined;
          }

          if (decision.outcome === "record") {
            const rec: RecordTimelineParams = {
              pluginId: meta.pluginId,
              pluginName: meta.pluginName,
              eventCode: meta.eventCode,
              title: `${meta.pluginName} 捕获 ${meta.eventCode}（仅记录）`,
              summary: decision.reason,
              status: "completed",
              reasoning: decision.reason,
              payload: { tool: call.name, policy: "record" },
            };
            const recorded = await bridge.callHost<{ timelineEventId: string }>(
              "host.recordTimelineEvent",
              rec as unknown as Record<string, unknown>,
            );
            if (recorded?.timelineEventId) {
              tracker?.recordTimeline(
                api.conversationId,
                recorded.timelineEventId,
              );
            }
            return { block: decision.reason };
          }

          // outcome === "ask" -> queue InboxApprovalItem + linked pending_confirm TimelineEvent
          const approvalReq = buildApprovalPayload(meta, call, decision.reason);
          const queued = await bridge.callHost<{
            inboxId: string;
            timelineEventId: string;
          }>(
            "host.queueApproval",
            approvalReq as unknown as Record<string, unknown>,
          );
          if (queued?.inboxId) {
            tracker?.recordInbox(
              api.conversationId,
              queued.inboxId,
              queued.timelineEventId,
            );
          }
          return {
            block: `NEEDS_APPROVAL(${queued?.inboxId ?? "pending"}): 该敏感操作未直接执行，已提交至「收件箱」与「时间线」等待用户批准。请告知用户前去收件箱确认。`,
          };
        },
        afterTool: async (
          call: ToolHookCall,
          result: ToolExecutionResult,
          api: HookApi,
          _context: Context,
        ) => {
          if (result.isError) return result;
          const meta = policyRegistry.get(call.name);
          if (!meta || meta.safety === "readonly") return result;

          const details =
            result.details && typeof result.details === "object"
              ? (result.details as Record<string, unknown>)
              : {};
          const timelineReq: RecordTimelineParams = {
            pluginId: meta.pluginId,
            pluginName: meta.pluginName,
            eventCode: meta.eventCode,
            title:
              typeof details.timelineTitle === "string"
                ? details.timelineTitle
                : `${meta.pluginName} 已执行 ${meta.actionId}`,
            summary:
              typeof details.timelineSummary === "string"
                ? details.timelineSummary
                : `已按当前自主策略自动完成 ${call.name}。`,
            status: "completed",
            reasoning: `由工具 ${call.name} 执行完成（策略允许）。`,
            reclaimedGB:
              typeof details.reclaimedGB === "number"
                ? details.reclaimedGB
                : undefined,
            intercepted: meta.pluginId === "process-sentinel" ? true : undefined,
            canRestore:
              typeof details.canRestore === "boolean"
                ? details.canRestore
                : meta.reversible7d,
            payload: {
              tool: call.name,
              action: meta.actionId,
            },
          };
          const recorded = await bridge.callHost<{ timelineEventId: string }>(
            "host.recordTimelineEvent",
            timelineReq as unknown as Record<string, unknown>,
          );
          if (recorded?.timelineEventId) {
            tracker?.recordTimeline(api.conversationId, recorded.timelineEventId);
          }
          return result;
        },
      }),
    ],
  });
}
