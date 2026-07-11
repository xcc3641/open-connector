import type { ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import type { ProxymanActionName } from "./definition.ts";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Interface as ReadlineInterface } from "node:readline";

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { defineProviderExecutors, providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";
import { proxymanActionNames } from "./definition.ts";

const service = "proxyman";
const proxymanProtocolVersion = "2025-06-18";
const defaultProxymanMcpServerPath = "/Applications/Proxyman.app/Contents/MacOS/mcp-server";
const defaultHandshakePath = join(homedir(), "Library/Application Support/com.proxyman.NSProxy/mcp-handshake.json");
const defaultRequestTimeoutMs = 20_000;

export interface ProxymanJsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface ProxymanMcpClient {
  request(message: ProxymanJsonRpcMessage): Promise<unknown>;
  notify(message: ProxymanJsonRpcMessage): Promise<void>;
  close(): void;
}

export interface ProxymanActionContext {
  client: ProxymanMcpClient;
}

type ProxymanActionHandler = (input: Record<string, unknown>, context: ProxymanActionContext) => Promise<unknown>;

export const proxymanActionHandlers: Record<ProxymanActionName, ProxymanActionHandler> = Object.fromEntries(
  proxymanActionNames.map((name) => [
    name,
    (input: Record<string, unknown>, context: ProxymanActionContext) => callProxymanMcpTool(context, name, input),
  ]),
) as Record<ProxymanActionName, ProxymanActionHandler>;

export const executors: ProviderExecutors = defineProviderExecutors<ProxymanActionContext>({
  service,
  handlers: proxymanActionHandlers,
  createContext(context: ExecutionContext, fetcher: typeof fetch): ProxymanActionContext {
    return {
      client: createProxymanClient(fetcher, context.signal),
    };
  },
  fallbackMessage: "proxyman MCP request failed",
});

export async function callProxymanMcpTool(
  context: ProxymanActionContext,
  toolName: ProxymanActionName,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    const initializePayload = await context.client.request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: proxymanProtocolVersion,
        capabilities: {},
        clientInfo: {
          name: "oomol-connect-proxyman",
          version: "1.0.0",
        },
      },
    });
    const initializeResponse = normalizeJsonRpcResponse(initializePayload);
    if (initializeResponse.error) {
      throw new ProviderRequestError(
        mapJsonRpcErrorStatus(initializeResponse.error.code),
        `proxyman MCP initialize error: ${initializeResponse.error.message ?? "unknown JSON-RPC error"}`,
        initializeResponse.error.data,
      );
    }

    await context.client.notify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });

    const payload = normalizeJsonRpcResponse(
      await context.client.request({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: input,
        },
      }),
    );

    if (payload.error) {
      throw new ProviderRequestError(
        mapJsonRpcErrorStatus(payload.error.code),
        `proxyman MCP ${toolName} error: ${payload.error.message ?? "unknown JSON-RPC error"}`,
        payload.error.data,
      );
    }
    if (!payload.result) {
      throw new ProviderRequestError(502, `proxyman MCP ${toolName} returned no result`);
    }

    if (payload.result.isError) {
      throw new ProviderRequestError(400, `proxyman ${toolName} failed: ${resultContentText(payload.result)}`);
    }

    if (payload.result.structuredContent !== undefined) {
      return payload.result.structuredContent;
    }

    const content = payload.result.content ?? [];
    const textItems = content.filter(
      (item): item is McpTextContent => item.type === "text" && typeof item.text === "string",
    );
    if (textItems.length === 1) {
      return parseTextContent(textItems[0].text);
    }
    if (textItems.length > 1) {
      return textItems.map((item) => parseTextContent(item.text));
    }
    if (content.length > 0) {
      return content;
    }
    return payload.result;
  } finally {
    context.client.close();
  }
}

function createProxymanClient(fetcher: typeof fetch, signal?: AbortSignal): ProxymanMcpClient {
  const explicitUrl = process.env.PROXYMAN_MCP_URL?.trim();
  const explicitToken = process.env.PROXYMAN_MCP_TOKEN?.trim();
  if (explicitUrl) {
    if (!explicitToken) {
      throw new ProviderRequestError(400, "PROXYMAN_MCP_URL is set but PROXYMAN_MCP_TOKEN is missing");
    }
    return new HttpProxymanMcpClient({ url: explicitUrl, token: explicitToken, fetcher, signal });
  }

  const handshake = readProxymanHandshake();
  if (handshake) {
    const host = process.env.PROXYMAN_MCP_HTTP_HOST?.trim() || "127.0.0.1";
    const protocol = process.env.PROXYMAN_MCP_HTTP_PROTOCOL?.trim() || "http";
    return new HttpProxymanMcpClient({
      url: `${protocol}://${host}:${handshake.port}/mcp`,
      token: explicitToken || handshake.token,
      fetcher,
      signal,
    });
  }

  return new StdioProxymanMcpClient(resolveProxymanMcpServerPath(), signal);
}

function resolveProxymanMcpServerPath(): string {
  return process.env.PROXYMAN_MCP_SERVER_PATH?.trim() || defaultProxymanMcpServerPath;
}

function readProxymanHandshake(): ProxymanHandshake | undefined {
  const path = process.env.PROXYMAN_MCP_HANDSHAKE_PATH?.trim() || defaultHandshakePath;
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Partial<ProxymanHandshake>;
    if (typeof data.token === "string" && typeof data.port === "number" && Number.isInteger(data.port)) {
      return { token: data.token, port: data.port };
    }
  } catch {
    throw new ProviderRequestError(502, `proxyman MCP handshake file is invalid: ${path}`);
  }
  throw new ProviderRequestError(502, `proxyman MCP handshake file is missing token or port: ${path}`);
}

class HttpProxymanMcpClient implements ProxymanMcpClient {
  private readonly url: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly signal?: AbortSignal;

  constructor(options: { url: string; token: string; fetcher: typeof fetch; signal?: AbortSignal }) {
    this.url = options.url;
    this.token = options.token;
    this.fetcher = options.fetcher;
    this.signal = options.signal;
  }

  async request(message: ProxymanJsonRpcMessage): Promise<unknown> {
    if (message.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: proxymanProtocolVersion,
          serverInfo: { name: "proxyman-mcp-http-bridge", version: "1.0.0" },
          capabilities: { tools: { listChanged: false } },
        },
      };
    }

    if (message.method !== "tools/call") {
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `unsupported Proxyman MCP method: ${message.method ?? "unknown"}` },
      };
    }

    const params = asRecord(message.params);
    const toolName = typeof params.name === "string" ? params.name : undefined;
    if (!toolName) {
      return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "tools/call missing tool name" } };
    }
    const toolArguments = asRecord(params.arguments);
    const body =
      Object.keys(toolArguments).length > 0 ? { command: toolName, params: toolArguments } : { command: toolName };

    let response: Response;
    let responseText: string;
    try {
      response = await this.fetcher(this.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "user-agent": providerUserAgent,
        },
        body: JSON.stringify(body),
        signal: this.signal,
      });
      responseText = await response.text();
    } catch (error) {
      throw new ProviderRequestError(
        502,
        error instanceof Error
          ? `proxyman MCP HTTP request failed: ${error.message}`
          : "proxyman MCP HTTP request failed",
      );
    }

    if (!response.ok) {
      throw new ProviderRequestError(
        response.status >= 500 ? 502 : response.status,
        `proxyman MCP HTTP ${response.status}: ${snippet(responseText)}`,
      );
    }

    const payload = parseJson(responseText, "proxyman MCP HTTP response") as ProxymanHttpResponse;
    if (payload.success === false) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: payload.error ?? "unknown Proxyman HTTP error" }],
          isError: true,
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        structuredContent: payload.data !== undefined ? payload.data : payload,
        isError: false,
      },
    };
  }

  async notify(_message: ProxymanJsonRpcMessage): Promise<void> {}

  close(): void {}
}

class StdioProxymanMcpClient implements ProxymanMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: ReadlineInterface;
  private readonly pending = new Map<number, PendingRequest>();
  private stderrText = "";
  private closed = false;
  private readonly abortHandler?: () => void;

  constructor(command: string, signal?: AbortSignal) {
    try {
      this.child = spawn(command, [], { stdio: "pipe" });
    } catch (error) {
      throw new ProviderRequestError(
        502,
        error instanceof Error
          ? `failed to start Proxyman MCP server: ${error.message}`
          : "failed to start Proxyman MCP server",
      );
    }

    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      this.stderrText = snippet(`${this.stderrText}${String(chunk)}`);
    });
    this.child.on("error", (error) => this.rejectAll(`proxyman MCP process error: ${error.message}`));
    this.child.on("exit", (code, childSignal) => {
      if (!this.closed) {
        this.rejectAll(`proxyman MCP process exited: ${code ?? childSignal ?? "unknown"}`);
      }
    });

    if (signal) {
      this.abortHandler = () => {
        this.rejectAll("proxyman MCP request aborted");
        this.close();
      };
      signal.addEventListener("abort", this.abortHandler, { once: true });
    }
  }

  request(message: ProxymanJsonRpcMessage): Promise<unknown> {
    if (message.id === undefined) {
      return Promise.reject(new ProviderRequestError(500, "proxyman MCP request id is required"));
    }
    if (this.closed) {
      return Promise.reject(new ProviderRequestError(502, "proxyman MCP process is closed"));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(message.id!);
        reject(
          new ProviderRequestError(
            504,
            `proxyman MCP request timed out${this.stderrText ? `: ${this.stderrText}` : ""}`,
          ),
        );
      }, defaultRequestTimeoutMs);
      this.pending.set(message.id!, { resolve, reject, timeout });
      this.writeMessage(message).catch((error: unknown) => {
        clearTimeout(timeout);
        this.pending.delete(message.id!);
        reject(error);
      });
    });
  }

  async notify(message: ProxymanJsonRpcMessage): Promise<void> {
    await this.writeMessage(message);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.lines.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new ProviderRequestError(502, "proxyman MCP process closed"));
    }
    this.pending.clear();
    this.child.kill("SIGTERM");
  }

  private async writeMessage(message: ProxymanJsonRpcMessage): Promise<void> {
    const serialized = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(serialized, (error) => {
        if (error) {
          reject(new ProviderRequestError(502, `proxyman MCP write failed: ${error.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  private handleLine(line: string): void {
    const payload = parseJson(line, "proxyman MCP stdio response") as ProxymanJsonRpcMessage;
    if (payload.id === undefined) {
      return;
    }
    const pending = this.pending.get(payload.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(payload.id);
    pending.resolve(payload);
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new ProviderRequestError(502, `${message}${this.stderrText ? `: ${this.stderrText}` : ""}`));
    }
    this.pending.clear();
  }
}

function normalizeJsonRpcResponse(payload: unknown): McpJsonRpcResponse {
  const record = asRecord(payload);
  return record as McpJsonRpcResponse;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderRequestError(502, `${label} returned non-JSON data: ${snippet(text)}`);
  }
}

function parseTextContent(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

function resultContentText(result: McpToolResult): string {
  const text = (result.content ?? [])
    .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : JSON.stringify(item)))
    .join("\n")
    .trim();
  return snippet(text || "unknown Proxyman MCP tool error");
}

function mapJsonRpcErrorStatus(code: number | undefined): 400 | 404 | 502 {
  if (code === -32601) {
    return 404;
  }
  if (code === -32602 || code === -32000) {
    return 400;
  }
  return 502;
}

function snippet(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim().slice(0, 500);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

interface ProxymanHandshake {
  token: string;
  port: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ProxymanHttpResponse {
  success?: boolean;
  data?: unknown;
  error?: string;
  [key: string]: unknown;
}

interface McpJsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: McpToolResult;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface McpToolResult {
  content?: McpContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface McpTextContent {
  type: "text";
  text: string;
}

type McpContent = McpTextContent | Record<string, unknown>;
