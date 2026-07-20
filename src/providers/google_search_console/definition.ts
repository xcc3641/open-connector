import type { ProviderDefinition } from "../../core/types.ts";

import { googleSearchConsoleActions } from "./actions.ts";
import { googleSearchConsoleOAuthScopes } from "./scopes.ts";

const service = "google_search_console";

/**
 * Google Search Console provider backed by the Search Console and URL Inspection APIs.
 *
 * Supports:
 * - OAuth2 user consent (browser flow)
 * - Google service-account JSON (JWT bearer), same model as local `gsc.sh`
 */
export const provider: ProviderDefinition = {
  service,
  displayName: "Google Search Console",
  categories: ["Data", "Marketing"],
  authTypes: ["oauth2", "custom_credential"],
  auth: [
    {
      type: "oauth2",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: googleSearchConsoleOAuthScopes,
      tokenEndpointAuthMethod: "client_secret_post",
      authorizationParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
    {
      type: "custom_credential",
      fields: [
        {
          key: "serviceAccountJson",
          label: "Service Account JSON",
          inputType: "textarea",
          required: true,
          secret: true,
          placeholder: '{"type":"service_account","client_email":"…","private_key":"…"}',
          description:
            "Full Google Cloud service-account key JSON. The account must be added as a user on each Search Console property. Same credential model as local gsc.sh.",
        },
      ],
      testAction: {
        actionName: "list_sites",
        input: {},
      },
    },
  ],
  homepageUrl: "https://search.google.com/search-console",
  actions: googleSearchConsoleActions,
};
