package types

// AppView mirrors the primary navigation views in Valet.
type AppView string

const (
	ViewInbox    AppView = "inbox"
	ViewTimeline AppView = "timeline"
	ViewChat     AppView = "chat"
	ViewPlugins  AppView = "plugins"
	ViewSettings AppView = "settings"
)

// MonitoringThresholds configures disk, CPU/memory, and log thresholds.
type MonitoringThresholds struct {
	DiskLowSpacePct     int      `json:"diskLowSpacePct"`
	CacheBloatGB        string   `json:"cacheBloatGB"`
	LargeFileSizeGB     string   `json:"largeFileSizeGB"`
	LargeFileIdleDays   string   `json:"largeFileIdleDays"`
	CPUSpikePct         string   `json:"cpuSpikePct"`
	CPUSpikeDuration    string   `json:"cpuSpikeDuration"`
	MemoryPressureLevel string   `json:"memoryPressureLevel"`
	IgnoredProcesses    []string `json:"ignoredProcesses"`
	LogSensitivity      string   `json:"logSensitivity"`
	EventThrottle10m    bool     `json:"eventThrottle10m"`
}

// CleanupPolicySettings governs how files are deleted and protected.
type CleanupPolicySettings struct {
	DeleteMethod           string   `json:"deleteMethod"`
	RestoreRetentionDays   string   `json:"restoreRetentionDays"`
	ProtectedDirs          []string `json:"protectedDirs"`
	AutoScanAfterUninstall bool     `json:"autoScanAfterUninstall"`
}

// PluginRuntimeSettings configures plugin isolation, limits, and quiet hours.
type PluginRuntimeSettings struct {
	SandboxIsolation   bool   `json:"sandboxIsolation"`
	AllowUnsignedLocal bool   `json:"allowUnsignedLocal"`
	MaxEventsPerHour   string `json:"maxEventsPerHour"`
	QuietHours         string `json:"quietHours"`
}

// PermissionGuideStep describes one step in the permission grant wizard.
type PermissionGuideStep struct {
	Index  string `json:"index"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// MockSystemSettingApp mirrors an entry inside the Settings mockup preview.
type MockSystemSettingApp struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	IsValet bool   `json:"isValet,omitempty"`
	Enabled bool   `json:"enabled"`
}

// PermissionItem tracks macOS privacy & security permission state.
type PermissionItem struct {
	ID                  string                 `json:"id"`
	Name                string                 `json:"name"`
	Tier                string                 `json:"tier"`
	Description         string                 `json:"description"`
	SettingsSectionName string                 `json:"settingsSectionName"`
	SettingsSubtext     string                 `json:"settingsSubtext"`
	Granted             bool                   `json:"granted"`
	Steps               []PermissionGuideStep  `json:"steps"`
	MockApps            []MockSystemSettingApp `json:"mockApps"`
}

// PluginEventPolicy maps a plugin event code to a routing policy.
type PluginEventPolicy struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	Policy      string `json:"policy"` // "auto" | "ask" | "record"
	Count24h    int    `json:"count24h"`
}

// PluginActionCapability describes an executable plugin capability and its safety level.
type PluginActionCapability struct {
	ID          string `json:"id"`
	Safety      string `json:"safety"` // "readonly" | "reversible" | "confirm_always"
	SafetyLabel string `json:"safetyLabel"`
}

// PluginConfig holds plugin-specific configuration fields.
type PluginConfig struct {
	LowSpaceThresholdPct *int     `json:"lowSpaceThresholdPct,omitempty"`
	ProtectedPaths       []string `json:"protectedPaths,omitempty"`
	SampleIntervalSec    *int     `json:"sampleIntervalSec,omitempty"`
	CustomNote           string   `json:"customNote,omitempty"`
}

// PluginState stores all metadata, state, and manifest YAML for a plugin.
type PluginState struct {
	ID                      string                   `json:"id"`
	Slug                    string                   `json:"slug"`
	Name                    string                   `json:"name"`
	Tagline                 string                   `json:"tagline"`
	Description             string                   `json:"description"`
	Version                 string                   `json:"version"`
	BundleID                string                   `json:"bundleId"`
	IconKind                string                   `json:"iconKind"`
	IconLabel               string                   `json:"iconLabel,omitempty"`
	Source                  string                   `json:"source"` // "core" | "community" | "local"
	Enabled                 bool                     `json:"enabled"`
	Installed               bool                     `json:"installed"`
	AuthError               string                   `json:"authError,omitempty"`
	RequiredPermission      string                   `json:"requiredPermission,omitempty"`
	RequiredPermissionLabel string                   `json:"requiredPermissionLabel,omitempty"`
	DefaultBehaviorHint     string                   `json:"defaultBehaviorHint,omitempty"`
	StatusSubtitle          string                   `json:"statusSubtitle,omitempty"`
	WeeklyImpactValue       string                   `json:"weeklyImpactValue,omitempty"`
	WeeklyImpactUnit        string                   `json:"weeklyImpactUnit,omitempty"`
	WeeklyImpactLabel       string                   `json:"weeklyImpactLabel,omitempty"`
	Triggers24h             []int                    `json:"triggers24h"`
	Events                  []PluginEventPolicy      `json:"events"`
	Actions                 []PluginActionCapability `json:"actions"`
	Config                  PluginConfig             `json:"config"`
	ManifestYAML            string                   `json:"manifestYaml"`
}

// TimelineActionItem represents an individual target item inside an inbox/timeline checklist.
type TimelineActionItem struct {
	ID            string  `json:"id"`
	Label         string  `json:"label"`
	Path          string  `json:"path"`
	SizeMB        float64 `json:"sizeMB"`
	SizeLabel     string  `json:"sizeLabel"`
	Checked       bool    `json:"checked"`
	KeepNote      string  `json:"keepNote,omitempty"`
	DefaultHidden bool    `json:"defaultHidden,omitempty"`
}

// TraceStep captures a step in an event's execution chain.
type TraceStep struct {
	ID     string `json:"id"`
	Time   string `json:"time"`
	Stage  string `json:"stage"`
	Detail string `json:"detail"`
	Status string `json:"status"` // "done" | "active" | "waiting" | "error"
}

// LogLine represents a diagnostic log line recorded during event execution.
type LogLine struct {
	ID      string `json:"id"`
	TS      string `json:"ts"`
	Level   string `json:"level"` // "INFO" | "WARN" | "ERR" | "EXEC"
	Message string `json:"message"`
}

// TimelineProgress tracks long-running task completion on the timeline.
type TimelineProgress struct {
	CurrentLabel string  `json:"currentLabel"`
	CurrentGB    float64 `json:"currentGB"`
	TotalGB      float64 `json:"totalGB"`
	Pct          int     `json:"pct"`
	TargetPath   string  `json:"targetPath"`
}

// InboxApprovalItem represents an actionable approval card awaiting user decision.
type InboxApprovalItem struct {
	ID                    string               `json:"id"`
	Timestamp             string               `json:"timestamp"`
	TimeLabel             string               `json:"timeLabel"`
	AgeLabel              string               `json:"ageLabel,omitempty"`
	Category              string               `json:"category"` // "files" | "process" | "outbound"
	IconKind              string               `json:"iconKind"` // "trash" | "disk" | "pulse" | "mail"
	Title                 string               `json:"title"`
	Summary               string               `json:"summary"`
	PluginID              string               `json:"pluginId"`
	PluginName            string               `json:"pluginName"`
	PluginBadge           string               `json:"pluginBadge"`
	EventCode             string               `json:"eventCode"`
	WarningTag            string               `json:"warningTag,omitempty"`
	Reversible7d          bool                 `json:"reversible7d"`
	ReclaimableGB         float64              `json:"reclaimableGB,omitempty"`
	ApproveLabel          string               `json:"approveLabel"`
	DismissLabel          string               `json:"dismissLabel"`
	Status                string               `json:"status"` // "pending" | "approved" | "dismissed"
	Restored              bool                 `json:"restored,omitempty"`
	ProcessedAt           string               `json:"processedAt,omitempty"`
	LinkedTimelineEventID string               `json:"linkedTimelineEventId,omitempty"`
	TriggerLatencyLabel   string               `json:"triggerLatencyLabel,omitempty"`
	Payload               map[string]any       `json:"payload"`
	Reasoning             string               `json:"reasoning"`
	ActionItems           []TimelineActionItem `json:"actionItems"`
	TraceSteps            []TraceStep          `json:"traceSteps"`
	Logs                  []LogLine            `json:"logs"`
	ToolName              string               `json:"toolName,omitempty"`
	ToolArgs              map[string]any       `json:"toolArgs,omitempty"`
	TrashBatchID          string               `json:"trashBatchId,omitempty"`
}

// TimelineEvent represents an audit & execution entry on the Timeline.
type TimelineEvent struct {
	ID                  string               `json:"id"`
	Timestamp           string               `json:"timestamp"`
	TimeLabel           string               `json:"timeLabel"`
	DayGroup            string               `json:"dayGroup"` // "today" | "earlier"
	Title               string               `json:"title"`
	Summary             string               `json:"summary"`
	PluginID            string               `json:"pluginId"`
	PluginName          string               `json:"pluginName"`
	PluginBadge         string               `json:"pluginBadge"`
	EventCode           string               `json:"eventCode"`
	Status              string               `json:"status"` // "running" | "pending_confirm" | "completed" | "failed"
	Progress            *TimelineProgress    `json:"progress,omitempty"`
	ConfirmBannerText   string               `json:"confirmBannerText,omitempty"`
	AuthFixPluginID     string               `json:"authFixPluginId,omitempty"`
	TriggerLatencyLabel string               `json:"triggerLatencyLabel,omitempty"`
	Payload             map[string]any       `json:"payload"`
	Reasoning           string               `json:"reasoning"`
	ActionItems         []TimelineActionItem `json:"actionItems"`
	TraceSteps          []TraceStep          `json:"traceSteps"`
	Logs                []LogLine            `json:"logs"`
	ReclaimedGB         float64              `json:"reclaimedGB,omitempty"`
	Intercepted         bool                 `json:"intercepted,omitempty"`
	CanRestore          bool                 `json:"canRestore,omitempty"`
	Restored            bool                 `json:"restored,omitempty"`
	Ignored             bool                 `json:"ignored,omitempty"`
	TrashBatchID        string               `json:"trashBatchId,omitempty"`
}

// ProcessSampleRow holds a single sampled system process row inside a chat card.
type ProcessSampleRow struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	PID         int    `json:"pid,omitempty"`
	CPUPct      int    `json:"cpuPct"`
	MemLabel    string `json:"memLabel"`
	SourceLabel string `json:"sourceLabel"`
	Severity    string `json:"severity"` // "high" | "normal"
	Killed      bool   `json:"killed,omitempty"`
}

// ProcessTablePayload holds the process table card attached to an assistant message.
type ProcessTablePayload struct {
	Rows                []ProcessSampleRow `json:"rows"`
	PrimaryActionDone   bool               `json:"primaryActionDone,omitempty"`
	SecondaryActionDone bool               `json:"secondaryActionDone,omitempty"`
	AutoRuleAdded       bool               `json:"autoRuleAdded,omitempty"`
}

// PluginDraftSpec describes a natural-language generated YAML plugin draft.
type PluginDraftSpec struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	WhenExpression   string `json:"whenExpression"`
	ActionExpression string `json:"actionExpression"`
	ManifestYAML     string `json:"manifestYaml"`
	Installed        bool   `json:"installed,omitempty"`
}

// ChatAttachment represents a file, image, or screen attachment on a message.
type ChatAttachment struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"` // "image" | "file" | "screen"
	Name  string `json:"name"`
	Meta  string `json:"meta,omitempty"`
	Badge string `json:"badge,omitempty"`
}

// ChatMessage stores one message inside a chat thread.
type ChatMessage struct {
	ID           string               `json:"id"`
	Role         string               `json:"role"` // "user" | "assistant"
	Content      string               `json:"content"`
	MetaLabel    string               `json:"metaLabel,omitempty"`
	CreatedAt    string               `json:"createdAt"`
	Attachments  []ChatAttachment     `json:"attachments,omitempty"`
	ProcessTable *ProcessTablePayload `json:"processTable,omitempty"`
	PluginDraft  *PluginDraftSpec     `json:"pluginDraft,omitempty"`
}

// ChatThread represents one persistent agent conversation.
type ChatThread struct {
	ID                  string        `json:"id"`
	Title               string        `json:"title"`
	Model               string        `json:"model"`
	TimelineActionCount int           `json:"timelineActionCount"`
	LinkedEventIDs      []string      `json:"linkedEventIds"`
	UpdatedAt           string        `json:"updatedAt"`
	Messages            []ChatMessage `json:"messages"`
}

// AgentProviderConfig stores LLM provider connection metadata.
type AgentProviderConfig struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	Letter              string   `json:"letter"`
	Subtitle            string   `json:"subtitle"`
	APIKey              string   `json:"apiKey"`
	APIKeyMasked        string   `json:"apiKeyMasked"`
	BaseURL             string   `json:"baseUrl"`
	ProxyURL            string   `json:"proxyUrl"`
	OrgID               string   `json:"orgId"`
	Endpoint            string   `json:"endpoint"`
	Verified            bool     `json:"verified"`
	LatencyMs           int      `json:"latencyMs,omitempty"`
	AvailableModelCount int      `json:"availableModelCount"`
	Models              []string `json:"models"`
	Connected           bool     `json:"connected"`
}

// ModelSelection identifies primary, fast, and vision model IDs.
type ModelSelection struct {
	Primary string `json:"primary"`
	Fast    string `json:"fast"`
	Vision  string `json:"vision"`
}

// AutomationRule represents a cron or event-driven automation rule.
type AutomationRule struct {
	ID             string `json:"id"`
	ScheduleTop    string `json:"scheduleTop"`
	ScheduleBottom string `json:"scheduleBottom"`
	Title          string `json:"title"`
	Subtitle       string `json:"subtitle,omitempty"`
	Enabled        bool   `json:"enabled"`
	TriggerType    string `json:"triggerType"` // "cron" | "event"
}

// McpServerItem configures an external MCP server.
type McpServerItem struct {
	ID             string `json:"id"`
	Abbr           string `json:"abbr"`
	Name           string `json:"name"`
	TransportLabel string `json:"transportLabel"`
	ToolCount      int    `json:"toolCount"`
	Enabled        bool   `json:"enabled"`
	AuthExpired    bool   `json:"authExpired,omitempty"`
}

// MemoryEntry holds a persisted user preference item.
type MemoryEntry struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	Source    string `json:"source"`
	CreatedAt string `json:"createdAt"`
}

// SafetyConfirmationChecklist tracks fine-grained confirmation switches.
type SafetyConfirmationChecklist struct {
	DeleteOrOverwrite    bool `json:"deleteOrOverwrite"`
	SendMessageOrEmail   bool `json:"sendMessageOrEmail"`
	PaymentOrSubscription bool `json:"paymentOrSubscription"`
	RunTerminalCommand   bool `json:"runTerminalCommand"`
	ModifySystemSettings bool `json:"modifySystemSettings"`
}

// ValetPreferences stores all Settings sections.
type ValetPreferences struct {
	LaunchAtLogin         bool                        `json:"launchAtLogin"`
	ShowMenuBarIcon       bool                        `json:"showMenuBarIcon"`
	Appearance            string                      `json:"appearance"` // "light" | "dark" | "auto"
	Language              string                      `json:"language"`
	GlobalHotkey          []string                    `json:"globalHotkey"`
	ActiveProviderID      string                      `json:"activeProviderId"`
	Models                ModelSelection              `json:"models"`
	DailySpendCurrent     float64                     `json:"dailySpendCurrent"`
	DailySpendLimit       float64                     `json:"dailySpendLimit"`
	MaxStepsPerTask       int                         `json:"maxStepsPerTask"`
	UserNickname          string                      `json:"userNickname"`
	ToneStyle             string                      `json:"toneStyle"` // "formal" | "concise" | "friendly"
	CustomInstructions    string                      `json:"customInstructions"`
	AutonomyLevel         string                      `json:"autonomyLevel"` // "always_ask" | "sensitive_only" | "autonomous"
	ConfirmChecklist      SafetyConfirmationChecklist `json:"confirmChecklist"`
	BlockedApps           []string                    `json:"blockedApps"`
	EmergencyStopShortcut []string                    `json:"emergencyStopShortcut"`
	Thresholds            MonitoringThresholds        `json:"thresholds"`
	CleanupPolicy         CleanupPolicySettings       `json:"cleanupPolicy"`
	PluginRuntime         PluginRuntimeSettings       `json:"pluginRuntime"`
	MemoryEnabled         bool                        `json:"memoryEnabled"`
	AutoLearnMemory       bool                        `json:"autoLearnMemory"`
	HoldToSpeakKey        string                      `json:"holdToSpeakKey"`
	WakeWordEnabled       bool                        `json:"wakeWordEnabled"`
	SpeechLanguage        string                      `json:"speechLanguage"`
	SpeakReplies          string                      `json:"speakReplies"`
	NotifyOnConfirm       bool                        `json:"notifyOnConfirm"`
	NotifyOnComplete      bool                        `json:"notifyOnComplete"`
	NotifyOnFailure       bool                        `json:"notifyOnFailure"`
	FollowFocusMode       bool                        `json:"followFocusMode"`
	RecordActionReplay    bool                        `json:"recordActionReplay"`
	BlurSensitiveInfo     bool                        `json:"blurSensitiveInfo"`
	TimelineRetentionDays string                      `json:"timelineRetentionDays"`
}

// SystemMetrics reports live host telemetry shown in the sidebar.
type SystemMetrics struct {
	DiskPct           int     `json:"diskPct"`
	DiskFreeGB        float64 `json:"diskFreeGB"`
	DiskTotalGB       float64 `json:"diskTotalGB"`
	CPUPct            int     `json:"cpuPct"`
	MemPct            int     `json:"memPct"`
	ActiveTaskLabel   *string `json:"activeTaskLabel"`
	ActiveTaskPct     int     `json:"activeTaskPct"`
	ActiveTaskEventID *string `json:"activeTaskEventId"`
}

// ScanTaskItem summarizes one check category in onboarding first-scan.
type ScanTaskItem struct {
	ID           string  `json:"id"` // "disk" | "orphan" | "process" | "log"
	Title        string  `json:"title"`
	Detail       string  `json:"detail"`
	SizeLabel    string  `json:"sizeLabel"`
	SizeGB       float64 `json:"sizeGB"`
	Status       string  `json:"status"` // "pending" | "running" | "done" | "skipped"
	DurationHint string  `json:"durationHint,omitempty"`
}

// ScanState holds the latest system health scan progress and summary.
type ScanState struct {
	Status        string         `json:"status"` // "idle" | "running" | "done"
	ProgressPct   int            `json:"progressPct"`
	ElapsedSec    int            `json:"elapsedSec"`
	ReclaimableGB float64        `json:"reclaimableGB"`
	Tasks         []ScanTaskItem `json:"tasks"`
}

// ValetSnapshot is the full persisted & synced application state shared with the UI.
type ValetSnapshot struct {
	OnboardingCompleted        bool                  `json:"onboardingCompleted"`
	OnboardingStep             int                   `json:"onboardingStep"`
	ActiveView                 string                `json:"activeView"`
	ActiveSettingsSection      string                `json:"activeSettingsSection"`
	IsOnDuty                   bool                  `json:"isOnDuty"`
	IsPaused                   bool                  `json:"isPaused"`
	ActivePluginDetailID       *string               `json:"activePluginDetailId"`
	ActiveChatID               string                `json:"activeChatId"`
	SelectedTimelineEventID    *string               `json:"selectedTimelineEventId"`
	SelectedInboxItemID        *string               `json:"selectedInboxItemId"`
	TimelinePluginFilter       string                `json:"timelinePluginFilter"`
	Permissions                []PermissionItem      `json:"permissions"`
	Plugins                    []PluginState         `json:"plugins"`
	Providers                  []AgentProviderConfig `json:"providers"`
	InboxItems                 []InboxApprovalItem   `json:"inboxItems"`
	InboxProcessedHistoryCount int                   `json:"inboxProcessedHistoryCount"`
	TimelineEvents             []TimelineEvent       `json:"timelineEvents"`
	EarlierCountLabel          string                `json:"earlierCountLabel"`
	ChatThreads                []ChatThread          `json:"chatThreads"`
	Automations                []AutomationRule      `json:"automations"`
	McpServers                 []McpServerItem       `json:"mcpServers"`
	Memories                   []MemoryEntry         `json:"memories"`
	Preferences                ValetPreferences      `json:"preferences"`
	SystemMetrics              SystemMetrics         `json:"systemMetrics"`
	Scan                       ScanState             `json:"scan"`
}

// --- RPC & Streaming Payloads ---

// ProviderVerifyResult returns connectivity test results for an Agent provider.
type ProviderVerifyResult struct {
	OK         bool   `json:"ok"`
	LatencyMs  int    `json:"latencyMs"`
	ModelCount int    `json:"modelCount"`
	Message    string `json:"message"`
}

// TestMessageResult returns the output of a provider test ping.
type TestMessageResult struct {
	OK        bool   `json:"ok"`
	Reply     string `json:"reply"`
	LatencyMs int    `json:"latencyMs"`
}

// SendChatParams carries user input, target model, and attachments to the durable agent.
type SendChatParams struct {
	ChatID          string           `json:"chatId"`
	Prompt          string           `json:"prompt"`
	Model           string           `json:"model"`
	MentionPluginID string           `json:"mentionPluginId,omitempty"`
	Attachments     []ChatAttachment `json:"attachments,omitempty"`
}

// SendChatResult returns the completed turn message and any queued Inbox / Timeline items.
type SendChatResult struct {
	ReplyMessage    ChatMessage        `json:"replyMessage"`
	CreatedInbox    *InboxApprovalItem `json:"createdInbox,omitempty"`
	CreatedEvent    *TimelineEvent     `json:"createdEvent,omitempty"`
	ProviderUsed    string             `json:"providerUsed"`
	UsageCostDelta  float64            `json:"usageCostDelta"`
}

// SimulateEventResult returns the Timeline and optional Inbox card created for a simulated event.
type SimulateEventResult struct {
	Event     TimelineEvent      `json:"event"`
	InboxItem *InboxApprovalItem `json:"inboxItem,omitempty"`
}

// InstallCustomPluginParams defines a user-submitted custom plugin manifest.
type InstallCustomPluginParams struct {
	Name    string `json:"name"`
	Tagline string `json:"tagline"`
	YAML    string `json:"yaml"`
}

// ChatStreamStep tracks one live tool call during a turn.
type ChatStreamStep struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"` // "pending" | "running" | "done" | "error"
	Detail string `json:"detail,omitempty"`
}

// ChatStreamPayload carries incremental thinking, tool steps, and text deltas to the frontend.
type ChatStreamPayload struct {
	ChatID       string           `json:"chatId"`
	Phase        string           `json:"phase"` // "thinking" | "tools" | "streaming" | "done" | "error"
	PartialText  string           `json:"partialText,omitempty"`
	ThinkingText string           `json:"thinkingText,omitempty"`
	Steps        []ChatStreamStep `json:"steps,omitempty"`
	Error        string           `json:"error,omitempty"`
}

// StateChangeNotice notifies frontend listeners when background agent or host work updates stored state.
type StateChangeNotice struct {
	Scope string `json:"scope"` // "full" | "inbox" | "timeline" | "plugins" | "settings"
}
