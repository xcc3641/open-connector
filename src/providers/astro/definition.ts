import type { JsonSchema, ProviderDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "astro";
const outputSchema = s.unknown(
  "Astro MCP tool result. JSON text content is parsed when possible; plain text is returned as text.",
);
const platformSchema = s.stringEnum(["iphone", "ipad", "mac", "appletv", "realityDevice"], {
  description: "Platform (default: iphone)",
});
const storeSchema = s.string("Store/country code, for example 'us', 'jp', 'cn', 'uk', or 'it'.");
const appIdSchema = s.string("App Store ID or tracked app ID.");
const appNameSchema = s.string("App name, matched partially by Astro when supported.");
const keywordSchema = s.string("Keyword text.");
const colorSchema = s.stringEnum(["red", "orange", "yellow", "green", "blue", "purple", "gray"], {
  description: "Tag color.",
});

export const astroActionNames = [
  "list_apps",
  "get_app_keywords",
  "search_rankings",
  "get_app_ratings",
  "extract_competitors_keywords",
  "add_app",
  "add_keywords",
  "remove_keywords",
  "set_keyword_note",
  "set_keyword_tag",
  "manage_tag",
  "search_app_store",
  "get_keyword_suggestions",
] as const;

export type AstroActionName = (typeof astroActionNames)[number];

export const provider: ProviderDefinition = {
  service,
  displayName: "Astro ASO",
  categories: ["Marketing", "Developer Tools", "Data"],
  authTypes: ["no_auth"],
  auth: [{ type: "no_auth" }],
  homepageUrl: "http://127.0.0.1:8089/mcp",
  actions: [
    action("list_apps", "List all apps tracked in Astro with keyword counts and stores.", s.object({})),
    action(
      "get_app_keywords",
      "Get all keywords tracked for a specific app.",
      s.object({
        appId: appIdSchema,
        appName: appNameSchema,
        store: s.string("Filter by store."),
      }),
    ),
    action(
      "search_rankings",
      "Search keyword rankings for apps, including current ranking, difficulty, popularity, metadata, optional history, and statistics.",
      s.object(
        {
          appId: s.string("Filter by app bundle ID (case-insensitive exact match)."),
          appName: s.string("Filter by app name (case-insensitive partial match)."),
          daysBack: s.integer("Number of days of history when includeHistory is true. Ignored if period is provided."),
          includeHistory: s.boolean("Whether to include historical ranking data points."),
          includeStatistics: s.boolean(
            "Whether to include average/min/max ranking, volatility, and trend. Requires includeHistory.",
          ),
          keyword: s.string("Keyword to search for (case-insensitive partial match)."),
          period: s.stringEnum(["week", "month", "year", "all"], {
            description: "History period. Overrides daysBack when includeHistory is true.",
          }),
          store: s.string("App Store country code, for example 'us', 'uk', or 'it'."),
        },
        { required: ["keyword", "store"] },
      ),
    ),
    action(
      "get_app_ratings",
      "Get app ratings by store/country. Set includeHistory to true to include full rating history.",
      s.object({
        appId: appIdSchema,
        appName: appNameSchema,
        includeHistory: s.boolean("Whether to include full historical rating data points."),
        store: s.string("Filter by store."),
      }),
    ),
    action(
      "extract_competitors_keywords",
      "Extract keyword ideas from competitor apps ranking for a tracked keyword, returning keyword ideas with popularity greater than 5 sorted by score.",
      s.object(
        {
          keyword: s.string("Keyword text. Must already be tracked in Astro."),
          store: storeSchema,
        },
        { required: ["keyword", "store"] },
      ),
    ),
    action(
      "add_app",
      "Add an App Store app to tracking by numeric ID, or create a temporary app placeholder for apps not yet published.",
      s.object({
        appStoreId: s.string("Numeric App Store ID. Required unless temporary is true."),
        name: s.string("Custom name for a temporary app."),
        platform: platformSchema,
        temporary: s.boolean("Whether to create a temporary app placeholder instead of fetching from the App Store."),
      }),
    ),
    action(
      "add_keywords",
      "Add up to 100 keywords to track for an app, fetching ranking, popularity, and difficulty from the App Store.",
      s.object(
        {
          appId: appIdSchema,
          appName: appNameSchema,
          keywords: s.array(s.string("Keyword to add."), { description: "Keywords to add.", maxItems: 100 }),
          platform: platformSchema,
          store: storeSchema,
        },
        { required: ["keywords", "store"] },
      ),
    ),
    action(
      "remove_keywords",
      "Remove one or more tracked keywords from an app. Destructive: list the keywords and get explicit user confirmation before calling this action.",
      s.object({
        appId: appIdSchema,
        appName: appNameSchema,
        keyword: s.string("Single keyword to remove. Alternative to keywords."),
        keywords: s.array(s.string("Keyword to remove."), { description: "Keywords to remove.", maxItems: 100 }),
        store: s.string("Store code. Required if the keyword exists in multiple stores; otherwise optional."),
      }),
    ),
    action(
      "set_keyword_note",
      "Set, update, or delete a note on a tracked keyword. Omit note or pass an empty string to delete the existing note.",
      s.object(
        {
          appId: appIdSchema,
          appName: appNameSchema,
          keyword: s.string("Keyword text, exact match."),
          note: s.string("Note text. Omit or pass empty string to delete."),
          store: s.string("Store code to narrow down if keyword exists in multiple stores."),
        },
        { required: ["keyword"] },
      ),
    ),
    action(
      "set_keyword_tag",
      "Add or remove a tag from a tracked keyword. The tag must already exist in Astro.",
      s.object(
        {
          action: s.stringEnum(["add", "remove"], { description: "Whether to assign or unassign the tag." }),
          appId: appIdSchema,
          appName: appNameSchema,
          keyword: s.string("Keyword text, exact match."),
          store: s.string("Store code to narrow down if keyword exists in multiple stores."),
          tag: s.string("Tag name, exact match."),
        },
        { required: ["keyword", "tag", "action"] },
      ),
    ),
    action(
      "manage_tag",
      "List, create, or update Astro tags.",
      s.object(
        {
          action: s.stringEnum(["list", "create", "update"], {
            description: "Tag management action.",
          }),
          color: colorSchema,
          name: s.string("Tag name. Required for create and update."),
          newName: s.string("New tag name when updating."),
        },
        { required: ["action"] },
      ),
    ),
    action(
      "search_app_store",
      "Search the App Store for a keyword or app name. Optionally pass your appId to include your ranking position.",
      s.object(
        {
          appId: s.string("Your app's App Store ID. Optional."),
          keyword: s.string("Search term, keyword, or app name."),
          limit: s.integer("Maximum results to return. Default 50, max 100."),
          platform: platformSchema,
          store: storeSchema,
        },
        { required: ["keyword", "store"] },
      ),
    ),
    action(
      "get_keyword_suggestions",
      "Get AI-powered keyword suggestions for an app, including popularity, difficulty, and app count.",
      s.object(
        {
          appId: appIdSchema,
          appName: appNameSchema,
          highPopularity: s.boolean("Whether to filter for high popularity suggestions. Default true."),
          store: storeSchema,
        },
        { required: ["store"] },
      ),
    ),
  ],
};

function action(
  name: AstroActionName,
  description: string,
  inputSchema: JsonSchema,
): ReturnType<typeof defineProviderAction> {
  return defineProviderAction(service, {
    name,
    description,
    inputSchema,
    outputSchema,
  });
}
