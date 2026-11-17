package plugins

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"valet/internal/types"
)

// NormalizeSlug converts an arbitrary plugin identifier or name into a safe directory slug.
func NormalizeSlug(raw string) string {
	s := strings.TrimSpace(strings.ToLower(raw))
	for _, prefix := range []string{"local.valet.", "com.valet.", "com.community."} {
		s = strings.TrimPrefix(s, prefix)
	}
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		isAlnum := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if isAlnum {
			b.WriteRune(r)
			prevDash = false
		} else if !prevDash && b.Len() > 0 {
			b.WriteByte('-')
			prevDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" || out == "." || out == ".." {
		return "local-plugin"
	}
	return out
}

// SafetyLabelFor returns the human-readable Chinese badge label for an action safety tier.
func SafetyLabelFor(safety string) string {
	switch safety {
	case "readonly":
		return "只读"
	case "confirm_always":
		return "始终确认"
	default:
		return "可撤销"
	}
}

// ManifestSpecsToPoliciesAndActions converts parsed manifest specs into UI/runtime policy and action slices,
// preserving existing per-event user policy overrides and 24h counters where IDs match.
func ManifestSpecsToPoliciesAndActions(
	parsed ParsedManifest,
	existing []types.PluginEventPolicy,
) ([]types.PluginEventPolicy, []types.PluginActionCapability) {
	prevMap := make(map[string]types.PluginEventPolicy, len(existing))
	for _, ev := range existing {
		prevMap[ev.ID] = ev
	}
	evList := make([]types.PluginEventPolicy, 0, len(parsed.TriggerSpecs))
	for _, ts := range parsed.TriggerSpecs {
		srcSummary := DescribeTriggerSource(ts)
		if prev, ok := prevMap[ts.ID]; ok {
			if strings.TrimSpace(ts.Description) != "" {
				prev.Description = ts.Description
			}
			prev.Sensor = ts.Sensor
			prev.SourceSummary = srcSummary
			evList = append(evList, prev)
			continue
		}
		desc := strings.TrimSpace(ts.Description)
		if desc == "" {
			desc = "Manifest 声明触发规则"
		}
		pol := ts.Policy
		if pol == "" {
			pol = "ask"
		}
		evList = append(evList, types.PluginEventPolicy{
			ID:            ts.ID,
			Description:   desc,
			Policy:        pol,
			Sensor:        ts.Sensor,
			SourceSummary: srcSummary,
		})
	}
	actList := make([]types.PluginActionCapability, 0, len(parsed.ActionSpecs))
	for _, as := range parsed.ActionSpecs {
		actList = append(actList, types.PluginActionCapability{
			ID: as.ID, Safety: as.Safety, SafetyLabel: SafetyLabelFor(as.Safety),
		})
	}
	return evList, actList
}

// BuildPluginStateFromParsed constructs or updates a PluginState from parsed manifest specs and skill text.
func BuildPluginStateFromParsed(
	id, slug, name, tagline, description, manifestYAML, skillMD, localDir string,
	parsed ParsedManifest,
	existing *types.PluginState,
) types.PluginState {
	var prevEvents []types.PluginEventPolicy
	if existing != nil {
		prevEvents = existing.Events
	}
	events, _ := ManifestSpecsToPoliciesAndActions(parsed, prevEvents)

	resolvedSlug := strings.TrimSpace(slug)
	if resolvedSlug == "" {
		resolvedSlug = strings.TrimSpace(parsed.Slug)
	}
	if resolvedSlug == "" && existing != nil {
		resolvedSlug = existing.Slug
	}
	if resolvedSlug == "" {
		resolvedSlug = NormalizeSlug(id)
	}
	resolvedID := strings.TrimSpace(id)
	if resolvedID == "" {
		resolvedID = strings.TrimSpace(parsed.ID)
	}
	if resolvedID == "" && existing != nil {
		resolvedID = existing.ID
	}
	if resolvedID == "" {
		resolvedID = resolvedSlug
	}

	resolvedName := strings.TrimSpace(name)
	if resolvedName == "" {
		resolvedName = strings.TrimSpace(parsed.Name)
	}
	if resolvedName == "" && existing != nil {
		resolvedName = existing.Name
	}
	if resolvedName == "" {
		resolvedName = resolvedSlug
	}

	resolvedVersion := strings.TrimSpace(parsed.Version)
	if resolvedVersion == "" && existing != nil {
		resolvedVersion = existing.Version
	}
	if resolvedVersion == "" {
		resolvedVersion = "0.1.0"
	}

	resolvedBundle := strings.TrimSpace(parsed.BundleID)
	if resolvedBundle == "" {
		resolvedBundle = strings.TrimSpace(parsed.ID)
	}
	if resolvedBundle == "" && existing != nil {
		resolvedBundle = existing.BundleID
	}
	if resolvedBundle == "" {
		resolvedBundle = "local.valet." + resolvedSlug
	}

	resolvedTagline := strings.TrimSpace(tagline)
	if resolvedTagline == "" {
		resolvedTagline = strings.TrimSpace(parsed.Tagline)
	}
	if resolvedTagline == "" && existing != nil {
		resolvedTagline = existing.Tagline
	}
	if resolvedTagline == "" {
		if len(events) > 0 && events[0].SourceSummary != "" {
			resolvedTagline = events[0].SourceSummary
		} else {
			resolvedTagline = "~/Valet/plugins/" + resolvedSlug + " · 插件包"
		}
	}

	resolvedDesc := strings.TrimSpace(description)
	if resolvedDesc == "" {
		resolvedDesc = strings.TrimSpace(parsed.Description)
	}
	if resolvedDesc == "" && existing != nil {
		resolvedDesc = existing.Description
	}
	if resolvedDesc == "" {
		resolvedDesc = "自包含插件包（manifest.yaml + SKILL.md + scripts），无宿主特化逻辑。"
	}

	resolvedSkill := strings.TrimSpace(skillMD)
	if resolvedSkill == "" {
		resolvedSkill = strings.TrimSpace(parsed.Skill)
	}
	if resolvedSkill == "" && existing != nil {
		resolvedSkill = existing.SkillMarkdown
	}

	resolvedSource := strings.TrimSpace(parsed.Source)
	if resolvedSource != "core" && resolvedSource != "community" && resolvedSource != "local" {
		if existing != nil && existing.Source != "" {
			resolvedSource = existing.Source
		} else {
			resolvedSource = "local"
		}
	}

	resolvedIcon := strings.TrimSpace(parsed.IconKind)
	if resolvedIcon == "" {
		if existing != nil && existing.IconKind != "" {
			resolvedIcon = existing.IconKind
		} else {
			resolvedIcon = "code"
		}
	}
	resolvedIconLabel := strings.TrimSpace(parsed.IconLabel)
	if resolvedIconLabel == "" && existing != nil {
		resolvedIconLabel = existing.IconLabel
	}
	if resolvedIconLabel == "" && resolvedIcon == "code" {
		resolvedIconLabel = "{ }"
	}

	resolvedPerm := strings.TrimSpace(parsed.RequiredPermission)
	if resolvedPerm == "" && len(parsed.Permissions) > 0 {
		resolvedPerm = parsed.Permissions[0]
	}
	if resolvedPerm == "" && existing != nil {
		resolvedPerm = existing.RequiredPermission
	}
	resolvedPermLabel := strings.TrimSpace(parsed.RequiredPermissionLabel)
	if resolvedPermLabel == "" && existing != nil {
		resolvedPermLabel = existing.RequiredPermissionLabel
	}
	if resolvedPermLabel == "" && resolvedPerm != "" {
		resolvedPermLabel = permissionLabelFor(resolvedPerm)
	}

	installed := true
	enabled := true
	if parsed.DefaultInstalled != nil {
		installed = *parsed.DefaultInstalled
		enabled = *parsed.DefaultInstalled
	}

	cfg := types.PluginConfig{}
	if existing != nil {
		cfg = existing.Config
		installed = existing.Installed
		enabled = existing.Enabled
	}
	if cfg.Values == nil {
		cfg.Values = make(map[string]any)
	} else {
		copied := make(map[string]any, len(cfg.Values))
		for k, v := range cfg.Values {
			copied[k] = v
		}
		cfg.Values = copied
	}
	if cfg.LowSpaceThresholdPct != nil {
		if _, ok := cfg.Values["lowSpaceThresholdPct"]; !ok {
			cfg.Values["lowSpaceThresholdPct"] = *cfg.LowSpaceThresholdPct
		}
	}
	if cfg.SampleIntervalSec != nil {
		if _, ok := cfg.Values["sampleIntervalSec"]; !ok {
			cfg.Values["sampleIntervalSec"] = *cfg.SampleIntervalSec
		}
	}
	for _, field := range parsed.ConfigSchema {
		if field.Key != "" && field.Default != nil {
			if _, ok := cfg.Values[field.Key]; !ok {
				cfg.Values[field.Key] = field.Default
			}
		}
	}

	subtitle := "已停用"
	if enabled {
		if len(events) > 0 && events[0].SourceSummary != "" {
			subtitle = "在岗监听 · " + events[0].SourceSummary
		} else {
			subtitle = "在岗 · 支持对话 @唤起"
		}
	}

	state := types.PluginState{
		ID:                      resolvedID,
		Slug:                    resolvedSlug,
		Name:                    resolvedName,
		Tagline:                 resolvedTagline,
		Description:             resolvedDesc,
		Version:                 resolvedVersion,
		BundleID:                resolvedBundle,
		IconKind:                resolvedIcon,
		IconLabel:               resolvedIconLabel,
		Source:                  resolvedSource,
		Enabled:                 enabled,
		Installed:               installed,
		RequiredPermission:      resolvedPerm,
		RequiredPermissionLabel: resolvedPermLabel,
		StatusSubtitle:          subtitle,
		Triggers24h:             make([]int, 10),
		Events:                  events,
		Actions:                 []types.PluginActionCapability{},
		ConfigSchema:            append([]types.PluginConfigField(nil), parsed.ConfigSchema...),
		Config:                  cfg,
		ManifestYAML:            manifestYAML,
		SkillMarkdown:           resolvedSkill,
		LocalDir:                localDir,
	}

	if existing != nil {
		state.AuthError = existing.AuthError
		state.DefaultBehaviorHint = existing.DefaultBehaviorHint
		state.WeeklyImpactValue = existing.WeeklyImpactValue
		state.WeeklyImpactUnit = existing.WeeklyImpactUnit
		state.WeeklyImpactLabel = existing.WeeklyImpactLabel
		if len(existing.BundledFiles) > 0 {
			state.BundledFiles = append([]string(nil), existing.BundledFiles...)
		}
		if len(existing.Triggers24h) > 0 {
			state.Triggers24h = append([]int(nil), existing.Triggers24h...)
		}
	}
	return state
}

func permissionLabelFor(perm string) string {
	switch strings.TrimSpace(perm) {
	case "full_disk":
		return "完全磁盘访问"
	case "automation":
		return "自动化控制"
	case "notifications":
		return "通知权限"
	case "accessibility":
		return "辅助功能"
	case "screen_recording":
		return "屏幕录制"
	default:
		return ""
	}
}

// WritePluginBundle validates a plugin manifest and atomically writes manifest.yaml, SKILL.md,
// and any supporting relative files into `<basePluginsDir>/<slug>/`.
func WritePluginBundle(basePluginsDir string, params types.UpsertLocalPluginParams) (string, ParsedManifest, error) {
	manifestYAML := strings.TrimSpace(params.ManifestYAML)
	if manifestYAML == "" {
		return "", ParsedManifest{}, errors.New("manifestYaml 不能为空")
	}
	parsed, err := ParseManifestYAML(manifestYAML)
	if err != nil {
		return "", ParsedManifest{}, err
	}

	slug := strings.TrimSpace(params.Slug)
	if slug == "" {
		slug = strings.TrimSpace(params.ID)
	}
	if slug == "" {
		slug = strings.TrimSpace(parsed.ID)
	}
	if slug == "" {
		slug = strings.TrimSpace(params.Name)
	}
	if slug == "" {
		slug = strings.TrimSpace(parsed.Name)
	}
	slug = NormalizeSlug(slug)

	pluginDir := filepath.Join(basePluginsDir, slug)
	if err := os.MkdirAll(pluginDir, 0o755); err != nil {
		return "", ParsedManifest{}, fmt.Errorf("创建插件目录失败: %w", err)
	}

	if err := writeFileAtomic(filepath.Join(pluginDir, "manifest.yaml"), []byte(manifestYAML+"\n"), 0o644); err != nil {
		return "", ParsedManifest{}, err
	}

	skillMD := strings.TrimSpace(params.SkillMarkdown)
	if skillMD == "" {
		skillMD = strings.TrimSpace(parsed.Skill)
	}
	if skillMD != "" {
		if err := writeFileAtomic(filepath.Join(pluginDir, "SKILL.md"), []byte(skillMD+"\n"), 0o644); err != nil {
			return "", ParsedManifest{}, err
		}
	}

	absBase, err := filepath.Abs(pluginDir)
	if err != nil {
		return "", ParsedManifest{}, err
	}
	for relRaw, content := range params.Files {
		rel := filepath.Clean(strings.TrimSpace(relRaw))
		if rel == "" || rel == "." || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return "", ParsedManifest{}, fmt.Errorf("非法的插件相对路径: %q", relRaw)
		}
		target := filepath.Join(absBase, rel)
		relCheck, relErr := filepath.Rel(absBase, target)
		if relErr != nil || relCheck == "." || strings.HasPrefix(relCheck, "..") {
			return "", ParsedManifest{}, fmt.Errorf("插件文件路径越界: %q", relRaw)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return "", ParsedManifest{}, err
		}
		mode := fs.FileMode(0o644)
		ext := strings.ToLower(filepath.Ext(target))
		if ext == ".sh" || ext == ".zsh" || ext == ".py" || ext == ".js" || ext == ".ts" || strings.HasPrefix(content, "#!") {
			mode = 0o755
		}
		if err := writeFileAtomic(target, []byte(content), mode); err != nil {
			return "", ParsedManifest{}, err
		}
	}

	return pluginDir, parsed, nil
}

// ReadPluginBundle loads manifest.yaml (or plugin.yaml), optional SKILL.md, and relative files
// from a plugin directory or direct manifest file path.
func ReadPluginBundle(path string) (manifestYAML string, skillMD string, parsed ParsedManifest, files []string, err error) {
	cleaned := strings.TrimSpace(path)
	if cleaned == "" {
		return "", "", ParsedManifest{}, nil, errors.New("插件路径不能为空")
	}
	info, statErr := os.Stat(cleaned)
	if statErr != nil {
		return "", "", ParsedManifest{}, nil, statErr
	}

	pluginDir := cleaned
	manifestPath := ""
	if !info.IsDir() {
		manifestPath = cleaned
		pluginDir = filepath.Dir(cleaned)
	} else {
		for _, cand := range []string{"manifest.yaml", "manifest.yml", "plugin.yaml", "plugin.yml"} {
			p := filepath.Join(pluginDir, cand)
			if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
				manifestPath = p
				break
			}
		}
	}
	if manifestPath == "" {
		return "", "", ParsedManifest{}, nil, fmt.Errorf("目录 %s 下未找到 manifest.yaml", pluginDir)
	}

	rawManifest, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", "", ParsedManifest{}, nil, err
	}
	manifestYAML = strings.TrimSpace(string(rawManifest))
	parsed, err = ParseManifestYAML(manifestYAML)
	if err != nil {
		return "", "", ParsedManifest{}, nil, err
	}

	for _, skillName := range []string{"SKILL.md", "skill.md"} {
		sp := filepath.Join(pluginDir, skillName)
		if rawSkill, sErr := os.ReadFile(sp); sErr == nil {
			skillMD = strings.TrimSpace(string(rawSkill))
			break
		}
	}
	if skillMD == "" && strings.TrimSpace(parsed.Skill) != "" {
		skillMD = strings.TrimSpace(parsed.Skill)
	}

	_ = filepath.WalkDir(pluginDir, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && p != pluginDir {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") {
			return nil
		}
		if rel, rErr := filepath.Rel(pluginDir, p); rErr == nil {
			files = append(files, filepath.ToSlash(rel))
		}
		return nil
	})
	sort.Strings(files)

	return manifestYAML, skillMD, parsed, files, nil
}

// DiscoverLocalPlugins scans `<basePluginsDir>/*/manifest.yaml` and returns parsed local PluginStates.
func DiscoverLocalPlugins(basePluginsDir string) ([]types.PluginState, error) {
	entries, err := os.ReadDir(basePluginsDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	var out []types.PluginState
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		dir := filepath.Join(basePluginsDir, entry.Name())
		manifestYAML, skillMD, parsed, files, rErr := ReadPluginBundle(dir)
		if rErr != nil {
			continue
		}
		slug := NormalizeSlug(entry.Name())
		state := BuildPluginStateFromParsed(slug, slug, parsed.Name, "", "", manifestYAML, skillMD, dir, parsed, nil)
		state.BundledFiles = files
		out = append(out, state)
	}
	return out, nil
}

// LoadCatalogFromFS loads all embedded self-contained plugin bundles (`<slug>/manifest.yaml` + `SKILL.md` + `scripts/*`).
func LoadCatalogFromFS(fsys fs.FS) ([]types.PluginState, error) {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return nil, err
	}
	var out []types.PluginState
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		dirName := entry.Name()
		manifestBytes, mErr := fs.ReadFile(fsys, dirName+"/manifest.yaml")
		if mErr != nil {
			continue
		}
		manifestYAML := strings.TrimSpace(string(manifestBytes))
		parsed, pErr := ParseManifestYAML(manifestYAML)
		if pErr != nil {
			continue
		}
		skillBytes, _ := fs.ReadFile(fsys, dirName+"/SKILL.md")
		skillMD := strings.TrimSpace(string(skillBytes))

		var files []string
		_ = fs.WalkDir(fsys, dirName, func(p string, d fs.DirEntry, wErr error) error {
			if wErr != nil || d.IsDir() {
				return nil
			}
			rel := strings.TrimPrefix(p, dirName+"/")
			if rel != "" && !strings.HasPrefix(d.Name(), ".") {
				files = append(files, rel)
			}
			return nil
		})
		sort.Strings(files)

		slug := NormalizeSlug(dirName)
		id := strings.TrimSpace(parsed.ID)
		if id == "" {
			id = slug
		}
		st := BuildPluginStateFromParsed(id, slug, parsed.Name, "", "", manifestYAML, skillMD, "", parsed, nil)
		st.BundledFiles = files
		out = append(out, st)
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Installed != out[j].Installed {
			return out[i].Installed
		}
		if out[i].Source != out[j].Source {
			return out[i].Source == "core"
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// MaterializeCatalogPlugin ensures `<basePluginsDir>/<slug>/` contains the catalog bundle's files
// without clobbering user-edited manifest.yaml or SKILL.md if already present on disk.
func MaterializeCatalogPlugin(fsys fs.FS, slug, basePluginsDir string) (string, []string, error) {
	cleanSlug := NormalizeSlug(slug)
	sub, err := fs.Sub(fsys, cleanSlug)
	if err != nil {
		return "", nil, err
	}
	targetDir := filepath.Join(basePluginsDir, cleanSlug)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return "", nil, err
	}

	var files []string
	walkErr := fs.WalkDir(sub, ".", func(p string, d fs.DirEntry, wErr error) error {
		if wErr != nil || p == "." {
			return nil
		}
		if d.IsDir() {
			return os.MkdirAll(filepath.Join(targetDir, filepath.FromSlash(p)), 0o755)
		}
		files = append(files, p)
		dstPath := filepath.Join(targetDir, filepath.FromSlash(p))
		isScript := strings.HasPrefix(p, "scripts/")
		if !isScript {
			if _, statErr := os.Stat(dstPath); statErr == nil {
				return nil // Preserve user customization of manifest.yaml / SKILL.md
			}
		}
		data, rErr := fs.ReadFile(sub, p)
		if rErr != nil {
			return rErr
		}
		mode := fs.FileMode(0o644)
		ext := strings.ToLower(filepath.Ext(dstPath))
		if ext == ".sh" || ext == ".zsh" || ext == ".py" || ext == ".js" || ext == ".mjs" || ext == ".ts" {
			mode = 0o755
		}
		return writeFileAtomic(dstPath, data, mode)
	})
	if walkErr != nil {
		return "", nil, walkErr
	}
	sort.Strings(files)
	return targetDir, files, nil
}

// CopyPluginDirToStore copies a local plugin bundle from srcDir into `<basePluginsDir>/<slug>/`.
func CopyPluginDirToStore(srcDir, basePluginsDir, slugOverride string) (string, string, string, ParsedManifest, error) {
	manifestYAML, skillMD, parsed, files, err := ReadPluginBundle(srcDir)
	if err != nil {
		return "", "", "", ParsedManifest{}, err
	}
	info, _ := os.Stat(srcDir)
	resolvedSrcDir := srcDir
	if info != nil && !info.IsDir() {
		resolvedSrcDir = filepath.Dir(srcDir)
	}

	slug := strings.TrimSpace(slugOverride)
	if slug == "" {
		slug = strings.TrimSpace(parsed.ID)
	}
	if slug == "" {
		slug = filepath.Base(resolvedSrcDir)
	}
	slug = NormalizeSlug(slug)

	extraFiles := make(map[string]string)
	for _, rel := range files {
		low := strings.ToLower(rel)
		if low == "manifest.yaml" || low == "manifest.yml" || low == "plugin.yaml" || low == "plugin.yml" || low == "skill.md" {
			continue
		}
		data, rErr := os.ReadFile(filepath.Join(resolvedSrcDir, filepath.FromSlash(rel)))
		if rErr == nil && len(data) <= 512*1024 {
			extraFiles[rel] = string(data)
		}
	}

	dstDir, parsedOut, wErr := WritePluginBundle(basePluginsDir, types.UpsertLocalPluginParams{
		ID:            slug,
		Slug:          slug,
		Name:          parsed.Name,
		ManifestYAML:  manifestYAML,
		SkillMarkdown: skillMD,
		Files:         extraFiles,
	})
	if wErr != nil {
		return "", "", "", ParsedManifest{}, wErr
	}
	return dstDir, manifestYAML, skillMD, parsedOut, nil
}

// ScaffoldPluginBundle generates a starter `manifest.yaml` and `SKILL.md` in `dir`.
func ScaffoldPluginBundle(dir, slug, template string) error {
	cleanSlug := NormalizeSlug(slug)
	if cleanSlug == "local-plugin" && strings.TrimSpace(dir) != "" {
		cleanSlug = NormalizeSlug(filepath.Base(dir))
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	manifestPath := filepath.Join(dir, "manifest.yaml")
	if _, err := os.Stat(manifestPath); err == nil {
		return fmt.Errorf("目录 %s 已存在 manifest.yaml", dir)
	}

	manifest, skill := templateManifestAndSkill(cleanSlug, strings.TrimSpace(strings.ToLower(template)))
	if err := writeFileAtomic(manifestPath, []byte(manifest+"\n"), 0o644); err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(dir, "SKILL.md"), []byte(skill+"\n"), 0o644)
}

func templateManifestAndSkill(slug, template string) (string, string) {
	bt := "`"
	switch template {
	case "fs_watch":
		return fmt.Sprintf(`id: %s
bundle_id: local.valet.%s
name: %s
version: 0.1.0
source: local
icon: disk
triggers:
  - id: fs.file_created
    description: 监听指定目录新增文件
    sensor: fs_watch
    watch_dirs: [~/Downloads]
    ops: [create]
    glob: "*.tmp"
    policy: ask`, slug, slug, slug),
			fmt.Sprintf("### 触发场景\n- 当 %s~/Downloads%s 新增匹配文件时触发 %sfs.file_created%s。\n\n### 处理流程\n1. 检查事件 payload 中的 %spath%s 与文件大小（可用 %sbash%s 或 %sread_file%s 核对）。\n2. 若确认无需保留，调用 %strash_files%s 移入废纸篓（7 天可还原）；执行写操作会自动请求用户授权或进入收件箱审批。", bt, bt, bt, bt, bt, bt, bt, bt, bt, bt, bt, bt)

	case "http_poll":
		return fmt.Sprintf(`id: %s
bundle_id: local.valet.%s
name: %s
version: 0.1.0
source: local
icon: pulse
triggers:
  - id: service.status_changed
    description: 定时轮询 HTTP 接口健康变化
    sensor: http_poll
    url: "http://127.0.0.1:8080/healthz"
    interval_sec: 60
    emit_on: change
    policy: record`, slug, slug, slug),
			fmt.Sprintf("### 触发场景\n- 轮询目标 HTTP/JSON 端点发生内容变化时触发。\n\n### 处理流程\n1. 读取 payload 中的 %sstatus%s 与 %sbody%s。\n2. 若状态异常，用 %sbash%s 执行只读核查命令定位进程与日志，并总结根因。", bt, bt, bt, bt, bt, bt)

	case "cron":
		return fmt.Sprintf(`id: %s
bundle_id: local.valet.%s
name: %s
version: 0.1.0
source: local
icon: calendar
triggers:
  - id: schedule.tick
    description: 按 Cron 表达式定期执行检查
    sensor: cron
    schedule: "0 18 * * *"
    policy: auto`, slug, slug, slug),
			fmt.Sprintf("### 触发场景\n- 到达设定的 Cron 调度时间时自动触发。\n\n### 处理流程\n1. 使用 %sbash%s 或 %sread_file%s 收集目标诊断状态。\n2. 输出精简结论与建议。", bt, bt, bt, bt)

	case "webhook":
		return fmt.Sprintf(`id: %s
bundle_id: local.valet.%s
name: %s
version: 0.1.0
source: local
icon: gh
triggers:
  - id: webhook.received
    description: 通过本地 Webhook 接收外部事件推送
    sensor: webhook
    policy: ask`, slug, slug, slug),
			fmt.Sprintf("### 触发场景\n- 外部脚本或 CI POST 到 %s/events/%s/webhook.received%s 时触发。\n\n### 处理流程\n1. 解析 payload 中的关键上下文。\n2. 按需通过 %sbash%s / %sread_file%s 拉取补充信息并归因；如需执行修复操作先经授权确认。", bt, slug, bt, bt, bt, bt, bt)

	default: // command_poll
		return fmt.Sprintf(`id: %s
bundle_id: local.valet.%s
name: %s
version: 0.1.0
source: local
icon: pulse
triggers:
  - id: probe.changed
    description: 定期执行命令探针并在输出变化时触发
    sensor: command_poll
    command: "uptime"
    interval_sec: 60
    emit_on: change
    policy: record`, slug, slug, slug),
			fmt.Sprintf("### 触发场景\n- %scommand_poll%s 探针输出发生变化时触发 %sprobe.changed%s。\n\n### 处理流程\n1. 读取 payload 中的 %sexitCode%s 与 %sstdout%s。\n2. 结合 %sbash%s / %sread_file%s 排查异常（可调用 %s$VALET_PLUGIN_DIR%s 中的辅助脚本）。", bt, bt, bt, bt, bt, bt, bt, bt, bt, bt, bt, bt, bt, bt)
	}
}

func writeFileAtomic(path string, data []byte, perm fs.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	if err := os.Chmod(tmp, perm); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}
