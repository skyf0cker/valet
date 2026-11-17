import { connect, type Socket } from "node:net";
import { createInterface } from "node:readline";
import type {
  DispatchPluginEventRequest,
  ExecuteApprovedToolRequest,
  HostBridge,
  ProbeMcpRequest,
  ResolvePermissionRequest,
  SendChatRequest,
  TestAutoReviewRequest,
  TestProviderRequest,
  ValetSyncState,
} from "./protocol.ts";
import { ValetDurableRuntime } from "./runtime.ts";

// Reserve stdout exclusively for NDJSON JSON-RPC 2.0 frames.
console.log = (...args: unknown[]) => {
  console.error(...args);
};

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface RpcResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

class StdioJsonRpcServer implements HostBridge {
  private nextId = 1;
  private socket: Socket | null = null;
  private readonly pendingHostCalls = new Map<
    string | number,
    {
      resolve: (val: unknown) => void;
      reject: (err: Error) => void;
    }
  >();

  private runtime: ValetDurableRuntime;

  constructor() {
    this.runtime = new ValetDurableRuntime(this);
  }

  private writeFrame(msg: object): void {
    const frame = `${JSON.stringify(msg)}\n`;
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(frame);
      return;
    }
    process.stdout.write(frame);
  }

  notifyHost(method: string, params?: unknown): void {
    this.writeFrame({ jsonrpc: "2.0", method, params });
  }

  callHost<TResult = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<TResult> {
    const id = `sc-${this.nextId++}`;
    return new Promise<TResult>((resolve, reject) => {
      this.pendingHostCalls.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
      });
      this.writeFrame({ jsonrpc: "2.0", id, method, params });
    });
  }

  private async handleIncomingLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: RpcRequest & RpcResponse;
    try {
      msg = JSON.parse(trimmed) as RpcRequest & RpcResponse;
    } catch (error) {
      console.error("[sidecar] failed to parse JSON-RPC line:", error);
      return;
    }

    // Response to a host.* call initiated by Sidecar
    if (!msg.method && msg.id !== undefined) {
      const pending = this.pendingHostCalls.get(msg.id);
      if (!pending) return;
      this.pendingHostCalls.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || "host RPC error"));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Incoming request from Go Host
    const { id, method, params = {} } = msg;
    try {
      const result = await this.dispatch(method, params);
      if (id !== undefined) {
        this.writeFrame({ jsonrpc: "2.0", id, result });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (id !== undefined) {
        this.writeFrame({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message },
        });
      }
    }
  }

  private async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case "agent.ping":
        return { ok: true, pid: process.pid, runtime: typeof Bun !== "undefined" ? "bun" : "node" };
      case "agent.init":
        return this.runtime.init({
          dbPath: String(params.dbPath ?? ""),
          state: params.state as ValetSyncState,
        });
      case "agent.syncState":
        return this.runtime.syncState(params.state as ValetSyncState);
      case "chat.send":
        return this.runtime.sendChat(params as unknown as SendChatRequest);
      case "chat.abort":
        return this.runtime.abortChat(String(params.chatId ?? ""));
      case "chat.resolvePermission":
        return this.runtime.resolvePermission(
          params as unknown as ResolvePermissionRequest,
        );
      case "plugin.event":
        return this.runtime.dispatchPluginEvent(
          params as unknown as DispatchPluginEventRequest,
        );
      case "tool.executeApproved":
        return this.runtime.executeApprovedTool(
          params as unknown as ExecuteApprovedToolRequest,
        );
      case "agent.inspect":
        return this.runtime.inspect();
      case "agent.testProvider":
        return this.runtime.testProvider(
          params as unknown as TestProviderRequest,
        );
      case "agent.testAutoReview":
        return this.runtime.testAutoReview(
          params as unknown as TestAutoReviewRequest,
        );
      case "mcp.probe":
        return this.runtime.probeMcpServer(params as unknown as ProbeMcpRequest);
      case "agent.shutdown":
        await this.runtime.close();
        setTimeout(() => process.exit(0), 15);
        return { ok: true };
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  private resolveSocketPath(): string | undefined {
    const idx = process.argv.indexOf("--socket");
    if (idx >= 0 && idx + 1 < process.argv.length) {
      return process.argv[idx + 1];
    }
    const envPath = process.env.VALET_AGENT_SOCKET?.trim();
    return envPath || undefined;
  }

  start(): void {
    const socketPath = this.resolveSocketPath();
    if (socketPath) {
      const sock = connect(socketPath);
      this.socket = sock;
      sock.setEncoding("utf8");
      let buf = "";
      let shuttingDown = false;
      const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        void this.runtime.close().finally(() => process.exit(0));
      };
      sock.on("data", (chunk: string) => {
        buf += chunk;
        let nlIdx: number;
        while ((nlIdx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nlIdx);
          buf = buf.slice(nlIdx + 1);
          void this.handleIncomingLine(line);
        }
      });
      sock.on("close", shutdown);
      sock.on("error", shutdown);
      return;
    }

    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on("line", (line) => {
      void this.handleIncomingLine(line);
    });
    rl.on("close", () => {
      void this.runtime.close().finally(() => process.exit(0));
    });
  }
}

new StdioJsonRpcServer().start();
