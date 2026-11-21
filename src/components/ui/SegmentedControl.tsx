import React from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  widthClass?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: "surface" | "ink";
  size?: "sm" | "md";
  fullWidth?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = "surface",
  size = "sm",
  fullWidth = false,
}: SegmentedControlProps<T>) {
  const heightClass = size === "md" ? "h-[38px] rounded-[9px] p-[3px]" : "h-[28px] rounded-[7px] p-[2px]";

  return (
    <div
      role="tablist"
      className={`inline-flex shrink-0 items-center gap-[2px] bg-[var(--bg-muted)] ${heightClass} ${
        fullWidth ? "w-full" : ""
      }`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const radiusClass = size === "md" ? "rounded-[7px]" : "rounded-[5px]";
        const activeStyle =
          variant === "ink"
            ? "bg-[var(--ink-primary)] text-[var(--ink-on-primary)] font-semibold"
            : "bg-[var(--bg-segment-active)] text-[var(--ink-strong)] font-semibold shadow-[var(--shadow-segment)]";
        const idleStyle = "text-[var(--ink-muted)] hover:text-[var(--ink-strong)] font-normal";

        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`flex h-full cursor-pointer items-center justify-center gap-1.5 transition-all duration-150 ${radiusClass} ${
              fullWidth ? "flex-1" : opt.widthClass ?? "px-2.5"
            } ${size === "md" ? "text-[13px]" : "text-[12px]"} ${active ? activeStyle : idleStyle}`}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
