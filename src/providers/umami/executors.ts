import type { CredentialValidators, ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import type { UmamiActionContext } from "./runtime.ts";

import { defineProviderExecutors, ProviderRequestError } from "../provider-runtime.ts";
import { createUmamiActionContext, umamiActionHandlers, validateUmamiCredential } from "./runtime.ts";

const service = "umami";

export const executors: ProviderExecutors = defineProviderExecutors<UmamiActionContext>({
  service,
  handlers: umamiActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<UmamiActionContext> {
    const credential = await context.getCredential(service);
    if (credential?.authType === "api_key") {
      return createUmamiActionContext(
        {
          apiKey: credential.apiKey,
          values: credential.values,
        },
        fetcher,
        context.signal,
      );
    }
    if (credential?.authType === "custom_credential") {
      return createUmamiActionContext(
        {
          values: credential.values,
        },
        fetcher,
        context.signal,
      );
    }
    throw new ProviderRequestError(401, "Configure Umami API key or self-hosted login credentials first.");
  },
  fallbackMessage: "umami request failed",
});

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher, signal }) {
    return validateUmamiCredential(input, fetcher, signal);
  },
  customCredential(input, { fetcher, signal }) {
    return validateUmamiCredential(input, fetcher, signal);
  },
};
