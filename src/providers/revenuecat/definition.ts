import type { ProviderDefinition } from "../../core/types.ts";

import { revenuecatActions } from "./actions.ts";

const service = "revenuecat";

/**
 * RevenueCat provider backed by the public RevenueCat REST API v2.
 */
export const provider: ProviderDefinition = {
  service,
  displayName: "RevenueCat",
  categories: ["Developer Tools", "Payments"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "Secret API Key",
      placeholder: "sk_...",
      description:
        "RevenueCat API v2 secret key sent as a Bearer token. Create a secret key in RevenueCat Project Settings > API keys: https://www.revenuecat.com/docs/api-v2.",
    },
  ],
  homepageUrl: "https://www.revenuecat.com",
  actions: revenuecatActions,
};
