import { describe, expect, it } from "bun:test";
import type { NotebookBlock } from "../../types/valet";
import {
  applyCodeBlockEnter,
  applyCodeBlockTab,
  applyMarkdownPasteToBlocks,
  clampBlockIndent,
  computeNumberedListMarkers,
  convertSelectedBlocks,
  deleteSelectedBlocks,
  duplicateSelectedBlocks,
  getBlockRangeIds,
  indentBlockSubtree,
  indentSelectedBlocks,
  mapRenderedOffsetToRawOffset,
  MAX_NOTEBOOK_INDENT,
  moveBlockSubtree,
  moveSelectedBlocks,
  parseMarkdownToBlocks,
  replaceSelectedBlocksWithMarkdown,
  toggleInlineMarkdownFormat,
  toggleSelectedTodos,
} from "../notebookEditor";

describe("notebookEditor indentation and subtree movement", () => {
  it("clamps indent strictly for indentable vs non-indentable block types", () => {
    expect(clampBlockIndent("bullet", undefined)).toBe(0);
    expect(clampBlockIndent("bullet", -2)).toBe(0);
    expect(clampBlockIndent("bullet", 2)).toBe(2);
    expect(clampBlockIndent("todo", 99)).toBe(MAX_NOTEBOOK_INDENT);
    expect(clampBlockIndent("h1", 2)).toBe(0);
    expect(clampBlockIndent("code", 1)).toBe(0);
    expect(clampBlockIndent("divider", 1)).toBe(0);
  });

  it("indents and outdents a parent list item together with its nested subtree", () => {
    const blocks: NotebookBlock[] = [
      { id: "b1", type: "bullet", content: "First" },
      { id: "b2", type: "bullet", content: "Second" },
      { id: "b3", type: "bullet", content: "Second child", indent: 1 },
      { id: "b4", type: "todo", content: "Second grandchild", indent: 2 },
      { id: "b5", type: "bullet", content: "Third" },
    ];

    // Cannot indent first block (index 0)
    expect(indentBlockSubtree(blocks, 0, 1)).toBe(null);

    // Indenting b2 moves b2, b3, b4 to indents 1, 2, 3 while leaving b5 at 0
    const indented = indentBlockSubtree(blocks, 1, 1);
    expect(indented).not.toBe(null);
    expect(indented!.map((b) => b.indent ?? 0)).toEqual([0, 1, 2, 3, 0]);

    // Cannot indent b2 past prev(b1).indent + 1
    expect(indentBlockSubtree(indented!, 1, 1)).toBe(null);

    // Outdenting b2 brings subtree back to 0, 1, 2
    const outdented = indentBlockSubtree(indented!, 1, -1);
    expect(outdented).not.toBe(null);
    expect(outdented!.map((b) => b.indent ?? 0)).toEqual([0, 0, 1, 2, 0]);
    expect(outdented![1]!.indent).toBe(undefined);
  });

  it("refuses to indent directly beneath a non-indentable heading or divider", () => {
    const blocks: NotebookBlock[] = [
      { id: "h", type: "h1", content: "Heading" },
      { id: "b", type: "bullet", content: "Item" },
    ];
    expect(indentBlockSubtree(blocks, 1, 1)).toBe(null);
  });

  it("moves a parent block along with its nested children cleanly up and down", () => {
    const blocks: NotebookBlock[] = [
      { id: "a", type: "bullet", content: "Alpha" },
      { id: "a1", type: "bullet", content: "Alpha child", indent: 1 },
      { id: "b", type: "bullet", content: "Beta" },
      { id: "b1", type: "bullet", content: "Beta child", indent: 1 },
    ];

    const movedUp = moveBlockSubtree(blocks, 2, -1);
    expect(movedUp).not.toBe(null);
    expect(movedUp!.nextIndex).toBe(0);
    expect(movedUp!.blocks.map((x) => x.id)).toEqual(["b", "b1", "a", "a1"]);
    expect(movedUp!.blocks.map((x) => x.indent ?? 0)).toEqual([0, 1, 0, 1]);

    const movedDown = moveBlockSubtree(movedUp!.blocks, 0, 1);
    expect(movedDown).not.toBe(null);
    expect(movedDown!.nextIndex).toBe(2);
    expect(movedDown!.blocks.map((x) => x.id)).toEqual(["a", "a1", "b", "b1"]);
  });

  it("computes independent per-level Notion markers (1./a./i.) across nested lists", () => {
    const blocks: NotebookBlock[] = [
      { id: "n1", type: "numbered", content: "First" },
      { id: "n1a", type: "numbered", content: "Sub A", indent: 1 },
      { id: "n1a1", type: "numbered", content: "Sub i", indent: 2 },
      { id: "n1a2", type: "numbered", content: "Sub ii", indent: 2 },
      { id: "note", type: "bullet", content: "Nested bullet under First", indent: 1 },
      { id: "n2", type: "numbered", content: "Second" },
      { id: "brk", type: "paragraph", content: "Top paragraph" },
      { id: "n3", type: "numbered", content: "New list 1" },
    ];

    const markers = computeNumberedListMarkers(blocks);
    expect(markers["n1"]).toEqual({ index: 1, label: "1." });
    expect(markers["n1a"]).toEqual({ index: 1, label: "a." });
    expect(markers["n1a1"]).toEqual({ index: 1, label: "i." });
    expect(markers["n1a2"]).toEqual({ index: 2, label: "ii." });
    expect(markers["n2"]).toEqual({ index: 2, label: "2." });
    expect(markers["n3"]).toEqual({ index: 1, label: "1." });
  });
});

describe("notebookEditor Markdown paste and block conversion", () => {
  it("parses headings, nested lists, todos, callouts, quotes, dividers, and code blocks", () => {
    const md = [
      "# Roadmap",
      "",
      "- Top bullet",
      "  - Nested bullet",
      "\t- Sibling nested bullet",
      "1. Step one",
      "  1) Step alpha",
      "- [x] Shipped",
      "  - [ ] Follow-up task",
      "> [!note] Important detail",
      "> Second callout line",
      "",
      "> Quoted text",
      "---",
      "```typescript",
      "const x = 1;",
      "console.log(x);",
      "```",
    ].join("\n");

    const parsed = parseMarkdownToBlocks(md);
    expect(parsed.map((b) => [b.type, b.indent ?? 0])).toEqual([
      ["h1", 0],
      ["bullet", 0],
      ["bullet", 1],
      ["bullet", 1],
      ["numbered", 0],
      ["numbered", 1],
      ["todo", 0],
      ["todo", 1],
      ["callout", 0],
      ["quote", 0],
      ["divider", 0],
      ["code", 0],
    ]);
    expect(parsed[6]!.checked).toBe(true);
    expect(parsed[7]!.checked).toBe(false);
    expect(parsed[8]!.content).toBe("Important detail\nSecond callout line");
    expect(parsed[11]!.language).toBe("typescript");
    expect(parsed[11]!.content).toBe("const x = 1;\nconsole.log(x);");
  });

  it("handles mid-line multi-line paste while preserving before/after text and inline refs", () => {
    const blocks: NotebookBlock[] = [
      { id: "b1", type: "paragraph", content: "Start end [[session:chat-1]]" },
    ];
    const res = applyMarkdownPasteToBlocks({
      blocks,
      blockIndex: 0,
      selStart: 6,
      selEnd: 6,
      pastedText: "mid\n- Child item\n- Last ",
    });

    expect(res).not.toBe(null);
    expect(res!.blocks).toHaveLength(3);
    expect(res!.blocks[0]!.content).toBe("Start mid [[session:chat-1]]");
    expect(res!.blocks[1]!.type).toBe("bullet");
    expect(res!.blocks[1]!.content).toBe("Child item");
    expect(res!.blocks[2]!.type).toBe("bullet");
    expect(res!.blocks[2]!.content).toBe("Last end");
    expect(res!.focusBlockId).toBe(res!.blocks[2]!.id);
    expect(res!.focusCursorPos).toBe("Last ".length);
  });

  it("converts single-line markdown prefix pasted into an empty paragraph", () => {
    const blocks: NotebookBlock[] = [{ id: "b1", type: "paragraph", content: "" }];
    const res = applyMarkdownPasteToBlocks({
      blocks,
      blockIndex: 0,
      selStart: 0,
      selEnd: 0,
      pastedText: "## Release Checklist",
    });

    expect(res).not.toBe(null);
    expect(res!.blocks[0]).toEqual({
      id: "b1",
      type: "h2",
      content: "Release Checklist",
      checked: undefined,
      language: undefined,
    });
    expect(res!.focusBlockId).toBe("b1");
    expect(res!.focusCursorPos).toBe("Release Checklist".length);
  });
});

describe("notebookEditor inline formatting, code editing, and click caret mapping", () => {
  it("toggles bold, italic, strike, code, and link without colliding on * vs **", () => {
    const bolded = toggleInlineMarkdownFormat("hello world", 6, 11, "bold");
    expect(bolded).toEqual({ text: "hello **world**", selectionStart: 8, selectionEnd: 13 });

    // Pressing italic inside **world** should add a 3rd asterisk rather than stripping bold
    const boldAndItalic = toggleInlineMarkdownFormat(
      bolded.text,
      bolded.selectionStart,
      bolded.selectionEnd,
      "italic"
    );
    expect(boldAndItalic).toEqual({
      text: "hello ***world***",
      selectionStart: 9,
      selectionEnd: 14,
    });

    // Toggling bold off ***world*** strips ** leaving *world*
    const onlyItalic = toggleInlineMarkdownFormat(
      boldAndItalic.text,
      boldAndItalic.selectionStart,
      boldAndItalic.selectionEnd,
      "bold"
    );
    expect(onlyItalic).toEqual({
      text: "hello *world*",
      selectionStart: 7,
      selectionEnd: 12,
    });

    // Toggling italic off *world* unwraps to plain world
    const unwrapped = toggleInlineMarkdownFormat(
      onlyItalic.text,
      onlyItalic.selectionStart,
      onlyItalic.selectionEnd,
      "italic"
    );
    expect(unwrapped).toEqual({
      text: "hello world",
      selectionStart: 6,
      selectionEnd: 11,
    });

    expect(toggleInlineMarkdownFormat("foo", 0, 3, "code")).toEqual({
      text: "`foo`",
      selectionStart: 1,
      selectionEnd: 4,
    });

    expect(toggleInlineMarkdownFormat("docs", 0, 4, "link")).toEqual({
      text: "[docs](https://)",
      selectionStart: 7,
      selectionEnd: 15,
    });

    expect(toggleInlineMarkdownFormat("https://example.com", 0, 19, "link")).toEqual({
      text: "[](https://example.com)",
      selectionStart: 1,
      selectionEnd: 1,
    });
  });

  it("handles Tab indentation and Enter auto-indent inside code blocks", () => {
    const single = applyCodeBlockTab("const x = 1;", 0, 0, false);
    expect(single).toEqual({
      text: "  const x = 1;",
      selectionStart: 2,
      selectionEnd: 2,
    });

    const multi = applyCodeBlockTab("a\nb\nc", 0, 5, false);
    expect(multi).toEqual({
      text: "  a\n  b\n  c",
      selectionStart: 0,
      selectionEnd: 11,
    });

    const outdent = applyCodeBlockTab("  a\n b\nc", 0, 8, true);
    expect(outdent).toEqual({
      text: "a\nb\nc",
      selectionStart: 0,
      selectionEnd: 5,
    });

    const enter = applyCodeBlockEnter("  if (ok) {", 11, 11);
    expect(enter).toEqual({
      text: "  if (ok) {\n  ",
      selectionStart: 14,
      selectionEnd: 14,
    });
  });

  it("maps rendered display text offsets accurately back to raw Markdown indices", () => {
    const raw = "Hi **bold** and `code` with [docs](https://example.com)";
    // Rendered text: "Hi bold and code with docs"
    expect(mapRenderedOffsetToRawOffset(raw, 0)).toBe(0);
    // Boundary after "Hi " stays outside the bold delimiter
    expect(mapRenderedOffsetToRawOffset(raw, 3)).toBe(3);
    // Between 'b' and 'o' inside "bold" (rendered 4) maps inside **b|old** (raw 6)
    expect(mapRenderedOffsetToRawOffset(raw, 4)).toBe(6);
    // End of "bold" (rendered 7) maps before closing ** (raw 9)
    expect(mapRenderedOffsetToRawOffset(raw, 7)).toBe(9);
    // Between 'd' and 'o' inside "docs" (rendered 23) maps inside [d|ocs](...) (raw 30)
    expect(mapRenderedOffsetToRawOffset(raw, 23)).toBe(30);
    // End of rendered string -> end of raw string
    expect(mapRenderedOffsetToRawOffset(raw, 999)).toBe(raw.length);
  });
});

describe("notebookEditor multi-block selection operations", () => {
  it("computes inclusive forward and reverse block ranges cleanly", () => {
    const blocks: NotebookBlock[] = [
      { id: "a", type: "paragraph", content: "A" },
      { id: "b", type: "bullet", content: "B" },
      { id: "c", type: "todo", content: "C" },
      { id: "d", type: "paragraph", content: "D" },
    ];
    expect(getBlockRangeIds(blocks, "b", "d")).toEqual(["b", "c", "d"]);
    expect(getBlockRangeIds(blocks, "d", "b")).toEqual(["b", "c", "d"]);
    expect(getBlockRangeIds(blocks, "b", "missing")).toEqual([]);
  });

  it("deletes multi-block selections, normalizes indents, and falls back to one empty paragraph", () => {
    const blocks: NotebookBlock[] = [
      { id: "h", type: "h1", content: "Title" },
      { id: "b1", type: "bullet", content: "Parent" },
      { id: "b2", type: "bullet", content: "Child", indent: 1 },
      { id: "p", type: "paragraph", content: "Trailing", indent: 1 },
    ];

    const partial = deleteSelectedBlocks(blocks, new Set(["b1", "b2"]));
    expect(partial).not.toBe(null);
    expect(partial!.blocks.map((b) => [b.id, b.indent ?? 0])).toEqual([
      ["h", 0],
      ["p", 0],
    ]);
    expect(partial!.focusBlockId).toBe("h");
    expect(partial!.focusCursorPos).toBe("Title".length);

    const clearAll = deleteSelectedBlocks(
      blocks,
      new Set(["h", "b1", "b2", "p"])
    );
    expect(clearAll).not.toBe(null);
    expect(clearAll!.blocks).toHaveLength(1);
    expect(clearAll!.blocks[0]!.type).toBe("paragraph");
    expect(clearAll!.blocks[0]!.content).toBe("");
    expect(clearAll!.focusBlockId).toBe(clearAll!.blocks[0]!.id);
  });

  it("batch-indents and outdents selected blocks while preserving valid hierarchy", () => {
    const blocks: NotebookBlock[] = [
      { id: "p0", type: "bullet", content: "Anchor" },
      { id: "p1", type: "bullet", content: "First" },
      { id: "p2", type: "bullet", content: "Nested", indent: 1 },
      { id: "unselected", type: "bullet", content: "Child", indent: 2 },
    ];

    const indented = indentSelectedBlocks(blocks, new Set(["p1", "p2"]), 1);
    expect(indented).not.toBe(null);
    expect(indented!.map((b) => b.indent ?? 0)).toEqual([0, 1, 2, 2]);

    const outdented = indentSelectedBlocks(indented!, new Set(["p1", "p2"]), -1);
    expect(outdented).not.toBe(null);
    expect(outdented!.map((b) => b.indent ?? 0)).toEqual([0, 0, 1, 2]);

    // Outdenting p2 again pulls unselected level-2 child down to level 1 so no orphan exists
    const outdentedAgain = indentSelectedBlocks(outdented!, new Set(["p2"]), -1);
    expect(outdentedAgain).not.toBe(null);
    expect(outdentedAgain!.map((b) => b.indent ?? 0)).toEqual([0, 0, 0, 1]);
  });

  it("duplicates, moves, converts, toggles todos, and replaces selected blocks via Markdown paste", () => {
    const blocks: NotebookBlock[] = [
      { id: "a", type: "paragraph", content: "One" },
      { id: "b", type: "todo", checked: false, content: "Two" },
      { id: "div", type: "divider", content: "" },
      { id: "c", type: "todo", checked: true, content: "Three" },
    ];

    const dup = duplicateSelectedBlocks(blocks, new Set(["a", "b"]));
    expect(dup).not.toBe(null);
    expect(dup!.blocks.map((x) => x.content)).toEqual([
      "One",
      "Two",
      "One",
      "Two",
      "",
      "Three",
    ]);
    expect(dup!.duplicatedIds).toHaveLength(2);
    expect(dup!.duplicatedIds[0]).not.toBe("a");

    const movedDown = moveSelectedBlocks(blocks, new Set(["a", "b"]), 1);
    expect(movedDown).not.toBe(null);
    expect(movedDown!.map((x) => x.id)).toEqual(["div", "a", "b", "c"]);

    const movedUp = moveSelectedBlocks(movedDown!, new Set(["a", "b"]), -1);
    expect(movedUp).not.toBe(null);
    expect(movedUp!.map((x) => x.id)).toEqual(["a", "b", "div", "c"]);
    expect(moveSelectedBlocks(blocks, new Set(["a", "b"]), -1)).toBe(null);

    const converted = convertSelectedBlocks(blocks, new Set(["a", "div"]), "h2");
    expect(converted).not.toBe(null);
    expect(converted![0]!.type).toBe("h2");
    expect(converted![2]!.type).toBe("divider");

    const toggledTodos = toggleSelectedTodos(blocks, new Set(["b", "c"]));
    expect(toggledTodos).not.toBe(null);
    expect(toggledTodos![1]!.checked).toBe(true);
    expect(toggledTodos![3]!.checked).toBe(true);

    const uncheckAll = toggleSelectedTodos(toggledTodos!, new Set(["b", "c"]));
    expect(uncheckAll![1]!.checked).toBe(false);
    expect(uncheckAll![3]!.checked).toBe(false);

    const replaced = replaceSelectedBlocksWithMarkdown(
      blocks,
      new Set(["b", "div"]),
      "- New bullet\n  - Sub item"
    );
    expect(replaced).not.toBe(null);
    expect(replaced!.blocks.map((x) => [x.type, x.content, x.indent ?? 0])).toEqual([
      ["paragraph", "One", 0],
      ["bullet", "New bullet", 0],
      ["bullet", "Sub item", 1],
      ["todo", "Three", 0],
    ]);
    expect(replaced!.focusCursorPos).toBe("Sub item".length);
  });
});
