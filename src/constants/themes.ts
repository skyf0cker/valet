import type { DarkThemeId } from "../types/valet";

export interface DarkThemePreview {
  sidebar: string;
  canvas: string;
  surface: string;
  navPill: string;
  border: string;
  accent: string;
  switchTrack: string;
  ctaBg: string;
  ink: string;
  muted: string;
}

export interface DarkThemeOption {
  id: DarkThemeId;
  name: string;
  enName: string;
  tagline: string;
  preview: DarkThemePreview;
}

const VALID_DARK_THEME_IDS = new Set<DarkThemeId>([
  "cursor",
  "vercel",
  "vesper",
  "onedark",
  "tokyo-night",
  "catppuccin",
]);

export const DARK_THEME_OPTIONS: DarkThemeOption[] = [
  {
    id: "cursor",
    name: "Cursor Dark",
    enName: "Anysphere Neutral",
    tagline: "中性炭灰 · 清透低噪",
    preview: {
      sidebar: "#141414",
      canvas: "#181818",
      surface: "#1E1E1E",
      navPill: "#242424",
      border: "rgba(255, 255, 255, 0.12)",
      accent: "#83D6C5",
      switchTrack: "#4A9E8E",
      ctaBg: "#EDEDED",
      ink: "#F5F5F5",
      muted: "#858585",
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    enName: "Geist OLED Dark",
    tagline: "纯黑锐利 · 高对比度",
    preview: {
      sidebar: "#000000",
      canvas: "#0A0A0A",
      surface: "#111111",
      navPill: "#1A1A1A",
      border: "rgba(255, 255, 255, 0.14)",
      accent: "#52A8FF",
      switchTrack: "#0070F3",
      ctaBg: "#FFFFFF",
      ink: "#FFFFFF",
      muted: "#888888",
    },
  },
  {
    id: "vesper",
    name: "Vesper",
    enName: "Rauno Minimal",
    tagline: "哑光墨黑 · 暖杏薄荷",
    preview: {
      sidebar: "#0A0A0A",
      canvas: "#101010",
      surface: "#161616",
      navPill: "#1D1D1D",
      border: "rgba(255, 255, 255, 0.12)",
      accent: "#FFC799",
      switchTrack: "#C98F62",
      ctaBg: "#F5F5F5",
      ink: "#FFFFFF",
      muted: "#7E7E7E",
    },
  },
  {
    id: "onedark",
    name: "One Dark Pro",
    enName: "Atom Classic",
    tagline: "经典灰蓝 · 舒适耐看",
    preview: {
      sidebar: "#21252B",
      canvas: "#282C34",
      surface: "#2C313A",
      navPill: "#323844",
      border: "rgba(171, 178, 191, 0.18)",
      accent: "#61AFEF",
      switchTrack: "#4D8CC4",
      ctaBg: "#E6EBF3",
      ink: "#F0F4FA",
      muted: "#848B98",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    enName: "Indigo Night",
    tagline: "深邃靛蓝 · 柔和霓光",
    preview: {
      sidebar: "#16161E",
      canvas: "#1A1B26",
      surface: "#1F2335",
      navPill: "#24283B",
      border: "rgba(122, 162, 247, 0.20)",
      accent: "#7AA2F7",
      switchTrack: "#5374C4",
      ctaBg: "#D5DDF7",
      ink: "#E2E8FF",
      muted: "#7882A8",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    enName: "Mocha Pastel",
    tagline: "温柔摩卡 · 薰衣草紫",
    preview: {
      sidebar: "#181825",
      canvas: "#1E1E2E",
      surface: "#252538",
      navPill: "#313244",
      border: "rgba(203, 166, 247, 0.20)",
      accent: "#CBA6F7",
      switchTrack: "#8E6BC4",
      ctaBg: "#DCE3FA",
      ink: "#EAEFFC",
      muted: "#9399B2",
    },
  },
];

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
