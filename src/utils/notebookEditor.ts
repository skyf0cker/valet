import type { NotebookBlock, NotebookBlockType } from "../types/valet";
import {
  detectMarkdownShortcut,
  extractInlineRefs,
  joinTextWithInlineRefs,
  makeBlockId,
  parseInlineNotebookText,
  splitInlineRefs,
} from "./notebook";

export const MAX_NOTEBOOK_INDENT = 6;

const INDENTABLE_BLOCK_TYPES = new Set<NotebookBlockType>([
  "bullet",
  "numbered",
  "todo",
  "paragraph",
  "quote",
  "callout",
]);

const LIST_BLOCK_TYPES = new Set<NotebookBlockType>(["bullet", "numbered", "todo"]);

export function isIndentableBlockType(type: NotebookBlockType): boolean {
  return INDENTABLE_BLOCK_TYPES.has(type);
}

export function isListBlockType(type: NotebookBlockType): boolean {
  return LIST_BLOCK_TYPES.has(type);
}

export function clampBlockIndent(type: NotebookBlockType, indent?: number): number {
  if (!isIndentableBlockType(type)) return 0;
  if (typeof indent !== "number" || !Number.isFinite(indent)) return 0;
  return Math.max(0, Math.min(MAX_NOTEBOOK_INDENT, Math.floor(indent)));
}

function withNormalizedIndent(block: NotebookBlock, indent: number): NotebookBlock {
  const clamped = clampBlockIndent(block.type, indent);
  if (clamped === (block.indent ?? 0) && (clamped === 0 ? block.indent === undefined : true)) {
    return block;
  }
  const next: NotebookBlock = { ...block };
  if (clamped > 0) {
    next.indent = clamped;
  } else {
    delete next.indent;
  }
  return next;
}

/**
 * Returns the last contiguous index belonging to the nested subtree rooted at `index`.
 */
export function getSubtreeEndIndex(blocks: NotebookBlock[], index: number): number {
  const root = blocks[index];
  if (!root || !isIndentableBlockType(root.type)) return index;
  const baseIndent = clampBlockIndent(root.type, root.indent);
  let end = index;
  for (let i = index + 1; i < blocks.length; i++) {
    const candidate = blocks[i];
    if (!candidate || !isIndentableBlockType(candidate.type)) break;
    if (clampBlockIndent(candidate.type, candidate.indent) <= baseIndent) break;
    end = i;
  }
  return end;
}

/**
 * Computes the maximum allowed indent at `index` so a block never floats more than
 * one level deeper than the block directly above it.
 */
export function getMaxAllowedIndent(blocks: NotebookBlock[], index: number): number {
  if (index <= 0 || index >= blocks.length) return 0;
  const current = blocks[index];
  if (!current || !isIndentableBlockType(current.type)) return 0;
  const prev = blocks[index - 1];
  if (!prev || !isIndentableBlockType(prev.type)) return 0;
  return Math.min(MAX_NOTEBOOK_INDENT, clampBlockIndent(prev.type, prev.indent) + 1);
}

/**
 * Forward-normalizes every block's indent so deletes, moves, or pastes never leave
 * floating orphan indents or indents on non-indentable block types.
 */
export function normalizeBlockIndents(blocks: NotebookBlock[]): NotebookBlock[] {
  const result: NotebookBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i]!;
    if (!isIndentableBlockType(blk.type) || i === 0) {
      result.push(withNormalizedIndent(blk, 0));
      continue;
    }
    const prev = result[i - 1]!;
    const maxAllowed = isIndentableBlockType(prev.type)
      ? Math.min(MAX_NOTEBOOK_INDENT, clampBlockIndent(prev.type, prev.indent) + 1)
      : 0;
    const clamped = Math.min(clampBlockIndent(blk.type, blk.indent), maxAllowed);
    result.push(withNormalizedIndent(blk, clamped));
  }
  return result;
}

/**
 * Indents or outdents the block at `index` along with all contiguous nested descendants.
 * Returns `null` when the operation is a no-op (at boundary indent 0 or maxAllowed).
 */
export function indentBlockSubtree(
  blocks: NotebookBlock[],
  index: number,
  delta: 1 | -1
): NotebookBlock[] | null {
  const root = blocks[index];
  if (!root || !isIndentableBlockType(root.type)) return null;

  const curIndent = clampBlockIndent(root.type, root.indent);
  if (delta === -1 && curIndent === 0) return null;
  if (delta === 1 && curIndent >= getMaxAllowedIndent(blocks, index)) return null;

  const endIdx = getSubtreeEndIndex(blocks, index);
  const next = [...blocks];
  for (let i = index; i <= endIdx; i++) {
    const item = next[i]!;
    const nextIndent = clampBlockIndent(item.type, clampBlockIndent(item.type, item.indent) + delta);
    next[i] = withNormalizedIndent(item, nextIndent);
  }
  return next;
}

/**
 * Moves a block (together with its nested children) up or down past the adjacent sibling subtree.
 */
export function moveBlockSubtree(
  blocks: NotebookBlock[],
  index: number,
  delta: -1 | 1
): { blocks: NotebookBlock[]; nextIndex: number } | null {
  const root = blocks[index];
  if (!root) return null;

  const endIdx = getSubtreeEndIndex(blocks, index);
  const subtreeLen = endIdx - index + 1;
  const baseIndent = clampBlockIndent(root.type, root.indent);

  if (delta === -1) {
    if (index <= 0) return null;
    let target = index - 1;
    while (
      target > 0 &&
      isIndentableBlockType(blocks[target]!.type) &&
      clampBlockIndent(blocks[target]!.type, blocks[target]!.indent) > baseIndent
    ) {
      target -= 1;
    }
    const copy = [...blocks];
    const subtree = copy.splice(index, subtreeLen);
    copy.splice(target, 0, ...subtree);
    return {
      blocks: normalizeBlockIndents(copy),
      nextIndex: target,
    };
  }

  if (endIdx >= blocks.length - 1) return null;
  const nextSiblingStart = endIdx + 1;
  const nextSiblingEnd = getSubtreeEndIndex(blocks, nextSiblingStart);
  const copy = [...blocks];
  const subtree = copy.splice(index, subtreeLen);
  const insertAt = nextSiblingEnd + 1 - subtreeLen;
  copy.splice(insertAt, 0, ...subtree);
  return {
    blocks: normalizeBlockIndents(copy),
    nextIndex: insertAt,
  };
}

export interface NumberedMarker {
  index: number;
  label: string;
}

function toAlphaLabel(num: number): string {
  if (num <= 0) return String(num);
  let n = num;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function toRomanLabel(num: number): string {
  if (num <= 0 || num > 3999) return String(num);
  const table: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let rem = num;
  let out = "";
  for (const [val, sym] of table) {
    while (rem >= val) {
      out += sym;
      rem -= val;
    }
  }
  return out;
}

export function formatNumberedMarkerLabel(index: number, indent: number): string {
  const depth = ((indent % 3) + 3) % 3;
  if (depth === 1) return `${toAlphaLabel(index)}.`;
  if (depth === 2) return `${toRomanLabel(index)}.`;
  return `${index}.`;
}

/**
 * Computes independent per-level ordered list indices & Notion labels (`1. / a. / i.`),
 * preserving outer counters across deeper nested bullets/paragraphs.
 */
export function computeNumberedListMarkers(
  blocks: NotebookBlock[]
): Record<string, NumberedMarker> {
  const map: Record<string, NumberedMarker> = {};
  const counters: number[] = [];

  for (const blk of blocks) {
    const level = clampBlockIndent(blk.type, blk.indent);
    if (blk.type === "numbered") {
      counters.length = level + 1;
      const nextVal = (counters[level] ?? 0) + 1;
      counters[level] = nextVal;
      map[blk.id] = {
        index: nextVal,
        label: formatNumberedMarkerLabel(nextVal, level),
      };
    } else {
      counters.length = Math.min(counters.length, level);
    }
  }

  return map;
}

function leadingWhitespaceToIndent(ws: string): number {
  const expanded = ws.replace(/\t/g, "  ").length;
  return Math.min(MAX_NOTEBOOK_INDENT, Math.floor(expanded / 2));
}

const CALLOUT_START_RE = /^\s*>\s*\[!(?:note|info|tip|warning|important|caution)\]\s*(.*)$/i;
const QUOTE_LINE_RE = /^\s*>\s?(.*)$/;
const CODE_FENCE_OPEN_RE = /^\s*```([a-zA-Z0-9_+-]*)\s*$/;
const CODE_FENCE_CLOSE_RE = /^\s*```\s*$/;
const DIVIDER_LINE_RE = /^\s*(?:---+|\*\*\*+|___+)\s*$/;
const HEADING_LINE_RE = /^(#{1,6})\s+(.*)$/;
const TODO_LINE_RE = /^([ \t]*)(?:[-*+]\s+)?\[([ xX])\]\s+(.*)$/;
const BULLET_LINE_RE = /^([ \t]*)[-*+]\s+(.*)$/;
const NUMBERED_LINE_RE = /^([ \t]*)\d+[.)]\s+(.*)$/;

/**
 * Parses Markdown text into structured Notion-compatible `NotebookBlock[]`.
 */
export function parseMarkdownToBlocks(rawMarkdown: string): NotebookBlock[] {
  const normalized = rawMarkdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const out: NotebookBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fenceOpen = CODE_FENCE_OPEN_RE.exec(line);
    if (fenceOpen) {
      const lang = fenceOpen[1]?.trim() || "bash";
      const inner: string[] = [];
      i += 1;
      while (i < lines.length && !CODE_FENCE_CLOSE_RE.test(lines[i]!)) {
        inner.push(lines[i]!);
        i += 1;
      }
      out.push({
        id: makeBlockId("blk"),
        type: "code",
        language: lang,
        content: inner.join("\n"),
      });
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    if (DIVIDER_LINE_RE.test(line)) {
      out.push({
        id: makeBlockId("blk"),
        type: "divider",
        content: "",
      });
      continue;
    }

    const heading = HEADING_LINE_RE.exec(line.trimStart());
    if (heading) {
      const level = heading[1]!.length;
      const type: NotebookBlockType = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      out.push({
        id: makeBlockId("blk"),
        type,
        content: heading[2]!.trimEnd(),
      });
      continue;
    }

    const calloutStart = CALLOUT_START_RE.exec(line);
    if (calloutStart) {
      const parts: string[] = [];
      if (calloutStart[1]?.trim()) {
        parts.push(calloutStart[1].trimEnd());
      }
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1]!;
        if (CALLOUT_START_RE.test(nextLine)) break;
        const quoteCont = QUOTE_LINE_RE.exec(nextLine);
        if (!quoteCont) break;
        parts.push(quoteCont[1]!);
        i += 1;
      }
      out.push({
        id: makeBlockId("blk"),
        type: "callout",
        content: parts.join("\n"),
      });
      continue;
    }

    const quoteStart = QUOTE_LINE_RE.exec(line);
    if (quoteStart) {
      const parts: string[] = [quoteStart[1]!];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1]!;
        if (CALLOUT_START_RE.test(nextLine)) break;
        const quoteCont = QUOTE_LINE_RE.exec(nextLine);
        if (!quoteCont) break;
        parts.push(quoteCont[1]!);
        i += 1;
      }
      out.push({
        id: makeBlockId("blk"),
        type: "quote",
        content: parts.join("\n"),
      });
      continue;
    }

    const todoMatch = TODO_LINE_RE.exec(line);
    if (todoMatch) {
      const indent = leadingWhitespaceToIndent(todoMatch[1]!);
      out.push({
        id: makeBlockId("blk"),
        type: "todo",
        checked: todoMatch[2]!.toLowerCase() === "x",
        content: todoMatch[3]!,
        ...(indent > 0 ? { indent } : {}),
      });
      continue;
    }

    const bulletMatch = BULLET_LINE_RE.exec(line);
    if (bulletMatch) {
      const indent = leadingWhitespaceToIndent(bulletMatch[1]!);
      out.push({
        id: makeBlockId("blk"),
        type: "bullet",
        content: bulletMatch[2]!,
        ...(indent > 0 ? { indent } : {}),
      });
      continue;
    }

    const numberedMatch = NUMBERED_LINE_RE.exec(line);
    if (numberedMatch) {
      const indent = leadingWhitespaceToIndent(numberedMatch[1]!);
      out.push({
        id: makeBlockId("blk"),
        type: "numbered",
        content: numberedMatch[2]!,
        ...(indent > 0 ? { indent } : {}),
      });
      continue;
    }

    const paraIndentMatch = /^([ \t]*)(.*)$/.exec(line)!;
    const indent = leadingWhitespaceToIndent(paraIndentMatch[1]!);
    out.push({
      id: makeBlockId("blk"),
      type: "paragraph",
      content: paraIndentMatch[2]!,
      ...(indent > 0 ? { indent } : {}),
    });
  }

  return normalizeBlockIndents(out);
}

/**
 * Applies clipboard Markdown paste at the active selection inside a non-code block.
 * Returns `null` when plain native textarea paste should handle the event instead.
 */
export function applyMarkdownPasteToBlocks(params: {
  blocks: NotebookBlock[];
  blockIndex: number;
  selStart: number;
  selEnd: number;
  pastedText: string;
}): {
  blocks: NotebookBlock[];
  focusBlockId: string;
  focusCursorPos: number;
} | null {
  const { blocks, blockIndex, selStart, selEnd, pastedText } = params;
  const block = blocks[blockIndex];
  if (!block || block.type === "code" || !pastedText) return null;

  const normalizedPaste = pastedText.replace(/\r\n?/g, "\n");
  const isMultiLine = normalizedPaste.includes("\n");
  const { editableText, refs } = splitInlineRefs(block.content);

  // Single-line paste: convert only when pasting a Markdown line prefix into an empty paragraph.
  if (!isMultiLine) {
    if (
      block.type !== "paragraph" ||
      editableText !== "" ||
      refs.length > 0 ||
      selStart !== 0 ||
      selEnd !== 0
    ) {
      return null;
    }

    const shortcut =
      detectMarkdownShortcut(normalizedPaste, { trigger: "input", currentType: "paragraph" }) ??
      detectMarkdownShortcut(normalizedPaste, { trigger: "enter", currentType: "paragraph" });
    if (!shortcut) return null;

    if (shortcut.type === "divider") {
      const followPara: NotebookBlock = {
        id: makeBlockId("blk"),
        type: "paragraph",
        content: "",
      };
      const next = [...blocks];
      next.splice(blockIndex, 1, { id: block.id, type: "divider", content: "" }, followPara);
      return {
        blocks: normalizeBlockIndents(next),
        focusBlockId: followPara.id,
        focusCursorPos: 0,
      };
    }

    const next = [...blocks];
    next[blockIndex] = {
      id: block.id,
      type: shortcut.type,
      content: shortcut.content,
      checked: shortcut.checked,
      language: shortcut.language,
    };
    return {
      blocks: normalizeBlockIndents(next),
      focusBlockId: block.id,
      focusCursorPos: shortcut.content.length,
    };
  }

  // Multi-line paste: parse structured Markdown blocks cleanly around cursor before/after text.
  const parsed = parseMarkdownToBlocks(normalizedPaste);
  if (parsed.length === 0) return null;

  const before = editableText.slice(0, selStart);
  const after = editableText.slice(selEnd);
  const baseIndent = clampBlockIndent(block.type, block.indent);

  const shiftByBaseIndent = (blk: NotebookBlock): NotebookBlock => {
    if (baseIndent === 0 || !isIndentableBlockType(blk.type)) return blk;
    return withNormalizedIndent(blk, clampBlockIndent(blk.type, blk.indent) + baseIndent);
  };

  // Empty block with no inline refs -> replace directly with parsed blocks.
  if (block.type === "paragraph" && before === "" && after === "" && refs.length === 0) {
    const inserted = parsed.map((b, idx) => {
      const shifted = shiftByBaseIndent(b);
      return idx === 0 ? { ...shifted, id: block.id } : shifted;
    });
    const last = inserted[inserted.length - 1]!;
    let focusBlock = last;
    if (last.type === "divider" || last.type === "session_ref") {
      const trailing: NotebookBlock = {
        id: makeBlockId("blk"),
        type: "paragraph",
        content: "",
      };
      inserted.push(trailing);
      focusBlock = trailing;
    }
    const next = [...blocks];
    next.splice(blockIndex, 1, ...inserted);
    return {
      blocks: normalizeBlockIndents(next),
      focusBlockId: focusBlock.id,
      focusCursorPos: focusBlock.content.length,
    };
  }

  const next = [...blocks];
  const first = parsed[0]!;
  let remaining: NotebookBlock[];
  let headBlock: NotebookBlock;
  let usedParsedFirstInHead = false;

  if (before === "" && refs.length === 0 && block.type === "paragraph") {
    headBlock = shiftByBaseIndent({ ...first, id: block.id });
    remaining = parsed.slice(1).map(shiftByBaseIndent);
    usedParsedFirstInHead = true;
  } else if (first.type === "paragraph" && (first.indent ?? 0) === 0) {
    headBlock = {
      ...block,
      content: joinTextWithInlineRefs(`${before}${first.content}`, refs),
    };
    remaining = parsed.slice(1).map(shiftByBaseIndent);
    usedParsedFirstInHead = true;
  } else {
    headBlock = {
      ...block,
      content: joinTextWithInlineRefs(before, refs),
    };
    remaining = parsed.map(shiftByBaseIndent);
  }

  if (remaining.length === 0) {
    if (after) {
      if (headBlock.type === "code" || headBlock.type === "divider" || headBlock.type === "session_ref") {
        const trailing: NotebookBlock = {
          id: makeBlockId("blk"),
          type: "paragraph",
          content: after,
        };
        next.splice(blockIndex, 1, headBlock, trailing);
        return {
          blocks: normalizeBlockIndents(next),
          focusBlockId: trailing.id,
          focusCursorPos: 0,
        };
      }
      const curSplit = splitInlineRefs(headBlock.content);
      const cursorPos = curSplit.editableText.length;
      headBlock = {
        ...headBlock,
        content: joinTextWithInlineRefs(`${curSplit.editableText}${after}`, curSplit.refs),
      };
      next[blockIndex] = headBlock;
      return {
        blocks: normalizeBlockIndents(next),
        focusBlockId: headBlock.id,
        focusCursorPos: cursorPos,
      };
    }

    next[blockIndex] = headBlock;
    if (headBlock.type === "divider" || headBlock.type === "session_ref") {
      const trailing: NotebookBlock = {
        id: makeBlockId("blk"),
        type: "paragraph",
        content: "",
      };
      next.splice(blockIndex + 1, 0, trailing);
      return {
        blocks: normalizeBlockIndents(next),
        focusBlockId: trailing.id,
        focusCursorPos: 0,
      };
    }

    return {
      blocks: normalizeBlockIndents(next),
      focusBlockId: headBlock.id,
      focusCursorPos:
        headBlock.type === "code"
          ? headBlock.content.length
          : splitInlineRefs(headBlock.content).editableText.length,
    };
  }

  const tail = remaining[remaining.length - 1]!;
  let focusBlockId = tail.id;
  let focusCursorPos =
    tail.type === "code" ? tail.content.length : splitInlineRefs(tail.content).editableText.length;

  if (after) {
    if (tail.type === "divider" || tail.type === "session_ref" || tail.type === "code") {
      const trailing: NotebookBlock = {
        id: makeBlockId("blk"),
        type: "paragraph",
        content: after,
      };
      remaining.push(trailing);
      focusBlockId = trailing.id;
      focusCursorPos = 0;
    } else {
      const tailSplit = splitInlineRefs(tail.content);
      focusCursorPos = tailSplit.editableText.length;
      remaining[remaining.length - 1] = {
        ...tail,
        content: joinTextWithInlineRefs(`${tailSplit.editableText}${after}`, tailSplit.refs),
      };
    }
  } else if (tail.type === "divider" || tail.type === "session_ref") {
    const trailing: NotebookBlock = {
      id: makeBlockId("blk"),
      type: "paragraph",
      content: "",
    };
    remaining.push(trailing);
    focusBlockId = trailing.id;
    focusCursorPos = 0;
  }

  const insertedHeadRefs = usedParsedFirstInHead ? extractInlineRefs(headBlock.content) : refs;
  if (!usedParsedFirstInHead && insertedHeadRefs.length === 0 && headBlock.content === "") {
    // Drop the empty original paragraph if nothing remained before the pasted block sequence.
    next.splice(blockIndex, 1, ...remaining);
  } else {
    next.splice(blockIndex, 1, headBlock, ...remaining);
  }

  return {
    blocks: normalizeBlockIndents(next),
    focusBlockId,
    focusCursorPos,
  };
}

export type InlineFormatKind = "bold" | "italic" | "strike" | "code" | "link";

function countConsecutiveCharsBackward(text: string, endExclusive: number, ch: string): number {
  let count = 0;
  for (let i = endExclusive - 1; i >= 0 && text[i] === ch; i--) {
    count += 1;
  }
  return count;
}

function countConsecutiveCharsForward(text: string, startInclusive: number, ch: string): number {
  let count = 0;
  for (let i = startInclusive; i < text.length && text[i] === ch; i++) {
    count += 1;
  }
  return count;
}

/**
 * Wraps or unwraps inline Markdown syntax (`**bold**`, `*italic*`, `~~strike~~`,
 * `` `code` ``, `[label](url)`) cleanly around the current selection or caret.
 */
export function toggleInlineMarkdownFormat(
  text: string,
  selStart: number,
  selEnd: number,
  format: InlineFormatKind
): { text: string; selectionStart: number; selectionEnd: number } {
  const start = Math.max(0, Math.min(text.length, Math.min(selStart, selEnd)));
  const end = Math.max(start, Math.min(text.length, Math.max(selStart, selEnd)));
  const selected = text.slice(start, end);

  if (format === "link") {
    const mdLinkMatch = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(selected);
    if (mdLinkMatch) {
      const label = mdLinkMatch[1]!;
      return {
        text: `${text.slice(0, start)}${label}${text.slice(end)}`,
        selectionStart: start,
        selectionEnd: start + label.length,
      };
    }

    if (start === end) {
      const template = "[](https://)";
      return {
        text: `${text.slice(0, start)}${template}${text.slice(end)}`,
        selectionStart: start + 1,
        selectionEnd: start + 1,
      };
    }

    if (/^https?:\/\/\S+$/.test(selected.trim())) {
      const url = selected.trim();
      const inserted = `[](${url})`;
      return {
        text: `${text.slice(0, start)}${inserted}${text.slice(end)}`,
        selectionStart: start + 1,
        selectionEnd: start + 1,
      };
    }

    const inserted = `[${selected}](https://)`;
    const urlStart = start + selected.length + 3;
    return {
      text: `${text.slice(0, start)}${inserted}${text.slice(end)}`,
      selectionStart: urlStart,
      selectionEnd: urlStart + 8,
    };
  }

  if (format === "italic") {
    const leftOuter = countConsecutiveCharsBackward(text, start, "*");
    const rightOuter = countConsecutiveCharsForward(text, end, "*");
    if (Math.min(leftOuter, rightOuter) % 2 === 1) {
      return {
        text: `${text.slice(0, start - 1)}${selected}${text.slice(end + 1)}`,
        selectionStart: start - 1,
        selectionEnd: end - 1,
      };
    }

    const leftInner = countConsecutiveCharsForward(selected, 0, "*");
    const rightInner = countConsecutiveCharsBackward(selected, selected.length, "*");
    if (selected.length >= 2 && Math.min(leftInner, rightInner) % 2 === 1) {
      const inner = selected.slice(1, selected.length - 1);
      return {
        text: `${text.slice(0, start)}${inner}${text.slice(end)}`,
        selectionStart: start,
        selectionEnd: start + inner.length,
      };
    }

    return {
      text: `${text.slice(0, start)}*${selected}*${text.slice(end)}`,
      selectionStart: start + 1,
      selectionEnd: end + 1,
    };
  }

  const delim = format === "bold" ? "**" : format === "strike" ? "~~" : "`";
  const dLen = delim.length;

  if (
    start >= dLen &&
    end + dLen <= text.length &&
    text.slice(start - dLen, start) === delim &&
    text.slice(end, end + dLen) === delim
  ) {
    return {
      text: `${text.slice(0, start - dLen)}${selected}${text.slice(end + dLen)}`,
      selectionStart: start - dLen,
      selectionEnd: end - dLen,
    };
  }

  if (
    selected.length >= dLen * 2 &&
    selected.startsWith(delim) &&
    selected.endsWith(delim)
  ) {
    const inner = selected.slice(dLen, selected.length - dLen);
    return {
      text: `${text.slice(0, start)}${inner}${text.slice(end)}`,
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }

  return {
    text: `${text.slice(0, start)}${delim}${selected}${delim}${text.slice(end)}`,
    selectionStart: start + dLen,
    selectionEnd: end + dLen,
  };
}

/**
 * Handles Tab / Shift+Tab inside Notebook `code` blocks using 2-space indentation.
 */
export function applyCodeBlockTab(
  text: string,
  selStart: number,
  selEnd: number,
  shiftKey: boolean
): { text: string; selectionStart: number; selectionEnd: number } {
  const start = Math.max(0, Math.min(text.length, Math.min(selStart, selEnd)));
  const end = Math.max(start, Math.min(text.length, Math.max(selStart, selEnd)));

  if (!shiftKey && start === end) {
    return {
      text: `${text.slice(0, start)}  ${text.slice(end)}`,
      selectionStart: start + 2,
      selectionEnd: start + 2,
    };
  }

  const blockStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const effectiveEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const nextNewline = text.indexOf("\n", effectiveEnd);
  const blockEnd = nextNewline === -1 ? text.length : nextNewline;
  const lines = text.slice(blockStart, blockEnd).split("\n");

  if (!shiftKey) {
    const indented = lines.map((line) => `  ${line}`).join("\n");
    const totalAdded = lines.length * 2;
    const nextStart = start === blockStart && lines.length > 1 ? blockStart : start + 2;
    return {
      text: `${text.slice(0, blockStart)}${indented}${text.slice(blockEnd)}`,
      selectionStart: nextStart,
      selectionEnd: end + totalAdded,
    };
  }

  let firstRemoved = 0;
  let totalRemoved = 0;
  const outdentedLines = lines.map((line, idx) => {
    let removed = 0;
    if (line.startsWith("\t")) {
      removed = 1;
    } else {
      const m = /^ {1,2}/.exec(line);
      removed = m ? m[0].length : 0;
    }
    if (idx === 0) firstRemoved = removed;
    totalRemoved += removed;
    return line.slice(removed);
  });

  const nextStart = Math.max(blockStart, start - firstRemoved);
  const nextEnd = Math.max(nextStart, end - totalRemoved);
  return {
    text: `${text.slice(0, blockStart)}${outdentedLines.join("\n")}${text.slice(blockEnd)}`,
    selectionStart: nextStart,
    selectionEnd: nextEnd,
  };
}

/**
 * Inserts a newline while preserving the current line's leading indentation in code blocks.
 */
export function applyCodeBlockEnter(
  text: string,
  selStart: number,
  selEnd: number
): { text: string; selectionStart: number; selectionEnd: number } {
  const start = Math.max(0, Math.min(text.length, Math.min(selStart, selEnd)));
  const end = Math.max(start, Math.min(text.length, Math.max(selStart, selEnd)));
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const leading = /^[ \t]*/.exec(text.slice(lineStart, start))?.[0] ?? "";
  const insertion = `\n${leading}`;
  return {
    text: `${text.slice(0, start)}${insertion}${text.slice(end)}`,
    selectionStart: start + insertion.length,
    selectionEnd: start + insertion.length,
  };
}

/**
 * Maps a character offset in rendered inline display text (excluding Markdown markers)
 * back to the corresponding character offset in raw editable text.
 */
export function mapRenderedOffsetToRawOffset(rawText: string, renderedOffset: number): number {
  if (!rawText || renderedOffset <= 0) return 0;
  const segments = parseInlineNotebookText(rawText);
  let rawCursor = 0;
  let renderedCursor = 0;

  for (const seg of segments) {
    if (seg.kind === "session" || seg.kind === "inbox" || seg.kind === "timeline") {
      // Inline ref tokens are displayed separately when editing.
      continue;
    }

    let prefixLen = 0;
    let suffixLen = 0;
    let visibleText = "";
    let rawSegmentText = "";

    if (seg.kind === "text") {
      visibleText = seg.text;
      rawSegmentText = seg.text;
    } else if (seg.kind === "bold") {
      prefixLen = 2;
      suffixLen = 2;
      visibleText = seg.text;
      rawSegmentText = `**${seg.text}**`;
    } else if (seg.kind === "italic") {
      prefixLen = 1;
      suffixLen = 1;
      visibleText = seg.text;
      rawSegmentText = `*${seg.text}*`;
    } else if (seg.kind === "strike") {
      prefixLen = 2;
      suffixLen = 2;
      visibleText = seg.text;
      rawSegmentText = `~~${seg.text}~~`;
    } else if (seg.kind === "code") {
      prefixLen = 1;
      suffixLen = 1;
      visibleText = seg.text;
      rawSegmentText = `\`${seg.text}\``;
    } else if (seg.kind === "link") {
      visibleText = seg.label;
      const mdCandidate = `[${seg.label}](${seg.href})`;
      if (rawText.startsWith(mdCandidate, rawCursor)) {
        prefixLen = 1;
        suffixLen = mdCandidate.length - 1 - seg.label.length;
        rawSegmentText = mdCandidate;
      } else {
        rawSegmentText = seg.href;
      }
    }

    const visLen = visibleText.length;
    if (renderedOffset <= renderedCursor + visLen) {
      const innerOffset = Math.max(0, renderedOffset - renderedCursor);
      return Math.min(rawText.length, rawCursor + prefixLen + innerOffset);
    }

    renderedCursor += visLen;
    rawCursor += rawSegmentText.length || prefixLen + visLen + suffixLen;
  }

  return rawText.length;
}
