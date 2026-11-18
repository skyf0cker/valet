import React from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  size?: "sm" | "md";
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  size = "md",
}) => {
  const isSm = size === "sm";
  const trackSize = isSm ? "h-[18px] w-[30px]" : "h-[20px] w-[34px]";
  const thumbSize = isSm ? "h-3.5 w-3.5" : "h-4 w-4";
  const thumbTranslate = isSm
    ? checked
      ? "translate-x-[12px]"
      : "translate-x-0"
    : checked
      ? "translate-x-[14px]"
      : "translate-x-0";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className={`app-no-drag relative inline-flex ${trackSize} shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-primary)] ${
        checked ? "bg-[var(--switch-on-bg)]" : "bg-[var(--switch-off-bg)]"
      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      <span
        className={`${thumbSize} rounded-full shadow-xs transition-transform duration-150 ease-[var(--ease-valet)] ${
          checked ? "bg-[var(--switch-thumb-on)]" : "bg-[var(--switch-thumb-off)]"
        } ${thumbTranslate}`}
      />
    </button>
  );
};
