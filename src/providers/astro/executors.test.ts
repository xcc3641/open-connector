import { describe, expect, it } from "vitest";
import { ProviderRequestError } from "../provider-runtime.ts";
import { astroActionHandlers, callAstroMcpTool } from "./executors.ts";

describe("Astro provider MCP bridge", () => {
  it("calls an Astro MCP tool and parses JSON text content", async () => {
    const requests: unknown[] = [];
    const output = await callAstroMcpTool(
      {
        url: "http://astro.local/mcp",
        fetcher: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)));
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                content: [{ type: "text", text: '[{"name":"KaChiKa"}]' }],
                isError: false,
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
      },
      "list_apps",
      {},
    );

    expect(requests).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_apps", arguments: {} },
      },
    ]);
    expect(output).toEqual([{ name: "KaChiKa" }]);
  });

  it("maps Astro MCP tool errors to provider request errors", async () => {
    await expect(
      callAstroMcpTool(
        {
          url: "http://astro.local/mcp",
          fetcher: async () =>
            new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: {
                  content: [{ type: "text", text: "keyword not found" }],
                  isError: true,
                },
              }),
            ),
        },
        "search_rankings",
        { keyword: "missing", store: "us" },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "astro search_rankings failed: keyword not found",
    });
  });

  it("passes search_app_store input through the provider handler", async () => {
    const output = await astroActionHandlers.search_app_store(
      { keyword: "flashcards", store: "us", limit: 5 },
      {
        url: "http://astro.local/mcp",
        fetcher: async (_url, init) => {
          const request = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                content: [{ type: "text", text: JSON.stringify({ received: request.params }) }],
                isError: false,
              },
            }),
          );
        },
      },
    );

    expect(output).toEqual({
      received: {
        name: "search_app_store",
        arguments: { keyword: "flashcards", store: "us", limit: 5 },
      },
    });
  });
});
