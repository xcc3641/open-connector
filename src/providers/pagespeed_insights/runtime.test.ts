import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRequestError } from "../provider-runtime.ts";
import {
  pagespeedInsightsActionHandlers,
  pagespeedInsightsApiBaseUrl,
  validatePagespeedInsightsCredential,
} from "./runtime.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pagespeed_insights runtime", () => {
  it("calls runPagespeed with key query auth and repeated category params", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        id: "https://example.com/",
        kind: "pagespeedonline#result",
        analysisUTCTimestamp: "2026-08-05T12:00:00.000Z",
        lighthouseResult: {
          requestedUrl: "https://example.com/",
          finalUrl: "https://example.com/",
          lighthouseVersion: "12.0.0",
          fetchTime: "2026-08-05T12:00:00.000Z",
          categories: {
            performance: { id: "performance", title: "Performance", score: 0.91 },
          },
        },
        loadingExperience: {
          id: "https://example.com/",
          overall_category: "FAST",
        },
      }),
    );

    const result = await pagespeedInsightsActionHandlers.runPagespeed(
      {
        url: "https://example.com/",
        strategy: "MOBILE",
        category: ["PERFORMANCE", "SEO"],
        locale: "en_US",
        fields: "id,analysisUTCTimestamp,lighthouseResult",
      },
      {
        apiKey: "test-key",
        fetcher,
        signal: undefined,
      },
    );

    expect(fetcher).toHaveBeenCalledOnce();
    const call = fetcher.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    const requested = new URL(String(call[0]));
    expect(requested.origin + requested.pathname).toBe(
      `${pagespeedInsightsApiBaseUrl}/pagespeedonline/v5/runPagespeed`,
    );
    expect(requested.searchParams.get("key")).toBe("test-key");
    expect(requested.searchParams.get("url")).toBe("https://example.com/");
    expect(requested.searchParams.get("strategy")).toBe("MOBILE");
    expect(requested.searchParams.get("locale")).toBe("en_US");
    expect(requested.searchParams.get("fields")).toBe("id,analysisUTCTimestamp,lighthouseResult");
    expect(requested.searchParams.getAll("category")).toEqual(["PERFORMANCE", "SEO"]);
    expect(call[1]?.method).toBe("GET");
    expect(result).toMatchObject({
      id: "https://example.com/",
      kind: "pagespeedonline#result",
      analysisUTCTimestamp: "2026-08-05T12:00:00.000Z",
      categories: {
        performance: { id: "performance", title: "Performance", score: 0.91 },
      },
      loadingExperience: {
        id: "https://example.com/",
        overall_category: "FAST",
      },
    });
  });

  it("requires url", async () => {
    const fetcher = vi.fn();
    await expect(
      pagespeedInsightsActionHandlers.runPagespeed(
        {},
        {
          apiKey: "test-key",
          fetcher,
          signal: undefined,
        },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "url is required.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps invalid API key errors during validation to 400", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 400,
            message: "API key not valid. Please pass a valid API key.",
            status: "INVALID_ARGUMENT",
          },
        },
        400,
      ),
    );

    await expect(validatePagespeedInsightsCredential("bad-key", fetcher)).rejects.toMatchObject({
      status: 400,
      message: "API key not valid. Please pass a valid API key.",
    });
    await expect(validatePagespeedInsightsCredential("bad-key", fetcher)).rejects.toBeInstanceOf(ProviderRequestError);
  });

  it("maps invalid API key errors during execute to 401", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 400,
            message: "API key not valid. Please pass a valid API key.",
            status: "INVALID_ARGUMENT",
          },
        },
        400,
      ),
    );

    await expect(
      pagespeedInsightsActionHandlers.runPagespeed(
        { url: "https://example.com/" },
        {
          apiKey: "bad-key",
          fetcher,
          signal: undefined,
        },
      ),
    ).rejects.toMatchObject({
      status: 401,
      message: "API key not valid. Please pass a valid API key.",
    });
  });

  it("validates credentials with a compact fields projection", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        id: "https://example.com/",
        analysisUTCTimestamp: "2026-08-05T12:00:00.000Z",
      }),
    );

    const result = await validatePagespeedInsightsCredential("good-key", fetcher);
    const call = fetcher.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    const requested = new URL(String(call[0]));

    expect(requested.searchParams.get("key")).toBe("good-key");
    expect(requested.searchParams.get("url")).toBe("https://example.com/");
    expect(requested.searchParams.get("strategy")).toBe("DESKTOP");
    expect(requested.searchParams.get("category")).toBe("PERFORMANCE");
    expect(requested.searchParams.get("fields")).toBe("id,analysisUTCTimestamp");
    expect(result).toEqual({
      profile: {
        accountId: "api_key",
        displayName: "PageSpeed Insights API Key",
      },
      grantedScopes: [],
      metadata: {
        validationEndpoint: "/pagespeedonline/v5/runPagespeed",
        apiBaseUrl: pagespeedInsightsApiBaseUrl,
      },
    });
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(payload == null ? "" : JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
