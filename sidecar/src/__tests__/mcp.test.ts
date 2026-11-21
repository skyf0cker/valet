import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Extension } from "@earendil-works/pi-durable";
import { ToolPolicyRegistry } from "../approval.ts";
import { buildEnhancedMcpEnv, McpClientManager } from "../mcp.ts";

describe("MCP Client Manager resilience & HTTP headers", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop();
      if (s) {
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    }
  });

  it("handles nonexistent stdio MCP commands gracefully without crashing the process", async () => {
    const manager = new McpClientManager();
    const policy = new ToolPolicyRegistry();
    const installed: Extension[] = [];

    const probe = await manager.probeServer({
      id: "mcp-missing",
      abbr: "mi",
      name: "missing",
      transportLabel: "stdio · __valet_nonexistent_mcp_cmd__",
      toolCount: 0,
      enabled: true,
      transport: "stdio",
      command: "__valet_nonexistent_mcp_cmd__",
      args: ["--flag"],
    });
    expect(probe.ok).toBe(false);
    expect(probe.toolCount).toBe(0);
    expect(typeof probe.error).toBe("string");
    expect((probe.error ?? "").length).toBeGreaterThanOrEqual(5);

    await manager.syncServers(
      [
        {
          id: "mcp-missing",
          abbr: "mi",
          name: "missing",
          transportLabel: "stdio · __valet_nonexistent_mcp_cmd__",
          toolCount: 0,
          enabled: true,
          transport: "stdio",
          command: "__valet_nonexistent_mcp_cmd__",
          args: ["--flag"],
        },
      ],
      policy,
      (ext) => installed.push(ext),
      () => {},
    );
    expect(installed.length).toBe(0);

    const env = buildEnhancedMcpEnv();
    expect(env.PATH ?? "").toContain("/usr/local/bin");
    await manager.closeAll();
  });

  it("forwards custom HTTP headers across initialize, tools/list, and tools/call", async () => {
    const seenMethods: string[] = [];
    const srv = createServer((req, res) => {
      if (req.headers.authorization !== "Bearer test-token-123") {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "MISSING_MCP_AUTH" }));
        return;
      }
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as {
          id?: number;
          method?: string;
          params?: { name?: string; arguments?: Record<string, unknown> };
        };
        if (body.method) seenMethods.push(body.method);
        res.setHeader("Content-Type", "application/json");
        if (body.method === "initialize") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: { protocolVersion: "2024-11-05", serverInfo: { name: "tower", version: "1.0" } },
            }),
          );
          return;
        }
        if (body.method === "tools/list") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                tools: [
                  {
                    name: "get_platform_state",
                    description: "Read Tower state",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              },
            }),
          );
          return;
        }
        if (body.method === "tools/call") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [{ type: "text", text: "tower-ok" }],
              },
            }),
          );
          return;
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
      });
    });

    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    servers.push(srv);
    const port = (srv.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/mcp`;

    const manager = new McpClientManager();
    const policy = new ToolPolicyRegistry();
    const installed: Extension[] = [];

    const unauthProbe = await manager.probeServer({
      id: "tower-noauth",
      abbr: "to",
      name: "tower",
      transportLabel: "http",
      toolCount: 0,
      enabled: true,
      transport: "http",
      url,
    });
    expect(unauthProbe.ok).toBe(false);
    expect(unauthProbe.error ?? "").toContain("401");

    const authProbe = await manager.probeServer({
      id: "tower-auth",
      abbr: "to",
      name: "tower",
      transportLabel: "http",
      toolCount: 0,
      enabled: true,
      transport: "http",
      url,
      headers: {
        Authorization: "Bearer test-token-123",
      },
    });
    expect(authProbe.ok).toBe(true);
    expect(authProbe.toolCount).toBe(1);
    expect(authProbe.tools).toEqual(["get_platform_state"]);

    await manager.syncServers(
      [
        {
          id: "tower-1",
          abbr: "to",
          name: "tower",
          transportLabel: `http · ${url}`,
          toolCount: 1,
          enabled: true,
          transport: "http",
          url,
          headers: {
            Authorization: "Bearer test-token-123",
          },
        },
      ],
      policy,
      (ext) => installed.push(ext),
      () => {},
    );
    expect(installed.length).toBe(1);
    const tool = installed[0]?.tools?.[0];
    expect(tool?.name).toBe("mcp_tower_1_get_platform_state");
    const callRes = await tool!.execute({}, {} as never, {} as never);
    expect(JSON.stringify(callRes)).toContain("tower-ok");
    expect(seenMethods).toContain("tools/call");

    await manager.closeAll();
  });
});
