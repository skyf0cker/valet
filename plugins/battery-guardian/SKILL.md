### 触发场景
- `command_poll` 周期执行 `pmset -g batt`，当电池电量或电源适配器状态变化时触发（`system.battery_low`）。

### 处理流程
1. 解析 payload 中的 `stdout` 与电源状态（AC / Battery），必要时通过只读 `bash` 运行 `pmset -g batt` 或 `pmset -g assertions` 复核。
2. 如处于电池供电且电量低于 20%，用 `ps` / `top -l 1` 核查高 CPU / 唤醒阻止睡眠的进程，以简洁表格给出节能建议。
