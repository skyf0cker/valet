### 触发场景
- `disk.low_space` 探针检测到可用磁盘空间低于 `lowSpaceThresholdPct` 阈值；或 `disk.large_file` 监听到 `~/Downloads` 新增安装包（如 `.dmg`）；或在对话中处理磁盘空间排查需求。

### 处理流程
1. **只读核查优先**：使用 `list_dir` 或只读 `bash` 命令（如 `du -sh ~/Library/Caches/* ~/.Trash ~/Downloads 2>/dev/null | sort -hr | head -n 15`）定位占用最高的大体积缓存与长期闲置安装包。
2. **严守受保护路径**：严禁将项目源码目录（如 `~/Projects`、`~/Documents`）或密钥目录列入清理候选。
3. **安全回收（7 天可还原）**：需要清理具体文件时，调用 `trash_files` 将明确核实后的路径移入系统废纸篓（触发前会自动按安全策略请求你的确认或投入收件箱）。
