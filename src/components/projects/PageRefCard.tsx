import React from "react";
import { useValet } from "../../store/ValetContext";
import { getDirectChildPages, resolvePageRefTarget } from "../../utils/notebookPages";
import { BookOpenIcon, CloseIcon, FileTextIcon } from "../ui/Icons";

interface InlinePageChipProps {
  pageRefId: string;
  onRemove?: () => void;
}

export const InlinePageChip: React.FC<InlinePageChipProps> = ({
  pageRefId,
  onRemove,
}) => {
  const { state, selectProject, openProjectPage } = useValet();
  const target = resolvePageRefTarget(state.projects, pageRefId);
  const isMissing = !target;
  const label = target ? target.title : "已移除页面";

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!target) return;
    if (target.isRoot || !target.page) {
      selectProject(target.project.id, "notebook");
      return;
    }
    openProjectPage(target.project.id, target.page.id);
  };

  return (
    <span
      data-inline-interactive="true"
      className={`group/chip mx-0.5 inline-flex max-w-full align-baseline items-center gap-1 rounded-[5px] border px-1.5 py-[1px] text-[12px] leading-[1.35] transition-colors ${
        isMissing
          ? "border-dashed border-[var(--border-control)] bg-[var(--bg-subtle)] text-[var(--ink-subtle)]"
          : "border-[var(--border-control)] bg-[var(--bg-subtle)] text-[var(--ink-strong)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if ((e.key === "Backspace" || e.key === "Delete") && onRemove) {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }
        }}
        title={
          target
            ? target.isRoot
              ? `${target.project.title} · Notebook`
              : `${target.project.title} / ${target.title}`
            : "页面不存在或已删除"
        }
        className={`inline-flex min-w-0 items-center gap-1 text-left ${
          isMissing ? "cursor-default" : "cursor-pointer"
        }`}
      >
        {target?.isRoot ? (
          <BookOpenIcon size={11} className="shrink-0 text-[var(--ink-primary)]" />
        ) : (
          <FileTextIcon
            size={11}
            className={`shrink-0 ${
              isMissing ? "text-[var(--ink-subtle)]" : "text-[var(--ink-primary)]"
            }`}
          />
        )}
        <span className="max-w-[200px] truncate font-medium">{label}</span>
        {!isMissing && (
          <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">↗</span>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          title="移除引用"
          aria-label="移除引用"
          className="ml-0.5 hidden h-[14px] w-[14px] shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-[var(--ink-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)] group-hover/chip:inline-flex"
        >
          <CloseIcon size={9} />
        </button>
      )}
    </span>
  );
};

interface PageRefBlockCardProps {
  pageRefId: string;
  fallbackTitle?: string;
  onRemove?: () => void;
}

export const PageRefBlockCard: React.FC<PageRefBlockCardProps> = ({
  pageRefId,
  fallbackTitle,
  onRemove,
}) => {
  const { state, selectProject, openProjectPage } = useValet();
  const target = resolvePageRefTarget(state.projects, pageRefId);
  const isMissing = !target;

  const title = target
    ? target.title
    : fallbackTitle?.trim() || "已移除页面";

  const meta = (() => {
    if (!target) {
      return "页面不存在或已被删除";
    }
    if (target.isRoot || !target.page) {
      return `${target.project.title} · 项目 Notebook · ${target.project.blocks.length} 块`;
    }
    const childCount = getDirectChildPages(
      target.project.pages,
      target.page.id
    ).length;
    const parts = [target.project.title];
    if (childCount > 0) {
      parts.push(`${childCount} 个子页面`);
    }
    parts.push(`${target.page.blocks.length} 块`);
    return parts.join(" · ");
  })();

  const handleOpen = () => {
    if (!target) return;
    if (target.isRoot || !target.page) {
      selectProject(target.project.id, "notebook");
      return;
    }
    openProjectPage(target.project.id, target.page.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleOpen();
        } else if ((e.key === "Backspace" || e.key === "Delete") && onRemove) {
          e.preventDefault();
          onRemove();
        }
      }}
      className={`group flex w-full items-center justify-between gap-3 rounded-[10px] border px-3.5 py-2.5 text-left transition-colors ${
        isMissing
          ? "cursor-default border-dashed border-[var(--border-control)] bg-[var(--bg-subtle)]/50 opacity-75"
          : "cursor-pointer border-[var(--border-card)] bg-[var(--bg-subtle)]/65 hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-surface)] ${
            isMissing ? "text-[var(--ink-subtle)]" : "text-[var(--ink-primary)]"
          }`}
        >
          {target?.isRoot ? (
            <BookOpenIcon size={13.5} />
          ) : (
            <FileTextIcon size={13.5} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[var(--ink-strong)]">
            {title}
          </div>
          <div className="truncate text-[11px] text-[var(--ink-muted)]">
            {meta}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {!isMissing && (
          <span className="text-[11px] font-medium text-[var(--ink-muted)] transition-colors group-hover:text-[var(--ink-strong)]">
            打开页面 →
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="移除引用块"
            aria-label="移除引用块"
            className="hidden h-6 w-6 cursor-pointer items-center justify-center rounded-[5px] text-[var(--ink-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-strong)] group-hover:flex"
          >
            <CloseIcon size={11} />
          </button>
        )}
      </div>
    </div>
  );
};
