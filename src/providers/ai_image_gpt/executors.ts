import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { isPrivateNetworkAccessAllowed } from "../../core/request.ts";
import { createAiImageActionHandlers, createAiImageContext, validateAiImageCredential } from "../ai-image-runtime.ts";
import { createProviderFetch, defineProviderExecutors } from "../provider-runtime.ts";

const service = "ai_image_gpt";

export const executors: ProviderExecutors = defineProviderExecutors({
  service,
  handlers: createAiImageActionHandlers("gpt"),
  allowPrivateNetwork: isPrivateNetworkAccessAllowed,
  createContext(executionContext, fetcher) {
    return createAiImageContext({ service, backend: "gpt", executionContext, fetcher });
  },
});

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher, signal }) {
    return validateAiImageCredential({
      apiKey: input.apiKey,
      baseUrl: input.values.baseUrl,
      backend: "gpt",
      displayName: "AI-Image GPT",
      fetcher: createProviderFetch({ fetch: fetcher, allowPrivateNetwork: isPrivateNetworkAccessAllowed }),
      signal,
    });
  },
};
