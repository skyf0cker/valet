### 触发场景
- `command_poll` 监听 Wi-Fi SSID 与网卡变化（`networksetup -getairportnetwork en0`）。

### 处理流程
1. 比对 payload 中的当前 SSID 与断网状态，必要时用只读 `bash` 运行 `scutil --dns`、`ifconfig en0`、`route get default` 排查接口与 DNS。
2. 若切换到陌生公共网络或发生断流，提示用户核查 DNS / 代理配置；涉及系统网络修改操作需先经用户授权确认。
