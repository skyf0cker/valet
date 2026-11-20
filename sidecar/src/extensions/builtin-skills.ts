import {
  type Extension,
  defineExtension,
  defineTool,
} from "@earendil-works/pi-durable";
import { arr, bool, obj, opt, str } from "@earendil-works/pi-schema";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolPolicyRegistry } from "../approval.ts";
import type {
  BuiltinSkillMeta,
  HostBridge,
  PluginState,
  ValetSyncState,
} from "../protocol.ts";

function textResult(text: string, details?: Record<string, unknown>) {
  return {
    output: [{ type: "text" as const, text }],
    ...(details ? { details: details as never } : {}),
  };
}

function errorResult(text: string) {
  return {
    output: [{ type: "text" as const, text }],
    isError: true,
  };
}

const FALLBACK_BUILTIN_DEFS: Array<{
  name: string;
  title: string;
  description: string;
}> = [
  {
    name: "valet-plugin-dev",
    title: "Valet 插件开发与热加载指南（Action-less 自包含架构）",
    description:
      "开发、校验、加载与调试 Valet Action-less 自包含插件包（manifest.yaml + SKILL.md + scripts/*）的内置技能手册。",
  },
  {
    name: "valet-self-config",
    title: "valet CLI 自配置与控制手册",
    description:
      "使用 valet CLI 安全查看、诊断和配置 Valet 自身设置（外观、模型与服务商、心跳、阈值、自动化规则、MCP、记忆与插件）的内置技能手册。",
  },
];

function loadFallbackSkillsFromRepo(): BuiltinSkillMeta[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const skillsRoot = join(dirname(dirname(dirname(here))), "skills");
  const out: BuiltinSkillMeta[] = [];
  for (const def of FALLBACK_BUILTIN_DEFS) {
    const filePath = join(skillsRoot, def.name, "SKILL.md");
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf8").trim();
      if (content) {
        out.push({
          name: def.name,
          title: def.title,
          description: def.description,
          content,
          source: "builtin",
        });
      }
    } catch {
      // Ignore unreadable fallback path in packaged runtime
    }
  }
  return out;
}

export function resolveBuiltinSkills(state: ValetSyncState): BuiltinSkillMeta[] {
  const synced = state.builtinSkills ?? [];
  if (synced.length > 0) return synced;
  return loadFallbackSkillsFromRepo();
}

/**
 * Installs Valet's built-in skills loader (`skill_load`) and closed-loop plugin
 * authoring/hot-reload management tools (`plugin_list`, `plugin_inspect`,
 * `plugin_install`, `plugin_reload`, `plugin_configure`, `plugin_trigger`, `plugin_remove`).
 */
export function createBuiltinSkillsExtension(options: {
  bridge: HostBridge;
  getState: () => ValetSyncState;
  policyRegistry: ToolPolicyRegistry;
  onPluginsUpdated: (plugins: PluginState[]) => void;
}): Extension {
  const { bridge, getState, policyRegistry, onPluginsUpdated } = options;

  policyRegistry.registerAll([
    {
      toolName: "skill_load",
      pluginId: "valet-core",
      pluginName: "Valet Skills",
      actionId: "skill.load",
      eventCode: "skill.loaded",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "读取",
      dismissLabel: "取消",
    },
    {
      toolName: "plugin_list",
      pluginId: "valet-core",
      pluginName: "插件管理器",
      actionId: "plugin.list",
      eventCode: "plugin.listed",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "plugin_inspect",
      pluginId: "valet-core",
      pluginName: "插件管理器",
      actionId: "plugin.inspect",
      eventCode: "plugin.inspected",
      safety: "readonly",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "确定",
      dismissLabel: "取消",
    },
    {
      toolName: "plugin_install",
      pluginId: "valet-core",
      pluginName: "插件管理器",
      actionId: "plugin.install",
      eventCode: "plugin.installed",
      safety: "reversible",
      checklistKey: "modifySystemSettings",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "允许加载插件",
      dismissLabel: "取消",
    },
    {
      toolName: "plugin_reload",
      pluginId: "valet-core",
      pluginName: "插件管理器",
      actionId: "plugin.reload",
      eventCode: "plugin.reloaded",
      safety: "reversible",
      checklistKey: "modifySystemSettings",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "热重载",
      dismissLabel: "取消",
    },
    {
      toolName: "plugin_configure",
      pluginId: "valet-core",
      pluginName: "插件管理器",
      actionId: "plugin.configure",
      eventCode: "plugin.configured",
      safety: "reversible",
      checklistKey: "modifySystemSettings",
      category: "files",
      iconKind: "disk",
      reversible7d: true,
      approveLabel: "更新配置",
      dismissLabel: "取消",
    },
    {
      toolName: "plugin_trigger",
      pluginId: "valet-core",
      pluginName: "插件管理器",
      actionId: "plugin.trigger",
      eventCode: "plugin.triggered",
      safety: "readonly",
      category: "process",
      iconKind: "pulse",
      reversible7d: true,
      approveLabel: "触发测试",
      dismissLabel: "取消",
    },
    {
      toolName: "plugin_remove",
      pluginId: "valet-core",
      pluginName: "插件管理器",
      actionId: "plugin.remove",
      eventCode: "plugin.removed",
      safety: "reversible",
      checklistKey: "deleteOrOverwrite",
      category: "files",
      iconKind: "trash",
      reversible7d: false,
      approveLabel: "移除插件",
      dismissLabel: "取消",
    },
  ]);

  const skillLoadTool = defineTool({
    name: "skill_load",
    description:
      "Load the full SKILL.md instruction manual for a Valet built-in skill ('valet-plugin-dev' or 'valet-self-config') or an installed plugin before authoring plugins or self-configuring Valet.",
    parameters: obj({
      name: str({
        description:
          "Skill or plugin identifier, e.g. 'valet-plugin-dev', 'valet-self-config', 'disk-guard', etc.",
      }),
    }),
    replay: "safe",
    execute: async (args) => {
      const target = args.name.trim();
      if (!target) {
        return errorResult("skill_load 缺少 name 参数。");
      }
      const lower = target.toLowerCase();
      const state = getState();

      const builtins = resolveBuiltinSkills(state);
      const matchedBuiltin = builtins.find(
        (sk) => sk.name.toLowerCase() === lower,
      );
      if (matchedBuiltin) {
        return textResult(
          `# Skill: ${matchedBuiltin.name}\n\n${matchedBuiltin.content}`,
          { skill: matchedBuiltin as never },
        );
      }

      const matchedPlugin = state.plugins.find(
        (p) =>
          p.id.toLowerCase() === lower ||
          p.slug.toLowerCase() === lower ||
          p.name.toLowerCase() === lower,
      );
      if (matchedPlugin) {
        const body = matchedPlugin.skillMarkdown?.trim() || "(该插件尚未编写 SKILL.md)";
        return textResult(
          `# Plugin Skill: ${matchedPlugin.name} (${matchedPlugin.id})\nlocalDir: ${matchedPlugin.localDir ?? "-"}\n\n${body}`,
          { skill: { name: matchedPlugin.id, content: body } as never },
        );
      }

      try {
        const sk = await bridge.callHost<BuiltinSkillMeta>("host.skills.read", {
          name: target,
        });
        return textResult(`# Skill: ${sk.name}\n\n${sk.content}`, {
          skill: sk as never,
        });
      } catch (err) {
        const available = builtins.map((s) => s.name).join(", ");
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(
          `读取 Skill「${target}」失败：${msg}（可用内置 Skill: ${available || "valet-plugin-dev, valet-self-config"}）`,
        );
      }
    },
  });

  const pluginListTool = defineTool({
    name: "plugin_list",
    description:
      "List all installed and available Valet plugins with IDs, slugs, enabled state, sensors/events, localDir, and bundledFiles.",
    parameters: obj({}),
    replay: "safe",
    execute: async () => {
      try {
        const res = await bridge.callHost<{
          pluginsDir?: string;
          plugins?: PluginState[];
        }>("host.plugin.list", {});
        const plugins = Array.isArray(res?.plugins)
          ? res.plugins
          : getState().plugins;
        const summary = plugins.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          source: p.source,
          installed: p.installed,
          enabled: p.enabled,
          localDir: p.localDir,
          bundledFiles: p.bundledFiles,
          events: p.events.map((e) => ({
            id: e.id,
            policy: e.policy,
            sensor: e.sensor,
          })),
        }));
        return textResult(
          JSON.stringify(
            { pluginsDir: res?.pluginsDir, plugins: summary },
            null,
            2,
          ),
        );
      } catch {
        const summary = getState().plugins.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          source: p.source,
          installed: p.installed,
          enabled: p.enabled,
          localDir: p.localDir,
        }));
        return textResult(JSON.stringify({ plugins: summary }, null, 2));
      }
    },
  });

  const pluginInspectTool = defineTool({
    name: "plugin_inspect",
    description:
      "Inspect full details of a plugin by ID or slug, including executionMode, manifestYaml, skillMarkdown, workflowYaml, localDir, and bundled files.",
    parameters: obj({
      id: str({ description: "Plugin ID or slug." }),
    }),
    replay: "safe",
    execute: async (args) => {
      try {
        const res = await bridge.callHost<{
          plugin: PluginState;
          files?: string[];
        }>("host.plugin.inspect", { id: args.id });
        return textResult(JSON.stringify(res, null, 2));
      } catch (err) {
        const found = getState().plugins.find(
          (p) => p.id === args.id || p.slug === args.id,
        );
        if (found) {
          return textResult(JSON.stringify({ plugin: found }, null, 2));
        }
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  const pluginInstallTool = defineTool({
    name: "plugin_install",
    description:
      "Write or install a self-contained Action-less Valet plugin bundle (manifest.yaml + SKILL.md + optional scripts/*) to disk, reload Go sensors, and immediately hot-mount it into the current conversation.",
    parameters: obj({
      slug: opt(str({ description: "Kebab-case directory slug under <dataDir>/plugins/." })),
      id: opt(str({ description: "Optional explicit plugin ID (defaults to slug)." })),
      name: opt(str({ description: "Display name of the plugin." })),
      tagline: opt(str({ description: "Short one-line tagline." })),
      description: opt(str({ description: "Detailed plugin description." })),
      dir: opt(
        str({
          description:
            "Optional existing local directory or manifest.yaml path to install from disk when manifestYaml is omitted.",
        }),
      ),
      manifestYaml: opt(
        str({
          description:
            "Action-less plugin manifest.yaml content declaring triggers (sensors), optional execution_mode (skill | workflow), and optional config_schema.",
        }),
      ),
      executionMode: opt(
        str({
          description:
            "Execution mode: 'skill' (default, mounts SKILL.md) or 'workflow' (executes workflow.yaml via local Vercel Workflow SDK).",
        }),
      ),
      skillMarkdown: opt(
        str({
          description:
            "SKILL.md content explaining how Valet handles events using core tools (used when executionMode is 'skill').",
        }),
      ),
      workflowYaml: opt(
        str({
          description:
            "workflow.yaml DAG definition (used when executionMode is 'workflow').",
        }),
      ),
      files: opt(
        arr(
          obj({
            path: str({ description: "Relative file path inside plugin directory, e.g. scripts/poll-check.mjs" }),
            content: str({ description: "File text content." }),
          }),
          { description: "Optional helper scripts or extra bundle files." },
        ),
      ),
      enabled: opt(bool({ description: "Enable immediately after install (default true)." })),
    }),
    execute: async (args) => {
      if (args.dir && !args.manifestYaml?.trim()) {
        const res = await bridge.callHost<{
          plugin: PluginState;
          plugins?: PluginState[];
        }>("host.plugin.installDir", {
          dir: args.dir,
          slug: args.slug ?? "",
          name: args.name ?? "",
          tagline: args.tagline ?? "",
        });
        if (Array.isArray(res?.plugins)) {
          onPluginsUpdated(res.plugins);
        }
        return textResult(
          `已从目录安装并热加载插件「${res.plugin.name}」(${res.plugin.id}) -> ${res.plugin.localDir ?? ""}`,
          { plugin: res.plugin as never },
        );
      }

      if (!args.manifestYaml?.trim()) {
        return errorResult("plugin_install 需要提供 manifestYaml（或提供现有插件目录 dir）。");
      }

      const fileMap: Record<string, string> = {};
      if (Array.isArray(args.files)) {
        for (const f of args.files) {
          if (f && typeof f.path === "string" && f.path.trim()) {
            fileMap[f.path.trim()] = typeof f.content === "string" ? f.content : "";
          }
        }
      }

      const res = await bridge.callHost<{
        plugin: PluginState;
        plugins?: PluginState[];
      }>("host.plugin.upsert", {
        id: args.id ?? args.slug ?? "",
        slug: args.slug ?? "",
        name: args.name ?? "",
        tagline: args.tagline ?? "",
        description: args.description ?? "",
        manifestYaml: args.manifestYaml,
        executionMode: args.executionMode ?? "",
        skillMarkdown: args.skillMarkdown ?? "",
        workflowYaml: args.workflowYaml ?? "",
        ...(Object.keys(fileMap).length > 0 ? { files: fileMap } : {}),
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      });
      if (Array.isArray(res?.plugins)) {
        onPluginsUpdated(res.plugins);
      }
      const modeLabel =
        res.plugin.executionMode === "workflow"
          ? "已验证并加载 workflow.yaml"
          : "已触发传感器刷新并实时挂载 <plugin_skill>";
      return textResult(
        `已写入并热加载插件「${res.plugin.name}」(${res.plugin.id}) -> ${res.plugin.localDir ?? ""}\n${modeLabel}。`,
        { plugin: res.plugin as never },
      );
    },
  });

  const pluginReloadTool = defineTool({
    name: "plugin_reload",
    description:
      "Hot-reload one plugin (or all local plugins when id is omitted) from disk and refresh sensors & active SKILL.md.",
    parameters: obj({
      id: opt(str({ description: "Plugin ID or slug (omit to reload all)." })),
    }),
    execute: async (args) => {
      const res = await bridge.callHost<{ plugins?: PluginState[] }>(
        "host.plugin.reload",
        { id: args.id ?? "" },
      );
      if (Array.isArray(res?.plugins)) {
        onPluginsUpdated(res.plugins);
      }
      return textResult(
        args.id
          ? `已从磁盘热重载插件 ${args.id} 并同步传感器与 Skill。`
          : "已热重载全部本地插件。",
      );
    },
  });

  const pluginConfigureTool = defineTool({
    name: "plugin_configure",
    description:
      "Enable/disable a plugin or update an event trigger policy (auto | ask | record).",
    parameters: obj({
      id: str({ description: "Plugin ID or slug." }),
      enabled: opt(bool({ description: "Optional enabled state." })),
      eventId: opt(str({ description: "Optional event trigger ID to update policy." })),
      policy: opt(str({ description: "Event policy when eventId is provided: auto | ask | record." })),
    }),
    execute: async (args) => {
      const res = await bridge.callHost<{
        plugin: PluginState;
        plugins?: PluginState[];
      }>("host.plugin.configure", {
        id: args.id,
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.eventId ? { eventId: args.eventId } : {}),
        ...(args.policy ? { policy: args.policy } : {}),
      });
      if (Array.isArray(res?.plugins)) {
        onPluginsUpdated(res.plugins);
      }
      return textResult(
        `已更新插件「${res.plugin.name}」配置 (enabled=${String(res.plugin.enabled)})。`,
        { plugin: res.plugin as never },
      );
    },
  });

  const pluginTriggerTool = defineTool({
    name: "plugin_trigger",
    description:
      "Inject a simulated test event for an enabled plugin to verify its trigger routing and SKILL.md execution.",
    parameters: obj({
      id: str({ description: "Plugin ID." }),
      eventId: str({ description: "Declared event ID from manifest triggers." }),
      payloadJson: opt(str({ description: "Optional JSON string payload." })),
    }),
    execute: async (args) => {
      const res = await bridge.callHost<Record<string, unknown>>(
        "host.plugin.trigger",
        {
          id: args.id,
          eventId: args.eventId,
          payloadJson: args.payloadJson ?? "",
        },
      );
      return textResult(
        `已触发插件 ${args.id} 事件 ${args.eventId}：\n${JSON.stringify(res, null, 2)}`,
      );
    },
  });

  const pluginRemoveTool = defineTool({
    name: "plugin_remove",
    description:
      "Uninstall a plugin (removes local plugins completely; returns catalog plugins to Discover) and optionally deletes its disk directory.",
    parameters: obj({
      id: str({ description: "Plugin ID or slug." }),
      deleteFiles: opt(bool({ description: "Delete local bundle files on disk (default true)." })),
    }),
    execute: async (args) => {
      const res = await bridge.callHost<{
        removed: string;
        plugins?: PluginState[];
      }>("host.plugin.remove", {
        id: args.id,
        ...(args.deleteFiles !== undefined
          ? { deleteFiles: args.deleteFiles }
          : {}),
      });
      if (Array.isArray(res?.plugins)) {
        onPluginsUpdated(res.plugins);
      }
      return textResult(`已移除/卸载插件 ${args.id} 并刷新运行时。`);
    },
  });

  return defineExtension({
    name: "valet:builtin-skills",
    tools: [
      skillLoadTool,
      pluginListTool,
      pluginInspectTool,
      pluginInstallTool,
      pluginReloadTool,
      pluginConfigureTool,
      pluginTriggerTool,
      pluginRemoveTool,
    ],
  });
}
