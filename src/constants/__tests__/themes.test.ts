import { describe, expect, it } from "bun:test";
import {
  DARK_THEME_OPTIONS,
  getDarkThemeMeta,
  normalizeDarkTheme,
} from "../themes";

describe("IDE dark theme presets", () => {
  it("exposes the 6 modern IDE dark palettes in order", () => {
    expect(DARK_THEME_OPTIONS.map((t) => t.id)).toEqual([
      "cursor",
      "vercel",
      "vesper",
      "onedark",
      "tokyo-night",
      "catppuccin",
    ]);
    expect(new Set(DARK_THEME_OPTIONS.map((t) => t.id)).size).toBe(6);
  });

  it("preserves supported IDs and migrates legacy or unknown inputs to cursor", () => {
    for (const opt of DARK_THEME_OPTIONS) {
      expect(normalizeDarkTheme(opt.id)).toBe(opt.id);
    }
    expect(normalizeDarkTheme("obsidian")).toBe("cursor");
    expect(normalizeDarkTheme("espresso")).toBe("cursor");
    expect(normalizeDarkTheme("chronometer")).toBe("cursor");
    expect(normalizeDarkTheme("")).toBe("cursor");
    expect(normalizeDarkTheme(undefined)).toBe("cursor");
    expect(normalizeDarkTheme("unknown-palette")).toBe("cursor");
  });

  it("resolves metadata cleanly and falls back to Cursor Dark", () => {
    expect(getDarkThemeMeta("vercel").name).toBe("Vercel");
    expect(getDarkThemeMeta("vesper").name).toBe("Vesper");
    expect(getDarkThemeMeta("onedark").name).toBe("One Dark Pro");
    expect(getDarkThemeMeta("tokyo-night").name).toBe("Tokyo Night");
    expect(getDarkThemeMeta("catppuccin").name).toBe("Catppuccin Mocha");
    expect(getDarkThemeMeta("obsidian").id).toBe("cursor");
    expect(getDarkThemeMeta("obsidian").name).toBe("Cursor Dark");
  });
});
