import {
  DEFAULT_PROJECT_ID,
  type ChatAttachment,
  type ChatThread,
  type NotebookBlock,
  type NotebookBlockType,
  type Project,
  type ProjectTab,
  type ValetSnapshot,
} from "../types/valet";
import { clampBlockIndent, computeNumberedListMarkers } from "./notebookEditor";

const MAX_NOTEBOOK_EXCERPT_CHARS = 10_000;

export function makeBlockId(prefix = "blk"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createDefaultProject(): Project {
  return {
    id: DEFAULT_PROJECT_ID,
    title: "默认项目",
    description:
      "自动收纳所有快速发起与历史迁移的对话；可随时归类移入专属项目，或切换至 Notebook 用 Markdown 整理备忘。",
    icon: "box",
    tags: [],
    isDefault: true,
    updatedAt: "刚刚",
    createdAt: new Date().toISOString().slice(0, 10),
    blocks: [{ id: "blk-default-1", type: "paragraph", content: "" }],
  };
}

export function normalizeProjectsState(snapshot: ValetSnapshot): ValetSnapshot {
  const rawProjects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  let defaultProj: Project | null = null;
  const others: Project[] = [];

  for (const p of rawProjects) {
    if (!p || !p.id) continue;
    const normalizedBlocks: NotebookBlock[] =
      Array.isArray(p.blocks) && p.blocks.length > 0
        ? p.blocks.map((blk) => {
            const normIndent = clampBlockIndent(blk.type, blk.indent);
            const nextBlk: NotebookBlock = { ...blk };
            if (normIndent > 0) {
              nextBlk.indent = normIndent;
            } else {
              delete nextBlk.indent;
            }
            return nextBlk;
          })
        : [{ id: makeBlockId("blk"), type: "paragraph", content: "" }];
    const normalized: Project = {
      ...p,
      tags: Array.isArray(p.tags) ? p.tags : [],
      blocks: normalizedBlocks,
    };
    if (p.id === DEFAULT_PROJECT_ID) {
      defaultProj = {
        ...normalized,
        isDefault: true,
        archived: false,
        title: normalized.title?.trim() || "默认项目",
        icon: normalized.icon || "box",
      };
    } else {
      others.push({ ...normalized, isDefault: false });
    }
  }

  const projects = [defaultProj ?? createDefaultProject(), ...others];
  const validProjectIds = new Set(projects.map((p) => p.id));

  const chatThreads = (Array.isArray(snapshot.chatThreads) ? snapshot.chatThreads : []).map(
    (t) => ({
      ...t,
      projectId: t.projectId && validProjectIds.has(t.projectId) ? t.projectId : DEFAULT_PROJECT_ID,
    })
  );

  const activeProjectId =
    snapshot.activeProjectId && validProjectIds.has(snapshot.activeProjectId)
      ? snapshot.activeProjectId
      : DEFAULT_PROJECT_ID;

  const activeView = snapshot.activeView === "chat" ? "projects" : snapshot.activeView;
  let activeProjectTab: ProjectTab =
    snapshot.activeProjectTab === "notebook" ||
    snapshot.activeProjectTab === "sessions" ||
    snapshot.activeProjectTab === "session"
      ? snapshot.activeProjectTab
      : activeProjectId === DEFAULT_PROJECT_ID
        ? "sessions"
        : "notebook";

  if (snapshot.activeView === "chat" && !snapshot.activeProjectTab) {
    activeProjectTab = "session";
  }

  return {
    ...snapshot,
    activeView,
    projects,
    chatThreads,
    activeProjectId,
    activeProjectTab,
  };
}

export function extractThreadSummary(thread: ChatThread): string {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const msg = thread.messages[i];
    if (!msg || msg.role !== "assistant") continue;
    const stripped = msg.content
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
      .replace(/<think(?:ing)?>[\s\S]*$/gi, "")
      .trim();
    for (const rawLine of stripped.split(/\r?\n/)) {
      const cleaned = rawLine
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .trim();
      if (!cleaned) continue;
      return cleaned.length > 140 ? `${cleaned.slice(0, 139)}…` : cleaned;
    }
  }
  return "";
}

export function findNearestHeading(blocks: NotebookBlock[], beforeIndex: number): string {
  for (let i = Math.min(beforeIndex, blocks.length - 1); i >= 0; i--) {
    const blk = blocks[i];
    if (!blk) continue;
    if ((blk.type === "h1" || blk.type === "h2" || blk.type === "h3") && blk.content.trim()) {
      return blk.content.trim();
    }
  }
  return "";
}

export function formatInlineTokensForMarkdown(text: string, threadsById: Map<string, ChatThread>): string {
  return text
    .replace(/\[\[session:([^\]]+)\]\]/g, (_m, id: string) => {
      const t = threadsById.get(id);
      return `[会话: ${t?.title ?? id}]`;
    })
    .replace(/\[\[inbox:([^\]]+)\]\]/g, (_m, id: string) => `[收件箱: ${id}]`)
    .replace(/\[\[timeline:([^\]]+)\]\]/g, (_m, id: string) => `[时间线: ${id}]`);
}

export interface NotebookContextOriginOptions {
  originBlockId?: string;
  originSection?: string;
  originBeforeText?: string;
  originAfterText?: string;
}

function toSingleLineSnippet(text: string, maxLen = 42): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen - 1)}…` : collapsed;
}

function getNotebookBlockTypeLabel(blk: NotebookBlock): string {
  switch (blk.type) {
    case "h1":
      return "一级标题";
    case "h2":
      return "二级标题";
    case "h3":
      return "三级标题";
    case "bullet":
      return "无序列表";
    case "numbered":
      return "有序列表";
    case "todo":
      return blk.checked ? "已完成待办" : "未完成待办";
    case "callout":
      return "提示框";
    case "quote":
      return "引用块";
    case "code":
      return "代码块";
    case "divider":
      return "分割线";
    case "session_ref":
      return "关联会话卡片";
    case "paragraph":
    default:
      return "正文段落";
  }
}

function formatSingleBlockLines(
  blk: NotebookBlock,
  orderedNumber: number,
  threadsById: Map<string, ChatThread>,
  overrideText?: string
): { lines: string[]; trailingBlank: boolean } {
  const rawText = overrideText ?? blk.content ?? "";
  const text = blk.type === "code" ? rawText : formatInlineTokensForMarkdown(rawText, threadsById);
  const indentPrefix = "  ".repeat(clampBlockIndent(blk.type, blk.indent));
  switch (blk.type) {
    case "h1":
      return { lines: [`# ${text}`], trailingBlank: true };
    case "h2":
      return { lines: [`## ${text}`], trailingBlank: true };
    case "h3":
      return { lines: [`### ${text}`], trailingBlank: true };
    case "bullet":
      return { lines: [`${indentPrefix}- ${text}`], trailingBlank: false };
    case "numbered":
      return { lines: [`${indentPrefix}${orderedNumber}. ${text}`], trailingBlank: false };
    case "todo":
      return { lines: [`${indentPrefix}- [${blk.checked ? "x" : " "}] ${text}`], trailingBlank: false };
    case "callout":
      return {
        lines: [`${indentPrefix}> [!note]`, ...text.split("\n").map((l) => `${indentPrefix}> ${l}`)],
        trailingBlank: true,
      };
    case "quote":
      return {
        lines: text.split("\n").map((l) => `${indentPrefix}> ${l}`),
        trailingBlank: true,
      };
    case "code":
      return {
        lines: [`\`\`\`${blk.language ?? ""}`, rawText, "\`\`\`"],
        trailingBlank: true,
      };
    case "divider":
      return { lines: ["---"], trailingBlank: true };
    case "session_ref": {
      const linked = blk.sessionId ? threadsById.get(blk.sessionId) : undefined;
      const title = linked?.title || text || "关联会话";
      const summary = blk.summary || (linked ? extractThreadSummary(linked) : "");
      return {
        lines: [
          `> **@valet 会话：${title}**`,
          ...(summary ? [`> ${summary}`] : []),
        ],
        trailingBlank: true,
      };
    }
    case "paragraph":
    default:
      return text.trim()
        ? { lines: [`${indentPrefix}${text}`], trailingBlank: true }
        : { lines: [], trailingBlank: false };
  }
}

function formatSingleBlockMarkdown(
  blk: NotebookBlock,
  orderedNumber: number,
  threadsById: Map<string, ChatThread>,
  overrideText?: string
): string {
  return formatSingleBlockLines(blk, orderedNumber, threadsById, overrideText).lines.join("\n");
}

export function blocksToMarkdown(project: Project, threads: ChatThread[]): string {
  const threadsById = new Map(threads.map((t) => [t.id, t]));
  const markers = computeNumberedListMarkers(project.blocks);
  const lines: string[] = [`# ${project.title}`];

  if (project.tags.length > 0 || project.workingDir) {
    const meta: string[] = [];
    if (project.tags.length > 0) meta.push(`标签: ${project.tags.join(", ")}`);
    if (project.workingDir) meta.push(`工作目录: \`${project.workingDir}\``);
    lines.push("", meta.join(" · "));
  }

  lines.push("");
  for (const blk of project.blocks) {
    const orderedNumber = markers[blk.id]?.index ?? 1;
    const formatted = formatSingleBlockLines(blk, orderedNumber, threadsById);
    if (formatted.lines.length > 0) {
      lines.push(...formatted.lines);
      if (formatted.trailingBlank) {
        lines.push("");
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function buildNotebookContextAttachment(
  project: Project,
  threads: ChatThread[],
  origin?: string | NotebookContextOriginOptions
): ChatAttachment {
  const {
    originBlockId,
    originSection,
    originBeforeText,
    originAfterText,
  } = typeof origin === "string" ? { originSection: origin } : (origin ?? {});

  const threadsById = new Map(threads.map((t) => [t.id, t]));
  const markers = computeNumberedListMarkers(project.blocks);

  interface AnnotatedEntry {
    blockId: string;
    lineNo: number;
    typeLabel: string;
    markdownText: string;
    plainText: string;
    isOrigin: boolean;
    isBlankOrigin: boolean;
    formattedBlock: string;
  }

  const entries: AnnotatedEntry[] = [];
  let lineNo = 0;

  for (const blk of project.blocks) {
    const orderedNumber = markers[blk.id]?.index ?? 1;

    const isOrigin = Boolean(originBlockId && blk.id === originBlockId);
    const rawContent = blk.content ?? "";

    if (!isOrigin && blk.type === "paragraph" && !rawContent.trim()) {
      continue;
    }

    const hasMidLineMarker =
      isOrigin && Boolean(originBeforeText?.trim() && originAfterText?.trim());
    let effectiveOverride: string | undefined;
    if (hasMidLineMarker) {
      const existingRefs = extractInlineRefs(rawContent);
      effectiveOverride = joinTextWithInlineRefs(
        `${originBeforeText!.trimEnd()} [@valet] ${originAfterText!.trimStart()}`,
        existingRefs
      );
    } else if (isOrigin && !rawContent.trim() && (originBeforeText?.trim() || originAfterText?.trim())) {
      effectiveOverride = `${originBeforeText ?? ""}${originAfterText ?? ""}`;
    }

    const effectiveRaw = effectiveOverride ?? rawContent;
    const isBlankOrigin =
      isOrigin &&
      blk.type !== "divider" &&
      blk.type !== "session_ref" &&
      !effectiveRaw.trim();

    lineNo += 1;
    const typeLabel = getNotebookBlockTypeLabel(blk);
    const markdownText = isBlankOrigin
      ? "（空白行）"
      : formatSingleBlockMarkdown(blk, orderedNumber, threadsById, effectiveOverride);

    let plainText = "";
    if (!isBlankOrigin) {
      if (blk.type === "divider") {
        plainText = "---";
      } else if (blk.type === "session_ref") {
        const linked = blk.sessionId ? threadsById.get(blk.sessionId) : undefined;
        plainText = linked?.title || effectiveRaw || "关联会话";
      } else if (blk.type === "code") {
        plainText = effectiveRaw;
      } else {
        plainText = formatInlineTokensForMarkdown(effectiveRaw, threadsById);
      }
    }

    const marker = isOrigin
      ? isBlankOrigin
        ? "  <<< [@valet 当前发起位置]"
        : "  <<< [@valet 当前引用行]"
      : "";
    const formattedBlock = markdownText
      .split("\n")
      .map((line, i) => (i === 0 ? `L${lineNo}: ${line}${marker}` : `    ${line}`))
      .join("\n");

    entries.push({
      blockId: blk.id,
      lineNo,
      typeLabel,
      markdownText,
      plainText,
      isOrigin,
      isBlankOrigin,
      formattedBlock,
    });
  }

  const originIdx = entries.findIndex((e) => e.isOrigin);
  const originEntry = originIdx >= 0 ? entries[originIdx] : undefined;
  let prevEntry: AnnotatedEntry | undefined;
  if (originEntry?.isBlankOrigin) {
    for (let i = originIdx - 1; i >= 0; i--) {
      if (!entries[i]!.isBlankOrigin) {
        prevEntry = entries[i];
        break;
      }
    }
  }

  const headerLines: string[] = ["[发起定位]", `- 所属项目：${project.title}`];
  if (originSection) {
    headerLines.push(`- 所属章节：${originSection}`);
  }
  if (originEntry) {
    if (originEntry.isBlankOrigin) {
      headerLines.push(
        `- 引用位置：第 ${originEntry.lineNo} 行（空白行${prevEntry ? `，紧接在第 ${prevEntry.lineNo} 行下方` : ""}）`
      );
      if (prevEntry) {
        headerLines.push(
          `- 上方紧邻内容（第 ${prevEntry.lineNo} 行）：${prevEntry.markdownText.replace(/\n+/g, " ")}`
        );
      }
    } else {
      headerLines.push(
        `- 引用位置：第 ${originEntry.lineNo} 行（${originEntry.typeLabel}）`,
        `- 当前引用行内容：${originEntry.markdownText.replace(/\n+/g, " ")}`
      );
    }
  }

  const bodyHeaderLines = ["", "[完整 Notebook 上下文（已标注当前引用行）]"];
  const projectMetaParts: string[] = [];
  if (project.tags.length > 0) projectMetaParts.push(`标签: ${project.tags.join(", ")}`);
  if (project.workingDir) projectMetaParts.push(`工作目录: \`${project.workingDir}\``);
  if (projectMetaParts.length > 0) {
    bodyHeaderLines.push(projectMetaParts.join(" · "));
  }

  const prefix = `${headerLines.join("\n")}\n${bodyHeaderLines.join("\n")}`;
  const fullBody = entries.map((e) => e.formattedBlock).join("\n");
  const fullExcerpt = fullBody ? `${prefix}\n${fullBody}` : prefix;

  let excerpt: string;
  if (fullExcerpt.length <= MAX_NOTEBOOK_EXCERPT_CHARS) {
    excerpt = fullExcerpt;
  } else if (entries.length === 0) {
    excerpt = prefix.slice(0, MAX_NOTEBOOK_EXCERPT_CHARS);
  } else {
    const budget = Math.max(0, MAX_NOTEBOOK_EXCERPT_CHARS - prefix.length - 1);
    const anchorIdx = originIdx >= 0 ? originIdx : 0;
    const renderWindow = (l: number, r: number): string => {
      const parts: string[] = [];
      if (l > 0) parts.push("…（前文已省略）");
      for (let i = l; i <= r; i++) {
        parts.push(entries[i]!.formattedBlock);
      }
      if (r < entries.length - 1) parts.push("…（后文已省略）");
      return parts.join("\n");
    };

    let left = anchorIdx;
    let right = anchorIdx;
    while (true) {
      let moved = false;
      if (left > 0 && renderWindow(left - 1, right).length <= budget) {
        left -= 1;
        moved = true;
      }
      if (right < entries.length - 1 && renderWindow(left, right + 1).length <= budget) {
        right += 1;
        moved = true;
      }
      if (!moved) break;
    }

    let windowed = renderWindow(left, right);
    if (windowed.length > budget) {
      windowed = budget > 16 ? `${windowed.slice(0, budget - 14)}\n…（内容已截断）` : windowed.slice(0, budget);
    }
    excerpt = `${prefix}\n${windowed}`;
  }

  const name =
    originSection && originSection !== project.title
      ? `${project.title} / ${originSection}`
      : project.title;

  let meta: string;
  if (originEntry) {
    if (!originEntry.isBlankOrigin) {
      meta = `第 ${originEntry.lineNo} 行 · ${toSingleLineSnippet(originEntry.plainText || originEntry.typeLabel, 42)}`;
    } else if (prevEntry) {
      meta = `第 ${originEntry.lineNo} 行（空白行，位于「${toSingleLineSnippet(prevEntry.plainText || prevEntry.typeLabel, 24)}」下方）`;
    } else {
      meta = `第 ${originEntry.lineNo} 行（空白行）`;
    }
  } else {
    meta = originSection ? `章节 · ${originSection}` : `${project.blocks.length} 个内容块`;
  }

  return {
    id: `ctx-notebook-${project.id}`,
    kind: "notebook_context",
    refId: project.id,
    badge: "Notebook",
    name,
    meta,
    textExcerpt: excerpt,
  };
}

export function detectMarkdownShortcut(
  raw: string,
  options?: { trigger?: "input" | "enter"; currentType?: NotebookBlockType }
): {
  type: NotebookBlockType;
  content: string;
  checked?: boolean;
  language?: string;
} | null {
  const trigger = options?.trigger ?? "input";
  const currentType = options?.currentType ?? "paragraph";

  if (trigger === "enter") {
    if (currentType !== "paragraph") return null;
    const trimmed = raw.trim();
    const fenceEnter = /^```([a-zA-Z0-9_+-]*)$/.exec(trimmed);
    if (fenceEnter) {
      return { type: "code", content: "", language: fenceEnter[1] || "bash" };
    }
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      return { type: "divider", content: "" };
    }
    if (/^>\s*\[!(?:note|info|tip)\]$/i.test(trimmed)) {
      return { type: "callout", content: "" };
    }
    return null;
  }

  if (currentType === "bullet" || currentType === "numbered" || currentType === "todo") {
    const todoChecked = /^\[[xX]\]\s(.*)$/.exec(raw);
    if (todoChecked) {
      return { type: "todo", content: todoChecked[1] ?? "", checked: true };
    }
    const todoUnchecked = /^\[\s?\]\s(.*)$/.exec(raw);
    if (todoUnchecked) {
      return { type: "todo", content: todoUnchecked[1] ?? "", checked: false };
    }
    return null;
  }

  if (currentType !== "paragraph") {
    return null;
  }

  if (/^###\s(.*)$/.test(raw)) {
    return { type: "h3", content: raw.replace(/^###\s/, "") };
  }
  if (/^##\s(.*)$/.test(raw)) {
    return { type: "h2", content: raw.replace(/^##\s/, "") };
  }
  if (/^#\s(.*)$/.test(raw)) {
    return { type: "h1", content: raw.replace(/^#\s/, "") };
  }
  const todoChecked =
    /^[-*+]\s\[[xX]\]\s(.*)$/.exec(raw) ?? /^\[[xX]\]\s(.*)$/.exec(raw);
  if (todoChecked) {
    return { type: "todo", content: todoChecked[1] ?? "", checked: true };
  }
  const todoUnchecked =
    /^[-*+]\s\[\s?\]\s(.*)$/.exec(raw) ?? /^\[\s?\]\s(.*)$/.exec(raw);
  if (todoUnchecked) {
    return { type: "todo", content: todoUnchecked[1] ?? "", checked: false };
  }
  if (/^[-*+]\s(.*)$/.test(raw)) {
    return { type: "bullet", content: raw.replace(/^[-*+]\s/, "") };
  }
  const numbered = /^\d+[.)]\s(.*)$/.exec(raw);
  if (numbered) {
    return { type: "numbered", content: numbered[1] ?? "" };
  }
  const callout = /^>\s*\[!(?:note|info|tip)\]\s(.*)$/i.exec(raw);
  if (callout) {
    return { type: "callout", content: callout[1] ?? "" };
  }
  if (/^>\s(.*)$/.test(raw)) {
    return { type: "quote", content: raw.replace(/^>\s/, "") };
  }
  if (/^(?:---|___|\*\*\*)$/.test(raw.trim())) {
    return { type: "divider", content: "" };
  }
  const codeFence = /^```([a-zA-Z0-9_+-]*)\s$/.exec(raw);
  if (codeFence) {
    return { type: "code", content: "", language: codeFence[1] || "bash" };
  }
  return null;
}

export type InlineRefKind = "session" | "inbox" | "timeline";

export interface InlineRefToken {
  kind: InlineRefKind;
  id: string;
  raw: string;
  start: number;
  end: number;
}

const INLINE_REF_RE = /\[\[(session|inbox|timeline):([^\]]+)\]\]/g;

/**
 * Extracts all inline reference tokens (`[[session:...]]`, `[[inbox:...]]`, `[[timeline:...]]`)
 * in appearance order with their exact character offsets.
 */
export function extractInlineRefs(content: string): InlineRefToken[] {
  if (!content) return [];
  const refs: InlineRefToken[] = [];
  INLINE_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_REF_RE.exec(content)) !== null) {
    const kind = match[1] as InlineRefKind;
    const id = match[2] ?? "";
    refs.push({
      kind,
      id,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return refs;
}

/**
 * Separates a Notebook block's raw content into clean user-editable text and atomic reference tokens,
 * stripping at most one separator space per token so user-entered spaces round-trip cleanly.
 */
export function splitInlineRefs(content: string): {
  editableText: string;
  refs: InlineRefToken[];
} {
  const refs = extractInlineRefs(content);
  if (refs.length === 0) {
    return { editableText: content, refs: [] };
  }

  let result = content.slice(0, refs[0]!.start);
  for (let i = 0; i < refs.length; i++) {
    const cur = refs[i]!;
    const nextStart = refs[i + 1]?.start ?? content.length;
    let nextChunk = content.slice(cur.end, nextStart);

    let hasTextAfter = nextChunk.length > 0;
    if (!hasTextAfter) {
      for (let k = i + 1; k < refs.length; k++) {
        const tailStart = refs[k]!.end;
        const tailEnd = refs[k + 1]?.start ?? content.length;
        if (tailEnd > tailStart) {
          hasTextAfter = true;
          break;
        }
      }
    }

    if (result.endsWith(" ") && nextChunk.startsWith(" ")) {
      nextChunk = nextChunk.slice(1);
    } else if (result.endsWith(" ") && !hasTextAfter) {
      result = result.slice(0, -1);
    } else if (result === "" && nextChunk.startsWith(" ")) {
      nextChunk = nextChunk.slice(1);
    }

    result += nextChunk;
  }

  return { editableText: result, refs };
}

/**
 * Recombines clean editable text with atomic inline reference tokens using canonical single-space separation.
 */
export function joinTextWithInlineRefs(
  editableText: string,
  refs: ReadonlyArray<Pick<InlineRefToken, "raw">>
): string {
  if (refs.length === 0) return editableText;
  const suffix = refs.map((r) => r.raw).join(" ");
  if (editableText === "") return suffix;
  return `${editableText} ${suffix}`;
}

/**
 * Removes a single inline reference token by index without leaving dangling or doubled separator spaces.
 */
export function removeInlineRefAt(content: string, refIndex: number): string {
  const refs = extractInlineRefs(content);
  if (refIndex < 0 || refIndex >= refs.length) return content;
  const target = refs[refIndex]!;
  let before = content.slice(0, target.start);
  let after = content.slice(target.end);

  if (before.endsWith(" ") && after.startsWith(" ")) {
    after = after.slice(1);
  } else if (before.endsWith(" ") && after === "") {
    before = before.slice(0, -1);
  } else if (before === "" && after.startsWith(" ")) {
    after = after.slice(1);
  }

  return `${before}${after}`;
}

export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "strike"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "session"; sessionId: string }
  | { kind: "inbox"; itemId: string }
  | { kind: "timeline"; eventId: string };

const INLINE_TOKEN_RE =
  /\[\[session:([^\]]+)\]\]|\[\[inbox:([^\]]+)\]\]|\[\[timeline:([^\]]+)\]\]|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()'"\u0080-\uffff]+)/g;

function pushTextSegment(out: InlineSegment[], text: string): void {
  if (!text) return;
  const prev = out[out.length - 1];
  if (prev && prev.kind === "text") {
    prev.text += text;
  } else {
    out.push({ kind: "text", text });
  }
}

export function parseInlineNotebookText(text: string): InlineSegment[] {
  if (!text) return [];
  const out: InlineSegment[] = [];
  let lastIndex = 0;
  INLINE_TOKEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushTextSegment(out, text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      out.push({ kind: "session", sessionId: match[1] });
    } else if (match[2]) {
      out.push({ kind: "inbox", itemId: match[2] });
    } else if (match[3]) {
      out.push({ kind: "timeline", eventId: match[3] });
    } else if (match[4] !== undefined) {
      out.push({ kind: "code", text: match[4] });
    } else if (match[5] !== undefined) {
      out.push({ kind: "bold", text: match[5] });
    } else if (match[6] !== undefined) {
      out.push({ kind: "strike", text: match[6] });
    } else if (match[7] !== undefined) {
      out.push({ kind: "italic", text: match[7] });
    } else if (match[8] !== undefined && match[9] !== undefined) {
      out.push({ kind: "link", label: match[8], href: match[9] });
    } else if (match[10] !== undefined) {
      const rawUrl = match[10];
      const trailingMatch = /[.,;:!?)\]}>。，；：！？）】]+$/.exec(rawUrl);
      const cleanUrl = trailingMatch ? rawUrl.slice(0, trailingMatch.index) : rawUrl;
      const trailingText = trailingMatch ? trailingMatch[0] : "";
      if (cleanUrl) {
        out.push({ kind: "link", label: cleanUrl, href: cleanUrl });
      } else {
        pushTextSegment(out, rawUrl);
      }
      if (trailingText) {
        pushTextSegment(out, trailingText);
      }
    }
    lastIndex = INLINE_TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    pushTextSegment(out, text.slice(lastIndex));
  }
  return out;
}

const DEICTIC_PROMPT_RE = /(这个|这里|这一条|这条|这项|上面|上述|该项|它)/;
const GENERIC_VERB_RE =
  /^(调研|查|看|分析|处理|总结|整理|了解|搜索|搜|核实|跟进|执行|解决|回答|解释|评估)(一下|下|看看)?$/;

function cleanAttachmentTitleCandidate(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^-\s*\[[xX\s]?\]\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/[？?！!。，,；;：:…]+$/u, "")
    .trim();
}

function truncateCodePoints(text: string, maxChars: number): string {
  const chars = Array.from(text);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("") : text;
}

/**
 * Derives a clean, deictic-aware fallback session title from the user prompt and attached context.
 */
export function deriveFallbackSessionTitle(
  prompt: string,
  attachments?: ChatAttachment[]
): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  const cleaned = collapsed
    .replace(/^(?:请|麻烦|可以|能不能|帮我|请你|你帮我|你去|去|先)+/u, "")
    .replace(/[？?！!。，,；;：:…]+$/u, "")
    .trim();

  const isDeictic =
    cleaned.length === 0 ||
    (Array.from(cleaned).length <= 16 && DEICTIC_PROMPT_RE.test(cleaned)) ||
    GENERIC_VERB_RE.test(cleaned);

  if (isDeictic && attachments && attachments.length > 0) {
    const refAtt = attachments.find(
      (a) =>
        a.kind === "notebook_context" ||
        a.kind === "inbox_item" ||
        a.kind === "timeline_event" ||
        a.kind === "message_quote"
    );
    if (refAtt) {
      let candidate = "";
      if (refAtt.kind === "notebook_context") {
        const meta = refAtt.meta?.trim() ?? "";
        const belowMatch = /位于「([^」]+)」下方/.exec(meta);
        if (belowMatch?.[1]) {
          candidate = belowMatch[1];
        } else if (/^第\s*\d+\s*行\s*·\s*/.test(meta)) {
          candidate = meta.replace(/^第\s*\d+\s*行\s*·\s*/, "");
        } else if (/^章节\s*·\s*/.test(meta)) {
          candidate = meta.replace(/^章节\s*·\s*/, "");
        }
        if (!candidate && refAtt.textExcerpt) {
          const lineMatch =
            /^- (?:当前引用行内容|上方紧邻内容（[^）]+）)：(.+)$/m.exec(
              refAtt.textExcerpt
            );
          if (lineMatch?.[1]) {
            candidate = lineMatch[1];
          }
        }
        if (!candidate && refAtt.name) {
          const parts = refAtt.name.split(" / ");
          candidate = parts[parts.length - 1] ?? refAtt.name;
        }
      } else {
        candidate = refAtt.name;
      }

      const cleanedCandidate = cleanAttachmentTitleCandidate(candidate);
      if (cleanedCandidate) {
        return truncateCodePoints(cleanedCandidate, 18);
      }
    }
  }

  const base = cleaned || collapsed;
  return base ? truncateCodePoints(base, 18) : "新对话";
}
