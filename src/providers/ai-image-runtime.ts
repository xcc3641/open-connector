import type { CredentialValidationResult, ExecutionContext, TransitFileWriter } from "../core/types.ts";
import type { AiImageBackend } from "./ai-image-actions.ts";
import type { ProviderFetch, ProviderTransitFile } from "./provider-runtime.ts";

import {
  base64Bytes,
  compactObject,
  optionalInteger,
  optionalObjectArray,
  optionalRecord,
  optionalString,
  requiredString,
} from "../core/cast.ts";
import { assertPublicHttpUrl, isPrivateNetworkAccessAllowed, readBoundedResponseBytes } from "../core/request.ts";
import {
  createProviderFetch,
  ProviderRequestError,
  providerFetch,
  providerUserAgent,
  readProviderTextBody,
  requireApiKeyCredential,
} from "./provider-runtime.ts";

const defaultAiImageBaseUrl = "http://host.docker.internal:18080/v1";
const defaultModels: Record<AiImageBackend, string> = {
  gpt: "gpt-image-2",
  grok: "grok-imagine-image-quality",
};
const modelPrefixes: Record<AiImageBackend, string> = {
  gpt: "gpt-image-",
  grok: "grok-imagine",
};
const imageResponseOverheadBytes = 1024 * 1024;
const maximumGeneratedImages = 4;

export interface AiImageContext {
  apiKey: string;
  backend: AiImageBackend;
  baseUrl: string;
  fetcher: ProviderFetch;
  signal?: AbortSignal;
  transitFiles?: TransitFileWriter;
}

interface AiImageContextInput {
  service: string;
  backend: AiImageBackend;
  executionContext: ExecutionContext;
  fetcher: ProviderFetch;
}

interface ValidateAiImageCredentialInput {
  apiKey: string;
  baseUrl?: string;
  backend: AiImageBackend;
  displayName: string;
  fetcher: ProviderFetch;
  signal?: AbortSignal;
}

interface GeneratedImageSource {
  bytes: Uint8Array;
  mimeType: string;
  revisedPrompt?: string;
}

export function createAiImageActionHandlers(
  backend: AiImageBackend,
): Record<string, (input: Record<string, unknown>, context: AiImageContext) => Promise<unknown>> {
  return {
    list_models(_input, context) {
      assertContextBackend(context, backend);
      return listAiImageModels(context);
    },
    generate_image(input, context) {
      assertContextBackend(context, backend);
      return generateAiImages(input, context);
    },
  };
}

export async function createAiImageContext(input: AiImageContextInput): Promise<AiImageContext> {
  const credential = await requireApiKeyCredential(input.executionContext, input.service);
  const baseUrl = normalizeAiImageBaseUrl(
    optionalString(credential.metadata.apiBaseUrl) ?? optionalString(credential.values.baseUrl),
  );
  return {
    apiKey: credential.apiKey,
    backend: input.backend,
    baseUrl,
    fetcher: createAiImageFetcher(input.fetcher, baseUrl),
    signal: input.executionContext.signal,
    transitFiles: input.executionContext.transitFiles,
  };
}

export async function validateAiImageCredential(
  input: ValidateAiImageCredentialInput,
): Promise<CredentialValidationResult> {
  const baseUrl = normalizeAiImageBaseUrl(input.baseUrl);
  const guardedFetcher = createAiImageFetcher(input.fetcher, baseUrl);
  const models = await requestModelIds({
    apiKey: input.apiKey,
    baseUrl,
    fetcher: guardedFetcher,
    signal: input.signal,
    phase: "validate",
  });
  const availableModels = filterImageModels(models, input.backend);
  if (availableModels.length === 0) {
    const expected = input.backend === "gpt" ? "an OpenAI image group" : "a Grok image group";
    throw new ProviderRequestError(400, `This Sub2API key is not bound to ${expected}.`);
  }

  return {
    profile: {
      accountId: `ai-image-${input.backend}`,
      displayName: input.displayName,
      grantedScopes: ["image-generation"],
    },
    grantedScopes: ["image-generation"],
    metadata: {
      apiBaseUrl: baseUrl,
      backend: input.backend,
      availableModels,
      validationEndpoint: "/models",
    },
  };
}

function createAiImageFetcher(fetcher: ProviderFetch, baseUrl: string): ProviderFetch {
  return createProviderFetch({
    fetch: fetcher,
    allowPrivateNetwork: isPrivateNetworkAccessAllowed,
    // OrbStack maps this fixed Docker host alias to 0.250.250.254, which the
    // generic DNS guard correctly classifies as reserved. The alias and port
    // are code-controlled, so URL/redirect guards remain active while only its
    // redundant resolved-address check is skipped.
    skipDnsValidation: baseUrl === defaultAiImageBaseUrl,
  });
}

export function normalizeAiImageBaseUrl(value: unknown): string {
  const raw = optionalString(value) ?? defaultAiImageBaseUrl;
  const url = assertPublicHttpUrl(raw, {
    fieldName: "baseUrl",
    allowPrivateNetwork: isPrivateNetworkAccessAllowed(),
    createError: providerInputError,
  });
  if (url.username || url.password) {
    throw providerInputError("baseUrl must not include credentials");
  }
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/u, "");
  url.pathname = path.endsWith("/v1") ? path : `${path}/v1`;
  return url.toString().replace(/\/$/u, "");
}

async function listAiImageModels(context: AiImageContext): Promise<Record<string, unknown>> {
  const models = await requestModelIds({ ...context, phase: "execute" });
  return { models: filterImageModels(models, context.backend) };
}

async function generateAiImages(
  input: Record<string, unknown>,
  context: AiImageContext,
): Promise<Record<string, unknown>> {
  if (!context.transitFiles) {
    throw new ProviderRequestError(400, "AI-Image generation requires local transit file storage.");
  }

  const model = optionalString(input.model) ?? defaultModels[context.backend];
  assertModelMatchesBackend(model, context.backend);
  const outputFormat = context.backend === "gpt" ? (optionalString(input.outputFormat) ?? "png") : "png";
  const body = compactObject({
    model,
    prompt: requiredString(input.prompt, "prompt", providerInputError),
    n: optionalInteger(input.n) ?? 1,
    size: optionalString(input.size),
    quality: context.backend === "gpt" ? optionalString(input.quality) : undefined,
    background: context.backend === "gpt" ? optionalString(input.background) : undefined,
    output_format: context.backend === "gpt" ? outputFormat : undefined,
    output_compression: context.backend === "gpt" ? optionalInteger(input.outputCompression) : undefined,
    moderation: context.backend === "gpt" ? optionalString(input.moderation) : undefined,
    response_format: "b64_json",
    stream: false,
  });

  const response = await context.fetcher(`${context.baseUrl}/images/generations`, {
    method: "POST",
    headers: aiImageHeaders(context.apiKey),
    body: JSON.stringify(body),
    signal: context.signal,
  });
  const payload = await readAiImageJson(response, "execute", context.transitFiles.maxBytes);
  const record = requireResponseRecord(payload, "image generation response");
  const items = optionalObjectArray(record.data, "image item", invalidResponseError);
  if (items.length === 0) {
    throw new ProviderRequestError(502, "Sub2API image response did not include generated images.", payload);
  }

  const images = await Promise.all(
    items.map(async (item, index) => {
      const source = await resolveGeneratedImage(item, outputFormat, context.transitFiles!.maxBytes, context.signal);
      const extension = extensionForMimeType(source.mimeType);
      const fileName = `ai-image-${context.backend}-${Date.now()}-${String(index + 1).padStart(2, "0")}.${extension}`;
      const stored = await context.transitFiles!.create(
        new File([Uint8Array.from(source.bytes)], fileName, { type: source.mimeType }),
      );
      const file: ProviderTransitFile = {
        fileId: stored.fileId,
        downloadUrl: stored.downloadUrl,
        sizeBytes: stored.sizeBytes,
        name: stored.name,
        mimeType: stored.mimeType,
      };
      return compactObject({ file, revisedPrompt: source.revisedPrompt });
    }),
  );

  return compactObject({
    model: optionalString(record.model) ?? model,
    created: optionalInteger(record.created),
    images,
    usage: optionalRecord(record.usage),
  });
}

async function resolveGeneratedImage(
  item: Record<string, unknown>,
  fallbackFormat: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<GeneratedImageSource> {
  const revisedPrompt = optionalString(item.revised_prompt);
  const b64 = optionalString(item.b64_json);
  if (b64) {
    const bytes = base64Bytes(b64, "data[].b64_json", invalidResponseError);
    assertImageSize(bytes.byteLength, maxBytes);
    return {
      bytes,
      mimeType: detectImageMimeType(bytes) ?? mimeTypeForFormat(optionalString(item.output_format) ?? fallbackFormat),
      revisedPrompt,
    };
  }

  const imageUrl = optionalString(item.url);
  if (!imageUrl) {
    throw invalidResponseError("Each generated image must include b64_json or url");
  }
  const dataUrl = /^data:([^;,]+);base64,(.+)$/isu.exec(imageUrl);
  if (dataUrl) {
    const bytes = base64Bytes(dataUrl[2], "data[].url", invalidResponseError);
    assertImageSize(bytes.byteLength, maxBytes);
    return {
      bytes,
      mimeType: detectImageMimeType(bytes) ?? normalizeImageMimeType(dataUrl[1]),
      revisedPrompt,
    };
  }

  const publicUrl = assertPublicHttpUrl(imageUrl, {
    fieldName: "generated image URL",
    createError: invalidResponseError,
  });
  const response = await providerFetch(publicUrl, { signal });
  if (!response.ok) {
    throw new ProviderRequestError(502, `Generated image download failed with HTTP ${response.status}.`);
  }
  const bytes = await readBoundedResponseBytes(response, {
    maxBytes,
    fieldName: "generated image",
    createError: (message) => new ProviderRequestError(413, message),
  });
  return {
    bytes,
    mimeType: detectImageMimeType(bytes) ?? normalizeImageMimeType(response.headers.get("content-type")),
    revisedPrompt,
  };
}

async function requestModelIds(input: {
  apiKey: string;
  baseUrl: string;
  fetcher: ProviderFetch;
  signal?: AbortSignal;
  phase: "validate" | "execute";
}): Promise<string[]> {
  const response = await input.fetcher(`${input.baseUrl}/models`, {
    headers: aiImageHeaders(input.apiKey),
    signal: input.signal,
  });
  const payload = await readAiImageJson(response, input.phase);
  const record = requireResponseRecord(payload, "models response");
  return optionalObjectArray(record.data, "model", invalidResponseError)
    .map((model) => optionalString(model.id))
    .filter((id): id is string => id !== undefined);
}

async function readAiImageJson(
  response: Response,
  phase: "validate" | "execute",
  imageMaxBytes?: number,
): Promise<unknown> {
  const maxBytes = imageMaxBytes
    ? Math.ceil(imageMaxBytes * maximumGeneratedImages * (4 / 3)) + imageResponseOverheadBytes
    : imageResponseOverheadBytes;
  const text = await readProviderTextBody(response, "Sub2API response", maxBytes);
  let payload: unknown;
  try {
    payload = text.trim() ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ProviderRequestError(502, "Sub2API returned an invalid JSON response.");
  }
  if (!response.ok) {
    const message = extractErrorMessage(payload) ?? `Sub2API request failed with HTTP ${response.status}.`;
    const status = phase === "validate" && (response.status === 401 || response.status === 403) ? 400 : response.status;
    throw new ProviderRequestError(status >= 500 ? 502 : status, message, payload);
  }
  return payload;
}

function aiImageHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": providerUserAgent,
  };
}

function assertContextBackend(context: AiImageContext, backend: AiImageBackend): void {
  if (context.backend !== backend) {
    throw new ProviderRequestError(500, "AI-Image provider backend configuration mismatch.");
  }
}

function filterImageModels(models: string[], backend: AiImageBackend): string[] {
  return models.filter((model) => model.toLowerCase().startsWith(modelPrefixes[backend])).sort();
}

function assertModelMatchesBackend(model: string, backend: AiImageBackend): void {
  if (!model.toLowerCase().startsWith(modelPrefixes[backend])) {
    throw new ProviderRequestError(
      400,
      `model must be a supported ${backend === "gpt" ? "GPT Image" : "Grok Imagine"} model`,
    );
  }
}

function requireResponseRecord(value: unknown, fieldName: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) {
    throw invalidResponseError(`${fieldName} must be an object`);
  }
  return record;
}

function extractErrorMessage(payload: unknown): string | undefined {
  const record = optionalRecord(payload);
  const error = optionalRecord(record?.error);
  return optionalString(error?.message) ?? optionalString(record?.message) ?? optionalString(record?.error);
}

function detectImageMimeType(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function mimeTypeForFormat(format: string): string {
  switch (format.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function normalizeImageMimeType(value: string | null | undefined): string {
  const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType?.startsWith("image/") ? mimeType : "image/png";
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}

function assertImageSize(size: number, maxBytes: number): void {
  if (size > maxBytes) {
    throw new ProviderRequestError(413, `Generated image exceeds the local transit file limit of ${maxBytes} bytes.`);
  }
}

function providerInputError(message: string): ProviderRequestError {
  return new ProviderRequestError(400, message);
}

function invalidResponseError(message: string): ProviderRequestError {
  return new ProviderRequestError(502, message);
}
