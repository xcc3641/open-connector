import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearGoogleServiceAccountTokenCache,
  createServiceAccountJwt,
  mintGoogleServiceAccountAccessToken,
  parseGoogleServiceAccountJson,
} from "./service-account.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

const sampleServiceAccount = {
  type: "service_account",
  client_email: "reader@example-gsc-test.iam.gserviceaccount.com",
  private_key: privateKeyPem,
  private_key_id: "test-key-id",
  project_id: "example-gsc-test",
  token_uri: "https://oauth2.googleapis.com/token",
};

afterEach(() => {
  clearGoogleServiceAccountTokenCache();
  vi.restoreAllMocks();
});

describe("parseGoogleServiceAccountJson", () => {
  it("parses a valid service-account key", () => {
    const parsed = parseGoogleServiceAccountJson(JSON.stringify(sampleServiceAccount));
    expect(parsed.client_email).toBe(sampleServiceAccount.client_email);
    expect(parsed.private_key).toContain("PRIVATE KEY");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseGoogleServiceAccountJson("{nope")).toThrow(/valid JSON/);
  });

  it("rejects missing private key", () => {
    expect(() =>
      parseGoogleServiceAccountJson(
        JSON.stringify({ client_email: "a@b.com", private_key: "not-a-key" }),
      ),
    ).toThrow(/private_key/);
  });
});

describe("createServiceAccountJwt", () => {
  it("signs a verifiable RS256 JWT", () => {
    const jwt = createServiceAccountJwt({
      serviceAccount: sampleServiceAccount,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      nowSeconds: 1_700_000_000,
    });

    const [headerB64, payloadB64, signatureB64] = jwt.split(".");
    expect(headerB64 && payloadB64 && signatureB64).toBeTruthy();

    const header = JSON.parse(Buffer.from(headerB64!, "base64url").toString("utf8")) as {
      alg: string;
      typ: string;
      kid?: string;
    };
    const payload = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8")) as {
      iss: string;
      scope: string;
      aud: string;
      iat: number;
      exp: number;
    };

    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");
    expect(header.kid).toBe("test-key-id");
    expect(payload.iss).toBe(sampleServiceAccount.client_email);
    expect(payload.aud).toBe("https://oauth2.googleapis.com/token");
    expect(payload.exp - payload.iat).toBe(3600);

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    expect(
      verifier.verify(createPublicKey(publicKeyPem), Buffer.from(signatureB64!, "base64url")),
    ).toBe(true);
  });
});

describe("mintGoogleServiceAccountAccessToken", () => {
  it("exchanges a JWT assertion for an access token and caches it", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: "ya29.token", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const first = await mintGoogleServiceAccountAccessToken({
      serviceAccount: sampleServiceAccount,
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_700_000_000_000,
    });
    const second = await mintGoogleServiceAccountAccessToken({
      serviceAccount: sampleServiceAccount,
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_700_000_000_000 + 60_000,
    });

    expect(first).toBe("ya29.token");
    expect(second).toBe("ya29.token");
    expect(fetcher).toHaveBeenCalledTimes(1);

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    const body = String(request.body);
    expect(body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(body).toContain("assertion=");
  });

  it("forceRefresh bypasses cache", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-2", expires_in: 3600 }), { status: 200 }),
      );

    const first = await mintGoogleServiceAccountAccessToken({
      serviceAccount: sampleServiceAccount,
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_700_000_000_000,
    });
    const second = await mintGoogleServiceAccountAccessToken({
      serviceAccount: sampleServiceAccount,
      fetcher: fetcher as unknown as typeof fetch,
      now: () => 1_700_000_000_000 + 1_000,
      forceRefresh: true,
    });

    expect(first).toBe("token-1");
    expect(second).toBe("token-2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
