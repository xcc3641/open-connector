/**
 * OAuth scopes advertised by the US Mixpanel MCP authorization server.
 *
 * Source: https://mcp.mixpanel.com/.well-known/oauth-authorization-server/mcp
 */
export const mixpanelMcpOAuthScopes = [
  "projects",
  "analysis",
  "events",
  "insights",
  "segmentation",
  "retention",
  "data:read",
  "funnels",
  "flows",
  "data_definitions",
  "bookmarks",
  "business_context",
  "cohorts",
  "dashboard_reports",
  "experiments",
  "feature_flags",
  "metrics",
  "user_details",
] as const;

export type MixpanelMcpOAuthScope = (typeof mixpanelMcpOAuthScopes)[number];
