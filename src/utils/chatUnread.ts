import type { ChatThread, ValetSnapshot } from "../types/valet";

export const CHAT_UNREAD_STORAGE_KEY = "valet_chat_unread_v1";

type ViewVisibilityState = Pick<
  ValetSnapshot,
  "activeView" | "activeProjectTab" | "activeChatId"
>;

export function getVisibleChatId(state: ViewVisibilityState): string | null {
  const inSessionView =
    (state.activeView === "projects" || state.activeView === "chat") &&
    state.activeProjectTab === "session";
  if (!inSessionView || !state.activeChatId) return null;
  return state.activeChatId;
}

export function isChatThreadVisible(
  state: ViewVisibilityState,
  chatId: string
): boolean {
  return getVisibleChatId(state) === chatId;
}

export function collectAssistantMessageIds(
  threads: readonly ChatThread[]
): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const t of threads) {
    const ids = new Set<string>();
    for (const m of t.messages) {
      if (m.role === "assistant" && m.id) {
        ids.add(m.id);
      }
    }
    map[t.id] = ids;
  }
  return map;
}

export function loadPersistedUnreadCounts(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(CHAT_UNREAD_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        out[k] = Math.floor(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function persistUnreadCounts(counts: Record<string, number>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const keys = Object.keys(counts);
    if (keys.length === 0) {
      localStorage.removeItem(CHAT_UNREAD_STORAGE_KEY);
    } else {
      localStorage.setItem(CHAT_UNREAD_STORAGE_KEY, JSON.stringify(counts));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function shallowEqualCounts(
  a: Record<string, number>,
  b: Record<string, number>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function pruneUnreadCounts(
  counts: Record<string, number>,
  threads: readonly ChatThread[],
  visibleChatId?: string | null
): Record<string, number> {
  const activeIds = new Set<string>();
  for (const t of threads) {
    if (!t.archived) activeIds.add(t.id);
  }
  const next: Record<string, number> = {};
  for (const [id, rawCount] of Object.entries(counts)) {
    if (!activeIds.has(id)) continue;
    if (visibleChatId && id === visibleChatId) continue;
    if (typeof rawCount === "number" && Number.isFinite(rawCount) && rawCount > 0) {
      next[id] = Math.floor(rawCount);
    }
  }
  return shallowEqualCounts(counts, next) ? counts : next;
}

export function computeNextUnreadCounts(params: {
  prevUnread: Record<string, number>;
  seenAssistantIds: Record<string, Set<string>>;
  threads: readonly ChatThread[];
  visibleChatId: string | null;
}): {
  nextUnread: Record<string, number>;
  nextSeen: Record<string, Set<string>>;
  changed: boolean;
} {
  const { prevUnread, seenAssistantIds, threads, visibleChatId } = params;
  const nextSeen = collectAssistantMessageIds(threads);
  const nextUnread: Record<string, number> = {};

  for (const t of threads) {
    if (t.archived || t.id === visibleChatId) {
      continue;
    }
    const prevSeenSet = seenAssistantIds[t.id];
    const currSeenSet = nextSeen[t.id]!;
    let added = 0;
    for (const msgId of currSeenSet) {
      if (!prevSeenSet || !prevSeenSet.has(msgId)) {
        added += 1;
      }
    }
    const base = prevUnread[t.id] ?? 0;
    const total = base + added;
    if (total > 0) {
      nextUnread[t.id] = total;
    }
  }

  const changed = !shallowEqualCounts(prevUnread, nextUnread);
  return {
    nextUnread: changed ? nextUnread : prevUnread,
    nextSeen,
    changed,
  };
}

export function countUnreadThreads(
  counts: Record<string, number>,
  threads: readonly ChatThread[]
): number {
  let total = 0;
  for (const t of threads) {
    if (!t.archived && (counts[t.id] ?? 0) > 0) {
      total += 1;
    }
  }
  return total;
}
