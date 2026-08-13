import type { ProviderDefinition } from "../../core/types.ts";

import { pagespeedInsightsActions } from "./actions.ts";

const service = "pagespeed_insights";

/**
 * Google PageSpeed Insights provider backed by the PageSpeed Insights API v5.
 */
export const provider: ProviderDefinition = {
  service,
  displayName: "PageSpeed Insights",
  categories: ["Developer Tools", "Data", "Marketing"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "API Key",
      placeholder: "AIza...",
      description:
        "Google Cloud API key sent as the key query parameter. Enable the PageSpeed Insights API and create a key in Google Cloud Console: https://developers.google.com/speed/docs/insights/v5/get-started.",
    },
  ],
  homepageUrl: "https://pagespeed.web.dev/",
  actions: pagespeedInsightsActions,
};
