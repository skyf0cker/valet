import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isMyGo } from "mygo-runtime";
import {
  Valet,
  events,
  type AgentProviderConfig as MyGoProviderConfig,
  type AutomationRule as MyGoAutomationRule,
  type ChatStreamPayload,
  type McpServerItem as MyGoMcpServerItem,
  type ModelSelection as MyGoModelSelection,
  type PluginConfig as MyGoPluginConfig,
  type PluginDraftSpec as MyGoPluginDraftSpec,
  type ValetPreferences as MyGoPreferences,
  type ValetSnapshot as MyGoSnapshot,
} from "../mygo";
import {
  DEFAULT_CLEANUP_POLICY,
  DEFAULT_PLUGIN_RUNTIME,
  DEFAULT_THRESHOLDS,
  createInitialSnapshot,
} from "../services/mockData";
import { valetService } from "../services/valetService";
import type {
  AgentProviderConfig,
  AppView,
  AutonomyLevel,
  AutomationRule,
  ChatAttachment,
  ChatMessage,
  ChatThread,
  EventPolicyMode,
  McpServerItem,
  ModelSelection,
  OnboardingStepId,
  PermissionId,
  PluginConfig,
  PluginDraftSpec,
  PluginState,
  ProviderId,
  ScanTaskItem,
  SettingsSectionId,
  TimelineEvent,
  ValetPreferences,
  ValetSnapshot,
} from "../types/valet";

const STORAGE_KEY = "valet.mvp.state.v2";

export interface ToastMessage {
  id: string;
  text: string;
  tone?: "default" | "success" | "warning" | "danger";
}

export interface ArrivalNotice {
  id: string;
  pluginName: string;
  eventCode: string;
}

function createCleanSlateShell(): ValetSnapshot {
  const base = createInitialSnapshot();
  return {
    ...base,
    schemaVersion: 2,
    inboxItems: [],
    inboxProcessedHistoryCount: 0,
    timelineEvents: [],
    earlierCountLabel: "",
    automations: [],
    mcpServers: [],
    memories: [],
    activeChatId: "chat-default",
    chatThreads: [
      {
        id: "chat-default",
        title: "新对话",
        model: base.preferences.models.primary,
        updatedAt: "刚刚",
        timelineActionCount: 0,
        linkedEventIds: [],
        messages: [],
      },
    ],
    providers: base.providers.map((p) => ({
      ...p,
      apiKey: "",
      apiKeyMasked: "",
      verified: false,
      connected: false,
      latencyMs: undefined,
    })),
    preferences: {
      ...base.preferences,
      dailySpendCurrent: 0,
    },
    scan: {
      status: "idle",
      progressPct: 0,
      elapsedSec: 0,
      reclaimableGB: 0,
      tasks: [],
    },
  };
}

function loadInitialState(): ValetSnapshot {
  if (isMyGo()) {
    return createCleanSlateShell();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialSnapshot();
    const parsed = JSON.parse(raw) as Partial<ValetSnapshot>;
    const base = createInitialSnapshot();
    return {
      ...base,
      ...parsed,
      preferences: {
        ...base.preferences,
        ...(parsed.preferences ?? {}),
        confirmChecklist: {
          ...base.preferences.confirmChecklist,
          ...(parsed.preferences?.confirmChecklist ?? {}),
        },
        models: {
          ...base.preferences.models,
          ...(parsed.preferences?.models ?? {}),
        },
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          ...(parsed.preferences?.thresholds ?? {}),
        },
        cleanupPolicy: {
          ...DEFAULT_CLEANUP_POLICY,
          ...(parsed.preferences?.cleanupPolicy ?? {}),
        },
        pluginRuntime: {
          ...DEFAULT_PLUGIN_RUNTIME,
          ...(parsed.preferences?.pluginRuntime ?? {}),
        },
      },
      systemMetrics: {
        ...base.systemMetrics,
        ...(parsed.systemMetrics ?? {}),
      },
      scan: {
        ...base.scan,
        ...(parsed.scan ?? {}),
      },
    };
  } catch {
    return createInitialSnapshot();
  }
}

function computeSelectedGB(
  items: { checked: boolean; sizeMB: number }[],
  fallbackGB = 0
): number {
  const mb = items
    .filter((i) => i.checked)
    .reduce((acc, i) => acc + i.sizeMB, 0);
  if (mb > 0) return Number((mb / 1024).toFixed(1));
  return fallbackGB;
}

function isFastModelId(id: string): boolean {
  const low = id.toLowerCase();
  return (
    low.includes("haiku") ||
    low.includes("flash") ||
    low.includes("mini") ||
    low.includes("nano") ||
    low.includes("fast") ||
    low.includes("lite")
  );
}

function reconcileProviderModelSelection(
  prev: ValetSnapshot,
  models: string[]
): {
  preferences: ValetPreferences;
  chatThreads: ChatThread[];
} {
  if (models.length === 0) {
    return {
      preferences: prev.preferences,
      chatThreads: prev.chatThreads,
    };
  }
  const hasModel = (id: string) => models.includes(id);
  const primary = hasModel(prev.preferences.models.primary)
    ? prev.preferences.models.primary
    : models[0]!;
  const fast = hasModel(prev.preferences.models.fast)
    ? prev.preferences.models.fast
    : models.find(isFastModelId) ?? models[models.length - 1] ?? primary;
  const vision =
    prev.preferences.models.vision === "同主模型" ||
    hasModel(prev.preferences.models.vision)
      ? prev.preferences.models.vision
      : "同主模型";

  const chatThreads = prev.chatThreads.map((t) =>
    hasModel(t.model) ? t : { ...t, model: primary }
  );

  return {
    preferences: {
      ...prev.preferences,
      models: { primary, fast, vision },
    },
    chatThreads,
  };
}

function mergeBackendSnapshot(
  prev: ValetSnapshot,
  remoteRaw: MyGoSnapshot
): ValetSnapshot {
  const remote = remoteRaw as unknown as ValetSnapshot;
  const hasActiveChat = remote.chatThreads.some((t) => t.id === prev.activeChatId);
  return {
    ...prev,
    ...remote,
    activeView: prev.activeView,
    activeSettingsSection: prev.activeSettingsSection,
    activePluginDetailId: prev.activePluginDetailId,
    selectedInboxItemId: prev.selectedInboxItemId,
    selectedTimelineEventId: prev.selectedTimelineEventId,
    timelinePluginFilter: prev.timelinePluginFilter,
    activeChatId: hasActiveChat ? prev.activeChatId : remote.activeChatId,
    onboardingStep: prev.onboardingStep,
  };
}

export interface ValetContextValue {
  state: ValetSnapshot;
  chatStream: ChatStreamPayload | null;
  toasts: ToastMessage[];
  nodTick: number;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  pushToast: (text: string, tone?: ToastMessage["tone"]) => void;
  dismissToast: (id: string) => void;
  triggerNod: () => void;

  // Responsive & layout chrome
  isCompactViewport: boolean;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  arrivalNotice: ArrivalNotice | null;
  clearArrivalNotice: () => void;

  // Navigation
  setOnboardingStep: (step: OnboardingStepId) => void;
  completeOnboarding: () => void;
  importExistingConfig: () => void;
  resetOnboarding: () => void;
  setActiveView: (view: AppView) => void;
  setActiveSettingsSection: (section: SettingsSectionId) => void;
  openSettingsSection: (section: SettingsSectionId) => void;
  openPluginDetail: (pluginId: string | null) => void;
  togglePauseValet: () => void;

  // Inbox approvals
  selectInboxItem: (itemId: string | null) => void;
  toggleInboxActionItem: (itemId: string, actionId: string) => void;
  approveInboxItem: (itemId: string) => void;
  dismissInboxItem: (itemId: string) => void;
  approveAllReversibleInboxItems: () => void;
  restoreApprovedInboxItem: (itemId: string) => void;

  // Permissions
  setPermissionGranted: (id: PermissionId, granted: boolean) => void;
  toggleMockAppPermission: (permissionId: PermissionId, appId: string) => void;
  refreshPermissions: () => void;

  // Plugins
  togglePluginEnabled: (pluginId: string) => void;
  installMarketplacePlugin: (pluginId: string) => void;
  installCustomPlugin: (params: { name: string; tagline: string; yaml: string }) => void;
  updatePluginManifest: (pluginId: string, yaml: string) => void;
  fixPluginAuth: (pluginId: string) => void;
  updatePluginEventPolicy: (pluginId: string, eventId: string, policy: EventPolicyMode) => void;
  updatePluginConfig: (pluginId: string, patch: Partial<PluginConfig>) => void;
  simulatePluginEvent: (pluginId: string, eventId: string) => void;

  // Providers & Agent
  selectProvider: (providerId: ProviderId) => void;
  updateProvider: (providerId: ProviderId, patch: Partial<AgentProviderConfig>) => void;
  updateModels: (patch: Partial<ModelSelection>) => void;
  setAutonomyLevel: (level: AutonomyLevel) => void;

  // First Scan
  runFirstScan: () => void;

  // Timeline
  selectTimelineEvent: (eventId: string | null) => void;
  setTimelinePluginFilter: (pluginId: string) => void;
  toggleTimelineActionItem: (eventId: string, actionId: string) => void;
  executeTimelineEventActions: (eventId: string) => void;
  ignoreTimelineEvent: (eventId: string) => void;
  restoreTimelineEvent: (eventId: string) => void;

  // Chat
  selectChatThread: (chatId: string) => void;
  createNewChat: () => void;
  updateChatThreadModel: (chatId: string, model: string) => void;
  sendChatMessage: (params: {
    prompt: string;
    mentionPlugin: PluginState | null;
    attachments: ChatAttachment[];
  }) => Promise<void>;
  performProcessAction: (
    chatId: string,
    messageId: string,
    action: "kill_primary" | "clean_disk" | "auto_rule"
  ) => void;
  installPluginDraft: (chatId: string, messageId: string, draft: PluginDraftSpec) => void;

  // Settings
  updatePreferences: (patch: Partial<ValetPreferences>) => void;
  resetThresholdsToDefault: () => void;
  toggleAutomation: (id: string) => void;
  addAutomationRule: (rule: Omit<AutomationRule, "id">) => void;
  runAutomationNow: (id: string) => void;
  deleteAutomationRule: (id: string) => void;
  toggleMcpServer: (id: string) => void;
  reconnectMcpServer: (id: string) => void;
  addMcpServer: (server: Omit<McpServerItem, "id">) => void;
  deleteMcpServer: (id: string) => void;
  deleteMemory: (id: string) => void;
  clearMemories: () => void;
  resetAllData: () => void;
}

const ValetContext = createContext<ValetContextValue | null>(null);

export const ValetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ValetSnapshot>(loadInitialState);
  const stateRef = useRef<ValetSnapshot>(state);
  stateRef.current = state;

  const [chatStream, setChatStream] = useState<ChatStreamPayload | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [nodTick, setNodTick] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [arrivalNotice, setArrivalNotice] = useState<ArrivalNotice | null>(null);

  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth <= 880 : false
  );
  const [manualSidebarCollapsed, setManualSidebarCollapsed] = useState<boolean | null>(null);

  const scanTimersRef = useRef<number[]>([]);

  useEffect(() => {
    const onResize = () => {
      const nextCompact = window.innerWidth <= 880;
      setIsCompactViewport((prevCompact) => {
        if (prevCompact !== nextCompact) {
          setManualSidebarCollapsed(null);
        }
        return nextCompact;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const sidebarCollapsed = manualSidebarCollapsed ?? isCompactViewport;

  const toggleSidebarCollapsed = useCallback(() => {
    setManualSidebarCollapsed((prev) => !(prev ?? isCompactViewport));
  }, [isCompactViewport]);

  const clearArrivalNotice = useCallback(() => {
    setArrivalNotice(null);
  }, []);

  // Persist snapshot (standalone browser mode only)
  useEffect(() => {
    if (isMyGo()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors
    }
  }, [state]);

  // Apply light/dark/auto theme to document root
  useEffect(() => {
    const applyTheme = () => {
      const mode = state.preferences.appearance;
      const isSystemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const resolved = mode === "auto" ? (isSystemDark ? "dark" : "light") : mode;
      document.documentElement.dataset.theme = resolved;
    };
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", applyTheme);
    return () => mq.removeEventListener("change", applyTheme);
  }, [state.preferences.appearance]);

  // Hydrate canonical state and subscribe to MyGo push events when hosted in MyGo
  useEffect(() => {
    if (!isMyGo()) return;
    let active = true;

    void Valet.getSnapshot()
      .then((snap) => {
        if (!active) return;
        setState(snap as unknown as ValetSnapshot);
      })
      .catch(() => {
        // Ignore startup errors if window closes early
      });

    const offMetrics = events.metricsUpdated.on((metrics) => {
      setState((prev) => ({
        ...prev,
        systemMetrics: metrics as unknown as ValetSnapshot["systemMetrics"],
      }));
    });

    const offChatStream = events.chatStream.on((payload) => {
      setChatStream(payload.phase === "done" || payload.phase === "error" ? null : payload);
    });

    const offStateChanged = events.stateChanged.on(() => {
      void Valet.getSnapshot()
        .then((snap) => {
          if (!active) return;
          setState((prev) => mergeBackendSnapshot(prev, snap));
        })
        .catch(() => {
          // Ignore refresh error
        });
    });

    return () => {
      active = false;
      offMetrics();
      offChatStream();
      offStateChanged();
    };
  }, []);

  // Subtle ambient telemetry simulation when on duty in standalone browser mode
  useEffect(() => {
    if (isMyGo() || !state.onboardingCompleted || state.isPaused) return;
    const timer = window.setInterval(() => {
      setState((prev) => {
        if (prev.isPaused) return prev;
        const cpuDelta = Math.round((Math.random() - 0.5) * 4);
        const memDelta = Math.round((Math.random() - 0.5) * 2);
        const nextCpu = Math.min(72, Math.max(14, prev.systemMetrics.cpuPct + cpuDelta));
        const nextMem = Math.min(82, Math.max(48, prev.systemMetrics.memPct + memDelta));
        return {
          ...prev,
          systemMetrics: {
            ...prev.systemMetrics,
            cpuPct: nextCpu,
            memPct: nextMem,
          },
        };
      });
    }, 3200);
    return () => window.clearInterval(timer);
  }, [state.onboardingCompleted, state.isPaused]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((text: string, tone: ToastMessage["tone"] = "default") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  const triggerNod = useCallback(() => {
    setNodTick((n) => n + 1);
  }, []);

  const syncFromBackend = useCallback(
    (promise: Promise<MyGoSnapshot>, replaceNav = false) => {
      void promise
        .then((snap) => {
          setState((prev) =>
            replaceNav ? (snap as unknown as ValetSnapshot) : mergeBackendSnapshot(prev, snap)
          );
        })
        .catch((err: unknown) => {
          pushToast(err instanceof Error ? err.message : String(err), "danger");
        });
    },
    [pushToast]
  );

  const setOnboardingStep = useCallback((step: OnboardingStepId) => {
    setState((prev) => ({ ...prev, onboardingStep: step }));
  }, []);

  const completeOnboarding = useCallback(() => {
    triggerNod();
    setState((prev) => ({
      ...prev,
      onboardingCompleted: true,
      activeView: "inbox",
    }));
    if (isMyGo()) {
      syncFromBackend(Valet.completeOnboarding(), true);
    }
  }, [syncFromBackend, triggerNod]);

  const importExistingConfig = useCallback(() => {
    const base = createInitialSnapshot();
    const grantedPerms = base.permissions.map((p) =>
      p.id === "full_disk" ||
      p.id === "accessibility" ||
      p.id === "notifications" ||
      p.id === "screen_recording"
        ? {
            ...p,
            granted: true,
            mockApps: p.mockApps.map((m) => (m.isValet ? { ...m, enabled: true } : m)),
          }
        : p
    );
    setState({
      ...base,
      permissions: grantedPerms,
      onboardingCompleted: true,
      activeView: "inbox",
    });
    triggerNod();
    pushToast("已导入历史配置，欢迎回来", "success");
    if (isMyGo()) {
      syncFromBackend(Valet.importExistingConfig(), true);
    }
  }, [pushToast, syncFromBackend, triggerNod]);

  const resetOnboarding = useCallback(() => {
    setState((prev) => ({
      ...prev,
      onboardingCompleted: false,
      onboardingStep: 1,
    }));
    if (isMyGo()) {
      syncFromBackend(Valet.resetOnboarding(), true);
    }
  }, [syncFromBackend]);

  const setActiveView = useCallback((view: AppView) => {
    setState((prev) => ({
      ...prev,
      activeView: view,
      activePluginDetailId: view === "plugins" ? prev.activePluginDetailId : null,
      selectedTimelineEventId: view === "timeline" ? prev.selectedTimelineEventId : null,
      selectedInboxItemId: view === "inbox" ? prev.selectedInboxItemId : null,
    }));
  }, []);

  const setActiveSettingsSection = useCallback((section: SettingsSectionId) => {
    setState((prev) => ({
      ...prev,
      activeSettingsSection: section,
    }));
  }, []);

  const openSettingsSection = useCallback((section: SettingsSectionId) => {
    setState((prev) => ({
      ...prev,
      activeView: "settings",
      activeSettingsSection: section,
      selectedInboxItemId: null,
      selectedTimelineEventId: null,
    }));
  }, []);

  const openPluginDetail = useCallback((pluginId: string | null) => {
    setState((prev) => ({
      ...prev,
      activeView: "plugins",
      activePluginDetailId: pluginId,
    }));
  }, []);

  const togglePauseValet = useCallback(() => {
    const nextPaused = !stateRef.current.isPaused;
    pushToast(
      nextPaused ? "Valet 已暂停，所有后台监听与自动动作已挂起" : "Valet 已恢复在岗",
      nextPaused ? "warning" : "success"
    );
    setState((prev) => ({
      ...prev,
      isPaused: !prev.isPaused,
      isOnDuty: prev.isPaused,
    }));
    if (isMyGo()) {
      syncFromBackend(Valet.togglePause());
    }
  }, [pushToast, syncFromBackend]);

  const selectInboxItem = useCallback((itemId: string | null) => {
    setState((prev) => ({ ...prev, selectedInboxItemId: itemId }));
  }, []);

  const toggleInboxActionItem = useCallback(
    (itemId: string, actionId: string) => {
      setState((prev) => {
        const target = prev.inboxItems.find((i) => i.id === itemId);
        const linkedEvtId = target?.linkedTimelineEventId;
        return {
          ...prev,
          inboxItems: prev.inboxItems.map((it) => {
            if (it.id !== itemId) return it;
            const nextItems = it.actionItems.map((a) =>
              a.id === actionId ? { ...a, checked: !a.checked } : a
            );
            return {
              ...it,
              actionItems: nextItems,
              reclaimableGB: computeSelectedGB(nextItems, it.reclaimableGB ?? 0),
            };
          }),
          timelineEvents: linkedEvtId
            ? prev.timelineEvents.map((evt) =>
                evt.id !== linkedEvtId
                  ? evt
                  : {
                      ...evt,
                      actionItems: evt.actionItems.map((a) =>
                        a.id === actionId ? { ...a, checked: !a.checked } : a
                      ),
                    }
              )
            : prev.timelineEvents,
        };
      });
      if (isMyGo()) {
        syncFromBackend(Valet.toggleInboxActionItem(itemId, actionId));
      }
    },
    [syncFromBackend]
  );

  const approveInboxItem = useCallback(
    (itemId: string) => {
      const target = stateRef.current.inboxItems.find((i) => i.id === itemId);
      if (!target || target.status !== "pending") return;

      const reclaimed =
        target.actionItems.some((a) => a.sizeMB > 0)
          ? computeSelectedGB(target.actionItems, target.reclaimableGB ?? 0)
          : target.reclaimableGB ?? 0;

      const toastMsg = target.reversible7d
        ? `已批准「${target.pluginName}」清理 ${reclaimed > 0 ? `${reclaimed} GB` : ""}（7 天内可还原）`
        : `已批准并执行「${target.title}」`;

      if (isMyGo()) {
        void Valet.approveInboxItem(itemId)
          .then((snap) => {
            setState((prev) =>
              mergeBackendSnapshot(
                {
                  ...prev,
                  selectedInboxItemId:
                    prev.selectedInboxItemId === itemId ? null : prev.selectedInboxItemId,
                },
                snap
              )
            );
            triggerNod();
            pushToast(toastMsg, "success");
          })
          .catch((err: unknown) => {
            pushToast(err instanceof Error ? err.message : String(err), "danger");
          });
        return;
      }

      setState((prev) => {
        const cur = prev.inboxItems.find((i) => i.id === itemId);
        if (!cur || cur.status !== "pending") return prev;

        const nowTime = new Date().toTimeString().slice(0, 5);
        const nextInbox = prev.inboxItems.map((it) =>
          it.id === itemId
            ? {
                ...it,
                status: "approved" as const,
                processedAt: nowTime,
                reclaimedGB: reclaimed,
                traceSteps: it.traceSteps.map((s) => ({ ...s, status: "done" as const })),
              }
            : it
        );

        let nextTimeline = prev.timelineEvents;
        if (cur.linkedTimelineEventId) {
          nextTimeline = prev.timelineEvents.map((evt) =>
            evt.id === cur.linkedTimelineEventId
              ? {
                  ...evt,
                  status: "completed" as const,
                  reclaimedGB: reclaimed > 0 ? reclaimed : evt.reclaimedGB,
                  canRestore: cur.reversible7d,
                  summary: cur.reversible7d
                    ? `已在收件箱批准并移入废纸篓（释放 ${reclaimed} GB，7 天内可还原）。`
                    : `已在收件箱批准并执行完成。`,
                  traceSteps: evt.traceSteps.map((s) => ({ ...s, status: "done" as const })),
                }
              : evt
          );
        } else {
          const newEvt: TimelineEvent = {
            id: `evt-from-${cur.id}`,
            timestamp: new Date().toISOString(),
            timeLabel: nowTime,
            dayGroup: "today",
            title: cur.title,
            summary: cur.reversible7d
              ? `已在收件箱批准处理（${reclaimed > 0 ? `释放 ${reclaimed} GB，` : ""}7 天内可还原）。`
              : cur.category === "process"
                ? "已向进程发送 SIGTERM 并释放系统资源。"
                : "已在收件箱批准外发该日程顺延消息。",
            pluginId: cur.pluginId,
            pluginName: cur.pluginName,
            pluginBadge: cur.pluginBadge,
            eventCode: cur.eventCode,
            status: "completed",
            reclaimedGB: reclaimed > 0 ? reclaimed : undefined,
            intercepted: cur.category === "process",
            canRestore: cur.reversible7d,
            triggerLatencyLabel: `${nowTime} · 收件箱批准执行`,
            payload: cur.payload,
            reasoning: cur.reasoning,
            actionItems: cur.actionItems,
            traceSteps: cur.traceSteps.map((s) => ({ ...s, status: "done" as const })),
            logs: cur.logs,
          };
          nextTimeline = [newEvt, ...prev.timelineEvents];
        }

        const freedDiskDelta = Math.max(0, reclaimed);
        const pctDrop = Math.round((freedDiskDelta / prev.systemMetrics.diskTotalGB) * 100);
        const nextDiskPct = Math.max(42, prev.systemMetrics.diskPct - pctDrop);
        const nextDiskFree = Number((prev.systemMetrics.diskFreeGB + freedDiskDelta).toFixed(1));

        return {
          ...prev,
          selectedInboxItemId:
            prev.selectedInboxItemId === itemId ? null : prev.selectedInboxItemId,
          inboxItems: nextInbox,
          inboxProcessedHistoryCount: prev.inboxProcessedHistoryCount + 1,
          timelineEvents: nextTimeline,
          systemMetrics: {
            ...prev.systemMetrics,
            diskPct: nextDiskPct,
            diskFreeGB: nextDiskFree,
          },
        };
      });
      triggerNod();
      pushToast(toastMsg, "success");
    },
    [pushToast, triggerNod]
  );

  const dismissInboxItem = useCallback(
    (itemId: string) => {
      setState((prev) => {
        const target = prev.inboxItems.find((i) => i.id === itemId);
        if (!target || target.status !== "pending") return prev;
        const nowTime = new Date().toTimeString().slice(0, 5);
        return {
          ...prev,
          selectedInboxItemId:
            prev.selectedInboxItemId === itemId ? null : prev.selectedInboxItemId,
          inboxItems: prev.inboxItems.map((it) =>
            it.id === itemId
              ? { ...it, status: "dismissed" as const, processedAt: nowTime }
              : it
          ),
          inboxProcessedHistoryCount: prev.inboxProcessedHistoryCount + 1,
          timelineEvents: target.linkedTimelineEventId
            ? prev.timelineEvents.map((evt) =>
                evt.id === target.linkedTimelineEventId
                  ? {
                      ...evt,
                      status: "completed" as const,
                      ignored: true,
                      summary: "已在收件箱选择保留 / 忽略，未做任何改动。",
                    }
                  : evt
              )
            : prev.timelineEvents,
        };
      });
      pushToast("已忽略该待批事项，未做任何改动");
      if (isMyGo()) {
        syncFromBackend(Valet.dismissInboxItem(itemId));
      }
    },
    [pushToast, syncFromBackend]
  );

  const approveAllReversibleInboxItems = useCallback(() => {
    const targets = stateRef.current.inboxItems.filter(
      (i) => i.status === "pending" && i.reversible7d
    );
    if (targets.length === 0) return;

    const batchCount = targets.length;
    const totalFreed = Number(
      targets
        .reduce((acc, t) => {
          const g = t.actionItems.some((a) => a.sizeMB > 0)
            ? computeSelectedGB(t.actionItems, t.reclaimableGB ?? 0)
            : t.reclaimableGB ?? 0;
          return acc + g;
        }, 0)
        .toFixed(1)
    );

    if (isMyGo()) {
      void Valet.approveAllReversible()
        .then((snap) => {
          setState((prev) =>
            mergeBackendSnapshot({ ...prev, selectedInboxItemId: null }, snap)
          );
          triggerNod();
          pushToast(
            `已批量批准 ${batchCount} 个可还原项，释放 ${totalFreed} GB（7 天内可从时间线/已处理还原）`,
            "success"
          );
        })
        .catch((err: unknown) => {
          pushToast(err instanceof Error ? err.message : String(err), "danger");
        });
      return;
    }

    setState((prev) => {
      const curTargets = prev.inboxItems.filter(
        (i) => i.status === "pending" && i.reversible7d
      );
      if (curTargets.length === 0) return prev;

      const nowTime = new Date().toTimeString().slice(0, 5);
      const targetIds = new Set(curTargets.map((t) => t.id));
      const linkedIds = new Set(
        curTargets.map((t) => t.linkedTimelineEventId).filter(Boolean) as string[]
      );

      const nextInbox = prev.inboxItems.map((it) =>
        targetIds.has(it.id)
          ? {
              ...it,
              status: "approved" as const,
              processedAt: nowTime,
              traceSteps: it.traceSteps.map((s) => ({ ...s, status: "done" as const })),
            }
          : it
      );

      const newTimelineFromUnlinked: TimelineEvent[] = curTargets
        .filter((t) => !t.linkedTimelineEventId)
        .map((t) => ({
          id: `evt-batch-${t.id}`,
          timestamp: new Date().toISOString(),
          timeLabel: nowTime,
          dayGroup: "today" as const,
          title: t.title,
          summary: `已在收件箱批量批准移入废纸篓（释放 ${t.reclaimableGB ?? 0} GB，7 天内可还原）。`,
          pluginId: t.pluginId,
          pluginName: t.pluginName,
          pluginBadge: t.pluginBadge,
          eventCode: t.eventCode,
          status: "completed" as const,
          reclaimedGB: t.reclaimableGB,
          canRestore: true,
          triggerLatencyLabel: `${nowTime} · 收件箱批量批准`,
          payload: t.payload,
          reasoning: t.reasoning,
          actionItems: t.actionItems,
          traceSteps: t.traceSteps.map((s) => ({ ...s, status: "done" as const })),
          logs: t.logs,
        }));

      const updatedExistingTimeline = prev.timelineEvents.map((evt) =>
        linkedIds.has(evt.id)
          ? {
              ...evt,
              status: "completed" as const,
              canRestore: true,
              reclaimedGB: computeSelectedGB(evt.actionItems, evt.reclaimedGB ?? 0),
              summary: "已在收件箱批量批准并移入废纸篓（7 天内可还原）。",
              traceSteps: evt.traceSteps.map((s) => ({ ...s, status: "done" as const })),
            }
          : evt
      );

      const pctDrop = Math.round((totalFreed / prev.systemMetrics.diskTotalGB) * 100);
      const nextDiskPct = Math.max(42, prev.systemMetrics.diskPct - pctDrop);
      const nextDiskFree = Number((prev.systemMetrics.diskFreeGB + totalFreed).toFixed(1));

      return {
        ...prev,
        selectedInboxItemId: null,
        inboxItems: nextInbox,
        inboxProcessedHistoryCount: prev.inboxProcessedHistoryCount + curTargets.length,
        timelineEvents: [...newTimelineFromUnlinked, ...updatedExistingTimeline],
        systemMetrics: {
          ...prev.systemMetrics,
          diskPct: nextDiskPct,
          diskFreeGB: nextDiskFree,
        },
      };
    });

    triggerNod();
    pushToast(
      `已批量批准 ${batchCount} 个可还原项，释放 ${totalFreed} GB（7 天内可从时间线/已处理还原）`,
      "success"
    );
  }, [pushToast, triggerNod]);

  const restoreApprovedInboxItem = useCallback(
    (itemId: string) => {
      setState((prev) => {
        const target = prev.inboxItems.find((i) => i.id === itemId);
        if (!target || target.status !== "approved" || !target.reversible7d) return prev;
        const reclaimed = target.reclaimableGB ?? 0;
        const pctAdd = Math.round((reclaimed / prev.systemMetrics.diskTotalGB) * 100);

        return {
          ...prev,
          inboxItems: prev.inboxItems.map((it) =>
            it.id === itemId ? { ...it, restored: true } : it
          ),
          timelineEvents: prev.timelineEvents.map((evt) =>
            evt.id === target.linkedTimelineEventId || evt.id === `evt-from-${itemId}` || evt.id === `evt-batch-${itemId}`
              ? { ...evt, restored: true, canRestore: false }
              : evt
          ),
          systemMetrics: {
            ...prev.systemMetrics,
            diskPct: Math.min(96, prev.systemMetrics.diskPct + pctAdd),
            diskFreeGB: Math.max(12, Number((prev.systemMetrics.diskFreeGB - reclaimed).toFixed(1))),
          },
        };
      });
      triggerNod();
      pushToast("已从废纸篓一键还原对应文件", "success");
      if (isMyGo()) {
        syncFromBackend(Valet.restoreApprovedInboxItem(itemId));
      }
    },
    [pushToast, syncFromBackend, triggerNod]
  );

  const setPermissionGranted = useCallback(
    (id: PermissionId, granted: boolean) => {
      setState((prev) => ({
        ...prev,
        permissions: prev.permissions.map((perm) =>
          perm.id === id
            ? {
                ...perm,
                granted,
                mockApps: perm.mockApps.map((app) =>
                  app.isValet ? { ...app, enabled: granted } : app
                ),
              }
            : perm
        ),
      }));
      if (granted) {
        triggerNod();
      }
      if (isMyGo()) {
        syncFromBackend(Valet.setPermissionGranted(id, granted));
      }
    },
    [syncFromBackend, triggerNod]
  );

  const toggleMockAppPermission = useCallback(
    (permissionId: PermissionId, appId: string) => {
      const targetPerm = stateRef.current.permissions.find((p) => p.id === permissionId);
      const toggledApp = targetPerm?.mockApps.find((a) => a.id === appId);
      const nextValetGranted =
        toggledApp?.isValet ? !toggledApp.enabled : undefined;

      setState((prev) => ({
        ...prev,
        permissions: prev.permissions.map((perm) => {
          if (perm.id !== permissionId) return perm;
          const nextApps = perm.mockApps.map((app) =>
            app.id === appId ? { ...app, enabled: !app.enabled } : app
          );
          const valetApp = nextApps.find((a) => a.isValet);
          return {
            ...perm,
            granted: valetApp ? valetApp.enabled : perm.granted,
            mockApps: nextApps,
          };
        }),
      }));

      if (isMyGo() && nextValetGranted !== undefined) {
        syncFromBackend(Valet.setPermissionGranted(permissionId, nextValetGranted));
      }
    },
    [syncFromBackend]
  );

  const togglePluginEnabled = useCallback(
    (pluginId: string) => {
      setState((prev) => ({
        ...prev,
        plugins: prev.plugins.map((pl) =>
          pl.id === pluginId ? { ...pl, enabled: !pl.enabled } : pl
        ),
      }));
      triggerNod();
      if (isMyGo()) {
        syncFromBackend(Valet.togglePluginEnabled(pluginId));
      }
    },
    [syncFromBackend, triggerNod]
  );

  const installMarketplacePlugin = useCallback(
    (pluginId: string) => {
      setState((prev) => ({
        ...prev,
        plugins: prev.plugins.map((pl) =>
          pl.id === pluginId ? { ...pl, installed: true, enabled: true } : pl
        ),
      }));
      triggerNod();
      pushToast("插件已安装并启用", "success");
      if (isMyGo()) {
        syncFromBackend(Valet.installMarketplacePlugin(pluginId));
      }
    },
    [pushToast, syncFromBackend, triggerNod]
  );

  const installCustomPlugin = useCallback(
    (params: { name: string; tagline: string; yaml: string }) => {
      if (isMyGo()) {
        void Valet.installCustomPlugin(params)
          .then((snap) => {
            setState((prev) => mergeBackendSnapshot(prev, snap));
            triggerNod();
            pushToast(`已安装本地插件「${params.name.trim() || "自定义本地插件"}」`, "success");
          })
          .catch((err: unknown) => {
            pushToast(err instanceof Error ? err.message : String(err), "danger");
          });
        return;
      }

      const slug = `local-${Date.now().toString(36).slice(-4)}`;
      const newPlugin: PluginState = {
        id: slug,
        slug,
        name: params.name.trim() || "自定义本地插件",
        tagline: params.tagline.trim() || "~/Valet/plugins/custom · 本地开发",
        description: "通过本地 Manifest YAML 导入的自定义事件响应插件。",
        version: "v0.1.0",
        bundleId: `local.valet.${slug}`,
        iconKind: "code",
        iconLabel: "{ }",
        source: "local",
        enabled: true,
        installed: true,
        statusSubtitle: "~/Valet/plugins/custom · 热重载中",
        triggers24h: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
        events: [
          {
            id: "custom.event_triggered",
            description: "自定义 Manifest 触发规则",
            policy: "ask",
            count24h: 0,
          },
        ],
        actions: [{ id: "custom.run_action", safety: "reversible", safetyLabel: "可撤销" }],
        config: {},
        manifestYaml: params.yaml,
      };
      setState((prev) => ({
        ...prev,
        plugins: [...prev.plugins, newPlugin],
      }));
      triggerNod();
      pushToast(`已安装本地插件「${newPlugin.name}」`, "success");
    },
    [pushToast, triggerNod]
  );

  const updatePluginManifest = useCallback(
    (pluginId: string, yaml: string) => {
      if (isMyGo()) {
        void Valet.updatePluginManifest(pluginId, yaml)
          .then((snap) => {
            setState((prev) => mergeBackendSnapshot(prev, snap));
            triggerNod();
            pushToast("已保存插件 Manifest 并热重载", "success");
          })
          .catch((err: unknown) => {
            pushToast(err instanceof Error ? err.message : String(err), "danger");
          });
        return;
      }
      setState((prev) => ({
        ...prev,
        plugins: prev.plugins.map((pl) =>
          pl.id === pluginId
            ? {
                ...pl,
                manifestYaml: yaml,
                statusSubtitle: "刚刚热重载 · Manifest 已生效",
              }
            : pl
        ),
      }));
      triggerNod();
      pushToast("已保存插件 Manifest 并热重载", "success");
    },
    [pushToast, triggerNod]
  );

  const fixPluginAuth = useCallback(
    (pluginId: string) => {
      setState((prev) => ({
        ...prev,
        plugins: prev.plugins.map((pl) =>
          pl.id === pluginId
            ? {
                ...pl,
                authError: undefined,
                statusSubtitle: "刚刚重新授权 · 正常运行",
              }
            : pl
        ),
        timelineEvents: prev.timelineEvents.map((evt) =>
          evt.authFixPluginId === pluginId && evt.status === "failed"
            ? {
                ...evt,
                status: "completed",
                summary: "Token 已重新授权并完成构建日志读取，CI 失败源于测试超时。",
              }
            : evt
        ),
      }));
      triggerNod();
      pushToast("插件授权已刷新", "success");
      if (isMyGo()) {
        syncFromBackend(Valet.fixPluginAuth(pluginId));
      }
    },
    [pushToast, syncFromBackend, triggerNod]
  );

  const updatePluginEventPolicy = useCallback(
    (pluginId: string, eventId: string, policy: EventPolicyMode) => {
      setState((prev) => ({
        ...prev,
        plugins: prev.plugins.map((pl) =>
          pl.id !== pluginId
            ? pl
            : {
                ...pl,
                events: pl.events.map((ev) => (ev.id === eventId ? { ...ev, policy } : ev)),
              }
        ),
      }));
      if (isMyGo()) {
        syncFromBackend(Valet.updatePluginEventPolicy(pluginId, eventId, policy));
      }
    },
    [syncFromBackend]
  );

  const updatePluginConfig = useCallback(
    (pluginId: string, patch: Partial<PluginConfig>) => {
      const target = stateRef.current.plugins.find((pl) => pl.id === pluginId);
      const nextConfig = target ? { ...target.config, ...patch } : patch;
      setState((prev) => ({
        ...prev,
        plugins: prev.plugins.map((pl) =>
          pl.id === pluginId ? { ...pl, config: { ...pl.config, ...patch } } : pl
        ),
      }));
      if (isMyGo()) {
        syncFromBackend(Valet.updatePluginConfig(pluginId, nextConfig as MyGoPluginConfig));
      }
    },
    [syncFromBackend]
  );

  const simulatePluginEvent = useCallback(
    (pluginId: string, eventId: string) => {
      if (isMyGo()) {
        void Valet.simulatePluginEvent(pluginId, eventId)
          .then((res) => {
            setArrivalNotice({
              id: res.event.id,
              pluginName: res.event.pluginName,
              eventCode: eventId,
            });
            triggerNod();
            pushToast("已向时间线注入模拟事件", "success");
            syncFromBackend(Valet.getSnapshot());
          })
          .catch((err: unknown) => {
            pushToast(err instanceof Error ? err.message : String(err), "danger");
          });
        return;
      }

      let notice: ArrivalNotice | null = null;
      setState((prev) => {
        const plugin = prev.plugins.find((p) => p.id === pluginId);
        if (!plugin) return prev;
        const { event: created, inboxItem } = valetService.createSimulatedPluginEvent(
          plugin,
          eventId
        );
        notice = {
          id: created.id,
          pluginName: plugin.name,
          eventCode: eventId,
        };
        return {
          ...prev,
          timelineEvents: [created, ...prev.timelineEvents],
          inboxItems: inboxItem ? [inboxItem, ...prev.inboxItems] : prev.inboxItems,
          plugins: prev.plugins.map((p) => {
            if (p.id !== pluginId) return p;
            const bars = [...p.triggers24h];
            const lastIdx = bars.length - 1;
            if (lastIdx >= 0) {
              bars[lastIdx] = (bars[lastIdx] ?? 0) + 2;
            }
            return {
              ...p,
              triggers24h: bars,
              events: p.events.map((ev) =>
                ev.id === eventId ? { ...ev, count24h: ev.count24h + 1 } : ev
              ),
            };
          }),
        };
      });
      if (notice) {
        setArrivalNotice(notice);
      }
      triggerNod();
      pushToast("已向时间线注入模拟事件", "success");
    },
    [pushToast, syncFromBackend, triggerNod]
  );

  const selectProvider = useCallback(
    (providerId: ProviderId) => {
      setState((prev) => {
        const target = prev.providers.find((p) => p.id === providerId);
        const models = target?.models ?? [];
        const nextBase: ValetSnapshot = {
          ...prev,
          providers: prev.providers.map((p) =>
            p.id === providerId ? { ...p, connected: p.verified || p.id === "ollama" } : p
          ),
          preferences: {
            ...prev.preferences,
            activeProviderId: providerId,
          },
        };
        return {
          ...nextBase,
          ...reconcileProviderModelSelection(nextBase, models),
        };
      });
      if (isMyGo()) {
        syncFromBackend(Valet.selectProvider(providerId));
      }
    },
    [syncFromBackend]
  );

  const updateProvider = useCallback(
    (providerId: ProviderId, patch: Partial<AgentProviderConfig>) => {
      const existing = stateRef.current.providers.find((p) => p.id === providerId);
      setState((prev) => {
        const nextProviders = prev.providers.map((p) =>
          p.id === providerId ? { ...p, ...patch } : p
        );
        if (
          prev.preferences.activeProviderId === providerId &&
          patch.models &&
          patch.models.length > 0
        ) {
          return {
            ...prev,
            providers: nextProviders,
            ...reconcileProviderModelSelection(prev, patch.models),
          };
        }
        return {
          ...prev,
          providers: nextProviders,
        };
      });
      if (isMyGo() && existing) {
        const merged = { ...existing, ...patch, id: providerId };
        syncFromBackend(Valet.updateProvider(providerId, merged as unknown as MyGoProviderConfig));
      }
    },
    [syncFromBackend]
  );

  const updateModels = useCallback(
    (patch: Partial<ModelSelection>) => {
      const nextModels = { ...stateRef.current.preferences.models, ...patch };
      setState((prev) => {
        const nextThreads = nextModels.primary
          ? prev.chatThreads.map((t) => ({ ...t, model: nextModels.primary }))
          : prev.chatThreads;
        return {
          ...prev,
          preferences: {
            ...prev.preferences,
            models: nextModels,
          },
          chatThreads: nextThreads,
        };
      });
      if (isMyGo()) {
        syncFromBackend(Valet.updateModels(nextModels as MyGoModelSelection));
      }
    },
    [syncFromBackend]
  );

  const setAutonomyLevel = useCallback(
    (level: AutonomyLevel) => {
      setState((prev) => ({
        ...prev,
        preferences: { ...prev.preferences, autonomyLevel: level },
      }));
      if (isMyGo()) {
        syncFromBackend(Valet.setAutonomyLevel(level));
      }
    },
    [syncFromBackend]
  );

  const runFirstScan = useCallback(() => {
    scanTimersRef.current.forEach((id) => window.clearTimeout(id));
    scanTimersRef.current = [];

    if (isMyGo()) {
      setState((prev) => ({
        ...prev,
        scan: {
          status: "running",
          progressPct: 24,
          elapsedSec: 1,
          reclaimableGB: 0,
          tasks: [
            {
              id: "disk",
              title: "磁盘",
              detail: "正在扫描 Xcode、模拟器与包管理器缓存…",
              sizeLabel: "…",
              sizeGB: 0,
              status: "running",
            },
            {
              id: "orphan",
              title: "卸载残留",
              detail: "正在扫描 ~/Library 孤儿目录…",
              sizeLabel: "…",
              sizeGB: 0,
              status: "running",
            },
            {
              id: "process",
              title: "进程",
              detail: "正在采样实时 CPU / 内存占用…",
              sizeLabel: "…",
              sizeGB: 0,
              status: "running",
            },
            {
              id: "log",
              title: "系统日志",
              detail: "正在检查近期崩溃报告…",
              sizeLabel: "…",
              sizeGB: 0,
              status: "running",
            },
          ],
        },
      }));
      void Valet.runFirstScan()
        .then((snap) => {
          setState((prev) => mergeBackendSnapshot(prev, snap));
          triggerNod();
        })
        .catch((err: unknown) => {
          pushToast(err instanceof Error ? err.message : String(err), "danger");
        });
      return;
    }

    setState((prev) => {
      const logPluginEnabled =
        prev.plugins.find((p) => p.id === "log-detective")?.enabled ?? false;
      const tasks: ScanTaskItem[] = [
        {
          id: "disk",
          title: "磁盘",
          detail: "正在扫描 Xcode、模拟器与包管理器缓存…",
          sizeLabel: "…",
          sizeGB: 0,
          status: "running",
        },
        {
          id: "orphan",
          title: "卸载残留",
          detail: "等待磁盘扫描完成",
          sizeLabel: "…",
          sizeGB: 0,
          status: "pending",
        },
        {
          id: "process",
          title: "进程",
          detail: "等待采样 30 秒内的 CPU / 内存…",
          sizeLabel: "—",
          sizeGB: 0,
          status: "pending",
        },
        {
          id: "log",
          title: "系统日志",
          detail: logPluginEnabled ? "等待日志归因分析" : "日志侦探未启用，已跳过",
          sizeLabel: "—",
          sizeGB: 0,
          status: logPluginEnabled ? "pending" : "skipped",
        },
      ];
      return {
        ...prev,
        scan: {
          status: "running",
          progressPct: 12,
          elapsedSec: 4,
          reclaimableGB: 0,
          tasks,
        },
      };
    });

    const t1 = window.setTimeout(() => {
      setState((prev) => ({
        ...prev,
        scan: {
          ...prev.scan,
          progressPct: 38,
          elapsedSec: 16,
          reclaimableGB: 18.4,
          tasks: prev.scan.tasks.map((t) =>
            t.id === "disk"
              ? {
                  ...t,
                  status: "done",
                  detail: "可用 38 GB / 494 GB · 发现 18.4 GB 开发缓存",
                  sizeLabel: "18.4 GB",
                  sizeGB: 18.4,
                }
              : t.id === "orphan"
                ? { ...t, status: "running", detail: "正在比对 /Applications 与 ~/Library…" }
                : t
          ),
        },
      }));
    }, 650);

    const t2 = window.setTimeout(() => {
      setState((prev) => ({
        ...prev,
        scan: {
          ...prev.scan,
          progressPct: 68,
          elapsedSec: 29,
          reclaimableGB: 23.1,
          tasks: prev.scan.tasks.map((t) =>
            t.id === "orphan"
              ? {
                  ...t,
                  status: "done",
                  detail: "3 个已删除的 App 留下 41 项文件",
                  sizeLabel: "4.7 GB",
                  sizeGB: 4.7,
                }
              : t.id === "process"
                ? {
                    ...t,
                    status: "running",
                    detail: "正在采样 30 秒内的 CPU / 内存…",
                    sizeLabel: "12s",
                    durationHint: "12s",
                  }
                : t
          ),
        },
      }));
    }, 1350);

    const t3 = window.setTimeout(() => {
      setState((prev) => {
        const logEnabled = prev.plugins.find((p) => p.id === "log-detective")?.enabled ?? false;
        return {
          ...prev,
          scan: {
            status: "done",
            progressPct: 100,
            elapsedSec: 42,
            reclaimableGB: 23.1,
            tasks: prev.scan.tasks.map((t) => {
              if (t.id === "process") {
                return {
                  ...t,
                  status: "done",
                  detail: "发现 1 个异常 vite 进程（CPU 240%）",
                  sizeLabel: "1.9 GB",
                  sizeGB: 1.9,
                };
              }
              if (t.id === "log" && logEnabled) {
                return {
                  ...t,
                  status: "done",
                  detail: "关联到 3 次 WindowServer 异常报告",
                  sizeLabel: "1 份",
                  sizeGB: 0,
                };
              }
              return t;
            }),
          },
        };
      });
      triggerNod();
    }, 2250);

    scanTimersRef.current = [t1, t2, t3];
  }, [pushToast, triggerNod]);

  const selectTimelineEvent = useCallback((eventId: string | null) => {
    setState((prev) => ({ ...prev, selectedTimelineEventId: eventId }));
  }, []);

  const setTimelinePluginFilter = useCallback((pluginId: string) => {
    setState((prev) => ({ ...prev, timelinePluginFilter: pluginId }));
  }, []);

  const toggleTimelineActionItem = useCallback(
    (eventId: string, actionId: string) => {
      setState((prev) => ({
        ...prev,
        timelineEvents: prev.timelineEvents.map((evt) =>
          evt.id !== eventId
            ? evt
            : {
                ...evt,
                actionItems: evt.actionItems.map((item) =>
                  item.id === actionId ? { ...item, checked: !item.checked } : item
                ),
              }
        ),
        inboxItems: prev.inboxItems.map((it) => {
          if (it.linkedTimelineEventId !== eventId) return it;
          const nextItems = it.actionItems.map((a) =>
            a.id === actionId ? { ...a, checked: !a.checked } : a
          );
          return {
            ...it,
            actionItems: nextItems,
            reclaimableGB: computeSelectedGB(nextItems, it.reclaimableGB ?? 0),
          };
        }),
      }));
      if (isMyGo()) {
        syncFromBackend(Valet.toggleTimelineActionItem(eventId, actionId));
      }
    },
    [syncFromBackend]
  );

  const executeTimelineEventActions = useCallback(
    (eventId: string) => {
      const target = stateRef.current.timelineEvents.find((e) => e.id === eventId);
      if (!target) return;

      const selectedMB = target.actionItems
        .filter((item) => item.checked)
        .reduce((acc, item) => acc + item.sizeMB, 0);
      const reclaimedGB = Number((selectedMB / 1024).toFixed(1));
      const cleanedGBLabel = reclaimedGB > 0 ? `${reclaimedGB} GB` : "所选项目";

      if (isMyGo()) {
        void Valet.executeTimelineEvent(eventId)
          .then((snap) => {
            setState((prev) =>
              mergeBackendSnapshot({ ...prev, selectedTimelineEventId: null }, snap)
            );
            triggerNod();
            pushToast(`已移入废纸篓（${cleanedGBLabel || "完成"}），7 天内可还原`, "success");
          })
          .catch((err: unknown) => {
            pushToast(err instanceof Error ? err.message : String(err), "danger");
          });
        return;
      }

      setState((prev) => {
        const cur = prev.timelineEvents.find((e) => e.id === eventId);
        if (!cur) return prev;
        const nowTime = new Date().toTimeString().slice(0, 5);

        const nextEvents = prev.timelineEvents.map((evt) => {
          if (evt.id !== eventId) return evt;
          return {
            ...evt,
            status: "completed" as const,
            reclaimedGB: reclaimedGB > 0 ? reclaimedGB : evt.reclaimedGB,
            canRestore: selectedMB > 0,
            restored: false,
            ignored: false,
            summary:
              selectedMB > 0
                ? `已按你的确认将 ${cleanedGBLabel} 移入废纸篓，保留了用户文件（7 天内可还原）。`
                : "已执行你勾选的清理项目。",
            traceSteps: evt.traceSteps.map((s) => ({ ...s, status: "done" as const })),
            logs: [
              ...evt.logs,
              {
                id: `log-done-${Date.now()}`,
                ts: new Date().toTimeString().slice(0, 8),
                level: "EXEC" as const,
                message: `Moved ${cleanedGBLabel} to Trash cleanly (7-day restore enabled)`,
              },
            ],
          };
        });

        const hasLinkedInboxPending = prev.inboxItems.some(
          (i) => i.linkedTimelineEventId === eventId && i.status === "pending"
        );
        const pctDrop = Math.round((reclaimedGB / prev.systemMetrics.diskTotalGB) * 100);

        return {
          ...prev,
          selectedTimelineEventId: null,
          timelineEvents: nextEvents,
          inboxItems: prev.inboxItems.map((it) =>
            it.linkedTimelineEventId === eventId
              ? { ...it, status: "approved" as const, processedAt: nowTime }
              : it
          ),
          inboxProcessedHistoryCount:
            prev.inboxProcessedHistoryCount + (hasLinkedInboxPending ? 1 : 0),
          systemMetrics: {
            ...prev.systemMetrics,
            diskPct: Math.max(42, prev.systemMetrics.diskPct - pctDrop),
            diskFreeGB: Number((prev.systemMetrics.diskFreeGB + reclaimedGB).toFixed(1)),
          },
        };
      });
      triggerNod();
      pushToast(`已移入废纸篓（${cleanedGBLabel || "完成"}），7 天内可还原`, "success");
    },
    [pushToast, triggerNod]
  );

  const ignoreTimelineEvent = useCallback(
    (eventId: string) => {
      setState((prev) => {
        const nowTime = new Date().toTimeString().slice(0, 5);
        const hasLinkedInboxPending = prev.inboxItems.some(
          (i) => i.linkedTimelineEventId === eventId && i.status === "pending"
        );
        return {
          ...prev,
          selectedTimelineEventId: null,
          timelineEvents: prev.timelineEvents.map((evt) =>
            evt.id === eventId
              ? {
                  ...evt,
                  status: "completed",
                  ignored: true,
                  summary: "已按你的选择忽略本次提醒，不会改动任何文件。",
                }
              : evt
          ),
          inboxItems: prev.inboxItems.map((it) =>
            it.linkedTimelineEventId === eventId
              ? { ...it, status: "dismissed" as const, processedAt: nowTime }
              : it
          ),
          inboxProcessedHistoryCount:
            prev.inboxProcessedHistoryCount + (hasLinkedInboxPending ? 1 : 0),
        };
      });
      pushToast("已忽略该事件");
      if (isMyGo()) {
        syncFromBackend(Valet.ignoreTimelineEvent(eventId));
      }
    },
    [pushToast, syncFromBackend]
  );

  const restoreTimelineEvent = useCallback(
    (eventId: string) => {
      setState((prev) => ({
        ...prev,
        timelineEvents: prev.timelineEvents.map((evt) =>
          evt.id === eventId
            ? {
                ...evt,
                restored: true,
                canRestore: false,
                summary: "已从废纸篓还原全部已清理文件。",
              }
            : evt
        ),
        inboxItems: prev.inboxItems.map((it) =>
          it.linkedTimelineEventId === eventId ? { ...it, restored: true } : it
        ),
      }));
      triggerNod();
      pushToast("已从废纸篓一键还原", "success");
      if (isMyGo()) {
        syncFromBackend(Valet.restoreTimelineEvent(eventId));
      }
    },
    [pushToast, syncFromBackend, triggerNod]
  );

  const selectChatThread = useCallback((chatId: string) => {
    setState((prev) => ({
      ...prev,
      activeView: "chat",
      activeChatId: chatId,
    }));
  }, []);

  const createNewChat = useCallback(() => {
    if (isMyGo()) {
      syncFromBackend(Valet.createChatThread(), true);
      return;
    }

    const newId = `chat-${Date.now().toString(36)}`;
    setState((prev) => {
      const thread: ChatThread = {
        id: newId,
        title: "新对话",
        model: prev.preferences.models.primary,
        timelineActionCount: 0,
        linkedEventIds: [],
        updatedAt: "刚刚",
        messages: [
          {
            id: `welcome-${newId}`,
            role: "assistant",
            metaLabel: `${prev.preferences.models.primary} · 就绪`,
            createdAt: new Date().toTimeString().slice(0, 5),
            content: `${prev.preferences.userNickname || "你"}好，我可以帮你排查 Mac 卡顿、清理磁盘缓存、查看崩溃日志，或者直接用自然语言帮你写一个本地插件。`,
          },
        ],
      };
      return {
        ...prev,
        activeView: "chat",
        activeChatId: newId,
        chatThreads: [thread, ...prev.chatThreads],
      };
    });
  }, [syncFromBackend]);

  const updateChatThreadModel = useCallback(
    (chatId: string, model: string) => {
      setState((prev) => ({
        ...prev,
        chatThreads: prev.chatThreads.map((c) => (c.id === chatId ? { ...c, model } : c)),
      }));
      if (isMyGo()) {
        syncFromBackend(Valet.updateChatModel(chatId, model));
      }
    },
    [syncFromBackend]
  );

  const sendChatMessage = useCallback(
    async (params: {
      prompt: string;
      mentionPlugin: PluginState | null;
      attachments: ChatAttachment[];
    }) => {
      const activeId = stateRef.current.activeChatId;
      const activeChat = stateRef.current.chatThreads.find((c) => c.id === activeId);
      const model = stateRef.current.preferences.models.primary || activeChat?.model || "claude-opus-4";
      const nowTime = new Date().toTimeString().slice(0, 5);
      const userMsg: ChatMessage = {
        id: `usr-${Date.now()}`,
        role: "user",
        content: params.prompt,
        createdAt: nowTime,
        attachments: params.attachments.length > 0 ? params.attachments : undefined,
      };

      setState((prev) => ({
        ...prev,
        chatThreads: prev.chatThreads.map((t) => {
          if (t.id !== activeId) return t;
          const nextTitle =
            t.title === "新对话" ? params.prompt.slice(0, 18) : t.title;
          return {
            ...t,
            title: nextTitle,
            updatedAt: "刚刚",
            messages: [...t.messages, userMsg],
          };
        }),
      }));

      triggerNod();
      try {
        const outcome = await valetService.sendChatMessage({
          chatId: activeId,
          prompt: params.prompt,
          model,
          mentionPlugin: params.mentionPlugin,
          attachments: params.attachments,
        });

        if (isMyGo()) {
          const snap = await Valet.getSnapshot();
          setState((prev) => mergeBackendSnapshot(prev, snap));
        } else {
          setState((prev) => ({
            ...prev,
            timelineEvents: outcome.createdEvent
              ? [outcome.createdEvent, ...prev.timelineEvents]
              : prev.timelineEvents,
            inboxItems: outcome.createdInboxItem
              ? [outcome.createdInboxItem, ...prev.inboxItems]
              : prev.inboxItems,
            chatThreads: prev.chatThreads.map((t) => {
              if (t.id !== activeId) return t;
              return {
                ...t,
                timelineActionCount:
                  t.timelineActionCount + (outcome.createdEvent ? 1 : 0),
                linkedEventIds: outcome.createdEvent
                  ? [outcome.createdEvent.id, ...t.linkedEventIds]
                  : t.linkedEventIds,
                messages: [...t.messages, outcome.replyMessage],
              };
            }),
          }));
        }

        if (outcome.createdEvent) {
          pushToast("已生成待确认清理任务，已同步至收件箱与时间线", "warning");
        }
      } catch (err: unknown) {
        pushToast(err instanceof Error ? err.message : String(err), "danger");
      } finally {
        setChatStream(null);
      }
    },
    [pushToast, triggerNod]
  );

  const performProcessAction = useCallback(
    (
      chatId: string,
      messageId: string,
      action: "kill_primary" | "clean_disk" | "auto_rule"
    ) => {
      setState((prev) => ({
        ...prev,
        systemMetrics:
          action === "kill_primary"
            ? { ...prev.systemMetrics, cpuPct: 16, memPct: 54 }
            : action === "clean_disk"
              ? {
                  ...prev.systemMetrics,
                  diskPct: 82,
                  diskFreeGB: prev.systemMetrics.diskFreeGB + 18,
                }
              : prev.systemMetrics,
        chatThreads: prev.chatThreads.map((t) => {
          if (t.id !== chatId) return t;
          return {
            ...t,
            messages: t.messages.map((m) => {
              if (m.id !== messageId || !m.processTable) return m;
              const pt = m.processTable;
              if (action === "kill_primary") {
                return {
                  ...m,
                  processTable: {
                    ...pt,
                    primaryActionDone: true,
                    rows: pt.rows.map((r, idx) =>
                      idx === 0 ? { ...r, killed: true, cpuPct: 0 } : r
                    ),
                  },
                };
              }
              if (action === "clean_disk") {
                return {
                  ...m,
                  processTable: { ...pt, secondaryActionDone: true },
                };
              }
              return {
                ...m,
                processTable: { ...pt, autoRuleAdded: true },
              };
            }),
          };
        }),
      }));
      triggerNod();
      const labelMap = {
        kill_primary: "已结束高占用 vite 进程，CPU 回落至正常水平",
        clean_disk: "已触发 18 GB 开发缓存清理",
        auto_rule: "已将「process.cpu_spike」切换为自动处理策略",
      };
      pushToast(labelMap[action], "success");
      if (isMyGo()) {
        syncFromBackend(Valet.performProcessAction(chatId, messageId, action));
      }
    },
    [pushToast, syncFromBackend, triggerNod]
  );

  const installPluginDraft = useCallback(
    (chatId: string, messageId: string, draft: PluginDraftSpec) => {
      if (isMyGo()) {
        void Valet.installPluginDraft(chatId, messageId, draft as unknown as MyGoPluginDraftSpec)
          .then((snap) => {
            setState((prev) => mergeBackendSnapshot(prev, snap));
            triggerNod();
            pushToast(`插件「${draft.name}」已安装到本地`, "success");
          })
          .catch((err: unknown) => {
            pushToast(err instanceof Error ? err.message : String(err), "danger");
          });
        return;
      }

      setState((prev) => {
        const alreadyInstalled = prev.plugins.some((p) => p.id === draft.id);
        const nextPlugins = alreadyInstalled
          ? prev.plugins.map((p) =>
              p.id === draft.id ? { ...p, installed: true, enabled: true } : p
            )
          : [
              ...prev.plugins,
              {
                id: draft.id,
                slug: draft.id,
                name: draft.name,
                tagline: `~/Valet/plugins/${draft.id} · 热重载中`,
                description: `${draft.whenExpression} ${draft.actionExpression}`,
                version: "v0.1.0",
                bundleId: `local.valet.${draft.id}`,
                iconKind: "code" as const,
                iconLabel: "{ }",
                source: "local" as const,
                enabled: true,
                installed: true,
                statusSubtitle: `~/Valet/plugins/${draft.id} · 已安装并启用`,
                triggers24h: [0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
                events: [
                  {
                    id: "fs.file_created",
                    description: draft.whenExpression,
                    policy: "auto" as const,
                    count24h: 0,
                  },
                ],
                actions: [
                  {
                    id: "move_to_trash",
                    safety: "reversible" as const,
                    safetyLabel: "可撤销 · 7 天",
                  },
                ],
                config: {},
                manifestYaml: draft.manifestYaml,
              },
            ];

        return {
          ...prev,
          plugins: nextPlugins,
          chatThreads: prev.chatThreads.map((t) =>
            t.id !== chatId
              ? t
              : {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === messageId && m.pluginDraft
                      ? { ...m, pluginDraft: { ...m.pluginDraft, installed: true } }
                      : m
                  ),
                }
          ),
        };
      });
      triggerNod();
      pushToast(`插件「${draft.name}」已安装到本地`, "success");
    },
    [pushToast, triggerNod]
  );

  const updatePreferences = useCallback(
    (patch: Partial<ValetPreferences>) => {
      const nextPrefs = { ...stateRef.current.preferences, ...patch };
      setState((prev) => ({
        ...prev,
        preferences: { ...prev.preferences, ...patch },
      }));
      if (isMyGo()) {
        syncFromBackend(Valet.updatePreferences(nextPrefs as unknown as MyGoPreferences));
      }
    },
    [syncFromBackend]
  );

  const resetThresholdsToDefault = useCallback(() => {
    setState((prev) => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        thresholds: { ...DEFAULT_THRESHOLDS },
      },
    }));
    triggerNod();
    pushToast("已恢复默认监控阈值", "success");
    if (isMyGo()) {
      syncFromBackend(Valet.resetThresholds());
    }
  }, [pushToast, syncFromBackend, triggerNod]);

  const toggleAutomation = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        automations: prev.automations.map((a) =>
          a.id === id ? { ...a, enabled: !a.enabled } : a
        ),
      }));
      if (isMyGo()) {
        syncFromBackend(Valet.toggleAutomation(id));
      }
    },
    [syncFromBackend]
  );

  const addAutomationRule = useCallback(
    (rule: Omit<AutomationRule, "id">) => {
      const created = { ...rule, id: `auto-${Date.now().toString(36)}` };
      setState((prev) => ({
        ...prev,
        automations: [...prev.automations, created],
      }));
      pushToast("已新建自动化规则", "success");
      if (isMyGo()) {
        syncFromBackend(Valet.addAutomationRule(created as unknown as MyGoAutomationRule));
      }
    },
    [pushToast, syncFromBackend]
  );

  const runAutomationNow = useCallback(
    (id: string) => {
      if (isMyGo()) {
        pushToast("正在执行自动化规则…", "default");
        void Valet.runAutomationNow(id)
          .then((snap) => {
            setState((prev) => mergeBackendSnapshot(prev, snap));
            triggerNod();
            pushToast("自动化规则执行完成，详情已写入对话", "success");
          })
          .catch((err: unknown) => {
            pushToast(err instanceof Error ? err.message : String(err), "danger");
          });
        return;
      }
      const nowHHMM = new Date().toTimeString().slice(0, 5);
      setState((prev) => ({
        ...prev,
        automations: prev.automations.map((a) =>
          a.id === id ? { ...a, lastRunAt: nowHHMM } : a
        ),
      }));
      pushToast("已触发执行规则（本地演示模式）", "success");
    },
    [pushToast, triggerNod]
  );

  const deleteAutomationRule = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        automations: prev.automations.filter((a) => a.id !== id),
      }));
      pushToast("已删除自动化规则", "warning");
      if (isMyGo()) {
        syncFromBackend(Valet.deleteAutomationRule(id));
      }
    },
    [pushToast, syncFromBackend]
  );

  const deleteMcpServer = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        mcpServers: prev.mcpServers.filter((s) => s.id !== id),
      }));
      pushToast("已移除 MCP 服务器", "warning");
      if (isMyGo()) {
        syncFromBackend(Valet.deleteMcpServer(id));
      }
    },
    [pushToast, syncFromBackend]
  );

  const refreshPermissions = useCallback(() => {
    if (isMyGo()) {
      void Valet.checkPermissions()
        .then((snap) => {
          setState((prev) => mergeBackendSnapshot(prev, snap));
          pushToast("已重新检测 macOS 系统权限状态", "success");
        })
        .catch((err: unknown) => {
          pushToast(err instanceof Error ? err.message : String(err), "danger");
        });
      return;
    }
    pushToast("已刷新本地权限检查", "success");
  }, [pushToast]);

  const toggleMcpServer = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        mcpServers: prev.mcpServers.map((s) =>
          s.id === id ? { ...s, enabled: !s.enabled } : s
        ),
      }));
      if (isMyGo()) {
        syncFromBackend(Valet.toggleMcpServer(id));
      }
    },
    [syncFromBackend]
  );

  const reconnectMcpServer = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        mcpServers: prev.mcpServers.map((s) =>
          s.id === id ? { ...s, authExpired: false, enabled: true } : s
        ),
      }));
      pushToast("MCP 服务器认证已更新", "success");
      if (isMyGo()) {
        syncFromBackend(Valet.reconnectMcpServer(id));
      }
    },
    [pushToast, syncFromBackend]
  );

  const addMcpServer = useCallback(
    (server: Omit<McpServerItem, "id">) => {
      const created = { ...server, id: `mcp-${Date.now().toString(36)}` };
      setState((prev) => ({
        ...prev,
        mcpServers: [...prev.mcpServers, created],
      }));
      pushToast(`已接入 MCP 服务器「${server.name}」`, "success");
      if (isMyGo()) {
        syncFromBackend(Valet.addMcpServer(created as unknown as MyGoMcpServerItem));
      }
    },
    [pushToast, syncFromBackend]
  );

  const deleteMemory = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        memories: prev.memories.filter((m) => m.id !== id),
      }));
      if (isMyGo()) {
        syncFromBackend(Valet.deleteMemory(id));
      }
    },
    [syncFromBackend]
  );

  const clearMemories = useCallback(() => {
    setState((prev) => ({ ...prev, memories: [] }));
    pushToast("已清空本地记忆", "warning");
    if (isMyGo()) {
      syncFromBackend(Valet.clearMemories());
    }
  }, [pushToast, syncFromBackend]);

  const resetAllData = useCallback(() => {
    if (isMyGo()) {
      syncFromBackend(Valet.resetAllData(), true);
      pushToast("已重置全部本地数据", "warning");
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    setState(createInitialSnapshot());
    pushToast("已重置全部本地数据", "warning");
  }, [pushToast, syncFromBackend]);

  const value = useMemo<ValetContextValue>(
    () => ({
      state,
      chatStream,
      toasts,
      nodTick,
      commandPaletteOpen,
      setCommandPaletteOpen,
      pushToast,
      dismissToast,
      triggerNod,
      isCompactViewport,
      sidebarCollapsed,
      toggleSidebarCollapsed,
      arrivalNotice,
      clearArrivalNotice,
      setOnboardingStep,
      completeOnboarding,
      importExistingConfig,
      resetOnboarding,
      setActiveView,
      setActiveSettingsSection,
      openSettingsSection,
      openPluginDetail,
      togglePauseValet,
      selectInboxItem,
      toggleInboxActionItem,
      approveInboxItem,
      dismissInboxItem,
      approveAllReversibleInboxItems,
      restoreApprovedInboxItem,
      setPermissionGranted,
      toggleMockAppPermission,
      refreshPermissions,
      togglePluginEnabled,
      installMarketplacePlugin,
      installCustomPlugin,
      updatePluginManifest,
      fixPluginAuth,
      updatePluginEventPolicy,
      updatePluginConfig,
      simulatePluginEvent,
      selectProvider,
      updateProvider,
      updateModels,
      setAutonomyLevel,
      runFirstScan,
      selectTimelineEvent,
      setTimelinePluginFilter,
      toggleTimelineActionItem,
      executeTimelineEventActions,
      ignoreTimelineEvent,
      restoreTimelineEvent,
      selectChatThread,
      createNewChat,
      updateChatThreadModel,
      sendChatMessage,
      performProcessAction,
      installPluginDraft,
      updatePreferences,
      resetThresholdsToDefault,
      toggleAutomation,
      addAutomationRule,
      runAutomationNow,
      deleteAutomationRule,
      toggleMcpServer,
      reconnectMcpServer,
      addMcpServer,
      deleteMcpServer,
      deleteMemory,
      clearMemories,
      resetAllData,
    }),
    [
      addAutomationRule,
      addMcpServer,
      approveAllReversibleInboxItems,
      approveInboxItem,
      arrivalNotice,
      chatStream,
      clearArrivalNotice,
      clearMemories,
      commandPaletteOpen,
      completeOnboarding,
      createNewChat,
      deleteAutomationRule,
      deleteMcpServer,
      deleteMemory,
      dismissInboxItem,
      dismissToast,
      executeTimelineEventActions,
      fixPluginAuth,
      ignoreTimelineEvent,
      importExistingConfig,
      installCustomPlugin,
      installMarketplacePlugin,
      installPluginDraft,
      isCompactViewport,
      nodTick,
      openPluginDetail,
      openSettingsSection,
      performProcessAction,
      pushToast,
      reconnectMcpServer,
      refreshPermissions,
      resetAllData,
      resetOnboarding,
      resetThresholdsToDefault,
      restoreApprovedInboxItem,
      restoreTimelineEvent,
      runAutomationNow,
      runFirstScan,
      selectChatThread,
      selectInboxItem,
      selectProvider,
      selectTimelineEvent,
      sendChatMessage,
      setActiveSettingsSection,
      setActiveView,
      setAutonomyLevel,
      setOnboardingStep,
      setPermissionGranted,
      setTimelinePluginFilter,
      sidebarCollapsed,
      simulatePluginEvent,
      state,
      toasts,
      toggleAutomation,
      toggleInboxActionItem,
      toggleMcpServer,
      toggleMockAppPermission,
      togglePauseValet,
      togglePluginEnabled,
      toggleSidebarCollapsed,
      toggleTimelineActionItem,
      triggerNod,
      updateChatThreadModel,
      updateModels,
      updatePluginConfig,
      updatePluginEventPolicy,
      updatePluginManifest,
      updatePreferences,
      updateProvider,
    ]
  );

  return <ValetContext.Provider value={value}>{children}</ValetContext.Provider>;
};

export function useValet(): ValetContextValue {
  const ctx = useContext(ValetContext);
  if (!ctx) {
    throw new Error("useValet must be used inside <ValetProvider>");
  }
  return ctx;
}
