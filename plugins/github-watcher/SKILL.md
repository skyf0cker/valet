### 触发场景
- 通过本地 **Webhook 网关** 接收 CI 失败告警（`POST /events/github-watcher/github.ci_failed`）。

### 处理流程
1. 读取 webhook payload 中的仓库名、分支、Commit、错误信息与 `logUrl`。
2. 如需查看本地对应仓库状态或远程详情，可使用只读 `bash`（如 `git status`、`git log -n 5`、`gh run view` 等，先核查本地 CLI 可用性）。
3. 总结失败 Job 与报错原因；如需重跑工作流或发表外发 PR 评论，通过 `bash` 发起并经用户授权确认后执行。
