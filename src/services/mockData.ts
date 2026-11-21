import {
  DEFAULT_PROJECT_ID,
  type AgentProviderConfig,
  type AutomationRule,
  type ChatThread,
  type CleanupPolicySettings,
  type InboxApprovalItem,
  type McpServerItem,
  type MemoryEntry,
  type MonitoringThresholds,
  type PermissionItem,
  type PluginRuntimeSettings,
  type PluginState,
  type Project,
  type ScanState,
  type SystemMetrics,
  type TimelineEvent,
  type ValetPreferences,
  type ValetSnapshot,
} from "../types/valet";

export const DEFAULT_THRESHOLDS: MonitoringThresholds = {
  diskLowSpacePct: 15,
  cacheBloatGB: "5 GB",
  largeFileSizeGB: "2 GB",
  largeFileIdleDays: "90 天",
  cpuSpikePct: "200%",
  cpuSpikeDuration: "5 分钟",
  memoryPressureLevel: "red",
  ignoredProcesses: ["Xcode", "ffmpeg", "Docker"],
  logSensitivity: "medium",
  eventThrottle10m: true,
};

export const DEFAULT_CLEANUP_POLICY: CleanupPolicySettings = {
  deleteMethod: "移入废纸篓",
  restoreRetentionDays: "7 天",
  protectedDirs: ["~/Documents", "~/Projects"],
  autoScanAfterUninstall: true,
};

export const DEFAULT_PLUGIN_RUNTIME: PluginRuntimeSettings = {
  sandboxIsolation: true,
  allowUnsignedLocal: true,
  maxEventsPerHour: "60 / 小时",
  quietHours: "23:30 – 08:00",
};

export const INITIAL_INBOX_ITEMS: InboxApprovalItem[] = [
  {
    id: "inbox-docker-remnants",
    timestamp: "2026-11-15T22:30:00",
    timeLabel: "22:30",
    ageLabel: "11m 前",
    category: "files",
    iconKind: "trash",
    title: "清理「Docker Desktop」卸载后的 12 项残留",
    summary:
      "App 已移除 30 分钟；虚拟机镜像与特权助手无其他容器工具引用，镜像仓库凭据默认保留。",
    pluginId: "uninstall-scrubber",
    pluginName: "卸载清道夫",
    pluginBadge: "卸载清道夫",
    eventCode: "app.uninstalled",
    reversible7d: true,
    reclaimableGB: 11.4,
    approveLabel: "批准清理",
    dismissLabel: "忽略",
    status: "pending",
    linkedTimelineEventId: "evt-docker-uninstall",
    triggerLatencyLabel: "22:30 · 触发于卸载后 48s",
    payload: {
      bundle_id: "com.docker.docker",
      removed_at: "2026-11-15T22:19:12",
      path: "/Applications/Docker.app",
      referenced_by: "none",
    },
    reasoning:
      "Docker Desktop 主程序已移入废纸篓超过 30 分钟。检测到 12 项关联磁盘镜像与特权辅助工具未再被 Colima 或 OrbStack 引用；镜像仓库登录配置 ~/.docker/config.json 已自动排除勾选项以保留你的凭据。",
    actionItems: [
      {
        id: "dk-1",
        label: "~/Library/Containers/com.docker.docker/Data/vms",
        path: "~/Library/Containers/com.docker.docker/Data/vms",
        sizeMB: 11468,
        sizeLabel: "11.2 GB",
        checked: true,
      },
      {
        id: "dk-2",
        label: "/Library/PrivilegedHelperTools/com.docker.vmnetd",
        path: "/Library/PrivilegedHelperTools/com.docker.vmnetd",
        sizeMB: 4,
        sizeLabel: "特权助手",
        checked: true,
      },
      {
        id: "dk-3",
        label: "~/.docker/config.json",
        path: "~/.docker/config.json",
        sizeMB: 0,
        sizeLabel: "12 KB",
        checked: false,
        keepNote: "· 含仓库登录态，保留",
      },
      {
        id: "dk-4",
        label: "~/Library/Application Support/Docker Desktop",
        path: "~/Library/Application Support/Docker Desktop",
        sizeMB: 148,
        sizeLabel: "148 MB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-5",
        label: "~/Library/Group Containers/group.com.docker",
        path: "~/Library/Group Containers/group.com.docker",
        sizeMB: 32,
        sizeLabel: "32 MB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-6",
        label: "~/Library/Caches/com.docker.docker",
        path: "~/Library/Caches/com.docker.docker",
        sizeMB: 18,
        sizeLabel: "18 MB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-7",
        label: "~/Library/Logs/Docker Desktop",
        path: "~/Library/Logs/Docker Desktop",
        sizeMB: 12,
        sizeLabel: "12 MB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-8",
        label: "/Library/LaunchDaemons/com.docker.vmnetd.plist",
        path: "/Library/LaunchDaemons/com.docker.vmnetd.plist",
        sizeMB: 1,
        sizeLabel: "4 KB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-9",
        label: "/Library/LaunchDaemons/com.docker.socket.plist",
        path: "/Library/LaunchDaemons/com.docker.socket.plist",
        sizeMB: 1,
        sizeLabel: "4 KB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-10",
        label: "~/Library/Preferences/com.docker.docker.plist",
        path: "~/Library/Preferences/com.docker.docker.plist",
        sizeMB: 1,
        sizeLabel: "24 KB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-11",
        label: "~/Library/Saved Application State/com.electron.docker-frontend.savedState",
        path: "~/Library/Saved Application State/com.electron.docker-frontend.savedState",
        sizeMB: 2,
        sizeLabel: "2.1 MB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-12",
        label: "~/Library/HTTPStorages/com.docker.docker",
        path: "~/Library/HTTPStorages/com.docker.docker",
        sizeMB: 1,
        sizeLabel: "640 KB",
        checked: true,
        defaultHidden: true,
      },
    ],
    traceSteps: [
      { id: "dkt1", time: "22:19:12", stage: "目录监听", detail: "/Applications/Docker.app 被移入废纸篓", status: "done" },
      { id: "dkt2", time: "22:29:45", stage: "依赖排查", detail: "确认 12 项虚拟机与助手文件无活跃容器引用", status: "done" },
      { id: "dkt3", time: "22:30:00", stage: "进入收件箱", detail: "默认保留 ~/.docker/config.json，等待确认", status: "active" },
    ],
    logs: [
      { id: "dkl1", ts: "22:19:12.401", level: "INFO", message: "FSEvent: Removed /Applications/Docker.app" },
      { id: "dkl2", ts: "22:29:45.109", level: "INFO", message: "Detected 12 orphan entries totaling 11.4 GB; kept ~/.docker/config.json" },
      { id: "dkl3", ts: "22:30:00.004", level: "WARN", message: "Policy=ask -> queued to Inbox for user confirmation" },
    ],
  },
  {
    id: "inbox-large-files",
    timestamp: "2026-11-15T21:14:00",
    timeLabel: "21:14",
    category: "files",
    iconKind: "disk",
    title: "移出 2 个超过 90 天未打开的巨型文件（3.4 GB）",
    summary:
      "~/Downloads/macos-15.1-restore.ipsw（2.6 GB）与 Paper-demo-raw.mov（820 MB），移入废纸篓。",
    pluginId: "disk-guard",
    pluginName: "磁盘守卫",
    pluginBadge: "磁盘守卫",
    eventCode: "disk.large_file",
    reversible7d: true,
    reclaimableGB: 3.4,
    approveLabel: "移入废纸篓",
    dismissLabel: "保留",
    status: "pending",
    linkedTimelineEventId: "evt-large-files",
    triggerLatencyLabel: "21:14 · 来自磁盘定时扫描",
    payload: {
      threshold_gb: 2,
      idle_days: 90,
      candidate_count: 2,
      total_gb: 3.4,
    },
    reasoning:
      "两个文件均超过设定的 90 天未打开大文件阈值，位于 ~/Downloads 下，已避开 ~/Documents 与 ~/Projects 受保护路径。",
    actionItems: [
      {
        id: "lf-1",
        label: "~/Downloads/macos-15.1-restore.ipsw",
        path: "~/Downloads/macos-15.1-restore.ipsw",
        sizeMB: 2662,
        sizeLabel: "2.6 GB",
        checked: true,
      },
      {
        id: "lf-2",
        label: "~/Downloads/Paper-demo-raw.mov",
        path: "~/Downloads/Paper-demo-raw.mov",
        sizeMB: 820,
        sizeLabel: "820 MB",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "lft1", time: "21:13:52", stage: "磁盘扫描", detail: "遍历非受保护目录超过 2 GB 的闲置文件", status: "done" },
      { id: "lft2", time: "21:14:00", stage: "等待批准", detail: "策略为「问我」，排队等待确认移入废纸篓", status: "active" },
    ],
    logs: [
      { id: "lfl1", ts: "21:13:52.090", level: "INFO", message: "Found 2 idle large files (>90d) totaling 3.4 GB" },
    ],
  },
  {
    id: "inbox-rust-analyzer",
    timestamp: "2026-11-15T20:42:00",
    timeLabel: "20:42",
    category: "process",
    iconKind: "pulse",
    title: "终止卡死的 rust-analyzer 进程（PID 61904）",
    summary:
      "连续 9 分钟占用 CPU 285% · 内存 4.1 GB，原终端会话已关闭；将发送 SIGTERM 释放资源。",
    pluginId: "process-sentinel",
    pluginName: "进程哨兵",
    pluginBadge: "进程哨兵",
    eventCode: "proc.high_cpu",
    warningTag: "不可撤销",
    reversible7d: false,
    reclaimableGB: 0,
    approveLabel: "结束进程",
    dismissLabel: "忽略",
    status: "pending",
    linkedTimelineEventId: "evt-rust-analyzer",
    triggerLatencyLabel: "20:42 · 持续高于 200% 超过 5 分钟",
    payload: {
      pid: 61904,
      command: "rust-analyzer --stdio",
      cpu_avg: "285%",
      memory_gb: 4.1,
      parent_tty_alive: false,
    },
    reasoning:
      "rust-analyzer 不在忽略进程名单内，父进程终端已退出，当前变为孤儿进程持续空转并消耗 4.1 GB 内存。发送 SIGTERM 无法撤销正在进行的索引状态，按安全级别需要你确认。",
    actionItems: [
      {
        id: "ra-1",
        label: "发送 SIGTERM 至 PID 61904（rust-analyzer）",
        path: "PID 61904 · TTY 已关闭",
        sizeMB: 0,
        sizeLabel: "释放 4.1 GB 内存",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "rat1", time: "20:37:00", stage: "异常检测", detail: "PID 61904 CPU 持续 > 200%", status: "done" },
      { id: "rat2", time: "20:42:00", stage: "等待人工确认", detail: "进程终止属于不可撤销操作", status: "active" },
    ],
    logs: [
      { id: "ral1", ts: "20:42:00.120", level: "WARN", message: "Orphan pid=61904 rust-analyzer at 285% CPU, 4.1 GB RSS" },
    ],
  },
  {
    id: "inbox-calendar-reply",
    timestamp: "2026-11-15T19:55:00",
    timeLabel: "19:55",
    category: "outbound",
    iconKind: "mail",
    title: "向「设计周会」组织者发送顺延 10 分钟的日程回复",
    summary: "检测到 20:00 日程冲突；草稿：「前序评审顺延，我约 20:10 接入」，未经批准不会外发。",
    pluginId: "calendar-focus",
    pluginName: "日历",
    pluginBadge: "日历",
    eventCode: "cal.conflict_reply",
    warningTag: "外发消息",
    reversible7d: false,
    approveLabel: "批准发送",
    dismissLabel: "不发送",
    status: "pending",
    linkedTimelineEventId: "evt-calendar-reply",
    triggerLatencyLabel: "19:55 · 外发消息安全拦截",
    payload: {
      meeting: "设计周会",
      recipient: "lin.chen@company.example",
      draft: "前序评审顺延，我约 20:10 接入",
      requires_approval: true,
    },
    reasoning:
      "日历插件检测到当前进行的评审与 20:00「设计周会」重叠，已自动为你拟好礼貌顺延回复。根据「发送消息、邮件始终需确认」规则，必须经你批准后才允许发出。",
    actionItems: [
      {
        id: "cal-1",
        label: "发送邮件/日程备注至「设计周会」组织者",
        path: "lin.chen@company.example",
        sizeMB: 0,
        sizeLabel: "外发 1 条",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "calt1", time: "19:54:50", stage: "冲突检测", detail: "前序会议尚未结束且距离 20:00 仅剩 5 分钟", status: "done" },
      { id: "calt2", time: "19:55:00", stage: "外发拦截", detail: "等待批准发送回复草稿", status: "active" },
    ],
    logs: [
      { id: "call1", ts: "19:55:00.018", level: "WARN", message: "Outbound reply draft held by safety rule confirmChecklist.sendMessageOrEmail" },
    ],
  },
];

export const INITIAL_PERMISSIONS: PermissionItem[] = [
  {
    id: "full_disk",
    name: "完全磁盘访问",
    tier: "required",
    description: "扫描缓存与卸载残留、读取系统日志——Valet 的核心能力都依赖它",
    settingsSectionName: "完全磁盘访问权限",
    settingsSubtext: "允许以下应用访问邮件、信息、Safari 及所有用户文件。",
    granted: false,
    steps: [
      {
        index: "01",
        title: "打开系统设置",
        detail: "点击下方按钮，Valet 会直接带你到「隐私与安全性 › 完全磁盘访问权限」。",
      },
      {
        index: "02",
        title: "打开 Valet 的开关",
        detail: "在列表中找到 Valet，打开右侧开关，并输入解锁密码或使用触控 ID。",
      },
      {
        index: "03",
        title: "回到这里",
        detail: "若系统提示「退出并重新打开」，选择稍后，Valet 会自动检测并继续。",
      },
    ],
    mockApps: [
      { id: "paper", name: "Paper", enabled: true },
      { id: "valet", name: "Valet", isValet: true, enabled: false },
      { id: "meetings", name: "会议", enabled: false },
    ],
  },
  {
    id: "accessibility",
    name: "辅助功能",
    tier: "recommended",
    description: "替你操作需要点击的 App 界面，如系统设置、网页表单",
    settingsSectionName: "辅助功能",
    settingsSubtext: "允许以下应用控制你的电脑，以便协助操作界面。",
    granted: true,
    steps: [
      {
        index: "01",
        title: "打开系统设置",
        detail: "点击下方按钮，前往「隐私与安全性 › 辅助功能」。",
      },
      {
        index: "02",
        title: "启用 Valet",
        detail: "在列表勾选或打开 Valet 的辅助功能开关。",
      },
      {
        index: "03",
        title: "自动同步",
        detail: "授权完成后这里会自动刷新状态。",
      },
    ],
    mockApps: [
      { id: "valet", name: "Valet", isValet: true, enabled: true },
      { id: "raycast", name: "Terminal", enabled: true },
    ],
  },
  {
    id: "screen_recording",
    name: "屏幕录制",
    tier: "recommended",
    description: "看懂屏幕内容，用于界面操作与截图诊断",
    settingsSectionName: "屏幕录制与系统录音",
    settingsSubtext: "允许以下应用录制屏幕内容以进行视觉诊断。",
    granted: false,
    steps: [
      {
        index: "01",
        title: "打开系统设置",
        detail: "点击下方按钮，前往「隐私与安全性 › 屏幕录制」。",
      },
      {
        index: "02",
        title: "打开 Valet 的开关",
        detail: "允许 Valet 截取当前屏幕画面供多模态分析。",
      },
      {
        index: "03",
        title: "回到 Valet",
        detail: "状态会自动更新，所有截图仅保留在本地。",
      },
    ],
    mockApps: [
      { id: "obs", name: "ScreenStudio", enabled: true },
      { id: "valet", name: "Valet", isValet: true, enabled: false },
    ],
  },
  {
    id: "automation",
    name: "自动化",
    tier: "recommended",
    description: "通过 AppleScript 控制 Finder、日历、邮件等应用，比模拟点击更稳定",
    settingsSectionName: "自动化",
    settingsSubtext: "允许 Valet 向 Finder、日历和系统事件发送控制指令。",
    granted: false,
    steps: [
      {
        index: "01",
        title: "打开系统设置",
        detail: "前往「隐私与安全性 › 自动化」。",
      },
      {
        index: "02",
        title: "展开 Valet 条目",
        detail: "勾选允许控制的系统应用（如 Finder、Calendar）。",
      },
      {
        index: "03",
        title: "回到这里",
        detail: "每 2 秒自动检测授权结果。",
      },
    ],
    mockApps: [
      { id: "valet", name: "Valet", isValet: true, enabled: false },
    ],
  },
  {
    id: "notifications",
    name: "通知",
    tier: "recommended",
    description: "任务完成、需要确认敏感操作时及时提醒你",
    settingsSectionName: "通知",
    settingsSubtext: "允许 Valet 在需要你确认或任务完成时发送桌面横幅。",
    granted: true,
    steps: [
      {
        index: "01",
        title: "打开系统设置",
        detail: "前往「通知 › Valet」。",
      },
      {
        index: "02",
        title: "开启允许通知",
        detail: "建议选择「横幅」样式以便及时确认操作。",
      },
      {
        index: "03",
        title: "完成",
        detail: "状态已就绪。",
      },
    ],
    mockApps: [
      { id: "valet", name: "Valet", isValet: true, enabled: true },
    ],
  },
  {
    id: "microphone",
    name: "麦克风",
    tier: "optional",
    description: "用于语音输入与「嘿 Valet」唤醒词",
    settingsSectionName: "麦克风",
    settingsSubtext: "允许以下应用访问麦克风。语音识别默认在本地运行。",
    granted: false,
    steps: [
      {
        index: "01",
        title: "打开系统设置",
        detail: "前往「隐私与安全性 › 麦克风」。",
      },
      {
        index: "02",
        title: "开启 Valet 开关",
        detail: "仅在按住 fn 或启用唤醒词时采集音频。",
      },
      {
        index: "03",
        title: "回到这里",
        detail: "即可使用语音输入。",
      },
    ],
    mockApps: [
      { id: "zoom", name: "会议", enabled: true },
      { id: "valet", name: "Valet", isValet: true, enabled: false },
    ],
  },
];

export const INITIAL_PLUGINS: PluginState[] = [
  {
    id: "disk-guard",
    slug: "disk-guard",
    name: "磁盘守卫",
    tagline: "空间不足时自动清理缓存与垃圾",
    description: "持续监测可用磁盘空间，智能识别安全可清理的开发缓存与大文件，清理前默认移入废纸篓。",
    version: "v1.2.0",
    bundleId: "com.valet.disk-guard",
    iconKind: "disk",
    source: "core",
    enabled: true,
    installed: true,
    requiredPermission: "full_disk",
    requiredPermissionLabel: "完全磁盘访问",
    defaultBehaviorHint: "清缓存自动，删大文件先问",
    statusSubtitle: "刚刚触发 disk.low_space · 正在处理",
    weeklyImpactValue: "41.6",
    weeklyImpactUnit: "GB",
    weeklyImpactLabel: "本周为你释放",
    triggers24h: [4, 6, 4, 8, 5, 4, 10, 6, 14, 20],
    events: [
      {
        id: "disk.low_space",
        description: "可用空间低于阈值（15%）",
        policy: "auto",
        count24h: 1,
      },
      {
        id: "disk.cache_bloat",
        description: "缓存目录 7 天内增长超过 5 GB",
        policy: "auto",
        count24h: 2,
      },
      {
        id: "disk.large_file",
        description: "发现 > 2 GB 且 90 天未打开的文件",
        policy: "ask",
        count24h: 4,
      },
      {
        id: "disk.duplicate_found",
        description: "下载与文稿中的重复文件",
        policy: "record",
        count24h: 0,
      },
    ],
    config: {
      lowSpaceThresholdPct: 15,
      protectedPaths: ["~/Documents", "~/Projects"],
      values: { lowSpaceThresholdPct: 15 },
    },
    manifestYaml: `id: com.valet.disk-guard
name: 磁盘守卫
version: 1.2.0
permissions: [full_disk]
triggers:
  - id: disk.low_space
    sensor: script_poll
    script: scripts/poll-disk.mjs`,
  },
  {
    id: "uninstall-scrubber",
    slug: "uninstall-scrubber",
    name: "卸载清道夫",
    tagline: "App 被删除后，找出并清理残留",
    description: "监听 /Applications 目录变更，自动关联残留的缓存、偏好设置与后台 LaunchAgent。",
    version: "v1.1.0",
    bundleId: "com.valet.uninstall-scrubber",
    iconKind: "trash",
    source: "core",
    enabled: true,
    installed: true,
    requiredPermission: "full_disk",
    requiredPermissionLabel: "完全磁盘访问",
    defaultBehaviorHint: "清理前先问你",
    statusSubtitle: "1 项待你确认",
    weeklyImpactValue: "12.4",
    weeklyImpactUnit: "GB",
    weeklyImpactLabel: "本周清理残留",
    triggers24h: [2, 2, 8, 2, 2, 2, 2, 2, 2, 12],
    events: [
      {
        id: "app.uninstalled",
        description: "检测到应用被移入废纸篓或删除",
        policy: "ask",
        count24h: 1,
      },
      {
        id: "app.orphan_found",
        description: "扫描到已不存在应用的遗留支持文件",
        policy: "ask",
        count24h: 2,
      },
    ],
    config: {
      protectedPaths: ["~/Documents/Exports"],
    },
    manifestYaml: `id: com.valet.uninstall-scrubber
name: 卸载清道夫
version: 1.1.0
events:
  - id: app.uninstalled
  - id: app.orphan_found`,
  },
  {
    id: "process-sentinel",
    slug: "process-sentinel",
    name: "进程哨兵",
    tagline: "盯住 CPU、内存与能耗异常的进程",
    description: "每 5 秒采样一次高耗能进程，识别失控的编译脚本、死循环监听或内存泄漏。",
    version: "v1.0.4",
    bundleId: "com.valet.process-sentinel",
    iconKind: "pulse",
    source: "core",
    enabled: true,
    installed: true,
    defaultBehaviorHint: "无需额外权限 · 默认：结束进程前先问",
    statusSubtitle: "每 5 秒采样 · 今日拦截 2 次",
    weeklyImpactValue: "9",
    weeklyImpactUnit: "次",
    weeklyImpactLabel: "本周拦截失控进程",
    triggers24h: [6, 9, 7, 16, 8, 6, 7, 18, 6, 5],
    events: [
      {
        id: "process.cpu_spike",
        description: "单进程占用 CPU > 180% 持续 3 分钟",
        policy: "ask",
        count24h: 2,
      },
      {
        id: "memory.pressure",
        description: "系统内存压缩率进入黄色预警区",
        policy: "record",
        count24h: 3,
      },
      {
        id: "process.hang",
        description: "前台应用无响应超过 45 秒",
        policy: "ask",
        count24h: 0,
      },
    ],
    config: {
      sampleIntervalSec: 5,
    },
    manifestYaml: `id: com.valet.process-sentinel
name: 进程哨兵
version: 1.0.4
events:
  - id: process.cpu_spike
  - id: memory.pressure
  - id: process.hang`,
  },
  {
    id: "log-detective",
    slug: "log-detective",
    name: "日志侦探",
    tagline: "从系统日志里发现崩溃与异常",
    description: "关联 DiagnosticReports 与统一系统日志，把晦涩的堆栈翻译成你能看懂的诊断结论。",
    version: "v1.0.2",
    bundleId: "com.valet.log-detective",
    iconKind: "log",
    source: "core",
    enabled: false,
    installed: true,
    requiredPermission: "full_disk",
    requiredPermissionLabel: "完全磁盘访问",
    defaultBehaviorHint: "仅记录并生成报告",
    statusSubtitle: "生成报告 1 份",
    weeklyImpactValue: "1",
    weeklyImpactUnit: "份",
    weeklyImpactLabel: "本周生成诊断报告",
    triggers24h: [2, 2, 2, 2, 2, 10, 14, 2, 2, 2],
    events: [
      {
        id: "log.crash_loop",
        description: "同进程 30 分钟内重复崩溃超过 3 次",
        policy: "record",
        count24h: 1,
      },
      {
        id: "log.kernel_panic",
        description: "发现内核错误或 GPU 重置记录",
        policy: "ask",
        count24h: 0,
      },
      {
        id: "log.disk_io_error",
        description: "I/O 超时或外接卷异常卸载",
        policy: "record",
        count24h: 0,
      },
      {
        id: "log.wake_reason",
        description: "合盖睡眠期间频繁异常唤醒",
        policy: "record",
        count24h: 1,
      },
    ],
    config: {},
    manifestYaml: `id: com.valet.log-detective
name: 日志侦探
version: 1.0.2
permissions: [full_disk]
events:
  - id: log.crash_loop
  - id: log.kernel_panic`,
  },
  {
    id: "github-watcher",
    slug: "github-watcher",
    name: "GitHub",
    tagline: "监听仓库 CI 失败、PR Review 与安全告警",
    description: "接入 GitHub Webhook / Polling，在构建失败时自动抓取日志并给出修复定位。",
    version: "v0.9.3",
    bundleId: "com.community.github",
    iconKind: "gh",
    iconLabel: "gh",
    source: "community",
    enabled: true,
    installed: true,
    authError: "Token 已过期 · 重新授权",
    statusSubtitle: "Token 已过期 · 重新授权",
    triggers24h: [8, 12, 6, 10, 4, 2, 2, 2, 2, 2],
    events: [
      { id: "github.ci_failed", description: "默认分支工作流运行失败", policy: "ask", count24h: 1 },
      { id: "github.pr_review", description: "收到新的代码评审请求", policy: "record", count24h: 4 },
      { id: "github.dependabot", description: "高危依赖安全漏洞告警", policy: "ask", count24h: 0 },
      { id: "github.release", description: "新版本 Tag 发布通知", policy: "record", count24h: 0 },
      { id: "github.mention", description: "Issue 中被 @ 提及", policy: "record", count24h: 2 },
    ],
    config: {},
    manifestYaml: `id: com.community.github
name: GitHub
version: 0.9.3
events:
  - id: github.ci_failed
  - id: github.pr_review`,
  },
  {
    id: "calendar-focus",
    slug: "calendar-focus",
    name: "日历",
    tagline: "会前 10 分钟关闭干扰 App · 开启勿扰",
    description: "读取 macOS 日历日程，在重要会议开始前自动收起社交软件并切换专注模式。",
    version: "v1.0.0",
    bundleId: "com.community.calendar-focus",
    iconKind: "calendar",
    iconLabel: "15",
    source: "community",
    enabled: true,
    installed: true,
    requiredPermission: "automation",
    requiredPermissionLabel: "自动化",
    statusSubtitle: "会前 10 分钟关闭干扰 App · 开启勿扰",
    triggers24h: [2, 8, 2, 8, 8, 2, 8, 2, 2, 8],
    events: [
      { id: "calendar.meeting_soon", description: "日程开始前 10 分钟触发", policy: "auto", count24h: 3 },
      { id: "calendar.meeting_end", description: "会议结束恢复工作区窗口", policy: "auto", count24h: 3 },
    ],
    config: {},
    manifestYaml: `id: com.community.calendar-focus
name: 日历
version: 1.0.0
events:
  - id: calendar.meeting_soon
  - id: calendar.meeting_end`,
  },
  {
    id: "surge-doctor",
    slug: "surge-doctor",
    name: "Surge 诊断",
    tagline: "通过 script_poll 导入脱敏日志并按 Skill 排查网络故障",
    description:
      "内置 scripts/poll-errors.mjs 与 import-logs.mjs（不修改宿主代码），定期采集并脱敏 ~/Library/Logs/Surge 新增报错，借助通用核心工具定位 DNS、TUN、策略组与外部代理故障。",
    version: "v1.0.0",
    bundleId: "com.community.surge-doctor",
    iconKind: "surge",
    iconLabel: "Sg",
    source: "community",
    enabled: true,
    installed: true,
    defaultBehaviorHint: "脚本自动脱敏读取，执行 surge-cli 变更或改写配置时需你批准",
    statusSubtitle: "脚本轮询 ~/Library/Logs/Surge · Skill 已挂载",
    triggers24h: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    events: [
      {
        id: "surge.error_detected",
        description: "监测 ~/Library/Logs/Surge 新增错误与告警日志并自动导入归因",
        policy: "auto",
        sensor: "script_poll",
        sourceSummary: "script_poll · scripts/poll-errors.mjs",
        count24h: 0,
      },
      {
        id: "surge.webhook_alert",
        description: "接收 Surge Event 脚本或外部探针推送的实时网络/脚本异常",
        policy: "ask",
        sensor: "webhook",
        sourceSummary: "webhook · POST /events/surge-doctor/surge.webhook_alert",
        count24h: 0,
      },
    ],
    configSchema: [
      {
        key: "pollIntervalSec",
        label: "日志轮询间隔（秒）",
        type: "slider",
        default: 30,
        min: 5,
        max: 300,
      },
      {
        key: "windowMinutes",
        label: "日志回溯窗口（分钟）",
        type: "slider",
        default: 60,
        min: 10,
        max: 1440,
      },
    ],
    config: { values: { pollIntervalSec: 30, windowMinutes: 60 } },
    bundledFiles: [
      "manifest.yaml",
      "SKILL.md",
      "scripts/import-logs.mjs",
      "scripts/poll-errors.mjs",
      "scripts/surge-valet-event.js",
    ],
    manifestYaml: `id: com.community.surge-doctor
name: Surge 诊断
version: 1.0.0
triggers:
  - id: surge.error_detected
    sensor: script_poll
    script: scripts/poll-errors.mjs
    interval_config_key: pollIntervalSec
    interval_sec: 30
    emit_on: json
    policy: auto
  - id: surge.webhook_alert
    sensor: webhook
    policy: ask`,
    skillMarkdown: `### 触发场景
- 收到 \`surge.error_detected\` / \`surge.webhook_alert\` 或用户发起 Surge 诊断排查。

### 处理流程
1. 使用 \`bash\` 运行插件自带只读脚本 \`bun "\${VALET_PLUGIN_DIR}/scripts/import-logs.mjs" --minutes 360\` 获取最新脱敏报告。
2. 需要查看配置文件时用 \`read_file\` 只读核对异常段；如需刷新 DNS 或重载配置，先通过 \`ask_user\` 或直接运行 \`surge-cli\` 触发权限批准。`,
  },
  {
    id: "dmg-sweeper",
    slug: "dmg-sweeper",
    name: "dmg 清扫员",
    tagline: "~/Valet/plugins/dmg-sweeper · 热重载中",
    description: "监控下载文件夹中的 .dmg 安装包，在检测到对应 App 已拖入 /Applications 后自动移入废纸篓。",
    version: "v0.1.0-dev",
    bundleId: "local.valet.dmg-sweeper",
    iconKind: "code",
    iconLabel: "{ }",
    source: "local",
    enabled: true,
    installed: true,
    statusSubtitle: "~/Valet/plugins/dmg-sweeper · 热重载中",
    triggers24h: [2, 2, 2, 2, 2, 2, 2, 2, 2, 6],
    events: [
      { id: "fs.file_created", description: "~/Downloads/*.dmg 创建且对应 App 已安装", policy: "auto", count24h: 1 },
    ],
    config: {},
    manifestYaml: `id: local.valet.dmg-sweeper
name: dmg 清扫员
triggers:
  - id: fs.file_created
    sensor: fs_watch
    watch_dirs: [~/Downloads]
    glob: "*.dmg"`,
  },
  // Marketplace discoverable plugins (installed: false initially)
  {
    id: "battery-guardian",
    slug: "battery-guardian",
    name: "电池健康",
    tagline: "过充预警、耗电大户排行与合盖耗电分析",
    description: "追踪电池循环次数与夜间异常掉电，及时提醒高耗电后台进程。",
    version: "v1.3.1",
    bundleId: "com.community.battery-guardian",
    iconKind: "battery",
    iconLabel: "92%",
    source: "community",
    enabled: false,
    installed: false,
    triggers24h: [2, 4, 3, 5, 4, 2, 3, 4, 2, 3],
    events: [
      { id: "battery.drain_spike", description: "10 分钟掉电超过 6%", policy: "ask", count24h: 0 },
      { id: "battery.sleep_drain", description: "合盖睡眠掉电超过 5%", policy: "record", count24h: 0 },
    ],
    config: {},
    manifestYaml: `id: com.community.battery-guardian
name: 电池健康
version: 1.3.1
triggers:
  - id: battery.drain_spike
    sensor: command_poll`,
  },
  {
    id: "homekit-bridge",
    slug: "homekit-bridge",
    name: "HomeKit",
    tagline: "离开工位自动熄灯，进入专注自动调暗桌面台灯",
    description: "结合 Mac 锁屏与工作状态事件联动家中智能开关与灯光场景。",
    version: "v0.8.0",
    bundleId: "com.community.homekit",
    iconKind: "homekit",
    iconLabel: "HK",
    source: "community",
    enabled: false,
    installed: false,
    triggers24h: [1, 2, 1, 2, 4, 2, 1, 2, 1, 2],
    events: [
      { id: "mac.screen_locked", description: "屏幕锁定超过 5 分钟", policy: "auto", count24h: 0 },
    ],
    config: {},
    manifestYaml: `id: com.community.homekit
name: HomeKit
version: 0.8.0
triggers:
  - id: mac.screen_locked`,
  },
  {
    id: "wifi-sentinel",
    slug: "wifi-sentinel",
    name: "Wi-Fi",
    tagline: "切换公共 Wi-Fi 自动连 VPN，网络波动自动诊断 DNS",
    description: "监听网络接口切换事件，保护公共热点安全并定位丢包节点。",
    version: "v1.0.6",
    bundleId: "com.community.wifi-sentinel",
    iconKind: "wifi",
    iconLabel: "Wi",
    source: "community",
    enabled: false,
    installed: false,
    triggers24h: [2, 2, 3, 2, 5, 2, 2, 3, 2, 2],
    events: [
      { id: "net.ssid_changed", description: "切换到非信任 Wi-Fi 网络", policy: "ask", count24h: 0 },
    ],
    config: {},
    manifestYaml: `id: com.community.wifi-sentinel
name: Wi-Fi
version: 1.0.6
triggers:
  - id: net.ssid_changed`,
  },
];

export const INITIAL_TIMELINE_EVENTS: TimelineEvent[] = [
  {
    id: "evt-disk-clean-now",
    timestamp: "2026-11-15T22:41:00",
    timeLabel: "22:41",
    dayGroup: "today",
    title: "可用空间低于 15%，正在清理开发缓存",
    summary: "Xcode DerivedData、iOS 模拟器与 npm 缓存，全部移入废纸篓，7 天内可还原。",
    pluginId: "disk-guard",
    pluginName: "磁盘守卫",
    pluginBadge: "磁盘守卫",
    eventCode: "disk.low_space",
    status: "running",
    triggerLatencyLabel: "22:41 · 自动触发于可用空间低于 15%",
    progress: {
      currentLabel: "12.6 / 18.4 GB",
      currentGB: 12.6,
      totalGB: 18.4,
      pct: 68,
      targetPath: "~/Library/Developer/CoreSimulator",
    },
    payload: {
      free_ratio: "12.4%",
      threshold: "15.0%",
      volume: "/System/Volumes/Data",
      policy: "auto",
    },
    reasoning:
      "可用磁盘空间降至 12.4%（低于设定阈值 15%）。检测发现 Xcode DerivedData、过期 iOS Simulator 镜像及 npm 缓存占用了 18.4 GB，且过去 14 天未被构建引用，已按「自动处理」策略安全移入废纸篓。",
    actionItems: [
      {
        id: "act-xcode",
        label: "Xcode DerivedData",
        path: "~/Library/Developer/Xcode/DerivedData",
        sizeMB: 9400,
        sizeLabel: "9.4 GB",
        checked: true,
      },
      {
        id: "act-sim",
        label: "iOS 模拟器旧运行时",
        path: "~/Library/Developer/CoreSimulator",
        sizeMB: 6800,
        sizeLabel: "6.8 GB",
        checked: true,
      },
      {
        id: "act-npm",
        label: "npm / pnpm 全局缓存",
        path: "~/.npm/_cacache",
        sizeMB: 2200,
        sizeLabel: "2.2 GB",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "t1", time: "22:40:58", stage: "事件捕获", detail: "disk.low_space (free: 12.4% < 15%)", status: "done" },
      { id: "t2", time: "22:40:59", stage: "安全过滤", detail: "排除受保护目录 ~/Documents、~/Projects", status: "done" },
      { id: "t3", time: "22:41:00", stage: "执行移入废纸篓", detail: "正在处理 CoreSimulator (12.6 / 18.4 GB)", status: "active" },
    ],
    logs: [
      { id: "l1", ts: "22:40:58.112", level: "INFO", message: "Trigger disk.low_space received from com.valet.disk-guard" },
      { id: "l2", ts: "22:40:59.040", level: "INFO", message: "Scanned 3 safe developer cache targets (18.4 GB)" },
      { id: "l3", ts: "22:41:02.318", level: "EXEC", message: "Moving ~/Library/Developer/Xcode/DerivedData to Trash (9.4 GB)" },
      { id: "l4", ts: "22:41:05.890", level: "EXEC", message: "Moving ~/Library/Developer/CoreSimulator/Caches to Trash..." },
    ],
  },
  {
    id: "evt-docker-uninstall",
    timestamp: "2026-11-15T22:30:00",
    timeLabel: "22:30",
    dayGroup: "today",
    title: "「Docker Desktop」已被卸载，发现 12 项残留",
    summary: "共 11.4 GB：镜像、特权助手与容器缓存。",
    pluginId: "uninstall-scrubber",
    pluginName: "卸载清道夫",
    pluginBadge: "卸载清道夫",
    eventCode: "app.uninstalled",
    status: "pending_confirm",
    confirmBannerText: "共 11.4 GB：镜像、特权助手与容器缓存（镜像仓库凭据默认保留）。",
    triggerLatencyLabel: "22:30 · 触发于卸载后 48s",
    payload: {
      bundle_id: "com.docker.docker",
      removed_at: "2026-11-15T22:19:12",
      path: "/Applications/Docker.app",
    },
    reasoning:
      "App 已移除 30 分钟且未重新安装。虚拟机镜像与特权助手均无其他容器工具引用，镜像仓库凭据 ~/.docker/config.json 会为你保留。",
    actionItems: [
      {
        id: "dk-1",
        label: "~/Library/Containers/com.docker.docker/Data/vms",
        path: "~/Library/Containers/com.docker.docker/Data/vms",
        sizeMB: 11468,
        sizeLabel: "11.2 GB",
        checked: true,
      },
      {
        id: "dk-2",
        label: "/Library/PrivilegedHelperTools/com.docker.vmnetd",
        path: "/Library/PrivilegedHelperTools/com.docker.vmnetd",
        sizeMB: 4,
        sizeLabel: "特权助手",
        checked: true,
      },
      {
        id: "dk-3",
        label: "~/.docker/config.json",
        path: "~/.docker/config.json",
        sizeMB: 0,
        sizeLabel: "12 KB",
        checked: false,
        keepNote: "· 含仓库登录态，保留",
      },
      {
        id: "dk-4",
        label: "~/Library/Application Support/Docker Desktop",
        path: "~/Library/Application Support/Docker Desktop",
        sizeMB: 148,
        sizeLabel: "148 MB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-5",
        label: "~/Library/Group Containers/group.com.docker",
        path: "~/Library/Group Containers/group.com.docker",
        sizeMB: 32,
        sizeLabel: "32 MB",
        checked: true,
        defaultHidden: true,
      },
      {
        id: "dk-6",
        label: "~/Library/Caches/com.docker.docker",
        path: "~/Library/Caches/com.docker.docker",
        sizeMB: 18,
        sizeLabel: "18 MB",
        checked: true,
        defaultHidden: true,
      },
    ],
    traceSteps: [
      { id: "dkt1", time: "22:19:12", stage: "目录监听", detail: "/Applications/Docker.app 被移入废纸篓", status: "done" },
      { id: "dkt2", time: "22:29:45", stage: "关联扫描", detail: "按 com.docker.docker 匹配到 12 项残留", status: "done" },
      { id: "dkt3", time: "22:30:00", stage: "等待用户确认", detail: "策略为「问我」，挂起清理动作", status: "active" },
    ],
    logs: [
      { id: "dkl1", ts: "22:19:12.401", level: "INFO", message: "FSEvent: Removed /Applications/Docker.app" },
      { id: "dkl2", ts: "22:29:45.109", level: "INFO", message: "Found 12 remnant paths totaling 11.4 GB; excluded credentials" },
      { id: "dkl3", ts: "22:30:00.004", level: "WARN", message: "Policy=ask -> waiting for user approval before moving to Trash" },
    ],
  },
  {
    id: "evt-node-cpu-spike",
    timestamp: "2026-11-15T21:58:00",
    timeLabel: "21:58",
    dayGroup: "today",
    title: "node 占用 CPU 240% 持续 6 分钟",
    summary: "定位为 vite 监听死循环（PID 48211），经你同意后已结束。",
    pluginId: "process-sentinel",
    pluginName: "进程哨兵",
    pluginBadge: "进程哨兵",
    eventCode: "process.cpu_spike",
    status: "completed",
    intercepted: true,
    reclaimedGB: 1.9,
    triggerLatencyLabel: "21:58 · 采样窗口 30s",
    payload: {
      pid: 48211,
      command: "node ./node_modules/.bin/vite",
      cpu_avg: "240.4%",
      duration_sec: 360,
    },
    reasoning:
      "该进程来自已关闭的终端会话，因监听目录包含 build 输出产生死循环编译，连续 6 分钟占用 2.4 个核心并推高风扇转速。",
    actionItems: [
      {
        id: "np-1",
        label: "向 PID 48211 发送 SIGTERM 优雅终止",
        path: "PID 48211 · node · vite",
        sizeMB: 0,
        sizeLabel: "已释放 1.9 GB 内存",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "nt1", time: "21:52:00", stage: "指标采样", detail: "检测到 node CPU 持续 > 180%", status: "done" },
      { id: "nt2", time: "21:57:40", stage: "询问用户", detail: "在对话工作台确认结束 vite 进程", status: "done" },
      { id: "nt3", time: "21:58:02", stage: "执行完成", detail: "进程已退出，CPU 回落至 18%", status: "done" },
    ],
    logs: [
      { id: "nl1", ts: "21:57:10.002", level: "INFO", message: "process.cpu_spike matched pid=48211 (node)" },
      { id: "nl2", ts: "21:58:01.994", level: "EXEC", message: "Sent SIGTERM to pid=48211; exited cleanly with code 0" },
    ],
  },
  {
    id: "evt-large-files",
    timestamp: "2026-11-15T21:14:00",
    timeLabel: "21:14",
    dayGroup: "today",
    title: "发现 2 个超过 90 天未打开的巨型文件（3.4 GB）",
    summary: "~/Downloads/macos-15.1-restore.ipsw（2.6 GB）与 Paper-demo-raw.mov（820 MB）。",
    pluginId: "disk-guard",
    pluginName: "磁盘守卫",
    pluginBadge: "磁盘守卫",
    eventCode: "disk.large_file",
    status: "pending_confirm",
    confirmBannerText: "发现 3.4 GB 长期闲置文件，已送入收件箱等待你确认移入废纸篓。",
    triggerLatencyLabel: "21:14 · 来自磁盘定时扫描",
    payload: {
      threshold_gb: 2,
      idle_days: 90,
      candidate_count: 2,
      total_gb: 3.4,
    },
    reasoning:
      "两个文件均超过设定的 90 天未打开大文件阈值，位于 ~/Downloads 下，已避开 ~/Documents 与 ~/Projects 受保护路径。",
    actionItems: [
      {
        id: "lf-1",
        label: "~/Downloads/macos-15.1-restore.ipsw",
        path: "~/Downloads/macos-15.1-restore.ipsw",
        sizeMB: 2662,
        sizeLabel: "2.6 GB",
        checked: true,
      },
      {
        id: "lf-2",
        label: "~/Downloads/Paper-demo-raw.mov",
        path: "~/Downloads/Paper-demo-raw.mov",
        sizeMB: 820,
        sizeLabel: "820 MB",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "lft1", time: "21:13:52", stage: "磁盘扫描", detail: "遍历非受保护目录超过 2 GB 的闲置文件", status: "done" },
      { id: "lft2", time: "21:14:00", stage: "等待批准", detail: "策略为「问我」，已推送至收件箱等待确认", status: "active" },
    ],
    logs: [
      { id: "lfl1", ts: "21:13:52.090", level: "INFO", message: "Found 2 idle large files (>90d) totaling 3.4 GB" },
    ],
  },
  {
    id: "evt-rust-analyzer",
    timestamp: "2026-11-15T20:42:00",
    timeLabel: "20:42",
    dayGroup: "today",
    title: "rust-analyzer 进程持续空转（PID 61904）",
    summary: "连续 9 分钟占用 CPU 285% · 内存 4.1 GB，等待确认发送 SIGTERM。",
    pluginId: "process-sentinel",
    pluginName: "进程哨兵",
    pluginBadge: "进程哨兵",
    eventCode: "proc.high_cpu",
    status: "pending_confirm",
    intercepted: true,
    confirmBannerText: "孤儿进程 rust-analyzer（PID 61904）持续占用 285% CPU，终止操作不可撤销，已送入收件箱等待确认。",
    triggerLatencyLabel: "20:42 · 持续高于 200% 超过 5 分钟",
    payload: {
      pid: 61904,
      command: "rust-analyzer --stdio",
      cpu_avg: "285%",
      memory_gb: 4.1,
      parent_tty_alive: false,
    },
    reasoning:
      "rust-analyzer 不在忽略进程名单内，父进程终端已退出，当前变为孤儿进程持续空转并消耗 4.1 GB 内存。发送 SIGTERM 无法撤销正在进行的索引状态，按安全级别需要你确认。",
    actionItems: [
      {
        id: "ra-1",
        label: "发送 SIGTERM 至 PID 61904（rust-analyzer）",
        path: "PID 61904 · TTY 已关闭",
        sizeMB: 0,
        sizeLabel: "释放 4.1 GB 内存",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "rat1", time: "20:37:00", stage: "异常检测", detail: "PID 61904 CPU 持续 > 200%", status: "done" },
      { id: "rat2", time: "20:42:00", stage: "等待人工确认", detail: "进程终止属于不可撤销操作", status: "active" },
    ],
    logs: [
      { id: "ral1", ts: "20:42:00.120", level: "WARN", message: "Orphan pid=61904 rust-analyzer at 285% CPU, 4.1 GB RSS" },
    ],
  },
  {
    id: "evt-windowserver-crash",
    timestamp: "2026-11-15T20:15:00",
    timeLabel: "20:15",
    dayGroup: "today",
    title: "WindowServer 30 分钟内崩溃 3 次",
    summary: "关联到外接显示器的 DisplayLink 驱动 v11.2，已生成诊断报告。",
    pluginId: "log-detective",
    pluginName: "日志侦探",
    pluginBadge: "日志侦探",
    eventCode: "log.crash_loop",
    status: "completed",
    intercepted: true,
    triggerLatencyLabel: "20:15 · 自动归因 DiagnosticReports",
    payload: {
      process: "WindowServer",
      crash_count_30m: 3,
      suspected_kext: "DisplayLinkDriver v11.2",
    },
    reasoning:
      "3 份 .ips 崩溃报告均在显示器唤醒时于 CoreDisplay / DisplayLink 虚拟帧缓冲帧内触发空指针解引用，建议升级 DisplayLink Manager 至 v11.4+。",
    actionItems: [
      {
        id: "ws-1",
        label: "生成归因报告 ~/Documents/Valet/WindowServer-Report.md",
        path: "~/Documents/Valet/WindowServer-Report.md",
        sizeMB: 0,
        sizeLabel: "48 KB",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "wt1", time: "20:14:50", stage: "日志采集", detail: "读取 3 份 WindowServer.ips", status: "done" },
      { id: "wt2", time: "20:15:00", stage: "堆栈归因", detail: "定位到 DisplayLink v11.2 驱动帧异常", status: "done" },
    ],
    logs: [
      { id: "wl1", ts: "20:14:52.100", level: "INFO", message: "Parsed 3 crash reports from /Library/Logs/DiagnosticReports" },
      { id: "wl2", ts: "20:15:00.412", level: "INFO", message: "Saved diagnosis summary to ~/Documents/Valet/WindowServer-Report.md" },
    ],
  },
  {
    id: "evt-calendar-reply",
    timestamp: "2026-11-15T19:55:00",
    timeLabel: "19:55",
    dayGroup: "today",
    title: "拦截「设计周会」顺延回复外发草稿",
    summary: "检测到 20:00 日程冲突，已拟好顺延 10 分钟草稿并等待批准发送。",
    pluginId: "calendar-focus",
    pluginName: "日历",
    pluginBadge: "日历",
    eventCode: "cal.conflict_reply",
    status: "pending_confirm",
    intercepted: true,
    confirmBannerText: "外发邮件/日程回复受安全规则保护，等待你在收件箱确认发送。",
    triggerLatencyLabel: "19:55 · 外发消息安全拦截",
    payload: {
      meeting: "设计周会",
      recipient: "lin.chen@company.example",
      draft: "前序评审顺延，我约 20:10 接入",
      requires_approval: true,
    },
    reasoning:
      "日历插件检测到当前进行的评审与 20:00「设计周会」重叠，已自动为你拟好礼貌顺延回复。根据「发送消息、邮件始终需确认」规则，必须经你批准后才允许发出。",
    actionItems: [
      {
        id: "cal-1",
        label: "发送邮件/日程备注至「设计周会」组织者",
        path: "lin.chen@company.example",
        sizeMB: 0,
        sizeLabel: "外发 1 条",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "calt1", time: "19:54:50", stage: "冲突检测", detail: "前序会议尚未结束且距离 20:00 仅剩 5 分钟", status: "done" },
      { id: "calt2", time: "19:55:00", stage: "外发拦截", detail: "等待批准发送回复草稿", status: "active" },
    ],
    logs: [
      { id: "call1", ts: "19:55:00.018", level: "WARN", message: "Outbound reply draft held by safety rule confirmChecklist.sendMessageOrEmail" },
    ],
  },
  {
    id: "evt-github-ci-fail",
    timestamp: "2026-11-15T18:02:00",
    timeLabel: "18:02",
    dayGroup: "today",
    title: "valet/main 的 CI 失败",
    summary: "插件 Token 已过期，Valet 无法读取构建日志。",
    pluginId: "github-watcher",
    pluginName: "GitHub",
    pluginBadge: "GitHub · 第三方",
    eventCode: "github.ci_failed",
    status: "failed",
    authFixPluginId: "github-watcher",
    triggerLatencyLabel: "18:02 · Webhook 接收",
    payload: {
      repo: "dd/valet",
      branch: "main",
      http_status: 401,
      error: "Bad credentials / Token expired",
    },
    reasoning:
      "GitHub 插件在尝试拉取 workflow run #418 日志时收到 401 Unauthorized，需要重新授权个人访问令牌。",
    actionItems: [],
    traceSteps: [
      { id: "gt1", time: "18:02:00", stage: "Webhook 到达", detail: "workflow_run.completed (conclusion: failure)", status: "done" },
      { id: "gt2", time: "18:02:01", stage: "拉取构建日志", detail: "HTTP 401: Token 已过期", status: "error" },
    ],
    logs: [
      { id: "gl1", ts: "18:02:01.004", level: "ERR", message: "GitHub API 401 Unauthorized: personal access token expired" },
    ],
  },
  {
    id: "evt-yesterday-1",
    timestamp: "2026-11-14T23:00:00",
    timeLabel: "昨天 23:00",
    dayGroup: "earlier",
    title: "夜间定时整理「下载」文件夹",
    summary: "归档 19 个安装包与截图，释放 4.5 GB 空间。",
    pluginId: "disk-guard",
    pluginName: "磁盘守卫",
    pluginBadge: "磁盘守卫",
    eventCode: "disk.cache_bloat",
    status: "completed",
    reclaimedGB: 4.5,
    canRestore: true,
    triggerLatencyLabel: "昨天 23:00 · 定时任务",
    payload: {
      folder: "~/Downloads",
      moved_files: 19,
      reclaimed_gb: 4.5,
    },
    reasoning: "按照「每晚 23:00 整理下载文件夹」规则，已把超过 7 天的 .dmg/.zip 移入废纸篓，图片移入按月归档目录。",
    actionItems: [
      {
        id: "y1-a",
        label: "14 个过期 .dmg 与 .pkg 安装包",
        path: "~/Downloads/*.dmg",
        sizeMB: 4608,
        sizeLabel: "4.5 GB",
        checked: true,
      },
    ],
    traceSteps: [
      { id: "yt1", time: "23:00:00", stage: "定时唤醒", detail: "执行自动化规则「整理下载文件夹」", status: "done" },
      { id: "yt2", time: "23:00:04", stage: "完成", detail: "释放 4.5 GB", status: "done" },
    ],
    logs: [
      { id: "yl1", ts: "23:00:04.221", level: "EXEC", message: "Moved 14 installer archives (4.5 GB) to Trash" },
    ],
  },
  {
    id: "evt-yesterday-2",
    timestamp: "2026-11-14T15:20:00",
    timeLabel: "昨天 15:20",
    dayGroup: "earlier",
    title: "会前自动开启勿扰并隐藏即时通讯窗口",
    summary: "检测到「产品评审周会」将于 10 分钟后开始。",
    pluginId: "calendar-focus",
    pluginName: "日历",
    pluginBadge: "日历 · 第三方",
    eventCode: "calendar.meeting_soon",
    status: "completed",
    intercepted: true,
    triggerLatencyLabel: "昨天 15:20 · 日历事件触发",
    payload: {
      event_title: "产品评审周会",
      starts_in_min: 10,
    },
    reasoning: "遵循日历插件自动策略，已开启 macOS 勿扰模式并暂时隐藏非会议相关弹窗应用。",
    actionItems: [],
    traceSteps: [
      { id: "ct1", time: "15:20:00", stage: "日历触发", detail: "calendar.meeting_soon", status: "done" },
      { id: "ct2", time: "15:20:01", stage: "切换专注", detail: "已开启专注模式", status: "done" },
    ],
    logs: [
      { id: "cl1", ts: "15:20:01.005", level: "INFO", message: "Focus mode enabled for 60m" },
    ],
  },
];

export const INITIAL_PROJECTS: Project[] = [
  {
    id: DEFAULT_PROJECT_ID,
    title: "默认项目",
    description:
      "自动收纳所有快速发起与历史迁移的对话；可随时归类移入专属项目，或切换至 Notebook 用 Markdown 整理备忘。",
    icon: "box",
    tags: [],
    isDefault: true,
    updatedAt: "刚刚",
    createdAt: "2026-11-15",
    blocks: [
      {
        id: "blk-default-intro",
        type: "callout",
        content:
          "这里记录零散灵感与日常巡检备忘；在任意空白行输入 @valet 可直接发起新对话并在原位引用，或输入 / 插入 Markdown 块。",
      },
      {
        id: "blk-default-1",
        type: "paragraph",
        content: "",
      },
    ],
  },
  {
    id: "proj-perf",
    title: "Mac 性能与存储治理",
    description: "集中追踪卡顿排查、开发缓存清理与自动巡检规则沉淀。",
    icon: "book",
    tags: ["性能诊断", "磁盘治理", "自动化"],
    workingDir: "~/Projects/valet",
    updatedAt: "刚刚",
    createdAt: "2026-11-15",
    blocks: [
      {
        id: "blk-perf-h2",
        type: "h2",
        content: "现象与排查线索",
      },
      {
        id: "blk-perf-callout",
        type: "callout",
        content:
          "本周连续两天切换窗口明显卡顿，磁盘剩余空间跌破 12%。所有诊断线索与修复动作统一记录在本页，需要执行排查时直接输入 `@valet` 发起会话。",
      },
      {
        id: "blk-perf-p1",
        type: "paragraph",
        content:
          "初步观察是后台开发服务 CPU 占用异常，已通过 [[session:chat-mac-slow]] 确认是未关闭的 `vite` 持续重编译吃掉 **2.4 核 CPU**。",
      },
      {
        id: "blk-perf-todo-1",
        type: "todo",
        checked: true,
        content: "终止失控的 node · vite 进程（已释放 1.9 GB 内存）",
      },
      {
        id: "blk-perf-todo-2",
        type: "todo",
        checked: false,
        content: "扫描并清理 ~/Library/Caches 与 Xcode DerivedData 超过 2 GB 的缓存目录",
      },
      {
        id: "blk-perf-todo-3",
        type: "todo",
        checked: false,
        content: "沉淀为每周自动巡检插件规则，磁盘低于 15% 时提醒",
      },
      {
        id: "blk-perf-ref-1",
        type: "session_ref",
        sessionId: "chat-mac-slow",
        content: "Mac 为什么变卡了",
        summary: "主要是 node 在拖后腿：一个忘记关闭的 vite 开发服务在反复重新编译，吃掉了 2.4 个核。",
      },
      {
        id: "blk-perf-code",
        type: "code",
        language: "bash",
        content: "du -sh ~/Library/Caches/* ~/Library/Developer/Xcode/DerivedData/* | sort -rh | head -n 5",
      },
    ],
  },
];

export const INITIAL_CHAT_THREADS: ChatThread[] = [
  {
    id: "chat-mac-slow",
    projectId: "proj-perf",
    originBlockId: "blk-perf-ref-1",
    originSection: "现象与排查线索",
    notebookContextInjected: true,
    title: "Mac 为什么变卡了",
    model: "claude-opus-4",
    timelineActionCount: 2,
    linkedEventIds: ["evt-node-cpu-spike", "evt-disk-clean-now"],
    updatedAt: "刚刚",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "最近风扇一直转，切窗口都卡，帮我看看怎么回事？",
        createdAt: "21:55",
      },
      {
        id: "m2",
        role: "assistant",
        metaLabel: "采样 30s · 进程哨兵",
        content:
          "主要是 `node` 在拖后腿：一个忘记关闭的 vite 开发服务在反复重新编译，吃掉了 2.4 个核。另外磁盘只剩 12%，系统在频繁交换内存。",
        createdAt: "21:56",
        processTable: {
          rows: [
            {
              id: "proc-vite",
              name: "node · vite",
              cpuPct: 240,
              memLabel: "1.9 GB",
              sourceLabel: "终端",
              severity: "high",
            },
            {
              id: "proc-chrome",
              name: "Google Chrome Helper",
              cpuPct: 38,
              memLabel: "3.2 GB",
              sourceLabel: "31 个标签页",
              severity: "normal",
            },
            {
              id: "proc-mds",
              name: "mds_stores",
              cpuPct: 22,
              memLabel: "410 MB",
              sourceLabel: "聚焦索引",
              severity: "normal",
            },
          ],
          primaryActionDone: false,
          secondaryActionDone: false,
          autoRuleAdded: false,
        },
      },
      {
        id: "m3",
        role: "user",
        content: "顺便帮我做个插件：下载文件夹里装完的 .dmg 自动删掉。",
        createdAt: "22:10",
      },
      {
        id: "m4",
        role: "assistant",
        content: "已经按你的需求起草了一份本地插件规则，它只会在对应应用已安装到 /Applications 后把 .dmg 移入废纸篓：",
        createdAt: "22:11",
        pluginDraft: {
          id: "dmg-sweeper",
          name: "dmg 清扫员",
          whenExpression: "when fs.file_created(~/Downloads/*.dmg)",
          actionExpression: "and app_installed_from(dmg) → move_to_trash",
          installed: true,
          manifestYaml: `id: local.valet.dmg-sweeper
name: dmg 清扫员
version: 0.1.0
triggers:
  - id: fs.file_created
    sensor: fs_watch
    watch_dirs: [~/Downloads]
    glob: "*.dmg"
condition:
  - app_installed_from(dmg)`,
        },
      },
    ],
  },
  {
    id: "chat-dmg-plugin",
    projectId: DEFAULT_PROJECT_ID,
    title: "做一个 .dmg 自动清理插件",
    model: "claude-opus-4",
    timelineActionCount: 1,
    linkedEventIds: [],
    updatedAt: "昨天",
    messages: [
      {
        id: "m2-1",
        role: "user",
        content: "每次装完软件都会忘删下载目录里的 dmg 镜像，能自动判断装好后就清掉吗？",
        createdAt: "昨天 19:20",
      },
      {
        id: "m2-2",
        role: "assistant",
        metaLabel: "插件生成器",
        content: "可以，我可以通过监听 `fs.file_created` 并在 10 分钟后检查 `/Applications` 是否出现同名 `.app` 来安全移入废纸篓。",
        createdAt: "昨天 19:21",
      },
    ],
  },
  {
    id: "chat-docker-remnants",
    projectId: DEFAULT_PROJECT_ID,
    title: "Docker 残留清单",
    model: "claude-opus-4",
    timelineActionCount: 1,
    linkedEventIds: ["evt-docker-uninstall"],
    updatedAt: "22:30",
    messages: [
      {
        id: "m3-1",
        role: "user",
        content: "Docker Desktop 卸掉后会不会把我的镜像仓库登录凭据也删了？",
        createdAt: "22:31",
      },
      {
        id: "m3-2",
        role: "assistant",
        metaLabel: "卸载清道夫",
        content: "不会。`~/.docker/config.json` 已被自动标记为「含仓库登录态，保留」且默认取消勾选；其余 11 项虚拟机镜像与特权助手也会先移入废纸篓，7 天内随时可还原。",
        createdAt: "22:31",
      },
    ],
  },
];

export const INITIAL_PROVIDERS: AgentProviderConfig[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    letter: "A",
    subtitle: "Claude 系列 · 推荐",
    apiKey: "sk-ant-api03-mock-92a4c0e8d1b57f3a",
    apiKeyMasked: "sk-ant-••••••••••••••••7f3a",
    baseUrl: "https://api.anthropic.com",
    proxyUrl: "",
    orgId: "",
    endpoint: "",
    verified: true,
    latencyMs: 312,
    availableModelCount: 9,
    models: ["claude-opus-4", "claude-sonnet-4", "claude-haiku-4"],
    connected: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    letter: "O",
    subtitle: "GPT 系列",
    apiKey: "",
    apiKeyMasked: "",
    baseUrl: "https://api.openai.com/v1",
    proxyUrl: "",
    orgId: "",
    endpoint: "",
    verified: false,
    availableModelCount: 11,
    models: ["gpt-5", "gpt-5-mini", "o4-mini"],
    connected: false,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    letter: "G",
    subtitle: "长上下文 · 多模态",
    apiKey: "",
    apiKeyMasked: "",
    baseUrl: "https://generativelanguage.googleapis.com",
    proxyUrl: "",
    orgId: "",
    endpoint: "",
    verified: false,
    availableModelCount: 6,
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    connected: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    letter: "R",
    subtitle: "一个 Key 访问多家",
    apiKey: "",
    apiKeyMasked: "",
    baseUrl: "https://openrouter.ai/api/v1",
    proxyUrl: "",
    orgId: "",
    endpoint: "",
    verified: false,
    availableModelCount: 42,
    models: ["anthropic/claude-opus-4", "openai/gpt-5", "google/gemini-2.5-pro"],
    connected: false,
  },
  {
    id: "ollama",
    name: "Ollama",
    letter: "L",
    subtitle: "本地模型 · 离线",
    apiKey: "",
    apiKeyMasked: "",
    baseUrl: "http://localhost:11434",
    proxyUrl: "",
    orgId: "",
    endpoint: "localhost:11434",
    verified: false,
    availableModelCount: 3,
    models: ["qwen3:32b", "llama3.3:70b", "deepseek-r1:14b"],
    connected: false,
  },
  {
    id: "custom",
    name: "自定义",
    letter: "+",
    subtitle: "OpenAI 兼容接口",
    apiKey: "",
    apiKeyMasked: "",
    baseUrl: "",
    proxyUrl: "",
    orgId: "",
    endpoint: "",
    verified: false,
    availableModelCount: 0,
    models: ["custom-reasoning", "custom-fast"],
    connected: false,
  },
];

export const INITIAL_AUTOMATIONS: AutomationRule[] = [
  {
    id: "auto-downloads",
    scheduleTop: "每晚",
    scheduleBottom: "23:00",
    title: "整理「下载」文件夹",
    enabled: true,
    triggerType: "cron",
  },
  {
    id: "auto-weekly",
    scheduleTop: "周五",
    scheduleBottom: "17:30",
    title: "汇总周报并发给我",
    enabled: true,
    triggerType: "cron",
  },
  {
    id: "auto-screenshots",
    scheduleTop: "当…",
    scheduleBottom: "时",
    title: "桌面出现新截图",
    subtitle: "重命名并移入「截图」",
    enabled: false,
    triggerType: "event",
  },
];

export const INITIAL_MCP_SERVERS: McpServerItem[] = [
  {
    id: "mcp-fs",
    abbr: "fs",
    name: "Filesystem",
    transportLabel: "stdio · 12 tools",
    toolCount: 12,
    enabled: true,
  },
  {
    id: "mcp-gh",
    abbr: "gh",
    name: "GitHub",
    transportLabel: "http · 26 tools",
    toolCount: 26,
    enabled: true,
  },
  {
    id: "mcp-nt",
    abbr: "nt",
    name: "Notion",
    transportLabel: "http · 14 tools",
    toolCount: 14,
    enabled: false,
    authExpired: true,
  },
];

export const INITIAL_MEMORIES: MemoryEntry[] = [
  {
    id: "mem-1",
    content: "回复始终使用简体中文，先给结论再展开细节。",
    source: "自定义指令",
    createdAt: "2026-11-10",
  },
  {
    id: "mem-2",
    content: "工作产物与导出文件优先保存在 ~/Documents/Valet，禁止清理 ~/Projects。",
    source: "对话学习",
    createdAt: "2026-11-12",
  },
  {
    id: "mem-3",
    content: "工作日早上 9:00 前避免发出非关键提醒通知。",
    source: "对话学习",
    createdAt: "2026-11-14",
  },
];

export const INITIAL_PREFERENCES: ValetPreferences = {
  launchAtLogin: true,
  showMenuBarIcon: true,
  appearance: "light",
  darkTheme: "cursor",
  language: "简体中文",
  globalHotkey: ["⌥", "Space"],
  busyMessagePolicy: "queue",

  activeProviderId: "anthropic",
  models: {
    primary: "claude-opus-4",
    fast: "claude-haiku-4",
    vision: "同主模型",
  },
  autoReview: {
    engine: "auto",
    jevEndpoint: "https://api.typesafe.ai/v1/systemone",
    jevApiKey: "",
    jevApiKeyMasked: "",
    jevModel: "jev-latest",
    fallbackProviderId: "",
    fallbackModel: "同快速模型",
  },
  dailySpendCurrent: 18.4,
  dailySpendLimit: 30,
  maxStepsPerTask: 50,

  userNickname: "dd",
  toneStyle: "concise",
  customInstructions:
    "- 回复用中文，先给结论再给细节\n- 文件一律存到 ~/Documents/Valet\n- 工作日 9:00 前不要发通知",

  autonomyLevel: "auto_review",
  confirmChecklist: {
    deleteOrOverwrite: false,
    sendMessageOrEmail: true,
    paymentOrSubscription: true,
    runTerminalCommand: false,
    modifySystemSettings: false,
  },
  blockedApps: ["钥匙串访问", "招商银行", "1Password"],
  emergencyStopShortcut: ["⌥", "⎋"],

  thresholds: DEFAULT_THRESHOLDS,
  cleanupPolicy: DEFAULT_CLEANUP_POLICY,
  pluginRuntime: DEFAULT_PLUGIN_RUNTIME,
  heartbeat: {
    enabled: true,
    initialized: true,
    intervalMin: 30,
    prompt: "巡检当前待处理的系统与应用事件、收件箱待确认事项及后台服务状态；若发现需要关注的异常则按自治策略响应或汇总至收件箱，若一切平稳则静默记录心跳。",
  },

  memoryEnabled: true,
  autoLearnMemory: true,

  holdToSpeakKey: "fn",
  wakeWordEnabled: false,
  speechLanguage: "中文 + English",
  speakReplies: "仅语音提问时",

  notifyOnConfirm: true,
  notifyOnComplete: true,
  notifyOnFailure: true,
  followFocusMode: true,

  recordActionReplay: true,
  blurSensitiveInfo: true,
  timelineRetentionDays: "30 天",
};

export const INITIAL_SYSTEM_METRICS: SystemMetrics = {
  diskPct: 88,
  diskFreeGB: 38,
  diskTotalGB: 494,
  cpuPct: 31,
  memPct: 64,
  activeTaskLabel: "正在清理开发缓存 · 68%",
  activeTaskPct: 68,
  activeTaskEventId: "evt-disk-clean-now",
};

export const INITIAL_SCAN_STATE: ScanState = {
  status: "done",
  progressPct: 76,
  elapsedSec: 42,
  reclaimableGB: 23.1,
  tasks: [
    {
      id: "disk",
      title: "磁盘",
      detail: "可用 38 GB / 494 GB · 发现 18.4 GB 开发缓存",
      sizeLabel: "18.4 GB",
      sizeGB: 18.4,
      status: "done",
    },
    {
      id: "orphan",
      title: "卸载残留",
      detail: "3 个已删除的 App 留下 41 项文件",
      sizeLabel: "4.7 GB",
      sizeGB: 4.7,
      status: "done",
    },
    {
      id: "process",
      title: "进程",
      detail: "正在采样 30 秒内的 CPU / 内存…",
      sizeLabel: "12s",
      sizeGB: 0,
      status: "running",
      durationHint: "12s",
    },
    {
      id: "log",
      title: "系统日志",
      detail: "日志侦探未启用，已跳过",
      sizeLabel: "—",
      sizeGB: 0,
      status: "skipped",
    },
  ],
};

export function createInitialSnapshot(): ValetSnapshot {
  return {
    onboardingCompleted: false,
    onboardingStep: 1,
    activeView: "inbox",
    activeSettingsSection: "thresholds",
    isOnDuty: true,
    isPaused: false,
    activePluginDetailId: null,
    activeProjectId: DEFAULT_PROJECT_ID,
    activeProjectTab: "sessions",
    activeChatId: "chat-mac-slow",
    selectedTimelineEventId: null,
    selectedInboxItemId: null,
    timelinePluginFilter: "all",
    permissions: INITIAL_PERMISSIONS,
    plugins: INITIAL_PLUGINS,
    providers: INITIAL_PROVIDERS,
    inboxItems: INITIAL_INBOX_ITEMS,
    inboxProcessedHistoryCount: 9,
    timelineEvents: INITIAL_TIMELINE_EVENTS,
    earlierCountLabel: "昨天 · 22 个动作 ↓",
    projects: INITIAL_PROJECTS,
    chatThreads: INITIAL_CHAT_THREADS,
    automations: INITIAL_AUTOMATIONS,
    mcpServers: INITIAL_MCP_SERVERS,
    memories: INITIAL_MEMORIES,
    heartbeatLogs: [],
    preferences: INITIAL_PREFERENCES,
    systemMetrics: INITIAL_SYSTEM_METRICS,
    scan: INITIAL_SCAN_STATE,
  };
}
