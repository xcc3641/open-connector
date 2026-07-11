import type { ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import type { AstroActionName } from "./definition.ts";

import { defineProviderExecutors, providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";
import { astroActionNames } from "./definition.ts";

const service = "astro";
const defaultAstroMcpUrl = "http://127.0.0.1:8089/mcp";

export interface AstroActionContext {
  url: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
}

type AstroActionHandler = (input: Record<string, unknown>, context: AstroActionContext) => Promise<unknown>;

export const astroActionHandlers: Record<AstroActionName, AstroActionHandler> = Object.fromEntries(
  astroActionNames.map((name) => [
    name,
    (input: Record<string, unknown>, context: AstroActionContext) => callAstroMcpTool(context, name, input),
  ]),
) as Record<AstroActionName, AstroActionHandler>;

export const executors: ProviderExecutors = defineProviderExecutors<AstroActionContext>({
  service,
  handlers: astroActionHandlers,
  createContext(context: ExecutionContext, fetcher: typeof fetch): AstroActionContext {
    return {
      url: resolveAstroMcpUrl(),
      fetcher,
      signal: context.signal,
    };
  },
  fallbackMessage: "astro MCP request failed",
});

export async function callAstroMcpTool(
  context: AstroActionContext,
  toolName: AstroActionName,
  input: Record<string, unknown>,
): Promise<unknown> {
  const requestBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: input,
    },
  };

  let response: Response;
  let responseText: string;
  try {
    response = await context.fetcher(context.url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "user-agent": providerUserAgent,
      },
      body: JSON.stringify(requestBody),
      signal: context.signal,
    });
    responseText = await response.text();
  } catch (error) {
    throw new ProviderRequestError(
      502,
      error instanceof Error ? `astro MCP request failed: ${error.message}` : "astro MCP request failed",
    );
  }

  if (!response.ok) {
    throw new ProviderRequestError(
      response.status >= 500 ? 502 : response.status,
      `astro MCP HTTP ${response.status}: ${snippet(responseText)}`,
    );
  }

  const payload = parseJsonRpcResponse(responseText);
  if (payload.error) {
    throw new ProviderRequestError(
      mapJsonRpcErrorStatus(payload.error.code),
      `astro MCP ${toolName} error: ${payload.error.message ?? "unknown JSON-RPC error"}`,
      payload.error.data,
    );
  }
  if (!payload.result) {
    throw new ProviderRequestError(502, `astro MCP ${toolName} returned no result`);
  }

  if (payload.result.isError) {
    throw new ProviderRequestError(400, `astro ${toolName} failed: ${resultContentText(payload.result)}`);
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

function resolveAstroMcpUrl(): string {
  const url = process.env.ASTRO_MCP_URL?.trim();
  return url || defaultAstroMcpUrl;
}

function parseJsonRpcResponse(text: string): McpJsonRpcResponse {
  try {
    return JSON.parse(text) as McpJsonRpcResponse;
  } catch {
    throw new ProviderRequestError(502, `astro MCP returned non-JSON response: ${snippet(text)}`);
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
  return snippet(text || "unknown Astro MCP tool error");
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
