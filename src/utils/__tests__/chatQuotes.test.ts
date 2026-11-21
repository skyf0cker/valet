import { describe, expect, it } from "bun:test";
import type { ChatAttachment } from "../../types/valet";
import {
  buildMessageQuoteAttachment,
  computeQuotePopoverPosition,
  isAnyQuoteAttachment,
  isMessageQuoteAttachment,
  isQuoteAttachment,
  normalizeSelectedQuoteText,
} from "../chatQuotes";

describe("chatQuotes selection utilities", () => {
  it("normalizes line breaks, HTML table tabs, blank lines, and caps at 4000 chars", () => {
    const rawTable =
      "\n  \r\nsystem_overview\t实时系统概览：磁盘、内存、CPU\r\nread_file\t\t安全读取文本文件  \n\n\n\nlist_dir\t列目录内容 \t \n  ";
    const normalized = normalizeSelectedQuoteText(rawTable);
    expect(normalized).toBe(
      [
        "system_overview | 实时系统概览：磁盘、内存、CPU",
        "read_file | 安全读取文本文件",
        "",
        "list_dir | 列目录内容",
      ].join("\n")
    );

    const longInput = "a".repeat(4500);
    const truncated = normalizeSelectedQuoteText(longInput);
    expect(truncated.length <= 4000).toBe(true);
    expect(truncated.endsWith("…(已截断)")).toBe(true);
    expect(normalizeSelectedQuoteText("   \n\t  ")).toBe("");
  });

  it("builds deterministic message_quote attachments with distinct IDs per excerpt", () => {
    expect(
      buildMessageQuoteAttachment({
        text: "   \n  ",
        messageId: "msg-1",
        role: "assistant",
      })
    ).toBe(null);

    const a1 = buildMessageQuoteAttachment({
      text: "system_overview\t实时系统概览\nread_file\t安全读取文本文件",
      messageId: "msg-1",
      role: "assistant",
    });
    const a1Dup = buildMessageQuoteAttachment({
      text: "system_overview\t实时系统概览\r\nread_file\t安全读取文本文件  ",
      messageId: "msg-1",
      role: "assistant",
    });
    const a2 = buildMessageQuoteAttachment({
      text: "list_dir\t列目录内容",
      messageId: "msg-1",
      role: "assistant",
    });
    const u1 = buildMessageQuoteAttachment({
      text: "请对比上述两个工具",
      messageId: "msg-usr-1",
      role: "user",
    });

    expect(a1 !== null).toBe(true);
    expect(a1!.kind).toBe("message_quote");
    expect(a1!.badge).toBe("引用 Valet");
    expect(a1!.refId).toBe("msg-1");
    expect(a1!.meta).toContain("2 行 · ");
    expect(a1!.id).toBe(a1Dup!.id);
    expect(a1!.id).not.toBe(a2!.id);
    expect(u1!.badge).toBe("引用我的消息");
    expect(u1!.meta).toBe("9 字");

    const veryLongSingleLine = buildMessageQuoteAttachment({
      text: "这是一段非常长的单行引用文本用于测试预览标题截断效果".repeat(4),
      role: "assistant",
    });
    expect(veryLongSingleLine!.id.startsWith("quote-msg-live-")).toBe(true);
    expect(Array.from(veryLongSingleLine!.name).length <= 72).toBe(true);
    expect(veryLongSingleLine!.name.endsWith("…")).toBe(true);
  });

  it("distinguishes inbox/timeline quotes from message selection quotes cleanly", () => {
    const inboxAtt: ChatAttachment = {
      id: "quote-inbox-1",
      kind: "inbox_item",
      refId: "inbox-1",
      name: "清理建议",
    };
    const msgQuote = buildMessageQuoteAttachment({
      text: "read_file | 安全读取文本文件",
      messageId: "m1",
      role: "assistant",
    })!;
    const fileAtt: ChatAttachment = {
      id: "f1",
      kind: "file",
      name: "log.txt",
    };

    expect(isQuoteAttachment(inboxAtt)).toBe(true);
    expect(isMessageQuoteAttachment(inboxAtt)).toBe(false);
    expect(isAnyQuoteAttachment(inboxAtt)).toBe(true);

    expect(isQuoteAttachment(msgQuote)).toBe(false);
    expect(isMessageQuoteAttachment(msgQuote)).toBe(true);
    expect(isAnyQuoteAttachment(msgQuote)).toBe(true);

    expect(isAnyQuoteAttachment(fileAtt)).toBe(false);
  });

  it("computes floating popover coordinates with top-flip, edge clamping, and visibility checks", () => {
    const container = { left: 100, top: 80, right: 700, bottom: 600 };

    const above = computeQuotePopoverPosition({
      selectionRect: {
        left: 300,
        top: 220,
        right: 460,
        bottom: 244,
        width: 160,
        height: 24,
      },
      containerRect: container,
    });
    expect(above).toEqual({ left: 380, top: 210, placement: "above" });

    const flippedBelow = computeQuotePopoverPosition({
      selectionRect: {
        left: 110,
        top: 95,
        right: 190,
        bottom: 115,
        width: 80,
        height: 20,
      },
      containerRect: container,
    });
    expect(flippedBelow).toEqual({ left: 176, top: 125, placement: "below" });

    const clampedRight = computeQuotePopoverPosition({
      selectionRect: {
        left: 650,
        top: 300,
        right: 710,
        bottom: 320,
        width: 60,
        height: 20,
      },
      containerRect: container,
    });
    expect(clampedRight).toEqual({ left: 624, top: 290, placement: "above" });

    expect(
      computeQuotePopoverPosition({
        selectionRect: { left: 200, top: 40, right: 300, bottom: 60, width: 100, height: 20 },
        containerRect: container,
      })
    ).toBe(null);

    expect(
      computeQuotePopoverPosition({
        selectionRect: { left: 200, top: 200, right: 200, bottom: 200, width: 0, height: 0 },
        containerRect: container,
      })
    ).toBe(null);
  });
});
