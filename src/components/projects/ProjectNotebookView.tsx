import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useImeGuard } from "../../hooks/useImeGuard";
import { useValet } from "../../store/ValetContext";
import type {
  ChatThread,
  NotebookBlock,
  NotebookBlockType,
  Project,
} from "../../types/valet";
import { copyTextToClipboard } from "../../utils/chatClipboard";
import {
  blocksToMarkdown,
  detectMarkdownShortcut,
  extractInlineRefs,
  findNearestHeading,
  joinTextWithInlineRefs,
  makeBlockId,
  parseInlineNotebookText,
  removeInlineRefAt,
  serializeBlocksToMarkdown,
  splitInlineRefs,
  type InlineRefToken,
} from "../../utils/notebook";
import {
  applyCodeBlockEnter,
  applyCodeBlockTab,
  applyMarkdownPasteToBlocks,
  clampBlockIndent,
  computeNumberedListMarkers,
  convertSelectedBlocks,
  deleteSelectedBlocks,
  duplicateSelectedBlocks,
  getBlockRangeIds,
  indentBlockSubtree,
  indentSelectedBlocks,
  isIndentableBlockType,
  mapRenderedOffsetToRawOffset,
  moveBlockSubtree,
  moveSelectedBlocks,
  normalizeBlockIndents,
  replaceSelectedBlocksWithMarkdown,
  toggleInlineMarkdownFormat,
  toggleSelectedTodos,
  type InlineFormatKind,
} from "../../utils/notebookEditor";
import {
  BowtieSvg,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  GripDotsIcon,
  InboxIcon,
  PlusIcon,
} from "../ui/Icons";
import { InlineValetComposer } from "./InlineValetComposer";
import { NotebookFormatToolbar } from "./NotebookFormatToolbar";
import {
  NotebookMentionPopover,
  NotebookSlashPopover,
  type MentionAction,
  type SlashBlockChoice,
} from "./NotebookMentionPopover";
import { NotebookSelectionBar } from "./NotebookSelectionBar";
import { InlineSessionChip, SessionRefBlockCard } from "./SessionRefCard";

export function exportProjectMarkdownFile(project: Project, threads: ChatThread[]): void {
  const md = blocksToMarkdown(project, threads);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeName =
    project.title
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-") || "project-notebook";
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CopyIconSvg: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const CONVERT_OPTIONS: Array<{ type: NotebookBlockType; label: string }> = [
  { type: "paragraph", label: "正文段落" },
  { type: "h1", label: "一级标题 H1" },
  { type: "h2", label: "二级标题 H2" },
  { type: "h3", label: "三级标题 H3" },
  { type: "todo", label: "待办清单" },
  { type: "bullet", label: "无序列表" },
  { type: "numbered", label: "有序列表" },
  { type: "callout", label: "提示框 Callout" },
  { type: "quote", label: "引用块 Quote" },
  { type: "code", label: "代码块 Code" },
];

const NON_TEXT_BLOCK_TYPES = new Set<NotebookBlockType>(["divider", "session_ref"]);

const CODE_LANGUAGES = [
  "bash",
  "typescript",
  "javascript",
  "go",
  "python",
  "json",
  "yaml",
  "sql",
  "rust",
  "swift",
  "markdown",
  "html",
  "css",
  "text",
];

const QUICK_CONVERT_CODES: Record<string, NotebookBlockType> = {
  Digit0: "paragraph",
  Digit1: "h1",
  Digit2: "h2",
  Digit3: "h3",
  Digit4: "todo",
  Digit5: "bullet",
  Digit6: "numbered",
  Digit7: "quote",
  Digit8: "code",
  Digit9: "callout",
};

interface NotebookHistorySnapshot {
  blocks: NotebookBlock[];
  focusedBlockId: string | null;
  selStart: number;
  selEnd: number;
}

function getClickedRenderedOffset(
  container: HTMLElement,
  clientX: number,
  clientY: number
): number | null {
  if (typeof document === "undefined") return null;
  let range: Range | null = null;
  if (typeof document.caretRangeFromPoint === "function") {
    range = document.caretRangeFromPoint(clientX, clientY);
  } else {
    const caretPosFn = (
      document as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number
        ) => { offsetNode: Node; offset: number } | null;
      }
    ).caretPositionFromPoint;
    if (typeof caretPosFn === "function") {
      const pos = caretPosFn.call(document, clientX, clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
  }
  if (!range || !container.contains(range.startContainer)) return null;

  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentEl = node.parentElement;
      if (parentEl?.closest("[data-inline-interactive], [data-placeholder-text]")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    if (current === range.startContainer) {
      return offset + range.startOffset;
    }
    try {
      if (range.comparePoint(current, 0) >= 0) {
        return offset;
      }
    } catch {
      return null;
    }
    offset += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return offset;
}

function isTextareaOnVisualFirstLine(el: HTMLTextAreaElement, selStart: number): boolean {
  const before = el.value.slice(0, selStart);
  if (before.includes("\n")) return false;
  const lineHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight || "24") || 24;
  if (el.scrollHeight <= lineHeight * 1.65) return true;
  return selStart === 0;
}

function isTextareaOnVisualLastLine(el: HTMLTextAreaElement, selEnd: number): boolean {
  const after = el.value.slice(selEnd);
  if (after.includes("\n")) return false;
  const lineHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight || "24") || 24;
  if (el.scrollHeight <= lineHeight * 1.65) return true;
  return selEnd === el.value.length;
}

const SELECTION_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "[data-inline-interactive]",
  "[data-block-gutter]",
  "[data-block-menu]",
  "[data-notebook-toolbar]",
  "[data-valet-composer]",
  "[data-popover]",
].join(", ");

function isSelectionInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest(SELECTION_INTERACTIVE_SELECTOR));
}

function findBlockIdAtClientY(container: HTMLElement, clientY: number): string | null {
  const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]"));
  if (elements.length === 0) return null;

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return el.dataset.blockId ?? null;
    }
  }

  const firstRect = elements[0]!.getBoundingClientRect();
  if (clientY < firstRect.top) {
    return elements[0]!.dataset.blockId ?? null;
  }

  let nearestId = elements[elements.length - 1]!.dataset.blockId ?? null;
  let minDistance = Number.POSITIVE_INFINITY;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    const dist =
      clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    if (dist < minDistance) {
      minDistance = dist;
      nearestId = el.dataset.blockId ?? null;
    }
  }
  return nearestId;
}

function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const style = window.getComputedStyle(cur);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      cur.scrollHeight > cur.clientHeight
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function getEditableTypographyClass(type: NotebookBlockType, checked?: boolean): string {
  switch (type) {
    case "h1":
      return "font-[family-name:var(--font-serif-zh)] text-[22px] font-semibold leading-[32px] tracking-[-0.015em] text-[var(--ink-strong)]";
    case "h2":
      return "font-[family-name:var(--font-serif-zh)] text-[18px] font-semibold leading-[26px] text-[var(--ink-strong)]";
    case "h3":
      return "text-[15.5px] font-semibold leading-[23px] text-[var(--ink-strong)]";
    case "quote":
      return "text-[14px] leading-[23px] italic text-[var(--ink-secondary)]";
    case "callout":
      return "text-[13.5px] leading-[22px] text-[var(--ink-strong)]";
    case "todo":
      return `text-[14px] leading-[24px] ${
        checked ? "line-through text-[var(--ink-muted)]" : "text-[var(--ink-body)]"
      }`;
    case "bullet":
    case "numbered":
    case "paragraph":
    default:
      return "text-[14px] leading-[24px] text-[var(--ink-body)]";
  }
}

export const ProjectNotebookView: React.FC<{ project: Project }> = ({ project }) => {
  const {
    state,
    runningChatIds,
    focusedNotebookBlock,
    updateProject,
    setProjectTab,
    spawnSessionFromNotebook,
    setActiveView,
    selectInboxItem,
    selectTimelineEvent,
    pushToast,
  } = useValet();

  const [titleDraft, setTitleDraft] = useState(project.title);
  const [descDraft, setDescDraft] = useState(project.description ?? "");
  const [workingDirDraft, setWorkingDirDraft] = useState(project.workingDir ?? "");
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const headerIme = useImeGuard();

  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [textSelection, setTextSelection] = useState<{
    blockId: string;
    start: number;
    end: number;
  } | null>(null);
  const [mentionState, setMentionState] = useState<{
    blockId: string;
    atIndex: number;
    cursorIndex: number;
    query: string;
  } | null>(null);
  const [slashState, setSlashState] = useState<{
    blockId: string;
    mode: "typing" | "insert_after";
    query: string;
  } | null>(null);
  const [valetComposerState, setValetComposerState] = useState<{
    blockId: string;
    beforeText: string;
    afterText: string;
    existingRefs?: InlineRefToken[];
  } | null>(null);
  const [blockMenuId, setBlockMenuId] = useState<string | null>(null);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const blockTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const pendingSelectionRef = useRef<{ blockId: string; start: number; end: number } | null>(
    null
  );
  const lastCompositionEndRef = useRef(0);
  const blocksRef = useRef<NotebookBlock[]>(project.blocks);
  blocksRef.current = project.blocks;
  const focusedBlockIdRef = useRef<string | null>(null);
  focusedBlockIdRef.current = focusedBlockId;
  const selectedBlockIdsRef = useRef<string[]>([]);
  selectedBlockIdsRef.current = selectedBlockIds;
  const selectedBlockIdSet = useMemo(() => new Set(selectedBlockIds), [selectedBlockIds]);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const selectionHeadIdRef = useRef<string | null>(null);
  const dragSessionRef = useRef<{
    mode: "block-cross" | "marquee";
    anchorBlockId?: string;
    startClientX: number;
    startClientY: number;
    startScrollTop: number;
    scrollContainer: HTMLElement | null;
    active: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const historyRef = useRef<{
    past: NotebookHistorySnapshot[];
    future: NotebookHistorySnapshot[];
    lastCoalesceKey: string | null;
    lastCoalesceAt: number;
  }>({
    past: [],
    future: [],
    lastCoalesceKey: null,
    lastCoalesceAt: 0,
  });

  // Reset local header drafts, selection & history when switching projects
  useEffect(() => {
    setTitleDraft(project.title);
    setDescDraft(project.description ?? "");
    setWorkingDirDraft(project.workingDir ?? "");
    setFocusedBlockId(null);
    setTextSelection(null);
    setMentionState(null);
    setSlashState(null);
    setValetComposerState(null);
    setBlockMenuId(null);
    setSelectedBlockIds([]);
    setIsDraggingSelection(false);
    setMarqueeRect(null);
    selectionAnchorIdRef.current = null;
    selectionHeadIdRef.current = null;
    dragSessionRef.current = null;
    historyRef.current = {
      past: [],
      future: [],
      lastCoalesceKey: null,
      lastCoalesceAt: 0,
    };
  }, [project.id]);

  useEffect(() => {
    setTitleDraft(project.title);
  }, [project.title]);

  useEffect(() => {
    setDescDraft(project.description ?? "");
  }, [project.description]);

  useEffect(() => {
    setWorkingDirDraft(project.workingDir ?? "");
  }, [project.workingDir]);

  // Close block action menu on outside click
  useEffect(() => {
    if (!blockMenuId) return;
    const onDown = () => setBlockMenuId(null);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [blockMenuId]);

  // Scroll & highlight when jumping back to a referenced Notebook block
  useEffect(() => {
    if (!focusedNotebookBlock || focusedNotebookBlock.projectId !== project.id) return;
    const targetId = focusedNotebookBlock.blockId;
    const el = document.querySelector<HTMLElement>(
      `[data-block-id="${CSS.escape(targetId)}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setHighlightedBlockId(targetId);
    const timer = window.setTimeout(() => {
      setHighlightedBlockId((cur) => (cur === targetId ? null : cur));
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [focusedNotebookBlock, project.id]);

  // Auto-focus & resize active block textarea while preserving sub-control focus
  useEffect(() => {
    if (!focusedBlockId) return;
    const el = blockTextareaRefs.current[focusedBlockId];
    if (!el) return;
    const activeEl = document.activeElement;
    const isEditingCodeLang =
      activeEl instanceof HTMLInputElement &&
      activeEl.dataset.blockLangInput === focusedBlockId;
    if (activeEl !== el && !isEditingCodeLang) {
      el.focus();
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    const pending = pendingSelectionRef.current;
    if (pending && pending.blockId === focusedBlockId) {
      const start = Math.max(0, Math.min(el.value.length, pending.start));
      const end = Math.max(start, Math.min(el.value.length, pending.end));
      el.setSelectionRange(start, end);
      pendingSelectionRef.current = null;
      setTextSelection(start !== end ? { blockId: focusedBlockId, start, end } : null);
    }
  }, [focusedBlockId, project.blocks]);

  const projectThreads = useMemo(
    () => state.chatThreads.filter((t) => (t.projectId || "proj-default") === project.id),
    [project.id, state.chatThreads]
  );

  const activeThreads = useMemo(
    () => projectThreads.filter((t) => !t.archived),
    [projectThreads]
  );

  const threadIdSet = useMemo(
    () => new Set(projectThreads.map((t) => t.id)),
    [projectThreads]
  );

  const runningCount = useMemo(
    () => activeThreads.filter((t) => (runningChatIds[t.id] ?? 0) > 0).length,
    [activeThreads, runningChatIds]
  );

  const pendingInboxCount = useMemo(
    () =>
      state.inboxItems.filter(
        (it) =>
          it.status === "pending" &&
          it.sourceChatId &&
          threadIdSet.has(it.sourceChatId)
      ).length,
    [state.inboxItems, threadIdSet]
  );

  const inboxById = useMemo(
    () => new Map(state.inboxItems.map((it) => [it.id, it])),
    [state.inboxItems]
  );

  const timelineById = useMemo(
    () => new Map(state.timelineEvents.map((ev) => [ev.id, ev])),
    [state.timelineEvents]
  );

  const blocks = useMemo<NotebookBlock[]>(
    () =>
      project.blocks.length > 0
        ? project.blocks
        : [{ id: makeBlockId("blk"), type: "paragraph", content: "" }],
    [project.blocks]
  );

  const numberedMarkers = useMemo(() => computeNumberedListMarkers(blocks), [blocks]);

  const commitBlocks = useCallback(
    (
      nextBlocks: NotebookBlock[],
      options?: { recordHistory?: boolean; coalesceKey?: string }
    ) => {
      const normalized =
        nextBlocks.length > 0
          ? nextBlocks
          : [{ id: makeBlockId("blk"), type: "paragraph" as const, content: "" }];

      if (options?.recordHistory !== false) {
        const activeId = focusedBlockIdRef.current;
        const activeEl = activeId ? blockTextareaRefs.current[activeId] : null;
        const snapshot: NotebookHistorySnapshot = {
          blocks: blocksRef.current.map((b) => ({ ...b })),
          focusedBlockId: activeId,
          selStart: activeEl?.selectionStart ?? 0,
          selEnd: activeEl?.selectionEnd ?? 0,
        };
        const hist = historyRef.current;
        const now = Date.now();
        const canCoalesce =
          Boolean(options?.coalesceKey) &&
          hist.lastCoalesceKey === options?.coalesceKey &&
          now - hist.lastCoalesceAt < 700 &&
          hist.past.length > 0;
        if (!canCoalesce) {
          hist.past.push(snapshot);
          if (hist.past.length > 80) hist.past.shift();
        }
        hist.future = [];
        hist.lastCoalesceKey = options?.coalesceKey ?? null;
        hist.lastCoalesceAt = options?.coalesceKey ? now : 0;
      }

      updateProject(project.id, { blocks: normalized });
    },
    [project.id, updateProject]
  );

  const projectThreadsRef = useRef(projectThreads);
  projectThreadsRef.current = projectThreads;

  const clearBlockSelection = useCallback(() => {
    selectionAnchorIdRef.current = null;
    selectionHeadIdRef.current = null;
    setSelectedBlockIds((cur) => (cur.length > 0 ? [] : cur));
  }, []);

  const focusBlockAt = useCallback(
    (blockId: string, cursorPos?: number, cursorEnd?: number) => {
      clearBlockSelection();
      if (cursorPos !== undefined) {
        pendingSelectionRef.current = {
          blockId,
          start: cursorPos,
          end: cursorEnd ?? cursorPos,
        };
      }
      setFocusedBlockId(blockId);
    },
    [clearBlockSelection]
  );

  const selectBlockRange = useCallback(
    (anchorId: string, headId: string) => {
      const range = getBlockRangeIds(blocksRef.current, anchorId, headId);
      if (range.length === 0) return;
      selectionAnchorIdRef.current = anchorId;
      selectionHeadIdRef.current = headId;
      const activeEl = document.activeElement;
      if (
        activeEl instanceof HTMLElement &&
        editorRootRef.current?.contains(activeEl) &&
        (activeEl instanceof HTMLTextAreaElement || activeEl.getAttribute("role") === "textbox")
      ) {
        activeEl.blur();
      }
      setFocusedBlockId(null);
      setTextSelection(null);
      setMentionState(null);
      setSlashState(null);
      setBlockMenuId(null);
      setSelectedBlockIds(range);
    },
    []
  );

  const handleSelectAllBlocks = useCallback(() => {
    const cur = blocksRef.current;
    if (cur.length === 0) return;
    selectionAnchorIdRef.current = cur[0]!.id;
    selectionHeadIdRef.current = cur[cur.length - 1]!.id;
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && editorRootRef.current?.contains(activeEl)) {
      activeEl.blur();
    }
    setFocusedBlockId(null);
    setTextSelection(null);
    setMentionState(null);
    setSlashState(null);
    setBlockMenuId(null);
    setSelectedBlockIds(cur.map((b) => b.id));
  }, []);

  const handleDeleteSelectedBlocks = useCallback(() => {
    const ids = new Set(selectedBlockIdsRef.current);
    const res = deleteSelectedBlocks(blocksRef.current, ids);
    if (!res) return;
    clearBlockSelection();
    commitBlocks(res.blocks);
    if (res.focusBlockId) {
      focusBlockAt(res.focusBlockId, res.focusCursorPos);
    } else {
      setFocusedBlockId(null);
    }
  }, [clearBlockSelection, commitBlocks, focusBlockAt]);

  const handleIndentSelectedBlocks = useCallback(
    (delta: 1 | -1) => {
      const ids = new Set(selectedBlockIdsRef.current);
      const next = indentSelectedBlocks(blocksRef.current, ids, delta);
      if (!next) return;
      commitBlocks(next);
    },
    [commitBlocks]
  );

  const handleCopySelectedBlocks = useCallback(() => {
    const ids = new Set(selectedBlockIdsRef.current);
    const selected = blocksRef.current.filter((b) => ids.has(b.id));
    if (selected.length === 0) return;
    const md = serializeBlocksToMarkdown(selected, projectThreadsRef.current);
    if (!md) return;
    void copyTextToClipboard(md).then((ok) => {
      pushToast(
        ok ? `已复制选中的 ${selected.length} 个块` : "复制失败，请检查剪贴板权限",
        ok ? "success" : "warning"
      );
    });
  }, [pushToast]);

  const handleCutSelectedBlocks = useCallback(() => {
    const ids = new Set(selectedBlockIdsRef.current);
    const selected = blocksRef.current.filter((b) => ids.has(b.id));
    if (selected.length === 0) return;
    const md = serializeBlocksToMarkdown(selected, projectThreadsRef.current);
    const count = selected.length;
    if (md) {
      void copyTextToClipboard(md);
    }
    const res = deleteSelectedBlocks(blocksRef.current, ids);
    if (!res) return;
    clearBlockSelection();
    commitBlocks(res.blocks);
    if (res.focusBlockId) {
      focusBlockAt(res.focusBlockId, res.focusCursorPos);
    } else {
      setFocusedBlockId(null);
    }
    pushToast(`已剪切 ${count} 个块`, "success");
  }, [clearBlockSelection, commitBlocks, focusBlockAt, pushToast]);

  const handleDuplicateSelectedBlocks = useCallback(() => {
    const ids = new Set(selectedBlockIdsRef.current);
    const res = duplicateSelectedBlocks(blocksRef.current, ids);
    if (!res) return;
    commitBlocks(res.blocks);
    if (res.duplicatedIds.length > 0) {
      selectionAnchorIdRef.current = res.duplicatedIds[0]!;
      selectionHeadIdRef.current = res.duplicatedIds[res.duplicatedIds.length - 1]!;
      setSelectedBlockIds(res.duplicatedIds);
    }
  }, [commitBlocks]);

  const handleMoveSelectedBlocks = useCallback(
    (delta: -1 | 1) => {
      const ids = new Set(selectedBlockIdsRef.current);
      const next = moveSelectedBlocks(blocksRef.current, ids, delta);
      if (!next) return;
      commitBlocks(next);
    },
    [commitBlocks]
  );

  const handleConvertSelectedBlocks = useCallback(
    (targetType: NotebookBlockType) => {
      const ids = new Set(selectedBlockIdsRef.current);
      const next = convertSelectedBlocks(blocksRef.current, ids, targetType);
      if (!next) return;
      commitBlocks(next);
    },
    [commitBlocks]
  );

  const handleToggleSelectedTodos = useCallback(() => {
    const ids = new Set(selectedBlockIdsRef.current);
    const next = toggleSelectedTodos(blocksRef.current, ids);
    if (!next) return;
    commitBlocks(next);
  }, [commitBlocks]);

  const handleUndo = useCallback(() => {
    const hist = historyRef.current;
    const prev = hist.past.pop();
    if (!prev) return false;

    const activeId = focusedBlockIdRef.current;
    const activeEl = activeId ? blockTextareaRefs.current[activeId] : null;
    hist.future.push({
      blocks: blocksRef.current.map((b) => ({ ...b })),
      focusedBlockId: activeId,
      selStart: activeEl?.selectionStart ?? 0,
      selEnd: activeEl?.selectionEnd ?? 0,
    });
    hist.lastCoalesceKey = null;
    hist.lastCoalesceAt = 0;

    setMentionState(null);
    setSlashState(null);
    clearBlockSelection();
    commitBlocks(prev.blocks, { recordHistory: false });
    if (prev.focusedBlockId) {
      focusBlockAt(prev.focusedBlockId, prev.selStart, prev.selEnd);
    } else {
      setFocusedBlockId(null);
    }
    return true;
  }, [clearBlockSelection, commitBlocks, focusBlockAt]);

  const handleRedo = useCallback(() => {
    const hist = historyRef.current;
    const nextSnap = hist.future.pop();
    if (!nextSnap) return false;

    const activeId = focusedBlockIdRef.current;
    const activeEl = activeId ? blockTextareaRefs.current[activeId] : null;
    hist.past.push({
      blocks: blocksRef.current.map((b) => ({ ...b })),
      focusedBlockId: activeId,
      selStart: activeEl?.selectionStart ?? 0,
      selEnd: activeEl?.selectionEnd ?? 0,
    });
    hist.lastCoalesceKey = null;
    hist.lastCoalesceAt = 0;

    setMentionState(null);
    setSlashState(null);
    clearBlockSelection();
    commitBlocks(nextSnap.blocks, { recordHistory: false });
    if (nextSnap.focusedBlockId) {
      focusBlockAt(nextSnap.focusedBlockId, nextSnap.selStart, nextSnap.selEnd);
    } else {
      setFocusedBlockId(null);
    }
    return true;
  }, [clearBlockSelection, commitBlocks, focusBlockAt]);

  // Global mousemove / mouseup tracking for Notion-style cross-block drag & margin marquee
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const session = dragSessionRef.current;
      const root = editorRootRef.current;
      if (!session || !root) return;

      const sc = session.scrollContainer;
      if (sc && session.active) {
        const scRect = sc.getBoundingClientRect();
        if (e.clientY < scRect.top + 48) {
          sc.scrollTop -= Math.max(4, Math.round((scRect.top + 48 - e.clientY) / 3));
        } else if (e.clientY > scRect.bottom - 48) {
          sc.scrollTop += Math.max(4, Math.round((e.clientY - (scRect.bottom - 48)) / 3));
        }
      }

      const dx = e.clientX - session.startClientX;
      const dy = e.clientY - session.startClientY;

      if (session.mode === "block-cross" && session.anchorBlockId) {
        const overBlockId = findBlockIdAtClientY(root, e.clientY);
        if (!session.active) {
          if (
            overBlockId &&
            overBlockId !== session.anchorBlockId &&
            Math.hypot(dx, dy) > 4
          ) {
            session.active = true;
            window.getSelection()?.removeAllRanges();
            const active = document.activeElement;
            if (active instanceof HTMLElement && root.contains(active)) {
              active.blur();
            }
            setFocusedBlockId(null);
            setTextSelection(null);
            setMentionState(null);
            setSlashState(null);
            setBlockMenuId(null);
            setIsDraggingSelection(true);
          } else {
            return;
          }
        }
        if (overBlockId) {
          const range = getBlockRangeIds(
            blocksRef.current,
            session.anchorBlockId,
            overBlockId
          );
          if (range.length > 0) {
            selectionAnchorIdRef.current = session.anchorBlockId;
            selectionHeadIdRef.current = overBlockId;
            setSelectedBlockIds(range);
          }
        }
        return;
      }

      if (session.mode === "marquee") {
        if (!session.active) {
          if (Math.abs(dx) <= 6 && Math.abs(dy) <= 6) return;
          session.active = true;
          window.getSelection()?.removeAllRanges();
          const active = document.activeElement;
          if (active instanceof HTMLElement && root.contains(active)) {
            active.blur();
          }
          setFocusedBlockId(null);
          setTextSelection(null);
          setMentionState(null);
          setSlashState(null);
          setBlockMenuId(null);
          setIsDraggingSelection(true);
        }

        const scrollOffset = sc ? sc.scrollTop - session.startScrollTop : 0;
        const anchorViewportY = session.startClientY - scrollOffset;
        const rect: MarqueeRect = {
          left: Math.min(session.startClientX, e.clientX),
          top: Math.min(anchorViewportY, e.clientY),
          width: Math.abs(e.clientX - session.startClientX),
          height: Math.abs(e.clientY - anchorViewportY),
        };
        setMarqueeRect(rect);

        const hits: string[] = [];
        const blockEls = root.querySelectorAll<HTMLElement>("[data-block-id]");
        for (const el of blockEls) {
          const bRect = el.getBoundingClientRect();
          const intersects =
            bRect.right >= rect.left &&
            bRect.left <= rect.left + rect.width &&
            bRect.bottom >= rect.top &&
            bRect.top <= rect.top + rect.height;
          if (intersects && el.dataset.blockId) {
            hits.push(el.dataset.blockId);
          }
        }
        if (hits.length > 0) {
          selectionAnchorIdRef.current = hits[0]!;
          selectionHeadIdRef.current = hits[hits.length - 1]!;
        } else {
          selectionAnchorIdRef.current = null;
          selectionHeadIdRef.current = null;
        }
        setSelectedBlockIds(hits);
      }
    };

    const onMouseUp = () => {
      const session = dragSessionRef.current;
      if (!session) return;
      dragSessionRef.current = null;
      setIsDraggingSelection(false);
      setMarqueeRect(null);
      if (session.active) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
      } else if (session.mode === "marquee" && selectedBlockIdsRef.current.length > 0) {
        clearBlockSelection();
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [clearBlockSelection]);

  // Window keyboard & paste handlers for block multi-selection + unfocused Undo/Redo/SelectAll
  useEffect(() => {
    const isModalOrNonEditorEditable = (): boolean => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return true;
      }
      if (active instanceof HTMLElement && active.closest('[role="dialog"]')) {
        return true;
      }
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        !active.closest('[data-notebook-editor="true"]')
      ) {
        return true;
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isModalOrNonEditorEditable()) return;

      const meta = e.metaKey || e.ctrlKey;
      const lower = e.key.toLowerCase();

      if (meta && !e.altKey && lower === "z") {
        const handled = e.shiftKey ? handleRedo() : handleUndo();
        if (handled) e.preventDefault();
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && lower === "y") {
        if (handleRedo()) e.preventDefault();
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && lower === "a") {
        if (document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        handleSelectAllBlocks();
        return;
      }

      const selected = selectedBlockIdsRef.current;
      if (selected.length === 0) return;

      if (e.key === "Escape") {
        e.preventDefault();
        clearBlockSelection();
        return;
      }

      if ((e.key === "Backspace" || e.key === "Delete") && !meta && !e.altKey) {
        e.preventDefault();
        handleDeleteSelectedBlocks();
        return;
      }

      if (e.key === "Tab" && !meta && !e.altKey) {
        e.preventDefault();
        handleIndentSelectedBlocks(e.shiftKey ? -1 : 1);
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && lower === "c") {
        if (!window.getSelection()?.toString()) {
          e.preventDefault();
          handleCopySelectedBlocks();
        }
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && lower === "x") {
        if (!window.getSelection()?.toString()) {
          e.preventDefault();
          handleCutSelectedBlocks();
        }
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && lower === "d") {
        e.preventDefault();
        handleDuplicateSelectedBlocks();
        return;
      }

      if (meta && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        handleMoveSelectedBlocks(e.key === "ArrowUp" ? -1 : 1);
        return;
      }

      if (meta && e.altKey && QUICK_CONVERT_CODES[e.code]) {
        e.preventDefault();
        handleConvertSelectedBlocks(QUICK_CONVERT_CODES[e.code]!);
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        handleToggleSelectedTodos();
        return;
      }

      if (!meta && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const cur = blocksRef.current;
        const selectedSet = new Set(selected);
        const dir = e.key === "ArrowUp" ? -1 : 1;
        const firstSelectedIdx = cur.findIndex((b) => selectedSet.has(b.id));
        const lastSelectedIdx = (() => {
          for (let i = cur.length - 1; i >= 0; i--) {
            if (selectedSet.has(cur[i]!.id)) return i;
          }
          return -1;
        })();

        if (e.shiftKey) {
          e.preventDefault();
          const anchor =
            selectionAnchorIdRef.current ??
            (dir === -1 ? cur[lastSelectedIdx]?.id : cur[firstSelectedIdx]?.id) ??
            null;
          const curHead =
            selectionHeadIdRef.current ??
            (dir === -1 ? cur[firstSelectedIdx]?.id : cur[lastSelectedIdx]?.id) ??
            anchor;
          if (!anchor || !curHead) return;
          const headIdx = cur.findIndex((b) => b.id === curHead);
          const nextIdx = Math.max(0, Math.min(cur.length - 1, headIdx + dir));
          const nextHead = cur[nextIdx]!.id;
          const nextRange = getBlockRangeIds(cur, anchor, nextHead);
          if (nextRange.length > 0) {
            selectionAnchorIdRef.current = anchor;
            selectionHeadIdRef.current = nextHead;
            setSelectedBlockIds(nextRange);
          }
          return;
        }

        // Plain Up/Down collapses selection and focuses the neighboring editable block
        e.preventDefault();
        const startIdx =
          dir === -1 ? Math.max(0, firstSelectedIdx - 1) : Math.min(cur.length - 1, lastSelectedIdx + 1);
        for (let i = startIdx; i >= 0 && i < cur.length; i += dir) {
          const cand = cur[i];
          if (cand && !NON_TEXT_BLOCK_TYPES.has(cand.type)) {
            const len =
              cand.type === "code" ? cand.content.length : splitInlineRefs(cand.content).editableText.length;
            focusBlockAt(cand.id, dir === -1 ? len : 0);
            return;
          }
        }
        clearBlockSelection();
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isModalOrNonEditorEditable()) return;
      if (selectedBlockIdsRef.current.length === 0) return;
      const pasted = e.clipboardData?.getData("text/plain");
      if (!pasted) return;
      const res = replaceSelectedBlocksWithMarkdown(
        blocksRef.current,
        new Set(selectedBlockIdsRef.current),
        pasted
      );
      if (!res) return;
      e.preventDefault();
      clearBlockSelection();
      commitBlocks(res.blocks);
      focusBlockAt(res.focusBlockId, res.focusCursorPos);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [
    clearBlockSelection,
    commitBlocks,
    focusBlockAt,
    handleConvertSelectedBlocks,
    handleCopySelectedBlocks,
    handleCutSelectedBlocks,
    handleDeleteSelectedBlocks,
    handleDuplicateSelectedBlocks,
    handleIndentSelectedBlocks,
    handleMoveSelectedBlocks,
    handleRedo,
    handleSelectAllBlocks,
    handleToggleSelectedTodos,
    handleUndo,
  ]);

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(project.title);
      return;
    }
    if (trimmed !== project.title) {
      updateProject(project.id, { title: trimmed });
    }
  };

  const commitDescription = () => {
    const trimmed = descDraft.trim();
    if (trimmed !== (project.description ?? "")) {
      updateProject(project.id, { description: trimmed });
    }
  };

  const commitWorkingDir = () => {
    const trimmed = workingDirDraft.trim();
    if (trimmed !== (project.workingDir ?? "")) {
      updateProject(project.id, { workingDir: trimmed });
    }
  };

  const handleAddTag = () => {
    const trimmed = tagDraft.trim();
    setAddingTag(false);
    setTagDraft("");
    if (!trimmed) return;
    if (project.tags.includes(trimmed)) return;
    updateProject(project.id, { tags: [...project.tags, trimmed] });
  };

  const getBlockEditableLength = (block: NotebookBlock): number =>
    block.type === "code"
      ? block.content.length
      : splitInlineRefs(block.content).editableText.length;

  const updateBlockContentOrProps = (
    blockId: string,
    patch: Partial<NotebookBlock>,
    commitOpts?: { recordHistory?: boolean; coalesceKey?: string }
  ) => {
    const next = blocksRef.current.map((b) =>
      b.id === blockId ? { ...b, ...patch } : b
    );
    commitBlocks(next, commitOpts);
  };

  const convertBlockType = (blockId: string, targetType: NotebookBlockType) => {
    const cur = blocksRef.current;
    const mapped = cur.map((b) => {
      if (b.id !== blockId) return b;
      const nextBlk: NotebookBlock = {
        ...b,
        type: targetType,
        language: targetType === "code" ? b.language || "bash" : undefined,
        checked: targetType === "todo" ? Boolean(b.checked) : undefined,
      };
      if (!isIndentableBlockType(targetType)) {
        delete nextBlk.indent;
      }
      return nextBlk;
    });
    commitBlocks(normalizeBlockIndents(mapped));
  };

  const applyInlineFormat = (block: NotebookBlock, kind: InlineFormatKind) => {
    if (block.type === "code") return;
    const el = blockTextareaRefs.current[block.id];
    if (!el) return;
    const selStart = el.selectionStart ?? 0;
    const selEnd = el.selectionEnd ?? 0;
    const { editableText, refs } = splitInlineRefs(block.content);
    const formatted = toggleInlineMarkdownFormat(editableText, selStart, selEnd, kind);
    pendingSelectionRef.current = {
      blockId: block.id,
      start: formatted.selectionStart,
      end: formatted.selectionEnd,
    };
    updateBlockContentOrProps(block.id, {
      content: joinTextWithInlineRefs(formatted.text, refs),
    });
  };

  const handleRemoveInlineRef = (blockId: string, refIndex: number) => {
    const blk = blocksRef.current.find((b) => b.id === blockId);
    if (!blk) return;
    updateBlockContentOrProps(blockId, {
      content: removeInlineRefAt(blk.content, refIndex),
    });
  };

  const deleteBlock = (blockId: string) => {
    const cur = blocksRef.current;
    const idx = cur.findIndex((b) => b.id === blockId);
    if (idx === -1) return;
    if (cur.length === 1) {
      const resetId = cur[0]!.id;
      commitBlocks([{ id: resetId, type: "paragraph", content: "" }]);
      focusBlockAt(resetId, 0);
      return;
    }
    const next = normalizeBlockIndents(cur.filter((b) => b.id !== blockId));
    commitBlocks(next);
    const neighbor = next[Math.max(0, idx - 1)];
    if (neighbor && !NON_TEXT_BLOCK_TYPES.has(neighbor.type)) {
      focusBlockAt(neighbor.id, getBlockEditableLength(neighbor));
    } else {
      setFocusedBlockId(null);
    }
  };

  const indentBlock = (blockId: string, delta: 1 | -1) => {
    const cur = blocksRef.current;
    const idx = cur.findIndex((b) => b.id === blockId);
    if (idx === -1) return;
    const next = indentBlockSubtree(cur, idx, delta);
    if (!next) return;
    const el = blockTextareaRefs.current[blockId];
    if (el) {
      pendingSelectionRef.current = {
        blockId,
        start: el.selectionStart ?? 0,
        end: el.selectionEnd ?? 0,
      };
    }
    commitBlocks(next);
  };

  const moveBlock = (blockId: string, delta: -1 | 1) => {
    const cur = blocksRef.current;
    const idx = cur.findIndex((b) => b.id === blockId);
    if (idx === -1) return;
    const moved = moveBlockSubtree(cur, idx, delta);
    if (!moved) return;
    const el = blockTextareaRefs.current[blockId];
    if (el) {
      pendingSelectionRef.current = {
        blockId,
        start: el.selectionStart ?? 0,
        end: el.selectionEnd ?? 0,
      };
    }
    commitBlocks(moved.blocks);
  };

  const duplicateBlock = (blockId: string) => {
    const cur = [...blocksRef.current];
    const idx = cur.findIndex((b) => b.id === blockId);
    if (idx === -1) return;
    const clone: NotebookBlock = {
      ...cur[idx]!,
      id: makeBlockId("blk"),
    };
    cur.splice(idx + 1, 0, clone);
    commitBlocks(normalizeBlockIndents(cur));
    if (!NON_TEXT_BLOCK_TYPES.has(clone.type)) {
      focusBlockAt(clone.id, getBlockEditableLength(clone));
    }
  };

  const reorderBlocks = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const cur = [...blocksRef.current];
    const fromIdx = cur.findIndex((b) => b.id === sourceId);
    const toIdx = cur.findIndex((b) => b.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = cur.splice(fromIdx, 1);
    cur.splice(toIdx, 0, moved!);
    commitBlocks(normalizeBlockIndents(cur));
  };

  const handleOpenInlineValetAtEndOrFocused = () => {
    const cur = blocksRef.current;
    const activeBlock =
      (focusedBlockId && cur.find((b) => b.id === focusedBlockId)) || null;
    if (
      activeBlock &&
      !NON_TEXT_BLOCK_TYPES.has(activeBlock.type) &&
      activeBlock.content.trim() === ""
    ) {
      setMentionState(null);
      setSlashState(null);
      setValetComposerState({
        blockId: activeBlock.id,
        beforeText: "",
        afterText: "",
      });
      return;
    }

    const newBlk: NotebookBlock = {
      id: makeBlockId("blk"),
      type: "paragraph",
      content: "",
    };
    const insertAfterIdx = activeBlock
      ? cur.findIndex((b) => b.id === activeBlock.id) + 1
      : cur.length;
    const next = [...cur];
    next.splice(insertAfterIdx, 0, newBlk);
    commitBlocks(next);
    setMentionState(null);
    setSlashState(null);
    setValetComposerState({
      blockId: newBlk.id,
      beforeText: "",
      afterText: "",
    });
  };

  const handleBlockChange = (
    block: NotebookBlock,
    rawVal: string,
    selectionStart: number
  ) => {
    if (block.type === "code") {
      updateBlockContentOrProps(block.id, { content: rawVal }, { coalesceKey: block.id });
      setMentionState(null);
      setSlashState(null);
      return;
    }

    const existingRefs = extractInlineRefs(block.content);

    // 1. Live Markdown prefix conversion (paragraphs + empty-list -> todo conversion)
    const shortcut = detectMarkdownShortcut(rawVal, {
      trigger: "input",
      currentType: block.type,
    });
    if (shortcut && !(shortcut.type === "divider" && existingRefs.length > 0)) {
      setMentionState(null);
      setSlashState(null);
      const cur = blocksRef.current;
      const idx = cur.findIndex((b) => b.id === block.id);
      if (shortcut.type === "divider") {
        const nextPara: NotebookBlock = {
          id: makeBlockId("blk"),
          type: "paragraph",
          content: "",
        };
        const next = [...cur];
        next[idx] = { id: block.id, type: "divider", content: "" };
        next.splice(idx + 1, 0, nextPara);
        commitBlocks(normalizeBlockIndents(next));
        focusBlockAt(nextPara.id, 0);
        return;
      }
      const next = cur.map((b) => {
        if (b.id !== block.id) return b;
        const converted: NotebookBlock = {
          ...b,
          type: shortcut.type,
          content: joinTextWithInlineRefs(shortcut.content, existingRefs),
          checked: shortcut.checked,
          language: shortcut.language,
        };
        if (!isIndentableBlockType(shortcut.type)) {
          delete converted.indent;
        }
        return converted;
      });
      commitBlocks(normalizeBlockIndents(next));
      focusBlockAt(block.id, shortcut.content.length);
      return;
    }

    // Persist normal text edit while preserving existing inline reference chips
    updateBlockContentOrProps(
      block.id,
      {
        content: joinTextWithInlineRefs(rawVal, existingRefs),
      },
      { coalesceKey: block.id }
    );

    const beforeCursor = rawVal.slice(0, selectionStart);

    // 2. Typing `@valet ` (trailing space) launches the inline @valet session composer immediately
    const valetSpaceMatch = /(^|\s)@valet\s$/.exec(beforeCursor);
    if (valetSpaceMatch) {
      const tokenStart =
        beforeCursor.length -
        valetSpaceMatch[0].length +
        valetSpaceMatch[1]!.length;
      const beforeText = rawVal.slice(0, tokenStart);
      const afterText = rawVal.slice(selectionStart);
      updateBlockContentOrProps(block.id, {
        content: joinTextWithInlineRefs(`${beforeText}${afterText}`, existingRefs),
      });
      setMentionState(null);
      setSlashState(null);
      setValetComposerState({
        blockId: block.id,
        beforeText,
        afterText,
        existingRefs,
      });
      return;
    }

    // 3. Typing `@...` opens Mention Popover
    const mentionMatch = /(^|\s)@([^\s@]*)$/.exec(beforeCursor);
    if (mentionMatch) {
      const atIndex =
        beforeCursor.length -
        mentionMatch[0].length +
        mentionMatch[1]!.length;
      setMentionState({
        blockId: block.id,
        atIndex,
        cursorIndex: selectionStart,
        query: mentionMatch[2] ?? "",
      });
      setSlashState(null);
      return;
    }

    // 4. Typing `/...` at start of any non-code text block opens Slash Block Menu
    if (!NON_TEXT_BLOCK_TYPES.has(block.type) && existingRefs.length === 0) {
      const slashMatch = /^\/([^\s]*)$/.exec(rawVal);
      if (slashMatch) {
        setSlashState({
          blockId: block.id,
          mode: "typing",
          query: slashMatch[1] ?? "",
        });
        setMentionState(null);
        return;
      }
    }

    setMentionState((cur) => (cur?.blockId === block.id ? null : cur));
    setSlashState((cur) => (cur?.blockId === block.id ? null : cur));
  };

  const handleBlockPaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    block: NotebookBlock,
    blockIndex: number
  ) => {
    if (block.type === "code") return;
    const pasted = e.clipboardData?.getData("text/plain");
    if (!pasted) return;
    const el = e.currentTarget;
    const res = applyMarkdownPasteToBlocks({
      blocks: blocksRef.current,
      blockIndex,
      selStart: el.selectionStart ?? 0,
      selEnd: el.selectionEnd ?? 0,
      pastedText: pasted,
    });
    if (!res) return;
    e.preventDefault();
    setMentionState(null);
    setSlashState(null);
    commitBlocks(res.blocks);
    focusBlockAt(res.focusBlockId, res.focusCursorPos);
  };

  const handleMentionSelect = (action: MentionAction) => {
    if (!mentionState) return;
    const { blockId, atIndex, cursorIndex } = mentionState;
    const cur = blocksRef.current;
    const idx = cur.findIndex((b) => b.id === blockId);
    const blk = cur[idx];
    if (!blk) {
      setMentionState(null);
      return;
    }

    const { editableText, refs } = splitInlineRefs(blk.content);
    const beforeText = editableText.slice(0, atIndex);
    const afterText = editableText.slice(cursorIndex);
    setMentionState(null);

    if (action.kind === "new_valet_session") {
      updateBlockContentOrProps(blockId, {
        content: joinTextWithInlineRefs(`${beforeText}${afterText}`, refs),
      });
      setValetComposerState({
        blockId,
        beforeText,
        afterText,
        existingRefs: refs,
      });
      return;
    }

    if (action.kind === "link_session" && !beforeText.trim() && !afterText.trim() && refs.length === 0) {
      const next = [...cur];
      next[idx] = {
        id: blk.id,
        type: "session_ref",
        sessionId: action.thread.id,
        content: action.thread.title,
      };
      if (idx === next.length - 1) {
        next.push({ id: makeBlockId("blk"), type: "paragraph", content: "" });
      }
      commitBlocks(next);
      setFocusedBlockId(null);
      return;
    }

    const refToken =
      action.kind === "link_session"
        ? `[[session:${action.thread.id}]]`
        : action.kind === "link_inbox"
          ? `[[inbox:${action.itemId}]]`
          : `[[timeline:${action.eventId}]]`;
    const cleanAfter = afterText.trimStart();
    const mergedText = cleanAfter
      ? `${beforeText}${cleanAfter}`
      : beforeText.replace(/ $/, "");
    const nextContent = joinTextWithInlineRefs(mergedText, [...refs, { raw: refToken }]);
    updateBlockContentOrProps(blockId, { content: nextContent });
    focusBlockAt(blockId, cleanAfter ? beforeText.length : mergedText.length);
  };

  const handleSlashSelect = (choice: SlashBlockChoice) => {
    if (!slashState) return;
    const { blockId, mode } = slashState;
    const cur = blocksRef.current;
    const idx = cur.findIndex((b) => b.id === blockId);
    if (idx === -1) {
      setSlashState(null);
      return;
    }
    setSlashState(null);

    if (choice.kind === "valet_session") {
      if (mode === "typing") {
        updateBlockContentOrProps(blockId, { content: "" });
        setValetComposerState({ blockId, beforeText: "", afterText: "" });
      } else {
        const newBlk: NotebookBlock = {
          id: makeBlockId("blk"),
          type: "paragraph",
          content: "",
        };
        const next = [...cur];
        next.splice(idx + 1, 0, newBlk);
        commitBlocks(next);
        setValetComposerState({ blockId: newBlk.id, beforeText: "", afterText: "" });
      }
      return;
    }

    const chosenType = choice.blockType;
    if (mode === "typing") {
      if (chosenType === "divider") {
        const nextPara: NotebookBlock = {
          id: makeBlockId("blk"),
          type: "paragraph",
          content: "",
        };
        const next = [...cur];
        next[idx] = { id: blockId, type: "divider", content: "" };
        next.splice(idx + 1, 0, nextPara);
        commitBlocks(normalizeBlockIndents(next));
        focusBlockAt(nextPara.id, 0);
        return;
      }
      const next = cur.map((b) => {
        if (b.id !== blockId) return b;
        const converted: NotebookBlock = {
          ...b,
          type: chosenType,
          content: "",
          language: chosenType === "code" ? b.language || "bash" : undefined,
          checked: chosenType === "todo" ? false : undefined,
        };
        if (!isIndentableBlockType(chosenType)) {
          delete converted.indent;
        }
        return converted;
      });
      commitBlocks(normalizeBlockIndents(next));
      focusBlockAt(blockId, 0);
      return;
    }

    // mode === "insert_after"
    const sourceIndent = cur[idx] ? clampBlockIndent(cur[idx]!.type, cur[idx]!.indent) : 0;
    const newBlk: NotebookBlock = {
      id: makeBlockId("blk"),
      type: chosenType,
      content: "",
      ...(sourceIndent > 0 && isIndentableBlockType(chosenType) ? { indent: sourceIndent } : {}),
      language: chosenType === "code" ? "bash" : undefined,
      checked: chosenType === "todo" ? false : undefined,
    };
    const next = [...cur];
    next.splice(idx + 1, 0, newBlk);
    if (chosenType === "divider") {
      const followPara: NotebookBlock = {
        id: makeBlockId("blk"),
        type: "paragraph",
        content: "",
      };
      next.splice(idx + 2, 0, followPara);
      commitBlocks(normalizeBlockIndents(next));
      focusBlockAt(followPara.id, 0);
      return;
    }
    commitBlocks(normalizeBlockIndents(next));
    focusBlockAt(newBlk.id, 0);
  };

  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    block: NotebookBlock,
    blockIndex: number
  ) => {
    if (
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      performance.now() - lastCompositionEndRef.current < 100
    ) {
      return;
    }

    const popoverOpen =
      mentionState?.blockId === block.id || slashState?.blockId === block.id;

    // Popover window capture listener owns navigation/confirmation while open
    if (
      popoverOpen &&
      (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape")
    ) {
      return;
    }

    const meta = e.metaKey || e.ctrlKey;
    const lowerKey = e.key.toLowerCase();

    // Block-level Undo / Redo across block splits, merges, indentation, pastes, and edits
    if (meta && !e.altKey && lowerKey === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && lowerKey === "y") {
      e.preventDefault();
      handleRedo();
      return;
    }

    const el = e.currentTarget;
    const selStart = el.selectionStart ?? 0;
    const selEnd = el.selectionEnd ?? 0;

    // 2-stage Select All: first ⌘A selects inside the block, second ⌘A selects all blocks
    if (meta && !e.altKey && !e.shiftKey && lowerKey === "a") {
      if (el.value.length === 0 || (selStart === 0 && selEnd === el.value.length)) {
        e.preventDefault();
        handleSelectAllBlocks();
      }
      return;
    }

    // Shift+ArrowUp / Shift+ArrowDown crossing out of the block initiates cross-block selection
    if (!meta && !e.altKey && e.shiftKey && e.key === "ArrowUp" && selStart === 0 && blockIndex > 0) {
      e.preventDefault();
      const prevBlk = blocksRef.current[blockIndex - 1];
      if (prevBlk) {
        selectBlockRange(block.id, prevBlk.id);
      }
      return;
    }
    if (
      !meta &&
      !e.altKey &&
      e.shiftKey &&
      e.key === "ArrowDown" &&
      selEnd === el.value.length &&
      blockIndex < blocksRef.current.length - 1
    ) {
      e.preventDefault();
      const nextBlk = blocksRef.current[blockIndex + 1];
      if (nextBlk) {
        selectBlockRange(block.id, nextBlk.id);
      }
      return;
    }

    // Universal block shortcuts (Duplicate / Move subtree / Quick convert)
    if (meta && !e.altKey && !e.shiftKey && lowerKey === "d") {
      e.preventDefault();
      duplicateBlock(block.id);
      return;
    }
    if (meta && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveBlock(block.id, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (meta && e.altKey && QUICK_CONVERT_CODES[e.code]) {
      e.preventDefault();
      const targetType = QUICK_CONVERT_CODES[e.code]!;
      pendingSelectionRef.current = { blockId: block.id, start: selStart, end: selEnd };
      convertBlockType(block.id, targetType);
      focusBlockAt(block.id, selStart, selEnd);
      return;
    }

    const focusAdjacentEditableBlock = (direction: -1 | 1, col: number) => {
      const cur = blocksRef.current;
      for (let i = blockIndex + direction; i >= 0 && i < cur.length; i += direction) {
        const candidate = cur[i];
        if (!candidate || NON_TEXT_BLOCK_TYPES.has(candidate.type)) continue;
        const candText =
          candidate.type === "code"
            ? candidate.content
            : splitInlineRefs(candidate.content).editableText;
        if (direction === -1) {
          const lastLineStart = candText.lastIndexOf("\n") + 1;
          const lastLineLen = candText.length - lastLineStart;
          focusBlockAt(candidate.id, lastLineStart + Math.min(col, lastLineLen));
        } else {
          const firstNewline = candText.indexOf("\n");
          const firstLineLen = firstNewline === -1 ? candText.length : firstNewline;
          focusBlockAt(candidate.id, Math.min(col, firstLineLen));
        }
        return true;
      }
      return false;
    };

    if (block.type === "code") {
      if (e.key === "Tab") {
        e.preventDefault();
        const nextCode = applyCodeBlockTab(block.content, selStart, selEnd, e.shiftKey);
        pendingSelectionRef.current = {
          blockId: block.id,
          start: nextCode.selectionStart,
          end: nextCode.selectionEnd,
        };
        updateBlockContentOrProps(block.id, { content: nextCode.text });
        return;
      }
      if (e.key === "Enter" && (e.shiftKey || meta)) {
        e.preventDefault();
        const cur = blocksRef.current;
        const nextBlk: NotebookBlock = {
          id: makeBlockId("blk"),
          type: "paragraph",
          content: "",
        };
        const next = [...cur];
        next.splice(blockIndex + 1, 0, nextBlk);
        commitBlocks(next);
        focusBlockAt(nextBlk.id, 0);
        return;
      }
      if (e.key === "Enter" && !e.altKey) {
        e.preventDefault();
        const nextCode = applyCodeBlockEnter(block.content, selStart, selEnd);
        pendingSelectionRef.current = {
          blockId: block.id,
          start: nextCode.selectionStart,
          end: nextCode.selectionEnd,
        };
        updateBlockContentOrProps(block.id, { content: nextCode.text });
        return;
      }
      if (e.key === "Backspace" && block.content === "") {
        e.preventDefault();
        updateBlockContentOrProps(block.id, { type: "paragraph", language: undefined });
        focusBlockAt(block.id, 0);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        el.blur();
        return;
      }
      if (
        e.key === "ArrowUp" &&
        !e.shiftKey &&
        !e.altKey &&
        !meta &&
        selStart === selEnd &&
        !block.content.slice(0, selStart).includes("\n")
      ) {
        if (focusAdjacentEditableBlock(-1, selStart)) {
          e.preventDefault();
        }
        return;
      }
      if (
        e.key === "ArrowDown" &&
        !e.shiftKey &&
        !e.altKey &&
        !meta &&
        selStart === selEnd &&
        !block.content.slice(selEnd).includes("\n")
      ) {
        const lineStart = block.content.lastIndexOf("\n", Math.max(0, selStart - 1)) + 1;
        if (focusAdjacentEditableBlock(1, selStart - lineStart)) {
          e.preventDefault();
        }
      }
      return;
    }

    const { editableText, refs } = splitInlineRefs(block.content);

    // Tab / Shift+Tab indentation for indentable blocks (never let Tab escape the editor)
    if (e.key === "Tab") {
      e.preventDefault();
      if (!popoverOpen) {
        indentBlock(block.id, e.shiftKey ? -1 : 1);
      }
      return;
    }

    // Inline formatting shortcuts
    if (meta && !e.altKey) {
      if (!e.shiftKey && lowerKey === "b") {
        e.preventDefault();
        applyInlineFormat(block, "bold");
        return;
      }
      if (!e.shiftKey && lowerKey === "i") {
        e.preventDefault();
        applyInlineFormat(block, "italic");
        return;
      }
      if (!e.shiftKey && lowerKey === "e") {
        e.preventDefault();
        applyInlineFormat(block, "code");
        return;
      }
      if (e.shiftKey && lowerKey === "s") {
        e.preventDefault();
        applyInlineFormat(block, "strike");
        return;
      }
      if (!e.shiftKey && lowerKey === "k" && selStart !== selEnd) {
        e.preventDefault();
        applyInlineFormat(block, "link");
        return;
      }
      if (e.key === "Enter" && block.type === "todo") {
        e.preventDefault();
        pendingSelectionRef.current = { blockId: block.id, start: selStart, end: selEnd };
        updateBlockContentOrProps(block.id, { checked: !block.checked });
        return;
      }
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setTextSelection(null);
      el.blur();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();

      // Enter-triggered block conversion (e.g. ```ts, ---, > [!note])
      const enterShortcut = detectMarkdownShortcut(editableText, {
        trigger: "enter",
        currentType: block.type,
      });
      if (enterShortcut && !(enterShortcut.type === "divider" && refs.length > 0)) {
        const cur = blocksRef.current;
        if (enterShortcut.type === "divider") {
          const nextPara: NotebookBlock = {
            id: makeBlockId("blk"),
            type: "paragraph",
            content: "",
          };
          const next = [...cur];
          next[blockIndex] = { id: block.id, type: "divider", content: "" };
          next.splice(blockIndex + 1, 0, nextPara);
          commitBlocks(normalizeBlockIndents(next));
          focusBlockAt(nextPara.id, 0);
          return;
        }
        const next = cur.map((b) => {
          if (b.id !== block.id) return b;
          const converted: NotebookBlock = {
            ...b,
            type: enterShortcut.type,
            content: joinTextWithInlineRefs(enterShortcut.content, refs),
            checked: enterShortcut.checked,
            language: enterShortcut.language,
          };
          if (!isIndentableBlockType(enterShortcut.type)) {
            delete converted.indent;
          }
          return converted;
        });
        commitBlocks(normalizeBlockIndents(next));
        focusBlockAt(block.id, enterShortcut.content.length);
        return;
      }

      if (
        (block.type === "bullet" ||
          block.type === "numbered" ||
          block.type === "todo" ||
          block.type === "quote" ||
          block.type === "callout") &&
        editableText.trim() === "" &&
        refs.length === 0
      ) {
        if (clampBlockIndent(block.type, block.indent) > 0) {
          indentBlock(block.id, -1);
          return;
        }
        updateBlockContentOrProps(block.id, { type: "paragraph", checked: undefined });
        focusBlockAt(block.id, 0);
        return;
      }

      const before = editableText.slice(0, selStart);
      const after = editableText.slice(selEnd);
      const continueType: NotebookBlockType =
        block.type === "bullet" || block.type === "numbered" || block.type === "todo"
          ? block.type
          : "paragraph";
      const curIndent = clampBlockIndent(block.type, block.indent);
      const inheritIndent = isIndentableBlockType(continueType) ? curIndent : 0;
      const newBlk: NotebookBlock = {
        id: makeBlockId("blk"),
        type: continueType,
        content: after,
        ...(inheritIndent > 0 ? { indent: inheritIndent } : {}),
        checked: continueType === "todo" ? false : undefined,
      };
      const next = [...blocksRef.current];
      next[blockIndex] = {
        ...block,
        content: joinTextWithInlineRefs(before, refs),
      };
      next.splice(blockIndex + 1, 0, newBlk);
      commitBlocks(next);
      focusBlockAt(newBlk.id, 0);
      return;
    }

    if (
      e.key === "Delete" &&
      selStart === editableText.length &&
      selEnd === selStart &&
      refs.length > 0
    ) {
      e.preventDefault();
      pendingSelectionRef.current = {
        blockId: block.id,
        start: editableText.length,
        end: editableText.length,
      };
      handleRemoveInlineRef(block.id, 0);
      return;
    }

    if (e.key === "Backspace" && selStart === 0 && selEnd === 0) {
      if (editableText === "" && refs.length > 0) {
        e.preventDefault();
        pendingSelectionRef.current = { blockId: block.id, start: 0, end: 0 };
        handleRemoveInlineRef(block.id, refs.length - 1);
        return;
      }
      if (clampBlockIndent(block.type, block.indent) > 0) {
        e.preventDefault();
        indentBlock(block.id, -1);
        return;
      }
      if (block.type !== "paragraph") {
        e.preventDefault();
        updateBlockContentOrProps(block.id, { type: "paragraph", checked: undefined });
        focusBlockAt(block.id, 0);
        return;
      }
      const cur = blocksRef.current;
      if (blockIndex > 0 && cur[blockIndex - 1]?.type === "divider") {
        e.preventDefault();
        const next = normalizeBlockIndents(cur.filter((_, i) => i !== blockIndex - 1));
        commitBlocks(next);
        focusBlockAt(block.id, 0);
        return;
      }
      if (editableText === "" && refs.length === 0 && cur.length > 1) {
        e.preventDefault();
        deleteBlock(block.id);
        return;
      }
      if (blockIndex > 0) {
        const prev = cur[blockIndex - 1];
        if (prev && !NON_TEXT_BLOCK_TYPES.has(prev.type) && prev.type !== "code") {
          e.preventDefault();
          const prevSplit = splitInlineRefs(prev.content);
          const joinPos = prevSplit.editableText.length;
          const next = [...cur];
          next[blockIndex - 1] = {
            ...prev,
            content: joinTextWithInlineRefs(
              `${prevSplit.editableText}${editableText}`,
              [...prevSplit.refs, ...refs]
            ),
          };
          next.splice(blockIndex, 1);
          commitBlocks(normalizeBlockIndents(next));
          focusBlockAt(prev.id, joinPos);
        }
      }
      return;
    }

    if (
      e.key === "ArrowUp" &&
      !e.shiftKey &&
      !e.altKey &&
      !meta &&
      selStart === selEnd &&
      isTextareaOnVisualFirstLine(el, selStart)
    ) {
      if (focusAdjacentEditableBlock(-1, selStart)) {
        e.preventDefault();
      }
      return;
    }

    if (
      e.key === "ArrowDown" &&
      !e.shiftKey &&
      !e.altKey &&
      !meta &&
      selStart === selEnd &&
      isTextareaOnVisualLastLine(el, selEnd)
    ) {
      const lineStart = el.value.lastIndexOf("\n", Math.max(0, selStart - 1)) + 1;
      if (focusAdjacentEditableBlock(1, selStart - lineStart)) {
        e.preventDefault();
      }
    }
  };

  const renderInlineRefChip = (
    ref: Pick<InlineRefToken, "kind" | "id">,
    blockId: string,
    refIndex: number,
    key: React.Key
  ) => {
    const onRemove = () => handleRemoveInlineRef(blockId, refIndex);

    if (ref.kind === "session") {
      return (
        <InlineSessionChip
          key={key}
          sessionId={ref.id}
          onRemove={onRemove}
        />
      );
    }

    const isInbox = ref.kind === "inbox";
    const item = isInbox ? inboxById.get(ref.id) : undefined;
    const ev = !isInbox ? timelineById.get(ref.id) : undefined;
    const label = (isInbox ? item?.title : ev?.title) ?? ref.id;
    const navigate = () => {
      if (isInbox) {
        if (!item) {
          pushToast("该收件箱事项已清理", "warning");
          return;
        }
        setActiveView("inbox");
        selectInboxItem(item.id);
        return;
      }
      if (!ev) {
        pushToast("该时间线事件已不存在", "warning");
        return;
      }
      setActiveView("timeline");
      selectTimelineEvent(ev.id);
    };

    return (
      <span
        key={key}
        data-inline-interactive="true"
        className={`mx-1 inline-flex items-center overflow-hidden rounded-[6px] border align-baseline text-[12px] leading-[16px] transition-colors ${
          isInbox
            ? "border-[var(--amber-border)] bg-[var(--amber-bg)] text-[var(--amber-text)] hover:border-[var(--amber-pill)]"
            : "border-[var(--border-control)] bg-[var(--bg-subtle)] text-[var(--ink-strong)] hover:border-[var(--border-strong)]"
        }`}
      >
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            navigate();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" || e.key === "Delete") {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
          title={
            isInbox
              ? item
                ? `点击跳转到收件箱：${item.title}`
                : "该收件箱事项已清理"
              : ev
                ? `点击跳转到时间线：${ev.title}`
                : "该时间线事件已不存在"
          }
          className="inline-flex cursor-pointer items-center gap-1 px-2 py-[1px] transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:bg-[var(--bg-hover)]"
        >
          {isInbox ? <InboxIcon size={11} /> : <ClockIcon size={11} />}
          <span className="max-w-[180px] truncate font-medium">{label}</span>
          <span className="shrink-0 text-[11px] opacity-65">↗</span>
        </button>
        <button
          type="button"
          aria-label="移除引用"
          title="移除引用"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={`inline-flex cursor-pointer items-center self-stretch border-l px-1 opacity-75 transition-colors hover:bg-[var(--bg-hover)] hover:opacity-100 ${
            isInbox ? "border-[var(--amber-border)]" : "border-[var(--border-light)]"
          }`}
        >
          <CloseIcon size={10} />
        </button>
      </span>
    );
  };

  const renderInlineDisplay = (block: NotebookBlock) => {
    const segments = parseInlineNotebookText(block.content);
    if (segments.length === 0) {
      const placeholder =
        blocks.length === 1 || (focusedBlockId === null && block.id === blocks[blocks.length - 1]?.id)
          ? "输入笔记，键入 / 插入 Markdown 块，或输入 @valet 发起新会话…"
          : "";
      return (
        <span data-placeholder-text="true" className="text-[var(--ink-subtle)] select-none">
          {placeholder || "\u00A0"}
        </span>
      );
    }

    let refIdx = 0;
    return segments.map((seg, i) => {
      switch (seg.kind) {
        case "bold":
          return (
            <strong key={i} className="font-semibold text-[var(--ink-strong)]">
              {seg.text}
            </strong>
          );
        case "italic":
          return (
            <em key={i} className="italic">
              {seg.text}
            </em>
          );
        case "strike":
          return (
            <del key={i} className="text-[var(--ink-muted)] line-through">
              {seg.text}
            </del>
          );
        case "code":
          return (
            <code
              key={i}
              className="mx-0.5 rounded-[5px] border border-[var(--border-light)] bg-[var(--bg-code)] px-1.5 py-[1px] font-mono text-[12px] text-[var(--ink-strong)]"
            >
              {seg.text}
            </code>
          );
        case "link":
          return (
            <a
              key={i}
              data-inline-interactive="true"
              href={seg.href}
              target="_blank"
              rel="noreferrer"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--ink-strong)]"
            >
              {seg.label}
            </a>
          );
        case "session":
          return renderInlineRefChip(
            { kind: "session", id: seg.sessionId },
            block.id,
            refIdx++,
            i
          );
        case "inbox":
          return renderInlineRefChip(
            { kind: "inbox", id: seg.itemId },
            block.id,
            refIdx++,
            i
          );
        case "timeline":
          return renderInlineRefChip(
            { kind: "timeline", id: seg.eventId },
            block.id,
            refIdx++,
            i
          );
        case "text":
        default:
          return <React.Fragment key={i}>{seg.text}</React.Fragment>;
      }
    });
  };

  const renderEditableTextOrDisplay = (block: NotebookBlock, blockIndex: number) => {
    const isFocused = focusedBlockId === block.id;
    const typoClass = getEditableTypographyClass(block.type, block.checked);
    const { editableText, refs } = splitInlineRefs(block.content);

    const showFormatToolbar =
      isFocused &&
      textSelection?.blockId === block.id &&
      textSelection.start !== textSelection.end;

    if (isFocused) {
      return (
        <div className="relative w-full">
          {showFormatToolbar && (
            <NotebookFormatToolbar
              onFormat={(kind) => applyInlineFormat(block, kind)}
            />
          )}
          <textarea
            ref={(el) => {
              blockTextareaRefs.current[block.id] = el;
            }}
            rows={1}
            value={editableText}
            onChange={(e) =>
              handleBlockChange(
                block,
                e.target.value,
                e.target.selectionStart ?? e.target.value.length
              )
            }
            onPaste={(e) => handleBlockPaste(e, block, blockIndex)}
            onSelect={(e) => {
              const targetEl = e.currentTarget;
              const start = targetEl.selectionStart ?? 0;
              const end = targetEl.selectionEnd ?? 0;
              setTextSelection((cur) => {
                if (start === end) return cur?.blockId === block.id ? null : cur;
                if (
                  cur &&
                  cur.blockId === block.id &&
                  cur.start === start &&
                  cur.end === end
                ) {
                  return cur;
                }
                return { blockId: block.id, start, end };
              });
            }}
            onCompositionEnd={() => {
              lastCompositionEndRef.current = performance.now();
            }}
            onKeyDown={(e) => handleTextareaKeyDown(e, block, blockIndex)}
            onBlur={() => {
              // Keep focusedBlockId briefly so clicks inside popovers don't flicker
              window.setTimeout(() => {
                setFocusedBlockId((cur) => {
                  if (cur !== block.id) return cur;
                  const activeEl = document.activeElement;
                  if (activeEl === blockTextareaRefs.current[block.id]) return cur;
                  setTextSelection((sel) => (sel?.blockId === block.id ? null : sel));
                  return null;
                });
              }, 120);
            }}
            placeholder={
              refs.length > 0
                ? "输入内容…（按 Backspace 可整块删除引用）"
                : block.type === "paragraph"
                  ? "输入内容，键入 / 插入块，或 @valet 新建会话…"
                  : "输入内容…"
            }
            className={`w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-[var(--ink-subtle)] ${typoClass}`}
          />
          {refs.length > 0 && (
            <div
              className="mt-1 flex flex-wrap items-center gap-1"
              data-inline-interactive="true"
            >
              {refs.map((ref, refIdx) =>
                renderInlineRefChip(
                  ref,
                  block.id,
                  refIdx,
                  `${ref.kind}-${ref.id}-${refIdx}`
                )
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        role="textbox"
        tabIndex={0}
        onClick={(e) => {
          if (suppressNextClickRef.current) return;
          if ((e.target as HTMLElement).closest("[data-inline-interactive]")) {
            return;
          }
          if (e.shiftKey || (e.metaKey || e.ctrlKey) && selectedBlockIdsRef.current.length > 0) {
            return;
          }
          const renderedOffset = getClickedRenderedOffset(
            e.currentTarget,
            e.clientX,
            e.clientY
          );
          const targetOffset =
            renderedOffset !== null
              ? mapRenderedOffsetToRawOffset(editableText, renderedOffset)
              : editableText.length;
          focusBlockAt(block.id, targetOffset);
        }}
        onFocus={(e) => {
          if (
            e.target !== e.currentTarget ||
            suppressNextClickRef.current ||
            selectedBlockIdsRef.current.length > 0 ||
            dragSessionRef.current?.active
          ) {
            return;
          }
          focusBlockAt(block.id, editableText.length);
        }}
        className={`min-h-[24px] w-full cursor-text whitespace-pre-wrap break-words ${typoClass}`}
      >
        {renderInlineDisplay(block)}
      </div>
    );
  };

  const handleBlockMouseDown = (
    e: React.MouseEvent<HTMLDivElement>,
    block: NotebookBlock
  ) => {
    if (e.button !== 0 || isSelectionInteractiveTarget(e.target)) return;

    if (e.shiftKey) {
      e.preventDefault();
      const anchorId =
        selectionAnchorIdRef.current ?? focusedBlockIdRef.current ?? block.id;
      selectBlockRange(anchorId, block.id);
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && selectedBlockIdsRef.current.length > 0) {
      e.preventDefault();
      const cur = selectedBlockIdsRef.current;
      const next = cur.includes(block.id)
        ? cur.filter((id) => id !== block.id)
        : blocksRef.current
            .map((b) => b.id)
            .filter((id) => cur.includes(id) || id === block.id);
      selectionAnchorIdRef.current = next[0] ?? null;
      selectionHeadIdRef.current = next[next.length - 1] ?? null;
      setSelectedBlockIds(next);
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
      return;
    }

    const sc = findScrollContainer(editorRootRef.current);
    dragSessionRef.current = {
      mode: "block-cross",
      anchorBlockId: block.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollTop: sc?.scrollTop ?? 0,
      scrollContainer: sc,
      active: false,
    };
  };

  const handleSurfaceMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isSelectionInteractiveTarget(e.target)) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-block-id]") || target.closest('[data-notebook-header="true"]')) {
      return;
    }

    const sc = findScrollContainer(editorRootRef.current);
    dragSessionRef.current = {
      mode: "marquee",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollTop: sc?.scrollTop ?? 0,
      scrollContainer: sc,
      active: false,
    };
  };

  return (
    <div
      ref={editorRootRef}
      data-notebook-editor="true"
      onMouseDown={handleSurfaceMouseDown}
      className={`min-h-full w-full ${isDraggingSelection ? "select-none" : ""}`}
    >
      {marqueeRect && marqueeRect.width > 2 && marqueeRect.height > 2 && (
        <div
          aria-hidden="true"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
          className="pointer-events-none fixed z-30 rounded-[4px] border border-[var(--ink-primary)]/45 bg-[var(--ink-primary)]/10"
        />
      )}

      <div
        className="mx-auto w-full max-w-[760px] px-10 pt-7 pb-28 lg:px-14"
        onClick={(e) => {
          if (suppressNextClickRef.current || e.target !== e.currentTarget) return;
          clearBlockSelection();
          const last = blocks[blocks.length - 1];
          if (last && last.type === "paragraph" && last.content === "") {
            focusBlockAt(last.id, 0);
          }
        }}
      >
        <datalist id="valet-code-languages">
          {CODE_LANGUAGES.map((lang) => (
            <option key={lang} value={lang} />
          ))}
        </datalist>

        <div data-notebook-header="true">
          {/* Utility Actions Strip */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--ink-muted)]">
        <button
          type="button"
          onClick={() => exportProjectMarkdownFile(project, projectThreads)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
        >
          <DownloadIcon size={12} />
          <span>导出 Markdown</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const md = blocksToMarkdown(project, projectThreads);
            void copyTextToClipboard(md).then((ok) => {
              pushToast(
                ok ? "已复制 Notebook Markdown" : "复制失败，请检查剪贴板权限",
                ok ? "success" : "warning"
              );
            });
          }}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
        >
          <CopyIconSvg size={12} />
          <span>复制 Markdown</span>
        </button>

        <button
          type="button"
          onClick={handleOpenInlineValetAtEndOrFocused}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-subtle)] px-2.5 py-1 font-medium text-[var(--ink-strong)] transition-colors hover:border-[var(--border-strong)]"
        >
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)]">
            <BowtieSvg size={9} />
          </span>
          <span>@valet 发起新会话</span>
        </button>
      </div>

      {/* Document Title */}
      <input
        type="text"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitle}
        {...headerIme.compositionProps}
        onKeyDown={(e) => {
          if (headerIme.shouldIgnoreEnter(e)) return;
          if (e.key === "Enter") {
            e.preventDefault();
            commitTitle();
            if (blocks[0] && !NON_TEXT_BLOCK_TYPES.has(blocks[0].type)) {
              focusBlockAt(blocks[0].id, 0);
            }
          }
        }}
        placeholder="无标题项目"
        className="w-full bg-transparent font-[family-name:var(--font-serif-zh)] text-[30px] font-semibold leading-[40px] tracking-[-0.02em] text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)] lg:text-[32px] lg:leading-[44px]"
      />

      {/* Subtitle / Description */}
      <input
        type="text"
        value={descDraft}
        onChange={(e) => setDescDraft(e.target.value)}
        onBlur={commitDescription}
        {...headerIme.compositionProps}
        onKeyDown={(e) => {
          if (headerIme.shouldIgnoreEnter(e)) return;
          if (e.key === "Enter") {
            e.preventDefault();
            commitDescription();
            e.currentTarget.blur();
          }
        }}
        placeholder="添加项目背景、目标或约束说明…"
        className="mt-1.5 w-full bg-transparent text-[13.5px] leading-[20px] text-[var(--ink-muted)] outline-none placeholder:text-[var(--ink-subtle)]"
      />

      {/* Compact Notion Properties Strip */}
      <div className="mt-4 flex flex-col gap-2 border-b border-[var(--border-light)] pb-4 text-[12px]">
        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[var(--ink-subtle)]">关联会话</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setProjectTab("sessions")}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--ink-strong)] hover:border-[var(--border-strong)]"
            >
              <span>{projectThreads.length} 个会话</span>
              <span className="text-[var(--ink-subtle)]">→</span>
            </button>
            {runningCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--ink-strong)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-primary)]" />
                {runningCount} 进行中
              </span>
            )}
            {pendingInboxCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--amber-border)] bg-[var(--amber-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--amber-text)]">
                {pendingInboxCount} 待你确认
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[var(--ink-subtle)]">标签</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {project.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--border-light)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] text-[var(--ink-secondary)]"
              >
                <span>{tag}</span>
                <button
                  type="button"
                  onClick={() =>
                    updateProject(project.id, {
                      tags: project.tags.filter((t) => t !== tag),
                    })
                  }
                  className="cursor-pointer text-[10px] text-[var(--ink-subtle)] hover:text-[var(--ink-strong)]"
                  title="移除标签"
                >
                  ×
                </button>
              </span>
            ))}

            {addingTag ? (
              <input
                type="text"
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={handleAddTag}
                {...headerIme.compositionProps}
                onKeyDown={(e) => {
                  if (headerIme.shouldIgnoreEnter(e)) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  } else if (e.key === "Escape") {
                    setAddingTag(false);
                    setTagDraft("");
                  }
                }}
                placeholder="输入标签…"
                className="h-[22px] w-24 rounded-[6px] border border-[var(--ink-primary)] bg-[var(--bg-canvas)] px-2 text-[11px] text-[var(--ink-strong)] outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingTag(true)}
                className="cursor-pointer rounded-[6px] px-1.5 py-0.5 text-[11px] text-[var(--ink-subtle)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
              >
                + 添加标签
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[var(--ink-subtle)]">工作目录</span>
          <input
            type="text"
            value={workingDirDraft}
            onChange={(e) => setWorkingDirDraft(e.target.value)}
            onBlur={commitWorkingDir}
            {...headerIme.compositionProps}
            onKeyDown={(e) => {
              if (headerIme.shouldIgnoreEnter(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                commitWorkingDir();
                e.currentTarget.blur();
              }
            }}
            placeholder="~/Projects/... (可选)"
            className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-[var(--ink-secondary)] outline-none placeholder:text-[var(--ink-subtle)]"
          />
        </div>
      </div>
      </div>

      {/* Block Editor Body */}
      <div className="mt-5 flex flex-col gap-1.5">
        {blocks.map((block, idx) => {
          const isInlineComposerActive = valetComposerState?.blockId === block.id;
          const isMentionOpen = mentionState?.blockId === block.id;
          const isSlashOpen = slashState?.blockId === block.id;
          const isHighlighted = highlightedBlockId === block.id;
          const isSelectedBlock = selectedBlockIdSet.has(block.id);
          const isDragTarget = dragOverBlockId === block.id;
          const indent = clampBlockIndent(block.type, block.indent);
          const indentable = isIndentableBlockType(block.type);
          const prevBlock = idx > 0 ? blocks[idx - 1] : undefined;
          const maxAllowedIndent =
            indentable && prevBlock && isIndentableBlockType(prevBlock.type)
              ? Math.min(6, clampBlockIndent(prevBlock.type, prevBlock.indent) + 1)
              : 0;
          const bulletMod = indent % 3;

          return (
            <div
              key={block.id}
              data-block-id={block.id}
              style={indent > 0 ? { marginLeft: indent * 24 } : undefined}
              onMouseDown={(e) => handleBlockMouseDown(e, block)}
              onDragOver={(e) => {
                if (!draggedBlockId || draggedBlockId === block.id) return;
                e.preventDefault();
                setDragOverBlockId(block.id);
              }}
              onDragLeave={() => {
                setDragOverBlockId((cur) => (cur === block.id ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedBlockId) {
                  reorderBlocks(draggedBlockId, block.id);
                }
                setDraggedBlockId(null);
                setDragOverBlockId(null);
              }}
              className={`group/block relative rounded-[8px] px-1 py-0.5 transition-colors ${
                isSelectedBlock
                  ? "bg-[var(--ink-primary)]/[0.11] ring-1 ring-inset ring-[var(--ink-primary)]/25"
                  : isHighlighted
                    ? "bg-[var(--bg-subtle)]/90 ring-2 ring-[var(--ink-primary)]/35"
                    : ""
              } ${isDragTarget ? "border-t-2 border-[var(--ink-primary)]" : ""}`}
            >
              {/* Subtle vertical indentation guides for nested blocks */}
              {indent > 0 &&
                Array.from({ length: indent }, (_, lvl) => (
                  <span
                    key={lvl}
                    aria-hidden="true"
                    style={{ left: -((indent - lvl) * 24 - 10) }}
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--border-light)]/80"
                  />
                ))}

              {/* Left Block Gutter (+ insert / ⋮⋮ block menu & drag) */}
              <div
                data-block-gutter="true"
                className="absolute top-[5px] -left-11 flex w-10 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/block:opacity-100 focus-within:opacity-100"
              >
                <button
                  type="button"
                  title="在下方插入块或 @valet"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMentionState(null);
                    setBlockMenuId(null);
                    setSlashState({ blockId: block.id, mode: "insert_after", query: "" });
                  }}
                  className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-[5px] text-[var(--ink-subtle)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                >
                  <PlusIcon size={12} />
                </button>
                <button
                  type="button"
                  draggable
                  title="拖拽排序 / 块菜单 (⇧点击或⌘点击可多选)"
                  onDragStart={() => setDraggedBlockId(block.id)}
                  onDragEnd={() => {
                    setDraggedBlockId(null);
                    setDragOverBlockId(null);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) {
                      const anchorId =
                        selectionAnchorIdRef.current ?? focusedBlockIdRef.current ?? block.id;
                      selectBlockRange(anchorId, block.id);
                      return;
                    }
                    if (e.metaKey || e.ctrlKey) {
                      const cur = selectedBlockIdsRef.current;
                      const next = cur.includes(block.id)
                        ? cur.filter((id) => id !== block.id)
                        : blocksRef.current
                            .map((b) => b.id)
                            .filter((id) => cur.includes(id) || id === block.id);
                      selectionAnchorIdRef.current = next[0] ?? null;
                      selectionHeadIdRef.current = next[next.length - 1] ?? null;
                      setSelectedBlockIds(next);
                      return;
                    }
                    setBlockMenuId((cur) => (cur === block.id ? null : block.id));
                  }}
                  className="flex h-5 w-5 cursor-grab items-center justify-center rounded-[5px] text-[var(--ink-subtle)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)] active:cursor-grabbing"
                >
                  <GripDotsIcon size={12} />
                </button>
              </div>

              {/* Block Action Popover Menu */}
              {blockMenuId === block.id && (
                <div
                  data-block-menu="true"
                  onMouseDown={(e) => e.stopPropagation()}
                  className="animate-valet-modal-in absolute top-7 -left-10 z-50 w-56 overflow-hidden rounded-[10px] border border-[var(--border-control)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-popover)]"
                >
                  {!NON_TEXT_BLOCK_TYPES.has(block.type) && (
                    <>
                      <div className="px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
                        转换为
                      </div>
                      <div className="max-h-[210px] overflow-y-auto">
                        {CONVERT_OPTIONS.map((opt) => {
                          const current = block.type === opt.type;
                          return (
                            <button
                              key={opt.type}
                              type="button"
                              onClick={() => {
                                setBlockMenuId(null);
                                convertBlockType(block.id, opt.type);
                                focusBlockAt(block.id, getBlockEditableLength(block));
                              }}
                              className={`flex w-full cursor-pointer items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-[12px] ${
                                current
                                  ? "bg-[var(--bg-muted)] font-medium text-[var(--ink-strong)]"
                                  : "text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                              }`}
                            >
                              <span>{opt.label}</span>
                              {current && <CheckIcon size={11} />}
                            </button>
                          );
                        })}
                      </div>
                      <div className="my-1 border-t border-[var(--border-light)]" />
                    </>
                  )}
                  {indentable && (indent < maxAllowedIndent || indent > 0) && (
                    <>
                      {indent < maxAllowedIndent && (
                        <button
                          type="button"
                          onClick={() => {
                            setBlockMenuId(null);
                            indentBlock(block.id, 1);
                          }}
                          className="flex w-full cursor-pointer items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                        >
                          <span>增加缩进</span>
                          <span className="font-mono text-[10px] text-[var(--ink-subtle)]">Tab</span>
                        </button>
                      )}
                      {indent > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setBlockMenuId(null);
                            indentBlock(block.id, -1);
                          }}
                          className="flex w-full cursor-pointer items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                        >
                          <span>减少缩进</span>
                          <span className="font-mono text-[10px] text-[var(--ink-subtle)]">⇧Tab</span>
                        </button>
                      )}
                      <div className="my-1 border-t border-[var(--border-light)]" />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setBlockMenuId(null);
                      const newBlk: NotebookBlock = {
                        id: makeBlockId("blk"),
                        type: "paragraph",
                        content: "",
                      };
                      const next = [...blocks];
                      next.splice(idx + 1, 0, newBlk);
                      commitBlocks(next);
                      setValetComposerState({ blockId: newBlk.id, beforeText: "", afterText: "" });
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-strong)] hover:bg-[var(--bg-subtle)]"
                  >
                    <BowtieSvg size={11} />
                    <span>在下方插入 @valet 会话</span>
                  </button>
                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setBlockMenuId(null);
                        moveBlock(block.id, -1);
                      }}
                      className="flex w-full cursor-pointer items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                    >
                      <span>上移一块</span>
                      <span className="font-mono text-[10px] text-[var(--ink-subtle)]">⌘⇧↑</span>
                    </button>
                  )}
                  {idx < blocks.length - 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setBlockMenuId(null);
                        moveBlock(block.id, 1);
                      }}
                      className="flex w-full cursor-pointer items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                    >
                      <span>下移一块</span>
                      <span className="font-mono text-[10px] text-[var(--ink-subtle)]">⌘⇧↓</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setBlockMenuId(null);
                      duplicateBlock(block.id);
                    }}
                    className="flex w-full cursor-pointer items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                  >
                    <span>复制块</span>
                    <span className="font-mono text-[10px] text-[var(--ink-subtle)]">⌘D</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBlockMenuId(null);
                      deleteBlock(block.id);
                    }}
                    className="flex w-full cursor-pointer rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--danger-fg,#c53030)] hover:bg-[var(--bg-subtle)]"
                  >
                    删除块
                  </button>
                </div>
              )}

              {/* Block Body */}
              {isInlineComposerActive && valetComposerState ? (
                <div data-valet-composer="true" className="my-1.5 flex flex-col gap-2">
                  {(valetComposerState.beforeText.trim() || valetComposerState.afterText.trim()) && (
                    <div className="text-[14px] leading-[22px] text-[var(--ink-body)]">
                      {valetComposerState.beforeText}
                      <span className="mx-1 rounded-[5px] bg-[var(--brand-icon-bg)] px-1.5 py-[1px] font-mono text-[11px] font-medium text-[var(--brand-icon-fg)]">
                        @valet
                      </span>
                      {valetComposerState.afterText}
                    </div>
                  )}
                  <InlineValetComposer
                    onCancel={() => {
                      const existingRefs = valetComposerState.existingRefs ?? [];
                      const mergedText = `${valetComposerState.beforeText}${valetComposerState.afterText}`;
                      const restored = joinTextWithInlineRefs(mergedText, existingRefs);
                      updateBlockContentOrProps(block.id, { content: restored });
                      setValetComposerState(null);
                      focusBlockAt(block.id, mergedText.length);
                    }}
                    onSubmit={async ({ prompt, model, includeNotebookContext }) => {
                      const created = await spawnSessionFromNotebook({
                        projectId: project.id,
                        prompt,
                        model,
                        includeNotebookContext,
                        originBlockId: block.id,
                        originSection: findNearestHeading(blocks, idx),
                        originBeforeText: valetComposerState.beforeText,
                        originAfterText: valetComposerState.afterText,
                        openImmediately: false,
                      });
                      if (!created) return;

                      const { beforeText, afterText, existingRefs = [] } = valetComposerState;
                      const next = [...blocksRef.current];
                      const curIdx = next.findIndex((b) => b.id === block.id);
                      if (curIdx === -1) {
                        setValetComposerState(null);
                        return;
                      }

                      if (!beforeText.trim() && !afterText.trim() && existingRefs.length === 0) {
                        next[curIdx] = {
                          id: block.id,
                          type: "session_ref",
                          sessionId: created.id,
                          content: created.title,
                          summary: prompt,
                        };
                        if (curIdx === next.length - 1) {
                          next.push({
                            id: makeBlockId("blk"),
                            type: "paragraph",
                            content: "",
                          });
                        }
                      } else {
                        const cleanAfter = afterText.trimStart();
                        const mergedText = cleanAfter
                          ? `${beforeText}${cleanAfter}`
                          : beforeText.replace(/ $/, "");
                        next[curIdx] = {
                          ...next[curIdx]!,
                          content: joinTextWithInlineRefs(mergedText, [
                            ...existingRefs,
                            { raw: `[[session:${created.id}]]` },
                          ]),
                        };
                      }
                      commitBlocks(next);
                      setValetComposerState(null);
                      pushToast(`已发起会话「${created.title}」并插入引用`, "success");
                    }}
                  />
                </div>
              ) : block.type === "session_ref" ? (
                <div className="my-1.5">
                  <SessionRefBlockCard
                    sessionId={block.sessionId ?? ""}
                    fallbackTitle={block.content}
                    fallbackSummary={block.summary}
                    onRemove={() => deleteBlock(block.id)}
                  />
                </div>
              ) : block.type === "divider" ? (
                <div className="group/div relative py-2.5">
                  <hr className="border-[var(--border-light)]" />
                  <button
                    type="button"
                    onClick={() => deleteBlock(block.id)}
                    title="删除分割线"
                    className="hidden cursor-pointer rounded-[5px] border border-[var(--border-control)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)] group-hover/div:inline-flex"
                    style={{ position: "absolute", right: 0, top: 2 }}
                  >
                    删除分割线
                  </button>
                </div>
              ) : block.type === "code" ? (
                <div className="my-1.5 overflow-hidden rounded-[10px] border border-[var(--border-card)] bg-[var(--bg-code)]">
                  <div className="flex items-center justify-between border-b border-[var(--border-light)] px-3 py-1.5">
                    <input
                      type="text"
                      list="valet-code-languages"
                      data-block-lang-input={block.id}
                      value={block.language ?? "bash"}
                      onChange={(e) =>
                        updateBlockContentOrProps(
                          block.id,
                          { language: e.target.value },
                          { coalesceKey: `lang-${block.id}` }
                        )
                      }
                      aria-label="代码块语言"
                      className="w-28 bg-transparent font-mono text-[11px] text-[var(--ink-muted)] outline-none focus:text-[var(--ink-strong)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void copyTextToClipboard(block.content).then((ok) => {
                          pushToast(
                            ok ? "已复制代码片段" : "复制失败，请手动选中复制",
                            ok ? "success" : "warning"
                          );
                        });
                      }}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-[5px] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                    >
                      <CopyIconSvg size={11} />
                      <span>复制</span>
                    </button>
                  </div>
                  <textarea
                    ref={(el) => {
                      blockTextareaRefs.current[block.id] = el;
                    }}
                    rows={Math.max(2, block.content.split("\n").length)}
                    value={block.content}
                    onFocus={() => {
                      clearBlockSelection();
                      setFocusedBlockId(block.id);
                    }}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setFocusedBlockId((cur) => {
                          if (cur !== block.id) return cur;
                          const activeEl = document.activeElement;
                          if (activeEl === blockTextareaRefs.current[block.id]) return cur;
                          return null;
                        });
                      }, 120);
                    }}
                    onChange={(e) =>
                      handleBlockChange(
                        block,
                        e.target.value,
                        e.target.selectionStart ?? e.target.value.length
                      )
                    }
                    onKeyDown={(e) => handleTextareaKeyDown(e, block, idx)}
                    placeholder="输入命令或代码… (Tab 缩进，⌘Enter / Shift+Enter 跳至下一块)"
                    spellCheck={false}
                    className="w-full resize-none bg-transparent px-3.5 py-2.5 font-mono text-[12.5px] leading-[20px] text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)]"
                  />
                </div>
              ) : block.type === "callout" ? (
                <div className="my-1 flex items-start gap-2.5 rounded-[10px] border border-[var(--border-card)] bg-[var(--bg-subtle)]/85 px-4 py-3">
                  <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-control)] bg-[var(--bg-surface)] font-mono text-[10px] font-semibold text-[var(--ink-muted)]">
                    i
                  </span>
                  <div className="min-w-0 flex-1">{renderEditableTextOrDisplay(block, idx)}</div>
                </div>
              ) : block.type === "quote" ? (
                <div className="my-0.5 border-l-[2.5px] border-[var(--border-strong)] pl-3.5">
                  {renderEditableTextOrDisplay(block, idx)}
                </div>
              ) : block.type === "todo" ? (
                <div className="flex items-start gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      updateBlockContentOrProps(block.id, { checked: !block.checked })
                    }
                    aria-label={block.checked ? "标记为未完成" : "标记为已完成"}
                    className={`mt-[4px] flex h-[15px] w-[15px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] border transition-colors ${
                      block.checked
                        ? "border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
                        : "border-[var(--border-strong)] bg-[var(--bg-surface)] hover:border-[var(--ink-primary)]"
                    }`}
                  >
                    {block.checked && <CheckIcon size={10} strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">{renderEditableTextOrDisplay(block, idx)}</div>
                </div>
              ) : block.type === "bullet" ? (
                <div className="flex items-start gap-2.5 pl-1">
                  {bulletMod === 0 ? (
                    <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--ink-secondary)]" />
                  ) : bulletMod === 1 ? (
                    <span className="mt-[9px] h-[5.5px] w-[5.5px] shrink-0 rounded-full border-[1.35px] border-[var(--ink-muted)]" />
                  ) : (
                    <span className="mt-[9.5px] h-[4.5px] w-[4.5px] shrink-0 rounded-[1px] bg-[var(--ink-muted)]" />
                  )}
                  <div className="min-w-0 flex-1">{renderEditableTextOrDisplay(block, idx)}</div>
                </div>
              ) : block.type === "numbered" ? (
                <div className="flex items-start gap-2 pl-0.5">
                  <span className="mt-[2px] min-w-[20px] shrink-0 font-mono text-[12.5px] text-[var(--ink-muted)]">
                    {numberedMarkers[block.id]?.label ?? "1."}
                  </span>
                  <div className="min-w-0 flex-1">{renderEditableTextOrDisplay(block, idx)}</div>
                </div>
              ) : (
                <div className={block.type === "h1" ? "mt-3" : block.type === "h2" ? "mt-2" : ""}>
                  {renderEditableTextOrDisplay(block, idx)}
                </div>
              )}

              {/* Anchored Popovers */}
              {isMentionOpen && mentionState && (
                <div data-popover="true">
                  <NotebookMentionPopover
                    projectId={project.id}
                    query={mentionState.query}
                    onSelect={handleMentionSelect}
                    onClose={() => setMentionState(null)}
                  />
                </div>
              )}

              {isSlashOpen && slashState && (
                <div data-popover="true">
                  <NotebookSlashPopover
                    query={slashState.query}
                    onSelect={handleSlashSelect}
                    onClose={() => setSlashState(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky Multi-Block Selection Toolbar */}
      {selectedBlockIds.length > 0 && (
        <NotebookSelectionBar
          count={selectedBlockIds.length}
          onConvert={handleConvertSelectedBlocks}
          onIndent={handleIndentSelectedBlocks}
          onCopy={handleCopySelectedBlocks}
          onDuplicate={handleDuplicateSelectedBlocks}
          onDelete={handleDeleteSelectedBlocks}
          onClear={clearBlockSelection}
        />
      )}

      {/* Bottom Notion Blank Space Click Target */}
      <div
        onClick={() => {
          if (suppressNextClickRef.current) return;
          clearBlockSelection();
          const last = blocks[blocks.length - 1];
          if (last && last.type === "paragraph" && last.content === "") {
            focusBlockAt(last.id, 0);
            return;
          }
          const nextPara: NotebookBlock = {
            id: makeBlockId("blk"),
            type: "paragraph",
            content: "",
          };
          commitBlocks([...blocks, nextPara]);
          focusBlockAt(nextPara.id, 0);
        }}
        className="mt-4 min-h-[120px] cursor-text"
      />
      </div>
    </div>
  );
};
