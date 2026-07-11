import type { UmamiActionContext } from "./runtime.ts";

import { describe, expect, it } from "vitest";
import { umamiActionHandlers, validateUmamiCredential } from "./runtime.ts";

const selfHostedValues = {
  baseUrl: "https://umi.kachika.app",
  username: "admin",
  password: "secret-password",
};

describe("Umami provider runtime", () => {
  it("logs in with self-hosted credentials and uses the returned bearer token", async () => {
    const requests: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];
    const context = selfHostedContext(async (url, init) => {
      requests.push({
        url: String(url),
        method: init?.method ?? "GET",
        headers: lowerHeaders(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (requests.length === 1) {
        return jsonResponse({ token: "session-token" });
      }
      return jsonResponse({ data: [{ id: "site-1", name: "KaChiKa" }], count: 1, page: 1, pageSize: 10 });
    });

    const output = await umamiActionHandlers.list_websites({ pageSize: 10 }, context);

    expect(output).toMatchObject({ websites: [{ id: "site-1", name: "KaChiKa" }] });
    expect(requests).toEqual([
      {
        url: "https://umi.kachika.app/api/auth/login",
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: { username: "admin", password: "secret-password" },
      },
      {
        url: "https://umi.kachika.app/api/websites?pageSize=10",
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer session-token" }),
        body: undefined,
      },
    ]);
  });

  it("calls self-hosted expanded metrics with path dimensions", async () => {
    const urls: string[] = [];
    const context = selfHostedContext(async (url, init) => {
      urls.push(String(url));
      if (String(url).endsWith("/api/auth/login")) {
        return jsonResponse({ token: "session-token" });
      }
      expect(lowerHeaders(init?.headers)).toMatchObject({ authorization: "Bearer session-token" });
      return jsonResponse([{ name: "/en/", pageviews: "35", visitors: 34, visits: 35, bounces: 35, totaltime: "0" }]);
    });

    const output = await umamiActionHandlers.get_expanded_metrics(
      {
        websiteId: "f65b3e8e-c95f-4be5-a56d-79d613345dd6",
        startAt: 1782864000000,
        endAt: 1783470000000,
        type: "path",
        limit: 3,
      },
      context,
    );

    expect(output).toEqual({
      metrics: [{ name: "/en/", pageviews: "35", visitors: 34, visits: 35, bounces: 35, totaltime: "0" }],
      raw: [{ name: "/en/", pageviews: "35", visitors: 34, visits: 35, bounces: 35, totaltime: "0" }],
    });
    expect(urls[1]).toBe(
      "https://umi.kachika.app/api/websites/f65b3e8e-c95f-4be5-a56d-79d613345dd6/metrics/expanded?startAt=1782864000000&endAt=1783470000000&type=path&limit=3",
    );
  });

  it("keeps cloud API key behavior on api.umami.is", async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    const context: UmamiActionContext = {
      apiKey: "cloud-api-key",
      values: { apiKey: "cloud-api-key" },
      fetcher: async (url, init) => {
        requests.push({ url: String(url), headers: lowerHeaders(init?.headers) });
        return jsonResponse({ id: "user-1", username: "cloud-user" });
      },
    };

    const output = await umamiActionHandlers.get_current_user({}, context);

    expect(output).toEqual({
      user: { id: "user-1", username: "cloud-user" },
      raw: { id: "user-1", username: "cloud-user" },
    });
    expect(requests).toEqual([
      {
        url: "https://api.umami.is/api/me",
        headers: expect.objectContaining({ authorization: "Bearer cloud-api-key" }),
      },
    ]);
  });

  it("validates self-hosted credentials through login and records the base URL", async () => {
    const result = await validateUmamiCredential({ apiKey: "unused", values: selfHostedValues }, async (url, init) => {
      expect(String(url)).toBe("https://umi.kachika.app/api/auth/login");
      expect(JSON.parse(String(init?.body))).toEqual({ username: "admin", password: "secret-password" });
      return jsonResponse({ token: "session-token" });
    });

    expect(result).toMatchObject({
      profile: {
        accountId: "https://umi.kachika.app:admin",
        displayName: "admin @ umi.kachika.app",
      },
      metadata: {
        apiBaseUrl: "https://umi.kachika.app",
        authMode: "self_hosted_login",
        username: "admin",
      },
    });
  });

  it("maps self-hosted login failures to credential errors", async () => {
    await expect(
      validateUmamiCredential({ apiKey: "unused", values: selfHostedValues }, async () =>
        jsonResponse({ message: "Invalid login" }, { status: 401 }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Invalid login",
    });
  });

  it.each([
    ["http://127.0.0.1:3000", "baseUrl must not target private or reserved IP addresses"],
    ["https://user:password@umi.example.com", "baseUrl must not include credentials"],
  ])("rejects unsafe self-hosted base URL %s", async (baseUrl, message) => {
    let requested = false;

    await expect(
      validateUmamiCredential(
        {
          values: {
            ...selfHostedValues,
            baseUrl,
          },
        },
        async () => {
          requested = true;
          return jsonResponse({ token: "unexpected" });
        },
      ),
    ).rejects.toMatchObject({ status: 400, message });

    expect(requested).toBe(false);
  });
});

function selfHostedContext(fetcher: typeof fetch): UmamiActionContext {
  return {
    apiKey: "unused",
    values: {
      apiKey: "unused",
      ...selfHostedValues,
    },
    fetcher,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function lowerHeaders(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}
