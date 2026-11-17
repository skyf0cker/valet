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
	s.data = loaded
	return s, nil
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
	if s.TimelineEvents == nil {
		s.TimelineEvents = []types.TimelineEvent{}
	}
	if s.ChatThreads == nil || len(s.ChatThreads) == 0 {
		s.ChatThreads = seedChatThreads(s.Preferences.Models.Primary, s.Preferences.UserNickname)
		s.ActiveChatID = s.ChatThreads[0].ID
	}
	if s.Automations == nil {
		s.Automations = []types.AutomationRule{}
	}
	if s.McpServers == nil {
		s.McpServers = []types.McpServerItem{}
	}
	if s.Memories == nil {
		s.Memories = []types.MemoryEntry{}
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
