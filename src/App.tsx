import React from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar } from "./components/Sidebar";
import { InboxView } from "./components/inbox/InboxView";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { PluginsView } from "./components/plugins/PluginsView";
import { ProjectWorkspaceView } from "./components/projects/ProjectWorkspaceView";
import { SettingsView } from "./components/settings/SettingsView";
import { TimelineView } from "./components/timeline/TimelineView";
import { ToastStack } from "./components/ui/Modal";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { ValetProvider, useValet } from "./store/ValetContext";

const ValetShell: React.FC = () => {
  const { state, toasts, dismissToast } = useValet();
  useGlobalShortcuts();

  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--ink-strong)]">
      {!state.onboardingCompleted ? (
        <OnboardingFlow />
      ) : (
        <div className="flex h-full w-full overflow-hidden">
          <Sidebar />
          {state.activeView === "inbox" && <InboxView />}
          {state.activeView === "timeline" && <TimelineView />}
          {(state.activeView === "projects" || state.activeView === "chat") && (
            <ProjectWorkspaceView />
          )}
          {state.activeView === "plugins" && <PluginsView />}
          {state.activeView === "settings" && <SettingsView />}
        </div>
      )}

      <CommandPalette />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export const App: React.FC = () => (
  <ValetProvider>
    <ValetShell />
  </ValetProvider>
);

export default App;
