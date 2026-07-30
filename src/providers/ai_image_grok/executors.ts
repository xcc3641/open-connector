import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { isPrivateNetworkAccessAllowed } from "../../core/request.ts";
import { createAiImageActionHandlers, createAiImageContext, validateAiImageCredential } from "../ai-image-runtime.ts";
import { createProviderFetch, defineProviderExecutors } from "../provider-runtime.ts";

const service = "ai_image_grok";

export const executors: ProviderExecutors = defineProviderExecutors({
  service,
  handlers: createAiImageActionHandlers("grok"),
  allowPrivateNetwork: isPrivateNetworkAccessAllowed,
  createContext(executionContext, fetcher) {
    return createAiImageContext({ service, backend: "grok", executionContext, fetcher });
  },
});

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher, signal }) {
    return validateAiImageCredential({
      apiKey: input.apiKey,
      baseUrl: input.values.baseUrl,
      backend: "grok",
      displayName: "AI-Image Grok",
      fetcher: createProviderFetch({ fetch: fetcher, allowPrivateNetwork: isPrivateNetworkAccessAllowed }),
      signal,
    });
  },
};
