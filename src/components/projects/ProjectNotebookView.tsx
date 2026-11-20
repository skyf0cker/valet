import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type {
  ChatThread,
  NotebookBlock,
  NotebookBlockType,
  Project,
} from "../../types/valet";
import {
  blocksToMarkdown,
  detectMarkdownShortcut,
  extractInlineRefs,
  findNearestHeading,
  joinTextWithInlineRefs,
  makeBlockId,
  parseInlineNotebookText,
  removeInlineRefAt,
  splitInlineRefs,
  type InlineRefToken,
} from "../../utils/notebook";
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
import {
  NotebookMentionPopover,
  NotebookSlashPopover,
  type MentionAction,
  type SlashBlockChoice,
} from "./NotebookMentionPopover";
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

  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
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

  const blockTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const pendingCursorPosRef = useRef<{ blockId: string; pos: number } | null>(null);
  const lastCompositionEndRef = useRef(0);
  const blocksRef = useRef<NotebookBlock[]>(project.blocks);
  blocksRef.current = project.blocks;

  // Reset local header drafts when switching projects or syncing remotely when unfocused
  useEffect(() => {
    setTitleDraft(project.title);
    setDescDraft(project.description ?? "");
    setWorkingDirDraft(project.workingDir ?? "");
    setFocusedBlockId(null);
    setMentionState(null);
    setSlashState(null);
    setValetComposerState(null);
    setBlockMenuId(null);
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

  // Auto-focus & resize active block textarea
  useEffect(() => {
    if (!focusedBlockId) return;
    const el = blockTextareaRefs.current[focusedBlockId];
    if (!el) return;
    el.focus();
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    const pending = pendingCursorPosRef.current;
    if (pending && pending.blockId === focusedBlockId) {
      const clamped = Math.max(0, Math.min(el.value.length, pending.pos));
      el.setSelectionRange(clamped, clamped);
      pendingCursorPosRef.current = null;
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

  const numberedIndices = useMemo(() => {
    const map: Record<string, number> = {};
    let counter = 0;
    for (const blk of blocks) {
      if (blk.type === "numbered") {
        counter += 1;
        map[blk.id] = counter;
      } else {
        counter = 0;
      }
    }
    return map;
  }, [blocks]);

  const commitBlocks = useCallback(
    (nextBlocks: NotebookBlock[]) => {
      const normalized =
        nextBlocks.length > 0
          ? nextBlocks
          : [{ id: makeBlockId("blk"), type: "paragraph" as const, content: "" }];
      updateProject(project.id, { blocks: normalized });
    },
    [project.id, updateProject]
  );

  const focusBlockAt = useCallback((blockId: string, cursorPos?: number) => {
    if (cursorPos !== undefined) {
      pendingCursorPosRef.current = { blockId, pos: cursorPos };
    }
    setFocusedBlockId(blockId);
  }, []);

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
    patch: Partial<NotebookBlock>
  ) => {
    const next = blocksRef.current.map((b) =>
      b.id === blockId ? { ...b, ...patch } : b
    );
    commitBlocks(next);
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
    const next = cur.filter((b) => b.id !== blockId);
    commitBlocks(next);
    const neighbor = next[Math.max(0, idx - 1)];
    if (neighbor && !NON_TEXT_BLOCK_TYPES.has(neighbor.type)) {
      focusBlockAt(neighbor.id, getBlockEditableLength(neighbor));
    } else {
      setFocusedBlockId(null);
    }
  };

  const moveBlock = (blockId: string, delta: -1 | 1) => {
    const cur = [...blocksRef.current];
    const idx = cur.findIndex((b) => b.id === blockId);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= cur.length) return;
    const [item] = cur.splice(idx, 1);
    cur.splice(target, 0, item!);
    commitBlocks(cur);
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
    commitBlocks(cur);
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
    commitBlocks(cur);
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
      updateBlockContentOrProps(block.id, { content: rawVal });
      setMentionState(null);
      setSlashState(null);
      return;
    }

    const existingRefs = extractInlineRefs(block.content);

    // 1. Live Markdown prefix conversion on paragraphs
    if (block.type === "paragraph") {
      const shortcut = detectMarkdownShortcut(rawVal);
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
          commitBlocks(next);
          focusBlockAt(nextPara.id, 0);
          return;
        }
        const next = cur.map((b) =>
          b.id === block.id
            ? {
                ...b,
                type: shortcut.type,
                content: joinTextWithInlineRefs(shortcut.content, existingRefs),
                checked: shortcut.checked,
                language: shortcut.language,
              }
            : b
        );
        commitBlocks(next);
        focusBlockAt(block.id, shortcut.content.length);
        return;
      }
    }

    // Persist normal text edit while preserving existing inline reference chips
    updateBlockContentOrProps(block.id, {
      content: joinTextWithInlineRefs(rawVal, existingRefs),
    });

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

    // 4. Typing `/...` at start of paragraph opens Slash Block Menu
    if (block.type === "paragraph" && existingRefs.length === 0) {
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
        commitBlocks(next);
        focusBlockAt(nextPara.id, 0);
        return;
      }
      const next = cur.map((b) =>
        b.id === blockId
          ? {
              ...b,
              type: chosenType,
              content: "",
              language: chosenType === "code" ? b.language || "bash" : undefined,
              checked: chosenType === "todo" ? false : undefined,
            }
          : b
      );
      commitBlocks(next);
      focusBlockAt(blockId, 0);
      return;
    }

    // mode === "insert_after"
    const newBlk: NotebookBlock = {
      id: makeBlockId("blk"),
      type: chosenType,
      content: "",
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
      commitBlocks(next);
      focusBlockAt(followPara.id, 0);
      return;
    }
    commitBlocks(next);
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

    // Popover window capture listener owns navigation/confirmation while open
    if (
      (mentionState?.blockId === block.id || slashState?.blockId === block.id) &&
      (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape")
    ) {
      return;
    }

    const el = e.currentTarget;
    const selStart = el.selectionStart ?? 0;
    const selEnd = el.selectionEnd ?? 0;

    if (block.type === "code") {
      if (e.key === "Enter" && e.shiftKey) {
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
      if (e.key === "Backspace" && block.content === "") {
        e.preventDefault();
        updateBlockContentOrProps(block.id, { type: "paragraph", language: undefined });
        focusBlockAt(block.id, 0);
      }
      return;
    }

    const { editableText, refs } = splitInlineRefs(block.content);

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (
        (block.type === "bullet" || block.type === "numbered" || block.type === "todo") &&
        editableText.trim() === "" &&
        refs.length === 0
      ) {
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
      const newBlk: NotebookBlock = {
        id: makeBlockId("blk"),
        type: continueType,
        content: after,
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
      pendingCursorPosRef.current = { blockId: block.id, pos: editableText.length };
      handleRemoveInlineRef(block.id, 0);
      return;
    }

    if (e.key === "Backspace" && selStart === 0 && selEnd === 0) {
      if (editableText === "" && refs.length > 0) {
        e.preventDefault();
        pendingCursorPosRef.current = { blockId: block.id, pos: 0 };
        handleRemoveInlineRef(block.id, refs.length - 1);
        return;
      }
      if (block.type !== "paragraph") {
        e.preventDefault();
        updateBlockContentOrProps(block.id, { type: "paragraph", checked: undefined });
        focusBlockAt(block.id, 0);
        return;
      }
      const cur = blocksRef.current;
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
          commitBlocks(next);
          focusBlockAt(prev.id, joinPos);
        }
      }
      return;
    }

    if (e.key === "ArrowUp" && selStart === 0 && selEnd === 0) {
      const cur = blocksRef.current;
      for (let i = blockIndex - 1; i >= 0; i--) {
        const candidate = cur[i];
        if (candidate && !NON_TEXT_BLOCK_TYPES.has(candidate.type)) {
          e.preventDefault();
          focusBlockAt(candidate.id, getBlockEditableLength(candidate));
          break;
        }
      }
      return;
    }

    if (e.key === "ArrowDown" && selStart === editableText.length && selEnd === selStart) {
      const cur = blocksRef.current;
      for (let i = blockIndex + 1; i < cur.length; i++) {
        const candidate = cur[i];
        if (candidate && !NON_TEXT_BLOCK_TYPES.has(candidate.type)) {
          e.preventDefault();
          focusBlockAt(candidate.id, 0);
          break;
        }
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
        <span className="text-[var(--ink-subtle)] select-none">
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

    if (isFocused) {
      return (
        <div className="w-full">
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
          if ((e.target as HTMLElement).closest("[data-inline-interactive]")) {
            return;
          }
          focusBlockAt(block.id, editableText.length);
        }}
        onFocus={(e) => {
          if (e.target !== e.currentTarget) return;
          focusBlockAt(block.id, editableText.length);
        }}
        className={`min-h-[24px] w-full cursor-text whitespace-pre-wrap break-words ${typoClass}`}
      >
        {renderInlineDisplay(block)}
      </div>
    );
  };

  return (
    <div
      className="mx-auto w-full max-w-[760px] px-10 pt-7 pb-28 lg:px-14"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const last = blocks[blocks.length - 1];
        if (last && last.type === "paragraph" && last.content === "") {
          focusBlockAt(last.id, 0);
        }
      }}
    >
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
            void navigator.clipboard.writeText(md);
            pushToast("已复制 Notebook Markdown", "success");
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
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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

      {/* Block Editor Body */}
      <div className="mt-5 flex flex-col gap-1.5">
        {blocks.map((block, idx) => {
          const isInlineComposerActive = valetComposerState?.blockId === block.id;
          const isMentionOpen = mentionState?.blockId === block.id;
          const isSlashOpen = slashState?.blockId === block.id;
          const isHighlighted = highlightedBlockId === block.id;
          const isDragTarget = dragOverBlockId === block.id;

          return (
            <div
              key={block.id}
              data-block-id={block.id}
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
                isHighlighted
                  ? "bg-[var(--bg-subtle)]/90 ring-2 ring-[var(--ink-primary)]/35"
                  : ""
              } ${isDragTarget ? "border-t-2 border-[var(--ink-primary)]" : ""}`}
            >
              {/* Left Block Gutter (+ insert / ⋮⋮ block menu & drag) */}
              <div className="absolute top-[5px] -left-11 flex w-10 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/block:opacity-100 focus-within:opacity-100">
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
                  title="拖拽排序 / 块菜单"
                  onDragStart={() => setDraggedBlockId(block.id)}
                  onDragEnd={() => {
                    setDraggedBlockId(null);
                    setDragOverBlockId(null);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
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
                  onMouseDown={(e) => e.stopPropagation()}
                  className="animate-valet-modal-in absolute top-7 -left-10 z-50 w-52 overflow-hidden rounded-[10px] border border-[var(--border-control)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-popover)]"
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
                                updateBlockContentOrProps(block.id, {
                                  type: opt.type,
                                  language:
                                    opt.type === "code" ? block.language || "bash" : undefined,
                                  checked: opt.type === "todo" ? Boolean(block.checked) : undefined,
                                });
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
                      className="flex w-full cursor-pointer rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                    >
                      上移一块
                    </button>
                  )}
                  {idx < blocks.length - 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setBlockMenuId(null);
                        moveBlock(block.id, 1);
                      }}
                      className="flex w-full cursor-pointer rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                    >
                      下移一块
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setBlockMenuId(null);
                      duplicateBlock(block.id);
                    }}
                    className="flex w-full cursor-pointer rounded-[6px] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                  >
                    复制块
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
                <div className="my-1.5 flex flex-col gap-2">
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
                      value={block.language ?? "bash"}
                      onChange={(e) =>
                        updateBlockContentOrProps(block.id, { language: e.target.value })
                      }
                      aria-label="代码块语言"
                      className="w-24 bg-transparent font-mono text-[11px] text-[var(--ink-muted)] outline-none focus:text-[var(--ink-strong)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(block.content);
                        pushToast("已复制代码片段", "success");
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
                    rows={2}
                    value={block.content}
                    onFocus={() => setFocusedBlockId(block.id)}
                    onChange={(e) =>
                      handleBlockChange(
                        block,
                        e.target.value,
                        e.target.selectionStart ?? e.target.value.length
                      )
                    }
                    onKeyDown={(e) => handleTextareaKeyDown(e, block, idx)}
                    placeholder="输入命令或代码… (Shift+Enter 跳至下一块)"
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
                  <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--ink-muted)]" />
                  <div className="min-w-0 flex-1">{renderEditableTextOrDisplay(block, idx)}</div>
                </div>
              ) : block.type === "numbered" ? (
                <div className="flex items-start gap-2 pl-0.5">
                  <span className="mt-[2px] min-w-[18px] shrink-0 font-mono text-[12.5px] text-[var(--ink-muted)]">
                    {numberedIndices[block.id] ?? 1}.
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
                <NotebookMentionPopover
                  projectId={project.id}
                  query={mentionState.query}
                  onSelect={handleMentionSelect}
                  onClose={() => setMentionState(null)}
                />
              )}

              {isSlashOpen && slashState && (
                <NotebookSlashPopover
                  query={slashState.query}
                  onSelect={handleSlashSelect}
                  onClose={() => setSlashState(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Notion Blank Space Click Target */}
      <div
        onClick={() => {
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
  );
};
