package cli_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"valet/internal/backend"
	"valet/internal/cli"
	"valet/internal/configctl"
	"valet/internal/types"
)

func runCLI(t *testing.T, args ...string) (string, map[string]any) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := cli.Run(args, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("valet %v exited %d\nstdout: %s\nstderr: %s", args, code, stdout.String(), stderr.String())
	}
	raw := stdout.String()
	var parsed map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &parsed); err != nil {
		t.Fatalf("valet %v output is not valid JSON: %v\nraw:\n%s", args, err, raw)
	}
	return raw, parsed
}

func TestCLIOfflineMode(t *testing.T) {
	tmpRoot := t.TempDir()
	dataDir := filepath.Join(tmpRoot, "data")
	pluginDir := filepath.Join(tmpRoot, "downloads-watcher")

	// 1. version & status
	_, verRes := runCLI(t, "--json", "version")
	if verRes["ok"] != true || verRes["version"] == "" {
		t.Fatalf("unexpected version output: %#v", verRes)
	}

	_, stRes := runCLI(t, "--data-dir", dataDir, "--json", "status")
	if stRes["mode"] != "offline" {
		t.Fatalf("expected offline mode, got %#v", stRes)
	}

	// 2. config get / set / schema
	_, cfgGetRes := runCLI(t, "--data-dir", dataDir, "--json", "config", "get", "appearance")
	if cfgGetRes["ok"] != true {
		t.Fatalf("config get failed: %#v", cfgGetRes)
	}

	_, cfgSetRes := runCLI(t, "--data-dir", dataDir, "--json", "config", "set", "appearance=dark", "thresholds.diskLowSpacePct=20")
	if cfgSetRes["ok"] != true {
		t.Fatalf("config set failed: %#v", cfgSetRes)
	}
	_, cfgAfterRes := runCLI(t, "--data-dir", dataDir, "--json", "config", "get", "appearance")
	if cfgAfterRes["value"] != "dark" {
		t.Fatalf("expected updated appearance=dark, got %#v", cfgAfterRes)
	}

	_, schemaRes := runCLI(t, "--data-dir", dataDir, "--json", "config", "schema")
	keysSlice, _ := schemaRes["keys"].([]any)
	if len(keysSlice) == 0 {
		t.Fatalf("expected non-empty config schema keys, got %#v", schemaRes)
	}

	// 3. model set / show
	_, mSetRes := runCLI(t, "--data-dir", dataDir, "--json", "model", "set", "--primary", "gpt-5", "--fast", "gpt-5-mini")
	if mSetRes["ok"] != true {
		t.Fatalf("model set failed: %#v", mSetRes)
	}
	rawModelShow, mShowRes := runCLI(t, "--data-dir", dataDir, "--json", "model", "show")
	if !strings.Contains(rawModelShow, `"gpt-5"`) || mShowRes["ok"] != true {
		t.Fatalf("expected gpt-5 in model show: %s", rawModelShow)
	}

	// 4. provider set / list (plaintext APIKey MUST NEVER be echoed)
	const secretKey = "sk-proj-1234567890abcdef"
	rawProvSet, _ := runCLI(t, "--data-dir", dataDir, "--json",
		"provider", "set", "openai",
		"--api-key", secretKey,
		"--base-url", "https://api.openai.com/v1",
	)
	if strings.Contains(rawProvSet, secretKey) {
		t.Fatalf("provider set leaked plaintext apiKey in output: %s", rawProvSet)
	}
	rawProvList, _ := runCLI(t, "--data-dir", dataDir, "--json", "provider", "list")
	if strings.Contains(rawProvList, secretKey) {
		t.Fatalf("provider list leaked plaintext apiKey in output: %s", rawProvList)
	}
	if !strings.Contains(rawProvList, "••••") {
		t.Fatalf("expected masked apiKey in provider list, got: %s", rawProvList)
	}
	rawStateOnDisk, err := os.ReadFile(filepath.Join(dataDir, "state.json"))
	if err != nil {
		t.Fatalf("read state.json failed: %v", err)
	}
	if strings.Contains(string(rawStateOnDisk), secretKey) {
		t.Fatalf("state.json must not store plaintext apiKey")
	}
	secPath := filepath.Join(dataDir, "secrets.json")
	secInfo, err := os.Stat(secPath)
	if err != nil {
		t.Fatalf("expected secrets.json to exist: %v", err)
	}
	if secInfo.Mode().Perm() != 0o600 {
		t.Fatalf("expected secrets.json mode 0600, got %o", secInfo.Mode().Perm())
	}
	rawSecOnDisk, err := os.ReadFile(secPath)
	if err != nil || !strings.Contains(string(rawSecOnDisk), secretKey) {
		t.Fatalf("expected secrets.json to store apiKey (err=%v)", err)
	}

	// 5. heartbeat set & automation add / list / remove
	_, hbSetRes := runCLI(t, "--data-dir", dataDir, "--json", "heartbeat", "set", "--enabled", "true", "--interval", "20")
	if hbSetRes["ok"] != true {
		t.Fatalf("heartbeat set failed: %#v", hbSetRes)
	}

	_, autoAddRes := runCLI(t, "--data-dir", dataDir, "--json",
		"automation", "add",
		"--title", "每日巡检",
		"--cron", "30 9 * * *",
		"--prompt", "检查磁盘",
	)
	if autoAddRes["ok"] != true {
		t.Fatalf("automation add failed: %#v", autoAddRes)
	}
	rawAutoList, _ := runCLI(t, "--data-dir", dataDir, "--json", "automation", "list")
	var autoList struct {
		Automations []types.AutomationRule `json:"automations"`
	}
	if err := json.Unmarshal([]byte(rawAutoList), &autoList); err != nil {
		t.Fatal(err)
	}
	var addedRuleID string
	for _, r := range autoList.Automations {
		if r.Title == "每日巡检" {
			addedRuleID = r.ID
		}
	}
	if addedRuleID == "" {
		t.Fatalf("expected newly added automation rule in list, got: %s", rawAutoList)
	}
	runCLI(t, "--data-dir", dataDir, "--json", "automation", "remove", addedRuleID)

	// 6. plugin init -> validate -> install -> list -> inspect -> policy -> reload -> remove --delete-files
	runCLI(t, "--json", "plugin", "init", pluginDir, "--template", "script_poll", "--name", "下载看守")
	rawVal, _ := runCLI(t, "--json", "plugin", "validate", pluginDir)
	var valOut struct {
		OK       bool `json:"ok"`
		ID       string `json:"id"`
		Triggers []struct {
			ID string `json:"id"`
		} `json:"triggers"`
		HasSkill bool `json:"hasSkill"`
	}
	if err := json.Unmarshal([]byte(rawVal), &valOut); err != nil {
		t.Fatal(err)
	}
	if !valOut.OK || valOut.ID == "" || len(valOut.Triggers) == 0 || !valOut.HasSkill {
		t.Fatalf("unexpected plugin validate output: %s", rawVal)
	}
	firstEventID := valOut.Triggers[0].ID

	rawInst, _ := runCLI(t, "--data-dir", dataDir, "--json", "plugin", "install", pluginDir)
	var instOut struct {
		Plugin types.PluginState `json:"plugin"`
	}
	if err := json.Unmarshal([]byte(rawInst), &instOut); err != nil {
		t.Fatal(err)
	}
	pid := instOut.Plugin.ID
	if pid == "" || instOut.Plugin.LocalDir == "" {
		t.Fatalf("expected installed plugin ID and LocalDir, got: %s", rawInst)
	}

	rawPlist, _ := runCLI(t, "--data-dir", dataDir, "--json", "plugin", "list")
	if !strings.Contains(rawPlist, pid) {
		t.Fatalf("expected %s in plugin list: %s", pid, rawPlist)
	}

	rawInspect, _ := runCLI(t, "--data-dir", dataDir, "--json", "plugin", "inspect", pid)
	if !strings.Contains(rawInspect, pid) {
		t.Fatalf("expected %s in plugin inspect: %s", pid, rawInspect)
	}

	runCLI(t, "--data-dir", dataDir, "--json", "plugin", "policy", pid, firstEventID, "ask")
	runCLI(t, "--data-dir", dataDir, "--json", "plugin", "reload", pid)
	runCLI(t, "--data-dir", dataDir, "--json", "plugin", "remove", pid, "--delete-files")
	if _, err := os.Stat(instOut.Plugin.LocalDir); !os.IsNotExist(err) {
		t.Fatalf("expected plugin dir %s to be deleted after --delete-files", instOut.Plugin.LocalDir)
	}

	// 7. skill list & skill show (verify Action-less guidance & no legacy actions: scaffold)
	rawSkillList, _ := runCLI(t, "--data-dir", dataDir, "--json", "skill", "list")
	if !strings.Contains(rawSkillList, "valet-plugin-dev") || !strings.Contains(rawSkillList, "valet-self-config") {
		t.Fatalf("expected built-in skills in skill list: %s", rawSkillList)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if code := cli.Run([]string{"--data-dir", dataDir, "skill", "show", "valet-plugin-dev"}, &stdout, &stderr); code != 0 {
		t.Fatalf("skill show valet-plugin-dev failed: %s", stderr.String())
	}
	skillPluginDev := stdout.String()
	if !strings.Contains(skillPluginDev, "script_poll") || !strings.Contains(skillPluginDev, "plugin_install") {
		t.Fatalf("expected Action-less keywords in valet-plugin-dev SKILL.md, got:\n%s", skillPluginDev)
	}
	if strings.Contains(skillPluginDev, "\nactions:\n") {
		t.Fatalf("valet-plugin-dev SKILL.md must not instruct legacy top-level actions: field")
	}

	stdout.Reset()
	stderr.Reset()
	if code := cli.Run([]string{"--data-dir", dataDir, "skill", "show", "valet-self-config"}, &stdout, &stderr); code != 0 {
		t.Fatalf("skill show valet-self-config failed: %s", stderr.String())
	}
	if !strings.Contains(stdout.String(), "valet config set") {
		t.Fatalf("expected valet config set in valet-self-config SKILL.md, got:\n%s", stdout.String())
	}
}

func TestCLILiveDaemonModeAndAuth(t *testing.T) {
	tmpRoot := t.TempDir()
	homeDir := filepath.Join(tmpRoot, "home")
	dataDir := filepath.Join(tmpRoot, "data")
	pluginDir := filepath.Join(tmpRoot, "daemon-probe")
	if err := os.MkdirAll(homeDir, 0o755); err != nil {
		t.Fatal(err)
	}

	svc := backend.NewService()
	if err := backend.StartService(svc, backend.StartOptions{
		DataDir:      dataDir,
		HomeDir:      homeDir,
		DesktopReady: false,
		UseVaultOnly: true,
	}); err != nil {
		t.Fatalf("StartService failed: %v", err)
	}
	defer func() {
		if err := backend.CloseService(svc); err != nil {
			t.Errorf("CloseService error: %v", err)
		}
	}()

	// 1. control.json permissions & unauthenticated rejection + no CORS header
	ctrlPath := filepath.Join(dataDir, configctl.ControlFileName)
	fi, err := os.Stat(ctrlPath)
	if err != nil {
		t.Fatalf("expected control.json at %s: %v", ctrlPath, err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("expected control.json mode 0600, got %#o", fi.Mode().Perm())
	}

	ctrl, err := configctl.ReadControlInfo(dataDir)
	if err != nil {
		t.Fatalf("ReadControlInfo failed: %v", err)
	}
	resp, err := http.Get(ctrl.BaseURL + "/api/v1/status")
	if err != nil {
		t.Fatalf("unauthenticated HTTP GET failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized without Bearer token, got %d", resp.StatusCode)
	}
	if acao := resp.Header.Get("Access-Control-Allow-Origin"); acao != "" {
		t.Fatalf("expected empty Access-Control-Allow-Origin on /api/v1/*, got %q", acao)
	}

	// 2. Live daemon CLI invocations
	_, stRes := runCLI(t, "--data-dir", dataDir, "--json", "status")
	if stRes["mode"] != "daemon" {
		t.Fatalf("expected daemon mode, got %#v", stRes)
	}

	runCLI(t, "--data-dir", dataDir, "--json", "config", "set", "userNickname=Master")

	const liveSecret = "sk-ant-secret-99998888"
	rawSetProv, _ := runCLI(t, "--data-dir", dataDir, "--json", "provider", "set", "anthropic", "--api-key", liveSecret)
	if strings.Contains(rawSetProv, liveSecret) {
		t.Fatalf("live provider set leaked plaintext apiKey: %s", rawSetProv)
	}
	rawListProv, _ := runCLI(t, "--data-dir", dataDir, "--json", "provider", "list")
	if strings.Contains(rawListProv, liveSecret) {
		t.Fatalf("live provider list leaked plaintext apiKey: %s", rawListProv)
	}

	// 2b. HTTP MCP add with --header and --headers
	runCLI(
		t,
		"--data-dir", dataDir,
		"--json",
		"mcp", "add",
		"--name", "tower",
		"--transport", "http",
		"--url", "https://example.invalid/mcp",
		"--header", "Authorization: Bearer tok123",
	)
	rawMcpList, _ := runCLI(t, "--data-dir", dataDir, "--json", "mcp", "list")
	if !strings.Contains(rawMcpList, "Bearer tok123") || !strings.Contains(rawMcpList, "tower") {
		t.Fatalf("expected mcp list to include Authorization header, got: %s", rawMcpList)
	}

	// 3. Plugin lifecycle in live daemon mode
	runCLI(t, "--json", "plugin", "init", pluginDir, "--template", "cron", "--name", "Daemon Probe")
	rawInst, _ := runCLI(t, "--data-dir", dataDir, "--json", "plugin", "install", pluginDir)
	var instOut struct {
		Plugin types.PluginState `json:"plugin"`
	}
	if err := json.Unmarshal([]byte(rawInst), &instOut); err != nil {
		t.Fatal(err)
	}
	pid := instOut.Plugin.ID

	snap, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot failed: %v", err)
	}
	if snap.Preferences.UserNickname != "Master" {
		t.Fatalf("expected live UserNickname=Master, got %q", snap.Preferences.UserNickname)
	}
	var foundLivePlugin bool
	for _, pl := range snap.Plugins {
		if pl.ID == pid {
			foundLivePlugin = true
			break
		}
	}
	if !foundLivePlugin {
		t.Fatalf("expected live snapshot to contain newly installed plugin %s", pid)
	}

	runCLI(t, "--data-dir", dataDir, "--json", "plugin", "reload", pid)
	runCLI(t, "--data-dir", dataDir, "--json", "plugin", "remove", pid, "--delete-files")

	snapAfter, err := svc.GetSnapshot()
	if err != nil {
		t.Fatalf("GetSnapshot after remove failed: %v", err)
	}
	for _, pl := range snapAfter.Plugins {
		if pl.ID == pid {
			t.Fatalf("expected removed plugin %s absent from live snapshot", pid)
		}
	}
}
