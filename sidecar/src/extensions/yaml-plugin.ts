import {
  type Extension,
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { obj, opt, str } from "@earendil-works/pi-schema";
import { parse as parseYaml } from "yaml";
import type { ToolPolicyRegistry } from "../approval.ts";
import type { HostBridge, PluginState } from "../protocol.ts";

interface ParsedYamlManifest {
  id?: string;
  name?: string;
  version?: string;
  triggers?: Array<{ event?: string; glob?: string }>;
  events?: Array<string | { id?: string }>;
  condition?: string[];
  actions?: Array<string | { id?: string } | Record<string, unknown>>;
}

function sanitizeToolIdentifier(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

function parseActionId(
  entry: string | { id?: string } | Record<string, unknown>,
): string | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry.id === "string") return entry.id;
  const firstKey = Object.keys(entry)[0];
  return firstKey || undefined;
}

/**
 * Compiles any YAML-backed community, marketplace, or local custom plugin into a real
 * Pi Durable Extension with its own system prompt section and executable action tools.
 */
export function compileYamlPluginExtension(options: {
  plugin: PluginState;
  bridge: HostBridge;
  policyRegistry: ToolPolicyRegistry;
}): Extension {
  const { plugin, bridge, policyRegistry } = options;

  let parsed: ParsedYamlManifest = {};
  try {
    const doc = parseYaml(plugin.manifestYaml);
    if (doc && typeof doc === "object") {
      parsed = doc as ParsedYamlManifest;
    }
  } catch {
    parsed = {};
  }

  const eventIds = new Set<string>(plugin.events.map((e) => e.id));
  for (const t of parsed.triggers ?? []) {
    if (t.event) eventIds.add(t.event);
  }
  for (const ev of parsed.events ?? []) {
    if (typeof ev === "string") eventIds.add(ev);
    else if (ev?.id) eventIds.add(ev.id);
  }
  const primaryEvent = [...eventIds][0] ?? "custom.event_triggered";

  const actionIds = new Map<string, "readonly" | "reversible" | "confirm_always">(
    plugin.actions.map((a) => [a.id, a.safety]),
  );
  for (const act of parsed.actions ?? []) {
    const aid = parseActionId(act);
    if (aid && !actionIds.has(aid)) {
      actionIds.set(aid, aid.includes("delete") || aid.includes("empty") ? "confirm_always" : "reversible");
    }
  }
  if (actionIds.size === 0) {
    actionIds.set("run_action", "reversible");
  }

  policyRegistry.unregisterByPlugin(plugin.id);

  const tools = [...actionIds.entries()].map(([actionId, safety]) => {
    const toolName = `plugin_${sanitizeToolIdentifier(plugin.slug || plugin.id)}_${sanitizeToolIdentifier(actionId)}`;
    policyRegistry.register({
      toolName,
      pluginId: plugin.id,
      pluginName: plugin.name,
      actionId,
      eventCode: primaryEvent,
      safety,
      category:
        actionId.includes("focus") || actionId.includes("comment")
          ? "outbound"
          : "files",
      iconKind: plugin.source === "local" ? "trash" : "disk",
      warningTag: safety === "confirm_always" ? "不可撤销" : undefined,
      reversible7d: safety !== "confirm_always",
      approveLabel: safety === "confirm_always" ? "批准执行" : "移入废纸篓",
      dismissLabel: "忽略",
      checklistKey: safety === "readonly" ? undefined : "deleteOrOverwrite",
    });

    return defineTool({
      name: toolName,
      description: `Execute plugin "${plugin.name}" (${plugin.bundleId}) action "${actionId}" for event ${primaryEvent}.`,
      parameters: obj({
        path: opt(str({ description: "Optional target file or resource path." })),
        note: opt(str({ description: "Optional context note or condition." })),
      }),
      execute: async (args) => {
        const res = await bridge.callHost<Record<string, unknown>>(
          "host.executePluginAction",
          {
            pluginId: plugin.id,
            actionId,
            eventCode: primaryEvent,
            args: {
              path: args.path ?? "",
              note: args.note ?? "",
            },
          },
        );
        return {
          output: [
            {
              type: "text" as const,
              text: `插件「${plugin.name}」执行 ${actionId} 完成：\n${JSON.stringify(res)}`,
            },
          ],
          details: {
            timelineTitle: `${plugin.name} 执行 ${actionId}`,
            timelineSummary: `已响应 ${primaryEvent} 并执行 ${actionId}。`,
            canRestore: safety === "reversible",
          } as never,
        };
      },
    });
  });

  const conditionNote =
    parsed.condition && parsed.condition.length > 0
      ? `；附加条件：${parsed.condition.join(", ")}`
      : "";

  return defineExtension({
    name: `plugin:${plugin.id}`,
    sections: [
      section(`plugin_${sanitizeToolIdentifier(plugin.id)}`, () => {
        return `插件「${plugin.name}」(${plugin.version})：${plugin.description} 触发事件：${[...eventIds].join(", ")}${conditionNote}`;
      }),
    ],
    tools,
  });
}
