import { describe, expect, it, vi } from "vitest";
import { ProviderRequestError } from "../provider-runtime.ts";
import { mixpanelMcpEndpoint } from "./runtime.ts";

// Import after mocks would be needed for full MCP client tests; these cover pure helpers
// exposed via intentional failures on bad endpoints and argument guards in executors.

describe("mixpanel MCP endpoint guards", () => {
  it("exports the US hosted MCP endpoint", () => {
    expect(mixpanelMcpEndpoint).toBe("https://mcp.mixpanel.com/mcp");
  });

  it("rejects non-https MCP endpoints through listMixpanelMcpTools", async () => {
    const { listMixpanelMcpTools } = await import("./runtime.ts");
    await expect(
      listMixpanelMcpTools({
        accessToken: "token",
        fetcher: vi.fn() as unknown as typeof fetch,
        endpoint: "http://mcp.mixpanel.com/mcp",
      }),
    ).rejects.toBeInstanceOf(ProviderRequestError);
  });

  it("rejects non-mixpanel MCP hosts", async () => {
    const { listMixpanelMcpTools } = await import("./runtime.ts");
    await expect(
      listMixpanelMcpTools({
        accessToken: "token",
        fetcher: vi.fn() as unknown as typeof fetch,
        endpoint: "https://evil.example/mcp",
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });
});
