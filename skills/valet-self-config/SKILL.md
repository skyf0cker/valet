---
name: valet-self-config
description: 使用 valet CLI 安全查看、诊断和配置 Valet 自身设置（外观、模型与服务商、心跳、阈值、自动化规则、MCP 服务、记忆与插件管理）的内置技能手册。
---

# `valet` CLI 自配置与控制手册

`valet` 是 Valet 内置的命令行工具，可用于查看运行状态、读取与修改设置、管理模型/心跳/定时自动化/MCP/记忆以及插件生命周期。

- **双模自动切换**：当 Valet 桌面客户端正在运行时，`valet` CLI 通过本地带鉴权的控制 API 实时热更新运行中的 UI、传感器与 Agent；当桌面端未运行时，自动回退读写 `<VALET_DATA_DIR>/state.json` 并在下次启动时生效。
- 在内置 `bash` 工具中，`valet` 命令、`VALET_DATA_DIR` 和 `VALET_CONTROL_FILE` 均已自动配置到环境变量中，可直接执行。

---

## 一、核心诊断与配置查看命令（只读，安全网关直接放行）

```bash
# 查看运行态概览（在岗/暂停、服务商与模型、事件统计、Webhook 地址、DataDir）
valet status --json

# 查看当前配置（支持按分区过滤）
valet config show --json
valet config show --section heartbeat
valet config get appearance
valet config get heartbeat.intervalMin

# 列出所有支持修改的配置项点路径、类型与合法枚举值
valet config schema

# 查看其他核心资源
valet model show
valet provider list
valet heartbeat status
valet heartbeat logs
valet automation list
valet plugin list
valet plugin inspect <pluginId>
valet mcp list
valet memory list
valet inbox list
valet timeline list --limit 20
valet skill list
```

---

## 二、支持修改的配置键（`valet config set key=value ...`）

支持一次传入多个 `key=value`（或单条 `valet config set <key> <value>`）；对于数组字段（`string[]`），支持 JSON 数组 `["a","b"]`、逗号分隔 `"a,b"`，或增量语法 `"+Docker"` / `"-ffmpeg"`。

### 1. 通用与外观 (`general`)
| Key | 类型 / 合法值 | 说明 |
| :--- | :--- | :--- |
| `launchAtLogin` | `true` \| `false` | 开机自启 |
| `showMenuBarIcon` | `true` \| `false` | 菜单栏图标驻留 |
| `appearance` | `light` \| `dark` \| `auto` | 外观主题（浅色/深色/跟随系统） |
| `darkTheme` | `obsidian` \| `espresso` \| `chronometer` | 深色主题配色（午夜黑曜石 / 暖岩黑胡桃 / 深松怀表） |
| `language` | `string` | 界面语言（如 `简体中文`、`English`） |
| `busyMessagePolicy` | `queue` \| `steer` | 运行中发消息策略（排队 / 立即插话） |

### 2. 人格、模型预算与记忆 (`persona` / `models` / `memory`)
| Key | 类型 / 合法值 | 说明 |
| :--- | :--- | :--- |
| `userNickname` | `string` | 对你的称呼 |
| `toneStyle` | `formal` \| `concise` \| `friendly` | 语气风格 |
| `customInstructions` | `string` | 常驻自定义指令 |
| `activeProviderId` | `anthropic` \| `openai` \| `gemini` \| `openrouter` \| `ollama` \| `custom` | 默认 LLM 服务商 |
| `models.primary` | `string` | 主对话与分析模型 ID |
| `models.fast` | `string` | 心跳与后台快速响应模型 ID |
| `models.vision` | `string` | 视觉/截屏分析模型 ID（或 `同主模型`） |
| `dailySpendLimit` | `number` (> 0) | 每日 API 预算上限（美元） |
| `maxStepsPerTask` | `integer` (1..200) | 单任务最大工具步数 |
| `memoryEnabled` | `true` \| `false` | 启用本地记忆 |
| `autoLearnMemory` | `true` \| `false` | 对话中自动记住偏好 |

### 3. 主动心跳与感知阈值 (`heartbeat` / `thresholds`)
| Key | 类型 / 合法值 | 说明 |
| :--- | :--- | :--- |
| `heartbeat.enabled` | `true` \| `false` | 启用周期值守心跳 |
| `heartbeat.intervalMin` | `integer` (1..1440) | 巡检周期（分钟） |
| `heartbeat.prompt` | `string` | 心跳巡检指令 Prompt |
| `thresholds.diskLowSpacePct` | `integer` (1..90) | 磁盘可用空间低于百分比告警 |
| `thresholds.cacheBloatGB` | `string` | 缓存膨胀告警阈值（如 `5 GB`） |
| `thresholds.largeFileSizeGB` | `string` | 大文件阈值（如 `2 GB`） |
| `thresholds.largeFileIdleDays` | `string` | 大文件闲置天数（如 `90 天`） |
| `thresholds.cpuSpikePct` | `string` | 进程 CPU 异常阈值（如 `200%`） |
| `thresholds.cpuSpikeDuration` | `string` | CPU 持续时间阈值（如 `5 分钟`） |
| `thresholds.memoryPressureLevel` | `yellow` \| `red` | 内存压力提醒级别 |
| `thresholds.ignoredProcesses` | `string[]` | 忽略高占用的进程白名单 |
| `thresholds.logSensitivity` | `low` \| `medium` \| `high` | 日志异常灵敏度 |
| `thresholds.eventThrottle10m` | `true` \| `false` | 同一事件 10 分钟内只响应一次 |

### 4. 通知、语音与隐私 (`notifications` / `voice` / `privacy`)
| Key | 类型 / 合法值 | 说明 |
| :--- | :--- | :--- |
| `notifyOnConfirm` | `true` \| `false` | 需要确认时发送桌面通知 |
| `notifyOnComplete` | `true` \| `false` | 任务完成通知 |
| `notifyOnFailure` | `true` \| `false` | 执行失败通知 |
| `followFocusMode` | `true` \| `false` | 跟随 macOS 专注模式勿扰 |
| `holdToSpeakKey` | `string` | 按住说话快捷键（如 `fn`） |
| `wakeWordEnabled` | `true` \| `false` | 离线唤醒词开关 |
| `speechLanguage` | `string` | 语音识别语言 |
| `speakReplies` | `string` | 回复朗读策略 |
| `recordActionReplay` | `true` \| `false` | 记录操作回放 |
| `blurSensitiveInfo` | `true` \| `false` | 回放/导出时模糊敏感信息 |
| `timelineRetentionDays` | `string` | 时间线保留天数 |

### 5. 高敏感安全护栏（**受安全门控保护，修改将强制进入收件箱审批**）
- `autonomyLevel`（`always_ask` | `auto_review` | `full_access`）
- `autoReview.engine`（`auto` | `jev` | `llm`）/ `autoReview.jevEndpoint` / `autoReview.jevModel` / `autoReview.fallbackProviderId` / `autoReview.fallbackModel`（其中 `jevEndpoint` / `jevModel` 支持 TypeSafe Jev `/v1/systemone`、OpenRouter，以及 Google Decisions `https://generativelanguage.googleapis.com/v1beta/decisions` + `gemini-decision-1`）
- `confirmChecklist.deleteOrOverwrite` / `sendMessageOrEmail` / `paymentOrSubscription` / `runTerminalCommand` / `modifySystemSettings`
- `cleanupPolicy.deleteMethod` / `restoreRetentionDays` / `protectedDirs` / `autoScanAfterUninstall`
- `blockedApps`
- `pluginRuntime.sandboxIsolation` / `allowUnsignedLocal` / `maxEventsPerHour` / `quietHours`

---

## 三、常用专项子命令示例

```bash
# 切换模型或配置服务商端点（建议通过环境变量名引用 Key，避免明文出现在命令行）
valet model set --primary claude-sonnet-4-5 --fast claude-haiku-4-5
valet provider select openai
valet provider set openai --base-url https://api.openai.com/v1 --api-key-env OPENAI_API_KEY
valet provider verify openai

# 心跳与定时自动化规则
valet heartbeat set --enabled true --interval 15
valet heartbeat run
valet automation add --title "每日磁盘体检" --cron "0 9 * * *" --when "每天 09:00" --prompt "检查系统磁盘与缓存"
valet automation disable <ruleId>

# 守护进程暂停/恢复与 MCP/记忆
valet pause
valet resume
valet mcp add --name "Filesystem" --transport stdio --command npx --args "-y @modelcontextprotocol/server-filesystem ~/Downloads"
valet mcp add --name "Tower" --transport http --url "https://example.com/mcp" --header "Authorization: Bearer <token>"
valet memory add "优先保留 ~/Projects 和 ~/Work 下的构建缓存"

# 插件脚手架与管理
valet plugin init ./my-plugin --template fs_watch
valet plugin validate ./my-plugin
valet plugin install ./my-plugin
valet plugin policy <pluginId> <eventId> auto
valet plugin trigger <pluginId> <eventId> --payload '{"test":true}'
```

---

## 四、自配置安全准则

1. **先查后改，改后核验**：修改配置前先用 `valet config get` 或 `valet status --json` 确认当前值；修改完成后再次读取并向用户汇报实际生效值。
2. **严禁擅自放宽安全防线**：绝对不要在用户未明确要求时调低 `autonomyLevel`（例如改成 `full_access`）、关闭 `confirmChecklist.*`、移除 `cleanupPolicy.protectedDirs`、修改 `blockedApps` 或关闭 `pluginRuntime.sandboxIsolation`。此类高敏修改都会被 Valet 安全门控拦截并推送至「收件箱」由用户亲自确认。
3. **保护凭据隐私**：配置 Provider Key 时优先使用 `--api-key-env <ENV_VAR>`，不要在回复中回显任何明文 API Key。
