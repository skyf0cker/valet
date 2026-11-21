---
name: valet-plugin-dev
description: 开发、校验、加载与调试 Valet Action-less 自包含插件包（manifest.yaml + SKILL.md + scripts/*）的内置技能手册。每当需要为 Valet 编写新插件、修改现有插件的触发器/脚本/SKILL.md 或热加载生效时，先读取并遵循本手册。
---

# Valet 插件开发与热加载指南（Action-less 自包含架构）

Valet 的插件采用 **「通用核心工具 + 可插拔事件插件（Sensor + ConfigSchema + SKILL.md + 脚本）」** 架构：宿主不绑定任何插件专用的静态动作 (`actions`) 或宿主 `driver`，所有插件（内置核心、社区插件与本地自研插件）通过同一套 Go Sensor Engine 与 Pi Durable `compilePluginExtension` 运行。

---

## 一、自包含插件目录结构规范

所有已安装/本地自研插件包存放在：

```text
<VALET_DATA_DIR>/plugins/<slug>/
├── manifest.yaml       # 必需：插件元数据、config_schema、triggers 事件传感器
├── SKILL.md            # 必需：事件触发或对话 @插件 时，指导 Agent 如何使用通用核心工具排查与处置
└── scripts/            # 可选：自定义探针/导入脚本（.mjs / .sh / .py 自动授予 0755）
```

### 运行时自动注入的环境变量与目录持久化
当 `script_poll` / `command_poll` 传感器运行脚本时，Valet 会自动注入环境变量；当 Agent 在对话/事件中通过 `bash` 运行插件包脚本时，请直接使用插件 Prompt 中给出的 `VALET_PLUGIN_DIR` 绝对路径（例如 `bun "<VALET_PLUGIN_DIR>/scripts/poll-xxx.mjs"`）：
- `VALET_PLUGIN_DIR`：当前插件包目录绝对路径（`<dataDir>/plugins/<slug>`）
- `VALET_PLUGIN_STATE_DIR`：插件持久化状态目录（`<dataDir>/plugin-state/<pluginId>`，用于游标、去重标记等）
- `VALET_DATA_DIR` & `VALET_HOME_DIR`：Valet 数据目录与用户主目录
- `VALET_PLUGIN_CONFIG_JSON`：用户在 UI 中调节后的插件配置 JSON（例如 `{"pollIntervalSec":30}`）
- Bundled `bun` 自动位于 `PATH` 最前，脚本可直接以 `#!/usr/bin/env bun` 编写 `.mjs` 探针。
- 内置目录插件（`core` / `community`）同样物化到 `<VALET_DATA_DIR>/plugins/<slug>/`；修改其 `manifest.yaml` 或 `SKILL.md` 后调用 `plugin_reload`（或 `valet plugin reload <id>`）即可持久保留并热重载生效，不会被覆盖。

---

## 二、`manifest.yaml` 完整字段参考

> **关键约束**：不要在 `manifest.yaml` 中编写静态 `actions:` 或 `driver:`！插件只需声明「何时感知（`triggers`）」「暴露哪些设置项（`config_schema`）」以及「触发后怎么做（`SKILL.md`）」。

### 1. 顶层字段
```yaml
id: my-plugin                    # 插件唯一 ID（推荐 kebab-case）
bundle_id: local.valet.my-plugin # 包标识符
name: 我的自定义管家插件            # 展示名称
tagline: 一句话说明监听什么与如何协助   # 副标题
description: 详细能力说明...
version: 0.1.0
source: local                    # local | core | community
icon: code                       # code | disk | pulse | log | gh | calendar | wifi | battery | surge
permissions:                     # 可选：full_disk | notifications | accessibility | screen_recording
  - full_disk
config_schema:                   # 可选：插件详情页动态渲染的设置控件
  - key: pollIntervalSec
    label: 巡检间隔（秒）
    type: slider                 # slider | number | text | boolean
    min: 10
    max: 300
    default: 60
    description: 后台脚本轮询间隔
```

### 2. `triggers` 传感器类型（6 类通用 Sensors）

每个 trigger 支持通用字段：`id`（领域事件码）、`description`、`sensor`、`policy`（`auto` | `ask` | `record`，默认 `ask`）。

1. **`fs_watch`** — 文件系统监听：
```yaml
triggers:
  - id: fs.file_created
    description: 监听下载目录新增安装包
    sensor: fs_watch
    watch_dirs: [~/Downloads]    # 或 watch_dir: ~/Downloads
    ops: [create]                # create | write | remove | rename
    glob: "*.dmg"
    policy: ask
```

2. **`script_poll`** — 脚本结构化轮询（**最推荐自定义探针方式**）：
```yaml
triggers:
  - id: service.alert
    description: 定期执行脚本探针，按 JSON 结果决定是否触发
    sensor: script_poll
    script: scripts/poll-check.mjs
    interval_config_key: pollIntervalSec
    interval_sec: 60
    policy: ask
```
脚本向 stdout 输出严格 JSON：
```json
{ "triggered": true, "payload": { "summary": "...", "items": [] } }
```

3. **`command_poll`** — Shell 命令轮询：
```yaml
triggers:
  - id: docker.unhealthy
    description: 检测异常容器并告警
    sensor: command_poll
    command: "docker ps --filter health=unhealthy --format '{{.Names}}'"
    interval_sec: 60
    emit_on: non_empty           # change(默认) | non_empty | exit_zero | always
    match_contains: ""
    policy: ask
```

4. **`http_poll`** — HTTP/JSON 端点轮询：
```yaml
triggers:
  - id: api.health_changed
    description: 轮询健康检查接口状态变化
    sensor: http_poll
    url: "http://127.0.0.1:8080/healthz"
    method: GET
    interval_sec: 60
    emit_on: change
    policy: record
```

5. **`webhook`** — 本地 HTTP Webhook 推送接入：
```yaml
triggers:
  - id: webhook.received
    description: 接收外部 Webhook POST 推送
    sensor: webhook
    policy: ask
```
推送地址：`POST http://127.0.0.1:41920/events/<pluginId>/<eventCode>`（加 `?sync=1` 可同步等待返回）。

6. **`cron`** — 定时任务调度：
```yaml
triggers:
  - id: daily.audit
    description: 每个工作日 18:00 自动检查
    sensor: cron
    schedule: "0 18 * * 1-5"     # 标准 5 段 Cron（分 时 日 月 周）
    policy: auto
```

---

## 三、`SKILL.md` 与通用核心工具

`SKILL.md` 会通过 `compilePluginExtension` 直接挂载到对话与事件处理的 `<plugin_skill>` 上下文中。编写时直接调度 Valet 提供的通用核心工具：

- **只读诊断原语（免审批直接放行）**：
  - `read_file`：按行读取文件/日志/配置
  - `system_overview`：读取实时 CPU / 内存 / 磁盘与高占用进程
  - `bash`：执行只读探测命令（如 `ls`, `ps`, `df`, `pmset`, `networksetup`, `lsof`）及插件包内只读脚本（`scripts/poll-*.mjs` / `import-*.mjs` / `read-*.mjs` 等）
  - `ask_user`：需要用户做主观裁决时提问
- **受安全门控保护的变更原语**：
  - `trash_files`：将明确路径列表移入 Finder 废纸篓 / Valet Vault（7 天可还原，受 `protectedDirs` 严格拦截）
  - `write_file`：创建或更新文本文件
  - `kill_process`：终止指定 PID 进程（受 `blockedApps` 拦截）
  - `bash`：执行修改系统/配置命令（前后台均受安全策略审批门控）
  - `inbox_propose_approval`：后台批量文件清理提交收件箱审批卡

> 只读脚本命名规范：插件包内用于只读探测/采集的脚本，文件名前缀请使用 `poll-` / `import-` / `read-` / `inspect-` / `scan-` / `sample-` / `summarize-` 且扩展名为 `.mjs` / `.js` / `.ts`（即匹配 `(poll|import|read|inspect|scan|sample|summarize)-*.(mjs|js|ts)`）。Valet 安全门控（`READ_ONLY_PLUGIN_SCRIPT_RE`）会自动识别为只读脚本并在前台免弹窗放行。

---

## 三·五、可选运行模式：`execution_mode: workflow` (`workflow.yaml`)

每个插件可在 `skill` 模式（挂载 `SKILL.md`）与 `workflow` 模式（本地执行声明式 `workflow.yaml`，二选一互斥）之间切换：

```yaml
# manifest.yaml
execution_mode: workflow   # skill (默认) | workflow
```

`workflow.yaml` 采用有向无环图 (DAG)，支持以下节点类型 (`nodes[].type`)：
- `trigger`：触发入口（注入 `{{trigger.event}}`、`{{trigger.payload}}`、`{{config.*}}`）
- `script`：执行本地脚本 (`command`, `args`, `cwd`, `timeoutMs`, `parseJson`)
- `http`：HTTP 请求 (`url`, `method`, `headers`, `body`, `timeoutMs`)
- `tool`：调用 Valet 内置安全工具 (`tool`, `args`)
- `agent`：单步 LLM 推理 (`prompt`, `systemPrompt`, `model`, `allowTools`)
- `condition`：条件分支 (`expr: { path, op, value }`，边上使用 `when: "true"` / `when: "false"`)
- `transform`：数据重组映射 (`output`)
- `sleep`：持久化休眠 (`duration: "5s" | "10m"`)
- `approval`：挂起工作流并在收件箱生成审批卡 (`title`, `detail`, `riskLevel`，边可用 `when: "approved"` / `when: "rejected"`)
- `notify`：写入时间线或管家通知 (`title`, `message`, `level`, `kind: timeline | outbox | both`)

---

## 四、Agent 自研并热加载插件的标准闭环工作流

当用户要求你**编写并加载/启用一个新插件**，或者**修改优化已有插件**时，按以下 4 步执行：

1. **查看现状**：先调用 `plugin_list`（若基于现有插件修改，再调用 `plugin_inspect`）确认现有插件 ID、传感器、本地目录 (`localDir`) 与捆绑脚本。
2. **编写并热加载 (`plugin_install`)**：
   - 调用 `plugin_install` 提交 `slug`、`name`、`tagline`、`manifestYaml`、`skillMarkdown`，以及可选 `files: [{ path: "scripts/poll-xxx.mjs", content: "..." }]`。
   - `plugin_install` 会自动校验 Manifest、写入 `<dataDir>/plugins/<slug>/` 并赋予脚本可执行权限、重载 Go 传感器引擎，并**立即更新当前会话的 `<plugin_skill>` 挂载**。
   - 只有当用户明确表示“先出个方案/草稿给我看看再装”时，才改用 `plugin_draft_create`。
3. **验证闭环**：
   - 若包含 `scripts/*.mjs` 探针，可先用 `bash` 试跑验证 JSON 输出；
   - 再调用 `plugin_trigger` 注入测试事件验证 `SKILL.md` 触发与处置链路。
4. **交付汇报**：
   - 清晰说明插件 `id`、`localDir` 路径、传感器触发器与策略（`auto` / `ask` / `record`）、包含的脚本文件以及验证结果。
