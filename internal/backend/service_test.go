package backend

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"valet/internal/store"
	"valet/internal/sys"
	"valet/internal/types"
)

func TestBackendSidecarEndToEnd(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	downloadsDir := filepath.Join(homeDir, "Downloads")
	if err := os.MkdirAll(downloadsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	samplePath := filepath.Join(downloadsDir, "old-installer.dmg")
	if err := os.WriteFile(samplePath, make([]byte, 2048), 0o644); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var streamEvents []types.ChatStreamPayload

	svc := NewService()
	err := svc.start(StartOptions{
		DataDir:      dataDir,
		HomeDir:      homeDir,
		DesktopReady: false,
		UseVaultOnly: true,
		OnChatStream: func(p types.ChatStreamPayload) {
			mu.Lock()
			streamEvents = append(streamEvents, p)
			mu.Unlock()
		},
	})
	if err != nil {
		t.Fatalf("start failed: %v", err)
	}
	defer func() {
		if err := svc.close(); err != nil {
			t.Errorf("close error: %v", err)
		}
	}()

	// 0. Clean Slate verification
	initialSnap, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot failed: %v", err)
	}
	if initialSnap.SchemaVersion != store.CurrentSchemaVersion {
		t.Fatalf("expected schemaVersion=%d, got %d", store.CurrentSchemaVersion, initialSnap.SchemaVersion)
	}
	if len(initialSnap.InboxItems) != 0 || len(initialSnap.TimelineEvents) != 0 || len(initialSnap.Automations) != 0 || len(initialSnap.McpServers) != 0 || len(initialSnap.Memories) != 0 {
		t.Fatalf("expected empty Clean Slate collections, got inbox=%d timeline=%d auto=%d mcp=%d mem=%d",
			len(initialSnap.InboxItems), len(initialSnap.TimelineEvents), len(initialSnap.Automations), len(initialSnap.McpServers), len(initialSnap.Memories))
	}
	if initialSnap.Preferences.DailySpendCurrent != 0 {
		t.Fatalf("expected initial DailySpendCurrent=0, got %v", initialSnap.Preferences.DailySpendCurrent)
	}
	if initialSnap.StorageStats == nil || initialSnap.StorageStats.TotalLabel == "" {
		t.Fatalf("expected non-nil StorageStats on GetSnapshot")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// 1. Live OS process sampling via /ps through Pi Durable Sidecar
	psRes, err := svc.SendChatMessage(ctx, types.SendChatParams{
		ChatID: "chat-default",
		Prompt: "/ps 帮我看看现在哪些进程最占 CPU",
		Model:  "claude-opus-4",
	})
	if err != nil {
		t.Fatalf("SendChatMessage(/ps) failed: %v", err)
	}
	if psRes.ReplyMessage.ProcessTable == nil || len(psRes.ReplyMessage.ProcessTable.Rows) == 0 {
		t.Fatalf("expected non-empty live processTable from host.sampleProcesses, got %+v", psRes.ReplyMessage)
	}
	mu.Lock()
	if len(streamEvents) == 0 {
		t.Errorf("expected streaming notifications during turn")
	}
	mu.Unlock()

	// 2. Plugin YAML draft via /plugin + InstallPluginDraft + UpdatePluginManifest hot-reload
	pluginRes, err := svc.SendChatMessage(ctx, types.SendChatParams{
		ChatID: "chat-default",
		Prompt: "/plugin 帮我创建一个自动清理下载目录 .dmg 的插件",
		Model:  "claude-opus-4",
	})
	if err != nil {
		t.Fatalf("SendChatMessage(/plugin) failed: %v", err)
	}
	if pluginRes.ReplyMessage.PluginDraft == nil {
		t.Fatalf("expected pluginDraft card from plugin_draft_create tool")
	}
	snapAfterInstall, err := svc.InstallPluginDraft("chat-default", pluginRes.ReplyMessage.ID, *pluginRes.ReplyMessage.PluginDraft)
	if err != nil {
		t.Fatalf("InstallPluginDraft failed: %v", err)
	}
	foundDraftPlugin := false
	for _, p := range snapAfterInstall.Plugins {
		if p.ID == pluginRes.ReplyMessage.PluginDraft.ID && p.Enabled {
			foundDraftPlugin = true
			break
		}
	}
	if !foundDraftPlugin {
		t.Fatalf("installed draft plugin missing from snapshot")
	}
	updatedManifestYAML := strings.Replace(pluginRes.ReplyMessage.PluginDraft.ManifestYAML, "0.1.0", "0.1.1", 1)
	if _, err := svc.UpdatePluginManifest(pluginRes.ReplyMessage.PluginDraft.ID, updatedManifestYAML); err != nil {
		t.Fatalf("UpdatePluginManifest failed: %v", err)
	}

	// 3. Protected dir enforcement + reversible Trash & 7-day Restore ledger
	if _, err := sys.ValidateTargetPath("~/Projects/secret-code", homeDir, snapAfterInstall.Preferences.CleanupPolicy.ProtectedDirs); err == nil {
		t.Fatalf("expected protected directory rejection for ~/Projects/secret-code")
	}

	batchID, movedCount, _, err := sys.MoveItemsToTrash(
		homeDir,
		dataDir,
		snapAfterInstall.Preferences.CleanupPolicy.ProtectedDirs,
		[]string{samplePath},
		0.2,
		nil,
	)
	if err != nil || movedCount != 1 {
		t.Fatalf("MoveItemsToTrash failed: batch=%s moved=%d err=%v", batchID, movedCount, err)
	}
	if _, statErr := os.Stat(samplePath); !os.IsNotExist(statErr) {
		t.Fatalf("expected original file %s to be moved into trash vault", samplePath)
	}
	restoredCount, err := sys.RestoreTrashBatch(dataDir, batchID)
	if err != nil || restoredCount != 1 {
		t.Fatalf("RestoreTrashBatch failed: count=%d err=%v", restoredCount, err)
	}
	if _, statErr := os.Stat(samplePath); statErr != nil {
		t.Fatalf("expected restored file at %s, stat err=%v", samplePath, statErr)
	}

	// Create a 2 MB dummy cache file in ~/Library/Caches/Homebrew so ScanDisk reports >= 1 MB
	// and verify the full /clean -> beforeTool Inbox approval -> Trash -> Restore flow.
	brewCacheDir := filepath.Join(homeDir, "Library", "Caches", "Homebrew")
	if err := os.MkdirAll(brewCacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	brewCacheFile := filepath.Join(brewCacheDir, "pkg.tar.gz")
	if err := os.WriteFile(brewCacheFile, make([]byte, 2*1024*1024), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.SetAutonomyLevel("sensitive_only"); err != nil {
		t.Fatalf("SetAutonomyLevel failed: %v", err)
	}
	cleanRes, err := svc.SendChatMessage(ctx, types.SendChatParams{
		ChatID: "chat-default",
		Prompt: "/clean 扫描并清理缓存",
		Model:  "claude-opus-4",
	})
	if err != nil {
		t.Fatalf("SendChatMessage(/clean) failed: %v", err)
	}
	if cleanRes.CreatedInbox == nil || cleanRes.CreatedEvent == nil {
		t.Fatalf("expected beforeTool safety hook to queue Inbox and Timeline items, got %+v", cleanRes)
	}
	if _, err := svc.ApproveInboxItem(ctx, cleanRes.CreatedInbox.ID); err != nil {
		t.Fatalf("ApproveInboxItem failed: %v", err)
	}
	if _, statErr := os.Stat(brewCacheFile); !os.IsNotExist(statErr) {
		t.Fatalf("expected %s to be moved to trash vault after approval, stat err=%v", brewCacheFile, statErr)
	}
	if _, err := svc.RestoreApprovedInboxItem(cleanRes.CreatedInbox.ID); err != nil {
		t.Fatalf("RestoreApprovedInboxItem failed: %v", err)
	}
	if _, statErr := os.Stat(brewCacheFile); statErr != nil {
		t.Fatalf("expected %s to be restored after undo, stat err=%v", brewCacheFile, statErr)
	}

	// 4. Disabling disk-guard makes RunFirstScan mark the disk task as skipped
	if _, err := svc.TogglePluginEnabled("disk-guard"); err != nil {
		t.Fatalf("TogglePluginEnabled(disk-guard) failed: %v", err)
	}
	scanSnap, err := svc.RunFirstScan(ctx)
	if err != nil {
		t.Fatalf("RunFirstScan failed: %v", err)
	}
	var diskTaskStatus string
	for _, tk := range scanSnap.Scan.Tasks {
		if tk.ID == "disk" {
			diskTaskStatus = tk.Status
			if !strings.Contains(tk.Detail, "已跳过") {
				t.Fatalf("expected skipped disk detail when disk-guard disabled, got %q", tk.Detail)
			}
		}
	}
	if diskTaskStatus != "skipped" {
		t.Fatalf("expected disk task status=skipped, got %q", diskTaskStatus)
	}

	// 5. Simulate plugin event routing through real Pi Durable Sidecar
	simRes, err := svc.SimulatePluginEvent(ctx, "process-sentinel", "process.cpu_spike")
	if err != nil {
		t.Fatalf("SimulatePluginEvent failed: %v", err)
	}
	if simRes.Event.ID == "" && !strings.Contains(simRes.Event.Title, "进程哨兵") {
		t.Fatalf("unexpected simulate result: %+v", simRes)
	}
}

func TestLegacyV1MigrationAndProviderVerification(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Seed a legacy v1 state.json (schemaVersion: 0) with mock items, mock API key, and a user custom plugin.
	legacy := store.NewSeedSnapshot(homeDir)
	legacy.SchemaVersion = 0
	legacy.OnboardingCompleted = true
	legacy.Preferences.DailySpendCurrent = 18.4
	legacy.InboxItems = []types.InboxApprovalItem{
		{ID: "inbox-docker-remnants", Title: "Legacy Mock Card", Status: "pending"},
	}
	legacy.TimelineEvents = []types.TimelineEvent{
		{ID: "evt-docker-uninstall", Title: "Legacy Mock Event", Status: "completed"},
	}
	for i := range legacy.Providers {
		if legacy.Providers[i].ID == "anthropic" {
			legacy.Providers[i].APIKey = "sk-ant-api03-mock-legacy"
			legacy.Providers[i].Verified = true
			legacy.Providers[i].Connected = true
		} else if legacy.Providers[i].ID == "openai" {
			legacy.Providers[i].APIKey = "sk-real-test-key-123456"
			legacy.Providers[i].Verified = true
			legacy.Providers[i].Connected = true
		}
	}
	legacy.Plugins = append(legacy.Plugins, types.PluginState{
		ID:      "local-test-custom",
		Slug:    "local-test-custom",
		Name:    "我的自定义规则",
		Source:  "local",
		Enabled: true,
	})
	rawLegacy, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "state.json"), rawLegacy, 0o600); err != nil {
		t.Fatal(err)
	}

	svc := NewService()
	if err := svc.start(StartOptions{
		DataDir:      dataDir,
		HomeDir:      homeDir,
		DesktopReady: false,
		UseVaultOnly: true,
	}); err != nil {
		t.Fatalf("start on legacy state failed: %v", err)
	}
	defer func() {
		_ = svc.close()
	}()

	migrated, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot failed: %v", err)
	}
	if migrated.SchemaVersion != store.CurrentSchemaVersion {
		t.Fatalf("expected migrated SchemaVersion=%d, got %d", store.CurrentSchemaVersion, migrated.SchemaVersion)
	}
	if !migrated.OnboardingCompleted {
		t.Fatalf("expected OnboardingCompleted to be preserved across migration")
	}
	if len(migrated.InboxItems) != 0 || len(migrated.TimelineEvents) != 0 || migrated.Preferences.DailySpendCurrent != 0 {
		t.Fatalf("expected legacy mock data stripped, got inbox=%d timeline=%d spend=%v",
			len(migrated.InboxItems), len(migrated.TimelineEvents), migrated.Preferences.DailySpendCurrent)
	}
	foundCustom := false
	for _, pl := range migrated.Plugins {
		if pl.ID == "local-test-custom" {
			foundCustom = true
		}
	}
	if !foundCustom {
		t.Fatalf("expected user's custom plugin preserved across v1->v2 migration")
	}
	for _, p := range migrated.Providers {
		if p.ID == "anthropic" && p.APIKey != "" {
			t.Fatalf("expected legacy -mock- APIKey stripped, got %q", p.APIKey)
		}
		if p.ID == "openai" && p.APIKey != "sk-real-test-key-123456" {
			t.Fatalf("expected real APIKey preserved, got %q", p.APIKey)
		}
	}

	// Verify real HTTP model discovery & 401 failure in VerifyProvider
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer sk-valid-key" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4.1"},{"id":"gpt-4.1-mini"}]}`))
	}))
	defer srv.Close()

	okRes, err := svc.VerifyProvider(context.Background(), types.AgentProviderConfig{
		ID:      "openai",
		APIKey:  "sk-valid-key",
		BaseURL: srv.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("VerifyProvider error: %v", err)
	}
	if !okRes.OK || len(okRes.Models) != 2 || okRes.Models[0] != "gpt-4.1" {
		t.Fatalf("expected discovered OpenAI models on HTTP 200, got %+v", okRes)
	}

	failRes, err := svc.VerifyProvider(context.Background(), types.AgentProviderConfig{
		ID:      "openai",
		APIKey:  "sk-wrong-key",
		BaseURL: srv.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("VerifyProvider 401 error: %v", err)
	}
	if failRes.OK {
		t.Fatalf("expected VerifyProvider to return OK=false on HTTP 401, got %+v", failRes)
	}
}
