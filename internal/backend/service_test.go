package backend

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

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

	// Create a dummy large-like file and backdate its mtime > 95 days so ScanDisk detects it if >= threshold,
	// and verify reversible trash move & 7-day restore directly on disk.
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

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// 1. Live OS process sampling via /ps through Pi Durable Sidecar
	psRes, err := svc.SendChatMessage(ctx, types.SendChatParams{
		ChatID: "test-chat-ps",
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

	// 2. Plugin YAML draft via /plugin + InstallPluginDraft hot-reload
	pluginRes, err := svc.SendChatMessage(ctx, types.SendChatParams{
		ChatID: "test-chat-plugin",
		Prompt: "/plugin 帮我创建一个自动清理下载目录 .dmg 的插件",
		Model:  "claude-opus-4",
	})
	if err != nil {
		t.Fatalf("SendChatMessage(/plugin) failed: %v", err)
	}
	if pluginRes.ReplyMessage.PluginDraft == nil {
		t.Fatalf("expected pluginDraft card from plugin_draft_create tool")
	}
	snapAfterInstall, err := svc.InstallPluginDraft("test-chat-plugin", pluginRes.ReplyMessage.ID, *pluginRes.ReplyMessage.PluginDraft)
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
		ChatID: "test-chat-clean",
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

	// 4. Simulate plugin event routing through real Pi Durable Sidecar
	simRes, err := svc.SimulatePluginEvent(ctx, "process-sentinel", "process.cpu_spike")
	if err != nil {
		t.Fatalf("SimulatePluginEvent failed: %v", err)
	}
	if simRes.Event.ID == "" && !strings.Contains(simRes.Event.Title, "进程哨兵") {
		t.Fatalf("unexpected simulate result: %+v", simRes)
	}
}
