export type AppView = "inbox" | "timeline" | "chat" | "plugins" | "settings";

export type SettingsSectionId =
  | "general"
  | "models"
  | "persona"
  | "safety"
  | "thresholds"
  | "cleanup"
  | "runtime"
  | "permissions"
  | "voice"
  | "notifications"
  | "memory"
  | "privacy"
  | "shortcuts"
  | "about";

export type InboxCategory = "files" | "process" | "outbound";

export interface InboxApprovalItem {
  id: string;
  timestamp: string;
  timeLabel: string;
  ageLabel?: string;
  category: InboxCategory;
  iconKind: "trash" | "disk" | "pulse" | "mail";
  title: string;
  summary: string;
  pluginId: string;
  pluginName: string;
  pluginBadge: string;
  eventCode: string;
  warningTag?: "不可撤销" | "外发消息";
  reversible7d: boolean;
  reclaimableGB?: number;
  approveLabel: string;
  dismissLabel: string;
  status: "pending" | "approved" | "dismissed";
  restored?: boolean;
  processedAt?: string;
  linkedTimelineEventId?: string;
  triggerLatencyLabel?: string;
  payload: Record<string, string | number | boolean>;
  reasoning: string;
  actionItems: TimelineActionItem[];
  traceSteps: TraceStep[];
  logs: LogLine[];
}

export interface MonitoringThresholds {
  diskLowSpacePct: number;
  cacheBloatGB: string;
  largeFileSizeGB: string;
  largeFileIdleDays: string;
  cpuSpikePct: string;
  cpuSpikeDuration: string;
  memoryPressureLevel: "yellow" | "red";
  ignoredProcesses: string[];
  logSensitivity: "low" | "medium" | "high";
  eventThrottle10m: boolean;
}

export interface CleanupPolicySettings {
  deleteMethod: string;
  restoreRetentionDays: string;
  protectedDirs: string[];
  autoScanAfterUninstall: boolean;
}

export interface PluginRuntimeSettings {
  sandboxIsolation: boolean;
  allowUnsignedLocal: boolean;
  maxEventsPerHour: string;
  quietHours: string;
}

export type OnboardingStepId = 1 | 2 | 3 | 4 | 5;

export type PermissionId =
  | "full_disk"
  | "accessibility"
  | "screen_recording"
  | "automation"
  | "notifications"
  | "microphone";

export type PermissionTier = "required" | "recommended" | "optional";

export interface PermissionGuideStep {
  index: string;
  title: string;
  detail: string;
}

export interface MockSystemSettingApp {
  id: string;
  name: string;
  isValet?: boolean;
  enabled: boolean;
}

export interface PermissionItem {
  id: PermissionId;
  name: string;
  tier: PermissionTier;
  description: string;
  settingsSectionName: string;
  settingsSubtext: string;
  granted: boolean;
  steps: PermissionGuideStep[];
  mockApps: MockSystemSettingApp[];
}

export type PluginSource = "core" | "community" | "local";

export type EventPolicyMode = "auto" | "ask" | "record";

export type ActionSafety = "readonly" | "reversible" | "confirm_always";

export interface PluginEventPolicy {
  id: string;
  description: string;
  policy: EventPolicyMode;
  count24h: number;
}

export interface PluginActionCapability {
  id: string;
  safety: ActionSafety;
  safetyLabel: string;
}

export interface PluginConfig {
  lowSpaceThresholdPct?: number;
  protectedPaths?: string[];
  sampleIntervalSec?: number;
  customNote?: string;
}

export type PluginIconKind =
  | "disk"
  | "trash"
  | "pulse"
  | "log"
  | "gh"
  | "calendar"
  | "code"
  | "battery"
  | "wifi"
  | "homekit";

export interface PluginState {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  version: string;
  bundleId: string;
  iconKind: PluginIconKind;
  iconLabel?: string;
  source: PluginSource;
  enabled: boolean;
  installed: boolean;
  authError?: string;
  requiredPermission?: PermissionId;
  requiredPermissionLabel?: string;
  defaultBehaviorHint?: string;
  statusSubtitle?: string;
  weeklyImpactValue?: string;
  weeklyImpactUnit?: string;
  weeklyImpactLabel?: string;
  triggers24h: number[];
  events: PluginEventPolicy[];
  actions: PluginActionCapability[];
  config: PluginConfig;
  manifestYaml: string;
}

export type TimelineStatus = "running" | "pending_confirm" | "completed" | "failed";

export interface TimelineActionItem {
  id: string;
  label: string;
  path: string;
  sizeMB: number;
  sizeLabel: string;
  checked: boolean;
  keepNote?: string;
  defaultHidden?: boolean;
}

export interface TraceStep {
  id: string;
  time: string;
  stage: string;
  detail: string;
  status: "done" | "active" | "waiting" | "error";
}

export interface LogLine {
  id: string;
  ts: string;
  level: "INFO" | "WARN" | "ERR" | "EXEC";
  message: string;
}

export interface TimelineProgress {
  currentLabel: string;
  currentGB: number;
  totalGB: number;
  pct: number;
  targetPath: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  timeLabel: string;
  dayGroup: "today" | "earlier";
  title: string;
  summary: string;
  pluginId: string;
  pluginName: string;
  pluginBadge: string;
  eventCode: string;
  status: TimelineStatus;
  progress?: TimelineProgress;
  confirmBannerText?: string;
  authFixPluginId?: string;
  triggerLatencyLabel?: string;
  payload: Record<string, string | number | boolean>;
  reasoning: string;
  actionItems: TimelineActionItem[];
  traceSteps: TraceStep[];
  logs: LogLine[];
  reclaimedGB?: number;
  intercepted?: boolean;
  canRestore?: boolean;
  restored?: boolean;
  ignored?: boolean;
}

export interface ProcessSampleRow {
  id: string;
  name: string;
  cpuPct: number;
  memLabel: string;
  sourceLabel: string;
  severity: "high" | "normal";
  killed?: boolean;
}

export interface PluginDraftSpec {
  id: string;
  name: string;
  whenExpression: string;
  actionExpression: string;
  manifestYaml: string;
  installed?: boolean;
}

export interface ChatAttachment {
  id: string;
  kind: "image" | "file" | "screen";
  name: string;
  meta?: string;
  badge?: string;
  path?: string;
  dataUrl?: string;
  mimeType?: string;
  textExcerpt?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  metaLabel?: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  processTable?: {
    rows: ProcessSampleRow[];
    primaryActionDone?: boolean;
    secondaryActionDone?: boolean;
    autoRuleAdded?: boolean;
  };
  pluginDraft?: PluginDraftSpec;
}

export interface ChatThread {
  id: string;
  title: string;
  model: string;
  timelineActionCount: number;
  linkedEventIds: string[];
  updatedAt: string;
  messages: ChatMessage[];
}

export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "ollama"
  | "custom";

export type AutonomyLevel = "always_ask" | "sensitive_only" | "autonomous";

export interface AgentProviderConfig {
  id: ProviderId;
  name: string;
  letter: string;
  subtitle: string;
  apiKey: string;
  apiKeyMasked: string;
  baseUrl: string;
  proxyUrl: string;
  orgId: string;
  endpoint: string;
  verified: boolean;
  latencyMs?: number;
  availableModelCount: number;
  models: string[];
  connected: boolean;
}

export interface ModelSelection {
  primary: string;
  fast: string;
  vision: string;
}

export interface AutomationRule {
  id: string;
  scheduleTop: string;
  scheduleBottom: string;
  title: string;
  subtitle?: string;
  enabled: boolean;
  triggerType: "cron" | "event";
  cronExpr?: string;
  prompt?: string;
  lastRunAt?: string;
}

export interface McpServerItem {
  id: string;
  abbr: string;
  name: string;
  transportLabel: string;
  toolCount: number;
  enabled: boolean;
  authExpired?: boolean;
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  statusError?: string;
}

export interface StorageStats {
  totalLabel: string;
  totalBytes: number;
  databaseLabel: string;
  stateLabel: string;
  vaultLabel: string;
  dataDir: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  source: string;
  createdAt: string;
}

export type AppearanceMode = "light" | "dark" | "auto";
export type ToneStyle = "formal" | "concise" | "friendly";

export interface SafetyConfirmationChecklist {
  deleteOrOverwrite: boolean;
  sendMessageOrEmail: boolean;
  paymentOrSubscription: boolean;
  runTerminalCommand: boolean;
  modifySystemSettings: boolean;
}

export interface ValetPreferences {
  // 01 通用
  launchAtLogin: boolean;
  showMenuBarIcon: boolean;
  appearance: AppearanceMode;
  language: string;
  globalHotkey: string[];

  // 02 模型与预算
  activeProviderId: ProviderId;
  models: ModelSelection;
  dailySpendCurrent: number;
  dailySpendLimit: number;
  maxStepsPerTask: number;

  // 03 人格与指令
  userNickname: string;
  toneStyle: ToneStyle;
  customInstructions: string;

  // 04 自主与安全
  autonomyLevel: AutonomyLevel;
  confirmChecklist: SafetyConfirmationChecklist;
  blockedApps: string[];
  emergencyStopShortcut: string[];

  // Care：监控阈值 / 清理策略 / 插件运行时
  thresholds: MonitoringThresholds;
  cleanupPolicy: CleanupPolicySettings;
  pluginRuntime: PluginRuntimeSettings;

  // 06 记忆
  memoryEnabled: boolean;
  autoLearnMemory: boolean;

  // 08 语音
  holdToSpeakKey: string;
  wakeWordEnabled: boolean;
  speechLanguage: string;
  speakReplies: string;

  // 09 通知
  notifyOnConfirm: boolean;
  notifyOnComplete: boolean;
  notifyOnFailure: boolean;
  followFocusMode: boolean;

  // 11 数据与隐私
  recordActionReplay: boolean;
  blurSensitiveInfo: boolean;
  timelineRetentionDays: string;
}

export interface SystemMetrics {
  diskPct: number;
  diskFreeGB: number;
  diskTotalGB: number;
  cpuPct: number;
  memPct: number;
  activeTaskLabel: string | null;
  activeTaskPct: number;
  activeTaskEventId: string | null;
}

export interface ScanTaskItem {
  id: "disk" | "orphan" | "process" | "log";
  title: string;
  detail: string;
  sizeLabel: string;
  sizeGB: number;
  status: "pending" | "running" | "done" | "skipped";
  durationHint?: string;
}

export interface ScanState {
  status: "idle" | "running" | "done";
  progressPct: number;
  elapsedSec: number;
  reclaimableGB: number;
  tasks: ScanTaskItem[];
}

export interface ValetSnapshot {
  schemaVersion?: number;
  onboardingCompleted: boolean;
  onboardingStep: OnboardingStepId;
  activeView: AppView;
  activeSettingsSection: SettingsSectionId;
  isOnDuty: boolean;
  isPaused: boolean;
  activePluginDetailId: string | null;
  activeChatId: string;
  selectedTimelineEventId: string | null;
  selectedInboxItemId: string | null;
  timelinePluginFilter: string;
  permissions: PermissionItem[];
  plugins: PluginState[];
  providers: AgentProviderConfig[];
  inboxItems: InboxApprovalItem[];
  inboxProcessedHistoryCount: number;
  timelineEvents: TimelineEvent[];
  earlierCountLabel: string;
  chatThreads: ChatThread[];
  automations: AutomationRule[];
  mcpServers: McpServerItem[];
  memories: MemoryEntry[];
  preferences: ValetPreferences;
  systemMetrics: SystemMetrics;
  scan: ScanState;
  storageStats?: StorageStats;
}
