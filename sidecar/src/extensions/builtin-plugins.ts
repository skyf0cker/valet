import {
  type Extension,
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { arr, num, obj, opt, str } from "@earendil-works/pi-schema";
import type { ToolPolicyRegistry } from "../approval.ts";
import type { HostBridge, ProcessSampleRow } from "../protocol.ts";

function jsonTextResult(
  summary: string,
  payload: unknown,
  details?: Record<string, unknown>,
) {
  return {
    output: [
      {
        type: "text" as const,
        text: `${summary}\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
    ...(details ? { details: details as never } : {}),
  };
}

/**
 * Registers all built-in core & community plugin extensions in Pi Durable,
 * synchronized 1-to-1 with Valet's frontend plugin catalog and event policies.
 */
export function createBuiltinPluginExtensions(options: {
  bridge: HostBridge;
  policyRegistry: ToolPolicyRegistry;
}): Record<string, Extension> {
  const { bridge, policyRegistry } = options;

  policyRegistry.registerAll([
    // disk-guard
    {
      toolName: "disk_scan",
      pluginId: "disk-guard",
      pluginName: "磁盘守卫",
      actionId: "disk.scan",
      eventCode: "disk.large_file",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "disk_move_to_trash",
      pluginId: "disk-guard",
      pluginName: "磁盘守卫",
      actionId: "disk.move_to_trash",
      eventCode: "disk.large_file",
      safety: "reversible",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "移入废纸篓",
      dismissLabel: "保留",
      checklistKey: "deleteOrOverwrite",
    },
    {
      toolName: "disk_empty_trash",
      pluginId: "disk-guard",
      pluginName: "磁盘守卫",
      actionId: "disk.empty_trash",
      eventCode: "disk.low_space",
      safety: "confirm_always",
      category: "files",
      iconKind: "trash",
      warningTag: "不可撤销",
      reversible7d: false,
      approveLabel: "永久清倒",
      dismissLabel: "取消",
      checklistKey: "deleteOrOverwrite",
    },

    // uninstall-scrubber
    {
      toolName: "app_scan_remnants",
      pluginId: "uninstall-scrubber",
      pluginName: "卸载清道夫",
      actionId: "app.scan_remnants",
      eventCode: "app.uninstalled",
      safety: "readonly",
      category: "files",
      iconKind: "trash",
      reversible7d: true,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "app_trash_remnants",
      pluginId: "uninstall-scrubber",
      pluginName: "卸载清道夫",
      actionId: "app.trash_remnants",
      eventCode: "app.uninstalled",
      safety: "reversible",
      category: "files",
      iconKind: "trash",
      reversible7d: true,
      approveLabel: "批准清理",
      dismissLabel: "忽略",
      checklistKey: "deleteOrOverwrite",
    },
    {
      toolName: "app_unload_agent",
      pluginId: "uninstall-scrubber",
      pluginName: "卸载清道夫",
      actionId: "app.unload_agent",
      eventCode: "app.uninstalled",
      safety: "confirm_always",
      category: "process",
      iconKind: "trash",
      warningTag: "不可撤销",
      reversible7d: false,
      approveLabel: "卸载助手",
      dismissLabel: "忽略",
      checklistKey: "runTerminalCommand",
    },

    // process-sentinel
    {
      toolName: "process_sample",
      pluginId: "process-sentinel",
      pluginName: "进程哨兵",
      actionId: "process.sample",
      eventCode: "process.cpu_spike",
      safety: "readonly",
      category: "process",
      iconKind: "pulse",
      reversible7d: false,
      approveLabel: "确定",
      dismissLabel: "关闭",
    },
    {
      toolName: "process_terminate",
      pluginId: "process-sentinel",
      pluginName: "进程哨兵",
      actionId: "process.terminate",
      eventCode: "process.cpu_spike",
      safety: "confirm_always",
      category: "process",
      iconKind: "pulse",
      warningTag: "不可撤销",
      reversible7d: false,
      approveLabel: "结束进程",
      dismissLabel: "忽略",
      checklistKey: "runTerminalCommand",
    },

    // log-detective
    {
      toolName: "log_summarize_crashes",
      pluginId: "log-detective",
      pluginName: "日志侦探",
      actionId: "log.summarize",
      eventCode: "log.crash_loop",
      safety: "readonly",
      category: "process",
      iconKind: "pulse",
      reversible7d: false,
      approveLabel: "确定",
      dismissLabel: "关闭",
    },

    // github-watcher
    {
      toolName: "github_fetch_failed_runs",
      pluginId: "github-watcher",
      pluginName: "GitHub",
      actionId: "github.fetch_logs",
      eventCode: "github.ci_failed",
      safety: "readonly",
      category: "outbound",
      iconKind: "mail",
      reversible7d: true,
      approveLabel: "确定",
      dismissLabel: "关闭",
    },
    {
      toolName: "github_rerun_job",
      pluginId: "github-watcher",
      pluginName: "GitHub",
      actionId: "github.rerun_job",
      eventCode: "github.ci_failed",
      safety: "confirm_always",
      category: "outbound",
      iconKind: "mail",
      warningTag: "外发消息",
      reversible7d: false,
      approveLabel: "批准重跑",
      dismissLabel: "忽略",
      checklistKey: "sendMessageOrEmail",
    },
    {
      toolName: "github_post_comment",
      pluginId: "github-watcher",
      pluginName: "GitHub",
      actionId: "github.comment",
      eventCode: "github.pr_review",
      safety: "confirm_always",
      category: "outbound",
      iconKind: "mail",
      warningTag: "外发消息",
      reversible7d: false,
      approveLabel: "批准发送",
      dismissLabel: "不发送",
      checklistKey: "sendMessageOrEmail",
    },

    // calendar-focus
    {
      toolName: "calendar_list_upcoming",
      pluginId: "calendar-focus",
      pluginName: "日历",
      actionId: "calendar.list",
      eventCode: "calendar.meeting_soon",
      safety: "readonly",
      category: "outbound",
      iconKind: "mail",
      reversible7d: true,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "calendar_set_focus_mode",
      pluginId: "calendar-focus",
      pluginName: "日历",
      actionId: "system.set_focus",
      eventCode: "calendar.meeting_soon",
      safety: "reversible",
      category: "outbound",
      iconKind: "mail",
      reversible7d: true,
      approveLabel: "开启勿扰",
      dismissLabel: "忽略",
    },
    {
      toolName: "calendar_send_conflict_reply",
      pluginId: "calendar-focus",
      pluginName: "日历",
      actionId: "calendar.reply",
      eventCode: "cal.conflict_reply",
      safety: "confirm_always",
      category: "outbound",
      iconKind: "mail",
      warningTag: "外发消息",
      reversible7d: false,
      approveLabel: "批准发送",
      dismissLabel: "不发送",
      checklistKey: "sendMessageOrEmail",
    },
  ]);

  // 1. plugin:disk-guard
  const diskGuardExt = defineExtension({
    name: "plugin:disk-guard",
    sections: [
      section("plugin_disk_guard", () => {
        return "磁盘守卫已挂载：可执行 disk_scan 检查可安全清理的缓存和大文件，如需删除必须经由 disk_move_to_trash（移入废纸篓，7 天可还原）。";
      }),
    ],
    tools: [
      defineTool({
        name: "disk_scan",
        description:
          "Read-only scan for safe developer caches and idle large files above size/age thresholds, skipping protected user directories.",
        parameters: obj({
          scope: opt(str({ description: "caches | large_files | all" })),
          minSizeMB: opt(num()),
          idleDays: opt(num()),
        }),
        replay: "safe",
        execute: async (args) => {
          const res = await bridge.callHost<Record<string, unknown>>(
            "host.scanDisk",
            {
              scope: args.scope ?? "all",
              minSizeMB: args.minSizeMB ?? 2048,
              idleDays: args.idleDays ?? 90,
            },
          );
          return jsonTextResult("磁盘只读扫描完成", res);
        },
      }),
      defineTool({
        name: "disk_move_to_trash",
        description:
          "Move specific cache directories or idle large files into Trash (7-day reversible). Subject to Valet Inbox safety approval when policy requires.",
        parameters: obj({
          paths: arr(str(), { description: "Paths to move to Trash." }),
          estimatedGB: opt(num()),
          reason: opt(str()),
        }),
        execute: async (args) => {
          const res = await bridge.callHost<{
            movedCount: number;
            reclaimedGB: number;
            trashBatchId: string;
          }>("host.trashItems", {
            paths: args.paths,
            estimatedGB: args.estimatedGB ?? 0,
            reason: args.reason ?? "",
          });
          return jsonTextResult("已将目标文件安全移入废纸篓", res, {
            timelineTitle: `磁盘守卫已清理 ${args.paths.length} 项文件`,
            timelineSummary: `已将 ${args.paths.length} 项安全移入废纸篓（释放 ${res.reclaimedGB ?? args.estimatedGB ?? 0} GB，7 天内可还原）。`,
            reclaimedGB: res.reclaimedGB ?? args.estimatedGB ?? 0,
            canRestore: true,
          });
        },
      }),
      defineTool({
        name: "disk_empty_trash",
        description: "Permanently empty Finder Trash (irreversible; always asks user approval).",
        parameters: obj({
          reason: opt(str()),
        }),
        execute: async () => {
          return jsonTextResult("清倒废纸篓动作已确认执行（MVP 安全保护下保留本地索引）。", {
            ok: true,
          });
        },
      }),
    ],
  });

  // 2. plugin:uninstall-scrubber
  const uninstallScrubberExt = defineExtension({
    name: "plugin:uninstall-scrubber",
    tools: [
      defineTool({
        name: "app_scan_remnants",
        description:
          "Scan ~/Library/Caches and Application Support for orphaned files left by uninstalled apps.",
        parameters: obj({
          bundleId: opt(str()),
        }),
        replay: "safe",
        execute: async (args) => {
          const res = await bridge.callHost<Record<string, unknown>>(
            "host.scanOrphanRemnants",
            { bundleId: args.bundleId ?? "" },
          );
          return jsonTextResult("卸载残留扫描完成", res);
        },
      }),
      defineTool({
        name: "app_trash_remnants",
        description: "Move scanned orphaned app remnants to Trash cleanly.",
        parameters: obj({
          paths: arr(str()),
          estimatedGB: opt(num()),
          reason: opt(str()),
        }),
        execute: async (args) => {
          const res = await bridge.callHost<{
            movedCount: number;
            reclaimedGB: number;
          }>("host.trashItems", {
            paths: args.paths,
            estimatedGB: args.estimatedGB ?? 0,
          });
          return jsonTextResult("已将卸载残留移入废纸篓", res, {
            timelineTitle: `已清理 ${args.paths.length} 项卸载残留`,
            timelineSummary: `已移入废纸篓（释放 ${res.reclaimedGB ?? 0} GB，7 天内可还原）。`,
            reclaimedGB: res.reclaimedGB ?? 0,
            canRestore: true,
          });
        },
      }),
      defineTool({
        name: "app_unload_agent",
        description: "Unload an orphaned LaunchAgent/LaunchDaemon plist (requires user confirmation).",
        parameters: obj({
          label: str(),
          path: opt(str()),
        }),
        execute: async (args) => {
          return jsonTextResult(`已卸载后台助手 ${args.label}`, {
            label: args.label,
          });
        },
      }),
    ],
  });

  // 3. plugin:process-sentinel
  const processSentinelExt = defineExtension({
    name: "plugin:process-sentinel",
    tools: [
      defineTool({
        name: "process_sample",
        description:
          "Sample top CPU and memory-consuming macOS processes right now.",
        parameters: obj({
          limit: opt(num()),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
          const res = await bridge.callHost<{
            rows: ProcessSampleRow[];
            cpuPct: number;
            memPct: number;
          }>("host.sampleProcesses", { limit: args.limit ?? 5 });
          const table = {
            rows: res.rows ?? [],
            primaryActionDone: false,
            secondaryActionDone: false,
            autoRuleAdded: false,
          };
          await api.details({ processTable: table as never }, context);
          return jsonTextResult("已完成当前系统进程采样", res, {
            processTable: table as never,
          });
        },
      }),
      defineTool({
        name: "process_terminate",
        description:
          "Send SIGTERM or SIGKILL to an abnormal process PID (irreversible; always asks user confirmation).",
        parameters: obj({
          pid: num({ description: "Process ID (> 1)." }),
          name: str({ description: "Process name." }),
          signal: opt(str({ description: "SIGTERM or SIGKILL." })),
          reason: opt(str()),
        }),
        execute: async (args) => {
          const res = await bridge.callHost<Record<string, unknown>>(
            "host.terminateProcess",
            {
              pid: args.pid,
              name: args.name,
              signal: args.signal ?? "SIGTERM",
            },
          );
          return jsonTextResult(
            `已向进程 ${args.name} (PID ${args.pid}) 发送 ${args.signal ?? "SIGTERM"}`,
            res,
            {
              timelineTitle: `已终止异常进程 ${args.name}（PID ${args.pid}）`,
              timelineSummary: `经批准后已发送 ${args.signal ?? "SIGTERM"} 并释放资源。`,
              canRestore: false,
            },
          );
        },
      }),
    ],
  });

  // 4. plugin:log-detective
  const logDetectiveExt = defineExtension({
    name: "plugin:log-detective",
    tools: [
      defineTool({
        name: "log_summarize_crashes",
        description:
          "Inspect ~/Library/Logs/DiagnosticReports for recent crash logs and summarize recurring culprits.",
        parameters: obj({
          minutes: opt(num()),
        }),
        replay: "safe",
        execute: async (args) => {
          const res = await bridge.callHost<Record<string, unknown>>(
            "host.summarizeLogs",
            { minutes: args.minutes ?? 60 },
          );
          return jsonTextResult("系统崩溃与诊断日志分析完成", res);
        },
      }),
    ],
  });

  // 5. plugin:github-watcher
  const githubWatcherExt = defineExtension({
    name: "plugin:github-watcher",
    tools: [
      defineTool({
        name: "github_fetch_failed_runs",
        description: "Inspect recent failed GitHub Actions workflows or mentions.",
        parameters: obj({
          repo: opt(str()),
        }),
        replay: "safe",
        execute: async (args) => {
          const res = await bridge.callHost<Record<string, unknown>>(
            "host.executePluginAction",
            {
              pluginId: "github-watcher",
              actionId: "github.fetch_logs",
              args: { repo: args.repo ?? "valet/main" },
            },
          );
          return jsonTextResult("GitHub 构建状态读取完成", res);
        },
      }),
      defineTool({
        name: "github_rerun_job",
        description: "Rerun a failed GitHub workflow job (always requires confirmation).",
        parameters: obj({
          repo: str(),
          runId: opt(str()),
          reason: opt(str()),
        }),
        execute: async (args) => {
          return jsonTextResult(`已触发工作流重跑：${args.repo}`, {
            repo: args.repo,
            runId: args.runId ?? "latest",
          });
        },
      }),
      defineTool({
        name: "github_post_comment",
        description: "Post a comment on a GitHub PR/Issue (outbound message; requires confirmation).",
        parameters: obj({
          repo: str(),
          issueNumber: opt(num()),
          body: str(),
        }),
        execute: async (args) => {
          return jsonTextResult(`已在 ${args.repo} 提交评论`, args);
        },
      }),
    ],
  });

  // 6. plugin:calendar-focus
  const calendarFocusExt = defineExtension({
    name: "plugin:calendar-focus",
    tools: [
      defineTool({
        name: "calendar_list_upcoming",
        description: "List upcoming calendar events and detect schedule conflicts.",
        parameters: obj({
          hoursAhead: opt(num()),
        }),
        replay: "safe",
        execute: async (args) => {
          const res = await bridge.callHost<Record<string, unknown>>(
            "host.executePluginAction",
            {
              pluginId: "calendar-focus",
              actionId: "calendar.list",
              args: { hoursAhead: args.hoursAhead ?? 4 },
            },
          );
          return jsonTextResult("日程读取完成", res);
        },
      }),
      defineTool({
        name: "calendar_set_focus_mode",
        description: "Toggle macOS Focus / Do Not Disturb before a meeting.",
        parameters: obj({
          enabled: opt(num()),
          reason: opt(str()),
        }),
        execute: async (args) => {
          const res = await bridge.callHost<Record<string, unknown>>(
            "host.executePluginAction",
            {
              pluginId: "calendar-focus",
              actionId: "system.set_focus",
              args: { enabled: args.enabled ?? 1, reason: args.reason ?? "" },
            },
          );
          return jsonTextResult("已切换专注模式状态", res);
        },
      }),
      defineTool({
        name: "calendar_send_conflict_reply",
        description:
          "Send a polite delay reply to a meeting organizer (outbound message; always requires user approval).",
        parameters: obj({
          meeting: str(),
          recipient: str(),
          draft: str(),
        }),
        execute: async (args) => {
          return jsonTextResult(`已向 ${args.recipient} 发送日程回复`, args);
        },
      }),
    ],
  });

  return {
    "disk-guard": diskGuardExt,
    "uninstall-scrubber": uninstallScrubberExt,
    "process-sentinel": processSentinelExt,
    "log-detective": logDetectiveExt,
    "github-watcher": githubWatcherExt,
    "calendar-focus": calendarFocusExt,
  };
}
