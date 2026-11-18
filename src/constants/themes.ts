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

export const DARK_THEME_OPTIONS: DarkThemeOption[] = [
  {
    id: "obsidian",
    name: "午夜黑曜石",
    enName: "Midnight Tuxedo",
    tagline: "冷调板岩 · 清透利落",
    preview: {
      sidebar: "#0B0D12",
      canvas: "#131720",
      surface: "#181E2A",
      navPill: "#1B2232",
      border: "rgba(205, 222, 255, 0.16)",
      accent: "#82ACFF",
      switchTrack: "#3D527A",
      ctaBg: "#EEF3FC",
      ink: "#F4F7FC",
      muted: "#7D899E",
    },
  },
  {
    id: "espresso",
    name: "暖岩黑胡桃",
    enName: "Savile Espresso",
    tagline: "温润胡桃 · 象牙衬线",
    preview: {
      sidebar: "#0D0C0A",
      canvas: "#161412",
      surface: "#1C1916",
      navPill: "#211D19",
      border: "rgba(255, 238, 210, 0.16)",
      accent: "#E8AD50",
      switchTrack: "#9A7032",
      ctaBg: "#F3EDE2",
      ink: "#F6F2EA",
      muted: "#8A8175",
    },
  },
  {
    id: "chronometer",
    name: "深松怀表",
    enName: "Nocturnal Chronometer",
    tagline: "深松墨黑 · 翡翠古铜",
    preview: {
      sidebar: "#090D0C",
      canvas: "#111715",
      surface: "#151E1B",
      navPill: "#18231F",
      border: "rgba(192, 240, 218, 0.16)",
      accent: "#55CA90",
      switchTrack: "#2B6E51",
      ctaBg: "#EAF3EE",
      ink: "#F0F6F3",
      muted: "#788D84",
    },
  },
];

/** Clamp any persisted or external darkTheme string to a supported DarkThemeId. */
export function normalizeDarkTheme(raw?: string): DarkThemeId {
  if (raw === "espresso" || raw === "chronometer") return raw;
  return "obsidian";
}

/** Return metadata for the given dark theme ID (defaulting to obsidian). */
export function getDarkThemeMeta(id?: string): DarkThemeOption {
  const normalized = normalizeDarkTheme(id);
  return DARK_THEME_OPTIONS.find((item) => item.id === normalized) ?? DARK_THEME_OPTIONS[0]!;
}
