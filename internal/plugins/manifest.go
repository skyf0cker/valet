package plugins

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"valet/internal/types"
)

// TriggerSpec describes a normalized declarative sensor trigger in a plugin manifest.
type TriggerSpec struct {
	ID                string   `json:"id"`
	Description       string   `json:"description,omitempty"`
	Policy            string   `json:"policy,omitempty"` // "auto" | "ask" | "record"
	Sensor            string   `json:"sensor"`           // "fs_watch" | "script_poll" | "command_poll" | "http_poll" | "webhook" | "cron" | "manual"
	WatchDirs         []string `json:"watchDirs,omitempty"`
	Ops               []string `json:"ops,omitempty"` // "create" | "write" | "remove" | "rename"
	Glob              string   `json:"glob,omitempty"`
	Script            string   `json:"script,omitempty"`
	IntervalConfigKey string   `json:"intervalConfigKey,omitempty"`
	Metric            string   `json:"metric,omitempty"`
	Operator          string   `json:"operator,omitempty"`
	Threshold         float64  `json:"threshold,omitempty"`
	IntervalSec       int      `json:"intervalSec,omitempty"`
	SustainedSec      int      `json:"sustainedSec,omitempty"`
	Schedule          string   `json:"schedule,omitempty"`
	URL               string   `json:"url,omitempty"`
	Method            string   `json:"method,omitempty"`
	Command           string   `json:"command,omitempty"`
	EmitOn            string   `json:"emitOn,omitempty"` // "json" | "change" | "non_empty" | "exit_zero" | "always"
	MatchContains     string   `json:"matchContains,omitempty"`
}

// ActionSpec describes a normalized declarative tool/action in a plugin manifest.
type ActionSpec struct {
	ID           string `json:"id"`
	ToolName     string `json:"toolName"`
	Driver       string `json:"driver"`
	EventCode    string `json:"eventCode,omitempty"`
	Safety       string `json:"safety"`   // "readonly" | "reversible" | "confirm_always"
	Category     string `json:"category"` // "files" | "process" | "outbound"
	ChecklistKey string `json:"checklistKey,omitempty"`
	UICard       string `json:"uiCard,omitempty"`
	Target       string `json:"target,omitempty"`
	Command      string `json:"command,omitempty"`
	URL          string `json:"url,omitempty"`
	Description  string `json:"description,omitempty"`
}

// ParsedManifest captures normalized plugin metadata, config schema, triggers/sensors, and skill rules.
type ParsedManifest struct {
	ID                      string                    `json:"id"`
	Slug                    string                    `json:"slug,omitempty"`
	BundleID                string                    `json:"bundleId,omitempty"`
	Name                    string                    `json:"name"`
	Tagline                 string                    `json:"tagline,omitempty"`
	Description             string                    `json:"description,omitempty"`
	Version                 string                    `json:"version"`
	Source                  string                    `json:"source,omitempty"`
	IconKind                string                    `json:"iconKind,omitempty"`
	IconLabel               string                    `json:"iconLabel,omitempty"`
	DefaultInstalled        *bool                     `json:"defaultInstalled,omitempty"`
	RequiredPermission      string                    `json:"requiredPermission,omitempty"`
	RequiredPermissionLabel string                    `json:"requiredPermissionLabel,omitempty"`
	Permissions             []string                  `json:"permissions,omitempty"`
	ExecutionMode           string                    `json:"executionMode,omitempty"` // "skill" | "workflow"
	WorkflowYAML            string                    `json:"workflowYaml,omitempty"`
	Instructions            string                    `json:"instructions,omitempty"`
	Skill                   string                    `json:"skill,omitempty"`
	ConfigSchema            []types.PluginConfigField `json:"configSchema,omitempty"`
	Events                  []string                  `json:"events"`
	Actions                 []string                  `json:"actions,omitempty"`
	TriggerSpecs            []TriggerSpec             `json:"triggerSpecs"`
	ActionSpecs             []ActionSpec              `json:"actionSpecs,omitempty"`
}

// ParseManifestYAML extracts normalized triggers/sensors, config_schema, skill rules, and metadata
// from declarative plugin manifests without external dependencies.
func ParseManifestYAML(raw string) (ParsedManifest, error) {
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	var out ParsedManifest

	section := ""
	subList := ""
	skillIndent := -1
	var skillLines []string
	var curTrigger *TriggerSpec
	var curAction *ActionSpec
	var curConfigField *types.PluginConfigField
	shorthandActionSub := false

	flushSkill := func() {
		if len(skillLines) > 0 {
			joined := strings.TrimSpace(strings.Join(skillLines, "\n"))
			if out.Skill == "" {
				out.Skill = joined
			}
			if out.Instructions == "" {
				out.Instructions = joined
			}
			skillLines = nil
		}
		skillIndent = -1
	}

	flushTrigger := func() {
		if curTrigger == nil {
			return
		}
		if curTrigger.ID != "" {
			finalizeTriggerSpec(curTrigger)
			out.TriggerSpecs = append(out.TriggerSpecs, *curTrigger)
		}
		curTrigger = nil
	}

	flushConfigField := func() {
		if curConfigField == nil {
			return
		}
		if curConfigField.Key != "" {
			if curConfigField.Type == "" {
				curConfigField.Type = "text"
			}
			if curConfigField.Label == "" {
				curConfigField.Label = curConfigField.Key
			}
			out.ConfigSchema = append(out.ConfigSchema, *curConfigField)
		}
		curConfigField = nil
	}

	flushAction := func() {
		if curAction == nil {
			return
		}
		if curAction.ID != "" {
			finalizeActionSpec(curAction, out.ID)
			out.ActionSpecs = append(out.ActionSpecs, *curAction)
		}
		curAction = nil
		shorthandActionSub = false
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		indent := len(line) - len(strings.TrimLeft(line, " \t"))

		if section == "skill" || section == "instructions" {
			if trimmed == "" {
				if len(skillLines) > 0 {
					skillLines = append(skillLines, "")
				}
				continue
			}
			if indent > 0 {
				if skillIndent < 0 {
					skillIndent = indent
				}
				cut := indent
				if cut > skillIndent {
					cut = skillIndent
				}
				skillLines = append(skillLines, line[cut:])
				continue
			}
			flushSkill()
		}

		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		if indent == 0 {
			flushTrigger()
			flushConfigField()
			flushAction()
			subList = ""
			key, val, ok := strings.Cut(trimmed, ":")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			val = stripYAMLQuotes(val)
			switch key {
			case "id":
				out.ID = val
				section = ""
			case "slug":
				out.Slug = val
				section = ""
			case "bundle_id", "bundleId":
				out.BundleID = val
				section = ""
			case "name":
				out.Name = val
				section = ""
			case "tagline":
				out.Tagline = val
				section = ""
			case "description":
				out.Description = val
				section = ""
			case "version":
				out.Version = val
				section = ""
			case "source", "category_tag":
				out.Source = val
				section = ""
			case "icon", "icon_kind", "iconKind":
				out.IconKind = val
				section = ""
			case "icon_label", "iconLabel":
				out.IconLabel = val
				section = ""
			case "default_installed", "defaultInstalled":
				b := strings.EqualFold(val, "true")
				out.DefaultInstalled = &b
				section = ""
			case "required_permission", "requiredPermission":
				out.RequiredPermission = val
				section = ""
			case "required_permission_label", "requiredPermissionLabel":
				out.RequiredPermissionLabel = val
				section = ""
			case "execution_mode", "executionMode":
				if strings.EqualFold(val, "workflow") {
					out.ExecutionMode = "workflow"
				} else {
					out.ExecutionMode = "skill"
				}
				section = ""
			case "permissions":
				if strings.HasPrefix(val, "[") {
					out.Permissions = parseInlineList(val)
					section = ""
				} else {
					section = "permissions"
				}
			case "config_schema", "configSchema":
				section = "config_schema"
			case "skill", "instructions":
				if val != "|" && val != ">" && val != "|-" && val != ">-" && val != "" {
					if key == "skill" || out.Skill == "" {
						out.Skill = val
					}
					if key == "instructions" || out.Instructions == "" {
						out.Instructions = val
					}
					section = ""
				} else {
					section = key
					skillIndent = -1
					skillLines = nil
				}
			case "events", "triggers":
				section = "events"
			case "actions":
				section = "actions"
			default:
				section = key
			}
			continue
		}

		if section == "permissions" && strings.HasPrefix(trimmed, "-") {
			item := stripYAMLQuotes(strings.TrimPrefix(trimmed, "-"))
			if item != "" {
				out.Permissions = append(out.Permissions, item)
			}
			continue
		}

		if strings.HasPrefix(trimmed, "-") {
			item := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			switch section {
			case "config_schema":
				flushConfigField()
				f := types.PluginConfigField{}
				if k, v, ok := strings.Cut(item, ":"); ok {
					applyConfigFieldKV(&f, strings.TrimSpace(k), stripYAMLQuotes(v))
				} else {
					f.Key = stripYAMLQuotes(item)
				}
				curConfigField = &f

			case "events":
				if indent >= 6 && curTrigger != nil && !strings.Contains(item, ":") {
					val := stripYAMLQuotes(item)
					if val != "" {
						if subList == "ops" {
							curTrigger.Ops = append(curTrigger.Ops, val)
						} else {
							curTrigger.WatchDirs = append(curTrigger.WatchDirs, val)
						}
					}
					continue
				}
				subList = ""
				flushTrigger()
				t := TriggerSpec{}
				if k, v, ok := strings.Cut(item, ":"); ok {
					k = strings.TrimSpace(k)
					v = stripYAMLQuotes(v)
					applyTriggerKV(&t, k, v)
				} else {
					t.ID = stripYAMLQuotes(item)
				}
				curTrigger = &t

			case "actions":
				if indent >= 6 && curAction != nil {
					if k, v, ok := strings.Cut(item, ":"); ok {
						applyActionKV(curAction, strings.TrimSpace(k), stripYAMLQuotes(v))
					}
					continue
				}
				flushAction()
				subList = ""
				a := ActionSpec{}
				if k, v, ok := strings.Cut(item, ":"); ok {
					k = strings.TrimSpace(k)
					v = stripYAMLQuotes(v)
					if k == "id" {
						a.ID = v
					} else {
						a.ID = k
						if v != "" {
							a.Target = v
						}
						shorthandActionSub = true
					}
				} else {
					a.ID = stripYAMLQuotes(item)
				}
				curAction = &a
			}
			continue
		}

		// Indented key: value lines inside an event/trigger, config_schema field, or action item
		k, rawVal, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v := stripYAMLQuotes(rawVal)

		switch section {
		case "config_schema":
			if curConfigField == nil {
				curConfigField = &types.PluginConfigField{}
			}
			applyConfigFieldKV(curConfigField, k, v)

		case "events":
			if curTrigger == nil {
				curTrigger = &TriggerSpec{}
			}
			switch k {
			case "watch_dirs":
				if strings.HasPrefix(v, "[") {
					curTrigger.WatchDirs = parseInlineList(v)
					subList = ""
				} else {
					subList = "watch_dirs"
				}
			case "ops":
				if strings.HasPrefix(v, "[") {
					curTrigger.Ops = parseInlineList(v)
					subList = ""
				} else {
					subList = "ops"
				}
			default:
				subList = ""
				applyTriggerKV(curTrigger, k, v)
			}
		case "actions":
			if curAction == nil {
				curAction = &ActionSpec{}
			}
			if shorthandActionSub && (k == "target" || k == "retention_days" || k == "path") {
				if k == "target" || k == "path" {
					curAction.Target = v
				}
				continue
			}
			applyActionKV(curAction, k, v)
		}
		_ = subList
	}

	flushSkill()
	flushTrigger()
	flushConfigField()
	flushAction()

	// Populate flat Event/Action ID slices for UI compatibility
	seenEvent := map[string]bool{}
	for _, t := range out.TriggerSpecs {
		if !seenEvent[t.ID] {
			seenEvent[t.ID] = true
			out.Events = append(out.Events, t.ID)
		}
	}
	seenAction := map[string]bool{}
	for _, a := range out.ActionSpecs {
		if !seenAction[a.ID] {
			seenAction[a.ID] = true
			out.Actions = append(out.Actions, a.ID)
		}
	}

	if out.Name == "" && out.ID == "" && len(out.Events) == 0 && out.Skill == "" && out.ExecutionMode == "" {
		return out, fmt.Errorf("无效插件 manifest：缺少 name / id / triggers / skill 声明")
	}
	if out.ExecutionMode == "" {
		out.ExecutionMode = "skill"
	}
	if len(out.Events) == 0 && len(out.TriggerSpecs) == 0 && out.Name == "" && out.ID == "" {
		out.Events = []string{"custom.event_triggered"}
		out.TriggerSpecs = append(out.TriggerSpecs, TriggerSpec{
			ID:     "custom.event_triggered",
			Sensor: "manual",
			Policy: "ask",
		})
	}
	if out.Version == "" {
		out.Version = "0.1.0"
	}
	return out, nil
}

func stripYAMLQuotes(raw string) string {
	s := strings.TrimSpace(raw)
	if len(s) >= 2 && ((s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'')) {
		return s[1 : len(s)-1]
	}
	return s
}

func parseInlineList(raw string) []string {
	inner := strings.TrimSpace(raw)
	inner = strings.TrimPrefix(inner, "[")
	inner = strings.TrimSuffix(inner, "]")
	if strings.TrimSpace(inner) == "" {
		return nil
	}
	parts := strings.Split(inner, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		clean := stripYAMLQuotes(p)
		if clean != "" {
			out = append(out, clean)
		}
	}
	return out
}

func applyTriggerKV(t *TriggerSpec, k, v string) {
	switch k {
	case "id", "event":
		t.ID = v
	case "description":
		t.Description = v
	case "policy":
		t.Policy = v
	case "sensor", "source":
		t.Sensor = v
	case "glob":
		t.Glob = v
	case "script":
		t.Script = v
	case "interval_config_key", "intervalConfigKey":
		t.IntervalConfigKey = v
	case "metric":
		t.Metric = v
	case "operator":
		t.Operator = v
	case "threshold":
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			t.Threshold = n
		}
	case "interval_sec", "intervalSec":
		if n, err := strconv.Atoi(v); err == nil {
			t.IntervalSec = n
		}
	case "sustained_sec", "sustainedSec":
		if n, err := strconv.Atoi(v); err == nil {
			t.SustainedSec = n
		}
	case "schedule":
		t.Schedule = v
	case "url":
		t.URL = v
	case "method":
		t.Method = strings.ToUpper(v)
	case "command":
		t.Command = v
	case "emit_on", "emitOn":
		t.EmitOn = v
	case "match_contains", "matchContains":
		t.MatchContains = v
	case "watch_dir", "watchDir":
		if v != "" {
			t.WatchDirs = append(t.WatchDirs, v)
		}
	}
}

func applyConfigFieldKV(f *types.PluginConfigField, k, v string) {
	switch k {
	case "key":
		f.Key = v
	case "label":
		f.Label = v
	case "type":
		f.Type = strings.ToLower(strings.TrimSpace(v))
	case "description":
		f.Description = v
	case "min":
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			f.Min = n
		}
	case "max":
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			f.Max = n
		}
	case "default":
		if strings.EqualFold(v, "true") {
			f.Default = true
		} else if strings.EqualFold(v, "false") {
			f.Default = false
		} else if n, err := strconv.Atoi(v); err == nil {
			f.Default = n
		} else if n, err := strconv.ParseFloat(v, 64); err == nil {
			f.Default = n
		} else {
			f.Default = v
		}
	}
}

func applyActionKV(a *ActionSpec, k, v string) {
	switch k {
	case "id":
		a.ID = v
	case "tool":
		a.ToolName = v
	case "driver":
		a.Driver = v
	case "event":
		a.EventCode = v
	case "safety":
		a.Safety = v
	case "category":
		a.Category = v
	case "checklist":
		a.ChecklistKey = v
	case "ui_card":
		a.UICard = v
	case "target":
		a.Target = v
	case "command":
		a.Command = v
	case "url":
		a.URL = v
	case "description":
		a.Description = v
	}
}

func finalizeTriggerSpec(t *TriggerSpec) {
	if t.Script != "" && t.Sensor == "" {
		t.Sensor = "script_poll"
	}
	if t.Command != "" && t.Sensor == "" {
		t.Sensor = "command_poll"
	}
	if t.URL != "" && t.Sensor == "" {
		t.Sensor = "http_poll"
	}
	if t.Glob != "" {
		if t.Sensor == "" {
			t.Sensor = "fs_watch"
		}
		if len(t.WatchDirs) == 0 {
			dir := filepath.Dir(t.Glob)
			if dir != "" && dir != "." {
				t.WatchDirs = []string{dir}
			}
		}
		if len(t.Ops) == 0 {
			t.Ops = []string{"create"}
		}
	}
	if t.Schedule != "" && t.Sensor == "" {
		t.Sensor = "cron"
	}
	if (t.Sensor == "script_poll" || t.Sensor == "command_poll" || t.Sensor == "http_poll") && t.IntervalSec <= 0 {
		t.IntervalSec = 60
	}
	if t.Sensor == "script_poll" && t.EmitOn == "" {
		t.EmitOn = "json"
	} else if (t.Sensor == "command_poll" || t.Sensor == "http_poll") && t.EmitOn == "" {
		t.EmitOn = "change"
	}
	if t.Sensor == "" {
		t.Sensor = "manual"
	}
	if t.Policy == "" {
		t.Policy = "ask"
	}
}

// DescribeTriggerSource formats a concise human-readable summary of a trigger's event source.
func DescribeTriggerSource(t TriggerSpec) string {
	switch t.Sensor {
	case "fs_watch":
		if t.Glob != "" {
			return "fs_watch · " + t.Glob
		}
		if len(t.WatchDirs) > 0 {
			return "fs_watch · " + strings.Join(t.WatchDirs, ", ")
		}
		return "fs_watch"
	case "script_poll":
		interval := t.IntervalSec
		if interval <= 0 {
			interval = 60
		}
		if strings.TrimSpace(t.Script) != "" {
			return fmt.Sprintf("script_poll · %s (%ds)", strings.TrimSpace(t.Script), interval)
		}
		return fmt.Sprintf("script_poll (%ds)", interval)
	case "command_poll":
		interval := t.IntervalSec
		if interval <= 0 {
			interval = 60
		}
		cmd := strings.TrimSpace(t.Command)
		if len(cmd) > 36 {
			cmd = cmd[:35] + "…"
		}
		if cmd == "" {
			return fmt.Sprintf("command_poll (%ds)", interval)
		}
		return fmt.Sprintf("command_poll · %s (%ds)", cmd, interval)
	case "http_poll":
		interval := t.IntervalSec
		if interval <= 0 {
			interval = 60
		}
		u := strings.TrimSpace(t.URL)
		if len(u) > 42 {
			u = u[:41] + "…"
		}
		if u == "" {
			return fmt.Sprintf("http_poll (%ds)", interval)
		}
		return fmt.Sprintf("http_poll · %s (%ds)", u, interval)
	case "webhook":
		return "webhook · POST /events/<plugin>/" + t.ID
	case "cron":
		if strings.TrimSpace(t.Schedule) != "" {
			return "cron · " + strings.TrimSpace(t.Schedule)
		}
		return "cron · 定时表达式"
	default:
		return "manual · 主动调用 / 对话触发"
	}
}

func finalizeActionSpec(a *ActionSpec, pluginID string) {
	id := strings.TrimSpace(a.ID)
	if a.Driver == "" {
		switch id {
		case "disk.scan", "scan":
			a.Driver = "fs.scan_cleanable"
		case "disk.move_to_trash", "app.trash_remnants", "move_to_trash":
			a.Driver = "fs.trash"
		case "move_to", "fs.move":
			a.Driver = "fs.move"
		case "disk.empty_trash":
			a.Driver = "fs.empty_trash"
		case "app.scan_remnants":
			a.Driver = "fs.scan_orphans"
		case "app.unload_agent":
			a.Driver = "launchd.unload"
		case "process.sample":
			a.Driver = "proc.sample"
		case "process.terminate":
			a.Driver = "proc.signal"
		case "log.summarize":
			a.Driver = "log.summarize_crashes"
		case "surge.import_logs":
			a.Driver = "surge.import_logs"
		case "surge.inspect_status":
			a.Driver = "surge.inspect_status"
		case "surge.flush_dns":
			a.Driver = "surge.flush_dns"
		case "surge.reload_profile":
			a.Driver = "surge.reload_profile"
		case "battery.report":
			a.Driver = "macos.battery_status"
		case "net.flush_dns":
			a.Driver = "macos.network_status"
		case "system.set_focus":
			a.Driver = "macos.focus_mode"
		case "calendar.list":
			a.Driver = "macos.calendar_upcoming"
		case "github.fetch_logs":
			a.Driver = "net.http_json"
		default:
			if strings.Contains(id, "trash") {
				a.Driver = "fs.trash"
			} else if strings.Contains(id, "move") {
				a.Driver = "fs.move"
			} else {
				a.Driver = "plugin.noop"
			}
		}
	}
	if a.Safety == "" {
		switch a.Driver {
		case "fs.scan_cleanable", "fs.scan_orphans", "fs.read_text", "proc.sample", "log.summarize_crashes", "surge.import_logs", "surge.inspect_status", "macos.battery_status", "macos.network_status", "macos.calendar_upcoming", "net.http_json":
			a.Safety = "readonly"
		case "fs.empty_trash", "proc.signal", "launchd.unload", "shell.exec", "surge.flush_dns", "surge.reload_profile":
			a.Safety = "confirm_always"
		default:
			a.Safety = "reversible"
		}
	}
	if a.Category == "" {
		switch a.Driver {
		case "proc.sample", "proc.signal", "log.summarize_crashes", "shell.exec", "surge.import_logs", "surge.inspect_status", "surge.flush_dns", "surge.reload_profile":
			a.Category = "process"
		case "macos.calendar_upcoming", "macos.focus_mode", "net.http_json", "plugin.noop":
			if strings.Contains(id, "comment") || strings.Contains(id, "reply") || strings.Contains(id, "rerun") {
				a.Category = "outbound"
			} else {
				a.Category = "files"
			}
		default:
			a.Category = "files"
		}
	}
	if a.ToolName == "" {
		switch id {
		case "disk.scan":
			a.ToolName = "disk_scan"
		case "disk.move_to_trash":
			a.ToolName = "disk_move_to_trash"
		case "disk.empty_trash":
			a.ToolName = "disk_empty_trash"
		case "app.scan_remnants":
			a.ToolName = "app_scan_remnants"
		case "app.trash_remnants":
			a.ToolName = "app_trash_remnants"
		case "app.unload_agent":
			a.ToolName = "app_unload_agent"
		case "process.sample":
			a.ToolName = "process_sample"
		case "process.terminate":
			a.ToolName = "process_terminate"
		case "log.summarize":
			a.ToolName = "log_summarize_crashes"
		case "surge.import_logs":
			a.ToolName = "surge_import_logs"
		case "surge.inspect_status":
			a.ToolName = "surge_inspect_status"
		case "surge.flush_dns":
			a.ToolName = "surge_flush_dns"
		case "surge.reload_profile":
			a.ToolName = "surge_reload_profile"
		default:
			prefix := strings.TrimPrefix(pluginID, "local.valet.")
			prefix = sanitizeIdent(prefix)
			if prefix != "" {
				a.ToolName = "plugin_" + prefix + "_" + sanitizeIdent(id)
			} else {
				a.ToolName = "plugin_" + sanitizeIdent(id)
			}
		}
	}
}

func sanitizeIdent(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	return strings.Trim(b.String(), "_")
}

// NormalizeExecutionMode returns "workflow" or "skill" (default).
func NormalizeExecutionMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "workflow") {
		return "workflow"
	}
	return "skill"
}

// SetManifestExecutionMode updates or inserts a top-level `execution_mode` line in manifest YAML.
func SetManifestExecutionMode(manifestYAML, mode string) string {
	normalizedMode := NormalizeExecutionMode(mode)
	norm := strings.ReplaceAll(strings.TrimSpace(manifestYAML), "\r\n", "\n")
	if norm == "" {
		return "execution_mode: " + normalizedMode
	}
	lines := strings.Split(norm, "\n")
	replaced := false
	insertIdx := -1
	for i, line := range lines {
		if len(line) == 0 || line[0] == ' ' || line[0] == '\t' || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		trimmed := strings.TrimSpace(line)
		key, _, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		k := strings.TrimSpace(key)
		if k == "execution_mode" || k == "executionMode" {
			lines[i] = "execution_mode: " + normalizedMode
			replaced = true
			break
		}
		if k == "id" || k == "name" || k == "version" {
			insertIdx = i + 1
		}
	}
	if !replaced {
		newLine := "execution_mode: " + normalizedMode
		if insertIdx < 0 || insertIdx > len(lines) {
			lines = append([]string{newLine}, lines...)
		} else {
			out := make([]string, 0, len(lines)+1)
			out = append(out, lines[:insertIdx]...)
			out = append(out, newLine)
			out = append(out, lines[insertIdx:]...)
			lines = out
		}
	}
	return strings.Join(lines, "\n")
}

// DefaultStarterWorkflowYAML returns a ready-to-run 3-node starter workflow.yaml definition.
func DefaultStarterWorkflowYAML(name, eventCode string) string {
	cleanName := strings.TrimSpace(name)
	if cleanName == "" {
		cleanName = "plugin-workflow"
	}
	cleanEvent := strings.TrimSpace(eventCode)
	if cleanEvent == "" {
		cleanEvent = "manual"
	}
	return fmt.Sprintf(`version: 1
name: %s
description: 声明式自动化工作流
nodes:
  - id: trigger
    type: trigger
    name: 事件触发
    config:
      event: %s
  - id: prepare
    type: transform
    name: 整理上下文
    config:
      output:
        event: "{{trigger.event}}"
        summary: "{{trigger.summary}}"
        payload: "{{trigger.payload}}"
  - id: report
    type: notify
    name: 记录结果
    config:
      title: %s
      message: "已处理事件 {{steps.prepare.output.event}}: {{steps.prepare.output.summary}}"
      level: info
      kind: timeline
edges:
  - from: trigger
    to: prepare
  - from: prepare
    to: report
`, cleanName, cleanEvent, cleanName)
}
