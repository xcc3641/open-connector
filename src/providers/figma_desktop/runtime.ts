import type { TransitFileWriter } from "../../core/types.ts";
import type { ProviderActionHandlers, ProviderFetch, ProviderRuntimeHandler } from "../provider-runtime.ts";

import { base64Bytes, optionalRecord, optionalString } from "../../core/cast.ts";
import {
  createProviderTimeout,
  isAbortSignalError,
  ProviderRequestError,
  providerUserAgent,
} from "../provider-runtime.ts";

const defaultFigmaDesktopMcpUrl = "http://127.0.0.1:3845/mcp";
const dockerHostFigmaDesktopMcpUrl = "http://host.docker.internal:3845/mcp";
const figmaDesktopRequestTimeoutMs = 120_000;
const mcpProtocolVersion = "2025-06-18";
const unknownClientContext = "unknown";

/** Resolved endpoint of the Dev Mode MCP server exposed by the Figma desktop app. */
export const figmaDesktopMcpUrl: string = resolveFigmaDesktopMcpUrl();

export interface FigmaDesktopActionContext {
  url: string;
  fetcher: ProviderFetch;
  transitFiles?: TransitFileWriter;
  signal?: AbortSignal;
}

/**
 * The Figma Dev Mode MCP server is stateful: every tool call must carry the
 * session id handed out by `initialize`. Sessions are per endpoint and survive
 * across calls, so one session is opened lazily and reused until Figma drops it.
 */
let openSessionPromise: Promise<string> | undefined;

export const figmaDesktopActionHandlers: ProviderActionHandlers<
  "figma_desktop",
  ProviderRuntimeHandler<FigmaDesktopActionContext>
> = {
  get_design_context: (input, context) => callFigmaDesktopTool(context, "get_design_context", input),
  get_metadata: (input, context) => callFigmaDesktopTool(context, "get_metadata", input),
  get_screenshot: (input, context) => callFigmaDesktopTool(context, "get_screenshot", input),
  get_variable_defs: (input, context) => callFigmaDesktopTool(context, "get_variable_defs", input),
  get_motion_context: (input, context) => callFigmaDesktopTool(context, "get_motion_context", input),
  get_figjam: (input, context) => callFigmaDesktopTool(context, "get_figjam", input),
};

/** Call one Dev Mode MCP tool, reopening the session once when Figma expired it. */
export async function callFigmaDesktopTool(
  context: FigmaDesktopActionContext,
  toolName: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: withClientContext(toolName, input) },
  });

  let response = await postFigmaDesktop(context, body, await ensureSession(context));
  if (isStaleSessionResponse(response)) {
    resetSession();
    response = await postFigmaDesktop(context, body, await ensureSession(context));
  }
  if (response.status >= 400) {
    throw new ProviderRequestError(
      response.status >= 500 ? 502 : response.status,
      `Figma Dev Mode MCP HTTP ${response.status}: ${snippet(response.text)}`,
    );
  }

  const payload = parseMcpMessage(response.text);
  if (payload.error) {
    throw new ProviderRequestError(
      mapJsonRpcErrorStatus(payload.error.code),
      `Figma Dev Mode MCP ${toolName} error: ${payload.error.message ?? "unknown JSON-RPC error"}`,
      payload.error.data,
    );
  }
  if (!payload.result) {
    throw new ProviderRequestError(502, `Figma Dev Mode MCP ${toolName} returned no result`);
  }
  if (payload.result.isError) {
    throw new ProviderRequestError(400, `Figma ${toolName} failed: ${resultContentText(payload.result)}`);
  }

  return readToolResult(context, toolName, payload.result);
}

/** Only the fixed Docker-to-host endpoint may bypass the redundant DNS check. */
export function shouldSkipFigmaDesktopDnsValidation(url: string): boolean {
  return url === dockerHostFigmaDesktopMcpUrl;
}

function resolveFigmaDesktopMcpUrl(): string {
  const configured = process.env.FIGMA_DESKTOP_MCP_URL?.trim();
  const resolved = configured || defaultFigmaDesktopMcpUrl;
  return resolved.endsWith("/") ? resolved.slice(0, -1) : resolved;
}

function ensureSession(context: FigmaDesktopActionContext): Promise<string> {
  if (!openSessionPromise) {
    const pending = openSession(context);
    openSessionPromise = pending;
    pending.catch(() => {
      if (openSessionPromise === pending) {
        openSessionPromise = undefined;
      }
    });
  }
  return openSessionPromise;
}

function resetSession(): void {
  openSessionPromise = undefined;
}

async function openSession(context: FigmaDesktopActionContext): Promise<string> {
  const initialize = await postFigmaDesktop(
    context,
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: mcpProtocolVersion,
        capabilities: {},
        clientInfo: { name: "oomol-connect", version: "1" },
      },
    }),
  );
  if (initialize.status >= 400) {
    throw new ProviderRequestError(
      initialize.status >= 500 ? 502 : initialize.status,
      `Figma Dev Mode MCP initialize failed with HTTP ${initialize.status}: ${snippet(initialize.text)}`,
    );
  }

  const sessionId = initialize.sessionId;
  if (!sessionId) {
    throw new ProviderRequestError(502, "Figma Dev Mode MCP initialize returned no mcp-session-id header");
  }

  const initialized = parseMcpMessage(initialize.text);
  if (initialized.error) {
    throw new ProviderRequestError(
      mapJsonRpcErrorStatus(initialized.error.code),
      `Figma Dev Mode MCP initialize error: ${initialized.error.message ?? "unknown JSON-RPC error"}`,
    );
  }

  await postFigmaDesktop(context, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), sessionId);
  return sessionId;
}

interface FigmaDesktopResponse {
  status: number;
  text: string;
  sessionId?: string;
}

async function postFigmaDesktop(
  context: FigmaDesktopActionContext,
  body: string,
  sessionId?: string,
): Promise<FigmaDesktopResponse> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "user-agent": providerUserAgent,
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = mcpProtocolVersion;
  }

  context.signal?.throwIfAborted();
  const timeout = createProviderTimeout(context.signal, figmaDesktopRequestTimeoutMs);
  try {
    const response = await context.fetcher(context.url, {
      method: "POST",
      headers,
      body,
      signal: timeout.signal,
    });
    return {
      status: response.status,
      text: await response.text(),
      sessionId: response.headers.get("mcp-session-id") ?? undefined,
    };
  } catch (error) {
    if (timeout.didTimeout()) {
      throw new ProviderRequestError(504, "Figma Dev Mode MCP request timed out");
    }
    if (isAbortSignalError(context.signal, error)) {
      throw error;
    }
    throw new ProviderRequestError(
      502,
      error instanceof Error
        ? `Figma Dev Mode MCP request failed: ${error.message}. Is the Figma desktop app running with Dev Mode MCP server enabled at ${context.url}?`
        : "Figma Dev Mode MCP request failed",
    );
  } finally {
    timeout.cleanup();
  }
}

function isStaleSessionResponse(response: FigmaDesktopResponse): boolean {
  if (response.status === 404) {
    return true;
  }
  return (response.status === 400 || response.status === 401) && /session/i.test(response.text);
}

/** Figma only uses these fields for telemetry, but rejects nothing when they are absent. */
function withClientContext(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  if (toolName === "get_screenshot" || toolName === "get_figjam") {
    return input;
  }
  return {
    clientLanguages: unknownClientContext,
    clientFrameworks: unknownClientContext,
    ...input,
  };
}

async function readToolResult(
  context: FigmaDesktopActionContext,
  toolName: string,
  result: McpToolResult,
): Promise<unknown> {
  const content = result.content ?? [];
  const hasImage = content.some((item) => item.type === "image");
  if (result.structuredContent !== undefined && !hasImage) {
    return result.structuredContent;
  }
  if (content.length === 0) {
    return result.structuredContent ?? result;
  }

  const items = await Promise.all(content.map((item) => readContentItem(context, toolName, item)));
  return items.length === 1 ? items[0] : items;
}

async function readContentItem(
  context: FigmaDesktopActionContext,
  toolName: string,
  item: McpContent,
): Promise<unknown> {
  if (item.type === "text" && typeof item.text === "string") {
    return parseTextContent(item.text);
  }
  if (item.type === "image") {
    return readImageContent(context, toolName, item);
  }
  return item;
}

/**
 * Screenshots arrive as base64 image content. Store them as transit files so tool
 * output stays small and callers get a downloadable URL instead of a huge blob.
 */
async function readImageContent(
  context: FigmaDesktopActionContext,
  toolName: string,
  item: Record<string, unknown>,
): Promise<unknown> {
  const mimeType = optionalString(item.mimeType) ?? "image/png";
  const data = optionalString(item.data);
  if (!data) {
    return item;
  }
  if (!context.transitFiles) {
    return {
      type: "image",
      mimeType,
      message: "Figma returned an image but this deployment has no transit file storage to serve it.",
    };
  }

  const bytes = base64Bytes(data, "image data", (message) => new ProviderRequestError(502, message));
  const extension = mimeType === "image/jpeg" ? "jpg" : "png";
  const fileName = `figma-${toolName}-${Date.now()}.${extension}`;
  const stored = await context.transitFiles.create(new File([bytes], fileName, { type: mimeType }));
  return {
    type: "image",
    mimeType,
    fileId: stored.fileId,
    downloadUrl: stored.downloadUrl,
    sizeBytes: stored.sizeBytes,
    name: stored.name,
  };
}

function parseMcpMessage(text: string): McpJsonRpcResponse {
  const payload = readJsonPayload(text);
  const record = optionalRecord(payload);
  if (!record) {
    throw new ProviderRequestError(502, `Figma Dev Mode MCP returned an unexpected response: ${snippet(text)}`);
  }
  return record as McpJsonRpcResponse;
}

/** Streamable HTTP replies are Server-Sent Events; plain JSON stays supported. */
function readJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ProviderRequestError(502, "Figma Dev Mode MCP returned an empty response");
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJson(trimmed, text);
  }

  const dataLines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line.length > 0);
  if (dataLines.length === 0) {
    throw new ProviderRequestError(502, `Figma Dev Mode MCP returned a non-JSON response: ${snippet(text)}`);
  }
  return parseJson(dataLines.join(""), text);
}

function parseJson(candidate: string, original: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    throw new ProviderRequestError(502, `Figma Dev Mode MCP returned invalid JSON: ${snippet(original)}`);
  }
}

function parseTextContent(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return text;
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
  return snippet(text || "unknown Figma Dev Mode MCP tool error");
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

type McpContent = Record<string, unknown> & { type?: string; text?: unknown };
