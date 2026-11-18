import React, { useState } from "react";

const CodeBlockCard: React.FC<{ language: string; code: string }> = ({
  language,
  code,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-code)]">
      <div className="flex h-[28px] items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--ink-subtle)]">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="cursor-pointer font-mono text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
        >
          {copied ? "已复制 ✓" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[11.5px] leading-[18px] text-[var(--ink-secondary)]">
        <code>{code}</code>
      </pre>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Indentation helpers (spaces + 4-column tab stops)
// ---------------------------------------------------------------------------

function getIndentCols(line: string): number {
  let cols = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") {
      cols += 1;
    } else if (ch === "\t") {
      cols += 4 - (cols % 4);
    } else {
      break;
    }
  }
  return cols;
}

function stripIndentCols(line: string, maxCols: number): string {
  if (maxCols <= 0) return line;
  let cols = 0;
  let i = 0;
  while (i < line.length && cols < maxCols) {
    const ch = line[i];
    if (ch === " ") {
      cols += 1;
      i++;
    } else if (ch === "\t") {
      const nextCols = cols + (4 - (cols % 4));
      if (nextCols > maxCols) {
        return " ".repeat(nextCols - maxCols) + line.slice(i + 1);
      }
      cols = nextCols;
      i++;
    } else {
      break;
    }
  }
  return line.slice(i);
}

// ---------------------------------------------------------------------------
// Inline parser
// ---------------------------------------------------------------------------

const ESCAPABLE_CHARS = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  ".",
  "!",
  "|",
  "~",
  ">",
]);

function isEscapableChar(ch: string | undefined): boolean {
  return ch !== undefined && ESCAPABLE_CHARS.has(ch);
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === undefined || ch === "" || /\s/.test(ch);
}

function isSafeLinkUrl(url: string): boolean {
  return /^(?:https?:\/\/|mailto:)/i.test(url);
}

function findInlineCodeSpanEnd(
  text: string,
  start: number
): { contentStart: number; closeStart: number; closeEnd: number } | null {
  let j = start;
  while (j < text.length && text[j] === "`") j++;
  const tickLen = j - start;
  if (tickLen === 0) return null;

  let k = j;
  while (k < text.length) {
    if (text[k] === "`") {
      let m = k;
      while (m < text.length && text[m] === "`") m++;
      if (m - k === tickLen) {
        return { contentStart: j, closeStart: k, closeEnd: m };
      }
      k = m;
    } else {
      k++;
    }
  }
  return null;
}

function normalizeCodeSpanContent(raw: string): string {
  const singleLine = raw.replace(/\r?\n/g, " ");
  if (
    singleLine.length >= 2 &&
    singleLine.startsWith(" ") &&
    singleLine.endsWith(" ") &&
    /[^ ]/.test(singleLine)
  ) {
    return singleLine.slice(1, -1);
  }
  return singleLine;
}

function parseMarkdownLink(
  text: string,
  start: number
): { label: string; href: string; end: number } | null {
  if (text[start] !== "[") return null;

  let k = start + 1;
  let depth = 1;
  while (k < text.length) {
    const ch = text[k];
    if (ch === "\\" && isEscapableChar(text[k + 1])) {
      k += 2;
      continue;
    }
    if (ch === "`") {
      const span = findInlineCodeSpanEnd(text, k);
      if (span) {
        k = span.closeEnd;
      } else {
        while (k < text.length && text[k] === "`") k++;
      }
      continue;
    }
    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) break;
    }
    k++;
  }

  if (depth !== 0 || text[k + 1] !== "(") return null;

  const label = text.slice(start + 1, k);
  let p = k + 2;
  while (p < text.length && (text[p] === " " || text[p] === "\t")) p++;

  let href = "";
  if (text[p] === "<") {
    const angleStart = p + 1;
    let q = angleStart;
    while (q < text.length && text[q] !== ">" && text[q] !== "\n" && text[q] !== "<") {
      if (text[q] === "\\" && q + 1 < text.length) {
        q += 2;
        continue;
      }
      q++;
    }
    if (text[q] !== ">") return null;
    href = text.slice(angleStart, q).trim();
    p = q + 1;
  } else {
    const destStart = p;
    let parenDepth = 0;
    while (p < text.length) {
      const ch = text[p]!;
      if (ch === "\\" && isEscapableChar(text[p + 1])) {
        p += 2;
        continue;
      }
      if (/\s/.test(ch)) break;
      if (ch === "(") {
        parenDepth++;
      } else if (ch === ")") {
        if (parenDepth === 0) break;
        parenDepth--;
      }
      p++;
    }
    href = text.slice(destStart, p).replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, "$1");
  }

  // Optional whitespace and optional link title before closing ')'
  while (p < text.length && (text[p] === " " || text[p] === "\t")) p++;
  if (text[p] === '"' || text[p] === "'") {
    const quote = text[p];
    p++;
    while (p < text.length && text[p] !== quote && text[p] !== "\n") {
      if (text[p] === "\\" && p + 1 < text.length) {
        p += 2;
        continue;
      }
      p++;
    }
    if (text[p] !== quote) return null;
    p++;
    while (p < text.length && (text[p] === " " || text[p] === "\t")) p++;
  }

  if (text[p] !== ")" || !href || !isSafeLinkUrl(href)) return null;

  return { label, href, end: p + 1 };
}

function scanAngleAutolink(
  text: string,
  start: number
): { href: string; end: number } | null {
  if (text[start] !== "<") return null;
  const closeIdx = text.indexOf(">", start + 1);
  if (closeIdx === -1) return null;
  const inner = text.slice(start + 1, closeIdx);
  if (!inner || inner.includes("<") || /\s/.test(inner)) return null;
  if (!/^(?:https?:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+)$/i.test(inner)) return null;
  return { href: inner, end: closeIdx + 1 };
}

function scanBareUrl(
  text: string,
  start: number
): { href: string; end: number } | null {
  if (
    !text.startsWith("https://", start) &&
    !text.startsWith("http://", start)
  ) {
    return null;
  }
  if (start > 0 && /[A-Za-z0-9]/.test(text[start - 1]!)) {
    return null;
  }

  // Stop at whitespace, quotes, angle brackets, backticks, or CJK/fullwidth chars
  let k = start;
  while (k < text.length) {
    const ch = text[k]!;
    if (/[\s<>"'`\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]/.test(ch)) {
      break;
    }
    k++;
  }

  let candidate = text.slice(start, k);
  while (candidate.length > 0) {
    const last = candidate[candidate.length - 1]!;
    if (/[.,;:!?'"~*]/.test(last)) {
      candidate = candidate.slice(0, -1);
      continue;
    }
    if (last === ")" || last === "]" || last === "}") {
      const open = last === ")" ? "(" : last === "]" ? "[" : "{";
      let balance = 0;
      for (let i = 0; i < candidate.length; i++) {
        if (candidate[i] === open) balance++;
        else if (candidate[i] === last) balance--;
      }
      if (balance < 0) {
        candidate = candidate.slice(0, -1);
        continue;
      }
    }
    break;
  }

  if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(candidate)) {
    return null;
  }

  return { href: candidate, end: start + candidate.length };
}

function canOpenDelimiter(
  text: string,
  runStart: number,
  runEnd: number,
  delimChar: "*" | "_" | "~"
): boolean {
  const prevChar = runStart > 0 ? text[runStart - 1] : "";
  const nextChar = runEnd < text.length ? text[runEnd] : "";
  if (isWhitespace(nextChar)) return false;
  if (delimChar === "_" && isWordChar(prevChar) && isWordChar(nextChar)) {
    return false;
  }
  return true;
}

function canCloseDelimiter(
  text: string,
  runStart: number,
  runEnd: number,
  delimChar: "*" | "_" | "~"
): boolean {
  const prevChar = runStart > 0 ? text[runStart - 1] : "";
  const nextChar = runEnd < text.length ? text[runEnd] : "";
  if (isWhitespace(prevChar)) return false;
  if (delimChar === "_" && isWordChar(prevChar) && isWordChar(nextChar)) {
    return false;
  }
  return true;
}

function skipInlineAtom(text: string, k: number): number | null {
  const ch = text[k];
  if (ch === "\\" && isEscapableChar(text[k + 1])) {
    return k + 2;
  }
  if (ch === "`") {
    const span = findInlineCodeSpanEnd(text, k);
    if (span) return span.closeEnd;
    let end = k;
    while (end < text.length && text[end] === "`") end++;
    return end;
  }
  if (ch === "[") {
    const link = parseMarkdownLink(text, k);
    if (link) return link.end;
  }
  return null;
}

function findClosingDelimiter(
  text: string,
  searchStart: number,
  delimChar: "*" | "_" | "~",
  delimLen: number
): { closeStart: number; closeEnd: number } | null {
  let k = searchStart;
  while (k < text.length) {
    const skipped = skipInlineAtom(text, k);
    if (skipped !== null) {
      k = skipped;
      continue;
    }
    if (text[k] === delimChar) {
      let m = k;
      while (m < text.length && text[m] === delimChar) m++;
      const runLen = m - k;

      const matchesLen =
        delimChar === "~"
          ? runLen === 2
          : runLen === delimLen || (delimLen < 3 && runLen === 3);

      if (matchesLen && canCloseDelimiter(text, k, m, delimChar)) {
        const closeStart = delimLen < 3 && runLen === 3 ? m - delimLen : k;
        const closeEnd = closeStart + delimLen;
        if (closeStart > searchStart) {
          return { closeStart, closeEnd };
        }
      }
      k = m;
      continue;
    }
    k++;
  }
  return null;
}

function peekFirstClosingRunLen(
  text: string,
  searchStart: number,
  delimChar: "*" | "_"
): number | null {
  let k = searchStart;
  while (k < text.length) {
    const skipped = skipInlineAtom(text, k);
    if (skipped !== null) {
      k = skipped;
      continue;
    }
    if (text[k] === delimChar) {
      let m = k;
      while (m < text.length && text[m] === delimChar) m++;
      const runLen = m - k;
      if ((runLen === 1 || runLen === 2) && canCloseDelimiter(text, k, m, delimChar)) {
        return runLen;
      }
      k = m;
      continue;
    }
    k++;
  }
  return null;
}

function renderInline(
  text: string,
  keyPrefix = "in",
  inLink = false
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let plainBuf = "";
  let i = 0;
  let idx = 0;

  const flushPlain = () => {
    if (plainBuf) {
      nodes.push(plainBuf);
      plainBuf = "";
    }
  };

  while (i < text.length) {
    const ch = text[i]!;

    // 1. Backslash escape
    if (ch === "\\" && isEscapableChar(text[i + 1])) {
      plainBuf += text[i + 1]!;
      i += 2;
      continue;
    }

    // 2. Variable-length inline code span
    if (ch === "`") {
      const span = findInlineCodeSpanEnd(text, i);
      if (span) {
        flushPlain();
        const key = `${keyPrefix}-${idx++}`;
        nodes.push(
          <code
            key={key}
            className="rounded-[4px] bg-[var(--bg-muted)] px-1 py-0.5 font-mono text-[12px] font-semibold text-[var(--ink-strong)]"
          >
            {normalizeCodeSpanContent(text.slice(span.contentStart, span.closeStart))}
          </code>
        );
        i = span.closeEnd;
      } else {
        let j = i;
        while (j < text.length && text[j] === "`") j++;
        plainBuf += text.slice(i, j);
        i = j;
      }
      continue;
    }

    // 3. Markdown link [label](href)
    if (!inLink && ch === "[") {
      const link = parseMarkdownLink(text, i);
      if (link) {
        flushPlain();
        const key = `${keyPrefix}-${idx++}`;
        nodes.push(
          <a
            key={key}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--ink-strong)] underline decoration-[var(--border-strong)] underline-offset-2 hover:opacity-80"
          >
            {renderInline(link.label, `${key}-a`, true)}
          </a>
        );
        i = link.end;
        continue;
      }
    }

    // 4. Angle-bracket autolink <https://...> / <mailto:...>
    if (!inLink && ch === "<") {
      const auto = scanAngleAutolink(text, i);
      if (auto) {
        flushPlain();
        const key = `${keyPrefix}-${idx++}`;
        nodes.push(
          <a
            key={key}
            href={auto.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-[var(--ink-strong)] underline decoration-[var(--border-strong)] underline-offset-2 hover:opacity-80"
          >
            {auto.href}
          </a>
        );
        i = auto.end;
        continue;
      }
    }

    // 5. Bare URL autolink
    if (!inLink && ch === "h") {
      const bare = scanBareUrl(text, i);
      if (bare) {
        flushPlain();
        const key = `${keyPrefix}-${idx++}`;
        nodes.push(
          <a
            key={key}
            href={bare.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-[var(--ink-strong)] underline decoration-[var(--border-strong)] underline-offset-2 hover:opacity-80"
          >
            {bare.href}
          </a>
        );
        i = bare.end;
        continue;
      }
    }

    // 6. Emphasis & strikethrough (*, _, ~~)
    if (ch === "*" || ch === "_" || ch === "~") {
      let runEnd = i;
      while (runEnd < text.length && text[runEnd] === ch) runEnd++;
      const runLen = runEnd - i;

      if (ch === "~") {
        if (runLen === 2 && canOpenDelimiter(text, i, runEnd, "~")) {
          const match = findClosingDelimiter(text, runEnd, "~", 2);
          if (match) {
            flushPlain();
            const key = `${keyPrefix}-${idx++}`;
            nodes.push(
              <del key={key} className="text-[var(--ink-muted)] line-through">
                {renderInline(text.slice(runEnd, match.closeStart), `${key}-s`, inLink)}
              </del>
            );
            i = match.closeEnd;
            continue;
          }
        }
        plainBuf += text.slice(i, runEnd);
        i = runEnd;
        continue;
      }

      if (runLen > 3 || !canOpenDelimiter(text, i, runEnd, ch)) {
        plainBuf += text.slice(i, runEnd);
        i = runEnd;
        continue;
      }

      let matched = false;
      const tryLengths: number[] =
        runLen === 3
          ? peekFirstClosingRunLen(text, runEnd, ch) === 2
            ? [3, 1]
            : [3, 2, 1]
          : [runLen];

      for (const tryLen of tryLengths) {
        const openEnd = i + tryLen;
        const match = findClosingDelimiter(text, openEnd, ch, tryLen);
        if (!match) continue;

        flushPlain();
        const key = `${keyPrefix}-${idx++}`;
        const inner = text.slice(openEnd, match.closeStart);
        if (tryLen === 3) {
          nodes.push(
            <strong key={key} className="font-semibold italic text-[var(--ink-strong)]">
              {renderInline(inner, `${key}-bi`, inLink)}
            </strong>
          );
        } else if (tryLen === 2) {
          nodes.push(
            <strong key={key} className="font-semibold text-[var(--ink-strong)]">
              {renderInline(inner, `${key}-b`, inLink)}
            </strong>
          );
        } else {
          nodes.push(
            <em key={key} className="italic">
              {renderInline(inner, `${key}-i`, inLink)}
            </em>
          );
        }
        i = match.closeEnd;
        matched = true;
        break;
      }

      if (matched) continue;

      // Advance 1 char on unmatched runs so cases like **foo* still match inner *foo*
      plainBuf += ch;
      i += 1;
      continue;
    }

    plainBuf += ch;
    i++;
  }

  flushPlain();
  return nodes;
}

// ---------------------------------------------------------------------------
// Block matchers
// ---------------------------------------------------------------------------

function isHorizontalRule(line: string): boolean {
  return /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line);
}

interface FenceOpen {
  indentCols: number;
  char: "`" | "~";
  len: number;
  lang: string;
}

function matchCodeFenceOpen(line: string): FenceOpen | null {
  // Backtick info string cannot contain backticks (prevents matching inline ```foo```)
  const btMatch = /^(\s*)(`{3,})([^`]*)$/.exec(line);
  if (btMatch?.[2]) {
    const lang = (btMatch[3] ?? "").trim().split(/\s+/)[0] ?? "";
    return {
      indentCols: getIndentCols(btMatch[1] ?? ""),
      char: "`",
      len: btMatch[2].length,
      lang,
    };
  }
  const tildeMatch = /^(\s*)(~{3,})(.*)$/.exec(line);
  if (tildeMatch?.[2]) {
    const lang = (tildeMatch[3] ?? "").trim().split(/\s+/)[0] ?? "";
    return {
      indentCols: getIndentCols(tildeMatch[1] ?? ""),
      char: "~",
      len: tildeMatch[2].length,
      lang,
    };
  }
  return null;
}

function isCodeFenceClose(line: string, char: "`" | "~", minLen: number): boolean {
  const trimmed = line.trim();
  if (trimmed.length < minLen) return false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== char) return false;
  }
  return true;
}

function matchHeading(line: string): { level: number; content: string } | null {
  const m = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
  if (!m?.[1] || !m?.[2]) return null;
  return { level: m[1].length, content: m[2] };
}

function splitTableRow(rawLine: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inBacktick = false;
  let trimmed = rawLine.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    trimmed = trimmed.slice(0, -1);
  }

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === "\\" && trimmed[i + 1] === "|" && !inBacktick) {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "`") {
      inBacktick = !inBacktick;
      cur += ch;
      continue;
    }
    if (ch === "|" && !inBacktick) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || !trimmed.includes("-")) return false;
  return (
    /^\|?(?:\s*:?-{1,}:?\s*\|)+\s*(?::?-{1,}:?\s*\|?)?$/.test(trimmed) ||
    /^\|(?:\s*:?-{1,}:?\s*\|)+$/.test(trimmed)
  );
}

function parseTableAlignments(delimiterLine: string): Array<"left" | "center" | "right"> {
  return splitTableRow(delimiterLine).map((cell) => {
    const c = cell.trim();
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

interface ListMarker {
  indent: number;
  kind: "ordered" | "unordered";
  delimiter: string;
  orderNumber?: number;
  contentIndent: number;
  content: string;
  taskChecked?: boolean;
}

function parseTaskPrefix(rawContent: string): {
  content: string;
  taskChecked?: boolean;
} {
  const m = /^\[([ xX])\](?:\s+(.*)|$)$/.exec(rawContent);
  if (!m?.[1]) return { content: rawContent };
  return {
    content: m[2] ?? "",
    taskChecked: m[1].toLowerCase() === "x",
  };
}

function parseListMarker(line: string): ListMarker | null {
  if (isHorizontalRule(line)) return null;

  const ordered = /^(\s*)(\d{1,9})([.)])(\s+)(.*)$/.exec(line);
  if (ordered?.[2] && ordered[3] && ordered[4] !== undefined) {
    const indent = getIndentCols(ordered[1] ?? "");
    const markerWidth = ordered[2].length + 1;
    const spaceCols = getIndentCols(ordered[4]);
    const contentIndent =
      spaceCols > 4 ? indent + markerWidth + 1 : indent + markerWidth + spaceCols;
    const task = parseTaskPrefix(ordered[5] ?? "");
    return {
      indent,
      kind: "ordered",
      delimiter: ordered[3],
      orderNumber: Number.parseInt(ordered[2], 10),
      contentIndent,
      content: task.content,
      taskChecked: task.taskChecked,
    };
  }

  const unordered = /^(\s*)([-*+])(\s+)(.*)$/.exec(line);
  if (unordered?.[2] && unordered[3] !== undefined) {
    const indent = getIndentCols(unordered[1] ?? "");
    const markerWidth = 1;
    const spaceCols = getIndentCols(unordered[3]);
    const contentIndent =
      spaceCols > 4 ? indent + markerWidth + 1 : indent + markerWidth + spaceCols;
    const task = parseTaskPrefix(unordered[4] ?? "");
    return {
      indent,
      kind: "unordered",
      delimiter: unordered[2],
      contentIndent,
      content: task.content,
      taskChecked: task.taskChecked,
    };
  }

  return null;
}

function isCompatibleListMarker(first: ListMarker, candidate: ListMarker): boolean {
  if (first.indent !== candidate.indent || first.kind !== candidate.kind) {
    return false;
  }
  if (first.kind === "ordered") {
    return first.delimiter === candidate.delimiter;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Recursive block & list renderers
// ---------------------------------------------------------------------------

interface ParsedListItem {
  startIdx: number;
  marker: ListMarker;
  dedentedLines: string[];
}

function renderListBlock(
  lines: string[],
  startIdx: number,
  keyPrefix: string
): { node: React.ReactNode; nextIdx: number } {
  const firstMarker = parseListMarker(lines[startIdx] ?? "");
  if (!firstMarker) {
    return { node: null, nextIdx: startIdx + 1 };
  }

  const isOrdered = firstMarker.kind === "ordered";
  const startNumber = firstMarker.orderNumber ?? 1;
  let isLoose = false;
  const parsedItems: ParsedListItem[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const marker = parseListMarker(line);
    if (!marker || !isCompatibleListMarker(firstMarker, marker)) {
      break;
    }

    const itemStartIdx = i;
    const rawContinuationLines: Array<{ text: string; inFence: boolean }> = [];
    let activeFence = matchCodeFenceOpen(marker.content);
    let j = i + 1;

    while (j < lines.length) {
      const cur = lines[j] ?? "";

      if (activeFence) {
        rawContinuationLines.push({ text: cur, inFence: true });
        if (isCodeFenceClose(cur, activeFence.char, activeFence.len)) {
          activeFence = null;
        }
        j++;
        continue;
      }

      if (!cur.trim()) {
        let k = j;
        while (k < lines.length && !(lines[k] ?? "").trim()) {
          k++;
        }
        if (k < lines.length && getIndentCols(lines[k] ?? "") > marker.indent) {
          for (let b = j; b < k; b++) {
            rawContinuationLines.push({ text: "", inFence: false });
          }
          isLoose = true;
          j = k;
          continue;
        }
        break;
      }

      if (getIndentCols(cur) > marker.indent) {
        const openedFence = matchCodeFenceOpen(cur);
        if (openedFence) {
          activeFence = openedFence;
        }
        rawContinuationLines.push({ text: cur, inFence: false });
        j++;
        continue;
      }

      break;
    }

    let minOuterIndent = Infinity;
    for (const entry of rawContinuationLines) {
      if (!entry.inFence && entry.text.trim()) {
        minOuterIndent = Math.min(minOuterIndent, getIndentCols(entry.text));
      }
    }

    const dedentCols =
      minOuterIndent === Infinity
        ? marker.contentIndent
        : Math.min(marker.contentIndent, minOuterIndent);
    const dedentedLines = rawContinuationLines.map((entry) =>
      stripIndentCols(entry.text, dedentCols)
    );

    parsedItems.push({
      startIdx: itemStartIdx,
      marker,
      dedentedLines,
    });

    i = j;

    // Peek past blank lines to keep loose lists grouped in a single <ol>/<ul>
    if (i < lines.length && !(lines[i] ?? "").trim()) {
      let k = i;
      while (k < lines.length && !(lines[k] ?? "").trim()) {
        k++;
      }
      if (k < lines.length) {
        const nextMarker = parseListMarker(lines[k] ?? "");
        if (nextMarker && isCompatibleListMarker(firstMarker, nextMarker)) {
          isLoose = true;
          i = k;
          continue;
        }
      }
      break;
    }
  }

  const hasTasks = parsedItems.some((item) => item.marker.taskChecked !== undefined);
  const allTasks =
    hasTasks && parsedItems.every((item) => item.marker.taskChecked !== undefined);

  const items = parsedItems.map(({ startIdx: itemIdx, marker, dedentedLines }) => {
    const itemKey = `${keyPrefix}-li-${itemIdx}`;
    const isInlineOnly =
      dedentedLines.length === 0 && matchCodeFenceOpen(marker.content) === null;

    let bodyNode: React.ReactNode;
    if (isInlineOnly) {
      bodyNode = renderInline(marker.content, `${keyPrefix}-${itemIdx}`);
    } else {
      const itemLines = marker.content
        ? [marker.content, ...dedentedLines]
        : dedentedLines;
      bodyNode = renderBlocks(itemLines.join("\n"), `${keyPrefix}-b-${itemIdx}`);
    }

    if (marker.taskChecked !== undefined) {
      return (
        <li
          key={itemKey}
          className={`${allTasks ? "" : "-ml-4 "}flex list-none items-start gap-2`}
        >
          <span
            aria-hidden="true"
            className={`mt-[3px] inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border font-mono text-[9px] ${
              marker.taskChecked
                ? "border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                : "border-[var(--border-strong)] bg-transparent text-transparent"
            }`}
          >
            {marker.taskChecked ? "✓" : ""}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">{bodyNode}</div>
        </li>
      );
    }

    return (
      <li
        key={itemKey}
        className={isInlineOnly ? "pl-0.5" : "pl-0.5 space-y-1.5"}
      >
        {bodyNode}
      </li>
    );
  });

  const ListTag = isOrdered ? "ol" : "ul";
  const spacingClass = isLoose ? "space-y-2" : "space-y-1";
  const markerClass = allTasks
    ? "list-none pl-1"
    : isOrdered
      ? "list-decimal pl-5"
      : "list-disc pl-5";

  return {
    node: (
      <ListTag
        key={`${keyPrefix}-list-${startIdx}`}
        start={isOrdered && startNumber !== 1 ? startNumber : undefined}
        className={`min-w-0 ${markerClass} ${spacingClass}`}
      >
        {items}
      </ListTag>
    ),
    nextIdx: i,
  };
}

function renderBlocks(rawText: string, keyPrefix = "md"): React.ReactNode[] {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Fenced code block (``` or ~~~)
    const fenceOpen = matchCodeFenceOpen(line);
    if (fenceOpen) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        if (isCodeFenceClose(cur, fenceOpen.char, fenceOpen.len)) {
          i++;
          break;
        }
        codeLines.push(stripIndentCols(cur, fenceOpen.indentCols));
        i++;
      }
      blocks.push(
        <CodeBlockCard
          key={`${keyPrefix}-code-${i}`}
          language={fenceOpen.lang}
          code={codeLines.join("\n")}
        />
      );
      continue;
    }

    // 2. Horizontal rule (checked before list markers so --- / * * * never parse as lists)
    if (isHorizontalRule(line)) {
      blocks.push(
        <hr
          key={`${keyPrefix}-hr-${i}`}
          className="my-1 border-0 border-t border-[var(--border-light)]"
        />
      );
      i++;
      continue;
    }

    // 3. Heading
    const heading = matchHeading(line);
    if (heading) {
      const sizeClass =
        heading.level === 1
          ? "text-[16px] font-bold leading-[24px]"
          : heading.level === 2
            ? "text-[15px] font-semibold leading-[22px]"
            : heading.level === 3
              ? "text-[14px] font-semibold leading-[20px]"
              : "text-[13px] font-semibold leading-[19px]";
      blocks.push(
        <div
          key={`${keyPrefix}-h-${i}`}
          className={`mt-1 text-[var(--ink-strong)] ${sizeClass}`}
        >
          {renderInline(heading.content, `${keyPrefix}-h-${i}`)}
        </div>
      );
      i++;
      continue;
    }

    // 4. GFM Table
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableDelimiterLine(lines[i + 1] ?? "")
    ) {
      const headers = splitTableRow(line);
      const alignments = parseTableAlignments(lines[i + 1] ?? "");
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i] ?? "";
        const rowTrim = rowLine.trim();
        if (
          !rowTrim ||
          !rowLine.includes("|") ||
          matchCodeFenceOpen(rowLine) !== null ||
          isHorizontalRule(rowLine) ||
          matchHeading(rowLine) !== null ||
          /^\s{0,3}>/.test(rowLine) ||
          parseListMarker(rowLine) !== null
        ) {
          break;
        }
        const cells = splitTableRow(rowLine);
        const normalized = headers.map((_, colIdx) => cells[colIdx] ?? "");
        rows.push(normalized);
        i++;
      }

      blocks.push(
        <div
          key={`${keyPrefix}-tbl-${i}`}
          className="min-w-0 max-w-full overflow-x-auto rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-surface)]"
        >
          <table className="w-full border-collapse text-left text-[12.5px] leading-[18px]">
            <thead>
              <tr className="bg-[var(--bg-subtle)]">
                {headers.map((h, colIdx) => {
                  const align = alignments[colIdx] ?? "left";
                  return (
                    <th
                      key={colIdx}
                      style={{ textAlign: align }}
                      className="border-b border-[var(--border-light)] px-3 py-2 font-semibold text-[var(--ink-strong)]"
                    >
                      {renderInline(h, `${keyPrefix}-th-${i}-${colIdx}`)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]/40"
                >
                  {row.map((cell, cIdx) => {
                    const align = alignments[cIdx] ?? "left";
                    return (
                      <td
                        key={cIdx}
                        style={{ textAlign: align }}
                        className="px-3 py-2 align-top text-[var(--ink-body)]"
                      >
                        {renderInline(cell, `${keyPrefix}-td-${i}-${rIdx}-${cIdx}`)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 5. Blockquote
    if (/^\s{0,3}>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i] ?? "")) {
        quoteLines.push((lines[i] ?? "").replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={`${keyPrefix}-bq-${i}`}
          className="flex flex-col gap-1.5 border-l-2 border-[var(--border-strong)] pl-3 text-[var(--ink-muted)]"
        >
          {renderBlocks(quoteLines.join("\n"), `${keyPrefix}-bq-${i}`)}
        </blockquote>
      );
      continue;
    }

    // 6. List
    if (parseListMarker(line) !== null) {
      const { node, nextIdx } = renderListBlock(lines, i, `${keyPrefix}-l-${i}`);
      blocks.push(node);
      i = nextIdx;
      continue;
    }

    // 7. Paragraph
    const paraLines: string[] = [];
    while (i < lines.length) {
      const pLine = lines[i] ?? "";
      const pTrim = pLine.trim();
      if (
        !pTrim ||
        matchCodeFenceOpen(pLine) !== null ||
        isHorizontalRule(pLine) ||
        matchHeading(pLine) !== null ||
        /^\s{0,3}>/.test(pLine) ||
        parseListMarker(pLine) !== null ||
        (pLine.includes("|") &&
          i + 1 < lines.length &&
          isTableDelimiterLine(lines[i + 1] ?? ""))
      ) {
        break;
      }
      paraLines.push(pLine);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(
        <p key={`${keyPrefix}-p-${i}`} className="whitespace-pre-wrap break-words">
          {renderInline(paraLines.join("\n"), `${keyPrefix}-p-${i}`)}
        </p>
      );
    } else {
      i++;
    }
  }

  return blocks;
}

export const MarkdownRenderer: React.FC<{
  text: string;
  className?: string;
}> = ({ text, className = "" }) => {
  if (!text || !text.trim()) return null;
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`.trim()}>
      {renderBlocks(text)}
    </div>
  );
};
