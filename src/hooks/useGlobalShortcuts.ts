import { useEffect } from "react";
import { getDarkThemeMeta, getLightThemeMeta } from "../constants/themes";
import { useValet } from "../store/ValetContext";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target.isContentEditable;
}

export function useGlobalShortcuts() {
  const {
    state,
    setActiveView,
    setCommandPaletteOpen,
    createNewChat,
    togglePauseValet,
    toggleSidebarCollapsed,
    updatePreferences,
    pushToast,
  } = useValet();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!state.onboardingCompleted || e.defaultPrevented) return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && e.key === "4") {
        e.preventDefault();
        setActiveView("inbox");
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "i" && !isEditableTarget(e.target)) {
        e.preventDefault();
        setActiveView("inbox");
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && e.key === "1") {
        e.preventDefault();
        setActiveView("timeline");
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && e.key === "2") {
        e.preventDefault();
        setActiveView("projects");
        return;
      }

      if (meta && !e.altKey && !e.shiftKey && e.key === "3") {
        e.preventDefault();
        setActiveView("plugins");
        return;
      }

      if (meta && e.key === ",") {
        e.preventDefault();
        setActiveView("settings");
        return;
      }

      if (meta && e.key === "\\") {
        e.preventDefault();
        toggleSidebarCollapsed();
        return;
      }

      if (meta && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const isCurrentlyDark =
          document.documentElement.dataset.theme === "dark";
        const next = isCurrentlyDark ? "light" : "dark";
        updatePreferences({ appearance: next });
        pushToast(
          next === "dark"
            ? `已切换深色模式 · ${getDarkThemeMeta(state.preferences.darkTheme).name}`
            : `已切换浅色模式 · ${getLightThemeMeta(state.preferences.lightTheme).name}`
        );
        return;
      }

      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createNewChat();
        return;
      }

      if (e.altKey && e.key === "Escape") {
        e.preventDefault();
        togglePauseValet();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    createNewChat,
    pushToast,
    setActiveView,
    setCommandPaletteOpen,
    state.onboardingCompleted,
    state.preferences.lightTheme,
    state.preferences.darkTheme,
    togglePauseValet,
    toggleSidebarCollapsed,
    updatePreferences,
  ]);
}
