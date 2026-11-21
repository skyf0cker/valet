package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"valet/internal/types"
)

// CurrentSecretsVersion defines the isolated local credential file schema revision.
const CurrentSecretsVersion = 1

// SecretFile holds sensitive API credentials isolated from state.json in a 0600 file.
type SecretFile struct {
	Version              int               `json:"version"`
	MigratedFromKeychain bool              `json:"migratedFromKeychain"`
	Providers            map[string]string `json:"providers"`
	AutoReviewJevAPIKey  string            `json:"autoReviewJevApiKey,omitempty"`
}

// HydrateSecretsOptions configures how SecretsStore hydrates a Store snapshot on startup.
type HydrateSecretsOptions struct {
	DesktopReady bool
	KeychainGet  func(key string) ([]byte, error)
}

// SecretsStore manages atomic 0600 persistence for `<dataDir>/secrets.json`.
type SecretsStore struct {
	mu           sync.RWMutex
	filePath     string
	existsOnDisk bool
	data         SecretFile
}

// OpenSecretsStore loads `<dataDir>/secrets.json` if present, tightening file permissions to 0600,
// or initializes an empty in-memory credential store when absent.
func OpenSecretsStore(dataDir string) (*SecretsStore, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	fp := filepath.Join(dataDir, "secrets.json")
	s := &SecretsStore{
		filePath: fp,
		data: SecretFile{
			Version:   CurrentSecretsVersion,
			Providers: map[string]string{},
		},
	}

	info, err := os.Stat(fp)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return nil, err
	}
	if info.Mode().Perm() != 0o600 {
		_ = os.Chmod(fp, 0o600)
	}

	raw, err := os.ReadFile(fp)
	if err != nil {
		return nil, err
	}
	var loaded SecretFile
	if err := json.Unmarshal(raw, &loaded); err == nil {
		normalizeSecretFile(&loaded)
		s.data = loaded
		s.existsOnDisk = true
	}
	return s, nil
}

// Path returns the filesystem path of `secrets.json`.
func (s *SecretsStore) Path() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.filePath
}

// ExistsOnDisk reports whether `secrets.json` currently exists on disk.
func (s *SecretsStore) ExistsOnDisk() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.existsOnDisk
}

// Snapshot returns a deep copy of the credential file data.
func (s *SecretsStore) Snapshot() SecretFile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneSecretFile(s.data)
}

// SetProviderKey writes or deletes a single provider API key atomically at 0600.
func (s *SecretsStore) SetProviderKey(providerID, key string) error {
	pid := strings.TrimSpace(providerID)
	if pid == "" {
		return nil
	}
	trimmed := strings.TrimSpace(key)
	return s.Update(func(sf *SecretFile) {
		if trimmed == "" {
			delete(sf.Providers, pid)
			return
		}
		sf.Providers[pid] = trimmed
	})
}

// SetAutoReviewJevAPIKey writes or clears the Auto Review decision model API key atomically at 0600.
func (s *SecretsStore) SetAutoReviewJevAPIKey(key string) error {
	trimmed := strings.TrimSpace(key)
	return s.Update(func(sf *SecretFile) {
		sf.AutoReviewJevAPIKey = trimmed
	})
}

// Update mutates the credential store under lock and persists atomically at 0600.
func (s *SecretsStore) Update(fn func(*SecretFile)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if fn != nil {
		fn(&s.data)
	}
	normalizeSecretFile(&s.data)
	return s.saveLocked()
}

// Reset clears stored credentials while marking Keychain migration completed so resets
// never re-trigger legacy Keychain lookups.
func (s *SecretsStore) Reset() error {
	return s.Update(func(sf *SecretFile) {
		sf.MigratedFromKeychain = true
		sf.Providers = map[string]string{}
		sf.AutoReviewJevAPIKey = ""
	})
}

// HydrateSnapshot synchronizes secrets between `<dataDir>/secrets.json`, in-memory `st`,
// and (once per installation in DesktopReady mode) legacy OS Keychain entries, ensuring
// plaintext credentials stay out of `state.json`.
func (s *SecretsStore) HydrateSnapshot(st *Store, opts HydrateSecretsOptions, maskFn func(string) string) error {
	if st == nil {
		return nil
	}
	if maskFn == nil {
		maskFn = maskKey
	}

	snap := st.Snapshot()
	secSnap := s.Snapshot()

	targetProviders := make(map[string]string, len(secSnap.Providers))
	for k, v := range secSnap.Providers {
		if tv := strings.TrimSpace(v); tv != "" {
			targetProviders[k] = tv
		}
	}
	targetJevKey := strings.TrimSpace(secSnap.AutoReviewJevAPIKey)
	migratedFromKeychain := secSnap.MigratedFromKeychain

	secretsDirty := false
	storeNeedsScrub := false

	// Step A: Migrate any plaintext keys present in state.json or seeded env vars into secrets.json.
	for _, p := range snap.Providers {
		k := strings.TrimSpace(p.APIKey)
		if k == "" {
			continue
		}
		storeNeedsScrub = true
		if targetProviders[p.ID] == "" {
			targetProviders[p.ID] = k
			secretsDirty = true
		}
	}
	if jev := strings.TrimSpace(snap.Preferences.AutoReview.JevAPIKey); jev != "" {
		storeNeedsScrub = true
		if targetJevKey == "" {
			targetJevKey = jev
			secretsDirty = true
		}
	}

	// Step B: One-time legacy Keychain migration (only unhydrated masked keys, read once).
	if opts.DesktopReady && !migratedFromKeychain && opts.KeychainGet != nil {
		for _, p := range snap.Providers {
			if strings.TrimSpace(p.APIKey) != "" || targetProviders[p.ID] != "" || strings.TrimSpace(p.APIKeyMasked) == "" {
				continue
			}
			raw, err := opts.KeychainGet("provider.apikey." + p.ID)
			if err != nil {
				fmt.Fprintf(os.Stderr, "[valet] one-time keychain migration read failed for provider %s: %v\n", p.ID, err)
				continue
			}
			if val := strings.TrimSpace(string(raw)); val != "" {
				targetProviders[p.ID] = val
			}
		}
		if strings.TrimSpace(snap.Preferences.AutoReview.JevAPIKey) == "" &&
			targetJevKey == "" &&
			strings.TrimSpace(snap.Preferences.AutoReview.JevAPIKeyMasked) != "" {
			raw, err := opts.KeychainGet("autoreview.jev.apikey")
			if err != nil {
				fmt.Fprintf(os.Stderr, "[valet] one-time keychain migration read failed for autoReview: %v\n", err)
			} else if val := strings.TrimSpace(string(raw)); val != "" {
				targetJevKey = val
			}
		}
		migratedFromKeychain = true
		secretsDirty = true
	}

	// Step C: Persist secrets.json if modified or first desktop initialization.
	if secretsDirty || (!s.ExistsOnDisk() && opts.DesktopReady) {
		if err := s.Update(func(sf *SecretFile) {
			sf.MigratedFromKeychain = migratedFromKeychain
			sf.Providers = targetProviders
			sf.AutoReviewJevAPIKey = targetJevKey
		}); err != nil {
			return err
		}
	}

	// Determine whether in-memory snapshot needs updating or state.json needs scrubbing on disk.
	storeNeedsHydrate := false
	for _, p := range snap.Providers {
		if v := targetProviders[p.ID]; v != "" && v != p.APIKey {
			storeNeedsHydrate = true
			break
		}
	}
	if !storeNeedsHydrate && targetJevKey != "" && targetJevKey != snap.Preferences.AutoReview.JevAPIKey {
		storeNeedsHydrate = true
	}

	if storeNeedsHydrate || storeNeedsScrub {
		st.Update(func(stMut *types.ValetSnapshot) {
			for i := range stMut.Providers {
				if v := targetProviders[stMut.Providers[i].ID]; v != "" {
					stMut.Providers[i].APIKey = v
					stMut.Providers[i].APIKeyMasked = maskFn(v)
				}
			}
			if targetJevKey != "" {
				stMut.Preferences.AutoReview.JevAPIKey = targetJevKey
				stMut.Preferences.AutoReview.JevAPIKeyMasked = maskFn(targetJevKey)
			}
		})
	}
	return nil
}

func (s *SecretsStore) saveLocked() error {
	normalizeSecretFile(&s.data)
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.filePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, s.filePath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	s.existsOnDisk = true
	return nil
}

func normalizeSecretFile(sf *SecretFile) {
	if sf.Version <= 0 {
		sf.Version = CurrentSecretsVersion
	}
	clean := make(map[string]string, len(sf.Providers))
	for k, v := range sf.Providers {
		tk := strings.TrimSpace(k)
		tv := strings.TrimSpace(v)
		if tk != "" && tv != "" {
			clean[tk] = tv
		}
	}
	sf.Providers = clean
	sf.AutoReviewJevAPIKey = strings.TrimSpace(sf.AutoReviewJevAPIKey)
}

func cloneSecretFile(src SecretFile) SecretFile {
	out := src
	out.Providers = make(map[string]string, len(src.Providers))
	for k, v := range src.Providers {
		out.Providers[k] = v
	}
	return out
}
