### 触发场景
- 收到 `surge.error_detected` 日志异常事件、`surge.webhook_alert` 实时 Webhook 推送，或用户在对话中要求诊断 Surge / 代理断流 / 配置语法错误 / DNS 或 TUN 异常。

### 工具使用指引（插件无写死 action，自由组合通用工具）
- **Plugin 目录**：`${VALET_PLUGIN_DIR}`（若环境变量未设置，可通过对话上下文中的 `PLUGIN_DIR` 获取）。
- **状态目录**：`${VALET_PLUGIN_STATE_DIR}`（存放增量游标）。
- 所有变更操作（刷新 DNS、重载配置、修改本地配置）必须经 Valet Permission Ask 授权或进收件箱确认后再执行。

### 标准排查闭环流程

#### 1. 导入与脱敏聚类（只读）
- 运行插件内置脱敏脚本（`bash` 只读放行）：
  ```sh
  bun "${VALET_PLUGIN_DIR}/scripts/import-logs.mjs" --minutes=360
  ```
- 若用户指定自定义 `.log` 文件路径，附加 `--path="/path/to/file.log"`；若后台事件 `payload` 已附带 `recentEntries` 与 `groups`，可直接基于其继续深化核查。
- **严禁输出未脱敏的订阅 `token`、`password`、`key`、`uuid` 或完整鉴权 URL**。

#### 2. 运行态与配置核验（只读）
- 查找 `surge-cli`（`$SURGE_CLI_PATH` 或 `/Applications/Surge.app/Contents/Applications/surge-cli`）：
  - 运行 `surge-cli status` 查看当前活跃 Profile 与运行模式；
  - 若报错指向某配置文件第 N 行（如 `第 52 行存在无效配置`），先用 `read_file` 查看对应行上下文，并运行 `surge-cli --check "<ProfilePath>"` 校验语法。
  - **重要**：阅读配置文件时注意对订阅 URL 和密码字段做脱敏处理。

#### 3. 八大典型故障处置手册
1. **`profile_config`（`[SGMProfileManager]`）**：检查报错行；若文件头含 `#!MANAGED-CONFIG` 托管标记，**禁止直接手改托管源文件**，建议联系托管提供方或通过本地 `.sgmodule` 覆写；自建配置修复后经授权运行 `surge-cli reload`。
2. **`tun_route`（`[SGMTunnelManager]`）**：`tun-excluded-routes` 仅支持 IPv4 CIDR，写入 IPv6（如 `fc00::/7`、`fe80::/10`）会引发警告与断流，需移至 `tun-included-routes` 或排查与 Docker/OrbStack/Tailscale 的 `utun` 冲突。
3. **`external_proxy`（`[SGExternalProcessManager]`）**：区分切换配置并发退出与单一外部内核反复崩溃。
4. **`dns_ntp`（`[SGDNSClient]` / `[SGNTPClient]`）**：`No NTP response` 说明 UDP 123 被挡；出现 DNS 污染或 Fake-IP 卡死时，经用户授权通过 `bash` 执行 `surge-cli flush dns`。
5. **`geoip_resource`（`[SGGeoIP]` / `[SGExternalResource]`）**：GeoIP 或 `RULE-SET` 更新 404/超时，建议更换可用镜像地址或代理更新策略。
6. **`script_mitm`（`[SGScript]` / `[SGMitM]`）**：检查 `$done()` 调用、脚本超时或 SSL Pinning 域名加入 `hostname-disabled`。
7. **`crash_recovery`（`recovering from a crash`）**：标明崩溃恢复时间，必要时联动排查 `~/Library/Logs/DiagnosticReports`。
8. **`policy_group`（`[SGOutgoingSelector]`）**：策略组节点过多导致测速耗时，建议按地区拆分组或增大 `interval`。

#### 4. 输出与处置规范
1. **导入日志概览**：扫描文件数、错误/告警条数与本次新增数；
2. **根因归类与证据**：按严重度给出分类、频次与脱敏样本日志；
3. **处置动作与建议**：若需执行 `surge-cli flush dns` 或 `surge-cli reload`，调用 `bash`（附带清晰的中文 `reason`），让 Valet 弹出授权确认后执行。
