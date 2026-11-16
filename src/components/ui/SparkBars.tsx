import React from "react";

interface SparkBarsProps {
  values: number[];
  muted?: boolean;
  compact?: boolean;
}

export const SparkBars: React.FC<SparkBarsProps> = ({
  values,
  muted = false,
  compact = false,
}) => {
  const displayValues = compact ? values.slice(-7) : values;
  const maxVal = Math.max(1, ...displayValues);
  const maxHeightPx = compact ? 16 : 20;

  return (
    <div
      className={`flex shrink-0 items-end ${
        compact ? "h-[16px] w-[64px] gap-[2px]" : "h-[20px] w-[112px] gap-[3px]"
      }`}
      aria-hidden="true"
    >
      {displayValues.map((val, idx) => {
        const ratio = val / maxVal;
        const px = val <= 0 ? 2 : Math.max(2, Math.round(ratio * maxHeightPx));
        const isPeak = val > 0 && val === maxVal;
        const isHigh = val > 0 && ratio >= 0.65 && !isPeak;

        const bgClass = muted
          ? "bg-[var(--bg-track)]"
          : isPeak
            ? "bg-[var(--ink-primary)]"
            : isHigh
              ? "bg-[var(--spark-bar-active)]"
              : val <= 2
                ? "bg-[var(--bg-track)]"
                : "bg-[var(--spark-bar-muted)]";

        return (
          <span
            key={idx}
            className={`${compact ? "w-[5px]" : "w-[7px]"} shrink-0 rounded-[1px] transition-all duration-200 ${bgClass}`}
            style={{ height: `${px}px` }}
          />
        );
      })}
    </div>
  );
};
