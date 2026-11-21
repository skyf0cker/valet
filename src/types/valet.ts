export type AppView = "inbox" | "timeline" | "projects" | "chat" | "plugins" | "settings";

export type ProjectTab = "notebook" | "sessions" | "session" | "page";

export type ProjectIconKind = "box" | "book" | "terminal" | "sparkles" | "folder";

export type NotebookBlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "todo"
  | "callout"
  | "quote"
  | "code"
  | "table"
  | "divider"
  | "session_ref"
  | "page_ref";

export const DEFAULT_PROJECT_ID = "proj-default";

export interface NotebookBlock {
  id: string;
  type: NotebookBlockType;
  content: string;
  indent?: number;
  checked?: boolean;
  language?: string;
  sessionId?: string;
  pageId?: string;
  summary?: string;
}

export interface ProjectPage {
  id: string;
  parentPageId?: string;
  title: string;
  icon?: ProjectIconKind | string;
  updatedAt: string;
  createdAt: string;
  blocks: NotebookBlock[];
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  icon?: ProjectIconKind | string;
  tags: string[];
  workingDir?: string;
  isDefault?: boolean;
  archived?: boolean;
  updatedAt: string;
  createdAt: string;
  blocks: NotebookBlock[];
  pages?: ProjectPage[];
}

export type BusyMessagePolicy = "queue" | "steer";

export type SettingsSectionId =
  | "general"
  | "models"
  | "persona"
  | "heartbeat"
  | "safety"
  | "thresholds"
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
  payload: Record<string, unknown>;
  reasoning: string;
  actionItems: TimelineActionItem[];
  traceSteps: TraceStep[];
  logs: LogLine[];
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  options?: string[];
  selectedOption?: string;
  sourceChatId?: string;
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
  webhookEndpoint?: string;
  debounceMs?: number;
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

export type PluginExecutionMode = "skill" | "workflow";

export type EventPolicyMode = "auto" | "ask" | "record";

export type ActionSafety = "readonly" | "reversible" | "confirm_always";

export interface PluginEventPolicy {
  id: string;
  description: string;
  policy: EventPolicyMode;
  sensor?: string;
  sourceSummary?: string;
  count24h: number;
}

export interface PluginActionCapability {
  id: string;
  safety: ActionSafety;
  safetyLabel: string;
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: "slider" | "number" | "text" | "boolean";
  min?: number;
  max?: number;
  default?: unknown;
  description?: string;
}

export interface PluginConfig {
  values?: Record<string, unknown>;
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
  | "homekit"
  | "surge";

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
  actions?: PluginActionCapability[];
  configSchema?: PluginConfigField[];
  config: PluginConfig;
  manifestYaml: string;
  executionMode?: PluginExecutionMode;
  skillMarkdown?: string;
  workflowYaml?: string;
  localDir?: string;
  bundledFiles?: string[];
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
  payload: Record<string, unknown>;
  reasoning: string;
  actionItems: TimelineActionItem[];
  traceSteps: TraceStep[];
  logs: LogLine[];
  reclaimedGB?: number;
  intercepted?: boolean;
  canRestore?: boolean;
  restored?: boolean;
  ignored?: boolean;
  workflowRunId?: string;
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
  sensor?: string;
  skillMarkdown?: string;
  installed?: boolean;
}

export interface ChatAttachment {
  id: string;
  kind:
    | "image"
    | "file"
    | "screen"
    | "timeline_event"
    | "inbox_item"
    | "notebook_context"
    | "message_quote";
  refId?: string;
  name: string;
  meta?: string;
  badge?: string;
  path?: string;
  dataUrl?: string;
  mimeType?: string;
  textExcerpt?: string;
}

export interface PendingPermissionRequest {
  requestId: string;
  chatId: string;
  toolName: string;
  title: string;
  summary: string;
  command?: string;
  paths?: string[];
  targetPath?: string;
  options?: string[];
  approveLabel: string;
  allowSessionLabel?: string;
  dismissLabel: string;
}

export interface ChatStreamStep {
  id: string;
  name: string;
  label?: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  metaLabel?: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  steps?: ChatStreamStep[];
  workDurationMs?: number;
  thinkingSummary?: string;
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
  projectId?: string;
  title: string;
  model: string;
  timelineActionCount: number;
  linkedEventIds: string[];
  updatedAt: string;
  archived?: boolean;
  archivedAt?: string;
  originPageId?: string;
  originBlockId?: string;
  originSection?: string;
  notebookContextInjected?: boolean;
  messages: ChatMessage[];
}

export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "ollama"
  | "custom";

export type AutonomyLevel = "always_ask" | "auto_review" | "full_access";

export interface AutoReviewConfig {
  engine: "auto" | "jev" | "llm";
  jevEndpoint: string;
  jevApiKey: string;
  jevApiKeyMasked?: string;
  jevModel: string;
  jevVerified?: boolean;
  jevLatencyMs?: number;
  fallbackProviderId?: string;
  fallbackModel: string;
}

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
  headers?: Record<string, string>;
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

export interface HeartbeatRunLog {
  id: string;
  timestamp: string;
  createdAt: string;
  status: "ok" | "error" | string;
  model?: string;
  durationMs?: number;
  summary: string;
  detail?: string;
}

export type AppearanceMode = "light" | "dark" | "auto";
export type LightThemeId =
  | "cursor-light"
  | "vercel-light"
  | "one-light"
  | "tokyo-day"
  | "catppuccin-latte"
  | "solarized-light";
export type DarkThemeId =
  | "cursor"
  | "vercel"
  | "onedark"
  | "tokyo-night"
  | "catppuccin"
  | "vesper";
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
  lightTheme?: LightThemeId;
  darkTheme?: DarkThemeId;
  language: string;
  globalHotkey: string[];
  busyMessagePolicy?: BusyMessagePolicy;

  // 02 模型与预算
  activeProviderId: ProviderId;
  models: ModelSelection;
  autoReview: AutoReviewConfig;
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

  // Steward：事件感知阈值 / 受保护路径策略 / 插件运行时
  thresholds: MonitoringThresholds;
  cleanupPolicy: CleanupPolicySettings;
  pluginRuntime: PluginRuntimeSettings;
  heartbeat?: {
    enabled: boolean;
    initialized?: boolean;
    intervalMin: number;
    prompt: string;
    lastRunAt?: string;
  };

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
  activeProjectId: string;
  activeProjectTab?: ProjectTab;
  activePageId?: string;
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
  projects: Project[];
  chatThreads: ChatThread[];
  automations: AutomationRule[];
  mcpServers: McpServerItem[];
  memories: MemoryEntry[];
  heartbeatLogs?: HeartbeatRunLog[];
  preferences: ValetPreferences;
  systemMetrics: SystemMetrics;
  scan: ScanState;
  storageStats?: StorageStats;
}

export interface QueuedChatMessage {
  id: string;
  chatId: string;
  prompt: string;
  mentionPlugin: PluginState | null;
  attachments: ChatAttachment[];
  createdAt: string;
}

export type WorkflowNodeType =
  | "trigger"
  | "script"
  | "http"
  | "tool"
  | "agent"
  | "condition"
  | "transform"
  | "sleep"
  | "approval"
  | "notify";

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowNodeStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowNodeType;
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  when?: string;
  label?: string;
}

export interface WorkflowGraphDefinition {
  version: number;
  name?: string;
  description?: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
  definition?: WorkflowGraphDefinition;
  topologicalOrder: string[];
  entryNodeIds: string[];
}

export interface WorkflowGraphResponse {
  pluginId: string;
  executionMode: PluginExecutionMode;
  workflowYaml: string;
  valid: boolean;
  errors: string[];
  definition?: WorkflowGraphDefinition;
  topologicalOrder: string[];
  entryNodeIds: string[];
}

export interface WorkflowRunSummary {
  runId: string;
  pluginId: string;
  pluginName: string;
  triggerEvent: string;
  triggerSource: string;
  status: WorkflowRunStatus;
  timelineEventId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorMessage?: string;
  durationMs?: number;
}

export interface WorkflowNodeRunState {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  status: WorkflowNodeStatus;
  attempt?: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  hookToken?: string;
  inboxId?: string;
}

export interface WorkflowEdgeRunState {
  edgeId: string;
  from: string;
  to: string;
  status: "pending" | "taken" | "skipped";
}

export interface WorkflowRunDetail {
  summary: WorkflowRunSummary;
  definition: WorkflowGraphDefinition;
  triggerInput?: unknown;
  nodes: WorkflowNodeRunState[];
  edges: WorkflowEdgeRunState[];
}

export interface WorkflowUpdatedPayload {
  pluginId: string;
  runId: string;
  status: WorkflowRunStatus;
  error?: string;
  timelineEventId?: string;
  completedNodeCount?: number;
}

export interface StartWorkflowParams {
  pluginId: string;
  event?: string;
  source?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  waitForCompletionMs?: number;
}

export interface ResumeWorkflowHookParams {
  token: string;
  approved: boolean;
  comment?: string;
  decidedBy?: string;
}
