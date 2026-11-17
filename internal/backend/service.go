package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
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

// StartOptions configures backend directories, native callbacks, and runtime flags.
type StartOptions struct {
	DataDir      string
	HomeDir      string
	ResourcesDir string
	RepoRoot     string
	DesktopReady bool
	UseVaultOnly bool // true in tests to avoid touching user's real Finder Trash
	WatchDir     plugins.WatchDirFunc
	OnNotify     func(kind, title, subtitle, body string)
	OnSyncTray   func(show bool, paused bool)
	OnSyncLogin  func(launchAtLogin bool)
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
	engine       *plugins.Engine
	stopMetrics  chan struct{}
	trashMover   sys.TrashMover
	createdInbox map[string]types.InboxApprovalItem
	createdEvent map[string]types.TimelineEvent
}

// NewService constructs a zero-I/O Service safe to pass to mygo.Bind before App.Run / MYGO_GENERATE.
func NewService() *Service {
	return &Service{
		createdInbox: make(map[string]types.InboxApprovalItem),
		createdEvent: make(map[string]types.TimelineEvent),
	}
}

// StartService opens durable storage, initializes telemetry, and starts the Pi Durable sidecar.
func StartService(s *Service, opts StartOptions) error {
	return s.start(opts)
}

// CloseService shuts down background tickers, plugin sensors, and the Pi Durable sidecar cleanly.
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

	st, err := store.OpenWithOptions(opts.DataDir, opts.HomeDir, opts.DesktopReady)
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

	eng := plugins.NewEngine(plugins.EngineConfig{
		HomeDir:    opts.HomeDir,
		DataDir:    opts.DataDir,
		WatchDir:   opts.WatchDir,
		TrashMover: mover,
		OnTrigger:  s.handlePluginEngineTrigger,
	})

	client := sidecar.NewClient(
		opts.ResourcesDir,
		opts.RepoRoot,
		s.handleSidecarHostRequest,
		s.handleSidecarNotify,
	)

	s.opts = opts
	s.store = st
	s.client = client
	s.engine = eng
	s.trashMover = mover
	s.stopMetrics = make(chan struct{})
	s.started = true
	s.mu.Unlock()

	// Hydrate secrets from OS Keychain and probe live privacy permissions when in desktop app
	if opts.DesktopReady {
		s.hydrateSecretsFromKeychain()
	}
	s.refreshPermissionsOnStartup()
	s.refreshHostMetrics()

	snap := st.Snapshot()
	if opts.OnSyncTray != nil {
		opts.OnSyncTray(snap.Preferences.ShowMenuBarIcon, snap.IsPaused)
	}
	if opts.OnSyncLogin != nil {
		opts.OnSyncLogin(snap.Preferences.LaunchAtLogin)
	}

	// Launch and initialize Pi Durable sidecar
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	initParams := sidecar.InitParams{
		DBPath: filepath.Join(opts.DataDir, "pi-agent.sqlite"),
		State:  s.buildSyncState(snap),
	}
	if err := client.Call(ctx, "agent.init", initParams, nil); err != nil {
		fmt.Fprintf(os.Stderr, "[valet] initial sidecar init error: %v\n", err)
	}

	eng.Sync(snap)

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
	eng := s.engine
	s.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}
	if eng != nil {
		eng.Close()
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
		McpServers:  snap.McpServers,
		Memories:    snap.Memories,
	}
}

func (s *Service) syncRuntime(snap types.ValetSnapshot) {
	if s.engine != nil {
		s.engine.Sync(snap)
	}
	s.syncSidecar(snap)
}

func (s *Service) hydrateSecretsFromKeychain() {
	snap := s.store.Snapshot()
	updated := false
	for _, p := range snap.Providers {
		if raw, err := mygo.Secrets.Get("provider.apikey." + p.ID); err == nil {
			val := strings.TrimSpace(string(raw))
			if val != "" && val != p.APIKey {
				updated = true
			}
		}
	}
	if !updated {
		return
	}
	s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Providers {
			if raw, err := mygo.Secrets.Get("provider.apikey." + st.Providers[i].ID); err == nil {
				val := strings.TrimSpace(string(raw))
				if val != "" {
					st.Providers[i].APIKey = val
					st.Providers[i].APIKeyMasked = maskSecretKey(val)
				}
			}
		}
	})
}

func (s *Service) refreshPermissionsOnStartup() {
	s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Permissions {
			granted := sys.CheckPermissionStatus(st.Permissions[i].ID, st.Permissions[i].Granted, s.opts.DesktopReady)
			st.Permissions[i].Granted = granted
			for j := range st.Permissions[i].MockApps {
				if st.Permissions[i].MockApps[j].IsValet {
					st.Permissions[i].MockApps[j].Enabled = granted
				}
			}
		}
	})
}

func (s *Service) handlePluginEngineTrigger(d plugins.TriggerDispatch) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		switch d.Kind {
		case "plugin":
			_, _ = s.dispatchPluginEventInternal(ctx, d.PluginID, d.EventCode, d.Payload, false)
		case "automation":
			if d.AutomationID != "" {
				_, _ = s.RunAutomationNow(ctx, d.AutomationID)
			}
		}
	}()
}

func (s *Service) recordPluginTriggerStat(pluginID, eventCode string, subtitle string) {
	s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID != pluginID {
				continue
			}
			if len(st.Plugins[i].Triggers24h) > 0 {
				st.Plugins[i].Triggers24h[len(st.Plugins[i].Triggers24h)-1] += 2
			}
			for j := range st.Plugins[i].Events {
				if st.Plugins[i].Events[j].ID == eventCode {
					st.Plugins[i].Events[j].Count24h++
				}
			}
			if subtitle != "" {
				st.Plugins[i].StatusSubtitle = subtitle
			}
		}
	})
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
	case "host.plugin.invoke":
		var req struct {
			PluginID  string         `json:"pluginId"`
			ActionID  string         `json:"actionId"`
			Driver    string         `json:"driver"`
			EventCode string         `json:"eventCode"`
			Args      map[string]any `json:"args"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		res, err := s.engine.Invoke(ctx, snap, req.PluginID, req.ActionID, req.Driver, req.Args)
		if err != nil {
			return nil, err
		}
		if req.EventCode != "" {
			s.recordPluginTriggerStat(req.PluginID, req.EventCode, res.Summary)
		}
		if res.Driver == "fs.trash" && res.MovedCount > 0 {
			s.refreshHostMetrics()
		}
		return res, nil

	case "host.kernel.overview", "host.systemOverview":
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

	case "host.kernel.saveMemory", "host.saveMemory":
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
		s.syncRuntime(next)
		s.emitStateChange("settings")
		return entry, nil

	case "host.queueApproval":
		var req sidecar.QueueApprovalRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		out := s.queueApprovalFromAgent(req)
		s.recordPluginTriggerStat(req.PluginID, req.EventCode, "等待收件箱确认 · "+req.Title)
		if s.opts.OnNotify != nil && snap.Preferences.NotifyOnConfirm {
			s.opts.OnNotify("confirm", req.Title, req.PluginName, req.Summary)
		}
		return out, nil

	case "host.recordTimelineEvent":
		var req sidecar.RecordTimelineRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		out := s.recordTimelineFromAgent(req)
		s.recordPluginTriggerStat(req.PluginID, req.EventCode, req.Title)
		if s.opts.OnNotify != nil {
			if req.Status == "failed" && snap.Preferences.NotifyOnFailure {
				s.opts.OnNotify("fail", req.Title, req.PluginName, req.Summary)
			} else if req.Status == "completed" && snap.Preferences.NotifyOnComplete {
				s.opts.OnNotify("complete", req.Title, req.PluginName, req.Summary)
			}
		}
		return out, nil

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

// GetSnapshot returns the current persistent application state plus live storage stats.
func (s *Service) GetSnapshot() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	snap := s.store.Snapshot()
	stats := s.measureStorageStats()
	snap.StorageStats = &stats
	return snap, nil
}

// CompleteOnboarding finishes the onboarding wizard and opens Inbox.
func (s *Service) CompleteOnboarding() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.OnboardingCompleted = true
		st.ActiveView = string(types.ViewInbox)
	})
	s.syncRuntime(next)
	return next, nil
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
	s.syncRuntime(next)
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

// ResetAllData resets the persistent state back to factory Clean Slate defaults.
func (s *Service) ResetAllData() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	if s.opts.DesktopReady {
		snap := s.store.Snapshot()
		for _, p := range snap.Providers {
			_ = mygo.Secrets.Delete("provider.apikey." + p.ID)
		}
	}
	seed := store.NewSeedSnapshot(s.opts.HomeDir)
	next := s.store.Update(func(st *types.ValetSnapshot) {
		*st = seed
	})
	s.syncRuntime(next)
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
	if s.opts.OnSyncTray != nil {
		s.opts.OnSyncTray(next.Preferences.ShowMenuBarIcon, next.IsPaused)
	}
	s.syncRuntime(next)
	return next, nil
}

// RunFirstScan performs real read-only host inspection routed through enabled core plugins and updates ScanState.
func (s *Service) RunFirstScan(ctx context.Context) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	start := time.Now()
	snap := s.store.Snapshot()
	metrics := sys.SampleDiskMetrics(s.opts.HomeDir)

	var diskReport sys.DiskScanReport
	diskTask := types.ScanTaskItem{ID: "disk", Title: "磁盘", Detail: "插件「磁盘守卫」已停用，已跳过", SizeLabel: "—", Status: "skipped"}
	if diskRes, err := s.engine.Invoke(ctx, snap, "disk-guard", "disk.scan", "fs.scan_cleanable", map[string]any{"minSizeMB": 2048, "idleDays": 90}); err == nil {
		if rep, ok := diskRes.Data.(sys.DiskScanReport); ok {
			diskReport = rep
		}
		diskTask = types.ScanTaskItem{
			ID:        "disk",
			Title:     "磁盘",
			Detail:    fmt.Sprintf("可用 %.1f GB / %.0f GB · 发现 %d 项可安全释放资产", metrics.DiskFreeGB, metrics.DiskTotalGB, len(diskReport.Items)),
			SizeLabel: fmt.Sprintf("%.1f GB", diskReport.EstimatedReclaimableGB),
			SizeGB:    diskReport.EstimatedReclaimableGB,
			Status:    "done",
		}
	}

	orphanTask := types.ScanTaskItem{ID: "orphan", Title: "卸载残留", Detail: "插件「卸载清道夫」已停用，已跳过", SizeLabel: "—", Status: "skipped"}
	if orphRes, err := s.engine.Invoke(ctx, snap, "uninstall-scrubber", "app.scan_remnants", "fs.scan_orphans", map[string]any{}); err == nil {
		orphanCount := 0
		if m, ok := orphRes.Data.(map[string]any); ok {
			if list, ok := m["remnants"].([]sys.OrphanRemnant); ok {
				orphanCount = len(list)
			}
		}
		orphanTask = types.ScanTaskItem{
			ID:        "orphan",
			Title:     "卸载残留",
			Detail:    fmt.Sprintf("扫描到 %d 项疑似残留缓存目录", orphanCount),
			SizeLabel: fmt.Sprintf("%d 项", orphanCount),
			SizeGB:    0,
			Status:    "done",
		}
	}

	var procs sys.ProcessSampleSummary
	procTask := types.ScanTaskItem{ID: "process", Title: "进程", Detail: "插件「进程哨兵」已停用，已跳过", SizeLabel: "—", Status: "skipped"}
	if procRes, err := s.engine.Invoke(ctx, snap, "process-sentinel", "process.sample", "proc.sample", map[string]any{"limit": 3}); err == nil {
		if ps, ok := procRes.Data.(sys.ProcessSampleSummary); ok {
			procs = ps
		} else {
			procs.Rows = procRes.Rows
		}
		topProcDetail := "系统负载平稳"
		if len(procs.Rows) > 0 {
			topProcDetail = fmt.Sprintf("最高占用：%s (CPU %d%% · %s)", procs.Rows[0].Name, procs.Rows[0].CPUPct, procs.Rows[0].MemLabel)
		}
		procTask = types.ScanTaskItem{
			ID:        "process",
			Title:     "进程",
			Detail:    topProcDetail,
			SizeLabel: fmt.Sprintf("CPU %d%%", procs.CPUPct),
			SizeGB:    0,
			Status:    "done",
		}
	}

	logTask := types.ScanTaskItem{ID: "log", Title: "系统日志", Detail: "插件「日志侦探」未启用，已跳过", SizeLabel: "—", Status: "skipped"}
	if logRes, err := s.engine.Invoke(ctx, snap, "log-detective", "log.summarize", "log.summarize_crashes", map[string]any{"minutes": 120}); err == nil {
		if summary, ok := logRes.Data.(sys.CrashSummary); ok {
			logTask = types.ScanTaskItem{
				ID:        "log",
				Title:     "系统日志",
				Detail:    summary.Summary,
				SizeLabel: fmt.Sprintf("%d 份", summary.Count),
				SizeGB:    0,
				Status:    "done",
			}
		}
	}

	elapsed := int(math.Max(1, math.Round(time.Since(start).Seconds())))
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.SystemMetrics.DiskPct = metrics.DiskPct
		st.SystemMetrics.DiskFreeGB = metrics.DiskFreeGB
		st.SystemMetrics.DiskTotalGB = metrics.DiskTotalGB
		if procs.CPUPct > 0 {
			st.SystemMetrics.CPUPct = procs.CPUPct
			st.SystemMetrics.MemPct = procs.MemPct
		}
		st.Scan = types.ScanState{
			Status:        "done",
			ProgressPct:   100,
			ElapsedSec:    elapsed,
			ReclaimableGB: diskReport.EstimatedReclaimableGB,
			Tasks:         []types.ScanTaskItem{diskTask, orphanTask, procTask, logTask},
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

		events := make([]types.PluginEventPolicy, 0, len(parsed.TriggerSpecs))
		for _, tr := range parsed.TriggerSpecs {
			pol := tr.Policy
			if pol == "" {
				pol = "auto"
			}
			desc := tr.Description
			if desc == "" {
				desc = draft.WhenExpression
			}
			events = append(events, types.PluginEventPolicy{
				ID: tr.ID, Description: desc, Policy: pol, Count24h: 0,
			})
		}
		actions := make([]types.PluginActionCapability, 0, len(parsed.ActionSpecs))
		for _, act := range parsed.ActionSpecs {
			label := "可撤销 · 7 天"
			if act.Safety == "readonly" {
				label = "只读"
			} else if act.Safety == "confirm_always" {
				label = "每次确认"
			}
			actions = append(actions, types.PluginActionCapability{
				ID: act.ID, Safety: act.Safety, SafetyLabel: label,
			})
		}
		st.Plugins = append(st.Plugins, types.PluginState{
			ID: draft.ID, Slug: draft.ID, Name: draft.Name,
			Tagline: fmt.Sprintf("%s · %s", draft.WhenExpression, draft.ActionExpression),
			Description: "通过对话工作台自然语言生成并启用的本地自动化插件。",
			Version: parsed.Version, BundleID: "local.valet." + draft.ID,
			IconKind: "code", IconLabel: "{ }", Source: "local",
			Enabled: true, Installed: true,
			StatusSubtitle: "本地生成插件 · 传感器与工具热重载生效中",
			Triggers24h:    []int{0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
			Events:         events,
			Actions:        actions,
			ManifestYAML:   draft.ManifestYAML,
		})
	})

	s.syncRuntime(next)
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
			checkedPaths = append(checkedPaths, strings.TrimSpace(a.Path))
		}
	}
	if len(target.ActionItems) == 0 {
		checkedPaths = extractTargetPaths(target.ToolArgs)
		if len(checkedPaths) == 0 {
			checkedPaths = extractTargetPaths(target.Payload)
		}
	}

	activeMover := s.trashMover
	if snap.Preferences.CleanupPolicy.DeleteMethod == "安全移出到隔离区" {
		activeMover = nil
	}

	batchID := ""
	reclaimed := target.ReclaimableGB

	switch {
	case target.ToolName == "disk_empty_trash":
		if s.client != nil {
			_ = s.client.Call(ctx, "tool.executeApproved", sidecar.ExecuteApprovedRequest{
				InboxID:      target.ID,
				ToolName:     target.ToolName,
				ToolArgs:     target.ToolArgs,
				CheckedPaths: checkedPaths,
			}, nil)
		}
	case target.Category == "files" || strings.Contains(target.ToolName, "trash"):
		if len(checkedPaths) == 0 {
			if s.opts.DesktopReady {
				if len(target.ActionItems) == 0 {
					return snap, errors.New("该审批卡片未绑定具体文件路径（旧卡片无可执行目标），请忽略此卡并在对话中重新扫描清理")
				}
				return snap, errors.New("请至少勾选一项要清理的文件，或点击忽略")
			}
			break
		}
		bID, movedCount, realReclaimed, err := sys.MoveItemsToTrash(
			s.opts.HomeDir,
			s.opts.DataDir,
			snap.Preferences.CleanupPolicy.ProtectedDirs,
			checkedPaths,
			reclaimed,
			activeMover,
		)
		if err != nil {
			return snap, err
		}
		if s.opts.DesktopReady && movedCount == 0 {
			return snap, errors.New("没有文件被实际移出，请检查目标路径是否存在")
		}
		batchID = bID
		if realReclaimed > 0 {
			reclaimed = realReclaimed
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
	nextSnap := s.store.Update(func(st *types.ValetSnapshot) {
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
	})
	if batchID != "" && s.opts.DesktopReady {
		s.refreshHostMetrics()
		nextSnap = s.store.Snapshot()
	}
	return nextSnap, nil
}

func extractTargetPaths(m map[string]any) []string {
	if len(m) == 0 {
		return nil
	}
	var out []string
	appendPath := func(s string) {
		trimmed := strings.TrimSpace(s)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if rawPaths, ok := m["paths"]; ok {
		switch v := rawPaths.(type) {
		case []string:
			for _, p := range v {
				appendPath(p)
			}
		case []any:
			for _, item := range v {
				if s, ok := item.(string); ok {
					appendPath(s)
				}
			}
		}
	}
	for _, key := range []string{"path", "target"} {
		if s, ok := m[key].(string); ok {
			appendPath(s)
		}
	}
	return out
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
			checked = append(checked, strings.TrimSpace(a.Path))
		}
	}
	if len(target.ActionItems) == 0 {
		checked = extractTargetPaths(target.Payload)
	}
	if len(checked) == 0 && s.opts.DesktopReady {
		if len(target.ActionItems) == 0 {
			return snap, errors.New("该时间线事件未绑定具体文件路径，无法执行清理")
		}
		return snap, errors.New("请至少勾选一项要移入废纸篓的文件")
	}

	activeMover := s.trashMover
	if snap.Preferences.CleanupPolicy.DeleteMethod == "安全移出到隔离区" {
		activeMover = nil
	}

	batchID := ""
	reclaimed := computeCheckedGB(target.ActionItems, target.ReclaimedGB)
	if len(checked) > 0 {
		bID, movedCount, realReclaimed, err := sys.MoveItemsToTrash(
			s.opts.HomeDir,
			s.opts.DataDir,
			snap.Preferences.CleanupPolicy.ProtectedDirs,
			checked,
			reclaimed,
			activeMover,
		)
		if err != nil {
			return snap, err
		}
		if s.opts.DesktopReady && movedCount == 0 {
			return snap, errors.New("没有文件被实际移出，请检查目标路径是否存在")
		}
		batchID = bID
		if realReclaimed > 0 {
			reclaimed = realReclaimed
		}
	}

	nextSnap := s.store.Update(func(st *types.ValetSnapshot) {
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
	})
	if batchID != "" && s.opts.DesktopReady {
		s.refreshHostMetrics()
		nextSnap = s.store.Snapshot()
	}
	return nextSnap, nil
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

// TogglePluginEnabled toggles plugin enabled status and hot-reloads the engine & Pi Durable registry.
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
	s.syncRuntime(next)
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
	s.syncRuntime(next)
	return next, nil
}

// InstallCustomPlugin parses YAML, installs a local plugin, and hot-reloads sensors & Pi Durable.
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

	evList, actList := manifestSpecsToPoliciesAndActions(parsed, nil)

	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Plugins = append(st.Plugins, types.PluginState{
			ID: slug, Slug: slug, Name: name, Tagline: tagline,
			Description: "通过本地 Manifest YAML 导入的自定义事件响应插件。",
			Version: parsed.Version, BundleID: "local.valet." + slug,
			IconKind: "code", IconLabel: "{ }", Source: "local",
			Enabled: true, Installed: true,
			StatusSubtitle: "~/Valet/plugins/custom · 热重载中",
			Triggers24h:    make([]int, 10),
			Events:         evList, Actions: actList, ManifestYAML: params.YAML,
		})
	})
	s.syncRuntime(next)
	return next, nil
}

// UpdatePluginManifest parses updated YAML for an existing plugin, preserves matching event policies, and hot-reloads.
func (s *Service) UpdatePluginManifest(pluginID, manifestYAML string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	parsed, err := plugins.ParseManifestYAML(manifestYAML)
	if err != nil {
		return s.store.Snapshot(), err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID != pluginID {
				continue
			}
			evList, actList := manifestSpecsToPoliciesAndActions(parsed, st.Plugins[i].Events)
			if strings.TrimSpace(parsed.Version) != "" {
				st.Plugins[i].Version = parsed.Version
			}
			st.Plugins[i].Events = evList
			st.Plugins[i].Actions = actList
			st.Plugins[i].ManifestYAML = manifestYAML
			st.Plugins[i].StatusSubtitle = "刚刚热重载 · Manifest 已生效"
		}
	})
	s.syncRuntime(next)
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
				st.TimelineEvents[i].Summary = "授权已恢复，相关触发器现已就绪。"
			}
		}
	})
	s.syncRuntime(next)
	return next, nil
}

// UpdatePluginEventPolicy updates event policy ("auto"|"ask"|"record") and syncs Engine & Sidecar.
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
	s.syncRuntime(next)
	return next, nil
}

// UpdatePluginConfig updates per-plugin config and syncs Engine & Sidecar.
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
	s.syncRuntime(next)
	return next, nil
}

// SimulatePluginEvent injects an event through Valet's event throttle + Pi Durable agent pipeline.
func (s *Service) SimulatePluginEvent(ctx context.Context, pluginID, eventCode string) (types.SimulateEventResult, error) {
	return s.dispatchPluginEventInternal(ctx, pluginID, eventCode, map[string]any{"simulated": true}, true)
}

func (s *Service) dispatchPluginEventInternal(
	ctx context.Context,
	pluginID string,
	eventCode string,
	payload map[string]any,
	simulated bool,
) (types.SimulateEventResult, error) {
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
	if !simulated && (!plugin.Installed || !plugin.Enabled) {
		return types.SimulateEventResult{}, fmt.Errorf("plugin %s is disabled", pluginID)
	}

	if s.engine != nil && !s.engine.Throttle().Allow(pluginID, eventCode, snap.Preferences.Thresholds.EventThrottle10m, simulated) {
		return types.SimulateEventResult{}, errors.New("event throttled")
	}

	s.recordPluginTriggerStat(pluginID, eventCode, fmt.Sprintf("刚刚触发 · %s", eventCode))

	reqPayload := make(map[string]any, len(payload)+2)
	for k, v := range payload {
		reqPayload[k] = v
	}
	reqPayload["bundle"] = plugin.BundleID
	if simulated {
		reqPayload["simulated"] = true
	}

	var resp sidecar.PluginEventResponse
	if s.client != nil && plugin.Installed && plugin.Enabled {
		s.syncSidecarBlocking(ctx, s.store.Snapshot())
		_ = s.client.Call(ctx, "plugin.event", sidecar.PluginEventRequest{
			PluginID:  pluginID,
			EventCode: eventCode,
			Payload:   reqPayload,
			Simulated: simulated,
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
	summary := "策略为「自动处理」，Valet 已记录事件触发。"
	if policy == "ask" {
		evtStatus = "pending_confirm"
		summary = "策略为「问我」，需要你在收件箱或时间线确认后执行下一步动作。"
	} else if policy == "record" {
		summary = "策略为「仅记录」，已归档到时间线供你随时回溯。"
	}
	sourceLabel := "来自运行时感知"
	titlePrefix := "传感器事件："
	if simulated {
		sourceLabel = "来自开发者事件模拟器"
		titlePrefix = "模拟事件："
	}

	evtID := fmt.Sprintf("evt-plug-%d", now.UnixNano())
	evt := types.TimelineEvent{
		ID: evtID, Timestamp: now.Format(time.RFC3339), TimeLabel: nowHHMM,
		DayGroup: "today", Title: fmt.Sprintf("%s%s 捕获 %s", titlePrefix, plugin.Name, eventCode),
		Summary: summary, PluginID: plugin.ID, PluginName: plugin.Name, PluginBadge: badge,
		EventCode: eventCode, Status: evtStatus, TriggerLatencyLabel: nowHHMM + " · " + sourceLabel,
		Payload: reqPayload,
		Reasoning: fmt.Sprintf("插件「%s」捕获事件 %s，当前按策略「%s」路由记录。", plugin.Name, eventCode, policy),
		ActionItems: []types.TimelineActionItem{},
		TraceSteps: []types.TraceStep{
			{ID: "s1", Time: nowHHMM, Stage: "事件触发", Detail: eventCode + " 已进入事件总线", Status: "done"},
		},
		Logs: []types.LogLine{{ID: "sl1", TS: now.Format("15:04:05"), Level: "INFO", Message: "Dispatched " + eventCode}},
	}

	var inb *types.InboxApprovalItem
	if policy == "ask" {
		item := types.InboxApprovalItem{
			ID: fmt.Sprintf("inbox-plug-%d", now.UnixNano()), Timestamp: evt.Timestamp,
			TimeLabel: nowHHMM, AgeLabel: "刚刚", Category: "files", IconKind: "disk",
			Title: evt.Title, Summary: evt.Summary, PluginID: plugin.ID, PluginName: plugin.Name,
			PluginBadge: plugin.Name, EventCode: eventCode, Reversible7d: false, ReclaimableGB: 0,
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
	s.emitStateChange("timeline")
	return types.SimulateEventResult{Event: evt, InboxItem: inb}, nil
}

// --- Providers, Preferences & System ---

// SelectProvider changes the active LLM provider ID and reconciles active model selections.
func (s *Service) SelectProvider(providerID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences.ActiveProviderID = providerID
		for i := range st.Providers {
			if st.Providers[i].ID == providerID {
				st.Providers[i].Connected = st.Providers[i].Verified || st.Providers[i].ID == "ollama"
			}
		}
		reconcileActiveProviderModels(st, providerID)
	})
	s.syncRuntime(next)
	return next, nil
}

// UpdateProvider updates API keys (stored in OS Keychain when available), base URLs, and connection status for a provider.
func (s *Service) UpdateProvider(providerID string, patch types.AgentProviderConfig) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	trimmedKey := strings.TrimSpace(patch.APIKey)
	if s.opts.DesktopReady {
		if trimmedKey != "" {
			_ = mygo.Secrets.Set("provider.apikey."+providerID, []byte(trimmedKey))
		} else {
			_ = mygo.Secrets.Delete("provider.apikey." + providerID)
		}
	}
	patch.ID = providerID
	patch.APIKey = trimmedKey
	patch.APIKeyMasked = maskSecretKey(trimmedKey)

	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Providers {
			if st.Providers[i].ID == providerID {
				st.Providers[i] = patch
			}
		}
		if st.Preferences.ActiveProviderID == providerID {
			reconcileActiveProviderModels(st, providerID)
		}
	})
	s.syncRuntime(next)
	return next, nil
}

// VerifyProvider performs real HTTP endpoint discovery and credential validation against the configured provider.
func (s *Service) VerifyProvider(ctx context.Context, provider types.AgentProviderConfig) (types.ProviderVerifyResult, error) {
	start := time.Now()
	client, err := buildHTTPClient(provider.ProxyURL, 15*time.Second)
	if err != nil {
		return types.ProviderVerifyResult{OK: false, Message: "代理地址格式无效: " + err.Error()}, nil
	}

	key := strings.TrimSpace(provider.APIKey)
	rawBase := strings.TrimSpace(provider.BaseURL)
	if rawBase == "" {
		rawBase = strings.TrimSpace(provider.Endpoint)
	}

	candidates, defaultBase, errMsg := buildProviderProbeCandidates(provider.ID, rawBase, key, provider.OrgID)
	if errMsg != "" {
		return types.ProviderVerifyResult{OK: false, Message: errMsg}, nil
	}

	var (
		lastStatus int
		lastBody   []byte
		lastLat    int
		lastBase   = defaultBase
		lastErr    error
	)

	for idx, cand := range candidates {
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, cand.url, nil)
		if reqErr != nil {
			lastErr = reqErr
			continue
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "Valet/0.1.0")
		for hk, hv := range cand.headers {
			req.Header.Set(hk, hv)
		}

		resp, doErr := client.Do(req)
		lastLat = int(math.Max(1, float64(time.Since(start).Milliseconds())))
		if doErr != nil {
			lastErr = doErr
			lastBase = cand.url
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 16*1024*1024))
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			lastBase = cand.url
			continue
		}

		lastStatus = resp.StatusCode
		lastBody = body
		lastBase = cand.url
		lastErr = nil

		if resp.StatusCode < 400 {
			models := parseModelsFromResponse(provider.ID, body)
			count := len(models)
			if count == 0 {
				models = provider.Models
				count = len(models)
			}
			return types.ProviderVerifyResult{
				OK:         true,
				LatencyMs:  lastLat,
				ModelCount: count,
				Models:     models,
				Message:    fmt.Sprintf("已验证（HTTP %d）· 延迟 %dms · 发现 %d 个模型", resp.StatusCode, lastLat, count),
			}, nil
		}

		shouldRetry := idx+1 < len(candidates) &&
			(resp.StatusCode == http.StatusNotFound ||
				resp.StatusCode == http.StatusMethodNotAllowed ||
				cand.retryOnAuth)
		if !shouldRetry {
			break
		}
	}

	if lastErr != nil && lastStatus == 0 {
		lat := int(math.Max(1, float64(time.Since(start).Milliseconds())))
		return types.ProviderVerifyResult{
			OK:        false,
			LatencyMs: lat,
			Message:   fmt.Sprintf("连接 %s 失败: %v", lastBase, lastErr),
		}, nil
	}

	detail := extractAPIErrorDetail(lastBody)
	msg := fmt.Sprintf("鉴权或接口失败（HTTP %d）· 延迟 %dms", lastStatus, lastLat)
	if detail != "" {
		msg += " · " + detail
	}
	return types.ProviderVerifyResult{
		OK:        false,
		LatencyMs: lastLat,
		Message:   msg,
	}, nil
}

// SendTestAgentMessage sends a real single-turn probe completion using the Pi Durable sidecar.
func (s *Service) SendTestAgentMessage(ctx context.Context, provider types.AgentProviderConfig, model string) (types.TestMessageResult, error) {
	if err := s.ensureStarted(); err != nil {
		return types.TestMessageResult{}, err
	}
	var out types.TestMessageResult
	err := s.client.Call(ctx, "agent.testProvider", sidecar.TestProviderRequest{
		Provider: provider,
		Model:    model,
	}, &out)
	return out, err
}

// UpdateModels updates primary/fast/vision model selections.
func (s *Service) UpdateModels(models types.ModelSelection) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences.Models = models
		reconcileActiveProviderModels(st, st.Preferences.ActiveProviderID)
		if strings.TrimSpace(st.Preferences.Models.Primary) != "" {
			for i := range st.ChatThreads {
				st.ChatThreads[i].Model = st.Preferences.Models.Primary
			}
		}
	})
	s.syncRuntime(next)
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
	s.syncRuntime(next)
	return next, nil
}

// UpdatePreferences applies a full preferences update, syncs native Tray/Login hooks, and reloads Engine & Sidecar.
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
	if s.opts.OnSyncTray != nil {
		s.opts.OnSyncTray(next.Preferences.ShowMenuBarIcon, next.IsPaused)
	}
	if s.opts.OnSyncLogin != nil {
		s.opts.OnSyncLogin(next.Preferences.LaunchAtLogin)
	}
	s.syncRuntime(next)
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
	s.syncRuntime(next)
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

// CaptureCurrentScreen verifies Screen Recording access, captures a bounded screenshot on macOS,
// and syncs the updated permission state.
func (s *Service) CaptureCurrentScreen(ctx context.Context) (types.ScreenCaptureResult, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ScreenCaptureResult{OK: false, Error: err.Error()}, err
	}
	res := sys.CaptureCurrentScreen(ctx, s.opts.DataDir, s.opts.DesktopReady)
	if s.opts.DesktopReady && (res.OK || res.PermissionDenied) {
		granted := res.OK && !res.PermissionDenied
		s.store.Update(func(st *types.ValetSnapshot) {
			for i := range st.Permissions {
				if st.Permissions[i].ID == "screen_recording" {
					st.Permissions[i].Granted = granted
					for j := range st.Permissions[i].MockApps {
						if st.Permissions[i].MockApps[j].IsValet {
							st.Permissions[i].MockApps[j].Enabled = granted
						}
					}
				}
			}
		})
	}
	return res, nil
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

// ToggleAutomation enables/disables an automation rule and reloads the Engine scheduler.
func (s *Service) ToggleAutomation(id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Automations {
			if st.Automations[i].ID == id {
				st.Automations[i].Enabled = !st.Automations[i].Enabled
			}
		}
	})
	s.syncRuntime(next)
	return next, nil
}

// AddAutomationRule appends a new cron/event rule and reloads the Engine scheduler.
func (s *Service) AddAutomationRule(rule types.AutomationRule) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	if rule.ID == "" {
		rule.ID = fmt.Sprintf("auto-%d", time.Now().UnixNano())
	}
	if strings.TrimSpace(rule.CronExpr) == "" && rule.TriggerType == "cron" {
		rule.CronExpr = defaultCronExprFromSchedule(rule.ScheduleTop + " " + rule.ScheduleBottom)
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Automations = append(st.Automations, rule)
	})
	s.syncRuntime(next)
	return next, nil
}

// DeleteAutomationRule removes an automation rule and reloads the Engine scheduler.
func (s *Service) DeleteAutomationRule(id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		filtered := make([]types.AutomationRule, 0, len(st.Automations))
		for _, r := range st.Automations {
			if r.ID != id {
				filtered = append(filtered, r)
			}
		}
		st.Automations = filtered
	})
	s.syncRuntime(next)
	return next, nil
}

// RunAutomationNow executes an automation rule immediately through the Pi Durable agent.
func (s *Service) RunAutomationNow(ctx context.Context, id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	snap := s.store.Snapshot()
	var rule *types.AutomationRule
	for i := range snap.Automations {
		if snap.Automations[i].ID == id {
			cp := snap.Automations[i]
			rule = &cp
			break
		}
	}
	if rule == nil {
		return snap, fmt.Errorf("automation rule not found: %s", id)
	}

	nowHHMM := time.Now().Format("15:04")
	s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Automations {
			if st.Automations[i].ID == id {
				st.Automations[i].LastRunAt = nowHHMM
			}
		}
	})

	prompt := strings.TrimSpace(rule.Prompt)
	if prompt == "" {
		prompt = fmt.Sprintf("请立即执行自动化规则「%s」：%s", rule.Title, rule.Subtitle)
	}
	model := snap.Preferences.Models.Fast
	if strings.TrimSpace(model) == "" {
		model = snap.Preferences.Models.Primary
	}
	if _, err := s.SendChatMessage(ctx, types.SendChatParams{
		ChatID: "chat-default",
		Prompt: prompt,
		Model:  model,
	}); err != nil {
		return s.store.Snapshot(), err
	}
	s.emitStateChange("automations")
	return s.store.Snapshot(), nil
}

// ToggleMcpServer enables/disables an MCP server configuration and syncs Sidecar.
func (s *Service) ToggleMcpServer(id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.McpServers {
			if st.McpServers[i].ID == id {
				st.McpServers[i].Enabled = !st.McpServers[i].Enabled
			}
		}
	})
	s.syncRuntime(next)
	return next, nil
}

// ReconnectMcpServer probes an MCP server via Sidecar, updates tool count/status, and syncs Sidecar.
func (s *Service) ReconnectMcpServer(ctx context.Context, id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	snap := s.store.Snapshot()
	var target *types.McpServerItem
	for i := range snap.McpServers {
		if snap.McpServers[i].ID == id {
			cp := snap.McpServers[i]
			target = &cp
			break
		}
	}
	if target == nil {
		return snap, fmt.Errorf("mcp server not found: %s", id)
	}
	probed := s.probeMcpServer(ctx, *target)
	probed.Enabled = true
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.McpServers {
			if st.McpServers[i].ID == id {
				st.McpServers[i] = probed
			}
		}
	})
	s.syncRuntime(next)
	return next, nil
}

// AddMcpServer registers a new MCP server, probes it when enabled, and syncs Sidecar.
func (s *Service) AddMcpServer(ctx context.Context, srv types.McpServerItem) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	if srv.ID == "" {
		srv.ID = fmt.Sprintf("mcp-%d", time.Now().UnixNano())
	}
	if srv.Enabled {
		srv = s.probeMcpServer(ctx, srv)
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.McpServers = append(st.McpServers, srv)
	})
	s.syncRuntime(next)
	return next, nil
}

// DeleteMcpServer removes an MCP server configuration and syncs Sidecar.
func (s *Service) DeleteMcpServer(id string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		filtered := make([]types.McpServerItem, 0, len(st.McpServers))
		for _, srv := range st.McpServers {
			if srv.ID != id {
				filtered = append(filtered, srv)
			}
		}
		st.McpServers = filtered
	})
	s.syncRuntime(next)
	return next, nil
}

func (s *Service) probeMcpServer(ctx context.Context, srv types.McpServerItem) types.McpServerItem {
	if s.client == nil {
		return srv
	}
	var probe sidecar.ProbeMcpResponse
	if err := s.client.Call(ctx, "mcp.probe", sidecar.ProbeMcpRequest{Server: srv}, &probe); err != nil {
		srv.StatusError = err.Error()
		srv.AuthExpired = true
		return srv
	}
	if probe.TransportLabel != "" {
		srv.TransportLabel = probe.TransportLabel
	}
	if probe.OK {
		srv.ToolCount = probe.ToolCount
		srv.AuthExpired = false
		srv.StatusError = ""
	} else {
		srv.StatusError = probe.Error
		srv.AuthExpired = true
	}
	return srv
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
	s.syncRuntime(next)
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
	s.syncRuntime(next)
	return next, nil
}

func (s *Service) measureStorageStats() types.StorageStats {
	dataDir := s.opts.DataDir
	dbBytes := fileOrGlobSize(dataDir, "pi-agent.sqlite", "pi-agent.sqlite-wal", "pi-agent.sqlite-shm")
	stateBytes := fileOrGlobSize(dataDir, "state.json")
	vaultBytes := dirSizeBytes(filepath.Join(dataDir, "trash"))
	totalBytes := dbBytes + stateBytes + vaultBytes
	return types.StorageStats{
		DataDir:       dataDir,
		TotalBytes:    totalBytes,
		TotalLabel:    formatBytesHuman(totalBytes),
		DatabaseLabel: formatBytesHuman(dbBytes),
		StateLabel:    formatBytesHuman(stateBytes),
		VaultLabel:    formatBytesHuman(vaultBytes),
	}
}

func fileOrGlobSize(dir string, names ...string) int64 {
	var total int64
	for _, n := range names {
		if info, err := os.Stat(filepath.Join(dir, n)); err == nil && !info.IsDir() {
			total += info.Size()
		}
	}
	return total
}

func dirSizeBytes(root string) int64 {
	var total int64
	_ = filepath.Walk(root, func(_ string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		total += info.Size()
		return nil
	})
	return total
}

func formatBytesHuman(b int64) string {
	switch {
	case b <= 0:
		return "0 KB"
	case b < 1024*1024:
		kb := math.Max(1, math.Round(float64(b)/1024.0))
		return fmt.Sprintf("%.0f KB", kb)
	case b < 1024*1024*1024:
		return fmt.Sprintf("%.1f MB", float64(b)/(1024.0*1024.0))
	default:
		return fmt.Sprintf("%.2f GB", float64(b)/(1024.0*1024.0*1024.0))
	}
}

func manifestSpecsToPoliciesAndActions(
	parsed plugins.ParsedManifest,
	existing []types.PluginEventPolicy,
) ([]types.PluginEventPolicy, []types.PluginActionCapability) {
	prevMap := make(map[string]types.PluginEventPolicy, len(existing))
	for _, ev := range existing {
		prevMap[ev.ID] = ev
	}
	evList := make([]types.PluginEventPolicy, 0, len(parsed.TriggerSpecs))
	for _, ts := range parsed.TriggerSpecs {
		if prev, ok := prevMap[ts.ID]; ok {
			if strings.TrimSpace(ts.Description) != "" {
				prev.Description = ts.Description
			}
			evList = append(evList, prev)
			continue
		}
		desc := strings.TrimSpace(ts.Description)
		if desc == "" {
			desc = "Manifest 声明触发规则"
		}
		pol := ts.Policy
		if pol == "" {
			pol = "ask"
		}
		evList = append(evList, types.PluginEventPolicy{
			ID: ts.ID, Description: desc, Policy: pol,
		})
	}
	actList := make([]types.PluginActionCapability, 0, len(parsed.ActionSpecs))
	for _, as := range parsed.ActionSpecs {
		actList = append(actList, types.PluginActionCapability{
			ID: as.ID, Safety: as.Safety, SafetyLabel: safetyLabelFor(as.Safety),
		})
	}
	return evList, actList
}

func safetyLabelFor(safety string) string {
	switch safety {
	case "readonly":
		return "只读"
	case "confirm_always":
		return "始终确认"
	default:
		return "可撤销"
	}
}

func maskSecretKey(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if len(s) <= 8 {
		return strings.Repeat("*", len(s))
	}
	return s[:4] + "••••••••" + s[len(s)-4:]
}

func buildHTTPClient(proxyRaw string, timeout time.Duration) (*http.Client, error) {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if p := strings.TrimSpace(proxyRaw); p != "" {
		parsed, err := url.Parse(p)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return nil, errors.New("proxy URL must include scheme and host")
		}
		tr.Proxy = http.ProxyURL(parsed)
	}
	return &http.Client{Timeout: timeout, Transport: tr}, nil
}

type probeCandidate struct {
	url         string
	headers     map[string]string
	retryOnAuth bool
}

func isLocalEndpointHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]" || h == "0.0.0.0" {
		return true
	}
	return strings.HasPrefix(h, "10.") || strings.HasPrefix(h, "192.168.") || strings.HasPrefix(h, "172.")
}

func normalizeEndpointURL(raw string, defaultScheme string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		scheme := defaultScheme
		if scheme == "" {
			hostPort := strings.SplitN(s, "/", 2)[0]
			host := strings.SplitN(hostPort, ":", 2)[0]
			if isLocalEndpointHost(host) {
				scheme = "http"
			} else {
				scheme = "https"
			}
		}
		s = scheme + "://" + s
	}
	s = strings.TrimRight(s, "/")
	for _, suffix := range []string{"/chat/completions", "/completions", "/messages", "/responses"} {
		if strings.HasSuffix(s, suffix) {
			s = strings.TrimRight(strings.TrimSuffix(s, suffix), "/")
			break
		}
	}
	return s
}

func hasAPIVersionSuffix(base string) bool {
	for _, v := range []string{"/v1", "/v1beta", "/v2", "/v3", "/v4"} {
		if strings.HasSuffix(base, v) {
			return true
		}
	}
	return false
}

func stripAPIVersionSuffix(base string) string {
	for _, v := range []string{"/v1beta", "/v1", "/v2", "/v3", "/v4"} {
		if strings.HasSuffix(base, v) {
			return strings.TrimRight(strings.TrimSuffix(base, v), "/")
		}
	}
	return base
}

func buildProviderProbeCandidates(providerID, rawBase, key, orgID string) ([]probeCandidate, string, string) {
	switch providerID {
	case "ollama":
		base := normalizeEndpointURL(rawBase, "http")
		if base == "" {
			base = "http://localhost:11434"
		}
		root := strings.TrimRight(strings.TrimSuffix(base, "/api/tags"), "/")
		root = strings.TrimRight(strings.TrimSuffix(root, "/v1"), "/")
		headers := map[string]string{}
		if key != "" {
			headers["Authorization"] = "Bearer " + key
		}
		return []probeCandidate{
			{url: root + "/api/tags", headers: headers},
			{url: root + "/v1/models", headers: headers},
		}, root, ""

	case "anthropic":
		if key == "" {
			return nil, "", "请输入有效的 Anthropic API Key"
		}
		base := normalizeEndpointURL(rawBase, "https")
		if base == "" {
			base = "https://api.anthropic.com"
		}
		base = strings.TrimRight(strings.TrimSuffix(base, "/models"), "/")
		primaryHdr := map[string]string{
			"x-api-key":         key,
			"anthropic-version": "2023-06-01",
		}
		bearerHdr := map[string]string{
			"Authorization":     "Bearer " + key,
			"x-api-key":         key,
			"anthropic-version": "2023-06-01",
		}
		isCustomHost := !strings.Contains(strings.ToLower(base), "api.anthropic.com")
		if hasAPIVersionSuffix(base) {
			cands := []probeCandidate{
				{url: base + "/models", headers: primaryHdr, retryOnAuth: isCustomHost},
			}
			if isCustomHost {
				cands = append(cands, probeCandidate{url: base + "/models", headers: bearerHdr})
			}
			return cands, base, ""
		}
		cands := []probeCandidate{
			{url: base + "/v1/models", headers: primaryHdr, retryOnAuth: isCustomHost},
			{url: base + "/models", headers: primaryHdr, retryOnAuth: isCustomHost},
		}
		if isCustomHost {
			cands = append(cands, probeCandidate{url: base + "/v1/models", headers: bearerHdr})
		}
		return cands, base, ""

	case "gemini":
		if key == "" {
			return nil, "", "请输入有效的 Gemini API Key"
		}
		base := normalizeEndpointURL(rawBase, "https")
		if base == "" {
			base = "https://generativelanguage.googleapis.com/v1beta"
		}
		base = strings.TrimRight(strings.TrimSuffix(base, "/models"), "/")
		headers := map[string]string{"x-goog-api-key": key}
		q := "?key=" + url.QueryEscape(key)
		if strings.HasSuffix(base, "/v1beta") || strings.HasSuffix(base, "/v1") {
			return []probeCandidate{{url: base + "/models" + q, headers: headers}}, base, ""
		}
		return []probeCandidate{
			{url: base + "/v1beta/models" + q, headers: headers},
			{url: base + "/models" + q, headers: headers},
		}, base, ""

	case "openrouter":
		if key == "" {
			return nil, "", "请输入有效的 OpenRouter API Key"
		}
		base := normalizeEndpointURL(rawBase, "https")
		if base == "" {
			base = "https://openrouter.ai/api/v1"
		}
		if parsed, err := url.Parse(base); err == nil && strings.Contains(strings.ToLower(parsed.Hostname()), "openrouter.ai") {
			if parsed.Path == "" || parsed.Path == "/" {
				base += "/api/v1"
			} else if parsed.Path == "/api" {
				base += "/v1"
			}
		}
		headers := map[string]string{
			"Authorization":      "Bearer " + key,
			"HTTP-Referer":       "https://valet.local",
			"X-OpenRouter-Title": "Valet",
		}
		if strings.HasSuffix(base, "/models/user") {
			return []probeCandidate{{url: base, headers: headers}}, base, ""
		}
		if strings.HasSuffix(base, "/models") {
			root := strings.TrimRight(strings.TrimSuffix(base, "/models"), "/")
			return []probeCandidate{
				{url: root + "/models/user", headers: headers},
				{url: base, headers: headers},
			}, base, ""
		}
		if hasAPIVersionSuffix(base) {
			return []probeCandidate{
				{url: base + "/models/user", headers: headers},
				{url: base + "/models", headers: headers},
			}, base, ""
		}
		return []probeCandidate{
			{url: base + "/v1/models/user", headers: headers},
			{url: base + "/models/user", headers: headers},
			{url: base + "/v1/models", headers: headers},
			{url: base + "/models", headers: headers},
		}, base, ""

	default:
		if providerID == "openai" && key == "" {
			return nil, "", "请输入有效的 OpenAI API Key"
		}
		base := normalizeEndpointURL(rawBase, "")
		if base == "" {
			if providerID == "openai" {
				base = "https://api.openai.com/v1"
			} else {
				return nil, "", "请填写自定义服务的 Base URL"
			}
		}
		headers := map[string]string{}
		if key != "" {
			headers["Authorization"] = "Bearer " + key
		}
		if org := strings.TrimSpace(orgID); org != "" {
			headers["OpenAI-Organization"] = org
		}
		if strings.HasSuffix(base, "/models") {
			return []probeCandidate{{url: base, headers: headers}}, base, ""
		}
		if hasAPIVersionSuffix(base) {
			cands := []probeCandidate{{url: base + "/models", headers: headers}}
			stripped := stripAPIVersionSuffix(base)
			if stripped != base {
				cands = append(cands, probeCandidate{url: stripped + "/models", headers: headers})
			}
			return cands, base, ""
		}
		return []probeCandidate{
			{url: base + "/v1/models", headers: headers},
			{url: base + "/models", headers: headers},
		}, base, ""
	}
}

func extractAPIErrorDetail(body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return ""
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err == nil {
		var msg string
		if errField, ok := parsed["error"].(map[string]any); ok {
			if m, ok := errField["message"].(string); ok {
				msg = m
			}
		} else if errStr, ok := parsed["error"].(string); ok {
			msg = errStr
		}
		if msg == "" {
			if m, ok := parsed["message"].(string); ok {
				msg = m
			}
		}
		msg = strings.Join(strings.Fields(msg), " ")
		if msg != "" {
			if len(msg) > 180 {
				return msg[:180] + "…"
			}
			return msg
		}
	}
	flat := strings.Join(strings.Fields(trimmed), " ")
	if len(flat) > 140 {
		return flat[:140] + "…"
	}
	return flat
}

func isFastModelID(id string) bool {
	low := strings.ToLower(id)
	return strings.Contains(low, "haiku") ||
		strings.Contains(low, "flash") ||
		strings.Contains(low, "mini") ||
		strings.Contains(low, "nano") ||
		strings.Contains(low, "fast") ||
		strings.Contains(low, "lite")
}

func reconcileActiveProviderModels(st *types.ValetSnapshot, providerID string) {
	var models []string
	for _, p := range st.Providers {
		if p.ID == providerID {
			models = p.Models
			break
		}
	}
	if len(models) == 0 {
		return
	}
	hasModel := func(target string) bool {
		for _, m := range models {
			if m == target {
				return true
			}
		}
		return false
	}

	if !hasModel(st.Preferences.Models.Primary) {
		st.Preferences.Models.Primary = models[0]
	}
	if !hasModel(st.Preferences.Models.Fast) {
		fastPick := ""
		for _, m := range models {
			if isFastModelID(m) {
				fastPick = m
				break
			}
		}
		if fastPick == "" {
			if len(models) > 1 {
				fastPick = models[len(models)-1]
			} else {
				fastPick = models[0]
			}
		}
		st.Preferences.Models.Fast = fastPick
	}
	if st.Preferences.Models.Vision != "同主模型" && !hasModel(st.Preferences.Models.Vision) {
		st.Preferences.Models.Vision = "同主模型"
	}

	for i := range st.ChatThreads {
		if !hasModel(st.ChatThreads[i].Model) {
			st.ChatThreads[i].Model = st.Preferences.Models.Primary
		}
	}
}

func shouldIncludeDiscoveredModel(providerID, id string, meta map[string]any) bool {
	if id == "" || strings.HasPrefix(id, "~") {
		return false
	}
	low := strings.ToLower(id)

	if providerID == "gemini" {
		if methods, ok := meta["supportedGenerationMethods"].([]any); ok && len(methods) > 0 {
			supportsGen := false
			for _, m := range methods {
				if s, ok := m.(string); ok && s == "generateContent" {
					supportsGen = true
					break
				}
			}
			if !supportsGen {
				return false
			}
		}
		for _, prefix := range []string{"embedding-", "text-embedding-", "gemini-embedding-", "aqa", "imagen-", "veo-"} {
			if strings.HasPrefix(low, prefix) {
				return false
			}
		}
		return true
	}

	if providerID == "openrouter" {
		if arch, ok := meta["architecture"].(map[string]any); ok {
			if outMods, ok := arch["output_modalities"].([]any); ok && len(outMods) > 0 {
				supportsText := false
				for _, mod := range outMods {
					if s, ok := mod.(string); ok && s == "text" {
						supportsText = true
						break
					}
				}
				if !supportsText {
					return false
				}
			}
		}
		return true
	}

	if providerID == "openai" || providerID == "custom" {
		for _, skip := range []string{
			"whisper-",
			"tts-",
			"dall-e-",
			"gpt-image-",
			"chatgpt-image-",
			"text-embedding-",
			"embedding-",
			"omni-moderation-",
			"text-moderation-",
			"babbage-",
			"davinci-",
			"sora-",
		} {
			if strings.HasPrefix(low, skip) {
				return false
			}
		}
		if providerID == "openai" && (strings.Contains(low, "-transcribe") || strings.Contains(low, "-realtime")) {
			return false
		}
	}

	return true
}

func parseModelsFromResponse(providerID string, body []byte) []string {
	var out []string
	seen := make(map[string]struct{})
	add := func(id string, meta map[string]any) {
		id = strings.TrimSpace(strings.TrimPrefix(id, "models/"))
		if !shouldIncludeDiscoveredModel(providerID, id, meta) {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}

	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err == nil {
		if items, ok := raw["data"].([]any); ok {
			for _, item := range items {
				if m, ok := item.(map[string]any); ok {
					if id, ok := m["id"].(string); ok {
						add(id, m)
					}
				}
			}
		}
		if items, ok := raw["models"].([]any); ok {
			for _, item := range items {
				switch v := item.(type) {
				case map[string]any:
					if name, ok := v["name"].(string); ok {
						add(name, v)
					} else if id, ok := v["id"].(string); ok {
						add(id, v)
					} else if mod, ok := v["model"].(string); ok {
						add(mod, v)
					}
				case string:
					add(v, nil)
				}
			}
		}
		return out
	}

	var list []any
	if err := json.Unmarshal(body, &list); err == nil {
		for _, item := range list {
			switch v := item.(type) {
			case map[string]any:
				if id, ok := v["id"].(string); ok {
					add(id, v)
				} else if name, ok := v["name"].(string); ok {
					add(name, v)
				}
			case string:
				add(v, nil)
			}
		}
	}
	return out
}

func defaultCronExprFromSchedule(schedule string) string {
	s := strings.ToLower(strings.TrimSpace(schedule))
	switch {
	case strings.Contains(s, "小时"), strings.Contains(s, "hourly"):
		return "0 * * * *"
	case strings.Contains(s, "周一"), strings.Contains(s, "每周"), strings.Contains(s, "weekly"):
		return "0 9 * * 1"
	case strings.Contains(s, "每天"), strings.Contains(s, "每日"), strings.Contains(s, "daily"):
		return "0 9 * * *"
	default:
		return "0 9 * * *"
	}
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
