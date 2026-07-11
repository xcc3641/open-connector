import type { CredentialValidationResult } from "../../core/types.ts";

import { optionalInteger, optionalRecord, optionalString } from "../../core/cast.ts";
import { assertPublicHttpUrl } from "../../core/request.ts";
import { ProviderRequestError, providerUserAgent } from "../provider-runtime.ts";

export const umamiApiBaseUrl = "https://api.umami.is";
export const umamiValidationPath = "/api/auth/verify";

export interface UmamiActionContext {
  apiKey?: string;
  values: Record<string, string>;
  fetcher: typeof fetch;
  signal?: AbortSignal;
}

export interface UmamiCredentialInput {
  apiKey?: string;
  values: Record<string, string>;
}

type UmamiActionHandler = (input: Record<string, unknown>, context: UmamiActionContext) => Promise<unknown>;
type UmamiAuthMode = "api_key" | "self_hosted_login";

interface UmamiRequestOptions {
  path: string;
  context: UmamiActionContext;
  fetcher: typeof fetch;
  signal?: AbortSignal;
  mode: "validate" | "execute";
  method?: "GET" | "POST";
  query?: Record<string, string | undefined>;
}

interface ResolvedUmamiAuth {
  baseUrl: string;
  authMode: UmamiAuthMode;
  bearerToken: string;
  username?: string;
}

export const umamiActionHandlers: Record<string, UmamiActionHandler> = {
  async get_current_user(_input, context) {
    const user = normalizeCurrentUserPayload(
      await requestUmamiJson({
        path: "/api/me",
        context,
        fetcher: context.fetcher,
        signal: context.signal,
        mode: "execute",
      }),
    );
    return { user, raw: user };
  },
  async list_websites(input, context) {
    const payload = requireObject(
      await requestUmamiJson({
        path: "/api/websites",
        context,
        fetcher: context.fetcher,
        signal: context.signal,
        mode: "execute",
        query: {
          query: optionalString(input.query),
          page: optionalIntegerString(input.page),
          pageSize: optionalIntegerString(input.pageSize),
        },
      }),
      "Umami returned an invalid website list payload",
    );
    return {
      websites: objectArray(payload.data, "Umami returned an invalid website list data payload"),
      count: readNonNegativeInteger(payload.count, "count"),
      page: readPositiveInteger(payload.page, "page"),
      pageSize: readPositiveInteger(payload.pageSize, "pageSize"),
      raw: payload,
    };
  },
  async get_website(input, context) {
    const websiteId = requiredInputString(input.websiteId, "websiteId");
    const website = requireObject(
      await requestUmamiJson({
        path: `/api/websites/${encodeURIComponent(websiteId)}`,
        context,
        fetcher: context.fetcher,
        signal: context.signal,
        mode: "execute",
      }),
      "Umami returned an invalid website payload",
    );
    return { website, raw: website };
  },
  async get_website_stats(input, context) {
    const websiteId = requiredInputString(input.websiteId, "websiteId");
    const stats = requireObject(
      await requestUmamiJson({
        path: `/api/websites/${encodeURIComponent(websiteId)}/stats`,
        context,
        fetcher: context.fetcher,
        signal: context.signal,
        mode: "execute",
        query: buildDateRangeQuery(input),
      }),
      "Umami returned an invalid stats payload",
    );
    return { stats, raw: stats };
  },
  async get_pageviews(input, context) {
    const websiteId = requiredInputString(input.websiteId, "websiteId");
    const pageviews = requireObject(
      await requestUmamiJson({
        path: `/api/websites/${encodeURIComponent(websiteId)}/pageviews`,
        context,
        fetcher: context.fetcher,
        signal: context.signal,
        mode: "execute",
        query: {
          ...buildDateRangeQuery(input),
          unit: optionalString(input.unit),
        },
      }),
      "Umami returned an invalid pageviews payload",
    );
    return { pageviews, raw: pageviews };
  },
  async get_metrics(input, context) {
    const websiteId = requiredInputString(input.websiteId, "websiteId");
    const metrics = objectArray(
      await requestUmamiJson({
        path: `/api/websites/${encodeURIComponent(websiteId)}/metrics`,
        context,
        fetcher: context.fetcher,
        signal: context.signal,
        mode: "execute",
        query: {
          ...buildDateRangeQuery(input),
          type: requiredInputString(input.type, "type"),
          limit: optionalIntegerString(input.limit),
        },
      }),
      "Umami returned an invalid metrics payload",
    );
    return { metrics, raw: metrics };
  },
  async get_expanded_metrics(input, context) {
    const websiteId = requiredInputString(input.websiteId, "websiteId");
    const metrics = objectArray(
      await requestUmamiJson({
        path: `/api/websites/${encodeURIComponent(websiteId)}/metrics/expanded`,
        context,
        fetcher: context.fetcher,
        signal: context.signal,
        mode: "execute",
        query: {
          ...buildDateRangeQuery(input),
          type: requiredInputString(input.type, "type"),
          limit: optionalIntegerString(input.limit),
        },
      }),
      "Umami returned an invalid expanded metrics payload",
    );
    return { metrics, raw: metrics };
  },
  async get_realtime(input, context) {
    const websiteId = requiredInputString(input.websiteId, "websiteId");
    const realtime = requireObject(
      await requestUmamiJson({
        path: `/api/realtime/${encodeURIComponent(websiteId)}`,
        context,
        fetcher: context.fetcher,
        signal: context.signal,
        mode: "execute",
      }),
      "Umami returned an invalid realtime payload",
    );
    return { realtime, raw: realtime };
  },
  async list_events(input, context) {
    const websiteId = requiredInputString(input.websiteId, "websiteId");
    const payload = requireObject(
      await requestUmamiJson({
        path: `/api/websites/${encodeURIComponent(websiteId)}/events`,
        context,
        fetcher: context.fetcher,
        signal: context.signal,
        mode: "execute",
        query: {
          ...buildDateRangeQuery(input),
          query: optionalString(input.query),
          page: optionalIntegerString(input.page),
          pageSize: optionalIntegerString(input.pageSize),
        },
      }),
      "Umami returned an invalid event list payload",
    );
    return {
      events: objectArray(payload.data, "Umami returned an invalid event list data payload"),
      count: readNonNegativeInteger(payload.count, "count"),
      page: readPositiveInteger(payload.page, "page"),
      pageSize: readPositiveInteger(payload.pageSize, "pageSize"),
      raw: payload,
    };
  },
};

export async function validateUmamiCredential(
  credential: UmamiCredentialInput,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  const context = createUmamiActionContext(credential, fetcher, signal);
  const auth = await resolveUmamiAuth(context, "validate");

  if (auth.authMode === "self_hosted_login") {
    return {
      profile: {
        accountId: `${auth.baseUrl}:${auth.username}`,
        displayName: `${auth.username} @ ${new URL(auth.baseUrl).host}`,
      },
      grantedScopes: [],
      metadata: {
        apiBaseUrl: auth.baseUrl,
        authMode: auth.authMode,
        username: auth.username,
      },
    };
  }

  const user = normalizeCurrentUserPayload(
    await requestUmamiJson({
      path: umamiValidationPath,
      context,
      fetcher,
      signal,
      mode: "validate",
      method: "POST",
    }),
  );

  const userId = optionalString(user.id);
  const username = optionalString(user.username);
  return {
    profile: {
      accountId: userId ?? username ?? "umami:api-key",
      displayName: username ?? userId ?? "Umami API Key",
    },
    grantedScopes: [],
    metadata: {
      apiBaseUrl: auth.baseUrl,
      authMode: auth.authMode,
      validationEndpoint: umamiValidationPath,
      userId,
      username,
      role: optionalString(user.role),
    },
  };
}

export function createUmamiActionContext(
  credential: UmamiCredentialInput,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): UmamiActionContext {
  return {
    apiKey: credential.apiKey,
    values: credential.values,
    fetcher,
    signal,
  };
}

async function requestUmamiJson(options: UmamiRequestOptions): Promise<unknown> {
  const auth = await resolveUmamiAuth(options.context, options.mode);
  const url = new URL(`${auth.baseUrl}${options.path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  const response = await options.fetcher(url, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${auth.bearerToken}`,
      "user-agent": providerUserAgent,
    },
    signal: options.signal,
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw mapUmamiError(response.status, payload, options.mode);
  }

  return payload;
}

async function resolveUmamiAuth(context: UmamiActionContext, mode: "validate" | "execute"): Promise<ResolvedUmamiAuth> {
  const baseUrl = normalizeBaseUrl(context.values.baseUrl);
  const username = optionalString(context.values.username);
  const password = optionalString(context.values.password);

  if (username || password) {
    if (!username) {
      throw new ProviderRequestError(400, "username is required for self-hosted Umami login");
    }
    if (!password) {
      throw new ProviderRequestError(400, "password is required for self-hosted Umami login");
    }
    const bearerToken = await loginToSelfHostedUmami({
      baseUrl,
      username,
      password,
      fetcher: context.fetcher,
      signal: context.signal,
      mode,
    });
    return {
      baseUrl,
      authMode: "self_hosted_login",
      bearerToken,
      username,
    };
  }

  const apiKey = optionalString(context.apiKey ?? context.values.apiKey);
  if (!apiKey) {
    throw new ProviderRequestError(401, "Configure Umami API key or self-hosted login credentials first.");
  }

  return {
    baseUrl,
    authMode: "api_key",
    bearerToken: apiKey,
  };
}

async function loginToSelfHostedUmami(input: {
  baseUrl: string;
  username: string;
  password: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
  mode: "validate" | "execute";
}): Promise<string> {
  const response = await input.fetcher(new URL(`${input.baseUrl}/api/auth/login`), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": providerUserAgent,
    },
    body: JSON.stringify({ username: input.username, password: input.password }),
    signal: input.signal,
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw mapUmamiError(response.status, payload, input.mode);
  }

  const token = optionalString(optionalRecord(payload)?.token);
  if (!token) {
    throw new ProviderRequestError(502, "Umami login returned no token", payload);
  }
  return token;
}

function buildDateRangeQuery(input: Record<string, unknown>): Record<string, string | undefined> {
  return {
    startAt: integerString(input.startAt, "startAt"),
    endAt: integerString(input.endAt, "endAt"),
    timezone: optionalString(input.timezone),
    url: optionalString(input.url),
    referrer: optionalString(input.referrer),
    title: optionalString(input.title),
    host: optionalString(input.host),
    os: optionalString(input.os),
    browser: optionalString(input.browser),
    device: optionalString(input.device),
    country: optionalString(input.country),
    region: optionalString(input.region),
    city: optionalString(input.city),
  };
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      message: text,
    };
  }
}

function normalizeCurrentUserPayload(payload: unknown): Record<string, unknown> {
  const body = requireObject(payload, "Umami returned an invalid user payload");
  const nestedUser = optionalRecord(body.user);
  return nestedUser ?? body;
}

function normalizeBaseUrl(value: unknown): string {
  const raw = optionalString(value) ?? umamiApiBaseUrl;
  const url = assertPublicHttpUrl(raw, {
    fieldName: "baseUrl",
    createError: (message) => new ProviderRequestError(400, message),
  });
  if (url.username || url.password) {
    throw new ProviderRequestError(400, "baseUrl must not include credentials");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  if (url.pathname.endsWith("/api")) {
    url.pathname = url.pathname.slice(0, -"/api".length) || "/";
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function mapUmamiError(status: number, payload: unknown, mode: "validate" | "execute"): ProviderRequestError {
  const message = readErrorMessage(payload) ?? `Umami API request failed with status ${status}`;
  if (status === 401 || status === 403) {
    return new ProviderRequestError(mode === "validate" ? 400 : 401, message, payload);
  }
  if (status === 404) {
    return new ProviderRequestError(404, message, payload);
  }
  if (status === 429) {
    return new ProviderRequestError(429, message, payload);
  }
  if (status === 400 || status === 422) {
    return new ProviderRequestError(400, message, payload);
  }
  return new ProviderRequestError(502, message, payload);
}

function readErrorMessage(payload: unknown): string | undefined {
  const body = optionalRecord(payload);
  if (!body) {
    return undefined;
  }

  if (typeof body.error === "string" && body.error) {
    return body.error;
  }
  const errorObject = optionalRecord(body.error);
  const errorMessage = optionalString(errorObject?.message);
  if (errorMessage) {
    return errorMessage;
  }

  return optionalString(body.message);
}

function requireObject(value: unknown, errorMessage: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) {
    throw new ProviderRequestError(502, errorMessage, value);
  }
  return record;
}

function objectArray(value: unknown, errorMessage: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new ProviderRequestError(502, errorMessage, value);
  }
  return value.map((item) => requireObject(item, errorMessage));
}

function requiredInputString(value: unknown, fieldName: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new ProviderRequestError(400, `${fieldName} is required`);
  }
  return text;
}

function integerString(value: unknown, fieldName: string): string {
  const parsed = optionalInteger(value);
  if (parsed === undefined) {
    throw new ProviderRequestError(400, `${fieldName} must be an integer`);
  }
  return String(parsed);
}

function optionalIntegerString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = optionalInteger(value);
  if (parsed === undefined) {
    throw new ProviderRequestError(400, "optional integer input must be an integer");
  }
  return String(parsed);
}

function readPositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ProviderRequestError(502, `Umami returned an invalid ${fieldName} payload`, value);
  }
  return value;
}

function readNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ProviderRequestError(502, `Umami returned an invalid ${fieldName} payload`, value);
  }
  return value;
}
