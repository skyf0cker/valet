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

func TestStorePersistsProjectPagesAndNormalizesHierarchy(t *testing.T) {
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
			ID:        "proj-pages",
			Title:     "多页面项目",
			Icon:      "book",
			Tags:      []string{},
			Blocks:    []types.NotebookBlock{{ID: "root-b1", Type: "paragraph", Content: "[[page:pg-a]]"}},
			Pages: []types.ProjectPage{
				{
					ID:        "pg-a",
					Title:     "页面 A",
					Blocks:    []types.NotebookBlock{{ID: "a1", Type: "bullet", Content: "顶层条目", Indent: 3}},
					UpdatedAt: "刚刚",
					CreatedAt: "2026-11-21",
				},
				{
					ID:           "pg-b",
					ParentPageID: "pg-a",
					Title:        "页面 B",
					Blocks: []types.NotebookBlock{
						{ID: "b1", Type: "bullet", Content: "嵌套条目", Indent: 99},
						{ID: "b2", Type: "page_ref", PageID: "pg-a", Content: "页面 A"},
					},
					UpdatedAt: "刚刚",
					CreatedAt: "2026-11-21",
				},
				{
					ID:        "pg-a",
					Title:     "重复 A（应去重）",
					Blocks:    []types.NotebookBlock{},
					UpdatedAt: "刚刚",
					CreatedAt: "2026-11-21",
				},
				{
					ID:           "pg-orphan",
					ParentPageID: "pg-nonexistent",
					Title:        "孤儿父节点",
					Blocks:       []types.NotebookBlock{},
					UpdatedAt:    "刚刚",
					CreatedAt:    "2026-11-21",
				},
				{
					ID:           "pg-cycle-1",
					ParentPageID: "pg-cycle-2",
					Title:        "环 1",
					Blocks:       []types.NotebookBlock{},
					UpdatedAt:    "刚刚",
					CreatedAt:    "2026-11-21",
				},
				{
					ID:           "pg-cycle-2",
					ParentPageID: "pg-cycle-1",
					Title:        "环 2",
					Blocks:       []types.NotebookBlock{},
					UpdatedAt:    "刚刚",
					CreatedAt:    "2026-11-21",
				},
			},
			UpdatedAt: "刚刚",
			CreatedAt: "2026-11-21",
		})
		snap.ChatThreads = append(snap.ChatThreads, types.ChatThread{
			ID:             "chat-subpage",
			ProjectID:      "proj-pages",
			OriginPageID:   "pg-b",
			OriginBlockID:  "b1",
			Title:          "子页面讨论",
			Model:          "claude-opus-4",
			LinkedEventIDs: []string{},
			Messages:       []types.ChatMessage{},
		})
		snap.ActiveProjectID = "proj-pages"
		snap.ActiveProjectTab = "page"
		snap.ActivePageID = "pg-b"
	})

	reopened, err := Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("reopen failed: %v", err)
	}
	snap := reopened.Snapshot()
	if snap.ActiveProjectID != "proj-pages" || snap.ActiveProjectTab != "page" || snap.ActivePageID != "pg-b" {
		t.Fatalf("expected active page preserved on reopen, got project=%q tab=%q page=%q",
			snap.ActiveProjectID, snap.ActiveProjectTab, snap.ActivePageID)
	}

	var proj *types.Project
	for i := range snap.Projects {
		if snap.Projects[i].ID == "proj-pages" {
			p := snap.Projects[i]
			proj = &p
			break
		}
	}
	if proj == nil {
		t.Fatalf("expected proj-pages persisted")
	}
	if len(proj.Pages) != 5 {
		t.Fatalf("expected 5 deduplicated pages, got %d: %+v", len(proj.Pages), proj.Pages)
	}
	byID := map[string]types.ProjectPage{}
	for _, pg := range proj.Pages {
		byID[pg.ID] = pg
	}
	if byID["pg-b"].ParentPageID != "pg-a" ||
		len(byID["pg-b"].Blocks) != 2 ||
		byID["pg-b"].Blocks[0].Indent != MaxNotebookBlockIndent ||
		byID["pg-b"].Blocks[1].Type != "page_ref" ||
		byID["pg-b"].Blocks[1].PageID != "pg-a" {
		t.Fatalf("unexpected pg-b after reopen: %+v", byID["pg-b"])
	}
	if byID["pg-orphan"].ParentPageID != "" {
		t.Fatalf("expected orphaned parent cleared, got %q", byID["pg-orphan"].ParentPageID)
	}
	if byID["pg-cycle-1"].ParentPageID == "pg-cycle-2" && byID["pg-cycle-2"].ParentPageID == "pg-cycle-1" {
		t.Fatalf("expected cycle broken between pg-cycle-1 and pg-cycle-2")
	}

	var foundThread *types.ChatThread
	for i := range snap.ChatThreads {
		if snap.ChatThreads[i].ID == "chat-subpage" {
			th := snap.ChatThreads[i]
			foundThread = &th
			break
		}
	}
	if foundThread == nil || foundThread.OriginPageID != "pg-b" {
		t.Fatalf("expected chat OriginPageID preserved, got %+v", foundThread)
	}

	// Missing ActivePageID must fall back cleanly to notebook tab
	reopened.Update(func(s *types.ValetSnapshot) {
		s.ActiveProjectTab = "page"
		s.ActivePageID = "pg-missing"
	})
	fallbackSnap := reopened.Snapshot()
	if fallbackSnap.ActiveProjectTab != "notebook" || fallbackSnap.ActivePageID != "" {
		t.Fatalf("expected fallback to notebook tab when ActivePageID missing, got tab=%q page=%q",
			fallbackSnap.ActiveProjectTab, fallbackSnap.ActivePageID)
	}
}

func TestStoreCoalescesLegacyTableParagraphBlocks(t *testing.T) {
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
			ID:    "proj-tbl",
			Title: "表格迁移项目",
			Icon:  "book",
			Tags:  []string{},
			Blocks: []types.NotebookBlock{
				{ID: "hdr-root", Type: "paragraph", Content: "| 维度 | AOA | Super Agent |"},
				{ID: "blank-1", Type: "paragraph", Content: ""},
				{ID: "delim-root", Type: "paragraph", Content: "|---|---|---|"},
				{ID: "blank-2", Type: "paragraph", Content: ""},
				{ID: "row-1", Type: "paragraph", Content: "| 核心动作 | 搬到后台 | 收敛入口 |"},
				{ID: "prose-pipe", Type: "paragraph", Content: "两条路都在做同一件事 | 互不冲突。"},
			},
			Pages: []types.ProjectPage{
				{
					ID:    "pg-tbl",
					Title: "对比页",
					Blocks: []types.NotebookBlock{
						{ID: "hdr-page", Type: "paragraph", Content: "| K | V |"},
						{ID: "delim-page", Type: "paragraph", Content: "| :--- | ---: |"},
						{ID: "row-page", Type: "paragraph", Content: "| 性能 | 100ms |"},
					},
					UpdatedAt: "刚刚",
					CreatedAt: "2026-11-21",
				},
			},
			UpdatedAt: "刚刚",
			CreatedAt: "2026-11-21",
		})
	})

	reopened, err := Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("reopen failed: %v", err)
	}
	snap := reopened.Snapshot()
	var proj *types.Project
	for i := range snap.Projects {
		if snap.Projects[i].ID == "proj-tbl" {
			p := snap.Projects[i]
			proj = &p
			break
		}
	}
	if proj == nil {
		t.Fatalf("expected proj-tbl persisted")
	}
	if len(proj.Blocks) != 2 ||
		proj.Blocks[0].ID != "hdr-root" ||
		proj.Blocks[0].Type != "table" ||
		proj.Blocks[1].ID != "prose-pipe" ||
		proj.Blocks[1].Type != "paragraph" {
		t.Fatalf("expected root table coalesced cleanly with prose untouched, got %+v", proj.Blocks)
	}
	if len(proj.Pages) != 1 || len(proj.Pages[0].Blocks) != 1 ||
		proj.Pages[0].Blocks[0].ID != "hdr-page" ||
		proj.Pages[0].Blocks[0].Type != "table" {
		t.Fatalf("expected page table coalesced cleanly, got %+v", proj.Pages)
	}
}
