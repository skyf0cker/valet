import React from "react";
import type { NotebookBlockType } from "../../types/valet";

interface NotebookSelectionBarProps {
  count: number;
  onConvert: (type: NotebookBlockType) => void;
  onIndent: (delta: 1 | -1) => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export const NotebookSelectionBar: React.FC<NotebookSelectionBarProps> = ({
  count,
  onConvert,
  onIndent,
  onCopy,
  onDuplicate,
  onDelete,
  onClear,
}) => {
  return (
    <div
      role="toolbar"
      aria-label="多块批量操作栏"
      data-notebook-toolbar="true"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="animate-valet-modal-in sticky bottom-5 z-40 mx-auto mt-4 flex w-fit flex-wrap items-center gap-0.5 rounded-[10px] border border-[var(--border-control)] bg-[var(--bg-elevated)] px-2 py-1 text-[11.5px] text-[var(--ink-secondary)] shadow-[var(--shadow-popover)]"
    >
      <span className="px-1.5 font-mono text-[11px] font-medium text-[var(--ink-strong)]">
        已选 {count} 块
      </span>

      <span className="mx-1 h-3.5 w-px bg-[var(--border-light)]" />

      <button
        type="button"
        title="全部转为正文段落 (⌘⌥0)"
        onClick={() => onConvert("paragraph")}
        className="cursor-pointer rounded-[6px] px-2 py-1 transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      >
        正文
      </button>
      <button
        type="button"
        title="全部转为待办 (⌘⌥4)"
        onClick={() => onConvert("todo")}
        className="cursor-pointer rounded-[6px] px-2 py-1 transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      >
        待办
      </button>
      <button
        type="button"
        title="全部转为无序列表 (⌘⌥5)"
        onClick={() => onConvert("bullet")}
        className="cursor-pointer rounded-[6px] px-2 py-1 transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      >
        列表
      </button>

      <span className="mx-1 h-3.5 w-px bg-[var(--border-light)]" />

      <button
        type="button"
        title="批量增加缩进 (Tab)"
        onClick={() => onIndent(1)}
        className="cursor-pointer rounded-[6px] px-2 py-1 transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      >
        缩进
      </button>
      <button
        type="button"
        title="批量减少缩进 (⇧Tab)"
        onClick={() => onIndent(-1)}
        className="cursor-pointer rounded-[6px] px-2 py-1 transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      >
        反缩进
      </button>

      <span className="mx-1 h-3.5 w-px bg-[var(--border-light)]" />

      <button
        type="button"
        title="复制选中块为 Markdown (⌘C)"
        onClick={onCopy}
        className="cursor-pointer rounded-[6px] px-2 py-1 transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      >
        复制
      </button>
      <button
        type="button"
        title="复制选中块 (⌘D)"
        onClick={onDuplicate}
        className="cursor-pointer rounded-[6px] px-2 py-1 transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      >
        创建副本
      </button>
      <button
        type="button"
        title="删除选中块 (Backspace / Delete)"
        onClick={onDelete}
        className="cursor-pointer rounded-[6px] px-2 py-1 text-[var(--danger-fg,#c53030)] transition-colors hover:bg-[var(--bg-subtle)]"
      >
        删除
      </button>

      <span className="mx-1 h-3.5 w-px bg-[var(--border-light)]" />

      <button
        type="button"
        aria-label="取消选择"
        title="取消选择 (Esc)"
        onClick={onClear}
        className="cursor-pointer rounded-[6px] px-1.5 py-1 text-[var(--ink-subtle)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      >
        ×
      </button>
    </div>
  );
};
