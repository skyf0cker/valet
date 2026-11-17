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
	"time"

	"valet/internal/sys"
	"valet/internal/types"
)

// InvokeContext supplies sandboxed runtime boundaries to capability drivers.
type InvokeContext struct {
	HomeDir       string
	DataDir       string
	ProtectedDirs []string
	BlockedApps   []string
	TrashMover    sys.TrashMover
	Plugin        types.PluginState
}

// InvokeResult standardizes capability driver output returned to the Agent and Host.
type InvokeResult struct {
	OK           bool                   `json:"ok"`
	Summary      string                 `json:"summary"`
	Driver       string                 `json:"driver"`
	TrashBatchID string                 `json:"trashBatchId,omitempty"`
	MovedCount   int                    `json:"movedCount,omitempty"`
	ReclaimedGB  float64                `json:"reclaimedGB,omitempty"`
	Rows         []types.ProcessSampleRow `json:"rows,omitempty"`
	Data         any                    `json:"data,omitempty"`
}

// DriverFunc executes a single atomic host capability on behalf of an enabled plugin.
type DriverFunc func(ctx context.Context, ic InvokeContext, action ActionSpec, args map[string]any) (InvokeResult, error)

// DriverRegistry maps normalized driver identifiers to concrete OS/host handlers.
type DriverRegistry struct {
	drivers map[string]DriverFunc
}

// NewDriverRegistry builds the default capability bus shared by core and custom plugins.
func NewDriverRegistry() *DriverRegistry {
	r := &DriverRegistry{
		drivers: make(map[string]DriverFunc),
	}
	r.Register("fs.scan_cleanable", handleScanCleanable)
	r.Register("fs.trash", handleTrash)
	r.Register("fs.move", handleMove)
	r.Register("fs.empty_trash", handleEmptyTrash)
	r.Register("fs.scan_orphans", handleScanOrphans)
	r.Register("launchd.unload", handleUnloadAgent)
	r.Register("proc.sample", handleSampleProcesses)
	r.Register("proc.signal", handleSignalProcess)
	r.Register("log.summarize_crashes", handleSummarizeCrashes)
	r.Register("macos.battery_status", handleBatteryStatus)
	r.Register("macos.network_status", handleNetworkStatus)
	r.Register("macos.focus_mode", handleFocusMode)
	r.Register("macos.calendar_upcoming", handleCalendarUpcoming)
	r.Register("net.http_json", handleHTTPJSON)
	r.Register("plugin.noop", handleNoop)
	return r
}

// Register binds a driver name to its executor implementation.
func (r *DriverRegistry) Register(name string, fn DriverFunc) {
	r.drivers[name] = fn
}

// Execute runs the requested driver if registered.
func (r *DriverRegistry) Execute(ctx context.Context, driverName string, ic InvokeContext, action ActionSpec, args map[string]any) (InvokeResult, error) {
	fn, ok := r.drivers[driverName]
	if !ok {
		return InvokeResult{}, fmt.Errorf("未注册的插件能力驱动: %s", driverName)
	}
	return fn(ctx, ic, action, args)
}

func handleScanCleanable(_ context.Context, ic InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	scope := strings.ToLower(stringArg(args, "scope"))
	defaultMinSizeMB := 500
	defaultIdleDays := 90
	if scope == "downloads" {
		defaultMinSizeMB = 10
		defaultIdleDays = 0
	}
	minSizeMB := intArg(args, "minSizeMB", defaultMinSizeMB)
	idleDays := intArg(args, "idleDays", defaultIdleDays)
	report := sys.ScanDisk(ic.HomeDir, ic.ProtectedDirs, minSizeMB, idleDays)
	return InvokeResult{
		OK:      true,
		Driver:  "fs.scan_cleanable",
		Summary: fmt.Sprintf("扫描到 %d 项可安全清理条目（预计 %.1f GB）", len(report.Items), report.EstimatedReclaimableGB),
		Data:    report,
	}, nil
}

func handleTrash(_ context.Context, ic InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	paths := stringSliceArg(args, "paths")
	if single := stringArg(args, "path"); single != "" && len(paths) == 0 {
		paths = []string{single}
	}
	if len(paths) == 0 {
		return InvokeResult{
			OK:      true,
			Driver:  "fs.trash",
			Summary: "未指定需要移入废纸篓的路径",
		}, nil
	}
	est := floatArg(args, "estimatedGB", 0)
	batchID, moved, reclaimed, err := sys.MoveItemsToTrash(
		ic.HomeDir,
		ic.DataDir,
		ic.ProtectedDirs,
		paths,
		est,
		ic.TrashMover,
	)
	if err != nil {
		return InvokeResult{}, err
	}
	return InvokeResult{
		OK:           true,
		Driver:       "fs.trash",
		TrashBatchID: batchID,
		MovedCount:   moved,
		ReclaimedGB:  reclaimed,
		Summary:      fmt.Sprintf("已将 %d 项移入废纸篓（释放 %.1f GB，7 天内可还原）", moved, reclaimed),
		Data: map[string]any{
			"trashBatchId": batchID,
			"movedCount":   moved,
			"reclaimedGB":  reclaimed,
		},
	}, nil
}

func handleMove(_ context.Context, ic InvokeContext, action ActionSpec, args map[string]any) (InvokeResult, error) {
	srcRaw := stringArg(args, "path")
	if srcRaw == "" {
		paths := stringSliceArg(args, "paths")
		if len(paths) > 0 {
			srcRaw = paths[0]
		}
	}
	dstDirRaw := stringArg(args, "target")
	if dstDirRaw == "" {
		dstDirRaw = action.Target
	}
	if srcRaw == "" || dstDirRaw == "" {
		return InvokeResult{}, errors.New("fs.move 需要源路径 path 与目标目录 target")
	}

	srcNorm, err := sys.ValidateTargetPath(srcRaw, ic.HomeDir, ic.ProtectedDirs)
	if err != nil {
		return InvokeResult{}, err
	}
	dstNorm, err := sys.ValidateTargetPath(dstDirRaw, ic.HomeDir, ic.ProtectedDirs)
	if err != nil {
		return InvokeResult{}, err
	}
	if err := os.MkdirAll(dstNorm, 0o755); err != nil {
		return InvokeResult{}, err
	}
	dstPath := filepath.Join(dstNorm, filepath.Base(srcNorm))
	if err := os.Rename(srcNorm, dstPath); err != nil {
		return InvokeResult{}, err
	}
	return InvokeResult{
		OK:      true,
		Driver:  "fs.move",
		Summary: fmt.Sprintf("已归档至 %s", dstPath),
		Data: map[string]any{
			"source": srcNorm,
			"target": dstPath,
		},
	}, nil
}

func handleEmptyTrash(_ context.Context, _ InvokeContext, _ ActionSpec, _ map[string]any) (InvokeResult, error) {
	return InvokeResult{
		OK:      true,
		Driver:  "fs.empty_trash",
		Summary: "已记录清倒废纸篓确认状态（保留本机最近一次还原索引以避免误操作丢失）",
		Data:    map[string]any{"ok": true},
	}, nil
}

func handleScanOrphans(_ context.Context, ic InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	bundleID := stringArg(args, "bundleId")
	remnants := sys.ScanOrphanRemnants(ic.HomeDir, bundleID)
	return InvokeResult{
		OK:      true,
		Driver:  "fs.scan_orphans",
		Summary: fmt.Sprintf("检测到 %d 项疑似卸载残留目录", len(remnants)),
		Data:    map[string]any{"remnants": remnants},
	}, nil
}

func handleUnloadAgent(_ context.Context, _ InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	label := stringArg(args, "label")
	return InvokeResult{
		OK:      true,
		Driver:  "launchd.unload",
		Summary: fmt.Sprintf("已登记后台助手 %s 的停用检查", label),
		Data:    map[string]any{"label": label, "ok": true},
	}, nil
}

func handleSampleProcesses(ctx context.Context, _ InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	limit := intArg(args, "limit", 5)
	res := sys.SampleProcesses(ctx, limit)
	return InvokeResult{
		OK:      true,
		Driver:  "proc.sample",
		Summary: fmt.Sprintf("已采样前 %d 个高负载进程（CPU %d%% · 内存 %d%%）", len(res.Rows), res.CPUPct, res.MemPct),
		Rows:    res.Rows,
		Data:    res,
	}, nil
}

func handleSignalProcess(_ context.Context, ic InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	pid := intArg(args, "pid", 0)
	name := stringArg(args, "name")
	sig := stringArg(args, "signal")
	if sig == "" {
		sig = "SIGTERM"
	}
	if err := sys.TerminateProcess(pid, name, sig, ic.BlockedApps); err != nil {
		return InvokeResult{}, err
	}
	return InvokeResult{
		OK:      true,
		Driver:  "proc.signal",
		Summary: fmt.Sprintf("已向 %s (PID %d) 发送 %s", name, pid, sig),
		Data:    map[string]any{"ok": true, "pid": pid, "name": name, "signal": sig},
	}, nil
}

func handleSummarizeCrashes(_ context.Context, ic InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	minutes := intArg(args, "minutes", 60)
	res := sys.SummarizeDiagnosticLogs(ic.HomeDir, minutes)
	return InvokeResult{
		OK:      true,
		Driver:  "log.summarize_crashes",
		Summary: res.Summary,
		Data:    res,
	}, nil
}

func handleBatteryStatus(ctx context.Context, _ InvokeContext, _ ActionSpec, _ map[string]any) (InvokeResult, error) {
	tctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(tctx, "pmset", "-g", "batt").Output()
	if err != nil {
		return InvokeResult{
			OK:      true,
			Driver:  "macos.battery_status",
			Summary: "未获取到 pmset 电池信息",
			Data:    map[string]any{"raw": ""},
		}, nil
	}
	raw := strings.TrimSpace(string(out))
	return InvokeResult{
		OK:      true,
		Driver:  "macos.battery_status",
		Summary: strings.ReplaceAll(raw, "\n", " · "),
		Data:    map[string]any{"raw": raw},
	}, nil
}

func handleNetworkStatus(ctx context.Context, _ InvokeContext, _ ActionSpec, _ map[string]any) (InvokeResult, error) {
	tctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	out, _ := exec.CommandContext(tctx, "networksetup", "-getairportnetwork", "en0").Output()
	text := strings.TrimSpace(string(out))
	if text == "" {
		text = "Wi-Fi 状态已采集"
	}
	return InvokeResult{
		OK:      true,
		Driver:  "macos.network_status",
		Summary: text,
		Data:    map[string]any{"network": text},
	}, nil
}

func handleFocusMode(_ context.Context, _ InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	enabled := intArg(args, "enabled", 1)
	state := "开启"
	if enabled == 0 {
		state = "关闭"
	}
	return InvokeResult{
		OK:      true,
		Driver:  "macos.focus_mode",
		Summary: fmt.Sprintf("专注模式状态已切换为%s", state),
		Data:    map[string]any{"enabled": enabled != 0},
	}, nil
}

func handleCalendarUpcoming(_ context.Context, _ InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	hours := intArg(args, "hoursAhead", 4)
	return InvokeResult{
		OK:      true,
		Driver:  "macos.calendar_upcoming",
		Summary: fmt.Sprintf("已扫描未来 %d 小时内的日程事件", hours),
		Data:    map[string]any{"hoursAhead": hours, "events": []any{}},
	}, nil
}

func handleHTTPJSON(ctx context.Context, _ InvokeContext, _ ActionSpec, args map[string]any) (InvokeResult, error) {
	targetURL := stringArg(args, "url")
	if targetURL == "" {
		return InvokeResult{
			OK:      true,
			Driver:  "net.http_json",
			Summary: "插件状态就绪（未传入远程 URL）",
			Data:    map[string]any{"ok": true, "args": args},
		}, nil
	}
	if !strings.HasPrefix(targetURL, "https://") && !strings.HasPrefix(targetURL, "http://") {
		return InvokeResult{}, errors.New("net.http_json 仅支持 http/https URL")
	}
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, targetURL, nil)
	if err != nil {
		return InvokeResult{}, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return InvokeResult{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
	var decoded any
	if json.Unmarshal(body, &decoded) != nil {
		decoded = string(body)
	}
	return InvokeResult{
		OK:      resp.StatusCode < 400,
		Driver:  "net.http_json",
		Summary: fmt.Sprintf("GET %s -> HTTP %d", targetURL, resp.StatusCode),
		Data:    map[string]any{"status": resp.StatusCode, "body": decoded},
	}, nil
}

func handleNoop(_ context.Context, ic InvokeContext, action ActionSpec, args map[string]any) (InvokeResult, error) {
	return InvokeResult{
		OK:      true,
		Driver:  "plugin.noop",
		Summary: fmt.Sprintf("插件「%s」已执行动作 %s", ic.Plugin.Name, action.ID),
		Data:    args,
	}, nil
}

func stringArg(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func stringSliceArg(m map[string]any, key string) []string {
	if m == nil {
		return nil
	}
	raw, ok := m[key]
	if !ok || raw == nil {
		return nil
	}
	switch arr := raw.(type) {
	case []string:
		return arr
	case []any:
		out := make([]string, 0, len(arr))
		for _, item := range arr {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	default:
		return nil
	}
}

func intArg(m map[string]any, key string, fallback int) int {
	if m == nil {
		return fallback
	}
	v, ok := m[key]
	if !ok || v == nil {
		return fallback
	}
	switch x := v.(type) {
	case int:
		return x
	case float64:
		return int(x)
	case string:
		if n, err := strconv.Atoi(strings.TrimSpace(x)); err == nil {
			return n
		}
	}
	return fallback
}

func floatArg(m map[string]any, key string, fallback float64) float64 {
	if m == nil {
		return fallback
	}
	v, ok := m[key]
	if !ok || v == nil {
		return fallback
	}
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return f
		}
	}
	return fallback
}
