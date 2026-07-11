import type { ProxymanJsonRpcMessage, ProxymanMcpClient } from "./executors.ts";

import { describe, expect, it } from "vitest";
import { callProxymanMcpTool, proxymanActionHandlers } from "./executors.ts";

class FakeProxymanClient implements ProxymanMcpClient {
  readonly messages: ProxymanJsonRpcMessage[] = [];
  private readonly handler: (message: ProxymanJsonRpcMessage) => unknown;

  constructor(handler: (message: ProxymanJsonRpcMessage) => unknown) {
    this.handler = handler;
  }

  async request(message: ProxymanJsonRpcMessage): Promise<unknown> {
    this.messages.push(message);
    return this.handler(message);
  }

  async notify(message: ProxymanJsonRpcMessage): Promise<void> {
    this.messages.push(message);
  }

  close(): void {}
}

describe("Proxyman provider MCP bridge", () => {
  it("initializes Proxyman MCP, calls a read-only tool, and parses JSON text content", async () => {
    const client = new FakeProxymanClient((message) => {
      if (message.method === "initialize") {
        return { jsonrpc: "2.0", id: message.id, result: { serverInfo: { name: "proxyman-mcp-server" } } };
      }
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: '{"recording":true}' }],
          isError: false,
        },
      };
    });

    const output = await callProxymanMcpTool({ client }, "get_proxy_status", {});

    expect(client.messages).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "oomol-connect-proxyman", version: "1.0.0" },
        },
      },
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_proxy_status", arguments: {} },
      },
    ]);
    expect(output).toEqual({ recording: true });
  });

  it("maps Proxyman MCP tool errors to provider request errors", async () => {
    const client = new FakeProxymanClient((message) => {
      if (message.method === "initialize") {
        return { jsonrpc: "2.0", id: message.id, result: {} };
      }
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: "flow not found" }],
          isError: true,
        },
      };
    });

    await expect(callProxymanMcpTool({ client }, "get_flow_detail", { flow_id: "missing" })).rejects.toMatchObject({
      status: 400,
      message: "proxyman get_flow_detail failed: flow not found",
    });
  });

  it("passes get_flows input through the provider handler unchanged", async () => {
    const client = new FakeProxymanClient((message) => {
      if (message.method === "initialize") {
        return { jsonrpc: "2.0", id: message.id, result: {} };
      }
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ received: message.params }) }],
          isError: false,
        },
      };
    });

    const output = await proxymanActionHandlers.get_flows({ limit: 5, host_filter: "api.example.com" }, { client });

    expect(output).toEqual({
      received: {
        name: "get_flows",
        arguments: { limit: 5, host_filter: "api.example.com" },
      },
    });
  });
});
