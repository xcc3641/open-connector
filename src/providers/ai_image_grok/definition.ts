import type { ProviderDefinition } from "../../core/types.ts";

import { aiImageGrokActions } from "./actions.ts";

const service = "ai_image_grok";

export const provider: ProviderDefinition = {
  service,
  displayName: "AI-Image Grok",
  description: "Generate Grok Imagine images through a self-hosted Sub2API gateway.",
  categories: ["AI", "Design"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "Sub2API API Key",
      placeholder: "sk-...",
      description:
        "A Sub2API API key bound to a Grok group with image generation enabled. The key is sent as a Bearer token.",
      extraFields: [
        {
          key: "baseUrl",
          label: "Sub2API Base URL",
          inputType: "text",
          required: false,
          secret: false,
          placeholder: "http://host.docker.internal:18080/v1",
          description:
            "Optional override. Leave empty to use the local Sub2API deployment at http://host.docker.internal:18080/v1.",
        },
      ],
    },
  ],
  homepageUrl: "https://github.com/Wei-Shaw/sub2api",
  actions: aiImageGrokActions,
};
