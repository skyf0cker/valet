package skillsbundle

import (
	_ "embed"
	"strings"
)

// BuiltinSkill represents an embedded Valet built-in Agent skill markdown package.
type BuiltinSkill struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Content     string `json:"content"`
}

//go:embed valet-plugin-dev/SKILL.md
var pluginDevSkillMD string

//go:embed valet-self-config/SKILL.md
var selfConfigSkillMD string

// All returns all built-in Agent skills bundled with Valet.
func All() []BuiltinSkill {
	return []BuiltinSkill{
		parseSkill("valet-plugin-dev", "Valet 插件开发与热加载指南", pluginDevSkillMD),
		parseSkill("valet-self-config", "valet CLI 自配置与控制手册", selfConfigSkillMD),
	}
}

// Lookup finds a built-in skill by name (case-insensitive).
func Lookup(name string) (BuiltinSkill, bool) {
	target := strings.TrimSpace(strings.ToLower(name))
	for _, s := range All() {
		if strings.ToLower(s.Name) == target {
			return s, true
		}
	}
	return BuiltinSkill{}, false
}

func parseSkill(fallbackName, fallbackTitle, raw string) BuiltinSkill {
	norm := strings.ReplaceAll(raw, "\r\n", "\n")
	name := fallbackName
	desc := ""
	title := fallbackTitle
	body := norm

	if strings.HasPrefix(norm, "---\n") {
		rest := norm[len("---\n"):]
		if endIdx := strings.Index(rest, "\n---\n"); endIdx >= 0 {
			fm := rest[:endIdx]
			body = strings.TrimLeft(rest[endIdx+len("\n---\n"):], "\n")
			for _, ln := range strings.Split(fm, "\n") {
				k, v, ok := strings.Cut(ln, ":")
				if !ok {
					continue
				}
				k = strings.TrimSpace(k)
				v = strings.Trim(strings.TrimSpace(v), `"'`)
				switch k {
				case "name":
					if v != "" {
						name = v
					}
				case "description":
					desc = v
				}
			}
		}
	}

	for _, ln := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(ln)
		if strings.HasPrefix(trimmed, "# ") {
			title = strings.TrimSpace(strings.TrimPrefix(trimmed, "# "))
			break
		}
	}

	return BuiltinSkill{
		Name:        name,
		Title:       title,
		Description: desc,
		Content:     strings.TrimSpace(norm),
	}
}
