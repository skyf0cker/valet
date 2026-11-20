---
name: post-dev-handoff
description: >-
  Post-development handoff workflow for the Valet repository. Activate whenever code changes,
  bug fixes, features, or repo config/skill updates are completed and verified, to proactively
  confirm with the user whether to commit and push changes to Git and whether to build the latest
  macOS release artifacts (Valet.app / .dmg).
---

# Post-Dev Handoff（开发收尾确认）

在 Valet 仓库完成代码开发、Bug 修复或工程配置改动后，遵循以下收尾流程，主动向用户确认代码提交与产物构建。

## 1. 适用时机

- **触发**：任何修改了仓库文件（Go / TypeScript / Sidecar / 配置 / 测试 / `.agents/` 等）的开发任务完成，且必要检查与测试通过后。
- **不触发**：纯问答、代码解释或未修改任何仓库文件的只读调研任务。

## 2. 确认前准备

向用户发起确认前，先执行只读检查核对现状：

```sh
git status --short
git branch --show-current
```

- 确认所有变更均在预期范围内、无遗漏测试或临时调试文件。
- **未经用户明确确认，不要擅自执行 `git commit`、`git push` 或全量打包 `bun run build`。**

## 3. 主动向用户确认事项

完成结果汇报时，主动向用户一次性确认以下两件事：

1. **是否提交并推送代码**：询问是否将当前改动 `commit` 并 `push` 到当前远端分支，并给出建议的 Conventional Commit 标题（如 `feat:`、`fix:`、`chore:`）。
2. **是否构建最新产物**：询问是否执行 `bun run build` 构建最新的 macOS 应用产物（`Valet.app` 与 `.dmg`）。

## 4. 用户确认后的执行规范

### A. 提交与推送代码

1. 复核 `git status --short` 与 `git diff --stat`，确保不暂存无关文件、构建缓存或敏感密钥信息。
2. 按仓库 Conventional Commits 风格提交到当前分支并推送至远端：
   ```sh
   git add <预期变更文件>
   git commit -m "<type>: <concise summary>"
   git push
   ```
3. 禁止未经明确要求执行 `--force` 推送或重写已推送的提交历史。
4. 完成后向用户汇报实际 commit hash、分支名称与远端推送结果。

### B. 构建最新产物

1. 若修改了 `main.go` 中通过 `mygo.Bind(...)` 暴露给前端的结构体方法或 `mygo.NewEvent` 事件，先执行绑定代码生成：
   ```sh
   bun run generate
   ```
2. 执行全量构建与打包（`mygo build` 会按 `mygo.config.ts` 自动串联执行 `bun run build:sidecar && bun run build:cli && bun run build:web` 并打包签名）：
   ```sh
   bun run build
   ```
3. 构建完成后检查输出目录 `build/darwin-arm64/`：
   ```sh
   ls -lh build/darwin-arm64
   ```
   确认生成了最新的 `Valet.app` 与安装包（如 `valet-0.1.0-arm64.dmg`，具体版本号以 `mygo.config.ts` 为准），并向用户汇报产物路径与构建结果。

## 5. 边界原则

- 若用户在同一轮指令中已明确说明要/不要提交、推送或构建，直接按用户要求执行，不重复追问。
