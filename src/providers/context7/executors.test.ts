import { describe, expect, it } from "vitest";
import { ProviderRequestError } from "../provider-runtime.ts";
import { callContext7McpTool, context7ActionHandlers } from "./executors.ts";

describe("Context7 provider MCP bridge", () => {
  it("initializes a Context7 MCP session and calls the requested tool", async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];

    const output = await callContext7McpTool(
      {
        url: "https://context7.example/mcp",
        fetcher: async (url, init) => {
          requests.push({
            url: String(url),
            headers: lowerHeaders(init?.headers),
            body: JSON.parse(String(init?.body)),
          });
          if (requests.length === 1) {
            return new Response(sse({ result: { protocolVersion: "2024-11-05" }, jsonrpc: "2.0", id: 1 }), {
              headers: { "mcp-session-id": "session-1", "content-type": "text/event-stream" },
            });
          }
          return new Response(
            sse({
              result: {
                content: [
                  { type: "text", text: "Available Libraries:\n- Context7-compatible library ID: /reactjs/react.dev" },
                ],
              },
              jsonrpc: "2.0",
              id: 2,
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      },
      "resolve-library-id",
      { libraryName: "React", query: "React useEffect cleanup" },
    );

    expect(output).toEqual("Available Libraries:\n- Context7-compatible library ID: /reactjs/react.dev");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.body).toMatchObject({ method: "initialize" });
    expect(requests[1]).toMatchObject({
      url: "https://context7.example/mcp",
      headers: expect.objectContaining({ "mcp-session-id": "session-1" }),
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "resolve-library-id",
          arguments: { libraryName: "React", query: "React useEffect cleanup" },
        },
      },
    });
  });

  it("maps Context7 action handlers to hyphenated MCP tool names", async () => {
    const calls: unknown[] = [];
    const output = await context7ActionHandlers.query_docs(
      { libraryId: "/reactjs/react.dev", query: "useEffect cleanup" },
      {
        url: "https://context7.example/mcp",
        fetcher: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          calls.push(body);
          if (body.method === "initialize") {
            return new Response(sse({ result: {}, jsonrpc: "2.0", id: body.id }), {
              headers: { "mcp-session-id": "session-2" },
            });
          }
          return new Response(
            sse({
              result: { content: [{ type: "text", text: JSON.stringify({ received: body.params }) }] },
              jsonrpc: "2.0",
              id: body.id,
            }),
          );
        },
      },
    );

    expect(output).toEqual({
      received: {
        name: "query-docs",
        arguments: { libraryId: "/reactjs/react.dev", query: "useEffect cleanup" },
      },
    });
    expect(calls).toHaveLength(2);
  });

  it("requires the MCP session id returned by initialize", async () => {
    await expect(
      callContext7McpTool(
        {
          url: "https://context7.example/mcp",
          fetcher: async () => new Response(sse({ result: {}, jsonrpc: "2.0", id: 1 })),
        },
        "query-docs",
        { libraryId: "/reactjs/react.dev", query: "hooks" },
      ),
    ).rejects.toBeInstanceOf(ProviderRequestError);
  });
});

function sse(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function lowerHeaders(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}
