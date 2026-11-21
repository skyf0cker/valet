import { describe, expect, it } from "bun:test";
import { isImeCompositionConfirm } from "../useImeGuard";

describe("useImeGuard isImeCompositionConfirm", () => {
  it("treats active composition, native isComposing, and keyCode 229 as IME confirmation", () => {
    expect(
      isImeCompositionConfirm({}, { isComposing: true, lastCompositionEndAt: 0 }, 500)
    ).toBe(true);
    expect(
      isImeCompositionConfirm(
        { nativeEvent: { isComposing: true } },
        { isComposing: false, lastCompositionEndAt: 0 },
        500
      )
    ).toBe(true);
    expect(
      isImeCompositionConfirm(
        { keyCode: 229 },
        { isComposing: false, lastCompositionEndAt: 0 },
        500
      )
    ).toBe(true);
    expect(
      isImeCompositionConfirm(
        { nativeEvent: { keyCode: 229 } },
        { isComposing: false, lastCompositionEndAt: 0 },
        500
      )
    ).toBe(true);
  });

  it("ignores WKWebView Enter arriving immediately after compositionend within grace window", () => {
    expect(
      isImeCompositionConfirm(
        { nativeEvent: { isComposing: false, keyCode: 13 }, keyCode: 13 },
        { isComposing: false, lastCompositionEndAt: 1000 },
        1015,
        120
      )
    ).toBe(true);

    // Regular Enter after grace window or without prior composition is NOT ignored
    expect(
      isImeCompositionConfirm(
        { nativeEvent: { isComposing: false, keyCode: 13 }, keyCode: 13 },
        { isComposing: false, lastCompositionEndAt: 1000 },
        1200,
        120
      )
    ).toBe(false);
    expect(
      isImeCompositionConfirm(
        { nativeEvent: { isComposing: false, keyCode: 13 }, keyCode: 13 },
        { isComposing: false, lastCompositionEndAt: 0 },
        50,
        120
      )
    ).toBe(false);
  });
});
