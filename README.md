# Valet

**English** | [简体中文](./README.zh-CN.md)

An **Always-On AI Desktop Steward** for macOS, built with a `CGO_ENABLED=0` pure Go backend, [MyGo](https://github.com/egoist/mygo) native `WKWebView` shell, React / TypeScript frontend, and a Bun Agent & Workflow sidecar runtime.

## Key Features

- **Always-On Background Duty & Local Event Gateway**
  - Continuous event-driven sensing (filesystem watchers, interval polls, local webhook ingress, and background heartbeats) with deduplication and debounce coalescing.
  - Full Timeline execution audit trail with step statuses, live traces, and duration tracking.
- **Safety Boundaries & Reversible Inbox Approvals**
  - Read-only probes run directly, while destructive file cleanups, configuration changes, mutating shell commands, and external actions are gated through the Inbox for approval (including interactive `ask_user` clarifications and optional Auto Review safety evaluation).
  - File deletions prioritize reversible trash recovery before permanent removal.
- **Project Workspaces & Notion-Style Notebook**
  - Manage **nested sub-pages (`Page`)** alongside **Chat sessions** as siblings under each Project.
  - Block-based Markdown editor supporting headings, todos, nested indented lists, callouts, code blocks, dividers, GFM tables, cross-block multi-select, drag reordering, and block-level undo/redo.
  - Mutual page & session referencing: trigger inline chips or block cards via `[[`, `@`, `/page`, and `@valet`, with live bidirectional **Backlinks** and scroll-to-block navigation.
  - Agents can read and edit any sub-page or root Notebook in the current Project via native `notebook_read` and `notebook_edit` tools.
- **Action-Less Plugins, Workflows & MCP**
  - Plugins declare triggers (`fs_watch`, `command_poll`, `script_poll`, `http_poll`, `webhook`, `cron`) in `manifest.yaml` alongside domain playbooks in `SKILL.md`—letting the Agent compose general tools or run compiled DAG workflows without rigid hardcoded actions.
  - Built-in MCP client management (Stdio & HTTP), multi-provider LLM configuration (Anthropic, OpenAI, Gemini, OpenRouter, Ollama / custom compatible gateways), and paired light/dark IDE themes.
- **Standalone `valet` CLI**
  - Compiled alongside the desktop app for terminal configuration, plugin management, diagnostics, and local control access.

---

## Architecture

- **Go Native Host (`main.go`, `internal/`)**: Manages native macOS windows, permissions, and menu bar residency via `mygo`, handling state persistence (`state.json`), isolated secret storage, the local Webhook / Control HTTP server, and sidecar lifecycle management.
- **Bun Sidecar Runtime (`sidecar/`)**: Hosts the Pi Durable Agent Runtime, SQLite thread persistence, Auto Review evaluator, MCP client manager, and Workflow execution engine.
- **Desktop Web UI (`src/`)**: React 19 + TypeScript + Tailwind CSS v4 + Vite, communicating with Go over type-safe bindings generated into `src/mygo.ts`.

---

## Requirements

- **OS**: macOS (default target `darwin/arm64`)
- **Go**: `1.27.4` or newer (can be managed via `gvm`: `gvm use go1.27.4`)
- **Bun**: Required for frontend dependencies, sidecar runtime, and build scripts

---

## Quick Start

### 1. Install Dependencies

```sh
gvm use go1.27.4
bun install
```

### 2. Development Mode (Hot Reload)

```sh
bun run dev
```

Starts the Vite dev server (`http://localhost:5173`) together with the native macOS desktop window.

### 3. Regenerate Go-to-TypeScript Bindings

After changing methods bound via `mygo.Bind(...)` or `mygo.NewEvent` in `main.go`, regenerate `src/mygo.ts`:

```sh
bun run generate
```

### 4. Type Checking & Tests

```sh
# TypeScript check (Frontend + Sidecar)
bun run typecheck

# Frontend & Sidecar unit tests
bun test src/ sidecar/src/__tests__

# Go vet & full Go test suite
CGO_ENABLED=0 go vet ./...
CGO_ENABLED=0 go test -count=1 ./internal/backend/... ./internal/store/... ./internal/cli/... ./internal/configctl/... ./internal/plugins/...
```

### 5. Run the Local CLI

```sh
bun run cli -- --help
```

### 6. Build & Package the macOS App

To prevent macOS privacy permissions (Full Disk Access, Automation, etc.) from resetting across rebuilds, initialize a persistent local self-signed development certificate once before your first build:

```sh
bun run signing:setup
```

Then build, sign, and package the `.app` and `.dmg`:

```sh
bun run build
```

To sign with an official Apple Developer certificate instead, pass `VALET_SIGNING_IDENTITY`:

```sh
VALET_SIGNING_IDENTITY="Developer ID Application: ..." bun run build
```

Artifacts are written to `build/darwin-arm64/` (git-ignored):
- `Valet.app`
- `valet-0.1.0-arm64.dmg`

---

## Built-In Plugins

| Plugin ID | Name | Category | Enabled by Default | Description |
| --- | --- | --- | --- | --- |
| `disk-guard` | 磁盘守卫 | Core | Yes | Monitors disk headroom and large installers in Downloads with reversible trash cleanup |
| `log-detective` | 日志侦探 | Core | Yes | Watches macOS crash reports (`.ips`/`.crash`) and summarizes crashing threads and root causes |
| `process-sentinel` | 进程哨兵 | Core | Yes | Samples runaway CPU/memory processes and inspects parent processes and open ports |
| `uninstall-scrubber` | 卸载清道夫 | Core | Yes | Detects `/Applications/*.app` removals and finds leftover files in `Application Support` / `Caches` |
| `surge-doctor` | Surge 诊断 | Community | Yes | Imports sanitized Surge logs and webhooks to diagnose profile, DNS, TUN, and node issues |
| `battery-guardian` | 电池健康 | Community | No | Tracks battery level and power source changes to diagnose abnormal energy drain |
| `calendar-focus` | 日历与专注 | Community | No | Periodically checks upcoming calendar events to assist Focus mode and meeting prep |
| `github-watcher` | GitHub | Community | No | Receives CI / PR failure webhooks via the local gateway for rapid diagnosis |
| `wifi-sentinel` | Wi-Fi | Community | No | Monitors Wi-Fi SSID and interface switches to help troubleshoot connectivity and DNS |

---

## Repository Structure

```text
.
├── main.go               # Go desktop app entrypoint, window setup, and MyGo bindings
├── cmd/valet/            # Standalone valet CLI entrypoint
├── internal/
│   ├── backend/          # Core service, event bus, Control API, Notebook tools, and tests
│   ├── cli/              # CLI subcommand implementations
│   ├── configctl/        # Configuration management and export/import
│   ├── plugins/          # Plugin manifest parsing and embedded plugin loader
│   ├── sidecar/          # Sidecar process lifecycle and RPC protocol
│   ├── store/            # state.json persistence and 0600 secrets.json isolation
│   ├── sys/              # macOS permissions, Trash, screen capture, and app helpers
│   └── types/            # Shared Go data structures
├── sidecar/
│   └── src/              # Bun Agent runtime, Workflow engine, Auto Review, MCP, and tests
├── src/
│   ├── components/       # React UI (Chat / Inbox / Timeline / Projects / Plugins / Settings)
│   ├── constants/        # Theme metadata and shared constants
│   ├── hooks/            # Custom React hooks (including IME composition guard)
│   ├── store/            # ValetContext global state and sync orchestration
│   ├── utils/            # Notebook editor, page tree/backlinks, tables, clipboard, and tests
│   └── mygo.ts           # Generated Go-to-TypeScript RPC bindings
├── plugins/              # Built-in Action-less plugins (manifest.yaml + SKILL.md + scripts)
├── skills/               # Embedded Agent skills (plugin authoring / self-configuration)
├── scripts/              # Workflow runtime bundler and macOS local signing scripts
├── resources/            # App icon and Sidecar entitlements
├── mygo.config.ts        # MyGo desktop build & packaging configuration
├── package.json          # Bun scripts and frontend dependencies
├── README.md             # English documentation (default)
├── README.zh-CN.md       # Simplified Chinese documentation
├── LICENSE               # MIT License
├── dist/                 # Frontend build output (git-ignored)
└── build/                # macOS .app and .dmg output (git-ignored)
```

---

## Security & Credential Storage

- Runtime application state (`state.json`) and sensitive credentials such as API keys (isolated in a local user-only `0600` file `secrets.json`) are stored separately; plaintext credentials are never persisted in normal snapshots or committed to git.
- Do not commit personal runtime data directories or any `.env` / secret key files to version control.

---

## License

Licensed under the [MIT License](./LICENSE).
