package plugins

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"valet/internal/sys"
	"valet/internal/types"
)

// FsWatchEvent represents a normalized filesystem change delivered by a watcher backend.
type FsWatchEvent struct {
	Op      string // "create" | "write" | "remove" | "rename"
	Path    string // absolute or relative path inside watched dir
	IsDir   bool
}

// WatchDirFunc abstracts filesystem watching (`mygo.WatchFiles` on desktop, directory diff polling in headless tests).
type WatchDirFunc func(ctx context.Context, dir string) (<-chan FsWatchEvent, func() error, error)

// TriggerDispatch describes a live event produced by a plugin sensor or scheduled automation rule.
type TriggerDispatch struct {
	Kind           string // "plugin" | "automation"
	PluginID       string
	EventCode      string
	AutomationID   string
	Title          string
	Prompt         string
	Payload        map[string]any
}

// EngineConfig configures Valet's generic declarative plugin engine & sensor runtime.
type EngineConfig struct {
	HomeDir    string
	DataDir    string
	WatchDir   WatchDirFunc
	TrashMover sys.TrashMover
	OnTrigger  func(TriggerDispatch)
}

// Engine executes declarative plugin capability drivers and manages live per-plugin sensors.
type Engine struct {
	cfg      EngineConfig
	drivers  *DriverRegistry
	throttle *ThrottleTracker

	mu             sync.Mutex
	closed         bool
	fsWatches      map[string]*activeSensor
	metricWorkers  map[string]*activeSensor
	cronStop       context.CancelFunc
	lastCronFired  map[string]string
	lastMetricsSig string
	lastCronSig    string
	automations    []types.AutomationRule
	preferences    types.ValetPreferences
	isPaused       bool
}

type activeSensor struct {
	sig    string
	cancel context.CancelFunc
}

// NewEngine creates a plugin runtime engine backed by Capability Drivers and Event Throttling.
func NewEngine(cfg EngineConfig) *Engine {
	if cfg.WatchDir == nil {
		cfg.WatchDir = PollingWatchDir(1200 * time.Millisecond)
	}
	return &Engine{
		cfg:           cfg,
		drivers:       NewDriverRegistry(),
		throttle:      NewThrottleTracker(),
		fsWatches:     make(map[string]*activeSensor),
		metricWorkers: make(map[string]*activeSensor),
		lastCronFired: make(map[string]string),
	}
}

// Drivers returns the underlying capability driver registry for inspection or registration.
func (e *Engine) Drivers() *DriverRegistry {
	return e.drivers
}

// Throttle returns the plugin event rate-limiter/deduplicator.
func (e *Engine) Throttle() *ThrottleTracker {
	return e.throttle
}

// PollingWatchDir provides a lightweight portable directory watcher for headless test environments.
func PollingWatchDir(interval time.Duration) WatchDirFunc {
	if interval <= 0 {
		interval = time.Second
	}
	return func(ctx context.Context, dir string) (<-chan FsWatchEvent, func() error, error) {
		ch := make(chan FsWatchEvent, 32)
		snapshotDir := func() map[string]bool {
			out := map[string]bool{}
			entries, err := os.ReadDir(dir)
			if err != nil {
				return out
			}
			for _, e := range entries {
				out[e.Name()] = e.IsDir()
			}
			return out
		}
		prev := snapshotDir()

		cctx, cancel := context.WithCancel(ctx)
		go func() {
			defer close(ch)
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-cctx.Done():
					return
				case <-ticker.C:
					curr := snapshotDir()
					for name, isDir := range curr {
						if _, existed := prev[name]; !existed {
							select {
							case ch <- FsWatchEvent{Op: "create", Path: filepath.Join(dir, name), IsDir: isDir}:
							case <-cctx.Done():
								return
							}
						}
					}
					for name, isDir := range prev {
						if _, stillThere := curr[name]; !stillThere {
							select {
							case ch <- FsWatchEvent{Op: "remove", Path: filepath.Join(dir, name), IsDir: isDir}:
							case <-cctx.Done():
								return
							}
						}
					}
					prev = curr
				}
			}
		}()
		return ch, func() error { cancel(); return nil }, nil
	}
}

// Close shuts down all running plugin sensor goroutines.
func (e *Engine) Close() {
	e.mu.Lock()
	e.closed = true
	for k, w := range e.fsWatches {
		w.cancel()
		delete(e.fsWatches, k)
	}
	for k, m := range e.metricWorkers {
		m.cancel()
		delete(e.metricWorkers, k)
	}
	if e.cronStop != nil {
		e.cronStop()
		e.cronStop = nil
	}
	e.mu.Unlock()
}

// Invoke enforces plugin enabled status, merges global + plugin-scoped protected paths,
// resolves the manifest ActionSpec + driver, and executes the capability on the host.
func (e *Engine) Invoke(
	ctx context.Context,
	snap types.ValetSnapshot,
	pluginID, actionID, driverOverride string,
	args map[string]any,
) (InvokeResult, error) {
	var plugin *types.PluginState
	for i := range snap.Plugins {
		if snap.Plugins[i].ID == pluginID {
			cp := snap.Plugins[i]
			plugin = &cp
			break
		}
	}
	if plugin == nil {
		return InvokeResult{}, fmt.Errorf("未找到插件: %s", pluginID)
	}
	if !plugin.Installed || !plugin.Enabled {
		return InvokeResult{}, fmt.Errorf("插件「%s」当前已停用，已拒绝执行 %s", plugin.Name, actionID)
	}

	parsed, err := ParseManifestYAML(plugin.ManifestYAML)
	var spec ActionSpec
	if err == nil {
		for _, a := range parsed.ActionSpecs {
			if a.ID == actionID || a.ToolName == actionID {
				spec = a
				break
			}
		}
	}
	if spec.ID == "" {
		spec = ActionSpec{ID: actionID, Driver: driverOverride}
		finalizeActionSpec(&spec, plugin.ID)
	} else if driverOverride != "" {
		spec.Driver = driverOverride
	}

	protected := make([]string, 0, len(snap.Preferences.CleanupPolicy.ProtectedDirs)+len(plugin.Config.ProtectedPaths))
	protected = append(protected, snap.Preferences.CleanupPolicy.ProtectedDirs...)
	protected = append(protected, plugin.Config.ProtectedPaths...)

	return e.drivers.Execute(ctx, spec.Driver, InvokeContext{
		HomeDir:       e.cfg.HomeDir,
		DataDir:       e.cfg.DataDir,
		ProtectedDirs: protected,
		BlockedApps:   snap.Preferences.BlockedApps,
		TrashMover:    e.cfg.TrashMover,
		Plugin:        *plugin,
	}, spec, args)
}

// Sync reconciles active plugin sensors and cron automations with the latest ValetSnapshot.
func (e *Engine) Sync(snap types.ValetSnapshot) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return
	}

	e.automations = append([]types.AutomationRule(nil), snap.Automations...)
	e.preferences = snap.Preferences
	e.isPaused = snap.IsPaused

	if snap.IsPaused {
		for k, w := range e.fsWatches {
			w.cancel()
			delete(e.fsWatches, k)
		}
		for k, m := range e.metricWorkers {
			m.cancel()
			delete(e.metricWorkers, k)
		}
		if e.cronStop != nil {
			e.cronStop()
			e.cronStop = nil
			e.lastCronSig = ""
		}
		return
	}

	desiredFS := map[string]struct {
		pluginID string
		triggers []TriggerSpec
		sig      string
	}{}
	desiredMetric := map[string]struct {
		plugin  types.PluginState
		trigger TriggerSpec
		sig     string
	}{}
	cronPluginTriggers := []struct {
		pluginID string
		trigger  TriggerSpec
	}{}

	for _, p := range snap.Plugins {
		if !p.Installed || !p.Enabled {
			continue
		}
		parsed, err := ParseManifestYAML(p.ManifestYAML)
		if err != nil {
			continue
		}
		for _, trig := range parsed.TriggerSpecs {
			switch trig.Sensor {
			case "fs_watch":
				for _, rawDir := range trig.WatchDirs {
					dir := sys.ExpandHome(rawDir, e.cfg.HomeDir)
					if dir == "" {
						continue
					}
					key := p.ID + "::" + dir
					cur := desiredFS[key]
					cur.pluginID = p.ID
					cur.triggers = append(cur.triggers, trig)
					cur.sig = p.Version + "|" + p.ManifestYAML
					desiredFS[key] = cur
				}
			case "metric_threshold":
				key := p.ID + "::" + trig.ID
				sig := fmt.Sprintf("%s|%v|%s|%v", p.ManifestYAML, snap.Preferences.Thresholds, snap.Preferences.PluginRuntime.QuietHours, p.Config.LowSpaceThresholdPct)
				desiredMetric[key] = struct {
					plugin  types.PluginState
					trigger TriggerSpec
					sig     string
				}{plugin: p, trigger: trig, sig: sig}
			case "cron":
				cronPluginTriggers = append(cronPluginTriggers, struct {
					pluginID string
					trigger  TriggerSpec
				}{pluginID: p.ID, trigger: trig})
			}
		}
	}

	// Reconcile fs_watch sensors
	for key, running := range e.fsWatches {
		des, ok := desiredFS[key]
		if !ok || running.sig != des.sig {
			running.cancel()
			delete(e.fsWatches, key)
		}
	}
	for key, des := range desiredFS {
		if _, exists := e.fsWatches[key]; exists {
			continue
		}
		_, dir, _ := strings.Cut(key, "::")
		cctx, cancel := context.WithCancel(context.Background())
		e.fsWatches[key] = &activeSensor{sig: des.sig, cancel: cancel}
		go e.runFsSensor(cctx, des.pluginID, dir, des.triggers)
	}

	// Reconcile metric_threshold sensors
	for key, running := range e.metricWorkers {
		des, ok := desiredMetric[key]
		if !ok || running.sig != des.sig {
			running.cancel()
			delete(e.metricWorkers, key)
		}
	}
	for key, des := range desiredMetric {
		if _, exists := e.metricWorkers[key]; exists {
			continue
		}
		cctx, cancel := context.WithCancel(context.Background())
		e.metricWorkers[key] = &activeSensor{sig: des.sig, cancel: cancel}
		go e.runMetricSensor(cctx, des.plugin, des.trigger, snap.Preferences)
	}

	// Reconcile cron scheduler (plugin cron triggers + enabled AutomationRules)
	hasEnabledAutomation := false
	for _, a := range snap.Automations {
		if a.Enabled && a.TriggerType == "cron" {
			hasEnabledAutomation = true
			break
		}
	}
	needCron := hasEnabledAutomation || len(cronPluginTriggers) > 0
	if !needCron && e.cronStop != nil {
		e.cronStop()
		e.cronStop = nil
	} else if needCron && e.cronStop == nil {
		cctx, cancel := context.WithCancel(context.Background())
		e.cronStop = cancel
		go e.runCronLoop(cctx)
	}
}

func (e *Engine) runFsSensor(ctx context.Context, pluginID, dir string, triggers []TriggerSpec) {
	ch, stopWatch, err := e.cfg.WatchDir(ctx, dir)
	if err != nil {
		return
	}
	defer func() { _ = stopWatch() }()

	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			for _, trig := range triggers {
				if !matchFsTrigger(ev, trig) {
					continue
				}
				e.dispatch(TriggerDispatch{
					Kind:      "plugin",
					PluginID:  pluginID,
					EventCode: trig.ID,
					Payload: map[string]any{
						"path":   ev.Path,
						"op":     ev.Op,
						"sensor": "fs_watch",
					},
				})
			}
		}
	}
}

func matchFsTrigger(ev FsWatchEvent, trig TriggerSpec) bool {
	opMatch := len(trig.Ops) == 0
	for _, op := range trig.Ops {
		if op == ev.Op {
			opMatch = true
			break
		}
	}
	if !opMatch {
		return false
	}
	if trig.Glob != "" {
		pat := filepath.Base(trig.Glob)
		name := filepath.Base(ev.Path)
		if matched, err := filepath.Match(pat, name); err == nil {
			return matched
		}
	}
	return true
}

func (e *Engine) runMetricSensor(ctx context.Context, plugin types.PluginState, trig TriggerSpec, prefs types.ValetPreferences) {
	interval := trig.IntervalSec
	if plugin.Config.SampleIntervalSec != nil && *plugin.Config.SampleIntervalSec > 0 {
		interval = *plugin.Config.SampleIntervalSec
	}
	if interval < 15 {
		interval = 15
	}
	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()

	var consecutive int
	lastDiagMtime := newestCrashMtime(e.cfg.HomeDir)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if inQuietHours(prefs.PluginRuntime.QuietHours, time.Now()) {
				continue
			}

			switch trig.Metric {
			case "disk.used_pct":
				m := sys.SampleDiskMetrics(e.cfg.HomeDir)
				freeThreshold := prefs.Thresholds.DiskLowSpacePct
				if plugin.Config.LowSpaceThresholdPct != nil {
					freeThreshold = *plugin.Config.LowSpaceThresholdPct
				}
				if freeThreshold <= 0 && trig.Threshold > 0 {
					freeThreshold = int(100 - trig.Threshold)
				}
				freePct := 100 - m.DiskPct
				if freeThreshold > 0 && freePct < freeThreshold {
					e.dispatch(TriggerDispatch{
						Kind:      "plugin",
						PluginID:  plugin.ID,
						EventCode: trig.ID,
						Payload: map[string]any{
							"diskPct":    m.DiskPct,
							"diskFreeGB": m.DiskFreeGB,
							"threshold":  freeThreshold,
							"sensor":     "metric_threshold",
						},
					})
				}

			case "proc.max_cpu":
				cpuThresh := parsePercent(prefs.Thresholds.CPUSpikePct, 200)
				if trig.Threshold > 0 {
					cpuThresh = int(trig.Threshold)
				}
				procs := sys.SampleProcesses(ctx, 5)
				hit := false
				var offender types.ProcessSampleRow
				for _, row := range procs.Rows {
					lower := strings.ToLower(row.Name)
					if lower == "valet" || lower == "valet-bun" {
						continue
					}
					ignored := false
					for _, ig := range prefs.Thresholds.IgnoredProcesses {
						if strings.Contains(lower, strings.ToLower(ig)) {
							ignored = true
							break
						}
					}
					if !ignored && row.CPUPct >= cpuThresh {
						hit = true
						offender = row
						break
					}
				}
				if hit {
					consecutive++
					needed := 2
					if trig.SustainedSec > 0 && interval > 0 {
						needed = maxInt(1, trig.SustainedSec/interval)
					}
					if consecutive >= needed {
						consecutive = 0
						e.dispatch(TriggerDispatch{
							Kind:      "plugin",
							PluginID:  plugin.ID,
							EventCode: trig.ID,
							Payload: map[string]any{
								"pid":    offender.PID,
								"name":   offender.Name,
								"cpuPct": offender.CPUPct,
								"sensor": "metric_threshold",
							},
						})
					}
				} else {
					consecutive = 0
				}

			case "logs.crash_count":
				newest := newestCrashMtime(e.cfg.HomeDir)
				if newest.After(lastDiagMtime) {
					lastDiagMtime = newest
					summary := sys.SummarizeDiagnosticLogs(e.cfg.HomeDir, 30)
					if summary.Count > 0 {
						e.dispatch(TriggerDispatch{
							Kind:      "plugin",
							PluginID:  plugin.ID,
							EventCode: trig.ID,
							Payload: map[string]any{
								"count":   summary.Count,
								"summary": summary.Summary,
								"sensor":  "metric_threshold",
							},
						})
					}
				}
			}
		}
	}
}

func (e *Engine) runCronLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			minuteKey := now.Format("2006-01-02 15:04")
			e.mu.Lock()
			rules := append([]types.AutomationRule(nil), e.automations...)
			quiet := e.preferences.PluginRuntime.QuietHours
			e.mu.Unlock()

			if inQuietHours(quiet, now) {
				continue
			}

			for _, rule := range rules {
				if !rule.Enabled || rule.TriggerType != "cron" {
					continue
				}
				if !matchAutomationSchedule(rule, now) {
					continue
				}
				e.mu.Lock()
				already := e.lastCronFired[rule.ID] == minuteKey
				if !already {
					e.lastCronFired[rule.ID] = minuteKey
				}
				e.mu.Unlock()
				if already {
					continue
				}
				e.dispatch(TriggerDispatch{
					Kind:         "automation",
					AutomationID: rule.ID,
					Title:        rule.Title,
					Prompt:       rule.Prompt,
				})
			}
		}
	}
}

func (e *Engine) dispatch(d TriggerDispatch) {
	if d.Kind == "plugin" {
		e.mu.Lock()
		throttle10m := e.preferences.Thresholds.EventThrottle10m
		e.mu.Unlock()
		if !e.throttle.Allow(d.PluginID, d.EventCode, throttle10m, false) {
			return
		}
	}
	if e.cfg.OnTrigger != nil {
		e.cfg.OnTrigger(d)
	}
}

func matchAutomationSchedule(rule types.AutomationRule, now time.Time) bool {
	if strings.TrimSpace(rule.CronExpr) != "" {
		fields := strings.Fields(strings.TrimSpace(rule.CronExpr))
		if len(fields) == 5 {
			return matchCronField(fields[0], now.Minute()) &&
				matchCronField(fields[1], now.Hour()) &&
				matchCronField(fields[2], now.Day()) &&
				matchCronField(fields[3], int(now.Month())) &&
				matchCronField(fields[4], int(now.Weekday()))
		}
	}
	top := strings.TrimSpace(rule.ScheduleTop)
	bot := strings.TrimSpace(rule.ScheduleBottom)
	hhmm := now.Format("15:04")
	if strings.Contains(top, "小时") {
		return now.Minute() == 0
	}
	if bot != "" && strings.Contains(bot, ":") && bot != hhmm {
		return false
	}
	switch {
	case strings.Contains(top, "周一"):
		return now.Weekday() == time.Monday
	case strings.Contains(top, "周二"):
		return now.Weekday() == time.Tuesday
	case strings.Contains(top, "周三"):
		return now.Weekday() == time.Wednesday
	case strings.Contains(top, "周四"):
		return now.Weekday() == time.Thursday
	case strings.Contains(top, "周五"):
		return now.Weekday() == time.Friday
	case strings.Contains(top, "周六"):
		return now.Weekday() == time.Saturday
	case strings.Contains(top, "周日"):
		return now.Weekday() == time.Sunday
	default:
		return bot == hhmm
	}
}

func matchCronField(field string, val int) bool {
	if field == "*" {
		return true
	}
	if strings.HasPrefix(field, "*/") {
		step, err := strconv.Atoi(strings.TrimPrefix(field, "*/"))
		return err == nil && step > 0 && val%step == 0
	}
	n, err := strconv.Atoi(field)
	return err == nil && n == val
}

func newestCrashMtime(homeDir string) time.Time {
	diagDir := filepath.Join(homeDir, "Library", "Logs", "DiagnosticReports")
	entries, err := os.ReadDir(diagDir)
	if err != nil {
		return time.Time{}
	}
	var latest time.Time
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".ips") && !strings.HasSuffix(name, ".crash") {
			continue
		}
		if info, err := entry.Info(); err == nil && info.ModTime().After(latest) {
			latest = info.ModTime()
		}
	}
	return latest
}

func inQuietHours(spec string, now time.Time) bool {
	spec = strings.TrimSpace(spec)
	if spec == "" || spec == "关闭" {
		return false
	}
	norm := strings.ReplaceAll(spec, "–", "-")
	parts := strings.Split(norm, "-")
	if len(parts) != 2 {
		return false
	}
	startH, startM, ok1 := parseHHMM(parts[0])
	endH, endM, ok2 := parseHHMM(parts[1])
	if !ok1 || !ok2 {
		return false
	}
	cur := now.Hour()*60 + now.Minute()
	start := startH*60 + startM
	end := endH*60 + endM
	if start <= end {
		return cur >= start && cur < end
	}
	return cur >= start || cur < end
}

func parseHHMM(raw string) (int, int, bool) {
	parts := strings.Split(strings.TrimSpace(raw), ":")
	if len(parts) != 2 {
		return 0, 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return h, m, true
}

func parsePercent(raw string, fallback int) int {
	clean := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(raw), "%"))
	if n, err := strconv.Atoi(clean); err == nil && n > 0 {
		return n
	}
	return fallback
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

var _ = errors.New
