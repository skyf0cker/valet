import { useCallback, useRef } from "react";

export interface ImeKeyLike {
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
}

export interface ImeCompositionState {
  isComposing: boolean;
  lastCompositionEndAt: number;
}

/**
 * Detects whether a `keydown` event is confirming or immediately trailing an IME composition.
 * macOS WKWebView often fires `compositionend` right before the confirming Enter `keydown`
 * with `isComposing=false`, so checking a short post-compositionend window prevents premature submit.
 */
export function isImeCompositionConfirm(
  e: ImeKeyLike,
  state: ImeCompositionState,
  now = performance.now(),
  windowMs = 120
): boolean {
  if (state.isComposing) return true;
  if (e.isComposing || e.nativeEvent?.isComposing) return true;
  if (e.keyCode === 229 || e.nativeEvent?.keyCode === 229) return true;
  if (state.lastCompositionEndAt > 0 && now - state.lastCompositionEndAt < windowMs) {
    return true;
  }
  return false;
}

export function useImeGuard(windowMs = 120) {
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  const onCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    lastCompositionEndAtRef.current = performance.now();
  }, []);

  const shouldIgnoreEnter = useCallback(
    (e: ImeKeyLike) =>
      isImeCompositionConfirm(
        e,
        {
          isComposing: isComposingRef.current,
          lastCompositionEndAt: lastCompositionEndAtRef.current,
        },
        performance.now(),
        windowMs
      ),
    [windowMs]
  );

  return {
    onCompositionStart,
    onCompositionEnd,
    shouldIgnoreEnter,
    compositionProps: {
      onCompositionStart,
      onCompositionEnd,
    },
  };
}
