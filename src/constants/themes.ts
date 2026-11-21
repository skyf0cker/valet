import type { DarkThemeId, LightThemeId } from "../types/valet";

export interface ThemeSwatchPreview {
  sidebar: string;
  canvas: string;
  surface: string;
  border: string;
  accent: string;
  ink: string;
  muted: string;
}

export interface ThemePaletteOption<T extends string = string> {
  id: T;
  name: string;
  enName: string;
  tagline: string;
  shortTag: string;
  polarity: "light" | "dark";
  pairedId?: string;
  preview: ThemeSwatchPreview;
}

export type DarkThemePreview = ThemeSwatchPreview;
export type DarkThemeOption = ThemePaletteOption<DarkThemeId>;
export type LightThemeOption = ThemePaletteOption<LightThemeId>;

const VALID_LIGHT_THEME_IDS = new Set<LightThemeId>([
  "cursor-light",
  "vercel-light",
  "one-light",
  "tokyo-day",
  "catppuccin-latte",
  "solarized-light",
]);

const VALID_DARK_THEME_IDS = new Set<DarkThemeId>([
  "cursor",
  "vercel",
  "onedark",
  "tokyo-night",
  "catppuccin",
  "vesper",
]);

export const LIGHT_THEME_OPTIONS: LightThemeOption[] = [
  {
    id: "cursor-light",
    name: "Cursor Light",
    enName: "Anysphere Light",
    tagline: "中性浅灰 · 清透低噪",
    shortTag: "中性浅灰",
    polarity: "light",
    pairedId: "cursor",
    preview: {
      sidebar: "#F3F3F3",
      canvas: "#FCFCFC",
      surface: "#FFFFFF",
      border: "#DFDFDF",
      accent: "#2A8F7D",
      ink: "#141414",
      muted: "#757575",
    },
  },
  {
    id: "vercel-light",
    name: "Vercel Light",
    enName: "Geist Light",
    tagline: "纯白锐利 · 高对比度",
    shortTag: "纯白锐利",
    polarity: "light",
    pairedId: "vercel",
    preview: {
      sidebar: "#FAFAFA",
      canvas: "#FFFFFF",
      surface: "#FFFFFF",
      border: "#E5E5E5",
      accent: "#0070F3",
      ink: "#000000",
      muted: "#666666",
    },
  },
  {
    id: "one-light",
    name: "One Light",
    enName: "Atom Light",
    tagline: "经典浅灰 · 柔和低眩",
    shortTag: "柔和低眩",
    polarity: "light",
    pairedId: "onedark",
    preview: {
      sidebar: "#EFEFF1",
      canvas: "#FAFAFA",
      surface: "#FFFFFF",
      border: "#DCDCE0",
      accent: "#4078F2",
      ink: "#2B2E36",
      muted: "#696C77",
    },
  },
  {
    id: "tokyo-day",
    name: "Tokyo Day",
    enName: "Tokyo Night Day",
    tagline: "东京晴昼 · 护眼雾蓝",
    shortTag: "护眼雾蓝",
    polarity: "light",
    pairedId: "tokyo-night",
    preview: {
      sidebar: "#D8DAE2",
      canvas: "#E6E7ED",
      surface: "#EFF0F5",
      border: "#C4C7D4",
      accent: "#2E7DE9",
      ink: "#24283B",
      muted: "#58607D",
    },
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    enName: "Latte Pastel",
    tagline: "拿铁柔灰 · 薰衣草紫",
    shortTag: "拿铁薰紫",
    polarity: "light",
    pairedId: "catppuccin",
    preview: {
      sidebar: "#E6E9EF",
      canvas: "#EFF1F5",
      surface: "#F7F8FB",
      border: "#CCD0DA",
      accent: "#8839EF",
      ink: "#3B3E54",
      muted: "#6C6F85",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    enName: "Warm Parchment",
    tagline: "暖米纸感 · 久读护眼",
    shortTag: "暖米纸感",
    polarity: "light",
    preview: {
      sidebar: "#EEE8D5",
      canvas: "#FDF6E3",
      surface: "#FCF7E8",
      border: "#DDD6C1",
      accent: "#268BD2",
      ink: "#073642",
      muted: "#586E75",
    },
  },
];

export const DARK_THEME_OPTIONS: DarkThemeOption[] = [
  {
    id: "cursor",
    name: "Cursor Dark",
    enName: "Anysphere Neutral",
    tagline: "中性炭灰 · 清透低噪",
    shortTag: "中性炭灰",
    polarity: "dark",
    pairedId: "cursor-light",
    preview: {
      sidebar: "#141414",
      canvas: "#181818",
      surface: "#1E1E1E",
      border: "rgba(255, 255, 255, 0.14)",
      accent: "#83D6C5",
      ink: "#F5F5F5",
      muted: "#858585",
    },
  },
  {
    id: "vercel",
    name: "Vercel Dark",
    enName: "Geist OLED Dark",
    tagline: "纯黑锐利 · 高对比度",
    shortTag: "纯黑锐利",
    polarity: "dark",
    pairedId: "vercel-light",
    preview: {
      sidebar: "#000000",
      canvas: "#0A0A0A",
      surface: "#111111",
      border: "rgba(255, 255, 255, 0.16)",
      accent: "#52A8FF",
      ink: "#FFFFFF",
      muted: "#888888",
    },
  },
  {
    id: "onedark",
    name: "One Dark Pro",
    enName: "Atom Classic",
    tagline: "经典灰蓝 · 舒适耐看",
    shortTag: "经典灰蓝",
    polarity: "dark",
    pairedId: "one-light",
    preview: {
      sidebar: "#21252B",
      canvas: "#282C34",
      surface: "#2C313A",
      border: "rgba(171, 178, 191, 0.19)",
      accent: "#61AFEF",
      ink: "#F0F4FA",
      muted: "#848B98",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    enName: "Indigo Night",
    tagline: "深邃靛蓝 · 柔和霓光",
    shortTag: "深邃靛蓝",
    polarity: "dark",
    pairedId: "tokyo-day",
    preview: {
      sidebar: "#16161E",
      canvas: "#1A1B26",
      surface: "#1F2335",
      border: "rgba(122, 162, 247, 0.22)",
      accent: "#7AA2F7",
      ink: "#E2E8FF",
      muted: "#7882A8",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    enName: "Mocha Pastel",
    tagline: "温柔摩卡 · 薰衣草紫",
    shortTag: "温柔摩卡",
    polarity: "dark",
    pairedId: "catppuccin-latte",
    preview: {
      sidebar: "#181825",
      canvas: "#1E1E2E",
      surface: "#252538",
      border: "rgba(203, 166, 247, 0.22)",
      accent: "#CBA6F7",
      ink: "#EAEFFC",
      muted: "#9399B2",
    },
  },
  {
    id: "vesper",
    name: "Vesper",
    enName: "Rauno Minimal",
    tagline: "哑光墨黑 · 暖杏薄荷",
    shortTag: "墨黑暖杏",
    polarity: "dark",
    preview: {
      sidebar: "#0A0A0A",
      canvas: "#101010",
      surface: "#161616",
      border: "rgba(255, 255, 255, 0.14)",
      accent: "#FFC799",
      ink: "#FFFFFF",
      muted: "#7E7E7E",
    },
  },
];

/** Clamp any persisted or external lightTheme string to a supported LightThemeId. */
export function normalizeLightTheme(raw?: string): LightThemeId {
  if (raw && VALID_LIGHT_THEME_IDS.has(raw as LightThemeId)) {
    return raw as LightThemeId;
  }
  return "cursor-light";
}

/** Return metadata for the given light theme ID (defaulting to cursor-light). */
export function getLightThemeMeta(id?: string): LightThemeOption {
  const normalized = normalizeLightTheme(id);
  return LIGHT_THEME_OPTIONS.find((item) => item.id === normalized) ?? LIGHT_THEME_OPTIONS[0]!;
}

/** Clamp any persisted or external darkTheme string to a supported DarkThemeId. */
export function normalizeDarkTheme(raw?: string): DarkThemeId {
  if (raw && VALID_DARK_THEME_IDS.has(raw as DarkThemeId)) {
    return raw as DarkThemeId;
  }
  return "cursor";
}

/** Return metadata for the given dark theme ID (defaulting to cursor). */
export function getDarkThemeMeta(id?: string): DarkThemeOption {
  const normalized = normalizeDarkTheme(id);
  return DARK_THEME_OPTIONS.find((item) => item.id === normalized) ?? DARK_THEME_OPTIONS[0]!;
}
