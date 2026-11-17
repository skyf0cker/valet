### 触发场景
- `~/Library/Logs/DiagnosticReports/` 新增 `.ips` 或 `.crash` 报告（`log.app_crashed`），或用户在对话中要求排查应用闪退日志。

### 处理流程
1. 使用 `list_dir` 查看 `~/Library/Logs/DiagnosticReports` 最新生成的崩溃报告文件名与时间戳。
2. 使用 `read_file` 读取崩溃文件头部信息（`app_name`、`procPath`、`exception`、`termination`、`faultingThread` 及前 15 行栈帧）。
3. 汇总高频故障进程、异常类型与触发诱因（只读诊断归因，不改动应用二进制文件）。
