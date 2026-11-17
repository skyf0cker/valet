package plugins

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"valet/internal/types"
)

func TestParseCoreAndShorthandManifests(t *testing.T) {
	coreDisk := `id: com.valet.disk-guard
name: 磁盘守卫
version: 1.2.0
permissions: [full_disk]
triggers:
  - id: disk.low_space
    sensor: metric_threshold
    metric: disk.used_pct
    operator: gt
    threshold: 85
    interval_sec: 30
    policy: auto
actions:
  - id: disk.scan
    tool: disk_scan
    driver: fs.scan_cleanable
    safety: readonly
  - id: disk.move_to_trash
    tool: disk_move_to_trash
    driver: fs.trash
    safety: reversible
`
	parsed, err := ParseManifestYAML(coreDisk)
	if err != nil {
		t.Fatalf("ParseManifestYAML coreDisk failed: %v", err)
	}
	if len(parsed.TriggerSpecs) != 1 || parsed.TriggerSpecs[0].Sensor != "metric_threshold" {
		t.Fatalf("unexpected trigger specs: %+v", parsed.TriggerSpecs)
	}
	if len(parsed.ActionSpecs) != 2 || parsed.ActionSpecs[1].Driver != "fs.trash" || parsed.ActionSpecs[1].ToolName != "disk_move_to_trash" {
		t.Fatalf("unexpected action specs: %+v", parsed.ActionSpecs)
	}

	shorthandDmg := `id: local.valet.dmg-cleaner
name: 下载 .dmg 清扫器
version: 0.1.0
triggers:
  - event: fs.file_created
    glob: "~/Downloads/*.dmg"
actions:
  - move_to_trash:
      retention_days: 7
`
	dmgParsed, err := ParseManifestYAML(shorthandDmg)
	if err != nil {
		t.Fatalf("ParseManifestYAML shorthand failed: %v", err)
	}
	if len(dmgParsed.TriggerSpecs) != 1 || dmgParsed.TriggerSpecs[0].Sensor != "fs_watch" || len(dmgParsed.TriggerSpecs[0].WatchDirs) == 0 || dmgParsed.TriggerSpecs[0].WatchDirs[0] != "~/Downloads" {
		t.Fatalf("expected fs_watch sensor inferred from glob, got %+v", dmgParsed.TriggerSpecs)
	}
	if len(dmgParsed.ActionSpecs) != 1 || dmgParsed.ActionSpecs[0].Driver != "fs.trash" {
		t.Fatalf("expected fs.trash driver inferred for move_to_trash, got %+v", dmgParsed.ActionSpecs)
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

	// Disabled plugin must refuse invocation
	if _, err := eng.Invoke(context.Background(), snap, "dmg-cleaner", "move_to_trash", "", map[string]any{"path": "~/Downloads/a.dmg"}); err == nil {
		t.Fatalf("expected disabled plugin invocation to be rejected")
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
