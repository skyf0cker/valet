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

	"valet/internal/sidecar"
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

	if _, err := svc.SetAutonomyLevel("sensitive_only"); err != nil {
		t.Fatalf("SetAutonomyLevel failed: %v", err)
	}
	snapAfterSet, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot after SetAutonomyLevel failed: %v", err)
	}
	if snapAfterSet.Preferences.AutonomyLevel != "auto_review" {
		t.Fatalf("expected legacy sensitive_only normalized to auto_review, got %q", snapAfterSet.Preferences.AutonomyLevel)
	}
	if snapAfterSet.Preferences.AutoReview.Engine != "auto" || snapAfterSet.Preferences.AutoReview.JevEndpoint == "" {
		t.Fatalf("expected default AutoReview config populated, got %+v", snapAfterSet.Preferences.AutoReview)
	}
	cleanRes, err := svc.SendChatMessage(ctx, types.SendChatParams{
		ChatID: "chat-default",
		Prompt: "/clean 扫描并清理下载目录",
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
	if _, statErr := os.Stat(samplePath); !os.IsNotExist(statErr) {
		t.Fatalf("expected %s to be moved to trash vault after approval, stat err=%v", samplePath, statErr)
	}
	if _, err := svc.RestoreApprovedInboxItem(cleanRes.CreatedInbox.ID); err != nil {
		t.Fatalf("RestoreApprovedInboxItem failed: %v", err)
	}
	if _, statErr := os.Stat(samplePath); statErr != nil {
		t.Fatalf("expected %s to be restored after undo, stat err=%v", samplePath, statErr)
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
				ToolName:     "trash_files",
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
				ToolName:      "trash_files",
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

	approvedSnap, err := svc.ApproveInboxItem(context.Background(), "inbox-real")
	if err != nil {
		t.Fatalf("ApproveInboxItem(inbox-real) failed: %v", err)
	}
	var linkedID string
	for _, it := range approvedSnap.InboxItems {
		if it.ID == "inbox-real" {
			linkedID = it.LinkedTimelineEventID
			break
		}
	}
	if linkedID != "evt-from-inbox-real" {
		t.Fatalf("expected inbox-real LinkedTimelineEventID=%q, got %q", "evt-from-inbox-real", linkedID)
	}
	foundLinkedEvt := false
	for _, ev := range approvedSnap.TimelineEvents {
		if ev.ID == "evt-from-inbox-real" {
			foundLinkedEvt = true
			break
		}
	}
	if !foundLinkedEvt {
		t.Fatalf("expected timeline event evt-from-inbox-real to exist after ApproveInboxItem")
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

func TestWebhookSkillArchiveMemoryHeartbeat(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	_ = os.MkdirAll(filepath.Join(homeDir, "Downloads"), 0o755)

	svc := NewService()
	if err := svc.start(StartOptions{
		HomeDir:      homeDir,
		DataDir:      dataDir,
		DesktopReady: false,
		UseVaultOnly: true,
	}); err != nil {
		t.Fatalf("svc.start failed: %v", err)
	}
	defer func() { _ = svc.close() }()

	snap, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot failed: %v", err)
	}
	if snap.Preferences.PluginRuntime.WebhookEndpoint == "" {
		t.Fatalf("expected webhook endpoint to be initialized, got empty")
	}
	if !snap.Preferences.Heartbeat.Enabled || !snap.Preferences.Heartbeat.Initialized {
		t.Fatalf("expected agent heartbeat to be enabled & initialized by default, got %+v", snap.Preferences.Heartbeat)
	}
	if snap.Preferences.BusyMessagePolicy != "queue" {
		t.Fatalf("expected default BusyMessagePolicy == \"queue\", got %q", snap.Preferences.BusyMessagePolicy)
	}

	// 1. Install custom webhook plugin with SKILL.md
	customYAML := `id: local.valet.deploy-watch
name: 部署观察员
version: 0.1.0
triggers:
  - id: deploy.failed
    sensor: webhook
    policy: auto
`
	customSkill := "# Deploy Watch Skill\n\n当收到 `deploy.failed` 时汇总错误摘要。"
	snap, err = svc.InstallCustomPlugin(types.InstallCustomPluginParams{
		Name:          "部署观察员",
		Tagline:       "接收部署失败 Webhook 并执行 Skill",
		YAML:          customYAML,
		SkillMarkdown: customSkill,
	})
	if err != nil {
		t.Fatalf("InstallCustomPlugin failed: %v", err)
	}

	var deployedID string
	for _, p := range snap.Plugins {
		if p.Name == "部署观察员" {
			deployedID = p.ID
			if !strings.Contains(p.SkillMarkdown, "Deploy Watch Skill") {
				t.Fatalf("expected SKILL.md persisted on plugin, got %q", p.SkillMarkdown)
			}
			break
		}
	}
	if deployedID == "" {
		t.Fatalf("expected installed deploy-watch plugin in snapshot")
	}

	// 2. UpdatePluginSkill persists revised SKILL.md
	snap, err = svc.UpdatePluginSkill(deployedID, "# Updated Skill\n\n- 优先分析构建失败栈。")
	if err != nil {
		t.Fatalf("UpdatePluginSkill failed: %v", err)
	}
	var updatedSkillFound bool
	for _, p := range snap.Plugins {
		if p.ID == deployedID && strings.Contains(p.SkillMarkdown, "优先分析构建失败栈") {
			updatedSkillFound = true
		}
	}
	if !updatedSkillFound {
		t.Fatalf("expected UpdatePluginSkill change to persist in snapshot")
	}

	// 3. POST to Webhook ingress /events/{pluginId}/{eventCode}?sync=1
	webhookURL := snap.Preferences.PluginRuntime.WebhookEndpoint + "/" + deployedID + "/deploy.failed?sync=1"
	resp, err := http.Post(webhookURL, "application/json", strings.NewReader(`{"service":"api-gateway","exitCode":1}`))
	if err != nil {
		t.Fatalf("HTTP POST webhook failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected webhook 200 OK, got %d", resp.StatusCode)
	}
	var hookBody map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&hookBody); err != nil {
		t.Fatalf("decode webhook JSON response failed: %v", err)
	}
	if hookBody["ok"] != true || hookBody["pluginId"] != deployedID || hookBody["eventCode"] != "deploy.failed" {
		t.Fatalf("unexpected webhook JSON body: %+v", hookBody)
	}

	// 4. AddMemory adds a persistent local memory item
	snap, err = svc.AddMemory("永远不要清理 ~/Work 目录", "手动添加")
	if err != nil {
		t.Fatalf("AddMemory failed: %v", err)
	}
	if len(snap.Memories) == 0 || snap.Memories[0].Content != "永远不要清理 ~/Work 目录" {
		t.Fatalf("expected newly added memory at index 0, got %+v", snap.Memories)
	}

	// 5. ArchiveChatThread archives active chat, switches/creates active chat, and restores cleanly
	origChatID := snap.ActiveChatID
	snap, err = svc.ArchiveChatThread(origChatID, true)
	if err != nil {
		t.Fatalf("ArchiveChatThread(true) failed: %v", err)
	}
	if snap.ActiveChatID == origChatID {
		t.Fatalf("expected activeChatId to switch away from archived thread %q", origChatID)
	}
	var archivedFlag bool
	for _, c := range snap.ChatThreads {
		if c.ID == origChatID && c.Archived {
			archivedFlag = true
		}
	}
	if !archivedFlag {
		t.Fatalf("expected thread %q to have Archived=true", origChatID)
	}
	snap, err = svc.ArchiveChatThread(origChatID, false)
	if err != nil {
		t.Fatalf("ArchiveChatThread(false) failed: %v", err)
	}
	if snap.ActiveChatID != origChatID {
		t.Fatalf("expected unarchiving to restore activeChatId=%q, got %q", origChatID, snap.ActiveChatID)
	}

	// 6. TriggerHeartbeatNow records heartbeat timestamp and writes to HeartbeatLogs (never TimelineEvents)
	snap, err = svc.TriggerHeartbeatNow(context.Background())
	if err != nil {
		t.Fatalf("TriggerHeartbeatNow failed: %v", err)
	}
	if snap.Preferences.Heartbeat.LastRunAt == "" {
		t.Fatalf("expected Preferences.Heartbeat.LastRunAt to be updated after heartbeat")
	}
	if len(snap.HeartbeatLogs) != 1 {
		t.Fatalf("expected 1 HeartbeatRunLog after TriggerHeartbeatNow, got %d (%+v)", len(snap.HeartbeatLogs), snap.HeartbeatLogs)
	}
	for _, ev := range snap.TimelineEvents {
		if ev.EventCode == "agent.heartbeat" {
			t.Fatalf("heartbeat must not pollute TimelineEvents, found %+v", ev)
		}
	}
	snap, err = svc.ClearHeartbeatLogs()
	if err != nil {
		t.Fatalf("ClearHeartbeatLogs failed: %v", err)
	}
	if len(snap.HeartbeatLogs) != 0 {
		t.Fatalf("expected 0 HeartbeatLogs after ClearHeartbeatLogs, got %d", len(snap.HeartbeatLogs))
	}
}

func TestGenericBundleScriptsKernelRPCsUninstallAndInteractivePermission(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	downloadsDir := filepath.Join(homeDir, "Downloads")
	logDir := filepath.Join(homeDir, "Library", "Logs", "Surge")
	if err := os.MkdirAll(downloadsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatal(err)
	}

	nowTS := time.Now().Format("2006-01-02 15:04:05.000000")
	logContent := strings.Join([]string{
		nowTS + ` <WARNING> [SGMProfileManager] Update config failed, URL: https://sub.example.com/api?token=superSecretSubToken, error: 第 52 行存在无效配置`,
		nowTS + ` <ERROR> [SGDNSClient] DNS query failed over DoH`,
	}, "\n") + "\n"
	if err := os.WriteFile(filepath.Join(logDir, "Surge-2026-11-17.log"), []byte(logContent), 0o644); err != nil {
		t.Fatal(err)
	}

	trashMe := filepath.Join(downloadsDir, "removable.dmg")
	if err := os.WriteFile(trashMe, []byte("dmg-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	permCh := make(chan types.PendingPermissionRequest, 4)
	svc := NewService()
	if err := svc.start(StartOptions{
		HomeDir:      homeDir,
		DataDir:      dataDir,
		DesktopReady: false,
		UseVaultOnly: true,
		OnChatStream: func(p types.ChatStreamPayload) {
			if p.PendingPermission != nil {
				permCh <- *p.PendingPermission
			}
		},
	}); err != nil {
		t.Fatalf("svc.start failed: %v", err)
	}
	defer func() {
		if err := svc.close(); err != nil {
			t.Errorf("close error: %v", err)
		}
	}()

	// 1. Verify catalog bundles materialized with 0 static actions and bundled scripts runnable via <dataDir>/bin/bun
	snap, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot failed: %v", err)
	}
	var surgePlug *types.PluginState
	for i := range snap.Plugins {
		p := snap.Plugins[i]
		if len(p.Actions) != 0 {
			t.Fatalf("expected Action-less plugin %s, got %+v", p.ID, p.Actions)
		}
		if p.ID == "surge-doctor" {
			cp := p
			surgePlug = &cp
		}
	}
	if surgePlug == nil || surgePlug.LocalDir == "" || len(surgePlug.ConfigSchema) < 2 {
		t.Fatalf("expected materialized surge-doctor with ConfigSchema, got %+v", surgePlug)
	}

	scriptOutAny, err := svc.handleSidecarHostRequest(
		context.Background(),
		"host.kernel.bash",
		json.RawMessage(`{"command":"bun \"`+filepath.Join(surgePlug.LocalDir, "scripts", "import-logs.mjs")+`\" --minutes 360"}`),
	)
	if err != nil {
		t.Fatalf("running bundled import-logs.mjs failed: %v", err)
	}
	scriptOutBytes, _ := json.Marshal(scriptOutAny)
	scriptOutStr := string(scriptOutBytes)
	if !strings.Contains(scriptOutStr, "***REDACTED***") || strings.Contains(scriptOutStr, "superSecretSubToken") {
		t.Fatalf("expected bundled script to redact secrets, got %s", scriptOutStr)
	}

	// 2. Verify host.kernel.writeFile -> host.kernel.readFile -> host.kernel.listDir
	notePath := filepath.Join(homeDir, "notes", "valet-note.txt")
	if _, err := svc.handleSidecarHostRequest(
		context.Background(),
		"host.kernel.writeFile",
		json.RawMessage(`{"path":"`+notePath+`","content":"line1\nline2"}`),
	); err != nil {
		t.Fatalf("host.kernel.writeFile failed: %v", err)
	}
	readRes, err := svc.handleSidecarHostRequest(
		context.Background(),
		"host.kernel.readFile",
		json.RawMessage(`{"path":"`+notePath+`","offsetLine":1,"limitLines":10}`),
	)
	if err != nil || !strings.Contains(readRes.(map[string]any)["content"].(string), "line2") {
		t.Fatalf("host.kernel.readFile unexpected result: %+v err=%v", readRes, err)
	}
	listRes, err := svc.handleSidecarHostRequest(
		context.Background(),
		"host.kernel.listDir",
		json.RawMessage(`{"path":"~/Downloads"}`),
	)
	if err != nil {
		t.Fatalf("host.kernel.listDir failed: %v", err)
	}
	if entries, ok := listRes.(map[string]any)["entries"].([]map[string]any); !ok || len(entries) == 0 {
		t.Fatalf("host.kernel.listDir unexpected entries: %+v", listRes)
	}

	// 3. Verify equal uninstall -> reinstall lifecycle on catalog plugin
	uninstalledSnap, err := svc.UninstallPlugin("surge-doctor")
	if err != nil {
		t.Fatalf("UninstallPlugin(surge-doctor) failed: %v", err)
	}
	var uninstalledFound bool
	for _, p := range uninstalledSnap.Plugins {
		if p.ID == "surge-doctor" {
			uninstalledFound = true
			if p.Installed || p.Enabled || p.LocalDir != "" {
				t.Fatalf("expected uninstalled catalog plugin reset, got %+v", p)
			}
		}
	}
	if !uninstalledFound {
		t.Fatalf("expected uninstalled catalog plugin to remain discoverable")
	}
	if _, statErr := os.Stat(surgePlug.LocalDir); !os.IsNotExist(statErr) {
		t.Fatalf("expected materialized plugin dir %s deleted on uninstall", surgePlug.LocalDir)
	}
	reinstalledSnap, err := svc.InstallMarketplacePlugin("surge-doctor")
	if err != nil {
		t.Fatalf("InstallMarketplacePlugin(surge-doctor) failed: %v", err)
	}
	for _, p := range reinstalledSnap.Plugins {
		if p.ID == "surge-doctor" && (!p.Installed || !p.Enabled || p.LocalDir == "") {
			t.Fatalf("expected reinstalled plugin enabled with LocalDir, got %+v", p)
		}
	}

	// 4. Verify interactive foreground Chat permission prompt (allow_once -> executes, deny -> aborts)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	chatErrCh := make(chan error, 1)
	go func() {
		_, cErr := svc.SendChatMessage(ctx, types.SendChatParams{
			ChatID:      "chat-interactive-test",
			Prompt:      "/clean 帮我清理 Downloads 安装包",
			Model:       "claude-opus-4",
			Interactive: true,
		})
		chatErrCh <- cErr
	}()

	select {
	case perm := <-permCh:
		if perm.ToolName != "trash_files" {
			t.Fatalf("expected interactive permission for trash_files, got %+v", perm)
		}
		ok, rErr := svc.ResolveChatPermission(ctx, perm.ChatID, perm.RequestID, "allow_once", "")
		if rErr != nil || !ok {
			t.Fatalf("ResolveChatPermission(allow_once) failed: ok=%v err=%v", ok, rErr)
		}
	case err := <-chatErrCh:
		t.Fatalf("chat finished before emitting pendingPermission: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for interactive PendingPermission")
	}

	if err := <-chatErrCh; err != nil {
		t.Fatalf("interactive SendChatMessage failed: %v", err)
	}
	if _, statErr := os.Stat(trashMe); !os.IsNotExist(statErr) {
		t.Fatalf("expected %s moved to Trash after allow_once, statErr=%v", trashMe, statErr)
	}

	// Verify deny leaves file untouched
	keepMe := filepath.Join(downloadsDir, "keep-me.dmg")
	if err := os.WriteFile(keepMe, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	go func() {
		_, cErr := svc.SendChatMessage(ctx, types.SendChatParams{
			ChatID:      "chat-interactive-deny",
			Prompt:      "/clean 再清理一次 Downloads",
			Model:       "claude-opus-4",
			Interactive: true,
		})
		chatErrCh <- cErr
	}()
	select {
	case perm := <-permCh:
		ok, rErr := svc.ResolveChatPermission(ctx, perm.ChatID, perm.RequestID, "deny", "保留此文件")
		if rErr != nil || !ok {
			t.Fatalf("ResolveChatPermission(deny) failed: ok=%v err=%v", ok, rErr)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for deny test PendingPermission")
	}
	if err := <-chatErrCh; err != nil {
		t.Fatalf("deny SendChatMessage failed: %v", err)
	}
	if _, statErr := os.Stat(keepMe); statErr != nil {
		t.Fatalf("expected %s preserved after user deny, err=%v", keepMe, statErr)
	}
}

func TestExecKernelBash(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	if err := os.MkdirAll(homeDir, 0o755); err != nil {
		t.Fatal(err)
	}

	svc := NewService()
	if err := svc.start(StartOptions{
		HomeDir:      homeDir,
		DataDir:      dataDir,
		DesktopReady: false,
		UseVaultOnly: true,
	}); err != nil {
		t.Fatalf("svc.start failed: %v", err)
	}
	defer func() {
		if err := svc.close(); err != nil {
			t.Errorf("close error: %v", err)
		}
	}()

	resAny, err := svc.handleSidecarHostRequest(
		context.Background(),
		"host.kernel.bash",
		json.RawMessage(`{"command":"echo hello-valet","cwd":"~"}`),
	)
	if err != nil {
		t.Fatalf("expected safe kernel bash command to succeed, got error: %v", err)
	}
	resMap, ok := resAny.(map[string]any)
	if !ok {
		t.Fatalf("unexpected result type: %T", resAny)
	}
	if resMap["ok"] != true || resMap["exitCode"] != 0 || resMap["output"] != "hello-valet" {
		t.Fatalf("unexpected kernel bash output: %+v", resMap)
	}

	if _, err := svc.handleSidecarHostRequest(
		context.Background(),
		"host.kernel.bash",
		json.RawMessage(`{"command":"cat ~/.ssh/id_rsa"}`),
	); err == nil || !strings.Contains(err.Error(), "安全边界拒绝") {
		t.Fatalf("expected forbidden kernel bash command to be rejected, got: %v", err)
	}
}

func TestQuoteItemToChatAndResolve(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	downloadsDir := filepath.Join(homeDir, "Downloads")
	if err := os.MkdirAll(downloadsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	staleFile := filepath.Join(downloadsDir, "stale-archive.dmg")
	if err := os.WriteFile(staleFile, make([]byte, 4096), 0o644); err != nil {
		t.Fatal(err)
	}

	svc := NewService()
	if err := svc.start(StartOptions{
		HomeDir:      homeDir,
		DataDir:      dataDir,
		DesktopReady: false,
		UseVaultOnly: true,
	}); err != nil {
		t.Fatalf("svc.start failed: %v", err)
	}
	defer func() {
		if err := svc.close(); err != nil {
			t.Errorf("close error: %v", err)
		}
	}()

	svc.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences.AutonomyLevel = "full_access"
		st.TimelineEvents = []types.TimelineEvent{
			{
				ID:          "evt-q1",
				Timestamp:   time.Now().Format(time.RFC3339),
				TimeLabel:   "12:00",
				DayGroup:    "today",
				Title:       "清理过期磁盘镜像 stale-archive.dmg",
				Summary:     "检测到闲置镜像，等待确认移入废纸篓。",
				PluginID:    "disk-guard",
				PluginName:  "磁盘守卫",
				PluginBadge: "磁盘守卫",
				EventCode:   "disk.large_file",
				Status:      "pending_confirm",
				Payload:     map[string]any{"path": staleFile},
				Reasoning:   "超过 90 天未打开。",
				ActionItems: []types.TimelineActionItem{
					{
						ID:        "act-q1",
						Label:     "stale-archive.dmg",
						Path:      staleFile,
						SizeMB:    1,
						SizeLabel: "4 KB",
						Checked:   true,
					},
				},
			},
			{
				ID:          "evt-q2",
				Timestamp:   time.Now().Format(time.RFC3339),
				TimeLabel:   "11:50",
				DayGroup:    "today",
				Title:       "时间线待确认提醒",
				Summary:     "等待确认或忽略。",
				PluginID:    "disk-guard",
				PluginName:  "磁盘守卫",
				PluginBadge: "磁盘守卫",
				EventCode:   "disk.cache_bloat",
				Status:      "pending_confirm",
				Payload:     map[string]any{},
				Reasoning:   "缓存占用提醒。",
				ActionItems: []types.TimelineActionItem{},
			},
		}
		st.InboxItems = []types.InboxApprovalItem{
			{
				ID:                    "inbox-q1",
				Timestamp:             time.Now().Format(time.RFC3339),
				TimeLabel:             "12:00",
				Category:              "files",
				IconKind:              "disk",
				Title:                 "清理过期磁盘镜像 stale-archive.dmg",
				Summary:               "检测到闲置镜像，建议移入废纸篓（7 天可还原）。",
				PluginID:              "disk-guard",
				PluginName:            "磁盘守卫",
				PluginBadge:           "磁盘守卫",
				EventCode:             "disk.large_file",
				Reversible7d:          true,
				ReclaimableGB:         0.1,
				ApproveLabel:          "移入废纸篓",
				DismissLabel:          "忽略",
				Status:                "pending",
				LinkedTimelineEventID: "evt-q1",
				ToolName:              "trash_files",
				Payload:               map[string]any{"path": staleFile},
				Reasoning:             "超过 90 天未打开。",
				ActionItems: []types.TimelineActionItem{
					{
						ID:        "act-q1",
						Label:     "stale-archive.dmg",
						Path:      staleFile,
						SizeMB:    1,
						SizeLabel: "4 KB",
						Checked:   true,
					},
				},
			},
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	quoteAtt := types.ChatAttachment{
		ID:          "quote-inbox-inbox-q1",
		Kind:        "inbox_item",
		RefID:       "inbox-q1",
		Badge:       "收件箱",
		Name:        "清理过期磁盘镜像 stale-archive.dmg",
		Meta:        "磁盘守卫 · disk.large_file · 待批准",
		TextExcerpt: "- 来源：收件箱待批/审批记录\n- inboxId：inbox-q1\n- 摘要：检测到闲置镜像，建议移入废纸篓。",
	}

	// 1. Ask a follow-up question referencing inbox-q1: attachment persists and item stays pending.
	askRes, err := svc.SendChatMessage(ctx, types.SendChatParams{
		ChatID:      "chat-default",
		Prompt:      "为什么建议清理这个文件？有什么风险？",
		Model:       "claude-opus-4",
		Attachments: []types.ChatAttachment{quoteAtt},
		Interactive: true,
	})
	if err != nil {
		t.Fatalf("SendChatMessage(ask) failed: %v", err)
	}
	if !strings.Contains(askRes.ReplyMessage.Content, "清理过期磁盘镜像") {
		t.Fatalf("expected reply to reference quoted item title, got: %s", askRes.ReplyMessage.Content)
	}

	snapAfterAsk, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot failed: %v", err)
	}
	if snapAfterAsk.InboxItems[0].Status != "pending" || snapAfterAsk.TimelineEvents[0].Status != "pending_confirm" {
		t.Fatalf("expected inbox-q1/evt-q1 to remain pending after question, got inbox=%s evt=%s",
			snapAfterAsk.InboxItems[0].Status, snapAfterAsk.TimelineEvents[0].Status)
	}
	var savedUserMsg *types.ChatMessage
	for _, th := range snapAfterAsk.ChatThreads {
		if th.ID == "chat-default" {
			for i := range th.Messages {
				if th.Messages[i].Role == "user" {
					savedUserMsg = &th.Messages[i]
					break
				}
			}
		}
	}
	if savedUserMsg == nil || len(savedUserMsg.Attachments) != 1 ||
		savedUserMsg.Attachments[0].Kind != "inbox_item" ||
		savedUserMsg.Attachments[0].RefID != "inbox-q1" {
		t.Fatalf("expected persisted user quote attachment, got: %+v", savedUserMsg)
	}

	// 2. Ask agent to approve and execute the quoted item via item_resolve -> host.item.resolve.
	approveRes, err := svc.SendChatMessage(ctx, types.SendChatParams{
		ChatID:      "chat-default",
		Prompt:      "确认没有问题，请帮我直接批准执行",
		Model:       "claude-opus-4",
		Attachments: []types.ChatAttachment{quoteAtt},
		Interactive: true,
	})
	if err != nil {
		t.Fatalf("SendChatMessage(approve) failed: %v", err)
	}
	if !strings.Contains(approveRes.ReplyMessage.Content, "已批准并执行") {
		t.Fatalf("expected approval confirmation in reply, got: %s", approveRes.ReplyMessage.Content)
	}

	snapAfterApprove, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot failed: %v", err)
	}
	if snapAfterApprove.InboxItems[0].Status != "approved" {
		t.Fatalf("expected inbox-q1 status=approved, got %s", snapAfterApprove.InboxItems[0].Status)
	}
	if snapAfterApprove.TimelineEvents[0].Status != "completed" {
		t.Fatalf("expected evt-q1 status=completed, got %s", snapAfterApprove.TimelineEvents[0].Status)
	}
	if _, statErr := os.Stat(staleFile); !os.IsNotExist(statErr) {
		t.Fatalf("expected %s moved to vault after approval, statErr=%v", staleFile, statErr)
	}

	// 3. Also verify timeline quote ignore via chat -> item_resolve -> host.item.resolve.
	timelineQuote := types.ChatAttachment{
		ID:          "quote-timeline-evt-q2",
		Kind:        "timeline_event",
		RefID:       "evt-q2",
		Badge:       "时间线",
		Name:        "时间线待确认提醒",
		Meta:        "磁盘守卫 · disk.cache_bloat · 待确认",
		TextExcerpt: "- 来源：时间线事件\n- eventId：evt-q2\n- 摘要：等待确认或忽略。",
	}
	if _, err := svc.SendChatMessage(ctx, types.SendChatParams{
		ChatID:      "chat-default",
		Prompt:      "这个先忽略保留",
		Model:       "claude-opus-4",
		Attachments: []types.ChatAttachment{timelineQuote},
		Interactive: true,
	}); err != nil {
		t.Fatalf("SendChatMessage(ignore timeline) failed: %v", err)
	}
	snapAfterIgnore, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot failed: %v", err)
	}
	if snapAfterIgnore.TimelineEvents[1].Status != "completed" || !snapAfterIgnore.TimelineEvents[1].Ignored {
		t.Fatalf("expected evt-q2 completed+ignored, got status=%s ignored=%v",
			snapAfterIgnore.TimelineEvents[1].Status, snapAfterIgnore.TimelineEvents[1].Ignored)
	}
}

func TestUserQuestionInboxNormalizationAndAnswer(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	if err := os.MkdirAll(homeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// 1. Seed a legacy persisted snapshot containing a user.question card with Reversible7d=true
	initialStore, err := store.OpenWithOptions(dataDir, homeDir, false)
	if err != nil {
		t.Fatalf("initial store.OpenWithOptions failed: %v", err)
	}
	nowTS := time.Now().Format(time.RFC3339)
	initialStore.Update(func(st *types.ValetSnapshot) {
		st.TimelineEvents = append([]types.TimelineEvent{
			{
				ID:          "evt-uq-legacy",
				Timestamp:   nowTS,
				TimeLabel:   "12:30",
				DayGroup:    "today",
				Title:       "是否添加 ntp-server？",
				Summary:     "等待用户选择",
				PluginID:    "surge-doctor",
				PluginName:  "Surge 诊断",
				PluginBadge: "Surge 诊断",
				EventCode:   "user.question",
				Status:      "pending_confirm",
				Payload: map[string]any{
					"question": "是否添加 ntp-server？",
					"options":  []any{"好，添加并重载", "先不动，继续观察"},
				},
				Reasoning:   "备选方案：好，添加并重载 / 先不动，继续观察",
				ActionItems: []types.TimelineActionItem{},
			},
			{
				ID:          "evt-uq-approve",
				Timestamp:   nowTS,
				TimeLabel:   "12:31",
				DayGroup:    "today",
				Title:       "是否刷新 DNS？",
				Summary:     "等待用户选择",
				PluginID:    "surge-doctor",
				PluginName:  "Surge 诊断",
				PluginBadge: "Surge 诊断",
				EventCode:   "user.question",
				Status:      "pending_confirm",
				Payload: map[string]any{
					"question": "是否刷新 DNS？",
					"options":  []any{"立即刷新", "暂不处理"},
				},
				Reasoning:   "备选方案：立即刷新 / 暂不处理",
				ActionItems: []types.TimelineActionItem{},
			},
		}, st.TimelineEvents...)

		st.InboxItems = append([]types.InboxApprovalItem{
			{
				ID:                    "inbox-uq-legacy",
				Timestamp:             nowTS,
				TimeLabel:             "12:30",
				Category:              "outbound",
				IconKind:              "mail",
				Title:                 "是否添加 ntp-server？",
				Summary:               "等待用户选择",
				PluginID:              "surge-doctor",
				PluginName:            "Surge 诊断",
				PluginBadge:           "Surge 诊断",
				EventCode:             "user.question",
				Reversible7d:          true,
				ApproveLabel:          "已知晓",
				DismissLabel:          "忽略",
				Status:                "pending",
				LinkedTimelineEventID: "evt-uq-legacy",
				ToolName:              "ask_user",
				ToolArgs: map[string]any{
					"question": "是否添加 ntp-server？",
					"options":  []any{"好，添加并重载", "先不动，继续观察"},
				},
				Payload: map[string]any{
					"question": "是否添加 ntp-server？",
					"options":  []any{"好，添加并重载", "先不动，继续观察"},
				},
				Reasoning:   "备选方案：好，添加并重载 / 先不动，继续观察",
				ActionItems: []types.TimelineActionItem{},
			},
			{
				ID:                    "inbox-uq-approve",
				Timestamp:             nowTS,
				TimeLabel:             "12:31",
				Category:              "outbound",
				IconKind:              "mail",
				Title:                 "是否刷新 DNS？",
				Summary:               "等待用户选择",
				PluginID:              "surge-doctor",
				PluginName:            "Surge 诊断",
				PluginBadge:           "Surge 诊断",
				EventCode:             "user.question",
				Reversible7d:          true,
				ApproveLabel:          "已知晓",
				DismissLabel:          "忽略",
				Status:                "pending",
				LinkedTimelineEventID: "evt-uq-approve",
				ToolName:              "ask_user",
				ToolArgs: map[string]any{
					"question": "是否刷新 DNS？",
					"options":  []any{"立即刷新", "暂不处理"},
				},
				Payload: map[string]any{
					"question": "是否刷新 DNS？",
					"options":  []any{"立即刷新", "暂不处理"},
				},
				Reasoning:   "备选方案：立即刷新 / 暂不处理",
				ActionItems: []types.TimelineActionItem{},
			},
		}, st.InboxItems...)
	})

	// Reopen from disk and confirm normalizeLoadedSnapshot fixed Reversible7d and Options
	reopened, err := store.OpenWithOptions(dataDir, homeDir, false)
	if err != nil {
		t.Fatalf("reopen store failed: %v", err)
	}
	reopenedSnap := reopened.Snapshot()
	if reopenedSnap.InboxItems[0].Reversible7d {
		t.Fatalf("expected user.question item normalized to Reversible7d=false")
	}
	if len(reopenedSnap.InboxItems[0].Options) != 2 || reopenedSnap.InboxItems[0].Options[0] != "好，添加并重载" {
		t.Fatalf("expected normalized Options on legacy user.question item, got %+v", reopenedSnap.InboxItems[0].Options)
	}

	// 2. Start Service and verify ApproveAllReversible skips user.question cards
	svc := NewService()
	if err := svc.start(StartOptions{
		HomeDir:      homeDir,
		DataDir:      dataDir,
		DesktopReady: false,
		UseVaultOnly: true,
	}); err != nil {
		t.Fatalf("svc.start failed: %v", err)
	}
	defer func() {
		if err := svc.close(); err != nil {
			t.Errorf("close error: %v", err)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	afterBatch, err := svc.ApproveAllReversible(ctx)
	if err != nil {
		t.Fatalf("ApproveAllReversible failed: %v", err)
	}
	for _, it := range afterBatch.InboxItems {
		if it.EventCode == "user.question" && it.Status != "pending" {
			t.Fatalf("expected ApproveAllReversible to skip user.question %s, got status=%s", it.ID, it.Status)
		}
	}

	// 3. ApproveInboxItem on a user.question item routes to AnswerInboxQuestion without creating duplicate cards
	afterApprove, err := svc.ApproveInboxItem(ctx, "inbox-uq-approve")
	if err != nil {
		t.Fatalf("ApproveInboxItem(inbox-uq-approve) failed: %v", err)
	}
	var approvedItem *types.InboxApprovalItem
	for i := range afterApprove.InboxItems {
		if afterApprove.InboxItems[i].ID == "inbox-uq-approve" {
			approvedItem = &afterApprove.InboxItems[i]
			break
		}
	}
	if approvedItem == nil || approvedItem.Status != "approved" || approvedItem.SelectedOption != "立即刷新" || approvedItem.Reversible7d {
		t.Fatalf("unexpected approved user.question item state: %+v", approvedItem)
	}

	// 4. AnswerInboxQuestion records explicit chosen option and marks linked timeline event completed without CanRestore
	beforeCount := len(afterApprove.InboxItems)
	afterAnswer, err := svc.AnswerInboxQuestion(ctx, "inbox-uq-legacy", "先不动，继续观察")
	if err != nil {
		t.Fatalf("AnswerInboxQuestion failed: %v", err)
	}
	if len(afterAnswer.InboxItems) != beforeCount {
		t.Fatalf("expected no duplicate Inbox item queued on AnswerInboxQuestion, before=%d after=%d", beforeCount, len(afterAnswer.InboxItems))
	}
	var legacyItem *types.InboxApprovalItem
	for i := range afterAnswer.InboxItems {
		if afterAnswer.InboxItems[i].ID == "inbox-uq-legacy" {
			legacyItem = &afterAnswer.InboxItems[i]
			break
		}
	}
	if legacyItem == nil || legacyItem.Status != "approved" || legacyItem.SelectedOption != "先不动，继续观察" || legacyItem.Reversible7d {
		t.Fatalf("unexpected answered user.question item: %+v", legacyItem)
	}
	var linkedEvt *types.TimelineEvent
	for i := range afterAnswer.TimelineEvents {
		if afterAnswer.TimelineEvents[i].ID == "evt-uq-legacy" {
			linkedEvt = &afterAnswer.TimelineEvents[i]
			break
		}
	}
	if linkedEvt == nil || linkedEvt.Status != "completed" || linkedEvt.CanRestore || !strings.Contains(linkedEvt.Summary, "先不动，继续观察") {
		t.Fatalf("unexpected linked timeline event after AnswerInboxQuestion: %+v", linkedEvt)
	}
}

func TestConfigureServicePreservesChatStreamCallbackOnEarlyEnsureStarted(t *testing.T) {
	tmp := t.TempDir()
	dataDir := filepath.Join(tmp, "data")
	homeDir := filepath.Join(tmp, "home")
	_ = os.MkdirAll(homeDir, 0o755)

	var (
		mu       sync.Mutex
		received []types.ChatStreamPayload
	)

	svc := NewService()
	opts := StartOptions{
		DataDir:      dataDir,
		HomeDir:      homeDir,
		DesktopReady: false,
		UseVaultOnly: true,
		OnChatStream: func(p types.ChatStreamPayload) {
			mu.Lock()
			received = append(received, p)
			mu.Unlock()
		},
	}

	// Simulate main.go calling ConfigureService synchronously before WebView calls GetSnapshot()
	// while StartService runs in a background goroutine.
	ConfigureService(svc, opts)
	if _, err := svc.GetSnapshot(); err != nil {
		t.Fatalf("GetSnapshot failed: %v", err)
	}
	defer func() { _ = CloseService(svc) }()

	if err := StartService(svc, opts); err != nil {
		t.Fatalf("StartService failed: %v", err)
	}

	svc.handleSidecarNotify("host.chatStream", json.RawMessage(`{"chatId":"chat-1","phase":"streaming","partialText":"hello"}`))

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 || received[0].ChatID != "chat-1" || received[0].PartialText != "hello" {
		t.Fatalf("expected chatStream callback to receive payload after early ensureStarted, got %+v", received)
	}
}

func TestAlwaysOnInboxTimerOutboxEndToEnd(t *testing.T) {
	tmp := t.TempDir()
	repoRoot, err := filepath.Abs("../..")
	if err != nil {
		t.Fatalf("resolve repoRoot failed: %v", err)
	}

	svc := NewService()
	if err := StartService(svc, StartOptions{
		DataDir:      filepath.Join(tmp, "data"),
		HomeDir:      filepath.Join(tmp, "home"),
		RepoRoot:     repoRoot,
		DesktopReady: false,
		UseVaultOnly: true,
	}); err != nil {
		t.Fatalf("StartService failed: %v", err)
	}
	defer CloseService(svc)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// 1. Create and cancel a durable Always-On timer
	delay := 120.0
	timer, err := svc.CreateAlwaysOnTimer(ctx, types.CreateAlwaysOnTimerParams{
		Kind:         "follow_up",
		Label:        "巡检构建队列",
		Payload:      "核实 CI 构建状态",
		DelaySeconds: &delay,
	})
	if err != nil {
		t.Fatalf("CreateAlwaysOnTimer failed: %v", err)
	}
	if timer.Status != "armed" || timer.Kind != "follow_up" {
		t.Fatalf("unexpected timer state: %+v", timer)
	}

	snap1, err := svc.GetAlwaysOnSnapshot(ctx)
	if err != nil {
		t.Fatalf("GetAlwaysOnSnapshot failed: %v", err)
	}
	if snap1.Stats.TimersArmed != 1 {
		t.Fatalf("expected 1 armed timer, got %d", snap1.Stats.TimersArmed)
	}

	cancelled, err := svc.CancelAlwaysOnTimer(ctx, timer.ID)
	if err != nil || cancelled == nil || cancelled.Status != "cancelled" {
		t.Fatalf("CancelAlwaysOnTimer failed: %v, %+v", err, cancelled)
	}

	// 2. Install a webhook plugin and verify async webhook POST ingests into Always-On Inbox with deduplication & tainting
	valetSnap, err := svc.InstallCustomPlugin(types.InstallCustomPluginParams{
		Name:    "AlwaysOn Webhook",
		Tagline: "测试合批与去重",
		YAML: `id: local.valet.alwayson-hook
name: AlwaysOn Webhook
version: 0.1.0
triggers:
  - id: deploy.alert
    sensor: webhook
    policy: auto
`,
		SkillMarkdown: "收到部署告警后按需汇总。",
	})
	if err != nil {
		t.Fatalf("InstallCustomPlugin failed: %v", err)
	}
	var pluginID string
	for _, p := range valetSnap.Plugins {
		if p.Name == "AlwaysOn Webhook" {
			pluginID = p.ID
			break
		}
	}
	if pluginID == "" {
		t.Fatalf("installed webhook plugin not found")
	}

	hookURL := valetSnap.Preferences.PluginRuntime.WebhookEndpoint + "/" + pluginID + "/deploy.alert"
	postEvent := func(eventID, body string) {
		req, _ := http.NewRequest(http.MethodPost, hookURL, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Event-Id", eventID)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("POST webhook failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusAccepted {
			t.Fatalf("expected 202 Accepted, got %d", resp.StatusCode)
		}
	}

	// Send 2 distinct events + 1 duplicate X-Event-Id inside the 1500ms debounce window
	postEvent("wh-dedupe-1", `{"service":"api","status":"down"}`)
	postEvent("wh-dedupe-1", `{"service":"api","status":"down"}`)
	postEvent("wh-dedupe-2", `{"service":"worker","status":"down"}`)

	// Wait briefly for async goroutines to finish calling alwaysOn.ingest
	deadline := time.Now().Add(5 * time.Second)
	var snapAfter types.AlwaysOnSnapshot
	for time.Now().Before(deadline) {
		snapAfter, err = svc.GetAlwaysOnSnapshot(ctx)
		if err == nil && snapAfter.Stats.InboxTotal >= 2 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if snapAfter.Stats.InboxTotal != 2 {
		t.Fatalf("expected exactly 2 deduplicated inbox items, got %d (%+v)", snapAfter.Stats.InboxTotal, snapAfter.Inbox)
	}
	for _, item := range snapAfter.Inbox {
		if item.Trusted {
			t.Fatalf("expected webhook inbox item to be untrusted (tainted), got %+v", item)
		}
		if item.Source != "webhook" {
			t.Fatalf("expected source=webhook, got %q", item.Source)
		}
	}
}

func TestTimelineEventNotificationsAndCommandFiltering(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	if err := os.MkdirAll(homeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("store.Open failed: %v", err)
	}

	type notifyCall struct {
		kind, title, subtitle, body string
	}
	var calls []notifyCall
	svc := &Service{
		store:        st,
		createdInbox: make(map[string]types.InboxApprovalItem),
		createdEvent: make(map[string]types.TimelineEvent),
		opts: StartOptions{
			OnNotify: func(kind, title, subtitle, body string) {
				calls = append(calls, notifyCall{kind: kind, title: title, subtitle: subtitle, body: body})
			},
		},
	}

	ctx := context.Background()

	// 1. valet-core system.command must be filtered at runtime and never trigger desktop notifications
	cmdRaw, _ := json.Marshal(sidecar.RecordTimelineRequest{
		PluginID:   "valet-core",
		PluginName: "Valet Core",
		EventCode:  "system.command",
		Title:      "已执行命令：T=secret curl /api/config",
		Summary:    "exit=0",
		Status:     "completed",
	})
	if _, err := svc.handleSidecarHostRequest(ctx, "host.recordTimelineEvent", cmdRaw); err != nil {
		t.Fatalf("handleSidecarHostRequest(system.command) failed: %v", err)
	}
	if len(st.Snapshot().TimelineEvents) != 0 {
		t.Fatalf("expected system.command to be skipped from TimelineEvents, got %+v", st.Snapshot().TimelineEvents)
	}
	if len(calls) != 0 {
		t.Fatalf("expected no desktop notification for system.command, got %+v", calls)
	}

	// 2. Completed timeline events write to TimelineEvents but do NOT pop desktop notifications
	fsRaw, _ := json.Marshal(sidecar.RecordTimelineRequest{
		PluginID:   "valet-core",
		PluginName: "Valet Core",
		EventCode:  "fs.modified",
		Title:      "写入文件：/tmp/demo.txt",
		Summary:    "写入 12 字节",
		Status:     "completed",
	})
	if _, err := svc.handleSidecarHostRequest(ctx, "host.recordTimelineEvent", fsRaw); err != nil {
		t.Fatalf("handleSidecarHostRequest(fs.modified completed) failed: %v", err)
	}
	if len(st.Snapshot().TimelineEvents) != 1 {
		t.Fatalf("expected 1 TimelineEvent after fs.modified, got %d", len(st.Snapshot().TimelineEvents))
	}
	if len(calls) != 0 {
		t.Fatalf("expected no desktop notification for completed timeline event, got %+v", calls)
	}

	// 3. Failed timeline events respect NotifyOnFailure
	failRaw, _ := json.Marshal(sidecar.RecordTimelineRequest{
		PluginID:   "valet-core",
		PluginName: "Valet Core",
		EventCode:  "fs.modified",
		Title:      "写入失败",
		Summary:    "permission denied",
		Status:     "failed",
	})
	if _, err := svc.handleSidecarHostRequest(ctx, "host.recordTimelineEvent", failRaw); err != nil {
		t.Fatalf("handleSidecarHostRequest(fs.modified failed off) failed: %v", err)
	}
	if len(calls) != 0 {
		t.Fatalf("expected no fail notification while NotifyOnFailure=false, got %+v", calls)
	}

	st.Update(func(snap *types.ValetSnapshot) {
		snap.Preferences.NotifyOnFailure = true
	})
	if _, err := svc.handleSidecarHostRequest(ctx, "host.recordTimelineEvent", failRaw); err != nil {
		t.Fatalf("handleSidecarHostRequest(fs.modified failed on) failed: %v", err)
	}
	if len(calls) != 1 || calls[0].kind != "fail" {
		t.Fatalf("expected 1 fail notification when NotifyOnFailure=true, got %+v", calls)
	}

	// 4. Proactive Outbox notifications follow NotifyOnComplete while still recording timeline entry
	calls = nil
	svc.handleAlwaysOnOutboxNotify(sidecar.AlwaysOnOutboxNotifyPayload{
		Level: "info",
		Message: types.AlwaysOnOutboxMessage{
			ID:    "outbox-1",
			Kind:  "message",
			Title: "后台巡检完成",
			Body:  "发现 1 项需关注变更",
		},
	})
	if len(calls) != 1 || calls[0].kind != "info" || calls[0].title != "后台巡检完成" {
		t.Fatalf("expected 1 outbox notification when NotifyOnComplete=true, got %+v", calls)
	}

	st.Update(func(snap *types.ValetSnapshot) {
		snap.Preferences.NotifyOnComplete = false
	})
	svc.handleAlwaysOnOutboxNotify(sidecar.AlwaysOnOutboxNotifyPayload{
		Level: "info",
		Message: types.AlwaysOnOutboxMessage{
			ID:    "outbox-2",
			Kind:  "message",
			Title: "静默汇报",
			Body:  "仅记录时间线",
		},
	})
	if len(calls) != 1 {
		t.Fatalf("expected no outbox notification when NotifyOnComplete=false, got %+v", calls)
	}
	if len(st.Snapshot().TimelineEvents) != 5 {
		t.Fatalf("expected 5 TimelineEvents total, got %d", len(st.Snapshot().TimelineEvents))
	}
}
