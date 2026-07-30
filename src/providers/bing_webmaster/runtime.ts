import type { CredentialValidationResult } from "../../core/types.ts";
import type { ApiKeyProviderContext, ProviderFetch, ProviderRuntimeHandler } from "../provider-runtime.ts";
import type { BingWebmasterActionName } from "./actions.ts";

import {
  compactObject,
  optionalBoolean,
  optionalInteger,
  optionalNumber,
  optionalRecord,
  optionalString,
  requiredString,
} from "../../core/cast.ts";
import { providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";

export const bingWebmasterApiBaseUrl = "https://ssl.bing.com/webmaster/api.svc/json";

type BingWebmasterPhase = "validate" | "execute";
type QueryValue = string | number | boolean | undefined;
type BingWebmasterActionHandler = ProviderRuntimeHandler<ApiKeyProviderContext>;

interface BingWebmasterRequestOptions {
  method: string;
  httpMethod?: "GET" | "POST";
  query?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
  phase?: BingWebmasterPhase;
}

export const bingWebmasterActionHandlers: Record<BingWebmasterActionName, BingWebmasterActionHandler> = {
  async list_sites(_input, context) {
    const payload = await bingWebmasterRequest({ method: "GetUserSites" }, context);
    return { sites: normalizeSites(unwrapData(payload)) };
  },

  async add_site(input, context) {
    await bingWebmasterRequest(
      {
        method: "AddSite",
        httpMethod: "POST",
        body: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { success: true as const };
  },

  async verify_site(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "VerifySite",
        httpMethod: "POST",
        body: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { verified: Boolean(unwrapData(payload) ?? true) };
  },

  async remove_site(input, context) {
    await bingWebmasterRequest(
      {
        method: "RemoveSite",
        httpMethod: "POST",
        body: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { success: true as const };
  },

  async get_site_roles(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetSiteRoles",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { roles: normalizeObjectArray(unwrapData(payload), "Bing Webmaster site role") };
  },

  async submit_url(input, context) {
    await bingWebmasterRequest(
      {
        method: "SubmitUrl",
        httpMethod: "POST",
        body: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
          url: readRequiredString(input.url, "url"),
        },
      },
      context,
    );
    return { success: true as const };
  },

  async submit_url_batch(input, context) {
    await bingWebmasterRequest(
      {
        method: "SubmitUrlBatch",
        httpMethod: "POST",
        body: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
          urlList: readRequiredStringArray(input.urlList, "urlList"),
        },
      },
      context,
    );
    return { success: true as const };
  },

  async get_url_submission_quota(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetUrlSubmissionQuota",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { quota: normalizeUrlQuota(unwrapData(payload)) };
  },

  async list_sitemaps(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetFeeds",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { sitemaps: normalizeSitemaps(unwrapData(payload)) };
  },

  async submit_sitemap(input, context) {
    await bingWebmasterRequest(
      {
        method: "SubmitFeed",
        httpMethod: "POST",
        body: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
          feedUrl: readRequiredString(input.feedUrl, "feedUrl"),
        },
      },
      context,
    );
    return { success: true as const };
  },

  async remove_sitemap(input, context) {
    await bingWebmasterRequest(
      {
        method: "RemoveFeed",
        httpMethod: "POST",
        body: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
          feedUrl: readRequiredString(input.feedUrl, "feedUrl"),
        },
      },
      context,
    );
    return { success: true as const };
  },

  async get_sitemap_details(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetFeedDetails",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
          feedUrl: readRequiredString(input.feedUrl, "feedUrl"),
        },
      },
      context,
    );
    return { sitemaps: normalizeSitemaps(unwrapData(payload)) };
  },

  async get_rank_and_traffic_stats(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetRankAndTrafficStats",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { stats: normalizeRankTrafficStats(unwrapData(payload)) };
  },

  async get_query_stats(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetQueryStats",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { stats: normalizeQueryStats(unwrapData(payload)) };
  },

  async get_page_stats(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetPageStats",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { stats: normalizeQueryStats(unwrapData(payload)) };
  },

  async get_page_query_stats(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetPageQueryStats",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
          page: readRequiredString(input.page, "page"),
        },
      },
      context,
    );
    return { stats: normalizeQueryStats(unwrapData(payload)) };
  },

  async get_crawl_stats(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetCrawlStats",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { stats: normalizeCrawlStats(unwrapData(payload)) };
  },

  async get_crawl_issues(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetCrawlIssues",
        query: {
          siteUrl: readRequiredString(input.siteUrl, "siteUrl"),
        },
      },
      context,
    );
    return { issues: normalizeCrawlIssues(unwrapData(payload)) };
  },

  async get_keyword(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetKeyword",
        query: {
          q: readRequiredString(input.q, "q"),
          country: readRequiredString(input.country, "country"),
          language: readRequiredString(input.language, "language"),
          startDate: readRequiredString(input.startDate, "startDate"),
          endDate: readRequiredString(input.endDate, "endDate"),
        },
      },
      context,
    );
    return { keywords: normalizeKeywords(unwrapData(payload)) };
  },

  async get_related_keywords(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetRelatedKeywords",
        query: {
          q: readRequiredString(input.q, "q"),
          country: readRequiredString(input.country, "country"),
          language: readRequiredString(input.language, "language"),
          startDate: readRequiredString(input.startDate, "startDate"),
          endDate: readRequiredString(input.endDate, "endDate"),
        },
      },
      context,
    );
    return { keywords: normalizeKeywords(unwrapData(payload)) };
  },

  async get_keyword_stats(input, context) {
    const payload = await bingWebmasterRequest(
      {
        method: "GetKeywordStats",
        query: {
          q: readRequiredString(input.q, "q"),
          country: readRequiredString(input.country, "country"),
          language: readRequiredString(input.language, "language"),
        },
      },
      context,
    );
    return { keywords: normalizeKeywords(unwrapData(payload)) };
  },
};

export async function validateBingWebmasterCredential(
  apiKey: string,
  fetcher: ProviderFetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  const payload = await bingWebmasterRequest(
    {
      method: "GetUserSites",
      phase: "validate",
    },
    { apiKey, fetcher, signal },
  );
  const sites = normalizeSites(unwrapData(payload));

  return {
    profile: {
      accountId: "bing_webmaster",
      displayName: "Bing Webmaster API Key",
    },
    grantedScopes: [],
    metadata: compactObject({
      apiBaseUrl: bingWebmasterApiBaseUrl,
      validationEndpoint: "GetUserSites",
      siteCount: sites.length,
    }),
  };
}

async function bingWebmasterRequest(
  options: BingWebmasterRequestOptions,
  context: Pick<ApiKeyProviderContext, "apiKey" | "fetcher" | "signal">,
): Promise<unknown> {
  const phase = options.phase ?? "execute";
  const httpMethod = options.httpMethod ?? (options.body === undefined ? "GET" : "POST");
  const url = buildBingWebmasterUrl(options.method, context.apiKey, options.query);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": providerUserAgent,
  };
  const init: RequestInit = {
    method: httpMethod,
    headers,
    signal: context.signal,
  };

  if (options.body !== undefined) {
    headers["content-type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  let payload: unknown;

  try {
    response = await context.fetcher(url, init);
    payload = await readJsonPayload(response);
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      throw error;
    }
    throw new ProviderRequestError(
      502,
      error instanceof Error ? `Bing Webmaster request failed: ${error.message}` : "Bing Webmaster request failed",
    );
  }

  const errorCode = extractBingErrorCode(payload);
  if (!response.ok || errorCode !== undefined) {
    throw createBingWebmasterError(response.status, payload, phase, errorCode);
  }

  return payload;
}

function buildBingWebmasterUrl(method: string, apiKey: string, query: Record<string, QueryValue> | undefined): string {
  const url = new URL(`${bingWebmasterApiBaseUrl}/${method}`);
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function unwrapData(payload: unknown): unknown {
  const record = optionalRecord(payload);
  if (!record) {
    return payload;
  }
  return Object.prototype.hasOwnProperty.call(record, "d") ? record.d : payload;
}

function normalizeSites(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const record = asObject(item, "Bing Webmaster site");
    return compactObject({
      url: optionalString(record.Url) ?? optionalString(record.url) ?? "",
      isVerified: optionalBoolean(record.IsVerified) ?? optionalBoolean(record.isVerified) ?? false,
      authenticationCode: optionalString(record.AuthenticationCode) ?? optionalString(record.authenticationCode),
      dnsVerificationCode: optionalString(record.DnsVerificationCode) ?? optionalString(record.dnsVerificationCode),
      ...pickUnknownFields(record, [
        "Url",
        "url",
        "IsVerified",
        "isVerified",
        "AuthenticationCode",
        "authenticationCode",
        "DnsVerificationCode",
        "dnsVerificationCode",
        "__type",
      ]),
    });
  });
}

function normalizeUrlQuota(value: unknown): Record<string, unknown> {
  const record = asObject(value, "Bing Webmaster URL submission quota");
  return compactObject({
    dailyQuota: optionalInteger(record.DailyQuota) ?? optionalInteger(record.dailyQuota) ?? 0,
    monthlyQuota: optionalInteger(record.MonthlyQuota) ?? optionalInteger(record.monthlyQuota) ?? 0,
    ...pickUnknownFields(record, ["DailyQuota", "dailyQuota", "MonthlyQuota", "monthlyQuota", "__type"]),
  });
}

function normalizeSitemaps(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    if (value == null) {
      return [];
    }
    return [normalizeSitemap(value)];
  }
  return value.map((item) => normalizeSitemap(item));
}

function normalizeSitemap(value: unknown): Record<string, unknown> {
  const record = asObject(value, "Bing Webmaster sitemap");
  return compactObject({
    url: optionalString(record.Url) ?? optionalString(record.url),
    type: optionalString(record.Type) ?? optionalString(record.type),
    status: optionalString(record.Status) ?? optionalString(record.status),
    submitted: normalizeDotNetDate(record.Submitted ?? record.submitted),
    lastCrawled: normalizeDotNetDate(record.LastCrawled ?? record.lastCrawled),
    fileSize: optionalInteger(record.FileSize) ?? optionalInteger(record.fileSize),
    compressed: optionalBoolean(record.Compressed) ?? optionalBoolean(record.compressed),
    urlCount: optionalInteger(record.UrlCount) ?? optionalInteger(record.urlCount),
    ...pickUnknownFields(record, [
      "Url",
      "url",
      "Type",
      "type",
      "Status",
      "status",
      "Submitted",
      "submitted",
      "LastCrawled",
      "lastCrawled",
      "FileSize",
      "fileSize",
      "Compressed",
      "compressed",
      "UrlCount",
      "urlCount",
      "__type",
    ]),
  });
}

function normalizeRankTrafficStats(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const record = asObject(item, "Bing Webmaster traffic stat");
    return compactObject({
      date: normalizeDotNetDate(record.Date ?? record.date),
      clicks: optionalInteger(record.Clicks) ?? optionalInteger(record.clicks),
      impressions: optionalInteger(record.Impressions) ?? optionalInteger(record.impressions),
      ...pickUnknownFields(record, ["Date", "date", "Clicks", "clicks", "Impressions", "impressions", "__type"]),
    });
  });
}

function normalizeQueryStats(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const record = asObject(item, "Bing Webmaster query stat");
    return compactObject({
      query: optionalString(record.Query) ?? optionalString(record.query),
      page: optionalString(record.Page) ?? optionalString(record.page),
      date: normalizeDotNetDate(record.Date ?? record.date),
      clicks: optionalInteger(record.Clicks) ?? optionalInteger(record.clicks),
      impressions: optionalInteger(record.Impressions) ?? optionalInteger(record.impressions),
      avgClickPosition: optionalNumber(record.AvgClickPosition) ?? optionalNumber(record.avgClickPosition),
      avgImpressionPosition:
        optionalNumber(record.AvgImpressionPosition) ?? optionalNumber(record.avgImpressionPosition),
      ...pickUnknownFields(record, [
        "Query",
        "query",
        "Page",
        "page",
        "Date",
        "date",
        "Clicks",
        "clicks",
        "Impressions",
        "impressions",
        "AvgClickPosition",
        "avgClickPosition",
        "AvgImpressionPosition",
        "avgImpressionPosition",
        "__type",
      ]),
    });
  });
}

function normalizeCrawlStats(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const record = asObject(item, "Bing Webmaster crawl stat");
    return compactObject({
      date: normalizeDotNetDate(record.Date ?? record.date),
      crawledPages: optionalInteger(record.CrawledPages) ?? optionalInteger(record.crawledPages),
      code2xx: optionalInteger(record.Code2xx) ?? optionalInteger(record.code2xx),
      code301: optionalInteger(record.Code301) ?? optionalInteger(record.code301),
      code302: optionalInteger(record.Code302) ?? optionalInteger(record.code302),
      code4xx: optionalInteger(record.Code4xx) ?? optionalInteger(record.code4xx),
      code5xx: optionalInteger(record.Code5xx) ?? optionalInteger(record.code5xx),
      blockedByRobotsTxt: optionalInteger(record.BlockedByRobotsTxt) ?? optionalInteger(record.blockedByRobotsTxt),
      allOtherCodes: optionalInteger(record.AllOtherCodes) ?? optionalInteger(record.allOtherCodes),
      ...pickUnknownFields(record, [
        "Date",
        "date",
        "CrawledPages",
        "crawledPages",
        "Code2xx",
        "code2xx",
        "Code301",
        "code301",
        "Code302",
        "code302",
        "Code4xx",
        "code4xx",
        "Code5xx",
        "code5xx",
        "BlockedByRobotsTxt",
        "blockedByRobotsTxt",
        "AllOtherCodes",
        "allOtherCodes",
        "__type",
      ]),
    });
  });
}

function normalizeCrawlIssues(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const record = asObject(item, "Bing Webmaster crawl issue");
    return compactObject({
      url: optionalString(record.Url) ?? optionalString(record.url),
      httpCode: optionalInteger(record.HttpCode) ?? optionalInteger(record.httpCode),
      issueType: optionalString(record.IssueType) ?? optionalString(record.issueType),
      message: optionalString(record.Message) ?? optionalString(record.message),
      inLinks: optionalInteger(record.InLinks) ?? optionalInteger(record.inLinks),
      ...pickUnknownFields(record, [
        "Url",
        "url",
        "HttpCode",
        "httpCode",
        "IssueType",
        "issueType",
        "Message",
        "message",
        "InLinks",
        "inLinks",
        "__type",
      ]),
    });
  });
}

function normalizeKeywords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    if (value == null) {
      return [];
    }
    return [normalizeKeyword(value)];
  }
  return value.map((item) => normalizeKeyword(item));
}

function normalizeKeyword(value: unknown): Record<string, unknown> {
  const record = asObject(value, "Bing Webmaster keyword");
  return compactObject({
    query: optionalString(record.Query) ?? optionalString(record.query),
    impressions: optionalInteger(record.Impressions) ?? optionalInteger(record.impressions),
    broadImpressions: optionalInteger(record.BroadImpressions) ?? optionalInteger(record.broadImpressions),
    date: normalizeDotNetDate(record.Date ?? record.date),
    ...pickUnknownFields(record, [
      "Query",
      "query",
      "Impressions",
      "impressions",
      "BroadImpressions",
      "broadImpressions",
      "Date",
      "date",
      "__type",
    ]),
  });
}

function normalizeObjectArray(value: unknown, fieldName: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const record = asObject(item, fieldName);
    return compactObject({
      email: optionalString(record.Email) ?? optionalString(record.email),
      role: optionalString(record.Role) ?? optionalString(record.role),
      date: normalizeDotNetDate(record.Date ?? record.date),
      ...pickUnknownFields(record, ["Email", "email", "Role", "role", "Date", "date", "__type"]),
    });
  });
}

function normalizeDotNetDate(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    const match = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(value);
    if (match) {
      const date = new Date(Number(match[1]));
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return undefined;
}

function pickUnknownFields(record: Record<string, unknown>, knownKeys: string[]): Record<string, unknown> {
  const known = new Set(knownKeys);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!known.has(key) && value !== undefined) {
      extra[key] = value;
    }
  }
  return extra;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderRequestError(502, "Bing Webmaster returned invalid JSON");
  }
}

function createBingWebmasterError(
  status: number,
  payload: unknown,
  phase: BingWebmasterPhase,
  errorCode: number | undefined,
): ProviderRequestError {
  const message = extractBingErrorMessage(payload) ?? `Bing Webmaster request failed with ${status || 500}`;
  const authError = errorCode === 2 || errorCode === 3 || status === 401 || status === 403;

  if (status === 429) {
    return new ProviderRequestError(429, message, payload);
  }

  if (phase === "validate" && (authError || status === 400 || status === 404 || status === 422)) {
    return new ProviderRequestError(400, message, payload);
  }

  if (phase === "execute" && authError) {
    return new ProviderRequestError(401, message, payload);
  }

  if (status === 400 || status === 404 || status === 422 || (errorCode !== undefined && errorCode > 0)) {
    return new ProviderRequestError(400, message, payload);
  }

  return new ProviderRequestError(status >= 500 ? 502 : status || 502, message, payload);
}

function extractBingErrorCode(payload: unknown): number | undefined {
  const record = optionalRecord(payload);
  const code = record?.ErrorCode ?? record?.errorCode;
  if (typeof code === "number" && Number.isFinite(code)) {
    return code;
  }
  if (typeof code === "string" && code.trim() !== "" && Number.isFinite(Number(code))) {
    return Number(code);
  }
  return undefined;
}

function extractBingErrorMessage(payload: unknown): string | undefined {
  const record = optionalRecord(payload);
  return (
    optionalString(record?.Message) ??
    optionalString(record?.message) ??
    optionalString(record?.error_description) ??
    optionalString(record?.error)
  );
}

function readRequiredString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}

function readRequiredStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProviderRequestError(400, `${fieldName} must be a non-empty string array`);
  }

  return value.map((item, index) => readRequiredString(item, `${fieldName}[${index}]`));
}

function asObject(value: unknown, fieldName: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) {
    throw new ProviderRequestError(502, `${fieldName} must be an object`);
  }
  return record;
}
