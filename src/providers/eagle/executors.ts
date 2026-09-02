import type {
  CredentialValidationResult,
  CredentialValidators,
  ExecutionContext,
  ProviderExecutors,
  ProviderProxyExecutor,
} from "../../core/types.ts";
import type { EagleActionContext } from "./runtime.ts";

import { optionalString } from "../../core/cast.ts";
import { isPrivateNetworkAccessAllowed } from "../../core/request.ts";
import {
  createProviderFetch,
  defineProviderExecutors,
  defineProviderProxy,
  requireApiKeyCredential,
} from "../provider-runtime.ts";
import { createEagleContext, eagleActionHandlers, normalizeEagleBaseUrl, validateEagleCredential } from "./runtime.ts";

const service = "eagle";

export const executors: ProviderExecutors = defineProviderExecutors<EagleActionContext>({
  service,
  handlers: eagleActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<EagleActionContext> {
    const credential = await requireApiKeyCredential(context, service);
    const guardedFetcher = createProviderFetch({
      fetch: fetcher,
      allowPrivateNetwork: isPrivateNetworkAccessAllowed,
      skipDnsValidation: true,
    });
    return createEagleContext(credential.values, credential.apiKey, guardedFetcher, context.signal);
  },
  fallbackMessage: "Eagle request failed",
  allowPrivateNetwork: isPrivateNetworkAccessAllowed,
  skipDnsValidation: true,
});

export const proxy: ProviderProxyExecutor = defineProviderProxy({
  service,
  baseUrl: async (context) => {
    const credential = await requireApiKeyCredential(context, service);
    const value =
      optionalString(credential.metadata.apiBaseUrl) ??
      optionalString(credential.metadata.baseUrl) ??
      optionalString(credential.values.baseUrl);
    return normalizeEagleBaseUrl(value);
  },
  auth: { type: "api_key_query", name: "token" },
  allowPrivateNetwork: isPrivateNetworkAccessAllowed,
  skipDnsValidation: true,
});

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher, signal }): Promise<CredentialValidationResult> {
    const guardedFetcher = createProviderFetch({
      fetch: fetcher,
      allowPrivateNetwork: isPrivateNetworkAccessAllowed,
      skipDnsValidation: true,
    });
    return validateEagleCredential(input.values, input.apiKey, guardedFetcher, signal);
  },
};
