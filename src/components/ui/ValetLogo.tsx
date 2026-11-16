import React from "react";
import { BowtieSvg } from "./Icons";

interface ValetLogoProps {
  size?: "sm" | "md" | "lg";
  withWordmark?: boolean;
  nodTick?: number;
}

export const ValetLogo: React.FC<ValetLogoProps> = ({
  size = "md",
  withWordmark = true,
  nodTick = 0,
}) => {
  const boxClass =
    size === "lg"
      ? "h-[30px] w-[30px] rounded-[8px]"
      : size === "sm"
        ? "h-[26px] w-[26px] rounded-[7px]"
        : "h-[28px] w-[28px] rounded-[8px]";

  const iconSize = size === "lg" ? 18 : size === "sm" ? 17 : 18;
  const wordmarkClass =
    size === "lg"
      ? "text-[26px] leading-[32px]"
      : size === "sm"
        ? "text-[24px] leading-[30px]"
        : "text-[24px] leading-[30px]";

  return (
    <div className="flex items-center gap-[9px]">
      <div
        key={nodTick}
        className={`${boxClass} ${
          nodTick > 0 ? "animate-valet-nod" : ""
        } flex shrink-0 items-center justify-center border border-[var(--brand-icon-border)] bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)]`}
      >
        <BowtieSvg size={iconSize} />
      </div>
      {withWordmark && (
        <span
          className={`${wordmarkClass} font-[family-name:var(--font-serif-en)] italic tracking-[-0.01em] text-[var(--ink-strong)] select-none`}
        >
          Valet
        </span>
      )}
    </div>
  );
};
