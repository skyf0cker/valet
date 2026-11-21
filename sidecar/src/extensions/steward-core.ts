import {
  type Extension,
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { arr, bool, num, obj, opt, str } from "@earendil-works/pi-schema";
import type {
  AlwaysOnOutboxMessage,
  AlwaysOnTimerRecord,
  AlwaysOnTimerStatus,
  ResidentStateInfo,
} from "../always-on.ts";
import type {
  InteractivePermissionCoordinator,
  ToolPolicyRegistry,
  TurnSideEffectTracker,
} from "../approval.ts";

export interface AlwaysOnToolBridge {
  getResidentState(): Promise<ResidentStateInfo | null>;
  wakeMeAt(params: {
    delaySeconds?: number;
    atIso?: string;
    everySeconds?: number;
    startAtIso?: string;
    label?: string;
    note: string;
  }): Promise<AlwaysOnTimerRecord>;
  cancelWake(timerId: string): Promise<AlwaysOnTimerRecord | null>;
  listTimers(status?: AlwaysOnTimerStatus): Promise<AlwaysOnTimerRecord[]>;
  notify(params: {
    title?: string;
    body: string;
    level?: "info" | "warn" | "urgent";
    dedupeKey?: string;
    callId?: string;
  }): Promise<AlwaysOnOutboxMessage>;
}
import type {
  HostBridge,
  PluginDraftSpec,
  QueueApprovalParams,
  ValetSyncState,
} from "../protocol.ts";
import { resolveBuiltinSkills } from "./builtin-skills.ts";

function textResult(text: string, details?: Record<string, unknown>) {
  return {
    output: [{ type: "text" as const, text }],
    ...(details ? { details: details as never } : {}),
  };
}

/**
 * Core Valet Steward extension (`valet:core`):
 * Injects persona, safety policy, memories, builtin skills, and active plugin index,
 * plus universal OS tools (`system_overview`, `bash`, `read_file`,
 * `write_file`, `trash_files`, `kill_process`, `ask_user`, `memory_remember`,
 * `plugin_draft_create`, `inbox_propose_approval`).
 */
export function createStewardCoreExtension(options: {
  bridge: HostBridge;
  getState: () => ValetSyncState;
  policyRegistry: ToolPolicyRegistry;
  tracker?: TurnSideEffectTracker;
  permissionCoordinator?: InteractivePermissionCoordinator;
  alwaysOn?: AlwaysOnToolBridge;
}): Extension {
  const {
    bridge,
    getState,
    policyRegistry,
    tracker,
    permissionCoordinator,
    alwaysOn,
  } = options;

  policyRegistry.registerAll([
    {
      toolName: "system_overview",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "system.overview",
      eventCode: "system.status",
      safety: "readonly",
      category: "process",
      iconKind: "pulse",
      reversible7d: false,
      approveLabel: "确定",
      dismissLabel: "关闭",
    },
    {
      toolName: "read_file",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "fs.read",
      eventCode: "system.inspect",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: false,
      approveLabel: "读取",
      dismissLabel: "取消",
    },
    {
      toolName: "write_file",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "fs.write",
      eventCode: "fs.modified",
      safety: "reversible",
      checklistKey: "deleteOrOverwrite",
      category: "files",
      iconKind: "disk",
      reversible7d: false,
      approveLabel: "批准写入",
      dismissLabel: "拒绝",
    },
    {
      toolName: "trash_files",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "fs.trash",
      eventCode: "fs.cleaned",
      safety: "reversible",
      checklistKey: "deleteOrOverwrite",
      category: "files",
      iconKind: "trash",
      reversible7d: true,
      approveLabel: "移入废纸篓",
      dismissLabel: "拒绝",
    },
    {
      toolName: "kill_process",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "proc.kill",
      eventCode: "process.terminated",
      safety: "confirm_always",
      checklistKey: "runTerminalCommand",
      warningTag: "不可撤销",
      category: "process",
      iconKind: "pulse",
      reversible7d: false,
      approveLabel: "结束进程",
      dismissLabel: "取消",
    },
    {
      toolName: "bash",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "shell.bash",
      eventCode: "system.command",
      safety: "reversible",
      checklistKey: "runTerminalCommand",
      warningTag: "不可撤销",
      category: "process",
      iconKind: "pulse",
      reversible7d: false,
      approveLabel: "批准执行",
      dismissLabel: "拒绝",
    },
    {
      toolName: "ask_user",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "user.ask",
      eventCode: "user.question",
      safety: "readonly",
      category: "outbound",
      iconKind: "mail",
      reversible7d: false,
      approveLabel: "确认",
      dismissLabel: "取消",
    },
    {
      toolName: "memory_remember",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "memory.save",
      eventCode: "memory.learned",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: false,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "plugin_draft_create",
      pluginId: "valet-core",
      pluginName: "插件生成器",
      actionId: "plugin.draft",
      eventCode: "plugin.drafted",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: false,
      approveLabel: "安装",
      dismissLabel: "取消",
    },
    {
      toolName: "inbox_propose_approval",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "inbox.propose",
      eventCode: "inbox.proposed",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "批准",
      dismissLabel: "忽略",
    },
    {
      toolName: "item_resolve",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "item.resolve",
      eventCode: "item.resolved",
      safety: "reversible",
      checklistKey: "deleteOrOverwrite",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "批准执行",
      dismissLabel: "取消",
    },
    {
      toolName: "wake_me_at",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "timer.create",
      eventCode: "timer.armed",
      safety: "readonly",
      category: "process",
      iconKind: "pulse",
      reversible7d: false,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "cancel_wake",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "timer.cancel",
      eventCode: "timer.cancelled",
      safety: "readonly",
      category: "process",
      iconKind: "pulse",
      reversible7d: false,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "list_timers",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "timer.list",
      eventCode: "timer.listed",
      safety: "readonly",
      category: "process",
      iconKind: "pulse",
      reversible7d: false,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "notify",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "outbox.notify",
      eventCode: "outbox.sent",
      safety: "readonly",
      category: "outbound",
      iconKind: "mail",
      reversible7d: false,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "notebook_read",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "notebook.read",
      eventCode: "notebook.read",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: false,
      approveLabel: "读取",
      dismissLabel: "取消",
    },
    {
      toolName: "notebook_edit",
      pluginId: "valet-core",
      pluginName: "Valet Core",
      actionId: "notebook.edit",
      eventCode: "notebook.updated",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: false,
      approveLabel: "确认编辑",
      dismissLabel: "取消",
    },
  ]);

  const bashTool = defineTool({
    name: "bash",
    description:
      "Execute a macOS shell command (/bin/zsh). Read-only inspection commands (ls, ps, df, networksetup, pmset, read-only plugin poll-/import- scripts, etc.) run immediately; mutating commands trigger interactive Chat permission approval or queue an Inbox approval card in background mode.",
    parameters: obj({
      command: str({ description: "Shell command string to execute." }),
      cwd: opt(
        str({
          description:
            "Working directory (supports ~, defaults to user home directory).",
        }),
      ),
      timeoutSec: opt(num({ description: "Timeout in seconds (1-90, default 20)." })),
      reason: opt(
        str({
          description:
            "Concise Chinese explanation of why this command is needed.",
        }),
      ),
    }),
    execute: async (args) => {
      const res = await bridge.callHost<{
        ok: boolean;
        command: string;
        cwd: string;
        exitCode: number;
        durationMs: number;
        output: string;
        summary: string;
      }>("host.kernel.bash", {
        command: args.command,
        cwd: args.cwd,
        timeoutSec: args.timeoutSec,
      });
      const body = `[exit=${res.exitCode}, cwd=${res.cwd}, ${res.durationMs}ms]\n${res.output || "(无标准输出)"}`;
      const details = {
        bashResult: res,
        canRestore: false,
      };
      if (res.exitCode !== 0 && !res.ok) {
        return {
          output: [{ type: "text" as const, text: body }],
          isError: true,
          details: details as never,
        };
      }
      return textResult(body, details);
    },
  });

  const systemOverviewTool = defineTool({
    name: "system_overview",
    description:
      "Read live macOS disk capacity, free space, CPU/memory metrics, enabled plugins, and top processes.",
    parameters: obj({}),
    replay: "safe",
    execute: async (_args, api, context) => {
      const overview = await bridge.callHost<Record<string, unknown>>(
        "host.kernel.overview",
        {},
      );
      const topProcesses = Array.isArray(overview?.topProcesses)
        ? overview.topProcesses
        : [];
      const details: Record<string, unknown> = { overview };
      if (topProcesses.length > 0) {
        const processTable = {
          rows: topProcesses,
          primaryActionDone: false,
          secondaryActionDone: false,
          autoRuleAdded: false,
        };
        details.processTable = processTable;
        await api.details({ processTable: processTable as never }, context);
      }
      return textResult(JSON.stringify(overview, null, 2), details);
    },
  });

  const readFileTool = defineTool({
    name: "read_file",
    description:
      "Read a UTF-8 text file safely (logs, configs, SKILL.md, scripts) with line offset & limit. Never accesses SSH/Keychain credentials.",
    parameters: obj({
      path: str({ description: "Absolute or ~/ path to read." }),
      offsetLine: opt(num({ description: "1-based starting line number (default 1)." })),
      limitLines: opt(num({ description: "Max lines to read (default 200, max 500)." })),
    }),
    replay: "safe",
    execute: async (args) => {
      const res = await bridge.callHost<{
        path: string;
        totalLines: number;
        startLine: number;
        endLine: number;
        content: string;
      }>("host.kernel.readFile", args as unknown as Record<string, unknown>);
      return textResult(
        `[file=${res.path} lines ${res.startLine}-${res.endLine}/${res.totalLines}]\n${res.content}`,
        { fileRead: res as never },
      );
    },
  });

  const writeFileTool = defineTool({
    name: "write_file",
    description:
      "Create, overwrite, or append a text file. Subject to safety permission approval.",
    parameters: obj({
      path: str({ description: "Target file path (supports ~)." }),
      content: str({ description: "Text content to write." }),
      append: opt(bool({ description: "Append instead of overwriting when true." })),
      reason: opt(str({ description: "Concise Chinese explanation of the write." })),
    }),
    execute: async (args) => {
      const res = await bridge.callHost<{
        ok: boolean;
        path: string;
        bytesWritten: number;
      }>("host.kernel.writeFile", args as unknown as Record<string, unknown>);
      return textResult(`已写入文件 ${res.path} (${res.bytesWritten} bytes)`, {
        timelineTitle: `写入文件：${res.path}`,
        timelineSummary: `写入 ${res.bytesWritten} 字节`,
        canRestore: false,
      });
    },
  });

  const trashFilesTool = defineTool({
    name: "trash_files",
    description:
      "Move specific files or directories into Finder Trash / Valet Vault (7-day reversible). Subject to safety permission approval and protectedDirs guard.",
    parameters: obj({
      paths: arr(str(), { description: "List of concrete filesystem paths to move to Trash." }),
      reason: opt(str({ description: "Concise Chinese explanation of why these paths can be trashed." })),
    }),
    execute: async (args) => {
      const res = await bridge.callHost<{
        ok: boolean;
        batchId: string;
        movedCount: number;
        reclaimedGB: number;
        summary: string;
      }>("host.kernel.trashFiles", args as unknown as Record<string, unknown>);
      return textResult(res.summary || JSON.stringify(res), {
        timelineTitle: `已移入废纸篓（${res.movedCount} 项）`,
        timelineSummary: res.summary,
        canRestore: res.movedCount > 0,
        reclaimedGB: res.reclaimedGB,
      });
    },
  });

  const killProcessTool = defineTool({
    name: "kill_process",
    description:
      "Terminate a specific OS process PID with SIGTERM or SIGKILL (respects blockedApps). Always requires explicit confirmation.",
    parameters: obj({
      pid: num({ description: "Numeric process ID (> 1)." }),
      name: str({ description: "Process display/binary name." }),
      signal: opt(str({ description: "Signal to send: SIGTERM (default) or SIGKILL." })),
      reason: opt(str({ description: "Concise Chinese explanation." })),
    }),
    execute: async (args) => {
      const res = await bridge.callHost<{
        ok: boolean;
        pid: number;
        name: string;
        signal: string;
        summary: string;
      }>("host.kernel.killProcess", args as unknown as Record<string, unknown>);
      return textResult(res.summary || JSON.stringify(res), {
        timelineTitle: `结束进程 ${res.name} (PID ${res.pid})`,
        timelineSummary: res.summary,
        canRestore: false,
      });
    },
  });

  const askUserTool = defineTool({
    name: "ask_user",
    description:
      "Ask the user a structured question with optional clickable choices when disambiguation, confirmation of strategy, or human judgment is needed. In interactive Chat, suspends until the user responds; in background mode, queues an Inbox question card.",
    parameters: obj({
      question: str({ description: "Clear question in Chinese for the user." }),
      options: opt(arr(str(), { description: "Optional clickable answer choices." })),
      context: opt(str({ description: "Optional short background context." })),
    }),
    execute: async (args, api) => {
      const optsList = Array.isArray(args.options)
        ? args.options.map((o) => String(o).trim()).filter(Boolean)
        : undefined;
      if (permissionCoordinator?.isForegroundChat(api.conversationId)) {
        const chatId = permissionCoordinator.getChatId(api.conversationId)!;
        const res = await permissionCoordinator.requestInteractive({
          chatId,
          toolName: "ask_user",
          title: "需要你的确认或选择",
          summary: args.context ? `${args.question}\n${args.context}` : args.question,
          options: optsList,
          approveLabel: "确认提交",
          dismissLabel: "跳过",
        });
        if (!res.approved && res.decision === "deny") {
          return textResult(
            `用户选择暂不处理或拒绝回答${res.note ? `（备注：${res.note}）` : ""}。`,
            { askUserCancelled: true },
          );
        }
        const chosen = res.note?.trim() || res.decision;
        return textResult(`用户回复：${chosen}`, {
          askUserAnswer: chosen,
        });
      }

      // Background sensor/heartbeat turn: queue an Inbox card for user review
      const sourceChatId = permissionCoordinator?.getChatId(api.conversationId);
      const state = getState();
      const sourcePluginId = sourceChatId?.startsWith("event:")
        ? sourceChatId.slice("event:".length)
        : undefined;
      const sourcePlugin = sourcePluginId
        ? state.plugins.find(
            (p) => p.id === sourcePluginId || p.slug === sourcePluginId,
          )
        : undefined;
      const cleanQuestion = args.question.trim();
      const title =
        cleanQuestion.length > 120
          ? `${cleanQuestion.slice(0, 119)}…`
          : cleanQuestion;
      const queued = await bridge.callHost<{
        inboxId: string;
        timelineEventId: string;
      }>("host.queueApproval", {
        pluginId: sourcePlugin?.id ?? "valet-core",
        pluginName: sourcePlugin?.name ?? "Valet 管家",
        eventCode: "user.question",
        category: "outbound",
        iconKind: "mail",
        title,
        summary: args.context ? `${cleanQuestion} · ${args.context}` : cleanQuestion,
        reasoning: optsList?.length
          ? `备选方案：${optsList.join(" / ")}`
          : cleanQuestion,
        reversible7d: false,
        approveLabel: optsList?.[0] ?? "确认回复",
        dismissLabel: "忽略",
        toolName: "ask_user",
        toolArgs: {
          question: cleanQuestion,
          options: optsList,
          ...(args.context ? { context: args.context } : {}),
          ...(sourceChatId ? { sourceChatId } : {}),
        },
        options: optsList,
        sourceChatId,
        actionItems: [],
      } satisfies QueueApprovalParams as unknown as Record<string, unknown>);
      if (queued?.inboxId) {
        tracker?.recordInbox(
          api.conversationId,
          queued.inboxId,
          queued.timelineEventId,
        );
      }
      return textResult(
        `当前处于后台运行模式，已将问题提交至「收件箱」(${queued?.inboxId ?? ""})等待用户确认。`,
        { queued },
      );
    },
  });

  const memoryRememberTool = defineTool({
    name: "memory_remember",
    description:
      "Persist a durable user preference or workflow habit into local Valet memory.",
    parameters: obj({
      content: str({ description: "Concise preference statement to remember." }),
      source: opt(str({ description: "Origin label, defaults to 对话学习." })),
    }),
    execute: async (args) => {
      const saved = await bridge.callHost<Record<string, unknown>>(
        "host.kernel.saveMemory",
        {
          content: args.content,
          source: args.source ?? "对话学习",
        },
      );
      return textResult(`已记住偏好：${args.content}`, { memory: saved as never });
    },
  });

  const pluginDraftCreateTool = defineTool({
    name: "plugin_draft_create",
    description:
      "Draft an Action-less pluggable Valet plugin bundle (custom event trigger/sensor + SKILL.md processing workflow). Valet core tools execute the Skill without needing static action declarations.",
    parameters: obj({
      name: str({ description: "Display name of the plugin in Chinese or English." }),
      slug: opt(str({ description: "Kebab-case identifier suffix." })),
      eventCode: str({ description: "Custom event code such as git.ci_failed or fs.file_created." }),
      sensor: opt(
        str({
          description:
            "Event source type: fs_watch | command_poll | script_poll | http_poll | webhook | cron",
        }),
      ),
      glob: opt(str({ description: "Path glob pattern when sensor=fs_watch." })),
      command: opt(str({ description: "Shell probe command when sensor=command_poll." })),
      script: opt(str({ description: "Relative script path when sensor=script_poll." })),
      url: opt(str({ description: "HTTP/JSON endpoint when sensor=http_poll." })),
      schedule: opt(str({ description: "5-field cron expression when sensor=cron." })),
      intervalSec: opt(num({ description: "Polling interval in seconds." })),
      policy: opt(str({ description: "Default event policy: auto | ask | record." })),
      actionSummary: opt(str({ description: "Human-readable description of intended response workflow." })),
      actionId: opt(str({ description: "Optional legacy label describing intended step (not emitted as static action)." })),
      targetPath: opt(str({ description: "Optional destination directory or file target." })),
      condition: opt(str({ description: "Optional guard condition expression." })),
      skillMarkdown: opt(
        str({
          description:
            "Markdown instructions (SKILL.md) defining how Valet analyzes the event payload and calls core tools.",
        }),
      ),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const id =
        args.slug?.trim() ||
        `local-${Date.now().toString(36).slice(-4)}`;
      const resolvedSensor =
        args.sensor?.trim() ||
        (args.glob
          ? "fs_watch"
          : args.script
            ? "script_poll"
            : args.command
              ? "command_poll"
              : args.url
                ? "http_poll"
                : args.schedule
                  ? "cron"
                  : "webhook");
      const whenExpression =
        resolvedSensor === "fs_watch" && args.glob
          ? `when ${args.eventCode}(${args.glob})`
          : resolvedSensor === "command_poll" && args.command
            ? `when ${args.eventCode} [cmd: ${args.command}]`
            : resolvedSensor === "script_poll" && args.script
              ? `when ${args.eventCode} [script: ${args.script}]`
              : resolvedSensor === "http_poll" && args.url
                ? `when ${args.eventCode} [http: ${args.url}]`
                : resolvedSensor === "cron" && args.schedule
                  ? `when ${args.eventCode} [cron: ${args.schedule}]`
                  : `when ${args.eventCode} [${resolvedSensor}]`;
      const actionLabel =
        args.actionSummary?.trim() ||
        args.actionId?.trim() ||
        (args.targetPath ? `处理 ${args.targetPath}` : "按 Skill 自主响应");
      const condSuffix = args.condition ? `${args.condition} -> ` : "";
      const actionExpression = `${condSuffix}${actionLabel}`;

      const watchDir = args.glob
        ? args.glob.includes("/")
          ? args.glob.slice(0, args.glob.lastIndexOf("/"))
          : "~/Downloads"
        : "";
      const policy = args.policy?.trim() || "ask";
      const skillText =
        args.skillMarkdown?.trim() ||
        [
          `### 触发条件`,
          `- 当通过 \`${resolvedSensor}\` 收到 \`${args.eventCode}\` 事件时触发本插件。`,
          ``,
          `### 处理流程`,
          `1. 使用 \`read_file\` / \`bash\` 检查事件 \`payload\` 中的变更对象与上下文。`,
          `2. 根据状况调用通用核心工具（${args.targetPath ? `如涉及 \`${args.targetPath}\` 的 \`trash_files\` / \`write_file\`` : "如 \`trash_files\`、\`write_file\`、\`bash\`"}）执行响应；如需人工裁决可调用 \`ask_user\`，危险工具调用也会自动请求用户批准。`,
        ].join("\n");

      const yamlLines = [
        `id: local.valet.${id}`,
        `name: ${args.name}`,
        `version: 0.1.0`,
        `triggers:`,
        `  - id: ${args.eventCode}`,
        `    sensor: ${resolvedSensor}`,
        `    policy: ${policy}`,
      ];
      if (resolvedSensor === "fs_watch" && args.glob) {
        if (watchDir) yamlLines.push(`    watch_dirs: [${watchDir}]`);
        yamlLines.push(`    ops: [create]`);
        yamlLines.push(`    glob: "${args.glob}"`);
      }
      if (args.command) {
        yamlLines.push(`    command: "${args.command.replace(/"/g, '\\"')}"`);
        yamlLines.push(`    interval_sec: ${args.intervalSec ?? 60}`);
        yamlLines.push(`    emit_on: change`);
      }
      if (args.script) {
        yamlLines.push(`    script: "${args.script.replace(/"/g, '\\"')}"`);
        yamlLines.push(`    interval_sec: ${args.intervalSec ?? 30}`);
        yamlLines.push(`    emit_on: json`);
      }
      if (args.url) {
        yamlLines.push(`    url: "${args.url}"`);
        yamlLines.push(`    interval_sec: ${args.intervalSec ?? 60}`);
        yamlLines.push(`    emit_on: change`);
      }
      if (args.schedule) {
        yamlLines.push(`    schedule: "${args.schedule}"`);
      }
      if (args.condition) {
        yamlLines.push(`condition:`);
        yamlLines.push(`  - ${args.condition}`);
      }
      yamlLines.push(`skill: |`);
      for (const line of skillText.split("\n")) {
        yamlLines.push(`  ${line}`);
      }

      const draft: PluginDraftSpec = {
        id,
        name: args.name,
        whenExpression,
        actionExpression,
        manifestYaml: yamlLines.join("\n"),
        sensor: resolvedSensor,
        skillMarkdown: skillText,
        installed: false,
      };
      await api.details({ pluginDraft: draft as never }, context);
      return textResult(
        `已生成闭环插件草稿「${draft.name}」(${whenExpression} -> ${actionExpression})`,
        { pluginDraft: draft as never },
      );
    },
  });

  const inboxProposeApprovalTool = defineTool({
    name: "inbox_propose_approval",
    description:
      "Queue an explicit human approval card in Valet Inbox for background tasks or multi-item file cleanup plans. For file actions, you MUST supply a non-empty paths array.",
    parameters: obj({
      pluginId: opt(str()),
      title: str(),
      summary: str(),
      category: opt(str()),
      reversible7d: opt(bool()),
      paths: opt(arr(str())),
      estimatedGB: opt(num()),
    }),
    execute: async (args, api) => {
      const category =
        args.category === "process" || args.category === "outbound"
          ? args.category
          : "files";
      const cleanPaths = Array.isArray(args.paths)
        ? args.paths.map((p) => String(p).trim()).filter(Boolean)
        : [];
      if (category === "files" && cleanPaths.length === 0) {
        return {
          output: [
            {
              type: "text" as const,
              text: "提交文件清理审批失败：必须提供非空的 paths 文件路径列表，或直接调用 trash_files 并传入具体 paths。",
            },
          ],
          isError: true,
        };
      }

      const state = getState();
      const estimatedGB =
        typeof args.estimatedGB === "number" && Number.isFinite(args.estimatedGB)
          ? args.estimatedGB
          : undefined;
      const pluginId = args.pluginId?.trim() || "valet-core";
      const matchedPlugin = state.plugins.find(
        (p) => p.id === pluginId || p.slug === pluginId,
      );
      const pluginName = matchedPlugin?.name ?? "Valet 管家";
      const toolName = category === "files" ? "trash_files" : "ask_user";

      const actionItems = cleanPaths.map((p, idx) => ({
        id: `propose-${Date.now()}-${idx + 1}`,
        label: p,
        path: p,
        sizeMB:
          estimatedGB && estimatedGB > 0
            ? Math.round(((estimatedGB * 1024) / cleanPaths.length) * 10) / 10
            : 0,
        sizeLabel:
          cleanPaths.length === 1 && estimatedGB && estimatedGB > 0
            ? `${estimatedGB} GB`
            : "待确认项目",
        checked: true,
      }));

      const req: QueueApprovalParams = {
        pluginId,
        pluginName,
        eventCode:
          category === "files" ? "fs.cleanup_proposed" : "system.proposed",
        category,
        iconKind: category === "process" ? "pulse" : "disk",
        title: args.title,
        summary: args.summary,
        reasoning: args.summary,
        reversible7d: args.reversible7d ?? (category === "files"),
        reclaimableGB: estimatedGB,
        approveLabel: category === "files" ? "移入废纸篓" : "批准执行",
        dismissLabel: "忽略",
        toolName,
        toolArgs:
          cleanPaths.length > 0
            ? { paths: cleanPaths, ...(estimatedGB ? { estimatedGB } : {}) }
            : {},
        actionItems,
      };
      const queued = await bridge.callHost<{
        inboxId: string;
        timelineEventId: string;
      }>("host.queueApproval", req as unknown as Record<string, unknown>);
      if (queued?.inboxId) {
        tracker?.recordInbox(
          api.conversationId,
          queued.inboxId,
          queued.timelineEventId,
        );
      }
      return textResult(`已提交收件箱待批事项 ${queued?.inboxId ?? ""}`, {
        queued,
      });
    },
  });

  const itemResolveTool = defineTool({
    name: "item_resolve",
    description:
      "Approve, dismiss, execute, ignore, or restore an existing Inbox approval item or Timeline pending confirmation event quoted by the user in foreground Chat. Never available in background turns.",
    parameters: obj({
      source: str({ description: "Item source: \"inbox\" or \"timeline\"." }),
      id: str({ description: "Target inboxItem.id or timelineEvent.id." }),
      action: str({
        description:
          "Action to perform: \"approve\", \"dismiss\", \"execute\", \"ignore\", or \"restore\".",
      }),
      checkedActionIds: opt(
        arr(str(), {
          description:
            "Optional subset of actionItem IDs to keep checked before executing/approving.",
        }),
      ),
      checkedPaths: opt(
        arr(str(), {
          description:
            "Optional subset of actionItem paths/labels to keep checked before executing/approving.",
        }),
      ),
      reason: opt(
        str({ description: "Concise Chinese explanation of the user's decision." }),
      ),
    }),
    execute: async (args, api) => {
      if (!permissionCoordinator?.isForegroundChat(api.conversationId)) {
        return {
          output: [
            {
              type: "text" as const,
              text: "安全边界拒绝：item_resolve 仅允许在前台用户交互对话中调用，后台任务禁止自行审批事项。",
            },
          ],
          isError: true,
        };
      }
      const res = await bridge.callHost<{
        ok: boolean;
        source: string;
        id: string;
        action: string;
        summary: string;
      }>("host.item.resolve", {
        source: args.source,
        id: args.id,
        action: args.action,
        checkedActionIds: args.checkedActionIds,
        checkedPaths: args.checkedPaths,
      });
      return textResult(res.summary || `已完成操作 ${args.action} (${args.id})`, {
        resolvedItem: res as never,
      });
    },
  });

  const wakeMeAtTool = defineTool({
    name: "wake_me_at",
    description:
      "Schedule a durable self-wake timer (one-shot follow_up via delaySeconds/atIso, or drift-free periodic schedule via everySeconds >= 60). When due, the timer fires atomically into Valet's Event Inbox.",
    parameters: obj({
      delaySeconds: opt(
        num({
          description:
            "One-shot delay in seconds (10 to 2592000). Mutually exclusive with atIso/everySeconds.",
        }),
      ),
      atIso: opt(
        str({
          description:
            "One-shot future ISO-8601 timestamp (e.g. 2026-11-20T18:00:00+08:00).",
        }),
      ),
      everySeconds: opt(
        num({
          description:
            "Periodic interval in seconds (>= 60) for a drift-free repeating schedule timer.",
        }),
      ),
      startAtIso: opt(
        str({
          description:
            "Optional ISO-8601 anchor time for periodic schedule timers.",
        }),
      ),
      label: opt(str({ description: "Short human-readable timer label." })),
      note: str({
        description:
          "Context / instructions delivered back to you when the timer fires.",
      }),
    }),
    execute: async (args) => {
      if (!alwaysOn) {
        return {
          output: [{ type: "text" as const, text: "Always-On 定时器引擎未初始化。" }],
          isError: true,
        };
      }
      const timer = await alwaysOn.wakeMeAt({
        delaySeconds: args.delaySeconds,
        atIso: args.atIso,
        everySeconds: args.everySeconds,
        startAtIso: args.startAtIso,
        label: args.label,
        note: args.note,
      });
      return textResult(
        `已创建定时器 ${timer.id}（${timer.kind === "schedule" ? `周期每 ${Math.round((timer.every_ms ?? 60_000) / 1000)}s` : "一次性"}）：${timer.label}，下次触发时间 ${timer.due_at}`,
        { timer: timer as never },
      );
    },
  });

  const cancelWakeTool = defineTool({
    name: "cancel_wake",
    description: "Cancel an armed self-wake timer by its timerId.",
    parameters: obj({
      timerId: str({ description: "Target timer ID (e.g. tmr_...)." }),
    }),
    execute: async (args) => {
      if (!alwaysOn) {
        return {
          output: [{ type: "text" as const, text: "Always-On 定时器引擎未初始化。" }],
          isError: true,
        };
      }
      const timer = await alwaysOn.cancelWake(args.timerId);
      if (!timer) {
        return textResult(`未找到定时器 ${args.timerId}`);
      }
      return textResult(`已取消定时器 ${timer.id}（${timer.label}）`, {
        timer: timer as never,
      });
    },
  });

  const listTimersTool = defineTool({
    name: "list_timers",
    description:
      "List durable self-wake timers (optional status filter: armed | done | cancelled).",
    parameters: obj({
      status: opt(
        str({ description: "Optional status filter: armed, done, or cancelled." }),
      ),
    }),
    replay: "safe",
    execute: async (args) => {
      if (!alwaysOn) {
        return textResult(JSON.stringify({ timers: [] }));
      }
      const status =
        args.status === "armed" ||
        args.status === "done" ||
        args.status === "cancelled"
          ? args.status
          : undefined;
      const timers = await alwaysOn.listTimers(status);
      return textResult(JSON.stringify({ timers }, null, 2), {
        timers: timers as never,
      });
    },
  });

  const notifyTool = defineTool({
    name: "notify",
    description:
      "Send an explicit proactive notification to Valet Outbox (quiet-by-default). Use during background event/timer/heartbeat runs ONLY when there is an actionable finding, anomaly, or milestone the user needs to know about.",
    parameters: obj({
      title: opt(str({ description: "Concise notification title." })),
      body: str({ description: "Clear notification body in Chinese." }),
      level: opt(
        str({ description: "Notification urgency: info | warn | urgent." }),
      ),
      dedupeKey: opt(
        str({
          description:
            "Optional idempotency key to avoid duplicate notifications.",
        }),
      ),
    }),
    execute: async (args, api) => {
      if (!alwaysOn) {
        return {
          output: [{ type: "text" as const, text: "Always-On Outbox 未初始化。" }],
          isError: true,
        };
      }
      const level =
        args.level === "warn" || args.level === "urgent" ? args.level : "info";
      const msg = await alwaysOn.notify({
        title: args.title,
        body: args.body,
        level,
        dedupeKey: args.dedupeKey,
        callId: api.callId,
      });
      return textResult(`已写入 Outbox 通知 ${msg.id}：${msg.title}`, {
        outboxMessage: msg as never,
      });
    },
  });

  const notebookReadTool = defineTool({
    name: "notebook_read",
    description:
      "Read the live Project Notebook belonging to the current chat session, returning ordered blocks with blockId, type, indentation, todo status, and Markdown preview. Always inspect first before updating or deleting specific blocks.",
    parameters: obj({}),
    replay: "safe",
    execute: async (_args, api) => {
      const chatId = permissionCoordinator?.getChatId(api.conversationId);
      if (!chatId) {
        return {
          output: [
            {
              type: "text" as const,
              text: "无法定位当前会话关联的项目，notebook_read 仅可在项目会话中使用。",
            },
          ],
          isError: true,
        };
      }
      const res = await bridge.callHost<{
        ok: boolean;
        projectId: string;
        projectTitle: string;
        originBlockId?: string;
        blockCount: number;
        formatted: string;
      }>("host.notebook.read", { chatId });
      return textResult(res.formatted, {
        notebook: {
          projectId: res.projectId,
          projectTitle: res.projectTitle,
          blockCount: res.blockCount,
          originBlockId: res.originBlockId,
        } as never,
      });
    },
  });

  const notebookEditTool = defineTool({
    name: "notebook_edit",
    description:
      "Edit the Project Notebook belonging to the current chat session. Actions: \"append\" (append parsed Markdown blocks), \"insert_after\" / \"insert_before\" (insert Markdown relative to targetBlockId or 1-based lineNumber), \"update_block\" (patch content/type/checked/indent/language on one block), \"replace_blocks\" (replace [targetBlockId..endBlockId] with Markdown), \"delete_blocks\" (remove blockIds or target range), \"replace_all\" (rewrite full Notebook from Markdown while keeping session cards by default).",
    parameters: obj({
      action: str({
        description:
          "Edit operation: append | insert_after | insert_before | update_block | replace_blocks | delete_blocks | replace_all.",
      }),
      markdown: opt(
        str({
          description:
            "Markdown content for append, insert_after, insert_before, replace_blocks, or replace_all (supports headings, nested lists, todos, code fences, quotes, callouts, dividers).",
        }),
      ),
      targetBlockId: opt(
        str({
          description:
            "Target block ID from notebook_read (used by insert_after, insert_before, update_block, replace_blocks, delete_blocks).",
        }),
      ),
      endBlockId: opt(
        str({
          description:
            "Optional inclusive end block ID for replace_blocks or range delete_blocks.",
        }),
      ),
      lineNumber: opt(
        num({
          description:
            "Optional 1-based block index fallback from notebook_read when targetBlockId is not provided.",
        }),
      ),
      blockIds: opt(
        arr(str(), {
          description: "List of block IDs to delete when action=\"delete_blocks\".",
        }),
      ),
      content: opt(
        str({
          description: "New raw text content for action=\"update_block\".",
        }),
      ),
      type: opt(
        str({
          description:
            "New block type for action=\"update_block\": paragraph | h1 | h2 | h3 | bullet | numbered | todo | callout | quote | code | divider.",
        }),
      ),
      checked: opt(
        bool({
          description: "Checked state for todo blocks when action=\"update_block\".",
        }),
      ),
      indent: opt(
        num({
          description: "Indentation depth (0..6) for action=\"update_block\".",
        }),
      ),
      language: opt(
        str({
          description: "Code language tag for code blocks when action=\"update_block\".",
        }),
      ),
      preserveSessionRefs: opt(
        bool({
          description:
            "For action=\"replace_all\", preserve existing session_ref cards (defaults to true).",
        }),
      ),
    }),
    execute: async (args, api) => {
      const chatId = permissionCoordinator?.getChatId(api.conversationId);
      if (!chatId) {
        return {
          output: [
            {
              type: "text" as const,
              text: "无法定位当前会话关联的项目，notebook_edit 仅可在项目会话中使用。",
            },
          ],
          isError: true,
        };
      }
      if (permissionCoordinator?.isTainted(api.conversationId)) {
        return {
          output: [
            {
              type: "text" as const,
              text: "安全边界拒绝：包含外部不可信输入的后台回合禁止自动修改项目 Notebook。",
            },
          ],
          isError: true,
        };
      }
      const payload: Record<string, unknown> = {
        chatId,
        action: args.action,
      };
      if (args.markdown !== undefined) payload.markdown = args.markdown;
      if (args.targetBlockId !== undefined) payload.targetBlockId = args.targetBlockId;
      if (args.endBlockId !== undefined) payload.endBlockId = args.endBlockId;
      if (args.lineNumber !== undefined) payload.lineNumber = args.lineNumber;
      if (args.blockIds !== undefined) payload.blockIds = args.blockIds;
      if (args.content !== undefined) payload.content = args.content;
      if (args.type !== undefined) payload.type = args.type;
      if (args.checked !== undefined) payload.checked = args.checked;
      if (args.indent !== undefined) payload.indent = args.indent;
      if (args.language !== undefined) payload.language = args.language;
      if (args.preserveSessionRefs !== undefined) {
        payload.preserveSessionRefs = args.preserveSessionRefs;
      }

      const res = await bridge.callHost<{
        ok: boolean;
        projectId: string;
        projectTitle: string;
        action: string;
        summary: string;
        blockCount: number;
        affectedIds: string[];
        formatted: string;
      }>("host.notebook.edit", payload);

      return textResult(`${res.summary}\n\n${res.formatted}`, {
        notebookEdit: {
          projectId: res.projectId,
          projectTitle: res.projectTitle,
          action: res.action,
          blockCount: res.blockCount,
          affectedIds: res.affectedIds,
        } as never,
      });
    },
  });

  return defineExtension({
    name: "valet:core",
    sections: [
      section("valet_persona", () => {
        const s = getState();
        const toneDesc: Record<string, string> = {
          formal: "专业稳重、措辞规范",
          concise: "简洁直接、先给结论再给细节",
          friendly: "温和自然、贴心管家风格",
        };
        return [
          `你是 Valet，运行在用户 (${s.preferences.userNickname || "用户"}) macOS 电脑上、感知事件并做出响应的常驻智能管家（而非单一磁盘清理工具）。`,
          `语言：${s.preferences.language}；语气风格：${toneDesc[s.preferences.toneStyle] ?? "简洁直接"}。`,
          s.preferences.customInstructions
            ? `用户自定义指令：\n${s.preferences.customInstructions}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      }),
      section("valet_safety_rules", () => {
        const s = getState();
        const levelLabel =
          s.preferences.autonomyLevel === "always_ask"
            ? "always_ask（每个都询问）"
            : s.preferences.autonomyLevel === "full_access" ||
                s.preferences.autonomyLevel === "autonomous"
              ? "full_access（Full Access）"
              : "auto_review（Auto Review 智能审查）";
        return [
          `当前安全自主级别：${levelLabel}`,
          `受保护路径（严禁改动）：${s.preferences.cleanupPolicy.protectedDirs.join(", ")}`,
          `严禁触碰的应用：${s.preferences.blockedApps.join(", ")}`,
          "通用核心工具（所有插件共享这套原语）：",
          "- 只读探测工具：`system_overview`、`read_file`、`notebook_read`、`ask_user`、`memory_remember`、`plugin_draft_create`、`bash`（纯只读命令与插件 `scripts/poll-*`/`import-*`/`read-*`/`inspect-*`/`scan-*`/`sample-*` 脚本直接放行）。",
          "- 工具使用优先顺序：查看文件内容请优先用 `read_file`；查看或修改当前项目 Notebook 笔记/待办时优先使用 `notebook_read`（获取最新内容与 blockId）和 `notebook_edit`（追加、插入、勾选待办、替换或删除内容块）；查看目录结构、系统探测或执行变更命令时使用 `bash`。",
          "- 变更执行工具：`trash_files`（移入废纸篓，7 天可还原）、`write_file`、`kill_process`、`bash`（修改系统/配置命令）、`item_resolve`（仅限前台对话中按用户明确指示批准、忽略、部分勾选执行或还原被引用的收件箱/时间线事项）。",
          "双模安全审批机制：在 `auto_review` 模式下，非纯只读调用会先由 Auto Review 模型评估风险，低风险自动放行，高风险或未配置时升级为人工确认（前台对话实时弹窗、后台任务推送收件箱）；在 `always_ask` 下每次变更都会确认；在 `full_access` 下除受保护目录/应用与安全护栏外的操作均自动放行。严禁访问 `~/.ssh`、`~/.gnupg`、`~/.aws`、Keychain 或使用 `sudo`。",
        ].join("\n");
      }),
      section("valet_memories", () => {
        const s = getState();
        if (!s.preferences.memoryEnabled) {
          return undefined;
        }
        const lines: string[] = [];
        if (s.preferences.autoLearnMemory) {
          lines.push(
            "记忆策略：当前已开启「对话中自动记住偏好」。每当用户明确表达长期偏好、工作习惯、重点关注目录/服务或禁忌规则时，请主动调用 memory_remember 持久化记录。",
          );
        }
        if (s.memories.length > 0) {
          lines.push(
            "已知用户偏好与事实记忆：",
            ...s.memories.map((m) => `- ${m.content} (${m.source})`),
          );
        }
        return lines.length > 0 ? lines.join("\n") : undefined;
      }),
      section("valet_builtin_skills", () => {
        const s = getState();
        const skills = resolveBuiltinSkills(s);
        if (skills.length === 0) {
          return undefined;
        }
        const items = skills.map(
          (sk) => `- ${sk.name} (${sk.title}): ${sk.description}`,
        );
        return [
          "Valet 内置引导技能（调用工具前按需使用 `skill_load` 读取完整手册）：",
          ...items,
          "- 在编写、修改、校验或热加载 Valet 插件前，务必先调用 `skill_load({ name: \"valet-plugin-dev\" })`，再通过 `plugin_install` / `plugin_reload` / `plugin_trigger` 完成闭环。",
          "- 在查看或修改 Valet 自身设置（模型、服务商、心跳、阈值、自动化、MCP、记忆等）前，务必先调用 `skill_load({ name: \"valet-self-config\" })`，再通过 `bash` 执行 `valet` CLI 命令。",
        ].join("\n");
      }),
      section("valet_active_plugins", () => {
        const s = getState();
        const active = s.plugins
          .filter((p) => p.installed && p.enabled)
          .map((p) => `${p.name}(${p.id}): ${p.tagline}`);
        return active.length > 0
          ? `当前已启用插件：\n${active.join("\n")}`
          : "当前没有启用的插件。";
      }),
      section("valet_plugin_architecture", () => {
        const s = getState();
        const webhook = s.preferences.pluginRuntime.webhookEndpoint;
        return [
          "Valet 采用「通用核心工具 + 可插拔事件插件（Sensor + SKILL.md + 脚本）」架构，宿主不绑定任何插件专用硬编码：",
          "- 插件目录包格式：`<dataDir>/plugins/<slug>/` 下包含 `manifest.yaml`（事件/传感器声明与 `config_schema`）、`SKILL.md`（处置方法论与执行流程）及可选 `scripts/*`。",
          `- 5 类通用传感器（Sensors）：\`fs_watch\`（文件系统变更）、\`command_poll\`（Shell 探针输出对比）、\`script_poll\`（Bun/Python/Shell 脚本输出 JSON \`{triggered, payload}\`）、\`http_poll\`（HTTP 端点轮询）、\`webhook\`（本地网关${webhook ? ` ${webhook}/{pluginId}/{eventCode}` : ""}）、\`cron\`（定时调度）。`,
          "- 核心工具与审批：插件不再静态声明 `actions` 或宿主 `driver`，Agent 阅读插件注入的 `<plugin_skill>` 后自主选用通用工具诊断，危险操作由统一安全门控拦截并请求用户批准。",
          "- 外部 MCP 扩展（valet:mcp:*）：通过 stdio / HTTP 接入的外部工具服务器。",
        ].join("\n");
      }),
      section("valet_resident_state", async () => {
        if (!alwaysOn) return undefined;
        const resident = await alwaysOn.getResidentState();
        if (!resident) return undefined;
        const lines: string[] = [
          "## Always-On 常驻运行状态（Resident State）",
          `- 事件队列：待处理 ${resident.inboxQueued} 条，死信 ${resident.inboxDead} 条（合批防抖窗口 ${resident.debounceMs}ms）；Outbox 未读通知 ${resident.outboxUnread} 条。`,
          "- 后台静默原则（Quiet-by-Default）：处理 `<inbox_batch>`、`<plugin_event>`、`<webhook_event>`、`<timer_event>`、`<heartbeat_event>` 时默认保持静默，仅当确实需要用户关注、决策或交付结果时调用 `notify`（或提交审批卡）。",
          "- 自我唤醒定时：如需延后复查状态或建立周期巡检，请调用 `wake_me_at` / `cancel_wake` / `list_timers`，不要无意义空转。",
        ];
        if (resident.armedTimers.length > 0) {
          lines.push("### 已武装定时器（timers）");
          for (const tm of resident.armedTimers) {
            const interval =
              tm.everyMs !== null ? `, 每 ${Math.round(tm.everyMs / 1000)}s` : "";
            lines.push(
              `- ${tm.id} [${tm.kind}${interval}] ${tm.label} @ ${tm.dueAt}`,
            );
          }
        }
        return lines.join("\n");
      }),
    ],
    tools: [
      systemOverviewTool,
      readFileTool,
      writeFileTool,
      trashFilesTool,
      killProcessTool,
      bashTool,
      askUserTool,
      memoryRememberTool,
      pluginDraftCreateTool,
      inboxProposeApprovalTool,
      itemResolveTool,
      wakeMeAtTool,
      cancelWakeTool,
      listTimersTool,
      notifyTool,
      notebookReadTool,
      notebookEditTool,
    ],
  });
}
