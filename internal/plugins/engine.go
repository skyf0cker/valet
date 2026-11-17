package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
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

// EngineConfig configures Valet's generic declarative plugin sensor runtime.
type EngineConfig struct {
	HomeDir    string
	DataDir    string
	BunPath    string
	WatchDir   WatchDirFunc
	TrashMover sys.TrashMover
	OnTrigger  func(TriggerDispatch)
}

// Engine manages live per-plugin sensors and cron automations.
type Engine struct {
	cfg      EngineConfig
	throttle *ThrottleTracker

	mu              sync.Mutex
	closed          bool
	fsWatches       map[string]*activeSensor
	httpPollWorkers map[string]*activeSensor
	cmdPollWorkers  map[string]*activeSensor
	cronTriggers    []pluginCronTrigger
	cronStop        context.CancelFunc
	lastCronFired   map[string]string
	lastCronSig     string
	automations     []types.AutomationRule
	preferences     types.ValetPreferences
	isPaused        bool
}

type activeSensor struct {
	sig    string
	cancel context.CancelFunc
}

type pluginCronTrigger struct {
	pluginID string
	trigger  TriggerSpec
}

// NewEngine creates a generic plugin sensor & cron runtime engine.
func NewEngine(cfg EngineConfig) *Engine {
	if cfg.WatchDir == nil {
		cfg.WatchDir = PollingWatchDir(1200 * time.Millisecond)
	}
	return &Engine{
		cfg:             cfg,
		throttle:        NewThrottleTracker(),
		fsWatches:       make(map[string]*activeSensor),
		httpPollWorkers: make(map[string]*activeSensor),
		cmdPollWorkers:  make(map[string]*activeSensor),
		lastCronFired:   make(map[string]string),
	}
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
	for k, h := range e.httpPollWorkers {
		h.cancel()
		delete(e.httpPollWorkers, k)
	}
	for k, c := range e.cmdPollWorkers {
		c.cancel()
		delete(e.cmdPollWorkers, k)
	}
	e.cronTriggers = nil
	if e.cronStop != nil {
		e.cronStop()
		e.cronStop = nil
	}
	e.mu.Unlock()
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
		for k, h := range e.httpPollWorkers {
			h.cancel()
			delete(e.httpPollWorkers, k)
		}
		for k, c := range e.cmdPollWorkers {
			c.cancel()
			delete(e.cmdPollWorkers, k)
		}
		e.cronTriggers = nil
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
	desiredHTTP := map[string]struct {
		plugin  types.PluginState
		trigger TriggerSpec
		sig     string
	}{}
	desiredPoll := map[string]struct {
		plugin  types.PluginState
		trigger TriggerSpec
		sig     string
	}{}
	var cronPluginTriggers []pluginCronTrigger

	for _, p := range snap.Plugins {
		if !p.Installed || !p.Enabled {
			continue
		}
		parsed, err := ParseManifestYAML(p.ManifestYAML)
		if err != nil {
			continue
		}
		cfgJSON, _ := json.Marshal(p.Config)
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
			case "http_poll":
				if strings.TrimSpace(trig.URL) == "" {
					continue
				}
				key := p.ID + "::" + trig.ID
				sig := fmt.Sprintf("%s|%s|%s", p.Version, p.ManifestYAML, snap.Preferences.PluginRuntime.QuietHours)
				desiredHTTP[key] = struct {
					plugin  types.PluginState
					trigger TriggerSpec
					sig     string
				}{plugin: p, trigger: trig, sig: sig}
			case "command_poll":
				if strings.TrimSpace(trig.Command) == "" {
					continue
				}
				key := p.ID + "::" + trig.ID
				sig := fmt.Sprintf("%s|%s|%s|%s", p.Version, p.ManifestYAML, snap.Preferences.PluginRuntime.QuietHours, string(cfgJSON))
				desiredPoll[key] = struct {
					plugin  types.PluginState
					trigger TriggerSpec
					sig     string
				}{plugin: p, trigger: trig, sig: sig}
			case "script_poll":
				if strings.TrimSpace(trig.Script) == "" {
					continue
				}
				key := p.ID + "::" + trig.ID
				sig := fmt.Sprintf("%s|%s|%s|%s|%s", p.Version, p.LocalDir, p.ManifestYAML, snap.Preferences.PluginRuntime.QuietHours, string(cfgJSON))
				desiredPoll[key] = struct {
					plugin  types.PluginState
					trigger TriggerSpec
					sig     string
				}{plugin: p, trigger: trig, sig: sig}
			case "cron":
				cronPluginTriggers = append(cronPluginTriggers, pluginCronTrigger{pluginID: p.ID, trigger: trig})
			}
		}
	}

	e.cronTriggers = cronPluginTriggers

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

	// Reconcile http_poll sensors
	for key, running := range e.httpPollWorkers {
		des, ok := desiredHTTP[key]
		if !ok || running.sig != des.sig {
			running.cancel()
			delete(e.httpPollWorkers, key)
		}
	}
	for key, des := range desiredHTTP {
		if _, exists := e.httpPollWorkers[key]; exists {
			continue
		}
		cctx, cancel := context.WithCancel(context.Background())
		e.httpPollWorkers[key] = &activeSensor{sig: des.sig, cancel: cancel}
		go e.runHttpPollSensor(cctx, des.plugin, des.trigger, snap.Preferences)
	}

	// Reconcile command_poll and script_poll sensors
	for key, running := range e.cmdPollWorkers {
		des, ok := desiredPoll[key]
		if !ok || running.sig != des.sig {
			running.cancel()
			delete(e.cmdPollWorkers, key)
		}
	}
	for key, des := range desiredPoll {
		if _, exists := e.cmdPollWorkers[key]; exists {
			continue
		}
		cctx, cancel := context.WithCancel(context.Background())
		e.cmdPollWorkers[key] = &activeSensor{sig: des.sig, cancel: cancel}
		go e.runCommandPollSensor(cctx, des.plugin, des.trigger, snap.Preferences)
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
			cronTrigs := append([]pluginCronTrigger(nil), e.cronTriggers...)
			quiet := e.preferences.PluginRuntime.QuietHours
			e.mu.Unlock()

			if InQuietHours(quiet, now) {
				continue
			}

			for _, ct := range cronTrigs {
				if strings.TrimSpace(ct.trigger.Schedule) == "" {
					continue
				}
				if !matchCronExpr(ct.trigger.Schedule, now) {
					continue
				}
				firedKey := "plugin:" + ct.pluginID + ":" + ct.trigger.ID
				e.mu.Lock()
				already := e.lastCronFired[firedKey] == minuteKey
				if !already {
					e.lastCronFired[firedKey] = minuteKey
				}
				e.mu.Unlock()
				if already {
					continue
				}
				e.dispatch(TriggerDispatch{
					Kind:      "plugin",
					PluginID:  ct.pluginID,
					EventCode: ct.trigger.ID,
					Payload: map[string]any{
						"sensor":   "cron",
						"schedule": ct.trigger.Schedule,
					},
				})
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

func (e *Engine) runHttpPollSensor(ctx context.Context, plugin types.PluginState, trig TriggerSpec, prefs types.ValetPreferences) {
	targetURL := strings.TrimSpace(trig.URL)
	if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
		return
	}
	interval := trig.IntervalSec
	if interval <= 0 {
		interval = 60
	}
	emitOn := strings.ToLower(strings.TrimSpace(trig.EmitOn))
	if emitOn == "" {
		emitOn = "change"
	}
	method := strings.ToUpper(strings.TrimSpace(trig.Method))
	if method == "" {
		method = http.MethodGet
	}

	var hasBaseline bool
	var lastBody string

	poll := func() {
		if InQuietHours(prefs.PluginRuntime.QuietHours, time.Now()) {
			return
		}
		reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(reqCtx, method, targetURL, nil)
		if err != nil {
			return
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		resp.Body.Close()

		body := strings.TrimSpace(string(raw))
		if len(body) > 4096 {
			body = body[:4096]
		}
		if trig.MatchContains != "" && !strings.Contains(body, trig.MatchContains) {
			return
		}

		shouldEmit := false
		switch emitOn {
		case "always":
			shouldEmit = resp.StatusCode < 500
		case "non_empty":
			shouldEmit = body != "" && body != "{}" && body != "[]"
		default: // "change"
			if !hasBaseline {
				hasBaseline = true
				lastBody = body
				return
			}
			if body != lastBody {
				lastBody = body
				shouldEmit = true
			}
		}
		if !shouldEmit {
			return
		}
		e.dispatch(TriggerDispatch{
			Kind:      "plugin",
			PluginID:  plugin.ID,
			EventCode: trig.ID,
			Payload: map[string]any{
				"sensor": "http_poll",
				"url":    targetURL,
				"status": resp.StatusCode,
				"body":   body,
			},
		})
	}

	if emitOn == "change" {
		poll()
	}

	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			poll()
		}
	}
}

func (e *Engine) runCommandPollSensor(ctx context.Context, plugin types.PluginState, trig TriggerSpec, prefs types.ValetPreferences) {
	isScript := trig.Sensor == "script_poll"
	rawCmd := strings.TrimSpace(trig.Command)
	rawScript := strings.TrimSpace(trig.Script)
	if isScript {
		if rawScript == "" {
			return
		}
	} else {
		if rawCmd == "" || isForbiddenPluginShellCommand(rawCmd) {
			return
		}
	}

	interval := resolvePollInterval(plugin, trig, 60)
	emitOn := strings.ToLower(strings.TrimSpace(trig.EmitOn))
	if emitOn == "" {
		if isScript {
			emitOn = "json"
		} else {
			emitOn = "change"
		}
	}

	var hasBaseline bool
	var lastStdout string

	poll := func() {
		if InQuietHours(prefs.PluginRuntime.QuietHours, time.Now()) {
			return
		}
		cmdCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()

		var cmd *exec.Cmd
		if isScript {
			bin, args, ok := e.resolveScriptCommand(plugin, rawScript)
			if !ok {
				return
			}
			cmd = exec.CommandContext(cmdCtx, bin, args...)
			if plugin.LocalDir != "" {
				cmd.Dir = plugin.LocalDir
			} else if e.cfg.HomeDir != "" {
				cmd.Dir = e.cfg.HomeDir
			}
		} else {
			cmd = exec.CommandContext(cmdCtx, "/bin/sh", "-c", rawCmd)
			if e.cfg.HomeDir != "" {
				cmd.Dir = e.cfg.HomeDir
			}
		}

		cmd.Env = pluginCommandEnv(e.cfg.HomeDir, e.cfg.DataDir, e.resolveBunBinary(), plugin)
		out, err := cmd.CombinedOutput()
		exitCode := 0
		if err != nil {
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = -1
			}
		}

		stdout := strings.TrimSpace(string(out))
		if isScript && emitOn == "json" {
			if exitCode != 0 || stdout == "" {
				return
			}
			var parsedOut struct {
				Triggered bool           `json:"triggered"`
				Payload   map[string]any `json:"payload"`
			}
			if err := json.Unmarshal([]byte(stdout), &parsedOut); err != nil || !parsedOut.Triggered {
				return
			}
			payload := make(map[string]any, len(parsedOut.Payload)+1)
			for k, v := range parsedOut.Payload {
				payload[k] = v
			}
			payload["sensor"] = "script_poll"
			e.dispatch(TriggerDispatch{
				Kind:      "plugin",
				PluginID:  plugin.ID,
				EventCode: trig.ID,
				Payload:   payload,
			})
			return
		}

		if len(stdout) > 8192 {
			stdout = stdout[:8192]
		}
		if trig.MatchContains != "" && !strings.Contains(stdout, trig.MatchContains) {
			return
		}

		shouldEmit := false
		switch emitOn {
		case "always":
			shouldEmit = true
		case "exit_zero":
			shouldEmit = exitCode == 0
		case "non_empty":
			shouldEmit = stdout != ""
		default: // "change"
			if !hasBaseline {
				hasBaseline = true
				lastStdout = stdout
				return
			}
			if stdout != lastStdout {
				lastStdout = stdout
				shouldEmit = true
			}
		}
		if !shouldEmit {
			return
		}
		payload := map[string]any{
			"sensor":   trig.Sensor,
			"exitCode": exitCode,
			"stdout":   stdout,
		}
		if isScript {
			payload["script"] = rawScript
		} else {
			payload["command"] = rawCmd
		}
		e.dispatch(TriggerDispatch{
			Kind:      "plugin",
			PluginID:  plugin.ID,
			EventCode: trig.ID,
			Payload:   payload,
		})
	}

	if emitOn == "change" || emitOn == "json" {
		poll()
	}

	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			poll()
		}
	}
}

func matchCronExpr(expr string, now time.Time) bool {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return false
	}
	return matchCronField(fields[0], now.Minute()) &&
		matchCronField(fields[1], now.Hour()) &&
		matchCronField(fields[2], now.Day()) &&
		matchCronField(fields[3], int(now.Month())) &&
		matchCronField(fields[4], int(now.Weekday()))
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

// InQuietHours reports whether now falls inside a "HH:MM - HH:MM" quiet hours window.
func InQuietHours(spec string, now time.Time) bool {
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

func resolvePollInterval(plugin types.PluginState, trig TriggerSpec, fallback int) int {
	interval := trig.IntervalSec
	if interval <= 0 {
		interval = fallback
	}
	if key := strings.TrimSpace(trig.IntervalConfigKey); key != "" {
		if plugin.Config.Values != nil {
			if raw, ok := plugin.Config.Values[key]; ok {
				switch v := raw.(type) {
				case int:
					if v > 0 {
						interval = v
					}
				case int64:
					if v > 0 {
						interval = int(v)
					}
				case float64:
					if int(v) > 0 {
						interval = int(v)
					}
				case string:
					if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n > 0 {
						interval = n
					}
				}
			}
		}
		if key == "sampleIntervalSec" && plugin.Config.SampleIntervalSec != nil && *plugin.Config.SampleIntervalSec > 0 {
			interval = *plugin.Config.SampleIntervalSec
		}
	} else if plugin.Config.SampleIntervalSec != nil && *plugin.Config.SampleIntervalSec > 0 {
		interval = *plugin.Config.SampleIntervalSec
	}
	if interval < 1 {
		interval = 1
	}
	return interval
}

func (e *Engine) resolveBunBinary() string {
	if p := strings.TrimSpace(e.cfg.BunPath); p != "" {
		return p
	}
	if e.cfg.DataDir != "" {
		candidate := filepath.Join(e.cfg.DataDir, "bin", "bun")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	if p, err := exec.LookPath("bun"); err == nil {
		return p
	}
	candidates := []string{}
	if e.cfg.HomeDir != "" {
		candidates = append(candidates, filepath.Join(e.cfg.HomeDir, ".bun", "bin", "bun"))
	}
	candidates = append(candidates, "/opt/homebrew/bin/bun", "/usr/local/bin/bun")
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return c
		}
	}
	return "bun"
}

func (e *Engine) resolveScriptCommand(plugin types.PluginState, relScript string) (string, []string, bool) {
	dir := strings.TrimSpace(plugin.LocalDir)
	if dir == "" {
		return "", nil, false
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return "", nil, false
	}
	cleaned := filepath.Clean(strings.TrimSpace(relScript))
	target := cleaned
	if !filepath.IsAbs(target) {
		target = filepath.Join(absDir, cleaned)
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", nil, false
	}
	rel, err := filepath.Rel(absDir, absTarget)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", nil, false
	}
	info, err := os.Stat(absTarget)
	if err != nil || info.IsDir() {
		return "", nil, false
	}

	switch strings.ToLower(filepath.Ext(absTarget)) {
	case ".js", ".mjs", ".ts", ".mts":
		return e.resolveBunBinary(), []string{absTarget}, true
	case ".py":
		return "python3", []string{absTarget}, true
	default:
		return "/bin/sh", []string{absTarget}, true
	}
}

func pluginCommandEnv(homeDir, dataDir, bunPath string, plugin types.PluginState) []string {
	home := strings.TrimSpace(homeDir)
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	stateDir := ""
	if strings.TrimSpace(dataDir) != "" {
		stateDir = filepath.Join(dataDir, "plugin-state", plugin.ID)
	} else {
		stateDir = filepath.Join(os.TempDir(), "valet-plugin-state", plugin.ID)
	}
	_ = os.MkdirAll(stateDir, 0o755)

	cfgValues := make(map[string]any, len(plugin.Config.Values)+3)
	for k, v := range plugin.Config.Values {
		cfgValues[k] = v
	}
	if plugin.Config.LowSpaceThresholdPct != nil {
		if _, ok := cfgValues["lowSpaceThresholdPct"]; !ok {
			cfgValues["lowSpaceThresholdPct"] = *plugin.Config.LowSpaceThresholdPct
		}
	}
	if plugin.Config.SampleIntervalSec != nil {
		if _, ok := cfgValues["sampleIntervalSec"]; !ok {
			cfgValues["sampleIntervalSec"] = *plugin.Config.SampleIntervalSec
		}
	}
	if len(plugin.Config.ProtectedPaths) > 0 {
		if _, ok := cfgValues["protectedPaths"]; !ok {
			cfgValues["protectedPaths"] = plugin.Config.ProtectedPaths
		}
	}
	cfgJSON, err := json.Marshal(cfgValues)
	if err != nil {
		cfgJSON = []byte("{}")
	}

	env := make([]string, 0, len(os.Environ())+8)
	pathPrepend := make([]string, 0, 4)
	if strings.TrimSpace(dataDir) != "" {
		pathPrepend = append(pathPrepend, filepath.Join(dataDir, "bin"))
	}
	if strings.TrimSpace(bunPath) != "" && strings.ContainsRune(bunPath, filepath.Separator) {
		pathPrepend = append(pathPrepend, filepath.Dir(bunPath))
	}
	if home != "" {
		pathPrepend = append(pathPrepend, filepath.Join(home, ".bun", "bin"))
	}
	pathPrepend = append(pathPrepend, "/opt/homebrew/bin")

	existingPath := os.Getenv("PATH")
	newPath := strings.Join(pathPrepend, string(os.PathListSeparator))
	if existingPath != "" {
		newPath += string(os.PathListSeparator) + existingPath
	}

	skipKeys := map[string]bool{
		"PATH":                     true,
		"VALET_HOME_DIR":           true,
		"VALET_DATA_DIR":           true,
		"VALET_PLUGIN_ID":          true,
		"VALET_PLUGIN_DIR":         true,
		"VALET_PLUGIN_STATE_DIR":   true,
		"VALET_PLUGIN_CONFIG_JSON": true,
	}
	for _, entry := range os.Environ() {
		k, _, ok := strings.Cut(entry, "=")
		if ok && skipKeys[k] {
			continue
		}
		env = append(env, entry)
	}
	env = append(env,
		"PATH="+newPath,
		"VALET_HOME_DIR="+home,
		"VALET_DATA_DIR="+dataDir,
		"VALET_PLUGIN_ID="+plugin.ID,
		"VALET_PLUGIN_DIR="+plugin.LocalDir,
		"VALET_PLUGIN_STATE_DIR="+stateDir,
		"VALET_PLUGIN_CONFIG_JSON="+string(cfgJSON),
	)
	return env
}

func isForbiddenPluginShellCommand(raw string) bool {
	lower := strings.ToLower(strings.TrimSpace(raw))
	if lower == "" {
		return true
	}
	blocked := []string{
		"rm -rf /",
		"rm -rf /*",
		"rm -rf ~",
		"rm -fr /",
		":(){",
		"mkfs.",
		"dd if=",
		"shutdown",
		"reboot",
		"halt",
		"chmod -r 777 /",
	}
	for _, pat := range blocked {
		if strings.Contains(lower, pat) {
			return true
		}
	}
	return false
}

var _ = errors.New
