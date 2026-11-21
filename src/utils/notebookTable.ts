import type { NotebookBlock } from "../types/valet";

export type TableAlignment = "left" | "center" | "right";

export interface ParsedMarkdownTable {
  headers: string[];
  alignments: TableAlignment[];
  rows: string[][];
}

export function splitMarkdownTableRow(rawLine: string): string[] {
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
      i += 1;
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

export function isMarkdownTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || !trimmed.includes("-")) return false;
  return (
    /^\|?(?:\s*:?-{1,}:?\s*\|)+\s*(?::?-{1,}:?\s*\|?)?$/.test(trimmed) ||
    /^\|(?:\s*:?-{1,}:?\s*\|)+$/.test(trimmed)
  );
}

export function isMarkdownTableRowCandidate(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("|")) return false;
  if (/^\s{0,3}(?:```|~~~)/.test(line)) return false;
  if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) return false;
  if (/^\s{0,3}#{1,6}\s/.test(line)) return false;
  if (/^\s{0,3}>/.test(line)) return false;
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) return false;
  if (/^\s*(?:[-*+]\s)?\[[xX\s]?\]\s/.test(line)) return false;
  return true;
}

function parseTableAlignments(delimiterLine: string): TableAlignment[] {
  return splitMarkdownTableRow(delimiterLine).map((cell) => {
    const c = cell.trim();
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

export function parseMarkdownTable(rawContent: string): ParsedMarkdownTable | null {
  const rawLines = rawContent.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  let end = rawLines.length;
  while (start < end && !rawLines[start]!.trim()) start += 1;
  while (end > start && !rawLines[end - 1]!.trim()) end -= 1;

  const lines = rawLines.slice(start, end);
  if (lines.length < 2) return null;

  const headerLine = lines[0]!;
  const delimLine = lines[1]!;
  if (!headerLine.includes("|") || !isMarkdownTableDelimiterLine(delimLine)) {
    return null;
  }

  const rawHeaders = splitMarkdownTableRow(headerLine);
  const rawAlignments = parseTableAlignments(delimLine);
  const colCount = Math.max(rawHeaders.length, rawAlignments.length, 1);

  const headers = Array.from({ length: colCount }, (_, idx) => rawHeaders[idx] ?? "");
  const alignments = Array.from<unknown, TableAlignment>(
    { length: colCount },
    (_, idx) => rawAlignments[idx] ?? "left"
  );

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const bodyLine = lines[i]!;
    if (!bodyLine.trim()) continue;
    if (!bodyLine.includes("|")) {
      return null;
    }
    const cells = splitMarkdownTableRow(bodyLine);
    rows.push(Array.from({ length: colCount }, (_, idx) => cells[idx] ?? ""));
  }

  return { headers, alignments, rows };
}

function formatTableRow(cells: string[]): string {
  return `| ${cells.map((c) => c.replace(/\r?\n/g, "<br>").trim()).join(" | ")} |`;
}

export function serializeMarkdownTable(table: ParsedMarkdownTable): string {
  const colCount = Math.max(table.headers.length, table.alignments.length, 1);
  const headers = Array.from({ length: colCount }, (_, idx) => table.headers[idx] ?? "");
  const delim = Array.from({ length: colCount }, (_, idx) => {
    const align = table.alignments[idx] ?? "left";
    if (align === "center") return ":---:";
    if (align === "right") return "---:";
    return "---";
  });
  const lines = [
    formatTableRow(headers),
    `| ${delim.join(" | ")} |`,
    ...table.rows.map((row) =>
      formatTableRow(Array.from({ length: colCount }, (_, idx) => row[idx] ?? ""))
    ),
  ];
  return lines.join("\n");
}

export function createDefaultMarkdownTable(cols = 3, rows = 2): string {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const headers = Array.from({ length: safeCols }, (_, idx) => `列 ${idx + 1}`);
  const alignments: TableAlignment[] = Array.from({ length: safeCols }, () => "left");
  const body = Array.from({ length: safeRows }, () =>
    Array.from({ length: safeCols }, () => "")
  );
  return serializeMarkdownTable({ headers, alignments, rows: body });
}

export function appendTableRow(rawContent: string): string {
  const parsed = parseMarkdownTable(rawContent);
  if (!parsed) return rawContent;
  return serializeMarkdownTable({
    ...parsed,
    rows: [...parsed.rows, parsed.headers.map(() => "")],
  });
}

export function appendTableColumn(rawContent: string): string {
  const parsed = parseMarkdownTable(rawContent);
  if (!parsed) return rawContent;
  const colNum = parsed.headers.length + 1;
  return serializeMarkdownTable({
    headers: [...parsed.headers, `列 ${colNum}`],
    alignments: [...parsed.alignments, "left"],
    rows: parsed.rows.map((row) => [...row, ""]),
  });
}

export function updateTableCell(
  rawContent: string,
  rowIndex: number,
  colIndex: number,
  nextValue: string
): string {
  const parsed = parseMarkdownTable(rawContent);
  if (!parsed || colIndex < 0 || colIndex >= parsed.headers.length) return rawContent;
  const cleanVal = nextValue.replace(/\r?\n/g, "<br>").trim();
  if (rowIndex === -1) {
    const headers = [...parsed.headers];
    headers[colIndex] = cleanVal;
    return serializeMarkdownTable({ ...parsed, headers });
  }
  if (rowIndex < 0 || rowIndex >= parsed.rows.length) return rawContent;
  const rows = parsed.rows.map((row, rIdx) => {
    if (rIdx !== rowIndex) return row;
    const nextRow = [...row];
    nextRow[colIndex] = cleanVal;
    return nextRow;
  });
  return serializeMarkdownTable({ ...parsed, rows });
}

export function removeTableRow(rawContent: string, rowIndex: number): string {
  const parsed = parseMarkdownTable(rawContent);
  if (!parsed || rowIndex < 0 || rowIndex >= parsed.rows.length) return rawContent;
  return serializeMarkdownTable({
    ...parsed,
    rows: parsed.rows.filter((_, idx) => idx !== rowIndex),
  });
}

export function removeTableColumn(rawContent: string, colIndex: number): string {
  const parsed = parseMarkdownTable(rawContent);
  if (
    !parsed ||
    parsed.headers.length <= 1 ||
    colIndex < 0 ||
    colIndex >= parsed.headers.length
  ) {
    return rawContent;
  }
  return serializeMarkdownTable({
    headers: parsed.headers.filter((_, idx) => idx !== colIndex),
    alignments: parsed.alignments.filter((_, idx) => idx !== colIndex),
    rows: parsed.rows.map((row) => row.filter((_, idx) => idx !== colIndex)),
  });
}

/**
 * Upgrades multiline table paragraphs and coalesces legacy split-paragraph
 * pipe lines into single structured `table` blocks.
 */
export function coalesceTableParagraphBlocks(blocks: NotebookBlock[]): NotebookBlock[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;

  const out: NotebookBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i]!;
    if (cur.type !== "paragraph") {
      out.push(cur);
      continue;
    }

    // 1. Single multiline paragraph containing a valid GFM table
    if (cur.content.includes("\n") && parseMarkdownTable(cur.content) !== null) {
      const nextBlk: NotebookBlock = { ...cur, type: "table" };
      delete nextBlk.indent;
      out.push(nextBlk);
      continue;
    }

    // 2. Legacy consecutive split paragraph blocks forming a GFM table
    if (!isMarkdownTableRowCandidate(cur.content)) {
      out.push(cur);
      continue;
    }

    let delimIdx = -1;
    const next1 = blocks[i + 1];
    const next2 = blocks[i + 2];
    if (next1 && next1.type === "paragraph" && isMarkdownTableDelimiterLine(next1.content)) {
      delimIdx = i + 1;
    } else if (
      next1 &&
      next1.type === "paragraph" &&
      !next1.content.trim() &&
      next2 &&
      next2.type === "paragraph" &&
      isMarkdownTableDelimiterLine(next2.content)
    ) {
      delimIdx = i + 2;
    }

    if (delimIdx === -1) {
      out.push(cur);
      continue;
    }

    const requireLeadingPipe =
      cur.content.trim().startsWith("|") ||
      blocks[delimIdx]!.content.trim().startsWith("|");
    const tableLines: string[] = [cur.content.trim(), blocks[delimIdx]!.content.trim()];
    let cursor = delimIdx + 1;

    if (
      cursor + 1 < blocks.length &&
      blocks[cursor]!.type === "paragraph" &&
      !blocks[cursor]!.content.trim() &&
      blocks[cursor + 1]!.type === "paragraph" &&
      isMarkdownTableRowCandidate(blocks[cursor + 1]!.content) &&
      (!requireLeadingPipe || blocks[cursor + 1]!.content.trim().startsWith("|"))
    ) {
      cursor += 1;
    }

    while (cursor < blocks.length) {
      const rowBlk = blocks[cursor]!;
      if (rowBlk.type !== "paragraph" || !isMarkdownTableRowCandidate(rowBlk.content)) {
        break;
      }
      const trimmedRow = rowBlk.content.trim();
      if (requireLeadingPipe && !trimmedRow.startsWith("|")) {
        break;
      }
      tableLines.push(trimmedRow);
      cursor += 1;
    }

    const joined = tableLines.join("\n");
    if (parseMarkdownTable(joined) === null) {
      out.push(cur);
      continue;
    }

    const coalesced: NotebookBlock = {
      ...cur,
      type: "table",
      content: joined,
    };
    delete coalesced.indent;
    out.push(coalesced);
    i = cursor - 1;
  }

  return out;
}
