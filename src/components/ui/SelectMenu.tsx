import React, { useEffect, useRef, useState } from "react";
import { CheckIcon } from "./Icons";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface SelectMenuProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  mono?: boolean;
  align?: "left" | "right";
  compact?: boolean;
  triggerClassName?: string;
  triggerLabel?: string;
}

export const SelectMenu: React.FC<SelectMenuProps> = ({
  value,
  options,
  onChange,
  mono = false,
  align = "right",
  compact = true,
  triggerClassName = "",
  triggerLabel,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex cursor-pointer items-center gap-2 rounded-[7px] border border-[var(--border-control)] bg-[var(--bg-elevated)] px-2.5 text-[12px] text-[var(--ink-strong)] transition-colors hover:border-[var(--border-strong)] ${
          compact ? "h-[28px]" : "h-[34px]"
        } ${triggerClassName}`}
      >
        <span className={mono ? "font-mono text-[11px]" : ""}>
          {triggerLabel ?? active?.label ?? value}
        </span>
        <span className="text-[9px] text-[var(--ink-subtle)]">▾</span>
      </button>

      {open && (
        <div
          className={`animate-valet-modal-in absolute z-40 mt-1.5 min-w-[180px] rounded-[10px] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-popover)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                  selected
                    ? "bg-[var(--bg-muted)] font-semibold text-[var(--ink-strong)]"
                    : "text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
                }`}
              >
                <span className={mono ? "font-mono text-[11px]" : ""}>{opt.label}</span>
                <span className="flex items-center gap-1.5">
                  {opt.hint && (
                    <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                      {opt.hint}
                    </span>
                  )}
                  {selected && <CheckIcon size={11} strokeWidth={2.8} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
