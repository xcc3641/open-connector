import type { CredentialValidators, ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import type { Context7ActionName } from "./definition.ts";

import { defineProviderExecutors, providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";

const service = "context7";
const defaultContext7McpUrl = "https://mcp.context7.com/mcp";
const context7ProtocolVersion = "2024-11-05";

export type Context7McpToolName = "resolve-library-id" | "query-docs";

export interface Context7ActionContext {
  url: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
  /** Optional Context7 API key (ctx7sk-...). When set, requests include CONTEXT7_API_KEY. */
  apiKey?: string;
}

type Context7ActionHandler = (input: Record<string, unknown>, context: Context7ActionContext) => Promise<unknown>;

const actionToolNames: Record<Context7ActionName, Context7McpToolName> = {
  resolve_library_id: "resolve-library-id",
  query_docs: "query-docs",
};

export const context7ActionHandlers: Record<Context7ActionName, Context7ActionHandler> = {
  resolve_library_id(input, context): Promise<unknown> {
    return callContext7McpTool(context, "resolve-library-id", input);
  },
  query_docs(input, context): Promise<unknown> {
    return callContext7McpTool(context, "query-docs", input);
  },
};

export const executors: ProviderExecutors = defineProviderExecutors<Context7ActionContext>({
  service,
  handlers: context7ActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<Context7ActionContext> {
    return createContext7ActionContext(context, fetcher);
  },
  fallbackMessage: "context7 MCP request failed",
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    await initializeContext7Session({
      url: resolveContext7McpUrl(),
      fetcher,
      signal,
      apiKey: input.apiKey,
    });
    return {
      profile: {
        accountId: "context7:api_key",
        displayName: "Context7 API Key",
      },
    };
  },
};

export async function createContext7ActionContext(
  context: ExecutionContext,
  fetcher: typeof fetch = fetch,
): Promise<Context7ActionContext> {
  const credential = await context.getCredential(service);
  if (!credential || credential.authType === "no_auth") {
    return {
      url: resolveContext7McpUrl(),
      fetcher,
      signal: context.signal,
    };
  }
  if (credential.authType === "api_key") {
    return {
      url: resolveContext7McpUrl(),
      fetcher,
      signal: context.signal,
      apiKey: credential.apiKey,
    };
  }
  throw new ProviderRequestError(401, "Connect Context7 without authentication or configure a Context7 API key.");
}

export async function callContext7McpTool(
  context: Context7ActionContext,
  toolName: Context7McpToolName,
  input: Record<string, unknown>,
): Promise<unknown> {
  const sessionId = await initializeContext7Session(context);
  const payload = await requestContext7JsonRpc(
    context,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: input,
      },
    },
    sessionId,
  );

  if (payload.error) {
    throw new ProviderRequestError(
      mapJsonRpcErrorStatus(payload.error.code),
      `context7 MCP ${toolName} error: ${payload.error.message ?? "unknown JSON-RPC error"}`,
      payload.error.data,
    );
  }
  if (!payload.result) {
    throw new ProviderRequestError(502, `context7 MCP ${toolName} returned no result`);
  }
  if (payload.result.isError) {
    throw new ProviderRequestError(400, `context7 ${toolName} failed: ${resultContentText(payload.result)}`);
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
}

async function initializeContext7Session(context: Context7ActionContext): Promise<string> {
  const response = await postContext7JsonRpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: context7ProtocolVersion,
      capabilities: {},
      clientInfo: {
        name: "oomol-connect-context7",
        version: "1.0.0",
      },
    },
  });
  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) {
    throw new ProviderRequestError(502, "context7 MCP initialize returned no MCP session id");
  }

  const payload = parseJsonRpcResponse(response.text);
  if (payload.error) {
    throw new ProviderRequestError(
      mapJsonRpcErrorStatus(payload.error.code),
      `context7 MCP initialize error: ${payload.error.message ?? "unknown JSON-RPC error"}`,
      payload.error.data,
    );
  }
  return sessionId;
}

async function requestContext7JsonRpc(
  context: Context7ActionContext,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<McpJsonRpcResponse> {
  const response = await postContext7JsonRpc(context, body, sessionId);
  return parseJsonRpcResponse(response.text);
}

async function postContext7JsonRpc(
  context: Context7ActionContext,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ headers: Headers; text: string }> {
  let response: Response;
  let text: string;
  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": context7ProtocolVersion,
      "user-agent": providerUserAgent,
      ...context7AuthHeaders(context.apiKey),
    };
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }
    response = await context.fetcher(context.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: context.signal,
    });
    text = await response.text();
  } catch (error) {
    throw new ProviderRequestError(
      502,
      error instanceof Error ? `context7 MCP request failed: ${error.message}` : "context7 MCP request failed",
    );
  }

  if (!response.ok) {
    throw new ProviderRequestError(
      response.status >= 500 ? 502 : response.status,
      `context7 MCP HTTP ${response.status}: ${snippet(text)}`,
    );
  }

  return { headers: response.headers, text };
}

function resolveContext7McpUrl(): string {
  const url = process.env.CONTEXT7_MCP_URL?.trim();
  return url || defaultContext7McpUrl;
}

/**
 * Hosted Context7 MCP accepts several header names; prefer CONTEXT7_API_KEY per docs.
 * @see https://context7.com/docs/howto/api-keys
 */
export function context7AuthHeaders(apiKey: string | undefined): Record<string, string> {
  const key = apiKey?.trim();
  if (!key) {
    return {};
  }
  return {
    CONTEXT7_API_KEY: key,
    authorization: `Bearer ${key}`,
  };
}

function parseJsonRpcResponse(text: string): McpJsonRpcResponse {
  const jsonText = extractSseData(text) ?? text;
  try {
    return JSON.parse(jsonText) as McpJsonRpcResponse;
  } catch {
    throw new ProviderRequestError(502, `context7 MCP returned non-JSON response: ${snippet(text)}`);
  }
}

function extractSseData(text: string): string | undefined {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());
  return dataLines.length > 0 ? dataLines.join("\n") : undefined;
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
  return snippet(text || "unknown Context7 MCP tool error");
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
