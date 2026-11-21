package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"valet/internal/types"
)

func TestSecretsStorePersistenceAndReset(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "data")

	sec, err := OpenSecretsStore(dataDir)
	if err != nil {
		t.Fatalf("OpenSecretsStore failed: %v", err)
	}
	if sec.ExistsOnDisk() {
		t.Fatalf("expected new SecretsStore not to write secrets.json until mutated")
	}

	if err := sec.SetProviderKey("custom", "  sk-custom-secret-123456  "); err != nil {
		t.Fatalf("SetProviderKey failed: %v", err)
	}
	if err := sec.SetAutoReviewJevAPIKey("  jev-secret-abcdef  "); err != nil {
		t.Fatalf("SetAutoReviewJevAPIKey failed: %v", err)
	}
	if !sec.ExistsOnDisk() {
		t.Fatalf("expected secrets.json to exist on disk after writes")
	}

	info, err := os.Stat(sec.Path())
	if err != nil {
		t.Fatalf("stat secrets.json failed: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected secrets.json mode 0600, got %o", info.Mode().Perm())
	}

	reopened, err := OpenSecretsStore(dataDir)
	if err != nil {
		t.Fatalf("reopen SecretsStore failed: %v", err)
	}
	snap := reopened.Snapshot()
	if snap.Providers["custom"] != "sk-custom-secret-123456" {
		t.Fatalf("expected persisted custom key, got %q", snap.Providers["custom"])
	}
	if snap.AutoReviewJevAPIKey != "jev-secret-abcdef" {
		t.Fatalf("expected persisted JevAPIKey, got %q", snap.AutoReviewJevAPIKey)
	}

	if err := reopened.SetProviderKey("custom", ""); err != nil {
		t.Fatalf("SetProviderKey delete failed: %v", err)
	}
	if reopened.Snapshot().Providers["custom"] != "" {
		t.Fatalf("expected custom key deleted")
	}
	if reopened.Snapshot().AutoReviewJevAPIKey != "jev-secret-abcdef" {
		t.Fatalf("expected JevAPIKey preserved when deleting provider key")
	}

	if err := reopened.Reset(); err != nil {
		t.Fatalf("Reset failed: %v", err)
	}
	resetSnap := reopened.Snapshot()
	if !resetSnap.MigratedFromKeychain || len(resetSnap.Providers) != 0 || resetSnap.AutoReviewJevAPIKey != "" {
		t.Fatalf("unexpected state after Reset: %+v", resetSnap)
	}
}

func TestHydrateSnapshotMigratesPlaintextAndRunsKeychainOnce(t *testing.T) {
	t.Run("migrates legacy plaintext from state.json and scrubs disk", func(t *testing.T) {
		tmp := t.TempDir()
		homeDir := filepath.Join(tmp, "home")
		dataDir := filepath.Join(tmp, "data")
		_ = os.MkdirAll(homeDir, 0o755)

		legacyStore, err := OpenWithOptions(dataDir, homeDir, false)
		if err != nil {
			t.Fatal(err)
		}
		legacyStore.Update(func(st *types.ValetSnapshot) {
			for i := range st.Providers {
				if st.Providers[i].ID == "openai" {
					st.Providers[i].APIKey = "sk-legacy-openai-9999"
					st.Providers[i].APIKeyMasked = maskKey("sk-legacy-openai-9999")
				}
			}
			st.Preferences.AutoReview.JevAPIKey = "jev-legacy-8888"
			st.Preferences.AutoReview.JevAPIKeyMasked = maskKey("jev-legacy-8888")
		})

		st, err := OpenWithOptions(dataDir, homeDir, true)
		if err != nil {
			t.Fatal(err)
		}
		sec, err := OpenSecretsStore(dataDir)
		if err != nil {
			t.Fatal(err)
		}
		if err := sec.HydrateSnapshot(st, HydrateSecretsOptions{DesktopReady: false}, nil); err != nil {
			t.Fatalf("HydrateSnapshot failed: %v", err)
		}

		rawState, err := os.ReadFile(filepath.Join(dataDir, "state.json"))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(rawState), "sk-legacy-openai-9999") || strings.Contains(string(rawState), "jev-legacy-8888") {
			t.Fatalf("expected plaintext secrets scrubbed from state.json")
		}
		secSnap := sec.Snapshot()
		if secSnap.Providers["openai"] != "sk-legacy-openai-9999" || secSnap.AutoReviewJevAPIKey != "jev-legacy-8888" {
			t.Fatalf("expected secrets migrated to secrets.json, got %+v", secSnap)
		}

		snap := st.Snapshot()
		var gotOpenAI string
		for _, p := range snap.Providers {
			if p.ID == "openai" {
				gotOpenAI = p.APIKey
			}
		}
		if gotOpenAI != "sk-legacy-openai-9999" || snap.Preferences.AutoReview.JevAPIKey != "jev-legacy-8888" {
			t.Fatalf("expected hydrated in-memory keys preserved")
		}
	})

	t.Run("one-time keychain migration queries only masked keys once and never repeats", func(t *testing.T) {
		tmp := t.TempDir()
		homeDir := filepath.Join(tmp, "home")
		dataDir := filepath.Join(tmp, "data")
		_ = os.MkdirAll(homeDir, 0o755)

		st, err := OpenWithOptions(dataDir, homeDir, true)
		if err != nil {
			t.Fatal(err)
		}
		st.Update(func(s *types.ValetSnapshot) {
			for i := range s.Providers {
				if s.Providers[i].ID == "custom" {
					s.Providers[i].APIKeyMasked = "sk-cus••••1234"
					s.Providers[i].Connected = true
				}
			}
			s.Preferences.AutoReview.JevAPIKeyMasked = "jev-ke••••5678"
		})

		calls := map[string]int{}
		totalCalls := 0
		mockKeychainGet := func(key string) ([]byte, error) {
			calls[key]++
			totalCalls++
			switch key {
			case "provider.apikey.custom":
				return []byte("sk-custom-from-keychain-1234"), nil
			case "autoreview.jev.apikey":
				return []byte("jev-key-from-keychain-5678"), nil
			default:
				return nil, os.ErrNotExist
			}
		}

		sec, err := OpenSecretsStore(dataDir)
		if err != nil {
			t.Fatal(err)
		}
		if err := sec.HydrateSnapshot(st, HydrateSecretsOptions{
			DesktopReady: true,
			KeychainGet:  mockKeychainGet,
		}, nil); err != nil {
			t.Fatal(err)
		}

		if totalCalls != 2 || calls["provider.apikey.custom"] != 1 || calls["autoreview.jev.apikey"] != 1 {
			t.Fatalf("expected exactly 1 keychain lookup per masked key (total=2), got total=%d calls=%+v", totalCalls, calls)
		}

		secSnap := sec.Snapshot()
		if !secSnap.MigratedFromKeychain {
			t.Fatalf("expected MigratedFromKeychain=true after migration")
		}
		if secSnap.Providers["custom"] != "sk-custom-from-keychain-1234" || secSnap.AutoReviewJevAPIKey != "jev-key-from-keychain-5678" {
			t.Fatalf("unexpected migrated secrets: %+v", secSnap)
		}

		// Second startup on same dataDir must make ZERO keychain calls
		st2, err := OpenWithOptions(dataDir, homeDir, true)
		if err != nil {
			t.Fatal(err)
		}
		sec2, err := OpenSecretsStore(dataDir)
		if err != nil {
			t.Fatal(err)
		}
		if err := sec2.HydrateSnapshot(st2, HydrateSecretsOptions{
			DesktopReady: true,
			KeychainGet:  mockKeychainGet,
		}, nil); err != nil {
			t.Fatal(err)
		}
		if totalCalls != 2 {
			t.Fatalf("expected 0 keychain calls on subsequent startup, got total=%d", totalCalls)
		}
	})

	t.Run("fresh install makes zero keychain lookups", func(t *testing.T) {
		tmp := t.TempDir()
		homeDir := filepath.Join(tmp, "home")
		dataDir := filepath.Join(tmp, "data")
		_ = os.MkdirAll(homeDir, 0o755)

		st, err := OpenWithOptions(dataDir, homeDir, true)
		if err != nil {
			t.Fatal(err)
		}
		sec, err := OpenSecretsStore(dataDir)
		if err != nil {
			t.Fatal(err)
		}
		calls := 0
		if err := sec.HydrateSnapshot(st, HydrateSecretsOptions{
			DesktopReady: true,
			KeychainGet: func(string) ([]byte, error) {
				calls++
				return nil, os.ErrNotExist
			},
		}, nil); err != nil {
			t.Fatal(err)
		}
		if calls != 0 {
			t.Fatalf("expected 0 keychain calls on clean install, got %d", calls)
		}
		if !sec.ExistsOnDisk() || !sec.Snapshot().MigratedFromKeychain {
			t.Fatalf("expected secrets.json persisted with MigratedFromKeychain=true")
		}
	})
}
