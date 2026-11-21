package configctl

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"valet/internal/types"
)

// KeySpec documents one addressable ValetPreferences setting key.
type KeySpec struct {
	Key         string   `json:"key"`
	Section     string   `json:"section"`
	Type        string   `json:"type"` // "bool" | "int" | "float" | "string" | "enum" | "string[]"
	Enum        []string `json:"enum,omitempty"`
	Sensitive   bool     `json:"sensitive,omitempty"`
	Description string   `json:"description"`
}

// ChangeRecord reports a single validated preference update.
type ChangeRecord struct {
	Key      string `json:"key"`
	OldValue any    `json:"oldValue"`
	NewValue any    `json:"newValue"`
}

type keyHandler struct {
	spec KeySpec
	get  func(p *types.ValetPreferences) any
	set  func(p *types.ValetPreferences, raw string) error
}

var registry = []keyHandler{
	// General
	boolHandler("launchAtLogin", "general", false, "开机自动启动 Valet", func(p *types.ValetPreferences) *bool { return &p.LaunchAtLogin }),
	boolHandler("showMenuBarIcon", "general", false, "在系统菜单栏常驻托盘图标", func(p *types.ValetPreferences) *bool { return &p.ShowMenuBarIcon }),
	enumHandler("appearance", "general", false, []string{"light", "dark", "auto"}, "外观模式（浅色 / 深色 / 跟随系统）", func(p *types.ValetPreferences) *string { return &p.Appearance }),
	enumHandler("darkTheme", "general", false, []string{"cursor", "vercel", "vesper", "onedark", "tokyo-night", "catppuccin"}, "深色主题配色（cursor=Cursor Dark / vercel=Vercel / vesper=Vesper / onedark=One Dark Pro / tokyo-night=Tokyo Night / catppuccin=Catppuccin Mocha）", func(p *types.ValetPreferences) *string { return &p.DarkTheme }),
	strHandler("language", "general", false, false, "界面与对话首选语言", func(p *types.ValetPreferences) *string { return &p.Language }),
	sliceHandler("globalHotkey", "general", false, "全局呼出快捷键按键列表", func(p *types.ValetPreferences) *[]string { return &p.GlobalHotkey }),
	enumHandler("busyMessagePolicy", "general", false, []string{"queue", "steer"}, "对话生成期间收到新消息的策略（排队 / 立即插话）", func(p *types.ValetPreferences) *string { return &p.BusyMessagePolicy }),

	// Models & Budget
	enumHandler("activeProviderId", "models", false, []string{"anthropic", "openai", "gemini", "openrouter", "ollama", "custom"}, "当前激活的默认模型服务商", func(p *types.ValetPreferences) *string { return &p.ActiveProviderID }),
	strHandler("models.primary", "models", false, false, "主对话与复杂分析模型 ID", func(p *types.ValetPreferences) *string { return &p.Models.Primary }),
	strHandler("models.fast", "models", false, false, "心跳巡检与后台快速响应模型 ID", func(p *types.ValetPreferences) *string { return &p.Models.Fast }),
	strHandler("models.vision", "models", false, false, "视觉/截屏分析模型 ID（或 同主模型）", func(p *types.ValetPreferences) *string { return &p.Models.Vision }),
	enumHandler("autoReview.engine", "models", true, []string{"auto", "jev", "llm"}, "Auto Review 审查引擎策略（auto=优先决策模型回退小模型 / jev / llm）", func(p *types.ValetPreferences) *string { return &p.AutoReview.Engine }),
	strHandler("autoReview.jevEndpoint", "models", true, false, "决策 API 端点 URL（如 https://api.typesafe.ai/v1/systemone 或 Google Decisions https://generativelanguage.googleapis.com/v1beta/decisions）", func(p *types.ValetPreferences) *string { return &p.AutoReview.JevEndpoint }),
	strHandler("autoReview.jevModel", "models", true, false, "决策模型 ID（如 gemini-decision-1、jev-latest 或 typesafe/jev-1.14）", func(p *types.ValetPreferences) *string { return &p.AutoReview.JevModel }),
	strHandler("autoReview.fallbackProviderId", "models", true, true, "Auto Review 回退审查模型服务商 ID（留空则跟随当前激活服务商）", func(p *types.ValetPreferences) *string { return &p.AutoReview.FallbackProviderID }),
	strHandler("autoReview.fallbackModel", "models", true, false, "Auto Review 未配置决策模型时的回退小模型 ID（或 同快速模型）", func(p *types.ValetPreferences) *string { return &p.AutoReview.FallbackModel }),
	{
		spec: KeySpec{Key: "dailySpendLimit", Section: "models", Type: "float", Description: "每日 API 预算上限（美元，> 0）"},
		get:  func(p *types.ValetPreferences) any { return p.DailySpendLimit },
		set: func(p *types.ValetPreferences, raw string) error {
			v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
			if err != nil || v <= 0 {
				return fmt.Errorf("dailySpendLimit 必须是大于 0 的数字，收到 %q", raw)
			}
			p.DailySpendLimit = v
			return nil
		},
	},
	intRangeHandler("maxStepsPerTask", "models", false, 1, 200, "单次任务最大工具调用步数 (1..200)", func(p *types.ValetPreferences) *int { return &p.MaxStepsPerTask }),

	// Persona
	strHandler("userNickname", "persona", false, false, "Valet 对用户的称呼", func(p *types.ValetPreferences) *string { return &p.UserNickname }),
	enumHandler("toneStyle", "persona", false, []string{"formal", "concise", "friendly"}, "回复语气风格", func(p *types.ValetPreferences) *string { return &p.ToneStyle }),
	strHandler("customInstructions", "persona", false, true, "常驻系统指令（Custom Instructions）", func(p *types.ValetPreferences) *string { return &p.CustomInstructions }),

	// Safety (sensitive)
	{
		spec: KeySpec{Key: "autonomyLevel", Section: "safety", Type: "enum", Enum: []string{"always_ask", "auto_review", "full_access"}, Sensitive: true, Description: "Agent 自主安全级别（always_ask / auto_review / full_access）"},
		get:  func(p *types.ValetPreferences) any { return p.AutonomyLevel },
		set: func(p *types.ValetPreferences, raw string) error {
			v := strings.TrimSpace(raw)
			switch v {
			case "always_ask", "auto_review", "full_access":
				p.AutonomyLevel = v
				return nil
			case "sensitive_only":
				p.AutonomyLevel = "auto_review"
				return nil
			case "autonomous":
				p.AutonomyLevel = "full_access"
				return nil
			default:
				return fmt.Errorf("autonomyLevel 仅支持 [always_ask, auto_review, full_access]，收到 %q", raw)
			}
		},
	},
	boolHandler("confirmChecklist.deleteOrOverwrite", "safety", true, "删除或覆盖文件前需人工确认", func(p *types.ValetPreferences) *bool { return &p.ConfirmChecklist.DeleteOrOverwrite }),
	boolHandler("confirmChecklist.sendMessageOrEmail", "safety", true, "外发消息或评论前需人工确认", func(p *types.ValetPreferences) *bool { return &p.ConfirmChecklist.SendMessageOrEmail }),
	boolHandler("confirmChecklist.paymentOrSubscription", "safety", true, "涉及支付或订阅变更前需人工确认", func(p *types.ValetPreferences) *bool { return &p.ConfirmChecklist.PaymentOrSubscription }),
	boolHandler("confirmChecklist.runTerminalCommand", "safety", true, "执行变更型终端命令前需人工确认", func(p *types.ValetPreferences) *bool { return &p.ConfirmChecklist.RunTerminalCommand }),
	boolHandler("confirmChecklist.modifySystemSettings", "safety", true, "修改系统或自配置前需人工确认", func(p *types.ValetPreferences) *bool { return &p.ConfirmChecklist.ModifySystemSettings }),
	sliceHandler("blockedApps", "safety", true, "严禁触碰或终止的受保护应用列表", func(p *types.ValetPreferences) *[]string { return &p.BlockedApps }),
	sliceHandler("emergencyStopShortcut", "safety", true, "紧急暂停守护全局快捷键", func(p *types.ValetPreferences) *[]string { return &p.EmergencyStopShortcut }),

	// Heartbeat
	boolHandler("heartbeat.enabled", "heartbeat", false, "启用周期主动值守心跳", func(p *types.ValetPreferences) *bool { return &p.Heartbeat.Enabled }),
	intRangeHandler("heartbeat.intervalMin", "heartbeat", false, 1, 1440, "心跳巡检周期（分钟，1..1440）", func(p *types.ValetPreferences) *int { return &p.Heartbeat.IntervalMin }),
	strHandler("heartbeat.prompt", "heartbeat", false, false, "心跳巡检指令 Prompt", func(p *types.ValetPreferences) *string { return &p.Heartbeat.Prompt }),

	// Thresholds
	intRangeHandler("thresholds.diskLowSpacePct", "thresholds", false, 1, 90, "磁盘可用空间低于百分比触发告警 (1..90)", func(p *types.ValetPreferences) *int { return &p.Thresholds.DiskLowSpacePct }),
	strHandler("thresholds.cacheBloatGB", "thresholds", false, false, "7 天缓存增长告警阈值（如 5 GB）", func(p *types.ValetPreferences) *string { return &p.Thresholds.CacheBloatGB }),
	strHandler("thresholds.largeFileSizeGB", "thresholds", false, false, "大文件判定阈值（如 2 GB）", func(p *types.ValetPreferences) *string { return &p.Thresholds.LargeFileSizeGB }),
	strHandler("thresholds.largeFileIdleDays", "thresholds", false, false, "大文件未访问天数阈值（如 90 天）", func(p *types.ValetPreferences) *string { return &p.Thresholds.LargeFileIdleDays }),
	strHandler("thresholds.cpuSpikePct", "thresholds", false, false, "进程 CPU 异常阈值（如 200%）", func(p *types.ValetPreferences) *string { return &p.Thresholds.CPUSpikePct }),
	strHandler("thresholds.cpuSpikeDuration", "thresholds", false, false, "进程 CPU 异常持续时长（如 5 分钟）", func(p *types.ValetPreferences) *string { return &p.Thresholds.CPUSpikeDuration }),
	enumHandler("thresholds.memoryPressureLevel", "thresholds", false, []string{"yellow", "red"}, "内存压力提醒级别", func(p *types.ValetPreferences) *string { return &p.Thresholds.MemoryPressureLevel }),
	sliceHandler("thresholds.ignoredProcesses", "thresholds", false, "高占用忽略进程白名单", func(p *types.ValetPreferences) *[]string { return &p.Thresholds.IgnoredProcesses }),
	enumHandler("thresholds.logSensitivity", "thresholds", false, []string{"low", "medium", "high"}, "日志异常灵敏度", func(p *types.ValetPreferences) *string { return &p.Thresholds.LogSensitivity }),
	boolHandler("thresholds.eventThrottle10m", "thresholds", false, "同一事件 10 分钟内只响应一次", func(p *types.ValetPreferences) *bool { return &p.Thresholds.EventThrottle10m }),

	// Cleanup Policy
	enumHandler("cleanupPolicy.deleteMethod", "cleanupPolicy", true, []string{"移入废纸篓", "安全移出到隔离区"}, "文件删除方式", func(p *types.ValetPreferences) *string { return &p.CleanupPolicy.DeleteMethod }),
	strHandler("cleanupPolicy.restoreRetentionDays", "cleanupPolicy", true, false, "可一键还原保留天数", func(p *types.ValetPreferences) *string { return &p.CleanupPolicy.RestoreRetentionDays }),
	sliceHandler("cleanupPolicy.protectedDirs", "cleanupPolicy", true, "严禁清理或改动的受保护目录列表", func(p *types.ValetPreferences) *[]string { return &p.CleanupPolicy.ProtectedDirs }),
	boolHandler("cleanupPolicy.autoScanAfterUninstall", "cleanupPolicy", false, "卸载应用后自动扫描残留目录", func(p *types.ValetPreferences) *bool { return &p.CleanupPolicy.AutoScanAfterUninstall }),

	// Plugin Runtime
	boolHandler("pluginRuntime.sandboxIsolation", "pluginRuntime", true, "开启插件沙箱路径与权限隔离", func(p *types.ValetPreferences) *bool { return &p.PluginRuntime.SandboxIsolation }),
	boolHandler("pluginRuntime.allowUnsignedLocal", "pluginRuntime", true, "允许加载未签名本地开发插件", func(p *types.ValetPreferences) *bool { return &p.PluginRuntime.AllowUnsignedLocal }),
	strHandler("pluginRuntime.maxEventsPerHour", "pluginRuntime", false, false, "单插件每小时最大事件数", func(p *types.ValetPreferences) *string { return &p.PluginRuntime.MaxEventsPerHour }),
	strHandler("pluginRuntime.quietHours", "pluginRuntime", false, false, "安静时段（如 23:30 – 08:00 或 关闭）", func(p *types.ValetPreferences) *string { return &p.PluginRuntime.QuietHours }),

	// Memory
	boolHandler("memoryEnabled", "memory", false, "启用本地长期记忆", func(p *types.ValetPreferences) *bool { return &p.MemoryEnabled }),
	boolHandler("autoLearnMemory", "memory", false, "对话中自动识别并保存偏好记忆", func(p *types.ValetPreferences) *bool { return &p.AutoLearnMemory }),

	// Voice
	strHandler("holdToSpeakKey", "voice", false, false, "按住说话触发键", func(p *types.ValetPreferences) *string { return &p.HoldToSpeakKey }),
	boolHandler("wakeWordEnabled", "voice", false, "启用本地离线唤醒词", func(p *types.ValetPreferences) *bool { return &p.WakeWordEnabled }),
	strHandler("speechLanguage", "voice", false, false, "语音识别语言", func(p *types.ValetPreferences) *string { return &p.SpeechLanguage }),
	strHandler("speakReplies", "voice", false, false, "回复语音朗读时机", func(p *types.ValetPreferences) *string { return &p.SpeakReplies }),

	// Notifications
	boolHandler("notifyOnConfirm", "notifications", false, "有待确认事项时发送桌面通知", func(p *types.ValetPreferences) *bool { return &p.NotifyOnConfirm }),
	boolHandler("notifyOnComplete", "notifications", false, "后台任务自动完成时发送通知", func(p *types.ValetPreferences) *bool { return &p.NotifyOnComplete }),
	boolHandler("notifyOnFailure", "notifications", false, "任务或传感器异常失败时发送通知", func(p *types.ValetPreferences) *bool { return &p.NotifyOnFailure }),
	boolHandler("followFocusMode", "notifications", false, "跟随 macOS 专注模式静默非紧急通知", func(p *types.ValetPreferences) *bool { return &p.FollowFocusMode }),

	// Privacy
	boolHandler("recordActionReplay", "privacy", false, "记录时间线操作回放详情", func(p *types.ValetPreferences) *bool { return &p.RecordActionReplay }),
	boolHandler("blurSensitiveInfo", "privacy", false, "导出或回放时模糊凭据与敏感路径", func(p *types.ValetPreferences) *bool { return &p.BlurSensitiveInfo }),
	strHandler("timelineRetentionDays", "privacy", false, false, "时间线事件本地保留天数", func(p *types.ValetPreferences) *string { return &p.TimelineRetentionDays }),
}

var byKey = func() map[string]keyHandler {
	m := make(map[string]keyHandler, len(registry))
	for _, h := range registry {
		m[h.spec.Key] = h
	}
	return m
}()

// Schema returns metadata for all configurable preference dot-paths.
func Schema() []KeySpec {
	out := make([]KeySpec, len(registry))
	for i, h := range registry {
		out[i] = h.spec
	}
	return out
}

// Get reads the full preferences object, a named section, or a single dot-path key.
func Get(prefs types.ValetPreferences, keyOrSection string) (any, error) {
	q := strings.TrimSpace(keyOrSection)
	if q == "" {
		return prefs, nil
	}
	if h, ok := byKey[q]; ok {
		return h.get(&prefs), nil
	}

	switch strings.ToLower(q) {
	case "general":
		return sectionMap(&prefs, "general"), nil
	case "models":
		return sectionMap(&prefs, "models"), nil
	case "persona":
		return sectionMap(&prefs, "persona"), nil
	case "safety":
		return sectionMap(&prefs, "safety"), nil
	case "heartbeat":
		return prefs.Heartbeat, nil
	case "thresholds":
		return prefs.Thresholds, nil
	case "cleanup", "cleanuppolicy":
		return prefs.CleanupPolicy, nil
	case "runtime", "pluginruntime":
		return prefs.PluginRuntime, nil
	case "memory":
		return sectionMap(&prefs, "memory"), nil
	case "voice":
		return sectionMap(&prefs, "voice"), nil
	case "notifications":
		return sectionMap(&prefs, "notifications"), nil
	case "privacy":
		return sectionMap(&prefs, "privacy"), nil
	default:
		return nil, fmt.Errorf("未知的配置项或分区: %q（可运行 valet config schema 查看支持列表）", q)
	}
}

func sectionMap(p *types.ValetPreferences, sec string) map[string]any {
	out := make(map[string]any)
	for _, h := range registry {
		if h.spec.Section == sec {
			out[h.spec.Key] = h.get(p)
		}
	}
	return out
}

// ApplyUpdates validates and applies key=rawValue preference patches to `st`.
func ApplyUpdates(st *types.ValetSnapshot, updates map[string]string) ([]ChangeRecord, error) {
	if len(updates) == 0 {
		return nil, fmt.Errorf("未提供任何配置更新项")
	}

	// Copy preferences so validation failures remain atomic.
	nextPrefs := st.Preferences
	keys := make([]string, 0, len(updates))
	for k := range updates {
		if _, ok := byKey[k]; !ok {
			return nil, fmt.Errorf("不支持的配置项: %q（可运行 valet config schema 查看支持列表）", k)
		}
		keys = append(keys, k)
	}
	// Apply autonomyLevel before confirmChecklist.* so explicit checklist overrides in the same batch take precedence.
	sort.Slice(keys, func(i, j int) bool {
		ki, kj := keys[i], keys[j]
		if ki == "autonomyLevel" && kj != "autonomyLevel" {
			return true
		}
		if kj == "autonomyLevel" && ki != "autonomyLevel" {
			return false
		}
		return ki < kj
	})

	changes := make([]ChangeRecord, 0, len(keys))
	for _, k := range keys {
		h := byKey[k]
		oldVal := h.get(&nextPrefs)
		if err := h.set(&nextPrefs, updates[k]); err != nil {
			return nil, err
		}
		if k == "autonomyLevel" {
			syncChecklistForAutonomy(&nextPrefs)
		}
		if strings.HasPrefix(k, "heartbeat.") {
			nextPrefs.Heartbeat.Initialized = true
		}
		newVal := h.get(&nextPrefs)
		changes = append(changes, ChangeRecord{
			Key:      k,
			OldValue: oldVal,
			NewValue: newVal,
		})
	}

	st.Preferences = nextPrefs
	for i := range st.Plugins {
		if st.Plugins[i].ID == "disk-guard" {
			val := nextPrefs.Thresholds.DiskLowSpacePct
			st.Plugins[i].Config.LowSpaceThresholdPct = &val
			st.Plugins[i].Config.ProtectedPaths = append([]string(nil), nextPrefs.CleanupPolicy.ProtectedDirs...)
		}
	}
	return changes, nil
}

func syncChecklistForAutonomy(p *types.ValetPreferences) {
	switch p.AutonomyLevel {
	case "always_ask":
		p.ConfirmChecklist = types.SafetyConfirmationChecklist{
			DeleteOrOverwrite: true, SendMessageOrEmail: true, PaymentOrSubscription: true,
			RunTerminalCommand: true, ModifySystemSettings: true,
		}
	case "auto_review", "sensitive_only":
		p.ConfirmChecklist = types.SafetyConfirmationChecklist{
			DeleteOrOverwrite: false, SendMessageOrEmail: true, PaymentOrSubscription: true,
			RunTerminalCommand: false, ModifySystemSettings: false,
		}
	case "full_access", "autonomous":
		p.ConfirmChecklist = types.SafetyConfirmationChecklist{
			DeleteOrOverwrite: false, SendMessageOrEmail: true, PaymentOrSubscription: true,
			RunTerminalCommand: false, ModifySystemSettings: false,
		}
	}
}

func boolHandler(key, section string, sensitive bool, desc string, ptr func(*types.ValetPreferences) *bool) keyHandler {
	return keyHandler{
		spec: KeySpec{Key: key, Section: section, Type: "bool", Sensitive: sensitive, Description: desc},
		get:  func(p *types.ValetPreferences) any { return *ptr(p) },
		set: func(p *types.ValetPreferences, raw string) error {
			b, err := parseBoolStrict(raw)
			if err != nil {
				return fmt.Errorf("%s 必须是 true/false，收到 %q", key, raw)
			}
			*ptr(p) = b
			return nil
		},
	}
}

func intRangeHandler(key, section string, sensitive bool, minVal, maxVal int, desc string, ptr func(*types.ValetPreferences) *int) keyHandler {
	return keyHandler{
		spec: KeySpec{Key: key, Section: section, Type: "int", Sensitive: sensitive, Description: desc},
		get:  func(p *types.ValetPreferences) any { return *ptr(p) },
		set: func(p *types.ValetPreferences, raw string) error {
			n, err := strconv.Atoi(strings.TrimSpace(raw))
			if err != nil || n < minVal || n > maxVal {
				return fmt.Errorf("%s 必须是 %d..%d 之间的整数，收到 %q", key, minVal, maxVal, raw)
			}
			*ptr(p) = n
			return nil
		},
	}
}

func strHandler(key, section string, sensitive, allowEmpty bool, desc string, ptr func(*types.ValetPreferences) *string) keyHandler {
	return keyHandler{
		spec: KeySpec{Key: key, Section: section, Type: "string", Sensitive: sensitive, Description: desc},
		get:  func(p *types.ValetPreferences) any { return *ptr(p) },
		set: func(p *types.ValetPreferences, raw string) error {
			v := strings.TrimSpace(raw)
			if !allowEmpty && v == "" {
				return fmt.Errorf("%s 不能为空", key)
			}
			*ptr(p) = v
			return nil
		},
	}
}

func enumHandler(key, section string, sensitive bool, allowed []string, desc string, ptr func(*types.ValetPreferences) *string) keyHandler {
	return keyHandler{
		spec: KeySpec{Key: key, Section: section, Type: "enum", Enum: allowed, Sensitive: sensitive, Description: desc},
		get:  func(p *types.ValetPreferences) any { return *ptr(p) },
		set: func(p *types.ValetPreferences, raw string) error {
			v := strings.TrimSpace(raw)
			for _, a := range allowed {
				if v == a {
					*ptr(p) = v
					return nil
				}
			}
			return fmt.Errorf("%s 仅支持 [%s]，收到 %q", key, strings.Join(allowed, ", "), raw)
		},
	}
}

func sliceHandler(key, section string, sensitive bool, desc string, ptr func(*types.ValetPreferences) *[]string) keyHandler {
	return keyHandler{
		spec: KeySpec{Key: key, Section: section, Type: "string[]", Sensitive: sensitive, Description: desc},
		get:  func(p *types.ValetPreferences) any { return append([]string(nil), (*ptr(p))...) },
		set: func(p *types.ValetPreferences, raw string) error {
			next, err := parseStringSliceUpdate(*ptr(p), raw)
			if err != nil {
				return fmt.Errorf("%s 解析失败: %w", key, err)
			}
			*ptr(p) = next
			return nil
		},
	}
}

func parseBoolStrict(raw string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "true", "1", "yes", "on":
		return true, nil
	case "false", "0", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("invalid bool %q", raw)
	}
}

func parseStringSliceUpdate(current []string, raw string) ([]string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return []string{}, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		var list []string
		if err := json.Unmarshal([]byte(trimmed), &list); err != nil {
			return nil, err
		}
		out := make([]string, 0, len(list))
		for _, item := range list {
			if s := strings.TrimSpace(item); s != "" {
				out = append(out, s)
			}
		}
		return out, nil
	}

	parts := strings.Split(trimmed, ",")
	allDelta := true
	for _, part := range parts {
		p := strings.TrimSpace(part)
		if p == "" || (!strings.HasPrefix(p, "+") && !strings.HasPrefix(p, "-")) {
			allDelta = false
			break
		}
	}
	if allDelta {
		out := append([]string(nil), current...)
		for _, part := range parts {
			p := strings.TrimSpace(part)
			if strings.HasPrefix(p, "+") {
				val := strings.TrimSpace(p[1:])
				if val != "" && !containsStr(out, val) {
					out = append(out, val)
				}
			} else if strings.HasPrefix(p, "-") {
				val := strings.TrimSpace(p[1:])
				filtered := out[:0]
				for _, item := range out {
					if item != val {
						filtered = append(filtered, item)
					}
				}
				out = filtered
			}
		}
		return out, nil
	}

	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if s := strings.TrimSpace(part); s != "" {
			out = append(out, s)
		}
	}
	return out, nil
}

func containsStr(list []string, target string) bool {
	for _, item := range list {
		if item == target {
			return true
		}
	}
	return false
}
