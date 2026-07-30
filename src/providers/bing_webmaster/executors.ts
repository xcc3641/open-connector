import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { defineApiKeyProviderExecutors } from "../provider-runtime.ts";
import { bingWebmasterActionHandlers, validateBingWebmasterCredential } from "./runtime.ts";

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(
  "bing_webmaster",
  bingWebmasterActionHandlers,
);

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    return validateBingWebmasterCredential(input.apiKey, fetcher, signal);
  },
};
