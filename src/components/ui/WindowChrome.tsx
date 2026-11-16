import React from "react";
import { isMyGo } from "mygo-runtime";

/**
 * WindowChrome renders macOS traffic lights when previewing outside MyGo (e.g. Vite browser),
 * and reserves transparent draggable inset space inside a MyGo native window where native
 * traffic lights sit at (20, 20).
 */
export const WindowChrome: React.FC<{
  className?: string;
  paddedLeft?: boolean;
  compact?: boolean;
}> = ({ className = "", paddedLeft = false, compact = false }) => {
  const nativeWindow = isMyGo();

  if (nativeWindow) {
    return (
      <div
        className={`app-drag flex shrink-0 items-center ${className}`}
        style={{ height: "var(--mygo-titlebar-controls-bottom, 24px)" }}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      className={`app-drag flex shrink-0 items-center ${
        compact ? "h-[10px] gap-1" : `h-[14px] gap-2 ${paddedLeft ? "pl-[6px]" : ""}`
      } ${className}`}
      aria-hidden="true"
    >
      <span
        className={`${
          compact ? "h-2.5 w-2.5" : "h-3 w-3"
        } shrink-0 rounded-full bg-[#FF5F57]`}
      />
      <span
        className={`${
          compact ? "h-2.5 w-2.5" : "h-3 w-3"
        } shrink-0 rounded-full bg-[#FEBC2E]`}
      />
      <span
        className={`${
          compact ? "h-2.5 w-2.5" : "h-3 w-3"
        } shrink-0 rounded-full bg-[#28C840]`}
      />
    </div>
  );
};
