import {
  type Extension,
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { arr, bool, num, obj, opt, str } from "@earendil-works/pi-schema";
import type { ToolPolicyRegistry, TurnSideEffectTracker } from "../approval.ts";
import type {
  HostBridge,
  PluginDraftSpec,
  QueueApprovalParams,
  ValetSyncState,
} from "../protocol.ts";

function textResult(text: string, details?: Record<string, unknown>) {
  return {
    output: [{ type: "text" as const, text }],
    ...(details ? { details: details as never } : {}),
  };
}

/**
 * Core Valet Steward extension (`valet:core`):
 * Injects persona, safety policy, memories, and active plugins prompt sections,
 * plus system overview, memory persistence, and YAML plugin drafting tools.
 */
export function createStewardCoreExtension(options: {
  bridge: HostBridge;
  getState: () => ValetSyncState;
  policyRegistry: ToolPolicyRegistry;
  tracker?: TurnSideEffectTracker;
}): Extension {
  const { bridge, getState, policyRegistry, tracker } = options;

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
      reversible7d: true,
      approveLabel: "确定",
      dismissLabel: "关闭",
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
      reversible7d: true,
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
      reversible7d: true,
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
  ]);

  const systemOverviewTool = defineTool({
    name: "system_overview",
    description:
      "Read live macOS disk capacity, free space, CPU/memory metrics, enabled plugins, and top processes.",
    parameters: obj({}),
    replay: "safe",
    execute: async () => {
      const overview = await bridge.callHost<Record<string, unknown>>(
        "host.kernel.overview",
        {},
      );
      return textResult(JSON.stringify(overview, null, 2), { overview: overview as never });
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
      "Draft an executable Valet YAML plugin manifest for an automation request (e.g. auto-cleaning .dmg installers or organizing screenshots).",
    parameters: obj({
      name: str({ description: "Display name of the plugin in Chinese or English." }),
      slug: opt(str({ description: "Kebab-case identifier suffix." })),
      eventCode: str({ description: "Trigger event code such as fs.file_created." }),
      glob: opt(str({ description: "Path glob pattern if watching filesystem events." })),
      actionId: str({ description: "Action ID such as move_to_trash or move_to." }),
      targetPath: opt(str({ description: "Optional destination directory for move actions." })),
      condition: opt(str({ description: "Optional guard condition such as app_installed_from(dmg)." })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const id =
        args.slug?.trim() ||
        `local-${Date.now().toString(36).slice(-4)}`;
      const whenExpression = args.glob
        ? `when ${args.eventCode}(${args.glob})`
        : `when ${args.eventCode}`;
      const condSuffix = args.condition ? ` and ${args.condition}` : "";
      const actionTarget = args.targetPath ? `(${args.targetPath})` : "";
      const actionExpression = `${condSuffix ? `${condSuffix.trim()} -> ` : ""}${args.actionId}${actionTarget}`;

      const driver =
        args.actionId === "move_to_trash"
          ? "fs.trash"
          : args.actionId === "move_to"
            ? "fs.move"
            : "plugin.noop";
      const watchDir = args.glob
        ? args.glob.includes("/")
          ? args.glob.slice(0, args.glob.lastIndexOf("/"))
          : "~/Downloads"
        : "";

      const yamlLines = [
        `id: local.valet.${id}`,
        `name: ${args.name}`,
        `version: 0.1.0`,
        `triggers:`,
        `  - id: ${args.eventCode}`,
      ];
      if (args.glob) {
        yamlLines.push(`    sensor: fs_watch`);
        if (watchDir) yamlLines.push(`    watch_dirs: [${watchDir}]`);
        yamlLines.push(`    ops: [create]`);
        yamlLines.push(`    glob: "${args.glob}"`);
        yamlLines.push(`    policy: auto`);
      }
      if (args.condition) {
        yamlLines.push(`condition:`);
        yamlLines.push(`  - ${args.condition}`);
      }
      yamlLines.push(`actions:`);
      yamlLines.push(`  - id: ${args.actionId}`);
      yamlLines.push(`    driver: ${driver}`);
      yamlLines.push(`    safety: reversible`);
      if (args.targetPath) {
        yamlLines.push(`    target: "${args.targetPath}"`);
      }

      const draft: PluginDraftSpec = {
        id,
        name: args.name,
        whenExpression,
        actionExpression,
        manifestYaml: yamlLines.join("\n"),
        installed: false,
      };
      await api.details({ pluginDraft: draft as never }, context);
      return textResult(
        `已生成插件草稿「${draft.name}」(${whenExpression} -> ${actionExpression})`,
        { pluginDraft: draft as never },
      );
    },
  });

  const inboxProposeApprovalTool = defineTool({
    name: "inbox_propose_approval",
    description:
      "Queue an explicit human approval card in Valet Inbox before touching user files or sending external messages. Prefer calling action tools such as disk_move_to_trash or app_trash_remnants directly (they automatically queue Inbox cards when confirmation is required). For file actions, you MUST supply a non-empty paths array of concrete filesystem paths.",
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
              text: "提交文件清理审批失败：必须提供非空的 paths 文件路径列表，或直接调用 disk_move_to_trash / app_trash_remnants 并传入具体 paths。",
            },
          ],
          isError: true,
        };
      }

      const estimatedGB =
        typeof args.estimatedGB === "number" && Number.isFinite(args.estimatedGB)
          ? args.estimatedGB
          : undefined;
      const pluginId = args.pluginId ?? "disk-guard";
      const pluginName =
        pluginId === "app-uninstaller" ? "卸载清理助手" : "磁盘守卫";
      const toolName =
        category === "files"
          ? pluginId === "app-uninstaller"
            ? "app_trash_remnants"
            : "disk_move_to_trash"
          : "plugin_noop";

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
          pluginId === "app-uninstaller" ? "app.orphan_found" : "disk.large_file",
        category,
        iconKind: "disk",
        title: args.title,
        summary: args.summary,
        reasoning: args.summary,
        reversible7d: args.reversible7d ?? true,
        reclaimableGB: estimatedGB,
        approveLabel: "批准执行",
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
          `你是 Valet，运行在用户 (${s.preferences.userNickname || "用户"}) macOS 设备上的常驻智能管家。`,
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
        return [
          `当前安全自主级别：${s.preferences.autonomyLevel}`,
          `受保护路径（严禁改动）：${s.preferences.cleanupPolicy.protectedDirs.join(", ")}`,
          `严禁触碰的应用：${s.preferences.blockedApps.join(", ")}`,
          "规则：清理文件优先移入废纸篓并支持 7 天还原；需要删除或清理文件时，请直接调用对应工具（如 disk_move_to_trash / app_trash_remnants）并传入完整 paths，安全拦截会自动把待批事项推入「收件箱」；若使用 inbox_propose_approval，必须传入具体的 paths 路径列表。",
        ].join("\n");
      }),
      section("valet_memories", () => {
        const s = getState();
        if (!s.preferences.memoryEnabled || s.memories.length === 0) {
          return undefined;
        }
        return s.memories
          .map((m) => `- ${m.content} (${m.source})`)
          .join("\n");
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
    ],
    tools: [
      systemOverviewTool,
      memoryRememberTool,
      pluginDraftCreateTool,
      inboxProposeApprovalTool,
    ],
  });
}
