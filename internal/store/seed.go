package store

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"valet/internal/sys"
	"valet/internal/types"
)

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

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
		Language:           "简体中文",
		GlobalHotkey:       []string{"⌥", "Space"},
		ActiveProviderID:   "anthropic",
		Models:             types.ModelSelection{Primary: "claude-opus-4", Fast: "claude-haiku-4", Vision: "同主模型"},
		DailySpendCurrent:  0,
		DailySpendLimit:    30,
		MaxStepsPerTask:    50,
		UserNickname:       nick,
		ToneStyle:          "concise",
		CustomInstructions: "",
		AutonomyLevel:      "sensitive_only",
		ConfirmChecklist: types.SafetyConfirmationChecklist{
			DeleteOrOverwrite:     true,
			SendMessageOrEmail:    true,
			PaymentOrSubscription: true,
			RunTerminalCommand:    true,
			ModifySystemSettings:  false,
		},
		BlockedApps:           []string{"钥匙串访问", "1Password"},
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

func zeroBars() []int {
	return []int{0, 0, 0, 0, 0, 0, 0, 0, 0, 0}
}

func seedPlugins() []types.PluginState {
	return []types.PluginState{
		{
			ID: "disk-guard", Slug: "disk-guard", Name: "磁盘守卫",
			Tagline: "可用空间检测、开发缓存清理与大文件回收",
			Description: "通过 metric_threshold 传感器持续监测磁盘占用，并提供可撤销的缓存清理与安全回收工具。",
			Version: "v1.2.0", BundleID: "com.valet.disk-guard", IconKind: "disk", Source: "core",
			Enabled: true, Installed: true, RequiredPermission: "full_disk", RequiredPermissionLabel: "完全磁盘访问",
			DefaultBehaviorHint: "扫描只读，删除自动进废纸篓或先问你", StatusSubtitle: "在岗监听中 · 每 30s 检查磁盘阈值",
			Triggers24h: zeroBars(),
			Events: []types.PluginEventPolicy{
				{ID: "disk.low_space", Description: "可用空间低于设定阈值", Policy: "auto", Count24h: 0},
				{ID: "disk.cache_bloat", Description: "开发缓存增长异常", Policy: "auto", Count24h: 0},
				{ID: "disk.large_file", Description: "长期未访问的大文件建议回收", Policy: "ask", Count24h: 0},
			},
			Actions: []types.PluginActionCapability{
				{ID: "disk.scan", Safety: "readonly", SafetyLabel: "只读"},
				{ID: "disk.move_to_trash", Safety: "reversible", SafetyLabel: "可撤销 · 7 天"},
				{ID: "disk.empty_trash", Safety: "confirm_always", SafetyLabel: "每次确认"},
			},
			Config: types.PluginConfig{LowSpaceThresholdPct: intPtr(15), ProtectedPaths: []string{"~/Documents", "~/Projects"}},
			ManifestYAML: `id: com.valet.disk-guard
name: 磁盘守卫
version: 1.2.0
permissions: [full_disk]
triggers:
  - id: disk.low_space
    description: 可用空间低于阈值
    sensor: metric_threshold
    metric: disk.used_pct
    operator: gt
    threshold: 85
    interval_sec: 30
    policy: auto
  - id: disk.large_file
    description: 发现长期闲置大文件
    sensor: manual
    policy: ask
actions:
  - id: disk.scan
    tool: disk_scan
    driver: fs.scan_cleanable
    safety: readonly
    category: files
    description: Read-only scan for safe developer caches and idle large files above size/age thresholds, skipping protected directories.
  - id: disk.move_to_trash
    tool: disk_move_to_trash
    driver: fs.trash
    event: disk.large_file
    safety: reversible
    category: files
    checklist: deleteOrOverwrite
    description: Move specific cache directories or idle large files into Trash (7-day reversible). Subject to Valet Inbox approval when required.
  - id: disk.empty_trash
    tool: disk_empty_trash
    driver: fs.empty_trash
    safety: confirm_always
    category: files
    checklist: deleteOrOverwrite
    description: Audit and confirm permanently emptying Finder Trash.`,
		},
		{
			ID: "uninstall-scrubber", Slug: "uninstall-scrubber", Name: "卸载清道夫",
			Tagline: "监听 /Applications 卸载变更并排查残留缓存",
			Description: "使用 fs_watch 传感器实时关注 /Applications 与 ~/Applications 移除的应用，自动排查 ~/Library 孤儿目录。",
			Version: "v1.1.0", BundleID: "com.valet.uninstall-scrubber", IconKind: "trash", Source: "core",
			Enabled: true, Installed: true, RequiredPermission: "full_disk", RequiredPermissionLabel: "完全磁盘访问",
			DefaultBehaviorHint: "发现残留后先提交收件箱确认", StatusSubtitle: "在岗监听 /Applications 目录变更",
			Triggers24h: zeroBars(),
			Events: []types.PluginEventPolicy{
				{ID: "app.uninstalled", Description: "检测到应用从 /Applications 移除", Policy: "ask", Count24h: 0},
				{ID: "app.orphan_found", Description: "扫描到已移除应用的残留目录", Policy: "ask", Count24h: 0},
			},
			Actions: []types.PluginActionCapability{
				{ID: "app.scan_remnants", Safety: "readonly", SafetyLabel: "只读"},
				{ID: "app.trash_remnants", Safety: "reversible", SafetyLabel: "可撤销 · 7 天"},
				{ID: "app.unload_agent", Safety: "confirm_always", SafetyLabel: "每次确认"},
			},
			Config: types.PluginConfig{ProtectedPaths: []string{"~/Documents/Exports"}},
			ManifestYAML: `id: com.valet.uninstall-scrubber
name: 卸载清道夫
version: 1.1.0
permissions: [full_disk]
triggers:
  - id: app.uninstalled
    description: 检测到应用从应用程序目录移除
    sensor: fs_watch
    watch_dirs: [/Applications, ~/Applications]
    ops: [remove]
    glob: "*.app"
    policy: ask
  - id: app.orphan_found
    description: 扫描到疑似遗留支持目录
    sensor: manual
    policy: ask
actions:
  - id: app.scan_remnants
    tool: app_scan_remnants
    driver: fs.scan_orphans
    safety: readonly
    category: files
    description: Scan ~/Library/Caches for orphaned directories left by uninstalled apps.
  - id: app.trash_remnants
    tool: app_trash_remnants
    driver: fs.trash
    safety: reversible
    category: files
    checklist: deleteOrOverwrite
    description: Move scanned orphaned app remnants to Trash cleanly.
  - id: app.unload_agent
    tool: app_unload_agent
    driver: launchd.unload
    safety: confirm_always
    category: process
    checklist: runTerminalCommand
    description: Unload an orphaned LaunchAgent plist after confirmation.`,
		},
		{
			ID: "process-sentinel", Slug: "process-sentinel", Name: "进程哨兵",
			Tagline: "盯住 CPU 与内存异常占用的后台进程",
			Description: "定期采样系统活跃进程，发现持续超高 CPU 占用或卡死进程时先征求你的意见。",
			Version: "v1.0.4", BundleID: "com.valet.process-sentinel", IconKind: "pulse", Source: "core",
			Enabled: true, Installed: true,
			DefaultBehaviorHint: "无需额外权限 · 结束进程前始终询问", StatusSubtitle: "在岗采样中 · 监控异常 CPU 占用",
			Triggers24h: zeroBars(),
			Events: []types.PluginEventPolicy{
				{ID: "process.cpu_spike", Description: "非忽略进程 CPU 持续超过阈值", Policy: "ask", Count24h: 0},
				{ID: "memory.pressure", Description: "系统内存占用进入预警区", Policy: "record", Count24h: 0},
			},
			Actions: []types.PluginActionCapability{
				{ID: "process.sample", Safety: "readonly", SafetyLabel: "只读"},
				{ID: "process.terminate", Safety: "confirm_always", SafetyLabel: "每次确认"},
			},
			Config: types.PluginConfig{SampleIntervalSec: intPtr(15)},
			ManifestYAML: `id: com.valet.process-sentinel
name: 进程哨兵
version: 1.0.4
triggers:
  - id: process.cpu_spike
    description: 非忽略进程持续高 CPU 占用
    sensor: metric_threshold
    metric: proc.max_cpu
    operator: gt
    threshold: 200
    interval_sec: 15
    sustained_sec: 30
    policy: ask
actions:
  - id: process.sample
    tool: process_sample
    driver: proc.sample
    safety: readonly
    category: process
    ui_card: process_table
    description: Sample top CPU and memory-consuming macOS processes right now.
  - id: process.terminate
    tool: process_terminate
    driver: proc.signal
    safety: confirm_always
    category: process
    checklist: runTerminalCommand
    description: Send SIGTERM or SIGKILL to an abnormal process PID after user approval.`,
		},
		{
			ID: "log-detective", Slug: "log-detective", Name: "日志侦探",
			Tagline: "盯住 DiagnosticReports 新增崩溃日志并归因",
			Description: "监听系统 DiagnosticReports 新出现的崩溃报告，分析高频故障进程原因。",
			Version: "v1.0.2", BundleID: "com.valet.log-detective", IconKind: "log", Source: "core",
			Enabled: false, Installed: true, RequiredPermission: "full_disk", RequiredPermissionLabel: "完全磁盘访问",
			DefaultBehaviorHint: "默认仅记录并生成报告", StatusSubtitle: "已安装 · 暂未启用",
			Triggers24h: zeroBars(),
			Events: []types.PluginEventPolicy{
				{ID: "log.crash_loop", Description: "检测到新的应用或系统崩溃报告", Policy: "record", Count24h: 0},
			},
			Actions: []types.PluginActionCapability{{ID: "log.summarize", Safety: "readonly", SafetyLabel: "只读"}},
			Config:  types.PluginConfig{},
			ManifestYAML: `id: com.valet.log-detective
name: 日志侦探
version: 1.0.2
permissions: [full_disk]
triggers:
  - id: log.crash_loop
    description: 检测到新的 DiagnosticReports 崩溃日志
    sensor: metric_threshold
    metric: logs.crash_count
    interval_sec: 30
    policy: record
actions:
  - id: log.summarize
    tool: log_summarize_crashes
    driver: log.summarize_crashes
    safety: readonly
    category: process
    description: Inspect ~/Library/Logs/DiagnosticReports for recent crash logs and summarize culprits.`,
		},
		{
			ID: "battery-guardian", Slug: "battery-guardian", Name: "电池健康",
			Tagline: "实时读取电池电量、电源适配器与状态报告",
			Description: "通过 macOS pmset 实时检查电源模式、电量百分比与充放电状态。",
			Version: "v1.3.1", BundleID: "com.community.battery-guardian", IconKind: "battery", IconLabel: "⚡", Source: "community",
			Enabled: false, Installed: false, StatusSubtitle: "可安装 · 社区扩展",
			Triggers24h: zeroBars(),
			Events:      []types.PluginEventPolicy{{ID: "battery.drain_spike", Description: "检查电池当前电源状态", Policy: "ask", Count24h: 0}},
			Actions:     []types.PluginActionCapability{{ID: "battery.report", Safety: "readonly", SafetyLabel: "只读"}},
			Config:      types.PluginConfig{},
			ManifestYAML: `id: com.community.battery-guardian
name: 电池健康
version: 1.3.1
triggers:
  - id: battery.drain_spike
    description: 电池耗电状态检查
    sensor: manual
    policy: ask
actions:
  - id: battery.report
    tool: battery_status
    driver: macos.battery_status
    safety: readonly
    category: process
    description: Read live macOS battery level, charging state, and power source via pmset.`,
		},
		{
			ID: "wifi-sentinel", Slug: "wifi-sentinel", Name: "Wi-Fi",
			Tagline: "检查当前无线接口与网络状态",
			Description: "采集当前机场/Wi-Fi SSID 与网络连接状态，协助排查断流与 DNS 异常。",
			Version: "v1.0.6", BundleID: "com.community.wifi-sentinel", IconKind: "wifi", IconLabel: "Wi", Source: "community",
			Enabled: false, Installed: false, StatusSubtitle: "可安装 · 社区扩展",
			Triggers24h: zeroBars(),
			Events:      []types.PluginEventPolicy{{ID: "net.ssid_changed", Description: "检查当前无线网络接入状态", Policy: "ask", Count24h: 0}},
			Actions:     []types.PluginActionCapability{{ID: "net.flush_dns", Safety: "readonly", SafetyLabel: "只读"}},
			Config:      types.PluginConfig{},
			ManifestYAML: `id: com.community.wifi-sentinel
name: Wi-Fi
version: 1.0.6
triggers:
  - id: net.ssid_changed
    description: 检查网络接口连接情况
    sensor: manual
    policy: ask
actions:
  - id: net.flush_dns
    tool: wifi_status
    driver: macos.network_status
    safety: readonly
    category: process
    description: Read active macOS Wi-Fi network interface and SSID status.`,
		},
		{
			ID: "github-watcher", Slug: "github-watcher", Name: "GitHub",
			Tagline: "通过 HTTP 接口检查仓库 CI 状态或触发后续操作",
			Description: "调用 net.http_json 驱动读取公开或已配置 URL 的构建状态，外发操作需经收件箱确认。",
			Version: "v0.9.3", BundleID: "com.community.github", IconKind: "gh", IconLabel: "gh", Source: "community",
			Enabled: false, Installed: false, StatusSubtitle: "可安装 · 社区扩展",
			Triggers24h: zeroBars(),
			Events: []types.PluginEventPolicy{
				{ID: "github.ci_failed", Description: "仓库工作流失败告警", Policy: "ask", Count24h: 0},
			},
			Actions: []types.PluginActionCapability{
				{ID: "github.fetch_logs", Safety: "readonly", SafetyLabel: "只读"},
				{ID: "github.comment", Safety: "confirm_always", SafetyLabel: "每次确认"},
			},
			Config: types.PluginConfig{},
			ManifestYAML: `id: com.community.github
name: GitHub
version: 0.9.3
triggers:
  - id: github.ci_failed
    description: 检查 GitHub 仓库工作流状态
    sensor: manual
    policy: ask
actions:
  - id: github.fetch_logs
    tool: github_fetch_failed_runs
    driver: net.http_json
    safety: readonly
    category: outbound
    description: Fetch JSON status from a GitHub API URL via net.http_json.
  - id: github.comment
    tool: github_post_comment
    driver: plugin.noop
    safety: confirm_always
    category: outbound
    checklist: sendMessageOrEmail
    description: Prepare an outbound GitHub PR/Issue comment (requires Inbox confirmation).`,
		},
		{
			ID: "calendar-focus", Slug: "calendar-focus", Name: "日历与专注",
			Tagline: "会前自动进入勿扰状态，外发日程回复前先确认",
			Description: "结合系统专注模式开关与安全外发拦截，防止误发送会议变更消息。",
			Version: "v1.0.0", BundleID: "com.community.calendar-focus", IconKind: "calendar", IconLabel: "Cal", Source: "community",
			Enabled: false, Installed: false, RequiredPermission: "automation", RequiredPermissionLabel: "自动化",
			StatusSubtitle: "可安装 · 社区扩展",
			Triggers24h: zeroBars(),
			Events: []types.PluginEventPolicy{
				{ID: "calendar.meeting_soon", Description: "日程临近专注提醒", Policy: "auto", Count24h: 0},
			},
			Actions: []types.PluginActionCapability{
				{ID: "calendar.list", Safety: "readonly", SafetyLabel: "只读"},
				{ID: "system.set_focus", Safety: "reversible", SafetyLabel: "可恢复"},
			},
			Config: types.PluginConfig{},
			ManifestYAML: `id: com.community.calendar-focus
name: 日历与专注
version: 1.0.0
permissions: [automation]
triggers:
  - id: calendar.meeting_soon
    description: 会前专注模式切换
    sensor: manual
    policy: auto
actions:
  - id: calendar.list
    tool: calendar_list_upcoming
    driver: macos.calendar_upcoming
    safety: readonly
    category: outbound
    description: Scan upcoming calendar schedule window.
  - id: system.set_focus
    tool: calendar_set_focus_mode
    driver: macos.focus_mode
    safety: reversible
    category: outbound
    description: Toggle macOS Focus mode state.`,
		},
	}
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
			BaseURL: "https://api.anthropic.com", Verified: anthropicEnv != "", AvailableModelCount: 9,
			Models: []string{"claude-opus-4", "claude-sonnet-4", "claude-haiku-4"}, Connected: anthropicEnv != "",
		},
		{
			ID: "openai", Name: "OpenAI", Letter: "O", Subtitle: "GPT 系列",
			APIKey: openaiEnv, APIKeyMasked: maskKey(openaiEnv),
			BaseURL: "https://api.openai.com/v1", Verified: openaiEnv != "", AvailableModelCount: 11,
			Models: []string{"gpt-5", "gpt-5-mini", "o4-mini"}, Connected: openaiEnv != "",
		},
		{
			ID: "gemini", Name: "Google Gemini", Letter: "G", Subtitle: "长上下文 · 多模态",
			APIKey: geminiEnv, APIKeyMasked: maskKey(geminiEnv),
			BaseURL: "https://generativelanguage.googleapis.com", Verified: geminiEnv != "", AvailableModelCount: 6,
			Models: []string{"gemini-2.5-pro", "gemini-2.5-flash"}, Connected: geminiEnv != "",
		},
		{
			ID: "openrouter", Name: "OpenRouter", Letter: "R", Subtitle: "一个 Key 访问多家",
			APIKey: openrouterEnv, APIKeyMasked: maskKey(openrouterEnv),
			BaseURL: "https://openrouter.ai/api/v1", Verified: openrouterEnv != "", AvailableModelCount: 42,
			Models: []string{"anthropic/claude-opus-4", "openai/gpt-5", "google/gemini-2.5-pro"}, Connected: openrouterEnv != "",
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
					Content: fmt.Sprintf("%s好，我可以帮你排查 Mac 卡顿、扫描并安全清理磁盘缓存、查看系统崩溃日志，或者通过自然语言帮你生成一个常驻触发的本地插件。", nick),
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
