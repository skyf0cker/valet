export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "ollama"
  | "custom";

export type AutonomyLevel =
  | "always_ask"
  | "auto_review"
  | "full_access"
  | "sensitive_only"
  | "autonomous";
export type CanonicalAutonomyLevel = "always_ask" | "auto_review" | "full_access";
export type EventPolicyMode = "auto" | "ask" | "record";
export type ActionSafety = "readonly" | "reversible" | "confirm_always";
export type InboxCategory = "files" | "process" | "outbound";
export type PluginExecutionMode = "skill" | "workflow";

export interface SafetyConfirmationChecklist {
  deleteOrOverwrite: boolean;
  sendMessageOrEmail: boolean;
  paymentOrSubscription: boolean;
  runTerminalCommand: boolean;
  modifySystemSettings: boolean;
}

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

export interface ValetPreferences {
  language: string;
  models: {
    primary: string;
    fast: string;
    vision: string;
  };
  activeProviderId: ProviderId;
  autoReview?: AutoReviewConfig;
  dailySpendCurrent: number;
  dailySpendLimit: number;
  maxStepsPerTask: number;
  userNickname: string;
  toneStyle: "formal" | "concise" | "friendly";
  customInstructions: string;
  autonomyLevel: AutonomyLevel;
  confirmChecklist: SafetyConfirmationChecklist;
  blockedApps: string[];
  thresholds: MonitoringThresholds;
  cleanupPolicy: CleanupPolicySettings;
  pluginRuntime: PluginRuntimeSettings;
  appearance?: "light" | "dark" | "auto";
  darkTheme?: "cursor" | "vercel" | "vesper" | "onedark" | "tokyo-night" | "catppuccin";
  busyMessagePolicy?: "queue" | "steer";
  heartbeat?: {
    enabled: boolean;
    initialized?: boolean;
    intervalMin: number;
    prompt: string;
    lastRunAt?: string;
  };
  memoryEnabled: boolean;
  autoLearnMemory: boolean;
}

export interface AgentProviderConfig {
  id: ProviderId;
  name: string;
  apiKey: string;
  baseUrl: string;
  proxyUrl?: string;
  orgId?: string;
  endpoint: string;
  verified: boolean;
  models: string[];
  connected: boolean;
}

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

export interface PluginState {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  version: string;
  bundleId: string;
  source: "core" | "community" | "local";
  enabled: boolean;
  installed: boolean;
  requiredPermission?: string;
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

export interface MemoryEntry {
  id: string;
  content: string;
  source: string;
  createdAt: string;
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

export interface ProcessSampleRow {
  id: string;
  name: string;
  pid?: number;
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

export interface McpServerConfig {
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

export interface BuiltinSkillMeta {
  name: string;
  title: string;
  description: string;
  content: string;
  source?: string;
}

export interface ValetSyncState {
  homeDir: string;
  dataDir: string;
  isPaused: boolean;
  preferences: ValetPreferences;
  providers: AgentProviderConfig[];
  plugins: PluginState[];
  mcpServers?: McpServerConfig[];
  memories: MemoryEntry[];
  builtinSkills?: BuiltinSkillMeta[];
}

export interface TestProviderRequest {
  provider: AgentProviderConfig;
  model: string;
}

export interface TestAutoReviewRequest {
  autoReview: AutoReviewConfig;
}

export interface ProbeMcpRequest {
  server: McpServerConfig;
}

export interface ProbeMcpResponse {
  ok: boolean;
  toolCount: number;
  transportLabel: string;
  tools?: string[];
  error?: string;
}

export interface ToolPolicyMeta {
  toolName: string;
  pluginId: string;
  pluginName: string;
  actionId: string;
  eventCode: string;
  safety: ActionSafety;
  category: InboxCategory;
  iconKind: "trash" | "disk" | "pulse" | "mail";
  warningTag?: "不可撤销" | "外发消息";
  reversible7d: boolean;
  approveLabel: string;
  dismissLabel: string;
  checklistKey?: keyof SafetyConfirmationChecklist;
}

export interface QueueApprovalParams {
  pluginId: string;
  pluginName: string;
  eventCode: string;
  category: InboxCategory;
  iconKind: "trash" | "disk" | "pulse" | "mail";
  title: string;
  summary: string;
  reasoning: string;
  warningTag?: "不可撤销" | "外发消息";
  reversible7d: boolean;
  reclaimableGB?: number;
  approveLabel: string;
  dismissLabel: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  options?: string[];
  sourceChatId?: string;
  actionItems: Array<{
    id: string;
    label: string;
    path: string;
    sizeMB: number;
    sizeLabel: string;
    checked: boolean;
    keepNote?: string;
    defaultHidden?: boolean;
  }>;
}

export interface RecordTimelineParams {
  pluginId: string;
  pluginName: string;
  eventCode: string;
  title: string;
  summary: string;
  status: "running" | "pending_confirm" | "completed" | "failed";
  reasoning: string;
  reclaimedGB?: number;
  intercepted?: boolean;
  canRestore?: boolean;
  workflowRunId?: string;
  payload: Record<string, string | number | boolean>;
  actionItems?: QueueApprovalParams["actionItems"];
}

export interface ChatStreamStep {
  id: string;
  name: string;
  label?: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
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

export interface ChatStreamPayload {
  chatId: string;
  phase: "thinking" | "tools" | "streaming" | "done" | "error";
  partialText?: string;
  thinkingText?: string;
  reasoningText?: string;
  startedAt?: number;
  steps?: ChatStreamStep[];
  pendingPermission?: PendingPermissionRequest;
  error?: string;
}

export interface ResolvePermissionRequest {
  chatId: string;
  requestId: string;
  decision: "allow_once" | "allow_session" | "deny";
  note?: string;
}

export interface SendChatRequest {
  chatId: string;
  prompt: string;
  model: string;
  mentionPluginId?: string;
  attachments?: ChatAttachment[];
  requestId?: string;
  whenBusy?: "steer" | "followUp";
  interactive?: boolean;
}

export interface SendChatResponse {
  replyMessage: ChatMessage;
  queuedInboxIds: string[];
  timelineEventIds: string[];
  usageCostDelta: number;
  providerUsed: string;
}

export interface DispatchPluginEventRequest {
  pluginId: string;
  eventCode: string;
  payload?: Record<string, unknown>;
  simulated?: boolean;
}

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

export interface WorkflowGraphNodeDto {
  id: string;
  type:
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
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowGraphEdgeDto {
  id: string;
  from: string;
  to: string;
  when?: string;
  label?: string;
}

export interface WorkflowGraphDefinitionDto {
  version: number;
  name?: string;
  description?: string;
  nodes: WorkflowGraphNodeDto[];
  edges: WorkflowGraphEdgeDto[];
}

export interface WorkflowValidationResponse {
  valid: boolean;
  errors: string[];
  definition?: WorkflowGraphDefinitionDto;
  topologicalOrder: string[];
  entryNodeIds: string[];
}

export interface WorkflowGraphResponse {
  pluginId: string;
  executionMode: PluginExecutionMode;
  workflowYaml: string;
  valid: boolean;
  errors: string[];
  definition?: WorkflowGraphDefinitionDto;
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
  definition: WorkflowGraphDefinitionDto;
  triggerInput?: unknown;
  nodes: WorkflowNodeRunState[];
  edges: WorkflowEdgeRunState[];
}

export interface StartWorkflowRequest {
  pluginId: string;
  event?: string;
  source?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  waitForCompletionMs?: number;
}

export interface ResumeWorkflowHookRequest {
  token: string;
  approved: boolean;
  comment?: string;
  decidedBy?: string;
}

export interface ExecuteApprovedToolRequest {
  inboxId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  checkedPaths?: string[];
}

export interface AnswerInboxQuestionRequest {
  inboxId: string;
  question: string;
  answer: string;
  sourceChatId?: string;
}

export interface AnswerInboxQuestionResponse {
  ok: boolean;
  resolvedChatId: string;
  replyMessage: ChatMessage;
  queuedInboxIds: string[];
  timelineEventIds: string[];
  usageCostDelta: number;
  providerUsed: string;
}

export interface GenerateTitleRequest {
  chatId: string;
  prompt: string;
  attachments?: ChatAttachment[];
}

export interface GenerateTitleResponse {
  title: string;
  usedModel?: string;
}

/** Bridge interface allowing durable tools & hooks to invoke Go host capabilities. */
export interface HostBridge {
  callHost<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TResult>;
  notifyHost(method: string, params?: unknown): void;
}
