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
    const normalized: Project = {
      ...p,
      tags: Array.isArray(p.tags) ? p.tags : [],
      blocks:
        Array.isArray(p.blocks) && p.blocks.length > 0
          ? p.blocks
          : [{ id: makeBlockId("blk"), type: "paragraph", content: "" }],
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

export function blocksToMarkdown(project: Project, threads: ChatThread[]): string {
  const threadsById = new Map(threads.map((t) => [t.id, t]));
  const lines: string[] = [`# ${project.title}`];

  if (project.tags.length > 0 || project.workingDir) {
    const meta: string[] = [];
    if (project.tags.length > 0) meta.push(`标签: ${project.tags.join(", ")}`);
    if (project.workingDir) meta.push(`工作目录: \`${project.workingDir}\``);
    lines.push("", meta.join(" · "));
  }

  lines.push("");
  let orderedCounter = 0;
  for (const blk of project.blocks) {
    if (blk.type !== "numbered") {
      orderedCounter = 0;
    }
    const text = formatInlineTokensForMarkdown(blk.content ?? "", threadsById);
    switch (blk.type) {
      case "h1":
        lines.push(`# ${text}`, "");
        break;
      case "h2":
        lines.push(`## ${text}`, "");
        break;
      case "h3":
        lines.push(`### ${text}`, "");
        break;
      case "bullet":
        lines.push(`- ${text}`);
        break;
      case "numbered":
        orderedCounter += 1;
        lines.push(`${orderedCounter}. ${text}`);
        break;
      case "todo":
        lines.push(`- [${blk.checked ? "x" : " "}] ${text}`);
        break;
      case "callout":
        lines.push(`> [!note]`, ...text.split("\n").map((l) => `> ${l}`), "");
        break;
      case "quote":
        lines.push(...text.split("\n").map((l) => `> ${l}`), "");
        break;
      case "code":
        lines.push(`\`\`\`${blk.language ?? ""}`, blk.content ?? "", "\`\`\`", "");
        break;
      case "divider":
        lines.push("---", "");
        break;
      case "session_ref": {
        const linked = blk.sessionId ? threadsById.get(blk.sessionId) : undefined;
        const title = linked?.title || text || "关联会话";
        const summary = blk.summary || (linked ? extractThreadSummary(linked) : "");
        lines.push(`> **@valet 会话：${title}**${summary ? `\n> ${summary}` : ""}`, "");
        break;
      }
      case "paragraph":
      default:
        if (text.trim()) {
          lines.push(text, "");
        }
        break;
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function buildNotebookContextAttachment(
  project: Project,
  threads: ChatThread[],
  originSection?: string
): ChatAttachment {
  const md = blocksToMarkdown(project, threads);
  const excerpt =
    md.length <= MAX_NOTEBOOK_EXCERPT_CHARS
      ? md
      : `${md.slice(0, MAX_NOTEBOOK_EXCERPT_CHARS - 20)}\n…(Notebook 内容已截断)`;

  return {
    id: `ctx-notebook-${project.id}`,
    kind: "notebook_context",
    refId: project.id,
    badge: "Notebook",
    name: project.title,
    meta: originSection ? `章节 · ${originSection}` : `${project.blocks.length} 个内容块`,
    textExcerpt: excerpt,
  };
}

export function detectMarkdownShortcut(raw: string): {
  type: NotebookBlockType;
  content: string;
  checked?: boolean;
  language?: string;
} | null {
  if (/^###\s(.*)$/.test(raw)) {
    return { type: "h3", content: raw.replace(/^###\s/, "") };
  }
  if (/^##\s(.*)$/.test(raw)) {
    return { type: "h2", content: raw.replace(/^##\s/, "") };
  }
  if (/^#\s(.*)$/.test(raw)) {
    return { type: "h1", content: raw.replace(/^#\s/, "") };
  }
  const todoChecked = /^-\s\[[xX]\]\s(.*)$/.exec(raw) ?? /^\[[xX]\]\s(.*)$/.exec(raw);
  if (todoChecked) {
    return { type: "todo", content: todoChecked[1] ?? "", checked: true };
  }
  const todoUnchecked = /^-\s\[\s?\]\s(.*)$/.exec(raw) ?? /^\[\s?\]\s(.*)$/.exec(raw);
  if (todoUnchecked) {
    return { type: "todo", content: todoUnchecked[1] ?? "", checked: false };
  }
  if (/^[-*+]\s(.*)$/.test(raw)) {
    return { type: "bullet", content: raw.replace(/^[-*+]\s/, "") };
  }
  if (/^1\.\s(.*)$/.test(raw)) {
    return { type: "numbered", content: raw.replace(/^1\.\s/, "") };
  }
  if (/^>\s(.*)$/.test(raw)) {
    return { type: "quote", content: raw.replace(/^>\s/, "") };
  }
  if (/^---$/.test(raw.trim())) {
    return { type: "divider", content: "" };
  }
  const codeFence = /^```([a-zA-Z0-9_-]*)\s$/.exec(raw);
  if (codeFence) {
    return { type: "code", content: "", language: codeFence[1] || "bash" };
  }
  return null;
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
  /\[\[session:([^\]]+)\]\]|\[\[inbox:([^\]]+)\]\]|\[\[timeline:([^\]]+)\]\]|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseInlineNotebookText(text: string): InlineSegment[] {
  if (!text) return [];
  const out: InlineSegment[] = [];
  let lastIndex = 0;
  INLINE_TOKEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push({ kind: "text", text: text.slice(lastIndex, match.index) });
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
    }
    lastIndex = INLINE_TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    out.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return out;
}
