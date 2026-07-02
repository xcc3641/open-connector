import type { CredentialValidators, ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import type { N8nActionContext } from "./runtime.ts";

import { defineProviderExecutors, requireApiKeyCredential } from "../provider-runtime.ts";
import { createN8nActionContext, n8nActionHandlers, validateN8nCredential } from "./runtime.ts";

const service = "n8n";

export const executors: ProviderExecutors = defineProviderExecutors<N8nActionContext>({
  service,
  handlers: n8nActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<N8nActionContext> {
    return createN8nActionContext(await requireApiKeyCredential(context, service), fetcher, context.signal);
  },
});

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher, signal }) {
    return validateN8nCredential(input, fetcher, signal);
  },
};
