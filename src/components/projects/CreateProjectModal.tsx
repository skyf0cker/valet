import React, { useEffect, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type { ProjectIconKind } from "../../types/valet";
import {
  BookOpenIcon,
  FolderIcon,
  SparklesIcon,
  TerminalIcon,
} from "../ui/Icons";
import { Modal } from "../ui/Modal";

const ICON_OPTIONS: Array<{
  id: ProjectIconKind;
  label: string;
  render: React.ReactNode;
}> = [
  { id: "book", label: "笔记", render: <BookOpenIcon size={15} /> },
  { id: "terminal", label: "终端", render: <TerminalIcon size={15} /> },
  { id: "folder", label: "目录", render: <FolderIcon size={15} /> },
  { id: "sparkles", label: "自动化", render: <SparklesIcon size={15} /> },
];

export const CreateProjectModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { createProject } = useValet();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [icon, setIcon] = useState<ProjectIconKind>("book");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setWorkingDir("");
      setTagsInput("");
      setIcon("book");
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const tags = tagsInput
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await createProject({
        title: trimmed,
        description: description.trim() || undefined,
        icon,
        tags,
        workingDir: workingDir.trim() || undefined,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建项目"
      subtitle="项目既是对话的管理容器，也是一个支持 Markdown 与 @valet 的 Notebook"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
            图标与项目名称
          </label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-[9px] border border-[var(--border-control)] bg-[var(--bg-subtle)] p-1">
              {ICON_OPTIONS.map((opt) => {
                const active = icon === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.label}
                    onClick={() => setIcon(opt.id)}
                    className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-[6px] transition-colors ${
                      active
                        ? "bg-[var(--bg-elevated)] text-[var(--ink-strong)] shadow-xs"
                        : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                    }`}
                  >
                    {opt.render}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：Mac 性能与存储治理"
              className="h-[38px] min-w-0 flex-1 rounded-[9px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[13px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
            简短说明（可选）
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="记录项目目标或排障范围…"
            className="h-[36px] rounded-[9px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[13px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
              工作目录（可选）
            </label>
            <input
              type="text"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              placeholder="~/Projects/..."
              className="h-[36px] rounded-[9px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 font-mono text-[12px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
              标签（空格或逗号分隔）
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="性能诊断, 自动化"
              className="h-[36px] rounded-[9px] border border-[var(--border-control)] bg-[var(--bg-canvas)] px-3 text-[12.5px] text-[var(--ink-strong)] outline-none focus:border-[var(--ink-primary)]"
            />
          </div>
        </div>

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-[34px] cursor-pointer rounded-[8px] border border-[var(--border-control)] px-3.5 text-[12px] font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className="h-[34px] cursor-pointer rounded-[8px] bg-[var(--ink-primary)] px-4 text-[12px] font-semibold text-[var(--ink-on-primary)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting ? "创建中…" : "创建并打开 Notebook"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
