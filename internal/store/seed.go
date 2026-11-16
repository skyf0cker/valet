package store

import (
	"valet/internal/sys"
	"valet/internal/types"
)

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

// NewSeedSnapshot builds the initial Valet state populated with core & community plugins,
// providers, sample durable context history, and live host metrics.
func NewSeedSnapshot(homeDir string) types.ValetSnapshot {
	metrics := sys.SampleDiskMetrics(homeDir)
	activeLabel := "正在清理开发缓存 · 68%"
	activeEvtID := "evt-disk-clean-now"
	metrics.ActiveTaskLabel = &activeLabel
	metrics.ActiveTaskPct = 68
	metrics.ActiveTaskEventID = &activeEvtID

	return types.ValetSnapshot{
		OnboardingCompleted:        false,
		OnboardingStep:             1,
		ActiveView:                 string(types.ViewInbox),
		ActiveSettingsSection:      "thresholds",
		IsOnDuty:                   true,
		IsPaused:                   false,
		ActivePluginDetailID:       nil,
		ActiveChatID:               "chat-mac-slow",
		SelectedTimelineEventID:    nil,
		SelectedInboxItemID:        nil,
		TimelinePluginFilter:       "all",
		InboxProcessedHistoryCount: 9,
		EarlierCountLabel:          "昨天 · 22 个动作 ↓",
		Permissions:                seedPermissions(),
		Plugins:                    seedPlugins(),
		Providers:                  seedProviders(),
		InboxItems:                 seedInboxItems(),
		TimelineEvents:             seedTimelineEvents(),
		ChatThreads:                seedChatThreads(),
		Automations:                seedAutomations(),
		McpServers:                 seedMcpServers(),
		Memories:                   seedMemories(),
		Preferences:                seedPreferences(),
		SystemMetrics:              metrics,
		Scan:                       seedScanState(metrics),
	}
}

func seedPreferences() types.ValetPreferences {
	return types.ValetPreferences{
		LaunchAtLogin:      true,
		ShowMenuBarIcon:    true,
		Appearance:         "light",
		Language:           "简体中文",
		GlobalHotkey:       []string{"⌥", "Space"},
		ActiveProviderID:   "anthropic",
		Models:             types.ModelSelection{Primary: "claude-opus-4", Fast: "claude-haiku-4", Vision: "同主模型"},
		DailySpendCurrent:  18.4,
		DailySpendLimit:    30,
		MaxStepsPerTask:    50,
		UserNickname:       "dd",
		ToneStyle:          "concise",
		CustomInstructions: "- 回复用中文，先给结论再给细节\n- 文件一律存到 ~/Documents/Valet\n- 工作日 9:00 前不要发通知",
		AutonomyLevel:      "sensitive_only",
		ConfirmChecklist: types.SafetyConfirmationChecklist{
			DeleteOrOverwrite:     true,
			SendMessageOrEmail:    true,
			PaymentOrSubscription: true,
			RunTerminalCommand:    true,
			ModifySystemSettings:  false,
		},
		BlockedApps:           []string{"钥匙串访问", "招商银行", "1Password"},
		EmergencyStopShortcut: []string{"⌥", "⎋"},
		Thresholds:            DefaultThresholds(),
		CleanupPolicy:         DefaultCleanupPolicy(),
		PluginRuntime:         DefaultPluginRuntime(),
		MemoryEnabled:         true,
		AutoLearnMemory:       true,
		HoldToSpeakKey:        "fn",
		WakeWordEnabled:       false,
		SpeechLanguage:        "中文 + English",
		SpeakReplies:          "仅语音提问时",
		NotifyOnConfirm:       true,
		NotifyOnComplete:      true,
		NotifyOnFailure:       true,
		FollowFocusMode:       true,
		RecordActionReplay:    true,
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
			SettingsSubtext:     "允许以下应用访问邮件、信息、Safari 及所有用户文件。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "点击下方按钮，Valet 会直接带你到「隐私与安全性 › 完全磁盘访问权限」。"},
				{Index: "02", Title: "打开 Valet 的开关", Detail: "在列表中找到 Valet，打开右侧开关，并输入解锁密码或使用触控 ID。"},
				{Index: "03", Title: "回到这里", Detail: "若系统提示「退出并重新打开」，选择稍后，Valet 会自动检测并继续。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "paper", Name: "Paper", Enabled: true},
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: false},
			},
		},
		{
			ID:                  "accessibility",
			Name:                "辅助功能",
			Tier:                "recommended",
			Description:         "替你操作需要点击的 App 界面，如系统设置、网页表单",
			SettingsSectionName: "辅助功能",
			SettingsSubtext:     "允许以下应用控制你的电脑，以便协助操作界面。",
			Granted:             true,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "点击下方按钮，前往「隐私与安全性 › 辅助功能」。"},
				{Index: "02", Title: "启用 Valet", Detail: "在列表勾选或打开 Valet 的辅助功能开关。"},
				{Index: "03", Title: "自动同步", Detail: "授权完成后这里会自动刷新状态。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: true},
				{ID: "terminal", Name: "Terminal", Enabled: true},
			},
		},
		{
			ID:                  "screen_recording",
			Name:                "屏幕录制",
			Tier:                "recommended",
			Description:         "看懂屏幕内容，用于界面操作与截图诊断",
			SettingsSectionName: "屏幕录制与系统录音",
			SettingsSubtext:     "允许以下应用录制屏幕内容以进行视觉诊断。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "前往「隐私与安全性 › 屏幕录制」。"},
				{Index: "02", Title: "打开 Valet 的开关", Detail: "允许 Valet 截取当前屏幕画面供多模态分析。"},
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
			Description:         "通过 AppleScript 控制 Finder、日历、邮件等应用，比模拟点击更稳定",
			SettingsSectionName: "自动化",
			SettingsSubtext:     "允许 Valet 向 Finder、日历和系统事件发送控制指令。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "前往「隐私与安全性 › 自动化」。"},
				{Index: "02", Title: "展开 Valet 条目", Detail: "勾选允许控制的系统应用（如 Finder、Calendar）。"},
				{Index: "03", Title: "回到这里", Detail: "每 2 秒自动检测授权结果。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: false},
			},
		},
		{
			ID:                  "notifications",
			Name:                "通知",
			Tier:                "recommended",
			Description:         "任务完成、需要确认敏感操作时及时提醒你",
			SettingsSectionName: "通知",
			SettingsSubtext:     "允许 Valet 在需要你确认或任务完成时发送桌面横幅。",
			Granted:             true,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "前往「通知 › Valet」。"},
				{Index: "02", Title: "开启允许通知", Detail: "建议选择「横幅」样式以便及时确认操作。"},
				{Index: "03", Title: "完成", Detail: "状态已就绪。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: true},
			},
		},
		{
			ID:                  "microphone",
			Name:                "麦克风",
			Tier:                "optional",
			Description:         "用于语音输入与「嘿 Valet」唤醒词",
			SettingsSectionName: "麦克风",
			SettingsSubtext:     "允许以下应用访问麦克风。语音识别默认在本地运行。",
			Granted:             false,
			Steps: []types.PermissionGuideStep{
				{Index: "01", Title: "打开系统设置", Detail: "前往「隐私与安全性 › 麦克风」。"},
				{Index: "02", Title: "开启 Valet 开关", Detail: "仅在按住 fn 或启用唤醒词时采集音频。"},
				{Index: "03", Title: "回到这里", Detail: "即可使用语音输入。"},
			},
			MockApps: []types.MockSystemSettingApp{
				{ID: "valet", Name: "Valet", IsValet: true, Enabled: false},
			},
		},
	}
}

func seedPlugins() []types.PluginState {
	return []types.PluginState{
		{
			ID: "disk-guard", Slug: "disk-guard", Name: "磁盘守卫",
			Tagline: "空间不足时自动清理缓存与垃圾",
			Description: "持续监测可用磁盘空间，智能识别安全可清理的开发缓存与大文件，清理前默认移入废纸篓。",
			Version: "v1.2.0", BundleID: "com.valet.disk-guard", IconKind: "disk", Source: "core",
			Enabled: true, Installed: true, RequiredPermission: "full_disk", RequiredPermissionLabel: "完全磁盘访问",
			DefaultBehaviorHint: "清缓存自动，删大文件先问", StatusSubtitle: "刚刚触发 disk.low_space · 正在处理",
			WeeklyImpactValue: "41.6", WeeklyImpactUnit: "GB", WeeklyImpactLabel: "本周为你释放",
			Triggers24h: []int{4, 6, 4, 8, 5, 4, 10, 6, 14, 20},
			Events: []types.PluginEventPolicy{
				{ID: "disk.low_space", Description: "可用空间低于阈值（15%）", Policy: "auto", Count24h: 1},
				{ID: "disk.cache_bloat", Description: "缓存目录 7 天内增长超过 5 GB", Policy: "auto", Count24h: 2},
				{ID: "disk.large_file", Description: "发现 > 2 GB 且 90 天未打开的文件", Policy: "ask", Count24h: 4},
				{ID: "disk.duplicate_found", Description: "下载与文稿中的重复文件", Policy: "record", Count24h: 0},
			},
			Actions: []types.PluginActionCapability{
				{ID: "disk.scan", Safety: "readonly", SafetyLabel: "只读"},
				{ID: "disk.move_to_trash", Safety: "reversible", SafetyLabel: "可撤销 · 7 天"},
				{ID: "disk.empty_trash", Safety: "confirm_always", SafetyLabel: "每次确认"},
				{ID: "disk.purge_snapshots", Safety: "confirm_always", SafetyLabel: "每次确认"},
			},
			Config:       types.PluginConfig{LowSpaceThresholdPct: intPtr(15), ProtectedPaths: []string{"~/Documents", "~/Projects"}},
			ManifestYAML: "id: com.valet.disk-guard\nname: 磁盘守卫\nversion: 1.2.0\npermissions: [full_disk]\nevents:\n  - id: disk.low_space\n  - id: disk.cache_bloat\n  - id: disk.large_file\nactions:\n  - id: disk.scan\n  - id: disk.move_to_trash",
		},
		{
			ID: "uninstall-scrubber", Slug: "uninstall-scrubber", Name: "卸载清道夫",
			Tagline: "App 被删除后，找出并清理残留",
			Description: "监听 /Applications 目录变更，自动关联残留的缓存、偏好设置与后台 LaunchAgent。",
			Version: "v1.1.0", BundleID: "com.valet.uninstall-scrubber", IconKind: "trash", Source: "core",
			Enabled: true, Installed: true, RequiredPermission: "full_disk", RequiredPermissionLabel: "完全磁盘访问",
			DefaultBehaviorHint: "清理前先问你", StatusSubtitle: "1 项待你确认",
			WeeklyImpactValue: "12.4", WeeklyImpactUnit: "GB", WeeklyImpactLabel: "本周清理残留",
			Triggers24h: []int{2, 2, 8, 2, 2, 2, 2, 2, 2, 12},
			Events: []types.PluginEventPolicy{
				{ID: "app.uninstalled", Description: "检测到应用被移入废纸篓或删除", Policy: "ask", Count24h: 1},
				{ID: "app.orphan_found", Description: "扫描到已不存在应用的遗留支持文件", Policy: "ask", Count24h: 2},
			},
			Actions: []types.PluginActionCapability{
				{ID: "app.scan_remnants", Safety: "readonly", SafetyLabel: "只读"},
				{ID: "app.trash_remnants", Safety: "reversible", SafetyLabel: "可撤销 · 7 天"},
				{ID: "app.unload_agent", Safety: "confirm_always", SafetyLabel: "每次确认"},
			},
			Config:       types.PluginConfig{ProtectedPaths: []string{"~/Documents/Exports"}},
			ManifestYAML: "id: com.valet.uninstall-scrubber\nname: 卸载清道夫\nversion: 1.1.0\nevents:\n  - id: app.uninstalled\n  - id: app.orphan_found",
		},
		{
			ID: "process-sentinel", Slug: "process-sentinel", Name: "进程哨兵",
			Tagline: "盯住 CPU、内存与能耗异常的进程",
			Description: "每 5 秒采样一次高耗能进程，识别失控的编译脚本、死循环监听或内存泄漏。",
			Version: "v1.0.4", BundleID: "com.valet.process-sentinel", IconKind: "pulse", Source: "core",
			Enabled: true, Installed: true,
			DefaultBehaviorHint: "无需额外权限 · 默认：结束进程前先问", StatusSubtitle: "每 5 秒采样 · 今日拦截 2 次",
			WeeklyImpactValue: "9", WeeklyImpactUnit: "次", WeeklyImpactLabel: "本周拦截失控进程",
			Triggers24h: []int{6, 9, 7, 16, 8, 6, 7, 18, 6, 5},
			Events: []types.PluginEventPolicy{
				{ID: "process.cpu_spike", Description: "单进程占用 CPU > 180% 持续 3 分钟", Policy: "ask", Count24h: 2},
				{ID: "memory.pressure", Description: "系统内存压缩率进入黄色预警区", Policy: "record", Count24h: 3},
				{ID: "process.hang", Description: "前台应用无响应超过 45 秒", Policy: "ask", Count24h: 0},
			},
			Actions: []types.PluginActionCapability{
				{ID: "process.sample", Safety: "readonly", SafetyLabel: "只读"},
				{ID: "process.terminate", Safety: "confirm_always", SafetyLabel: "每次确认"},
			},
			Config:       types.PluginConfig{SampleIntervalSec: intPtr(5)},
			ManifestYAML: "id: com.valet.process-sentinel\nname: 进程哨兵\nversion: 1.0.4\nevents:\n  - id: process.cpu_spike\n  - id: memory.pressure",
		},
		{
			ID: "log-detective", Slug: "log-detective", Name: "日志侦探",
			Tagline: "从系统日志里发现崩溃与异常",
			Description: "关联 DiagnosticReports 与统一系统日志，把晦涩的堆栈翻译成你能看懂的诊断结论。",
			Version: "v1.0.2", BundleID: "com.valet.log-detective", IconKind: "log", Source: "core",
			Enabled: false, Installed: true, RequiredPermission: "full_disk", RequiredPermissionLabel: "完全磁盘访问",
			DefaultBehaviorHint: "仅记录并生成报告", StatusSubtitle: "生成报告 1 份",
			WeeklyImpactValue: "1", WeeklyImpactUnit: "份", WeeklyImpactLabel: "本周生成诊断报告",
			Triggers24h: []int{2, 2, 2, 2, 2, 10, 14, 2, 2, 2},
			Events: []types.PluginEventPolicy{
				{ID: "log.crash_loop", Description: "同进程 30 分钟内重复崩溃超过 3 次", Policy: "record", Count24h: 1},
				{ID: "log.kernel_panic", Description: "发现内核错误或 GPU 重置记录", Policy: "ask", Count24h: 0},
			},
			Actions:      []types.PluginActionCapability{{ID: "log.summarize", Safety: "readonly", SafetyLabel: "只读"}},
			Config:       types.PluginConfig{},
			ManifestYAML: "id: com.valet.log-detective\nname: 日志侦探\nversion: 1.0.2\npermissions: [full_disk]\nevents:\n  - id: log.crash_loop",
		},
		{
			ID: "github-watcher", Slug: "github-watcher", Name: "GitHub",
			Tagline: "监听仓库 CI 失败、PR Review 与安全告警",
			Description: "接入 GitHub Webhook / Polling，在构建失败时自动抓取日志并给出修复定位。",
			Version: "v0.9.3", BundleID: "com.community.github", IconKind: "gh", IconLabel: "gh", Source: "community",
			Enabled: true, Installed: true, AuthError: "Token 已过期 · 重新授权", StatusSubtitle: "Token 已过期 · 重新授权",
			Triggers24h: []int{8, 12, 6, 10, 4, 2, 2, 2, 2, 2},
			Events: []types.PluginEventPolicy{
				{ID: "github.ci_failed", Description: "默认分支工作流运行失败", Policy: "ask", Count24h: 1},
				{ID: "github.pr_review", Description: "收到新的代码评审请求", Policy: "record", Count24h: 4},
			},
			Actions: []types.PluginActionCapability{
				{ID: "github.fetch_logs", Safety: "readonly", SafetyLabel: "只读"},
				{ID: "github.rerun_job", Safety: "confirm_always", SafetyLabel: "每次确认"},
				{ID: "github.comment", Safety: "confirm_always", SafetyLabel: "每次确认"},
			},
			Config:       types.PluginConfig{},
			ManifestYAML: "id: com.community.github\nname: GitHub\nversion: 0.9.3\nevents:\n  - id: github.ci_failed\n  - id: github.pr_review",
		},
		{
			ID: "calendar-focus", Slug: "calendar-focus", Name: "日历",
			Tagline: "会前 10 分钟关闭干扰 App · 开启勿扰",
			Description: "读取 macOS 日历日程，在重要会议开始前自动收起社交软件并切换专注模式。",
			Version: "v1.0.0", BundleID: "com.community.calendar-focus", IconKind: "calendar", IconLabel: "15", Source: "community",
			Enabled: true, Installed: true, RequiredPermission: "automation", RequiredPermissionLabel: "自动化",
			StatusSubtitle: "会前 10 分钟关闭干扰 App · 开启勿扰",
			Triggers24h: []int{2, 8, 2, 8, 8, 2, 8, 2, 2, 8},
			Events: []types.PluginEventPolicy{
				{ID: "calendar.meeting_soon", Description: "日程开始前 10 分钟触发", Policy: "auto", Count24h: 3},
				{ID: "calendar.meeting_end", Description: "会议结束恢复工作区窗口", Policy: "auto", Count24h: 3},
			},
			Actions: []types.PluginActionCapability{
				{ID: "system.set_focus", Safety: "reversible", SafetyLabel: "自动恢复"},
				{ID: "app.hide_distractions", Safety: "reversible", SafetyLabel: "仅隐藏窗口"},
			},
			Config:       types.PluginConfig{},
			ManifestYAML: "id: com.community.calendar-focus\nname: 日历\nversion: 1.0.0\nevents:\n  - id: calendar.meeting_soon\n  - id: calendar.meeting_end",
		},
		{
			ID: "dmg-sweeper", Slug: "dmg-sweeper", Name: "dmg 清扫员",
			Tagline: "~/Valet/plugins/dmg-sweeper · 热重载中",
			Description: "监控下载文件夹中的 .dmg 安装包，在检测到对应 App 已拖入 /Applications 后自动移入废纸篓。",
			Version: "v0.1.0-dev", BundleID: "local.valet.dmg-sweeper", IconKind: "code", IconLabel: "{ }", Source: "local",
			Enabled: true, Installed: true, StatusSubtitle: "~/Valet/plugins/dmg-sweeper · 热重载中",
			Triggers24h: []int{2, 2, 2, 2, 2, 2, 2, 2, 2, 6},
			Events: []types.PluginEventPolicy{
				{ID: "fs.file_created", Description: "~/Downloads/*.dmg 创建且对应 App 已安装", Policy: "auto", Count24h: 1},
			},
			Actions:      []types.PluginActionCapability{{ID: "move_to_trash", Safety: "reversible", SafetyLabel: "可撤销 · 7 天"}},
			Config:       types.PluginConfig{},
			ManifestYAML: "id: local.valet.dmg-sweeper\nname: dmg 清扫员\nevents:\n  - id: fs.file_created\nactions:\n  - id: move_to_trash",
		},
		{
			ID: "battery-guardian", Slug: "battery-guardian", Name: "电池健康",
			Tagline: "过充预警、耗电大户排行与合盖耗电分析",
			Description: "追踪电池循环次数与夜间异常掉电，及时提醒高耗电后台进程。",
			Version: "v1.3.1", BundleID: "com.community.battery-guardian", IconKind: "battery", IconLabel: "92%", Source: "community",
			Enabled: false, Installed: false,
			Triggers24h:  []int{2, 4, 3, 5, 4, 2, 3, 4, 2, 3},
			Events:       []types.PluginEventPolicy{{ID: "battery.drain_spike", Description: "10 分钟掉电超过 6%", Policy: "ask"}},
			Actions:      []types.PluginActionCapability{{ID: "battery.report", Safety: "readonly", SafetyLabel: "只读"}},
			Config:       types.PluginConfig{},
			ManifestYAML: "id: com.community.battery-guardian\nname: 电池健康\nversion: 1.3.1\nevents:\n  - id: battery.drain_spike",
		},
		{
			ID: "homekit-bridge", Slug: "homekit-bridge", Name: "HomeKit",
			Tagline: "离开工位自动熄灯，进入专注自动调暗桌面台灯",
			Description: "结合 Mac 锁屏与工作状态事件联动家中智能开关与灯光场景。",
			Version: "v0.8.0", BundleID: "com.community.homekit", IconKind: "homekit", IconLabel: "HK", Source: "community",
			Enabled: false, Installed: false,
			Triggers24h:  []int{1, 2, 1, 2, 4, 2, 1, 2, 1, 2},
			Events:       []types.PluginEventPolicy{{ID: "mac.screen_locked", Description: "屏幕锁定超过 5 分钟", Policy: "auto"}},
			Actions:      []types.PluginActionCapability{{ID: "homekit.trigger_scene", Safety: "reversible", SafetyLabel: "可恢复"}},
			Config:       types.PluginConfig{},
			ManifestYAML: "id: com.community.homekit\nname: HomeKit\nversion: 0.8.0\nevents:\n  - id: mac.screen_locked",
		},
		{
			ID: "wifi-sentinel", Slug: "wifi-sentinel", Name: "Wi-Fi",
			Tagline: "切换公共 Wi-Fi 自动连 VPN，网络波动自动诊断 DNS",
			Description: "监听网络接口切换事件，保护公共热点安全并定位丢包节点。",
			Version: "v1.0.6", BundleID: "com.community.wifi-sentinel", IconKind: "wifi", IconLabel: "Wi", Source: "community",
			Enabled: false, Installed: false,
			Triggers24h:  []int{2, 2, 3, 2, 5, 2, 2, 3, 2, 2},
			Events:       []types.PluginEventPolicy{{ID: "net.ssid_changed", Description: "切换到非信任 Wi-Fi 网络", Policy: "ask"}},
			Actions:      []types.PluginActionCapability{{ID: "net.flush_dns", Safety: "reversible", SafetyLabel: "无损"}},
			Config:       types.PluginConfig{},
			ManifestYAML: "id: com.community.wifi-sentinel\nname: Wi-Fi\nversion: 1.0.6\nevents:\n  - id: net.ssid_changed",
		},
	}
}

func seedProviders() []types.AgentProviderConfig {
	return []types.AgentProviderConfig{
		{
			ID: "anthropic", Name: "Anthropic", Letter: "A", Subtitle: "Claude 系列 · 推荐",
			APIKey: "sk-ant-api03-mock-92a4c0e8d1b57f3a", APIKeyMasked: "sk-ant-••••••••••••••••7f3a",
			BaseURL: "https://api.anthropic.com", Verified: true, LatencyMs: 312, AvailableModelCount: 9,
			Models: []string{"claude-opus-4", "claude-sonnet-4", "claude-haiku-4"}, Connected: true,
		},
		{
			ID: "openai", Name: "OpenAI", Letter: "O", Subtitle: "GPT 系列",
			BaseURL: "https://api.openai.com/v1", AvailableModelCount: 11,
			Models: []string{"gpt-5", "gpt-5-mini", "o4-mini"},
		},
		{
			ID: "gemini", Name: "Google Gemini", Letter: "G", Subtitle: "长上下文 · 多模态",
			BaseURL: "https://generativelanguage.googleapis.com", AvailableModelCount: 6,
			Models: []string{"gemini-2.5-pro", "gemini-2.5-flash"},
		},
		{
			ID: "openrouter", Name: "OpenRouter", Letter: "R", Subtitle: "一个 Key 访问多家",
			BaseURL: "https://openrouter.ai/api/v1", AvailableModelCount: 42,
			Models: []string{"anthropic/claude-opus-4", "openai/gpt-5", "google/gemini-2.5-pro"},
		},
		{
			ID: "ollama", Name: "Ollama", Letter: "L", Subtitle: "本地模型 · 离线",
			BaseURL: "http://localhost:11434", Endpoint: "localhost:11434", AvailableModelCount: 3,
			Models: []string{"qwen3:32b", "llama3.3:70b", "deepseek-r1:14b"},
		},
		{
			ID: "custom", Name: "自定义", Letter: "+", Subtitle: "OpenAI 兼容接口",
			Models: []string{"custom-reasoning", "custom-fast"},
		},
	}
}

func seedInboxItems() []types.InboxApprovalItem {
	return []types.InboxApprovalItem{
		{
			ID: "inbox-docker-remnants", Timestamp: "2026-11-15T22:30:00", TimeLabel: "22:30", AgeLabel: "11m 前",
			Category: "files", IconKind: "trash",
			Title: "清理「Docker Desktop」卸载后的 12 项残留",
			Summary: "App 已移除 30 分钟；虚拟机镜像与特权助手无其他容器工具引用，镜像仓库凭据默认保留。",
			PluginID: "uninstall-scrubber", PluginName: "卸载清道夫", PluginBadge: "卸载清道夫",
			EventCode: "app.uninstalled", Reversible7d: true, ReclaimableGB: 11.4,
			ApproveLabel: "批准清理", DismissLabel: "忽略", Status: "pending",
			LinkedTimelineEventID: "evt-docker-uninstall",
			TriggerLatencyLabel:   "22:30 · 触发于卸载后 48s",
			Payload: map[string]any{
				"bundle_id": "com.docker.docker", "removed_at": "2026-11-15T22:19:12", "path": "/Applications/Docker.app", "referenced_by": "none",
			},
			Reasoning: "Docker Desktop 主程序已移入废纸篓超过 30 分钟。检测到 12 项关联磁盘镜像与特权辅助工具未再被 Colima 或 OrbStack 引用；镜像仓库登录配置 ~/.docker/config.json 已自动排除勾选项以保留你的凭据。",
			ToolName:  "app_trash_remnants",
			ActionItems: []types.TimelineActionItem{
				{ID: "dk-1", Label: "~/Library/Containers/com.docker.docker/Data/vms", Path: "~/Library/Containers/com.docker.docker/Data/vms", SizeMB: 11468, SizeLabel: "11.2 GB", Checked: true},
				{ID: "dk-2", Label: "/Library/PrivilegedHelperTools/com.docker.vmnetd", Path: "/Library/PrivilegedHelperTools/com.docker.vmnetd", SizeMB: 4, SizeLabel: "特权助手", Checked: true},
				{ID: "dk-3", Label: "~/.docker/config.json", Path: "~/.docker/config.json", SizeMB: 0, SizeLabel: "12 KB", Checked: false, KeepNote: "· 含仓库登录态，保留"},
				{ID: "dk-4", Label: "~/Library/Application Support/Docker Desktop", Path: "~/Library/Application Support/Docker Desktop", SizeMB: 148, SizeLabel: "148 MB", Checked: true, DefaultHidden: true},
			},
			TraceSteps: []types.TraceStep{
				{ID: "dkt1", Time: "22:19:12", Stage: "目录监听", Detail: "/Applications/Docker.app 被移入废纸篓", Status: "done"},
				{ID: "dkt2", Time: "22:29:45", Stage: "依赖排查", Detail: "确认 12 项虚拟机与助手文件无活跃容器引用", Status: "done"},
				{ID: "dkt3", Time: "22:30:00", Stage: "进入收件箱", Detail: "默认保留 ~/.docker/config.json，等待确认", Status: "active"},
			},
			Logs: []types.LogLine{
				{ID: "dkl1", TS: "22:19:12.401", Level: "INFO", Message: "FSEvent: Removed /Applications/Docker.app"},
				{ID: "dkl3", TS: "22:30:00.004", Level: "WARN", Message: "Policy=ask -> queued to Inbox for user confirmation"},
			},
		},
		{
			ID: "inbox-large-files", Timestamp: "2026-11-15T21:14:00", TimeLabel: "21:14",
			Category: "files", IconKind: "disk",
			Title: "移出 2 个超过 90 天未打开的巨型文件（3.4 GB）",
			Summary: "~/Downloads/macos-15.1-restore.ipsw（2.6 GB）与 Paper-demo-raw.mov（820 MB），移入废纸篓。",
			PluginID: "disk-guard", PluginName: "磁盘守卫", PluginBadge: "磁盘守卫",
			EventCode: "disk.large_file", Reversible7d: true, ReclaimableGB: 3.4,
			ApproveLabel: "移入废纸篓", DismissLabel: "保留", Status: "pending",
			TriggerLatencyLabel: "21:14 · 来自磁盘定时扫描",
			Payload:             map[string]any{"threshold_gb": 2, "idle_days": 90, "candidate_count": 2},
			Reasoning:           "两个文件均超过设定的 90 天未打开大文件阈值，位于 ~/Downloads 下，已避开 ~/Documents 与 ~/Projects 受保护路径。",
			ToolName:            "disk_move_to_trash",
			ActionItems: []types.TimelineActionItem{
				{ID: "lf-1", Label: "~/Downloads/macos-15.1-restore.ipsw", Path: "~/Downloads/macos-15.1-restore.ipsw", SizeMB: 2662, SizeLabel: "2.6 GB", Checked: true},
				{ID: "lf-2", Label: "~/Downloads/Paper-demo-raw.mov", Path: "~/Downloads/Paper-demo-raw.mov", SizeMB: 820, SizeLabel: "820 MB", Checked: true},
			},
			TraceSteps: []types.TraceStep{
				{ID: "lft1", Time: "21:13:52", Stage: "磁盘扫描", Detail: "遍历非受保护目录超过 2 GB 的闲置文件", Status: "done"},
				{ID: "lft2", Time: "21:14:00", Stage: "等待批准", Detail: "策略为「问我」，排队等待确认移入废纸篓", Status: "active"},
			},
			Logs: []types.LogLine{{ID: "lfl1", TS: "21:13:52.090", Level: "INFO", Message: "Found 2 idle large files (>90d) totaling 3.4 GB"}},
		},
		{
			ID: "inbox-rust-analyzer", Timestamp: "2026-11-15T20:42:00", TimeLabel: "20:42",
			Category: "process", IconKind: "pulse",
			Title: "终止卡死的 rust-analyzer 进程（PID 61904）",
			Summary: "连续 9 分钟占用 CPU 285% · 内存 4.1 GB，原终端会话已关闭；将发送 SIGTERM 释放资源。",
			PluginID: "process-sentinel", PluginName: "进程哨兵", PluginBadge: "进程哨兵",
			EventCode: "proc.high_cpu", WarningTag: "不可撤销", Reversible7d: false,
			ApproveLabel: "结束进程", DismissLabel: "忽略", Status: "pending",
			TriggerLatencyLabel: "20:42 · 持续高于 200% 超过 5 分钟",
			Payload:             map[string]any{"pid": 61904, "command": "rust-analyzer --stdio", "cpu_avg": "285%"},
			Reasoning:           "rust-analyzer 不在忽略进程名单内，父进程终端已退出，当前变为孤儿进程持续空转并消耗 4.1 GB 内存。发送 SIGTERM 属于不可撤销操作。",
			ToolName:            "process_terminate",
			ActionItems: []types.TimelineActionItem{
				{ID: "ra-1", Label: "发送 SIGTERM 至 PID 61904（rust-analyzer）", Path: "PID 61904 · TTY 已关闭", SizeMB: 0, SizeLabel: "释放 4.1 GB 内存", Checked: true},
			},
			TraceSteps: []types.TraceStep{
				{ID: "rat1", Time: "20:37:00", Stage: "异常检测", Detail: "PID 61904 CPU 持续 > 200%", Status: "done"},
				{ID: "rat2", Time: "20:42:00", Stage: "等待人工确认", Detail: "进程终止属于不可撤销操作", Status: "active"},
			},
			Logs: []types.LogLine{{ID: "ral1", TS: "20:42:00.120", Level: "WARN", Message: "Orphan pid=61904 rust-analyzer at 285% CPU, 4.1 GB RSS"}},
		},
		{
			ID: "inbox-calendar-reply", Timestamp: "2026-11-15T19:55:00", TimeLabel: "19:55",
			Category: "outbound", IconKind: "mail",
			Title: "向「设计周会」组织者发送顺延 10 分钟的日程回复",
			Summary: "检测到 20:00 日程冲突；草稿：「前序评审顺延，我约 20:10 接入」，未经批准不会外发。",
			PluginID: "calendar-focus", PluginName: "日历", PluginBadge: "日历",
			EventCode: "cal.conflict_reply", WarningTag: "外发消息", Reversible7d: false,
			ApproveLabel: "批准发送", DismissLabel: "不发送", Status: "pending",
			TriggerLatencyLabel: "19:55 · 外发消息安全拦截",
			Payload:             map[string]any{"meeting": "设计周会", "recipient": "lin.chen@company.example"},
			Reasoning:           "日历插件检测到当前进行的评审与 20:00「设计周会」重叠，已自动为你拟好礼貌顺延回复。根据「发送消息、邮件始终需确认」规则，必须经你批准后才允许发出。",
			ToolName:            "calendar_send_conflict_reply",
			ActionItems: []types.TimelineActionItem{
				{ID: "cal-1", Label: "发送邮件/日程备注至「设计周会」组织者", Path: "lin.chen@company.example", SizeMB: 0, SizeLabel: "外发 1 条", Checked: true},
			},
			TraceSteps: []types.TraceStep{
				{ID: "calt1", Time: "19:54:50", Stage: "冲突检测", Detail: "前序会议尚未结束且距离 20:00 仅剩 5 分钟", Status: "done"},
				{ID: "calt2", Time: "19:55:00", Stage: "外发拦截", Detail: "等待批准发送回复草稿", Status: "active"},
			},
			Logs: []types.LogLine{{ID: "call1", TS: "19:55:00.018", Level: "WARN", Message: "Outbound reply draft held by safety rule confirmChecklist.sendMessageOrEmail"}},
		},
	}
}

func seedTimelineEvents() []types.TimelineEvent {
	return []types.TimelineEvent{
		{
			ID: "evt-disk-clean-now", Timestamp: "2026-11-15T22:41:00", TimeLabel: "22:41", DayGroup: "today",
			Title: "可用空间低于 15%，正在清理开发缓存",
			Summary: "Xcode DerivedData、iOS 模拟器与 npm 缓存，全部移入废纸篓，7 天内可还原。",
			PluginID: "disk-guard", PluginName: "磁盘守卫", PluginBadge: "磁盘守卫", EventCode: "disk.low_space",
			Status: "running", TriggerLatencyLabel: "22:41 · 自动触发于可用空间低于 15%",
			Progress: &types.TimelineProgress{
				CurrentLabel: "12.6 / 18.4 GB", CurrentGB: 12.6, TotalGB: 18.4, Pct: 68, TargetPath: "~/Library/Developer/CoreSimulator",
			},
			Payload:   map[string]any{"free_ratio": "12.4%", "threshold": "15.0%", "policy": "auto"},
			Reasoning: "可用磁盘空间低于阈值 15%。检测到 Xcode DerivedData、过期 Simulator 镜像及 npm 缓存占用 18.4 GB，按「自动处理」策略安全移入废纸篓。",
			ActionItems: []types.TimelineActionItem{
				{ID: "act-xcode", Label: "Xcode DerivedData", Path: "~/Library/Developer/Xcode/DerivedData", SizeMB: 9400, SizeLabel: "9.4 GB", Checked: true},
				{ID: "act-sim", Label: "iOS 模拟器旧运行时", Path: "~/Library/Developer/CoreSimulator", SizeMB: 6800, SizeLabel: "6.8 GB", Checked: true},
				{ID: "act-npm", Label: "npm / pnpm 全局缓存", Path: "~/.npm/_cacache", SizeMB: 2200, SizeLabel: "2.2 GB", Checked: true},
			},
			TraceSteps: []types.TraceStep{
				{ID: "t1", Time: "22:40:58", Stage: "事件捕获", Detail: "disk.low_space (free < 15%)", Status: "done"},
				{ID: "t2", Time: "22:40:59", Stage: "安全过滤", Detail: "排除受保护目录 ~/Documents、~/Projects", Status: "done"},
				{ID: "t3", Time: "22:41:00", Stage: "执行移入废纸篓", Detail: "正在处理 CoreSimulator (12.6 / 18.4 GB)", Status: "active"},
			},
			Logs: []types.LogLine{{ID: "l1", TS: "22:40:58.112", Level: "INFO", Message: "Trigger disk.low_space received from com.valet.disk-guard"}},
		},
		{
			ID: "evt-docker-uninstall", Timestamp: "2026-11-15T22:30:00", TimeLabel: "22:30", DayGroup: "today",
			Title: "「Docker Desktop」已被卸载，发现 12 项残留",
			Summary: "共 11.4 GB：镜像、特权助手与容器缓存。",
			PluginID: "uninstall-scrubber", PluginName: "卸载清道夫", PluginBadge: "卸载清道夫", EventCode: "app.uninstalled",
			Status: "pending_confirm", ConfirmBannerText: "共 11.4 GB：镜像、特权助手与容器缓存（镜像仓库凭据默认保留）。",
			TriggerLatencyLabel: "22:30 · 触发于卸载后 48s",
			Payload:             map[string]any{"bundle_id": "com.docker.docker", "path": "/Applications/Docker.app"},
			Reasoning:           "App 已移除 30 分钟且未重新安装，虚拟机镜像与特权助手无其他容器工具引用。",
			ActionItems: []types.TimelineActionItem{
				{ID: "dk-1", Label: "~/Library/Containers/com.docker.docker/Data/vms", Path: "~/Library/Containers/com.docker.docker/Data/vms", SizeMB: 11468, SizeLabel: "11.2 GB", Checked: true},
				{ID: "dk-2", Label: "/Library/PrivilegedHelperTools/com.docker.vmnetd", Path: "/Library/PrivilegedHelperTools/com.docker.vmnetd", SizeMB: 4, SizeLabel: "特权助手", Checked: true},
				{ID: "dk-3", Label: "~/.docker/config.json", Path: "~/.docker/config.json", SizeMB: 0, SizeLabel: "12 KB", Checked: false, KeepNote: "· 含仓库登录态，保留"},
			},
			TraceSteps: []types.TraceStep{
				{ID: "dkt1", Time: "22:19:12", Stage: "目录监听", Detail: "/Applications/Docker.app 被移入废纸篓", Status: "done"},
				{ID: "dkt3", Time: "22:30:00", Stage: "等待用户确认", Detail: "策略为「问我」，挂起清理动作", Status: "active"},
			},
			Logs: []types.LogLine{{ID: "dkl1", TS: "22:30:00.004", Level: "WARN", Message: "Policy=ask -> waiting for user approval"}},
		},
		{
			ID: "evt-node-cpu-spike", Timestamp: "2026-11-15T21:58:00", TimeLabel: "21:58", DayGroup: "today",
			Title: "node 占用 CPU 240% 持续 6 分钟",
			Summary: "定位为 vite 监听死循环（PID 48211），经你同意后已结束。",
			PluginID: "process-sentinel", PluginName: "进程哨兵", PluginBadge: "进程哨兵", EventCode: "process.cpu_spike",
			Status: "completed", Intercepted: true, ReclaimedGB: 1.9,
			Payload:   map[string]any{"pid": 48211, "cpu_avg": "240.4%"},
			Reasoning: "来自已关闭的终端会话，经确认后通过 SIGTERM 优雅退出。",
			ActionItems: []types.TimelineActionItem{
				{ID: "np-1", Label: "向 PID 48211 发送 SIGTERM 优雅终止", Path: "PID 48211 · node · vite", SizeLabel: "已释放 1.9 GB 内存", Checked: true},
			},
			TraceSteps: []types.TraceStep{{ID: "nt3", Time: "21:58:02", Stage: "执行完成", Detail: "进程已退出", Status: "done"}},
			Logs:       []types.LogLine{{ID: "nl2", TS: "21:58:01.994", Level: "EXEC", Message: "Sent SIGTERM to pid=48211"}},
		},
		{
			ID: "evt-windowserver-crash", Timestamp: "2026-11-15T20:15:00", TimeLabel: "20:15", DayGroup: "today",
			Title: "WindowServer 30 分钟内崩溃 3 次",
			Summary: "关联到外接显示器的 DisplayLink 驱动 v11.2，已生成诊断报告。",
			PluginID: "log-detective", PluginName: "日志侦探", PluginBadge: "日志侦探", EventCode: "log.crash_loop",
			Status: "completed", Intercepted: true,
			Payload:     map[string]any{"process": "WindowServer", "crash_count_30m": 3},
			Reasoning:   "检测到外接显卡驱动崩溃循环并已生成诊断报告。",
			ActionItems: []types.TimelineActionItem{},
			TraceSteps:  []types.TraceStep{{ID: "wt1", Time: "20:15:00", Stage: "仅记录与归档", Detail: "策略为「仅记录」，已存档", Status: "done"}},
			Logs:        []types.LogLine{{ID: "wl1", TS: "20:15:00.120", Level: "INFO", Message: "Generated crash diagnosis report"}},
		},
		{
			ID: "evt-github-auth-failed", Timestamp: "2026-11-15T18:02:00", TimeLabel: "18:02", DayGroup: "today",
			Title: "valet/main 的 CI 失败",
			Summary: "插件 Token 已过期，Valet 无法读取构建日志。",
			PluginID: "github-watcher", PluginName: "GitHub", PluginBadge: "GitHub · 第三方", EventCode: "github.ci_failed",
			Status: "failed", AuthFixPluginID: "github-watcher",
			Payload:     map[string]any{"repo": "valet/main", "error": "401 Unauthorized"},
			Reasoning:   "GitHub OAuth Token 已失效。",
			ActionItems: []types.TimelineActionItem{},
			TraceSteps:  []types.TraceStep{{ID: "gt1", Time: "18:02:00", Stage: "鉴权失败", Detail: "401 Bad credentials", Status: "error"}},
			Logs:        []types.LogLine{{ID: "gl1", TS: "18:02:00.512", Level: "ERR", Message: "401 Unauthorized"}},
		},
	}
}

func seedChatThreads() []types.ChatThread {
	return []types.ChatThread{
		{
			ID: "chat-mac-slow", Title: "Mac 为什么变卡了", Model: "claude-opus-4",
			TimelineActionCount: 2, LinkedEventIDs: []string{"evt-node-cpu-spike", "evt-disk-clean-now"},
			UpdatedAt: "22:40",
			Messages: []types.ChatMessage{
				{ID: "m1", Role: "user", Content: "最近风扇一直转，切窗口都卡，帮我看看怎么回事？", CreatedAt: "22:38"},
				{
					ID: "m2", Role: "assistant", MetaLabel: "采样 30s · 进程哨兵", CreatedAt: "22:39",
					Content: "主要是 `node` 在拖后腿：一个忘记关闭的 vite 开发服务在反复重新编译，吃掉了 2.4 个核。另外磁盘剩余空间偏低，系统在频繁交换内存。",
					ProcessTable: &types.ProcessTablePayload{
						Rows: []types.ProcessSampleRow{
							{ID: "p-node", Name: "node · vite", CPUPct: 240, MemLabel: "1.9 GB", SourceLabel: "终端", Severity: "high"},
							{ID: "p-chrome", Name: "Google Chrome Helper", CPUPct: 38, MemLabel: "3.2 GB", SourceLabel: "31 个标签页", Severity: "normal"},
							{ID: "p-mds", Name: "mds_stores", CPUPct: 22, MemLabel: "410 MB", SourceLabel: "聚焦索引", Severity: "normal"},
						},
					},
				},
				{ID: "m3", Role: "user", Content: "顺便帮我做个插件：下载文件夹里装完的 .dmg 自动删掉。", CreatedAt: "22:40"},
				{
					ID: "m4", Role: "assistant", MetaLabel: "", CreatedAt: "22:40",
					Content: "已经按你的需求起草了一份本地插件规则，它只会在对应应用已安装到 `/Applications` 后把 `.dmg` 移入废纸篓：",
					PluginDraft: &types.PluginDraftSpec{
						ID: "dmg-sweeper", Name: "dmg 清扫员",
						WhenExpression: "when fs.file_created(~/Downloads/*.dmg)", ActionExpression: "and app_installed_from(dmg) → move_to_trash",
						Installed: true,
						ManifestYAML: "id: local.valet.dmg-sweeper\nname: dmg 清扫员\nversion: 0.1.0\ntriggers:\n  - event: fs.file_created\n    glob: \"~/Downloads/*.dmg\"\nactions:\n  - move_to_trash:\n      retention_days: 7",
					},
				},
			},
		},
		{
			ID: "chat-dmg-plugin", Title: "做一个 .dmg 自动清理插件", Model: "claude-opus-4",
			TimelineActionCount: 1, LinkedEventIDs: []string{}, UpdatedAt: "昨天",
			Messages: []types.ChatMessage{
				{ID: "m2-1", Role: "user", Content: "每次装完软件都会忘删下载目录里的 dmg 镜像，能自动判断装好后就清掉吗？", CreatedAt: "昨天 19:20"},
				{ID: "m2-2", Role: "assistant", MetaLabel: "插件生成器", Content: "可以，我可以通过监听 `fs.file_created` 并在 10 分钟后检查 `/Applications` 是否出现同名 `.app` 来安全移入废纸篓。", CreatedAt: "昨天 19:21"},
			},
		},
		{
			ID: "chat-docker-remnants", Title: "Docker 残留清单", Model: "claude-opus-4",
			TimelineActionCount: 1, LinkedEventIDs: []string{"evt-docker-uninstall"}, UpdatedAt: "22:30",
			Messages: []types.ChatMessage{
				{ID: "m3-1", Role: "user", Content: "Docker Desktop 卸掉后会不会把我的镜像仓库登录凭据也删了？", CreatedAt: "22:31"},
				{ID: "m3-2", Role: "assistant", MetaLabel: "卸载清道夫", Content: "不会。`~/.docker/config.json` 已被自动标记为「含仓库登录态，保留」且默认取消勾选。", CreatedAt: "22:31"},
			},
		},
	}
}

func seedAutomations() []types.AutomationRule {
	return []types.AutomationRule{
		{ID: "auto-downloads", ScheduleTop: "每晚", ScheduleBottom: "23:00", Title: "整理「下载」文件夹", Enabled: true, TriggerType: "cron"},
		{ID: "auto-weekly", ScheduleTop: "周五", ScheduleBottom: "17:30", Title: "汇总周报并发给我", Enabled: true, TriggerType: "cron"},
		{ID: "auto-screenshots", ScheduleTop: "当…", ScheduleBottom: "时", Title: "桌面出现新截图", Subtitle: "重命名并移入「截图」", Enabled: false, TriggerType: "event"},
	}
}

func seedMcpServers() []types.McpServerItem {
	return []types.McpServerItem{
		{ID: "mcp-fs", Abbr: "fs", Name: "Filesystem", TransportLabel: "stdio · 12 tools", ToolCount: 12, Enabled: true},
		{ID: "mcp-gh", Abbr: "gh", Name: "GitHub", TransportLabel: "http · 26 tools", ToolCount: 26, Enabled: true},
		{ID: "mcp-nt", Abbr: "nt", Name: "Notion", TransportLabel: "http · 14 tools", ToolCount: 14, Enabled: false, AuthExpired: true},
	}
}

func seedMemories() []types.MemoryEntry {
	return []types.MemoryEntry{
		{ID: "mem-1", Content: "回复始终使用简体中文，先给结论再展开细节。", Source: "自定义指令", CreatedAt: "2026-11-10"},
		{ID: "mem-2", Content: "工作产物与导出文件优先保存在 ~/Documents/Valet，禁止清理 ~/Projects。", Source: "对话学习", CreatedAt: "2026-11-12"},
		{ID: "mem-3", Content: "工作日早上 9:00 前避免发出非关键提醒通知。", Source: "对话学习", CreatedAt: "2026-11-14"},
	}
}

func seedScanState(metrics types.SystemMetrics) types.ScanState {
	return types.ScanState{
		Status:        "done",
		ProgressPct:   100,
		ElapsedSec:    1,
		ReclaimableGB: 0,
		Tasks: []types.ScanTaskItem{
			{ID: "disk", Title: "磁盘", Detail: "就绪 · 可用空间实时采集中", SizeLabel: "—", SizeGB: 0, Status: "done"},
			{ID: "orphan", Title: "卸载残留", Detail: "等待首次扫描", SizeLabel: "—", SizeGB: 0, Status: "done"},
			{ID: "process", Title: "进程", Detail: "当前 CPU / 内存实时监测中", SizeLabel: "—", SizeGB: 0, Status: "done"},
			{ID: "log", Title: "系统日志", Detail: "DiagnosticReports 已接入", SizeLabel: "—", SizeGB: 0, Status: "skipped"},
		},
	}
}
