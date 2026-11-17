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

func TestProviderModelDiscoveryAndReconciliation(t *testing.T) {
	tmpRoot := t.TempDir()
	svc := NewService()
	if err := svc.start(StartOptions{
		DataDir:      filepath.Join(tmpRoot, "data"),
		HomeDir:      filepath.Join(tmpRoot, "home"),
		DesktopReady: false,
		UseVaultOnly: true,
	}); err != nil {
		t.Fatalf("start failed: %v", err)
	}
	defer func() {
		_ = svc.close()
	}()

	// 1. OpenRouter: >600KB payload, >60 models, hits /models/user, filters ~aliases & image-only models
	var openrouterPaths []string
	orSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		openrouterPaths = append(openrouterPaths, r.URL.Path)
		if r.URL.Path != "/api/v1/models/user" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer sk-or-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		type orEntry struct {
			ID           string         `json:"id"`
			Description  string         `json:"description"`
			Architecture map[string]any `json:"architecture"`
		}
		var entries []orEntry
		entries = append(entries,
			orEntry{ID: "~anthropic/claude-fable-latest", Description: "alias"},
			orEntry{ID: "black-forest-labs/flux.2-pro", Description: "image", Architecture: map[string]any{"output_modalities": []string{"image"}}},
		)
		bigPad := strings.Repeat("context ", 1200) // ~9.6KB per item -> >600KB total for 70 items
		for i := 0; i < 65; i++ {
			entries = append(entries, orEntry{
				ID:           "provider/model-" + strings.ReplaceAll(strings.TrimSpace(time.Duration(i).String()), "ns", ""),
				Description:  bigPad,
				Architecture: map[string]any{"output_modalities": []string{"text"}},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": entries})
	}))
	defer orSrv.Close()

	orRes, err := svc.VerifyProvider(context.Background(), types.AgentProviderConfig{
		ID:      "openrouter",
		APIKey:  "sk-or-test",
		BaseURL: orSrv.URL + "/api/v1",
	})
	if err != nil {
		t.Fatalf("VerifyProvider(openrouter) error: %v", err)
	}
	if !orRes.OK {
		t.Fatalf("expected OpenRouter verify OK=true, got %+v", orRes)
	}
	if len(openrouterPaths) == 0 || openrouterPaths[0] != "/api/v1/models/user" {
		t.Fatalf("expected OpenRouter to hit /api/v1/models/user, got %v", openrouterPaths)
	}
	if len(orRes.Models) != 65 {
		t.Fatalf("expected all 65 text models without 512KB/40-model truncation, got %d", len(orRes.Models))
	}

	// 2. Anthropic without /v1 suffix hits /v1/models with x-api-key
	var anthPath, anthKey string
	anthSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		anthPath = r.URL.Path
		anthKey = r.Header.Get("x-api-key")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"claude-sonnet-4-5"},{"id":"claude-haiku-4-5"}]}`))
	}))
	defer anthSrv.Close()

	anthRes, err := svc.VerifyProvider(context.Background(), types.AgentProviderConfig{
		ID:      "anthropic",
		APIKey:  "sk-ant-test",
		BaseURL: anthSrv.URL,
	})
	if err != nil || !anthRes.OK || anthPath != "/v1/models" || anthKey != "sk-ant-test" || len(anthRes.Models) != 2 {
		t.Fatalf("unexpected Anthropic verify result: res=%+v path=%s key=%s err=%v", anthRes, anthPath, anthKey, err)
	}

	// 3. Gemini without /v1beta suffix hits /v1beta/models and filters generateContent
	var gemPath string
	gemSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gemPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[{"name":"models/gemini-2.5-pro","supportedGenerationMethods":["generateContent"]},{"name":"models/text-embedding-004","supportedGenerationMethods":["embedContent"]}]}`))
	}))
	defer gemSrv.Close()

	gemRes, err := svc.VerifyProvider(context.Background(), types.AgentProviderConfig{
		ID:      "gemini",
		APIKey:  "AIzaTest",
		BaseURL: gemSrv.URL,
	})
	if err != nil || !gemRes.OK || gemPath != "/v1beta/models" || len(gemRes.Models) != 1 || gemRes.Models[0] != "gemini-2.5-pro" {
		t.Fatalf("unexpected Gemini verify result: res=%+v path=%s err=%v", gemRes, gemPath, err)
	}

	// 4. Ollama without scheme hits /api/tags
	var ollamaPath string
	olSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ollamaPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[{"name":"qwen3:32b"},{"name":"llama3.3:70b"}]}`))
	}))
	defer olSrv.Close()

	olRes, err := svc.VerifyProvider(context.Background(), types.AgentProviderConfig{
		ID:      "ollama",
		BaseURL: strings.TrimPrefix(olSrv.URL, "http://"),
	})
	if err != nil || !olRes.OK || ollamaPath != "/api/tags" || len(olRes.Models) != 2 {
		t.Fatalf("unexpected Ollama verify result: res=%+v path=%s err=%v", olRes, ollamaPath, err)
	}

	// 5. SelectProvider & UpdateProvider reconcile Preferences.Models and stale ChatThreads
	selSnap, err := svc.SelectProvider("openrouter")
	if err != nil {
		t.Fatalf("SelectProvider(openrouter) failed: %v", err)
	}
	if selSnap.Preferences.Models.Primary != "anthropic/claude-sonnet-4.5" {
		t.Fatalf("expected reconciled OpenRouter primary model, got %q", selSnap.Preferences.Models.Primary)
	}
	if len(selSnap.ChatThreads) == 0 || selSnap.ChatThreads[0].Model != selSnap.Preferences.Models.Primary {
		t.Fatalf("expected ChatThread model synced to active provider model, got %+v", selSnap.ChatThreads)
	}

	// Now update openrouter with discovered models -> primary & chat thread update atomically
	var updatedOR types.AgentProviderConfig
	for _, p := range selSnap.Providers {
		if p.ID == "openrouter" {
			updatedOR = p
			break
		}
	}
	updatedOR.Models = []string{"openrouter/tencent/hy4", "google/gemini-2.5-flash"}
	updatedOR.Verified = true
	updatedOR.Connected = true
	updSnap, err := svc.UpdateProvider("openrouter", updatedOR)
	if err != nil {
		t.Fatalf("UpdateProvider failed: %v", err)
	}
	if updSnap.Preferences.Models.Primary != "openrouter/tencent/hy4" ||
		updSnap.Preferences.Models.Fast != "google/gemini-2.5-flash" ||
		updSnap.ChatThreads[0].Model != "openrouter/tencent/hy4" {
		t.Fatalf("expected UpdateProvider to reconcile models & chat threads, got prefs=%+v thread=%q",
			updSnap.Preferences.Models, updSnap.ChatThreads[0].Model)
	}
}

func TestTrashApprovalAndModelSync(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	downloadsDir := filepath.Join(homeDir, "Downloads")
	trashVault := filepath.Join(tmpRoot, "os-trash")
	if err := os.MkdirAll(downloadsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(trashVault, 0o755); err != nil {
		t.Fatal(err)
	}

	freshDMG := filepath.Join(downloadsDir, "fresh-installer.dmg")
	if err := os.WriteFile(freshDMG, make([]byte, 2*1024*1024), 0o644); err != nil {
		t.Fatal(err)
	}

	// 1. ScanDisk with idleDays=0 finds freshly created Downloads files, and ExpandHome resolves bare/relative Downloads paths.
	report := sys.ScanDisk(homeDir, []string{"~/Projects"}, 1, 0)
	foundFresh := false
	for _, item := range report.Items {
		if strings.Contains(item.Path, "fresh-installer.dmg") {
			foundFresh = true
			break
		}
	}
	if !foundFresh {
		t.Fatalf("expected ScanDisk(..., idleDays=0) to include fresh-installer.dmg, got %+v", report.Items)
	}
	if got := sys.ExpandHome("fresh-installer.dmg", homeDir); got != freshDMG {
		t.Fatalf("expected ExpandHome(bare filename) -> %q, got %q", freshDMG, got)
	}
	if got := sys.ExpandHome("Downloads/fresh-installer.dmg", homeDir); got != freshDMG {
		t.Fatalf("expected ExpandHome(relative Downloads) -> %q, got %q", freshDMG, got)
	}

	// 2. Non-nil mover must return an explicit error instead of simulating when target is missing.
	realMover := func(absPath, _ string) (string, error) {
		dest := filepath.Join(trashVault, filepath.Base(absPath))
		if err := os.Rename(absPath, dest); err != nil {
			return "", err
		}
		return dest, nil
	}
	if _, _, _, err := sys.MoveItemsToTrash(homeDir, dataDir, nil, []string{"~/Downloads/does-not-exist.dmg"}, 0.1, realMover); err == nil {
		t.Fatalf("expected error from MoveItemsToTrash with non-nil mover for missing path")
	}

	// 3. ApproveInboxItem in DesktopReady mode rejects empty-path cards and really moves files when bound.
	svc := NewService()
	if err := svc.start(StartOptions{
		DataDir:      dataDir,
		HomeDir:      homeDir,
		DesktopReady: false,
		UseVaultOnly: true,
	}); err != nil {
		t.Fatalf("start failed: %v", err)
	}
	defer func() {
		if err := svc.close(); err != nil {
			t.Errorf("close error: %v", err)
		}
	}()

	svc.mu.Lock()
	svc.opts.DesktopReady = true
	svc.trashMover = realMover
	svc.mu.Unlock()

	svc.store.Update(func(st *types.ValetSnapshot) {
		st.InboxItems = []types.InboxApprovalItem{
			{
				ID:           "inbox-empty",
				PluginID:     "disk-guard",
				PluginName:   "磁盘守卫",
				Category:     "files",
				Title:        "空路径旧审批卡",
				Status:       "pending",
				Reversible7d: true,
				ToolName:     "disk_move_to_trash",
				ActionItems:  nil,
			},
			{
				ID:            "inbox-real",
				PluginID:      "disk-guard",
				PluginName:    "磁盘守卫",
				Category:      "files",
				Title:         "清理 fresh-installer.dmg",
				Status:        "pending",
				Reversible7d:  true,
				ReclaimableGB: 0.1,
				ToolName:      "disk_move_to_trash",
				ActionItems: []types.TimelineActionItem{
					{
						ID:        "a1",
						Label:     "fresh-installer.dmg",
						Path:      "fresh-installer.dmg",
						SizeMB:    2,
						SizeLabel: "2.0 MB",
						Checked:   true,
					},
				},
			},
		}
	})

	if _, err := svc.ApproveInboxItem(context.Background(), "inbox-empty"); err == nil {
		t.Fatalf("expected DesktopReady ApproveInboxItem to reject empty-path file approval")
	}

	if _, err := svc.ApproveInboxItem(context.Background(), "inbox-real"); err != nil {
		t.Fatalf("ApproveInboxItem(inbox-real) failed: %v", err)
	}
	if _, statErr := os.Stat(freshDMG); !os.IsNotExist(statErr) {
		t.Fatalf("expected %s to be moved out of Downloads, statErr=%v", freshDMG, statErr)
	}
	if _, statErr := os.Stat(filepath.Join(trashVault, "fresh-installer.dmg")); statErr != nil {
		t.Fatalf("expected file in mock OS Trash vault, statErr=%v", statErr)
	}

	// 4. UpdateModels keeps ChatThreads[i].Model synced with Preferences.Models.Primary.
	nextSnap, err := svc.UpdateModels(types.ModelSelection{
		Primary: "claude-haiku-4-5",
		Fast:    "claude-haiku-4-5",
		Vision:  "同主模型",
	})
	if err != nil {
		t.Fatalf("UpdateModels failed: %v", err)
	}
	if len(nextSnap.ChatThreads) == 0 || nextSnap.ChatThreads[0].Model != "claude-haiku-4-5" {
		t.Fatalf("expected ChatThreads[0].Model synced to Primary model, got %+v", nextSnap.ChatThreads)
	}

	if _, err := svc.SelectProvider("openrouter"); err != nil {
		t.Fatalf("SelectProvider(openrouter) failed: %v", err)
	}
	orSnap, err := svc.UpdateModels(types.ModelSelection{
		Primary: "openai/gpt-4.1",
		Fast:    "google/gemini-2.5-pro",
		Vision:  "anthropic/claude-sonnet-4.5",
	})
	if err != nil {
		t.Fatalf("UpdateModels(openrouter) failed: %v", err)
	}
	if orSnap.Preferences.Models.Primary != "openai/gpt-4.1" || orSnap.ChatThreads[0].Model != "openai/gpt-4.1" {
		t.Fatalf("expected OpenRouter primary & ChatThread synced to openai/gpt-4.1, got prefs=%+v thread=%q",
			orSnap.Preferences.Models, orSnap.ChatThreads[0].Model)
	}
}
