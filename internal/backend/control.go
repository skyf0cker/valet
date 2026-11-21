package backend

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"valet/internal/configctl"
	"valet/internal/types"
)

func (s *Service) registerControlAPI(mux *http.ServeMux, baseURL, webhookEndpoint string) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		tokenBytes = []byte(fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano()))
	}
	token := hex.EncodeToString(tokenBytes)

	s.mu.Lock()
	dataDir := s.opts.DataDir
	s.controlToken = token
	if dataDir != "" {
		ctrlPath := filepath.Join(dataDir, configctl.ControlFileName)
		info := configctl.ControlInfo{
			PID:             os.Getpid(),
			BaseURL:         baseURL,
			WebhookEndpoint: webhookEndpoint,
			Token:           token,
			DataDir:         dataDir,
			StartedAt:       time.Now().Format(time.RFC3339),
		}
		if raw, err := json.MarshalIndent(info, "", "  "); err == nil {
			if err := os.MkdirAll(dataDir, 0o755); err == nil {
				tmp := ctrlPath + ".tmp"
				if os.WriteFile(tmp, raw, 0o600) == nil && os.Rename(tmp, ctrlPath) == nil {
					s.controlFilePath = ctrlPath
				}
			}
		}
	}
	s.mu.Unlock()

	auth := func(method string, fn http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			// Deliberately NO Access-Control-Allow-* headers on /api/v1/* to prevent browser-origin access.
			if r.Method != method {
				writeControlJSON(w, http.StatusMethodNotAllowed, map[string]any{
					"ok":    false,
					"error": fmt.Sprintf("仅支持 %s 方法", method),
				})
				return
			}
			if !s.authorizeControlRequest(r) {
				writeControlJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "未授权：缺少或无效的 Bearer Token",
				})
				return
			}
			fn(w, r)
		}
	}

	mux.HandleFunc("/api/v1/status", auth(http.MethodGet, s.handleCtrlStatus))
	mux.HandleFunc("/api/v1/snapshot", auth(http.MethodGet, s.handleCtrlSnapshot))
	mux.HandleFunc("/api/v1/daemon/pause", auth(http.MethodPost, s.handleCtrlPause(true)))
	mux.HandleFunc("/api/v1/daemon/resume", auth(http.MethodPost, s.handleCtrlPause(false)))

	mux.HandleFunc("/api/v1/config", s.handleCtrlConfigDispatch)
	mux.HandleFunc("/api/v1/config/schema", auth(http.MethodGet, s.handleCtrlConfigSchema))
	mux.HandleFunc("/api/v1/config/reset-thresholds", auth(http.MethodPost, s.handleCtrlResetThresholds))

	mux.HandleFunc("/api/v1/providers", auth(http.MethodGet, s.handleCtrlProviders))
	mux.HandleFunc("/api/v1/providers/select", auth(http.MethodPost, s.handleCtrlProviderSelect))
	mux.HandleFunc("/api/v1/providers/update", auth(http.MethodPost, s.handleCtrlProviderUpdate))
	mux.HandleFunc("/api/v1/providers/verify", auth(http.MethodPost, s.handleCtrlProviderVerify))
	mux.HandleFunc("/api/v1/models", auth(http.MethodPost, s.handleCtrlModelsUpdate))

	mux.HandleFunc("/api/v1/heartbeat", auth(http.MethodGet, s.handleCtrlHeartbeat))
	mux.HandleFunc("/api/v1/heartbeat/set", auth(http.MethodPost, s.handleCtrlHeartbeatSet))
	mux.HandleFunc("/api/v1/heartbeat/run", auth(http.MethodPost, s.handleCtrlHeartbeatRun))
	mux.HandleFunc("/api/v1/heartbeat/clear-logs", auth(http.MethodPost, s.handleCtrlHeartbeatClear))

	mux.HandleFunc("/api/v1/automations", auth(http.MethodGet, s.handleCtrlAutomations))
	mux.HandleFunc("/api/v1/automations/add", auth(http.MethodPost, s.handleCtrlAutomationAdd))
	mux.HandleFunc("/api/v1/automations/enable", auth(http.MethodPost, s.handleCtrlAutomationEnable(true)))
	mux.HandleFunc("/api/v1/automations/disable", auth(http.MethodPost, s.handleCtrlAutomationEnable(false)))
	mux.HandleFunc("/api/v1/automations/run", auth(http.MethodPost, s.handleCtrlAutomationRun))
	mux.HandleFunc("/api/v1/automations/remove", auth(http.MethodPost, s.handleCtrlAutomationRemove))

	mux.HandleFunc("/api/v1/plugins", auth(http.MethodGet, s.handleCtrlPlugins))
	mux.HandleFunc("/api/v1/plugins/inspect", auth(http.MethodGet, s.handleCtrlPluginInspect))
	mux.HandleFunc("/api/v1/plugins/install", auth(http.MethodPost, s.handleCtrlPluginInstall))
	mux.HandleFunc("/api/v1/plugins/install-dir", auth(http.MethodPost, s.handleCtrlPluginInstallDir))
	mux.HandleFunc("/api/v1/plugins/reload", auth(http.MethodPost, s.handleCtrlPluginReload))
	mux.HandleFunc("/api/v1/plugins/enable", auth(http.MethodPost, s.handleCtrlPluginEnable(true)))
	mux.HandleFunc("/api/v1/plugins/disable", auth(http.MethodPost, s.handleCtrlPluginEnable(false)))
	mux.HandleFunc("/api/v1/plugins/policy", auth(http.MethodPost, s.handleCtrlPluginPolicy))
	mux.HandleFunc("/api/v1/plugins/config", auth(http.MethodPost, s.handleCtrlPluginConfig))
	mux.HandleFunc("/api/v1/plugins/trigger", auth(http.MethodPost, s.handleCtrlPluginTrigger))
	mux.HandleFunc("/api/v1/plugins/remove", auth(http.MethodPost, s.handleCtrlPluginRemove))

	mux.HandleFunc("/api/v1/mcp", auth(http.MethodGet, s.handleCtrlMcp))
	mux.HandleFunc("/api/v1/mcp/add", auth(http.MethodPost, s.handleCtrlMcpAdd))
	mux.HandleFunc("/api/v1/mcp/enable", auth(http.MethodPost, s.handleCtrlMcpEnable(true)))
	mux.HandleFunc("/api/v1/mcp/disable", auth(http.MethodPost, s.handleCtrlMcpEnable(false)))
	mux.HandleFunc("/api/v1/mcp/reconnect", auth(http.MethodPost, s.handleCtrlMcpReconnect))
	mux.HandleFunc("/api/v1/mcp/remove", auth(http.MethodPost, s.handleCtrlMcpRemove))

	mux.HandleFunc("/api/v1/memory", auth(http.MethodGet, s.handleCtrlMemory))
	mux.HandleFunc("/api/v1/memory/add", auth(http.MethodPost, s.handleCtrlMemoryAdd))
	mux.HandleFunc("/api/v1/memory/remove", auth(http.MethodPost, s.handleCtrlMemoryRemove))
	mux.HandleFunc("/api/v1/memory/clear", auth(http.MethodPost, s.handleCtrlMemoryClear))

	mux.HandleFunc("/api/v1/inbox", auth(http.MethodGet, s.handleCtrlInbox))
	mux.HandleFunc("/api/v1/timeline", auth(http.MethodGet, s.handleCtrlTimeline))
	mux.HandleFunc("/api/v1/skills", auth(http.MethodGet, s.handleCtrlSkills))
}

func (s *Service) authorizeControlRequest(r *http.Request) bool {
	s.mu.Lock()
	expected := s.controlToken
	s.mu.Unlock()
	if expected == "" {
		return false
	}
	hdr := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(hdr, "Bearer ") {
		return false
	}
	got := strings.TrimSpace(strings.TrimPrefix(hdr, "Bearer "))
	if len(got) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(expected)) == 1
}

func (s *Service) handleCtrlConfigDispatch(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeControlRequest(r) {
		writeControlJSON(w, http.StatusUnauthorized, map[string]any{
			"ok":    false,
			"error": "未授权：缺少或无效的 Bearer Token",
		})
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleCtrlConfigGet(w, r)
	case http.MethodPost:
		s.handleCtrlConfigSet(w, r)
	default:
		writeControlJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "仅支持 GET/POST"})
	}
}

func (s *Service) handleCtrlStatus(w http.ResponseWriter, _ *http.Request) {
	snap := s.store.Snapshot()
	pluginsEnabled := 0
	pluginsLocal := 0
	for _, p := range snap.Plugins {
		if p.Installed && p.Enabled {
			pluginsEnabled++
		}
		if p.Source == "local" {
			pluginsLocal++
		}
	}
	inboxPending := 0
	for _, it := range snap.InboxItems {
		if it.Status == "pending" {
			inboxPending++
		}
	}
	autoEnabled := 0
	for _, a := range snap.Automations {
		if a.Enabled {
			autoEnabled++
		}
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":               true,
		"mode":             "daemon",
		"pid":              os.Getpid(),
		"dataDir":          s.opts.DataDir,
		"webhookEndpoint":  snap.Preferences.PluginRuntime.WebhookEndpoint,
		"isPaused":         snap.IsPaused,
		"isOnDuty":         snap.IsOnDuty,
		"activeProviderId": snap.Preferences.ActiveProviderID,
		"models":           snap.Preferences.Models,
		"autonomyLevel":    snap.Preferences.AutonomyLevel,
		"appearance":       snap.Preferences.Appearance,
		"lightTheme":       snap.Preferences.LightTheme,
		"darkTheme":        snap.Preferences.DarkTheme,
		"systemMetrics":    snap.SystemMetrics,
		"counts": map[string]int{
			"pluginsTotal":       len(snap.Plugins),
			"pluginsEnabled":     pluginsEnabled,
			"pluginsLocal":       pluginsLocal,
			"inboxPending":       inboxPending,
			"timelineTotal":      len(snap.TimelineEvents),
			"automationsTotal":   len(snap.Automations),
			"automationsEnabled": autoEnabled,
			"mcpTotal":           len(snap.McpServers),
			"memoriesTotal":      len(snap.Memories),
		},
	})
}

func (s *Service) handleCtrlSnapshot(w http.ResponseWriter, _ *http.Request) {
	snap, err := s.GetSnapshot()
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"snapshot": redactSnapshot(snap),
	})
}

func (s *Service) handleCtrlPause(paused bool) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		next := s.store.Update(func(st *types.ValetSnapshot) {
			st.IsPaused = paused
			st.IsOnDuty = !paused
		})
		if s.opts.OnSyncTray != nil {
			s.opts.OnSyncTray(next.Preferences.ShowMenuBarIcon, next.IsPaused)
		}
		s.syncRuntime(next)
		s.emitStateChange("full")
		writeControlJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"isPaused": next.IsPaused,
			"isOnDuty": next.IsOnDuty,
		})
	}
}

func (s *Service) handleCtrlConfigGet(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	snap := s.store.Snapshot()
	val, err := configctl.Get(snap.Preferences, key)
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"key":   key,
		"value": val,
	})
}

func (s *Service) handleCtrlConfigSchema(w http.ResponseWriter, _ *http.Request) {
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"keys": configctl.Schema(),
	})
}

func (s *Service) handleCtrlConfigSet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Updates map[string]string `json:"updates"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	snap := s.store.Snapshot()
	changes, err := configctl.ApplyUpdates(&snap, body.Updates)
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.UpdatePreferences(snap.Preferences)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"changes":     changes,
		"preferences": next.Preferences,
	})
}

func (s *Service) handleCtrlResetThresholds(w http.ResponseWriter, _ *http.Request) {
	next, err := s.ResetThresholds()
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"thresholds": next.Preferences.Thresholds,
	})
}

func (s *Service) handleCtrlProviders(w http.ResponseWriter, _ *http.Request) {
	snap := s.store.Snapshot()
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":               true,
		"activeProviderId": snap.Preferences.ActiveProviderID,
		"models":           snap.Preferences.Models,
		"providers":        redactProviders(snap.Providers),
	})
}

func (s *Service) handleCtrlProviderSelect(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProviderID string `json:"providerId"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	pid := strings.TrimSpace(body.ProviderID)
	snap := s.store.Snapshot()
	found := false
	for _, p := range snap.Providers {
		if p.ID == pid {
			found = true
			break
		}
	}
	if !found {
		writeControlErr(w, http.StatusNotFound, fmt.Errorf("未找到服务商: %q", pid))
		return
	}
	next, err := s.SelectProvider(pid)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":               true,
		"activeProviderId": next.Preferences.ActiveProviderID,
		"models":           next.Preferences.Models,
	})
}

func (s *Service) handleCtrlProviderUpdate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProviderID string   `json:"providerId"`
		APIKey     *string  `json:"apiKey"`
		BaseURL    *string  `json:"baseUrl"`
		ProxyURL   *string  `json:"proxyUrl"`
		OrgID      *string  `json:"orgId"`
		Endpoint   *string  `json:"endpoint"`
		Models     []string `json:"models"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	pid := strings.TrimSpace(body.ProviderID)
	snap := s.store.Snapshot()
	var current *types.AgentProviderConfig
	for i := range snap.Providers {
		if snap.Providers[i].ID == pid {
			cp := snap.Providers[i]
			current = &cp
			break
		}
	}
	if current == nil {
		writeControlErr(w, http.StatusNotFound, fmt.Errorf("未找到服务商: %q", pid))
		return
	}
	if body.APIKey != nil {
		current.APIKey = strings.TrimSpace(*body.APIKey)
	}
	if body.BaseURL != nil {
		current.BaseURL = strings.TrimSpace(*body.BaseURL)
	}
	if body.ProxyURL != nil {
		current.ProxyURL = strings.TrimSpace(*body.ProxyURL)
	}
	if body.OrgID != nil {
		current.OrgID = strings.TrimSpace(*body.OrgID)
	}
	if body.Endpoint != nil {
		current.Endpoint = strings.TrimSpace(*body.Endpoint)
	}
	if len(body.Models) > 0 {
		current.Models = body.Models
		current.AvailableModelCount = len(body.Models)
	}

	next, err := s.UpdateProvider(pid, *current)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	var updated types.AgentProviderConfig
	for _, p := range redactProviders(next.Providers) {
		if p.ID == pid {
			updated = p
			break
		}
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"provider": updated,
	})
}

func (s *Service) handleCtrlProviderVerify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProviderID string `json:"providerId"`
	}
	if err := decodeControlBody(r, &body); err != nil && !strings.Contains(err.Error(), "EOF") {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	snap := s.store.Snapshot()
	pid := strings.TrimSpace(body.ProviderID)
	if pid == "" {
		pid = snap.Preferences.ActiveProviderID
	}
	var current *types.AgentProviderConfig
	for i := range snap.Providers {
		if snap.Providers[i].ID == pid {
			cp := snap.Providers[i]
			current = &cp
			break
		}
	}
	if current == nil {
		writeControlErr(w, http.StatusNotFound, fmt.Errorf("未找到服务商: %q", pid))
		return
	}
	res, err := s.VerifyProvider(r.Context(), *current)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	if res.OK {
		current.Verified = true
		current.Connected = true
		current.LatencyMs = res.LatencyMs
		if len(res.Models) > 0 {
			current.Models = res.Models
			current.AvailableModelCount = len(res.Models)
		}
		_, _ = s.UpdateProvider(pid, *current)
		s.emitStateChange("settings")
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":         res.OK,
		"providerId": pid,
		"result":     res,
	})
}

func (s *Service) handleCtrlModelsUpdate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Primary string `json:"primary"`
		Fast    string `json:"fast"`
		Vision  string `json:"vision"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	snap := s.store.Snapshot()
	models := snap.Preferences.Models
	if strings.TrimSpace(body.Primary) != "" {
		models.Primary = strings.TrimSpace(body.Primary)
	}
	if strings.TrimSpace(body.Fast) != "" {
		models.Fast = strings.TrimSpace(body.Fast)
	}
	if strings.TrimSpace(body.Vision) != "" {
		models.Vision = strings.TrimSpace(body.Vision)
	}
	next, err := s.UpdateModels(models)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"models": next.Preferences.Models,
	})
}

func (s *Service) handleCtrlHeartbeat(w http.ResponseWriter, _ *http.Request) {
	snap := s.store.Snapshot()
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"config": snap.Preferences.Heartbeat,
		"logs":   snap.HeartbeatLogs,
	})
}

func (s *Service) handleCtrlHeartbeatSet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled     *bool   `json:"enabled"`
		IntervalMin *int    `json:"intervalMin"`
		Prompt      *string `json:"prompt"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	snap := s.store.Snapshot()
	updates := map[string]string{}
	if body.Enabled != nil {
		updates["heartbeat.enabled"] = strconv.FormatBool(*body.Enabled)
	}
	if body.IntervalMin != nil {
		updates["heartbeat.intervalMin"] = strconv.Itoa(*body.IntervalMin)
	}
	if body.Prompt != nil {
		updates["heartbeat.prompt"] = *body.Prompt
	}
	if _, err := configctl.ApplyUpdates(&snap, updates); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.UpdatePreferences(snap.Preferences)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"config": next.Preferences.Heartbeat,
	})
}

func (s *Service) handleCtrlHeartbeatRun(w http.ResponseWriter, r *http.Request) {
	next, err := s.TriggerHeartbeatNow(r.Context())
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	var latest *types.HeartbeatRunLog
	if len(next.HeartbeatLogs) > 0 {
		latest = &next.HeartbeatLogs[0]
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"config": next.Preferences.Heartbeat,
		"latest": latest,
	})
}

func (s *Service) handleCtrlHeartbeatClear(w http.ResponseWriter, _ *http.Request) {
	if _, err := s.ClearHeartbeatLogs(); err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleCtrlAutomations(w http.ResponseWriter, _ *http.Request) {
	snap := s.store.Snapshot()
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"automations": snap.Automations,
	})
}

func (s *Service) handleCtrlAutomationAdd(w http.ResponseWriter, r *http.Request) {
	var rule types.AutomationRule
	if err := decodeControlBody(r, &rule); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(rule.Title) == "" {
		writeControlErr(w, http.StatusBadRequest, fmt.Errorf("自动化规则 title 不能为空"))
		return
	}
	if rule.TriggerType == "" {
		rule.TriggerType = "cron"
	}
	if rule.ScheduleTop == "" && rule.ScheduleBottom == "" {
		rule.ScheduleTop = "定时"
		rule.ScheduleBottom = "执行"
	}
	next, err := s.AddAutomationRule(rule)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("automations")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"automations": next.Automations,
	})
}

func (s *Service) handleCtrlAutomationEnable(enabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		if err := decodeControlBody(r, &body); err != nil {
			writeControlErr(w, http.StatusBadRequest, err)
			return
		}
		id := strings.TrimSpace(body.ID)
		found := false
		next := s.store.Update(func(st *types.ValetSnapshot) {
			for i := range st.Automations {
				if st.Automations[i].ID == id {
					st.Automations[i].Enabled = enabled
					found = true
				}
			}
		})
		if !found {
			writeControlErr(w, http.StatusNotFound, fmt.Errorf("未找到自动化规则: %q", id))
			return
		}
		s.syncRuntime(next)
		s.emitStateChange("automations")
		writeControlJSON(w, http.StatusOK, map[string]any{
			"ok":          true,
			"automations": next.Automations,
		})
	}
}

func (s *Service) handleCtrlAutomationRun(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.RunAutomationNow(r.Context(), strings.TrimSpace(body.ID))
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"automations": next.Automations,
	})
}

func (s *Service) handleCtrlAutomationRemove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.DeleteAutomationRule(strings.TrimSpace(body.ID))
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("automations")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"automations": next.Automations,
	})
}

func (s *Service) handleCtrlPlugins(w http.ResponseWriter, _ *http.Request) {
	snap := s.store.Snapshot()
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"pluginsDir": filepath.Join(s.opts.DataDir, "plugins"),
		"plugins":    snap.Plugins,
	})
}

func (s *Service) handleCtrlPluginInspect(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeControlErr(w, http.StatusBadRequest, fmt.Errorf("缺少 id 参数"))
		return
	}
	plugin, files, err := s.inspectPluginDetail(id)
	if err != nil {
		writeControlErr(w, http.StatusNotFound, err)
		return
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"plugin": plugin,
		"files":  files,
	})
}

func (s *Service) handleCtrlPluginInstall(w http.ResponseWriter, r *http.Request) {
	var params types.UpsertLocalPluginParams
	if err := decodeControlBody(r, &params); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	_, pl, err := s.upsertLocalPlugin(params)
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"plugin": pl,
	})
}

func (s *Service) handleCtrlPluginInstallDir(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Dir       string `json:"dir"`
		Slug      string `json:"slug"`
		Name      string `json:"name"`
		Tagline   string `json:"tagline"`
		SkillFile string `json:"skillFile"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	var skillOverride string
	if strings.TrimSpace(body.SkillFile) != "" {
		raw, err := os.ReadFile(strings.TrimSpace(body.SkillFile))
		if err != nil {
			writeControlErr(w, http.StatusBadRequest, err)
			return
		}
		skillOverride = string(raw)
	}
	_, pl, err := s.installPluginFromDir(body.Dir, body.Slug, body.Name, body.Tagline, skillOverride)
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"plugin": pl,
	})
}

func (s *Service) handleCtrlPluginReload(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	_ = decodeControlBody(r, &body)
	next, err := s.ReloadPlugin(strings.TrimSpace(body.ID))
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"plugins": next.Plugins,
	})
}

func (s *Service) handleCtrlPluginEnable(enabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		if err := decodeControlBody(r, &body); err != nil {
			writeControlErr(w, http.StatusBadRequest, err)
			return
		}
		id := strings.TrimSpace(body.ID)
		found := false
		var updated types.PluginState
		next := s.store.Update(func(st *types.ValetSnapshot) {
			for i := range st.Plugins {
				if st.Plugins[i].ID == id || st.Plugins[i].Slug == id {
					st.Plugins[i].Installed = true
					st.Plugins[i].Enabled = enabled
					updated = st.Plugins[i]
					found = true
					break
				}
			}
		})
		if !found {
			writeControlErr(w, http.StatusNotFound, fmt.Errorf("未找到插件: %q", id))
			return
		}
		s.syncRuntime(next)
		s.emitStateChange("plugins")
		writeControlJSON(w, http.StatusOK, map[string]any{
			"ok":     true,
			"plugin": updated,
		})
	}
}

func (s *Service) handleCtrlPluginPolicy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID      string `json:"id"`
		EventID string `json:"eventId"`
		Policy  string `json:"policy"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	pol := strings.TrimSpace(body.Policy)
	if pol != "auto" && pol != "ask" && pol != "record" {
		writeControlErr(w, http.StatusBadRequest, fmt.Errorf("策略仅支持 auto | ask | record，收到 %q", pol))
		return
	}
	next, err := s.UpdatePluginEventPolicy(strings.TrimSpace(body.ID), strings.TrimSpace(body.EventID), pol)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("plugins")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"plugins": next.Plugins,
	})
}

func (s *Service) handleCtrlPluginConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID     string             `json:"id"`
		Config types.PluginConfig `json:"config"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.UpdatePluginConfig(strings.TrimSpace(body.ID), body.Config)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("plugins")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"plugins": next.Plugins,
	})
}

func (s *Service) handleCtrlPluginTrigger(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID      string `json:"id"`
		EventID string `json:"eventId"`
		Payload string `json:"payload"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	res, err := s.TriggerPluginEvent(r.Context(), strings.TrimSpace(body.ID), strings.TrimSpace(body.EventID), body.Payload)
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"result": res,
	})
}

func (s *Service) handleCtrlPluginRemove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID          string `json:"id"`
		DeleteFiles bool   `json:"deleteFiles"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.RemoveLocalPluginWithFiles(strings.TrimSpace(body.ID), body.DeleteFiles)
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"plugins": next.Plugins,
	})
}

func (s *Service) handleCtrlMcp(w http.ResponseWriter, _ *http.Request) {
	snap := s.store.Snapshot()
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"mcpServers": snap.McpServers,
	})
}

func (s *Service) handleCtrlMcpAdd(w http.ResponseWriter, r *http.Request) {
	var srv types.McpServerItem
	if err := decodeControlBody(r, &srv); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(srv.Name) == "" {
		writeControlErr(w, http.StatusBadRequest, fmt.Errorf("MCP 名称不能为空"))
		return
	}
	if srv.Abbr == "" {
		srv.Abbr = strings.ToLower(string([]rune(strings.TrimSpace(srv.Name))[:minInt(2, len([]rune(strings.TrimSpace(srv.Name))))]))
	}
	if srv.Transport == "" {
		if srv.URL != "" {
			srv.Transport = "http"
		} else {
			srv.Transport = "stdio"
		}
	}
	if srv.TransportLabel == "" {
		if srv.Transport == "http" {
			srv.TransportLabel = "http · " + srv.URL
		} else {
			srv.TransportLabel = "stdio · " + srv.Command
		}
	}
	srv.Enabled = true
	next, err := s.AddMcpServer(r.Context(), srv)
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"mcpServers": next.McpServers,
	})
}

func (s *Service) handleCtrlMcpEnable(enabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		if err := decodeControlBody(r, &body); err != nil {
			writeControlErr(w, http.StatusBadRequest, err)
			return
		}
		id := strings.TrimSpace(body.ID)
		found := false
		next := s.store.Update(func(st *types.ValetSnapshot) {
			for i := range st.McpServers {
				if st.McpServers[i].ID == id || st.McpServers[i].Name == id {
					st.McpServers[i].Enabled = enabled
					found = true
				}
			}
		})
		if !found {
			writeControlErr(w, http.StatusNotFound, fmt.Errorf("未找到 MCP 服务器: %q", id))
			return
		}
		s.syncRuntime(next)
		s.emitStateChange("settings")
		writeControlJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"mcpServers": next.McpServers,
		})
	}
}

func (s *Service) handleCtrlMcpReconnect(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.ReconnectMcpServer(r.Context(), strings.TrimSpace(body.ID))
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"mcpServers": next.McpServers,
	})
}

func (s *Service) handleCtrlMcpRemove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.DeleteMcpServer(strings.TrimSpace(body.ID))
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"mcpServers": next.McpServers,
	})
}

func (s *Service) handleCtrlMemory(w http.ResponseWriter, _ *http.Request) {
	snap := s.store.Snapshot()
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"memories": snap.Memories,
	})
}

func (s *Service) handleCtrlMemoryAdd(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content string `json:"content"`
		Source  string `json:"source"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.AddMemory(body.Content, body.Source)
	if err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"memories": next.Memories,
	})
}

func (s *Service) handleCtrlMemoryRemove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := decodeControlBody(r, &body); err != nil {
		writeControlErr(w, http.StatusBadRequest, err)
		return
	}
	next, err := s.DeleteMemory(strings.TrimSpace(body.ID))
	if err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"memories": next.Memories,
	})
}

func (s *Service) handleCtrlMemoryClear(w http.ResponseWriter, _ *http.Request) {
	if _, err := s.ClearMemories(); err != nil {
		writeControlErr(w, http.StatusInternalServerError, err)
		return
	}
	s.emitStateChange("settings")
	writeControlJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleCtrlInbox(w http.ResponseWriter, _ *http.Request) {
	snap := s.store.Snapshot()
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"inboxItems": snap.InboxItems,
	})
}

func (s *Service) handleCtrlTimeline(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	events := snap.TimelineEvents
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		if n, err := strconv.Atoi(rawLimit); err == nil && n > 0 && n < len(events) {
			events = events[:n]
		}
	}
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"timelineEvents": events,
	})
}

func (s *Service) handleCtrlSkills(w http.ResponseWriter, _ *http.Request) {
	writeControlJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"skills": s.listAllSkills(),
	})
}

func redactProviders(list []types.AgentProviderConfig) []types.AgentProviderConfig {
	out := make([]types.AgentProviderConfig, len(list))
	copy(out, list)
	for i := range out {
		out[i].APIKey = ""
	}
	return out
}

func redactSnapshot(snap types.ValetSnapshot) types.ValetSnapshot {
	snap.Providers = redactProviders(snap.Providers)
	snap.Preferences.AutoReview.JevAPIKey = ""
	return snap
}

func decodeControlBody(r *http.Request, dst any) error {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 2*1024*1024))
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return io.EOF
	}
	return json.Unmarshal(raw, dst)
}

func writeControlErr(w http.ResponseWriter, status int, err error) {
	writeControlJSON(w, status, map[string]any{
		"ok":    false,
		"error": err.Error(),
	})
}

func writeControlJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
