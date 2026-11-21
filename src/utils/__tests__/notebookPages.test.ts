import { describe, expect, it } from "bun:test";
import type { ChatThread, Project } from "../../types/valet";
import {
  buildNotebookContextAttachment,
  pageToMarkdown,
  parseInlineNotebookText,
} from "../notebook";
import {
  buildPageTree,
  collectReferencedPageIds,
  findPageBacklinks,
  getDirectChildPages,
  getPageBreadcrumbs,
  isDescendantPage,
  makeRootPageRefId,
  normalizeProjectPages,
  parseRootPageRefId,
  resolvePageRefTarget,
} from "../notebookPages";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    title: "架构重构",
    icon: "folder",
    tags: [],
    blocks: [{ id: "root-b1", type: "h1", content: "项目总览" }],
    pages: [],
    updatedAt: "刚刚",
    createdAt: "2026-11-21",
    ...overrides,
  };
}

describe("notebookPages utilities", () => {
  it("normalizes duplicate IDs, orphaned parents, self-parents, and cycles", () => {
    const normalized = normalizeProjectPages([
      {
        id: "pg-a",
        title: "A",
        parentPageId: "pg-missing",
        blocks: [],
        updatedAt: "刚刚",
        createdAt: "2026-11-21",
      },
      {
        id: "pg-a",
        title: "A duplicate",
        blocks: [],
        updatedAt: "刚刚",
        createdAt: "2026-11-21",
      },
      {
        id: "pg-self",
        title: "Self",
        parentPageId: "pg-self",
        blocks: [],
        updatedAt: "刚刚",
        createdAt: "2026-11-21",
      },
      {
        id: "pg-c1",
        title: "Cycle 1",
        parentPageId: "pg-c2",
        blocks: [],
        updatedAt: "刚刚",
        createdAt: "2026-11-21",
      },
      {
        id: "pg-c2",
        title: "Cycle 2",
        parentPageId: "pg-c1",
        blocks: [],
        updatedAt: "刚刚",
        createdAt: "2026-11-21",
      },
      {
        id: "pg-child",
        title: "Child of A",
        parentPageId: "pg-a",
        blocks: [
          { id: "b0", type: "h1", content: "Heading", indent: 2 },
          { id: "b1", type: "bullet", content: "hi", indent: 99 },
        ],
        updatedAt: "刚刚",
        createdAt: "2026-11-21",
      },
    ]);

    expect(normalized.map((p) => p.id)).toEqual([
      "pg-a",
      "pg-self",
      "pg-c1",
      "pg-c2",
      "pg-child",
    ]);
    expect(normalized[0]!.parentPageId).toBe(undefined);
    expect(normalized[1]!.parentPageId).toBe(undefined);
    // At least one side of the cycle must have its parent cleared so no cycle remains
    const cycle1Parent = normalized[2]!.parentPageId;
    const cycle2Parent = normalized[3]!.parentPageId;
    expect(cycle1Parent === "pg-c2" && cycle2Parent === "pg-c1").toBe(false);
    expect(normalized[4]!.parentPageId).toBe("pg-a");
    expect(normalized[4]!.blocks[0]!.indent).toBe(undefined);
    expect(normalized[4]!.blocks[1]!.indent).toBe(6);
  });

  it("builds recursive page trees, breadcrumbs, direct children, and descendant checks", () => {
    const project = makeProject({
      pages: [
        { id: "p1", title: "设计", blocks: [], updatedAt: "刚刚", createdAt: "2026-11-21" },
        {
          id: "p2",
          title: "前端结构",
          parentPageId: "p1",
          blocks: [],
          updatedAt: "刚刚",
          createdAt: "2026-11-21",
        },
        {
          id: "p3",
          title: "页面引用卡片",
          parentPageId: "p2",
          blocks: [],
          updatedAt: "刚刚",
          createdAt: "2026-11-21",
        },
        { id: "p4", title: "测试", blocks: [], updatedAt: "刚刚", createdAt: "2026-11-21" },
      ],
    });

    const tree = buildPageTree(project.pages);
    expect(tree.map((n) => n.page.id)).toEqual(["p1", "p4"]);
    expect(tree[0]!.children[0]!.page.id).toBe("p2");
    expect(tree[0]!.children[0]!.children[0]!.page.id).toBe("p3");
    expect(tree[0]!.children[0]!.children[0]!.depth).toBe(2);

    expect(getPageBreadcrumbs(project, "p3").map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(getDirectChildPages(project.pages).map((p) => p.id)).toEqual(["p1", "p4"]);
    expect(getDirectChildPages(project.pages, "p1").map((p) => p.id)).toEqual(["p2"]);
    expect(isDescendantPage(project.pages, "p3", "p1")).toBe(true);
    expect(isDescendantPage(project.pages, "p1", "p3")).toBe(false);
  });

  it("parses [[page:...]] tokens, resolves root/cross-project targets, computes mutual backlinks safely, and formats markdown/context", () => {
    const rootRef = makeRootPageRefId("proj-1");
    expect(parseRootPageRefId(rootRef)).toBe("proj-1");
    expect(parseRootPageRefId("pg-a")).toBe(null);

    const parsed = parseInlineNotebookText("参见 [[page:pg-b]] 与 [[page:root:proj-1]] 文档");
    expect(parsed).toEqual([
      { kind: "text", text: "参见 " },
      { kind: "page", pageId: "pg-b" },
      { kind: "text", text: " 与 " },
      { kind: "page", pageId: "root:proj-1" },
      { kind: "text", text: " 文档" },
    ]);

    const proj1 = makeProject({
      blocks: [
        { id: "r1", type: "paragraph", content: "入口说明 [[page:pg-a]]" },
      ],
      pages: [
        {
          id: "pg-a",
          title: "页面 A",
          blocks: [
            { id: "a1", type: "paragraph", content: "引用 B [[page:pg-b]]" },
            { id: "a2", type: "page_ref", pageId: rootRef, content: "回到项目主页" },
          ],
          updatedAt: "刚刚",
          createdAt: "2026-11-21",
        },
        {
          id: "pg-b",
          title: "页面 B",
          parentPageId: "pg-a",
          blocks: [
            { id: "b1", type: "h2", content: "B 的详细设计" },
            { id: "b2", type: "paragraph", content: "互相关联 [[page:pg-a]]" },
          ],
          updatedAt: "刚刚",
          createdAt: "2026-11-21",
        },
      ],
    });

    const proj2 = makeProject({
      id: "proj-2",
      title: "另一个项目",
      blocks: [],
      pages: [
        {
          id: "pg-other",
          title: "外部关联页",
          blocks: [
            { id: "o1", type: "page_ref", pageId: "pg-a", content: "页面 A" },
          ],
          updatedAt: "刚刚",
          createdAt: "2026-11-21",
        },
      ],
    });

    const projects = [proj1, proj2];

    const targetRoot = resolvePageRefTarget(projects, rootRef);
    expect(targetRoot?.isRoot).toBe(true);
    expect(targetRoot?.page).toBe(null);
    expect(targetRoot?.title).toBe("架构重构");

    const targetPage = resolvePageRefTarget(projects, "pg-b");
    expect(targetPage?.isRoot).toBe(false);
    expect(targetPage?.project.id).toBe("proj-1");
    expect(targetPage?.title).toBe("页面 B");

    expect(resolvePageRefTarget(projects, "pg-unknown")).toBe(null);

    expect(collectReferencedPageIds(proj1.pages![0]!.blocks)).toEqual(["pg-b", rootRef]);

    const backlinksA = findPageBacklinks(projects, "pg-a");
    expect(backlinksA.map((l) => [l.sourceProjectId, l.sourcePageId ?? "root", l.blockId])).toEqual([
      ["proj-1", "root", "r1"],
      ["proj-1", "pg-b", "b2"],
      ["proj-2", "pg-other", "o1"],
    ]);

    const backlinksRoot = findPageBacklinks(projects, rootRef);
    expect(backlinksRoot.map((l) => [l.sourcePageId, l.blockId])).toEqual([["pg-a", "a2"]]);

    const md = pageToMarkdown(proj1, proj1.pages![0]!, [], projects);
    expect(md).toContain("# 页面 A");
    expect(md).toContain("[页面: 页面 B]");
    expect(md).toContain("- [页面：架构重构]");

    const threads: ChatThread[] = [];
    const att = buildNotebookContextAttachment(proj1, threads, {
      page: proj1.pages![0]!,
      originBlockId: "a1",
      allProjects: projects,
    });
    expect(att.badge).toBe("Page");
    expect(att.name).toContain("架构重构 / 页面 A");
    expect(att.textExcerpt ?? "").toContain("- 所属页面：页面 A (pageId=pg-a)");
    expect(att.textExcerpt ?? "").toContain("<<< [@valet 当前引用行]");
    expect(att.textExcerpt ?? "").toContain("[引用页面参考]");
    expect(att.textExcerpt ?? "").toContain("页面 B");
    expect(att.textExcerpt ?? "").toContain("B 的详细设计");
    expect(att.textExcerpt ?? "").toContain("### 架构重构 (项目 Notebook)");
  });
});
