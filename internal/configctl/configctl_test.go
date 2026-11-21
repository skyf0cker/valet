package configctl_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"valet/internal/configctl"
	"valet/internal/store"
)

func TestSchemaAndGet(t *testing.T) {
	specs := configctl.Schema()
	if len(specs) == 0 {
		t.Fatal("expected non-empty config schema")
	}
	for _, spec := range specs {
		if spec.Key == "" || spec.Section == "" || spec.Type == "" || spec.Description == "" {
			t.Fatalf("incomplete KeySpec: %+v", spec)
		}
	}

	snap := store.NewSeedSnapshot("/Users/testuser")

	full, err := configctl.Get(snap.Preferences, "")
	if err != nil {
		t.Fatalf("Get full preferences failed: %v", err)
	}
	if full == nil {
		t.Fatal("expected non-nil full preferences")
	}

	secVal, err := configctl.Get(snap.Preferences, "models")
	if err != nil {
		t.Fatalf("Get models section failed: %v", err)
	}
	secMap, ok := secVal.(map[string]any)
	if !ok || secMap["models.primary"] == "" {
		t.Fatalf("expected models section map with models.primary, got %#v", secVal)
	}

	scalar, err := configctl.Get(snap.Preferences, "appearance")
	if err != nil {
		t.Fatalf("Get appearance failed: %v", err)
	}
	if scalar != snap.Preferences.Appearance {
		t.Fatalf("expected %q, got %#v", snap.Preferences.Appearance, scalar)
	}
	lightThemeVal, err := configctl.Get(snap.Preferences, "lightTheme")
	if err != nil {
		t.Fatalf("Get lightTheme failed: %v", err)
	}
	if lightThemeVal != "cursor-light" {
		t.Fatalf("expected lightTheme=\"cursor-light\", got %#v", lightThemeVal)
	}
	darkThemeVal, err := configctl.Get(snap.Preferences, "darkTheme")
	if err != nil {
		t.Fatalf("Get darkTheme failed: %v", err)
	}
	if darkThemeVal != "cursor" {
		t.Fatalf("expected darkTheme=\"cursor\", got %#v", darkThemeVal)
	}

	if _, err := configctl.Get(snap.Preferences, "nonexistent.key.xyz"); err == nil {
		t.Fatal("expected error for unknown key/section")
	}
}

func TestApplyUpdatesAndValidation(t *testing.T) {
	snap := store.NewSeedSnapshot("/Users/testuser")

	// 1. Scalar, enum, int range, float & heartbeat initialization
	changes, err := configctl.ApplyUpdates(&snap, map[string]string{
		"appearance":            "dark",
		"lightTheme":            "vercel-light",
		"darkTheme":             "vesper",
		"dailySpendLimit":       "45.5",
		"maxStepsPerTask":       "40",
		"heartbeat.intervalMin": "15",
	})
	if err != nil {
		t.Fatalf("ApplyUpdates failed: %v", err)
	}
	if len(changes) != 6 {
		t.Fatalf("expected 6 ChangeRecords, got %d", len(changes))
	}
	if snap.Preferences.Appearance != "dark" || snap.Preferences.LightTheme != "vercel-light" || snap.Preferences.DarkTheme != "vesper" ||
		snap.Preferences.DailySpendLimit != 45.5 ||
		snap.Preferences.MaxStepsPerTask != 40 || snap.Preferences.Heartbeat.IntervalMin != 15 {
		t.Fatalf("preferences not updated as expected: %+v", snap.Preferences)
	}
	if !snap.Preferences.Heartbeat.Initialized {
		t.Fatal("expected heartbeat update to mark Heartbeat.Initialized=true")
	}

	// 2. Slice updates (+, -, CSV, JSON) + disk-guard sync
	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"cleanupPolicy.protectedDirs": "+~/Secret",
	}); err != nil {
		t.Fatalf("slice append failed: %v", err)
	}
	foundSecret := false
	for _, dir := range snap.Preferences.CleanupPolicy.ProtectedDirs {
		if dir == "~/Secret" {
			foundSecret = true
		}
	}
	if !foundSecret {
		t.Fatalf("expected ~/Secret appended, got %v", snap.Preferences.CleanupPolicy.ProtectedDirs)
	}

	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"cleanupPolicy.protectedDirs": "-~/Secret",
	}); err != nil {
		t.Fatalf("slice remove failed: %v", err)
	}
	for _, dir := range snap.Preferences.CleanupPolicy.ProtectedDirs {
		if dir == "~/Secret" {
			t.Fatalf("expected ~/Secret removed, got %v", snap.Preferences.CleanupPolicy.ProtectedDirs)
		}
	}

	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"cleanupPolicy.protectedDirs": "~/Alpha,~/Beta",
	}); err != nil {
		t.Fatalf("slice CSV replace failed: %v", err)
	}
	if len(snap.Preferences.CleanupPolicy.ProtectedDirs) != 2 || snap.Preferences.CleanupPolicy.ProtectedDirs[0] != "~/Alpha" {
		t.Fatalf("unexpected CSV result: %v", snap.Preferences.CleanupPolicy.ProtectedDirs)
	}

	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"cleanupPolicy.protectedDirs":     `["~/Work","~/Docs"]`,
		"thresholds.diskLowSpacePct":      "22",
	}); err != nil {
		t.Fatalf("slice JSON replace + threshold failed: %v", err)
	}
	if len(snap.Preferences.CleanupPolicy.ProtectedDirs) != 2 || snap.Preferences.CleanupPolicy.ProtectedDirs[1] != "~/Docs" {
		t.Fatalf("unexpected JSON array result: %v", snap.Preferences.CleanupPolicy.ProtectedDirs)
	}

	var diskGuardFound bool
	for _, pl := range snap.Plugins {
		if pl.ID == "disk-guard" {
			diskGuardFound = true
			if pl.Config.LowSpaceThresholdPct == nil || *pl.Config.LowSpaceThresholdPct != 22 {
				t.Fatalf("expected disk-guard LowSpaceThresholdPct=22, got %v", pl.Config.LowSpaceThresholdPct)
			}
			if len(pl.Config.ProtectedPaths) != 2 || pl.Config.ProtectedPaths[0] != "~/Work" {
				t.Fatalf("expected disk-guard ProtectedPaths synced, got %v", pl.Config.ProtectedPaths)
			}
		}
	}
	if !diskGuardFound {
		t.Fatal("expected seeded disk-guard plugin in snapshot")
	}

	// 3. autonomyLevel cascade + explicit checklist override precedence in same batch
	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"autonomyLevel": "autonomous",
	}); err != nil {
		t.Fatalf("autonomyLevel=autonomous failed: %v", err)
	}
	cc := snap.Preferences.ConfirmChecklist
	if cc.DeleteOrOverwrite || cc.RunTerminalCommand || cc.ModifySystemSettings ||
		!cc.SendMessageOrEmail || !cc.PaymentOrSubscription {
		t.Fatalf("unexpected ConfirmChecklist for autonomous: %+v", cc)
	}

	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"autonomyLevel":                      "autonomous",
		"confirmChecklist.deleteOrOverwrite": "true",
	}); err != nil {
		t.Fatalf("autonomyLevel batch override failed: %v", err)
	}
	if !snap.Preferences.ConfirmChecklist.DeleteOrOverwrite {
		t.Fatal("expected explicit confirmChecklist.deleteOrOverwrite=true to win over autonomyLevel cascade")
	}

	// 4. Atomicity on validation failure
	beforeAppearance := snap.Preferences.Appearance
	beforeLimit := snap.Preferences.DailySpendLimit
	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"appearance":      "light",
		"dailySpendLimit": "-5",
	}); err == nil {
		t.Fatal("expected validation error for negative dailySpendLimit")
	}
	if snap.Preferences.Appearance != beforeAppearance || snap.Preferences.DailySpendLimit != beforeLimit {
		t.Fatalf("expected failed ApplyUpdates batch to be atomic; appearance=%q limit=%v",
			snap.Preferences.Appearance, snap.Preferences.DailySpendLimit)
	}
	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"appearance":  "light",
		"unknown.key": "123",
	}); err == nil {
		t.Fatal("expected error for unknown key")
	}
	if snap.Preferences.Appearance != beforeAppearance {
		t.Fatal("expected failed ApplyUpdates batch with unknown key not to mutate Appearance")
	}
	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"lightTheme": "unknown-light",
	}); err == nil {
		t.Fatal("expected validation error for unsupported lightTheme")
	}
	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"darkTheme": "neon",
	}); err == nil {
		t.Fatal("expected validation error for unsupported darkTheme")
	}
	if _, err := configctl.ApplyUpdates(&snap, map[string]string{
		"darkTheme": "obsidian",
	}); err == nil {
		t.Fatal("expected validation error for removed legacy darkTheme")
	}
}

func TestControlFileResolution(t *testing.T) {
	tmpA := t.TempDir()
	tmpB := t.TempDir()

	if got := configctl.ResolveDefaultDataDir(tmpA); got != tmpA {
		t.Fatalf("expected ResolveDefaultDataDir(%q) == %q, got %q", tmpA, tmpA, got)
	}

	infoA := configctl.ControlInfo{
		PID:       111,
		BaseURL:   "http://127.0.0.1:10001",
		Token:     "token-a",
		DataDir:   tmpA,
		StartedAt: "2026-11-17T00:00:00Z",
	}
	rawA, _ := json.Marshal(infoA)
	if err := os.WriteFile(filepath.Join(tmpA, configctl.ControlFileName), rawA, 0o600); err != nil {
		t.Fatal(err)
	}

	ctrlBPath := filepath.Join(tmpB, configctl.ControlFileName)
	infoB := configctl.ControlInfo{
		PID:       222,
		BaseURL:   "http://127.0.0.1:20002",
		Token:     "token-b",
		DataDir:   tmpB,
		StartedAt: "2026-11-17T00:00:00Z",
	}
	rawB, _ := json.Marshal(infoB)
	if err := os.WriteFile(ctrlBPath, rawB, 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("VALET_CONTROL_FILE", ctrlBPath)

	// Explicit dataDir must ignore VALET_CONTROL_FILE and read <tmpA>/control.json.
	readA, err := configctl.ReadControlInfo(tmpA)
	if err != nil {
		t.Fatalf("ReadControlInfo(%q) failed: %v", tmpA, err)
	}
	if readA.Token != "token-a" || readA.PID != 111 {
		t.Fatalf("expected token-a/111 when explicit dataDir is passed, got %+v", readA)
	}

	// Empty dataDir falls back to VALET_CONTROL_FILE.
	readEnv, err := configctl.ReadControlInfo("")
	if err != nil {
		t.Fatalf("ReadControlInfo(\"\") failed: %v", err)
	}
	if readEnv.Token != "token-b" || readEnv.PID != 222 {
		t.Fatalf("expected VALET_CONTROL_FILE token-b/222, got %+v", readEnv)
	}
}
