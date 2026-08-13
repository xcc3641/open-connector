import type { CredentialValidationResult } from "../../core/types.ts";
import type { ApiKeyProviderContext, ProviderFetch } from "../provider-runtime.ts";

import { compactObject, optionalInteger, optionalRecord, optionalString } from "../../core/cast.ts";
import { createProviderTimeout, providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";
import { blueskyImageMaxBytes, blueskyVideoMaxBytes, getBlueskyPostTextValidationIssues } from "./actions.ts";

export interface BlueskyContext extends ApiKeyProviderContext {
  handle: string;
}

export const blueskyApiBaseUrl = "https://bsky.social";

const blueskyDefaultRequestTimeoutMs = 30_000;
const createSessionPath = "/xrpc/com.atproto.server.createSession";

export type BlueskyRequestPhase = "validate" | "execute";
type BlueskyActionHandler = (input: Record<string, unknown>, context: BlueskyContext) => Promise<unknown>;

export interface BlueskySession {
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  did: string;
  raw: Record<string, unknown>;
}

interface BlueskyRequestOptions {
  path: string;
  method: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  accessJwt?: string;
  fetcher: ProviderFetch;
  phase: BlueskyRequestPhase;
  signal?: AbortSignal;
}

export const blueskyActionHandlers: Record<string, BlueskyActionHandler> = {
  async get_profile(input, context) {
    const session = await createBlueskySession({
      identifier: context.handle,
      appPassword: context.apiKey,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const payload = await requestBlueskyJson({
      path: "/xrpc/app.bsky.actor.getProfile",
      method: "GET",
      query: {
        actor: requireInputString(input.actor, "actor"),
      },
      accessJwt: session.accessJwt,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    return {
      profile: requireRecord(payload, "Bluesky profile response"),
    };
  },
  async search_posts(input, context) {
    const session = await createBlueskySession({
      identifier: context.handle,
      appPassword: context.apiKey,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const payload = await requestBlueskyJson({
      path: "/xrpc/app.bsky.feed.searchPosts",
      method: "GET",
      query: buildSearchPostsQuery(input),
      accessJwt: session.accessJwt,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const record = requireRecord(payload, "Bluesky search response");
    return {
      posts: requireArray(record.posts, "posts").map((post) => requireRecord(post, "Bluesky post")),
      cursor: optionalString(record.cursor) ?? null,
      hitsTotal: optionalInteger(record.hitsTotal) ?? null,
    };
  },
  async create_text_post(input, context) {
    const session = await createBlueskySession({
      identifier: context.handle,
      appPassword: context.apiKey,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const payload = await requestBlueskyJson({
      path: "/xrpc/com.atproto.repo.createRecord",
      method: "POST",
      body: {
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: buildTextPostRecord(input),
      },
      accessJwt: session.accessJwt,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const record = requireRecord(payload, "Bluesky create record response");
    return {
      uri: requireResponseString(record.uri, "uri"),
      cid: requireResponseString(record.cid, "cid"),
      validationStatus: optionalString(record.validationStatus) ?? null,
      commit: optionalRecord(record.commit) ?? null,
    };
  },
  async create_post_with_image(input, context) {
    const session = await createBlueskySession({
      identifier: context.handle,
      appPassword: context.apiKey,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const imageBytes = decodeBase64Input(input.imageBase64, "imageBase64", blueskyImageMaxBytes);
    const mimeType = optionalString(input.imageMimeType) ?? "image/jpeg";

    const uploadUrl = new URL("/xrpc/com.atproto.repo.uploadBlob", blueskyApiBaseUrl);
    const timeout = createProviderTimeout(context.signal, blueskyDefaultRequestTimeoutMs);
    let response: Response;
    try {
      try {
        response = await context.fetcher(uploadUrl.toString(), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": mimeType,
            authorization: `Bearer ${session.accessJwt}`,
            "user-agent": providerUserAgent,
          },
          body: imageBytes as unknown as BodyInit,
          signal: timeout.signal,
        });
      } catch (error) {
        const message = timeout.didTimeout()
          ? "request timed out"
          : error instanceof Error
            ? error.message
            : "unknown transport error";
        throw new ProviderRequestError(timeout.didTimeout() ? 504 : 502, `Bluesky image upload failed: ${message}`);
      }
    } finally {
      timeout.cleanup();
    }

    if (!response.ok) {
      const text = await response.text();
      throw new ProviderRequestError(response.status, `Bluesky blob upload failed: ${text}`);
    }

    const blobResult = requireRecord(await readBlueskyJson(response, "invalid Bluesky blob response"), "blob result");
    const blobRecord = requireRecord(blobResult.blob, "blob record");

    const postRecord = buildTextPostRecord(input);
    postRecord.embed = {
      $type: "app.bsky.embed.images",
      images: [
        {
          alt: optionalString(input.alt) ?? "",
          image: blobRecord,
        },
      ],
    };

    const payload = await requestBlueskyJson({
      path: "/xrpc/com.atproto.repo.createRecord",
      method: "POST",
      body: {
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: postRecord,
      },
      accessJwt: session.accessJwt,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const record = requireRecord(payload, "Bluesky create record response");
    return {
      uri: requireResponseString(record.uri, "uri"),
      cid: requireResponseString(record.cid, "cid"),
      validationStatus: optionalString(record.validationStatus) ?? null,
      commit: optionalRecord(record.commit) ?? null,
    };
  },
  async like_post(input, context) {
    const session = await createBlueskySession({
      identifier: context.handle,
      appPassword: context.apiKey,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const payload = await requestBlueskyJson({
      path: "/xrpc/com.atproto.repo.createRecord",
      method: "POST",
      body: {
        repo: session.did,
        collection: "app.bsky.feed.like",
        record: {
          $type: "app.bsky.feed.like",
          subject: {
            uri: requireInputString(input.uri, "uri"),
            cid: requireInputString(input.cid, "cid"),
          },
          createdAt: new Date().toISOString(),
        },
      },
      accessJwt: session.accessJwt,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const record = requireRecord(payload, "Bluesky like record response");
    return {
      uri: requireResponseString(record.uri, "uri"),
      cid: requireResponseString(record.cid, "cid"),
    };
  },
  async create_post_with_video(input, context) {
    const session = await createBlueskySession({
      identifier: context.handle,
      appPassword: context.apiKey,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const videoBytes = decodeBase64Input(input.videoBase64, "videoBase64", blueskyVideoMaxBytes);
    const mimeType = optionalString(input.videoMimeType) ?? "video/mp4";

    const uploadUrl = new URL("/xrpc/com.atproto.repo.uploadBlob", blueskyApiBaseUrl);
    const timeout = createProviderTimeout(context.signal, blueskyDefaultRequestTimeoutMs);
    let blobRecord: Record<string, unknown>;
    try {
      let response: Response;
      try {
        response = await context.fetcher(uploadUrl.toString(), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": mimeType,
            authorization: `Bearer ${session.accessJwt}`,
            "user-agent": providerUserAgent,
          },
          body: videoBytes as unknown as BodyInit,
          signal: timeout.signal,
        });
      } catch (error) {
        const message = timeout.didTimeout()
          ? "request timed out"
          : error instanceof Error
            ? error.message
            : "unknown transport error";
        throw new ProviderRequestError(timeout.didTimeout() ? 504 : 502, `Bluesky video upload failed: ${message}`);
      }
      await assertBlueskyResponse(response, "execute");
      const uploadJson = await readBlueskyJson(response, "invalid uploadBlob response");
      blobRecord = requireRecord(requireRecord(uploadJson, "uploadBlob response").blob, "blob record");
    } finally {
      timeout.cleanup();
    }

    const postRecord = buildTextPostRecord(input);
    postRecord.embed = compactObject({
      $type: "app.bsky.embed.video",
      video: blobRecord,
      alt: optionalString(input.alt) ?? undefined,
      aspectRatio: {
        width: typeof input.width === "number" ? input.width : 16,
        height: typeof input.height === "number" ? input.height : 9,
      },
    });

    const payload = await requestBlueskyJson({
      path: "/xrpc/com.atproto.repo.createRecord",
      method: "POST",
      body: {
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: postRecord,
      },
      accessJwt: session.accessJwt,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const record = requireRecord(payload, "Bluesky create record response");
    return {
      uri: requireResponseString(record.uri, "uri"),
      cid: requireResponseString(record.cid, "cid"),
      validationStatus: optionalString(record.validationStatus) ?? null,
      commit: optionalRecord(record.commit) ?? null,
    };
  },
  async update_profile(input, context) {
    const session = await createBlueskySession({
      identifier: context.handle,
      appPassword: context.apiKey,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });

    let existingRecord: Record<string, unknown> = {};
    try {
      const getRes = await requestBlueskyJson({
        path: "/xrpc/com.atproto.repo.getRecord",
        method: "GET",
        query: {
          repo: session.did,
          collection: "app.bsky.actor.profile",
          rkey: "self",
        },
        accessJwt: session.accessJwt,
        fetcher: context.fetcher,
        signal: context.signal,
        phase: "execute",
      });
      const getJson = optionalRecord(getRes);
      if (getJson && getJson.value) {
        existingRecord = requireRecord(getJson.value, "profile value");
      }
    } catch (error) {
      if (!isMissingProfileRecordError(error)) {
        throw error;
      }
      // A missing profile record is created by putRecord below.
    }

    const newRecord: Record<string, unknown> = {
      $type: "app.bsky.actor.profile",
      ...existingRecord,
    };

    if (input.displayName === null) {
      delete newRecord.displayName;
    } else if (typeof input.displayName === "string") {
      newRecord.displayName = input.displayName;
    }
    if (input.description === null) {
      delete newRecord.description;
    } else if (typeof input.description === "string") {
      newRecord.description = input.description;
    }

    const payload = await requestBlueskyJson({
      path: "/xrpc/com.atproto.repo.putRecord",
      method: "POST",
      body: {
        repo: session.did,
        collection: "app.bsky.actor.profile",
        rkey: "self",
        record: newRecord,
      },
      accessJwt: session.accessJwt,
      fetcher: context.fetcher,
      signal: context.signal,
      phase: "execute",
    });
    const record = requireRecord(payload, "Bluesky profile putRecord response");
    return {
      uri: requireResponseString(record.uri, "uri"),
      cid: requireResponseString(record.cid, "cid"),
    };
  },
};

export async function validateBlueskyCredential(
  input: {
    apiKey: string;
    values: Record<string, string>;
  },
  fetcher: ProviderFetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  const session = await createBlueskySession({
    identifier: requireBlueskyHandle(input.values.handle),
    appPassword: requireInputString(input.apiKey, "apiKey"),
    fetcher,
    signal,
    phase: "validate",
  });

  return {
    profile: {
      accountId: session.did,
      displayName: session.handle,
      grantedScopes: [],
    },
    metadata: compactObject({
      apiBaseUrl: blueskyApiBaseUrl,
      validationEndpoint: createSessionPath,
      handle: session.handle,
      did: session.did,
    }),
  };
}

export function requireBlueskyHandle(value: unknown): string {
  const handle = optionalString(value);
  if (!handle) {
    throw new ProviderRequestError(400, "Bluesky handle is required");
  }
  return handle;
}

export async function createBlueskySession(input: {
  identifier: string;
  appPassword: string;
  fetcher: ProviderFetch;
  phase: BlueskyRequestPhase;
  signal?: AbortSignal;
}): Promise<BlueskySession> {
  const payload = await requestBlueskyJson({
    path: createSessionPath,
    method: "POST",
    body: {
      identifier: input.identifier,
      password: input.appPassword,
    },
    fetcher: input.fetcher,
    signal: input.signal,
    phase: input.phase,
  });
  const record = requireRecord(payload, "Bluesky session response");
  return {
    accessJwt: requireResponseString(record.accessJwt, "accessJwt"),
    refreshJwt: requireResponseString(record.refreshJwt, "refreshJwt"),
    handle: requireResponseString(record.handle, "handle"),
    did: requireResponseString(record.did, "did"),
    raw: record,
  };
}

function buildSearchPostsQuery(input: Record<string, unknown>): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const key of ["q", "sort", "since", "until", "mentions", "author", "lang", "domain", "url", "limit", "cursor"]) {
    if (input[key] !== undefined) {
      query[key] = input[key];
    }
  }
  if (Array.isArray(input.tag)) {
    query.tag = input.tag;
  }
  return query;
}

function buildTextPostRecord(input: Record<string, unknown>): Record<string, unknown> {
  const text = requirePostText(input.text);
  const explicitFacets = readRecordArray(input.facets);
  const facets = explicitFacets && explicitFacets.length > 0 ? explicitFacets : parseBlueskyRichTextFacets(text);

  let tags = readStringArray(input.tags);
  if (!tags || tags.length === 0) {
    const extractedTags: string[] = [];
    for (const facet of facets) {
      const features = facet.features as Array<Record<string, unknown>> | undefined;
      if (features) {
        for (const feature of features) {
          if (feature.$type === "app.bsky.richtext.facet#tag" && typeof feature.tag === "string") {
            extractedTags.push(feature.tag);
          }
        }
      }
    }
    if (extractedTags.length > 0) {
      tags = extractedTags;
    }
  }

  return compactObject({
    $type: "app.bsky.feed.post",
    text,
    createdAt: optionalString(input.createdAt) ?? new Date().toISOString(),
    langs: readStringArray(input.langs),
    tags,
    facets,
    reply: optionalRecord(input.reply),
    labels: optionalRecord(input.labels),
  });
}

function parseBlueskyRichTextFacets(text: string): Array<Record<string, unknown>> {
  const facets: Array<Record<string, unknown>> = [];
  const encoder = new TextEncoder();

  const urlRegex = /https?:\/\/[^\s\n]+/g;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    let url = match[0];
    while (/[.,!?:;)]$/.test(url)) {
      url = url.slice(0, -1);
    }
    const byteStart = encoder.encode(text.slice(0, match.index)).byteLength;
    const byteEnd = byteStart + encoder.encode(url).byteLength;
    facets.push({
      $type: "app.bsky.richtext.facet",
      index: { byteStart, byteEnd },
      features: [
        {
          $type: "app.bsky.richtext.facet#link",
          uri: url,
        },
      ],
    });
  }

  const tagRegex = /(?:^|\s)#([a-zA-Z0-9_\u4e00-\u9fa5]+)/g;
  while ((match = tagRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const tag = match[1];
    const hashIndexInMatch = fullMatch.indexOf("#");
    const charIndex = match.index + hashIndexInMatch;
    const tagString = "#" + tag;
    const byteStart = encoder.encode(text.slice(0, charIndex)).byteLength;
    const byteEnd = byteStart + encoder.encode(tagString).byteLength;
    facets.push({
      $type: "app.bsky.richtext.facet",
      index: { byteStart, byteEnd },
      features: [
        {
          $type: "app.bsky.richtext.facet#tag",
          tag: tag,
        },
      ],
    });
  }

  return facets;
}

async function requestBlueskyJson(options: BlueskyRequestOptions): Promise<unknown> {
  const url = buildBlueskyUrl(options.path, options.query);
  const timeout = createProviderTimeout(options.signal, blueskyDefaultRequestTimeoutMs);
  try {
    let response: Response;
    try {
      response = await options.fetcher(url.toString(), {
        method: options.method,
        headers: blueskyHeaders(options.accessJwt, options.body !== undefined),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: timeout.signal,
      });
    } catch (error) {
      const message = timeout.didTimeout()
        ? "request timed out"
        : error instanceof Error
          ? error.message
          : "unknown transport error";
      throw new ProviderRequestError(timeout.didTimeout() ? 504 : 502, `Bluesky request failed: ${message}`);
    }

    await assertBlueskyResponse(response, options.phase);
    return readBlueskyJson(response, "invalid Bluesky response");
  } finally {
    timeout.cleanup();
  }
}

function buildBlueskyUrl(path: string, query?: Record<string, unknown>): URL {
  const url = new URL(path, blueskyApiBaseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function blueskyHeaders(accessJwt: string | undefined, hasBody: boolean): Record<string, string> {
  return compactObject({
    accept: "application/json",
    "content-type": hasBody ? "application/json" : undefined,
    authorization: accessJwt ? `Bearer ${accessJwt}` : undefined,
    "user-agent": providerUserAgent,
  });
}

async function assertBlueskyResponse(response: Response, phase: BlueskyRequestPhase): Promise<void> {
  if (response.ok) {
    return;
  }

  const error = await readBlueskyError(response);
  if (response.status === 429) {
    throw new ProviderRequestError(429, error.message, error.payload);
  }
  if (phase === "validate" && (response.status === 401 || response.status === 403)) {
    throw new ProviderRequestError(400, error.message, error.payload);
  }
  throw new ProviderRequestError(response.status || 500, error.message, error.payload);
}

async function readBlueskyJson(response: Response, message: string): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderRequestError(502, message);
  }
}

async function readBlueskyError(response: Response): Promise<{ message: string; payload: unknown }> {
  const payload = await readBlueskyJson(response, `Bluesky request failed with ${response.status}`);
  const record = optionalRecord(payload);
  const message =
    optionalString(record?.message) ??
    optionalString(record?.error) ??
    `Bluesky request failed with HTTP ${response.status}`;
  return { message, payload };
}

function requireInputString(value: unknown, fieldName: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new ProviderRequestError(400, `${fieldName} is required`);
  }
  return text;
}

function requireResponseString(value: unknown, fieldName: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new ProviderRequestError(502, `Bluesky response is missing ${fieldName}`);
  }
  return text;
}

function requirePostText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProviderRequestError(400, "text is required");
  }
  const issue = getBlueskyPostTextValidationIssues(value)[0];
  if (issue) {
    throw new ProviderRequestError(400, issue);
  }
  return value;
}

function decodeBase64Input(value: unknown, fieldName: string, maxBytes: number): Uint8Array {
  const encoded = requireInputString(value, fieldName).replace(/\s/g, "");
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new ProviderRequestError(400, `${fieldName} exceeds ${maxBytes} decoded bytes`);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new ProviderRequestError(400, `${fieldName} must be valid Base64`);
  }

  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    throw new ProviderRequestError(400, `${fieldName} must be valid Base64`);
  }

  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.byteLength === 0) {
    throw new ProviderRequestError(400, `${fieldName} must not be empty`);
  }
  if (bytes.byteLength > maxBytes) {
    throw new ProviderRequestError(400, `${fieldName} exceeds ${maxBytes} decoded bytes`);
  }
  return bytes;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) {
    throw new ProviderRequestError(502, `invalid ${label}`);
  }
  return record;
}

function isMissingProfileRecordError(error: unknown): boolean {
  if (!(error instanceof ProviderRequestError) || error.status !== 400) {
    return false;
  }
  const details = optionalRecord(error.details);
  return optionalString(details?.error) === "RecordNotFound";
}

function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ProviderRequestError(502, `Bluesky response is missing ${fieldName}`);
  }
  return value;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map(String);
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((item) => requireRecord(item, "Bluesky record item"));
}
