import type { ProviderDefinition } from "../../core/types.ts";

import { bingWebmasterActions } from "./actions.ts";

const service = "bing_webmaster";

/**
 * Bing Webmaster Tools provider backed by the JSON Webmaster API and a per-user API key.
 *
 * API key is generated in Bing Webmaster Tools → Settings → API Access and works across all
 * verified sites on that account.
 *
 * Docs: https://learn.microsoft.com/en-us/bingwebmaster/
 */
export const provider: ProviderDefinition = {
  service,
  displayName: "Bing Webmaster Tools",
  categories: ["Marketing", "Data"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "API Key",
      placeholder: "Bing Webmaster API key",
      description:
        "Bing Webmaster Tools API key sent as the apikey query parameter. Generate it in Bing Webmaster Tools → Settings → API Access: https://www.bing.com/webmasters/.",
    },
  ],
  homepageUrl: "https://www.bing.com/webmasters/",
  actions: bingWebmasterActions,
};
