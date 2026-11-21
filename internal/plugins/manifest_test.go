package plugins

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"valet/internal/types"
	pluginsbundle "valet/plugins"
)

func TestParseCoreAndShorthandManifests(t *testing.T) {
	coreDisk := `id: com.valet.disk-guard
name: 磁盘守卫
version: 1.2.0
permissions: [full_disk]
triggers:
  - id: disk.low_space
    sensor: script_poll
    script: scripts/poll-disk.mjs
    interval_config_key: sampleIntervalSec
    interval_sec: 30
    emit_on: json
    policy: auto
config_schema:
  - key: lowSpaceThresholdPct
    label: 低空间告警阈值（可用百分比）
    type: slider
    min: 5
    max: 40
    default: 15
`
	parsed, err := ParseManifestYAML(coreDisk)
	if err != nil {
		t.Fatalf("ParseManifestYAML coreDisk failed: %v", err)
	}
	if len(parsed.TriggerSpecs) != 1 || parsed.TriggerSpecs[0].Sensor != "script_poll" || parsed.TriggerSpecs[0].Script != "scripts/poll-disk.mjs" {
		t.Fatalf("unexpected trigger specs: %+v", parsed.TriggerSpecs)
	}
	if len(parsed.ActionSpecs) != 0 {
		t.Fatalf("expected Action-less manifest with 0 ActionSpecs, got %+v", parsed.ActionSpecs)
	}
	if len(parsed.ConfigSchema) != 1 || parsed.ConfigSchema[0].Key != "lowSpaceThresholdPct" {
		t.Fatalf("unexpected ConfigSchema: %+v", parsed.ConfigSchema)
	}

	shorthandDmg := `id: local.valet.dmg-cleaner
name: 下载 .dmg 清扫器
version: 0.1.0
triggers:
  - event: fs.file_created
    glob: "~/Downloads/*.dmg"
`
	dmgParsed, err := ParseManifestYAML(shorthandDmg)
	if err != nil {
		t.Fatalf("ParseManifestYAML shorthand failed: %v", err)
	}
	if len(dmgParsed.TriggerSpecs) != 1 || dmgParsed.TriggerSpecs[0].Sensor != "fs_watch" || len(dmgParsed.TriggerSpecs[0].WatchDirs) == 0 || dmgParsed.TriggerSpecs[0].WatchDirs[0] != "~/Downloads" {
		t.Fatalf("expected fs_watch sensor inferred from glob, got %+v", dmgParsed.TriggerSpecs)
	}
	if len(dmgParsed.ActionSpecs) != 0 {
		t.Fatalf("expected 0 action specs, got %+v", dmgParsed.ActionSpecs)
	}
}

func TestEngineDisabledPluginBlockedAndFsSensorTriggers(t *testing.T) {
	tmpDir := t.TempDir()
	downloads := filepath.Join(tmpDir, "Downloads")
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		t.Fatal(err)
	}

	triggered := make(chan TriggerDispatch, 4)
	eng := NewEngine(EngineConfig{
		HomeDir:  tmpDir,
		DataDir:  filepath.Join(tmpDir, "data"),
		WatchDir: PollingWatchDir(80 * time.Millisecond),
		OnTrigger: func(d TriggerDispatch) {
			triggered <- d
		},
	})
	defer eng.Close()

	dmgPlugin := types.PluginState{
		ID:        "dmg-cleaner",
		Slug:      "dmg-cleaner",
		Name:      "DMG 清扫器",
		Version:   "0.1.0",
		Source:    "local",
		Installed: true,
		Enabled:   false,
		ManifestYAML: `id: local.valet.dmg-cleaner
name: DMG 清扫器
triggers:
  - event: fs.file_created
    glob: "~/Downloads/*.dmg"
actions:
  - move_to_trash:
      retention_days: 7
`,
	}

	snap := types.ValetSnapshot{
		Plugins: []types.PluginState{dmgPlugin},
		Preferences: types.ValetPreferences{
			CleanupPolicy: types.CleanupPolicySettings{
				ProtectedDirs: []string{"~/Documents", "~/Projects"},
			},
			Thresholds: types.MonitoringThresholds{
				EventThrottle10m: true,
			},
		},
	}

	// Disabled plugin must not register live fs_watch sensors
	eng.Sync(snap)
	eng.mu.Lock()
	disabledWatches := len(eng.fsWatches)
	eng.mu.Unlock()
	if disabledWatches != 0 {
		t.Fatalf("expected 0 active fs_watch sensors while plugin disabled, got %d", disabledWatches)
	}

	// Enable plugin and sync -> sensor should start watching Downloads
	snap.Plugins[0].Enabled = true
	eng.Sync(snap)
	time.Sleep(150 * time.Millisecond)

	dmgFile := filepath.Join(downloads, "Installer.dmg")
	if err := os.WriteFile(dmgFile, []byte("dmg-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	select {
	case ev := <-triggered:
		if ev.PluginID != "dmg-cleaner" || ev.EventCode != "fs.file_created" {
			t.Fatalf("unexpected trigger event: %+v", ev)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for fs_watch plugin trigger on new .dmg file")
	}
}

func TestParseExtendedSensorsAndSkillBlock(t *testing.T) {
	rawYAML := `id: local.valet.dev-sentinel
name: 开发哨兵
version: 0.2.0
permissions: [full_disk]
skill: |
  # Dev Sentinel Skill
  - 当收到 deploy.failed Webhook 时，读取构建日志并总结失败原因。
  - 若命令探针检测到版本变更，记录摘要。
triggers:
  - id: cmd.probe
    sensor: command_poll
    command: "echo ok"
    interval_sec: 10
    emit_on: change
    policy: auto
  - id: api.health
    sensor: http_poll
    url: "http://127.0.0.1:9999/healthz"
    interval_sec: 15
    emit_on: non_empty
  - id: deploy.failed
    sensor: webhook
    policy: ask
  - id: daily.digest
    sensor: cron
    schedule: "*/5 * * * *"
actions:
  - id: probe.exec
    driver: shell.exec
    command: "echo probe"
    safety: readonly
  - id: log.tail
    driver: fs.read_text
    path: "~/Library/Logs/build.log"
    safety: readonly
`
	parsed, err := ParseManifestYAML(rawYAML)
	if err != nil {
		t.Fatalf("ParseManifestYAML failed: %v", err)
	}
	if !strings.Contains(parsed.Skill, "# Dev Sentinel Skill") || !strings.Contains(parsed.Skill, "deploy.failed Webhook") {
		t.Fatalf("expected skill block scalar to be preserved, got %q", parsed.Skill)
	}
	if len(parsed.TriggerSpecs) != 4 {
		t.Fatalf("expected 4 trigger specs, got %d (%+v)", len(parsed.TriggerSpecs), parsed.TriggerSpecs)
	}
	if parsed.TriggerSpecs[0].Sensor != "command_poll" || parsed.TriggerSpecs[0].Command != "echo ok" {
		t.Fatalf("unexpected command_poll spec: %+v", parsed.TriggerSpecs[0])
	}
	if parsed.TriggerSpecs[1].Sensor != "http_poll" || parsed.TriggerSpecs[1].URL != "http://127.0.0.1:9999/healthz" {
		t.Fatalf("unexpected http_poll spec: %+v", parsed.TriggerSpecs[1])
	}
	if parsed.TriggerSpecs[2].Sensor != "webhook" {
		t.Fatalf("unexpected webhook spec: %+v", parsed.TriggerSpecs[2])
	}
	if parsed.TriggerSpecs[3].Sensor != "cron" || parsed.TriggerSpecs[3].Schedule != "*/5 * * * *" {
		t.Fatalf("unexpected cron spec: %+v", parsed.TriggerSpecs[3])
	}
	if len(parsed.ActionSpecs) != 2 || parsed.ActionSpecs[0].Driver != "shell.exec" || parsed.ActionSpecs[1].Driver != "fs.read_text" {
		t.Fatalf("unexpected action drivers: %+v", parsed.ActionSpecs)
	}
	cmdSummary := DescribeTriggerSource(parsed.TriggerSpecs[0])
	hookSummary := DescribeTriggerSource(parsed.TriggerSpecs[2])
	if !strings.Contains(cmdSummary, "command_poll") || !strings.Contains(hookSummary, "webhook") {
		t.Fatalf("unexpected trigger source summary: cmd=%q hook=%q", cmdSummary, hookSummary)
	}
}

func TestEngineCommandPollTriggersOnOutputChange(t *testing.T) {
	tmpDir := t.TempDir()
	probeFile := filepath.Join(tmpDir, "probe.txt")
	if err := os.WriteFile(probeFile, []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	triggered := make(chan TriggerDispatch, 4)
	eng := NewEngine(EngineConfig{
		HomeDir: tmpDir,
		DataDir: filepath.Join(tmpDir, "data"),
		OnTrigger: func(d TriggerDispatch) {
			triggered <- d
		},
	})
	defer eng.Close()

	plugin := types.PluginState{
		ID:        "probe-watch",
		Slug:      "probe-watch",
		Name:      "探针监视器",
		Version:   "0.1.0",
		Source:    "local",
		Installed: true,
		Enabled:   true,
		ManifestYAML: "id: local.valet.probe-watch\nname: 探针监视器\nversion: 0.1.0\ntriggers:\n  - id: probe.changed\n    sensor: command_poll\n    command: \"cat " + probeFile + "\"\n    interval_sec: 1\n    emit_on: change\n    policy: auto\n",
	}

	eng.Sync(types.ValetSnapshot{Plugins: []types.PluginState{plugin}})
	time.Sleep(250 * time.Millisecond)

	if err := os.WriteFile(probeFile, []byte("v2\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	select {
	case ev := <-triggered:
		if ev.PluginID != "probe-watch" || ev.EventCode != "probe.changed" {
			t.Fatalf("unexpected command_poll dispatch: %+v", ev)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for command_poll output change trigger")
	}
}

func TestCatalogBundlesActionLessAndScriptPollSensor(t *testing.T) {
	catalog, err := LoadCatalogFromFS(pluginsbundle.CatalogFS)
	if err != nil {
		t.Fatalf("LoadCatalogFromFS failed: %v", err)
	}
	if len(catalog) < 9 {
		t.Fatalf("expected >= 9 embedded catalog bundles, got %d", len(catalog))
	}
	var surgePlug *types.PluginState
	for i := range catalog {
		p := catalog[i]
		if len(p.Actions) != 0 {
			t.Fatalf("expected plugin %s to have 0 static actions, got %+v", p.ID, p.Actions)
		}
		if p.ID == "surge-doctor" {
			cp := p
			surgePlug = &cp
		}
	}
	if surgePlug == nil {
		t.Fatalf("expected surge-doctor in embedded catalog")
	}

	parsed, err := ParseManifestYAML(surgePlug.ManifestYAML)
	if err != nil {
		t.Fatalf("ParseManifestYAML(surge-doctor) failed: %v", err)
	}
	if len(parsed.TriggerSpecs) != 2 {
		t.Fatalf("expected 2 trigger specs, got %d (%+v)", len(parsed.TriggerSpecs), parsed.TriggerSpecs)
	}
	if parsed.TriggerSpecs[0].ID != "surge.error_detected" ||
		parsed.TriggerSpecs[0].Sensor != "script_poll" ||
		parsed.TriggerSpecs[0].Script != "scripts/poll-errors.mjs" {
		t.Fatalf("unexpected primary surge trigger: %+v", parsed.TriggerSpecs[0])
	}
	if parsed.TriggerSpecs[1].ID != "surge.webhook_alert" || parsed.TriggerSpecs[1].Sensor != "webhook" {
		t.Fatalf("unexpected webhook surge trigger: %+v", parsed.TriggerSpecs[1])
	}
	if len(parsed.ConfigSchema) < 2 {
		t.Fatalf("expected ConfigSchema fields on surge-doctor, got %+v", parsed.ConfigSchema)
	}

	tmpDir := t.TempDir()
	dataDir := filepath.Join(tmpDir, "data")
	logDir := filepath.Join(tmpDir, "Library", "Logs", "Surge")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatal(err)
	}

	matDir, matFiles, err := MaterializeCatalogPlugin(pluginsbundle.CatalogFS, "surge-doctor", filepath.Join(dataDir, "plugins"))
	if err != nil {
		t.Fatalf("MaterializeCatalogPlugin(surge-doctor) failed: %v", err)
	}
	if len(matFiles) < 4 {
		t.Fatalf("expected materialized files including scripts, got %+v", matFiles)
	}

	triggered := make(chan TriggerDispatch, 4)
	eng := NewEngine(EngineConfig{
		HomeDir: tmpDir,
		DataDir: dataDir,
		OnTrigger: func(d TriggerDispatch) {
			triggered <- d
		},
	})
	defer eng.Close()

	fastManifest := strings.Replace(surgePlug.ManifestYAML, "interval_sec: 30", "interval_sec: 1", 1)
	plugin := *surgePlug
	plugin.Installed = true
	plugin.Enabled = true
	plugin.LocalDir = matDir
	plugin.ManifestYAML = fastManifest
	plugin.Config.Values = map[string]any{"pollIntervalSec": 1, "windowMinutes": 60}

	eng.Sync(types.ValetSnapshot{Plugins: []types.PluginState{plugin}})
	time.Sleep(150 * time.Millisecond)

	nowTS := time.Now().Format("2006-01-02 15:04:05.123456")
	line := nowTS + " <WARNING> [SGMProfileManager] Update config failed, URL: https://sub.example.com?token=liveSecret123, error: 第 12 行存在无效配置\n"
	if err := os.WriteFile(filepath.Join(logDir, "Surge-live.log"), []byte(line), 0o644); err != nil {
		t.Fatal(err)
	}

	select {
	case ev := <-triggered:
		if ev.PluginID != "surge-doctor" || ev.EventCode != "surge.error_detected" {
			t.Fatalf("unexpected surge trigger event: %+v", ev)
		}
		raw, err := json.Marshal(ev.Payload)
		if err != nil {
			t.Fatal(err)
		}
		body := string(raw)
		if !strings.Contains(body, "***REDACTED***") {
			t.Fatalf("expected redacted token marker in payload, got %s", body)
		}
		if strings.Contains(body, "liveSecret123") {
			t.Fatalf("expected liveSecret123 to be stripped from payload, got %s", body)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for script_poll surge.error_detected sensor trigger")
	}
}

func TestWorkflowExecutionModeAndBundleRoundTrip(t *testing.T) {
	manifest := `id: local.valet.wf-sample
name: Workflow 示例
version: 1.0.0
execution_mode: workflow
triggers:
  - id: manual.run
    sensor: manual
    policy: auto
`
	parsed, err := ParseManifestYAML(manifest)
	if err != nil {
		t.Fatalf("ParseManifestYAML workflow failed: %v", err)
	}
	if parsed.ExecutionMode != "workflow" {
		t.Fatalf("expected ExecutionMode=workflow, got %q", parsed.ExecutionMode)
	}

	toggledSkill := SetManifestExecutionMode(manifest, "skill")
	pSkill, err := ParseManifestYAML(toggledSkill)
	if err != nil || pSkill.ExecutionMode != "skill" {
		t.Fatalf("expected skill mode after SetManifestExecutionMode, got %q (err=%v)", pSkill.ExecutionMode, err)
	}

	tmpDir := t.TempDir()
	wfYAML := DefaultStarterWorkflowYAML("wf-sample", "manual.run")
	pluginDir, parsedWritten, err := WritePluginBundle(tmpDir, types.UpsertLocalPluginParams{
		ID:            "wf-sample",
		Slug:          "wf-sample",
		Name:          "Workflow 示例",
		ManifestYAML:  toggledSkill,
		ExecutionMode: "workflow",
		WorkflowYAML:  wfYAML,
	})
	if err != nil {
		t.Fatalf("WritePluginBundle failed: %v", err)
	}
	if parsedWritten.ExecutionMode != "workflow" || parsedWritten.WorkflowYAML == "" {
		t.Fatalf("expected workflow mode and workflowYaml, got mode=%q len=%d", parsedWritten.ExecutionMode, len(parsedWritten.WorkflowYAML))
	}

	_, _, readParsed, files, err := ReadPluginBundle(pluginDir)
	if err != nil {
		t.Fatalf("ReadPluginBundle failed: %v", err)
	}
	if readParsed.ExecutionMode != "workflow" || !strings.Contains(readParsed.WorkflowYAML, "type: trigger") {
		t.Fatalf("unexpected ReadPluginBundle workflow fields: %+v", readParsed)
	}
	hasWorkflowFile := false
	for _, f := range files {
		if f == "workflow.yaml" {
			hasWorkflowFile = true
		}
	}
	if !hasWorkflowFile {
		t.Fatalf("expected workflow.yaml in files list, got %+v", files)
	}
}

func TestEngineGateProtectedFoldersRespectsPermissionsAndOptIn(t *testing.T) {
	tmpDir := t.TempDir()
	downloads := filepath.Join(tmpDir, "Downloads")
	logsDir := filepath.Join(tmpDir, "Library", "Logs", "DiagnosticReports")
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	eng := NewEngine(EngineConfig{
		HomeDir:              tmpDir,
		DataDir:              filepath.Join(tmpDir, "data"),
		WatchDir:             PollingWatchDir(50 * time.Millisecond),
		GateProtectedFolders: true,
	})
	defer eng.Close()

	snap := types.ValetSnapshot{
		Permissions: []types.PermissionItem{
			{ID: "full_disk", Granted: false},
		},
		Plugins: []types.PluginState{
			{
				ID:        "disk-guard",
				Slug:      "disk-guard",
				Version:   "1.2.0",
				Installed: true,
				Enabled:   true,
				Config: types.PluginConfig{
					Values: map[string]any{"watchDownloads": false},
				},
				ManifestYAML: `id: disk-guard
name: 磁盘守卫
triggers:
  - id: disk.large_file
    sensor: fs_watch
    watch_dirs: [~/Downloads]
    ops: [create]
    glob: "*.dmg"
    policy: ask
`,
			},
			{
				ID:        "log-detective",
				Slug:      "log-detective",
				Version:   "1.0.0",
				Installed: true,
				Enabled:   true,
				ManifestYAML: `id: log-detective
name: 日志侦探
triggers:
  - id: log.crash
    sensor: fs_watch
    watch_dirs: [~/Library/Logs/DiagnosticReports]
    ops: [create]
    glob: "*.ips"
    policy: auto
`,
			},
		},
	}

	eng.Sync(snap)
	eng.mu.Lock()
	_, hasDownloads := eng.fsWatches["disk-guard::"+downloads]
	_, hasLogs := eng.fsWatches["log-detective::"+logsDir]
	eng.mu.Unlock()
	if hasDownloads {
		t.Fatalf("expected ~/Downloads watcher skipped when GateProtectedFolders=true, full_disk=false, and watchDownloads=false")
	}
	if !hasLogs {
		t.Fatalf("expected non-TCC ~/Library/Logs/DiagnosticReports watcher active even when full_disk=false")
	}

	// Explicit opt-in via watchDownloads=true should start watching ~/Downloads
	snap.Plugins[0].Config.Values["watchDownloads"] = true
	eng.Sync(snap)
	eng.mu.Lock()
	_, hasDownloadsOptIn := eng.fsWatches["disk-guard::"+downloads]
	eng.mu.Unlock()
	if !hasDownloadsOptIn {
		t.Fatalf("expected ~/Downloads watcher active when watchDownloads=true")
	}

	// Reset watchDownloads=false and grant full_disk -> watcher should remain active
	snap.Plugins[0].Config.Values["watchDownloads"] = false
	snap.Permissions[0].Granted = true
	eng.Sync(snap)
	eng.mu.Lock()
	_, hasDownloadsFDA := eng.fsWatches["disk-guard::"+downloads]
	eng.mu.Unlock()
	if !hasDownloadsFDA {
		t.Fatalf("expected ~/Downloads watcher active when full_disk=true")
	}
}

