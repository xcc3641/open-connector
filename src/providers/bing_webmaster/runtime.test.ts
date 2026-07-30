import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRequestError } from "../provider-runtime.ts";
import { bingWebmasterActionHandlers, validateBingWebmasterCredential } from "./runtime.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bing_webmaster runtime", () => {
  it("lists sites and normalizes PascalCase Bing payload fields", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        d: [
          {
            __type: "Site:#Microsoft.Bing.Webmaster.Api",
            Url: "https://example.com",
            IsVerified: true,
            AuthenticationCode: "meta-code",
            DnsVerificationCode: "dns-code",
          },
        ],
      }),
    );

    const result = await bingWebmasterActionHandlers.list_sites(
      {},
      {
        apiKey: "test-key",
        fetcher,
        signal: undefined,
      },
    );

    expect(fetcher).toHaveBeenCalledOnce();
    const call = fetcher.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    expect(String(call[0])).toContain("/json/GetUserSites?");
    expect(String(call[0])).toContain("apikey=test-key");
    expect(call[1]?.method).toBe("GET");
    expect(result).toEqual({
      sites: [
        {
          url: "https://example.com",
          isVerified: true,
          authenticationCode: "meta-code",
          dnsVerificationCode: "dns-code",
        },
      ],
    });
  });

  it("submits a URL with a JSON body", async () => {
    const fetcher = vi.fn(async () => jsonResponse(null, 200));

    const result = await bingWebmasterActionHandlers.submit_url(
      {
        siteUrl: "https://example.com",
        url: "https://example.com/post",
      },
      {
        apiKey: "test-key",
        fetcher,
        signal: undefined,
      },
    );

    expect(result).toEqual({ success: true });
    const call = fetcher.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    expect(String(call[0])).toContain("/json/SubmitUrl?");
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.body).toBe(
      JSON.stringify({
        siteUrl: "https://example.com",
        url: "https://example.com/post",
      }),
    );
  });

  it("normalizes quota and /Date(...)/ timestamps", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("GetUrlSubmissionQuota")) {
        return jsonResponse({
          d: {
            DailyQuota: 12,
            MonthlyQuota: 340,
          },
        });
      }
      if (href.includes("GetRankAndTrafficStats")) {
        return jsonResponse({
          d: [
            {
              Date: "/Date(1719792000000)/",
              Clicks: 3,
              Impressions: 40,
            },
          ],
        });
      }
      throw new Error(`unexpected url: ${href}`);
    });

    const quota = await bingWebmasterActionHandlers.get_url_submission_quota(
      { siteUrl: "https://example.com" },
      { apiKey: "test-key", fetcher, signal: undefined },
    );
    const stats = await bingWebmasterActionHandlers.get_rank_and_traffic_stats(
      { siteUrl: "https://example.com" },
      { apiKey: "test-key", fetcher, signal: undefined },
    );

    expect(quota).toEqual({
      quota: {
        dailyQuota: 12,
        monthlyQuota: 340,
      },
    });
    expect(stats).toEqual({
      stats: [
        {
          date: new Date(1719792000000).toISOString(),
          clicks: 3,
          impressions: 40,
        },
      ],
    });
  });

  it("maps invalid API key errors during validation to 400", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          ErrorCode: 3,
          Message: "InvalidApiKey",
        },
        400,
      ),
    );

    await expect(validateBingWebmasterCredential("bad-key", fetcher)).rejects.toMatchObject({
      status: 400,
      message: "InvalidApiKey",
    });
    await expect(validateBingWebmasterCredential("bad-key", fetcher)).rejects.toBeInstanceOf(ProviderRequestError);
  });

  it("maps invalid API key errors during execute to 401", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          ErrorCode: 3,
          Message: "InvalidApiKey",
        },
        400,
      ),
    );

    await expect(
      bingWebmasterActionHandlers.list_sites(
        {},
        {
          apiKey: "bad-key",
          fetcher,
          signal: undefined,
        },
      ),
    ).rejects.toMatchObject({
      status: 401,
      message: "InvalidApiKey",
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
