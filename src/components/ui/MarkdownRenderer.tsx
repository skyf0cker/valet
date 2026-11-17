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
    <div className="overflow-hidden rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-code)]">
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

function renderInline(text: string, keyPrefix = "in"): React.ReactNode[] {
  const tokenRe =
    /(`[^`\n]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^\s)]+\)|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*)/g;
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded-[4px] bg-[var(--bg-muted)] px-1 py-0.5 font-mono text-[12px] font-semibold text-[var(--ink-strong)]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)$/.exec(token);
      if (linkMatch?.[1] && linkMatch?.[2]) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--ink-strong)] underline decoration-[var(--border-strong)] underline-offset-2 hover:opacity-80"
          >
            {renderInline(linkMatch[1], `${key}-a`)}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("***") && token.endsWith("***") && token.length > 6) {
      nodes.push(
        <strong key={key} className="font-semibold italic text-[var(--ink-strong)]">
          {renderInline(token.slice(3, -3), `${key}-bi`)}
        </strong>
      );
    } else if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      nodes.push(
        <strong key={key} className="font-semibold text-[var(--ink-strong)]">
          {renderInline(token.slice(2, -2), `${key}-b`)}
        </strong>
      );
    } else if (token.startsWith("~~") && token.endsWith("~~") && token.length > 4) {
      nodes.push(
        <del key={key} className="text-[var(--ink-muted)] line-through">
          {renderInline(token.slice(2, -2), `${key}-s`)}
        </del>
      );
    } else if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      nodes.push(
        <em key={key} className="italic">
          {renderInline(token.slice(1, -1), `${key}-i`)}
        </em>
      );
    } else {
      nodes.push(token);
    }

    lastIdx = tokenRe.lastIndex;
  }

  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }
  return nodes;
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
  if (!trimmed.includes("-")) return false;
  return /^\|?(?:\s*:?-{2,}:?\s*\|)+\s*(?::?-{2,}:?\s*\|?)?$/.test(trimmed) ||
    /^\|(?:\s*:?-{2,}:?\s*\|)+$/.test(trimmed);
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

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+/.test(line);
}

function getIndent(line: string): number {
  const m = /^(\s*)/.exec(line);
  return m?.[1]?.length ?? 0;
}

function renderListBlock(
  lines: string[],
  startIdx: number,
  keyPrefix: string
): { node: React.ReactNode; nextIdx: number } {
  const firstLine = lines[startIdx] ?? "";
  const baseIndent = getIndent(firstLine);
  const isOrdered = /^\s*\d+\.\s+/.test(firstLine);

  const items: React.ReactNode[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      break;
    }
    const indent = getIndent(line);
    if (indent < baseIndent) break;

    if (indent > baseIndent && isListLine(line)) {
      const sub = renderListBlock(lines, i, `${keyPrefix}-sub-${i}`);
      if (items.length > 0) {
        const lastIdx = items.length - 1;
        items[lastIdx] = (
          <li key={`${keyPrefix}-wrap-${i}`} className="flex flex-col gap-1">
            {items[lastIdx]}
            {sub.node}
          </li>
        );
      } else {
        items.push(<li key={`${keyPrefix}-orphan-${i}`}>{sub.node}</li>);
      }
      i = sub.nextIdx;
      continue;
    }

    const sameOrdered = /^\s*\d+\.\s+/.test(line);
    const sameUnordered = /^\s*[-*+]\s+/.test(line);
    if (indent === baseIndent && ((isOrdered && !sameOrdered) || (!isOrdered && !sameUnordered))) {
      break;
    }

    const taskMatch = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (taskMatch) {
      const checked = taskMatch[1]!.toLowerCase() === "x";
      const content = taskMatch[2] ?? "";
      items.push(
        <li key={`${keyPrefix}-li-${i}`} className="flex items-start gap-2">
          <span
            className={`mt-[3px] inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border font-mono text-[9px] ${
              checked
                ? "border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                : "border-[var(--border-strong)] bg-transparent text-transparent"
            }`}
          >
            {checked ? "✓" : ""}
          </span>
          <span className="min-w-0 flex-1">{renderInline(content, `${keyPrefix}-${i}`)}</span>
        </li>
      );
      i++;
      continue;
    }

    const orderedMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    const unorderedMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    const content = orderedMatch?.[1] ?? unorderedMatch?.[1] ?? line.trim();
    items.push(
      <li key={`${keyPrefix}-li-${i}`}>{renderInline(content, `${keyPrefix}-${i}`)}</li>
    );
    i++;
  }

  const ListTag = isOrdered ? "ol" : "ul";
  const hasTasks = items.some(
    (item) => React.isValidElement(item) && (item.props as { className?: string })?.className?.includes("items-start")
  );

  return {
    node: (
      <ListTag
        key={`${keyPrefix}-list-${startIdx}`}
        className={`flex flex-col gap-1 ${
          hasTasks
            ? "list-none pl-1"
            : isOrdered
              ? "list-decimal pl-5"
              : "list-disc pl-5"
        }`}
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
    const fenceMatch = /^\s*(```+|~~~+)(.*)$/.exec(line);
    if (fenceMatch?.[1]) {
      const fence = fenceMatch[1];
      const lang = (fenceMatch[2] ?? "").trim();
      const fenceChar = fence[0]!;
      const fenceLen = fence.length;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        const closeRe = new RegExp(`^\\s*\\${fenceChar}{${fenceLen},}\\s*$`);
        if (closeRe.test(cur)) {
          i++;
          break;
        }
        codeLines.push(cur);
        i++;
      }
      blocks.push(
        <CodeBlockCard
          key={`${keyPrefix}-code-${i}`}
          language={lang}
          code={codeLines.join("\n")}
        />
      );
      continue;
    }

    // 2. Horizontal rule
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
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
    const headingMatch = /^\s*(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (headingMatch?.[1] && headingMatch?.[2]) {
      const level = headingMatch[1].length;
      const sizeClass =
        level === 1
          ? "text-[16px] font-bold leading-[24px]"
          : level === 2
            ? "text-[15px] font-semibold leading-[22px]"
            : level === 3
              ? "text-[14px] font-semibold leading-[20px]"
              : "text-[13px] font-semibold leading-[19px]";
      blocks.push(
        <div
          key={`${keyPrefix}-h-${i}`}
          className={`mt-1 text-[var(--ink-strong)] ${sizeClass}`}
        >
          {renderInline(headingMatch[2], `${keyPrefix}-h-${i}`)}
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
          /^\s*(```+|~~~+)/.test(rowLine) ||
          /^\s*#{1,6}\s+/.test(rowLine) ||
          /^\s*>/.test(rowLine)
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
          className="overflow-x-auto rounded-[8px] border border-[var(--border-light)] bg-[var(--bg-surface)]"
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
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        quoteLines.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
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
    if (isListLine(line)) {
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
        /^\s*(```+|~~~+)/.test(pLine) ||
        /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(pLine) ||
        /^\s*(#{1,6})\s+/.test(pLine) ||
        /^\s*>/.test(pLine) ||
        isListLine(pLine) ||
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
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      {renderBlocks(text)}
    </div>
  );
};
