import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ThemePaletteOption, ThemeSwatchPreview } from "../../constants/themes";
import type { AppearanceMode, DarkThemeId, LightThemeId } from "../../types/valet";
import { CheckIcon, ChevronDownIcon } from "../ui/Icons";

interface ThemePickerDropdownProps {
  polarity: "light" | "dark";
  value: string;
  options: ReadonlyArray<ThemePaletteOption<string>>;
  onSelect: (id: string) => void;
  appearance: AppearanceMode;
  activeLightTheme: LightThemeId;
  activeDarkTheme: DarkThemeId;
}

interface PopoverCoords {
  top?: number;
  bottom?: number;
  right: number;
}

const ThemeMiniSwatch: React.FC<{
  preview: ThemeSwatchPreview;
  size: "sm" | "md";
}> = ({ preview, size }) => {
  const outerClass =
    size === "sm"
      ? "h-[16px] w-[24px] rounded-[4px]"
      : "h-[20px] w-[28px] rounded-[5px]";
  const sidebarClass = size === "sm" ? "w-[8px]" : "w-[9px]";
  const dotClass = size === "sm" ? "h-[4px] w-[4px]" : "h-[4.5px] w-[4.5px]";

  return (
    <span
      className={`flex shrink-0 overflow-hidden border ${outerClass}`}
      style={{ borderColor: preview.border }}
      aria-hidden="true"
    >
      <span
        className={`h-full shrink-0 border-r ${sidebarClass}`}
        style={{
          backgroundColor: preview.sidebar,
          borderRightColor: preview.border,
        }}
      />
      <span
        className="flex flex-1 items-end justify-end p-[2px]"
        style={{ backgroundColor: preview.canvas }}
      >
        <span
          className={`rounded-full ${dotClass}`}
          style={{ backgroundColor: preview.accent }}
        />
      </span>
    </span>
  );
};

function resolveAppliedTheme(mode: AppearanceMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export const ThemePickerDropdown: React.FC<ThemePickerDropdownProps> = ({
  polarity,
  value,
  options,
  onSelect,
  appearance,
  activeLightTheme,
  activeDarkTheme,
}) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef(false);
  const previewingRef = useRef(false);

  const selectedOption = options.find((opt) => opt.id === value) ?? options[0]!;

  const applyPreviewPalette = useCallback(
    (id: string) => {
      if (typeof document === "undefined") return;
      previewingRef.current = true;
      document.documentElement.dataset.theme = polarity;
      if (polarity === "light") {
        document.documentElement.dataset.lightPalette = id;
      } else {
        document.documentElement.dataset.darkPalette = id;
      }
    },
    [polarity]
  );

  const restoreCommittedTheme = useCallback(() => {
    if (typeof document === "undefined") return;
    if (committedRef.current) {
      committedRef.current = false;
      previewingRef.current = false;
      return;
    }
    if (!previewingRef.current) return;
    previewingRef.current = false;
    document.documentElement.dataset.theme = resolveAppliedTheme(appearance);
    document.documentElement.dataset.lightPalette = activeLightTheme;
    document.documentElement.dataset.darkPalette = activeDarkTheme;
  }, [activeDarkTheme, activeLightTheme, appearance]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;
    const gap = 6;
    const estHeight = 270;
    const spaceBelow = vh - rect.bottom - gap - pad;
    const spaceAbove = rect.top - gap - pad;
    const placeTop = spaceBelow < estHeight && spaceAbove > spaceBelow;
    const right = Math.max(pad, Math.round(vw - rect.right));

    setCoords({
      top: placeTop ? undefined : Math.round(rect.bottom + gap),
      bottom: placeTop ? Math.round(vh - rect.top + gap) : undefined,
      right,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        restoreCommittedTheme();
        setOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        restoreCommittedTheme();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const onViewportChange = () => updatePosition();

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, restoreCommittedTheme, updatePosition]);

  useEffect(() => {
    return () => {
      restoreCommittedTheme();
    };
  }, [restoreCommittedTheme]);

  return (
    <div className="inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            restoreCommittedTheme();
            setOpen(false);
          } else {
            committedRef.current = false;
            setOpen(true);
          }
        }}
        className={`inline-flex h-[32px] cursor-pointer items-center gap-2 rounded-[8px] border bg-[var(--bg-surface)] px-2.5 text-[12.5px] font-medium text-[var(--ink-strong)] transition-colors ${
          open
            ? "border-[var(--ink-primary)] ring-1 ring-[var(--ink-primary)]/15"
            : "border-[var(--border-control)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]/50"
        }`}
      >
        <ThemeMiniSwatch preview={selectedOption.preview} size="sm" />
        <span className="whitespace-nowrap">{selectedOption.name}</span>
        <ChevronDownIcon
          size={12}
          className={`shrink-0 text-[var(--ink-subtle)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={polarity === "light" ? "浅色主题列表" : "深色主题列表"}
            onMouseLeave={restoreCommittedTheme}
            style={{
              top: coords.top !== undefined ? `${coords.top}px` : undefined,
              bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
              right: `${coords.right}px`,
            }}
            className="fixed z-50 flex w-[286px] flex-col gap-0.5 rounded-[12px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-popover)]"
          >
            <div className="flex items-center justify-between px-2.5 pb-1 pt-1">
              <span className="text-[10.5px] font-medium text-[var(--ink-subtle)]">
                {polarity === "light" ? "浅色主题 · 悬停实时预览" : "深色主题 · 悬停实时预览"}
              </span>
              <span className="font-mono text-[10px] text-[var(--ink-faint)]">
                {options.length}
              </span>
            </div>

            {options.map((opt) => {
              const selected = opt.id === selectedOption.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => applyPreviewPalette(opt.id)}
                  onFocus={() => applyPreviewPalette(opt.id)}
                  onClick={() => {
                    committedRef.current = true;
                    previewingRef.current = false;
                    onSelect(opt.id);
                    setOpen(false);
                  }}
                  className={`flex h-[36px] w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-left transition-colors ${
                    selected
                      ? "bg-[var(--bg-subtle)] text-[var(--ink-strong)]"
                      : "text-[var(--ink-body)] hover:bg-[var(--bg-subtle)]/75 hover:text-[var(--ink-strong)]"
                  }`}
                >
                  <ThemeMiniSwatch preview={opt.preview} size="md" />
                  <span
                    className={`min-w-0 flex-1 truncate text-[12.5px] ${
                      selected ? "font-semibold text-[var(--ink-strong)]" : "font-medium"
                    }`}
                  >
                    {opt.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--ink-subtle)]">
                    {opt.shortTag}
                  </span>
                  <span className="flex w-3.5 shrink-0 items-center justify-center text-[var(--ink-primary)]">
                    {selected ? <CheckIcon size={12} strokeWidth={2.6} /> : null}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
};
