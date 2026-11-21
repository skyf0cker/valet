package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"valet/internal/configctl"
	"valet/internal/plugins"
	"valet/internal/types"
	skillsbundle "valet/skills"
)

const Version = "0.1.0"

type globalOpts struct {
	JSON    bool
	DataDir string
}

// Run executes the valet CLI with the provided arguments and output streams.
func Run(args []string, stdout, stderr io.Writer) int {
	opts, rest, err := parseGlobalFlags(args)
	if err != nil {
		fmt.Fprintf(stderr, "错误: %v\n", err)
		return 2
	}
	if len(rest) == 0 {
		printHelp(stdout)
		return 0
	}

	cmd := rest[0]
	subArgs := rest[1:]

	switch cmd {
	case "help", "--help", "-h":
		printHelp(stdout)
		return 0
	case "version", "--version", "-v":
		if opts.JSON {
			writeJSONOut(stdout, map[string]any{"ok": true, "version": Version})
		} else {
			fmt.Fprintf(stdout, "valet %s\n", Version)
		}
		return 0
	case "plugin":
		if len(subArgs) > 0 && (subArgs[0] == "init" || subArgs[0] == "validate") {
			code := runLocalPluginCmd(subArgs[0], subArgs[1:], opts, stdout, stderr)
			return code
		}
	}

	dataDir := configctl.ResolveDefaultDataDir(opts.DataDir)
	var b cliBackend
	if dc, _, ok := tryConnectDaemon(dataDir); ok {
		b = &daemonBackend{client: dc}
	} else {
		ob, oErr := openOfflineBackend(dataDir)
		if oErr != nil {
			failOut(stdout, stderr, opts.JSON, fmt.Errorf("打开 Valet 数据目录失败 (%s): %w", dataDir, oErr))
			return 1
		}
		b = ob
	}

	if err := dispatch(cmd, subArgs, b, opts, stdout); err != nil {
		failOut(stdout, stderr, opts.JSON, err)
		return 1
	}
	return 0
}

func parseGlobalFlags(args []string) (globalOpts, []string, error) {
	var opts globalOpts
	rest := make([]string, 0, len(args))
	stopFlags := false
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if stopFlags {
			rest = append(rest, arg)
			continue
		}
		if arg == "--" {
			stopFlags = true
			continue
		}
		switch {
		case arg == "--json":
			opts.JSON = true
		case strings.HasPrefix(arg, "--data-dir="):
			opts.DataDir = strings.TrimSpace(strings.TrimPrefix(arg, "--data-dir="))
			if opts.DataDir == "" {
				return opts, nil, errors.New("--data-dir 不能为空")
			}
		case arg == "--data-dir":
			if i+1 >= len(args) {
				return opts, nil, errors.New("--data-dir 缺少目录参数")
			}
			i++
			opts.DataDir = strings.TrimSpace(args[i])
			if opts.DataDir == "" {
				return opts, nil, errors.New("--data-dir 不能为空")
			}
		default:
			rest = append(rest, arg)
		}
	}
	return opts, rest, nil
}

func dispatch(cmd string, args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	switch cmd {
	case "status":
		res, err := b.status()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		return printStatusText(stdout, res)

	case "pause":
		res, err := b.setPaused(true)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "Valet 已暂停守护（mode=%s）\n", b.mode())
		return nil

	case "resume":
		res, err := b.setPaused(false)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "Valet 已恢复在岗守护（mode=%s）\n", b.mode())
		return nil

	case "config":
		return runConfigCmd(args, b, opts, stdout)

	case "model":
		return runModelCmd(args, b, opts, stdout)

	case "provider":
		return runProviderCmd(args, b, opts, stdout)

	case "heartbeat":
		return runHeartbeatCmd(args, b, opts, stdout)

	case "automation":
		return runAutomationCmd(args, b, opts, stdout)

	case "plugin":
		return runPluginCmd(args, b, opts, stdout)

	case "mcp":
		return runMcpCmd(args, b, opts, stdout)

	case "memory":
		return runMemoryCmd(args, b, opts, stdout)

	case "inbox":
		return runInboxCmd(args, b, opts, stdout)

	case "timeline":
		return runTimelineCmd(args, b, opts, stdout)

	case "skill":
		return runSkillCmd(args, b, opts, stdout)

	default:
		return fmt.Errorf("未知子命令 %q，运行 valet --help 查看可用命令", cmd)
	}
}

func runConfigCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("用法: valet config <show|get|set|schema|reset-thresholds>")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "show":
		section := ""
		for i := 0; i < len(rest); i++ {
			if rest[i] == "--section" {
				if i+1 >= len(rest) {
					return errors.New("--section 缺少参数")
				}
				i++
				section = rest[i]
			} else if strings.HasPrefix(rest[i], "--section=") {
				section = strings.TrimPrefix(rest[i], "--section=")
			} else if section == "" && !strings.HasPrefix(rest[i], "-") {
				section = rest[i]
			}
		}
		res, err := b.configGet(section)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		return printIndentedJSON(stdout, res["value"])

	case "get":
		key := ""
		if len(rest) > 0 {
			key = rest[0]
		}
		res, err := b.configGet(key)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		val := res["value"]
		switch v := val.(type) {
		case string:
			fmt.Fprintln(stdout, v)
		case bool, float64, int:
			fmt.Fprintln(stdout, v)
		default:
			return printIndentedJSON(stdout, val)
		}
		return nil

	case "set":
		if len(rest) == 0 {
			return errors.New("用法: valet config set <key>=<value> [...] 或 valet config set <key> <value>")
		}
		updates := map[string]string{}
		if len(rest) == 2 && !strings.Contains(rest[0], "=") {
			updates[rest[0]] = rest[1]
		} else {
			for _, item := range rest {
				k, v, ok := strings.Cut(item, "=")
				if !ok || strings.TrimSpace(k) == "" {
					return fmt.Errorf("参数 %q 必须是 <key>=<value> 格式", item)
				}
				updates[strings.TrimSpace(k)] = v
			}
		}
		res, err := b.configSet(updates)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		changes, _ := decodeAs[[]configctl.ChangeRecord](res["changes"])
		fmt.Fprintf(stdout, "已更新 %d 项配置（mode=%s）：\n", len(changes), b.mode())
		for _, ch := range changes {
			fmt.Fprintf(stdout, "  %s: %v -> %v\n", ch.Key, ch.OldValue, ch.NewValue)
		}
		return nil

	case "schema":
		res, err := b.configSchema()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		keys, _ := decodeAs[[]configctl.KeySpec](res["keys"])
		for _, k := range keys {
			extra := k.Type
			if len(k.Enum) > 0 {
				extra += " [" + strings.Join(k.Enum, "|") + "]"
			}
			sens := ""
			if k.Sensitive {
				sens = " (sensitive)"
			}
			fmt.Fprintf(stdout, "%-36s %-26s%s  %s\n", k.Key, extra, sens, k.Description)
		}
		return nil

	case "reset-thresholds":
		res, err := b.configResetThresholds()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已恢复默认监控阈值（mode=%s）\n", b.mode())
		return nil

	default:
		return fmt.Errorf("未知 config 子命令: %q", sub)
	}
}

func runModelCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("用法: valet model <show|set>")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "show":
		res, err := b.providersList()
		if err != nil {
			return err
		}
		models, _ := decodeAs[types.ModelSelection](res["models"])
		activeProvider, _ := res["activeProviderId"].(string)
		out := map[string]any{
			"ok":               true,
			"mode":             b.mode(),
			"activeProviderId": activeProvider,
			"models":           models,
		}
		if opts.JSON {
			return writeJSONOut(stdout, out)
		}
		fmt.Fprintf(stdout, "activeProviderId: %s\nprimary: %s\nfast:    %s\nvision:  %s\n",
			activeProvider, models.Primary, models.Fast, models.Vision)
		return nil

	case "set":
		var primary, fast, vision string
		for i := 0; i < len(rest); i++ {
			switch rest[i] {
			case "--primary":
				i++
				if i >= len(rest) {
					return errors.New("--primary 缺少模型 ID")
				}
				primary = rest[i]
			case "--fast":
				i++
				if i >= len(rest) {
					return errors.New("--fast 缺少模型 ID")
				}
				fast = rest[i]
			case "--vision":
				i++
				if i >= len(rest) {
					return errors.New("--vision 缺少模型 ID")
				}
				vision = rest[i]
			default:
				return fmt.Errorf("未知参数: %s", rest[i])
			}
		}
		if primary == "" && fast == "" && vision == "" {
			return errors.New("至少指定 --primary、--fast 或 --vision 之一")
		}
		res, err := b.modelsSet(primary, fast, vision)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		models, _ := decodeAs[types.ModelSelection](res["models"])
		fmt.Fprintf(stdout, "已更新模型分配（mode=%s）：primary=%s, fast=%s, vision=%s\n",
			b.mode(), models.Primary, models.Fast, models.Vision)
		return nil

	default:
		return fmt.Errorf("未知 model 子命令: %q", sub)
	}
}

func runProviderCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("用法: valet provider <list|select|set|verify>")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "list":
		res, err := b.providersList()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		active, _ := res["activeProviderId"].(string)
		list, _ := decodeAs[[]types.AgentProviderConfig](res["providers"])
		for _, p := range list {
			mark := " "
			if p.ID == active {
				mark = "*"
			}
			keyInfo := p.APIKeyMasked
			if keyInfo == "" {
				keyInfo = "(unset)"
			}
			fmt.Fprintf(stdout, "%s %-11s verified=%-5v key=%-14s base=%s\n",
				mark, p.ID, p.Verified, keyInfo, p.BaseURL)
		}
		return nil

	case "select":
		if len(rest) == 0 {
			return errors.New("用法: valet provider select <providerId>")
		}
		res, err := b.providerSelect(rest[0])
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已切换默认服务商为 %s（mode=%s）\n", rest[0], b.mode())
		return nil

	case "set":
		if len(rest) == 0 {
			return errors.New("用法: valet provider set <providerId> [--base-url ...] [--proxy-url ...] [--org-id ...] [--endpoint ...] [--models m1,m2] [--api-key-env ENV | --api-key KEY]")
		}
		pid := rest[0]
		body := map[string]any{"providerId": pid}
		changed := false
		for i := 1; i < len(rest); i++ {
			switch rest[i] {
			case "--base-url":
				i++
				if i >= len(rest) {
					return errors.New("--base-url 缺少值")
				}
				body["baseUrl"] = rest[i]
				changed = true
			case "--proxy-url":
				i++
				if i >= len(rest) {
					return errors.New("--proxy-url 缺少值")
				}
				body["proxyUrl"] = rest[i]
				changed = true
			case "--org-id":
				i++
				if i >= len(rest) {
					return errors.New("--org-id 缺少值")
				}
				body["orgId"] = rest[i]
				changed = true
			case "--endpoint":
				i++
				if i >= len(rest) {
					return errors.New("--endpoint 缺少值")
				}
				body["endpoint"] = rest[i]
				changed = true
			case "--models":
				i++
				if i >= len(rest) {
					return errors.New("--models 缺少逗号分隔模型列表")
				}
				var list []string
				for _, m := range strings.Split(rest[i], ",") {
					if s := strings.TrimSpace(m); s != "" {
						list = append(list, s)
					}
				}
				if len(list) == 0 {
					return errors.New("--models 不能为空")
				}
				body["models"] = list
				changed = true
			case "--api-key":
				i++
				if i >= len(rest) {
					return errors.New("--api-key 缺少值")
				}
				body["apiKey"] = rest[i]
				changed = true
			case "--api-key-env":
				i++
				if i >= len(rest) {
					return errors.New("--api-key-env 缺少环境变量名")
				}
				envName := strings.TrimSpace(rest[i])
				val := strings.TrimSpace(os.Getenv(envName))
				if val == "" {
					return fmt.Errorf("环境变量 %q 未设置或为空", envName)
				}
				body["apiKey"] = val
				changed = true
			default:
				return fmt.Errorf("未知参数: %s", rest[i])
			}
		}
		if !changed {
			return errors.New("未提供任何需要更新的字段")
		}
		res, err := b.providerUpdate(body)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		p, _ := decodeAs[types.AgentProviderConfig](res["provider"])
		fmt.Fprintf(stdout, "已更新服务商 %s：key=%s base=%s（mode=%s）\n", p.ID, p.APIKeyMasked, p.BaseURL, b.mode())
		return nil

	case "verify":
		pid := ""
		if len(rest) > 0 {
			pid = rest[0]
		}
		res, err := b.providerVerify(pid)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		vr, _ := decodeAs[types.ProviderVerifyResult](res["result"])
		fmt.Fprintf(stdout, "服务商验证 (%v): ok=%v · %s\n", res["providerId"], vr.OK, vr.Message)
		return nil

	default:
		return fmt.Errorf("未知 provider 子命令: %q", sub)
	}
}

func runHeartbeatCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("用法: valet heartbeat <status|set|run|logs>")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "status":
		res, err := b.heartbeatStatus()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		cfg, _ := decodeAs[types.AgentHeartbeatConfig](res["config"])
		logs, _ := decodeAs[[]types.HeartbeatRunLog](res["logs"])
		fmt.Fprintf(stdout, "enabled=%v  intervalMin=%d  lastRunAt=%s  logs=%d\nprompt: %s\n",
			cfg.Enabled, cfg.IntervalMin, emptyDash(cfg.LastRunAt), len(logs), cfg.Prompt)
		return nil

	case "set":
		var enabled *bool
		var interval *int
		var prompt *string
		for i := 0; i < len(rest); i++ {
			switch rest[i] {
			case "--enabled":
				i++
				if i >= len(rest) {
					return errors.New("--enabled 缺少 true/false")
				}
				v, err := strconv.ParseBool(rest[i])
				if err != nil {
					return fmt.Errorf("--enabled 值无效: %q", rest[i])
				}
				enabled = &v
			case "--interval":
				i++
				if i >= len(rest) {
					return errors.New("--interval 缺少分钟数")
				}
				n, err := strconv.Atoi(rest[i])
				if err != nil {
					return fmt.Errorf("--interval 值无效: %q", rest[i])
				}
				interval = &n
			case "--prompt":
				i++
				if i >= len(rest) {
					return errors.New("--prompt 缺少内容")
				}
				v := rest[i]
				prompt = &v
			default:
				return fmt.Errorf("未知参数: %s", rest[i])
			}
		}
		if enabled == nil && interval == nil && prompt == nil {
			return errors.New("至少指定 --enabled、--interval 或 --prompt 之一")
		}
		res, err := b.heartbeatSet(enabled, interval, prompt)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		cfg, _ := decodeAs[types.AgentHeartbeatConfig](res["config"])
		fmt.Fprintf(stdout, "已更新心跳配置：enabled=%v intervalMin=%d（mode=%s）\n", cfg.Enabled, cfg.IntervalMin, b.mode())
		return nil

	case "run":
		res, err := b.heartbeatRun()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintln(stdout, "已完成一次主动心跳巡检。")
		return nil

	case "logs":
		clear := false
		for _, a := range rest {
			if a == "--clear" {
				clear = true
			}
		}
		if clear {
			res, err := b.heartbeatClearLogs()
			if err != nil {
				return err
			}
			if opts.JSON {
				return writeJSONOut(stdout, res)
			}
			fmt.Fprintf(stdout, "已清空心跳巡检日志（mode=%s）\n", b.mode())
			return nil
		}
		res, err := b.heartbeatStatus()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, map[string]any{"ok": true, "logs": res["logs"]})
		}
		logs, _ := decodeAs[[]types.HeartbeatRunLog](res["logs"])
		if len(logs) == 0 {
			fmt.Fprintln(stdout, "暂无心跳日志。")
			return nil
		}
		for _, lg := range logs {
			fmt.Fprintf(stdout, "[%s] (%s) %s — %s\n", lg.CreatedAt, lg.Status, lg.Model, lg.Summary)
		}
		return nil

	default:
		return fmt.Errorf("未知 heartbeat 子命令: %q", sub)
	}
}

func runAutomationCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("用法: valet automation <list|add|enable|disable|run|remove>")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "list":
		res, err := b.automationList()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		list, _ := decodeAs[[]types.AutomationRule](res["automations"])
		if len(list) == 0 {
			fmt.Fprintln(stdout, "暂无自动化规则。")
			return nil
		}
		for _, a := range list {
			fmt.Fprintf(stdout, "%-20s enabled=%-5v cron=%-12s %s\n", a.ID, a.Enabled, a.CronExpr, a.Title)
		}
		return nil

	case "add":
		var rule types.AutomationRule
		rule.Enabled = true
		rule.TriggerType = "cron"
		when := ""
		for i := 0; i < len(rest); i++ {
			switch rest[i] {
			case "--title":
				i++
				if i >= len(rest) {
					return errors.New("--title 缺少参数")
				}
				rule.Title = rest[i]
			case "--cron":
				i++
				if i >= len(rest) {
					return errors.New("--cron 缺少参数")
				}
				rule.CronExpr = rest[i]
			case "--prompt":
				i++
				if i >= len(rest) {
					return errors.New("--prompt 缺少参数")
				}
				rule.Prompt = rest[i]
			case "--subtitle":
				i++
				if i >= len(rest) {
					return errors.New("--subtitle 缺少参数")
				}
				rule.Subtitle = rest[i]
			case "--when":
				i++
				if i >= len(rest) {
					return errors.New("--when 缺少参数")
				}
				when = rest[i]
			default:
				return fmt.Errorf("未知参数: %s", rest[i])
			}
		}
		if strings.TrimSpace(rule.Title) == "" {
			return errors.New("用法: valet automation add --title \"...\" [--cron \"0 9 * * *\"] [--prompt \"...\"] [--when \"...\"]")
		}
		if when != "" {
			top, bottom, ok := strings.Cut(when, " ")
			if ok {
				rule.ScheduleTop = top
				rule.ScheduleBottom = bottom
			} else {
				rule.ScheduleTop = when
				rule.ScheduleBottom = rule.CronExpr
			}
		} else if rule.CronExpr != "" {
			rule.ScheduleTop = "Cron"
			rule.ScheduleBottom = rule.CronExpr
		}
		res, err := b.automationAdd(rule)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已添加自动化规则「%s」（mode=%s）\n", rule.Title, b.mode())
		return nil

	case "enable", "disable":
		if len(rest) == 0 {
			return fmt.Errorf("用法: valet automation %s <id>", sub)
		}
		res, err := b.automationEnable(rest[0], sub == "enable")
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已%s自动化规则 %s\n", map[bool]string{true: "启用", false: "停用"}[sub == "enable"], rest[0])
		return nil

	case "run":
		if len(rest) == 0 {
			return errors.New("用法: valet automation run <id>")
		}
		res, err := b.automationRun(rest[0])
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已执行自动化规则 %s\n", rest[0])
		return nil

	case "remove":
		if len(rest) == 0 {
			return errors.New("用法: valet automation remove <id>")
		}
		res, err := b.automationRemove(rest[0])
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已移除自动化规则 %s\n", rest[0])
		return nil

	default:
		return fmt.Errorf("未知 automation 子命令: %q", sub)
	}
}

func runLocalPluginCmd(sub string, rest []string, opts globalOpts, stdout, stderr io.Writer) int {
	switch sub {
	case "init":
		if len(rest) == 0 {
			failOut(stdout, stderr, opts.JSON, errors.New("用法: valet plugin init <dir-or-slug> [--template fs_watch|command_poll|http_poll|webhook|cron] [--name \"...\"]"))
			return 1
		}
		target := ""
		tmpl := "command_poll"
		customName := ""
		for i := 0; i < len(rest); i++ {
			switch rest[i] {
			case "--template":
				i++
				if i >= len(rest) {
					failOut(stdout, stderr, opts.JSON, errors.New("--template 缺少模板名称"))
					return 1
				}
				tmpl = rest[i]
			case "--name":
				i++
				if i >= len(rest) {
					failOut(stdout, stderr, opts.JSON, errors.New("--name 缺少名称"))
					return 1
				}
				customName = strings.TrimSpace(rest[i])
			default:
				if strings.HasPrefix(rest[i], "-") {
					failOut(stdout, stderr, opts.JSON, fmt.Errorf("未知参数: %s", rest[i]))
					return 1
				}
				if target == "" {
					target = rest[i]
				}
			}
		}
		if target == "" {
			failOut(stdout, stderr, opts.JSON, errors.New("缺少插件目录或 slug"))
			return 1
		}
		absDir, err := resolveLocalPath(target)
		if err != nil {
			failOut(stdout, stderr, opts.JSON, err)
			return 1
		}
		slug := plugins.NormalizeSlug(filepath.Base(absDir))
		if err := plugins.ScaffoldPluginBundle(absDir, slug, tmpl); err != nil {
			failOut(stdout, stderr, opts.JSON, err)
			return 1
		}
		if customName != "" {
			mPath := filepath.Join(absDir, "manifest.yaml")
			if raw, rErr := os.ReadFile(mPath); rErr == nil {
				updated := strings.Replace(string(raw), "name: "+slug, "name: "+customName, 1)
				_ = os.WriteFile(mPath, []byte(updated), 0o644)
			}
		}
		res := map[string]any{
			"ok":       true,
			"dir":      absDir,
			"slug":     slug,
			"template": tmpl,
			"files":    []string{"manifest.yaml", "SKILL.md"},
		}
		if opts.JSON {
			_ = writeJSONOut(stdout, res)
		} else {
			fmt.Fprintf(stdout, "已在 %s 初始化插件模板 (%s)：\n  - manifest.yaml\n  - SKILL.md\n下一步：valet plugin validate %s && valet plugin install %s\n",
				absDir, tmpl, absDir, absDir)
		}
		return 0

	case "validate":
		if len(rest) == 0 {
			failOut(stdout, stderr, opts.JSON, errors.New("用法: valet plugin validate <dir-or-manifest>"))
			return 1
		}
		absPath, err := resolveLocalPath(rest[0])
		if err != nil {
			failOut(stdout, stderr, opts.JSON, err)
			return 1
		}
		manifestYAML, skillMD, parsed, files, err := plugins.ReadPluginBundle(absPath)
		if err != nil {
			failOut(stdout, stderr, opts.JSON, err)
			return 1
		}
		_ = manifestYAML
		res := map[string]any{
			"ok":           true,
			"id":           parsed.ID,
			"name":         parsed.Name,
			"version":      parsed.Version,
			"triggers":     parsed.TriggerSpecs,
			"configSchema": parsed.ConfigSchema,
			"permissions":  parsed.Permissions,
			"hasSkill":     strings.TrimSpace(skillMD) != "",
			"files":        files,
		}
		if opts.JSON {
			_ = writeJSONOut(stdout, res)
		} else {
			fmt.Fprintf(stdout, "校验通过：%s (%s v%s) · triggers=%d configSchema=%d files=%d hasSkill=%v\n",
				parsed.Name, parsed.ID, parsed.Version, len(parsed.TriggerSpecs), len(parsed.ConfigSchema), len(files), strings.TrimSpace(skillMD) != "")
		}
		return 0
	}
	return 1
}

func runPluginCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("用法: valet plugin <list|inspect|init|validate|install|reload|enable|disable|policy|trigger|remove>")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "list":
		res, err := b.pluginList()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		list, _ := decodeAs[[]types.PluginState](res["plugins"])
		for _, p := range list {
			fmt.Fprintf(stdout, "%-22s source=%-9s enabled=%-5v triggers=%d configSchema=%d files=%d  %s\n",
				p.ID, p.Source, p.Enabled, len(p.Events), len(p.ConfigSchema), len(p.BundledFiles), p.Name)
		}
		return nil

	case "inspect":
		if len(rest) == 0 {
			return errors.New("用法: valet plugin inspect <pluginId>")
		}
		res, err := b.pluginInspect(rest[0])
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		p, _ := decodeAs[types.PluginState](res["plugin"])
		files, _ := decodeAs[[]string](res["files"])
		fmt.Fprintf(stdout, "ID:      %s (%s v%s)\nSource:  %s  Enabled: %v\nDir:     %s\nEvents:\n",
			p.ID, p.Name, p.Version, p.Source, p.Enabled, emptyDash(p.LocalDir))
		for _, ev := range p.Events {
			fmt.Fprintf(stdout, "  - %-24s policy=%-6s sensor=%s  %s\n", ev.ID, ev.Policy, ev.Sensor, ev.Description)
		}
		if len(p.ConfigSchema) > 0 {
			fmt.Fprintf(stdout, "ConfigSchema:\n")
			for _, cf := range p.ConfigSchema {
				fmt.Fprintf(stdout, "  - %-24s type=%-8s %s\n", cf.Key, cf.Type, cf.Label)
			}
		}
		if len(files) > 0 {
			fmt.Fprintf(stdout, "Files:   %s\n", strings.Join(files, ", "))
		}
		return nil

	case "install":
		if len(rest) == 0 {
			return errors.New("用法: valet plugin install <dir-or-manifest> [--slug ...] [--name ...] [--tagline ...] [--skill-file ...]")
		}
		var dirArg, slug, name, tagline, skillFile string
		for i := 0; i < len(rest); i++ {
			switch rest[i] {
			case "--slug":
				i++
				if i >= len(rest) {
					return errors.New("--slug 缺少值")
				}
				slug = rest[i]
			case "--name":
				i++
				if i >= len(rest) {
					return errors.New("--name 缺少值")
				}
				name = rest[i]
			case "--tagline":
				i++
				if i >= len(rest) {
					return errors.New("--tagline 缺少值")
				}
				tagline = rest[i]
			case "--skill-file":
				i++
				if i >= len(rest) {
					return errors.New("--skill-file 缺少路径")
				}
				absSkill, err := resolveLocalPath(rest[i])
				if err != nil {
					return err
				}
				skillFile = absSkill
			default:
				if strings.HasPrefix(rest[i], "-") {
					return fmt.Errorf("未知参数: %s", rest[i])
				}
				if dirArg == "" {
					dirArg = rest[i]
				}
			}
		}
		if dirArg == "" {
			return errors.New("缺少插件目录或 manifest.yaml 路径")
		}
		absDir, err := resolveLocalPath(dirArg)
		if err != nil {
			return err
		}
		res, err := b.pluginInstallDir(absDir, slug, name, tagline, skillFile)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		p, _ := decodeAs[types.PluginState](res["plugin"])
		fmt.Fprintf(stdout, "已安装并加载插件 %s (%s) -> %s（mode=%s）\n", p.ID, p.Name, p.LocalDir, b.mode())
		return nil

	case "reload":
		pid := ""
		if len(rest) > 0 {
			pid = rest[0]
		}
		res, err := b.pluginReload(pid)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已完成插件热重载（mode=%s）\n", b.mode())
		return nil

	case "enable", "disable":
		if len(rest) == 0 {
			return fmt.Errorf("用法: valet plugin %s <pluginId>", sub)
		}
		res, err := b.pluginEnable(rest[0], sub == "enable")
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已%s插件 %s（mode=%s）\n", map[bool]string{true: "启用", false: "停用"}[sub == "enable"], rest[0], b.mode())
		return nil

	case "policy":
		if len(rest) < 3 {
			return errors.New("用法: valet plugin policy <pluginId> <eventId> <auto|ask|record>")
		}
		res, err := b.pluginPolicy(rest[0], rest[1], rest[2])
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已更新 %s / %s 响应策略为 %s（mode=%s）\n", rest[0], rest[1], rest[2], b.mode())
		return nil

	case "trigger":
		if len(rest) < 2 {
			return errors.New("用法: valet plugin trigger <pluginId> <eventId> [--payload '{...}']")
		}
		pid, evID := rest[0], rest[1]
		payload := ""
		for i := 2; i < len(rest); i++ {
			if rest[i] == "--payload" {
				i++
				if i >= len(rest) {
					return errors.New("--payload 缺少 JSON 字符串")
				}
				payload = rest[i]
			} else if strings.HasPrefix(rest[i], "--payload=") {
				payload = strings.TrimPrefix(rest[i], "--payload=")
			} else {
				return fmt.Errorf("未知参数: %s", rest[i])
			}
		}
		res, err := b.pluginTrigger(pid, evID, payload)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已触发事件 %s / %s\n", pid, evID)
		return nil

	case "remove":
		if len(rest) == 0 {
			return errors.New("用法: valet plugin remove <pluginId> [--delete-files]")
		}
		pid := rest[0]
		delFiles := false
		for _, a := range rest[1:] {
			if a == "--delete-files" {
				delFiles = true
			}
		}
		res, err := b.pluginRemove(pid, delFiles)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已移除本地插件 %s（deleteFiles=%v, mode=%s）\n", pid, delFiles, b.mode())
		return nil

	default:
		return fmt.Errorf("未知 plugin 子命令: %q", sub)
	}
}

func runMcpCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("用法: valet mcp <list|add|enable|disable|reconnect|remove>")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "list":
		res, err := b.mcpList()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		list, _ := decodeAs[[]types.McpServerItem](res["mcpServers"])
		if len(list) == 0 {
			fmt.Fprintln(stdout, "暂无已配置的 MCP 服务器。")
			return nil
		}
		for _, m := range list {
			fmt.Fprintf(stdout, "%-20s enabled=%-5v tools=%-3d %s (%s)\n", m.ID, m.Enabled, m.ToolCount, m.Name, m.TransportLabel)
		}
		return nil

	case "add":
		var srv types.McpServerItem
		for i := 0; i < len(rest); i++ {
			switch rest[i] {
			case "--name":
				i++
				if i >= len(rest) {
					return errors.New("--name 缺少名称")
				}
				srv.Name = rest[i]
			case "--transport":
				i++
				if i >= len(rest) {
					return errors.New("--transport 缺少 stdio|http")
				}
				srv.Transport = rest[i]
			case "--command":
				i++
				if i >= len(rest) {
					return errors.New("--command 缺少命令")
				}
				srv.Command = rest[i]
			case "--args":
				i++
				if i >= len(rest) {
					return errors.New("--args 缺少参数")
				}
				srv.Args = append(srv.Args, parseCliArgsList(rest[i])...)
			case "--url":
				i++
				if i >= len(rest) {
					return errors.New("--url 缺少地址")
				}
				srv.URL = rest[i]
			case "--header":
				i++
				if i >= len(rest) {
					return errors.New("--header 缺少请求头（格式 \"Key: Value\"）")
				}
				hk, hv, ok := strings.Cut(rest[i], ":")
				hk = strings.TrimSpace(hk)
				hv = strings.TrimSpace(hv)
				if !ok || hk == "" {
					return fmt.Errorf("--header 格式无效 %q，应为 \"Key: Value\"", rest[i])
				}
				if srv.Headers == nil {
					srv.Headers = map[string]string{}
				}
				srv.Headers[hk] = hv
			case "--headers":
				i++
				if i >= len(rest) {
					return errors.New("--headers 缺少 JSON 对象")
				}
				var parsedHeaders map[string]string
				if err := json.Unmarshal([]byte(rest[i]), &parsedHeaders); err != nil {
					return fmt.Errorf("--headers JSON 解析失败: %w", err)
				}
				if srv.Headers == nil {
					srv.Headers = map[string]string{}
				}
				for hk, hv := range parsedHeaders {
					if tk := strings.TrimSpace(hk); tk != "" {
						srv.Headers[tk] = strings.TrimSpace(hv)
					}
				}
			default:
				return fmt.Errorf("未知参数: %s", rest[i])
			}
		}
		if strings.TrimSpace(srv.Name) == "" {
			return errors.New("用法: valet mcp add --name \"...\" --transport stdio|http [--command ... --args ...] [--url ... --header \"Key: Value\"]")
		}
		res, err := b.mcpAdd(srv)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已添加 MCP 服务器「%s」（mode=%s）\n", srv.Name, b.mode())
		return nil

	case "enable", "disable":
		if len(rest) == 0 {
			return fmt.Errorf("用法: valet mcp %s <id>", sub)
		}
		res, err := b.mcpEnable(rest[0], sub == "enable")
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已%s MCP %s\n", map[bool]string{true: "启用", false: "停用"}[sub == "enable"], rest[0])
		return nil

	case "reconnect":
		if len(rest) == 0 {
			return errors.New("用法: valet mcp reconnect <id>")
		}
		res, err := b.mcpReconnect(rest[0])
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已重新探测 MCP %s\n", rest[0])
		return nil

	case "remove":
		if len(rest) == 0 {
			return errors.New("用法: valet mcp remove <id>")
		}
		res, err := b.mcpRemove(rest[0])
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已移除 MCP %s\n", rest[0])
		return nil

	default:
		return fmt.Errorf("未知 mcp 子命令: %q", sub)
	}
}

func runMemoryCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("用法: valet memory <list|add|remove|clear>")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "list":
		res, err := b.memoryList()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		list, _ := decodeAs[[]types.MemoryEntry](res["memories"])
		if len(list) == 0 {
			fmt.Fprintln(stdout, "暂无长期记忆。")
			return nil
		}
		for _, m := range list {
			fmt.Fprintf(stdout, "%-20s [%s · %s] %s\n", m.ID, m.CreatedAt, m.Source, m.Content)
		}
		return nil

	case "add":
		content := ""
		source := ""
		for i := 0; i < len(rest); i++ {
			if rest[i] == "--source" {
				i++
				if i >= len(rest) {
					return errors.New("--source 缺少来源标签")
				}
				source = rest[i]
			} else if content == "" {
				content = rest[i]
			}
		}
		if strings.TrimSpace(content) == "" {
			return errors.New("用法: valet memory add \"<内容>\" [--source \"...\"]")
		}
		res, err := b.memoryAdd(content, source)
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已保存记忆（mode=%s）\n", b.mode())
		return nil

	case "remove":
		if len(rest) == 0 {
			return errors.New("用法: valet memory remove <id>")
		}
		res, err := b.memoryRemove(rest[0])
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已删除记忆 %s\n", rest[0])
		return nil

	case "clear":
		res, err := b.memoryClear()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		fmt.Fprintf(stdout, "已清空长期记忆（mode=%s）\n", b.mode())
		return nil

	default:
		return fmt.Errorf("未知 memory 子命令: %q", sub)
	}
}

func runInboxCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) > 0 && args[0] != "list" {
		return fmt.Errorf("未知 inbox 子命令: %q（支持 valet inbox list）", args[0])
	}
	res, err := b.inboxList()
	if err != nil {
		return err
	}
	if opts.JSON {
		return writeJSONOut(stdout, res)
	}
	items, _ := decodeAs[[]types.InboxApprovalItem](res["inboxItems"])
	if len(items) == 0 {
		fmt.Fprintln(stdout, "收件箱为空。")
		return nil
	}
	for _, it := range items {
		fmt.Fprintf(stdout, "%-20s [%s] %-10s %s — %s\n", it.ID, it.TimeLabel, it.Status, it.Title, it.Summary)
	}
	return nil
}

func runTimelineCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	rest := args
	if len(rest) > 0 && rest[0] == "list" {
		rest = rest[1:]
	} else if len(rest) > 0 && !strings.HasPrefix(rest[0], "-") {
		return fmt.Errorf("未知 timeline 子命令: %q（支持 valet timeline list）", rest[0])
	}
	limit := 20
	for i := 0; i < len(rest); i++ {
		if rest[i] == "--limit" {
			i++
			if i >= len(rest) {
				return errors.New("--limit 缺少数字")
			}
			n, err := strconv.Atoi(rest[i])
			if err != nil || n <= 0 {
				return fmt.Errorf("--limit 值无效: %q", rest[i])
			}
			limit = n
		}
	}
	res, err := b.timelineList(limit)
	if err != nil {
		return err
	}
	if opts.JSON {
		return writeJSONOut(stdout, res)
	}
	evs, _ := decodeAs[[]types.TimelineEvent](res["timelineEvents"])
	if len(evs) == 0 {
		fmt.Fprintln(stdout, "时间线暂无事件。")
		return nil
	}
	for _, ev := range evs {
		fmt.Fprintf(stdout, "[%s] %-15s %-18s %s\n", ev.TimeLabel, ev.Status, ev.PluginID, ev.Title)
	}
	return nil
}

func runSkillCmd(args []string, b cliBackend, opts globalOpts, stdout io.Writer) error {
	if len(args) == 0 || args[0] == "list" {
		res, err := b.skillList()
		if err != nil {
			return err
		}
		if opts.JSON {
			return writeJSONOut(stdout, res)
		}
		skills, _ := decodeAs[[]types.BuiltinSkillMeta](res["skills"])
		for _, sk := range skills {
			fmt.Fprintf(stdout, "%-22s [%s] %s\n", sk.Name, sk.Source, sk.Title)
		}
		return nil
	}
	if args[0] == "show" {
		if len(args) < 2 {
			return errors.New("用法: valet skill show <name>")
		}
		target := strings.TrimSpace(args[1])
		res, err := b.skillList()
		if err != nil {
			return err
		}
		skills, _ := decodeAs[[]types.BuiltinSkillMeta](res["skills"])
		for _, sk := range skills {
			if strings.EqualFold(sk.Name, target) {
				if opts.JSON {
					return writeJSONOut(stdout, map[string]any{"ok": true, "mode": b.mode(), "skill": sk})
				}
				fmt.Fprintln(stdout, sk.Content)
				return nil
			}
		}
		// Fallback to inspecting plugin SkillMarkdown
		if pRes, pErr := b.pluginInspect(target); pErr == nil {
			if p, dErr := decodeAs[types.PluginState](pRes["plugin"]); dErr == nil {
				sk := types.BuiltinSkillMeta{
					Name:        p.ID,
					Title:       p.Name,
					Description: p.Tagline,
					Content:     p.SkillMarkdown,
					Source:      "plugin",
				}
				if opts.JSON {
					return writeJSONOut(stdout, map[string]any{"ok": true, "mode": b.mode(), "skill": sk})
				}
				fmt.Fprintln(stdout, sk.Content)
				return nil
			}
		}
		// Embedded fallback if API didn't include it
		if sk, ok := skillsbundle.Lookup(target); ok {
			if opts.JSON {
				return writeJSONOut(stdout, map[string]any{"ok": true, "mode": b.mode(), "skill": sk})
			}
			fmt.Fprintln(stdout, sk.Content)
			return nil
		}
		return fmt.Errorf("未找到 Skill: %q", target)
	}
	return fmt.Errorf("未知 skill 子命令: %q（支持 list | show）", args[0])
}

func printStatusText(w io.Writer, res map[string]any) error {
	mode, _ := res["mode"].(string)
	dataDir, _ := res["dataDir"].(string)
	activeProv, _ := res["activeProviderId"].(string)
	autonomy, _ := res["autonomyLevel"].(string)
	appearance, _ := res["appearance"].(string)
	paused, _ := res["isPaused"].(bool)
	webhook, _ := res["webhookEndpoint"].(string)
	models, _ := decodeAs[types.ModelSelection](res["models"])
	counts, _ := decodeAs[map[string]int](res["counts"])
	fmt.Fprintf(w, "Valet Status (mode=%s, onDuty=%v)\n", mode, !paused)
	fmt.Fprintf(w, "  dataDir:     %s\n", dataDir)
	if webhook != "" {
		fmt.Fprintf(w, "  webhook:     %s\n", webhook)
	}
	fmt.Fprintf(w, "  provider:    %s (primary=%s, fast=%s)\n", activeProv, models.Primary, models.Fast)
	fmt.Fprintf(w, "  safety:      autonomy=%s  appearance=%s\n", autonomy, appearance)
	if len(counts) > 0 {
		keys := make([]string, 0, len(counts))
		for k := range counts {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, fmt.Sprintf("%s=%d", k, counts[k]))
		}
		fmt.Fprintf(w, "  counts:      %s\n", strings.Join(parts, ", "))
	}
	return nil
}

func parseCliArgsList(raw string) []string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	if strings.HasPrefix(s, "[") {
		var list []string
		if err := json.Unmarshal([]byte(s), &list); err == nil {
			return list
		}
	}
	if strings.Contains(s, ",") {
		parts := strings.Split(s, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if t := strings.TrimSpace(p); t != "" {
				out = append(out, t)
			}
		}
		return out
	}
	return strings.Fields(s)
}

func resolveLocalPath(raw string) (string, error) {
	p := strings.TrimSpace(raw)
	if p == "" {
		return "", errors.New("路径不能为空")
	}
	if p == "~" || strings.HasPrefix(p, "~/") {
		home, err := os.UserHomeDir()
		if err == nil && home != "" {
			if p == "~" {
				p = home
			} else {
				p = filepath.Join(home, p[2:])
			}
		}
	}
	return filepath.Abs(p)
}

func decodeAs[T any](v any) (T, error) {
	var zero T
	if v == nil {
		return zero, nil
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return zero, err
	}
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		return zero, err
	}
	return out, nil
}

func writeJSONOut(w io.Writer, payload any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(payload)
}

func printIndentedJSON(w io.Writer, val any) error {
	return writeJSONOut(w, val)
}

func failOut(stdout, stderr io.Writer, asJSON bool, err error) {
	if asJSON {
		_ = writeJSONOut(stdout, map[string]any{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}
	fmt.Fprintf(stderr, "错误: %v\n", err)
}

func emptyDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

func printHelp(w io.Writer) {
	fmt.Fprint(w, `valet — Valet 桌面守护与自配置 CLI

全局参数:
  --json                 以结构化 JSON 输出结果
  --data-dir <dir>       指定 Valet 数据目录（默认自动识别当前运行实例或 ~/.valet-data）

核心命令:
  valet status                               查看在岗状态、模型、统计与控制模式（daemon/offline）
  valet pause | resume                       暂停 / 恢复 Valet 主动守护

  valet config show [--section <sec>]        查看全部或指定分区配置
  valet config get <key>                     读取单个配置点路径
  valet config set <key>=<value> [...]       校验并更新一个或多个配置项（支持 slice +item/-item）
  valet config schema                        列出所有可配置键、类型、枚举与敏感标记
  valet config reset-thresholds              恢复默认监测阈值

  valet model show                           查看当前主/快/视觉模型分配
  valet model set [--primary ..] [--fast ..] [--vision ..]

  valet provider list                        列出服务商连接与验证状态（API Key 已脱敏）
  valet provider select <id>                 切换默认服务商
  valet provider set <id> [--base-url ..] [--proxy-url ..] [--org-id ..] [--models m1,m2] [--api-key-env ENV]
  valet provider verify [<id>]               探测验证服务商接口连通性

  valet heartbeat status                     查看心跳配置与近期巡检记录
  valet heartbeat set [--enabled bool] [--interval min] [--prompt "..."]
  valet heartbeat run | logs [--clear]       立即巡检或查看/清空心跳日志

  valet automation list                      列出定时/事件自动化规则
  valet automation add --title "..." --cron "..." --prompt "..." [--when "..."]
  valet automation enable|disable|run|remove <id>

  valet plugin list                          列出核心/社区/本地插件
  valet plugin inspect <id>                  查看插件清单、事件、动作与本地目录
  valet plugin init <dir-or-slug> [--template fs_watch|command_poll|http_poll|webhook|cron]
  valet plugin validate <dir-or-manifest>    离线校验 manifest.yaml 与 SKILL.md
  valet plugin install <dir-or-manifest>     安装/更新本地插件并热加载传感器与 Agent 工具
  valet plugin reload [<id>]                 从磁盘热重载指定或全部本地插件
  valet plugin enable|disable <id>
  valet plugin policy <id> <eventId> <auto|ask|record>
  valet plugin trigger <id> <eventId> [--payload '{...}']
  valet plugin remove <id> [--delete-files]

  valet mcp list | add | enable | disable | reconnect | remove
  valet memory list | add "<text>" [--source "..."] | remove <id> | clear
  valet inbox list | timeline list [--limit N]
  valet skill list | skill show <name>       查看内置技能手册（valet-plugin-dev / valet-self-config）
`)
}
