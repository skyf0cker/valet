import { defineExtension, section, type Extension } from "@earendil-works/pi-durable";
import { parse as parseYaml } from "yaml";
import type { ToolPolicyRegistry } from "../approval.ts";
import type { HostBridge, PluginState } from "../protocol.ts";

interface ParsedTriggerYaml {
  id?: string;
  event?: string;
  description?: string;
  sensor?: string;
  policy?: string;
}

interface ParsedPluginYaml {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  triggers?: ParsedTriggerYaml[];
  condition?: string[];
  skill?: string;
  instructions?: string;
}

function sanitizeIdentifier(raw: string): string {
  const norm = raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "");
  return norm || "plugin";
}

/**
 * Compiles ANY Valet plugin (core, community, or local bundle) into a Pi Durable Extension.
 * Plugins declare Sensors (triggers), ConfigSchema, and SKILL.md (+ optional helper scripts),
 * while Valet's universal core tools handle diagnosis and gated execution uniformly.
 */
export function compilePluginExtension(options: {
  plugin: PluginState;
  dataDir?: string;
  bridge?: HostBridge;
  policyRegistry: ToolPolicyRegistry;
}): Extension {
  const { plugin, dataDir, policyRegistry } = options;

  let parsed: ParsedPluginYaml = {};
  try {
    const doc = parseYaml(plugin.manifestYaml);
    if (doc && typeof doc === "object") {
      parsed = doc as ParsedPluginYaml;
    }
  } catch {
    parsed = {};
  }

  // Ensure no legacy plugin-scoped tool policies linger across hot reloads.
  policyRegistry.unregisterByPlugin(plugin.id);

  const policySummary = plugin.events
    .map((e) => `${e.id}(${e.policy}${e.sensor ? `, ${e.sensor}` : ""})`)
    .join(", ");
  const conditionNote =
    parsed.condition && parsed.condition.length > 0
      ? `条件：${parsed.condition.join(", ")}`
      : "";
  const skillText = (
    plugin.skillMarkdown ||
    parsed.skill ||
    parsed.instructions ||
    ""
  ).trim();

  const slug = plugin.slug || plugin.id;
  const pluginDir =
    plugin.localDir ||
    (dataDir ? `${dataDir.replace(/\/$/, "")}/plugins/${slug}` : "");
  const stateDir = dataDir
    ? `${dataDir.replace(/\/$/, "")}/plugin-state/${plugin.id}`
    : "";
  const cfgValues = { ...(plugin.config?.values ?? {}) };
  if (
    plugin.config?.lowSpaceThresholdPct !== undefined &&
    cfgValues.lowSpaceThresholdPct === undefined
  ) {
    cfgValues.lowSpaceThresholdPct = plugin.config.lowSpaceThresholdPct;
  }
  if (
    plugin.config?.sampleIntervalSec !== undefined &&
    cfgValues.sampleIntervalSec === undefined
  ) {
    cfgValues.sampleIntervalSec = plugin.config.sampleIntervalSec;
  }
  if (
    Array.isArray(plugin.config?.protectedPaths) &&
    plugin.config.protectedPaths.length > 0 &&
    cfgValues.protectedPaths === undefined
  ) {
    cfgValues.protectedPaths = plugin.config.protectedPaths;
  }

  return defineExtension({
    name: `plugin:${plugin.id}`,
    sections: [
      section(`plugin_${sanitizeIdentifier(plugin.id)}`, () => {
        const lines = [
          `已挂载插件「${plugin.name}」(${plugin.id} ${plugin.version})：${plugin.description}`,
          policySummary ? `事件策略与传感器：[${policySummary}]` : "",
          conditionNote,
          pluginDir ? `插件目录 (VALET_PLUGIN_DIR): ${pluginDir}` : "",
          stateDir ? `插件状态目录 (VALET_PLUGIN_STATE_DIR): ${stateDir}` : "",
          Object.keys(cfgValues).length > 0
            ? `插件配置 (VALET_PLUGIN_CONFIG_JSON): ${JSON.stringify(cfgValues)}`
            : "",
          plugin.bundledFiles && plugin.bundledFiles.length > 0
            ? `插件包内文件：${plugin.bundledFiles.join(", ")}`
            : "",
        ].filter(Boolean);

        if (!skillText) {
          return lines.join("\n");
        }
        return `${lines.join("\n")}\n<plugin_skill plugin="${plugin.id}">\n${skillText}\n</plugin_skill>`;
      }),
    ],
    tools: [],
  });
}
