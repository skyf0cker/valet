import React, { useCallback, useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "../../utils/chatClipboard";
import {
  computeQuotePopoverPosition,
  normalizeSelectedQuoteText,
} from "../../utils/chatQuotes";
import { QuoteBlockIcon } from "../ui/Icons";

interface SelectionQuotePopoverProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onQuote: (params: {
    text: string;
    messageId?: string;
    role: "assistant" | "user";
  }) => void;
  onCopy?: (text: string) => void;
}

interface ActiveQuoteSelection {
  text: string;
  messageId?: string;
  role: "assistant" | "user";
  left: number;
  top: number;
  placement: "above" | "below";
}

function asElement(node: Node | null): HTMLElement | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as HTMLElement;
  return node.parentElement;
}

function isEditableElement(node: Node | null): boolean {
  const el = asElement(node);
  if (!el) return false;
  return Boolean(el.closest("input, textarea, [contenteditable='true']"));
}

function findQuoteHost(
  node: Node | null,
  boundary: HTMLElement
): { role: "assistant" | "user"; messageId?: string } | null {
  let cur = asElement(node);
  while (cur && boundary.contains(cur)) {
    const role = cur.getAttribute("data-quote-role");
    if (role === "assistant" || role === "user") {
      const msgId = cur.getAttribute("data-quote-message-id")?.trim() || undefined;
      return { role, messageId: msgId };
    }
    if (cur === boundary) break;
    cur = cur.parentElement;
  }
  return null;
}

function getEffectiveSelectionRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (r && (r.width > 0 || r.height > 0)) return r;
  }
  return null;
}

export const SelectionQuotePopover: React.FC<SelectionQuotePopoverProps> = ({
  containerRef,
  onQuote,
  onCopy,
}) => {
  const [active, setActive] = useState<ActiveQuoteSelection | null>(null);
  const rafRef = useRef<number | null>(null);

  const measureSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") {
      setActive(null);
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setActive(null);
      return;
    }

    const range = sel.getRangeAt(0);
    if (
      !container.contains(range.startContainer) ||
      !container.contains(range.endContainer)
    ) {
      setActive(null);
      return;
    }

    if (
      isEditableElement(range.startContainer) ||
      isEditableElement(range.endContainer)
    ) {
      setActive(null);
      return;
    }

    const host =
      findQuoteHost(range.commonAncestorContainer, container) ??
      findQuoteHost(range.startContainer, container);
    if (!host) {
      setActive(null);
      return;
    }

    const normalized = normalizeSelectedQuoteText(sel.toString());
    if (!normalized) {
      setActive(null);
      return;
    }

    const selRect = getEffectiveSelectionRect(range);
    if (!selRect) {
      setActive(null);
      return;
    }

    const pos = computeQuotePopoverPosition({
      selectionRect: selRect,
      containerRect: container.getBoundingClientRect(),
    });
    if (!pos) {
      setActive(null);
      return;
    }

    setActive({
      text: normalized,
      messageId: host.messageId,
      role: host.role,
      left: pos.left,
      top: pos.top,
      placement: pos.placement,
    });
  }, [containerRef]);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      measureSelection();
    });
  }, [measureSelection]);

  useEffect(() => {
    const onSelectionChange = () => scheduleMeasure();
    const onMouseUp = () => scheduleMeasure();
    const onKeyUp = () => scheduleMeasure();
    const onScroll = (e: Event) => {
      const container = containerRef.current;
      if (container && e.target === container) {
        scheduleMeasure();
      }
    };
    const onResize = () => scheduleMeasure();

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [containerRef, scheduleMeasure]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActive(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);

  if (!active) return null;

  const clearSelection = () => {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // ignore selection cleanup failure
    }
    setActive(null);
  };

  return (
    <div
      data-selection-quote-popover="true"
      style={{
        left: `${active.left}px`,
        top: `${active.top}px`,
        transform:
          active.placement === "above"
            ? "translate(-50%, -100%)"
            : "translate(-50%, 0)",
      }}
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 flex items-center gap-0.5 rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-0.5 shadow-lg backdrop-blur-md"
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onQuote({
            text: active.text,
            messageId: active.messageId,
            role: active.role,
          });
          clearSelection();
        }}
        className="inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-[7px] px-2 text-[11.5px] font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--bg-subtle)]"
      >
        <QuoteBlockIcon size={12.5} className="shrink-0 text-[var(--ink-primary)]" />
        <span>引用</span>
      </button>

      <div className="h-3.5 w-[1px] bg-[var(--border-subtle)]" aria-hidden="true" />

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          void copyTextToClipboard(active.text).then((ok) => {
            if (ok) {
              onCopy?.(active.text);
            }
          });
          clearSelection();
        }}
        className="inline-flex h-[26px] cursor-pointer items-center rounded-[7px] px-2 text-[11.5px] font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      >
        <span>复制</span>
      </button>
    </div>
  );
};
