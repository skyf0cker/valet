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
	"os/exec"
	"path/filepath"
	"runtime"
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
	pluginsbundle "valet/plugins"
	skillsbundle "valet/skills"
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
	mu              sync.Mutex
	started         bool
	closed          bool
	configured      bool
	configuredOpts  StartOptions
	opts            StartOptions
	store           *store.Store
	client          *sidecar.Client
	engine          *plugins.Engine
	webhookSrv      *http.Server
	controlToken    string
	controlFilePath string
	cliOnce         sync.Once
	cliBinPath      string
	stopMetrics     chan struct{}
	trashMover      sys.TrashMover
	createdInbox    map[string]types.InboxApprovalItem
	createdEvent    map[string]types.TimelineEvent
}

// NewService constructs a zero-I/O Service safe to pass to mygo.Bind before App.Run / MYGO_GENERATE.
func NewService() *Service {
	return &Service{
		createdInbox: make(map[string]types.InboxApprovalItem),
		createdEvent: make(map[string]types.TimelineEvent),
	}
}

// ConfigureService registers desktop StartOptions synchronously before the WebView can issue
// RPC calls, preventing ensureStarted() from racing ahead with DesktopReady=false and nil callbacks.
func ConfigureService(s *Service, opts StartOptions) {
	s.mu.Lock()
	s.configured = true
	s.configuredOpts = opts
	s.mu.Unlock()
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
		if s.opts.OnChatStream == nil && opts.OnChatStream != nil {
			s.opts.OnChatStream = opts.OnChatStream
		}
		if s.opts.OnState == nil && opts.OnState != nil {
			s.opts.OnState = opts.OnState
		}
		if s.opts.OnNotify == nil && opts.OnNotify != nil {
			s.opts.OnNotify = opts.OnNotify
		}
		if s.opts.OnSyncTray == nil && opts.OnSyncTray != nil {
			s.opts.OnSyncTray = opts.OnSyncTray
		}
		if s.opts.OnSyncLogin == nil && opts.OnSyncLogin != nil {
			s.opts.OnSyncLogin = opts.OnSyncLogin
		}
		startMetrics := s.opts.OnMetrics == nil && opts.OnMetrics != nil && !s.closed
		if startMetrics {
			s.opts.OnMetrics = opts.OnMetrics
		}
		s.mu.Unlock()
		if startMetrics {
			go s.metricsLoop()
		}
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

	bunBin := resolveBunBinaryWithOpts(opts)
	if opts.DataDir != "" && bunBin != "" && bunBin != "bun" {
		binDir := filepath.Join(opts.DataDir, "bin")
		_ = os.MkdirAll(binDir, 0o755)
		bunLink := filepath.Join(binDir, "bun")
		_ = os.Remove(bunLink)
		_ = os.Symlink(bunBin, bunLink)
	}

	eng := plugins.NewEngine(plugins.EngineConfig{
		HomeDir:    opts.HomeDir,
		DataDir:    opts.DataDir,
		BunPath:    bunBin,
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

	webhookEndpoint, webhookSrv, wErr := s.startWebhookServer(opts.DesktopReady)
	if wErr != nil {
		fmt.Fprintf(os.Stderr, "[valet] webhook server start error: %v\n", wErr)
	} else {
		s.mu.Lock()
		s.webhookSrv = webhookSrv
		s.mu.Unlock()
	}

	st.Update(func(snapMut *types.ValetSnapshot) {
		if webhookEndpoint != "" {
			snapMut.Preferences.PluginRuntime.WebhookEndpoint = webhookEndpoint
		}
		pluginsBaseDir := ""
		if opts.DataDir != "" {
			pluginsBaseDir = filepath.Join(opts.DataDir, "plugins")
		}
		for i := range snapMut.Plugins {
			snapMut.Plugins[i].Actions = nil
			if snapMut.Plugins[i].Config.Values == nil {
				snapMut.Plugins[i].Config.Values = map[string]any{}
			}
			if snapMut.Plugins[i].Installed && snapMut.Plugins[i].Source != "local" && pluginsBaseDir != "" {
				slug := plugins.NormalizeSlug(snapMut.Plugins[i].Slug)
				if slug == "" || slug == "local-plugin" {
					slug = plugins.NormalizeSlug(snapMut.Plugins[i].ID)
				}
				if matDir, matFiles, mErr := plugins.MaterializeCatalogPlugin(pluginsbundle.CatalogFS, slug, pluginsBaseDir); mErr == nil {
					snapMut.Plugins[i].LocalDir = matDir
					if len(matFiles) > 0 {
						snapMut.Plugins[i].BundledFiles = matFiles
					}
					if strings.TrimSpace(snapMut.Plugins[i].SkillMarkdown) == "" {
						if _, skillMD, _, _, rErr := plugins.ReadPluginBundle(matDir); rErr == nil && strings.TrimSpace(skillMD) != "" {
							snapMut.Plugins[i].SkillMarkdown = skillMD
						}
					}
				}
			} else if snapMut.Plugins[i].LocalDir != "" && len(snapMut.Plugins[i].BundledFiles) == 0 {
				if _, _, _, files, rErr := plugins.ReadPluginBundle(snapMut.Plugins[i].LocalDir); rErr == nil && len(files) > 0 {
					snapMut.Plugins[i].BundledFiles = files
				}
			}

			parsed, pErr := plugins.ParseManifestYAML(snapMut.Plugins[i].ManifestYAML)
			if strings.TrimSpace(snapMut.Plugins[i].SkillMarkdown) == "" && pErr == nil && strings.TrimSpace(parsed.Skill) != "" {
				snapMut.Plugins[i].SkillMarkdown = parsed.Skill
			}
			if pErr == nil {
				evs, _ := plugins.ManifestSpecsToPoliciesAndActions(parsed, snapMut.Plugins[i].Events)
				if len(evs) > 0 {
					snapMut.Plugins[i].Events = evs
				}
				if len(snapMut.Plugins[i].ConfigSchema) == 0 && len(parsed.ConfigSchema) > 0 {
					snapMut.Plugins[i].ConfigSchema = parsed.ConfigSchema
				}
			}
		}

		// Discover and merge local plugin bundles from <dataDir>/plugins/*/manifest.yaml
		if pluginsBaseDir != "" {
			if localBundles, dErr := plugins.DiscoverLocalPlugins(pluginsBaseDir); dErr == nil {
				for _, bundle := range localBundles {
					mergeLocalPluginIntoSlice(&snapMut.Plugins, bundle)
				}
			}
		}
	})

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
	go s.heartbeatLoop()
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
	webhookSrv := s.webhookSrv
	controlFile := s.controlFilePath
	s.webhookSrv = nil
	s.controlFilePath = ""
	s.mu.Unlock()

	if controlFile != "" {
		_ = os.Remove(controlFile)
	}

	if stopCh != nil {
		close(stopCh)
	}
	if webhookSrv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = webhookSrv.Shutdown(ctx)
		cancel()
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
	opts := StartOptions{DesktopReady: false}
	if s.configured {
		opts = s.configuredOpts
	}
	s.mu.Unlock()
	if started {
		return nil
	}
	return s.start(opts)
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

func (s *Service) heartbeatLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	lastRun := time.Now()
	for {
		select {
		case <-s.stopMetrics:
			return
		case now := <-ticker.C:
			snap := s.store.Snapshot()
			if !snap.OnboardingCompleted || snap.IsPaused || !snap.Preferences.Heartbeat.Enabled {
				continue
			}
			if plugins.InQuietHours(snap.Preferences.PluginRuntime.QuietHours, now) {
				continue
			}
			mins := snap.Preferences.Heartbeat.IntervalMin
			if mins <= 0 {
				mins = 30
			}
			if now.Sub(lastRun) < time.Duration(mins)*time.Minute {
				continue
			}
			lastRun = now
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			_, _ = s.TriggerHeartbeatNow(ctx)
			cancel()
		}
	}
}

// TriggerHeartbeatNow runs one proactive Agent heartbeat inspection turn and records it in HeartbeatLogs (never on Timeline).
func (s *Service) TriggerHeartbeatNow(ctx context.Context) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	startedAt := time.Now()
	snap := s.store.Snapshot()
	prompt := strings.TrimSpace(snap.Preferences.Heartbeat.Prompt)
	if prompt == "" {
		prompt = store.DefaultHeartbeatConfig().Prompt
	}
	model := strings.TrimSpace(snap.Preferences.Models.Fast)
	if model == "" {
		model = snap.Preferences.Models.Primary
	}
	nowHHMM := time.Now().Format("15:04")
	s.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences.Heartbeat.LastRunAt = nowHHMM
	})

	status := "ok"
	summary := "已完成本轮心跳巡检，系统状态平稳。"
	detail := summary
	if s.client != nil {
		s.syncSidecarBlocking(ctx, s.store.Snapshot())
		var resp sidecar.ChatSendResponse
		if err := s.client.Call(ctx, "chat.send", sidecar.ChatSendRequest{
			ChatID:    "heartbeat:system",
			Prompt:    "[AGENT_HEARTBEAT] " + prompt,
			Model:     model,
			RequestID: fmt.Sprintf("hb-%d", time.Now().UnixNano()),
		}, &resp); err == nil {
			txt := strings.TrimSpace(resp.ReplyMessage.Content)
			if txt != "" {
				runes := []rune(txt)
				if len(runes) > 4000 {
					detail = string(runes[:3999]) + "…"
				} else {
					detail = txt
				}
				for _, ln := range strings.Split(txt, "\n") {
					cleaned := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(ln), "#*-• "))
					if cleaned == "" {
						continue
					}
					cRunes := []rune(cleaned)
					if len(cRunes) > 120 {
						summary = string(cRunes[:119]) + "…"
					} else {
						summary = cleaned
					}
					break
				}
			}
			s.store.Update(func(st *types.ValetSnapshot) {
				if resp.UsageCostDelta > 0 {
					st.Preferences.DailySpendCurrent = math.Round((st.Preferences.DailySpendCurrent+resp.UsageCostDelta)*100) / 100
				}
			})
		} else {
			status = "error"
			summary = "心跳巡检执行失败"
			detail = err.Error()
		}
	}

	next := s.store.Update(func(st *types.ValetSnapshot) {
		entry := types.HeartbeatRunLog{
			ID:         fmt.Sprintf("hb-log-%d", time.Now().UnixNano()),
			Timestamp:  time.Now().Format(time.RFC3339),
			CreatedAt:  nowHHMM,
			Status:     status,
			Model:      model,
			DurationMs: int(time.Since(startedAt).Milliseconds()),
			Summary:    summary,
			Detail:     detail,
		}
		st.HeartbeatLogs = append([]types.HeartbeatRunLog{entry}, st.HeartbeatLogs...)
		if len(st.HeartbeatLogs) > 50 {
			st.HeartbeatLogs = st.HeartbeatLogs[:50]
		}
	})
	s.emitStateChange("preferences")
	return next, nil
}

// ClearHeartbeatLogs clears stored Agent heartbeat execution history.
func (s *Service) ClearHeartbeatLogs() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	return s.store.Update(func(st *types.ValetSnapshot) {
		st.HeartbeatLogs = []types.HeartbeatRunLog{}
	}), nil
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
		HomeDir:       s.opts.HomeDir,
		DataDir:       s.opts.DataDir,
		IsPaused:      snap.IsPaused,
		Preferences:   snap.Preferences,
		Providers:     snap.Providers,
		Plugins:       snap.Plugins,
		McpServers:    snap.McpServers,
		Memories:      snap.Memories,
		BuiltinSkills: s.listAllSkills(),
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
	if raw, err := mygo.Secrets.Get("autoreview.jev.apikey"); err == nil {
		val := strings.TrimSpace(string(raw))
		if val != "" && val != snap.Preferences.AutoReview.JevAPIKey {
			updated = true
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
		if raw, err := mygo.Secrets.Get("autoreview.jev.apikey"); err == nil {
			val := strings.TrimSpace(string(raw))
			if val != "" {
				st.Preferences.AutoReview.JevAPIKey = val
				st.Preferences.AutoReview.JevAPIKeyMasked = maskSecretKey(val)
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
			eventID := ""
			if d.Payload != nil {
				if raw, ok := d.Payload["event_id"].(string); ok {
					eventID = strings.TrimSpace(raw)
				}
			}
			if _, err := s.enqueuePluginEventAlwaysOn(ctx, d.PluginID, d.EventCode, d.Payload, "plugin", eventID, true); err != nil {
				_, _ = s.dispatchPluginEventInternal(ctx, d.PluginID, d.EventCode, d.Payload, false)
			}
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
	s.mu.Lock()
	onState := s.opts.OnState
	s.mu.Unlock()
	if onState != nil {
		onState(types.StateChangeNotice{Scope: scope})
	}
}

func (s *Service) handleSidecarNotify(method string, params json.RawMessage) {
	switch method {
	case "host.chatStream":
		s.mu.Lock()
		onChatStream := s.opts.OnChatStream
		s.mu.Unlock()
		if onChatStream == nil {
			return
		}
		var payload types.ChatStreamPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			fmt.Fprintf(os.Stderr, "[valet] chatStream unmarshal error: %v\n", err)
			return
		}
		onChatStream(payload)
	case "host.alwaysOnUpdate":
		s.emitStateChange("always_on")
	case "host.outboxNotify":
		var payload sidecar.AlwaysOnOutboxNotifyPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			fmt.Fprintf(os.Stderr, "[valet] outboxNotify unmarshal error: %v\n", err)
			return
		}
		s.handleAlwaysOnOutboxNotify(payload)
	}
}

func (s *Service) handleAlwaysOnOutboxNotify(payload sidecar.AlwaysOnOutboxNotifyPayload) {
	msg := payload.Message
	s.mu.Lock()
	onNotify := s.opts.OnNotify
	s.mu.Unlock()
	if onNotify != nil {
		kind := payload.Level
		if kind == "" {
			kind = "info"
		}
		if msg.Kind == "dead_letter" {
			kind = "warn"
		}
		onNotify(kind, msg.Title, "Valet 管家通知", msg.Body)
	}

	status := "completed"
	eventCode := "outbox.message"
	if msg.Kind == "dead_letter" {
		status = "failed"
		eventCode = "inbox.dead_letter"
	}
	s.recordTimelineFromAgent(sidecar.RecordTimelineRequest{
		PluginID:   "valet-core",
		PluginName: "Valet 管家",
		EventCode:  eventCode,
		Title:      msg.Title,
		Summary:    summarizeMarkdownReply(msg.Body),
		Status:     status,
		Reasoning:  msg.Body,
		Payload: map[string]any{
			"outbox_id": msg.ID,
			"kind":      msg.Kind,
			"run_id":    msg.RunID,
			"detail":    msg.Detail,
		},
	})
	s.emitStateChange("always_on")
}

// enqueuePluginEventAlwaysOn routes live background plugin/webhook events into the durable Always-On Inbox
// for deduplication, taint tracking, and debounce coalescing.
func (s *Service) enqueuePluginEventAlwaysOn(
	ctx context.Context,
	pluginID string,
	eventCode string,
	payload map[string]any,
	source string,
	eventID string,
	trusted bool,
) (sidecar.AlwaysOnIngestResponse, error) {
	if err := s.ensureStarted(); err != nil {
		return sidecar.AlwaysOnIngestResponse{}, err
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
		return sidecar.AlwaysOnIngestResponse{}, fmt.Errorf("plugin not found: %s", pluginID)
	}
	if !plugin.Installed || !plugin.Enabled {
		return sidecar.AlwaysOnIngestResponse{}, fmt.Errorf("plugin %s is disabled", pluginID)
	}

	policy := "ask"
	for _, ev := range plugin.Events {
		if ev.ID == eventCode {
			policy = ev.Policy
			break
		}
	}
	if policy == "record" {
		s.recordPluginTriggerStat(pluginID, eventCode, fmt.Sprintf("刚刚记录 · %s", eventCode))
		s.recordTimelineFromAgent(sidecar.RecordTimelineRequest{
			PluginID:   plugin.ID,
			PluginName: plugin.Name,
			EventCode:  eventCode,
			Title:      fmt.Sprintf("%s 捕获 %s", plugin.Name, eventCode),
			Summary:    "策略为「仅记录」，已归档到时间线供你随时回溯。",
			Status:     "completed",
			Reasoning:  fmt.Sprintf("事件 %s 策略配置为 record，仅写入时间线。", eventCode),
			Payload:    payload,
		})
		return sidecar.AlwaysOnIngestResponse{}, nil
	}

	if s.client == nil {
		return sidecar.AlwaysOnIngestResponse{}, errors.New("sidecar client not initialized")
	}

	s.recordPluginTriggerStat(pluginID, eventCode, fmt.Sprintf("已入队 · %s", eventCode))

	reqPayload := make(map[string]any, len(payload)+3)
	for k, v := range payload {
		reqPayload[k] = v
	}
	reqPayload["bundle"] = plugin.BundleID
	reqPayload["policy"] = policy
	payloadBytes, _ := json.Marshal(reqPayload)

	title := fmt.Sprintf("%s · %s", plugin.Name, eventCode)
	if customTitle, ok := reqPayload["title"].(string); ok && strings.TrimSpace(customTitle) != "" {
		title = strings.TrimSpace(customTitle)
	}

	s.syncSidecarBlocking(ctx, s.store.Snapshot())
	var resp sidecar.AlwaysOnIngestResponse
	t := trusted
	if err := s.client.Call(ctx, "alwaysOn.ingest", sidecar.AlwaysOnIngestRequest{
		Source:    source,
		PluginID:  plugin.ID,
		EventType: eventCode,
		Title:     title,
		Payload:   string(payloadBytes),
		EventID:   eventID,
		Trusted:   &t,
		ThreadKey: "event:" + plugin.ID,
	}, &resp); err != nil {
		return sidecar.AlwaysOnIngestResponse{}, err
	}
	return resp, nil
}

// GetAlwaysOnSnapshot returns the sidecar's durable Inbox queue, Runs, Timers, and Outbox snapshot.
func (s *Service) GetAlwaysOnSnapshot(ctx context.Context) (types.AlwaysOnSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.AlwaysOnSnapshot{}, err
	}
	if s.client == nil {
		return types.AlwaysOnSnapshot{}, errors.New("sidecar not running")
	}
	var out types.AlwaysOnSnapshot
	if err := s.client.Call(ctx, "alwaysOn.snapshot", map[string]any{}, &out); err != nil {
		return types.AlwaysOnSnapshot{}, err
	}
	return out, nil
}

// RetryAlwaysOnInboxItem resets a dead or delayed Always-On Inbox event back to queued for immediate execution.
func (s *Service) RetryAlwaysOnInboxItem(ctx context.Context, itemID string) (*types.AlwaysOnInboxItem, error) {
	if err := s.ensureStarted(); err != nil {
		return nil, err
	}
	if s.client == nil {
		return nil, errors.New("sidecar not running")
	}
	var out *types.AlwaysOnInboxItem
	if err := s.client.Call(ctx, "alwaysOn.retryInbox", map[string]any{"itemId": itemID}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// CreateAlwaysOnTimer creates a durable one-shot follow_up or drift-free periodic schedule timer.
func (s *Service) CreateAlwaysOnTimer(ctx context.Context, params types.CreateAlwaysOnTimerParams) (types.AlwaysOnTimer, error) {
	if err := s.ensureStarted(); err != nil {
		return types.AlwaysOnTimer{}, err
	}
	if s.client == nil {
		return types.AlwaysOnTimer{}, errors.New("sidecar not running")
	}
	var out types.AlwaysOnTimer
	if err := s.client.Call(ctx, "alwaysOn.createTimer", params, &out); err != nil {
		return types.AlwaysOnTimer{}, err
	}
	return out, nil
}

// CancelAlwaysOnTimer cancels an armed Always-On timer by ID.
func (s *Service) CancelAlwaysOnTimer(ctx context.Context, timerID string) (*types.AlwaysOnTimer, error) {
	if err := s.ensureStarted(); err != nil {
		return nil, err
	}
	if s.client == nil {
		return nil, errors.New("sidecar not running")
	}
	var out *types.AlwaysOnTimer
	if err := s.client.Call(ctx, "alwaysOn.cancelTimer", map[string]any{"timerId": timerID}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// MarkOutboxMessageRead marks a single Always-On Outbox notification as read.
func (s *Service) MarkOutboxMessageRead(ctx context.Context, msgID string) (*types.AlwaysOnOutboxMessage, error) {
	if err := s.ensureStarted(); err != nil {
		return nil, err
	}
	if s.client == nil {
		return nil, errors.New("sidecar not running")
	}
	var out *types.AlwaysOnOutboxMessage
	if err := s.client.Call(ctx, "alwaysOn.markOutboxRead", map[string]any{"msgId": msgID}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// MarkAllOutboxRead marks all unread Always-On Outbox notifications as read.
func (s *Service) MarkAllOutboxRead(ctx context.Context) (int, error) {
	if err := s.ensureStarted(); err != nil {
		return 0, err
	}
	if s.client == nil {
		return 0, errors.New("sidecar not running")
	}
	var out struct {
		Cleared int `json:"cleared"`
	}
	if err := s.client.Call(ctx, "alwaysOn.markAllOutboxRead", map[string]any{}, &out); err != nil {
		return 0, err
	}
	return out.Cleared, nil
}

func (s *Service) handleSidecarHostRequest(ctx context.Context, method string, raw json.RawMessage) (any, error) {
	snap := s.store.Snapshot()
	switch method {
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

	case "host.kernel.bash":
		return s.execKernelBash(ctx, snap, raw)

	case "host.kernel.readFile":
		return s.execKernelReadFile(snap, raw)

	case "host.kernel.listDir":
		return s.execKernelListDir(snap, raw)

	case "host.kernel.writeFile":
		return s.execKernelWriteFile(snap, raw)

	case "host.kernel.trashFiles":
		return s.execKernelTrashFiles(snap, raw)

	case "host.kernel.killProcess":
		return s.execKernelKillProcess(snap, raw)

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

	case "host.skills.list":
		return map[string]any{
			"skills": s.listAllSkills(),
		}, nil

	case "host.skills.read":
		var req struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		target := strings.TrimSpace(req.Name)
		for _, sk := range s.listAllSkills() {
			if strings.EqualFold(sk.Name, target) {
				return sk, nil
			}
		}
		for _, p := range snap.Plugins {
			if strings.EqualFold(p.ID, target) || strings.EqualFold(p.Slug, target) || strings.EqualFold(p.Name, target) {
				return types.BuiltinSkillMeta{
					Name:        p.ID,
					Title:       p.Name,
					Description: p.Tagline,
					Content:     p.SkillMarkdown,
					Source:      "plugin",
				}, nil
			}
		}
		return nil, fmt.Errorf("未找到名为 %q 的 Skill", target)

	case "host.plugin.list":
		return map[string]any{
			"pluginsDir": filepath.Join(s.opts.DataDir, "plugins"),
			"plugins":    snap.Plugins,
		}, nil

	case "host.plugin.inspect":
		var req struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		pl, files, err := s.inspectPluginDetail(req.ID)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"plugin": pl,
			"files":  files,
		}, nil

	case "host.plugin.upsert":
		var req types.UpsertLocalPluginParams
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		next, pl, err := s.upsertLocalPlugin(req)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"plugin":  pl,
			"plugins": next.Plugins,
		}, nil

	case "host.plugin.installDir":
		var req struct {
			Dir     string `json:"dir"`
			Slug    string `json:"slug"`
			Name    string `json:"name"`
			Tagline string `json:"tagline"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		next, pl, err := s.installPluginFromDir(req.Dir, req.Slug, req.Name, req.Tagline, "")
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"plugin":  pl,
			"plugins": next.Plugins,
		}, nil

	case "host.plugin.reload":
		var req struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(raw, &req)
		next, err := s.ReloadPlugin(req.ID)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"plugins": next.Plugins,
		}, nil

	case "host.plugin.configure":
		var req struct {
			ID      string `json:"id"`
			Enabled *bool  `json:"enabled"`
			EventID string `json:"eventId"`
			Policy  string `json:"policy"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		pid := strings.TrimSpace(req.ID)
		var updated types.PluginState
		found := false
		next := s.store.Update(func(st *types.ValetSnapshot) {
			for i := range st.Plugins {
				if st.Plugins[i].ID == pid || st.Plugins[i].Slug == pid {
					found = true
					if req.Enabled != nil {
						st.Plugins[i].Enabled = *req.Enabled
						if *req.Enabled {
							st.Plugins[i].Installed = true
						}
					}
					if req.EventID != "" && req.Policy != "" {
						for j := range st.Plugins[i].Events {
							if st.Plugins[i].Events[j].ID == req.EventID {
								st.Plugins[i].Events[j].Policy = req.Policy
							}
						}
					}
					updated = st.Plugins[i]
				}
			}
		})
		if !found {
			return nil, fmt.Errorf("未找到插件: %q", pid)
		}
		s.syncRuntime(next)
		s.emitStateChange("plugins")
		return map[string]any{
			"plugin":  updated,
			"plugins": next.Plugins,
		}, nil

	case "host.plugin.remove":
		var req struct {
			ID          string `json:"id"`
			DeleteFiles *bool  `json:"deleteFiles"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		delFiles := true
		if req.DeleteFiles != nil {
			delFiles = *req.DeleteFiles
		}
		next, err := s.RemoveLocalPluginWithFiles(req.ID, delFiles)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"removed": req.ID,
			"plugins": next.Plugins,
		}, nil

	case "host.plugin.trigger":
		var req struct {
			ID          string `json:"id"`
			EventID     string `json:"eventId"`
			PayloadJSON string `json:"payloadJson"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, err
		}
		return s.TriggerPluginEvent(ctx, strings.TrimSpace(req.ID), strings.TrimSpace(req.EventID), req.PayloadJSON)

	case "host.item.resolve":
		return s.execHostItemResolve(ctx, raw)

	default:
		return nil, fmt.Errorf("unknown host RPC method: %s", method)
	}
}

func (s *Service) execKernelBash(ctx context.Context, _ types.ValetSnapshot, raw json.RawMessage) (any, error) {
	var req struct {
		Command    string `json:"command"`
		Cwd        string `json:"cwd"`
		TimeoutSec int    `json:"timeoutSec"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}
	command := strings.TrimSpace(req.Command)
	if command == "" {
		return nil, errors.New("bash 缺少 command 参数")
	}

	low := strings.ToLower(command)
	if strings.Contains(low, "/.ssh") ||
		strings.Contains(low, "/.gnupg") ||
		strings.Contains(low, "/.aws") ||
		strings.Contains(low, "keychains") ||
		strings.Contains(low, "rm -rf /") ||
		strings.Contains(low, "mkfs") ||
		strings.HasPrefix(low, "sudo ") ||
		strings.Contains(low, " sudo ") ||
		strings.Contains(low, ";sudo ") ||
		strings.Contains(low, "&&sudo ") ||
		strings.Contains(low, "|sudo ") {
		return nil, errors.New("安全边界拒绝：禁止通过 bash 工具执行提权或访问密钥目录等高危指令")
	}

	homeDir := strings.TrimSpace(s.opts.HomeDir)
	if homeDir == "" {
		if h, err := os.UserHomeDir(); err == nil {
			homeDir = h
		}
	}

	cwd := strings.TrimSpace(req.Cwd)
	if cwd == "" {
		cwd = homeDir
	} else {
		if cwd == "~" {
			cwd = homeDir
		} else if strings.HasPrefix(cwd, "~/") && homeDir != "" {
			cwd = filepath.Join(homeDir, cwd[2:])
		}
		cwd = filepath.Clean(cwd)
	}
	if cwd != "" {
		info, err := os.Stat(cwd)
		if err != nil {
			return nil, fmt.Errorf("工作目录不可访问 (%s): %w", cwd, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("工作目录不是有效文件夹: %s", cwd)
		}
	}

	timeoutSec := req.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 20
	} else if timeoutSec > 90 {
		timeoutSec = 90
	}
	reqCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()

	shellPath := "/bin/sh"
	shellArgs := []string{"-c", command}
	if _, err := os.Stat("/bin/zsh"); err == nil {
		shellPath = "/bin/zsh"
		shellArgs = []string{"-lc", command}
	}

	start := time.Now()
	cmd := exec.CommandContext(reqCtx, shellPath, shellArgs...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.Env = s.buildKernelBashEnv()
	out, err := cmd.CombinedOutput()
	durationMs := time.Since(start).Milliseconds()

	exitCode := 0
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	const maxBytes = 24 * 1024
	text := string(out)
	if len(text) > maxBytes {
		text = text[:maxBytes] + "\n…(输出已截断)"
	}
	trimmed := strings.TrimSpace(text)

	summary := fmt.Sprintf("执行完成 (exit=%d)", exitCode)
	if trimmed != "" {
		firstLine, _, _ := strings.Cut(trimmed, "\n")
		firstRunes := []rune(strings.TrimSpace(firstLine))
		if len(firstRunes) > 80 {
			firstLine = string(firstRunes[:79]) + "…"
		} else {
			firstLine = string(firstRunes)
		}
		summary = fmt.Sprintf("exit=%d · %s", exitCode, firstLine)
	}

	return map[string]any{
		"ok":         err == nil,
		"command":    command,
		"cwd":        cwd,
		"exitCode":   exitCode,
		"durationMs": durationMs,
		"output":     trimmed,
		"summary":    summary,
	}, nil
}

func resolveSafeHostPath(rawPath, homeDir string) (string, error) {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return "", errors.New("缺少 path 参数")
	}
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	expanded := sys.ExpandHome(trimmed, homeDir)
	abs, err := filepath.Abs(expanded)
	if err != nil {
		return "", err
	}
	low := strings.ToLower(filepath.Clean(abs))
	for _, seg := range []string{"/.ssh", "/.gnupg", "/.aws", "/library/keychains"} {
		if strings.HasSuffix(low, seg) || strings.Contains(low, seg+"/") {
			return "", fmt.Errorf("安全边界拒绝：禁止访问敏感凭据路径 %q", rawPath)
		}
	}
	return abs, nil
}

func (s *Service) execKernelReadFile(_ types.ValetSnapshot, raw json.RawMessage) (any, error) {
	var req struct {
		Path       string `json:"path"`
		OffsetLine int    `json:"offsetLine"`
		LimitLines int    `json:"limitLines"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}
	abs, err := resolveSafeHostPath(req.Path, s.opts.HomeDir)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("%q 是目录，请使用 list_dir 读取目录内容", req.Path)
	}
	if info.Size() > 4*1024*1024 {
		return nil, fmt.Errorf("文件过大 (%d bytes)，建议用 bash head/tail 或 offsetLine 分段查看", info.Size())
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	totalLines := len(lines)
	offset := req.OffsetLine
	if offset <= 0 {
		offset = 1
	}
	limit := req.LimitLines
	if limit <= 0 {
		limit = 200
	} else if limit > 500 {
		limit = 500
	}
	startIdx := offset - 1
	if startIdx >= totalLines {
		return map[string]any{
			"path":       abs,
			"totalLines": totalLines,
			"startLine":  offset,
			"endLine":    offset - 1,
			"content":    "",
		}, nil
	}
	endIdx := startIdx + limit
	if endIdx > totalLines {
		endIdx = totalLines
	}
	content := strings.Join(lines[startIdx:endIdx], "\n")
	const maxBytes = 64 * 1024
	if len(content) > maxBytes {
		content = content[:maxBytes] + "\n…(内容已截断)"
	}
	return map[string]any{
		"path":       abs,
		"totalLines": totalLines,
		"startLine":  startIdx + 1,
		"endLine":    endIdx,
		"content":    content,
	}, nil
}

func (s *Service) execKernelListDir(_ types.ValetSnapshot, raw json.RawMessage) (any, error) {
	var req struct {
		Path       string `json:"path"`
		MaxEntries int    `json:"maxEntries"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}
	target := strings.TrimSpace(req.Path)
	if target == "" {
		target = "~"
	}
	abs, err := resolveSafeHostPath(target, s.opts.HomeDir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	maxEntries := req.MaxEntries
	if maxEntries <= 0 {
		maxEntries = 100
	} else if maxEntries > 500 {
		maxEntries = 500
	}
	out := make([]map[string]any, 0, min(len(entries), maxEntries))
	for _, entry := range entries {
		if len(out) >= maxEntries {
			break
		}
		info, iErr := entry.Info()
		sizeBytes := int64(0)
		modTime := ""
		if iErr == nil {
			sizeBytes = info.Size()
			modTime = info.ModTime().Format(time.RFC3339)
		}
		out = append(out, map[string]any{
			"name":      entry.Name(),
			"path":      filepath.Join(abs, entry.Name()),
			"isDir":     entry.IsDir(),
			"sizeBytes": sizeBytes,
			"modTime":   modTime,
		})
	}
	return map[string]any{
		"path":       abs,
		"totalCount": len(entries),
		"entries":    out,
	}, nil
}

func (s *Service) execKernelWriteFile(_ types.ValetSnapshot, raw json.RawMessage) (any, error) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Append  bool   `json:"append"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}
	abs, err := resolveSafeHostPath(req.Path, s.opts.HomeDir)
	if err != nil {
		return nil, err
	}
	clean := filepath.Clean(abs)
	homeClean := filepath.Clean(s.opts.HomeDir)
	if clean == "/" || (homeClean != "" && clean == homeClean) {
		return nil, fmt.Errorf("安全边界拒绝：禁止写入根目录或用户主目录 %q", req.Path)
	}
	for _, sysPrefix := range []string{"/System", "/usr", "/bin", "/sbin", "/Applications"} {
		if clean == sysPrefix || strings.HasPrefix(clean, sysPrefix+"/") {
			return nil, fmt.Errorf("安全边界拒绝：禁止写入系统路径 %q", req.Path)
		}
	}
	if err := os.MkdirAll(filepath.Dir(clean), 0o755); err != nil {
		return nil, err
	}
	data := []byte(req.Content)
	if req.Append {
		f, fErr := os.OpenFile(clean, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if fErr != nil {
			return nil, fErr
		}
		n, wErr := f.Write(data)
		_ = f.Close()
		if wErr != nil {
			return nil, wErr
		}
		return map[string]any{
			"ok":           true,
			"path":         clean,
			"bytesWritten": n,
			"append":       true,
		}, nil
	}
	if err := os.WriteFile(clean, data, 0o644); err != nil {
		return nil, err
	}
	return map[string]any{
		"ok":           true,
		"path":         clean,
		"bytesWritten": len(data),
		"append":       false,
	}, nil
}

func (s *Service) execKernelTrashFiles(snap types.ValetSnapshot, raw json.RawMessage) (any, error) {
	var req struct {
		Paths []string `json:"paths"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}
	var cleanPaths []string
	for _, p := range req.Paths {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			cleanPaths = append(cleanPaths, trimmed)
		}
	}
	if len(cleanPaths) == 0 {
		return nil, errors.New("trash_files 需要至少一个目标路径")
	}
	activeMover := s.trashMover
	if snap.Preferences.CleanupPolicy.DeleteMethod == "安全移出到隔离区" {
		activeMover = nil
	}
	batchID, movedCount, reclaimedGB, err := sys.MoveItemsToTrash(
		s.opts.HomeDir,
		s.opts.DataDir,
		snap.Preferences.CleanupPolicy.ProtectedDirs,
		cleanPaths,
		0,
		activeMover,
	)
	if err != nil {
		return nil, err
	}
	if movedCount > 0 {
		s.refreshHostMetrics()
	}
	return map[string]any{
		"ok":          true,
		"batchId":     batchID,
		"movedCount":  movedCount,
		"reclaimedGB": reclaimedGB,
		"summary":     fmt.Sprintf("已将 %d 项移入废纸篓（释放约 %.2f GB，7 天内可还原）", movedCount, reclaimedGB),
	}, nil
}

func (s *Service) execKernelKillProcess(snap types.ValetSnapshot, raw json.RawMessage) (any, error) {
	var req struct {
		PID    int    `json:"pid"`
		Name   string `json:"name"`
		Signal string `json:"signal"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}
	sig := strings.ToUpper(strings.TrimSpace(req.Signal))
	if sig == "" {
		sig = "SIGTERM"
	}
	if err := sys.TerminateProcess(req.PID, req.Name, sig, snap.Preferences.BlockedApps); err != nil {
		return nil, err
	}
	return map[string]any{
		"ok":      true,
		"pid":     req.PID,
		"name":    req.Name,
		"signal":  sig,
		"summary": fmt.Sprintf("已向进程 %s (PID %d) 发送 %s", req.Name, req.PID, sig),
	}, nil
}

func (s *Service) queueApprovalFromAgent(req sidecar.QueueApprovalRequest) map[string]string {
	now := time.Now()
	nowHHMM := now.Format("15:04")
	ts := now.Format(time.RFC3339)
	evtID := fmt.Sprintf("evt-ag-%d", now.UnixNano())
	inboxID := fmt.Sprintf("inbox-ag-%d", now.UnixNano())

	options := extractStringSlice(req.Options)
	if len(options) == 0 {
		options = extractStringSlice(req.ToolArgs["options"])
	}
	sourceChatID := strings.TrimSpace(req.SourceChatID)
	if sourceChatID == "" {
		if cid, ok := req.ToolArgs["sourceChatId"].(string); ok {
			sourceChatID = strings.TrimSpace(cid)
		}
	}
	isQuestion := req.EventCode == "user.question" || req.ToolName == "ask_user"
	reversible7d := req.Reversible7d
	traceStage := "安全拦截"
	traceDetail := "策略要求人工批准后执行 " + req.ToolName
	evtTriggerLabel := nowHHMM + " · Agent 安全拦截"
	if isQuestion {
		reversible7d = false
		traceStage = "等待确认"
		traceDetail = "等待你在收件箱选择处理方案"
		evtTriggerLabel = nowHHMM + " · 等待用户确认"
	}

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
		TriggerLatencyLabel: evtTriggerLabel,
		Payload:             req.ToolArgs,
		Reasoning:           req.Reasoning,
		ActionItems:         req.ActionItems,
		TraceSteps: []types.TraceStep{
			{ID: "st1", Time: nowHHMM, Stage: traceStage, Detail: traceDetail, Status: "active"},
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
		Reversible7d:          reversible7d,
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
		Options:               options,
		SourceChatID:          sourceChatID,
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
		_ = mygo.Secrets.Delete("autoreview.jev.apikey")
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

	isPluginActive := func(id string) bool {
		for _, p := range snap.Plugins {
			if p.ID == id || p.Slug == id {
				return p.Installed && p.Enabled
			}
		}
		return false
	}

	var diskReport sys.DiskScanReport
	diskTask := types.ScanTaskItem{ID: "disk", Title: "磁盘", Detail: "插件「磁盘守卫」已停用，已跳过", SizeLabel: "—", Status: "skipped"}
	if isPluginActive("disk-guard") {
		diskReport = sys.ScanDisk(s.opts.HomeDir, snap.Preferences.CleanupPolicy.ProtectedDirs, 2048, 90)
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
	if isPluginActive("uninstall-scrubber") {
		remnants := sys.ScanOrphanRemnants(s.opts.HomeDir, "")
		orphanCount := len(remnants)
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
	if isPluginActive("process-sentinel") {
		procs = sys.SampleProcesses(ctx, 3)
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
	if isPluginActive("log-detective") {
		summary := sys.SummarizeDiagnosticLogs(s.opts.HomeDir, 120)
		logTask = types.ScanTaskItem{
			ID:        "log",
			Title:     "系统日志",
			Detail:    summary.Summary,
			SizeLabel: fmt.Sprintf("%d 份", summary.Count),
			SizeGB:    0,
			Status:    "done",
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

func makeWelcomeChatThread(primaryModel, nick string) types.ChatThread {
	if strings.TrimSpace(nick) == "" {
		nick = "你"
	}
	nowHHMM := time.Now().Format("15:04")
	newID := fmt.Sprintf("chat-%d", time.Now().UnixNano())
	return types.ChatThread{
		ID:             newID,
		Title:          "新对话",
		Model:          primaryModel,
		UpdatedAt:      "刚刚",
		LinkedEventIDs: []string{},
		Messages: []types.ChatMessage{
			{
				ID:        "welcome-" + newID,
				Role:      "assistant",
				MetaLabel: primaryModel + " · 就绪",
				CreatedAt: nowHHMM,
				Content:   fmt.Sprintf("%s好，我是驻留在你 Mac 上的事件管家。我可以监听本机与外部事件、按策略自动响应异常，或用自然语言为你编排专属插件与 Skill。", nick),
			},
		},
	}
}

// CreateChatThread creates and activates a new conversation thread.
func (s *Service) CreateChatThread() (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		thread := makeWelcomeChatThread(st.Preferences.Models.Primary, st.Preferences.UserNickname)
		st.ActiveView = string(types.ViewChat)
		st.ActiveChatID = thread.ID
		st.ChatThreads = append([]types.ChatThread{thread}, st.ChatThreads...)
	})
	return next, nil
}

// ArchiveChatThread marks a conversation archived or restores it, ensuring an active non-archived thread remains.
func (s *Service) ArchiveChatThread(chatID string, archived bool) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	nowHHMM := time.Now().Format("15:04")
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.ChatThreads {
			if st.ChatThreads[i].ID == chatID {
				st.ChatThreads[i].Archived = archived
				if archived {
					st.ChatThreads[i].ArchivedAt = nowHHMM
				} else {
					st.ChatThreads[i].ArchivedAt = ""
				}
				break
			}
		}
		if archived && st.ActiveChatID == chatID {
			fallbackID := ""
			for _, t := range st.ChatThreads {
				if !t.Archived {
					fallbackID = t.ID
					break
				}
			}
			if fallbackID == "" {
				thread := makeWelcomeChatThread(st.Preferences.Models.Primary, st.Preferences.UserNickname)
				st.ChatThreads = append([]types.ChatThread{thread}, st.ChatThreads...)
				fallbackID = thread.ID
			}
			st.ActiveChatID = fallbackID
		} else if !archived {
			st.ActiveChatID = chatID
		}
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
		WhenBusy:        params.BusyMode,
		Interactive:     params.Interactive,
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
				replaced := false
				if resp.ReplyMessage.ID != "" {
					for mIdx := range st.ChatThreads[i].Messages {
						if st.ChatThreads[i].Messages[mIdx].ID == resp.ReplyMessage.ID {
							st.ChatThreads[i].Messages[mIdx] = resp.ReplyMessage
							replaced = true
							break
						}
					}
				}
				if !replaced {
					st.ChatThreads[i].Messages = append(st.ChatThreads[i].Messages, resp.ReplyMessage)
				}
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

// ResolveChatPermission resolves an interactive foreground permission or ask_user prompt in Chat.
func (s *Service) ResolveChatPermission(ctx context.Context, chatID, requestID, decision, note string) (bool, error) {
	if err := s.ensureStarted(); err != nil {
		return false, err
	}
	var out struct {
		Resolved bool `json:"resolved"`
	}
	if err := s.client.Call(ctx, "chat.resolvePermission", sidecar.ResolvePermissionRequest{
		ChatID:    chatID,
		RequestID: requestID,
		Decision:  decision,
		Note:      note,
	}, &out); err != nil {
		return false, err
	}
	return out.Resolved, nil
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

	pluginDir := ""
	if s.opts.DataDir != "" {
		if dir, _, wErr := plugins.WritePluginBundle(filepath.Join(s.opts.DataDir, "plugins"), types.UpsertLocalPluginParams{
			ID:            draft.ID,
			Slug:          draft.ID,
			Name:          draft.Name,
			ManifestYAML:  draft.ManifestYAML,
			SkillMarkdown: draft.SkillMarkdown,
		}); wErr == nil {
			pluginDir = dir
		}
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
				if pluginDir != "" {
					st.Plugins[i].LocalDir = pluginDir
				}
				return
			}
		}

		evList, _ := plugins.ManifestSpecsToPoliciesAndActions(parsed, nil)
		for idx := range evList {
			if evList[idx].Description == "Manifest 声明触发规则" && draft.WhenExpression != "" {
				evList[idx].Description = draft.WhenExpression
			}
		}
		skill := strings.TrimSpace(draft.SkillMarkdown)
		if skill == "" {
			skill = strings.TrimSpace(parsed.Skill)
		}
		st.Plugins = append(st.Plugins, types.PluginState{
			ID: draft.ID, Slug: draft.ID, Name: draft.Name,
			Tagline:        fmt.Sprintf("%s · %s", draft.WhenExpression, draft.ActionExpression),
			Description:    "通过对话工作台自然语言生成并启用的本地自动化插件。",
			Version:        parsed.Version,
			BundleID:       "local.valet." + draft.ID,
			IconKind:       "code",
			IconLabel:      "{ }",
			Source:         "local",
			Enabled:        true,
			Installed:      true,
			StatusSubtitle: "本地生成插件 · 传感器与 Skill 热重载生效中",
			Triggers24h:    []int{0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
			Events:         evList,
			ConfigSchema:   parsed.ConfigSchema,
			Config:         types.PluginConfig{Values: map[string]any{}},
			ManifestYAML:   draft.ManifestYAML,
			SkillMarkdown:  skill,
			LocalDir:       pluginDir,
			BundledFiles:   []string{"manifest.yaml", "SKILL.md"},
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

// AnswerInboxQuestion records a user's chosen option/reply for a pending `user.question` Inbox card
// and forwards the answer back to Sidecar to continue the originating agent conversation.
func (s *Service) AnswerInboxQuestion(ctx context.Context, itemID string, answer string) (types.ValetSnapshot, error) {
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

	opts := extractInboxQuestionOptions(*target)
	chosen := strings.TrimSpace(answer)
	if chosen == "" {
		if len(opts) > 0 {
			chosen = opts[0]
		} else {
			chosen = "确认"
		}
	}

	question, _ := target.ToolArgs["question"].(string)
	if strings.TrimSpace(question) == "" {
		question, _ = target.Payload["question"].(string)
	}
	if strings.TrimSpace(question) == "" {
		question = target.Summary
	}
	if strings.TrimSpace(question) == "" {
		question = target.Title
	}

	sourceChatID := strings.TrimSpace(target.SourceChatID)
	if sourceChatID == "" {
		if cid, ok := target.ToolArgs["sourceChatId"].(string); ok {
			sourceChatID = strings.TrimSpace(cid)
		}
	}
	if sourceChatID == "" {
		if cid, ok := target.Payload["sourceChatId"].(string); ok {
			sourceChatID = strings.TrimSpace(cid)
		}
	}
	if sourceChatID == "" && target.PluginID != "" && target.PluginID != "valet-core" {
		sourceChatID = "event:" + target.PluginID
	}

	now := time.Now()
	nowHHMM := now.Format("15:04")
	answerStep := types.TraceStep{
		ID:     fmt.Sprintf("st-ans-%d", now.UnixNano()),
		Time:   nowHHMM,
		Stage:  "用户回复",
		Detail: "已选择：" + chosen,
		Status: "done",
	}

	nextSnap := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.InboxItems {
			if st.InboxItems[i].ID == itemID {
				st.InboxItems[i].Status = "approved"
				st.InboxItems[i].ProcessedAt = nowHHMM
				st.InboxItems[i].SelectedOption = chosen
				st.InboxItems[i].Reversible7d = false
				for j := range st.InboxItems[i].TraceSteps {
					st.InboxItems[i].TraceSteps[j].Status = "done"
				}
				st.InboxItems[i].TraceSteps = append(st.InboxItems[i].TraceSteps, answerStep)
			}
		}
		st.InboxProcessedHistoryCount++
		if target.LinkedTimelineEventID != "" {
			for i := range st.TimelineEvents {
				if st.TimelineEvents[i].ID == target.LinkedTimelineEventID {
					st.TimelineEvents[i].Status = "completed"
					st.TimelineEvents[i].CanRestore = false
					st.TimelineEvents[i].Summary = fmt.Sprintf("已在收件箱回复：「%s」", chosen)
					for j := range st.TimelineEvents[i].TraceSteps {
						st.TimelineEvents[i].TraceSteps[j].Status = "done"
					}
					st.TimelineEvents[i].TraceSteps = append(st.TimelineEvents[i].TraceSteps, answerStep)
				}
			}
		}
	})
	s.emitStateChange("inbox")

	if s.client != nil {
		s.syncSidecarBlocking(ctx, nextSnap)
		var ansResp sidecar.AnswerInboxQuestionResponse
		if err := s.client.Call(ctx, "inbox.answerQuestion", sidecar.AnswerInboxQuestionRequest{
			InboxID:      target.ID,
			Question:     question,
			Answer:       chosen,
			SourceChatID: sourceChatID,
		}, &ansResp); err == nil {
			replySummary := summarizeMarkdownReply(ansResp.ReplyMessage.Content)
			followDetail := replySummary
			if followDetail == "" {
				followDetail = "已将你的选择回传给智能体处理完成"
			}
			followTime := time.Now()
			followHHMM := followTime.Format("15:04")
			followStep := types.TraceStep{
				ID:     fmt.Sprintf("st-done-%d", followTime.UnixNano()),
				Time:   followHHMM,
				Stage:  "后续处理",
				Detail: followDetail,
				Status: "done",
			}
			followLog := types.LogLine{
				ID:      fmt.Sprintf("lg-ans-%d", followTime.UnixNano()),
				TS:      followTime.Format("15:04:05"),
				Level:   "EXEC",
				Message: fmt.Sprintf("Answered %q -> %s (%s)", chosen, ansResp.ResolvedChatID, followDetail),
			}
			s.store.Update(func(st *types.ValetSnapshot) {
				if ansResp.UsageCostDelta > 0 {
					st.Preferences.DailySpendCurrent = math.Round((st.Preferences.DailySpendCurrent+ansResp.UsageCostDelta)*100) / 100
				}
				for i := range st.InboxItems {
					if st.InboxItems[i].ID == itemID {
						st.InboxItems[i].TraceSteps = append(st.InboxItems[i].TraceSteps, followStep)
						st.InboxItems[i].Logs = append(st.InboxItems[i].Logs, followLog)
					}
				}
				if target.LinkedTimelineEventID != "" && replySummary != "" {
					for i := range st.TimelineEvents {
						if st.TimelineEvents[i].ID == target.LinkedTimelineEventID {
							st.TimelineEvents[i].Summary = fmt.Sprintf("已选择「%s」· %s", chosen, replySummary)
							st.TimelineEvents[i].TraceSteps = append(st.TimelineEvents[i].TraceSteps, followStep)
							st.TimelineEvents[i].Logs = append(st.TimelineEvents[i].Logs, followLog)
						}
					}
				}
				if ansResp.ResolvedChatID != "" {
					for i := range st.ChatThreads {
						if st.ChatThreads[i].ID == ansResp.ResolvedChatID {
							userMsg := types.ChatMessage{
								ID:        fmt.Sprintf("usr-ans-%d", followTime.UnixNano()),
								Role:      "user",
								Content:   chosen,
								CreatedAt: nowHHMM,
							}
							st.ChatThreads[i].Messages = append(st.ChatThreads[i].Messages, userMsg)
							if ansResp.ReplyMessage.ID != "" || ansResp.ReplyMessage.Content != "" {
								st.ChatThreads[i].Messages = append(st.ChatThreads[i].Messages, ansResp.ReplyMessage)
							}
							st.ChatThreads[i].UpdatedAt = "刚刚"
							break
						}
					}
				}
			})
			s.emitStateChange("inbox")
		} else {
			errTime := time.Now()
			s.store.Update(func(st *types.ValetSnapshot) {
				for i := range st.InboxItems {
					if st.InboxItems[i].ID == itemID {
						st.InboxItems[i].Logs = append(st.InboxItems[i].Logs, types.LogLine{
							ID:      fmt.Sprintf("lg-ans-err-%d", errTime.UnixNano()),
							TS:      errTime.Format("15:04:05"),
							Level:   "WARN",
							Message: fmt.Sprintf("inbox.answerQuestion failed: %v", err),
						})
					}
				}
			})
			s.emitStateChange("inbox")
		}
	}

	return s.store.Snapshot(), nil
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
	if isQuestionInboxItem(*target) {
		return s.AnswerInboxQuestion(ctx, itemID, "")
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
	approvedToolSummary := ""
	existingTimelineIDs := make(map[string]bool, len(snap.TimelineEvents))
	for _, ev := range snap.TimelineEvents {
		existingTimelineIDs[ev.ID] = true
	}

	switch {
	case target.ToolName == "disk_empty_trash":
		if s.client != nil {
			var execRes struct {
				OK     bool   `json:"ok"`
				Output string `json:"output"`
			}
			if err := s.client.Call(ctx, "tool.executeApproved", sidecar.ExecuteApprovedRequest{
				InboxID:      target.ID,
				ToolName:     target.ToolName,
				ToolArgs:     target.ToolArgs,
				CheckedPaths: checkedPaths,
			}, &execRes); err == nil && strings.TrimSpace(execRes.Output) != "" {
				approvedToolSummary = summarizeMarkdownReply(execRes.Output)
			}
		}
	case target.ToolName == "trash_files" || target.Category == "files" || strings.Contains(target.ToolName, "trash"):
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
	case target.ToolName == "kill_process" || target.ToolName == "process_terminate":
		pid := intFromAny(target.ToolArgs["pid"])
		if pid <= 1 {
			pid = intFromAny(target.Payload["pid"])
		}
		procName, _ := target.ToolArgs["name"].(string)
		if strings.TrimSpace(procName) == "" {
			procName = target.Title
		}
		sig, _ := target.ToolArgs["signal"].(string)
		if strings.TrimSpace(sig) == "" {
			sig = "SIGTERM"
		}
		if pid > 1 {
			if err := sys.TerminateProcess(pid, procName, sig, snap.Preferences.BlockedApps); err != nil {
				return snap, err
			}
			approvedToolSummary = fmt.Sprintf("已向 %s (PID %d) 发送 %s", procName, pid, sig)
		}
	case target.ToolName != "" && s.client != nil:
		var execRes struct {
			OK     bool   `json:"ok"`
			Output string `json:"output"`
		}
		if err := s.client.Call(ctx, "tool.executeApproved", sidecar.ExecuteApprovedRequest{
			InboxID:      target.ID,
			ToolName:     target.ToolName,
			ToolArgs:     target.ToolArgs,
			CheckedPaths: checkedPaths,
		}, &execRes); err == nil && strings.TrimSpace(execRes.Output) != "" {
			approvedToolSummary = summarizeMarkdownReply(execRes.Output)
		}
	}

	nowHHMM := time.Now().Format("15:04")
	linkedSummary := "已批准执行并同步完成。"
	newEvtSummary := "已通过收件箱批准并执行。"
	if approvedToolSummary != "" && batchID == "" {
		linkedSummary = "已批准执行：" + approvedToolSummary
		newEvtSummary = "已批准执行：" + approvedToolSummary
	}
	nextSnap := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.InboxItems {
			if st.InboxItems[i].ID == itemID {
				st.InboxItems[i].Status = "approved"
				st.InboxItems[i].ProcessedAt = nowHHMM
				st.InboxItems[i].TrashBatchID = batchID
				if st.InboxItems[i].LinkedTimelineEventID == "" {
					st.InboxItems[i].LinkedTimelineEventID = "evt-from-" + itemID
				}
			}
		}
		st.InboxProcessedHistoryCount++
		pctDrop := int(math.Round((reclaimed / math.Max(1, st.SystemMetrics.DiskTotalGB)) * 100))
		st.SystemMetrics.DiskPct = int(math.Max(20, float64(st.SystemMetrics.DiskPct-pctDrop)))
		st.SystemMetrics.DiskFreeGB = math.Round((st.SystemMetrics.DiskFreeGB+reclaimed)*10) / 10

		if target.LinkedTimelineEventID != "" {
			filtered := make([]types.TimelineEvent, 0, len(st.TimelineEvents))
			for _, ev := range st.TimelineEvents {
				if !existingTimelineIDs[ev.ID] && strings.HasPrefix(ev.ID, "evt-rec-") {
					continue
				}
				if ev.ID == target.LinkedTimelineEventID {
					ev.Status = "completed"
					ev.CanRestore = target.Reversible7d
					ev.TrashBatchID = batchID
					ev.ReclaimedGB = reclaimed
					ev.Summary = linkedSummary
					for j := range ev.TraceSteps {
						ev.TraceSteps[j].Status = "done"
					}
				}
				filtered = append(filtered, ev)
			}
			st.TimelineEvents = filtered
		} else {
			st.TimelineEvents = append([]types.TimelineEvent{{
				ID: "evt-from-" + itemID, Timestamp: time.Now().Format(time.RFC3339), TimeLabel: nowHHMM,
				DayGroup: "today", Title: target.Title,
				Summary: newEvtSummary, PluginID: target.PluginID, PluginName: target.PluginName,
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

func extractStringSlice(raw any) []string {
	switch v := raw.(type) {
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if t := strings.TrimSpace(item); t != "" {
				out = append(out, t)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				if t := strings.TrimSpace(s); t != "" {
					out = append(out, t)
				}
			}
		}
		return out
	default:
		return nil
	}
}

func extractInboxQuestionOptions(it types.InboxApprovalItem) []string {
	if opts := extractStringSlice(it.Options); len(opts) > 0 {
		return opts
	}
	if opts := extractStringSlice(it.ToolArgs["options"]); len(opts) > 0 {
		return opts
	}
	if opts := extractStringSlice(it.Payload["options"]); len(opts) > 0 {
		return opts
	}
	return nil
}

func isQuestionInboxItem(it types.InboxApprovalItem) bool {
	return it.EventCode == "user.question" || it.ToolName == "ask_user" || len(extractInboxQuestionOptions(it)) > 0
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
		if it.Status == "pending" && it.Reversible7d && !isQuestionInboxItem(it) {
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

func (s *Service) execHostItemResolve(ctx context.Context, raw json.RawMessage) (any, error) {
	var req struct {
		Source           string   `json:"source"`
		ID               string   `json:"id"`
		Action           string   `json:"action"`
		CheckedActionIDs []string `json:"checkedActionIds"`
		CheckedPaths     []string `json:"checkedPaths"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}

	id := strings.TrimSpace(req.ID)
	if id == "" {
		return nil, errors.New("缺少事项 id 参数")
	}
	source := strings.ToLower(strings.TrimSpace(req.Source))
	switch source {
	case "inbox", "inbox_item":
		source = "inbox"
	case "timeline", "timeline_event":
		source = "timeline"
	default:
		return nil, fmt.Errorf("不支持的事项来源 %q，应为 inbox 或 timeline", req.Source)
	}

	action := strings.ToLower(strings.TrimSpace(req.Action))
	switch action {
	case "approve", "dismiss", "execute", "ignore", "restore":
	default:
		return nil, fmt.Errorf("不支持的操作类型 %q", req.Action)
	}

	snap := s.store.Snapshot()
	var inboxItem *types.InboxApprovalItem
	for i := range snap.InboxItems {
		if snap.InboxItems[i].ID == id {
			cp := snap.InboxItems[i]
			inboxItem = &cp
			break
		}
	}
	var timelineEvt *types.TimelineEvent
	for i := range snap.TimelineEvents {
		if snap.TimelineEvents[i].ID == id {
			cp := snap.TimelineEvents[i]
			timelineEvt = &cp
			break
		}
	}

	if source == "inbox" && inboxItem == nil {
		if timelineEvt != nil {
			return nil, fmt.Errorf("未在收件箱找到事项 %q（它位于时间线，请使用 source=\"timeline\"）", id)
		}
		return nil, fmt.Errorf("未找到收件箱事项 %q", id)
	}
	if source == "timeline" && timelineEvt == nil {
		if inboxItem != nil {
			return nil, fmt.Errorf("未在时间线找到事件 %q（它位于收件箱，请使用 source=\"inbox\"）", id)
		}
		return nil, fmt.Errorf("未找到时间线事件 %q", id)
	}

	if len(req.CheckedActionIDs) > 0 || len(req.CheckedPaths) > 0 {
		idSet := make(map[string]bool, len(req.CheckedActionIDs))
		for _, aid := range req.CheckedActionIDs {
			if t := strings.TrimSpace(aid); t != "" {
				idSet[t] = true
			}
		}
		pathSet := make(map[string]bool, len(req.CheckedPaths))
		for _, p := range req.CheckedPaths {
			if t := strings.TrimSpace(p); t != "" {
				pathSet[t] = true
			}
		}
		applySelection := func(items []types.TimelineActionItem) int {
			matched := 0
			for j := range items {
				match := idSet[items[j].ID] ||
					pathSet[strings.TrimSpace(items[j].Path)] ||
					pathSet[strings.TrimSpace(items[j].Label)]
				items[j].Checked = match
				if match {
					matched++
				}
			}
			return matched
		}

		var targetItems []types.TimelineActionItem
		if source == "inbox" {
			targetItems = inboxItem.ActionItems
		} else {
			targetItems = timelineEvt.ActionItems
		}
		if len(targetItems) > 0 {
			matched := 0
			for _, it := range targetItems {
				if idSet[it.ID] || pathSet[strings.TrimSpace(it.Path)] || pathSet[strings.TrimSpace(it.Label)] {
					matched++
				}
			}
			if matched == 0 {
				return nil, errors.New("提供的 checkedActionIds 或 checkedPaths 未匹配到该事项的任何子项")
			}
			s.store.Update(func(st *types.ValetSnapshot) {
				if source == "inbox" {
					linkedEvtID := ""
					for i := range st.InboxItems {
						if st.InboxItems[i].ID == id {
							linkedEvtID = st.InboxItems[i].LinkedTimelineEventID
							applySelection(st.InboxItems[i].ActionItems)
							st.InboxItems[i].ReclaimableGB = computeCheckedGB(st.InboxItems[i].ActionItems, 0)
						}
					}
					if linkedEvtID != "" {
						for i := range st.TimelineEvents {
							if st.TimelineEvents[i].ID == linkedEvtID {
								applySelection(st.TimelineEvents[i].ActionItems)
							}
						}
					}
				} else {
					for i := range st.TimelineEvents {
						if st.TimelineEvents[i].ID == id {
							applySelection(st.TimelineEvents[i].ActionItems)
						}
					}
					for i := range st.InboxItems {
						if st.InboxItems[i].LinkedTimelineEventID == id {
							applySelection(st.InboxItems[i].ActionItems)
							st.InboxItems[i].ReclaimableGB = computeCheckedGB(st.InboxItems[i].ActionItems, 0)
						}
					}
				}
			})
		}
	}

	var summary string
	if source == "inbox" {
		switch action {
		case "approve", "execute":
			if inboxItem.Status != "pending" {
				return nil, fmt.Errorf("收件箱事项 %q 当前状态为 %q，无需重复批准", id, inboxItem.Status)
			}
			if _, err := s.ApproveInboxItem(ctx, id); err != nil {
				return nil, err
			}
			summary = fmt.Sprintf("已批准并执行收件箱事项「%s」", inboxItem.Title)
		case "dismiss", "ignore":
			if inboxItem.Status != "pending" {
				return nil, fmt.Errorf("收件箱事项 %q 当前状态为 %q，无法忽略", id, inboxItem.Status)
			}
			if _, err := s.DismissInboxItem(id); err != nil {
				return nil, err
			}
			summary = fmt.Sprintf("已忽略收件箱事项「%s」", inboxItem.Title)
		case "restore":
			if inboxItem.Status != "approved" || !inboxItem.Reversible7d || inboxItem.Restored {
				return nil, fmt.Errorf("收件箱事项 %q 当前不支持还原", id)
			}
			if _, err := s.RestoreApprovedInboxItem(id); err != nil {
				return nil, err
			}
			summary = fmt.Sprintf("已还原收件箱事项「%s」清理的内容", inboxItem.Title)
		}
	} else {
		switch action {
		case "execute", "approve":
			if timelineEvt.Status != "pending_confirm" {
				return nil, fmt.Errorf("时间线事件 %q 当前状态为 %q，无法执行待确认操作", id, timelineEvt.Status)
			}
			if _, err := s.ExecuteTimelineEvent(ctx, id); err != nil {
				return nil, err
			}
			summary = fmt.Sprintf("已执行时间线待确认事件「%s」", timelineEvt.Title)
		case "ignore", "dismiss":
			if timelineEvt.Status != "pending_confirm" {
				return nil, fmt.Errorf("时间线事件 %q 当前状态为 %q，无法忽略", id, timelineEvt.Status)
			}
			if _, err := s.IgnoreTimelineEvent(id); err != nil {
				return nil, err
			}
			summary = fmt.Sprintf("已忽略时间线事件「%s」", timelineEvt.Title)
		case "restore":
			if timelineEvt.Status != "completed" || !timelineEvt.CanRestore || timelineEvt.Restored {
				return nil, fmt.Errorf("时间线事件 %q 当前不支持还原", id)
			}
			if _, err := s.RestoreTimelineEvent(id); err != nil {
				return nil, err
			}
			summary = fmt.Sprintf("已还原时间线事件「%s」清理的内容", timelineEvt.Title)
		}
	}

	s.emitStateChange("full")
	return map[string]any{
		"ok":      true,
		"source":  source,
		"id":      id,
		"action":  action,
		"summary": summary,
	}, nil
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

// InstallMarketplacePlugin marks a discoverable plugin installed & enabled,
// materializing its bundle files into `<dataDir>/plugins/<slug>/`.
func (s *Service) InstallMarketplacePlugin(pluginID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	pid := strings.TrimSpace(pluginID)
	snap := s.store.Snapshot()
	var slug string
	for _, p := range snap.Plugins {
		if p.ID == pid || p.Slug == pid {
			slug = p.Slug
			if slug == "" {
				slug = p.ID
			}
			break
		}
	}
	if slug == "" {
		slug = plugins.NormalizeSlug(pid)
	}

	var matDir string
	var matFiles []string
	if s.opts.DataDir != "" && slug != "" {
		if dir, files, err := plugins.MaterializeCatalogPlugin(pluginsbundle.CatalogFS, slug, filepath.Join(s.opts.DataDir, "plugins")); err == nil {
			matDir = dir
			matFiles = files
		}
	}

	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID == pid || st.Plugins[i].Slug == pid {
				st.Plugins[i].Installed = true
				st.Plugins[i].Enabled = true
				st.Plugins[i].Actions = nil
				if matDir != "" {
					st.Plugins[i].LocalDir = matDir
				}
				if len(matFiles) > 0 {
					st.Plugins[i].BundledFiles = matFiles
				}
				st.Plugins[i].StatusSubtitle = "已安装并启用 · 传感器与 Skill 已激活"
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
	if parsed.ID != "" {
		cand := plugins.NormalizeSlug(parsed.ID)
		if cand != "" && cand != "local-plugin" {
			slug = cand
		}
	}
	name := strings.TrimSpace(params.Name)
	if name == "" {
		name = parsed.Name
	}
	if name == "" {
		name = "自定义本地插件"
	}
	tagline := strings.TrimSpace(params.Tagline)
	if tagline == "" {
		tagline = "~/Valet/plugins/" + slug + " · 本地开发"
	}

	next, _, uErr := s.upsertLocalPlugin(types.UpsertLocalPluginParams{
		ID:            slug,
		Slug:          slug,
		Name:          name,
		Tagline:       tagline,
		Description:   "通过本地 Manifest 与 Skill 创建的自定义事件处理插件。",
		ManifestYAML:  params.YAML,
		SkillMarkdown: params.SkillMarkdown,
	})
	if uErr != nil {
		return s.store.Snapshot(), uErr
	}
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
			evList, _ := plugins.ManifestSpecsToPoliciesAndActions(parsed, st.Plugins[i].Events)
			if strings.TrimSpace(parsed.Version) != "" {
				st.Plugins[i].Version = parsed.Version
			}
			st.Plugins[i].Events = evList
			st.Plugins[i].Actions = nil
			st.Plugins[i].ConfigSchema = parsed.ConfigSchema
			st.Plugins[i].ManifestYAML = manifestYAML
			if strings.TrimSpace(parsed.Skill) != "" {
				st.Plugins[i].SkillMarkdown = strings.TrimSpace(parsed.Skill)
			}
			st.Plugins[i].StatusSubtitle = "刚刚热重载 · Manifest 已生效"
			if (st.Plugins[i].Source == "local" || st.Plugins[i].LocalDir != "") && s.opts.DataDir != "" {
				if dir, _, wErr := plugins.WritePluginBundle(filepath.Join(s.opts.DataDir, "plugins"), types.UpsertLocalPluginParams{
					ID:            st.Plugins[i].ID,
					Slug:          st.Plugins[i].Slug,
					Name:          st.Plugins[i].Name,
					ManifestYAML:  manifestYAML,
					SkillMarkdown: st.Plugins[i].SkillMarkdown,
				}); wErr == nil {
					st.Plugins[i].LocalDir = dir
				}
			}
		}
	})
	s.syncRuntime(next)
	return next, nil
}

// UpdatePluginSkill updates a plugin's SKILL.md instruction body and hot-reloads Pi Durable.
func (s *Service) UpdatePluginSkill(pluginID, skillMarkdown string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	trimmed := strings.TrimSpace(skillMarkdown)
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID == pluginID {
				st.Plugins[i].SkillMarkdown = trimmed
				st.Plugins[i].StatusSubtitle = "刚刚更新 Skill · 处理逻辑已热重载"
				if (st.Plugins[i].Source == "local" || st.Plugins[i].LocalDir != "") && s.opts.DataDir != "" && st.Plugins[i].ManifestYAML != "" {
					if dir, _, wErr := plugins.WritePluginBundle(filepath.Join(s.opts.DataDir, "plugins"), types.UpsertLocalPluginParams{
						ID:            st.Plugins[i].ID,
						Slug:          st.Plugins[i].Slug,
						Name:          st.Plugins[i].Name,
						ManifestYAML:  st.Plugins[i].ManifestYAML,
						SkillMarkdown: trimmed,
					}); wErr == nil {
						st.Plugins[i].LocalDir = dir
					}
				}
			}
		}
	})
	s.syncRuntime(next)
	return next, nil
}

// ReloadPlugin reloads one local plugin from disk (or all local plugins when pluginID is empty) and hot-reloads the runtime.
func (s *Service) ReloadPlugin(pluginID string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	pid := strings.TrimSpace(pluginID)
	pluginsBase := filepath.Join(s.opts.DataDir, "plugins")

	if pid == "" {
		discovered, err := plugins.DiscoverLocalPlugins(pluginsBase)
		if err != nil {
			return s.store.Snapshot(), err
		}
		next := s.store.Update(func(st *types.ValetSnapshot) {
			for _, bundle := range discovered {
				mergeLocalPluginIntoSlice(&st.Plugins, bundle)
			}
		})
		s.syncRuntime(next)
		s.emitStateChange("plugins")
		return next, nil
	}

	snap := s.store.Snapshot()
	var existing *types.PluginState
	for i := range snap.Plugins {
		if snap.Plugins[i].ID == pid || snap.Plugins[i].Slug == pid {
			cp := snap.Plugins[i]
			existing = &cp
			break
		}
	}
	dir := ""
	if existing != nil && existing.LocalDir != "" {
		dir = existing.LocalDir
	} else {
		cand := filepath.Join(pluginsBase, plugins.NormalizeSlug(pid))
		if _, err := os.Stat(cand); err == nil {
			dir = cand
		}
	}

	if dir != "" {
		manifestYAML, skillMD, parsed, _, err := plugins.ReadPluginBundle(dir)
		if err != nil {
			return snap, err
		}
		next := s.store.Update(func(st *types.ValetSnapshot) {
			var cur *types.PluginState
			for i := range st.Plugins {
				if st.Plugins[i].ID == pid || st.Plugins[i].Slug == pid {
					cur = &st.Plugins[i]
					break
				}
			}
			slug := plugins.NormalizeSlug(filepath.Base(dir))
			updated := plugins.BuildPluginStateFromParsed(pid, slug, parsed.Name, "", "", manifestYAML, skillMD, dir, parsed, cur)
			updated.StatusSubtitle = "刚刚从磁盘热重载 · 已生效"
			if cur != nil {
				*cur = updated
			} else {
				st.Plugins = append(st.Plugins, updated)
			}
		})
		s.syncRuntime(next)
		s.emitStateChange("plugins")
		return next, nil
	}

	if existing == nil {
		return snap, fmt.Errorf("未找到插件: %q", pid)
	}
	parsed, err := plugins.ParseManifestYAML(existing.ManifestYAML)
	if err != nil {
		return snap, err
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID == existing.ID {
				evList, _ := plugins.ManifestSpecsToPoliciesAndActions(parsed, st.Plugins[i].Events)
				st.Plugins[i].Events = evList
				st.Plugins[i].Actions = nil
				st.Plugins[i].ConfigSchema = parsed.ConfigSchema
				st.Plugins[i].StatusSubtitle = "刚刚热重载 · 已生效"
			}
		}
	})
	s.syncRuntime(next)
	s.emitStateChange("plugins")
	return next, nil
}

// UninstallPlugin uninstalls any installed plugin (removing local plugins completely, or
// resetting catalog plugins back to Installed=false) and deletes its materialized disk bundle.
func (s *Service) UninstallPlugin(pluginID string) (types.ValetSnapshot, error) {
	return s.RemoveLocalPluginWithFiles(pluginID, true)
}

// RemoveLocalPlugin uninstalls a plugin and removes its directory under <dataDir>/plugins.
func (s *Service) RemoveLocalPlugin(pluginID string) (types.ValetSnapshot, error) {
	return s.RemoveLocalPluginWithFiles(pluginID, true)
}

// RemoveLocalPluginWithFiles uninstalls a plugin (local plugins are removed from the list;
// catalog plugins return to Discover with Installed=false, Enabled=false) and optionally removes its disk files.
func (s *Service) RemoveLocalPluginWithFiles(pluginID string, deleteFiles bool) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	pid := strings.TrimSpace(pluginID)
	var removedDir string
	var resolvedID string
	var resolvedSlug string
	var found bool
	var isLocal bool

	snap := s.store.Snapshot()
	for _, p := range snap.Plugins {
		if p.ID == pid || p.Slug == pid {
			found = true
			isLocal = p.Source == "local"
			removedDir = p.LocalDir
			resolvedID = p.ID
			resolvedSlug = p.Slug
			if resolvedSlug == "" {
				resolvedSlug = p.ID
			}
			break
		}
	}
	if !found {
		return snap, fmt.Errorf("未找到插件: %q", pid)
	}

	next := s.store.Update(func(st *types.ValetSnapshot) {
		if isLocal {
			filtered := make([]types.PluginState, 0, len(st.Plugins))
			for _, p := range st.Plugins {
				if p.ID == pid || p.Slug == pid || p.ID == resolvedID {
					continue
				}
				filtered = append(filtered, p)
			}
			st.Plugins = filtered
		} else {
			for i := range st.Plugins {
				if st.Plugins[i].ID == resolvedID {
					st.Plugins[i].Installed = false
					st.Plugins[i].Enabled = false
					st.Plugins[i].LocalDir = ""
					st.Plugins[i].StatusSubtitle = "可安装 · 扩展目录"
				}
			}
		}
		if st.ActivePluginDetailID != nil && (*st.ActivePluginDetailID == pid || *st.ActivePluginDetailID == resolvedID) {
			st.ActivePluginDetailID = nil
		}
	})

	if deleteFiles && s.opts.DataDir != "" {
		basePlugins, _ := filepath.Abs(filepath.Join(s.opts.DataDir, "plugins"))
		targetDir := removedDir
		if targetDir == "" {
			targetDir = filepath.Join(basePlugins, plugins.NormalizeSlug(resolvedSlug))
		}
		if absTarget, err := filepath.Abs(targetDir); err == nil {
			if rel, rErr := filepath.Rel(basePlugins, absTarget); rErr == nil && rel != "." && !strings.HasPrefix(rel, "..") {
				_ = os.RemoveAll(absTarget)
			}
		}
		baseState, _ := filepath.Abs(filepath.Join(s.opts.DataDir, "plugin-state"))
		if absState, err := filepath.Abs(filepath.Join(baseState, resolvedID)); err == nil {
			if rel, rErr := filepath.Rel(baseState, absState); rErr == nil && rel != "." && !strings.HasPrefix(rel, "..") {
				_ = os.RemoveAll(absState)
			}
		}
	}

	s.syncRuntime(next)
	s.emitStateChange("plugins")
	return next, nil
}

// UpsertLocalPlugin writes a local plugin bundle to disk, registers/updates it in Store, and hot-reloads Engine & Sidecar.
func (s *Service) UpsertLocalPlugin(params types.UpsertLocalPluginParams) (types.ValetSnapshot, error) {
	next, _, err := s.upsertLocalPlugin(params)
	return next, err
}

func (s *Service) upsertLocalPlugin(params types.UpsertLocalPluginParams) (types.ValetSnapshot, types.PluginState, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, types.PluginState{}, err
	}
	pluginsBase := filepath.Join(s.opts.DataDir, "plugins")
	pluginDir, parsed, err := plugins.WritePluginBundle(pluginsBase, params)
	if err != nil {
		return s.store.Snapshot(), types.PluginState{}, err
	}
	slug := plugins.NormalizeSlug(filepath.Base(pluginDir))
	id := strings.TrimSpace(params.ID)
	if id == "" {
		id = slug
	}

	var result types.PluginState
	next := s.store.Update(func(st *types.ValetSnapshot) {
		var existing *types.PluginState
		for i := range st.Plugins {
			if st.Plugins[i].ID == id || st.Plugins[i].Slug == slug {
				existing = &st.Plugins[i]
				break
			}
		}
		if existing != nil && existing.Source != "local" {
			// Avoid overwriting core plugins by ID collision
			id = "local-" + slug
			existing = nil
		}
		built := plugins.BuildPluginStateFromParsed(
			id,
			slug,
			params.Name,
			params.Tagline,
			params.Description,
			strings.TrimSpace(params.ManifestYAML),
			strings.TrimSpace(params.SkillMarkdown),
			pluginDir,
			parsed,
			existing,
		)
		built.Installed = true
		if params.Enabled != nil {
			built.Enabled = *params.Enabled
		} else if existing == nil {
			built.Enabled = true
		}
		built.StatusSubtitle = "本地插件 · 传感器与工具热重载生效中"

		if existing != nil {
			*existing = built
		} else {
			st.Plugins = append(st.Plugins, built)
		}
		result = built
	})

	s.syncRuntime(next)
	s.emitStateChange("plugins")
	return next, result, nil
}

func (s *Service) installPluginFromDir(dir, slugOverride, nameOverride, taglineOverride, skillOverride string) (types.ValetSnapshot, types.PluginState, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, types.PluginState{}, err
	}
	manifestYAML, skillMD, parsed, files, err := plugins.ReadPluginBundle(dir)
	if err != nil {
		return s.store.Snapshot(), types.PluginState{}, err
	}
	if strings.TrimSpace(skillOverride) != "" {
		skillMD = strings.TrimSpace(skillOverride)
	}
	resolvedDir := dir
	if info, statErr := os.Stat(dir); statErr == nil && !info.IsDir() {
		resolvedDir = filepath.Dir(dir)
	}

	slug := strings.TrimSpace(slugOverride)
	if slug == "" {
		slug = strings.TrimSpace(parsed.ID)
	}
	if slug == "" {
		slug = filepath.Base(resolvedDir)
	}
	slug = plugins.NormalizeSlug(slug)

	extraFiles := make(map[string]string)
	for _, rel := range files {
		low := strings.ToLower(rel)
		if low == "manifest.yaml" || low == "manifest.yml" || low == "plugin.yaml" || low == "plugin.yml" || low == "skill.md" {
			continue
		}
		if data, rErr := os.ReadFile(filepath.Join(resolvedDir, filepath.FromSlash(rel))); rErr == nil && len(data) <= 512*1024 {
			extraFiles[rel] = string(data)
		}
	}

	return s.upsertLocalPlugin(types.UpsertLocalPluginParams{
		ID:            slug,
		Slug:          slug,
		Name:          strings.TrimSpace(nameOverride),
		Tagline:       strings.TrimSpace(taglineOverride),
		ManifestYAML:  manifestYAML,
		SkillMarkdown: skillMD,
		Files:         extraFiles,
	})
}

func (s *Service) inspectPluginDetail(idOrSlug string) (types.PluginState, []string, error) {
	snap := s.store.Snapshot()
	q := strings.TrimSpace(idOrSlug)
	for _, p := range snap.Plugins {
		if p.ID == q || p.Slug == q {
			var files []string
			if p.LocalDir != "" {
				if _, _, _, f, err := plugins.ReadPluginBundle(p.LocalDir); err == nil {
					files = f
				}
			}
			return p, files, nil
		}
	}
	return types.PluginState{}, nil, fmt.Errorf("未找到插件: %q", q)
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
	if cfg.Values == nil {
		cfg.Values = map[string]any{}
	}
	if cfg.LowSpaceThresholdPct != nil {
		if _, ok := cfg.Values["lowSpaceThresholdPct"]; !ok {
			cfg.Values["lowSpaceThresholdPct"] = *cfg.LowSpaceThresholdPct
		}
	} else if raw, ok := cfg.Values["lowSpaceThresholdPct"]; ok {
		if n := intFromAny(raw); n > 0 {
			cfg.LowSpaceThresholdPct = &n
		}
	}
	if cfg.SampleIntervalSec != nil {
		if _, ok := cfg.Values["sampleIntervalSec"]; !ok {
			cfg.Values["sampleIntervalSec"] = *cfg.SampleIntervalSec
		}
	} else if raw, ok := cfg.Values["sampleIntervalSec"]; ok {
		if n := intFromAny(raw); n > 0 {
			cfg.SampleIntervalSec = &n
		}
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

// TriggerPluginEvent injects a simulated event with an optional JSON payload string into Pi Durable.
func (s *Service) TriggerPluginEvent(ctx context.Context, pluginID, eventCode, payloadJSON string) (types.SimulateEventResult, error) {
	payload := map[string]any{"simulated": true}
	trimmed := strings.TrimSpace(payloadJSON)
	if trimmed != "" {
		var custom map[string]any
		if err := json.Unmarshal([]byte(trimmed), &custom); err != nil {
			return types.SimulateEventResult{}, fmt.Errorf("事件 Payload JSON 格式无效：%w", err)
		}
		for k, v := range custom {
			payload[k] = v
		}
		payload["simulated"] = true
	}
	return s.dispatchPluginEventInternal(ctx, pluginID, eventCode, payload, true)
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

	importedLogs := extractImportedLogLines(reqPayload)

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
		if len(importedLogs) > 0 {
			createdEvt.Logs = append(createdEvt.Logs, importedLogs...)
			if createdInbox != nil {
				createdInbox.Logs = append(createdInbox.Logs, importedLogs...)
			}
			s.mu.Lock()
			s.createdEvent[createdEvt.ID] = *createdEvt
			if createdInbox != nil {
				s.createdInbox[createdInbox.ID] = *createdInbox
			}
			s.mu.Unlock()
			s.store.Update(func(st *types.ValetSnapshot) {
				for i := range st.TimelineEvents {
					if st.TimelineEvents[i].ID == createdEvt.ID {
						st.TimelineEvents[i].Logs = append(st.TimelineEvents[i].Logs, importedLogs...)
					}
				}
				if createdInbox != nil {
					for i := range st.InboxItems {
						if st.InboxItems[i].ID == createdInbox.ID {
							st.InboxItems[i].Logs = append(st.InboxItems[i].Logs, importedLogs...)
						}
					}
				}
			})
			s.emitStateChange("timeline")
		}
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
	if reqPayload["source"] == "manual_import" {
		sourceLabel = "来自手动日志导入"
		titlePrefix = ""
	}

	title := fmt.Sprintf("%s%s 捕获 %s", titlePrefix, plugin.Name, eventCode)
	if customTitle, ok := reqPayload["title"].(string); ok && strings.TrimSpace(customTitle) != "" {
		title = strings.TrimSpace(customTitle)
	}
	reasoning := fmt.Sprintf("插件「%s」捕获事件 %s，当前按策略「%s」路由记录。", plugin.Name, eventCode, policy)
	if reply := strings.TrimSpace(resp.ReplyText); reply != "" {
		reasoning = reply
		if short := summarizeMarkdownReply(reply); short != "" {
			summary = short
		}
	}
	traceSteps := []types.TraceStep{
		{ID: "s1", Time: nowHHMM, Stage: "事件触发", Detail: eventCode + " 已进入事件总线", Status: "done"},
	}
	logs := []types.LogLine{{ID: "sl1", TS: now.Format("15:04:05"), Level: "INFO", Message: "Dispatched " + eventCode}}
	if len(importedLogs) > 0 {
		logs = importedLogs
		traceSteps = append(traceSteps, types.TraceStep{
			ID:     "s2",
			Time:   nowHHMM,
			Stage:  "日志采集与归因",
			Detail: fmt.Sprintf("附带 %d 条结构化日志供 Skill 归因", len(importedLogs)),
			Status: "done",
		})
	}

	evtID := fmt.Sprintf("evt-plug-%d", now.UnixNano())
	evt := types.TimelineEvent{
		ID: evtID, Timestamp: now.Format(time.RFC3339), TimeLabel: nowHHMM,
		DayGroup: "today", Title: title,
		Summary: summary, PluginID: plugin.ID, PluginName: plugin.Name, PluginBadge: badge,
		EventCode: eventCode, Status: evtStatus, TriggerLatencyLabel: nowHHMM + " · " + sourceLabel,
		Payload:     reqPayload,
		Reasoning:   reasoning,
		ActionItems: []types.TimelineActionItem{},
		TraceSteps:  traceSteps,
		Logs:        logs,
	}

	var inb *types.InboxApprovalItem
	if policy == "ask" {
		cat := "files"
		iconKind := plugin.IconKind
		if iconKind == "" {
			iconKind = "disk"
		}
		if iconKind == "pulse" || iconKind == "log" || iconKind == "battery" || iconKind == "wifi" || iconKind == "surge" {
			cat = "process"
		}
		item := types.InboxApprovalItem{
			ID: fmt.Sprintf("inbox-plug-%d", now.UnixNano()), Timestamp: evt.Timestamp,
			TimeLabel: nowHHMM, AgeLabel: "刚刚", Category: cat, IconKind: iconKind,
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

// TestAutoReview validates Auto Review decision model connectivity (Jev System One or small model fallback).
func (s *Service) TestAutoReview(ctx context.Context, cfg types.AutoReviewConfig) (types.TestMessageResult, error) {
	if err := s.ensureStarted(); err != nil {
		return types.TestMessageResult{}, err
	}
	cfg.JevAPIKey = strings.TrimSpace(cfg.JevAPIKey)
	cfg.JevEndpoint = strings.TrimSpace(cfg.JevEndpoint)
	cfg.JevModel = strings.TrimSpace(cfg.JevModel)
	cfg.FallbackProviderID = strings.TrimSpace(cfg.FallbackProviderID)
	cfg.FallbackModel = strings.TrimSpace(cfg.FallbackModel)
	var out types.TestMessageResult
	err := s.client.Call(ctx, "agent.testAutoReview", sidecar.TestAutoReviewRequest{
		AutoReview: cfg,
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
	normalized := strings.TrimSpace(level)
	switch normalized {
	case "sensitive_only", "":
		normalized = "auto_review"
	case "autonomous":
		normalized = "full_access"
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		st.Preferences.AutonomyLevel = normalized
		switch normalized {
		case "always_ask":
			st.Preferences.ConfirmChecklist = types.SafetyConfirmationChecklist{
				DeleteOrOverwrite: true, SendMessageOrEmail: true, PaymentOrSubscription: true,
				RunTerminalCommand: true, ModifySystemSettings: true,
			}
		case "auto_review":
			st.Preferences.ConfirmChecklist = types.SafetyConfirmationChecklist{
				DeleteOrOverwrite: false, SendMessageOrEmail: true, PaymentOrSubscription: true,
				RunTerminalCommand: false, ModifySystemSettings: false,
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
	trimmedJevKey := strings.TrimSpace(prefs.AutoReview.JevAPIKey)
	if s.opts.DesktopReady {
		if trimmedJevKey != "" {
			_ = mygo.Secrets.Set("autoreview.jev.apikey", []byte(trimmedJevKey))
		} else {
			_ = mygo.Secrets.Delete("autoreview.jev.apikey")
		}
	}
	prefs.AutoReview.JevAPIKey = trimmedJevKey
	prefs.AutoReview.JevAPIKeyMasked = maskSecretKey(trimmedJevKey)
	switch strings.TrimSpace(prefs.AutonomyLevel) {
	case "sensitive_only", "":
		prefs.AutonomyLevel = "auto_review"
	case "autonomous":
		prefs.AutonomyLevel = "full_access"
	}

	next := s.store.Update(func(st *types.ValetSnapshot) {
		prevWebhook := st.Preferences.PluginRuntime.WebhookEndpoint
		prevLastHeartbeat := st.Preferences.Heartbeat.LastRunAt
		st.Preferences = prefs
		if st.Preferences.PluginRuntime.WebhookEndpoint == "" {
			st.Preferences.PluginRuntime.WebhookEndpoint = prevWebhook
		}
		if st.Preferences.Heartbeat.LastRunAt == "" {
			st.Preferences.Heartbeat.LastRunAt = prevLastHeartbeat
		}
		if st.Preferences.Heartbeat.IntervalMin <= 0 {
			st.Preferences.Heartbeat.IntervalMin = 30
		}
		if st.Preferences.Heartbeat.Prompt == "" {
			st.Preferences.Heartbeat.Prompt = store.DefaultHeartbeatConfig().Prompt
		}
		st.Preferences.Heartbeat.Initialized = true
		if st.Preferences.BusyMessagePolicy != "steer" && st.Preferences.BusyMessagePolicy != "queue" {
			st.Preferences.BusyMessagePolicy = "queue"
		}
		st.Preferences.DarkTheme = types.NormalizeDarkTheme(st.Preferences.DarkTheme)
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

// AddMemory persists a user-authored long-term memory entry and syncs Sidecar.
func (s *Service) AddMemory(content, source string) (types.ValetSnapshot, error) {
	if err := s.ensureStarted(); err != nil {
		return types.ValetSnapshot{}, err
	}
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return s.store.Snapshot(), errors.New("记忆内容不能为空")
	}
	src := strings.TrimSpace(source)
	if src == "" {
		src = "手动添加"
	}
	next := s.store.Update(func(st *types.ValetSnapshot) {
		entry := types.MemoryEntry{
			ID:        fmt.Sprintf("mem-%d", time.Now().UnixNano()),
			Content:   trimmed,
			Source:    src,
			CreatedAt: time.Now().Format("2006-01-02"),
		}
		st.Memories = append([]types.MemoryEntry{entry}, st.Memories...)
	})
	s.syncRuntime(next)
	return next, nil
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

func mergeLocalPluginIntoSlice(list *[]types.PluginState, bundle types.PluginState) {
	for i := range *list {
		if (*list)[i].ID == bundle.ID || (*list)[i].Slug == bundle.Slug {
			if (*list)[i].Source != "local" {
				return
			}
			parsed, err := plugins.ParseManifestYAML(bundle.ManifestYAML)
			if err != nil {
				return
			}
			updated := plugins.BuildPluginStateFromParsed(
				(*list)[i].ID,
				(*list)[i].Slug,
				bundle.Name,
				(*list)[i].Tagline,
				(*list)[i].Description,
				bundle.ManifestYAML,
				bundle.SkillMarkdown,
				bundle.LocalDir,
				parsed,
				&(*list)[i],
			)
			(*list)[i] = updated
			return
		}
	}
	*list = append(*list, bundle)
}

func (s *Service) listAllSkills() []types.BuiltinSkillMeta {
	builtin := skillsbundle.All()
	out := make([]types.BuiltinSkillMeta, 0, len(builtin))
	seen := make(map[string]bool, len(builtin))
	for _, sk := range builtin {
		seen[strings.ToLower(sk.Name)] = true
		out = append(out, types.BuiltinSkillMeta{
			Name:        sk.Name,
			Title:       sk.Title,
			Description: sk.Description,
			Content:     sk.Content,
			Source:      "builtin",
		})
	}
	if s.opts.DataDir != "" {
		skillsDir := filepath.Join(s.opts.DataDir, "skills")
		if entries, err := os.ReadDir(skillsDir); err == nil {
			for _, entry := range entries {
				if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
					continue
				}
				sp := filepath.Join(skillsDir, entry.Name(), "SKILL.md")
				raw, rErr := os.ReadFile(sp)
				if rErr != nil {
					continue
				}
				name := entry.Name()
				if seen[strings.ToLower(name)] {
					continue
				}
				out = append(out, types.BuiltinSkillMeta{
					Name:        name,
					Title:       name,
					Description: "用户自定义本地 Skill",
					Content:     strings.TrimSpace(string(raw)),
					Source:      "user",
				})
			}
		}
	}
	return out
}

func (s *Service) buildKernelBashEnv() []string {
	skipKeys := map[string]bool{
		"PATH":               true,
		"VALET_HOME_DIR":     true,
		"VALET_DATA_DIR":     true,
		"VALET_CONTROL_FILE": true,
	}
	env := make([]string, 0, len(os.Environ())+6)
	for _, entry := range os.Environ() {
		k, _, ok := strings.Cut(entry, "=")
		if ok && skipKeys[k] {
			continue
		}
		env = append(env, entry)
	}
	if s.opts.HomeDir != "" {
		env = append(env, "VALET_HOME_DIR="+s.opts.HomeDir)
	}
	if s.opts.DataDir != "" {
		env = append(env, "VALET_DATA_DIR="+s.opts.DataDir)
	}
	s.mu.Lock()
	ctrlFile := s.controlFilePath
	s.mu.Unlock()
	if ctrlFile != "" {
		env = append(env, "VALET_CONTROL_FILE="+ctrlFile)
	}

	var extraPath []string
	if s.opts.DataDir != "" {
		extraPath = append(extraPath, filepath.Join(s.opts.DataDir, "bin"))
	}
	if cliBin := s.resolveCLIBinary(); cliBin != "" {
		extraPath = append(extraPath, filepath.Dir(cliBin))
	}
	if bunBin := resolveBunBinaryWithOpts(s.opts); bunBin != "" && strings.ContainsRune(bunBin, filepath.Separator) {
		extraPath = append(extraPath, filepath.Dir(bunBin))
	}
	if s.opts.HomeDir != "" {
		extraPath = append(extraPath, filepath.Join(s.opts.HomeDir, ".bun", "bin"))
	}
	extraPath = append(extraPath, "/opt/homebrew/bin")

	seen := make(map[string]bool, len(extraPath))
	deduped := make([]string, 0, len(extraPath))
	for _, p := range extraPath {
		if p != "" && !seen[p] {
			seen[p] = true
			deduped = append(deduped, p)
		}
	}
	curPath := os.Getenv("PATH")
	newPath := strings.Join(deduped, string(os.PathListSeparator))
	if curPath != "" {
		newPath += string(os.PathListSeparator) + curPath
	}
	env = append(env, "PATH="+newPath)
	return env
}

func resolveBunBinaryWithOpts(opts StartOptions) string {
	platDir := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	var candidates []string
	if opts.ResourcesDir != "" {
		candidates = append(candidates,
			filepath.Join(opts.ResourcesDir, "bin", "valet-bun"),
			filepath.Join(opts.ResourcesDir, platDir, "bin", "valet-bun"),
		)
	}
	repoRoot := findBackendRepoRoot(opts.RepoRoot)
	if repoRoot != "" {
		candidates = append(candidates,
			filepath.Join(repoRoot, "resources", platDir, "bin", "valet-bun"),
			filepath.Join(repoRoot, "resources", "bin", "valet-bun"),
		)
	}
	for _, cand := range candidates {
		if info, err := os.Stat(cand); err == nil && !info.IsDir() {
			return cand
		}
	}
	if p, err := exec.LookPath("bun"); err == nil {
		return p
	}
	home := strings.TrimSpace(opts.HomeDir)
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	for _, c := range []string{
		filepath.Join(home, ".bun", "bin", "bun"),
		"/opt/homebrew/bin/bun",
		"/usr/local/bin/bun",
	} {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return c
		}
	}
	return "bun"
}

func (s *Service) resolveCLIBinary() string {
	s.cliOnce.Do(func() {
		platDir := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
		var candidates []string
		if s.opts.ResourcesDir != "" {
			candidates = append(candidates,
				filepath.Join(s.opts.ResourcesDir, "bin", "valet"),
				filepath.Join(s.opts.ResourcesDir, platDir, "bin", "valet"),
			)
		}
		repoRoot := findBackendRepoRoot(s.opts.RepoRoot)
		if repoRoot != "" {
			candidates = append(candidates,
				filepath.Join(repoRoot, "resources", platDir, "bin", "valet"),
				filepath.Join(repoRoot, "resources", "bin", "valet"),
			)
		}
		if s.opts.DataDir != "" {
			candidates = append(candidates, filepath.Join(s.opts.DataDir, "bin", "valet"))
		}
		for _, cand := range candidates {
			if info, err := os.Stat(cand); err == nil && !info.IsDir() {
				s.cliBinPath = cand
				return
			}
		}
		// Fallback in dev/test environments: build ./cmd/valet once into <DataDir>/bin/valet.
		if repoRoot != "" && s.opts.DataDir != "" {
			if _, err := os.Stat(filepath.Join(repoRoot, "cmd", "valet", "main.go")); err == nil {
				outBin := filepath.Join(s.opts.DataDir, "bin", "valet")
				if os.MkdirAll(filepath.Dir(outBin), 0o755) == nil {
					ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
					defer cancel()
					buildCmd := exec.CommandContext(ctx, "go", "build", "-o", outBin, "./cmd/valet")
					buildCmd.Dir = repoRoot
					buildCmd.Env = append(os.Environ(), "CGO_ENABLED=0")
					if buildCmd.Run() == nil {
						s.cliBinPath = outBin
					}
				}
			}
		}
	})
	return s.cliBinPath
}

func findBackendRepoRoot(explicit string) string {
	var cands []string
	if explicit != "" {
		cands = append(cands, explicit)
	}
	if wd, err := os.Getwd(); err == nil {
		cur := wd
		for i := 0; i < 6; i++ {
			cands = append(cands, cur)
			parent := filepath.Dir(cur)
			if parent == cur {
				break
			}
			cur = parent
		}
	}
	for _, dir := range cands {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
	}
	return explicit
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

func extractImportedLogLines(payload map[string]any) []types.LogLine {
	if len(payload) == 0 {
		return nil
	}
	raw, ok := payload["recentEntries"]
	if !ok || raw == nil {
		return nil
	}
	toLogLine := func(idx int, ts, level, component, message string) (types.LogLine, bool) {
		msg := strings.TrimSpace(message)
		if msg == "" {
			return types.LogLine{}, false
		}
		if comp := strings.TrimSpace(component); comp != "" {
			msg = fmt.Sprintf("[%s] %s", comp, msg)
		}
		lvl := "WARN"
		if strings.EqualFold(strings.TrimSpace(level), "ERROR") || strings.EqualFold(strings.TrimSpace(level), "ERR") {
			lvl = "ERR"
		}
		if len(ts) >= 19 {
			ts = ts[11:19]
		}
		return types.LogLine{
			ID:      fmt.Sprintf("imp-%d", idx+1),
			TS:      ts,
			Level:   lvl,
			Message: msg,
		}, true
	}

	if entries, ok := raw.([]any); ok {
		out := make([]types.LogLine, 0, len(entries))
		for i, item := range entries {
			if i >= 30 {
				break
			}
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			ts, _ := m["timestamp"].(string)
			lvl, _ := m["level"].(string)
			comp, _ := m["component"].(string)
			msg, _ := m["message"].(string)
			if line, ok := toLogLine(i, ts, lvl, comp, msg); ok {
				out = append(out, line)
			}
		}
		return out
	}
	return nil
}

func summarizeMarkdownReply(raw string) string {
	for _, line := range strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		trimmed = strings.TrimLeft(trimmed, "#*- ")
		trimmed = strings.ReplaceAll(trimmed, "**", "")
		trimmed = strings.TrimSpace(trimmed)
		if trimmed == "" {
			continue
		}
		runes := []rune(trimmed)
		if len(runes) > 160 {
			return string(runes[:159]) + "…"
		}
		return string(runes)
	}
	return ""
}
