import type { CredentialValidationResult } from "../../core/types.ts";
import type { EagleActionName } from "./actions.ts";

import {
  objectArray,
  optionalInteger,
  optionalString,
  optionalStringArray,
  requiredString,
  requiredStringArray,
} from "../../core/cast.ts";
import { readBoundedResponseBytes } from "../../core/request.ts";
import { createProviderTimeout, providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";

export interface EagleActionContext {
  apiKey: string;
  apiBaseUrl: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
}

type EagleActionHandler = (input: Record<string, unknown>, context: EagleActionContext) => Promise<unknown>;

const defaultRequestTimeoutMs = 60_000;
const defaultEagleBaseUrl = "http://127.0.0.1:41595";
const maxResponseBytes = 10 * 1024 * 1024;

const blockedHostnames = new Set(["169.254.169.254", "metadata.google.internal", "metadata", "instance-data"]);

export const eagleActionHandlers: Record<EagleActionName, EagleActionHandler> = {
  get_application_info(_input, context) {
    return requestEagleJson("/api/application/info", "GET", {}, undefined, context);
  },
  get_library_info(_input, context) {
    return requestEagleJson("/api/library/info", "GET", {}, undefined, context);
  },
  get_library_history(_input, context) {
    return requestEagleJson("/api/library/history", "GET", {}, undefined, context);
  },
  switch_library(input, context) {
    const libraryPath = requiredString(input.library_path, "library_path");
    return requestEagleJson("/api/library/switch", "POST", {}, { libraryPath }, context);
  },
  list_items(input, context) {
    const query: Record<string, unknown> = {};
    if (input.limit !== undefined) query.limit = input.limit;
    if (input.offset !== undefined) query.offset = input.offset;
    if (input.order_by !== undefined) query.orderBy = input.order_by;
    if (input.keyword !== undefined) query.keyword = input.keyword;
    if (input.ext !== undefined) query.ext = input.ext;
    const tags = optionalStringArray(input.tags);
    if (tags && tags.length > 0) query.tags = tags.join(",");
    const folders = optionalStringArray(input.folders);
    if (folders && folders.length > 0) query.folders = folders.join(",");
    return requestEagleJson("/api/item/list", "GET", query, undefined, context);
  },
  get_item_info(input, context) {
    const id = requiredString(input.id, "id");
    return requestEagleJson("/api/item/info", "GET", { id }, undefined, context);
  },
  get_item_thumbnail(input, context) {
    const id = requiredString(input.id, "id");
    return requestEagleJson("/api/item/thumbnail", "GET", { id }, undefined, context);
  },
  add_item_from_url(input, context) {
    const body: Record<string, unknown> = {
      url: requiredString(input.url, "url"),
      name: requiredString(input.name, "name"),
    };
    if (input.website !== undefined) body.website = input.website;
    if (input.tags !== undefined) body.tags = input.tags;
    if (input.annotation !== undefined) body.annotation = input.annotation;
    if (input.modification_time !== undefined) body.modificationTime = input.modification_time;
    if (input.folder_id !== undefined) body.folderId = input.folder_id;
    if (input.headers !== undefined) body.headers = input.headers;
    return requestEagleJson("/api/item/addFromURL", "POST", {}, body, context);
  },
  add_item_from_path(input, context) {
    const body: Record<string, unknown> = {
      path: requiredString(input.path, "path"),
      name: requiredString(input.name, "name"),
    };
    if (input.website !== undefined) body.website = input.website;
    if (input.tags !== undefined) body.tags = input.tags;
    if (input.annotation !== undefined) body.annotation = input.annotation;
    if (input.folder_id !== undefined) body.folderId = input.folder_id;
    return requestEagleJson("/api/item/addFromPath", "POST", {}, body, context);
  },
  add_items_from_paths(input, context) {
    const items = objectArray(input.items, "items");
    const body: Record<string, unknown> = { items };
    if (input.folder_id !== undefined) body.folderId = input.folder_id;
    return requestEagleJson("/api/item/addFromPaths", "POST", {}, body, context);
  },
  add_bookmark(input, context) {
    const body: Record<string, unknown> = {
      url: requiredString(input.url, "url"),
      name: requiredString(input.name, "name"),
    };
    if (input.base64 !== undefined) body.base64 = input.base64;
    if (input.tags !== undefined) body.tags = input.tags;
    if (input.annotation !== undefined) body.annotation = input.annotation;
    if (input.folder_id !== undefined) body.folderId = input.folder_id;
    return requestEagleJson("/api/item/addBookmark", "POST", {}, body, context);
  },
  update_item(input, context) {
    const body: Record<string, unknown> = {
      id: requiredString(input.id, "id"),
    };
    if (input.tags !== undefined) body.tags = input.tags;
    if (input.annotation !== undefined) body.annotation = input.annotation;
    if (input.url !== undefined) body.url = input.url;
    if (input.star !== undefined) body.star = input.star;
    return requestEagleJson("/api/item/update", "POST", {}, body, context);
  },
  move_items_to_trash(input, context) {
    const itemIds = requiredStringArray(input.item_ids, "item_ids");
    return requestEagleJson("/api/item/moveToTrash", "POST", {}, { itemIds }, context);
  },
  refresh_item_thumbnail(input, context) {
    const id = requiredString(input.id, "id");
    return requestEagleJson("/api/item/refreshThumbnail", "POST", {}, { id }, context);
  },
  refresh_item_palette(input, context) {
    const id = requiredString(input.id, "id");
    return requestEagleJson("/api/item/refreshPalette", "POST", {}, { id }, context);
  },
  list_folders(_input, context) {
    return requestEagleJson("/api/folder/list", "GET", {}, undefined, context);
  },
  create_folder(input, context) {
    const body: Record<string, unknown> = {
      folderName: requiredString(input.folder_name, "folder_name"),
    };
    if (input.parent !== undefined) body.parent = input.parent;
    return requestEagleJson("/api/folder/create", "POST", {}, body, context);
  },
  rename_folder(input, context) {
    const body: Record<string, unknown> = {
      folderId: requiredString(input.folder_id, "folder_id"),
      newName: requiredString(input.new_name, "new_name"),
    };
    return requestEagleJson("/api/folder/rename", "POST", {}, body, context);
  },
  update_folder(input, context) {
    const body: Record<string, unknown> = {
      folderId: requiredString(input.folder_id, "folder_id"),
    };
    if (input.new_name !== undefined) body.newName = input.new_name;
    if (input.new_description !== undefined) body.newDescription = input.new_description;
    if (input.new_color !== undefined) body.newColor = input.new_color;
    return requestEagleJson("/api/folder/update", "POST", {}, body, context);
  },
  list_tags(_input, context) {
    return requestEagleJson("/api/tag/list", "GET", {}, undefined, context);
  },
};

export function createEagleContext(
  values: Record<string, string>,
  apiKey: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): EagleActionContext {
  return {
    apiKey: apiKey.trim(),
    apiBaseUrl: normalizeEagleBaseUrl(values.baseUrl),
    fetcher,
    signal,
  };
}

export async function validateEagleCredential(
  values: Record<string, string>,
  apiKey: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  const context = createEagleContext(values, apiKey, fetcher, signal);
  const result = (await requestEagleJson("/api/application/info", "GET", {}, undefined, context)) as Record<
    string,
    unknown
  >;
  const version = optionalString(result.version) ?? "4.0";
  const platform = optionalString(result.platform) ?? "local";
  return {
    profile: {
      accountId: `eagle:${platform}`,
      displayName: `Eagle App (${version})`,
    },
    grantedScopes: [],
    metadata: {
      apiBaseUrl: context.apiBaseUrl,
      version,
      platform,
    },
  };
}

/**
 * Validates an Eagle HTTP URL, removes trailing slashes and query/hash,
 * and ensures valid local/private address formatting.
 */
export function normalizeEagleBaseUrl(value?: unknown): string {
  const rawUrl = (optionalString(value) ?? defaultEagleBaseUrl).trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderRequestError(400, "baseUrl must be a valid HTTP or HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProviderRequestError(400, "baseUrl must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new ProviderRequestError(400, "baseUrl must not include credentials");
  }
  if (blockedHostnames.has(url.hostname.toLowerCase())) {
    throw new ProviderRequestError(400, "baseUrl must not target cloud metadata hosts");
  }
  url.hash = "";
  url.search = "";
  let pathname = url.pathname.replace(/\/+$/u, "");
  if (pathname.endsWith("/api")) {
    pathname = pathname.slice(0, -4);
  }
  url.pathname = pathname;
  return url.toString().replace(/\/+$/u, "");
}

async function requestEagleJson(
  path: string,
  method: "GET" | "POST",
  query: Record<string, unknown>,
  body: Record<string, unknown> | undefined,
  context: EagleActionContext,
): Promise<unknown> {
  const url = new URL(`${context.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`);

  for (const [key, val] of Object.entries(query)) {
    if (val !== undefined && val !== null && val !== "") {
      url.searchParams.set(key, String(val));
    }
  }

  if (context.apiKey) {
    if (method === "GET") {
      url.searchParams.set("token", context.apiKey);
    } else if (body && typeof body === "object") {
      body.token = context.apiKey;
    }
  }

  const timeout = createProviderTimeout(context.signal, defaultRequestTimeoutMs);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": providerUserAgent,
  };
  if (body) {
    headers["content-type"] = "application/json";
  }

  let response: Response;
  let responseText: string;
  try {
    response = await context.fetcher(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: timeout.signal,
    });
    const bytes = await readBoundedResponseBytes(response, {
      maxBytes: maxResponseBytes,
      fieldName: "Eagle response",
      createError: (msg) => new ProviderRequestError(502, msg),
    });
    responseText = new TextDecoder().decode(bytes);
  } catch (error) {
    throw new ProviderRequestError(
      502,
      error instanceof Error ? `Eagle network request failed: ${error.message}` : "Eagle network request failed",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new ProviderRequestError(
      response.ok ? 502 : response.status,
      `Eagle returned non-JSON response: ${responseText.slice(0, 500)}`,
    );
  }

  if (payload.status === "error") {
    const message = optionalString(payload.message) ?? "Eagle API returned an error";
    const code = optionalInteger(payload.code) ?? (response.ok ? 400 : response.status);
    throw new ProviderRequestError(code, message, payload);
  }

  if (!response.ok) {
    const message = optionalString(payload.message) ?? `Eagle request failed with HTTP ${response.status}`;
    throw new ProviderRequestError(response.status, message, payload);
  }

  return payload.data !== undefined ? payload.data : payload;
}
