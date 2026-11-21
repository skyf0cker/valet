import React from "react";
import type { InlineFormatKind } from "../../utils/notebookEditor";

interface NotebookFormatToolbarProps {
  onFormat: (kind: InlineFormatKind) => void;
}

const TOOLBAR_ACTIONS: Array<{
  kind: InlineFormatKind;
  label: string;
  title: string;
  className: string;
}> = [
  { kind: "bold", label: "B", title: "加粗 (⌘B)", className: "font-bold" },
  { kind: "italic", label: "I", title: "斜体 (⌘I)", className: "italic font-serif" },
  { kind: "strike", label: "S", title: "删除线 (⌘⇧S)", className: "line-through" },
  { kind: "code", label: "</>", title: "行内代码 (⌘E)", className: "font-mono text-[10.5px]" },
  { kind: "link", label: "链接", title: "添加/移除链接 (⌘K)", className: "text-[11px]" },
];

export const NotebookFormatToolbar: React.FC<NotebookFormatToolbarProps> = ({ onFormat }) => {
  return (
    <div
      role="toolbar"
      aria-label="文本格式化工具栏"
      onMouseDown={(e) => {
        // Keep focus & selection inside the active textarea when clicking toolbar buttons.
        e.preventDefault();
        e.stopPropagation();
      }}
      className="animate-valet-modal-in absolute -top-9 left-0 z-40 inline-flex items-center gap-0.5 rounded-[8px] border border-[var(--border-control)] bg-[var(--bg-elevated)] px-1 py-0.5 shadow-[var(--shadow-popover)]"
    >
      {TOOLBAR_ACTIONS.map((item) => (
        <button
          key={item.kind}
          type="button"
          title={item.title}
          onClick={() => onFormat(item.kind)}
          className={`flex h-6 min-w-[24px] cursor-pointer items-center justify-center rounded-[5px] px-1.5 text-[12px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)] ${item.className}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};
