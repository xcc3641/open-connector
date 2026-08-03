import type { TransitFileStore } from "../core/types.ts";

import { describe, expect, it, vi } from "vitest";
import { setDefaultGuardedFetchDnsLookup } from "../core/guarded-fetch.ts";
import { setPrivateNetworkAccessAllowed } from "../core/request.ts";
import { createAiImageActionHandlers, normalizeAiImageBaseUrl, validateAiImageCredential } from "./ai-image-runtime.ts";

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("AI-Image provider runtime", () => {
  it("normalizes a private Sub2API base URL when the deployment opts in", () => {
    setPrivateNetworkAccessAllowed(true);
    try {
      expect(normalizeAiImageBaseUrl("http://host.docker.internal:18080")).toBe("http://host.docker.internal:18080/v1");
      expect(normalizeAiImageBaseUrl("http://host.docker.internal:18080/v1/")).toBe(
        "http://host.docker.internal:18080/v1",
      );
      expect(normalizeAiImageBaseUrl(undefined)).toBe("http://host.docker.internal:18080/v1");
    } finally {
      setPrivateNetworkAccessAllowed(false);
    }
  });

  it("validates the default Docker-host connection despite OrbStack's reserved alias address", async () => {
    setPrivateNetworkAccessAllowed(true);
    setDefaultGuardedFetchDnsLookup(async () => [{ address: "0.250.250.254", family: 4 }]);
    try {
      const fetcher = vi.fn(async () =>
        Response.json({ data: [{ id: "gpt-5.6" }, { id: "gpt-image-2" }, { id: "gpt-image-1.5" }] }),
      ) as unknown as typeof fetch;

      await expect(
        validateAiImageCredential({
          apiKey: "sk-test",
          baseUrl: undefined,
          backend: "gpt",
          displayName: "AI-Image GPT",
          fetcher,
        }),
      ).resolves.toMatchObject({
        profile: { accountId: "ai-image-gpt", displayName: "AI-Image GPT" },
        metadata: {
          backend: "gpt",
          availableModels: ["gpt-image-1.5", "gpt-image-2"],
        },
      });
      expect(fetcher).toHaveBeenCalledWith("http://host.docker.internal:18080/v1/models", expect.any(Object));
    } finally {
      setDefaultGuardedFetchDnsLookup(undefined);
      setPrivateNetworkAccessAllowed(false);
    }
  });

  it("keeps resolved-address validation for custom Base URL overrides", async () => {
    setPrivateNetworkAccessAllowed(true);
    setDefaultGuardedFetchDnsLookup(async () => [{ address: "0.250.250.254", family: 4 }]);
    try {
      const fetcher = vi.fn(async () => Response.json({ data: [{ id: "gpt-image-2" }] })) as unknown as typeof fetch;
      await expect(
        validateAiImageCredential({
          apiKey: "sk-test",
          baseUrl: "http://sub2api.example.com/v1",
          backend: "gpt",
          displayName: "AI-Image GPT",
          fetcher,
        }),
      ).rejects.toMatchObject({
        status: 502,
        message: "request URL must not resolve to private or reserved IP addresses",
      });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      setDefaultGuardedFetchDnsLookup(undefined);
      setPrivateNetworkAccessAllowed(false);
    }
  });

  it("rejects a Grok key configured on the GPT provider", async () => {
    setPrivateNetworkAccessAllowed(true);
    try {
      const fetcher = vi.fn(async () =>
        Response.json({ data: [{ id: "grok-imagine-image-quality" }] }),
      ) as unknown as typeof fetch;
      await expect(
        validateAiImageCredential({
          apiKey: "sk-test",
          baseUrl: "http://host.docker.internal:18080/v1",
          backend: "gpt",
          displayName: "AI-Image GPT",
          fetcher,
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: "This Sub2API key is not bound to an OpenAI image group.",
      });
    } finally {
      setPrivateNetworkAccessAllowed(false);
    }
  });

  it("detects Grok JPEG bytes when the response omits output_format", async () => {
    const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ b64_json: Buffer.from(jpegBytes).toString("base64") }] }),
    ) as unknown as typeof fetch;

    const result = await createAiImageActionHandlers("grok").generate_image!(
      { prompt: "minimal icon" },
      {
        apiKey: "sk-test",
        backend: "grok",
        baseUrl: "http://sub2api.test/v1",
        fetcher,
        transitFiles: createTransitStore(),
      },
    );

    expect(result).toMatchObject({
      model: "grok-imagine-image-quality",
      images: [
        {
          file: {
            name: expect.stringMatching(/\.jpg$/u),
            mimeType: "image/jpeg",
          },
        },
      ],
    });
  });

  it("stores generated Base64 images in transit storage without returning Base64", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Response.json({
        created: 1_780_000_000,
        data: [{ b64_json: Buffer.from(pngBytes).toString("base64"), revised_prompt: "a moon cat" }],
        usage: { images: 1 },
      });
    }) as unknown as typeof fetch;
    const transitFiles = createTransitStore();

    const result = await createAiImageActionHandlers("gpt").generate_image!(
      { prompt: "a cat on the moon", quality: "high" },
      {
        apiKey: "sk-test",
        backend: "gpt",
        baseUrl: "http://sub2api.test/v1",
        fetcher,
        transitFiles,
      },
    );

    expect(result).toEqual({
      model: "gpt-image-2",
      created: 1_780_000_000,
      images: [
        {
          file: {
            fileId: "generated-1",
            downloadUrl: "/v1/files/generated-1",
            sizeBytes: pngBytes.byteLength,
            name: expect.stringMatching(/^ai-image-gpt-\d+-01\.png$/u),
            mimeType: "image/png",
          },
          revisedPrompt: "a moon cat",
        },
      ],
      usage: { images: 1 },
    });
    expect(JSON.stringify(result)).not.toContain(Buffer.from(pngBytes).toString("base64"));
    expect(requests[0]?.url).toBe("http://sub2api.test/v1/images/generations");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      model: "gpt-image-2",
      prompt: "a cat on the moon",
      n: 1,
      quality: "high",
      output_format: "png",
      response_format: "b64_json",
      stream: false,
    });
  });

  it("edits an image through images/edits with the best default GPT model", async () => {
    const source = new File([pngBytes], "source.png", { type: "image/png" });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Response.json({
        created: 1_780_000_001,
        data: [{ b64_json: Buffer.from(pngBytes).toString("base64") }],
      });
    }) as unknown as typeof fetch;

    const result = await createAiImageActionHandlers("gpt").edit_image!(
      {
        prompt: "make the cat wear a scarf",
        image: { fileId: "src-1" },
        quality: "high",
      },
      {
        apiKey: "sk-test",
        backend: "gpt",
        baseUrl: "http://sub2api.test/v1",
        fetcher,
        transitFiles: createTransitStore({ "src-1": source }),
      },
    );

    expect(result).toMatchObject({
      model: "gpt-image-2",
      images: [
        {
          file: {
            name: expect.stringMatching(/^ai-image-gpt-edit-\d+-01\.png$/u),
            mimeType: "image/png",
          },
        },
      ],
    });
    expect(requests[0]?.url).toBe("http://sub2api.test/v1/images/edits");
    expect(new Headers(requests[0]?.init?.headers).get("content-type")).toBeNull();
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer sk-test");
    expect(requests[0]?.init?.body).toBeInstanceOf(FormData);
    const body = requests[0]?.init?.body as FormData;
    expect(body.get("model")).toBe("gpt-image-2");
    expect(body.get("prompt")).toBe("make the cat wear a scarf");
    expect(body.get("response_format")).toBe("b64_json");
    expect(body.get("quality")).toBe("high");
    expect(body.get("image")).toBeInstanceOf(File);
  });

  it("generates with multiple reference images through images/edits", async () => {
    const refA = new File([pngBytes], "ref-a.png", { type: "image/png" });
    const refB = new File([pngBytes], "ref-b.png", { type: "image/png" });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Response.json({
        data: [{ b64_json: Buffer.from(pngBytes).toString("base64") }],
      });
    }) as unknown as typeof fetch;

    const result = await createAiImageActionHandlers("gpt").generate_with_reference!(
      {
        prompt: "same character, rainy street",
        referenceImages: [{ fileId: "a" }, { fileId: "b" }],
        inputFidelity: "high",
      },
      {
        apiKey: "sk-test",
        backend: "gpt",
        baseUrl: "http://sub2api.test/v1",
        fetcher,
        transitFiles: createTransitStore({ a: refA, b: refB }),
      },
    );

    expect(result).toMatchObject({
      model: "gpt-image-2",
      images: [{ file: { name: expect.stringMatching(/^ai-image-gpt-ref-\d+-01\.png$/u) } }],
    });
    const body = requests[0]?.init?.body as FormData;
    expect(requests[0]?.url).toBe("http://sub2api.test/v1/images/edits");
    expect(body.getAll("image[]")).toHaveLength(2);
    expect(body.get("input_fidelity")).toBe("high");
    expect(body.get("model")).toBe("gpt-image-2");
  });

  it("does not expose edit actions on the Grok backend handlers", () => {
    const handlers = createAiImageActionHandlers("grok");
    expect(handlers.edit_image).toBeUndefined();
    expect(handlers.generate_with_reference).toBeUndefined();
  });
});

function createTransitStore(files: Record<string, File> = {}): TransitFileStore {
  let created = 0;
  return {
    maxBytes: 1024,
    async create(file) {
      created += 1;
      return {
        fileId: `generated-${created}`,
        downloadUrl: `/v1/files/generated-${created}`,
        sizeBytes: file.size,
        name: file.name,
        mimeType: file.type,
      };
    },
    async read(fileId) {
      const file = files[fileId];
      if (!file) {
        throw new Error(`missing transit file ${fileId}`);
      }
      return {
        fileId,
        file,
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      };
    },
    async delete() {
      return false;
    },
  };
}
