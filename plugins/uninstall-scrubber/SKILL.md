### 触发场景
- `/Applications` 中有 `.app` 被移出或删除（`app.uninstalled`），或用户主动询问某应用卸载后的系统残留。

### 处理流程
1. **先确认应用已真卸载**：通过 `list_dir` 检查 `/Applications` 与 `~/Applications`，核对目标应用未在运行（可用只读 `bash` 执行 `pgrep -i "<AppName>"`）。
2. **定位残留目录**：检索以下位置中匹配该 App 名称或 Bundle ID 的目录与 plist：
   - `~/Library/Application Support/`
   - `~/Library/Caches/`
   - `~/Library/Preferences/`
   - `~/Library/Containers/`
   - `~/Library/LaunchAgents/`
3. **分类与安全回收**：
   - 将明确孤立的缓存与支持目录列清单汇报给用户；需要移除时调用 `trash_files`（移入废纸篓，7 天可还原）。
   - 若涉及重要登录凭据或用户文档，保持保留提示而不强制勾选删除。
