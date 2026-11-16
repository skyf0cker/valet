import React from "react";
import type { PermissionId, PluginState } from "../../types/valet";

interface IconProps {
  size?: number;
  className?: string;
}

export const BowtieSvg: React.FC<IconProps> = ({ size = 18, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M2.5 7.2c0-.7.7-1.1 1.3-.8l6.2 3.3v4.6l-6.2 3.3c-.6.3-1.3-.1-1.3-.8z"
      fill="currentColor"
    />
    <path
      d="M21.5 7.2c0-.7-.7-1.1-1.3-.8l-6.2 3.3v4.6l6.2 3.3c.6.3 1.3-.1 1.3-.8z"
      fill="currentColor"
    />
    <rect x="10.2" y="9.6" width="3.6" height="4.8" rx="1.2" fill="currentColor" />
  </svg>
);

export const CheckIcon: React.FC<IconProps & { strokeWidth?: number }> = ({
  size = 12,
  strokeWidth = 3,
  className = "",
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M5 12l5 5 9-10"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ArrowRightIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M5 12h14M13 6l6 6-6 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ArrowUpRightIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M7 17L17 7M8 7h9v9"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ArrowUpIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M12 19V5M5 12l7-7 7 7"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const CloseIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const UndoIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M9 14L4 9l5-5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 9h11a5 5 0 010 10h-3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const WarningTriangleIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M12 9v4M12 17h0"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const EyeIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const EyeOffIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10.4 10.4 0 0112 5c6.5 0 10 7 10 7a16.4 16.4 0 01-3.2 4.3M6.6 6.6A16.5 16.5 0 002 12s3.5 7 10 7a10.4 10.4 0 004.8-1.2"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PaperclipIcon: React.FC<IconProps> = ({ size = 17, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M21 11l-8.6 8.6a5 5 0 01-7-7L14 4a3.3 3.3 0 014.7 4.7l-8.6 8.6a1.7 1.7 0 01-2.4-2.4L16 6.6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ScreenCaptureIcon: React.FC<IconProps> = ({ size = 17, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const MicIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M5 11a7 7 0 0014 0M12 18v3"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ImageIcon: React.FC<IconProps> = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M3 15l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const ClockIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ChatBubbleIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PlugIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M9 3v4M15 3v4M6 7h12v5a6 6 0 01-12 0zM12 18v3"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SlidersIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <circle cx="16" cy="6" r="2" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="10" cy="12" r="2" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="18" cy="18" r="2" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const InboxIcon: React.FC<IconProps> = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M4 13h4.5l1.5 2.5h4L15.5 13H20"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.4 5.8L3.5 13v5a2 2 0 002 2h13a2 2 0 002-2v-5l-1.9-7.2A2 2 0 0016.7 4H7.3a2 2 0 00-1.9 1.8z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const DoubleCheckIcon: React.FC<IconProps> = ({ size = 13, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M2 12l5 5L17 7M11 17l2 2 9-9"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SidebarPanelIcon: React.FC<IconProps> = ({ size = 15, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M9 4v16" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const MailIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.5 7l8.5 6 8.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const TrashIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const DriveIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <rect x="3" y="13" width="18" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.5 13L7.2 6.5A2 2 0 019.1 5h5.8a2 2 0 011.9 1.5L18.5 13M16.5 16.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const PulseWaveIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path d="M3 12h4l3-7 4 14 3-7h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SunIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

export const MoonIcon: React.FC<IconProps> = ({ size = 14, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PermissionGlyph: React.FC<{ id: PermissionId; size?: number; className?: string }> = ({
  id,
  size = 18,
  className = "",
}) => {
  switch (id) {
    case "full_disk":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "accessibility":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="4.5" r="1.8" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M5 8.5l7 1.5 7-1.5M12 10v4.5M12 14.5l-3 6M12 14.5l3 6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "screen_recording":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="10.5" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "automation":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M4 17l6-6-6-6M12 19h8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "notifications":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "microphone":
      return <MicIcon size={size} className={className} />;
  }
};

export const PluginBadgeIcon: React.FC<{
  plugin: Pick<PluginState, "iconKind" | "iconLabel" | "source" | "enabled">;
  size?: "sm" | "md" | "lg";
}> = ({ plugin, size = "md" }) => {
  const dim =
    size === "lg" ? "h-14 w-14 rounded-[14px]" : size === "sm" ? "h-7 w-7 rounded-[7px]" : "h-8 w-8 rounded-[8px]";
  const iconSz = size === "lg" ? 26 : size === "sm" ? 14 : 16;

  if (plugin.source === "local") {
    return (
      <div
        className={`${dim} flex shrink-0 items-center justify-center border border-dashed border-[var(--ink-faint)] font-mono text-[11px] font-semibold text-[var(--ink-strong)]`}
      >
        {plugin.iconLabel ?? "{ }"}
      </div>
    );
  }

  if (plugin.source === "community") {
    return (
      <div
        className={`${dim} flex shrink-0 items-center justify-center border border-[var(--border-control)] bg-[var(--bg-surface)] font-mono text-[11px] font-semibold text-[var(--ink-strong)]`}
      >
        {plugin.iconLabel ?? plugin.iconKind.slice(0, 2)}
      </div>
    );
  }

  const activeStyle = plugin.enabled
    ? "border border-[var(--brand-icon-border)] bg-[var(--brand-icon-bg)] text-[var(--brand-icon-fg)]"
    : "bg-[var(--bg-muted)] text-[var(--ink-primary)]";

  return (
    <div className={`${dim} ${activeStyle} flex shrink-0 items-center justify-center transition-colors`}>
      {plugin.iconKind === "disk" && (
        <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none">
          <ellipse cx="12" cy="6" rx="8" ry="3" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      )}
      {plugin.iconKind === "trash" && (
        <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none">
          <path
            d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {plugin.iconKind === "pulse" && (
        <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none">
          <path
            d="M3 12h4l3-8 4 16 3-8h4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {plugin.iconKind === "log" && (
        <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none">
          <path
            d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 3v6h6M8 13h8M8 17h5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
};
