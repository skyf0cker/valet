package plugins

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

// TriggerSpec describes a normalized declarative sensor trigger in a plugin manifest.
type TriggerSpec struct {
	ID           string   `json:"id"`
	Description  string   `json:"description,omitempty"`
	Policy       string   `json:"policy,omitempty"` // "auto" | "ask" | "record"
	Sensor       string   `json:"sensor"`           // "metric_threshold" | "fs_watch" | "cron" | "manual"
	WatchDirs    []string `json:"watchDirs,omitempty"`
	Ops          []string `json:"ops,omitempty"` // "create" | "write" | "remove" | "rename"
	Glob         string   `json:"glob,omitempty"`
	Metric       string   `json:"metric,omitempty"`   // "disk.used_pct" | "proc.max_cpu" | "logs.crash_count"
	Operator     string   `json:"operator,omitempty"` // "gt" | "gte" | "lt"
	Threshold    float64  `json:"threshold,omitempty"`
	IntervalSec  int      `json:"intervalSec,omitempty"`
	SustainedSec int      `json:"sustainedSec,omitempty"`
	Schedule     string   `json:"schedule,omitempty"`
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
	Description  string `json:"description,omitempty"`
}

// ParsedManifest captures normalized plugin metadata, triggers/sensors, and actions/drivers.
type ParsedManifest struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Version      string        `json:"version"`
	Permissions  []string      `json:"permissions,omitempty"`
	Instructions string        `json:"instructions,omitempty"`
	Events       []string      `json:"events"`
	Actions      []string      `json:"actions"`
	TriggerSpecs []TriggerSpec `json:"triggerSpecs"`
	ActionSpecs  []ActionSpec  `json:"actionSpecs"`
}

// ParseManifestYAML extracts normalized triggers/sensors, actions/drivers, and metadata
// from both rich declarative manifests and shorthand YAML rules without external dependencies.
func ParseManifestYAML(raw string) (ParsedManifest, error) {
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	var out ParsedManifest

	section := ""
	subList := ""
	var curTrigger *TriggerSpec
	var curAction *ActionSpec
	shorthandActionSub := false

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
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " \t"))

		if indent == 0 {
			flushTrigger()
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
			case "name":
				out.Name = val
				section = ""
			case "version":
				out.Version = val
				section = ""
			case "permissions":
				if strings.HasPrefix(val, "[") {
					out.Permissions = parseInlineList(val)
					section = ""
				} else {
					section = "permissions"
				}
			case "instructions":
				if val != "|" && val != ">" && val != "" {
					out.Instructions = val
					section = ""
				} else {
					section = "instructions"
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

		if section == "instructions" {
			if out.Instructions != "" {
				out.Instructions += "\n"
			}
			out.Instructions += trimmed
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
				// Ignore nested parameter list items when inside shorthand or parameters block
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
						// Shorthand map style: `- move_to_trash:`
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

		// Indented key: value lines inside an event/trigger or action item
		k, rawVal, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v := stripYAMLQuotes(rawVal)

		switch section {
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

	flushTrigger()
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

	if out.Name == "" && out.ID == "" && len(out.Events) == 0 && len(out.Actions) == 0 {
		return out, fmt.Errorf("无效插件 manifest：缺少 name / id / events / actions 声明")
	}
	if len(out.Events) == 0 {
		out.Events = []string{"custom.event_triggered"}
		out.TriggerSpecs = append(out.TriggerSpecs, TriggerSpec{
			ID:     "custom.event_triggered",
			Sensor: "manual",
			Policy: "ask",
		})
	}
	if len(out.Actions) == 0 {
		defaultAction := ActionSpec{ID: "custom.run_action"}
		finalizeActionSpec(&defaultAction, out.ID)
		out.Actions = []string{defaultAction.ID}
		out.ActionSpecs = append(out.ActionSpecs, defaultAction)
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
	case "sensor":
		t.Sensor = v
	case "glob":
		t.Glob = v
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
	case "watch_dir", "watchDir":
		if v != "" {
			t.WatchDirs = append(t.WatchDirs, v)
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
	case "description":
		a.Description = v
	}
}

func finalizeTriggerSpec(t *TriggerSpec) {
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
	if t.Metric != "" && t.Sensor == "" {
		t.Sensor = "metric_threshold"
	}
	if t.ID == "app.uninstalled" && t.Sensor == "" {
		t.Sensor = "fs_watch"
		if len(t.WatchDirs) == 0 {
			t.WatchDirs = []string{"/Applications", "~/Applications"}
		}
		if len(t.Ops) == 0 {
			t.Ops = []string{"remove"}
		}
		if t.Glob == "" {
			t.Glob = "*.app"
		}
	}
	if t.ID == "log.crash_loop" && t.Sensor == "" {
		t.Sensor = "metric_threshold"
		t.Metric = "logs.crash_count"
		if t.IntervalSec <= 0 {
			t.IntervalSec = 30
		}
	}
	if t.Sensor == "" {
		t.Sensor = "manual"
	}
	if t.Policy == "" {
		t.Policy = "ask"
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
		case "fs.scan_cleanable", "fs.scan_orphans", "proc.sample", "log.summarize_crashes", "macos.battery_status", "macos.network_status", "macos.calendar_upcoming", "net.http_json":
			a.Safety = "readonly"
		case "fs.empty_trash", "proc.signal", "launchd.unload":
			a.Safety = "confirm_always"
		default:
			a.Safety = "reversible"
		}
	}
	if a.Category == "" {
		switch a.Driver {
		case "proc.sample", "proc.signal", "log.summarize_crashes":
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
