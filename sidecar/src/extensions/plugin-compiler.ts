import {
  type Extension,
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { arr, bool, num, obj, opt, str } from "@earendil-works/pi-schema";
import { parse as parseYaml } from "yaml";
import type { ToolPolicyRegistry } from "../approval.ts";
import type {
  ActionSafety,
  HostBridge,
  InboxCategory,
  PluginState,
  ProcessSampleRow,
  SafetyConfirmationChecklist,
} from "../protocol.ts";

interface ManifestTriggerRaw {
  id?: string;
  event?: string;
  description?: string;
  sensor?: string;
  glob?: string;
  policy?: string;
}

interface ManifestActionRaw {
  id?: string;
  tool?: string;
  driver?: string;
  event?: string;
  safety?: ActionSafety;
  category?: InboxCategory;
  checklist?: keyof SafetyConfirmationChecklist;
  ui_card?: string;
  target?: string;
  description?: string;
  [key: string]: unknown;
}

interface ParsedPluginYaml {
  id?: string;
  name?: string;
  version?: string;
  permissions?: string[];
  triggers?: ManifestTriggerRaw[];
  events?: Array<string | ManifestTriggerRaw>;
  condition?: string[];
  actions?: Array<string | ManifestActionRaw>;
}

interface NormalizedAction {
  id: string;
  toolName: string;
  driver: string;
  eventCode?: string;
  safety: ActionSafety;
  category: InboxCategory;
  checklistKey?: keyof SafetyConfirmationChecklist;
  uiCard?: string;
  target?: string;
  description?: string;
}

function sanitizeIdentifier(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

function defaultToolName(plugin: PluginState, actionId: string): string {
  const builtinMap: Record<string, string> = {
    "disk.scan": "disk_scan",
    "disk.move_to_trash": "disk_move_to_trash",
    "disk.empty_trash": "disk_empty_trash",
    "app.scan_remnants": "app_scan_remnants",
    "app.trash_remnants": "app_trash_remnants",
    "app.unload_agent": "app_unload_agent",
    "process.sample": "process_sample",
    "process.terminate": "process_terminate",
    "log.summarize": "log_summarize_crashes",
    "github.fetch_logs": "github_fetch_failed_runs",
    "github.rerun_job": "github_rerun_job",
    "github.comment": "github_post_comment",
    "calendar.list": "calendar_list_upcoming",
    "system.set_focus": "calendar_set_focus_mode",
    "calendar.reply": "calendar_send_conflict_reply",
    "battery.report": "battery_status",
    "net.flush_dns": "wifi_status",
  };
  if (builtinMap[actionId]) return builtinMap[actionId]!;
  return `plugin_${sanitizeIdentifier(plugin.slug || plugin.id)}_${sanitizeIdentifier(actionId)}`;
}

function inferDriver(actionId: string): string {
  switch (actionId) {
    case "disk.scan":
    case "scan":
      return "fs.scan_cleanable";
    case "disk.move_to_trash":
    case "app.trash_remnants":
    case "move_to_trash":
      return "fs.trash";
    case "move_to":
    case "fs.move":
      return "fs.move";
    case "disk.empty_trash":
      return "fs.empty_trash";
    case "app.scan_remnants":
      return "fs.scan_orphans";
    case "app.unload_agent":
      return "launchd.unload";
    case "process.sample":
      return "proc.sample";
    case "process.terminate":
      return "proc.signal";
    case "log.summarize":
      return "log.summarize_crashes";
    case "battery.report":
      return "macos.battery_status";
    case "net.flush_dns":
      return "macos.network_status";
    case "system.set_focus":
      return "macos.focus_mode";
    case "calendar.list":
      return "macos.calendar_upcoming";
    case "github.fetch_logs":
      return "net.http_json";
    default:
      if (actionId.includes("trash")) return "fs.trash";
      if (actionId.includes("move")) return "fs.move";
      return "plugin.noop";
  }
}

function buildParametersForTool(toolName: string, driver: string) {
  switch (toolName) {
    case "disk_scan":
      return obj({
        scope: opt(str({ description: "caches | large_files | all" })),
        minSizeMB: opt(num()),
        idleDays: opt(num()),
      });
    case "disk_move_to_trash":
    case "app_trash_remnants":
      return obj({
        paths: arr(str(), { description: "Paths to move cleanly to Trash." }),
        estimatedGB: opt(num()),
        reason: opt(str()),
      });
    case "disk_empty_trash":
      return obj({ reason: opt(str()) });
    case "app_scan_remnants":
      return obj({ bundleId: opt(str()) });
    case "app_unload_agent":
      return obj({ label: str(), path: opt(str()) });
    case "process_sample":
      return obj({ limit: opt(num()) });
    case "process_terminate":
      return obj({
        pid: num({ description: "Process ID (> 1)." }),
        name: str({ description: "Process name." }),
        signal: opt(str({ description: "SIGTERM or SIGKILL." })),
        reason: opt(str()),
      });
    case "log_summarize_crashes":
      return obj({ minutes: opt(num()) });
    case "github_post_comment":
      return obj({ repo: str(), issueNumber: opt(num()), body: str() });
    case "calendar_send_conflict_reply":
      return obj({ meeting: str(), recipient: str(), draft: str() });
    default:
      if (driver === "net.http_json") {
        return obj({ url: opt(str()), repo: opt(str()), note: opt(str()) });
      }
      if (driver === "macos.focus_mode") {
        return obj({ enabled: opt(num()), reason: opt(str()) });
      }
      if (driver === "macos.calendar_upcoming") {
        return obj({ hoursAhead: opt(num()) });
      }
      return obj({
        path: opt(str({ description: "Target file or directory path." })),
        paths: opt(arr(str(), { description: "Optional list of target paths." })),
        target: opt(str({ description: "Optional destination path for move operations." })),
        estimatedGB: opt(num()),
        reason: opt(str()),
        note: opt(str()),
      });
  }
}

function parseActions(plugin: PluginState, parsed: ParsedPluginYaml): NormalizedAction[] {
  const byId = new Map<string, NormalizedAction>();

  for (const act of parsed.actions ?? []) {
    if (typeof act === "string") {
      const driver = inferDriver(act);
      const toolName = defaultToolName(plugin, act);
      byId.set(act, {
        id: act,
        toolName,
        driver,
        safety: driver.includes("scan") || driver.includes("sample") || driver.includes("summarize") ? "readonly" : "reversible",
        category: driver.startsWith("proc.") || driver.startsWith("log.") ? "process" : "files",
      });
      continue;
    }

    if (act && typeof act === "object") {
      let id = typeof act.id === "string" ? act.id : "";
      let target = typeof act.target === "string" ? act.target : undefined;
      if (!id) {
        const firstKey = Object.keys(act)[0];
        if (!firstKey) continue;
        id = firstKey;
        const inner = act[firstKey];
        if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>).target === "string") {
          target = (inner as Record<string, unknown>).target as string;
        }
      }
      const driver = typeof act.driver === "string" && act.driver ? act.driver : inferDriver(id);
      const toolName = typeof act.tool === "string" && act.tool ? act.tool : defaultToolName(plugin, id);
      const safety: ActionSafety =
        act.safety === "readonly" || act.safety === "reversible" || act.safety === "confirm_always"
          ? act.safety
          : plugin.actions.find((a) => a.id === id)?.safety ?? "reversible";
      const category: InboxCategory =
        act.category === "files" || act.category === "process" || act.category === "outbound"
          ? act.category
          : driver.startsWith("proc.") || driver.startsWith("log.")
            ? "process"
            : driver.startsWith("macos.focus") || driver.startsWith("macos.calendar") || id.includes("comment") || id.includes("reply")
              ? "outbound"
              : "files";

      byId.set(id, {
        id,
        toolName,
        driver,
        eventCode: typeof act.event === "string" && act.event ? act.event : undefined,
        safety,
        category,
        checklistKey: act.checklist,
        uiCard: typeof act.ui_card === "string" ? act.ui_card : undefined,
        target,
        description: typeof act.description === "string" ? act.description : undefined,
      });
    }
  }

  for (const fallbackAct of plugin.actions) {
    if (!byId.has(fallbackAct.id)) {
      const driver = inferDriver(fallbackAct.id);
      byId.set(fallbackAct.id, {
        id: fallbackAct.id,
        toolName: defaultToolName(plugin, fallbackAct.id),
        driver,
        safety: fallbackAct.safety,
        category: driver.startsWith("proc.") || driver.startsWith("log.") ? "process" : "files",
      });
    }
  }

  if (byId.size === 0) {
    const id = "run_action";
    byId.set(id, {
      id,
      toolName: defaultToolName(plugin, id),
      driver: "plugin.noop",
      safety: "reversible",
      category: "files",
    });
  }

  return [...byId.values()];
}

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
 * Compiles ANY Valet plugin (core disk/process/uninstall/log, community, or local YAML rule)
 * into a unified Pi Durable Extension wired to Go's `host.plugin.invoke` driver bus.
 */
export function compilePluginExtension(options: {
  plugin: PluginState;
  bridge: HostBridge;
  policyRegistry: ToolPolicyRegistry;
}): Extension {
  const { plugin, bridge, policyRegistry } = options;

  let parsed: ParsedPluginYaml = {};
  try {
    const doc = parseYaml(plugin.manifestYaml);
    if (doc && typeof doc === "object") {
      parsed = doc as ParsedPluginYaml;
    }
  } catch {
    parsed = {};
  }

  const eventIds = new Set<string>(plugin.events.map((e) => e.id));
  for (const t of parsed.triggers ?? []) {
    const eid = t.id || t.event;
    if (eid) eventIds.add(eid);
  }
  for (const ev of parsed.events ?? []) {
    if (typeof ev === "string") eventIds.add(ev);
    else if (ev?.id || ev?.event) eventIds.add((ev.id || ev.event)!);
  }
  const primaryEvent = [...eventIds][0] ?? "custom.event_triggered";

  const normalizedActions = parseActions(plugin, parsed);
  policyRegistry.unregisterByPlugin(plugin.id);

  const iconKindForCategory = (cat: InboxCategory, driver: string): "trash" | "disk" | "pulse" | "mail" => {
    if (driver === "fs.trash") return plugin.id === "uninstall-scrubber" ? "trash" : "disk";
    if (cat === "process") return "pulse";
    if (cat === "outbound") return "mail";
    return "disk";
  };

  const tools = normalizedActions.map((act) => {
    const isUnsafeIrreversible = act.safety === "confirm_always";
    const approveLabel =
      act.toolName === "disk_move_to_trash"
        ? "移入废纸篓"
        : act.toolName === "app_trash_remnants"
          ? "批准清理"
          : act.toolName === "process_terminate"
            ? "结束进程"
            : isUnsafeIrreversible
              ? "批准执行"
              : "移入废纸篓";

    policyRegistry.register({
      toolName: act.toolName,
      pluginId: plugin.id,
      pluginName: plugin.name,
      actionId: act.id,
      eventCode: act.eventCode || primaryEvent,
      safety: act.safety,
      category: act.category,
      iconKind: iconKindForCategory(act.category, act.driver),
      warningTag: isUnsafeIrreversible
        ? act.category === "outbound"
          ? "外发消息"
          : "不可撤销"
        : undefined,
      reversible7d: act.safety === "reversible",
      approveLabel,
      dismissLabel: "忽略",
      checklistKey:
        act.checklistKey ??
        (act.safety === "readonly"
          ? undefined
          : act.category === "outbound"
            ? "sendMessageOrEmail"
            : act.driver === "proc.signal"
              ? "runTerminalCommand"
              : "deleteOrOverwrite"),
    });

    return defineTool({
      name: act.toolName,
      description:
        act.description ||
        `Plugin "${plugin.name}" (${plugin.id}) capability "${act.id}" via driver ${act.driver}.`,
      parameters: buildParametersForTool(act.toolName, act.driver) as ReturnType<typeof obj>,
      ...(act.safety === "readonly" ? { replay: "safe" as const } : {}),
      execute: async (args, api, context) => {
        const res = await bridge.callHost<{
          ok: boolean;
          summary: string;
          driver: string;
          trashBatchId?: string;
          movedCount?: number;
          reclaimedGB?: number;
          rows?: ProcessSampleRow[];
          data?: Record<string, unknown>;
        }>("host.plugin.invoke", {
          pluginId: plugin.id,
          actionId: act.id,
          driver: act.driver,
          eventCode: primaryEvent,
          args: {
            ...(act.target && !("target" in args) ? { target: act.target } : {}),
            ...(args as Record<string, unknown>),
          },
        });

        const details: Record<string, unknown> = {};
        if (act.uiCard === "process_table" || (Array.isArray(res.rows) && res.rows.length > 0)) {
          const table = {
            rows: res.rows ?? [],
            primaryActionDone: false,
            secondaryActionDone: false,
            autoRuleAdded: false,
          };
          details.processTable = table;
          await api.details({ processTable: table as never }, context);
        }

        if (act.safety !== "readonly") {
          details.timelineTitle = `${plugin.name} · ${res.summary || act.id}`;
          details.timelineSummary = res.summary || `已执行 ${act.id}。`;
          details.canRestore = act.safety === "reversible" && Boolean(res.trashBatchId);
          if (typeof res.reclaimedGB === "number") {
            details.reclaimedGB = res.reclaimedGB;
          }
        }

        const payload = res.data ?? res;
        return jsonTextResult(
          res.summary || `插件「${plugin.name}」执行 ${act.id} 完成`,
          payload,
          Object.keys(details).length > 0 ? details : undefined,
        );
      },
    });
  });

  const policySummary = plugin.events
    .map((e) => `${e.id}(${e.policy})`)
    .join(", ");
  const toolList = normalizedActions.map((a) => a.toolName).join(", ");
  const conditionNote =
    parsed.condition && parsed.condition.length > 0
      ? `；条件：${parsed.condition.join(", ")}`
      : "";

  return defineExtension({
    name: `plugin:${plugin.id}`,
    sections: [
      section(`plugin_${sanitizeIdentifier(plugin.id)}`, () => {
        return `已挂载插件「${plugin.name}」(${plugin.id} ${plugin.version})：${plugin.description}。事件策略：[${policySummary}]；可用工具：[${toolList}]${conditionNote}`;
      }),
    ],
    tools,
  });
}

// Keep unused bool import clean if needed
void bool;
