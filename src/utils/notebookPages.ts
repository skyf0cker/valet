import type { NotebookBlock, Project, ProjectPage } from "../types/valet";
import { clampBlockIndent } from "./notebookEditor";
import { coalesceTableParagraphBlocks } from "./notebookTable";

export const ROOT_PAGE_REF_PREFIX = "root:";

export function makeRootPageRefId(projectId: string): string {
  return `${ROOT_PAGE_REF_PREFIX}${projectId}`;
}

export function parseRootPageRefId(pageRefId: string): string | null {
  if (!pageRefId.startsWith(ROOT_PAGE_REF_PREFIX)) return null;
  const id = pageRefId.slice(ROOT_PAGE_REF_PREFIX.length).trim();
  return id || null;
}

export interface ProjectPageTreeNode {
  page: ProjectPage;
  depth: number;
  children: ProjectPageTreeNode[];
}

export interface PageRefTarget {
  project: Project;
  page: ProjectPage | null;
  title: string;
  isRoot: boolean;
}

export interface PageBacklink {
  sourceProjectId: string;
  sourceProjectTitle: string;
  sourcePageId: string | null;
  sourceTitle: string;
  blockId: string;
  snippet: string;
}

const INLINE_PAGE_TOKEN_RE = /\[\[page:([^\]]+)\]\]/g;

export function normalizeProjectPages(pages: ProjectPage[] | undefined): ProjectPage[] {
  if (!Array.isArray(pages) || pages.length === 0) return [];

  const seen = new Set<string>();
  const normalized: ProjectPage[] = [];

  for (const raw of pages) {
    if (!raw || typeof raw.id !== "string") continue;
    const id = raw.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const blocks: NotebookBlock[] = coalesceTableParagraphBlocks(
      Array.isArray(raw.blocks) && raw.blocks.length > 0
        ? raw.blocks.map((blk) => {
            const normIndent = clampBlockIndent(blk.type, blk.indent);
            const nextBlk: NotebookBlock = { ...blk };
            if (normIndent > 0) {
              nextBlk.indent = normIndent;
            } else {
              delete nextBlk.indent;
            }
            return nextBlk;
          })
        : [{ id: `blk-${id}-1`, type: "paragraph", content: "" }]
    );

    const parentPageId =
      typeof raw.parentPageId === "string" && raw.parentPageId.trim()
        ? raw.parentPageId.trim()
        : undefined;

    normalized.push({
      ...raw,
      id,
      parentPageId,
      title: raw.title?.trim() || "未命名页面",
      icon: raw.icon?.trim() || "file",
      updatedAt: raw.updatedAt || "刚刚",
      createdAt: raw.createdAt || new Date().toISOString().slice(0, 10),
      blocks,
    });
  }

  const byId = new Map(normalized.map((p) => [p.id, p]));
  for (const pg of normalized) {
    if (!pg.parentPageId || pg.parentPageId === pg.id || !byId.has(pg.parentPageId)) {
      delete pg.parentPageId;
      continue;
    }
    const visited = new Set<string>([pg.id]);
    let cur: string | undefined = pg.parentPageId;
    let valid = true;
    while (cur) {
      if (visited.has(cur)) {
        valid = false;
        break;
      }
      visited.add(cur);
      const next: string | undefined = byId.get(cur)?.parentPageId;
      if (next && !byId.has(next)) {
        valid = false;
        break;
      }
      cur = next;
    }
    if (!valid) {
      delete pg.parentPageId;
    }
  }

  return normalized;
}

export function buildPageTree(pages: ProjectPage[] | undefined): ProjectPageTreeNode[] {
  const list = pages ?? [];
  if (list.length === 0) return [];
  const validIds = new Set(list.map((p) => p.id));
  const childrenMap = new Map<string, ProjectPage[]>();

  for (const pg of list) {
    const parentKey = pg.parentPageId && validIds.has(pg.parentPageId) ? pg.parentPageId : "";
    const bucket = childrenMap.get(parentKey) ?? [];
    bucket.push(pg);
    childrenMap.set(parentKey, bucket);
  }

  const visited = new Set<string>();
  const buildNodes = (parentId: string, depth: number): ProjectPageTreeNode[] => {
    const siblings = childrenMap.get(parentId) ?? [];
    const nodes: ProjectPageTreeNode[] = [];
    for (const pg of siblings) {
      if (visited.has(pg.id)) continue;
      visited.add(pg.id);
      nodes.push({
        page: pg,
        depth,
        children: depth < 8 ? buildNodes(pg.id, depth + 1) : [],
      });
    }
    return nodes;
  };

  return buildNodes("", 0);
}

export function getPageBreadcrumbs(project: Project, pageId: string): ProjectPage[] {
  const pages = project.pages ?? [];
  const byId = new Map(pages.map((p) => [p.id, p]));
  const trail: ProjectPage[] = [];
  const visited = new Set<string>();
  let cur: string | undefined = pageId;

  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const pg = byId.get(cur);
    if (!pg) break;
    trail.unshift(pg);
    cur = pg.parentPageId;
  }

  return trail;
}

export function getDirectChildPages(
  pages: ProjectPage[] | undefined,
  parentPageId?: string
): ProjectPage[] {
  const targetParent = parentPageId?.trim() || "";
  return (pages ?? []).filter((p) => (p.parentPageId?.trim() || "") === targetParent);
}

export function isDescendantPage(
  pages: ProjectPage[] | undefined,
  candidateId: string,
  ancestorId: string
): boolean {
  if (!candidateId || !ancestorId) return false;
  if (candidateId === ancestorId) return true;
  const byId = new Map((pages ?? []).map((p) => [p.id, p]));
  const visited = new Set<string>();
  let cur: string | undefined = candidateId;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    if (cur === ancestorId) return true;
    cur = byId.get(cur)?.parentPageId;
  }
  return false;
}

export function resolvePageRefTarget(
  projects: Project[],
  pageRefId: string
): PageRefTarget | null {
  const trimmed = pageRefId.trim();
  if (!trimmed) return null;

  const rootProjectId = parseRootPageRefId(trimmed);
  if (rootProjectId) {
    const proj = projects.find((p) => !p.archived && p.id === rootProjectId);
    if (!proj) return null;
    return {
      project: proj,
      page: null,
      title: proj.title,
      isRoot: true,
    };
  }

  for (const proj of projects) {
    if (proj.archived) continue;
    const pg = (proj.pages ?? []).find((item) => item.id === trimmed);
    if (pg) {
      return {
        project: proj,
        page: pg,
        title: pg.title,
        isRoot: false,
      };
    }
  }

  return null;
}

export function collectReferencedPageIds(blocks: NotebookBlock[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    const trimmed = id?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    ids.push(trimmed);
  };

  for (const blk of blocks) {
    if (blk.type === "page_ref") {
      push(blk.pageId);
      continue;
    }
    if (!blk.content) continue;
    INLINE_PAGE_TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_PAGE_TOKEN_RE.exec(blk.content)) !== null) {
      push(m[1]);
    }
  }

  return ids;
}

function summarizeBacklinkSnippet(
  blk: NotebookBlock,
  projectsByPageRef: (refId: string) => string
): string {
  if (blk.type === "page_ref") {
    const title = blk.pageId ? projectsByPageRef(blk.pageId) : blk.content;
    return `引用了页面「${title || "页面"}」`;
  }
  const cleaned = blk.content
    .replace(/\[\[page:([^\]]+)\]\]/g, (_m, id: string) => `[${projectsByPageRef(id)}]`)
    .replace(/\[\[session:([^\]]+)\]\]/g, "[会话]")
    .replace(/\[\[(?:inbox|timeline):([^\]]+)\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 84 ? `${cleaned.slice(0, 83)}…` : cleaned || "页面引用";
}

export function findPageBacklinks(
  projects: Project[],
  targetPageRefId: string
): PageBacklink[] {
  const target = targetPageRefId.trim();
  if (!target) return [];

  const titleLookup = (refId: string): string =>
    resolvePageRefTarget(projects, refId)?.title ?? refId;

  const out: PageBacklink[] = [];
  const targetRootProjectId = parseRootPageRefId(target);

  for (const proj of projects) {
    if (proj.archived) continue;

    // 1. Check Project root Notebook (skip if target itself is root:<this project>)
    if (!targetRootProjectId || targetRootProjectId !== proj.id) {
      const rootRefBlock = proj.blocks.find((blk) =>
        collectReferencedPageIds([blk]).includes(target)
      );
      if (rootRefBlock) {
        out.push({
          sourceProjectId: proj.id,
          sourceProjectTitle: proj.title,
          sourcePageId: null,
          sourceTitle: `${proj.title} (Notebook)`,
          blockId: rootRefBlock.id,
          snippet: summarizeBacklinkSnippet(rootRefBlock, titleLookup),
        });
      }
    }

    // 2. Check every sub-page inside Project (skip self-references)
    for (const pg of proj.pages ?? []) {
      if (pg.id === target) continue;
      const pageRefBlock = pg.blocks.find((blk) =>
        collectReferencedPageIds([blk]).includes(target)
      );
      if (pageRefBlock) {
        out.push({
          sourceProjectId: proj.id,
          sourceProjectTitle: proj.title,
          sourcePageId: pg.id,
          sourceTitle: pg.title,
          blockId: pageRefBlock.id,
          snippet: summarizeBacklinkSnippet(pageRefBlock, titleLookup),
        });
      }
    }
  }

  return out;
}
