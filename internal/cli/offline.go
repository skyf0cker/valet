package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"valet/internal/configctl"
	"valet/internal/plugins"
	"valet/internal/store"
	"valet/internal/types"
	skillsbundle "valet/skills"
)

type cliBackend interface {
	mode() string
	status() (map[string]any, error)
	setPaused(paused bool) (map[string]any, error)
	configGet(keyOrSection string) (map[string]any, error)
	configSet(updates map[string]string) (map[string]any, error)
	configSchema() (map[string]any, error)
	configResetThresholds() (map[string]any, error)
	providersList() (map[string]any, error)
	providerSelect(id string) (map[string]any, error)
	providerUpdate(body map[string]any) (map[string]any, error)
	providerVerify(id string) (map[string]any, error)
	modelsSet(primary, fast, vision string) (map[string]any, error)
	heartbeatStatus() (map[string]any, error)
	heartbeatSet(enabled *bool, interval *int, prompt *string) (map[string]any, error)
	heartbeatRun() (map[string]any, error)
	heartbeatClearLogs() (map[string]any, error)
	automationList() (map[string]any, error)
	automationAdd(rule types.AutomationRule) (map[string]any, error)
	automationEnable(id string, enabled bool) (map[string]any, error)
	automationRun(id string) (map[string]any, error)
	automationRemove(id string) (map[string]any, error)
	pluginList() (map[string]any, error)
	pluginInspect(id string) (map[string]any, error)
	pluginInstallDir(dir, slug, name, tagline, skillFile string) (map[string]any, error)
	pluginReload(id string) (map[string]any, error)
	pluginEnable(id string, enabled bool) (map[string]any, error)
	pluginPolicy(id, eventID, policy string) (map[string]any, error)
	pluginTrigger(id, eventID, payload string) (map[string]any, error)
	pluginRemove(id string, deleteFiles bool) (map[string]any, error)
	mcpList() (map[string]any, error)
	mcpAdd(srv types.McpServerItem) (map[string]any, error)
	mcpEnable(id string, enabled bool) (map[string]any, error)
	mcpReconnect(id string) (map[string]any, error)
	mcpRemove(id string) (map[string]any, error)
	memoryList() (map[string]any, error)
	memoryAdd(content, source string) (map[string]any, error)
	memoryRemove(id string) (map[string]any, error)
	memoryClear() (map[string]any, error)
	inboxList() (map[string]any, error)
	timelineList(limit int) (map[string]any, error)
	skillList() (map[string]any, error)
}

type daemonBackend struct {
	client *daemonClient
}

func (d *daemonBackend) mode() string { return "daemon" }

func (d *daemonBackend) status() (map[string]any, error) {
	return d.client.get("/api/v1/status")
}

func (d *daemonBackend) setPaused(paused bool) (map[string]any, error) {
	if paused {
		return d.client.post("/api/v1/daemon/pause", map[string]any{})
	}
	return d.client.post("/api/v1/daemon/resume", map[string]any{})
}

func (d *daemonBackend) configGet(keyOrSection string) (map[string]any, error) {
	if strings.TrimSpace(keyOrSection) == "" {
		return d.client.get("/api/v1/config")
	}
	return d.client.get("/api/v1/config?" + encodeQuery("key", keyOrSection))
}

func (d *daemonBackend) configSet(updates map[string]string) (map[string]any, error) {
	return d.client.post("/api/v1/config", map[string]any{"updates": updates})
}

func (d *daemonBackend) configSchema() (map[string]any, error) {
	return d.client.get("/api/v1/config/schema")
}

func (d *daemonBackend) configResetThresholds() (map[string]any, error) {
	return d.client.post("/api/v1/config/reset-thresholds", map[string]any{})
}

func (d *daemonBackend) providersList() (map[string]any, error) {
	return d.client.get("/api/v1/providers")
}

func (d *daemonBackend) providerSelect(id string) (map[string]any, error) {
	return d.client.post("/api/v1/providers/select", map[string]any{"providerId": id})
}

func (d *daemonBackend) providerUpdate(body map[string]any) (map[string]any, error) {
	return d.client.post("/api/v1/providers/update", body)
}

func (d *daemonBackend) providerVerify(id string) (map[string]any, error) {
	return d.client.postLong("/api/v1/providers/verify", map[string]any{"providerId": id})
}

func (d *daemonBackend) modelsSet(primary, fast, vision string) (map[string]any, error) {
	return d.client.post("/api/v1/models", map[string]any{
		"primary": primary,
		"fast":    fast,
		"vision":  vision,
	})
}

func (d *daemonBackend) heartbeatStatus() (map[string]any, error) {
	return d.client.get("/api/v1/heartbeat")
}

func (d *daemonBackend) heartbeatSet(enabled *bool, interval *int, prompt *string) (map[string]any, error) {
	return d.client.post("/api/v1/heartbeat/set", map[string]any{
		"enabled":     enabled,
		"intervalMin": interval,
		"prompt":      prompt,
	})
}

func (d *daemonBackend) heartbeatRun() (map[string]any, error) {
	return d.client.postLong("/api/v1/heartbeat/run", map[string]any{})
}

func (d *daemonBackend) heartbeatClearLogs() (map[string]any, error) {
	return d.client.post("/api/v1/heartbeat/clear-logs", map[string]any{})
}

func (d *daemonBackend) automationList() (map[string]any, error) {
	return d.client.get("/api/v1/automations")
}

func (d *daemonBackend) automationAdd(rule types.AutomationRule) (map[string]any, error) {
	return d.client.post("/api/v1/automations/add", rule)
}

func (d *daemonBackend) automationEnable(id string, enabled bool) (map[string]any, error) {
	path := "/api/v1/automations/disable"
	if enabled {
		path = "/api/v1/automations/enable"
	}
	return d.client.post(path, map[string]any{"id": id})
}

func (d *daemonBackend) automationRun(id string) (map[string]any, error) {
	return d.client.postLong("/api/v1/automations/run", map[string]any{"id": id})
}

func (d *daemonBackend) automationRemove(id string) (map[string]any, error) {
	return d.client.post("/api/v1/automations/remove", map[string]any{"id": id})
}

func (d *daemonBackend) pluginList() (map[string]any, error) {
	return d.client.get("/api/v1/plugins")
}

func (d *daemonBackend) pluginInspect(id string) (map[string]any, error) {
	return d.client.get("/api/v1/plugins/inspect?" + encodeQuery("id", id))
}

func (d *daemonBackend) pluginInstallDir(dir, slug, name, tagline, skillFile string) (map[string]any, error) {
	return d.client.post("/api/v1/plugins/install-dir", map[string]any{
		"dir":       dir,
		"slug":      slug,
		"name":      name,
		"tagline":   tagline,
		"skillFile": skillFile,
	})
}

func (d *daemonBackend) pluginReload(id string) (map[string]any, error) {
	return d.client.post("/api/v1/plugins/reload", map[string]any{"id": id})
}

func (d *daemonBackend) pluginEnable(id string, enabled bool) (map[string]any, error) {
	path := "/api/v1/plugins/disable"
	if enabled {
		path = "/api/v1/plugins/enable"
	}
	return d.client.post(path, map[string]any{"id": id})
}

func (d *daemonBackend) pluginPolicy(id, eventID, policy string) (map[string]any, error) {
	return d.client.post("/api/v1/plugins/policy", map[string]any{
		"id":      id,
		"eventId": eventID,
		"policy":  policy,
	})
}

func (d *daemonBackend) pluginTrigger(id, eventID, payload string) (map[string]any, error) {
	return d.client.postLong("/api/v1/plugins/trigger", map[string]any{
		"id":      id,
		"eventId": eventID,
		"payload": payload,
	})
}

func (d *daemonBackend) pluginRemove(id string, deleteFiles bool) (map[string]any, error) {
	return d.client.post("/api/v1/plugins/remove", map[string]any{
		"id":          id,
		"deleteFiles": deleteFiles,
	})
}

func (d *daemonBackend) mcpList() (map[string]any, error) {
	return d.client.get("/api/v1/mcp")
}

func (d *daemonBackend) mcpAdd(srv types.McpServerItem) (map[string]any, error) {
	return d.client.postLong("/api/v1/mcp/add", srv)
}

func (d *daemonBackend) mcpEnable(id string, enabled bool) (map[string]any, error) {
	path := "/api/v1/mcp/disable"
	if enabled {
		path = "/api/v1/mcp/enable"
	}
	return d.client.post(path, map[string]any{"id": id})
}

func (d *daemonBackend) mcpReconnect(id string) (map[string]any, error) {
	return d.client.postLong("/api/v1/mcp/reconnect", map[string]any{"id": id})
}

func (d *daemonBackend) mcpRemove(id string) (map[string]any, error) {
	return d.client.post("/api/v1/mcp/remove", map[string]any{"id": id})
}

func (d *daemonBackend) memoryList() (map[string]any, error) {
	return d.client.get("/api/v1/memory")
}

func (d *daemonBackend) memoryAdd(content, source string) (map[string]any, error) {
	return d.client.post("/api/v1/memory/add", map[string]any{
		"content": content,
		"source":  source,
	})
}

func (d *daemonBackend) memoryRemove(id string) (map[string]any, error) {
	return d.client.post("/api/v1/memory/remove", map[string]any{"id": id})
}

func (d *daemonBackend) memoryClear() (map[string]any, error) {
	return d.client.post("/api/v1/memory/clear", map[string]any{})
}

func (d *daemonBackend) inboxList() (map[string]any, error) {
	return d.client.get("/api/v1/inbox")
}

func (d *daemonBackend) timelineList(limit int) (map[string]any, error) {
	path := "/api/v1/timeline"
	if limit > 0 {
		path = fmt.Sprintf("/api/v1/timeline?limit=%d", limit)
	}
	return d.client.get(path)
}

func (d *daemonBackend) skillList() (map[string]any, error) {
	return d.client.get("/api/v1/skills")
}

type offlineBackend struct {
	dataDir string
	homeDir string
	st      *store.Store
	secrets *store.SecretsStore
}

func openOfflineBackend(dataDir string) (*offlineBackend, error) {
	home, _ := os.UserHomeDir()
	st, err := store.OpenWithOptions(dataDir, home, true)
	if err != nil {
		return nil, err
	}
	secStore, err := store.OpenSecretsStore(dataDir)
	if err != nil {
		return nil, err
	}
	if err := secStore.HydrateSnapshot(st, store.HydrateSecretsOptions{DesktopReady: false}, maskSecretOffline); err != nil {
		return nil, err
	}
	if bundles, dErr := plugins.DiscoverLocalPlugins(filepath.Join(dataDir, "plugins")); dErr == nil && len(bundles) > 0 {
		st.Update(func(snap *types.ValetSnapshot) {
			for _, b := range bundles {
				mergeLocalPluginOffline(&snap.Plugins, b)
			}
		})
	}
	return &offlineBackend{dataDir: dataDir, homeDir: home, st: st, secrets: secStore}, nil
}

func (o *offlineBackend) mode() string { return "offline" }

func (o *offlineBackend) status() (map[string]any, error) {
	snap := o.st.Snapshot()
	pluginsEnabled, pluginsLocal, inboxPending, autoEnabled := 0, 0, 0, 0
	for _, p := range snap.Plugins {
		if p.Installed && p.Enabled {
			pluginsEnabled++
		}
		if p.Source == "local" {
			pluginsLocal++
		}
	}
	for _, it := range snap.InboxItems {
		if it.Status == "pending" {
			inboxPending++
		}
	}
	for _, a := range snap.Automations {
		if a.Enabled {
			autoEnabled++
		}
	}
	return map[string]any{
		"ok":               true,
		"mode":             "offline",
		"dataDir":          o.dataDir,
		"webhookEndpoint":  snap.Preferences.PluginRuntime.WebhookEndpoint,
		"isPaused":         snap.IsPaused,
		"isOnDuty":         snap.IsOnDuty,
		"activeProviderId": snap.Preferences.ActiveProviderID,
		"models":           snap.Preferences.Models,
		"autonomyLevel":    snap.Preferences.AutonomyLevel,
		"appearance":       snap.Preferences.Appearance,
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
	}, nil
}

func (o *offlineBackend) setPaused(paused bool) (map[string]any, error) {
	next := o.st.Update(func(st *types.ValetSnapshot) {
		st.IsPaused = paused
		st.IsOnDuty = !paused
	})
	return map[string]any{
		"ok":       true,
		"mode":     "offline",
		"isPaused": next.IsPaused,
		"isOnDuty": next.IsOnDuty,
	}, nil
}

func (o *offlineBackend) configGet(keyOrSection string) (map[string]any, error) {
	snap := o.st.Snapshot()
	val, err := configctl.Get(snap.Preferences, keyOrSection)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"ok":    true,
		"mode":  "offline",
		"key":   strings.TrimSpace(keyOrSection),
		"value": val,
	}, nil
}

func (o *offlineBackend) configSet(updates map[string]string) (map[string]any, error) {
	var (
		changes []configctl.ChangeRecord
		applyEr error
	)
	next := o.st.Update(func(st *types.ValetSnapshot) {
		changes, applyEr = configctl.ApplyUpdates(st, updates)
	})
	if applyEr != nil {
		return nil, applyEr
	}
	return map[string]any{
		"ok":          true,
		"mode":        "offline",
		"changes":     changes,
		"preferences": next.Preferences,
	}, nil
}

func (o *offlineBackend) configSchema() (map[string]any, error) {
	return map[string]any{
		"ok":   true,
		"mode": "offline",
		"keys": configctl.Schema(),
	}, nil
}

func (o *offlineBackend) configResetThresholds() (map[string]any, error) {
	next := o.st.Update(func(st *types.ValetSnapshot) {
		st.Preferences.Thresholds = store.DefaultThresholds()
	})
	return map[string]any{
		"ok":         true,
		"mode":       "offline",
		"thresholds": next.Preferences.Thresholds,
	}, nil
}

func (o *offlineBackend) providersList() (map[string]any, error) {
	snap := o.st.Snapshot()
	return map[string]any{
		"ok":               true,
		"mode":             "offline",
		"activeProviderId": snap.Preferences.ActiveProviderID,
		"models":           snap.Preferences.Models,
		"providers":        redactProvidersOffline(snap.Providers),
	}, nil
}

func (o *offlineBackend) providerSelect(id string) (map[string]any, error) {
	found := false
	next := o.st.Update(func(st *types.ValetSnapshot) {
		for _, p := range st.Providers {
			if p.ID == id {
				found = true
				break
			}
		}
		if !found {
			return
		}
		st.Preferences.ActiveProviderID = id
		for i := range st.Providers {
			if st.Providers[i].ID == id {
				st.Providers[i].Connected = st.Providers[i].Verified || st.Providers[i].ID == "ollama"
			}
		}
		reconcileProviderModelsOffline(st, id)
	})
	if !found {
		return nil, fmt.Errorf("未找到服务商: %q", id)
	}
	return map[string]any{
		"ok":               true,
		"mode":             "offline",
		"activeProviderId": next.Preferences.ActiveProviderID,
		"models":           next.Preferences.Models,
	}, nil
}

func (o *offlineBackend) providerUpdate(body map[string]any) (map[string]any, error) {
	pid, _ := body["providerId"].(string)
	pid = strings.TrimSpace(pid)
	found := false
	var (
		hasKeyUpdate bool
		updatedKey   string
	)
	next := o.st.Update(func(st *types.ValetSnapshot) {
		for i := range st.Providers {
			if st.Providers[i].ID != pid {
				continue
			}
			found = true
			if k, ok := body["apiKey"].(string); ok {
				k = strings.TrimSpace(k)
				hasKeyUpdate = true
				updatedKey = k
				st.Providers[i].APIKey = k
				st.Providers[i].APIKeyMasked = maskSecretOffline(k)
			}
			if u, ok := body["baseUrl"].(string); ok {
				st.Providers[i].BaseURL = strings.TrimSpace(u)
			}
			if u, ok := body["proxyUrl"].(string); ok {
				st.Providers[i].ProxyURL = strings.TrimSpace(u)
			}
			if org, ok := body["orgId"].(string); ok {
				st.Providers[i].OrgID = strings.TrimSpace(org)
			}
			if ep, ok := body["endpoint"].(string); ok {
				st.Providers[i].Endpoint = strings.TrimSpace(ep)
			}
			if mods, ok := body["models"].([]string); ok && len(mods) > 0 {
				st.Providers[i].Models = mods
				st.Providers[i].AvailableModelCount = len(mods)
			}
			if st.Preferences.ActiveProviderID == pid {
				reconcileProviderModelsOffline(st, pid)
			}
			break
		}
	})
	if !found {
		return nil, fmt.Errorf("未找到服务商: %q", pid)
	}
	if hasKeyUpdate && o.secrets != nil {
		if err := o.secrets.SetProviderKey(pid, updatedKey); err != nil {
			return nil, err
		}
	}
	var updated types.AgentProviderConfig
	for _, p := range redactProvidersOffline(next.Providers) {
		if p.ID == pid {
			updated = p
			break
		}
	}
	return map[string]any{
		"ok":       true,
		"mode":     "offline",
		"provider": updated,
	}, nil
}

func (o *offlineBackend) providerVerify(_ string) (map[string]any, error) {
	return nil, fmt.Errorf("当前处于离线模式（Valet 桌面端未运行）；在线验证服务商连通性需启动 Valet 后执行")
}

func (o *offlineBackend) modelsSet(primary, fast, vision string) (map[string]any, error) {
	next := o.st.Update(func(st *types.ValetSnapshot) {
		if strings.TrimSpace(primary) != "" {
			st.Preferences.Models.Primary = strings.TrimSpace(primary)
		}
		if strings.TrimSpace(fast) != "" {
			st.Preferences.Models.Fast = strings.TrimSpace(fast)
		}
		if strings.TrimSpace(vision) != "" {
			st.Preferences.Models.Vision = strings.TrimSpace(vision)
		}
		for i := range st.ChatThreads {
			st.ChatThreads[i].Model = st.Preferences.Models.Primary
		}
	})
	return map[string]any{
		"ok":     true,
		"mode":   "offline",
		"models": next.Preferences.Models,
	}, nil
}

func (o *offlineBackend) heartbeatStatus() (map[string]any, error) {
	snap := o.st.Snapshot()
	return map[string]any{
		"ok":     true,
		"mode":   "offline",
		"config": snap.Preferences.Heartbeat,
		"logs":   snap.HeartbeatLogs,
	}, nil
}

func (o *offlineBackend) heartbeatSet(enabled *bool, interval *int, prompt *string) (map[string]any, error) {
	updates := map[string]string{}
	if enabled != nil {
		if *enabled {
			updates["heartbeat.enabled"] = "true"
		} else {
			updates["heartbeat.enabled"] = "false"
		}
	}
	if interval != nil {
		updates["heartbeat.intervalMin"] = fmt.Sprintf("%d", *interval)
	}
	if prompt != nil {
		updates["heartbeat.prompt"] = *prompt
	}
	var applyEr error
	next := o.st.Update(func(st *types.ValetSnapshot) {
		_, applyEr = configctl.ApplyUpdates(st, updates)
	})
	if applyEr != nil {
		return nil, applyEr
	}
	return map[string]any{
		"ok":     true,
		"mode":   "offline",
		"config": next.Preferences.Heartbeat,
	}, nil
}

func (o *offlineBackend) heartbeatRun() (map[string]any, error) {
	return nil, fmt.Errorf("当前处于离线模式（Valet 桌面端未运行）；立即执行心跳巡检需启动 Valet 后执行")
}

func (o *offlineBackend) heartbeatClearLogs() (map[string]any, error) {
	o.st.Update(func(st *types.ValetSnapshot) {
		st.HeartbeatLogs = []types.HeartbeatRunLog{}
	})
	return map[string]any{"ok": true, "mode": "offline"}, nil
}

func (o *offlineBackend) automationList() (map[string]any, error) {
	snap := o.st.Snapshot()
	return map[string]any{
		"ok":          true,
		"mode":        "offline",
		"automations": snap.Automations,
	}, nil
}

func (o *offlineBackend) automationAdd(rule types.AutomationRule) (map[string]any, error) {
	if strings.TrimSpace(rule.Title) == "" {
		return nil, fmt.Errorf("自动化规则 title 不能为空")
	}
	if rule.ID == "" {
		rule.ID = fmt.Sprintf("auto-%d", time.Now().UnixNano())
	}
	if rule.TriggerType == "" {
		rule.TriggerType = "cron"
	}
	if rule.CronExpr == "" {
		rule.CronExpr = "0 9 * * *"
	}
	if rule.ScheduleTop == "" && rule.ScheduleBottom == "" {
		rule.ScheduleTop = "定时"
		rule.ScheduleBottom = "执行"
	}
	next := o.st.Update(func(st *types.ValetSnapshot) {
		st.Automations = append(st.Automations, rule)
	})
	return map[string]any{
		"ok":          true,
		"mode":        "offline",
		"automations": next.Automations,
	}, nil
}

func (o *offlineBackend) automationEnable(id string, enabled bool) (map[string]any, error) {
	found := false
	next := o.st.Update(func(st *types.ValetSnapshot) {
		for i := range st.Automations {
			if st.Automations[i].ID == id {
				st.Automations[i].Enabled = enabled
				found = true
			}
		}
	})
	if !found {
		return nil, fmt.Errorf("未找到自动化规则: %q", id)
	}
	return map[string]any{
		"ok":          true,
		"mode":        "offline",
		"automations": next.Automations,
	}, nil
}

func (o *offlineBackend) automationRun(_ string) (map[string]any, error) {
	return nil, fmt.Errorf("当前处于离线模式（Valet 桌面端未运行）；立即运行自动化规则需启动 Valet 后执行")
}

func (o *offlineBackend) automationRemove(id string) (map[string]any, error) {
	next := o.st.Update(func(st *types.ValetSnapshot) {
		out := make([]types.AutomationRule, 0, len(st.Automations))
		for _, a := range st.Automations {
			if a.ID != id {
				out = append(out, a)
			}
		}
		st.Automations = out
	})
	return map[string]any{
		"ok":          true,
		"mode":        "offline",
		"automations": next.Automations,
	}, nil
}

func (o *offlineBackend) pluginList() (map[string]any, error) {
	snap := o.st.Snapshot()
	return map[string]any{
		"ok":         true,
		"mode":       "offline",
		"pluginsDir": filepath.Join(o.dataDir, "plugins"),
		"plugins":    snap.Plugins,
	}, nil
}

func (o *offlineBackend) pluginInspect(id string) (map[string]any, error) {
	snap := o.st.Snapshot()
	q := strings.TrimSpace(id)
	for _, p := range snap.Plugins {
		if p.ID == q || p.Slug == q {
			var files []string
			if p.LocalDir != "" {
				if _, _, _, f, err := plugins.ReadPluginBundle(p.LocalDir); err == nil {
					files = f
				}
			}
			return map[string]any{
				"ok":     true,
				"mode":   "offline",
				"plugin": p,
				"files":  files,
			}, nil
		}
	}
	return nil, fmt.Errorf("未找到插件: %q", id)
}

func (o *offlineBackend) pluginInstallDir(dir, slugOverride, nameOverride, taglineOverride, skillFile string) (map[string]any, error) {
	manifestYAML, skillMD, parsed, files, err := plugins.ReadPluginBundle(dir)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(skillFile) != "" {
		raw, rErr := os.ReadFile(strings.TrimSpace(skillFile))
		if rErr != nil {
			return nil, rErr
		}
		skillMD = string(raw)
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

	pluginDir, parsedOut, err := plugins.WritePluginBundle(filepath.Join(o.dataDir, "plugins"), types.UpsertLocalPluginParams{
		ID:            slug,
		Slug:          slug,
		Name:          strings.TrimSpace(nameOverride),
		Tagline:       strings.TrimSpace(taglineOverride),
		ManifestYAML:  manifestYAML,
		SkillMarkdown: skillMD,
		Files:         extraFiles,
	})
	if err != nil {
		return nil, err
	}

	var result types.PluginState
	o.st.Update(func(st *types.ValetSnapshot) {
		var existing *types.PluginState
		for i := range st.Plugins {
			if st.Plugins[i].ID == slug || st.Plugins[i].Slug == slug {
				existing = &st.Plugins[i]
				break
			}
		}
		id := slug
		if existing != nil && existing.Source != "local" {
			id = "local-" + slug
			existing = nil
		}
		built := plugins.BuildPluginStateFromParsed(id, slug, nameOverride, taglineOverride, "", manifestYAML, skillMD, pluginDir, parsedOut, existing)
		built.Installed = true
		built.Enabled = true
		built.StatusSubtitle = "本地插件 · 离线已安装（启动 Valet 后自动激活）"
		if existing != nil {
			*existing = built
		} else {
			st.Plugins = append(st.Plugins, built)
		}
		result = built
	})

	return map[string]any{
		"ok":     true,
		"mode":   "offline",
		"plugin": result,
	}, nil
}

func (o *offlineBackend) pluginReload(id string) (map[string]any, error) {
	pid := strings.TrimSpace(id)
	pluginsBase := filepath.Join(o.dataDir, "plugins")
	if pid == "" {
		discovered, err := plugins.DiscoverLocalPlugins(pluginsBase)
		if err != nil {
			return nil, err
		}
		next := o.st.Update(func(st *types.ValetSnapshot) {
			for _, bundle := range discovered {
				mergeLocalPluginOffline(&st.Plugins, bundle)
			}
		})
		return map[string]any{"ok": true, "mode": "offline", "plugins": next.Plugins}, nil
	}
	dir := filepath.Join(pluginsBase, plugins.NormalizeSlug(pid))
	snap := o.st.Snapshot()
	for _, p := range snap.Plugins {
		if (p.ID == pid || p.Slug == pid) && p.LocalDir != "" {
			dir = p.LocalDir
			break
		}
	}
	manifestYAML, skillMD, parsed, _, err := plugins.ReadPluginBundle(dir)
	if err != nil {
		return nil, err
	}
	next := o.st.Update(func(st *types.ValetSnapshot) {
		var cur *types.PluginState
		for i := range st.Plugins {
			if st.Plugins[i].ID == pid || st.Plugins[i].Slug == pid {
				cur = &st.Plugins[i]
				break
			}
		}
		slug := plugins.NormalizeSlug(filepath.Base(dir))
		updated := plugins.BuildPluginStateFromParsed(pid, slug, parsed.Name, "", "", manifestYAML, skillMD, dir, parsed, cur)
		updated.StatusSubtitle = "已从磁盘重载（离线）"
		if cur != nil {
			*cur = updated
		} else {
			st.Plugins = append(st.Plugins, updated)
		}
	})
	return map[string]any{"ok": true, "mode": "offline", "plugins": next.Plugins}, nil
}

func (o *offlineBackend) pluginEnable(id string, enabled bool) (map[string]any, error) {
	found := false
	var updated types.PluginState
	o.st.Update(func(st *types.ValetSnapshot) {
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
		return nil, fmt.Errorf("未找到插件: %q", id)
	}
	return map[string]any{"ok": true, "mode": "offline", "plugin": updated}, nil
}

func (o *offlineBackend) pluginPolicy(id, eventID, policy string) (map[string]any, error) {
	if policy != "auto" && policy != "ask" && policy != "record" {
		return nil, fmt.Errorf("策略仅支持 auto | ask | record，收到 %q", policy)
	}
	foundPlugin, foundEv := false, false
	next := o.st.Update(func(st *types.ValetSnapshot) {
		for i := range st.Plugins {
			if st.Plugins[i].ID == id || st.Plugins[i].Slug == id {
				foundPlugin = true
				for j := range st.Plugins[i].Events {
					if st.Plugins[i].Events[j].ID == eventID {
						st.Plugins[i].Events[j].Policy = policy
						foundEv = true
					}
				}
			}
		}
	})
	if !foundPlugin {
		return nil, fmt.Errorf("未找到插件: %q", id)
	}
	if !foundEv {
		return nil, fmt.Errorf("插件 %q 未声明事件 %q", id, eventID)
	}
	return map[string]any{"ok": true, "mode": "offline", "plugins": next.Plugins}, nil
}

func (o *offlineBackend) pluginTrigger(_, _, _ string) (map[string]any, error) {
	return nil, fmt.Errorf("当前处于离线模式（Valet 桌面端未运行）；触发事件并调度 Pi Durable Agent 需启动 Valet 后执行")
}

func (o *offlineBackend) pluginRemove(id string, deleteFiles bool) (map[string]any, error) {
	snap := o.st.Snapshot()
	var found, isLocal bool
	var removedDir, resolvedID, resolvedSlug string
	for _, p := range snap.Plugins {
		if p.ID == id || p.Slug == id {
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
		return nil, fmt.Errorf("未找到插件: %q", id)
	}
	next := o.st.Update(func(st *types.ValetSnapshot) {
		if isLocal {
			filtered := make([]types.PluginState, 0, len(st.Plugins))
			for _, p := range st.Plugins {
				if p.ID == id || p.Slug == id || p.ID == resolvedID {
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
	})
	if deleteFiles {
		basePlugins, _ := filepath.Abs(filepath.Join(o.dataDir, "plugins"))
		target := removedDir
		if target == "" {
			target = filepath.Join(basePlugins, plugins.NormalizeSlug(resolvedSlug))
		}
		if absTarget, err := filepath.Abs(target); err == nil {
			if rel, rErr := filepath.Rel(basePlugins, absTarget); rErr == nil && rel != "." && !strings.HasPrefix(rel, "..") {
				_ = os.RemoveAll(absTarget)
			}
		}
		baseState, _ := filepath.Abs(filepath.Join(o.dataDir, "plugin-state"))
		if absState, err := filepath.Abs(filepath.Join(baseState, resolvedID)); err == nil {
			if rel, rErr := filepath.Rel(baseState, absState); rErr == nil && rel != "." && !strings.HasPrefix(rel, "..") {
				_ = os.RemoveAll(absState)
			}
		}
	}
	return map[string]any{"ok": true, "mode": "offline", "plugins": next.Plugins}, nil
}

func (o *offlineBackend) mcpList() (map[string]any, error) {
	snap := o.st.Snapshot()
	return map[string]any{"ok": true, "mode": "offline", "mcpServers": snap.McpServers}, nil
}

func (o *offlineBackend) mcpAdd(srv types.McpServerItem) (map[string]any, error) {
	if strings.TrimSpace(srv.Name) == "" {
		return nil, fmt.Errorf("MCP 名称不能为空")
	}
	if srv.ID == "" {
		srv.ID = fmt.Sprintf("mcp-%d", time.Now().UnixNano())
	}
	if srv.Abbr == "" {
		r := []rune(strings.TrimSpace(srv.Name))
		if len(r) > 2 {
			r = r[:2]
		}
		srv.Abbr = strings.ToLower(string(r))
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
	next := o.st.Update(func(st *types.ValetSnapshot) {
		st.McpServers = append(st.McpServers, srv)
	})
	return map[string]any{"ok": true, "mode": "offline", "mcpServers": next.McpServers}, nil
}

func (o *offlineBackend) mcpEnable(id string, enabled bool) (map[string]any, error) {
	found := false
	next := o.st.Update(func(st *types.ValetSnapshot) {
		for i := range st.McpServers {
			if st.McpServers[i].ID == id || st.McpServers[i].Name == id {
				st.McpServers[i].Enabled = enabled
				found = true
			}
		}
	})
	if !found {
		return nil, fmt.Errorf("未找到 MCP 服务器: %q", id)
	}
	return map[string]any{"ok": true, "mode": "offline", "mcpServers": next.McpServers}, nil
}

func (o *offlineBackend) mcpReconnect(_ string) (map[string]any, error) {
	return nil, fmt.Errorf("当前处于离线模式（Valet 桌面端未运行）；在线探测 MCP 工具列表需启动 Valet 后执行")
}

func (o *offlineBackend) mcpRemove(id string) (map[string]any, error) {
	next := o.st.Update(func(st *types.ValetSnapshot) {
		out := make([]types.McpServerItem, 0, len(st.McpServers))
		for _, m := range st.McpServers {
			if m.ID != id && m.Name != id {
				out = append(out, m)
			}
		}
		st.McpServers = out
	})
	return map[string]any{"ok": true, "mode": "offline", "mcpServers": next.McpServers}, nil
}

func (o *offlineBackend) memoryList() (map[string]any, error) {
	snap := o.st.Snapshot()
	return map[string]any{"ok": true, "mode": "offline", "memories": snap.Memories}, nil
}

func (o *offlineBackend) memoryAdd(content, source string) (map[string]any, error) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return nil, fmt.Errorf("记忆内容不能为空")
	}
	if strings.TrimSpace(source) == "" {
		source = "CLI 添加"
	}
	next := o.st.Update(func(st *types.ValetSnapshot) {
		entry := types.MemoryEntry{
			ID:        fmt.Sprintf("mem-%d", time.Now().UnixNano()),
			Content:   trimmed,
			Source:    strings.TrimSpace(source),
			CreatedAt: time.Now().Format("2006-01-02"),
		}
		st.Memories = append([]types.MemoryEntry{entry}, st.Memories...)
	})
	return map[string]any{"ok": true, "mode": "offline", "memories": next.Memories}, nil
}

func (o *offlineBackend) memoryRemove(id string) (map[string]any, error) {
	next := o.st.Update(func(st *types.ValetSnapshot) {
		out := make([]types.MemoryEntry, 0, len(st.Memories))
		for _, m := range st.Memories {
			if m.ID != id {
				out = append(out, m)
			}
		}
		st.Memories = out
	})
	return map[string]any{"ok": true, "mode": "offline", "memories": next.Memories}, nil
}

func (o *offlineBackend) memoryClear() (map[string]any, error) {
	o.st.Update(func(st *types.ValetSnapshot) {
		st.Memories = []types.MemoryEntry{}
	})
	return map[string]any{"ok": true, "mode": "offline"}, nil
}

func (o *offlineBackend) inboxList() (map[string]any, error) {
	snap := o.st.Snapshot()
	return map[string]any{"ok": true, "mode": "offline", "inboxItems": snap.InboxItems}, nil
}

func (o *offlineBackend) timelineList(limit int) (map[string]any, error) {
	snap := o.st.Snapshot()
	evs := snap.TimelineEvents
	if limit > 0 && limit < len(evs) {
		evs = evs[:limit]
	}
	return map[string]any{"ok": true, "mode": "offline", "timelineEvents": evs}, nil
}

func (o *offlineBackend) skillList() (map[string]any, error) {
	builtin := skillsbundle.All()
	skills := make([]types.BuiltinSkillMeta, 0, len(builtin))
	seen := make(map[string]bool, len(builtin))
	for _, sk := range builtin {
		seen[strings.ToLower(sk.Name)] = true
		skills = append(skills, types.BuiltinSkillMeta{
			Name:        sk.Name,
			Title:       sk.Title,
			Description: sk.Description,
			Content:     sk.Content,
			Source:      "builtin",
		})
	}
	skillsDir := filepath.Join(o.dataDir, "skills")
	if entries, err := os.ReadDir(skillsDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			if seen[strings.ToLower(entry.Name())] {
				continue
			}
			if raw, rErr := os.ReadFile(filepath.Join(skillsDir, entry.Name(), "SKILL.md")); rErr == nil {
				skills = append(skills, types.BuiltinSkillMeta{
					Name:        entry.Name(),
					Title:       entry.Name(),
					Description: "用户自定义本地 Skill",
					Content:     strings.TrimSpace(string(raw)),
					Source:      "user",
				})
			}
		}
	}
	return map[string]any{"ok": true, "mode": "offline", "skills": skills}, nil
}

func redactProvidersOffline(list []types.AgentProviderConfig) []types.AgentProviderConfig {
	out := make([]types.AgentProviderConfig, len(list))
	copy(out, list)
	for i := range out {
		out[i].APIKey = ""
	}
	return out
}

func maskSecretOffline(k string) string {
	k = strings.TrimSpace(k)
	if k == "" {
		return ""
	}
	if len(k) <= 8 {
		return "••••"
	}
	return k[:4] + "••••" + k[len(k)-4:]
}

func reconcileProviderModelsOffline(st *types.ValetSnapshot, providerID string) {
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
	has := func(t string) bool {
		for _, m := range models {
			if m == t {
				return true
			}
		}
		return false
	}
	if !has(st.Preferences.Models.Primary) {
		st.Preferences.Models.Primary = models[0]
	}
	if !has(st.Preferences.Models.Fast) {
		st.Preferences.Models.Fast = models[len(models)-1]
	}
	if st.Preferences.Models.Vision != "同主模型" && !has(st.Preferences.Models.Vision) {
		st.Preferences.Models.Vision = "同主模型"
	}
}

func mergeLocalPluginOffline(list *[]types.PluginState, bundle types.PluginState) {
	for i := range *list {
		if (*list)[i].ID == bundle.ID || (*list)[i].Slug == bundle.Slug {
			if (*list)[i].Source != "local" {
				return
			}
			parsed, err := plugins.ParseManifestYAML(bundle.ManifestYAML)
			if err != nil {
				return
			}
			(*list)[i] = plugins.BuildPluginStateFromParsed(
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
			return
		}
	}
	*list = append(*list, bundle)
}
