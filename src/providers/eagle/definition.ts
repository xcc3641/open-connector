import type { ProviderDefinition } from "../../core/types.ts";

import { eagleActions } from "./actions.ts";

const service = "eagle";

export const provider: ProviderDefinition = {
  service,
  displayName: "Eagle",
  description: "Manage digital assets, images, videos, folders, and tags on a local Eagle application.",
  categories: ["Productivity", "Media", "Design"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "API Token",
      placeholder: "Optional Eagle API Token",
      description:
        "Optional API Token configured in Eagle Preferences > Developer > API Token. Leave empty if API Token verification is disabled in Eagle.",
      extraFields: [
        {
          key: "baseUrl",
          label: "Eagle API URL",
          inputType: "text",
          required: false,
          secret: false,
          placeholder: "http://127.0.0.1:41595",
          description:
            "Local Eagle API URL (default: http://127.0.0.1:41595, or http://host.docker.internal:41595 if running in Docker container). Requires Eagle application to be running with private network access enabled.",
        },
      ],
    },
  ],
  homepageUrl: "https://eagle.cool",
  actions: eagleActions,
};
