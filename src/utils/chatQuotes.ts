import type {
  ChatAttachment,
  InboxApprovalItem,
  TimelineEvent,
} from "../types/valet";

const MAX_QUOTE_EXCERPT_CHARS = 10_000;

export function isQuoteAttachment(att: ChatAttachment): boolean {
  return att.kind === "inbox_item" || att.kind === "timeline_event";
}

function inboxStatusLabel(item: InboxApprovalItem): string {
  if (item.restored) return "已还原";
  if (item.status === "approved") return "已批准";
  if (item.status === "dismissed") return "已忽略";
  return "待批准";
}

function timelineStatusLabel(event: TimelineEvent): string {
  if (event.restored) return "已还原";
  if (event.ignored) return "已忽略";
  switch (event.status) {
    case "running":
      return "进行中";
    case "pending_confirm":
      return "待确认";
    case "failed":
      return "失败";
    case "completed":
    default:
      return "已完成";
  }
}

function formatSharedDetails(params: {
  payload: Record<string, unknown>;
  reasoning: string;
  actionItems: InboxApprovalItem["actionItems"];
  traceSteps: InboxApprovalItem["traceSteps"];
  logs: InboxApprovalItem["logs"];
}): string[] {
  const lines: string[] = [];

  if (params.reasoning) {
    lines.push(`- 判断依据：${params.reasoning}`);
  }

  if (params.payload && Object.keys(params.payload).length > 0) {
    lines.push(`- 事件载荷：\n\`\`\`json\n${JSON.stringify(params.payload, null, 2)}\n\`\`\``);
  }

  if (params.actionItems.length > 0) {
    lines.push(`- 执行清单（共 ${params.actionItems.length} 项）：`);
    for (const act of params.actionItems) {
      const checkedStr = act.checked ? "已勾选" : "未勾选";
      const note = act.keepNote ? ` (${act.keepNote})` : "";
      const pathPart = act.path && act.path !== act.label ? ` · path=${act.path}` : "";
      lines.push(
        `  - [${checkedStr}] actionId=${act.id} · ${act.label} (${act.sizeLabel})${pathPart}${note}`
      );
    }
  }

  if (params.traceSteps.length > 0) {
    lines.push(`- 事件响应链：`);
    for (const step of params.traceSteps) {
      lines.push(`  - [${step.time}] ${step.stage} (${step.status}): ${step.detail}`);
    }
  }

  if (params.logs.length > 0) {
    const recentLogs = params.logs.slice(-15);
    lines.push(`- 执行日志（最近 ${recentLogs.length} / ${params.logs.length} 条）：`);
    for (const log of recentLogs) {
      lines.push(`  - [${log.ts}] ${log.level}: ${log.message}`);
    }
  }

  return lines;
}

function truncateExcerpt(lines: string[]): string {
  const joined = lines.join("\n");
  if (joined.length <= MAX_QUOTE_EXCERPT_CHARS) return joined;
  return `${joined.slice(0, MAX_QUOTE_EXCERPT_CHARS - 16)}\n…(引用详情已截断)`;
}

export function buildInboxQuoteAttachment(item: InboxApprovalItem): ChatAttachment {
  const statusLabel = inboxStatusLabel(item);
  const lines: string[] = [
    `- 来源：收件箱待批/审批记录`,
    `- inboxId：${item.id}`,
    ...(item.linkedTimelineEventId ? [`- 关联时间线事件：${item.linkedTimelineEventId}`] : []),
    `- 标题：${item.title}`,
    `- 状态：${statusLabel}${item.processedAt ? `（处理于 ${item.processedAt}）` : ""}`,
    ...(item.selectedOption ? [`- 已选方案：${item.selectedOption}`] : []),
    `- 时间：${item.timeLabel}${item.ageLabel ? ` (${item.ageLabel})` : ""}`,
    `- 来源插件：${item.pluginName} (${item.pluginId}) · 事件码：${item.eventCode}`,
    `- 可逆性：${item.reversible7d ? "支持 7 天内还原" : "不可自动还原"}${item.warningTag ? ` · 警示标签：${item.warningTag}` : ""}`,
    ...(typeof item.reclaimableGB === "number" && item.reclaimableGB > 0
      ? [`- 预计释放空间：${item.reclaimableGB} GB`]
      : []),
    `- 摘要：${item.summary}`,
    ...formatSharedDetails({
      payload: item.payload,
      reasoning: item.reasoning,
      actionItems: item.actionItems,
      traceSteps: item.traceSteps,
      logs: item.logs,
    }),
  ];

  return {
    id: `quote-inbox-${item.id}`,
    kind: "inbox_item",
    refId: item.id,
    badge: "收件箱",
    name: item.title,
    meta: `${item.pluginName} · ${item.eventCode} · ${statusLabel}`,
    textExcerpt: truncateExcerpt(lines),
  };
}

export function buildTimelineQuoteAttachment(event: TimelineEvent): ChatAttachment {
  const statusLabel = timelineStatusLabel(event);
  const lines: string[] = [
    `- 来源：时间线事件`,
    `- eventId：${event.id}`,
    `- 标题：${event.title}`,
    `- 状态：${statusLabel}`,
    `- 时间：${event.timeLabel}${event.dayGroup === "earlier" ? "（更早）" : "（今天）"}`,
    `- 来源插件：${event.pluginName} (${event.pluginId}) · 事件码：${event.eventCode}`,
    `- 摘要：${event.confirmBannerText ?? event.summary}`,
    ...(typeof event.reclaimedGB === "number" && event.reclaimedGB > 0
      ? [`- 已释放空间：${event.reclaimedGB} GB`]
      : []),
    ...(event.canRestore && !event.restored ? [`- 可还原状态：支持从废纸篓一键还原`] : []),
    ...formatSharedDetails({
      payload: event.payload,
      reasoning: event.reasoning,
      actionItems: event.actionItems,
      traceSteps: event.traceSteps,
      logs: event.logs,
    }),
  ];

  return {
    id: `quote-timeline-${event.id}`,
    kind: "timeline_event",
    refId: event.id,
    badge: "时间线",
    name: event.title,
    meta: `${event.pluginName} · ${event.eventCode} · ${statusLabel}`,
    textExcerpt: truncateExcerpt(lines),
  };
}
