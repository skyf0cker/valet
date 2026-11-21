import type {
  ChatAttachment,
  InboxApprovalItem,
  TimelineEvent,
} from "../types/valet";

const MAX_QUOTE_EXCERPT_CHARS = 10_000;
const MAX_MESSAGE_QUOTE_CHARS = 4_000;

export function isQuoteAttachment(att: ChatAttachment): boolean {
  return att.kind === "inbox_item" || att.kind === "timeline_event";
}

export function isMessageQuoteAttachment(att: ChatAttachment): boolean {
  return att.kind === "message_quote";
}

export function isAnyQuoteAttachment(att: ChatAttachment): boolean {
  return isQuoteAttachment(att) || isMessageQuoteAttachment(att);
}

function fnv1aHashHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeSelectedQuoteText(raw: string): string {
  if (!raw) return "";
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line.replace(/[ \t]+$/g, "").replace(/[ \t]*\t+[ \t]*/g, " | ")
    );
  const joined = lines
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!joined) return "";
  if (joined.length <= MAX_MESSAGE_QUOTE_CHARS) return joined;
  return `${joined.slice(0, MAX_MESSAGE_QUOTE_CHARS - 7).trimEnd()}\n…(已截断)`;
}

export function buildMessageQuoteAttachment(params: {
  text: string;
  messageId?: string;
  role: "assistant" | "user";
  metaLabel?: string;
}): ChatAttachment | null {
  const normalized = normalizeSelectedQuoteText(params.text);
  if (!normalized) return null;

  const refId = params.messageId?.trim() || undefined;
  const hash = fnv1aHashHex(normalized);
  const singleLine = normalized.replace(/\s+/g, " ").trim();
  const singleChars = Array.from(singleLine);
  const name =
    singleChars.length > 72
      ? `${singleChars.slice(0, 71).join("")}…`
      : singleLine;
  const charCount = Array.from(normalized).length;
  const lineCount = normalized.split("\n").length;
  const meta =
    lineCount > 1 ? `${lineCount} 行 · ${charCount} 字` : `${charCount} 字`;

  return {
    id: `quote-msg-${refId || "live"}-${hash}`,
    kind: "message_quote",
    ...(refId ? { refId } : {}),
    badge: params.role === "assistant" ? "引用 Valet" : "引用我的消息",
    name,
    meta,
    textExcerpt: normalized,
  };
}

export function computeQuotePopoverPosition(params: {
  selectionRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  containerRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  popoverHalfWidth?: number;
  topClearance?: number;
}): { left: number; top: number; placement: "above" | "below" } | null {
  const { selectionRect, containerRect } = params;
  if (selectionRect.width <= 0 && selectionRect.height <= 0) {
    return null;
  }
  if (
    selectionRect.bottom < containerRect.top ||
    selectionRect.top > containerRect.bottom
  ) {
    return null;
  }

  const halfW = params.popoverHalfWidth ?? 76;
  const topClearance = params.topClearance ?? 46;
  const centerX = selectionRect.left + selectionRect.width / 2;
  const minLeft = containerRect.left + halfW;
  const maxLeft = containerRect.right - halfW;
  const left =
    minLeft > maxLeft
      ? (containerRect.left + containerRect.right) / 2
      : Math.min(maxLeft, Math.max(minLeft, centerX));

  const placement: "above" | "below" =
    selectionRect.top - containerRect.top >= topClearance ? "above" : "below";
  const top =
    placement === "above" ? selectionRect.top - 10 : selectionRect.bottom + 10;

  return {
    left: Math.round(left),
    top: Math.round(top),
    placement,
  };
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
