import { createPrivateKey, createSign } from "node:crypto";

import { ProviderRequestError } from "../provider-runtime.ts";
import {
  googleSearchConsoleFullScope,
  googleSearchConsoleReadonlyScope,
} from "./scopes.ts";

const googleTokenUrl = "https://oauth2.googleapis.com/token";

/** Space-separated scopes covering read + write Search Console APIs. */
export const googleSearchConsoleServiceAccountScope: string = [
  googleSearchConsoleReadonlyScope,
  googleSearchConsoleFullScope,
].join(" ");

/**
 * Parsed Google Cloud service-account key fields used for JWT bearer grants.
 */
export interface GoogleServiceAccountKey {
  type?: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
  token_uri?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Options for minting a Google OAuth access token from a service-account key.
 */
export interface MintGoogleServiceAccountAccessTokenInput {
  serviceAccount: GoogleServiceAccountKey;
  scope?: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
  /** Force mint even if a cached token exists. */
  forceRefresh?: boolean;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Options for building the RS256 JWT assertion used by the JWT-bearer grant.
 */
export interface CreateServiceAccountJwtInput {
  serviceAccount: GoogleServiceAccountKey;
  scope: string;
  nowSeconds: number;
  lifetimeSeconds?: number;
}

interface ServiceAccountJwtHeader {
  alg: "RS256";
  typ: "JWT";
  kid?: string;
}

/** Process-local token cache keyed by client_email + scope. */
const tokenCache = new Map<string, CachedToken>();

/**
 * Parse and validate a Google service-account key JSON string.
 */
export function parseGoogleServiceAccountJson(raw: string): GoogleServiceAccountKey {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ProviderRequestError(400, "serviceAccountJson is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ProviderRequestError(400, "serviceAccountJson must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderRequestError(400, "serviceAccountJson must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const clientEmail = typeof record.client_email === "string" ? record.client_email.trim() : "";
  const privateKey = typeof record.private_key === "string" ? record.private_key : "";

  if (!clientEmail) {
    throw new ProviderRequestError(400, "serviceAccountJson is missing client_email");
  }
  if (!privateKey.includes("PRIVATE KEY")) {
    throw new ProviderRequestError(400, "serviceAccountJson is missing a valid private_key");
  }

  const key: GoogleServiceAccountKey = {
    client_email: clientEmail,
    private_key: privateKey,
  };
  if (typeof record.type === "string") {
    key.type = record.type;
  }
  if (typeof record.private_key_id === "string") {
    key.private_key_id = record.private_key_id;
  }
  if (typeof record.project_id === "string") {
    key.project_id = record.project_id;
  }
  if (typeof record.token_uri === "string") {
    key.token_uri = record.token_uri;
  }
  return key;
}

/**
 * Mint a Google access token from a service-account key via JWT bearer grant.
 * Mirrors local `gsc.sh` (RS256 JWT → oauth2.googleapis.com/token).
 */
export async function mintGoogleServiceAccountAccessToken(
  input: MintGoogleServiceAccountAccessTokenInput,
): Promise<string> {
  const scope = input.scope ?? googleSearchConsoleServiceAccountScope;
  const nowMs = (input.now ?? Date.now)();
  const cacheKey = `${input.serviceAccount.client_email}\0${scope}`;
  const cached = tokenCache.get(cacheKey);
  // Refresh 5 minutes early, matching gsc.sh's ~55 minute reuse window.
  if (!input.forceRefresh && cached && cached.expiresAtMs - 5 * 60_000 > nowMs) {
    return cached.accessToken;
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const assertion = createServiceAccountJwt({
    serviceAccount: input.serviceAccount,
    scope,
    nowSeconds,
  });

  const tokenUri = input.serviceAccount.token_uri?.trim() || googleTokenUrl;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await input.fetcher(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: input.signal,
  });

  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;

  if (!response.ok || !payload?.access_token) {
    const message =
      payload?.error_description ||
      payload?.error ||
      `Google service-account token exchange failed with ${response.status}`;
    throw new ProviderRequestError(response.status || 502, message, payload);
  }

  const expiresInSeconds =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 3600;

  tokenCache.set(cacheKey, {
    accessToken: payload.access_token,
    expiresAtMs: nowMs + expiresInSeconds * 1000,
  });

  return payload.access_token;
}

/**
 * Build a signed RS256 JWT assertion for the Google JWT-bearer grant.
 */
export function createServiceAccountJwt(input: CreateServiceAccountJwtInput): string {
  const lifetimeSeconds = input.lifetimeSeconds ?? 3600;
  const header: ServiceAccountJwtHeader = {
    alg: "RS256",
    typ: "JWT",
  };
  if (input.serviceAccount.private_key_id) {
    header.kid = input.serviceAccount.private_key_id;
  }
  const payload = {
    iss: input.serviceAccount.client_email,
    scope: input.scope,
    aud: input.serviceAccount.token_uri?.trim() || googleTokenUrl,
    iat: input.nowSeconds,
    exp: input.nowSeconds + lifetimeSeconds,
  };

  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  let privateKey;
  try {
    privateKey = createPrivateKey(input.serviceAccount.private_key);
  } catch {
    throw new ProviderRequestError(400, "serviceAccountJson private_key is not a valid PEM key");
  }

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

/** Test helper: clear in-memory SA token cache. */
export function clearGoogleServiceAccountTokenCache(): void {
  tokenCache.clear();
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
