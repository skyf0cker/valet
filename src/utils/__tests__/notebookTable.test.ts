import { describe, expect, it } from "bun:test";
import {
  type NotebookBlock,
  type Project,
  type ValetSnapshot,
} from "../../types/valet";
import {
  blocksToMarkdown,
  normalizeProjectsState,
  pageToMarkdown,
  parseInlineNotebookText,
} from "../notebook";
import {
  appendTableColumn,
  appendTableRow,
  coalesceTableParagraphBlocks,
  createDefaultMarkdownTable,
  isMarkdownTableDelimiterLine,
  isMarkdownTableRowCandidate,
  parseMarkdownTable,
  removeTableColumn,
  removeTableRow,
  serializeMarkdownTable,
  splitMarkdownTableRow,
  updateTableCell,
} from "../notebookTable";

describe("notebookTable utilities", () => {
  it("parses GFM tables with alignments, escaped pipes, backtick pipes, and ragged rows", () => {
    expect(isMarkdownTableDelimiterLine("|---|---|---|")).toBe(true);
    expect(isMarkdownTableDelimiterLine("| :--- | :---: | ---: |")).toBe(true);
    expect(isMarkdownTableDelimiterLine("| not | a | delimiter |")).toBe(false);

    expect(isMarkdownTableRowCandidate("| a | b |")).toBe(true);
    expect(isMarkdownTableRowCandidate("> quoted | pipe")).toBe(false);
    expect(isMarkdownTableRowCandidate("- list | item")).toBe(false);
    expect(isMarkdownTableRowCandidate("# Heading | Title")).toBe(false);

    const row = splitMarkdownTableRow("| `a | b` | escaped \\| pipe | plain |");
    expect(row).toEqual(["`a | b`", "escaped | pipe", "plain"]);

    const parsed = parseMarkdownTable(
      [
        "| 维度 | 对齐居中 | 数值右对齐 |",
        "| :--- | :---: | ---: |",
        "| `foo | bar` | a \\| b | 42 |",
        "| 缺失末尾列 | only two |",
      ].join("\n")
    );
    expect(parsed).not.toBe(null);
    expect(parsed!.headers).toEqual(["维度", "对齐居中", "数值右对齐"]);
    expect(parsed!.alignments).toEqual(["left", "center", "right"]);
    expect(parsed!.rows).toEqual([
      ["`foo | bar`", "a | b", "42"],
      ["缺失末尾列", "only two", ""],
    ]);

    expect(parseMarkdownTable("| only header |")).toBe(null);
    expect(parseMarkdownTable("| h1 | h2 |\n| not | delim |\n| a | b |")).toBe(null);
    expect(parseMarkdownTable("| h1 | h2 |\n| --- | --- |\nplain line without pipe")).toBe(
      null
    );
  });

  it("serializes tables and supports row/column/cell mutations cleanly", () => {
    const starter = createDefaultMarkdownTable(2, 1);
    expect(starter).toBe("| 列 1 | 列 2 |\n| --- | --- |\n|  |  |");

    const serialized = serializeMarkdownTable({
      headers: ["特性", "说明"],
      alignments: ["center", "right"],
      rows: [["支持\n换行", "OK"]],
    });
    expect(serialized).toBe(
      "| 特性 | 说明 |\n| :---: | ---: |\n| 支持<br>换行 | OK |"
    );

    const withRow = appendTableRow(starter);
    expect(parseMarkdownTable(withRow)!.rows.length).toBe(2);

    const withCol = appendTableColumn(withRow);
    const parsedCol = parseMarkdownTable(withCol)!;
    expect(parsedCol.headers).toEqual(["列 1", "列 2", "列 3"]);
    expect(parsedCol.rows[0]!.length).toBe(3);

    const updatedHeader = updateTableCell(withCol, -1, 1, "核心指标");
    const updatedCell = updateTableCell(updatedHeader, 0, 2, "已通过");
    const parsedUpdated = parseMarkdownTable(updatedCell)!;
    expect(parsedUpdated.headers[1]).toBe("核心指标");
    expect(parsedUpdated.rows[0]![2]).toBe("已通过");

    const droppedRow = removeTableRow(updatedCell, 1);
    expect(parseMarkdownTable(droppedRow)!.rows.length).toBe(1);

    const droppedCol = removeTableColumn(droppedRow, 1);
    expect(parseMarkdownTable(droppedCol)!.headers).toEqual(["列 1", "列 3"]);

    // Do not drop the final remaining column
    const oneCol = removeTableColumn(droppedCol, 0);
    expect(parseMarkdownTable(oneCol)!.headers).toEqual(["列 3"]);
    expect(removeTableColumn(oneCol, 0)).toBe(oneCol);
  });

  it("coalesces legacy split-paragraph tables and multiline paragraph tables while leaving prose alone", () => {
    const screenshotSplitBlocks: NotebookBlock[] = [
      { id: "p0", type: "paragraph", content: "DeepSeek 的 Super Agent 架构调研：" },
      { id: "t-hdr", type: "paragraph", content: "| 维度 | Always-On Agent (AOA) | Super Agent |" },
      { id: "t-blank1", type: "paragraph", content: "" },
      { id: "t-sep", type: "paragraph", content: "|---|---|---|" },
      { id: "t-blank2", type: "paragraph", content: "" },
      {
        id: "t-r1",
        type: "paragraph",
        content: "| **核心动作** | 把执行搬到「人不在场时」 | 把多入口收敛成「单一会话」 |",
      },
      { id: "t-r2", type: "paragraph", content: "| **优化方向** | **时间上错峰** | **空间上收敛** |" },
      { id: "t-r3", type: "paragraph", content: "| **省下什么** | 人的「在场等待时间」 | 人的「上下文切换成本」 |" },
      { id: "p-end", type: "paragraph", content: "两条路都在做同一件事 | 互不冲突。" },
    ];

    const coalesced = coalesceTableParagraphBlocks(screenshotSplitBlocks);
    expect(coalesced.map((b) => [b.id, b.type])).toEqual([
      ["p0", "paragraph"],
      ["t-hdr", "table"],
      ["p-end", "paragraph"],
    ]);
    const parsedTbl = parseMarkdownTable(coalesced[1]!.content)!;
    expect(parsedTbl.headers).toEqual(["维度", "Always-On Agent (AOA)", "Super Agent"]);
    expect(parsedTbl.rows.length).toBe(3);

    // Single multiline paragraph containing a GFM table also upgrades to table
    const multilineUpgrade = coalesceTableParagraphBlocks([
      {
        id: "m1",
        type: "paragraph",
        indent: 2,
        content: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      },
    ]);
    expect(multilineUpgrade[0]!.type).toBe("table");
    expect(multilineUpgrade[0]!.indent).toBe(undefined);
  });

  it("heals tables in normalizeProjectsState, exports markdown cleanly, and parses __bold__ and * inside **bold**", () => {
    const proj: Project = {
      id: "proj-tbl",
      title: "调研",
      icon: "book",
      tags: [],
      blocks: [
        { id: "b1", type: "paragraph", content: "| 项 | 链接 |" },
        { id: "b2", type: "paragraph", content: "| --- | --- |" },
        { id: "b3", type: "paragraph", content: "| 详情 | [[page:pg-1]] |" },
      ],
      pages: [
        {
          id: "pg-1",
          title: "子详情页",
          blocks: [
            { id: "pb1", type: "table", content: "| 列 | 值 |\n| --- | --- |\n| X | 1 |" },
          ],
          updatedAt: "刚刚",
          createdAt: "2026-11-21",
        },
      ],
      updatedAt: "刚刚",
      createdAt: "2026-11-21",
    };

    const snap = {
      activeView: "projects",
      sidebarCollapsed: false,
      activeProjectId: "proj-tbl",
      activeProjectTab: "notebook",
      projects: [proj],
      chatThreads: [],
      inboxItems: [],
      timelineEvents: [],
      plugins: [],
      isPaused: false,
    } as unknown as ValetSnapshot;

    const norm = normalizeProjectsState(snap);
    const normProj = norm.projects.find((p) => p.id === "proj-tbl")!;
    expect(normProj.blocks.length).toBe(1);
    expect(normProj.blocks[0]!.type).toBe("table");

    const md = blocksToMarkdown(normProj, [], norm.projects);
    expect(md).toContain("| 项 | 链接 |");
    expect(md).toContain("| 详情 | [页面: 子详情页] |");

    const pageMd = pageToMarkdown(normProj, normProj.pages![0]!, [], norm.projects);
    expect(pageMd).toContain("| 列 | 值 |");
    expect(pageMd).toContain("| X | 1 |");

    // Inline bold improvements: __bold__, single * inside **bold**, without breaking snake_case
    expect(parseInlineNotebookText("__加粗__ 和 my_snake_case 变量")).toEqual([
      { kind: "bold", text: "加粗" },
      { kind: "text", text: " 和 my_snake_case 变量" },
    ]);
    expect(parseInlineNotebookText("**Only * one** 正常")).toEqual([
      { kind: "bold", text: "Only * one" },
      { kind: "text", text: " 正常" },
    ]);
  });
});
