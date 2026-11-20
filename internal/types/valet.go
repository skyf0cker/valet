package types

// AppView mirrors the primary navigation views in Valet.
type AppView string

const (
	ViewInbox    AppView = "inbox"
	ViewTimeline AppView = "timeline"
	ViewProjects AppView = "projects"
	ViewChat     AppView = "chat"
	ViewPlugins  AppView = "plugins"
	ViewSettings AppView = "settings"

	// DefaultProjectID identifies the pinned system project that manages unassigned/existing sessions.
	DefaultProjectID = "proj-default"
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
	WebhookEndpoint    string `json:"webhookEndpoint,omitempty"`
	DebounceMs         int    `json:"debounceMs,omitempty"`
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
	ID            string `json:"id"`
	Description   string `json:"description"`
	Policy        string `json:"policy"` // "auto" | "ask" | "record"
	Sensor        string `json:"sensor,omitempty"`
	SourceSummary string `json:"sourceSummary,omitempty"`
	Count24h      int    `json:"count24h"`
}

// PluginActionCapability describes an executable plugin capability and its safety level.
type PluginActionCapability struct {
	ID          string `json:"id"`
	Safety      string `json:"safety"` // "readonly" | "reversible" | "confirm_always"
	SafetyLabel string `json:"safetyLabel"`
}

// PluginConfigField defines one declarative configuration input rendered dynamically on PluginDetailView.
type PluginConfigField struct {
	Key         string  `json:"key"`
	Label       string  `json:"label"`
	Type        string  `json:"type"` // "slider" | "number" | "text" | "boolean"
	Min         float64 `json:"min,omitempty"`
	Max         float64 `json:"max,omitempty"`
	Default     any     `json:"default,omitempty"`
	Description string  `json:"description,omitempty"`
}

// PluginConfig holds plugin-specific configuration fields.
type PluginConfig struct {
	Values               map[string]any `json:"values,omitempty"`
	LowSpaceThresholdPct *int           `json:"lowSpaceThresholdPct,omitempty"`
	ProtectedPaths       []string       `json:"protectedPaths,omitempty"`
	SampleIntervalSec    *int           `json:"sampleIntervalSec,omitempty"`
	CustomNote           string         `json:"customNote,omitempty"`
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
	Actions                 []PluginActionCapability `json:"actions,omitempty"`
	ConfigSchema            []PluginConfigField      `json:"configSchema,omitempty"`
	Config                  PluginConfig             `json:"config"`
	ManifestYAML            string                   `json:"manifestYaml"`
	ExecutionMode           string                   `json:"executionMode,omitempty"` // "skill" | "workflow"
	SkillMarkdown           string                   `json:"skillMarkdown,omitempty"`
	WorkflowYAML            string                   `json:"workflowYaml,omitempty"`
	LocalDir                string                   `json:"localDir,omitempty"`
	BundledFiles            []string                 `json:"bundledFiles,omitempty"`
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
	Options               []string             `json:"options,omitempty"`
	SelectedOption        string               `json:"selectedOption,omitempty"`
	SourceChatID          string               `json:"sourceChatId,omitempty"`
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
	WorkflowRunID       string               `json:"workflowRunId,omitempty"`
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
	Sensor           string `json:"sensor,omitempty"`
	SkillMarkdown    string `json:"skillMarkdown,omitempty"`
	Installed        bool   `json:"installed,omitempty"`
}

// ChatAttachment represents a file, image, screen, or quoted item attachment on a message.
type ChatAttachment struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // "image" | "file" | "screen" | "timeline_event" | "inbox_item"
	RefID       string `json:"refId,omitempty"`
	Name        string `json:"name"`
	Meta        string `json:"meta,omitempty"`
	Badge       string `json:"badge,omitempty"`
	Path        string `json:"path,omitempty"`
	DataURL     string `json:"dataUrl,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
	TextExcerpt string `json:"textExcerpt,omitempty"`
}

// ScreenCaptureResult reports the outcome of a native macOS screen capture request.
type ScreenCaptureResult struct {
	OK               bool            `json:"ok"`
	PermissionDenied bool            `json:"permissionDenied,omitempty"`
	Error            string          `json:"error,omitempty"`
	Attachment       *ChatAttachment `json:"attachment,omitempty"`
}

// ChatMessage stores one message inside a chat thread.
type ChatMessage struct {
	ID           string               `json:"id"`
	Role         string               `json:"role"` // "user" | "assistant"
	Content      string               `json:"content"`
	MetaLabel    string               `json:"metaLabel,omitempty"`
	CreatedAt    string               `json:"createdAt"`
	Attachments  []ChatAttachment     `json:"attachments,omitempty"`
	Steps        []ChatStreamStep     `json:"steps,omitempty"`
	ProcessTable *ProcessTablePayload `json:"processTable,omitempty"`
	PluginDraft  *PluginDraftSpec     `json:"pluginDraft,omitempty"`
}

// ChatThread represents one persistent agent conversation.
type ChatThread struct {
	ID                      string        `json:"id"`
	ProjectID               string        `json:"projectId,omitempty"`
	Title                   string        `json:"title"`
	Model                   string        `json:"model"`
	TimelineActionCount     int           `json:"timelineActionCount"`
	LinkedEventIDs          []string      `json:"linkedEventIds"`
	UpdatedAt               string        `json:"updatedAt"`
	Archived                bool          `json:"archived,omitempty"`
	ArchivedAt              string        `json:"archivedAt,omitempty"`
	OriginBlockID           string        `json:"originBlockId,omitempty"`
	OriginSection           string        `json:"originSection,omitempty"`
	NotebookContextInjected bool          `json:"notebookContextInjected,omitempty"`
	Messages                []ChatMessage `json:"messages"`
}

// NotebookBlock stores one Notion-style Markdown or embedded session reference block in a project Notebook.
type NotebookBlock struct {
	ID        string `json:"id"`
	Type      string `json:"type"` // "paragraph" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "todo" | "callout" | "quote" | "code" | "divider" | "session_ref"
	Content   string `json:"content"`
	Checked   bool   `json:"checked,omitempty"`
	Language  string `json:"language,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Summary   string `json:"summary,omitempty"`
}

// Project represents an upper-level container managing sessions alongside a Markdown Notebook.
type Project struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description,omitempty"`
	Icon        string          `json:"icon,omitempty"`
	Tags        []string        `json:"tags"`
	WorkingDir  string          `json:"workingDir,omitempty"`
	IsDefault   bool            `json:"isDefault,omitempty"`
	Archived    bool            `json:"archived,omitempty"`
	UpdatedAt   string          `json:"updatedAt"`
	CreatedAt   string          `json:"createdAt"`
	Blocks      []NotebookBlock `json:"blocks"`
}

// CreateProjectParams defines parameters for creating a new Project container.
type CreateProjectParams struct {
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Icon        string   `json:"icon,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	WorkingDir  string   `json:"workingDir,omitempty"`
}

// UpdateProjectParams updates one or more fields of an existing Project.
type UpdateProjectParams struct {
	ProjectID   string           `json:"projectId"`
	Title       *string          `json:"title,omitempty"`
	Description *string          `json:"description,omitempty"`
	Icon        *string          `json:"icon,omitempty"`
	Tags        *[]string        `json:"tags,omitempty"`
	WorkingDir  *string          `json:"workingDir,omitempty"`
	Blocks      *[]NotebookBlock `json:"blocks,omitempty"`
	Archived    *bool            `json:"archived,omitempty"`
}

// CreateProjectChatParams creates a new session inside a target Project (optionally spawned from @valet in Notebook).
type CreateProjectChatParams struct {
	ProjectID               string `json:"projectId"`
	Title                   string `json:"title,omitempty"`
	Model                   string `json:"model,omitempty"`
	OriginBlockID           string `json:"originBlockId,omitempty"`
	OriginSection           string `json:"originSection,omitempty"`
	NotebookContextInjected bool   `json:"notebookContextInjected,omitempty"`
	SwitchToSession         bool   `json:"switchToSession,omitempty"`
}

// CreateProjectChatResult returns both the updated snapshot and the newly created ChatThread.
type CreateProjectChatResult struct {
	Snapshot ValetSnapshot `json:"snapshot"`
	Thread   ChatThread    `json:"thread"`
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
	CronExpr       string `json:"cronExpr,omitempty"`
	Prompt         string `json:"prompt,omitempty"`
	LastRunAt      string `json:"lastRunAt,omitempty"`
}

// McpServerItem configures an external MCP server.
type McpServerItem struct {
	ID             string   `json:"id"`
	Abbr           string   `json:"abbr"`
	Name           string   `json:"name"`
	TransportLabel string   `json:"transportLabel"`
	ToolCount      int      `json:"toolCount"`
	Enabled        bool     `json:"enabled"`
	AuthExpired    bool     `json:"authExpired,omitempty"`
	Transport      string   `json:"transport,omitempty"` // "stdio" | "http"
	Command        string   `json:"command,omitempty"`
	Args           []string `json:"args,omitempty"`
	URL            string   `json:"url,omitempty"`
	StatusError    string   `json:"statusError,omitempty"`
}

// MemoryEntry holds a persisted user preference item.
type MemoryEntry struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	Source    string `json:"source"`
	CreatedAt string `json:"createdAt"`
}

// AgentHeartbeatConfig configures periodic background health & safety inspection turns.
type AgentHeartbeatConfig struct {
	Enabled     bool   `json:"enabled"`
	Initialized bool   `json:"initialized,omitempty"`
	IntervalMin int    `json:"intervalMin"`
	Prompt      string `json:"prompt"`
	LastRunAt   string `json:"lastRunAt,omitempty"`
}

// HeartbeatRunLog records one periodic or manual Agent heartbeat inspection turn (stored separately from Timeline).
type HeartbeatRunLog struct {
	ID         string `json:"id"`
	Timestamp  string `json:"timestamp"`
	CreatedAt  string `json:"createdAt"`
	Status     string `json:"status"` // "ok" | "error"
	Model      string `json:"model,omitempty"`
	DurationMs int    `json:"durationMs,omitempty"`
	Summary    string `json:"summary"`
	Detail     string `json:"detail,omitempty"`
}

// SafetyConfirmationChecklist tracks fine-grained confirmation switches.
type SafetyConfirmationChecklist struct {
	DeleteOrOverwrite    bool `json:"deleteOrOverwrite"`
	SendMessageOrEmail   bool `json:"sendMessageOrEmail"`
	PaymentOrSubscription bool `json:"paymentOrSubscription"`
	RunTerminalCommand   bool `json:"runTerminalCommand"`
	ModifySystemSettings bool `json:"modifySystemSettings"`
}

// AutoReviewConfig configures the Auto Review permission evaluation engine
// (TypeSafe AI Jev System One or Google Gemini Decisions `gemini-decision-1` + configurable small LLM fallback).
type AutoReviewConfig struct {
	Engine             string `json:"engine"` // "auto" | "jev" | "llm"
	JevEndpoint        string `json:"jevEndpoint"`
	JevAPIKey          string `json:"jevApiKey"`
	JevAPIKeyMasked    string `json:"jevApiKeyMasked,omitempty"`
	JevModel           string `json:"jevModel"`
	JevVerified        bool   `json:"jevVerified,omitempty"`
	JevLatencyMs       int    `json:"jevLatencyMs,omitempty"`
	FallbackProviderID string `json:"fallbackProviderId,omitempty"`
	FallbackModel      string `json:"fallbackModel"`
}

// ValetPreferences stores all Settings sections.
type ValetPreferences struct {
	LaunchAtLogin         bool                        `json:"launchAtLogin"`
	ShowMenuBarIcon       bool                        `json:"showMenuBarIcon"`
	Appearance            string                      `json:"appearance"` // "light" | "dark" | "auto"
	DarkTheme             string                      `json:"darkTheme,omitempty"` // "obsidian" | "espresso" | "chronometer"
	Language              string                      `json:"language"`
	GlobalHotkey          []string                    `json:"globalHotkey"`
	BusyMessagePolicy     string                      `json:"busyMessagePolicy,omitempty"` // "queue" | "steer"
	ActiveProviderID      string                      `json:"activeProviderId"`
	Models                ModelSelection              `json:"models"`
	AutoReview            AutoReviewConfig            `json:"autoReview"`
	DailySpendCurrent     float64                     `json:"dailySpendCurrent"`
	DailySpendLimit       float64                     `json:"dailySpendLimit"`
	MaxStepsPerTask       int                         `json:"maxStepsPerTask"`
	UserNickname          string                      `json:"userNickname"`
	ToneStyle             string                      `json:"toneStyle"` // "formal" | "concise" | "friendly"
	CustomInstructions    string                      `json:"customInstructions"`
	AutonomyLevel         string                      `json:"autonomyLevel"` // "always_ask" | "auto_review" | "full_access"
	ConfirmChecklist      SafetyConfirmationChecklist `json:"confirmChecklist"`
	BlockedApps           []string                    `json:"blockedApps"`
	EmergencyStopShortcut []string                    `json:"emergencyStopShortcut"`
	Thresholds            MonitoringThresholds        `json:"thresholds"`
	CleanupPolicy         CleanupPolicySettings       `json:"cleanupPolicy"`
	PluginRuntime         PluginRuntimeSettings       `json:"pluginRuntime"`
	Heartbeat             AgentHeartbeatConfig        `json:"heartbeat"`
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

// StorageStats reports real local storage footprint inside Valet's DataDir.
type StorageStats struct {
	TotalLabel    string `json:"totalLabel"`
	TotalBytes    int64  `json:"totalBytes"`
	DatabaseLabel string `json:"databaseLabel"`
	StateLabel    string `json:"stateLabel"`
	VaultLabel    string `json:"vaultLabel"`
	DataDir       string `json:"dataDir"`
}

// ValetSnapshot is the full persisted & synced application state shared with the UI.
type ValetSnapshot struct {
	SchemaVersion              int                   `json:"schemaVersion"`
	OnboardingCompleted        bool                  `json:"onboardingCompleted"`
	OnboardingStep             int                   `json:"onboardingStep"`
	ActiveView                 string                `json:"activeView"`
	ActiveSettingsSection      string                `json:"activeSettingsSection"`
	IsOnDuty                   bool                  `json:"isOnDuty"`
	IsPaused                   bool                  `json:"isPaused"`
	ActivePluginDetailID       *string               `json:"activePluginDetailId"`
	ActiveProjectID            string                `json:"activeProjectId"`
	ActiveProjectTab           string                `json:"activeProjectTab,omitempty"` // "notebook" | "sessions" | "session"
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
	Projects                   []Project             `json:"projects"`
	ChatThreads                []ChatThread          `json:"chatThreads"`
	Automations                []AutomationRule      `json:"automations"`
	McpServers                 []McpServerItem       `json:"mcpServers"`
	Memories                   []MemoryEntry         `json:"memories"`
	HeartbeatLogs              []HeartbeatRunLog     `json:"heartbeatLogs"`
	Preferences                ValetPreferences      `json:"preferences"`
	SystemMetrics              SystemMetrics         `json:"systemMetrics"`
	Scan                       ScanState             `json:"scan"`
	StorageStats               *StorageStats         `json:"storageStats,omitempty"`
}

// --- RPC & Streaming Payloads ---

// ProviderVerifyResult returns connectivity test results for an Agent provider.
type ProviderVerifyResult struct {
	OK         bool     `json:"ok"`
	LatencyMs  int      `json:"latencyMs"`
	ModelCount int      `json:"modelCount"`
	Models     []string `json:"models,omitempty"`
	Message    string   `json:"message"`
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
	BusyMode        string           `json:"busyMode,omitempty"` // "steer" | "followUp"
	Interactive     bool             `json:"interactive,omitempty"`
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
	Event         TimelineEvent      `json:"event"`
	InboxItem     *InboxApprovalItem `json:"inboxItem,omitempty"`
	WorkflowRunID string             `json:"workflowRunId,omitempty"`
}

// InstallCustomPluginParams defines a user-submitted custom plugin manifest.
type InstallCustomPluginParams struct {
	Name          string `json:"name"`
	Tagline       string `json:"tagline"`
	YAML          string `json:"yaml"`
	ExecutionMode string `json:"executionMode,omitempty"`
	SkillMarkdown string `json:"skillMarkdown,omitempty"`
	WorkflowYAML  string `json:"workflowYaml,omitempty"`
}

// ChatStreamStep tracks one live tool call during a turn.
type ChatStreamStep struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Label  string `json:"label,omitempty"`
	Status string `json:"status"` // "pending" | "running" | "done" | "error"
	Detail string `json:"detail,omitempty"`
}

// PendingPermissionRequest carries an interactive inline permission prompt for a live chat turn.
type PendingPermissionRequest struct {
	RequestID         string   `json:"requestId"`
	ChatID            string   `json:"chatId"`
	ToolName          string   `json:"toolName"`
	Title             string   `json:"title"`
	Summary           string   `json:"summary"`
	Command           string   `json:"command,omitempty"`
	Paths             []string `json:"paths,omitempty"`
	TargetPath        string   `json:"targetPath,omitempty"`
	Options           []string `json:"options,omitempty"`
	ApproveLabel      string   `json:"approveLabel"`
	AllowSessionLabel string   `json:"allowSessionLabel,omitempty"`
	DismissLabel      string   `json:"dismissLabel"`
}

// ChatStreamPayload carries incremental thinking, tool steps, and text deltas to the frontend.
type ChatStreamPayload struct {
	ChatID            string                    `json:"chatId"`
	Phase             string                    `json:"phase"` // "thinking" | "tools" | "streaming" | "done" | "error"
	PartialText       string                    `json:"partialText,omitempty"`
	ThinkingText      string                    `json:"thinkingText,omitempty"`
	Steps             []ChatStreamStep          `json:"steps,omitempty"`
	PendingPermission *PendingPermissionRequest `json:"pendingPermission,omitempty"`
	Error             string                    `json:"error,omitempty"`
}

// StateChangeNotice notifies frontend listeners when background agent or host work updates stored state.
type StateChangeNotice struct {
	Scope string `json:"scope"` // "full" | "inbox" | "timeline" | "plugins" | "settings"
}

// UpsertLocalPluginParams describes an authored or updated local plugin bundle on disk.
type UpsertLocalPluginParams struct {
	ID            string            `json:"id"`
	Slug          string            `json:"slug,omitempty"`
	Name          string            `json:"name"`
	Tagline       string            `json:"tagline,omitempty"`
	Description   string            `json:"description,omitempty"`
	ManifestYAML  string            `json:"manifestYaml"`
	ExecutionMode string            `json:"executionMode,omitempty"`
	SkillMarkdown string            `json:"skillMarkdown,omitempty"`
	WorkflowYAML  string            `json:"workflowYaml,omitempty"`
	Files         map[string]string `json:"files,omitempty"`
	LocalDir      string            `json:"localDir,omitempty"`
	Enabled       *bool             `json:"enabled,omitempty"`
}

// BuiltinSkillMeta describes a built-in or user-authored Agent Skill synced to the sidecar.
type BuiltinSkillMeta struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Content     string `json:"content"`
	Source      string `json:"source,omitempty"` // "builtin" | "user"
}

// NormalizeDarkTheme clamps darkTheme to a supported palette ID.
func NormalizeDarkTheme(raw string) string {
	switch raw {
	case "obsidian", "espresso", "chronometer":
		return raw
	default:
		return "obsidian"
	}
}

// AlwaysOnInboxItem represents a durable queued/batched event in the sidecar Always-On Inbox.
type AlwaysOnInboxItem struct {
	ID            string  `json:"id"`
	EventID       *string `json:"event_id"`
	Source        string  `json:"source"`
	PluginID      *string `json:"plugin_id"`
	EventType     string  `json:"event_type"`
	Title         string  `json:"title"`
	Payload       string  `json:"payload"`
	Trusted       bool    `json:"trusted"`
	ThreadKey     *string `json:"thread_key"`
	Status        string  `json:"status"` // "queued" | "in_run" | "done" | "dead"
	Attempts      int     `json:"attempts"`
	NextAttemptAt *string `json:"next_attempt_at"`
	RunID         *string `json:"run_id"`
	AgentReply    *string `json:"agent_reply"`
	Error         *string `json:"error"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

// AlwaysOnRun represents one coalesced batch execution run in the Always-On engine.
type AlwaysOnRun struct {
	ID         string   `json:"id"`
	Status     string   `json:"status"`   // "running" | "done" | "failed"
	EndKind    *string  `json:"end_kind"` // "sent" | "silent" | "deferred" | "error"
	EventIDs   []string `json:"event_ids"`
	HasChat    bool     `json:"has_chat"`
	Tainted    bool     `json:"tainted"`
	ReplyText  *string  `json:"reply_text"`
	Error      *string  `json:"error"`
	LeaseUntil string   `json:"lease_until"`
	StartedAt  string   `json:"started_at"`
	EndedAt    *string  `json:"ended_at"`
}

// AlwaysOnTimer represents a durable follow_up or drift-free schedule timer.
type AlwaysOnTimer struct {
	ID          string  `json:"id"`
	Kind        string  `json:"kind"` // "follow_up" | "schedule"
	Label       string  `json:"label"`
	Payload     string  `json:"payload"`
	DueAt       string  `json:"due_at"`
	EveryMs     *int64  `json:"every_ms"`
	AnchorAt    *string `json:"anchor_at"`
	Status      string  `json:"status"` // "armed" | "done" | "cancelled"
	FireCount   int     `json:"fire_count"`
	LastFiredAt *string `json:"last_fired_at"`
	CreatedBy   string  `json:"created_by"` // "agent" | "user"
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

// AlwaysOnOutboxMessage represents a quiet-by-default proactive notification or dead-letter alert.
type AlwaysOnOutboxMessage struct {
	ID        string         `json:"id"`
	RunID     *string        `json:"run_id"`
	Kind      string         `json:"kind"` // "message" | "approval_request" | "dead_letter"
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	CallID    *string        `json:"call_id"`
	Detail    map[string]any `json:"detail"`
	ReadAt    *string        `json:"read_at"`
	CreatedAt string         `json:"created_at"`
}

// AlwaysOnStats summarizes current Always-On queue, timer, and outbox counts.
type AlwaysOnStats struct {
	InboxTotal   int `json:"inbox_total"`
	InboxPending int `json:"inbox_pending"`
	InboxQueued  int `json:"inbox_queued"`
	InboxInRun   int `json:"inbox_in_run"`
	InboxDead    int `json:"inbox_dead"`
	TimersArmed  int `json:"timers_armed"`
	OutboxUnread int `json:"outbox_unread"`
	DebounceMs   int `json:"debounce_ms"`
}

// AlwaysOnOutboxList holds outbox messages and unread count.
type AlwaysOnOutboxList struct {
	Messages    []AlwaysOnOutboxMessage `json:"messages"`
	UnreadCount int                     `json:"unread_count"`
}

// AlwaysOnSnapshot aggregates the Always-On engine's durable state for UI/CLI inspection.
type AlwaysOnSnapshot struct {
	Stats     AlwaysOnStats       `json:"stats"`
	ActiveRun *AlwaysOnRun        `json:"activeRun"`
	Inbox     []AlwaysOnInboxItem `json:"inbox"`
	Runs      []AlwaysOnRun       `json:"runs"`
	Timers    []AlwaysOnTimer     `json:"timers"`
	Outbox    AlwaysOnOutboxList  `json:"outbox"`
}

// CreateAlwaysOnTimerParams defines parameters for creating a durable follow_up or schedule timer.
type CreateAlwaysOnTimerParams struct {
	Kind         string   `json:"kind"` // "follow_up" | "schedule"
	Label        string   `json:"label"`
	Payload      string   `json:"payload"`
	DelaySeconds *float64 `json:"delay_seconds,omitempty"`
	AtISO        string   `json:"at_iso,omitempty"`
	EverySeconds *float64 `json:"every_seconds,omitempty"`
	StartAtISO   string   `json:"start_at_iso,omitempty"`
}

// WorkflowGraphNode represents one declarative node in a plugin's workflow DAG.
type WorkflowGraphNode struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	Name        string         `json:"name,omitempty"`
	Description string         `json:"description,omitempty"`
	Config      map[string]any `json:"config,omitempty"`
}

// WorkflowGraphEdge represents one directed dependency/branch edge in a plugin's workflow DAG.
type WorkflowGraphEdge struct {
	ID    string `json:"id"`
	From  string `json:"from"`
	To    string `json:"to"`
	When  string `json:"when,omitempty"`
	Label string `json:"label,omitempty"`
}

// WorkflowGraphDefinition captures the validated workflow DAG definition.
type WorkflowGraphDefinition struct {
	Version     int                 `json:"version"`
	Name        string              `json:"name,omitempty"`
	Description string              `json:"description,omitempty"`
	Nodes       []WorkflowGraphNode `json:"nodes"`
	Edges       []WorkflowGraphEdge `json:"edges"`
}

// WorkflowValidationResult reports workflow.yaml syntax and DAG validation status.
type WorkflowValidationResult struct {
	Valid            bool                     `json:"valid"`
	Errors           []string                 `json:"errors"`
	Definition       *WorkflowGraphDefinition `json:"definition,omitempty"`
	TopologicalOrder []string                 `json:"topologicalOrder"`
	EntryNodeIds     []string                 `json:"entryNodeIds"`
}

// WorkflowGraphResponse returns a plugin's parsed workflow DAG and active execution mode.
type WorkflowGraphResponse struct {
	PluginID         string                   `json:"pluginId"`
	ExecutionMode    string                   `json:"executionMode"`
	WorkflowYAML     string                   `json:"workflowYaml"`
	Valid            bool                     `json:"valid"`
	Errors           []string                 `json:"errors"`
	Definition       *WorkflowGraphDefinition `json:"definition,omitempty"`
	TopologicalOrder []string                 `json:"topologicalOrder"`
	EntryNodeIds     []string                 `json:"entryNodeIds"`
}

// WorkflowRunSummary summarizes one durable local execution of a plugin workflow.
type WorkflowRunSummary struct {
	RunID           string `json:"runId"`
	PluginID        string `json:"pluginId"`
	PluginName      string `json:"pluginName"`
	TriggerEvent    string `json:"triggerEvent"`
	TriggerSource   string `json:"triggerSource"`
	Status          string `json:"status"`
	TimelineEventID string `json:"timelineEventId,omitempty"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
	CompletedAt     string `json:"completedAt,omitempty"`
	ErrorMessage    string `json:"errorMessage,omitempty"`
	DurationMs      int64  `json:"durationMs,omitempty"`
}

// WorkflowNodeRunState holds live/completed status, timings, and hydrated I/O for a single workflow node.
type WorkflowNodeRunState struct {
	NodeID      string `json:"nodeId"`
	NodeType    string `json:"nodeType"`
	NodeName    string `json:"nodeName"`
	Status      string `json:"status"`
	Attempt     int    `json:"attempt,omitempty"`
	StartedAt   string `json:"startedAt,omitempty"`
	CompletedAt string `json:"completedAt,omitempty"`
	DurationMs  int64  `json:"durationMs,omitempty"`
	Input       any    `json:"input,omitempty"`
	Output      any    `json:"output,omitempty"`
	Error       string `json:"error,omitempty"`
	HookToken   string `json:"hookToken,omitempty"`
	InboxID     string `json:"inboxId,omitempty"`
}

// WorkflowEdgeRunState holds evaluated edge routing status within a workflow run.
type WorkflowEdgeRunState struct {
	EdgeID string `json:"edgeId"`
	From   string `json:"from"`
	To     string `json:"to"`
	Status string `json:"status"`
}

// WorkflowRunDetail aggregates full canvas state, node I/O, and edge outcomes for a workflow run.
type WorkflowRunDetail struct {
	Summary      WorkflowRunSummary      `json:"summary"`
	Definition   WorkflowGraphDefinition `json:"definition"`
	TriggerInput any                     `json:"triggerInput,omitempty"`
	Nodes        []WorkflowNodeRunState  `json:"nodes"`
	Edges        []WorkflowEdgeRunState  `json:"edges"`
}

// WorkflowUpdatedPayload notifies the UI when a background workflow run advances state.
type WorkflowUpdatedPayload struct {
	PluginID           string `json:"pluginId"`
	RunID              string `json:"runId"`
	Status             string `json:"status"`
	Error              string `json:"error,omitempty"`
	TimelineEventID    string `json:"timelineEventId,omitempty"`
	CompletedNodeCount int    `json:"completedNodeCount,omitempty"`
}

// StartWorkflowParams configures a manual or host-driven workflow invocation.
type StartWorkflowParams struct {
	PluginID            string         `json:"pluginId"`
	Event               string         `json:"event,omitempty"`
	Source              string         `json:"source,omitempty"`
	Summary             string         `json:"summary,omitempty"`
	Payload             map[string]any `json:"payload,omitempty"`
	WaitForCompletionMs int            `json:"waitForCompletionMs,omitempty"`
}

// ResumeWorkflowHookParams resumes a suspended workflow approval gate via its hook token.
type ResumeWorkflowHookParams struct {
	Token     string `json:"token"`
	Approved  bool   `json:"approved"`
	Comment   string `json:"comment,omitempty"`
	DecidedBy string `json:"decidedBy,omitempty"`
}
