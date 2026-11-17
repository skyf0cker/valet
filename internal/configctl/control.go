package configctl

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const ControlFileName = "control.json"

// ControlInfo stores the loopback control API coordinates and bearer token for a running Valet daemon.
type ControlInfo struct {
	PID             int    `json:"pid"`
	BaseURL         string `json:"baseUrl"`
	WebhookEndpoint string `json:"webhookEndpoint"`
	Token           string `json:"token"`
	DataDir         string `json:"dataDir"`
	StartedAt       string `json:"startedAt"`
}

// ResolveDefaultDataDir locates Valet's persistent data directory across CLI and headless invocations.
func ResolveDefaultDataDir(explicit string) string {
	if d := strings.TrimSpace(explicit); d != "" {
		return d
	}
	if env := strings.TrimSpace(os.Getenv("VALET_DATA_DIR")); env != "" {
		return env
	}
	if ctrl := strings.TrimSpace(os.Getenv("VALET_CONTROL_FILE")); ctrl != "" {
		if dir := filepath.Dir(ctrl); dir != "" && dir != "." {
			return dir
		}
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ".valet-data"
	}
	if runtime.GOOS == "darwin" {
		appSupport := filepath.Join(home, "Library", "Application Support", "dev.vophan.valet")
		if _, err := os.Stat(filepath.Join(appSupport, ControlFileName)); err == nil {
			return appSupport
		}
		if _, err := os.Stat(filepath.Join(appSupport, "state.json")); err == nil {
			return appSupport
		}
	}
	return filepath.Join(home, ".valet-data")
}

// ReadControlInfo reads and decodes `<dataDir>/control.json` (or `VALET_CONTROL_FILE` when dataDir is empty).
func ReadControlInfo(dataDir string) (ControlInfo, error) {
	path := ""
	if d := strings.TrimSpace(dataDir); d != "" {
		path = filepath.Join(d, ControlFileName)
	} else if envPath := strings.TrimSpace(os.Getenv("VALET_CONTROL_FILE")); envPath != "" {
		path = envPath
	} else {
		path = filepath.Join(ResolveDefaultDataDir(""), ControlFileName)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return ControlInfo{}, err
	}
	var info ControlInfo
	if err := json.Unmarshal(raw, &info); err != nil {
		return ControlInfo{}, err
	}
	return info, nil
}
