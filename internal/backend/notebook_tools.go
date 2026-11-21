package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"valet/internal/store"
	"valet/internal/types"
)

var (
	notebookBlockSeq atomic.Int64

	nbFenceOpenRE    = regexp.MustCompile("^[ \\t]*```([a-zA-Z0-9_+-]*)[ \\t]*$")
	nbFenceCloseRE   = regexp.MustCompile("^[ \\t]*```[ \\t]*$")
	nbDividerRE      = regexp.MustCompile(`^[ \t]*(?:---+|\*\*\*+|___+)[ \t]*$`)
	nbHeadingRE      = regexp.MustCompile(`^(#{1,6})[ \t]+(.*)$`)
	nbCalloutStartRE = regexp.MustCompile(`(?i)^[ \t]*>[ \t]*\[!(?:note|info|tip|warning|important|caution)\][ \t]*(.*)$`)
	nbQuoteLineRE    = regexp.MustCompile(`^[ \t]*>[ \t]?(.*)$`)
	nbTodoLineRE     = regexp.MustCompile(`^([ \t]*)(?:[-*+][ \t]+)?\[([ xX])\][ \t]+(.*)$`)
	nbBulletLineRE   = regexp.MustCompile(`^([ \t]*)[-*+][ \t]+(.*)$`)
	nbNumberedLineRE = regexp.MustCompile(`^([ \t]*)\d+[.)][ \t]+(.*)$`)
	nbLeadingWSRE    = regexp.MustCompile(`^([ \t]*)(.*)$`)
)

func makeNotebookBlockID() string {
	seq := notebookBlockSeq.Add(1)
	return fmt.Sprintf("blk-%d-%d", time.Now().UnixNano(), seq)
}

func resolveProjectForChat(snap types.ValetSnapshot, chatID string) (int, types.Project, string, error) {
	cid := strings.TrimSpace(chatID)
	if cid == "" {
		return -1, types.Project{}, "", errors.New("缺少当前会话 chatId，无法定位所属项目 Notebook")
	}

	var matchedThread *types.ChatThread
	for i := range snap.ChatThreads {
		if snap.ChatThreads[i].ID == cid {
			t := snap.ChatThreads[i]
			matchedThread = &t
			break
		}
	}
	if matchedThread == nil {
		return -1, types.Project{}, "", fmt.Errorf("当前会话 %q 未关联到项目，无法读写 Notebook", cid)
	}

	pid := strings.TrimSpace(matchedThread.ProjectID)
	if pid == "" {
		pid = types.DefaultProjectID
	}

	for i := range snap.Projects {
		if snap.Projects[i].ID == pid {
			return i, snap.Projects[i], matchedThread.OriginBlockID, nil
		}
	}

	return -1, types.Project{}, "", fmt.Errorf("未找到会话所属项目 %q", pid)
}

func leadingWhitespaceToNotebookIndent(ws string) int {
	width := 0
	for _, r := range ws {
		if r == '\t' {
			width += 2
		} else {
			width++
		}
	}
	indent := width / 2
	if indent > store.MaxNotebookBlockIndent {
		return store.MaxNotebookBlockIndent
	}
	return indent
}

func normalizeNotebookBlockIndents(blocks []types.NotebookBlock) []types.NotebookBlock {
	out := make([]types.NotebookBlock, len(blocks))
	for i, blk := range blocks {
		clamped := store.ClampNotebookBlockIndent(blk.Type, blk.Indent)
		if i == 0 || clamped == 0 {
			blk.Indent = 0
		} else {
			prevMax := store.ClampNotebookBlockIndent(out[i-1].Type, 1)
			if prevMax == 0 {
				// Previous block is non-indentable (e.g., heading/code/divider/session_ref).
				blk.Indent = 0
			} else {
				maxAllowed := out[i-1].Indent + 1
				if maxAllowed > store.MaxNotebookBlockIndent {
					maxAllowed = store.MaxNotebookBlockIndent
				}
				if clamped > maxAllowed {
					clamped = maxAllowed
				}
				blk.Indent = clamped
			}
		}
		out[i] = blk
	}
	return out
}

func parseNotebookMarkdownToBlocks(rawMarkdown string) []types.NotebookBlock {
	normalized := strings.ReplaceAll(rawMarkdown, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := strings.Split(normalized, "\n")
	out := make([]types.NotebookBlock, 0, len(lines))

	for i := 0; i < len(lines); i++ {
		line := lines[i]

		if m := nbFenceOpenRE.FindStringSubmatch(line); m != nil {
			lang := strings.TrimSpace(m[1])
			if lang == "" {
				lang = "bash"
			}
			var inner []string
			i++
			for i < len(lines) && !nbFenceCloseRE.MatchString(lines[i]) {
				inner = append(inner, lines[i])
				i++
			}
			out = append(out, types.NotebookBlock{
				ID:       makeNotebookBlockID(),
				Type:     "code",
				Language: lang,
				Content:  strings.Join(inner, "\n"),
			})
			continue
		}

		if strings.TrimSpace(line) == "" {
			continue
		}

		if nbDividerRE.MatchString(line) {
			out = append(out, types.NotebookBlock{
				ID:   makeNotebookBlockID(),
				Type: "divider",
			})
			continue
		}

		trimmedLeft := strings.TrimLeft(line, " \t")
		if m := nbHeadingRE.FindStringSubmatch(trimmedLeft); m != nil {
			blockType := "h3"
			switch len(m[1]) {
			case 1:
				blockType = "h1"
			case 2:
				blockType = "h2"
			}
			out = append(out, types.NotebookBlock{
				ID:      makeNotebookBlockID(),
				Type:    blockType,
				Content: strings.TrimRight(m[2], " \t"),
			})
			continue
		}

		if m := nbCalloutStartRE.FindStringSubmatch(line); m != nil {
			var parts []string
			if first := strings.TrimSpace(m[1]); first != "" {
				parts = append(parts, strings.TrimRight(m[1], " \t"))
			}
			for i+1 < len(lines) {
				nextLine := lines[i+1]
				if nbCalloutStartRE.MatchString(nextLine) {
					break
				}
				qm := nbQuoteLineRE.FindStringSubmatch(nextLine)
				if qm == nil {
					break
				}
				parts = append(parts, qm[1])
				i++
			}
			out = append(out, types.NotebookBlock{
				ID:      makeNotebookBlockID(),
				Type:    "callout",
				Content: strings.Join(parts, "\n"),
			})
			continue
		}

		if m := nbQuoteLineRE.FindStringSubmatch(line); m != nil {
			parts := []string{m[1]}
			for i+1 < len(lines) {
				nextLine := lines[i+1]
				if nbCalloutStartRE.MatchString(nextLine) {
					break
				}
				qm := nbQuoteLineRE.FindStringSubmatch(nextLine)
				if qm == nil {
					break
				}
				parts = append(parts, qm[1])
				i++
			}
			out = append(out, types.NotebookBlock{
				ID:      makeNotebookBlockID(),
				Type:    "quote",
				Content: strings.Join(parts, "\n"),
			})
			continue
		}

		if m := nbTodoLineRE.FindStringSubmatch(line); m != nil {
			out = append(out, types.NotebookBlock{
				ID:      makeNotebookBlockID(),
				Type:    "todo",
				Indent:  leadingWhitespaceToNotebookIndent(m[1]),
				Checked: strings.EqualFold(m[2], "x"),
				Content: m[3],
			})
			continue
		}

		if m := nbBulletLineRE.FindStringSubmatch(line); m != nil {
			out = append(out, types.NotebookBlock{
				ID:      makeNotebookBlockID(),
				Type:    "bullet",
				Indent:  leadingWhitespaceToNotebookIndent(m[1]),
				Content: m[2],
			})
			continue
		}

		if m := nbNumberedLineRE.FindStringSubmatch(line); m != nil {
			out = append(out, types.NotebookBlock{
				ID:      makeNotebookBlockID(),
				Type:    "numbered",
				Indent:  leadingWhitespaceToNotebookIndent(m[1]),
				Content: m[2],
			})
			continue
		}

		m := nbLeadingWSRE.FindStringSubmatch(line)
		out = append(out, types.NotebookBlock{
			ID:      makeNotebookBlockID(),
			Type:    "paragraph",
			Indent:  leadingWhitespaceToNotebookIndent(m[1]),
			Content: m[2],
		})
	}

	return normalizeNotebookBlockIndents(out)
}

func formatNotebookReadView(proj types.Project, originBlockID string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "项目 Notebook：%s (projectId=%s)\n", proj.Title, proj.ID)
	if strings.TrimSpace(proj.WorkingDir) != "" {
		fmt.Fprintf(&b, "工作目录：%s\n", proj.WorkingDir)
	}
	if len(proj.Tags) > 0 {
		fmt.Fprintf(&b, "标签：%s\n", strings.Join(proj.Tags, ", "))
	}
	fmt.Fprintf(&b, "共 %d 个内容块：\n", len(proj.Blocks))

	counters := make([]int, 0, store.MaxNotebookBlockIndent+1)
	for idx, blk := range proj.Blocks {
		level := store.ClampNotebookBlockIndent(blk.Type, blk.Indent)
		orderedNum := 1
		if blk.Type == "numbered" {
			if len(counters) <= level {
				grown := make([]int, level+1)
				copy(grown, counters)
				counters = grown
			} else {
				counters = counters[:level+1]
			}
			counters[level]++
			orderedNum = counters[level]
		} else if len(counters) > level {
			counters = counters[:level]
		}

		var metaParts []string
		metaParts = append(metaParts, blk.ID)
		typeLabel := blk.Type
		switch blk.Type {
		case "todo":
			if blk.Checked {
				typeLabel = "todo:done"
			} else {
				typeLabel = "todo:open"
			}
		case "code":
			lang := strings.TrimSpace(blk.Language)
			if lang == "" {
				lang = "bash"
			}
			typeLabel = "code:" + lang
		case "session_ref":
			if blk.SessionID != "" {
				typeLabel = "session_ref:" + blk.SessionID
			}
		}
		metaParts = append(metaParts, typeLabel)
		if level > 0 {
			metaParts = append(metaParts, fmt.Sprintf("indent=%d", level))
		}

		prefix := strings.Repeat("  ", level)
		var preview string
		switch blk.Type {
		case "h1":
			preview = "# " + blk.Content
		case "h2":
			preview = "## " + blk.Content
		case "h3":
			preview = "### " + blk.Content
		case "bullet":
			preview = prefix + "- " + blk.Content
		case "numbered":
			preview = fmt.Sprintf("%s%d. %s", prefix, orderedNum, blk.Content)
		case "todo":
			mark := " "
			if blk.Checked {
				mark = "x"
			}
			preview = fmt.Sprintf("%s- [%s] %s", prefix, mark, blk.Content)
		case "callout":
			preview = prefix + "> [!note] " + strings.ReplaceAll(blk.Content, "\n", " / ")
		case "quote":
			preview = prefix + "> " + strings.ReplaceAll(blk.Content, "\n", " / ")
		case "code":
			lang := strings.TrimSpace(blk.Language)
			if lang == "" {
				lang = "bash"
			}
			preview = fmt.Sprintf("```%s\n%s\n```", lang, blk.Content)
		case "divider":
			preview = "---"
		case "session_ref":
			preview = fmt.Sprintf("[@valet 会话卡片: %s]", blk.Content)
		default:
			if blk.Content == "" {
				preview = "（空行）"
			} else {
				preview = prefix + blk.Content
			}
		}

		originMarker := ""
		if originBlockID != "" && blk.ID == originBlockID {
			originMarker = "  <<< [当前会话发起行]"
		}
		fmt.Fprintf(&b, "%d. [%s] %s%s\n", idx+1, strings.Join(metaParts, " | "), preview, originMarker)
	}

	return strings.TrimRight(b.String(), "\n")
}

func resolveNotebookBlockIndex(blocks []types.NotebookBlock, targetBlockID string, lineNumber *int) (int, error) {
	if tid := strings.TrimSpace(targetBlockID); tid != "" {
		for i, blk := range blocks {
			if blk.ID == tid {
				return i, nil
			}
		}
		return -1, fmt.Errorf("未找到 ID 为 %q 的 Notebook 内容块", tid)
	}
	if lineNumber != nil {
		ln := *lineNumber
		if ln < 1 || ln > len(blocks) {
			return -1, fmt.Errorf("lineNumber=%d 超出当前 Notebook 范围 (1..%d)", ln, len(blocks))
		}
		return ln - 1, nil
	}
	return -1, errors.New("需要提供 targetBlockId 或 lineNumber 以定位目标内容块")
}

func resolveNotebookBlockRange(blocks []types.NotebookBlock, targetBlockID string, endBlockID string, lineNumber *int) (int, int, error) {
	startIdx, err := resolveNotebookBlockIndex(blocks, targetBlockID, lineNumber)
	if err != nil {
		return -1, -1, err
	}
	endIdx := startIdx
	if eid := strings.TrimSpace(endBlockID); eid != "" {
		found := -1
		for i, blk := range blocks {
			if blk.ID == eid {
				found = i
				break
			}
		}
		if found == -1 {
			return -1, -1, fmt.Errorf("未找到结束块 ID %q", eid)
		}
		endIdx = found
	}
	if startIdx > endIdx {
		startIdx, endIdx = endIdx, startIdx
	}
	return startIdx, endIdx, nil
}

func isAllowedNotebookEditType(t string) bool {
	switch t {
	case "paragraph", "h1", "h2", "h3", "bullet", "numbered", "todo", "callout", "quote", "code", "divider":
		return true
	default:
		return false
	}
}

func (s *Service) execHostNotebookRead(raw json.RawMessage) (any, error) {
	var req struct {
		ChatID string `json:"chatId"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}

	snap := s.store.Snapshot()
	_, proj, originBlockID, err := resolveProjectForChat(snap, req.ChatID)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"ok":            true,
		"projectId":     proj.ID,
		"projectTitle":  proj.Title,
		"workingDir":    proj.WorkingDir,
		"originBlockId": originBlockID,
		"blockCount":    len(proj.Blocks),
		"blocks":        proj.Blocks,
		"formatted":     formatNotebookReadView(proj, originBlockID),
	}, nil
}

func (s *Service) execHostNotebookEdit(raw json.RawMessage) (any, error) {
	var req struct {
		ChatID              string   `json:"chatId"`
		Action              string   `json:"action"`
		Markdown            string   `json:"markdown"`
		TargetBlockID       string   `json:"targetBlockId"`
		EndBlockID          string   `json:"endBlockId"`
		LineNumber          *int     `json:"lineNumber"`
		BlockIDs            []string `json:"blockIds"`
		Content             *string  `json:"content"`
		Type                *string  `json:"type"`
		Checked             *bool    `json:"checked"`
		Indent              *int     `json:"indent"`
		Language            *string  `json:"language"`
		PreserveSessionRefs *bool    `json:"preserveSessionRefs"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}

	action := strings.TrimSpace(req.Action)
	if action == "" {
		return nil, errors.New("notebook_edit 缺少 action 参数")
	}

	snap := s.store.Snapshot()
	_, proj, originBlockID, err := resolveProjectForChat(snap, req.ChatID)
	if err != nil {
		return nil, err
	}

	blocks := make([]types.NotebookBlock, len(proj.Blocks))
	copy(blocks, proj.Blocks)
	var affectedIDs []string
	var summary string

	switch action {
	case "append":
		parsed := parseNotebookMarkdownToBlocks(req.Markdown)
		if len(parsed) == 0 {
			return nil, errors.New("append 操作需要提供非空的 markdown 内容")
		}
		for _, p := range parsed {
			affectedIDs = append(affectedIDs, p.ID)
		}
		if len(blocks) == 1 && blocks[0].Type == "paragraph" && strings.TrimSpace(blocks[0].Content) == "" {
			blocks = parsed
		} else {
			blocks = append(blocks, parsed...)
		}
		summary = fmt.Sprintf("已向项目「%s」Notebook 末尾追加 %d 个内容块", proj.Title, len(parsed))

	case "insert_after", "insert_before":
		idx, idxErr := resolveNotebookBlockIndex(blocks, req.TargetBlockID, req.LineNumber)
		if idxErr != nil {
			return nil, idxErr
		}
		parsed := parseNotebookMarkdownToBlocks(req.Markdown)
		if len(parsed) == 0 {
			return nil, fmt.Errorf("%s 操作需要提供非空的 markdown 内容", action)
		}
		for _, p := range parsed {
			affectedIDs = append(affectedIDs, p.ID)
		}
		insertAt := idx + 1
		if action == "insert_before" {
			insertAt = idx
		}
		next := make([]types.NotebookBlock, 0, len(blocks)+len(parsed))
		next = append(next, blocks[:insertAt]...)
		next = append(next, parsed...)
		next = append(next, blocks[insertAt:]...)
		blocks = next
		summary = fmt.Sprintf("已在项目「%s」Notebook 中插入 %d 个内容块", proj.Title, len(parsed))

	case "update_block":
		idx, idxErr := resolveNotebookBlockIndex(blocks, req.TargetBlockID, req.LineNumber)
		if idxErr != nil {
			return nil, idxErr
		}
		if blocks[idx].Type == "session_ref" {
			return nil, errors.New("安全边界拒绝：不允许直接修改嵌入的关联会话卡片 (session_ref)")
		}
		if req.Content == nil && req.Type == nil && req.Checked == nil && req.Indent == nil && req.Language == nil {
			return nil, errors.New("update_block 至少需要提供 content、type、checked、indent 或 language 中的一项")
		}
		blk := blocks[idx]
		if req.Type != nil {
			nextType := strings.TrimSpace(*req.Type)
			if !isAllowedNotebookEditType(nextType) {
				return nil, fmt.Errorf("不支持的内容块类型 %q", nextType)
			}
			blk.Type = nextType
			if nextType != "todo" && req.Checked == nil {
				blk.Checked = false
			}
			if nextType == "code" && blk.Language == "" && req.Language == nil {
				blk.Language = "bash"
			} else if nextType != "code" && req.Language == nil {
				blk.Language = ""
			}
			if nextType == "divider" {
				blk.Content = ""
			}
		}
		if req.Content != nil {
			if blk.Type == "divider" {
				blk.Content = ""
			} else {
				blk.Content = *req.Content
			}
		}
		if req.Checked != nil {
			blk.Checked = *req.Checked
		}
		if req.Indent != nil {
			blk.Indent = *req.Indent
		}
		if req.Language != nil {
			blk.Language = strings.TrimSpace(*req.Language)
		}
		blocks[idx] = blk
		affectedIDs = []string{blk.ID}
		summary = fmt.Sprintf("已更新项目「%s」Notebook 内容块 %s", proj.Title, blk.ID)

	case "replace_blocks":
		startIdx, endIdx, rangeErr := resolveNotebookBlockRange(blocks, req.TargetBlockID, req.EndBlockID, req.LineNumber)
		if rangeErr != nil {
			return nil, rangeErr
		}
		parsed := parseNotebookMarkdownToBlocks(req.Markdown)
		if len(parsed) == 0 {
			return nil, errors.New("replace_blocks 需要提供非空的 markdown 内容")
		}
		for _, p := range parsed {
			affectedIDs = append(affectedIDs, p.ID)
		}
		next := make([]types.NotebookBlock, 0, len(blocks)-(endIdx-startIdx+1)+len(parsed))
		next = append(next, blocks[:startIdx]...)
		next = append(next, parsed...)
		next = append(next, blocks[endIdx+1:]...)
		blocks = next
		summary = fmt.Sprintf("已将项目「%s」Notebook 第 %d..%d 块替换为 %d 个新块", proj.Title, startIdx+1, endIdx+1, len(parsed))

	case "delete_blocks":
		toDelete := make(map[string]bool)
		for _, id := range req.BlockIDs {
			if trimmed := strings.TrimSpace(id); trimmed != "" {
				toDelete[trimmed] = true
			}
		}
		if strings.TrimSpace(req.TargetBlockID) != "" || req.LineNumber != nil {
			startIdx, endIdx, rangeErr := resolveNotebookBlockRange(blocks, req.TargetBlockID, req.EndBlockID, req.LineNumber)
			if rangeErr != nil {
				return nil, rangeErr
			}
			for i := startIdx; i <= endIdx; i++ {
				toDelete[blocks[i].ID] = true
			}
		}
		if len(toDelete) == 0 {
			return nil, errors.New("delete_blocks 需要提供 blockIds、targetBlockId 或 lineNumber")
		}
		kept := make([]types.NotebookBlock, 0, len(blocks))
		for _, blk := range blocks {
			if toDelete[blk.ID] {
				affectedIDs = append(affectedIDs, blk.ID)
				continue
			}
			kept = append(kept, blk)
		}
		if len(affectedIDs) == 0 {
			return nil, errors.New("未匹配到任何待删除的 Notebook 内容块")
		}
		if len(kept) == 0 {
			kept = []types.NotebookBlock{{ID: makeNotebookBlockID(), Type: "paragraph", Content: ""}}
		}
		blocks = kept
		summary = fmt.Sprintf("已从项目「%s」Notebook 删除 %d 个内容块", proj.Title, len(affectedIDs))

	case "replace_all":
		parsed := parseNotebookMarkdownToBlocks(req.Markdown)
		preserveRefs := req.PreserveSessionRefs == nil || *req.PreserveSessionRefs
		if preserveRefs {
			var preserved []types.NotebookBlock
			for _, blk := range blocks {
				if blk.Type == "session_ref" {
					preserved = append(preserved, blk)
				}
			}
			parsed = append(parsed, preserved...)
		}
		if len(parsed) == 0 {
			parsed = []types.NotebookBlock{{ID: makeNotebookBlockID(), Type: "paragraph", Content: ""}}
		}
		for _, b := range parsed {
			affectedIDs = append(affectedIDs, b.ID)
		}
		blocks = parsed
		summary = fmt.Sprintf("已重写项目「%s」Notebook（共 %d 个内容块）", proj.Title, len(blocks))

	default:
		return nil, fmt.Errorf("不支持的 notebook_edit action: %q", action)
	}

	normalizedBlocks := normalizeNotebookBlockIndents(blocks)
	var updatedProj types.Project
	var saved bool
	s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Projects {
			if st.Projects[i].ID == proj.ID {
				st.Projects[i].Blocks = normalizedBlocks
				st.Projects[i].UpdatedAt = "刚刚"
				updatedProj = st.Projects[i]
				saved = true
				break
			}
		}
	})
	if !saved {
		return nil, fmt.Errorf("保存失败：未找到项目 %q", proj.ID)
	}

	s.emitStateChange("projects")

	return map[string]any{
		"ok":           true,
		"projectId":    updatedProj.ID,
		"projectTitle": updatedProj.Title,
		"action":       action,
		"summary":      summary,
		"blockCount":   len(updatedProj.Blocks),
		"affectedIds":  affectedIDs,
		"formatted":    formatNotebookReadView(updatedProj, originBlockID),
	}, nil
}
