import type { InboxApprovalItem, TimelineEvent } from "../types/valet";

export function findLinkedTimelineEvent(
  item: InboxApprovalItem,
  timelineEvents: TimelineEvent[]
): TimelineEvent | null {
  if (item.linkedTimelineEventId) {
    const direct = timelineEvents.find((e) => e.id === item.linkedTimelineEventId);
    if (direct) return direct;
  }

  const derivedIds = new Set([`evt-from-${item.id}`, `evt-batch-${item.id}`]);
  const derived = timelineEvents.find((e) => derivedIds.has(e.id));
  if (derived) return derived;

  const fallback = timelineEvents.find(
    (e) =>
      e.pluginId === item.pluginId &&
      e.eventCode === item.eventCode &&
      e.timeLabel === item.timeLabel
  );
  return fallback ?? null;
}

export function findLinkedInboxItem(
  event: TimelineEvent,
  inboxItems: InboxApprovalItem[]
): InboxApprovalItem | null {
  return (
    inboxItems.find(
      (it) =>
        it.linkedTimelineEventId === event.id ||
        `evt-from-${it.id}` === event.id ||
        `evt-batch-${it.id}` === event.id
    ) ?? null
  );
}
