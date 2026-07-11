import type { CredentialValidationResult, CredentialValidators, ProviderExecutors } from "../../core/types.ts";
import type { ApiKeyProviderContext, ProviderFetch, ProviderRuntimeHandler } from "../provider-runtime.ts";
import type { RevenueCatActionName } from "./actions.ts";

import {
  compactObject,
  objectArray,
  optionalRecord,
  optionalString,
  requiredRecord,
  requiredString,
} from "../../core/cast.ts";
import { defineApiKeyProviderExecutors, providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";
import { revenuecatProviderScopes } from "./scopes.ts";

const service = "revenuecat";
const revenuecatApiBaseUrl = "https://api.revenuecat.com/v2";

type RevenueCatRequestPhase = "validate" | "execute";
type RevenueCatHttpMethod = "GET" | "POST";
type RevenueCatActionHandler = ProviderRuntimeHandler<ApiKeyProviderContext>;

interface RevenueCatRequestContext {
  apiKey: string;
  fetcher: ProviderFetch;
  signal?: AbortSignal;
}

interface RevenueCatRequestOptions {
  method: RevenueCatHttpMethod;
  path: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  phase?: RevenueCatRequestPhase;
}

interface RevenueCatPage {
  items: unknown[];
  nextPage: string | null;
  url: string | null;
  raw: Record<string, unknown>;
}

export const revenuecatActionHandlers: Record<RevenueCatActionName, RevenueCatActionHandler> = {
  list_projects(input, context) {
    return listProjects(input, context);
  },
  list_apps(input, context) {
    return listApps(input, context);
  },
  list_products(input, context) {
    return listProducts(input, context);
  },
  get_product(input, context) {
    return getProduct(input, context);
  },
  list_entitlements(input, context) {
    return listEntitlements(input, context);
  },
  get_entitlement(input, context) {
    return getEntitlement(input, context);
  },
  attach_products_to_entitlement(input, context) {
    return attachProductsToEntitlement(input, context);
  },
  detach_products_from_entitlement(input, context) {
    return detachProductsFromEntitlement(input, context);
  },
  list_offerings(input, context) {
    return listOfferings(input, context);
  },
  get_offering(input, context) {
    return getOffering(input, context);
  },
  list_packages(input, context) {
    return listPackages(input, context);
  },
  get_package(input, context) {
    return getPackage(input, context);
  },
  attach_products_to_package(input, context) {
    return attachProductsToPackage(input, context);
  },
  detach_products_from_package(input, context) {
    return detachProductsFromPackage(input, context);
  },
  list_customers(input, context) {
    return listCustomers(input, context);
  },
  get_customer(input, context) {
    return getCustomer(input, context);
  },
  list_customer_subscriptions(input, context) {
    return listCustomerSubscriptions(input, context);
  },
  get_subscription(input, context) {
    return getSubscription(input, context);
  },
};

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, revenuecatActionHandlers);

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }): Promise<CredentialValidationResult> {
    const raw = await revenuecatRequestJson(
      { apiKey: input.apiKey, fetcher, signal },
      { method: "GET", path: "/projects", query: { limit: 1 }, phase: "validate" },
    );
    const page = normalizePage(raw, "malformed revenuecat projects response");
    const firstProject = optionalRecord(page.items[0]);
    const accountId = optionalString(firstProject?.id) ?? "revenuecat";

    return {
      profile: {
        accountId,
        displayName: optionalString(firstProject?.name) ?? "RevenueCat API key",
      },
      grantedScopes: [...revenuecatProviderScopes],
      metadata: {
        apiBaseUrl: revenuecatApiBaseUrl,
        validationEndpoint: "/projects",
      },
    };
  },
};

async function listProjects(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return normalizePage(
    await revenuecatRequestJson(context, {
      method: "GET",
      path: "/projects",
      query: buildPaginationQuery(input),
    }),
    "malformed revenuecat projects response",
  );
}

async function listApps(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return listProjectPage(
    input,
    context,
    `/projects/${encodeURIComponent(readInputString(input.projectId, "projectId"))}/apps`,
    "malformed revenuecat apps response",
  );
}

async function listProducts(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return listProjectPage(
    input,
    context,
    `/projects/${encodeURIComponent(readInputString(input.projectId, "projectId"))}/products`,
    "malformed revenuecat products response",
    {
      app_id: optionalString(input.appId),
    },
  );
}

async function getProduct(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return wrapResource("product", await getProjectResource(input, context, "productId", "products"));
}

async function listEntitlements(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return listProjectPage(
    input,
    context,
    `/projects/${encodeURIComponent(readInputString(input.projectId, "projectId"))}/entitlements`,
    "malformed revenuecat entitlements response",
  );
}

async function getEntitlement(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return wrapResource("entitlement", await getProjectResource(input, context, "entitlementId", "entitlements"));
}

async function attachProductsToEntitlement(
  input: Record<string, unknown>,
  context: ApiKeyProviderContext,
): Promise<unknown> {
  const raw = await postProjectAction(input, context, "entitlementId", "entitlements", "attach_products", {
    product_ids: readStringArray(input.productIds, "productIds"),
  });
  return wrapResource("entitlement", raw);
}

async function detachProductsFromEntitlement(
  input: Record<string, unknown>,
  context: ApiKeyProviderContext,
): Promise<unknown> {
  const raw = await postProjectAction(input, context, "entitlementId", "entitlements", "detach_products", {
    product_ids: readStringArray(input.productIds, "productIds"),
  });
  return wrapResource("entitlement", raw);
}

async function listOfferings(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return listProjectPage(
    input,
    context,
    `/projects/${encodeURIComponent(readInputString(input.projectId, "projectId"))}/offerings`,
    "malformed revenuecat offerings response",
  );
}

async function getOffering(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return wrapResource("offering", await getProjectResource(input, context, "offeringId", "offerings"));
}

async function listPackages(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return listProjectPage(
    input,
    context,
    `/projects/${encodeURIComponent(readInputString(input.projectId, "projectId"))}/offerings/${encodeURIComponent(readInputString(input.offeringId, "offeringId"))}/packages`,
    "malformed revenuecat packages response",
  );
}

async function getPackage(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return wrapResource("package", await getProjectResource(input, context, "packageId", "packages"));
}

async function attachProductsToPackage(
  input: Record<string, unknown>,
  context: ApiKeyProviderContext,
): Promise<unknown> {
  const raw = await postProjectAction(input, context, "packageId", "packages", "attach_products", {
    products: readPackageProductAssociations(input.products),
  });
  return wrapResource("package", raw);
}

async function detachProductsFromPackage(
  input: Record<string, unknown>,
  context: ApiKeyProviderContext,
): Promise<unknown> {
  const raw = await postProjectAction(input, context, "packageId", "packages", "detach_products", {
    product_ids: readStringArray(input.productIds, "productIds"),
  });
  return wrapResource("package", raw);
}

async function listCustomers(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  return listProjectPage(
    input,
    context,
    `/projects/${encodeURIComponent(readInputString(input.projectId, "projectId"))}/customers`,
    "malformed revenuecat customers response",
    {
      search: optionalString(input.search),
    },
  );
}

async function getCustomer(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  const projectId = encodeURIComponent(readInputString(input.projectId, "projectId"));
  const customerId = encodeURIComponent(readInputString(input.customerId, "customerId"));
  return wrapResource(
    "customer",
    await revenuecatRequestJson(context, {
      method: "GET",
      path: `/projects/${projectId}/customers/${customerId}`,
      query: buildExpandQuery(input),
    }),
  );
}

async function listCustomerSubscriptions(
  input: Record<string, unknown>,
  context: ApiKeyProviderContext,
): Promise<unknown> {
  const projectId = encodeURIComponent(readInputString(input.projectId, "projectId"));
  const customerId = encodeURIComponent(readInputString(input.customerId, "customerId"));
  return normalizePage(
    await revenuecatRequestJson(context, {
      method: "GET",
      path: `/projects/${projectId}/customers/${customerId}/subscriptions`,
      query: { ...buildPaginationQuery(input), environment: optionalString(input.environment) },
    }),
    "malformed revenuecat subscriptions response",
  );
}

async function getSubscription(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  const projectId = encodeURIComponent(readInputString(input.projectId, "projectId"));
  const subscriptionId = encodeURIComponent(readInputString(input.subscriptionId, "subscriptionId"));
  return wrapResource(
    "subscription",
    await revenuecatRequestJson(context, {
      method: "GET",
      path: `/projects/${projectId}/subscriptions/${subscriptionId}`,
    }),
  );
}

async function listProjectPage(
  input: Record<string, unknown>,
  context: ApiKeyProviderContext,
  path: string,
  malformedMessage: string,
  extraQuery: Record<string, unknown> = {},
): Promise<unknown> {
  return normalizePage(
    await revenuecatRequestJson(context, {
      method: "GET",
      path,
      query: { ...buildPaginationQuery(input), ...buildExpandQuery(input), ...compactObject(extraQuery) },
    }),
    malformedMessage,
  );
}

async function getProjectResource(
  input: Record<string, unknown>,
  context: ApiKeyProviderContext,
  idFieldName: string,
  collectionPath: string,
): Promise<unknown> {
  const projectId = encodeURIComponent(readInputString(input.projectId, "projectId"));
  const resourceId = encodeURIComponent(readInputString(input[idFieldName], idFieldName));
  return revenuecatRequestJson(context, {
    method: "GET",
    path: `/projects/${projectId}/${collectionPath}/${resourceId}`,
    query: buildExpandQuery(input),
  });
}

async function postProjectAction(
  input: Record<string, unknown>,
  context: ApiKeyProviderContext,
  idFieldName: string,
  collectionPath: string,
  actionName: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const projectId = encodeURIComponent(readInputString(input.projectId, "projectId"));
  const resourceId = encodeURIComponent(readInputString(input[idFieldName], idFieldName));
  return revenuecatRequestJson(context, {
    method: "POST",
    path: `/projects/${projectId}/${collectionPath}/${resourceId}/actions/${actionName}`,
    body,
  });
}

export async function revenuecatRequestJson(
  context: RevenueCatRequestContext,
  options: RevenueCatRequestOptions,
): Promise<unknown> {
  const url = buildRevenueCatUrl(options.path);
  for (const [key, value] of Object.entries(compactObject(options.query ?? {}))) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await context.fetcher(url, {
      method: options.method,
      headers: createRevenueCatHeaders(context.apiKey, options.body != null),
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: context.signal,
    });
    const payload = await readRevenueCatPayload(response);
    if (!response.ok) {
      throw createRevenueCatError(response.status, response.statusText, payload, options.phase ?? "execute");
    }
    return payload;
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      throw error;
    }
    throw new ProviderRequestError(
      502,
      error instanceof Error ? `revenuecat request failed: ${error.message}` : "revenuecat request failed",
    );
  }
}

function createRevenueCatHeaders(apiKey: string, hasJsonBody: boolean): Headers {
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
    "user-agent": providerUserAgent,
  });
  if (hasJsonBody) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

function buildRevenueCatUrl(path: string): URL {
  return new URL(`/v2${path}`, "https://api.revenuecat.com");
}

async function readRevenueCatPayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function createRevenueCatError(
  status: number,
  statusText: string,
  payload: unknown,
  phase: RevenueCatRequestPhase,
): ProviderRequestError {
  const message = extractRevenueCatErrorMessage(payload) ?? statusText ?? "revenuecat request failed";
  if (status === 429) {
    return new ProviderRequestError(429, message, payload);
  }
  if (phase === "validate" && (status === 401 || status === 403)) {
    return new ProviderRequestError(400, message, payload);
  }
  if (phase === "execute" && (status === 401 || status === 403)) {
    return new ProviderRequestError(401, message, payload);
  }
  if ([400, 404, 422].includes(status)) {
    return new ProviderRequestError(400, message, payload);
  }
  return new ProviderRequestError(status >= 500 ? 502 : status || 502, message, payload);
}

function extractRevenueCatErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload.trim() || undefined;
  }
  const record = optionalRecord(payload);
  if (!record) {
    return undefined;
  }
  const error = optionalRecord(record.error);
  return optionalString(record.message) ?? optionalString(record.detail) ?? optionalString(error?.message);
}

function normalizePage(raw: unknown, malformedMessage: string): RevenueCatPage {
  const record = readProviderObject(raw, malformedMessage);
  if (!Array.isArray(record.items)) {
    throw new ProviderRequestError(502, malformedMessage, raw);
  }
  return {
    items: record.items,
    nextPage: record.next_page === null ? null : (optionalString(record.next_page) ?? null),
    url: record.url === null ? null : (optionalString(record.url) ?? null),
    raw: record,
  };
}

function wrapResource(resourceName: string, raw: unknown): unknown {
  return {
    [resourceName]: readProviderObject(raw, `malformed revenuecat ${resourceName} response`),
  };
}

function buildPaginationQuery(input: Record<string, unknown>): Record<string, unknown> {
  return compactObject({
    starting_after: optionalString(input.startingAfter),
    limit: input.limit,
  });
}

function buildExpandQuery(input: Record<string, unknown>): Record<string, unknown> {
  const expand = readOptionalStringArray(input.expand);
  return expand.length > 0 ? { expand } : {};
}

function readPackageProductAssociations(value: unknown): Array<Record<string, string>> {
  return objectArray(value, "products", (message) => new ProviderRequestError(400, message)).map((association) => {
    return {
      product_id: readInputString(association.productId, "productId"),
      eligibility_criteria: readInputString(association.eligibilityCriteria, "eligibilityCriteria"),
    };
  });
}

function readStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new ProviderRequestError(400, `${fieldName} must be an array`);
  }
  const values = value.map((item) => String(item).trim()).filter(Boolean);
  if (values.length === 0) {
    throw new ProviderRequestError(400, `${fieldName} must contain at least one item`);
  }
  return values;
}

function readOptionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function readInputString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}

function readProviderObject(value: unknown, message: string): Record<string, unknown> {
  return requiredRecord(value, "response", () => new ProviderRequestError(502, message, value));
}
