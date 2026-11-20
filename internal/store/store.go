package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"valet/internal/types"
)

// CurrentSchemaVersion defines the Clean Slate state schema revision.
// Legacy v1 files carrying seeded mock items are automatically migrated on open.
const CurrentSchemaVersion = 2

// Store manages durable atomic persistence of ValetSnapshot on disk.
type Store struct {
	mu          sync.RWMutex
	filePath    string
	homeDir     string
	stripAPIKey bool
	data        types.ValetSnapshot
}

// Open loads `<dataDir>/state.json`, migrates legacy v1 mock state to SchemaVersion 2,
// or creates a Clean Slate snapshot on first run.
func Open(dataDir, homeDir string) (*Store, error) {
	return OpenWithOptions(dataDir, homeDir, false)
}

// OpenWithOptions loads `<dataDir>/state.json` and optionally strips plaintext APIKey fields
// from disk when the host OS Keychain stores credentials.
func OpenWithOptions(dataDir, homeDir string, stripAPIKeyFromDisk bool) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	fp := filepath.Join(dataDir, "state.json")
	s := &Store{
		filePath:    fp,
		homeDir:     homeDir,
		stripAPIKey: stripAPIKeyFromDisk,
		data:        NewSeedSnapshot(homeDir),
	}

	raw, err := os.ReadFile(fp)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			_ = s.saveLocked()
			return s, nil
		}
		return nil, err
	}

	var loaded types.ValetSnapshot
	if err := json.Unmarshal(raw, &loaded); err != nil || len(loaded.Plugins) == 0 {
		_ = s.saveLocked()
		return s, nil
	}

	if loaded.SchemaVersion < CurrentSchemaVersion {
		s.data = migrateLegacySnapshot(loaded, homeDir)
		_ = s.saveLocked()
		return s, nil
	}

	normalizeLoadedSnapshot(&loaded)
	addedSeed := appendMissingSeededPlugins(&loaded)
	s.data = loaded
	if addedSeed {
		_ = s.saveLocked()
	}
	return s, nil
}

func appendMissingSeededPlugins(s *types.ValetSnapshot) bool {
	catalog := seedPlugins()
	seededMap := make(map[string]types.PluginState, len(catalog))
	for _, seeded := range catalog {
		seededMap[seeded.ID] = seeded
	}

	existing := make(map[string]bool, len(s.Plugins))
	changed := false

	for i := range s.Plugins {
		cur := &s.Plugins[i]
		existing[cur.ID] = true
		if cur.Config.Values == nil {
			cur.Config.Values = map[string]any{}
		}
		if len(cur.Actions) > 0 {
			cur.Actions = nil
			changed = true
		}

		seeded, ok := seededMap[cur.ID]
		if !ok {
			continue
		}

		isLegacyV1 := strings.Contains(cur.ManifestYAML, "\nactions:") ||
			strings.Contains(cur.ManifestYAML, "actions:") ||
			strings.Contains(cur.ManifestYAML, "metric_threshold") ||
			(cur.ID == "surge-doctor" && cur.Slug != "surge-doctor")

		if isLegacyV1 {
			oldPolicyByID := make(map[string]types.PluginEventPolicy, len(cur.Events))
			for _, ev := range cur.Events {
				oldPolicyByID[ev.ID] = ev
			}

			cur.Slug = seeded.Slug
			cur.Name = seeded.Name
			cur.Tagline = seeded.Tagline
			cur.Description = seeded.Description
			cur.Version = seeded.Version
			cur.BundleID = seeded.BundleID
			cur.IconKind = seeded.IconKind
			cur.IconLabel = seeded.IconLabel
			cur.Source = seeded.Source
			cur.RequiredPermission = seeded.RequiredPermission
			cur.RequiredPermissionLabel = seeded.RequiredPermissionLabel
			cur.DefaultBehaviorHint = seeded.DefaultBehaviorHint
			cur.StatusSubtitle = seeded.StatusSubtitle
			cur.ManifestYAML = seeded.ManifestYAML
			cur.SkillMarkdown = seeded.SkillMarkdown
			cur.ConfigSchema = append([]types.PluginConfigField(nil), seeded.ConfigSchema...)
			cur.BundledFiles = append([]string(nil), seeded.BundledFiles...)
			cur.Actions = nil
			cur.LocalDir = ""

			mergedEvents := make([]types.PluginEventPolicy, len(seeded.Events))
			for idx, ev := range seeded.Events {
				if prev, ok := oldPolicyByID[ev.ID]; ok {
					if prev.Policy != "" {
						ev.Policy = prev.Policy
					}
					ev.Count24h = prev.Count24h
				}
				mergedEvents[idx] = ev
			}
			cur.Events = mergedEvents
			changed = true
		} else {
			if len(cur.ConfigSchema) == 0 && len(seeded.ConfigSchema) > 0 {
				cur.ConfigSchema = append([]types.PluginConfigField(nil), seeded.ConfigSchema...)
				changed = true
			}
			if len(cur.BundledFiles) == 0 && len(seeded.BundledFiles) > 0 {
				cur.BundledFiles = append([]string(nil), seeded.BundledFiles...)
				changed = true
			}
			if cur.Tagline == "" {
				cur.Tagline = seeded.Tagline
			}
			if cur.Description == "" {
				cur.Description = seeded.Description
			}
		}

		// Ensure catalog defaults exist in Config.Values without overwriting user values
		for k, v := range seeded.Config.Values {
			if _, exists := cur.Config.Values[k]; !exists {
				cur.Config.Values[k] = v
				changed = true
			}
		}
		if cur.Config.LowSpaceThresholdPct != nil {
			if _, exists := cur.Config.Values["lowSpaceThresholdPct"]; !exists {
				cur.Config.Values["lowSpaceThresholdPct"] = *cur.Config.LowSpaceThresholdPct
				changed = true
			}
		}
		if cur.Config.SampleIntervalSec != nil {
			if _, exists := cur.Config.Values["sampleIntervalSec"]; !exists {
				cur.Config.Values["sampleIntervalSec"] = *cur.Config.SampleIntervalSec
				changed = true
			}
		}
	}

	for _, seeded := range catalog {
		if !existing[seeded.ID] {
			s.Plugins = append(s.Plugins, seeded)
			existing[seeded.ID] = true
			changed = true
		}
	}
	return changed
}

func migrateLegacySnapshot(old types.ValetSnapshot, homeDir string) types.ValetSnapshot {
	fresh := NewSeedSnapshot(homeDir)
	fresh.OnboardingCompleted = old.OnboardingCompleted

	// Keep user preferences (sans mock spend counter & mock "dd" default nickname unless customized)
	prefs := old.Preferences
	if prefs.DailySpendCurrent == 18.4 {
		prefs.DailySpendCurrent = 0
	}
	if prefs.UserNickname == "dd" {
		prefs.UserNickname = fresh.Preferences.UserNickname
	}
	if strings.Contains(prefs.CustomInstructions, "~/Documents/Valet") {
		prefs.CustomInstructions = ""
	}
	if prefs.Appearance != "" {
		fresh.Preferences = prefs
	}

	// Preserve any real non-mock API keys or endpoints configured by the user
	for i := range fresh.Providers {
		pid := fresh.Providers[i].ID
		for _, prev := range old.Providers {
			if prev.ID == pid {
				if prev.APIKey != "" && !strings.Contains(prev.APIKey, "-mock-") {
					fresh.Providers[i].APIKey = prev.APIKey
					fresh.Providers[i].APIKeyMasked = maskKey(prev.APIKey)
					fresh.Providers[i].Verified = prev.Verified
					fresh.Providers[i].Connected = prev.Connected
					fresh.Providers[i].LatencyMs = prev.LatencyMs
				}
				if prev.BaseURL != "" {
					fresh.Providers[i].BaseURL = prev.BaseURL
				}
				if prev.ProxyURL != "" {
					fresh.Providers[i].ProxyURL = prev.ProxyURL
				}
				if prev.OrgID != "" {
					fresh.Providers[i].OrgID = prev.OrgID
				}
				if prev.Endpoint != "" {
					fresh.Providers[i].Endpoint = prev.Endpoint
				}
			}
		}
	}

	// Preserve any user-authored custom local plugins (excluding the old seeded dmg-sweeper)
	for _, p := range old.Plugins {
		if p.Source == "local" && p.ID != "dmg-sweeper" {
			fresh.Plugins = append(fresh.Plugins, p)
		}
	}

	normalizeLoadedSnapshot(&fresh)
	return fresh
}

func normalizeLoadedSnapshot(s *types.ValetSnapshot) {
	if s.SchemaVersion == 0 {
		s.SchemaVersion = CurrentSchemaVersion
	}
	if s.InboxItems == nil {
		s.InboxItems = []types.InboxApprovalItem{}
	}
	for i := range s.InboxItems {
		it := &s.InboxItems[i]
		if it.EventCode == "user.question" || it.ToolName == "ask_user" {
			it.Reversible7d = false
			if len(it.Options) == 0 {
				if opts := extractStoreStringSlice(it.ToolArgs["options"]); len(opts) > 0 {
					it.Options = opts
				} else if opts := extractStoreStringSlice(it.Payload["options"]); len(opts) > 0 {
					it.Options = opts
				}
			}
			if strings.TrimSpace(it.SourceChatID) == "" {
				if cid, ok := it.ToolArgs["sourceChatId"].(string); ok && strings.TrimSpace(cid) != "" {
					it.SourceChatID = strings.TrimSpace(cid)
				} else if cid, ok := it.Payload["sourceChatId"].(string); ok && strings.TrimSpace(cid) != "" {
					it.SourceChatID = strings.TrimSpace(cid)
				}
			}
		}
	}
	if s.TimelineEvents == nil {
		s.TimelineEvents = []types.TimelineEvent{}
	}
	if s.ChatThreads == nil || len(s.ChatThreads) == 0 {
		s.ChatThreads = seedChatThreads(s.Preferences.Models.Primary, s.Preferences.UserNickname)
		s.ActiveChatID = s.ChatThreads[0].ID
	}
	normalizeProjectsSnapshot(s)
	if s.Automations == nil {
		s.Automations = []types.AutomationRule{}
	}
	if s.McpServers == nil {
		s.McpServers = []types.McpServerItem{}
	}
	if s.Memories == nil {
		s.Memories = []types.MemoryEntry{}
	}
	if s.HeartbeatLogs == nil {
		s.HeartbeatLogs = []types.HeartbeatRunLog{}
	}
	for i := range s.Plugins {
		if s.Plugins[i].Config.Values == nil {
			s.Plugins[i].Config.Values = map[string]any{}
		}
		if !s.Plugins[i].Installed && s.Plugins[i].Enabled {
			s.Plugins[i].Enabled = false
		}
		s.Plugins[i].Actions = nil
	}
	if len(s.TimelineEvents) > 0 {
		kept := make([]types.TimelineEvent, 0, len(s.TimelineEvents))
		existingIDs := make(map[string]bool, len(s.HeartbeatLogs))
		for _, lg := range s.HeartbeatLogs {
			existingIDs[lg.ID] = true
		}
		for _, ev := range s.TimelineEvents {
			if ev.PluginID == "valet-core" && (ev.EventCode == "system.command" || ev.EventCode == "user.question") {
				continue
			}
			if ev.EventCode == "agent.heartbeat" || ev.PluginBadge == "HB" {
				if !existingIDs[ev.ID] {
					s.HeartbeatLogs = append(s.HeartbeatLogs, types.HeartbeatRunLog{
						ID:        ev.ID,
						Timestamp: ev.Timestamp,
						CreatedAt: ev.TimeLabel,
						Status:    "ok",
						Summary:   ev.Summary,
						Detail:    ev.Summary,
					})
					existingIDs[ev.ID] = true
				}
				continue
			}
			kept = append(kept, ev)
		}
		s.TimelineEvents = kept
	}
	if s.Preferences.BusyMessagePolicy != "steer" && s.Preferences.BusyMessagePolicy != "queue" {
		s.Preferences.BusyMessagePolicy = "queue"
	}
	s.Preferences.DarkTheme = types.NormalizeDarkTheme(s.Preferences.DarkTheme)
	if !s.Preferences.Heartbeat.Initialized {
		def := DefaultHeartbeatConfig()
		s.Preferences.Heartbeat.Enabled = true
		s.Preferences.Heartbeat.Initialized = true
		if s.Preferences.Heartbeat.IntervalMin <= 0 {
			s.Preferences.Heartbeat.IntervalMin = def.IntervalMin
		}
		if strings.TrimSpace(s.Preferences.Heartbeat.Prompt) == "" ||
			strings.Contains(s.Preferences.Heartbeat.Prompt, "巡检系统磁盘可用空间") {
			s.Preferences.Heartbeat.Prompt = def.Prompt
		}
	}
	if s.Preferences.Heartbeat.IntervalMin <= 0 {
		s.Preferences.Heartbeat.IntervalMin = DefaultHeartbeatConfig().IntervalMin
	}
	if strings.TrimSpace(s.Preferences.Heartbeat.Prompt) == "" {
		s.Preferences.Heartbeat.Prompt = DefaultHeartbeatConfig().Prompt
	}

	switch s.Preferences.AutonomyLevel {
	case "always_ask", "auto_review", "full_access":
	case "sensitive_only", "":
		s.Preferences.AutonomyLevel = "auto_review"
		// Upgrade legacy sensitive_only preset checklist so Auto Review evaluates these instead of short-circuiting.
		if s.Preferences.ConfirmChecklist.DeleteOrOverwrite &&
			s.Preferences.ConfirmChecklist.RunTerminalCommand &&
			!s.Preferences.ConfirmChecklist.ModifySystemSettings {
			s.Preferences.ConfirmChecklist.DeleteOrOverwrite = false
			s.Preferences.ConfirmChecklist.RunTerminalCommand = false
		}
	case "autonomous":
		s.Preferences.AutonomyLevel = "full_access"
	default:
		s.Preferences.AutonomyLevel = "auto_review"
	}

	defAR := DefaultAutoReviewConfig()
	if s.Preferences.AutoReview.Engine != "auto" &&
		s.Preferences.AutoReview.Engine != "jev" &&
		s.Preferences.AutoReview.Engine != "llm" {
		s.Preferences.AutoReview.Engine = defAR.Engine
	}
	if strings.TrimSpace(s.Preferences.AutoReview.JevEndpoint) == "" {
		s.Preferences.AutoReview.JevEndpoint = defAR.JevEndpoint
	}
	if strings.TrimSpace(s.Preferences.AutoReview.JevModel) == "" {
		s.Preferences.AutoReview.JevModel = defAR.JevModel
	}
	if strings.TrimSpace(s.Preferences.AutoReview.FallbackModel) == "" {
		s.Preferences.AutoReview.FallbackModel = defAR.FallbackModel
	}
	if s.Preferences.AutoReview.JevAPIKey == "" && defAR.JevAPIKey != "" {
		s.Preferences.AutoReview.JevAPIKey = defAR.JevAPIKey
		s.Preferences.AutoReview.JevAPIKeyMasked = defAR.JevAPIKeyMasked
		s.Preferences.AutoReview.JevVerified = true
	}
}

// Snapshot returns a deep-cloned copy of the current application state.
func (s *Store) Snapshot() types.ValetSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneSnapshot(s.data)
}

// Update mutates state atomically under lock and writes to disk via temp+rename.
func (s *Store) Update(fn func(snap *types.ValetSnapshot)) types.ValetSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.data)
	normalizeLoadedSnapshot(&s.data)
	_ = s.saveLocked()
	return cloneSnapshot(s.data)
}

func (s *Store) saveLocked() error {
	toWrite := cloneSnapshot(s.data)
	toWrite.StorageStats = nil
	if s.stripAPIKey {
		for i := range toWrite.Providers {
			toWrite.Providers[i].APIKey = ""
		}
		toWrite.Preferences.AutoReview.JevAPIKey = ""
	}
	data, err := json.MarshalIndent(toWrite, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.filePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.filePath)
}

func cloneSnapshot(src types.ValetSnapshot) types.ValetSnapshot {
	raw, err := json.Marshal(src)
	if err != nil {
		return src
	}
	var out types.ValetSnapshot
	if err := json.Unmarshal(raw, &out); err != nil {
		return src
	}
	return out
}

func normalizeProjectsSnapshot(s *types.ValetSnapshot) {
	var defaultProj *types.Project
	others := make([]types.Project, 0, len(s.Projects))
	for i := range s.Projects {
		p := s.Projects[i]
		if p.ID == "" {
			continue
		}
		if p.Tags == nil {
			p.Tags = []string{}
		}
		if len(p.Blocks) == 0 {
			p.Blocks = []types.NotebookBlock{{ID: "blk-" + p.ID + "-1", Type: "paragraph", Content: ""}}
		}
		if p.ID == types.DefaultProjectID {
			p.IsDefault = true
			p.Archived = false
			if strings.TrimSpace(p.Title) == "" {
				p.Title = "默认项目"
			}
			if strings.TrimSpace(p.Icon) == "" {
				p.Icon = "box"
			}
			copyProj := p
			defaultProj = &copyProj
			continue
		}
		p.IsDefault = false
		others = append(others, p)
	}
	if defaultProj == nil {
		def := DefaultProject()
		defaultProj = &def
	}
	s.Projects = append([]types.Project{*defaultProj}, others...)

	validProjectIDs := make(map[string]bool, len(s.Projects))
	for _, p := range s.Projects {
		validProjectIDs[p.ID] = true
	}

	for i := range s.ChatThreads {
		if !validProjectIDs[s.ChatThreads[i].ProjectID] {
			s.ChatThreads[i].ProjectID = types.DefaultProjectID
		}
	}

	if !validProjectIDs[s.ActiveProjectID] {
		s.ActiveProjectID = types.DefaultProjectID
	}

	if s.ActiveView == string(types.ViewChat) {
		s.ActiveView = string(types.ViewProjects)
		if s.ActiveProjectTab == "" {
			s.ActiveProjectTab = "session"
		}
	}

	switch s.ActiveProjectTab {
	case "notebook", "sessions", "session":
	default:
		if s.ActiveProjectID == types.DefaultProjectID {
			s.ActiveProjectTab = "sessions"
		} else {
			s.ActiveProjectTab = "notebook"
		}
	}
}

func extractStoreStringSlice(raw any) []string {
	switch v := raw.(type) {
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if t := strings.TrimSpace(item); t != "" {
				out = append(out, t)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				if t := strings.TrimSpace(s); t != "" {
					out = append(out, t)
				}
			}
		}
		return out
	default:
		return nil
	}
}
