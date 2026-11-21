/**
 * Removes `<think>` / `<thinking>` blocks (including unclosed streaming tags)
 * from model output and trims leading whitespace.
 */
export function stripThinkMarkup(raw: string): string {
  if (!raw) return "";
  let clean = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  if (/<think(?:ing)?>/i.test(clean)) {
    clean = clean.replace(/<think(?:ing)?>[\s\S]*$/i, "");
  }
  return clean.replace(/^\s+/, "");
}

/**
 * Returns the copyable Markdown body of a chat message with think markup removed
 * and outer whitespace trimmed, preserving all Markdown formatting.
 */
export function getCopyableMessageText(raw: string): string {
  return stripThinkMarkup(raw).trim();
}

/**
 * Copies plain text to the system clipboard using the async Clipboard API when
 * available, falling back to a hidden textarea + `document.execCommand("copy")`
 * for WKWebView or non-secure contexts.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback below.
    }
  }

  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  const previousActive = document.activeElement;
  document.body.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    return Boolean(document.execCommand("copy"));
  } catch {
    return false;
  } finally {
    textarea.parentNode?.removeChild(textarea);
    if (
      typeof HTMLElement !== "undefined" &&
      previousActive instanceof HTMLElement &&
      typeof previousActive.focus === "function"
    ) {
      previousActive.focus({ preventScroll: true });
    }
  }
}
