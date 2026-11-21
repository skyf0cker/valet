package backend

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"valet/internal/store"
	"valet/internal/types"
)

func TestParseNotebookMarkdownToBlocks(t *testing.T) {
	md := strings.Join([]string{
		"# 发布清单",
		"",
		"- 父级事项",
		"  - [ ] 子待办事项",
		"\t- [x] 已完成子项",
		"1. 第一步",
		"  1) 子步骤 A",
		"> [!note] 提示第一行",
		"> 提示第二行",
		"",
		"> 普通引用",
		"---",
		"```go",
		`fmt.Println("hi")`,
		"```",
	}, "\n")

	blocks := parseNotebookMarkdownToBlocks(md)
	if len(blocks) != 10 {
		t.Fatalf("expected 10 parsed blocks, got %d: %+v", len(blocks), blocks)
	}
	if blocks[0].Type != "h1" || blocks[0].Content != "发布清单" {
		t.Fatalf("unexpected h1 block: %+v", blocks[0])
	}
	if blocks[1].Type != "bullet" || blocks[1].Indent != 0 {
		t.Fatalf("unexpected root bullet block: %+v", blocks[1])
	}
	if blocks[2].Type != "todo" || blocks[2].Checked || blocks[2].Indent != 1 {
		t.Fatalf("unexpected nested todo block: %+v", blocks[2])
	}
	if blocks[3].Type != "todo" || !blocks[3].Checked || blocks[3].Indent != 1 {
		t.Fatalf("unexpected tab-indented done todo block: %+v", blocks[3])
	}
	if blocks[4].Type != "numbered" || blocks[4].Indent != 0 || blocks[5].Type != "numbered" || blocks[5].Indent != 1 {
		t.Fatalf("unexpected numbered blocks: %+v / %+v", blocks[4], blocks[5])
	}
	if blocks[6].Type != "callout" || blocks[6].Content != "提示第一行\n提示第二行" {
		t.Fatalf("unexpected callout block: %+v", blocks[6])
	}
	if blocks[7].Type != "quote" || blocks[7].Content != "普通引用" {
		t.Fatalf("unexpected quote block: %+v", blocks[7])
	}
	if blocks[8].Type != "divider" {
		t.Fatalf("expected divider block, got %+v", blocks[8])
	}
	if blocks[9].Type != "code" || blocks[9].Language != "go" || blocks[9].Content != `fmt.Println("hi")` {
		t.Fatalf("unexpected code block: %+v", blocks[9])
	}
	// Trailing empty line / unmatched check: wait - lines 0..14 had 15 lines -> 10 blocks!
}

func TestParseNotebookMarkdownToBlocksCountsAndClamps(t *testing.T) {
	md := "# Title\n        - Over-indented item\n  - Child under item\n"
	blocks := parseNotebookMarkdownToBlocks(md)
	if len(blocks) != 3 {
		t.Fatalf("expected 3 blocks, got %d", len(blocks))
	}
	// Item right below h1 must clamp indent to 0
	if blocks[1].Indent != 0 {
		t.Fatalf("expected item under h1 to clamp to indent 0, got %d", blocks[1].Indent)
	}
	// Item right below indent-0 bullet gets indent 1
	if blocks[2].Indent != 1 {
		t.Fatalf("expected child indent 1, got %d", blocks[2].Indent)
	}
}

func TestHostNotebookReadAndEditLifecycle(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")

	st, err := store.Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("store.Open failed: %v", err)
	}

	var mu sync.Mutex
	var stateScopes []string
	svc := NewService()
	svc.store = st
	svc.opts.HomeDir = homeDir
	svc.opts.DataDir = dataDir
	svc.opts.OnState = func(notice types.StateChangeNotice) {
		mu.Lock()
		stateScopes = append(stateScopes, notice.Scope)
		mu.Unlock()
	}

	// Set up a second custom project while ActiveProjectID remains on default project
	// to prove scoping follows the chat thread's ProjectID rather than ActiveProjectID.
	st.Update(func(snap *types.ValetSnapshot) {
		snap.ActiveProjectID = types.DefaultProjectID
		snap.Projects = append(snap.Projects, types.Project{
			ID:         "proj-notes",
			Title:      "调研笔记本",
			WorkingDir: "~/Projects/demo",
			Tags:       []string{"测试"},
			Blocks: []types.NotebookBlock{
				{ID: "blk-blank", Type: "paragraph", Content: ""},
			},
			UpdatedAt: "刚刚",
			CreatedAt: "2026-11-21",
		})
		snap.ChatThreads = append(snap.ChatThreads, types.ChatThread{
			ID:            "chat-proj-notes",
			ProjectID:     "proj-notes",
			Title:         "整理调研",
			Model:         "claude-opus-4",
			OriginBlockID: "blk-blank",
			UpdatedAt:     "刚刚",
		})
	})

	ctx := context.Background()

	// 1. Unknown chatId must fail safely
	if _, err := svc.handleSidecarHostRequest(ctx, "host.notebook.read", json.RawMessage(`{"chatId":"nonexistent"}`)); err == nil {
		t.Fatalf("expected error for unknown chatId")
	}

	// 2. Append replaces the sole blank placeholder paragraph cleanly
	appendResAny, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-proj-notes",
		"action": "append",
		"markdown": "# 目标规划\n- [ ] 拉取日志\n  - 检查 error.log\n- [ ] 输出总结"
	}`))
	if err != nil {
		t.Fatalf("append failed: %v", err)
	}
	appendRes := appendResAny.(map[string]any)
	if appendRes["projectId"] != "proj-notes" || appendRes["blockCount"] != 4 {
		t.Fatalf("unexpected append result: %+v", appendRes)
	}

	// 3. Read returns project blocks & formatted IDs
	readAny, err := svc.handleSidecarHostRequest(ctx, "host.notebook.read", json.RawMessage(`{"chatId":"chat-proj-notes"}`))
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	readRes := readAny.(map[string]any)
	blocks := readRes["blocks"].([]types.NotebookBlock)
	if len(blocks) != 4 || blocks[2].Indent != 1 {
		t.Fatalf("unexpected read blocks: %+v", blocks)
	}
	todo1ID := blocks[1].ID
	childID := blocks[2].ID
	todo2ID := blocks[3].ID

	// 4. update_block marks todo checked while preserving its content
	if _, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-proj-notes",
		"action": "update_block",
		"targetBlockId": "`+todo1ID+`",
		"checked": true
	}`)); err != nil {
		t.Fatalf("update_block failed: %v", err)
	}

	// 5. insert_after adds a code block after childID
	if _, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-proj-notes",
		"action": "insert_after",
		"targetBlockId": "`+childID+`",
		"markdown": "`+"```bash\\nls -la /tmp\\n```"+`"
	}`)); err != nil {
		t.Fatalf("insert_after failed: %v", err)
	}

	// 6. delete_blocks removes todo2ID via blockIds
	if _, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-proj-notes",
		"action": "delete_blocks",
		"blockIds": ["`+todo2ID+`"]
	}`)); err != nil {
		t.Fatalf("delete_blocks failed: %v", err)
	}

	// 7. Re-insert a session_ref manually, then test update_block rejection + replace_all preservation
	st.Update(func(snap *types.ValetSnapshot) {
		for i := range snap.Projects {
			if snap.Projects[i].ID == "proj-notes" {
				snap.Projects[i].Blocks = append(snap.Projects[i].Blocks, types.NotebookBlock{
					ID:        "blk-sess-ref",
					Type:      "session_ref",
					SessionID: "chat-proj-notes",
					Content:   "整理调研",
				})
			}
		}
	})

	if _, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-proj-notes",
		"action": "update_block",
		"targetBlockId": "blk-sess-ref",
		"content": "hacked"
	}`)); err == nil {
		t.Fatalf("expected error attempting to overwrite session_ref block")
	}

	replaceAllAny, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-proj-notes",
		"action": "replace_all",
		"markdown": "# 最终结论\n1. 已完成清理"
	}`))
	if err != nil {
		t.Fatalf("replace_all failed: %v", err)
	}
	replaceAllRes := replaceAllAny.(map[string]any)
	if replaceAllRes["blockCount"] != 3 {
		t.Fatalf("expected 2 parsed blocks + 1 preserved session_ref = 3, got %+v", replaceAllRes)
	}

	// Verify state change notifications fired with scope "projects"
	mu.Lock()
	scopesCopy := append([]string(nil), stateScopes...)
	mu.Unlock()
	if len(scopesCopy) == 0 || scopesCopy[len(scopesCopy)-1] != "projects" {
		t.Fatalf("expected projects state change emissions, got %+v", scopesCopy)
	}

	// Verify durability across store reopen
	reopened, err := store.Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("reopen failed: %v", err)
	}
	reSnap := reopened.Snapshot()
	var persisted *types.Project
	for i := range reSnap.Projects {
		if reSnap.Projects[i].ID == "proj-notes" {
			p := reSnap.Projects[i]
			persisted = &p
			break
		}
	}
	if persisted == nil || len(persisted.Blocks) != 3 ||
		persisted.Blocks[0].Content != "最终结论" ||
		persisted.Blocks[1].Type != "numbered" ||
		persisted.Blocks[2].Type != "session_ref" {
		t.Fatalf("unexpected reopened project blocks: %+v", persisted)
	}
}

func TestHostNotebookSubPagesAndPageRefs(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")

	st, err := store.Open(dataDir, homeDir)
	if err != nil {
		t.Fatalf("store.Open failed: %v", err)
	}

	svc := NewService()
	svc.store = st
	svc.opts.HomeDir = homeDir
	svc.opts.DataDir = dataDir

	st.Update(func(snap *types.ValetSnapshot) {
		snap.Projects = append(snap.Projects, types.Project{
			ID:        "proj-subpages",
			Title:     "子页面工具项目",
			Tags:      []string{},
			Blocks:    []types.NotebookBlock{{ID: "root-blk-1", Type: "h1", Content: "根目录大纲"}},
			UpdatedAt: "刚刚",
			CreatedAt: "2026-11-21",
		})
		snap.ChatThreads = append(snap.ChatThreads, types.ChatThread{
			ID:             "chat-root-origin",
			ProjectID:      "proj-subpages",
			Title:          "根目录对话",
			Model:          "claude-opus-4",
			LinkedEventIDs: []string{},
			Messages:       []types.ChatMessage{},
			UpdatedAt:      "刚刚",
		})
	})

	ctx := context.Background()

	// 1. Agent creates a top-level sub-page with initial Markdown
	createAny, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-root-origin",
		"action": "create_page",
		"title": "API 规范",
		"markdown": "# 接口列表\n- GET /v1/pages"
	}`))
	if err != nil {
		t.Fatalf("create_page failed: %v", err)
	}
	createRes := createAny.(map[string]any)
	page1ID := createRes["pageId"].(string)
	if page1ID == "" || createRes["pageTitle"] != "API 规范" || createRes["blockCount"] != 2 {
		t.Fatalf("unexpected create_page result: %+v", createRes)
	}

	// 2. Rename the sub-page and read it back via pageId
	if _, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-root-origin",
		"action": "rename_page",
		"pageId": "`+page1ID+`",
		"title": "HTTP API 规范"
	}`)); err != nil {
		t.Fatalf("rename_page failed: %v", err)
	}

	// Manually embed a page_ref card into the sub-page & add a thread rooted inside that sub-page
	st.Update(func(snap *types.ValetSnapshot) {
		for i := range snap.Projects {
			if snap.Projects[i].ID == "proj-subpages" {
				for j := range snap.Projects[i].Pages {
					if snap.Projects[i].Pages[j].ID == page1ID {
						snap.Projects[i].Pages[j].Blocks = append(
							snap.Projects[i].Pages[j].Blocks,
							types.NotebookBlock{ID: "blk-pageref", Type: "page_ref", PageID: "root", Content: "根目录大纲"},
						)
					}
				}
			}
		}
		snap.ChatThreads = append(snap.ChatThreads, types.ChatThread{
			ID:             "chat-page-origin",
			ProjectID:      "proj-subpages",
			OriginPageID:   page1ID,
			OriginBlockID:  "blk-pageref",
			Title:          "子页面内对话",
			Model:          "claude-opus-4",
			LinkedEventIDs: []string{},
			Messages:       []types.ChatMessage{},
			UpdatedAt:      "刚刚",
		})
	})

	// 3. Reading without pageId from chat-page-origin defaults to OriginPageID
	readPageAny, err := svc.handleSidecarHostRequest(ctx, "host.notebook.read", json.RawMessage(`{"chatId":"chat-page-origin"}`))
	if err != nil {
		t.Fatalf("read subpage failed: %v", err)
	}
	readPageRes := readPageAny.(map[string]any)
	formatted := readPageRes["formatted"].(string)
	if readPageRes["pageId"] != page1ID || readPageRes["pageTitle"] != "HTTP API 规范" {
		t.Fatalf("expected default target OriginPageID=%q, got %+v", page1ID, readPageRes)
	}
	if !strings.Contains(formatted, "HTTP API 规范") || !strings.Contains(formatted, "page_ref") {
		t.Fatalf("expected sub-page directory and page_ref in formatted view, got:\n%s", formatted)
	}

	// 4. Passing pageId="root" reads root Notebook even from a sub-page chat
	readRootAny, err := svc.handleSidecarHostRequest(ctx, "host.notebook.read", json.RawMessage(`{"chatId":"chat-page-origin","pageId":"root"}`))
	if err != nil {
		t.Fatalf("read root via pageId=root failed: %v", err)
	}
	readRootRes := readRootAny.(map[string]any)
	rootBlocks := readRootRes["blocks"].([]types.NotebookBlock)
	if len(rootBlocks) != 1 || rootBlocks[0].Content != "根目录大纲" {
		t.Fatalf("unexpected root blocks when reading root from subpage chat: %+v", rootBlocks)
	}

	// 5. page_ref block must be protected from update_block & preserved in replace_all
	if _, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-page-origin",
		"action": "update_block",
		"blockId": "blk-pageref",
		"markdown": "尝试覆盖引用卡片"
	}`)); err == nil {
		t.Fatalf("expected error trying to overwrite page_ref block directly")
	}

	replaceAny, err := svc.handleSidecarHostRequest(ctx, "host.notebook.edit", json.RawMessage(`{
		"chatId": "chat-page-origin",
		"action": "replace_all",
		"markdown": "# 重写页面\n- 保留引用卡"
	}`))
	if err != nil {
		t.Fatalf("replace_all on sub-page failed: %v", err)
	}
	replaceRes := replaceAny.(map[string]any)
	if replaceRes["blockCount"] != 3 {
		t.Fatalf("expected 2 replaced blocks + 1 preserved page_ref = 3, got %+v", replaceRes)
	}
}

func TestParseNotebookMarkdownTablesAndReadView(t *testing.T) {
	md := strings.Join([]string{
		"# 调研对比",
		"",
		"| 维度 | Always-On Agent | Super Agent |",
		"| :--- | :---: | ---: |",
		"| 核心动作 | 错峰执行 | 单一会话 |",
		"| 省下什么 | 等待时间 | 上下文切换 |",
		"",
		"结论段落",
	}, "\n")

	blocks := parseNotebookMarkdownToBlocks(md)
	if len(blocks) != 3 {
		t.Fatalf("expected [h1, table, paragraph] (3 blocks), got %d: %+v", len(blocks), blocks)
	}
	if blocks[0].Type != "h1" || blocks[1].Type != "table" || blocks[2].Type != "paragraph" {
		t.Fatalf("unexpected parsed block types: %+v", blocks)
	}

	proj := types.Project{
		ID:     "proj-table-read",
		Title:  "表格测试",
		Blocks: blocks,
	}
	view := formatNotebookReadView(proj, -1, "", "")
	if !strings.Contains(view, "| table]") || !strings.Contains(view, "| 维度 | Always-On Agent | Super Agent |") {
		t.Fatalf("expected formatted view to include table block metadata and rows, got:\n%s", view)
	}
}
