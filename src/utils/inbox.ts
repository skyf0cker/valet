import type { InboxApprovalItem, TimelineEvent } from "../types/valet";

function extractStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

/**
 * Extracts clickable option choices for a `user.question` / `ask_user` Inbox card,
 * checking top-level `options`, `toolArgs.options`, and legacy `payload.options`.
 */
export function getInboxQuestionOptions(
  item: Pick<InboxApprovalItem, "options" | "payload" | "toolArgs">
): string[] {
  const top = extractStringArray(item.options);
  if (top.length > 0) return top;
  const fromArgs = extractStringArray(item.toolArgs?.options);
  if (fromArgs.length > 0) return fromArgs;
  return extractStringArray(item.payload?.options);
}

/** Returns true when an Inbox card represents an interactive `ask_user` / `user.question` prompt. */
export function isQuestionInboxItem(
  item: Pick<InboxApprovalItem, "eventCode" | "toolName" | "options" | "payload" | "toolArgs">
): boolean {
  return (
    item.eventCode === "user.question" ||
    item.toolName === "ask_user" ||
    getInboxQuestionOptions(item).length > 0
  );
}

/** Returns true only for genuine 7-day reversible Trash/Vault file cleanup Inbox items. */
export function isReversibleTrashInboxItem(item: InboxApprovalItem): boolean {
  if (!item.reversible7d || isQuestionInboxItem(item)) {
    return false;
  }
  return (
    item.category === "files" ||
    item.iconKind === "trash" ||
    (item.reclaimableGB ?? 0) > 0 ||
    item.actionItems.some((a) => a.sizeMB > 0)
  );
}

/** Returns true when a Timeline event represents a file cleanup / trash action rather than a question or generic confirmation. */
export function isFileCleanupTimelineEvent(event: TimelineEvent): boolean {
  if (event.eventCode === "user.question" || Array.isArray(event.payload?.options)) {
    return false;
  }
  return (
    event.actionItems.some((a) => a.sizeMB > 0) ||
    event.eventCode.startsWith("fs.clean") ||
    Boolean(event.canRestore)
  );
}
