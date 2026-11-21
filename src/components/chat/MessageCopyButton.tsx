import React, { useEffect, useRef, useState } from "react";
import { copyTextToClipboard, getCopyableMessageText } from "../../utils/chatClipboard";
import { CheckIcon, CopyIcon } from "../ui/Icons";

interface MessageCopyButtonProps {
  text: string;
  title?: string;
  copiedLabel?: string;
  showCopiedText?: boolean;
  iconSize?: number;
  className?: string;
  onCopied?: () => void;
  onError?: () => void;
}

/**
 * Reusable icon-and-feedback copy button for chat messages, showing transient
 * checkmark feedback after copying.
 */
export const MessageCopyButton: React.FC<MessageCopyButtonProps> = ({
  text,
  title = "复制回复",
  copiedLabel = "已复制",
  showCopiedText = true,
  iconSize = 14,
  className = "",
  onCopied,
  onError,
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copyable = getCopyableMessageText(text);
  if (!copyable) return null;

  const handleClick = async () => {
    const ok = await copyTextToClipboard(copyable);
    if (!ok) {
      onError?.();
      return;
    }

    setCopied(true);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, 1600);
    onCopied?.();
  };

  return (
    <button
      type="button"
      data-copy-message-button="true"
      data-copied={copied ? "true" : "false"}
      aria-label={copied ? copiedLabel : title}
      title={copied ? copiedLabel : title}
      onClick={() => void handleClick()}
      className={`inline-flex h-[26px] min-w-[26px] cursor-pointer items-center justify-center gap-1 rounded-[6px] px-1.5 text-[11px] transition-colors ${
        copied
          ? "text-emerald-500"
          : "text-[var(--ink-subtle)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-strong)]"
      } ${className}`.trim()}
    >
      {copied ? (
        <>
          <CheckIcon size={iconSize} strokeWidth={2.4} />
          {showCopiedText && (
            <span className="font-medium leading-none">{copiedLabel}</span>
          )}
        </>
      ) : (
        <CopyIcon size={iconSize} />
      )}
    </button>
  );
};
