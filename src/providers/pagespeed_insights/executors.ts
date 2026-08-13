import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { defineApiKeyProviderExecutors } from "../provider-runtime.ts";
import { pagespeedInsightsActionHandlers, validatePagespeedInsightsCredential } from "./runtime.ts";

const service = "pagespeed_insights";

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, pagespeedInsightsActionHandlers);

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher, signal }) {
    return validatePagespeedInsightsCredential(input.apiKey, fetcher, signal);
  },
};
