import React from "react";

interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
}

export const Slider: React.FC<SliderProps> = ({
  min,
  max,
  step = 1,
  value,
  onChange,
  ariaLabel,
}) => {
  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;

  return (
    <div className="relative flex h-5 w-full items-center">
      <div className="h-[3px] w-full overflow-hidden rounded-[2px] bg-[var(--bg-track)]">
        <div
          className="h-full bg-[var(--ink-primary)] transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        className="pointer-events-none absolute top-[2px] h-4 w-4 -translate-x-1/2 rounded-full border-2 border-[var(--ink-primary)] bg-[var(--bg-surface)] shadow-xs"
        style={{ left: `${pct}%` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
};
