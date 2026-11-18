package store

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"valet/internal/plugins"
	"valet/internal/sys"
	"valet/internal/types"
	pluginsbundle "valet/plugins"
)

// NewSeedSnapshot builds a Clean Slate SchemaVersion 2 initial state with real host metrics,
// declarative core & community plugins, zero mock inbox/timeline/chat history, and real env provider keys if set.
func NewSeedSnapshot(homeDir string) types.ValetSnapshot {
	metrics := sys.SampleDiskMetrics(homeDir)
	proc := sys.SampleProcesses(context.Background(), 3)
	metrics.CPUPct = proc.CPUPct
	metrics.MemPct = proc.MemPct
	metrics.ActiveTaskLabel = nil
	metrics.ActiveTaskPct = 0
	metrics.ActiveTaskEventID = nil

	prefs := seedPreferences()
	return types.ValetSnapshot{
		SchemaVersion:              CurrentSchemaVersion,
		OnboardingCompleted:        false,
		OnboardingStep:             1,
		ActiveView:                 string(types.ViewInbox),
		ActiveSettingsSection:      "models",
		IsOnDuty:                   true,
		IsPaused:                   false,
		ActivePluginDetailID:       nil,
		ActiveChatID:               "chat-default",
		SelectedTimelineEventID:    nil,
		SelectedInboxItemID:        nil,
		TimelinePluginFilter:       "all",
		InboxProcessedHistoryCount: 0,
		EarlierCountLabel:          "",
		Permissions:                seedPermissions(),
		Plugins:                    seedPlugins(),
		Providers:                  seedProviders(),
		InboxItems:                 []types.InboxApprovalItem{},
		TimelineEvents:             []types.TimelineEvent{},
		ChatThreads:                seedChatThreads(prefs.Models.Primary, prefs.UserNickname),
		Automations:                []types.AutomationRule{},
		McpServers:                 []types.McpServerItem{},
		Memories:                   []types.MemoryEntry{},
		HeartbeatLogs:              []types.HeartbeatRunLog{},
		Preferences:                prefs,
		SystemMetrics:              metrics,
		Scan:                       seedScanState(),
	}
}

func seedPreferences() types.ValetPreferences {
	nick := strings.TrimSpace(os.Getenv("USER"))
	if nick == "" {
		nick = "你"
	}
	return types.ValetPreferences{
		LaunchAtLogin:      false,
		ShowMenuBarIcon:    true,
		Appearance:         "auto",
		DarkTheme:          "obsidian",
		Language:           "简体中文",
		GlobalHotkey:       []string{"⌥", "Space"},
		BusyMessagePolicy:  "queue",
		ActiveProviderID:   "anthropic",
		Models:             types.ModelSelection{Primary: "claude-sonnet-4-5", Fast: "claude-haiku-4-5", Vision: "同主模型"},
		AutoReview:         DefaultAutoReviewConfig(),
		DailySpendCurrent:  0,
		DailySpendLimit:    30,
		MaxStepsPerTask:    50,
		UserNickname:       nick,
		ToneStyle:          "concise",
		CustomInstructions: "",
		AutonomyLevel:      "auto_review",
		ConfirmChecklist: types.SafetyConfirmationChecklist{
			DeleteOrOverwrite:     false,
			SendMessageOrEmail:    true,
			PaymentOrSubscription: true,
			RunTerminalCommand:    false,
			ModifySystemSettings:  false,
		},
		BlockedApps:           []string{"钥匙串访问", "1Password"},
		EmergencyStopShortcut: []string{"⌥", "⎋"},
		Thresholds:            DefaultThresholds(),
		CleanupPolicy:         DefaultCleanupPolicy(),
		PluginRuntime:         DefaultPluginRuntime(),
		Heartbeat:             DefaultHeartbeatConfig(),
		MemoryEnabled:         true,
		AutoLearnMemory:       true,
		HoldToSpeakKey:        "fn",
		WakeWordEnabled:       false,
		SpeechLanguage:        "中文 + English",
		SpeakReplies:          "仅语音提问时",
		NotifyOnConfirm:       true,
		NotifyOnComplete:      true,
		NotifyOnFailure:       false,
		FollowFocusMode:       true,
		RecordActionReplay:    false,
		BlurSensitiveInfo:     true,
		TimelineRetentionDays: "30 天",
	}
}

// DefaultThresholds returns canonical default monitoring thresholds.
func DefaultThresholds() types.MonitoringThresholds {
	return types.MonitoringThresholds{
		DiskLowSpacePct:     15,
		CacheBloatGB:        "5 GB",
		LargeFileSizeGB:     "2 GB",
		LargeFileIdleDays:   "90 天",
		CPUSpikePct:         "200%",
		CPUSpikeDuration:    "5 分钟",
		MemoryPressureLevel: "red",
		IgnoredProcesses:    []string{"Xcode", "ffmpeg", "Docker"},
		LogSensitivity:      "medium",
		EventThrottle10m:    true,
	}
}

// DefaultCleanupPolicy returns canonical cleanup protection defaults.
func DefaultCleanupPolicy() types.CleanupPolicySettings {
	return types.CleanupPolicySettings{
		DeleteMethod:           "移入废纸篓",
		RestoreRetentionDays:   "7 天",
		ProtectedDirs:          []string{"~/Documents", "~/Projects"},
		AutoScanAfterUninstall: true,
	}
}

// DefaultHeartbeatConfig returns canonical agent periodic heartbeat inspection defaults.
func DefaultHeartbeatConfig() types.AgentHeartbeatConfig {
	return types.AgentHeartbeatConfig{
		Enabled:     true,
		Initialized: true,
		IntervalMin: 30,
		Prompt:      "巡检当前待处理的系统与应用事件、收件箱待确认事项及后台服务状态；若发现需要关注的异常则按自治策略响应或汇总至收件箱，若一切平稳则静默记录心跳。",
	}
}

// DefaultAutoReviewConfig returns canonical Auto Review model evaluation defaults.
func DefaultAutoReviewConfig() types.AutoReviewConfig {
	jevEnv := strings.TrimSpace(os.Getenv("TYPESAFE_API_KEY"))
	return types.AutoReviewConfig{
		Engine:             "auto",
		JevEndpoint:        "https://api.typesafe.ai/v1/systemone",
		JevAPIKey:          jevEnv,
		JevAPIKeyMasked:    maskKey(jevEnv),
		JevModel:           "jev-latest",
		JevVerified:        jevEnv != "",
		FallbackProviderID: "",
		FallbackModel:      "同快速模型",
	}
}

// DefaultPluginRuntime returns canonical sandbox & rate-limit defaults.
func DefaultPluginRuntime() types.PluginRuntimeSettings {
	return types.PluginRuntimeSettings{
		SandboxIsolation:   true,
		AllowUnsignedLocal: true,
		MaxEventsPerHour:   "60 / 小时",
		QuietHours:         "23:30 – 08:00",
	}
}

func seedPermissions() []types.PermissionItem {
	return []types.PermissionItem{
		{
			ID:                  "full_disk",
			Name:                "完全磁盘访问",
			Tier:                "required",
			Description:         "扫描缓存与卸载残留、读取系统日志——Valet 的核心能力都依赖它",
			SettingsSectionName: "完全磁盘访问权限",
			SettingsSubtext:     "允许以下应用访问用户缓存、下载目录与系统诊断日志。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "点击下方按钮，Valet 会直接带你到「隐私与安全性 › 完全磁盘访问权限」。"},
				{Index: "02", Title: "打开 Valet 的开关", Detail: "在列表中找到 Valet，打开右侧开关，并输入解锁密码或使用触控 ID。"},
				{Index: "03", Title: "回到这里", Detail: "若系统提示「退出并重新打开」，选择稍后，Valet 会自动检测并继续。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: false},
			},
		},
		{
			ID:                  "accessibility",
			Name:                "辅助功能",
			Tier:                "recommended",
			Description:         "辅助感知前台窗口与全局快捷键响应",
			SettingsSectionName: "辅助功能",
			SettingsSubtext:     "允许以下应用全局监听快捷键并协助操作界面。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "点击下方按钮，前往「隐私与安全性 › 辅助功能」。"},
				{Index: "02", Title: "启用 Valet", Detail: "在列表勾选或打开 Valet 的辅助功能开关。"},
				{Index: "03", Title: "自动同步", Detail: "授权完成后这里会自动刷新状态。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: false},
			},
		},
		{
			ID:                  "screen_recording",
			Name:                "屏幕录制",
			Tier:                "recommended",
			Description:         "用于截屏提问与视觉诊断分析",
			SettingsSectionName: "屏幕录制与系统录音",
			SettingsSubtext:     "允许以下应用捕获屏幕画面以进行本地多模态分析。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "前往「隐私与安全性 › 屏幕录制」。"},
				{Index: "02", Title: "打开 Valet 的开关", Detail: "允许 Valet 截取当前屏幕画面供分析。"},
				{Index: "03", Title: "回到 Valet", Detail: "状态会自动更新，所有截图仅保留在本地。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: false},
			},
		},
		{
			ID:                  "automation",
			Name:                "自动化",
			Tier:                "recommended",
			Description:         "通过 Apple Events 协助控制 Finder、日历、勿扰等系统能力",
			SettingsSectionName: "自动化",
			SettingsSubtext:     "允许 Valet 向 Finder、Calendar 等应用发送自动化指令。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "前往「隐私与安全性 › 自动化」。"},
				{Index: "02", Title: "展开 Valet 条目", Detail: "勾选允许控制的系统应用。"},
				{Index: "03", Title: "回到这里", Detail: "点击检测刷新状态。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: false},
			},
		},
		{
			ID:                  "notifications",
			Name:                "通知",
			Tier:                "recommended",
			Description:         "任务完成或需要批准敏感操作时及时通知你",
			SettingsSectionName: "通知",
			SettingsSubtext:     "允许 Valet 在需要你确认或任务完成时发送系统通知。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "前往「通知 › Valet」。"},
				{Index: "02", Title: "开启允许通知", Detail: "建议选择「横幅」样式以便及时确认操作。"},
				{Index: "03", Title: "完成", Detail: "状态已就绪。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: false},
			},
		},
		{
			ID:                  "microphone",
			Name:                "麦克风",
			Tier:                "optional",
			Description:         "用于语音输入指令（仅主动按下时采集）",
			SettingsSectionName: "麦克风",
			SettingsSubtext:     "允许以下应用在语音提问时访问麦克风。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "前往「隐私与安全性 › 麦克风」。"},
				{Index: "02", Title: "开启 Valet 开关", Detail: "仅在主动语音输入时开启采集。"},
				{Index: "03", Title: "回到这里", Detail: "即可使用语音功能。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: false},
			},
		},
	}
}

func seedPlugins() []types.PluginState {
	catalog, err := plugins.LoadCatalogFromFS(pluginsbundle.CatalogFS)
	if err != nil {
		return []types.PluginState{}
	}
	return catalog
}

func seedProviders() []types.AgentProviderConfig {
	anthropicEnv := strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY"))
	openaiEnv := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	geminiEnv := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	openrouterEnv := strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY"))

	return []types.AgentProviderConfig{
		{
			ID: "anthropic", Name: "Anthropic", Letter: "A", Subtitle: "Claude 系列 · 推荐",
			APIKey: anthropicEnv, APIKeyMasked: maskKey(anthropicEnv),
			BaseURL: "https://api.anthropic.com", Verified: anthropicEnv != "", AvailableModelCount: 3,
			Models: []string{"claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"}, Connected: anthropicEnv != "",
		},
		{
			ID: "openai", Name: "OpenAI", Letter: "O", Subtitle: "GPT 系列",
			APIKey: openaiEnv, APIKeyMasked: maskKey(openaiEnv),
			BaseURL: "https://api.openai.com/v1", Verified: openaiEnv != "", AvailableModelCount: 3,
			Models: []string{"gpt-4.1", "gpt-4.1-mini", "o4-mini"}, Connected: openaiEnv != "",
		},
		{
			ID: "gemini", Name: "Google Gemini", Letter: "G", Subtitle: "长上下文 · 多模态",
			APIKey: geminiEnv, APIKeyMasked: maskKey(geminiEnv),
			BaseURL: "https://generativelanguage.googleapis.com/v1beta", Verified: geminiEnv != "", AvailableModelCount: 2,
			Models: []string{"gemini-2.5-pro", "gemini-2.5-flash"}, Connected: geminiEnv != "",
		},
		{
			ID: "openrouter", Name: "OpenRouter", Letter: "R", Subtitle: "一个 Key 访问多家",
			APIKey: openrouterEnv, APIKeyMasked: maskKey(openrouterEnv),
			BaseURL: "https://openrouter.ai/api/v1", Verified: openrouterEnv != "", AvailableModelCount: 4,
			Models: []string{"anthropic/claude-sonnet-4.5", "openai/gpt-4.1", "google/gemini-2.5-pro", "deepseek/deepseek-r1"}, Connected: openrouterEnv != "",
		},
		{
			ID: "ollama", Name: "Ollama", Letter: "L", Subtitle: "本地模型 · 离线",
			BaseURL: "http://localhost:11434", Endpoint: "http://localhost:11434", AvailableModelCount: 3,
			Models: []string{"qwen3:32b", "llama3.3:70b", "deepseek-r1:14b"},
		},
		{
			ID: "custom", Name: "自定义", Letter: "+", Subtitle: "OpenAI 兼容接口",
			Models: []string{"custom-reasoning", "custom-fast"},
		},
	}
}

func maskKey(k string) string {
	if len(k) < 10 {
		if k == "" {
			return ""
		}
		return "••••"
	}
	return k[:6] + "••••" + k[len(k)-4:]
}

func seedChatThreads(primaryModel, nick string) []types.ChatThread {
	nowHHMM := time.Now().Format("15:04")
	return []types.ChatThread{
		{
			ID: "chat-default", Title: "新对话", Model: primaryModel,
			TimelineActionCount: 0, LinkedEventIDs: []string{}, UpdatedAt: "刚刚",
			Messages: []types.ChatMessage{
				{
					ID: "welcome-default", Role: "assistant",
					MetaLabel: fmt.Sprintf("%s · 就绪", primaryModel), CreatedAt: nowHHMM,
					Content: fmt.Sprintf("%s好，我是驻留在你 Mac 上的事件管家。我可以监听本机与外部事件、按策略自动响应异常，或用自然语言为你编排专属插件与 Skill。", nick),
				},
			},
		},
	}
}

func seedScanState() types.ScanState {
	return types.ScanState{
		Status:        "idle",
		ProgressPct:   0,
		ElapsedSec:    0,
		ReclaimableGB: 0,
		Tasks: []types.ScanTaskItem{
			{ID: "disk", Title: "磁盘", Detail: "由「磁盘守卫」插件提供 · 点击开始实时扫描", SizeLabel: "—", SizeGB: 0, Status: "pending"},
			{ID: "orphan", Title: "卸载残留", Detail: "由「卸载清道夫」插件提供 · 检查 ~/Library 残留", SizeLabel: "—", SizeGB: 0, Status: "pending"},
			{ID: "process", Title: "进程", Detail: "由「进程哨兵」插件提供 · 采样当前进程负载", SizeLabel: "—", SizeGB: 0, Status: "pending"},
			{ID: "log", Title: "系统日志", Detail: "由「日志侦探」插件提供 · 汇总近期崩溃报告", SizeLabel: "—", SizeGB: 0, Status: "pending"},
		},
	}
}
