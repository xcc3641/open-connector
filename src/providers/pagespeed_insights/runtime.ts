import type { CredentialValidationResult } from "../../core/types.ts";
import type { ApiKeyProviderContext } from "../provider-runtime.ts";
import type { PagespeedInsightsActionName } from "./actions.ts";

import { compactObject, optionalRecord, optionalString, requiredString } from "../../core/cast.ts";
import { assertPublicHttpUrl, readBoundedResponseBytes } from "../../core/request.ts";
import { providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";

export const pagespeedInsightsApiBaseUrl = "https://www.googleapis.com";

type PagespeedInsightsPhase = "validate" | "execute";
type PagespeedInsightsActionContext = Pick<ApiKeyProviderContext, "apiKey" | "fetcher" | "signal">;
type PagespeedInsightsActionHandler = (
  input: Record<string, unknown>,
  context: PagespeedInsightsActionContext,
) => Promise<unknown>;

const strategyValues = new Set(["STRATEGY_UNSPECIFIED", "DESKTOP", "MOBILE"]);
const categoryValues = new Set([
  "CATEGORY_UNSPECIFIED",
  "ACCESSIBILITY",
  "BEST_PRACTICES",
  "PERFORMANCE",
  "PWA",
  "SEO",
  "AGENTIC_BROWSING",
]);
const maxPagespeedResponseBytes = 20 * 1024 * 1024;

export const pagespeedInsightsActionHandlers: Record<PagespeedInsightsActionName, PagespeedInsightsActionHandler> = {
  runPagespeed(input, context) {
    return executeRunPagespeed(input, context);
  },
};

export async function validatePagespeedInsightsCredential(
  apiKey: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  await pagespeedInsightsGetJson(
    {
      url: "https://example.com/",
      strategy: "DESKTOP",
      category: ["PERFORMANCE"],
      fields: "id,analysisUTCTimestamp",
    },
    {
      apiKey,
      fetcher,
      signal,
    },
    "validate",
  );

  return {
    profile: {
      accountId: "api_key",
      displayName: "PageSpeed Insights API Key",
    },
    grantedScopes: [],
    metadata: {
      validationEndpoint: "/pagespeedonline/v5/runPagespeed",
      apiBaseUrl: pagespeedInsightsApiBaseUrl,
    },
  };
}

async function executeRunPagespeed(
  input: Record<string, unknown>,
  context: PagespeedInsightsActionContext,
): Promise<unknown> {
  const payload = optionalRecord(await pagespeedInsightsGetJson(readRunPagespeedQuery(input), context, "execute"));
  if (!payload) {
    throw new ProviderRequestError(502, "PageSpeed Insights returned a non-object payload");
  }

  const lighthouseResult = optionalRecord(payload.lighthouseResult);
  const categories = optionalRecord(lighthouseResult?.categories);

  return compactObject({
    id: optionalString(payload.id),
    kind: optionalString(payload.kind),
    analysisUTCTimestamp: optionalString(payload.analysisUTCTimestamp),
    captchaResult: optionalString(payload.captchaResult),
    version: optionalRecord(payload.version),
    loadingExperience: optionalRecord(payload.loadingExperience),
    originLoadingExperience: optionalRecord(payload.originLoadingExperience),
    lighthouseResult,
    categories,
  });
}

function readRunPagespeedQuery(input: Record<string, unknown>): {
  url: string;
  strategy?: string;
  category?: string[];
  locale?: string;
  captchaToken?: string;
  utmCampaign?: string;
  utmSource?: string;
  fields?: string;
} {
  const url = readRequiredString(input.url, "url");
  assertPublicHttpUrl(url, {
    fieldName: "url",
    createError: (message) => new ProviderRequestError(400, message),
  });

  return {
    url,
    strategy: readOptionalEnum(input.strategy, "strategy", strategyValues),
    category: readOptionalCategoryList(input.category),
    locale: optionalString(input.locale),
    captchaToken: optionalString(input.captchaToken),
    utmCampaign: optionalString(input.utmCampaign),
    utmSource: optionalString(input.utmSource),
    fields: optionalString(input.fields),
  };
}

async function pagespeedInsightsGetJson(
  query: {
    url: string;
    strategy?: string;
    category?: string[];
    locale?: string;
    captchaToken?: string;
    utmCampaign?: string;
    utmSource?: string;
    fields?: string;
  },
  context: PagespeedInsightsActionContext,
  phase: PagespeedInsightsPhase,
): Promise<unknown> {
  const url = new URL("/pagespeedonline/v5/runPagespeed", pagespeedInsightsApiBaseUrl);
  url.searchParams.set("key", context.apiKey);
  url.searchParams.set("url", query.url);

  if (query.strategy) {
    url.searchParams.set("strategy", query.strategy);
  }
  if (query.locale) {
    url.searchParams.set("locale", query.locale);
  }
  if (query.captchaToken) {
    url.searchParams.set("captchaToken", query.captchaToken);
  }
  if (query.utmCampaign) {
    url.searchParams.set("utm_campaign", query.utmCampaign);
  }
  if (query.utmSource) {
    url.searchParams.set("utm_source", query.utmSource);
  }
  if (query.fields) {
    url.searchParams.set("fields", query.fields);
  }
  for (const category of query.category ?? []) {
    url.searchParams.append("category", category);
  }

  let response: Response;
  try {
    response = await context.fetcher(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": providerUserAgent,
      },
      signal: context.signal,
    });
  } catch (error) {
    throw new ProviderRequestError(
      isAbortError(error) ? 504 : 502,
      error instanceof Error
        ? `PageSpeed Insights request failed: ${error.message}`
        : "PageSpeed Insights request failed",
    );
  }

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw createPagespeedInsightsError(response.status, payload, phase);
  }

  return payload;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const bytes = await readBoundedResponseBytes(response, {
    maxBytes: maxPagespeedResponseBytes,
    fieldName: "PageSpeed Insights response",
    createError: (message) => new ProviderRequestError(502, message),
  });
  if (bytes.byteLength === 0) {
    return null;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ProviderRequestError(502, "PageSpeed Insights returned invalid JSON");
  }
}

function createPagespeedInsightsError(
  status: number,
  payload: unknown,
  phase: PagespeedInsightsPhase,
): ProviderRequestError {
  const message = extractPagespeedInsightsMessage(payload) ?? `PageSpeed Insights request failed with ${status || 500}`;

  if (isInvalidApiKeyMessage(message)) {
    return new ProviderRequestError(phase === "validate" ? 400 : 401, message, payload);
  }

  if (status === 429) {
    return new ProviderRequestError(429, message, payload);
  }

  if (status === 400) {
    return new ProviderRequestError(400, message, payload);
  }

  if (status === 401 || status === 403) {
    return new ProviderRequestError(phase === "validate" ? 400 : status, message, payload);
  }

  return new ProviderRequestError(status || 500, message, payload);
}

function extractPagespeedInsightsMessage(payload: unknown): string | undefined {
  const record = optionalRecord(payload);
  const error = optionalRecord(record?.error);
  return optionalString(error?.message) ?? optionalString(record?.message);
}

function isInvalidApiKeyMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("api key not valid") ||
    normalized.includes("api key is invalid") ||
    normalized.includes("invalid api key") ||
    normalized.includes("api_key_invalid")
  );
}

function readRequiredString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}

function readOptionalEnum(value: unknown, fieldName: string, allowed: Set<string>): string | undefined {
  const parsed = optionalString(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (!allowed.has(parsed)) {
    throw new ProviderRequestError(400, `${fieldName} must be one of: ${[...allowed].join(", ")}`);
  }
  return parsed;
}

function readOptionalCategoryList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return [readOptionalEnum(value, "category", categoryValues)!];
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new ProviderRequestError(400, "category must be a non-empty array of category enums");
  }

  return value.map((entry, index) => {
    const parsed = readOptionalEnum(entry, `category[${index}]`, categoryValues);
    if (!parsed) {
      throw new ProviderRequestError(400, `category[${index}] is required`);
    }
    return parsed;
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
