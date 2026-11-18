import React from "react";

interface DutyPulseProps {
  active?: boolean;
  size?: "sm" | "md";
}

export const DutyPulse: React.FC<DutyPulseProps> = ({ active = true, size = "sm" }) => {
  const outer = size === "md" ? "h-5 w-5" : "h-4 w-4";
  const dot = size === "md" ? "h-[9px] w-[9px]" : "h-[7px] w-[7px]";

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-full ${outer} ${
        active ? "bg-[var(--duty-halo)]" : "bg-[var(--amber-icon)]/15"
      }`}
    >
      {active && (
        <span
          className={`absolute rounded-full border border-[var(--duty-ring)] ${dot} animate-valet-pulse`}
        />
      )}
      <span
        className={`relative rounded-full ${dot} ${
          active ? "bg-[var(--duty-dot)]" : "bg-[var(--amber-icon)]"
        }`}
      />
    </span>
  );
};
