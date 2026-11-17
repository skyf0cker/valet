import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CheckIcon, SearchIcon } from "./Icons";

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
  variant?: "default" | "ghost";
  triggerClassName?: string;
  triggerLabel?: string;
  searchable?: boolean;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  minWidth: number;
  maxWidth: number;
  listMaxHeight: number;
}

export const SelectMenu: React.FC<SelectMenuProps> = ({
  value,
  options,
  onChange,
  mono = false,
  align = "right",
  compact = true,
  variant = "default",
  triggerClassName = "",
  triggerLabel,
  searchable,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const didInitOpenRef = useRef(false);

  const showSearch = searchable ?? options.length > 8;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;
    const gap = 6;
    const desiredMax = 280;
    const searchHeaderHeight = 38;

    const spaceBelow = vh - rect.bottom - gap - pad;
    const spaceAbove = rect.top - gap - pad;
    const placeTop = spaceBelow < 190 && spaceAbove > spaceBelow;
    const totalMaxH = Math.max(
      120,
      Math.min(desiredMax, Math.floor(placeTop ? spaceAbove : spaceBelow))
    );
    const listMaxHeight = Math.max(
      84,
      showSearch ? totalMaxH - searchHeaderHeight : totalMaxH
    );

    const capWidth = Math.min(360, vw - pad * 2);
    const minWidth = Math.min(capWidth, Math.max(180, Math.round(rect.width)));

    let left: number | undefined;
    let right: number | undefined;
    let maxWidth: number;

    if (align === "right") {
      const candidateRight = Math.max(pad, Math.round(vw - rect.right));
      if (vw - candidateRight - pad >= minWidth) {
        right = candidateRight;
        maxWidth = Math.min(360, vw - right - pad);
      } else {
        left = pad;
        maxWidth = capWidth;
      }
    } else {
      const preferredSpan = Math.min(capWidth, Math.max(minWidth, 260));
      left = Math.max(
        pad,
        Math.min(Math.round(rect.left), vw - preferredSpan - pad)
      );
      maxWidth = Math.min(360, vw - left - pad);
    }

    setMenuPos({
      top: placeTop ? undefined : Math.round(rect.bottom + gap),
      bottom: placeTop ? Math.round(vh - rect.top + gap) : undefined,
      left,
      right,
      minWidth,
      maxWidth,
      listMaxHeight,
    });
  }, [align, showSearch]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      didInitOpenRef.current = false;
      setQuery("");
      return;
    }
    if (!menuPos || didInitOpenRef.current) return;
    didInitOpenRef.current = true;

    const selectedEl = listRef.current?.querySelector<HTMLElement>(
      '[data-selected="true"]'
    );
    selectedEl?.scrollIntoView({ block: "nearest" });
    if (showSearch) {
      searchInputRef.current?.focus({ preventScroll: true });
    }
  }, [open, menuPos, showSearch]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (
        target &&
        (target === menuRef.current || menuRef.current?.contains(target))
      ) {
        return;
      }
      updatePosition();
    };
    const onResize = () => updatePosition();

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, updatePosition]);

  const active = options.find((o) => o.value === value);
  const displayLabel = triggerLabel ?? active?.label ?? value;

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        (opt.hint?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  return (
    <div ref={rootRef} className="relative inline-flex min-w-0 max-w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={displayLabel}
        onClick={() => {
          setOpen((o) => {
            if (!o) setQuery("");
            return !o;
          });
        }}
        className={`flex min-w-0 ${
          triggerClassName.includes("max-w-") ? "" : "max-w-[min(100%,280px)]"
        } cursor-pointer items-center gap-1.5 rounded-[7px] transition-colors ${
          variant === "ghost"
            ? "border border-transparent bg-transparent px-2 text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
            : "border border-[var(--border-control)] bg-[var(--bg-elevated)] px-2.5 text-[12px] text-[var(--ink-strong)] hover:border-[var(--border-strong)]"
        } ${
          compact ? "h-[28px]" : "h-[34px]"
        } ${triggerClassName}`}
      >
        <span
          className={`min-w-0 flex-1 truncate text-left ${
            mono ? "font-mono text-[11px]" : ""
          }`}
        >
          {displayLabel}
        </span>
        <span className="shrink-0 text-[9px] text-[var(--ink-subtle)]">▾</span>
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              top: menuPos.top,
              bottom: menuPos.bottom,
              left: menuPos.left,
              right: menuPos.right,
              minWidth: menuPos.minWidth,
              maxWidth: menuPos.maxWidth,
            }}
            className="app-no-drag animate-valet-modal-in fixed z-[80] flex flex-col overflow-hidden rounded-[10px] border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-[var(--shadow-popover)]"
          >
            {showSearch && (
              <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-[var(--border-light)] px-2.5">
                <SearchIcon
                  size={12}
                  className="shrink-0 text-[var(--ink-subtle)]"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="筛选选项…"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-subtle)]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      searchInputRef.current?.focus({ preventScroll: true });
                    }}
                    className="shrink-0 cursor-pointer text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                    aria-label="清空筛选"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            <div
              ref={listRef}
              style={{ maxHeight: menuPos.listMaxHeight }}
              className="overflow-x-hidden overflow-y-auto overscroll-contain p-1"
            >
              {filteredOptions.length === 0 ? (
                <div className="px-2.5 py-3 text-center text-[11px] text-[var(--ink-muted)]">
                  无匹配选项
                </div>
              ) : (
                filteredOptions.map((opt) => {
                  const selected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-selected={selected ? "true" : undefined}
                      title={opt.label}
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
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          mono ? "font-mono text-[11px]" : ""
                        }`}
                      >
                        {opt.label}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {opt.hint && (
                          <span className="font-mono text-[10px] text-[var(--ink-subtle)]">
                            {opt.hint}
                          </span>
                        )}
                        {selected && <CheckIcon size={11} strokeWidth={2.8} />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
