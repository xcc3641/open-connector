import { describe, expect, it } from "vitest";
import { revenuecatActionHandlers, revenuecatRequestJson } from "./executors.ts";

describe("RevenueCat provider REST executor", () => {
  it("sends bearer auth and parses paginated list responses", async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; method?: string }> = [];

    const output = await revenuecatRequestJson(
      {
        apiKey: "sk_test_123",
        fetcher: async (url, init) => {
          requests.push({ url: String(url), headers: lowerHeaders(init?.headers), method: init?.method });
          return new Response(
            JSON.stringify({
              items: [{ id: "proj_123", name: "Demo" }],
              next_page: "/v2/projects?starting_after=proj_123",
              url: "/v2/projects",
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
      },
      { method: "GET", path: "/projects", query: { limit: 10, starting_after: "proj_001" } },
    );

    expect(output).toEqual({
      items: [{ id: "proj_123", name: "Demo" }],
      next_page: "/v2/projects?starting_after=proj_123",
      url: "/v2/projects",
    });
    expect(requests).toEqual([
      {
        url: "https://api.revenuecat.com/v2/projects?limit=10&starting_after=proj_001",
        method: "GET",
        headers: expect.objectContaining({
          accept: "application/json",
          authorization: "Bearer sk_test_123",
        }),
      },
    ]);
  });

  it("serializes POST request bodies with JSON content-type", async () => {
    const requests: Array<{ headers: Record<string, string>; body: unknown }> = [];

    await revenuecatRequestJson(
      {
        apiKey: "sk_test_123",
        fetcher: async (_url, init) => {
          requests.push({ headers: lowerHeaders(init?.headers), body: JSON.parse(String(init?.body)) });
          return new Response(JSON.stringify({ id: "ent_123" }), { headers: { "content-type": "application/json" } });
        },
      },
      {
        method: "POST",
        path: "/projects/proj_123/entitlements/ent_123/actions/attach_products",
        body: { product_ids: ["prod_123"] },
      },
    );

    expect(requests).toEqual([
      {
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: { product_ids: ["prod_123"] },
      },
    ]);
  });

  it("maps RevenueCat API errors to provider request errors", async () => {
    await expect(
      revenuecatRequestJson(
        {
          apiKey: "sk_test_123",
          fetcher: async () =>
            new Response(JSON.stringify({ code: "parameter_error", message: "Invalid project_id" }), {
              status: 400,
              statusText: "Bad Request",
              headers: { "content-type": "application/json" },
            }),
        },
        { method: "GET", path: "/projects/bad/products" },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Invalid project_id",
    });
  });

  it("passes handler input through to the package product attachment endpoint", async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];

    const output = await revenuecatActionHandlers.attach_products_to_package(
      {
        projectId: "proj_123",
        packageId: "pkg_123",
        products: [{ productId: "prod_123", eligibilityCriteria: "all" }],
      },
      {
        apiKey: "sk_test_123",
        fetcher: async (url, init) => {
          calls.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)) });
          return new Response(JSON.stringify({ id: "pkg_123", attached: true }), {
            headers: { "content-type": "application/json" },
          });
        },
      },
    );

    expect(output).toEqual({ package: { id: "pkg_123", attached: true } });
    expect(calls).toEqual([
      {
        url: "https://api.revenuecat.com/v2/projects/proj_123/packages/pkg_123/actions/attach_products",
        method: "POST",
        body: { products: [{ product_id: "prod_123", eligibility_criteria: "all" }] },
      },
    ]);
  });
});

function lowerHeaders(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}
