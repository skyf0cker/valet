import { describe, expect, it } from "bun:test";
import {
  DARK_THEME_OPTIONS,
  LIGHT_THEME_OPTIONS,
  getDarkThemeMeta,
  getLightThemeMeta,
  normalizeDarkTheme,
  normalizeLightTheme,
} from "../themes";

describe("Aligned Light & Dark IDE theme presets", () => {
  it("exposes the 6 Light and 6 Dark IDE palettes in aligned order", () => {
    expect(LIGHT_THEME_OPTIONS.map((t) => t.id)).toEqual([
      "cursor-light",
      "vercel-light",
      "one-light",
      "tokyo-day",
      "catppuccin-latte",
      "solarized-light",
    ]);
    expect(DARK_THEME_OPTIONS.map((t) => t.id)).toEqual([
      "cursor",
      "vercel",
      "onedark",
      "tokyo-night",
      "catppuccin",
      "vesper",
    ]);
    expect(new Set(LIGHT_THEME_OPTIONS.map((t) => t.id)).size).toBe(6);
    expect(new Set(DARK_THEME_OPTIONS.map((t) => t.id)).size).toBe(6);
  });

  it("pairs corresponding Light <-> Dark theme families and leaves standalone classics unpaired", () => {
    const expectedPairs: Array<[string, string]> = [
      ["cursor-light", "cursor"],
      ["vercel-light", "vercel"],
      ["one-light", "onedark"],
      ["tokyo-day", "tokyo-night"],
      ["catppuccin-latte", "catppuccin"],
    ];

    for (const [lightId, darkId] of expectedPairs) {
      const light = getLightThemeMeta(lightId);
      const dark = getDarkThemeMeta(darkId);
      expect(light.pairedId).toBe(darkId);
      expect(dark.pairedId).toBe(lightId);
    }

    expect(getLightThemeMeta("solarized-light").pairedId).toBe(undefined);
    expect(getDarkThemeMeta("vesper").pairedId).toBe(undefined);
  });

  it("clamps invalid or removed legacy IDs to cursor-light / cursor", () => {
    for (const opt of LIGHT_THEME_OPTIONS) {
      expect(normalizeLightTheme(opt.id)).toBe(opt.id);
    }
    for (const opt of DARK_THEME_OPTIONS) {
      expect(normalizeDarkTheme(opt.id)).toBe(opt.id);
    }

    expect(normalizeLightTheme("")).toBe("cursor-light");
    expect(normalizeLightTheme(undefined)).toBe("cursor-light");
    expect(normalizeLightTheme("obsidian")).toBe("cursor-light");

    expect(normalizeDarkTheme("obsidian")).toBe("cursor");
    expect(normalizeDarkTheme("espresso")).toBe("cursor");
    expect(normalizeDarkTheme("chronometer")).toBe("cursor");
    expect(normalizeDarkTheme("")).toBe("cursor");
    expect(normalizeDarkTheme(undefined)).toBe("cursor");
  });

  it("resolves metadata cleanly with sensible defaults", () => {
    expect(getLightThemeMeta("vercel-light").name).toBe("Vercel Light");
    expect(getLightThemeMeta("one-light").name).toBe("One Light");
    expect(getLightThemeMeta("tokyo-day").name).toBe("Tokyo Day");
    expect(getLightThemeMeta("catppuccin-latte").name).toBe("Catppuccin Latte");
    expect(getLightThemeMeta("solarized-light").name).toBe("Solarized Light");
    expect(getLightThemeMeta("unknown").id).toBe("cursor-light");
    expect(getLightThemeMeta("unknown").name).toBe("Cursor Light");

    expect(getDarkThemeMeta("vercel").name).toBe("Vercel Dark");
    expect(getDarkThemeMeta("onedark").name).toBe("One Dark Pro");
    expect(getDarkThemeMeta("tokyo-night").name).toBe("Tokyo Night");
    expect(getDarkThemeMeta("catppuccin").name).toBe("Catppuccin Mocha");
    expect(getDarkThemeMeta("vesper").name).toBe("Vesper");
    expect(getDarkThemeMeta("obsidian").id).toBe("cursor");
    expect(getDarkThemeMeta("obsidian").name).toBe("Cursor Dark");
  });
});
