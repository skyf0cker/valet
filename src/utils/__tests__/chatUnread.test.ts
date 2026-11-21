import { describe, expect, it } from "bun:test";
import type { ChatMessage, ChatThread } from "../../types/valet";
import {
  collectAssistantMessageIds,
  computeNextUnreadCounts,
  countUnreadThreads,
  getVisibleChatId,
  isChatThreadVisible,
  pruneUnreadCounts,
} from "../chatUnread";

function makeMsg(
  id: string,
  role: "user" | "assistant",
  content = "msg"
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: "12:00",
  };
}

function makeThread(
  id: string,
  messages: ChatMessage[],
  archived = false
): ChatThread {
  return {
    id,
    projectId: "proj-default",
    title: `Thread ${id}`,
    model: "claude-opus-4",
    timelineActionCount: 0,
    linkedEventIds: [],
    updatedAt: "12:00",
    archived,
    messages,
  };
}

describe("chatUnread utilities", () => {
  it("determines visible chat thread across views and project tabs", () => {
    expect(
      getVisibleChatId({
        activeView: "projects",
        activeProjectTab: "session",
        activeChatId: "c1",
      })
    ).toBe("c1");
    expect(
      isChatThreadVisible(
        { activeView: "projects", activeProjectTab: "session", activeChatId: "c1" },
        "c1"
      )
    ).toBe(true);
    expect(
      isChatThreadVisible(
        { activeView: "chat", activeProjectTab: "session", activeChatId: "c1" },
        "c1"
      )
    ).toBe(true);

    expect(
      getVisibleChatId({
        activeView: "projects",
        activeProjectTab: "notebook",
        activeChatId: "c1",
      })
    ).toBe(null);
    expect(
      getVisibleChatId({
        activeView: "projects",
        activeProjectTab: "sessions",
        activeChatId: "c1",
      })
    ).toBe(null);
    expect(
      getVisibleChatId({
        activeView: "inbox",
        activeProjectTab: "session",
        activeChatId: "c1",
      })
    ).toBe(null);
    expect(
      getVisibleChatId({
        activeView: "timeline",
        activeProjectTab: "session",
        activeChatId: "c1",
      })
    ).toBe(null);
    expect(
      getVisibleChatId({
        activeView: "settings",
        activeProjectTab: "session",
        activeChatId: "c1",
      })
    ).toBe(null);
  });

  it("tracks unread assistant replies only for non-visible active chats", () => {
    const initialThreads = [
      makeThread("c1", [makeMsg("u1", "user"), makeMsg("a1", "assistant")]),
      makeThread("c2", [makeMsg("u2", "user"), makeMsg("a2", "assistant")]),
    ];

    const seen0 = collectAssistantMessageIds(initialThreads);

    // 1. Unchanged snapshot produces no unread and changed=false
    const noChange = computeNextUnreadCounts({
      prevUnread: {},
      seenAssistantIds: seen0,
      threads: initialThreads,
      visibleChatId: "c1",
    });
    expect(noChange.changed).toBe(false);
    expect(noChange.nextUnread).toEqual({});

    // 2. User-only message in non-visible c2 does NOT increment unread
    const userOnlyThreads = [
      initialThreads[0]!,
      makeThread("c2", [
        makeMsg("u2", "user"),
        makeMsg("a2", "assistant"),
        makeMsg("u2-new", "user"),
      ]),
    ];
    const userOnlyRes = computeNextUnreadCounts({
      prevUnread: noChange.nextUnread,
      seenAssistantIds: noChange.nextSeen,
      threads: userOnlyThreads,
      visibleChatId: "c1",
    });
    expect(userOnlyRes.changed).toBe(false);
    expect(userOnlyRes.nextUnread).toEqual({});

    // 3. New assistant reply in non-visible c2 increments unread 0 -> 1 -> 2
    const c2Reply1Threads = [
      initialThreads[0]!,
      makeThread("c2", [
        makeMsg("u2", "user"),
        makeMsg("a2", "assistant"),
        makeMsg("u2-new", "user"),
        makeMsg("a2-new-1", "assistant"),
      ]),
    ];
    const res1 = computeNextUnreadCounts({
      prevUnread: userOnlyRes.nextUnread,
      seenAssistantIds: userOnlyRes.nextSeen,
      threads: c2Reply1Threads,
      visibleChatId: "c1",
    });
    expect(res1.changed).toBe(true);
    expect(res1.nextUnread).toEqual({ c2: 1 });

    const c2Reply2Threads = [
      initialThreads[0]!,
      makeThread("c2", [
        makeMsg("u2", "user"),
        makeMsg("a2", "assistant"),
        makeMsg("u2-new", "user"),
        makeMsg("a2-new-1", "assistant"),
        makeMsg("a2-new-2", "assistant"),
      ]),
    ];
    const res2 = computeNextUnreadCounts({
      prevUnread: res1.nextUnread,
      seenAssistantIds: res1.nextSeen,
      threads: c2Reply2Threads,
      visibleChatId: "c1",
    });
    expect(res2.changed).toBe(true);
    expect(res2.nextUnread).toEqual({ c2: 2 });

    // 4. New assistant reply in currently visible c1 does NOT mark unread
    const c1VisibleReplyThreads = [
      makeThread("c1", [
        makeMsg("u1", "user"),
        makeMsg("a1", "assistant"),
        makeMsg("a1-new", "assistant"),
      ]),
      c2Reply2Threads[1]!,
    ];
    const resVisible = computeNextUnreadCounts({
      prevUnread: res2.nextUnread,
      seenAssistantIds: res2.nextSeen,
      threads: c1VisibleReplyThreads,
      visibleChatId: "c1",
    });
    expect(resVisible.changed).toBe(false);
    expect(resVisible.nextUnread).toEqual({ c2: 2 });

    // 5. Navigating to c2 clears c2 unread immediately
    const resCleared = computeNextUnreadCounts({
      prevUnread: resVisible.nextUnread,
      seenAssistantIds: resVisible.nextSeen,
      threads: c1VisibleReplyThreads,
      visibleChatId: "c2",
    });
    expect(resCleared.changed).toBe(true);
    expect(resCleared.nextUnread).toEqual({});
  });

  it("clears unread on archived or deleted threads and counts unread threads", () => {
    const active = [
      makeThread("c1", [makeMsg("a1", "assistant")]),
      makeThread("c2", [makeMsg("a2", "assistant")]),
      makeThread("c3", [makeMsg("a3", "assistant")], true),
    ];

    expect(countUnreadThreads({ c1: 2, c2: 1, c3: 5, missing: 3 }, active)).toBe(2);

    const pruned = pruneUnreadCounts(
      { c1: 2, c2: 1, c3: 5, missing: 3 },
      active,
      "c1"
    );
    expect(pruned).toEqual({ c2: 1 });

    // Same counts returns original reference
    expect(pruneUnreadCounts(pruned, active, "c1")).toBe(pruned);

    // Archiving c2 via computeNextUnreadCounts clears it
    const seen = collectAssistantMessageIds(active);
    const archivedUpdate = computeNextUnreadCounts({
      prevUnread: { c2: 1 },
      seenAssistantIds: seen,
      threads: [active[0]!, makeThread("c2", [makeMsg("a2", "assistant")], true)],
      visibleChatId: null,
    });
    expect(archivedUpdate.changed).toBe(true);
    expect(archivedUpdate.nextUnread).toEqual({});
  });
});
