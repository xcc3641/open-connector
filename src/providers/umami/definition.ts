import type { ProviderDefinition } from "../../core/types.ts";

import { umamiActions } from "./actions.ts";

const service = "umami";

export const provider: ProviderDefinition = {
  service,
  displayName: "Umami",
  categories: ["Data", "Marketing"],
  authTypes: ["api_key", "custom_credential"],
  auth: [
    {
      type: "api_key",
      label: "API Key",
      placeholder: "umami_api_key",
      description:
        "Umami API key used as an Authorization Bearer token. Defaults to Umami Cloud; set Base URL for a self-hosted instance that accepts bearer tokens.",
      extraFields: [
        {
          key: "baseUrl",
          label: "Base URL",
          inputType: "text",
          required: false,
          secret: false,
          placeholder: "https://api.umami.is or https://umi.example.com",
          description:
            "Optional Umami API base URL. Use https://api.umami.is for Umami Cloud or your self-hosted instance origin, without /api.",
        },
      ],
    },
    {
      type: "custom_credential",
      fields: [
        {
          key: "baseUrl",
          label: "Base URL",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "https://umi.example.com",
          description: "Self-hosted Umami instance origin, without /api.",
        },
        {
          key: "username",
          label: "Username",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "admin",
          description: "Self-hosted Umami username used for /api/auth/login.",
        },
        {
          key: "password",
          label: "Password",
          inputType: "password",
          required: true,
          secret: true,
          placeholder: "umami_password",
          description:
            "Self-hosted Umami password used for /api/auth/login. It is exchanged for a short-lived bearer token at execution time.",
        },
      ],
      testAction: {
        actionName: "get_current_user",
        input: {},
      },
    },
  ],
  homepageUrl: "https://umami.is",
  actions: umamiActions,
};
