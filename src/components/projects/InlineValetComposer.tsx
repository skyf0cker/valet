import React, { useEffect, useMemo, useRef, useState } from "react";
import { useValet } from "../../store/ValetContext";
import type { AutonomyLevel } from "../../types/valet";
import { BowtieSvg, CheckIcon } from "../ui/Icons";
import { SelectMenu } from "../ui/SelectMenu";

const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  always_ask: "敏感操作询问",
  auto_review: "Auto Review",
  full_access: "Full Access",
};

interface InlineValetComposerProps {
  initialPrompt?: string;
  onCancel: () => void;
  onSubmit: (params: {
    prompt: string;
    model: string;
    includeNotebookContext: boolean;
  }) => Promise<void>;
}

export const InlineValetComposer: React.FC<InlineValetComposerProps> = ({
  initialPrompt = "",
  onCancel,
  onSubmit,
}) => {
  const { state } = useValet();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [includeContext, setIncludeContext] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [model, setModel] = useState(
    () => state.preferences.models.primary || "claude-opus-4"
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastCompositionEndRef = useRef(0);

  const modelOptions = useMemo(() => {
    const activeProvider = state.providers.find(
      (p) => p.id === state.preferences.activeProviderId
    );
    const list =
      activeProvider?.models && activeProvider.models.length > 0
        ? activeProvider.models
        : [state.preferences.models.primary || "claude-opus-4"];
    const unique = Array.from(new Set([model, ...list].filter(Boolean)));
    return unique.map((m) => ({ value: m, label: m }));
  }, [model, state.preferences.activeProviderId, state.preferences.models.primary, state.providers]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(200, Math.max(46, el.scrollHeight))}px`;
  }, [prompt]);

  const handleConfirm = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        prompt: trimmed,
        model,
        includeNotebookContext: includeContext,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-valet-modal-in flex flex-col gap-2.5 rounded-[12px] border-[1.5px] border-[var(--ink-primary)] bg-[var(--bg-elevated)] px-4 py-3.5 shadow-[var(--shadow-composer)]">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--brand-icon-bg)] px-2 py-[3px] font-mono text-[11px] font-semibold leading-[14px] text-[var(--brand-icon-fg)]">
          <BowtieSvg size={11} />
          <span>@valet</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--ink-muted)]">
          新建项目会话 · 提交后将在本行替换为可点击引用
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 cursor-pointer font-mono text-[10.5px] text-[var(--ink-subtle)] hover:text-[var(--ink-strong)]"
        >
          Esc 取消
        </button>
      </div>

      {/* Prompt Input */}
      <textarea
        ref={textareaRef}
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onCompositionEnd={() => {
          lastCompositionEndRef.current = performance.now();
        }}
        onKeyDown={(e) => {
          if (
            e.nativeEvent.isComposing ||
            e.keyCode === 229 ||
            performance.now() - lastCompositionEndRef.current < 100
          ) {
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleConfirm();
          }
        }}
        placeholder="输入你想交给 Valet 执行或排查的任务，例如：扫描本机超过 1 GB 的冗余缓存并同步摘要回 Notebook…"
        className="w-full resize-none bg-transparent text-[14px] leading-[22px] text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)]"
      />

      {/* Bottom Action Bar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-light)] pt-2.5">
        <SelectMenu
          value={model}
          options={modelOptions}
          onChange={setModel}
          align="left"
          triggerClassName="h-[26px] rounded-[6px] border-0 bg-[var(--bg-subtle)] px-2 font-mono text-[11px] text-[var(--ink-body)]"
        />

        <button
          type="button"
          onClick={() => setIncludeContext((v) => !v)}
          className={`inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[6px] border px-2.5 text-[11px] font-medium transition-colors ${
            includeContext
              ? "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--ink-strong)]"
              : "border-[var(--border-light)] bg-transparent text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
          }`}
        >
          {includeContext && <CheckIcon size={10.5} strokeWidth={2.6} />}
          <span>携带当前 Notebook 上下文</span>
        </button>

        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-[6px] border border-[var(--amber-border)] bg-[var(--amber-bg)] px-2.5 text-[11px] font-medium text-[var(--amber-text)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--amber-icon)]" />
          <span>{AUTONOMY_LABEL[state.preferences.autonomyLevel] ?? "Auto Review"}</span>
        </span>

        <div className="flex-1" />

        <button
          type="button"
          disabled={!prompt.trim() || submitting}
          onClick={() => void handleConfirm()}
          className="inline-flex h-[30px] cursor-pointer items-center justify-center rounded-[8px] bg-[var(--ink-primary)] px-3.5 text-[12px] font-semibold text-[var(--ink-on-primary)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {submitting ? "创建中…" : "创建会话 ⏎"}
        </button>
      </div>
    </div>
  );
};
