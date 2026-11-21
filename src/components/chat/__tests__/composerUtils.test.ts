import { describe, expect, it } from "bun:test";
import { computeComposerTextareaMetrics } from "../composerUtils";

describe("composerUtils computeComposerTextareaMetrics", () => {
  it("enforces single-line minimum heights without scrolling", () => {
    expect(
      computeComposerTextareaMetrics({
        scrollHeight: 0,
        viewportHeight: 900,
        compact: false,
      })
    ).toEqual({ height: 24, maxHeight: 340, scrollable: false });

    expect(
      computeComposerTextareaMetrics({
        scrollHeight: 16,
        viewportHeight: 900,
        compact: true,
      })
    ).toEqual({ height: 20, maxHeight: 240, scrollable: false });
  });

  it("expands multi-line JSON content seamlessly up to the AGY-style cap", () => {
    const json10Lines = computeComposerTextareaMetrics({
      scrollHeight: 242,
      viewportHeight: 900,
      compact: false,
    });
    expect(json10Lines).toEqual({
      height: 242,
      maxHeight: 340,
      scrollable: false,
    });

    const veryLong = computeComposerTextareaMetrics({
      scrollHeight: 620,
      viewportHeight: 900,
      compact: false,
    });
    expect(veryLong).toEqual({
      height: 340,
      maxHeight: 340,
      scrollable: true,
    });

    const veryLongCompact = computeComposerTextareaMetrics({
      scrollHeight: 620,
      viewportHeight: 900,
      compact: true,
    });
    expect(veryLongCompact).toEqual({
      height: 240,
      maxHeight: 240,
      scrollable: true,
    });
  });

  it("scales maxHeight proportionally on smaller windows with a floor", () => {
    const midWindow = computeComposerTextareaMetrics({
      scrollHeight: 300,
      viewportHeight: 500,
      compact: false,
    });
    expect(midWindow).toEqual({
      height: 210,
      maxHeight: 210,
      scrollable: true,
    });

    const midWindowCompact = computeComposerTextareaMetrics({
      scrollHeight: 300,
      viewportHeight: 500,
      compact: true,
    });
    expect(midWindowCompact).toEqual({
      height: 180,
      maxHeight: 180,
      scrollable: true,
    });

    const tinyWindow = computeComposerTextareaMetrics({
      scrollHeight: 200,
      viewportHeight: 250,
      compact: false,
    });
    expect(tinyWindow).toEqual({
      height: 140,
      maxHeight: 140,
      scrollable: true,
    });

    const tinyWindowCompact = computeComposerTextareaMetrics({
      scrollHeight: 200,
      viewportHeight: 250,
      compact: true,
    });
    expect(tinyWindowCompact).toEqual({
      height: 120,
      maxHeight: 120,
      scrollable: true,
    });
  });
});
