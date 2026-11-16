package plugins

import (
	"fmt"
	"strings"
)

// ParsedManifest captures top-level declarations from a Valet plugin YAML manifest.
type ParsedManifest struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Version string   `json:"version"`
	Events  []string `json:"events"`
	Actions []string `json:"actions"`
}

// ParseManifestYAML extracts plugin identity, triggers/events, and action names
// from a lightweight Valet YAML manifest without external dependencies.
func ParseManifestYAML(raw string) (ParsedManifest, error) {
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	var out ParsedManifest
	section := ""
	seenEvent := map[string]bool{}
	seenAction := map[string]bool{}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " \t"))

		if indent == 0 {
			key, val, ok := strings.Cut(trimmed, ":")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			val = strings.Trim(strings.TrimSpace(val), `"'`)
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
			case "events", "triggers":
				section = "events"
			case "actions":
				section = "actions"
			default:
				section = key
			}
			continue
		}

		if !strings.HasPrefix(trimmed, "-") {
			continue
		}
		item := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
		item = strings.Trim(item, `"'`)
		if item == "" {
			continue
		}

		switch section {
		case "events":
			ev := item
			if strings.HasPrefix(ev, "event:") {
				ev = strings.TrimSpace(strings.TrimPrefix(ev, "event:"))
			} else if strings.HasPrefix(ev, "id:") {
				ev = strings.TrimSpace(strings.TrimPrefix(ev, "id:"))
			} else if k, v, ok := strings.Cut(ev, ":"); ok && (strings.TrimSpace(k) == "id" || strings.TrimSpace(k) == "event") {
				ev = strings.TrimSpace(v)
			}
			ev = strings.Trim(ev, `"'`)
			if ev != "" && !seenEvent[ev] {
				seenEvent[ev] = true
				out.Events = append(out.Events, ev)
			}
		case "actions":
			act := item
			if strings.HasPrefix(act, "id:") {
				act = strings.TrimSpace(strings.TrimPrefix(act, "id:"))
			} else if k, _, ok := strings.Cut(act, ":"); ok {
				act = strings.TrimSpace(k)
			}
			act = strings.Trim(act, `"'`)
			if act != "" && !seenAction[act] {
				seenAction[act] = true
				out.Actions = append(out.Actions, act)
			}
		}
	}

	if out.Name == "" && out.ID == "" && len(out.Events) == 0 && len(out.Actions) == 0 {
		return out, fmt.Errorf("无效插件 manifest：缺少 name / id / events / actions 声明")
	}
	if len(out.Events) == 0 {
		out.Events = []string{"custom.event_triggered"}
	}
	if len(out.Actions) == 0 {
		out.Actions = []string{"custom.run_action"}
	}
	if out.Version == "" {
		out.Version = "0.1.0"
	}
	return out, nil
}
