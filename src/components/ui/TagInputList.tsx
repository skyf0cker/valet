import React, { useState } from "react";

interface TagInputListProps {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  mono?: boolean;
  removable?: boolean;
  addButtonLabel?: string;
}

export const TagInputList: React.FC<TagInputListProps> = ({
  items,
  onChange,
  placeholder = "输入后回车添加",
  mono = false,
  removable = true,
  addButtonLabel = "+ 添加",
}) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const val = draft.trim();
    if (val && !items.includes(val)) {
      onChange([...items, val]);
    }
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className={`inline-flex h-[24px] items-center gap-1 rounded-[6px] bg-[var(--bg-muted)] px-2 text-[11px] text-[var(--ink-strong)] ${
            mono ? "font-mono" : ""
          }`}
        >
          <span>{item}</span>
          {removable && (
            <button
              type="button"
              onClick={() => onChange(items.filter((i) => i !== item))}
              className="cursor-pointer text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              aria-label={`移除 ${item}`}
            >
              ✕
            </button>
          )}
        </span>
      ))}

      {adding ? (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          placeholder={placeholder}
          className={`h-[24px] w-36 rounded-[6px] border border-[var(--ink-primary)] bg-[var(--bg-canvas)] px-2 text-[11px] text-[var(--ink-strong)] outline-none ${
            mono ? "font-mono" : ""
          }`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-[24px] cursor-pointer items-center rounded-[6px] border border-dashed border-[var(--border-dash)] px-2 text-[11px] text-[var(--ink-strong)] transition-colors hover:border-[var(--ink-primary)]"
        >
          {addButtonLabel}
        </button>
      )}
    </div>
  );
};
