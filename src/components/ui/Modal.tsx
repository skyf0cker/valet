import React, { useEffect } from "react";
import type { ToastMessage } from "../../store/ValetContext";
import { CloseIcon } from "./Icons";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  widthClass?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  widthClass = "max-w-[460px]",
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`animate-valet-modal-in w-full ${widthClass} rounded-[14px] border border-[var(--border-base)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-popover)]`}
      >
        <div className="flex items-start justify-between gap-4 pb-3">
          <div>
            <h3 className="font-[family-name:var(--font-serif-zh)] text-[19px] font-semibold text-[var(--ink-strong)]">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-1 text-[12px] text-[var(--ink-muted)]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-[var(--bg-subtle)] text-[var(--ink-primary)] hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <CloseIcon size={13} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

interface SlideOverDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const SlideOverDrawer: React.FC<SlideOverDrawerProps> = ({
  open,
  onClose,
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="fixed inset-0 bg-black/10 transition-opacity" aria-hidden="true" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="animate-valet-drawer-in relative z-10 flex h-full w-full max-w-[580px] flex-col border-l border-[var(--border-base)] bg-[var(--bg-canvas)] shadow-[var(--shadow-drawer)]"
      >
        {children}
      </aside>
    </div>
  );
};

export const ToastStack: React.FC<{
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col items-end gap-2">
      {toasts.map((toast) => {
        const badgeDot =
          toast.tone === "success"
            ? "bg-emerald-500"
            : toast.tone === "warning"
              ? "bg-[var(--amber-icon)]"
              : toast.tone === "danger"
                ? "bg-[var(--danger)]"
                : "bg-[var(--ink-on-primary)]";

        return (
          <div
            key={toast.id}
            onClick={() => onDismiss(toast.id)}
            className="animate-valet-modal-in pointer-events-auto flex cursor-pointer items-center gap-2.5 rounded-[10px] bg-[var(--ink-primary)] px-3.5 py-2.5 text-[12px] font-medium text-[var(--ink-on-primary)] shadow-[var(--shadow-popover)]"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${badgeDot}`} />
            <span>{toast.text}</span>
          </div>
        );
      })}
    </div>
  );
};
