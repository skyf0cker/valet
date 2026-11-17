import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  type Extension,
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { type Schema, unsafe } from "@earendil-works/pi-schema";
import type { ToolPolicyRegistry } from "./approval.ts";
import type { McpServerConfig, ProbeMcpResponse } from "./protocol.ts";

interface DiscoveredMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface ActiveMcpSession {
  config: McpServerConfig;
  signature: string;
  tools: DiscoveredMcpTool[];
  ext: Extension;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

function sanitizeMcpIdent(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

function isReadOnlyMcpTool(name: string): boolean {
  const lower = name.toLowerCase();
  return /^(list|get|read|search|query|find|fetch|describe|inspect|status|show)_?/.test(
    lower,
  );
}

class StdioMcpConnection {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = "";

  constructor(
    private readonly command: string,
    private readonly args: string[],
  ) {}

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: unknown;
            error?: { message?: string };
          };
          if (typeof msg.id === "number") {
            const p = this.pending.get(msg.id);
            if (p) {
              this.pending.delete(msg.id);
              if (msg.error) {
                p.reject(new Error(msg.error.message || "MCP error"));
              } else {
                p.resolve(msg.result);
              }
            }
          }
        } catch {
          // Ignore non-JSON stderr/banner lines
        }
      }
    });
    child.on("exit", (code) => {
      for (const p of this.pending.values()) {
        p.reject(new Error(`MCP process exited with code ${code ?? -1}`));
      }
      this.pending.clear();
      this.child = null;
    });

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "Valet", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.child) return;
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  async request<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 8000,
  ): Promise<T> {
    if (!this.child) {
      throw new Error("MCP stdio process not started");
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP stdio timeout calling ${method}`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.child!.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  async listTools(): Promise<DiscoveredMcpTool[]> {
    const res = await this.request<{ tools?: DiscoveredMcpTool[] }>(
      "tools/list",
      {},
    );
    return Array.isArray(res?.tools) ? res.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request(
      "tools/call",
      { name, arguments: args },
      25_000,
    );
  }

  async close(): Promise<void> {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.pending.clear();
  }
}

class HttpMcpConnection {
  private nextId = 1;
  private sessionId: string | null = null;

  constructor(private readonly url: string) {}

  private async postJsonRpc<T = unknown>(
    payload: Record<string, unknown>,
    timeoutMs = 8000,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const resp = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const sid = resp.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} from MCP server`);
    }
    const text = await resp.text();
    if (!text.trim()) return {} as T;

    // Parse SSE frame if server responded with text/event-stream
    if (text.includes("\ndata:") || text.startsWith("data:")) {
      const dataLines = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .filter(Boolean);
      const last = dataLines[dataLines.length - 1];
      if (last) {
        const parsed = JSON.parse(last) as { result?: T; error?: { message?: string } };
        if (parsed.error) throw new Error(parsed.error.message || "MCP error");
        return (parsed.result ?? parsed) as T;
      }
    }

    const parsed = JSON.parse(text) as { result?: T; error?: { message?: string } };
    if (parsed.error) throw new Error(parsed.error.message || "MCP error");
    return (parsed.result ?? parsed) as T;
  }

  async initialize(): Promise<void> {
    await this.postJsonRpc({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "Valet", version: "0.1.0" },
      },
    });
  }

  async listTools(): Promise<DiscoveredMcpTool[]> {
    const res = await this.postJsonRpc<{ tools?: DiscoveredMcpTool[] }>({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/list",
      params: {},
    });
    return Array.isArray(res?.tools) ? res.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.postJsonRpc(
      {
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "tools/call",
        params: { name, arguments: args },
      },
      25_000,
    );
  }
}

/**
 * Manages live external MCP server connections (`stdio` and `http`) and compiles their
 * discovered tools into Pi Durable Extensions governed by Valet's safety gate.
 */
export class McpClientManager {
  private readonly sessions = new Map<string, ActiveMcpSession>();

  async probeServer(server: McpServerConfig): Promise<ProbeMcpResponse> {
    const mode = server.transport || (server.url ? "http" : "stdio");
    if (mode === "http") {
      if (!server.url?.trim()) {
        return {
          ok: false,
          toolCount: 0,
          transportLabel: server.transportLabel,
          error: "请填写有效的 MCP HTTP URL",
        };
      }
      try {
        const client = new HttpMcpConnection(server.url.trim());
        await client.initialize();
        const tools = await client.listTools();
        return {
          ok: true,
          toolCount: tools.length,
          transportLabel: `http · ${tools.length} tools`,
          tools: tools.map((t) => t.name),
        };
      } catch (err) {
        return {
          ok: false,
          toolCount: 0,
          transportLabel: server.transportLabel || "http · unreachable",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    if (!server.command?.trim()) {
      return {
        ok: false,
        toolCount: 0,
        transportLabel: server.transportLabel,
        error: "请填写有效的 stdio 启动命令",
      };
    }

    const client = new StdioMcpConnection(
      server.command.trim(),
      server.args ?? [],
    );
    try {
      await client.start();
      const tools = await client.listTools();
      return {
        ok: true,
        toolCount: tools.length,
        transportLabel: `stdio · ${tools.length} tools`,
        tools: tools.map((t) => t.name),
      };
    } catch (err) {
      return {
        ok: false,
        toolCount: 0,
        transportLabel: server.transportLabel || "stdio · error",
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await client.close();
    }
  }

  async syncServers(
    servers: McpServerConfig[],
    policyRegistry: ToolPolicyRegistry,
    installExt: (ext: Extension) => void,
    uninstallExt: (ext: Extension) => void,
  ): Promise<void> {
    const activeIds = new Set<string>();

    for (const srv of servers) {
      if (!srv.enabled) continue;
      const mode = srv.transport || (srv.url ? "http" : srv.command ? "stdio" : "");
      if (!mode) continue;
      activeIds.add(srv.id);

      const sig = JSON.stringify({
        mode,
        command: srv.command ?? "",
        args: srv.args ?? [],
        url: srv.url ?? "",
      });
      const existing = this.sessions.get(srv.id);
      if (existing && existing.signature === sig) continue;

      if (existing) {
        uninstallExt(existing.ext);
        policyRegistry.unregisterByPlugin(`mcp:${srv.id}`);
        await existing.close().catch(() => {});
        this.sessions.delete(srv.id);
      }

      try {
        let tools: DiscoveredMcpTool[] = [];
        let callToolFn: (name: string, args: Record<string, unknown>) => Promise<unknown>;
        let closeFn: () => Promise<void> = async () => {};

        if (mode === "stdio" && srv.command) {
          const client = new StdioMcpConnection(srv.command, srv.args ?? []);
          await client.start();
          tools = await client.listTools();
          callToolFn = (n, a) => client.callTool(n, a);
          closeFn = () => client.close();
        } else if (mode === "http" && srv.url) {
          const client = new HttpMcpConnection(srv.url);
          await client.initialize();
          tools = await client.listTools();
          callToolFn = (n, a) => client.callTool(n, a);
        } else {
          continue;
        }

        const pluginKey = `mcp:${srv.id}`;
        policyRegistry.unregisterByPlugin(pluginKey);

        const compiledTools = tools.map((t) => {
          const safeToolName = `mcp_${sanitizeMcpIdent(srv.id)}_${sanitizeMcpIdent(t.name)}`;
          const readonly = isReadOnlyMcpTool(t.name);
          policyRegistry.register({
            toolName: safeToolName,
            pluginId: pluginKey,
            pluginName: `MCP · ${srv.name}`,
            actionId: t.name,
            eventCode: "mcp.tool_call",
            safety: readonly ? "readonly" : "confirm_always",
            category: "outbound",
            iconKind: "pulse",
            warningTag: readonly ? undefined : "不可撤销",
            reversible7d: false,
            approveLabel: "批准调用",
            dismissLabel: "拒绝",
            checklistKey: readonly ? undefined : "runTerminalCommand",
          });

          const rawSchema: Record<string, unknown> =
            t.inputSchema && typeof t.inputSchema === "object"
              ? {
                  type: "object",
                  ...t.inputSchema,
                }
              : { type: "object", properties: {} };

          return defineTool({
            name: safeToolName,
            description:
              t.description || `External MCP tool ${t.name} from ${srv.name}.`,
            parameters: unsafe<Record<string, unknown>>(rawSchema as unknown as Schema),
            ...(readonly ? { replay: "safe" as const } : {}),
            execute: async (args) => {
              const res = await callToolFn(t.name, args ?? {});
              return {
                output: [
                  {
                    type: "text" as const,
                    text: typeof res === "string" ? res : JSON.stringify(res, null, 2),
                  },
                ],
              };
            },
          });
        });

        const ext = defineExtension({
          name: pluginKey,
          sections: [
            section(`mcp_${sanitizeMcpIdent(srv.id)}`, () => {
              return `已连接 MCP 服务器「${srv.name}」(${srv.transportLabel})：提供工具 ${tools.map((t) => `mcp_${sanitizeMcpIdent(srv.id)}_${sanitizeMcpIdent(t.name)}`).join(", ") || "无"}。`;
            }),
          ],
          tools: compiledTools,
        });

        installExt(ext);
        this.sessions.set(srv.id, {
          config: srv,
          signature: sig,
          tools,
          ext,
          callTool: callToolFn,
          close: closeFn,
        });
      } catch (err) {
        console.error(`[mcp] failed connecting ${srv.name}:`, err);
      }
    }

    for (const [id, sess] of [...this.sessions.entries()]) {
      if (!activeIds.has(id)) {
        uninstallExt(sess.ext);
        policyRegistry.unregisterByPlugin(`mcp:${id}`);
        await sess.close().catch(() => {});
        this.sessions.delete(id);
      }
    }
  }

  async closeAll(): Promise<void> {
    for (const sess of this.sessions.values()) {
      await sess.close().catch(() => {});
    }
    this.sessions.clear();
  }
}
