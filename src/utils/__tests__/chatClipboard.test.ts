import { describe, expect, it } from "bun:test";
import {
  copyTextToClipboard,
  getCopyableMessageText,
  stripThinkMarkup,
} from "../chatClipboard";

const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");

function restoreGlobals() {
  if (originalNavigatorDesc) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDesc);
  } else {
    delete (globalThis as Record<string, unknown>).navigator;
  }
  if (originalDocumentDesc) {
    Object.defineProperty(globalThis, "document", originalDocumentDesc);
  } else {
    delete (globalThis as Record<string, unknown>).document;
  }
}

describe("stripThinkMarkup & getCopyableMessageText", () => {
  it("strips closed and multiple <think> / <thinking> blocks and trims leading whitespace", () => {
    const raw =
      "<think>\ninternal reasoning\n</think>\n\n  <THINKING>second block</THINKING>\n\nFinal answer.";
    expect(stripThinkMarkup(raw)).toBe("Final answer.");
  });

  it("strips unclosed streaming <think> / <thinking> tails", () => {
    expect(stripThinkMarkup("Prefix\n<think>partial thoughts")).toBe("Prefix\n");
    expect(stripThinkMarkup("<thinking>only reasoning")).toBe("");
  });

  it("preserves full Markdown formatting while trimming outer whitespace", () => {
    const markdown = [
      "<think>hidden</think>",
      "",
      "### 构建产物",
      "",
      "- **App**: `Valet.app`",
      "",
      "```bash",
      "systemctl status shadowsocks-libev",
      "```",
      "",
      "[link](https://example.com)   ",
    ].join("\n");

    expect(getCopyableMessageText(markdown)).toBe(
      [
        "### 构建产物",
        "",
        "- **App**: `Valet.app`",
        "",
        "```bash",
        "systemctl status shadowsocks-libev",
        "```",
        "",
        "[link](https://example.com)",
      ].join("\n")
    );
  });

  it("returns empty string for empty, whitespace-only, or think-only messages", () => {
    expect(getCopyableMessageText("")).toBe("");
    expect(getCopyableMessageText("   \n\t  ")).toBe("");
    expect(getCopyableMessageText("<think>just thinking</think>")).toBe("");
  });
});

describe("copyTextToClipboard", () => {
  it("returns false for empty text without calling clipboard APIs", async () => {
    try {
      let called = false;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          clipboard: {
            writeText: async () => {
              called = true;
            },
          },
        },
      });

      expect(await copyTextToClipboard("")).toBe(false);
      expect(called).toBe(false);
    } finally {
      restoreGlobals();
    }
  });

  it("uses navigator.clipboard.writeText when available", async () => {
    try {
      let copiedText = "";
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          clipboard: {
            writeText: async (value: string) => {
              copiedText = value;
            },
          },
        },
      });

      const ok = await copyTextToClipboard("### Hello\n\n```ts\nconst a = 1;\n```");
      expect(ok).toBe(true);
      expect(copiedText).toBe("### Hello\n\n```ts\nconst a = 1;\n```");
    } finally {
      restoreGlobals();
    }
  });

  it("falls back to hidden textarea + document.execCommand when clipboard API rejects", async () => {
    try {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          clipboard: {
            writeText: async () => {
              throw new Error("NotAllowedError");
            },
          },
        },
      });

      const children: unknown[] = [];
      let execCommandName = "";
      let appendedNode: unknown = null;
      let selected = false;
      let focused = false;

      const fakeTextarea = {
        value: "",
        readOnly: false,
        tabIndex: 0,
        style: {} as Record<string, string>,
        parentNode: {
          removeChild: (node: unknown) => {
            const idx = children.indexOf(node);
            if (idx >= 0) children.splice(idx, 1);
          },
        },
        setAttribute: () => {},
        focus: () => {
          focused = true;
        },
        select: () => {
          selected = true;
        },
      };

      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          activeElement: null,
          body: {
            appendChild: (node: unknown) => {
              children.push(node);
              appendedNode = node;
            },
          },
          createElement: (tag: string) => {
            expect(tag).toBe("textarea");
            return fakeTextarea;
          },
          execCommand: (cmd: string) => {
            execCommandName = cmd;
            expect(children.length).toBe(1);
            return true;
          },
        },
      });

      const ok = await copyTextToClipboard("fallback copy");
      expect(ok).toBe(true);
      expect(execCommandName).toBe("copy");
      expect(focused).toBe(true);
      expect(selected).toBe(true);
      expect(appendedNode).toBe(fakeTextarea);
      expect(fakeTextarea.value).toBe("fallback copy");
      expect(fakeTextarea.readOnly).toBe(true);
      expect(children.length).toBe(0);
    } finally {
      restoreGlobals();
    }
  });

  it("falls back when navigator.clipboard is missing and always removes textarea on failure", async () => {
    try {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {},
      });

      const children: unknown[] = [];
      const fakeTextarea = {
        value: "",
        readOnly: false,
        tabIndex: 0,
        style: {} as Record<string, string>,
        parentNode: {
          removeChild: (node: unknown) => {
            const idx = children.indexOf(node);
            if (idx >= 0) children.splice(idx, 1);
          },
        },
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
      };

      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          activeElement: null,
          body: {
            appendChild: (node: unknown) => {
              children.push(node);
            },
          },
          createElement: () => fakeTextarea,
          execCommand: () => false,
        },
      });

      expect(await copyTextToClipboard("should fail")).toBe(false);
      expect(children.length).toBe(0);
    } finally {
      restoreGlobals();
    }
  });

  it("returns false when neither clipboard API nor document fallback exists", async () => {
    try {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: undefined,
      });

      expect(await copyTextToClipboard("no dom")).toBe(false);
    } finally {
      restoreGlobals();
    }
  });
});
