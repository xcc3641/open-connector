import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { optionalString } from "../../core/cast.ts";
import { ProviderRequestError, providerUserAgent } from "../provider-runtime.ts";

export const mixpanelMcpEndpoint = "https://mcp.mixpanel.com/mcp";
const mixpanelMcpRequestTimeoutMs = 30_000;

type MixpanelMcpToolResult = Awaited<ReturnType<Client["callTool"]>>;

export interface MixpanelMcpToolSummary {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface MixpanelMcpClientInput {
  accessToken: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
  endpoint?: string;
}

/**
 * Validate an OAuth access token by listing MCP tools.
 */
export async function validateMixpanelMcpAccessToken(input: MixpanelMcpClientInput): Promise<{
  profile: { displayName: string };
  metadata: Record<string, unknown>;
}> {
  const tools = await listMixpanelMcpTools(input);
  // Do not hash the access token into accountId: tokens rotate on re-auth/refresh.
  // Leave accountId unset so the runtime can keep a stable connection identity.
  // Omit grantedScopes so ConnectionService can fall back to token metadata.scope.
  return {
    profile: {
      displayName: "Mixpanel MCP",
    },
    metadata: {
      mcpEndpoint: resolveMixpanelMcpEndpoint(input.endpoint),
      mcpToolCount: tools.length,
      mcpTools: tools.map((tool) => tool.name).sort(),
    },
  };
}

export async function listMixpanelMcpTools(input: MixpanelMcpClientInput): Promise<MixpanelMcpToolSummary[]> {
  return withMixpanelMcpClient(input, async (client) => {
    const result = await client.listTools(
      {},
      {
        timeout: mixpanelMcpRequestTimeoutMs,
      },
    );
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
    }));
  });
}

export async function callMixpanelMcpTool(
  input: MixpanelMcpClientInput & {
    toolName: string;
    arguments: Record<string, unknown>;
  },
): Promise<unknown> {
  return withMixpanelMcpClient(input, async (client) => {
    const result = await client.callTool(
      {
        name: input.toolName,
        arguments: input.arguments,
      },
      undefined,
      {
        timeout: mixpanelMcpRequestTimeoutMs,
      },
    );
    return normalizeMixpanelMcpToolResult(input.toolName, result);
  });
}

async function withMixpanelMcpClient<T>(
  input: MixpanelMcpClientInput,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const endpoint = resolveMixpanelMcpEndpoint(input.endpoint);
  const headers = new Headers();
  headers.set("authorization", `Bearer ${input.accessToken}`);
  headers.set("user-agent", providerUserAgent);

  // StreamableHTTPClientTransport replaces requestInit.signal per request, so
  // parent cancellation must close the client/transport explicitly.
  if (input.signal?.aborted) {
    throw new ProviderRequestError(499, "mixpanel MCP request was cancelled");
  }

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: input.fetcher,
    requestInit: {
      headers,
    },
  });
  const client = new Client({
    name: "oomol-connect-mixpanel",
    version: "1.0.0",
  });

  let onAbort: (() => void) | undefined;
  try {
    if (input.signal) {
      onAbort = () => {
        void client.close().catch(() => undefined);
        void transport.close().catch(() => undefined);
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
    }
    await client.connect(transport, {
      timeout: mixpanelMcpRequestTimeoutMs,
    });
    if (input.signal?.aborted) {
      throw new ProviderRequestError(499, "mixpanel MCP request was cancelled");
    }
    return await run(client);
  } catch (error) {
    if (input.signal?.aborted) {
      throw new ProviderRequestError(499, "mixpanel MCP request was cancelled");
    }
    throw mapMixpanelMcpError(error);
  } finally {
    if (input.signal && onAbort) {
      input.signal.removeEventListener("abort", onAbort);
    }
    await client.close().catch(() => undefined);
  }
}

function normalizeMixpanelMcpToolResult(toolName: string, result: MixpanelMcpToolResult): unknown {
  if ("toolResult" in result) {
    return result;
  }
  if (result.isError) {
    throw new ProviderRequestError(
      502,
      `mixpanel MCP tool ${toolName} returned an error: ${formatMixpanelMcpToolContent(result)}`,
      result,
    );
  }
  if (result.structuredContent) {
    return result.structuredContent;
  }

  const textItems = result.content.filter((content) => content.type === "text");
  if (textItems.length === 1) {
    try {
      const payload: unknown = JSON.parse(textItems[0]!.text);
      return payload;
    } catch {
      // Keep the MCP content envelope when the tool returns plain text.
    }
  }
  return result;
}

function formatMixpanelMcpToolContent(result: Extract<MixpanelMcpToolResult, { content: unknown }>): string {
  const text = result.content
    .map((content) => {
      if (content.type === "text") {
        return content.text;
      }
      if (content.type === "resource") {
        return "text" in content.resource ? content.resource.text : content.resource.uri;
      }
      if (content.type === "resource_link") {
        return content.uri;
      }
      return content.type;
    })
    .filter(Boolean)
    .join("; ");
  return text.slice(0, 300) || "empty error content";
}

function mapMixpanelMcpError(error: unknown): ProviderRequestError {
  if (error instanceof ProviderRequestError) {
    return error;
  }
  if (error instanceof UnauthorizedError) {
    return new ProviderRequestError(401, "mixpanel MCP token is invalid or expired", error);
  }
  if (error instanceof StreamableHTTPError) {
    const status = error.code;
    return new ProviderRequestError(
      status === 401 || status === 403
        ? 401
        : status === 429
          ? 429
          : status && status >= 400 && status < 500
            ? 400
            : 502,
      `mixpanel MCP request failed: ${error.message}`,
      error,
    );
  }
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) {
      return new ProviderRequestError(504, "mixpanel MCP request timed out", error);
    }
    return new ProviderRequestError(502, `mixpanel MCP request failed: ${error.message}`, error);
  }
  return new ProviderRequestError(
    502,
    error instanceof Error ? `mixpanel MCP request failed: ${error.message}` : "mixpanel MCP request failed",
    error,
  );
}

function resolveMixpanelMcpEndpoint(endpoint: string | undefined): string {
  const normalized = optionalString(endpoint) ?? mixpanelMcpEndpoint;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new ProviderRequestError(400, "Mixpanel MCP endpoint must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new ProviderRequestError(400, "Mixpanel MCP endpoint must use https");
  }
  if (url.hostname !== "mcp.mixpanel.com" && !url.hostname.endsWith(".mixpanel.com")) {
    throw new ProviderRequestError(400, "Mixpanel MCP endpoint must use an allowed Mixpanel hostname");
  }
  return url.toString().replace(/\/$/, "") === mixpanelMcpEndpoint.replace(/\/$/, "")
    ? mixpanelMcpEndpoint
    : url.toString();
}
