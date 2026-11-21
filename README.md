# Valet

面向 macOS 的 **Always-On AI 桌面管家**。采用 `CGO_ENABLED=0` 纯 Go 后端 + [MyGo](https://github.com/egoist/mygo) 原生 `WKWebView` 桌面壳 + React / TypeScript 前端 + Bun Agent & Workflow Sidecar 运行时架构。

## 核心特性

- **Always-On 后台值守与本地网关**
  - 持续事件驱动感知（文件系统变化、定时轮询、Webhook 推送与后台心跳），对高噪事件进行去重与防抖批处理（coalescing）。
  - 完整记录时间线（Timeline）运行轨迹、步骤耗时与执行状态。
- **安全边界与可逆收件箱（Inbox）**
  - 只读探针直接执行，涉及文件删除、配置修改、敏感终端命令或外发操作默认拦截并进入收件箱等待用户审批（支持基于 `ask_user` 的交互追问，以及可选的 Auto Review 自动风控评估）。
  - 文件清理优先通过安全废纸篓机制支持可逆保留。
- **项目工作区与 Notion 风格 Notebook**
  - 每个项目（Project）下支持**多级嵌套子页面（Page）**与**对话（Chat）平级管理**。
  - 块级 Markdown 编辑器：支持标题、待办、多层缩进列表、Callout、代码块、分割线、GFM 表格，以及跨块多选、拖拽排序与撤销重做。
  - 页面与对话互相引用：支持 `[[` 与 `@` 触发实时页内芯片与块级引用卡片（`/page`、`@valet`），自动维护双向**反向引用（Backlinks）**与定位跳转。
  - Agent 原生读写所在项目任意页面与根目录 Notebook（`notebook_read` / `notebook_edit`）。
- **Action-less 插件体系、Workflow 与 MCP**
  - 插件通过 `manifest.yaml` 声明触发器（`fs_watch` / `command_poll` / `script_poll` / `http_poll` / `webhook` / `cron`）与 `SKILL.md` 领域手册，由 Agent 自主组合工具或执行 DAG Workflow，无需硬编码动作函数。
  - 内置 MCP（Stdio / HTTP）客户端管理、多模型服务商支持（Anthropic、OpenAI、Gemini、OpenRouter、Ollama / 自定义兼容网关）与配对浅色/深色主题。
- **独立命令行工具 `valet`**
  - 随应用一同编译并提供 CLI，用于在终端管理配置、插件、诊断与控制接口。

---

## 技术架构

- **Go 原生宿主层（`main.go`、`internal/`）**：基于 `mygo` 管理原生 macOS 窗口、系统权限与菜单栏驻留，负责状态持久化（`state.json`）、密钥隔离、本地 Webhook / Control 服务以及 Sidecar 生命周期调度。
- **Bun Sidecar 运行时（`sidecar/`）**：托管 Pi Durable Agent Runtime、SQLite 对话持久化、Auto Review 评估引擎、MCP 客户端与 Workflow 执行引擎。
- **Web 桌面端 UI（`src/`）**：React 19 + TypeScript + Tailwind CSS v4 + Vite，通过 `src/mygo.ts` 自动生成绑定与 Go 后端类型安全通信。

---

## 环境要求

- **操作系统**：macOS（默认构建目标 `darwin/arm64`）
- **Go**：`1.27.4` 或更高版本（可通过 `gvm` 管理：`gvm use go1.27.4`）
- **Bun**：用于依赖管理、Sidecar 运行时与前端构建

---

## 快速开始

### 1. 安装依赖

```sh
gvm use go1.27.4
bun install
```

### 2. 开发模式（热重载）

```sh
bun run dev
```

同时启动 Vite 开发服务器（`http://localhost:5173`）与原生 macOS 窗口，支持前后端联动调试。

### 3. 更新前后端绑定

当修改了 `main.go` 中通过 `mygo.Bind(...)` 暴露的结构体方法或 `mygo.NewEvent` 事件后，运行以下命令重新生成 `src/mygo.ts`：

```sh
bun run generate
```

### 4. 类型检查与测试

```sh
# TypeScript 检查（前端 + Sidecar）
bun run typecheck

# Frontend & Sidecar 单元测试
bun test src/ sidecar/src/__tests__

# Go 静态检查与全量测试
CGO_ENABLED=0 go vet ./...
CGO_ENABLED=0 go test -count=1 ./internal/backend/... ./internal/store/... ./internal/cli/... ./internal/configctl/... ./internal/plugins/...
```

### 5. 运行本地 CLI

```sh
bun run cli -- --help
```

### 6. 构建与打包 macOS 应用

为避免后续重新打包导致 macOS 隐私权限（如完全磁盘访问、自动化等）频繁失效，首次打包前建议初始化一次本机自签名开发证书：

```sh
bun run signing:setup
```

随后执行全量构建、签名与 `.dmg` 打包：

```sh
bun run build
```

若使用 Apple 开发者正式签名证书，可通过环境变量指定：

```sh
VALET_SIGNING_IDENTITY="Developer ID Application: ..." bun run build
```

构建产物输出在 `build/darwin-arm64/`（已 Git 忽略）：
- `Valet.app`
- `valet-0.1.0-arm64.dmg`

---

## 内置插件一览

| 插件 ID | 名称 | 分类 | 默认启用 | 说明 |
| --- | --- | --- | --- | --- |
| `disk-guard` | 磁盘守卫 | 核心 | 是 | 周期监听可用空间与 Downloads 大体积安装包，支持可逆废纸篓清理 |
| `log-detective` | 日志侦探 | 核心 | 是 | 监听系统崩溃报告（`.ips`/`.crash`），提取故障线程并分析根因 |
| `process-sentinel` | 进程哨兵 | 核心 | 是 | 持续采样高占用进程并排查父进程与端口占用 |
| `uninstall-scrubber` | 卸载清道夫 | 核心 | 是 | 应用移出 `/Applications` 后排查 `Application Support` / `Caches` 等残留 |
| `surge-doctor` | Surge 诊断 | 社区 | 是 | 监听与脱敏导入 Surge 日志及 Event Webhook，定位配置/DNS/TUN 异常 |
| `battery-guardian` | 电池健康 | 社区 | 否 | 监听电量与电源切换，辅助定位异常高耗电进程 |
| `calendar-focus` | 日历与专注 | 社区 | 否 | 会前定时巡检日程，协助开启勿扰专注与梳理上下文 |
| `github-watcher` | GitHub | 社区 | 否 | 通过本地 Webhook 接收 CI / PR 构建失败通知并协助排查 |
| `wifi-sentinel` | Wi-Fi | 社区 | 否 | 监测接入点与网卡切换变化，辅助诊断网络与 DNS 问题 |

---

## 目录结构

```text
.
├── main.go               # Go 桌面应用入口、窗口配置与 MyGo 服务绑定
├── cmd/valet/            # valet CLI 可执行入口
├── internal/
│   ├── backend/          # 核心服务、事件总线、Control API、Notebook 工具与单测
│   ├── cli/              # CLI 子命令实现
│   ├── configctl/        # 配置控制与导出导入
│   ├── plugins/          # 插件清单解析与内嵌资源加载
│   ├── sidecar/          # Sidecar 进程与 RPC 协议封装
│   ├── store/            # state.json 持久化与 secrets.json 密钥隔离存储
│   ├── sys/              # macOS 系统权限、废纸篓与屏幕/应用辅助能力
│   └── types/            # 前后端共享 Go 数据结构
├── sidecar/
│   └── src/              # Bun Agent 运行时、Workflow 引擎、Auto Review、MCP 与测试
├── src/
│   ├── components/       # UI 组件（Chat / Inbox / Timeline / Projects / Plugins / Settings）
│   ├── constants/        # 主题配色等常量定义
│   ├── hooks/            # 自定义 React Hooks（含 IME 输入法守卫）
│   ├── store/            # ValetContext 全局状态与同步调度
│   ├── utils/            # Notebook 块编辑、页面树/双链、表格解析、剪贴板与工具单测
│   └── mygo.ts           # `mygo generate` 生成的前后端绑定客户端
├── plugins/              # 内置 Action-less 插件（manifest.yaml + SKILL.md + 脚本）
├── skills/               # Agent 内置能力说明书（插件开发 / 自配置）
├── scripts/              # Workflow 打包与 macOS 本地代码签名脚本
├── resources/            # 应用图标与 Sidecar Entitlements
├── mygo.config.ts        # MyGo 应用与打包配置
├── package.json          # Bun 脚本与前端依赖
├── LICENSE               # MIT 开源协议
├── dist/                 # 前端构建输出目录（Git 忽略）
└── build/                # macOS .app 与 .dmg 打包输出目录（Git 忽略）
```

---

## 安全与密钥存储说明

- 运行期配置状态（`state.json`）与用户 API Key 等敏感凭证（独立写入仅限本机用户读写的 `0600` 权限文件 `secrets.json`）相互隔离存储，不会将明文凭证写入仓库或普通状态快照。
- 请勿将个人运行数据目录或任何 `.env` / 密钥文件提交到版本库。

---

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。
