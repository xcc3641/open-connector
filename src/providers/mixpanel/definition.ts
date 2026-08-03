import type { ProviderDefinition } from "../../core/types.ts";

import { mixpanelActions } from "./actions.ts";
import { mixpanelMcpOAuthScopes } from "./scopes.ts";

const service = "mixpanel";

/**
 * Mixpanel provider.
 *
 * - oauth2: Free-plan-friendly path through Mixpanel's hosted MCP server
 *   (user browser login + PKCE public client). Preferred for agent access
 *   when Query API is not on the plan.
 * - api_key: Service-account Basic auth against Mixpanel Query/Export REST
 *   APIs (Growth/Enterprise Query API access).
 */
export const provider: ProviderDefinition = {
  service,
  displayName: "Mixpanel",
  description:
    "Query Mixpanel analytics through the hosted MCP OAuth path (Free-friendly) or the service-account Query/Export REST APIs (paid Query API).",
  categories: ["Data", "Marketing"],
  authTypes: ["oauth2", "api_key"],
  auth: [
    {
      type: "oauth2",
      authorizationUrl: "https://mixpanel.com/oauth/authorize",
      tokenUrl: "https://mixpanel.com/oauth/token/",
      refreshTokenUrl: "https://mixpanel.com/oauth/token/",
      scopes: [...mixpanelMcpOAuthScopes],
      tokenEndpointAuthMethod: "none",
      tokenRequestFormat: "form",
      pkce: {
        method: "S256",
      },
      tokenRequestFields: {
        clientSecret: false,
      },
      authorizationParams: {
        // RFC 8707 resource indicator for the US Mixpanel MCP server.
        resource: "https://mcp.mixpanel.com/mcp",
      },
      tokenParams: {
        // Same resource must be bound on code exchange and refresh (RFC 8707).
        resource: "https://mcp.mixpanel.com/mcp",
      },
    },
    {
      type: "api_key",
      label: "Service Account Secret",
      placeholder: "mixpanel_service_account_secret",
      description:
        "Mixpanel service account secret used with HTTP Basic authentication for project-scoped query APIs. Create it from Mixpanel Service Accounts: https://developer.mixpanel.com/reference/service-accounts-api. Query API access requires a paid Mixpanel plan (Growth/Enterprise).",
      extraFields: [
        {
          key: "serviceAccountUsername",
          label: "Service Account Username",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "svc_analytics_bot",
          description:
            "Mixpanel service account username paired with the secret for Basic auth. Find it on the same Mixpanel Service Accounts page.",
        },
        {
          key: "projectId",
          label: "Project ID",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "1234567",
          description:
            "Default Mixpanel project ID used for validation and for actions that omit project_id. Find it in Mixpanel project settings.",
        },
        {
          key: "baseUrl",
          label: "Base URL",
          inputType: "text",
          required: false,
          secret: false,
          placeholder: "https://mixpanel.com",
          description: "Optional Mixpanel query and app API base URL. Leave empty to use https://mixpanel.com.",
        },
        {
          key: "exportBaseUrl",
          label: "Export Base URL",
          inputType: "text",
          required: false,
          secret: false,
          placeholder: "https://data.mixpanel.com",
          description: "Optional Mixpanel raw export API base URL. Leave empty to use https://data.mixpanel.com.",
        },
      ],
    },
  ],
  homepageUrl: "https://mixpanel.com",
  actions: mixpanelActions,
};
