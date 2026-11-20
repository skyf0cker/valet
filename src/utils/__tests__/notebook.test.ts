import { describe, expect, it } from "bun:test";
import type { Project } from "../../types/valet";
import {
  blocksToMarkdown,
  buildNotebookContextAttachment,
  deriveFallbackSessionTitle,
  extractInlineRefs,
  joinTextWithInlineRefs,
  removeInlineRefAt,
  splitInlineRefs,
} from "../notebook";

describe("notebook inline reference helpers", () => {
  it("extracts inline session, inbox, and timeline tokens in appearance order", () => {
    expect(extractInlineRefs("")).toEqual([]);
    expect(extractInlineRefs("纯文本内容")).toEqual([]);

    const content =
      "调研郑州 [[session:chat-1]] 参考 [[inbox:inb-2]] 以及 [[timeline:evt-3]]";
    expect(extractInlineRefs(content)).toEqual([
      {
        kind: "session",
        id: "chat-1",
        raw: "[[session:chat-1]]",
        start: 5,
        end: 23,
      },
      {
        kind: "inbox",
        id: "inb-2",
        raw: "[[inbox:inb-2]]",
        start: 27,
        end: 42,
      },
      {
        kind: "timeline",
        id: "evt-3",
        raw: "[[timeline:evt-3]]",
        start: 46,
        end: 64,
      },
    ]);
  });

  it("round-trips splitInlineRefs and joinTextWithInlineRefs across spaces and multiple refs", () => {
    const samples = ["", " ", "调研郑州", "调研郑州 ", "调研郑州  ", "a b "];
    const oneRef = [{ raw: "[[session:chat-1]]" }];
    const twoRefs = [
      { raw: "[[session:chat-1]]" },
      { raw: "[[inbox:inb-2]]" },
    ];

    for (const editableText of samples) {
      const joinedOne = joinTextWithInlineRefs(editableText, oneRef);
      const splitOne = splitInlineRefs(joinedOne);
      expect(splitOne.editableText).toBe(editableText);
      expect(splitOne.refs.map((r) => r.raw)).toEqual(["[[session:chat-1]]"]);

      const joinedTwo = joinTextWithInlineRefs(editableText, twoRefs);
      const splitTwo = splitInlineRefs(joinedTwo);
      expect(splitTwo.editableText).toBe(editableText);
      expect(splitTwo.refs.map((r) => r.raw)).toEqual([
        "[[session:chat-1]]",
        "[[inbox:inb-2]]",
      ]);
    }
  });

  it("splits legacy, leading, middle, and ref-only content cleanly", () => {
    expect(splitInlineRefs("调研郑州[[session:a]]").editableText).toBe("调研郑州");
    expect(splitInlineRefs("[[session:a]] 后续").editableText).toBe("后续");
    expect(splitInlineRefs("先看 [[session:a]] 再看").editableText).toBe("先看 再看");
    expect(splitInlineRefs("先看 [[session:a]] [[inbox:b]] 再看").editableText).toBe(
      "先看 再看"
    );
    expect(splitInlineRefs("[[session:a]]").editableText).toBe("");
    expect(splitInlineRefs("[[session:a]] [[inbox:b]]").editableText).toBe("");
  });

  it("removes individual inline refs atomically without dangling or doubled spaces", () => {
    const multi = "调研郑州 [[session:a]] [[inbox:b]] [[timeline:c]]";
    expect(removeInlineRefAt(multi, 0)).toBe("调研郑州 [[inbox:b]] [[timeline:c]]");
    expect(removeInlineRefAt(multi, 1)).toBe("调研郑州 [[session:a]] [[timeline:c]]");
    expect(removeInlineRefAt(multi, 2)).toBe("调研郑州 [[session:a]] [[inbox:b]]");

    expect(removeInlineRefAt("调研郑州 [[session:a]]", 0)).toBe("调研郑州");
    expect(removeInlineRefAt("[[session:a]] 后续", 0)).toBe("后续");
    expect(removeInlineRefAt("先看 [[session:a]] 再看", 0)).toBe("先看 再看");
    expect(removeInlineRefAt("[[session:a]]", 0)).toBe("");

    // Out-of-range indices leave content untouched
    expect(removeInlineRefAt(multi, -1)).toBe(multi);
    expect(removeInlineRefAt(multi, 3)).toBe(multi);
  });
});

function makeTestProject(blocks: Project["blocks"], title = "默认项目"): Project {
  return {
    id: "proj-default",
    title,
    tags: [],
    updatedAt: "刚刚",
    createdAt: "2026-11-21",
    blocks,
  };
}

describe("buildNotebookContextAttachment", () => {
  it("pins exact origin line number and text for inline @valet on a specific todo line", () => {
    const project = makeTestProject([
      { id: "blk-1", type: "h1", content: "元旦旅行安排" },
      {
        id: "blk-2",
        type: "todo",
        checked: false,
        content: "调研郑州是否适合情侣元旦旅行，有哪些美食景点",
      },
      {
        id: "blk-3",
        type: "todo",
        checked: false,
        content: "预订高铁票和酒店",
      },
    ]);

    const att = buildNotebookContextAttachment(project, [], {
      originBlockId: "blk-2",
      originSection: "元旦旅行安排",
      originBeforeText: "调研郑州是否适合情侣元旦旅行，有哪些美食景点 ",
      originAfterText: "",
    });

    expect(att.name).toBe("默认项目 / 元旦旅行安排");
    expect(att.meta).toBe("第 2 行 · 调研郑州是否适合情侣元旦旅行，有哪些美食景点");
    expect(att.textExcerpt).toContain("[发起定位]");
    expect(att.textExcerpt).toContain("- 所属项目：默认项目");
    expect(att.textExcerpt).toContain("- 所属章节：元旦旅行安排");
    expect(att.textExcerpt).toContain("- 引用位置：第 2 行（未完成待办）");
    expect(att.textExcerpt).toContain(
      "- 当前引用行内容：- [ ] 调研郑州是否适合情侣元旦旅行，有哪些美食景点"
    );
    expect(att.textExcerpt).toContain(
      "L2: - [ ] 调研郑州是否适合情侣元旦旅行，有哪些美食景点  <<< [@valet 当前引用行]"
    );
    expect(att.textExcerpt).toContain("L1: # 元旦旅行安排");
    expect(att.textExcerpt).toContain("L3: - [ ] 预订高铁票和酒店");
    expect(att.textExcerpt).not.toContain("L1: # 元旦旅行安排  <<<");
    expect(att.textExcerpt).not.toContain("L3: - [ ] 预订高铁票和酒店  <<<");
  });

  it("includes inline [@valet] cursor marker when invoked mid-line", () => {
    const project = makeTestProject([
      { id: "blk-1", type: "h1", content: "元旦旅行安排" },
      { id: "blk-2", type: "paragraph", content: "先看交通再看美食" },
    ]);

    const att = buildNotebookContextAttachment(project, [], {
      originBlockId: "blk-2",
      originSection: "元旦旅行安排",
      originBeforeText: "先看交通 ",
      originAfterText: "再看美食",
    });

    expect(att.textExcerpt).toContain("- 当前引用行内容：先看交通 [@valet] 再看美食");
    expect(att.textExcerpt).toContain(
      "L2: 先看交通 [@valet] 再看美食  <<< [@valet 当前引用行]"
    );
  });

  it("locates blank-line @valet invocations relative to the nearest preceding block", () => {
    const project = makeTestProject([
      { id: "blk-1", type: "h1", content: "元旦旅行安排" },
      {
        id: "blk-2",
        type: "todo",
        checked: false,
        content: "调研郑州是否适合情侣元旦旅行，有哪些美食景点",
      },
      { id: "blk-3", type: "paragraph", content: "" },
    ]);

    const att = buildNotebookContextAttachment(project, [], {
      originBlockId: "blk-3",
      originSection: "元旦旅行安排",
      originBeforeText: "",
      originAfterText: "",
    });

    expect(att.meta).toContain("第 3 行（空白行，位于「");
    expect(att.textExcerpt).toContain("- 引用位置：第 3 行（空白行，紧接在第 2 行下方）");
    expect(att.textExcerpt).toContain(
      "- 上方紧邻内容（第 2 行）：- [ ] 调研郑州是否适合情侣元旦旅行，有哪些美食景点"
    );
    expect(att.textExcerpt).toContain("L3: （空白行）  <<< [@valet 当前发起位置]");
  });

  it("keeps [发起定位] and the cited line intact when truncating long Notebooks", () => {
    const filler = "长段背景描述用于填充字数以确保触发一万字符上下文窗口截断逻辑。".repeat(8);
    const blocks: Project["blocks"] = Array.from({ length: 60 }, (_, idx) => ({
      id: `blk-${idx + 1}`,
      type: idx === 0 ? "h1" : "paragraph",
      content: idx === 0 ? "长期项目记录" : `记录条目 ${idx + 1}：${filler}`,
    }));
    const targetIdx = 54;
    blocks[targetIdx] = {
      id: "blk-55",
      type: "todo",
      checked: false,
      content: "核查郑州博物馆元旦预约放票时间",
    };

    const project = makeTestProject(blocks, "旅行攻略");
    const att = buildNotebookContextAttachment(project, [], {
      originBlockId: "blk-55",
      originSection: "长期项目记录",
      originBeforeText: "核查郑州博物馆元旦预约放票时间 ",
      originAfterText: "",
    });

    expect(typeof att.textExcerpt).toBe("string");
    expect((att.textExcerpt?.length ?? 0) <= 10_000).toBe(true);
    expect(att.textExcerpt).toContain("[发起定位]");
    expect(att.textExcerpt).toContain("- 引用位置：第 55 行（未完成待办）");
    expect(att.textExcerpt).toContain(
      "L55: - [ ] 核查郑州博物馆元旦预约放票时间  <<< [@valet 当前引用行]"
    );
    expect(att.textExcerpt).toContain("…（前文已省略）");
  });

  it("keeps blocksToMarkdown clean without line numbers or @valet annotations", () => {
    const project = makeTestProject([
      { id: "blk-1", type: "h1", content: "元旦旅行安排" },
      { id: "blk-2", type: "todo", checked: false, content: "调研郑州美食景点" },
    ]);

    const md = blocksToMarkdown(project, []);
    expect(md).toBe("# 默认项目\n\n# 元旦旅行安排\n\n- [ ] 调研郑州美食景点\n");
    expect(md).not.toContain("L1:");
    expect(md).not.toContain("<<< [@valet");
  });
});

describe("deriveFallbackSessionTitle", () => {
  it("resolves deictic prompts to the cited Notebook line instead of copying vague text", () => {
    const project = makeTestProject([
      { id: "blk-1", type: "h1", content: "元旦旅行安排" },
      {
        id: "blk-2",
        type: "todo",
        checked: false,
        content: "调研郑州是否适合情侣元旦旅行，有哪些美食景点",
      },
    ]);
    const att = buildNotebookContextAttachment(project, [], {
      originBlockId: "blk-2",
      originSection: "元旦旅行安排",
    });

    expect(deriveFallbackSessionTitle("你去调研下这个", [att])).toBe(
      "调研郑州是否适合情侣元旦旅行，有哪些"
    );
  });

  it("extracts the neighboring line title when invoked from a blank line", () => {
    const project = makeTestProject([
      { id: "blk-1", type: "h1", content: "系统清理" },
      { id: "blk-2", type: "todo", checked: false, content: "扫描冗余缓存" },
      { id: "blk-3", type: "paragraph", content: "" },
    ]);
    const att = buildNotebookContextAttachment(project, [], {
      originBlockId: "blk-3",
      originSection: "系统清理",
    });

    expect(deriveFallbackSessionTitle("帮我分析一下", [att])).toBe("扫描冗余缓存");
  });

  it("strips filler prefixes and punctuation on normal prompts and handles empty input", () => {
    expect(deriveFallbackSessionTitle("帮我检查本机端口占用情况？")).toBe(
      "检查本机端口占用情况"
    );
    expect(deriveFallbackSessionTitle("   ")).toBe("新对话");
  });
});
