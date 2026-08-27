import type { TransitFileStore } from "../../core/types.ts";
import type { FigmaDesktopActionContext } from "./runtime.ts";

import { describe, expect, it } from "vitest";
import { callFigmaDesktopTool, shouldSkipFigmaDesktopDnsValidation } from "./runtime.ts";

const endpoint = "http://127.0.0.1:3845/mcp";

interface FigmaServerOptions {
  /** Tool result returned for the first successful tools/call. */
  toolResult: unknown;
  /** Number of leading tools/call requests answered with an expired-session error. */
  expiredSessionCalls?: number;
}

interface FigmaServer {
  fetcher: typeof fetch;
  initializeCount(): number;
  toolCallCount(): number;
  lastArguments(): Record<string, unknown> | undefined;
  lastSessionId(): string | undefined;
}

function createFigmaServer(options: FigmaServerOptions): FigmaServer {
  let initializeCount = 0;
  let toolCallCount = 0;
  let expiredRemaining = options.expiredSessionCalls ?? 0;
  let lastArguments: Record<string, unknown> | undefined;
  let lastSessionId: string | undefined;

  const fetcher: typeof fetch = async (url, init) => {
    expect(String(url)).toBe(endpoint);
    const request = JSON.parse(String(init?.body)) as {
      method: string;
      params?: { arguments?: Record<string, unknown> };
    };
    const headers = new Headers(init?.headers);
    lastSessionId = headers.get("mcp-session-id") ?? undefined;

    if (request.method === "initialize") {
      initializeCount += 1;
      return sseResponse(
        { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } },
        {
          "mcp-session-id": `session-${initializeCount}`,
        },
      );
    }
    if (request.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }

    expect(request.method).toBe("tools/call");
    if (expiredRemaining > 0) {
      expiredRemaining -= 1;
      return new Response(JSON.stringify({ error: { message: "Session not found" } }), { status: 404 });
    }
    toolCallCount += 1;
    lastArguments = request.params?.arguments;
    return sseResponse({ jsonrpc: "2.0", id: 1, result: options.toolResult });
  };

  return {
    fetcher,
    initializeCount: () => initializeCount,
    toolCallCount: () => toolCallCount,
    lastArguments: () => lastArguments,
    lastSessionId: () => lastSessionId,
  };
}

function sseResponse(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

function context(fetcher: typeof fetch, transitFiles?: TransitFileStore): FigmaDesktopActionContext {
  return { url: endpoint, fetcher, transitFiles };
}

describe("Figma Dev Mode MCP runtime", () => {
  it("performs the session handshake and parses SSE tool results", async () => {
    const server = createFigmaServer({
      toolResult: { content: [{ type: "text", text: '{"code":"<div />"}' }] },
    });

    const result = await callFigmaDesktopTool(context(server.fetcher), "get_design_context", { nodeId: "1:2" });

    expect(result).toEqual({ code: "<div />" });
    expect(server.initializeCount()).toBeGreaterThanOrEqual(1);
    expect(server.lastSessionId()).toMatch(/^session-\d+$/);
    expect(server.lastArguments()).toEqual({
      nodeId: "1:2",
      clientLanguages: "unknown",
      clientFrameworks: "unknown",
    });
  });

  it("reopens the session when Figma dropped it", async () => {
    const server = createFigmaServer({
      toolResult: { content: [{ type: "text", text: "plain metadata" }] },
      expiredSessionCalls: 1,
    });

    const result = await callFigmaDesktopTool(context(server.fetcher), "get_metadata", {});

    expect(result).toBe("plain metadata");
    expect(server.toolCallCount()).toBe(1);
    expect(server.initializeCount()).toBeGreaterThanOrEqual(1);
  });

  it("stores screenshot image content as a transit file", async () => {
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const server = createFigmaServer({
      toolResult: {
        content: [{ type: "image", mimeType: "image/png", data: Buffer.from(pngBytes).toString("base64") }],
      },
    });
    const created: File[] = [];
    const transitFiles: TransitFileStore = {
      maxBytes: 1024 * 1024,
      async create(file) {
        created.push(file);
        return {
          fileId: "file-1",
          downloadUrl: "http://127.0.0.1:13000/v1/files/file-1",
          sizeBytes: file.size,
          name: file.name,
          mimeType: file.type,
        };
      },
      read: () => Promise.reject(new Error("not used")),
      delete: () => Promise.resolve(false),
    };

    const result = await callFigmaDesktopTool(context(server.fetcher, transitFiles), "get_screenshot", {});

    expect(result).toMatchObject({
      type: "image",
      mimeType: "image/png",
      fileId: "file-1",
      downloadUrl: "http://127.0.0.1:13000/v1/files/file-1",
      sizeBytes: pngBytes.length,
    });
    expect(created).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(Buffer.from(pngBytes).toString("base64"));
    expect(server.lastArguments()).toEqual({});
  });

  it("maps tool errors to request errors", async () => {
    const server = createFigmaServer({
      toolResult: { isError: true, content: [{ type: "text", text: "Node not found" }] },
    });

    await expect(callFigmaDesktopTool(context(server.fetcher), "get_metadata", {})).rejects.toThrow(/Node not found/);
  });

  it("only skips DNS validation for the fixed docker host endpoint", () => {
    expect(shouldSkipFigmaDesktopDnsValidation("http://host.docker.internal:3845/mcp")).toBe(true);
    expect(shouldSkipFigmaDesktopDnsValidation("http://127.0.0.1:3845/mcp")).toBe(false);
    expect(shouldSkipFigmaDesktopDnsValidation("http://attacker.example.com/mcp")).toBe(false);
  });
});
