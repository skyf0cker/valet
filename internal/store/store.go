package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"valet/internal/types"
)

// Store manages durable atomic persistence of ValetSnapshot on disk.
type Store struct {
	mu       sync.RWMutex
	filePath string
	homeDir  string
	data     types.ValetSnapshot
}

// Open loads `<dataDir>/state.json`, or seeds initial state on first run.
func Open(dataDir, homeDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	fp := filepath.Join(dataDir, "state.json")
	s := &Store{
		filePath: fp,
		homeDir:  homeDir,
		data:     NewSeedSnapshot(homeDir),
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
	if err := json.Unmarshal(raw, &loaded); err == nil && len(loaded.Plugins) > 0 {
		s.data = loaded
	} else {
		_ = s.saveLocked()
	}
	return s, nil
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
	_ = s.saveLocked()
	return cloneSnapshot(s.data)
}

func (s *Store) saveLocked() error {
	data, err := json.MarshalIndent(s.data, "", "  ")
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
