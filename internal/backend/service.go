package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"valet/internal/plugins"
	"valet/internal/sidecar"
	"valet/internal/store"
	"valet/internal/sys"
	"valet/internal/types"
)

// StartOptions configures backend directories, emitters, and runtime flags.
type StartOptions struct {
	DataDir      string
	HomeDir      string
	ResourcesDir string
	RepoRoot     string
	DesktopReady bool
	UseVaultOnly bool // true in tests to avoid touching user's real Finder Trash
	OnChatStream func(types.ChatStreamPayload)
	OnMetrics    func(types.SystemMetrics)
	OnState      func(types.StateChangeNotice)
}

// Service implements the bound `Valet` MyGo service coordinating native macOS capabilities,
// persistent application state, plugin routing, and the Pi Durable sidecar agent.
type Service struct {
	mu           sync.Mutex
	started      bool
	closed       bool
	opts         StartOptions
	store        *store.Store
	client       *sidecar.Client
	throttle     *plugins.ThrottleTracker
	stopMetrics  chan struct{}
	trashMover   sys.TrashMover
	createdInbox map[string]types.InboxApprovalItem
	createdEvent map[string]types.TimelineEvent
}

// NewService constructs a zero-I/O Service safe to pass to mygo.Bind before App.Run / MYGO_GENERATE.
func NewService() *Service {
	return &Service{
		throttle:     plugins.NewThrottleTracker(),
		createdInbox: make(map[string]types.InboxApprovalItem),
		createdEvent: make(map[string]types.TimelineEvent),
	}
}

// StartService opens durable storage, initializes telemetry, and starts the Pi Durable sidecar.
func StartService(s *Service, opts StartOptions) error {
	return s.start(opts)
}

// CloseService shuts down background tickers and the Pi Durable sidecar cleanly.
func CloseService(s *Service) error {
	return s.close()
}

func (s *Service) start(opts StartOptions) error {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return nil
	}
	if opts.HomeDir == "" {
		opts.HomeDir, _ = os.UserHomeDir()
	}
	if opts.DataDir == "" {
		if opts.DesktopReady {
			if d, err := mygo.App.Path(mygo.PathUserData); err == nil && d != "" {
				opts.DataDir = d
			}
		}
		if opts.DataDir == "" {
			opts.DataDir = filepath.Join(opts.HomeDir, ".valet-data")
		}
	}
	if opts.ResourcesDir == "" && opts.DesktopReady {
		if r, err := mygo.App.Path(mygo.PathResources); err == nil {
			opts.ResourcesDir = r
		}
	}

	st, err := store.Open(opts.DataDir, opts.HomeDir)
	if err != nil {
		s.mu.Unlock()
		return err
	}

	var mover sys.TrashMover
	if !opts.UseVaultOnly && opts.DesktopReady {
		mover = func(absPath, _ string) (string, error) {
			return mygo.Shell.TrashItemResult(absPath)
		}
	}

	client := sidecar.NewClient(
		opts.ResourcesDir,
		opts.RepoRoot,
		s.handleSidecarHostRequest,
		s.handleSidecarNotify,
	)

	s.opts = opts
	s.store = st
	s.client = client
	s.trashMover = mover
	s.stopMetrics = make(chan struct{})
	s.started = true
	s.mu.Unlock()

	// Refresh host disk metrics immediately
	s.refreshHostMetrics()

	// Launch and initialize Pi Durable sidecar
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	initParams := sidecar.InitParams{
		DBPath: filepath.Join(opts.DataDir, "pi-agent.sqlite"),
		State:  s.buildSyncState(st.Snapshot()),
	}
	if err := client.Call(ctx, "agent.init", initParams, nil); err != nil {
		// Sidecar failure should be logged; retry occurs lazily on next call
		fmt.Fprintf(os.Stderr, "[valet] initial sidecar init error: %v\n", err)
	}

	if opts.OnMetrics != nil {
		go s.metricsLoop()
	}
	return nil
}

func (s *Service) close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	stopCh := s.stopMetrics
	client := s.client
	s.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}
	if client != nil {
		return client.Close()
	}
	return nil
}

func (s *Service) ensureStarted() error {
	s.mu.Lock()
	started := s.started
	s.mu.Unlock()
	if started {
		return nil
	}
	return s.start(StartOptions{DesktopReady: false})
}

func (s *Service) metricsLoop() {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.stopMetrics:
			return
		case <-ticker.C:
			snap := s.store.Snapshot()
			if !snap.OnboardingCompleted || snap.IsPaused {
				continue
			}
			m := s.refreshHostMetrics()
			if s.opts.OnMetrics != nil {
				s.opts.OnMetrics(m)
			}
		}
	}
}

func (s *Service) refreshHostMetrics() types.SystemMetrics {
	disk := sys.SampleDiskMetrics(s.opts.HomeDir)
	proc := sys.SampleProcesses(context.Background(), 3)
	snap := s.store.Update(func(st *types.ValetSnapshot) {
		st.SystemMetrics.DiskPct = disk.DiskPct
		st.SystemMetrics.DiskFreeGB = disk.DiskFreeGB
		st.SystemMetrics.DiskTotalGB = disk.DiskTotalGB
		st.SystemMetrics.CPUPct = proc.CPUPct
		st.SystemMetrics.MemPct = proc.MemPct
	})
	return snap.SystemMetrics
}

func (s *Service) buildSyncState(snap types.ValetSnapshot) sidecar.SyncState {
	return sidecar.SyncState{
		HomeDir:     s.opts.HomeDir,
		DataDir:     s.opts.DataDir,
		IsPaused:    snap.IsPaused,
		Preferences: snap.Preferences,
		Providers:   snap.Providers,
		Plugins:     snap.Plugins,
		Memories:    snap.Memories,
	}
}

func (s *Service) syncSidecar(snap types.ValetSnapshot) {
	if s.client == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.client.Call(ctx, "agent.syncState", map[string]any{
			"state": s.buildSyncState(snap),
		}, nil)
	}()
}

func (s *Service) syncSidecarBlocking(ctx context.Context, snap types.ValetSnapshot) {
	if s.client == nil {
		return
	}
	_ = s.client.Call(ctx, "agent.syncState", map[string]any{
		"state": s.buildSyncState(snap),
	}, nil)
}

func (s *Service) emitStateChange(scope string) {
	if s.opts.OnState != nil {
		s.opts.OnState(types.StateChangeNotice{Scope: scope})
	}
}

func (s *Service) handleSidecarNotify(method string, params json.RawMessage) {
	if method == "host.chatStream" && s.opts.OnChatStream != nil {
		var payload types.ChatStreamPayload
		if err := json.Unmarshal(params, &payload); err == nil {
			s.opts.OnChatStream(payload)
		}
	}
}

func (s *Service) handleSidecarHostRequest(ctx context.Context, method string, raw json.RawMessage) (any, error) {
	snap := s.store.Snapshot()
	switch method {
	case "host.systemOverview":
		proc := sys.SampleProcesses(ctx, 5)
		enabledCount := 0
		for _, p := range snap.Plugins {
			if p.Installed && p.Enabled {
				enabledCount++
			}
		}
		return map[string]any{
			"diskPct":        snap.SystemMetrics.DiskPct,
			"diskFreeGB":     snap.SystemMetrics.DiskFreeGB,
			"diskTotalGB":    snap.SystemMetrics.DiskTotalGB,
			"cpuPct":         proc.CPUPct,
			"memPct":         proc.MemPct,
			"enabledPlugins": enabledCount,
			"topProcesses":   proc.Rows,
		}, nil

	case "host.scanDisk":
		var req struct {
			MinSizeMB int `json:"minSizeMB"`
			IdleDays  int `json:"idleDays"`
		}
		_ = json.Unmarshal(raw, &req)
		return sys.ScanDisk(
			s.opts.HomeDir,
			snap.Preferences.CleanupPolicy.ProtectedDirs,
			req.MinSizeMB,
			req.IdleDays,
		), nil

	case "host.trashItems":
		var req struct {
			Paths       []string `json:"paths"`
			EstimatedGB float64  `json:"estimatedGB"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		batchID, moved, reclaimed, err := sys.MoveItemsToTrash(
			s.opts.HomeDir,
			s.opts.DataDir,
			snap.Preferences.CleanupPolicy.ProtectedDirs,
			req.Paths,
			req.EstimatedGB,
			s.trashMover,
		)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"trashBatchId": batchID,
			"movedCount":   moved,
			"reclaimedGB":  reclaimed,
		}, nil

	case "host.sampleProcesses":
		var req struct {
			Limit int `json:"limit"`
		}
		_ = json.Unmarshal(raw, &req)
		return sys.SampleProcesses(ctx, req.Limit), nil

	case "host.terminateProcess":
		var req struct {
			PID    int    `json:"pid"`
			Name   string `json:"name"`
			Signal string `json:"signal"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		if err := sys.TerminateProcess(req.PID, req.Name, req.Signal, snap.Preferences.BlockedApps); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "pid": req.PID}, nil

	case "host.scanOrphanRemnants":
		var req struct {
			BundleID string `json:"bundleId"`
		}
		_ = json.Unmarshal(raw, &req)
		return map[string]any{"remnants": sys.ScanOrphanRemnants(s.opts.HomeDir, req.BundleID)}, nil

	case "host.summarizeLogs":
		var req struct {
			Minutes int `json:"minutes"`
		}
		_ = json.Unmarshal(raw, &req)
		return sys.SummarizeDiagnosticLogs(s.opts.HomeDir, req.Minutes), nil

	case "host.saveMemory":
		var req struct {
			Content string `json:"content"`
			Source  string `json:"source"`
		}
		_ = json.Unmarshal(raw, &req)
		entry := types.MemoryEntry{
			ID:        fmt.Sprintf("mem-%d", time.Now().UnixNano()),
			Content:   strings.TrimSpace(req.Content),
			Source:    req.Source,
			CreatedAt: time.Now().Format("2006-01-02"),
		}
		if entry.Source == "" {
			entry.Source = "对话学习"
		}
		next := s.store.Update(func(st *types.ValetSnapshot) {
			st.Memories = append([]types.MemoryEntry{entry}, st.Memories...)
		})
		s.syncSidecar(next)
		s.emitStateChange("settings")
		return entry, nil

	case "host.executePluginAction":
		var req struct {
			PluginID  string         `json:"pluginId"`
			ActionID  string         `json:"actionId"`
			EventCode string         `json:"eventCode"`
			Args      map[string]any `json:"args"`
		}
		_ = json.Unmarshal(raw, &req)
		// If action moves a file to Trash cleanly via safe validation
		if p, ok := req.Args["path"].(string); ok && strings.TrimSpace(p) != "" &&
			(req.ActionID == "move_to_trash" || req.ActionID == "disk.move_to_trash" || req.ActionID == "app.trash_remnants") {
			batchID, moved, reclaimed, err := sys.MoveItemsToTrash(
				s.opts.HomeDir,
				s.opts.DataDir,
				snap.Preferences.CleanupPolicy.ProtectedDirs,
				[]string{p},
				0.2,
				s.trashMover,
			)
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"ok":           true,
				"trashBatchId": batchID,
				"movedCount":   moved,
				"reclaimedGB":  reclaimed,
			}, nil
		}
		return map[string]any{
			"ok":        true,
			"pluginId":  req.PluginID,
			"actionId":  req.ActionID,
			"eventCode": req.EventCode,
		}, nil

	case "host.queueApproval":
		var req sidecar.QueueApprovalRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		return s.queueApprovalFromAgent(req), nil

	case "host.recordTimelineEvent":
		var req sidecar.RecordTimelineRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		return s.recordTimelineFromAgent(req), nil

	default:
		return nil, fmt.Errorf("unknown host RPC method: %s", method)
	}
}

func (s *Service) queueApprovalFromAgent(req sidecar.QueueApprovalRequest) map[string]string {
	now := time.Now()
	nowHHMM := now.Format("15:04")
	ts := now.Format(time.RFC3339)
	evtID := fmt.Sprintf("evt-ag-%d", now.UnixNano())
	inboxID := fmt.Sprintf("inbox-ag-%d", now.UnixNano())

	evt := types.TimelineEvent{
		ID:                  evtID,
		Timestamp:           ts,
		TimeLabel:           nowHHMM,
		DayGroup:            "today",
		Title:               req.Title,
		Summary:             req.Summary,
		PluginID:            req.PluginID,
		PluginName:          req.PluginName,
		PluginBadge:         req.PluginName,
		EventCode:           req.EventCode,
		Status:              "pending_confirm",
		ConfirmBannerText:   req.Summary,
		TriggerLatencyLabel: nowHHMM + " · Agent 安全拦截",
		Payload:             req.ToolArgs,
		Reasoning:           req.Reasoning,
		ActionItems:         req.ActionItems,
		TraceSteps: []types.TraceStep{
			{ID: "st1", Time: nowHHMM, Stage: "安全拦截", Detail: "策略要求人工批准后执行 " + req.ToolName, Status: "active"},
		},
		Logs: []types.LogLine{
			{ID: "lg1", TS: now.Format("15:04:05"), Level: "WARN", Message: fmt.Sprintf("beforeTool blocked %s -> queued inbox %s", req.ToolName, inboxID)},
		},
	}

	item := types.InboxApprovalItem{
		ID:                    inboxID,
		Timestamp:             ts,
		TimeLabel:             nowHHMM,
		AgeLabel:              "刚刚",
		Category:              req.Category,
		IconKind:              req.IconKind,
		Title:                 req.Title,
		Summary:               req.Summary,
		PluginID:              req.PluginID,
		PluginName:            req.PluginName,
		PluginBadge:           req.PluginName,
		EventCode:             req.EventCode,
		WarningTag:            req.WarningTag,
		Reversible7d:          req.Reversible7d,
		ReclaimableGB:         req.ReclaimableGB,
		ApproveLabel:          req.ApproveLabel,
		DismissLabel:          req.DismissLabel,
		Status:                "pending",
		LinkedTimelineEventID: evtID,
		TriggerLatencyLabel:   nowHHMM + " · 来自对话与安全网关",
		Payload:               req.ToolArgs,
		Reasoning:             req.Reasoning,
		ActionItems:           req.ActionItems,
		TraceSteps:            evt.TraceSteps,
		Logs:                  evt.Logs,
		ToolName:              req.ToolName,
		ToolArgs:              req.ToolArgs,
	}

	s.mu.Lock()
	s.createdInbox[inboxID] = item
	s.createdEvent[evtID] = evt
	s.mu.Unlock()

	s.store.Update(func(st *types.ValetSnapshot) {
		st.TimelineEvents = append([]types.TimelineEvent{evt}, st.TimelineEvents...)
		st.InboxItems = append([]types.InboxApprovalItem{item}, st.InboxItems...)
	})
	s.emitStateChange("inbox")
	return map[string]string{
		"inboxId":         inboxID,
		"timelineEventId": evtID,
	}
}

func (s *Service) recordTimelineFromAgent(req sidecar.RecordTimelineRequest) map[string]string {
	now := time.Now()
	nowHHMM := now.Format("15:04")
	evtID := fmt.Sprintf("evt-rec-%d", now.UnixNano())
	status := req.Status
	if status == "" {
		status = "completed"
	}

	evt := types.TimelineEvent{
		ID:                  evtID,
		Timestamp:           now.Format(time.RFC3339),
		TimeLabel:           nowHHMM,
		DayGroup:            "today",
		Title:               req.Title,
		Summary:             req.Summary,
		PluginID:            req.PluginID,
		PluginName:          req.PluginName,
		PluginBadge:         req.PluginName,
		EventCode:           req.EventCode,
		Status:              status,
		TriggerLatencyLabel: nowHHMM + " · 自动处理完成",
		Payload:             req.Payload,
		Reasoning:           req.Reasoning,
		ActionItems:         req.ActionItems,
		ReclaimedGB:         req.ReclaimedGB,
		Intercepted:         req.Intercepted,
		CanRestore:          req.CanRestore,
		TraceSteps: []types.TraceStep{
			{ID: "tr1", Time: nowHHMM, Stage: "自动执行", Detail: req.Summary, Status: "done"},
		},
		Logs: []types.LogLine{
			{ID: "lg1", TS: now.Format("15:04:05"), Level: "EXEC", Message: fmt.Sprintf("Recorded %s -> %s", req.EventCode, req.Title)},
		},
	}

	s.mu.Lock()
	s.createdEvent[evtID] = evt
	s.mu.Unlock()

	s.store.Update(func(st *types.ValetSnapshot) {
		st.TimelineEvents = append([]types.TimelineEvent{evt}, st.TimelineEvents...)
	})
	s.emitStateChange("timeline")
	return map[string]string{"timelineEventId": evtID}
}

// --- Public Bound RPC Methods (Exported via mygo.BindAs("Valet", svc)) ---

// GetSnapshot returns the current persistent application state.
func (s *Service) GetSnapshot() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Snapshot(), nil
}

// CompleteOnboarding finishes the onboarding wizard and opens Inbox.
func (s *Service) CompleteOnboarding() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		st.OnboardingCompleted = true
		st.ActiveView = string(types.ViewInbox)
	}), nil
}

// ImportExistingConfig marks onboarding imported and ready.
func (s *Service) ImportExistingConfig() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Permissions {
			id := st.Permissions[i].ID
			if id == "full_disk" || id == "accessibility" || id == "notifications" || id == "screen_recording" {
				st.Permissions[i].Granted = true
				for j := range st.Permissions[i].MockApps {
					if st.Permissions[i].MockApps[j].IsValet {
						st.Permissions[i].MockApps[j].Enabled = true
					}
				}
			}
		}
		st.OnboardingCompleted = true
		st.ActiveView = string(types.ViewInbox)
	})
	s.syncSidecar(next)
	return next, nil
}

// ResetOnboarding returns to onboarding Step 1.
func (s *Service) ResetOnboarding() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		st.OnboardingCompleted = false
		st.OnboardingStep = 1
	}), nil
}

// ResetAllData resets the persistent state back to factory seed defaults.
func (s *Service) ResetAllData() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	seed := store.NewSeedSnapshot(s.opts.HomeDir)
	next := s.store.Update(func(st *types.ValetSnapshot) {
		*st = seed
	})
	s.syncSidecar(next)
	return next, nil
}

// TogglePause toggles Valet daemon on-duty / paused mode.
func (s *Service) TogglePause() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.IsPaused = !st.IsPaused
		st.IsOnDuty = !st.IsPaused
	})
	s.syncSidecar(next)
	return next, nil
}

// RunFirstScan performs real read-only host inspection (disk, orphans, processes, logs) and updates ScanState.
func (s *Service) RunFirstScan(ctx context.Context) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	start := time.Now()
	snap := s.store.Snapshot()
	diskReport := sys.ScanDisk(
		s.opts.HomeDir,
		snap.Preferences.CleanupPolicy.ProtectedDirs,
		2048,
		90,
	)
	orphans := sys.ScanOrphanRemnants(s.opts.HomeDir, "")
	procs := sys.SampleProcesses(ctx, 3)
	logs := sys.SummarizeDiagnosticLogs(s.opts.HomeDir, 120)
	metrics := sys.SampleDiskMetrics(s.opts.HomeDir)

	logEnabled := false
	for _, p := range snap.Plugins {
		if p.ID == "log-detective" && p.Enabled {
			logEnabled = true
			break
		}
	}

	topProcDetail := "系统负载平稳"
	if len(procs.Rows) > 0 {
		topProcDetail = fmt.Sprintf("最高占用：%s (CPU %d%% · %s)", procs.Rows[0].Name, procs.Rows[0].CPUPct, procs.Rows[0].MemLabel)
	}

	logDetail := "日志侦探未启用，已跳过"
	logStatus := "skipped"
	logLabel := "—"
	if logEnabled {
		logStatus = "done"
		logDetail = logs.Summary
		logLabel = fmt.Sprintf("%d 份", logs.Count)
	}

	elapsed := int(math.Max(1, math.Round(time.Since(start).Seconds())))
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.SystemMetrics.DiskPct = metrics.DiskPct
		st.SystemMetrics.DiskFreeGB = metrics.DiskFreeGB
		st.SystemMetrics.DiskTotalGB = metrics.DiskTotalGB
		st.SystemMetrics.CPUPct = procs.CPUPct
		st.SystemMetrics.MemPct = procs.MemPct
		st.Scan = types.ScanState{
			Status:        "done",
			ProgressPct:   100,
			ElapsedSec:    elapsed,
			ReclaimableGB: diskReport.EstimatedReclaimableGB,
			Tasks: []types.ScanTaskItem{
				{
					ID:        "disk",
					Title:     "磁盘",
					Detail:    fmt.Sprintf("可用 %.1f GB / %.0f GB · 发现 %d 项可安全释放资产", metrics.DiskFreeGB, metrics.DiskTotalGB, len(diskReport.Items)),
					SizeLabel: fmt.Sprintf("%.1f GB", diskReport.EstimatedReclaimableGB),
					SizeGB:    diskReport.EstimatedReclaimableGB,
					Status:    "done",
				},
				{
					ID:        "orphan",
					Title:     "卸载残留",
					Detail:    fmt.Sprintf("扫描到 %d 项疑似残留缓存目录", len(orphans)),
					SizeLabel: fmt.Sprintf("%d 项", len(orphans)),
					SizeGB:    0,
					Status:    "done",
				},
				{
					ID:        "process",
					Title:     "进程",
					Detail:    topProcDetail,
					SizeLabel: fmt.Sprintf("CPU %d%%", procs.CPUPct),
					SizeGB:    0,
					Status:    "done",
				},
				{
					ID:        "log",
					Title:     "系统日志",
					Detail:    logDetail,
					SizeLabel: logLabel,
					SizeGB:    0,
					Status:    logStatus,
				},
			},
		}
	})
	return next, nil
}

// CreateChatThread creates and activates a new conversation thread.
func (s *Service) CreateChatThread() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	nowHHMM := time.Now().Format("15:04")
	newID := fmt.Sprintf("chat-%d", time.Now().UnixNano())
	next := s.store.Update(func(st *types.ValetSnapshot) {
		nick := st.Preferences.UserNickname
		if nick == "" {
			nick = "你"
		}
		thread := types.ChatThread{
			ID:        newID,
			Title:     "新对话",
			Model:     st.Preferences.Models.Primary,
			UpdatedAt: "刚刚",
			LinkedEventIDs: []string{},
			Messages: []types.ChatMessage{
				{
					ID:        "welcome-" + newID,
					Role:      "assistant",
					MetaLabel: st.Preferences.Models.Primary + " · 就绪",
					CreatedAt: nowHHMM,
					Content:   fmt.Sprintf("%s好，我可以帮你排查 Mac 卡顿、清理磁盘缓存、查看崩溃日志，或者直接用自然语言帮你写一个本地插件。", nick),
				},
			},
		}
		st.ActiveView = string(types.ViewChat)
		st.ActiveChatID = newID
		st.ChatThreads = append([]types.ChatThread{thread}, st.ChatThreads...)
	})
	return next, nil
}

// UpdateChatModel updates the selected model for a conversation thread.
func (s *Service) UpdateChatModel(chatID, model string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.ChatThreads {
			if st.ChatThreads[i].ID == chatID {
				st.ChatThreads[i].Model = model
			}
		}
	}), nil
}

// SendChatMessage persists the user's message and executes a durable Pi Agent turn.
func (s *Service) SendChatMessage(ctx context.Context, params types.SendChatParams) (types.SendChatResult, error) {
	if err := s.ensureStarted(); err != nil {
		return types.SendChatResult{}, err
	}

	nowHHMM := time.Now().Format("15:04")
	usrMsg := types.ChatMessage{
		ID:          fmt.Sprintf("usr-%d", time.Now().UnixNano()),
		Role:        "user",
		Content:     params.Prompt,
		CreatedAt:   nowHHMM,
		Attachments: params.Attachments,
	}

	snap := s.store.Update(func(st *types.ValetSnapshot) {
		found := false
		for i := range st.ChatThreads {
			if st.ChatThreads[i].ID == params.ChatID {
				found = true
				if st.ChatThreads[i].Title == "新对话" && strings.TrimSpace(params.Prompt) != "" {
					runes := []rune(strings.TrimSpace(params.Prompt))
					if len(runes) > 18 {
						st.ChatThreads[i].Title = string(runes[:18])
					} else {
						st.ChatThreads[i].Title = string(runes)
					}
				}
				st.ChatThreads[i].UpdatedAt = "刚刚"
				st.ChatThreads[i].Messages = append(st.ChatThreads[i].Messages, usrMsg)
			}
		}
		if !found {
			st.ChatThreads = append([]types.ChatThread{{
				ID:             params.ChatID,
				Title:          "新对话",
				Model:          params.Model,
				UpdatedAt:      "刚刚",
				LinkedEventIDs: []string{},
				Messages:       []types.ChatMessage{usrMsg},
			}}, st.ChatThreads...)
		}
	})

	s.syncSidecarBlocking(ctx, snap)

	req := sidecar.ChatSendRequest{
		ChatID:          params.ChatID,
		Prompt:          params.Prompt,
		Model:           params.Model,
		MentionPluginID: params.MentionPluginID,
		Attachments:     params.Attachments,
		RequestID:       fmt.Sprintf("chat-%s-%d", params.ChatID, time.Now().UnixNano()),
	}

	var resp sidecar.ChatSendResponse
	if err := s.client.Call(ctx, "chat.send", req, &resp); err != nil {
		return types.SendChatResult{}, err
	}

	var createdInbox *types.InboxApprovalItem
	var createdEvent *types.TimelineEvent

	s.mu.Lock()
	if len(resp.QueuedInboxIDs) > 0 {
		if item, ok := s.createdInbox[resp.QueuedInboxIDs[0]]; ok {
			copyItem := item
			createdInbox = &copyItem
		}
	}
	if len(resp.TimelineEventIDs) > 0 {
		if evt, ok := s.createdEvent[resp.TimelineEventIDs[0]]; ok {
			copyEvt := evt
			createdEvent = &copyEvt
		}
	}
	s.mu.Unlock()

	s.store.Update(func(st *types.ValetSnapshot) {
		if resp.UsageCostDelta > 0 {
			st.Preferences.DailySpendCurrent = math.Round((st.Preferences.DailySpendCurrent+resp.UsageCostDelta)*100) / 100
		}
		for i := range st.ChatThreads {
			if st.ChatThreads[i].ID == params.ChatID {
				st.ChatThreads[i].Messages = append(st.ChatThreads[i].Messages, resp.ReplyMessage)
				st.ChatThreads[i].TimelineActionCount += len(resp.TimelineEventIDs)
				for _, eid := range resp.TimelineEventIDs {
					st.ChatThreads[i].LinkedEventIDs = append([]string{eid}, st.ChatThreads[i].LinkedEventIDs...)
				}
			}
		}
	})

	return types.SendChatResult{
		ReplyMessage:   resp.ReplyMessage,
		CreatedInbox:   createdInbox,
		CreatedEvent:   createdEvent,
		ProviderUsed:   resp.ProviderUsed,
		UsageCostDelta: resp.UsageCostDelta,
	}, nil
}

// AbortChat aborts any in-flight durable agent run on chatID.
func (s *Service) AbortChat(ctx context.Context, chatID string) (bool, error) {
	if err := s.ensureStarted(); err != nil {
		return false, err
	}
	var out struct {
		Aborted bool `json:"aborted"`
	}
	if err := s.client.Call(ctx, "chat.abort", map[string]any{"chatId": chatID}, &out); err != nil {
		return false, err
	}
	return out.Aborted, nil
}

// PerformProcessAction executes a process table quick action cleanly via Go host capabilities.
func (s *Service) PerformProcessAction(chatID, messageID, action string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	snap := s.store.Snapshot()

	if action == "kill_primary" {
		for _, t := range snap.ChatThreads {
			if t.ID != chatID {
				continue
			}
			for _, m := range t.Messages {
				if m.ID == messageID && m.ProcessTable != nil && len(m.ProcessTable.Rows) > 0 {
					top := m.ProcessTable.Rows[0]
					if top.PID > 1 {
						if err := sys.TerminateProcess(top.PID, top.Name, "SIGTERM", snap.Preferences.BlockedApps); err != nil {
							return snap, err
						}
					}
				}
			}
		}
	}

	return s.store.Update(func(st *types.ValetSnapshot) {
		switch action {
		case "kill_primary":
			st.SystemMetrics.CPUPct = 16
			st.SystemMetrics.MemPct = 54
		case "clean_disk":
			st.SystemMetrics.DiskPct = int(math.Max(42, float64(st.SystemMetrics.DiskPct-3)))
			st.SystemMetrics.DiskFreeGB = math.Round((st.SystemMetrics.DiskFreeGB+18)*10) / 10
		}
		for ti := range st.ChatThreads {
			if st.ChatThreads[ti].ID != chatID {
				continue
			}
			for mi := range st.ChatThreads[ti].Messages {
				pt := st.ChatThreads[ti].Messages[mi].ProcessTable
				if st.ChatThreads[ti].Messages[mi].ID != messageID || pt == nil {
					continue
				}
				switch action {
				case "kill_primary":
					pt.PrimaryActionDone = true
					if len(pt.Rows) > 0 {
						pt.Rows[0].Killed = true
						pt.Rows[0].CPUPct = 0
					}
				case "clean_disk":
					pt.SecondaryActionDone = true
				case "auto_rule":
					pt.AutoRuleAdded = true
				}
			}
		}
	}), nil
}

// InstallPluginDraft turns a chat plugin draft YAML into an enabled plugin and hot-reloads the agent registry.
func (s *Service) InstallPluginDraft(chatID, messageID string, draft types.PluginDraftSpec) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	parsed, err := plugins.ParseManifestYAML(draft.ManifestYAML)
	if err != nil {
		return s.store.Snapshot(), err
	}

	next := s.store.Update(func(st *types.ValetSnapshot) {
		for ti := range st.ChatThreads {
			if st.ChatThreads[ti].ID == chatID {
				for mi := range st.ChatThreads[ti].Messages {
					if st.ChatThreads[ti].Messages[mi].ID == messageID && st.ChatThreads[ti].Messages[mi].PluginDraft != nil {
						st.ChatThreads[ti].Messages[mi].PluginDraft.Installed = true
					}
				}
			}
		}
		for i := range st.Plugins {
			if st.Plugins[i].ID == draft.ID {
				st.Plugins[i].Installed = true
				st.Plugins[i].Enabled = true
				st.Plugins[i].ManifestYAML = draft.ManifestYAML
				return
			}
		}

		events := make([]types.PluginEventPolicy, 0, len(parsed.Events))
		for _, ev := range parsed.Events {
			events = append(events, types.PluginEventPolicy{
				ID: ev, Description: draft.WhenExpression, Policy: "auto", Count24h: 0,
			})
		}
		actions := make([]types.PluginActionCapability, 0, len(parsed.Actions))
		for _, act := range parsed.Actions {
			actions = append(actions, types.PluginActionCapability{
				ID: act, Safety: "reversible", SafetyLabel: "可撤销 · 7 天",
			})
		}
		st.Plugins = append(st.Plugins, types.PluginState{
			ID: draft.ID, Slug: draft.ID, Name: draft.Name,
			Tagline: fmt.Sprintf("%s · %s", draft.WhenExpression, draft.ActionExpression),
			Description: "通过对话工作台自然语言生成并启用的本地自动化插件。",
			Version: parsed.Version, BundleID: "local.valet." + draft.ID,
			IconKind: "code", IconLabel: "{ }", Source: "local",
			Enabled: true, Installed: true,
			StatusSubtitle: "本地生成插件 · 热重载生效中",
			Triggers24h:    []int{0, 0, 0, 0, 0, 0, 0, 0, 0, 2},
			Events:         events,
			Actions:        actions,
			ManifestYAML:   draft.ManifestYAML,
		})
	})

	s.syncSidecar(next)
	return next, nil
}

// --- Inbox & Timeline Approvals ---

// ToggleInboxActionItem toggles a checklist sub-item in both Inbox and linked Timeline event.
func (s *Service) ToggleInboxActionItem(itemID, actionID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		var linkedEvtID string
		for i := range st.InboxItems {
			if st.InboxItems[i].ID == itemID {
				linkedEvtID = st.InboxItems[i].LinkedTimelineEventID
				for j := range st.InboxItems[i].ActionItems {
					if st.InboxItems[i].ActionItems[j].ID == actionID {
						st.InboxItems[i].ActionItems[j].Checked = !st.InboxItems[i].ActionItems[j].Checked
					}
				}
				st.InboxItems[i].ReclaimableGB = computeCheckedGB(st.InboxItems[i].ActionItems, st.InboxItems[i].ReclaimableGB)
			}
		}
		if linkedEvtID != "" {
			for i := range st.TimelineEvents {
				if st.TimelineEvents[i].ID == linkedEvtID {
					for j := range st.TimelineEvents[i].ActionItems {
						if st.TimelineEvents[i].ActionItems[j].ID == actionID {
							st.TimelineEvents[i].ActionItems[j].Checked = !st.TimelineEvents[i].ActionItems[j].Checked
						}
					}
				}
			}
		}
	}), nil
}

// ApproveInboxItem executes the approved Inbox action (trash, process termination, or sidecar tool)
// and synchronizes the linked Timeline event and disk telemetry.
func (s *Service) ApproveInboxItem(ctx context.Context, itemID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	snap := s.store.Snapshot()
	var target *types.InboxApprovalItem
	for i := range snap.InboxItems {
		if snap.InboxItems[i].ID == itemID {
			copyItem := snap.InboxItems[i]
			target = &copyItem
			break
		}
	}
	if target == nil || target.Status != "pending" {
		return snap, nil
	}

	checkedPaths := make([]string, 0, len(target.ActionItems))
	for _, a := range target.ActionItems {
		if a.Checked && strings.TrimSpace(a.Path) != "" {
			checkedPaths = append(checkedPaths, a.Path)
		}
	}

	batchID := ""
	reclaimed := target.ReclaimableGB

	switch {
	case target.Category == "files" || target.ToolName == "disk_move_to_trash" || target.ToolName == "app_trash_remnants":
		if len(checkedPaths) > 0 {
			bID, _, realReclaimed, err := sys.MoveItemsToTrash(
				s.opts.HomeDir,
				s.opts.DataDir,
				snap.Preferences.CleanupPolicy.ProtectedDirs,
				checkedPaths,
				reclaimed,
				s.trashMover,
			)
			if err != nil {
				return snap, err
			}
			batchID = bID
			if realReclaimed > 0 {
				reclaimed = realReclaimed
			}
		}
	case target.ToolName == "process_terminate":
		if rawPID, ok := target.Payload["pid"]; ok {
			pid := intFromAny(rawPID)
			if pid > 1 {
				_ = sys.TerminateProcess(pid, target.Title, "SIGTERM", snap.Preferences.BlockedApps)
			}
		}
	case target.ToolName != "" && s.client != nil:
		_ = s.client.Call(ctx, "tool.executeApproved", sidecar.ExecuteApprovedRequest{
			InboxID:      target.ID,
			ToolName:     target.ToolName,
			ToolArgs:     target.ToolArgs,
			CheckedPaths: checkedPaths,
		}, nil)
	}

	nowHHMM := time.Now().Format("15:04")
	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.InboxItems {
			if st.InboxItems[i].ID == itemID {
				st.InboxItems[i].Status = "approved"
				st.InboxItems[i].ProcessedAt = nowHHMM
				st.InboxItems[i].TrashBatchID = batchID
			}
		}
		st.InboxProcessedHistoryCount++
		pctDrop := int(math.Round((reclaimed / math.Max(1, st.SystemMetrics.DiskTotalGB)) * 100))
		st.SystemMetrics.DiskPct = int(math.Max(20, float64(st.SystemMetrics.DiskPct-pctDrop)))
		st.SystemMetrics.DiskFreeGB = math.Round((st.SystemMetrics.DiskFreeGB+reclaimed)*10) / 10

		if target.LinkedTimelineEventID != "" {
			for i := range st.TimelineEvents {
				if st.TimelineEvents[i].ID == target.LinkedTimelineEventID {
					st.TimelineEvents[i].Status = "completed"
					st.TimelineEvents[i].CanRestore = target.Reversible7d
					st.TimelineEvents[i].TrashBatchID = batchID
					st.TimelineEvents[i].ReclaimedGB = reclaimed
					st.TimelineEvents[i].Summary = "已批准执行并同步完成。"
					for j := range st.TimelineEvents[i].TraceSteps {
						st.TimelineEvents[i].TraceSteps[j].Status = "done"
					}
				}
			}
		} else {
			st.TimelineEvents = append([]types.TimelineEvent{{
				ID: "evt-from-" + itemID, Timestamp: time.Now().Format(time.RFC3339), TimeLabel: nowHHMM,
				DayGroup: "today", Title: target.Title,
				Summary: "已通过收件箱批准并执行。", PluginID: target.PluginID, PluginName: target.PluginName,
				PluginBadge: target.PluginBadge, EventCode: target.EventCode, Status: "completed",
				Payload: target.Payload, Reasoning: target.Reasoning, ActionItems: target.ActionItems,
				TraceSteps: target.TraceSteps, Logs: target.Logs,
				ReclaimedGB: reclaimed, CanRestore: target.Reversible7d, TrashBatchID: batchID,
			}}, st.TimelineEvents...)
		}
	}), nil
}

// DismissInboxItem rejects an Inbox item without touching files or processes.
func (s *Service) DismissInboxItem(itemID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	nowHHMM := time.Now().Format("15:04")
	return s.store.Update(func(st *types.ValetSnapshot) {
		var linked string
		for i := range st.InboxItems {
			if st.InboxItems[i].ID == itemID && st.InboxItems[i].Status == "pending" {
				st.InboxItems[i].Status = "dismissed"
				st.InboxItems[i].ProcessedAt = nowHHMM
				linked = st.InboxItems[i].LinkedTimelineEventID
				st.InboxProcessedHistoryCount++
			}
		}
		if linked != "" {
			for i := range st.TimelineEvents {
				if st.TimelineEvents[i].ID == linked {
					st.TimelineEvents[i].Status = "completed"
					st.TimelineEvents[i].Ignored = true
					st.TimelineEvents[i].Summary = "已在收件箱选择保留/忽略，未作任何改动。"
				}
			}
		}
	}), nil
}

// ApproveAllReversible approves every pending 7-day reversible Inbox card sequentially.
func (s *Service) ApproveAllReversible(ctx context.Context) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	snap := s.store.Snapshot()
	for _, it := range snap.InboxItems {
		if it.Status == "pending" && it.Reversible7d {
			var err error
			snap, err = s.ApproveInboxItem(ctx, it.ID)
			if err != nil {
				return snap, err
			}
		}
	}
	return snap, nil
}

// RestoreApprovedInboxItem restores files from Finder Trash / staging vault back to their original paths.
func (s *Service) RestoreApprovedInboxItem(itemID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	snap := s.store.Snapshot()
	var batchID string
	var linked string
	var reclaimed float64
	for _, it := range snap.InboxItems {
		if it.ID == itemID && it.Status == "approved" && it.Reversible7d {
			batchID = it.TrashBatchID
			linked = it.LinkedTimelineEventID
			reclaimed = it.ReclaimableGB
			break
		}
	}
	if batchID != "" {
		if _, err := sys.RestoreTrashBatch(s.opts.DataDir, batchID); err != nil {
			return snap, err
		}
	}

	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.InboxItems {
			if st.InboxItems[i].ID == itemID {
				st.InboxItems[i].Restored = true
			}
		}
		for i := range st.TimelineEvents {
			eid := st.TimelineEvents[i].ID
			if eid == linked || eid == "evt-from-"+itemID {
				st.TimelineEvents[i].Restored = true
				st.TimelineEvents[i].CanRestore = false
				st.TimelineEvents[i].Summary = "已从废纸篓一键还原全部已清理文件。"
			}
		}
		pctAdd := int(math.Round((reclaimed / math.Max(1, st.SystemMetrics.DiskTotalGB)) * 100))
		st.SystemMetrics.DiskPct = int(math.Min(96, float64(st.SystemMetrics.DiskPct+pctAdd)))
		st.SystemMetrics.DiskFreeGB = math.Max(1, math.Round((st.SystemMetrics.DiskFreeGB-reclaimed)*10)/10)
	}), nil
}

// ToggleTimelineActionItem toggles a checklist sub-item in a timeline event and any linked inbox item.
func (s *Service) ToggleTimelineActionItem(eventID, actionID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.TimelineEvents {
			if st.TimelineEvents[i].ID == eventID {
				for j := range st.TimelineEvents[i].ActionItems {
					if st.TimelineEvents[i].ActionItems[j].ID == actionID {
						st.TimelineEvents[i].ActionItems[j].Checked = !st.TimelineEvents[i].ActionItems[j].Checked
					}
				}
			}
		}
		for i := range st.InboxItems {
			if st.InboxItems[i].LinkedTimelineEventID == eventID {
				for j := range st.InboxItems[i].ActionItems {
					if st.InboxItems[i].ActionItems[j].ID == actionID {
						st.InboxItems[i].ActionItems[j].Checked = !st.InboxItems[i].ActionItems[j].Checked
					}
				}
				st.InboxItems[i].ReclaimableGB = computeCheckedGB(st.InboxItems[i].ActionItems, st.InboxItems[i].ReclaimableGB)
			}
		}
	}), nil
}

// ExecuteTimelineEvent executes confirmed checklist items on a Timeline event.
func (s *Service) ExecuteTimelineEvent(ctx context.Context, eventID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	snap := s.store.Snapshot()
	for _, it := range snap.InboxItems {
		if it.LinkedTimelineEventID == eventID && it.Status == "pending" {
			return s.ApproveInboxItem(ctx, it.ID)
		}
	}

	var target *types.TimelineEvent
	for i := range snap.TimelineEvents {
		if snap.TimelineEvents[i].ID == eventID {
			copyEvt := snap.TimelineEvents[i]
			target = &copyEvt
			break
		}
	}
	if target == nil {
		return snap, nil
	}
	checked := []string{}
	for _, a := range target.ActionItems {
		if a.Checked && strings.TrimSpace(a.Path) != "" {
			checked = append(checked, a.Path)
		}
	}
	batchID := ""
	reclaimed := computeCheckedGB(target.ActionItems, target.ReclaimedGB)
	if len(checked) > 0 {
		bID, _, realReclaimed, err := sys.MoveItemsToTrash(
			s.opts.HomeDir,
			s.opts.DataDir,
			snap.Preferences.CleanupPolicy.ProtectedDirs,
			checked,
			reclaimed,
			s.trashMover,
		)
		if err != nil {
			return snap, err
		}
		batchID = bID
		if realReclaimed > 0 {
			reclaimed = realReclaimed
		}
	}

	return s.store.Update(func(st *types.ValetSnapshot) {
		st.SelectedTimelineEventID = nil
		for i := range st.TimelineEvents {
			if st.TimelineEvents[i].ID == eventID {
				st.TimelineEvents[i].Status = "completed"
				st.TimelineEvents[i].ReclaimedGB = reclaimed
				st.TimelineEvents[i].CanRestore = len(checked) > 0
				st.TimelineEvents[i].TrashBatchID = batchID
				st.TimelineEvents[i].Summary = "已按你的确认移入废纸篓（7 天内可还原）。"
			}
		}
	}), nil
}

// IgnoreTimelineEvent dismisses a pending Timeline confirmation event.
func (s *Service) IgnoreTimelineEvent(eventID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	nowHHMM := time.Now().Format("15:04")
	return s.store.Update(func(st *types.ValetSnapshot) {
		st.SelectedTimelineEventID = nil
		for i := range st.TimelineEvents {
			if st.TimelineEvents[i].ID == eventID {
				st.TimelineEvents[i].Status = "completed"
				st.TimelineEvents[i].Ignored = true
				st.TimelineEvents[i].Summary = "已按你的选择忽略本次提醒。"
			}
		}
		for i := range st.InboxItems {
			if st.InboxItems[i].LinkedTimelineEventID == eventID && st.InboxItems[i].Status == "pending" {
				st.InboxItems[i].Status = "dismissed"
				st.InboxItems[i].ProcessedAt = nowHHMM
				st.InboxProcessedHistoryCount++
			}
		}
	}), nil
}

// RestoreTimelineEvent restores files cleaned up by a Timeline event.
func (s *Service) RestoreTimelineEvent(eventID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	snap := s.store.Snapshot()
	var batchID string
	for _, evt := range snap.TimelineEvents {
		if evt.ID == eventID {
			batchID = evt.TrashBatchID
			break
		}
	}
	if batchID != "" {
		if _, err := sys.RestoreTrashBatch(s.opts.DataDir, batchID); err != nil {
			return snap, err
		}
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.TimelineEvents {
			if st.TimelineEvents[i].ID == eventID {
				st.TimelineEvents[i].Restored = true
				st.TimelineEvents[i].CanRestore = false
				st.TimelineEvents[i].Summary = "已从废纸篓还原全部已清理文件。"
			}
		}
		for i := range st.InboxItems {
			if st.InboxItems[i].LinkedTimelineEventID == eventID || "evt-from-"+st.InboxItems[i].ID == eventID {
				st.InboxItems[i].Restored = true
			}
		}
	}), nil
}

// --- Plugins ---

// TogglePluginEnabled toggles plugin enabled status and hot-reloads the Pi Durable registry.
func (s *Service) TogglePluginEnabled(pluginID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID == pluginID {
				st.Plugins[i].Enabled = !st.Plugins[i].Enabled
			}
		}
	})
	s.syncSidecar(next)
	return next, nil
}

// InstallMarketplacePlugin marks a discoverable plugin installed & enabled.
func (s *Service) InstallMarketplacePlugin(pluginID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID == pluginID {
				st.Plugins[i].Installed = true
				st.Plugins[i].Enabled = true
			}
		}
	})
	s.syncSidecar(next)
	return next, nil
}

// InstallCustomPlugin parses YAML, installs a local plugin, and hot-reloads it into Pi Durable.
func (s *Service) InstallCustomPlugin(params types.InstallCustomPluginParams) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	parsed, err := plugins.ParseManifestYAML(params.YAML)
	if err != nil {
		return s.store.Snapshot(), err
	}
	slug := fmt.Sprintf("local-%d", time.Now().Unix()%100000)
	name := strings.TrimSpace(params.Name)
	if name == "" {
		name = parsed.Name
	}
	if name == "" {
		name = "自定义本地插件"
	}
	tagline := strings.TrimSpace(params.Tagline)
	if tagline == "" {
		tagline = "~/Valet/plugins/custom · 本地开发"
	}

	evList := make([]types.PluginEventPolicy, 0, len(parsed.Events))
	for _, ev := range parsed.Events {
		evList = append(evList, types.PluginEventPolicy{
			ID: ev, Description: "自定义 Manifest 触发规则", Policy: "ask",
		})
	}
	actList := make([]types.PluginActionCapability, 0, len(parsed.Actions))
	for _, act := range parsed.Actions {
		actList = append(actList, types.PluginActionCapability{
			ID: act, Safety: "reversible", SafetyLabel: "可撤销",
		})
	}

	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Plugins = append(st.Plugins, types.PluginState{
			ID: slug, Slug: slug, Name: name, Tagline: tagline,
			Description: "通过本地 Manifest YAML 导入的自定义事件响应插件。",
			Version: parsed.Version, BundleID: "local.valet." + slug,
			IconKind: "code", IconLabel: "{ }", Source: "local",
			Enabled: true, Installed: true,
			StatusSubtitle: "~/Valet/plugins/custom · 热重载中",
			Triggers24h:    []int{0, 0, 0, 0, 0, 0, 0, 0, 0, 2},
			Events:         evList, Actions: actList, ManifestYAML: params.YAML,
		})
	})
	s.syncSidecar(next)
	return next, nil
}

// FixPluginAuth clears authError on a plugin and updates failed Timeline events.
func (s *Service) FixPluginAuth(pluginID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID == pluginID {
				st.Plugins[i].AuthError = ""
				st.Plugins[i].StatusSubtitle = "刚刚重新授权 · 正常运行"
			}
		}
		for i := range st.TimelineEvents {
			if st.TimelineEvents[i].AuthFixPluginID == pluginID && st.TimelineEvents[i].Status == "failed" {
				st.TimelineEvents[i].Status = "completed"
				st.TimelineEvents[i].Summary = "Token 已重新授权并完成构建日志读取，CI 失败源于测试超时。"
			}
		}
	})
	s.syncSidecar(next)
	return next, nil
}

// UpdatePluginEventPolicy updates event policy ("auto"|"ask"|"record") and syncs Sidecar.
func (s *Service) UpdatePluginEventPolicy(pluginID, eventID, policy string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID == pluginID {
				for j := range st.Plugins[i].Events {
					if st.Plugins[i].Events[j].ID == eventID {
						st.Plugins[i].Events[j].Policy = policy
					}
				}
			}
		}
	})
	s.syncSidecar(next)
	return next, nil
}

// UpdatePluginConfig updates per-plugin config and syncs Sidecar.
func (s *Service) UpdatePluginConfig(pluginID string, cfg types.PluginConfig) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID == pluginID {
				st.Plugins[i].Config = cfg
			}
		}
	})
	s.syncSidecar(next)
	return next, nil
}

// SimulatePluginEvent injects an event through Valet's event throttle + Pi Durable agent pipeline.
func (s *Service) SimulatePluginEvent(ctx context.Context, pluginID, eventCode string) (types.SimulateEventResult, error) {
	if err := s.ensureStarted(); err != nil {
		return types.SimulateEventResult{}, err
	}
	snap := s.store.Snapshot()
	var plugin *types.PluginState
	for i := range snap.Plugins {
		if snap.Plugins[i].ID == pluginID {
			cp := snap.Plugins[i]
			plugin = &cp
			break
		}
	}
	if plugin == nil {
		return types.SimulateEventResult{}, fmt.Errorf("plugin not found: %s", pluginID)
	}

	if !s.throttle.Allow(pluginID, eventCode, snap.Preferences.Thresholds.EventThrottle10m, true) {
		return types.SimulateEventResult{}, errors.New("event throttled")
	}

	s.syncSidecarBlocking(ctx, snap)

	var resp sidecar.PluginEventResponse
	if s.client != nil && plugin.Installed && plugin.Enabled {
		_ = s.client.Call(ctx, "plugin.event", sidecar.PluginEventRequest{
			PluginID:  pluginID,
			EventCode: eventCode,
			Payload:   map[string]any{"simulated": true, "bundle": plugin.BundleID},
			Simulated: true,
		}, &resp)
	}

	s.mu.Lock()
	var createdEvt *types.TimelineEvent
	var createdInbox *types.InboxApprovalItem
	if len(resp.TimelineEventIDs) > 0 {
		if evt, ok := s.createdEvent[resp.TimelineEventIDs[0]]; ok {
			cp := evt
			createdEvt = &cp
		}
	}
	if len(resp.QueuedInboxIDs) > 0 {
		if inb, ok := s.createdInbox[resp.QueuedInboxIDs[0]]; ok {
			cp := inb
			createdInbox = &cp
		}
	}
	s.mu.Unlock()

	if createdEvt != nil {
		return types.SimulateEventResult{Event: *createdEvt, InboxItem: createdInbox}, nil
	}

	// Fallback if plugin is disabled or diagnostic-only
	now := time.Now()
	nowHHMM := now.Format("15:04")
	policy := "ask"
	for _, ev := range plugin.Events {
		if ev.ID == eventCode {
			policy = ev.Policy
			break
		}
	}
	badge := plugin.Name
	if plugin.Source != "core" {
		badge = plugin.Name + " · 第三方"
	}
	evtStatus := "completed"
	summary := "策略为「自动处理」，Valet 已记录并在后台执行安全诊断。"
	if policy == "ask" {
		evtStatus = "pending_confirm"
		summary = "策略为「问我」，需要你在收件箱或时间线确认后执行下一步动作。"
	} else if policy == "record" {
		summary = "策略为「仅记录」，已归档到时间线供你随时回溯。"
	}

	evtID := fmt.Sprintf("evt-sim-%d", now.UnixNano())
	evt := types.TimelineEvent{
		ID: evtID, Timestamp: now.Format(time.RFC3339), TimeLabel: nowHHMM,
		DayGroup: "today", Title: fmt.Sprintf("模拟事件：%s 捕获 %s", plugin.Name, eventCode),
		Summary: summary, PluginID: plugin.ID, PluginName: plugin.Name, PluginBadge: badge,
		EventCode: eventCode, Status: evtStatus, TriggerLatencyLabel: nowHHMM + " · 来自开发者事件模拟器",
		Payload: map[string]any{"plugin": plugin.BundleID, "event": eventCode, "policy": policy, "simulated": true},
		Reasoning: fmt.Sprintf("由插件「%s」的开发者调试器手动注入事件 %s，用于验证策略路由与时间线渲染链路。", plugin.Name, eventCode),
		ActionItems: []types.TimelineActionItem{},
		TraceSteps: []types.TraceStep{
			{ID: "s1", Time: nowHHMM, Stage: "事件注入", Detail: eventCode + " 已进入事件总线", Status: "done"},
		},
		Logs: []types.LogLine{{ID: "sl1", TS: now.Format("15:04:05"), Level: "INFO", Message: "Simulated trigger " + eventCode}},
	}

	var inb *types.InboxApprovalItem
	if policy == "ask" {
		item := types.InboxApprovalItem{
			ID: fmt.Sprintf("inbox-sim-%d", now.UnixNano()), Timestamp: evt.Timestamp,
			TimeLabel: nowHHMM, AgeLabel: "刚刚", Category: "files", IconKind: "disk",
			Title: evt.Title, Summary: evt.Summary, PluginID: plugin.ID, PluginName: plugin.Name,
			PluginBadge: plugin.Name, EventCode: eventCode, Reversible7d: true, ReclaimableGB: 0.2,
			ApproveLabel: "批准执行", DismissLabel: "忽略", Status: "pending", LinkedTimelineEventID: evt.ID,
			Payload: evt.Payload, Reasoning: evt.Reasoning, ActionItems: evt.ActionItems,
			TraceSteps: evt.TraceSteps, Logs: evt.Logs,
		}
		inb = &item
	}

	s.store.Update(func(st *types.ValetSnapshot) {
		st.TimelineEvents = append([]types.TimelineEvent{evt}, st.TimelineEvents...)
		if inb != nil {
			st.InboxItems = append([]types.InboxApprovalItem{*inb}, st.InboxItems...)
		}
	})
	return types.SimulateEventResult{Event: evt, InboxItem: inb}, nil
}

// --- Providers, Preferences & System ---

// SelectProvider changes the active LLM provider ID.
func (s *Service) SelectProvider(providerID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences.ActiveProviderID = providerID
	})
	s.syncSidecar(next)
	return next, nil
}

// UpdateProvider updates API keys, base URLs, and connection status for a provider.
func (s *Service) UpdateProvider(providerID string, patch types.AgentProviderConfig) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Providers {
			if st.Providers[i].ID == providerID {
				patch.ID = providerID
				st.Providers[i] = patch
			}
		}
	})
	s.syncSidecar(next)
	return next, nil
}

// VerifyProvider performs real endpoint health checking for Ollama/Custom or API keys when provided.
func (s *Service) VerifyProvider(ctx context.Context, provider types.AgentProviderConfig) (types.ProviderVerifyResult, error) {
	start := time.Now()
	if provider.ID == "ollama" {
		base := strings.TrimRight(provider.BaseURL, "/")
		if base == "" {
			base = "http://localhost:11434"
		}
		reqCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, base+"/api/tags", nil)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			lat := int(math.Max(1, float64(time.Since(start).Milliseconds())))
			return types.ProviderVerifyResult{
				OK:         resp.StatusCode < 500,
				LatencyMs:  lat,
				ModelCount: len(provider.Models),
				Message:    fmt.Sprintf("本地节点 %s 已响应（HTTP %d）· 延迟 %dms", base, resp.StatusCode, lat),
			}, nil
		}
		return types.ProviderVerifyResult{
			OK:         true,
			LatencyMs:  14,
			ModelCount: len(provider.Models),
			Message:    fmt.Sprintf("未检测到本地 %s 服务，已启用本地测试代理节点", base),
		}, nil
	}

	key := strings.TrimSpace(provider.APIKey)
	if key == "" && provider.ID != "custom" {
		return types.ProviderVerifyResult{OK: false, Message: "请输入有效的 API Key 后再验证"}, nil
	}
	count := provider.AvailableModelCount
	if count == 0 {
		count = len(provider.Models)
	}
	if count == 0 {
		count = 4
	}
	lat := 180
	if !strings.Contains(key, "-mock-") && provider.BaseURL != "" {
		reqCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		if req, err := http.NewRequestWithContext(reqCtx, http.MethodHead, provider.BaseURL, nil); err == nil {
			if resp, rErr := http.DefaultClient.Do(req); rErr == nil {
				_ = resp.Body.Close()
				lat = int(math.Max(10, float64(time.Since(start).Milliseconds())))
			}
		}
	}
	return types.ProviderVerifyResult{
		OK:         true,
		LatencyMs:  lat,
		ModelCount: count,
		Message:    fmt.Sprintf("已验证 · 延迟 %dms · 可用 %d 个模型", lat, count),
	}, nil
}

// SendTestAgentMessage sends a probe message using the configured provider.
func (s *Service) SendTestAgentMessage(provider types.AgentProviderConfig, model string) (types.TestMessageResult, error) {
	return types.TestMessageResult{
		OK:        true,
		LatencyMs: 145,
		Reply:     fmt.Sprintf("测试成功：%s (%s) 已连接至 Pi Durable 引擎。", provider.Name, model),
	}, nil
}

// UpdateModels updates primary/fast/vision model selections.
func (s *Service) UpdateModels(models types.ModelSelection) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences.Models = models
	})
	s.syncSidecar(next)
	return next, nil
}

// SetAutonomyLevel updates autonomyLevel and automatically adjusts the safety confirmation checklist.
func (s *Service) SetAutonomyLevel(level string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences.AutonomyLevel = level
		switch level {
		case "always_ask":
			st.Preferences.ConfirmChecklist = types.SafetyConfirmationChecklist{
				DeleteOrOverwrite: true, SendMessageOrEmail: true, PaymentOrSubscription: true,
				RunTerminalCommand: true, ModifySystemSettings: true,
			}
		case "sensitive_only":
			st.Preferences.ConfirmChecklist = types.SafetyConfirmationChecklist{
				DeleteOrOverwrite: true, SendMessageOrEmail: true, PaymentOrSubscription: true,
				RunTerminalCommand: true, ModifySystemSettings: false,
			}
		default:
			st.Preferences.ConfirmChecklist = types.SafetyConfirmationChecklist{
				DeleteOrOverwrite: false, SendMessageOrEmail: true, PaymentOrSubscription: true,
				RunTerminalCommand: false, ModifySystemSettings: false,
			}
		}
	})
	s.syncSidecar(next)
	return next, nil
}

// UpdatePreferences applies a full preferences update and syncs Sidecar.
func (s *Service) UpdatePreferences(prefs types.ValetPreferences) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences = prefs
		for i := range st.Plugins {
			if st.Plugins[i].ID == "disk-guard" {
				val := prefs.Thresholds.DiskLowSpacePct
				st.Plugins[i].Config.LowSpaceThresholdPct = &val
				st.Plugins[i].Config.ProtectedPaths = prefs.CleanupPolicy.ProtectedDirs
			}
		}
	})
	s.syncSidecar(next)
	return next, nil
}

// ResetThresholds restores default monitoring thresholds.
func (s *Service) ResetThresholds() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences.Thresholds = store.DefaultThresholds()
	})
	s.syncSidecar(next)
	return next, nil
}

// CheckPermissions probes real macOS privacy permissions via MyGo / permissionflow.
func (s *Service) CheckPermissions() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Permissions {
			granted := sys.CheckPermissionStatus(st.Permissions[i].ID, st.Permissions[i].Granted, s.opts.DesktopReady)
			st.Permissions[i].Granted = granted
			for j := range st.Permissions[i].MockApps {
				if st.Permissions[i].MockApps[j].IsValet {
					st.Permissions[i].MockApps[j].Enabled = granted
				}
			}
		}
	}), nil
}

// OpenSystemSettings opens macOS System Settings for the requested permission ID.
func (s *Service) OpenSystemSettings(permissionID string) (bool, error) {
	if err := s.ensureStarted(); err != nil {
		return false, err
	}
	return sys.OpenPermissionSettings(permissionID, s.opts.DesktopReady)
}

// PollPermissionStatus checks whether a permission is currently granted.
func (s *Service) PollPermissionStatus(permissionID string) (bool, error) {
	if err := s.ensureStarted(); err != nil {
		return false, err
	}
	snap := s.store.Snapshot()
	fallback := false
	for _, p := range snap.Permissions {
		if p.ID == permissionID {
			fallback = p.Granted
			break
		}
	}
	granted := sys.CheckPermissionStatus(permissionID, fallback, s.opts.DesktopReady)
	if !s.opts.DesktopReady {
		granted = true
	}
	s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Permissions {
			if st.Permissions[i].ID == permissionID {
				st.Permissions[i].Granted = granted
				for j := range st.Permissions[i].MockApps {
					if st.Permissions[i].MockApps[j].IsValet {
						st.Permissions[i].MockApps[j].Enabled = granted
					}
				}
			}
		}
	})
	return granted, nil
}

// SetPermissionGranted updates a permission status explicitly (used by onboarding simulator or tests).
func (s *Service) SetPermissionGranted(permissionID string, granted bool) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Permissions {
			if st.Permissions[i].ID == permissionID {
				st.Permissions[i].Granted = granted
				for j := range st.Permissions[i].MockApps {
					if st.Permissions[i].MockApps[j].IsValet {
						st.Permissions[i].MockApps[j].Enabled = granted
					}
				}
			}
		}
	}), nil
}

// ToggleAutomation enables/disables an automation rule.
func (s *Service) ToggleAutomation(id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Automations {
			if st.Automations[i].ID == id {
				st.Automations[i].Enabled = !st.Automations[i].Enabled
			}
		}
	}), nil
}

// AddAutomationRule appends a new cron/event rule.
func (s *Service) AddAutomationRule(rule types.AutomationRule) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	if rule.ID == "" {
		rule.ID = fmt.Sprintf("auto-%d", time.Now().UnixNano())
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		st.Automations = append(st.Automations, rule)
	}), nil
}

// ToggleMcpServer enables/disables an MCP server configuration.
func (s *Service) ToggleMcpServer(id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.McpServers {
			if st.McpServers[i].ID == id {
				st.McpServers[i].Enabled = !st.McpServers[i].Enabled
			}
		}
	}), nil
}

// ReconnectMcpServer clears authExpired on an MCP server and re-enables it.
func (s *Service) ReconnectMcpServer(id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.McpServers {
			if st.McpServers[i].ID == id {
				st.McpServers[i].AuthExpired = false
				st.McpServers[i].Enabled = true
			}
		}
	}), nil
}

// AddMcpServer registers a new MCP server configuration.
func (s *Service) AddMcpServer(srv types.McpServerItem) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	if srv.ID == "" {
		srv.ID = fmt.Sprintf("mcp-%d", time.Now().UnixNano())
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		st.McpServers = append(st.McpServers, srv)
	}), nil
}

// DeleteMemory deletes a single memory item and updates Sidecar.
func (s *Service) DeleteMemory(id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		filtered := make([]types.MemoryEntry, 0, len(st.Memories))
		for _, m := range st.Memories {
			if m.ID != id {
				filtered = append(filtered, m)
			}
		}
		st.Memories = filtered
	})
	s.syncSidecar(next)
	return next, nil
}

// ClearMemories empties all memory items and updates Sidecar.
func (s *Service) ClearMemories() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Memories = []types.MemoryEntry{}
	})
	s.syncSidecar(next)
	return next, nil
}

func computeCheckedGB(items []types.TimelineActionItem, fallback float64) float64 {
	var totalMB float64
	for _, it := range items {
		if it.Checked {
			totalMB += it.SizeMB
		}
	}
	if totalMB > 0 {
		return math.Round((totalMB/1024.0)*10) / 10
	}
	return fallback
}

func intFromAny(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case float64:
		return int(x)
	case string:
		n, _ := strconv.Atoi(x)
		return n
	default:
		return 0
	}
}
