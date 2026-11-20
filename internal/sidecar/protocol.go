package sidecar

import (
	"encoding/json"

	"valet/internal/types"
)

// SyncState mirrors the subset of application state required by the durable Pi agent sidecar.
type SyncState struct {
	HomeDir       string                      `json:"homeDir"`
	DataDir       string                      `json:"dataDir"`
	IsPaused      bool                        `json:"isPaused"`
	Preferences   types.ValetPreferences      `json:"preferences"`
	Providers     []types.AgentProviderConfig `json:"providers"`
	Plugins       []types.PluginState         `json:"plugins"`
	McpServers    []types.McpServerItem       `json:"mcpServers"`
	Memories      []types.MemoryEntry         `json:"memories"`
	BuiltinSkills []types.BuiltinSkillMeta    `json:"builtinSkills,omitempty"`
}

// TestProviderRequest asks the sidecar to run a live single-turn completion check.
type TestProviderRequest struct {
	Provider types.AgentProviderConfig `json:"provider"`
	Model    string                    `json:"model"`
}

// TestAutoReviewRequest asks the sidecar to verify the Auto Review model configuration.
type TestAutoReviewRequest struct {
	AutoReview types.AutoReviewConfig `json:"autoReview"`
}

// ProbeMcpRequest tests an MCP server handshake and returns discovered tools.
type ProbeMcpRequest struct {
	Server types.McpServerItem `json:"server"`
}

// ProbeMcpResponse summarizes MCP server discovery results.
type ProbeMcpResponse struct {
	OK             bool     `json:"ok"`
	ToolCount      int      `json:"toolCount"`
	TransportLabel string   `json:"transportLabel"`
	Tools          []string `json:"tools,omitempty"`
	Error          string   `json:"error,omitempty"`
}

// InitParams initializes the sidecar harness with SQLite path and host state.
type InitParams struct {
	DBPath string    `json:"dbPath"`
	State  SyncState `json:"state"`
}

// ChatSendRequest dispatches a user message turn through a durable Conversation.
type ChatSendRequest struct {
	ChatID          string                 `json:"chatId"`
	Prompt          string                 `json:"prompt"`
	Model           string                 `json:"model"`
	MentionPluginID string                 `json:"mentionPluginId,omitempty"`
	Attachments     []types.ChatAttachment `json:"attachments,omitempty"`
	RequestID       string                 `json:"requestId,omitempty"`
	WhenBusy        string                 `json:"whenBusy,omitempty"` // "steer" | "followUp"
	Interactive     bool                   `json:"interactive,omitempty"`
}

// ChatSendResponse captures the committed assistant turn and any triggered Inbox/Timeline IDs.
type ChatSendResponse struct {
	ReplyMessage     types.ChatMessage `json:"replyMessage"`
	QueuedInboxIDs   []string          `json:"queuedInboxIds"`
	TimelineEventIDs []string          `json:"timelineEventIds"`
	UsageCostDelta   float64           `json:"usageCostDelta"`
	ProviderUsed     string            `json:"providerUsed"`
}

// PluginEventRequest dispatches a real or simulated plugin event into Pi Durable.
type PluginEventRequest struct {
	PluginID  string         `json:"pluginId"`
	EventCode string         `json:"eventCode"`
	Payload   map[string]any `json:"payload,omitempty"`
	Simulated bool           `json:"simulated"`
}

// PluginEventResponse returns routing policy and side-effect IDs for a dispatched event.
type PluginEventResponse struct {
	Handled          bool     `json:"handled"`
	Policy           string   `json:"policy"`
	ReplyText        string   `json:"replyText"`
	QueuedInboxIDs   []string `json:"queuedInboxIds"`
	TimelineEventIDs []string `json:"timelineEventIds"`
	WorkflowRunID    string   `json:"workflowRunId,omitempty"`
}

// ExecuteApprovedRequest runs a pre-approved Inbox tool invocation inside the sidecar.
type ExecuteApprovedRequest struct {
	InboxID      string         `json:"inboxId"`
	ToolName     string         `json:"toolName"`
	ToolArgs     map[string]any `json:"toolArgs"`
	CheckedPaths []string       `json:"checkedPaths,omitempty"`
}

// ResolvePermissionRequest delivers the user's inline permission decision to an interactive sidecar turn.
type ResolvePermissionRequest struct {
	ChatID    string `json:"chatId"`
	RequestID string `json:"requestId"`
	Decision  string `json:"decision"` // "allow_once" | "allow_session" | "deny"
	Note      string `json:"note,omitempty"`
}

// ExecuteApprovedResponse summarizes approved tool execution.
type ExecuteApprovedResponse struct {
	OK     bool   `json:"ok"`
	Output string `json:"output"`
}

// AnswerInboxQuestionRequest forwards a user's Inbox question selection back to Sidecar to continue execution.
type AnswerInboxQuestionRequest struct {
	InboxID      string `json:"inboxId"`
	Question     string `json:"question"`
	Answer       string `json:"answer"`
	SourceChatID string `json:"sourceChatId,omitempty"`
}

// AnswerInboxQuestionResponse summarizes the follow-up agent turn after an Inbox question is answered.
type AnswerInboxQuestionResponse struct {
	OK               bool              `json:"ok"`
	ResolvedChatID   string            `json:"resolvedChatId"`
	ReplyMessage     types.ChatMessage `json:"replyMessage"`
	QueuedInboxIDs   []string          `json:"queuedInboxIds"`
	TimelineEventIDs []string          `json:"timelineEventIds"`
	UsageCostDelta   float64           `json:"usageCostDelta"`
	ProviderUsed     string            `json:"providerUsed"`
}

// QueueApprovalRequest is sent by Sidecar's beforeTool safety hook to queue an Inbox card.
type QueueApprovalRequest struct {
	PluginID      string                     `json:"pluginId"`
	PluginName    string                     `json:"pluginName"`
	EventCode     string                     `json:"eventCode"`
	Category      string                     `json:"category"`
	IconKind      string                     `json:"iconKind"`
	Title         string                     `json:"title"`
	Summary       string                     `json:"summary"`
	Reasoning     string                     `json:"reasoning"`
	WarningTag    string                     `json:"warningTag,omitempty"`
	Reversible7d  bool                       `json:"reversible7d"`
	ReclaimableGB float64                    `json:"reclaimableGB,omitempty"`
	ApproveLabel  string                     `json:"approveLabel"`
	DismissLabel  string                     `json:"dismissLabel"`
	ToolName      string                     `json:"toolName"`
	ToolArgs      map[string]any             `json:"toolArgs"`
	Options       []string                   `json:"options,omitempty"`
	SourceChatID  string                     `json:"sourceChatId,omitempty"`
	ActionItems   []types.TimelineActionItem `json:"actionItems"`
}

// RecordTimelineRequest is sent by Sidecar after automatic/logged tool executions.
type RecordTimelineRequest struct {
	PluginID    string                     `json:"pluginId"`
	PluginName  string                     `json:"pluginName"`
	EventCode   string                     `json:"eventCode"`
	Title       string                     `json:"title"`
	Summary     string                     `json:"summary"`
	Status      string                     `json:"status"`
	Reasoning   string                     `json:"reasoning"`
	ReclaimedGB   float64                    `json:"reclaimedGB,omitempty"`
	Intercepted   bool                       `json:"intercepted,omitempty"`
	CanRestore    bool                       `json:"canRestore,omitempty"`
	WorkflowRunID string                     `json:"workflowRunId,omitempty"`
	Payload       map[string]any             `json:"payload"`
	ActionItems   []types.TimelineActionItem `json:"actionItems,omitempty"`
}

// AlwaysOnIngestRequest enqueues a durable event into the sidecar Always-On Inbox for coalesced execution.
type AlwaysOnIngestRequest struct {
	Source    string `json:"source"`
	PluginID  string `json:"plugin_id,omitempty"`
	EventType string `json:"event_type"`
	Title     string `json:"title"`
	Payload   string `json:"payload"`
	EventID   string `json:"event_id,omitempty"`
	Trusted   *bool  `json:"trusted,omitempty"`
	ThreadKey string `json:"thread_key,omitempty"`
}

// AlwaysOnIngestResponse reports whether an event was enqueued or deduplicated.
type AlwaysOnIngestResponse struct {
	Item         types.AlwaysOnInboxItem `json:"item"`
	Deduplicated bool                    `json:"deduplicated"`
	Immediate    bool                    `json:"immediate"`
}

// AlwaysOnOutboxNotifyPayload is sent by Sidecar when notify() or dead-letter writes an Outbox message.
type AlwaysOnOutboxNotifyPayload struct {
	Message types.AlwaysOnOutboxMessage `json:"message"`
	Level   string                      `json:"level"` // "info" | "warn" | "urgent"
}

type rpcEnvelope struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}
