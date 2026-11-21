package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"valet/internal/types"
)

func TestStoreCleanSlateHasDefaultProject(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	_ = os.MkdirAll(homeDir, 0o755)

	st, err := Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	snap := st.Snapshot()

	if len(snap.Projects) == 0 {
		t.Fatalf("expected at least 1 seeded project, got 0")
	}
	defProj := snap.Projects[0]
	if defProj.ID != types.DefaultProjectID || !defProj.IsDefault {
		t.Fatalf("expected index 0 to be default project %q with IsDefault=true, got %+v", types.DefaultProjectID, defProj)
	}
	if len(defProj.Blocks) == 0 {
		t.Fatalf("expected non-empty default project blocks")
	}
	if snap.ActiveProjectID != types.DefaultProjectID {
		t.Fatalf("expected ActiveProjectID=%q, got %q", types.DefaultProjectID, snap.ActiveProjectID)
	}
	if len(snap.ChatThreads) == 0 || snap.ChatThreads[0].ProjectID != types.DefaultProjectID {
		t.Fatalf("expected seeded chat thread assigned to %q, got %+v", types.DefaultProjectID, snap.ChatThreads)
	}
}

func TestStoreMigratesLegacyChatStateToDefaultProject(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	_ = os.MkdirAll(homeDir, 0o755)
	_ = os.MkdirAll(dataDir, 0o755)

	// Legacy SchemaVersion 2 snapshot saved before Projects existed (ActiveView == "chat", no Projects, unassigned threads).
	legacy := NewSeedSnapshot(homeDir)
	legacy.Projects = nil
	legacy.ActiveProjectID = ""
	legacy.ActiveProjectTab = ""
	legacy.ActiveView = string(types.ViewChat)
	legacy.ChatThreads = []types.ChatThread{
		{ID: "chat-legacy-1", Title: "旧会话 1", Model: "claude-sonnet-4-5", LinkedEventIDs: []string{}, Messages: []types.ChatMessage{}},
		{ID: "chat-orphan", ProjectID: "proj-does-not-exist", Title: "孤立会话", Model: "claude-sonnet-4-5", LinkedEventIDs: []string{}, Messages: []types.ChatMessage{}},
	}
	raw, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "state.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	st, err := Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("Open legacy state failed: %v", err)
	}
	snap := st.Snapshot()

	if len(snap.Projects) != 1 || snap.Projects[0].ID != types.DefaultProjectID || !snap.Projects[0].IsDefault {
		t.Fatalf("expected default project pinned at index 0 after migration, got %+v", snap.Projects)
	}
	if snap.ActiveProjectID != types.DefaultProjectID {
		t.Fatalf("expected ActiveProjectID=%q, got %q", types.DefaultProjectID, snap.ActiveProjectID)
	}
	if snap.ActiveView != string(types.ViewProjects) {
		t.Fatalf("expected legacy ActiveView=chat normalized to %q, got %q", types.ViewProjects, snap.ActiveView)
	}
	if snap.ActiveProjectTab != "session" {
		t.Fatalf("expected ActiveProjectTab=session when migrating from chat view, got %q", snap.ActiveProjectTab)
	}
	for _, th := range snap.ChatThreads {
		if th.ProjectID != types.DefaultProjectID {
			t.Fatalf("expected thread %q reassigned to %q, got %q", th.ID, types.DefaultProjectID, th.ProjectID)
		}
	}
}

func TestStorePersistsProjectsAndNotebookBlocks(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	_ = os.MkdirAll(homeDir, 0o755)

	st, err := Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}

	st.Update(func(snap *types.ValetSnapshot) {
		snap.Projects = append(snap.Projects, types.Project{
			ID:          "proj-custom-1",
			Title:       "存储治理计划",
			Description: "定期清理大缓存",
			Icon:        "terminal",
			Tags:        []string{"磁盘", "自动化"},
			WorkingDir:  "~/Projects/valet",
			Blocks: []types.NotebookBlock{
				{ID: "b1", Type: "h1", Content: "目标清单", Indent: 2},
				{ID: "b2", Type: "todo", Content: "清理多余镜像", Checked: true, Indent: 1},
				{ID: "b2b", Type: "bullet", Content: "深层嵌套列表", Indent: 99},
				{ID: "b3", Type: "session_ref", SessionID: "chat-default", Content: "扫描结果"},
			},
			UpdatedAt: "刚刚",
			CreatedAt: "2026-11-20",
		})
	})

	reopened, err := Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("reopen failed: %v", err)
	}
	snap := reopened.Snapshot()
	if len(snap.Projects) != 2 {
		t.Fatalf("expected 2 persisted projects, got %d", len(snap.Projects))
	}
	custom := snap.Projects[1]
	if custom.ID != "proj-custom-1" || custom.WorkingDir != "~/Projects/valet" || len(custom.Tags) != 2 {
		t.Fatalf("unexpected custom project round-trip: %+v", custom)
	}
	if len(custom.Blocks) != 4 ||
		custom.Blocks[0].Indent != 0 ||
		custom.Blocks[1].Type != "todo" ||
		!custom.Blocks[1].Checked ||
		custom.Blocks[1].Indent != 1 ||
		custom.Blocks[2].Indent != MaxNotebookBlockIndent ||
		custom.Blocks[3].SessionID != "chat-default" {
		t.Fatalf("unexpected persisted Notebook blocks: %+v", custom.Blocks)
	}
}
