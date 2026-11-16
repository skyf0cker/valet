import React from "react";
import { CheckIcon } from "./Icons";

interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  size = "sm",
  disabled = false,
  ariaLabel,
}) => {
  const dim = size === "md" ? "h-4 w-4" : "h-[15px] w-[15px]";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className={`${dim} flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] transition-colors duration-120 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-primary)] ${
        checked
          ? "bg-[var(--ink-primary)] text-[var(--ink-on-primary)]"
          : "border-[1.5px] border-[var(--border-dash)] bg-transparent hover:border-[var(--ink-muted)]"
      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      {checked && <CheckIcon size={size === "md" ? 10 : 9} strokeWidth={3.6} />}
    </button>
  );
};
