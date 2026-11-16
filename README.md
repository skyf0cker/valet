# Valet

基于 Go 与 [MyGo](https://github.com/egoist/mygo) 构建的轻量级 macOS 桌面应用，采用 `CGO_ENABLED=0` 纯 Go 后端与系统原生 `WKWebView` + Vite / TypeScript 前端架构，兼顾原生桌面能力与 Web 组件生态复用。

## 环境要求

- **操作系统**：macOS（默认构建目标 `darwin/arm64`，支持通过 `mygo build -platform` 指定其他目标）
- **Go**：`1.27.4` 或更高版本（可通过 `gvm` 管理：`gvm use go1.27.4`）
- **Bun**：用于安装前端依赖与执行项目脚本

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

该命令会同时启动 Vite 开发服务器（`http://localhost:5173`）与原生 macOS 应用窗口，支持前端与 Go 后端联动调试。

### 3. 生成前后端类型绑定

当你在 `main.go` 中修改了通过 `mygo.Bind(...)` 暴露给前端的结构体方法或 `mygo.NewEvent` 事件后，可运行以下命令更新 `src/mygo.ts`：

```sh
bun run generate
```

### 4. 类型检查与 Go 检查

```sh
bun run typecheck
CGO_ENABLED=0 go vet ./...
CGO_ENABLED=0 go test ./...
```

### 5. 构建与打包 macOS 应用

```sh
bun run build
```

构建完成后会在 `build/darwin-arm64/` 目录生成签名后的 `Valet.app` 与安装包 `valet-0.1.0-arm64.dmg`。

## 目录结构

```text
.
├── main.go             # Go 应用入口、窗口配置与后端绑定服务
├── go.mod / go.sum     # Go 模块与依赖声明（module valet）
├── mygo.config.ts      # MyGo 应用与打包配置（名称、Bundle ID、构建脚本等）
├── package.json        # Bun 脚本与前端依赖（dev / build / generate / typecheck）
├── index.html          # 前端页面入口
├── vite.config.ts      # Vite 开发服务器与构建配置
├── tsconfig.json       # TypeScript 编译选项
├── src/
│   ├── main.ts         # 前端入口逻辑
│   ├── mygo.ts         # 由 `mygo generate` 自动生成的类型安全客户端绑定
│   └── style.css       # 页面样式
├── resources/
│   └── icon.png        # 应用图标资源
├── dist/               # 前端构建输出目录（Git 忽略）
└── build/              # macOS .app 与 .dmg 打包输出目录（Git 忽略）
```
