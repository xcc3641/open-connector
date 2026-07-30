import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "bing_webmaster";

export type BingWebmasterActionName =
  | "list_sites"
  | "add_site"
  | "verify_site"
  | "remove_site"
  | "get_site_roles"
  | "submit_url"
  | "submit_url_batch"
  | "get_url_submission_quota"
  | "list_sitemaps"
  | "submit_sitemap"
  | "remove_sitemap"
  | "get_sitemap_details"
  | "get_rank_and_traffic_stats"
  | "get_query_stats"
  | "get_page_stats"
  | "get_page_query_stats"
  | "get_crawl_stats"
  | "get_crawl_issues"
  | "get_keyword"
  | "get_related_keywords"
  | "get_keyword_stats";

const siteUrlField = s.string({
  description: "Site URL exactly as registered in Bing Webmaster Tools, such as https://www.example.com.",
  minLength: 1,
});

const pageUrlField = s.string({
  description: "A fully qualified page URL under the site.",
  minLength: 1,
});

const feedUrlField = s.string({
  description: "A fully qualified sitemap or feed URL under the site.",
  minLength: 1,
});

const keywordField = s.string({
  description: "Search keyword or query string.",
  minLength: 1,
});

const countryField = s.string({
  description: "Two-letter country/region code used by Bing keyword research, such as us or gb.",
  minLength: 2,
  maxLength: 2,
});

const languageField = s.string({
  description: "Language or locale code used by Bing keyword research, such as en-US or zh-CN.",
  minLength: 2,
});

const dateField = (description: string) => s.date(description);

const successSchema = s.object("Result of a successful Bing Webmaster write operation.", {
  success: s.literal(true, {
    description: "Whether the operation completed successfully.",
  }),
});

const siteSchema = s.object(
  "A site registered in Bing Webmaster Tools.",
  {
    url: s.string("The registered site URL."),
    isVerified: s.boolean("Whether site ownership has been verified."),
    authenticationCode: s.nullableString("Meta-tag verification code when Bing returns one."),
    dnsVerificationCode: s.nullableString("DNS TXT verification code when Bing returns one."),
  },
  {
    required: ["url", "isVerified"],
    optional: ["authenticationCode", "dnsVerificationCode"],
    additionalProperties: true,
  },
);

const siteRoleSchema = s.looseObject("A role or owner entry for a Bing Webmaster site.", {
  email: s.nullableString("Email address associated with the role."),
  role: s.nullableString("Role name when Bing returns one."),
  date: s.nullableString("When the role was assigned, when Bing returns one."),
});

const urlQuotaSchema = s.object(
  "Remaining URL submission quota for a site.",
  {
    dailyQuota: s.integer("Remaining daily URL submission quota."),
    monthlyQuota: s.integer("Remaining monthly URL submission quota."),
  },
  {
    required: ["dailyQuota", "monthlyQuota"],
    additionalProperties: true,
  },
);

const sitemapSchema = s.looseObject("A sitemap or feed submitted to Bing Webmaster Tools.", {
  url: s.nullableString("The sitemap or feed URL."),
  type: s.nullableString("Feed type reported by Bing, such as RSS or Sitemap."),
  status: s.nullableString("Current feed status reported by Bing."),
  submitted: s.nullableString("When the feed was submitted."),
  lastCrawled: s.nullableString("When Bing last crawled the feed."),
  fileSize: s.nullable(s.integer("Feed file size in bytes when Bing returns one.")),
  compressed: s.nullable(s.boolean("Whether Bing reports the feed as compressed.")),
  urlCount: s.nullable(s.integer("Number of URLs in the feed when Bing returns one.")),
});

const rankTrafficStatSchema = s.looseObject("Daily rank and traffic statistics for a site.", {
  date: s.nullableString("Statistics date."),
  clicks: s.nullable(s.integer("Click count for the day.")),
  impressions: s.nullable(s.integer("Impression count for the day.")),
});

const queryStatSchema = s.looseObject("Search query or page traffic statistics returned by Bing.", {
  query: s.nullableString("Search query text when present."),
  page: s.nullableString("Page URL when present."),
  date: s.nullableString("Statistics date when present."),
  clicks: s.nullable(s.integer("Click count.")),
  impressions: s.nullable(s.integer("Impression count.")),
  avgClickPosition: s.nullable(s.number("Average click position.")),
  avgImpressionPosition: s.nullable(s.number("Average impression position.")),
});

const crawlStatSchema = s.looseObject("Daily crawl statistics for a site.", {
  date: s.nullableString("Crawl statistics date."),
  crawledPages: s.nullable(s.integer("Number of pages crawled when Bing returns one.")),
  code2xx: s.nullable(s.integer("Count of 2xx responses.")),
  code301: s.nullable(s.integer("Count of 301 responses.")),
  code302: s.nullable(s.integer("Count of 302 responses.")),
  code4xx: s.nullable(s.integer("Count of 4xx responses.")),
  code5xx: s.nullable(s.integer("Count of 5xx responses.")),
  blockedByRobotsTxt: s.nullable(s.integer("Count of pages blocked by robots.txt.")),
  allOtherCodes: s.nullable(s.integer("Count of other HTTP status codes.")),
});

const crawlIssueSchema = s.looseObject("A crawl issue reported for a site URL.", {
  url: s.nullableString("URL with the crawl issue."),
  httpCode: s.nullable(s.integer("HTTP status code when Bing returns one.")),
  issueType: s.nullableString("Issue type or category when Bing returns one."),
  message: s.nullableString("Human-readable issue details when Bing returns one."),
  inLinks: s.nullable(s.integer("Inbound link count when Bing returns one.")),
});

const keywordSchema = s.looseObject("Keyword research row returned by Bing.", {
  query: s.nullableString("Keyword or query text."),
  impressions: s.nullable(s.integer("Exact-match impression count.")),
  broadImpressions: s.nullable(s.integer("Broad-match impression count.")),
  date: s.nullableString("Statistics date when present."),
});

const siteOnlyInput = s.object(
  "Input that targets one Bing Webmaster site.",
  {
    siteUrl: siteUrlField,
  },
  { required: ["siteUrl"] },
);

export const bingWebmasterActions: ActionDefinition[] = [
  defineProviderAction(service, {
    name: "list_sites",
    description: "List all sites registered under the Bing Webmaster Tools account for this API key.",
    inputSchema: s.object("Input parameters for listing Bing Webmaster sites.", {}),
    outputSchema: s.object(
      "Sites visible to the connected Bing Webmaster account.",
      {
        sites: s.array("Sites returned by Bing Webmaster Tools.", siteSchema),
      },
      { required: ["sites"] },
    ),
  }),
  defineProviderAction(service, {
    name: "add_site",
    description: "Add a site to the Bing Webmaster Tools account. Ownership still needs verification.",
    inputSchema: siteOnlyInput,
    outputSchema: successSchema,
  }),
  defineProviderAction(service, {
    name: "verify_site",
    description: "Trigger ownership verification for a site after placing the meta tag or DNS verification token.",
    inputSchema: siteOnlyInput,
    outputSchema: s.object(
      "Site verification result.",
      {
        verified: s.boolean("Whether Bing reported the site as verified after this call."),
      },
      { required: ["verified"] },
    ),
  }),
  defineProviderAction(service, {
    name: "remove_site",
    description: "Remove a site from the Bing Webmaster Tools account.",
    inputSchema: siteOnlyInput,
    outputSchema: successSchema,
  }),
  defineProviderAction(service, {
    name: "get_site_roles",
    description: "List owners and delegated roles for a Bing Webmaster site.",
    inputSchema: siteOnlyInput,
    outputSchema: s.object(
      "Roles returned for a Bing Webmaster site.",
      {
        roles: s.array("Role entries returned by Bing Webmaster Tools.", siteRoleSchema),
      },
      { required: ["roles"] },
    ),
  }),
  defineProviderAction(service, {
    name: "submit_url",
    description: "Submit a single URL for Bing indexing under a verified site.",
    inputSchema: s.object(
      "Input parameters for submitting one URL to Bing.",
      {
        siteUrl: siteUrlField,
        url: pageUrlField,
      },
      { required: ["siteUrl", "url"] },
    ),
    outputSchema: successSchema,
  }),
  defineProviderAction(service, {
    name: "submit_url_batch",
    description: "Submit multiple URLs for Bing indexing in one request under a verified site.",
    inputSchema: s.object(
      "Input parameters for batch URL submission to Bing.",
      {
        siteUrl: siteUrlField,
        urlList: s.array("URLs to submit for indexing.", pageUrlField, {
          minItems: 1,
        }),
      },
      { required: ["siteUrl", "urlList"] },
    ),
    outputSchema: successSchema,
  }),
  defineProviderAction(service, {
    name: "get_url_submission_quota",
    description: "Get remaining daily and monthly URL submission quota for a site.",
    inputSchema: siteOnlyInput,
    outputSchema: s.object(
      "URL submission quota for a site.",
      {
        quota: urlQuotaSchema,
      },
      { required: ["quota"] },
    ),
  }),
  defineProviderAction(service, {
    name: "list_sitemaps",
    description: "List sitemaps and feeds submitted for a Bing Webmaster site.",
    inputSchema: siteOnlyInput,
    outputSchema: s.object(
      "Sitemaps returned for a Bing Webmaster site.",
      {
        sitemaps: s.array("Sitemaps or feeds returned by Bing Webmaster Tools.", sitemapSchema),
      },
      { required: ["sitemaps"] },
    ),
  }),
  defineProviderAction(service, {
    name: "submit_sitemap",
    description: "Submit a sitemap or feed URL for a Bing Webmaster site.",
    inputSchema: s.object(
      "Input parameters for submitting a sitemap to Bing.",
      {
        siteUrl: siteUrlField,
        feedUrl: feedUrlField,
      },
      { required: ["siteUrl", "feedUrl"] },
    ),
    outputSchema: successSchema,
  }),
  defineProviderAction(service, {
    name: "remove_sitemap",
    description: "Remove a previously submitted sitemap or feed from a Bing Webmaster site.",
    inputSchema: s.object(
      "Input parameters for removing a sitemap from Bing.",
      {
        siteUrl: siteUrlField,
        feedUrl: feedUrlField,
      },
      { required: ["siteUrl", "feedUrl"] },
    ),
    outputSchema: successSchema,
  }),
  defineProviderAction(service, {
    name: "get_sitemap_details",
    description: "Get details for one sitemap or feed under a Bing Webmaster site.",
    inputSchema: s.object(
      "Input parameters for fetching one Bing sitemap.",
      {
        siteUrl: siteUrlField,
        feedUrl: feedUrlField,
      },
      { required: ["siteUrl", "feedUrl"] },
    ),
    outputSchema: s.object(
      "Sitemap details returned by Bing Webmaster Tools.",
      {
        sitemaps: s.array("Detailed feed entries returned by Bing.", sitemapSchema),
      },
      { required: ["sitemaps"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_rank_and_traffic_stats",
    description: "Get daily clicks and impressions traffic statistics for a site.",
    inputSchema: siteOnlyInput,
    outputSchema: s.object(
      "Rank and traffic statistics for a site.",
      {
        stats: s.array("Daily rank and traffic rows.", rankTrafficStatSchema),
      },
      { required: ["stats"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_query_stats",
    description: "Get top search query performance statistics for a site.",
    inputSchema: siteOnlyInput,
    outputSchema: s.object(
      "Query statistics for a site.",
      {
        stats: s.array("Query performance rows.", queryStatSchema),
      },
      { required: ["stats"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_page_stats",
    description: "Get top page performance statistics for a site.",
    inputSchema: siteOnlyInput,
    outputSchema: s.object(
      "Page statistics for a site.",
      {
        stats: s.array("Page performance rows.", queryStatSchema),
      },
      { required: ["stats"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_page_query_stats",
    description: "Get search query performance statistics for one page under a site.",
    inputSchema: s.object(
      "Input parameters for page query statistics.",
      {
        siteUrl: siteUrlField,
        page: pageUrlField,
      },
      { required: ["siteUrl", "page"] },
    ),
    outputSchema: s.object(
      "Query statistics for one page.",
      {
        stats: s.array("Query performance rows for the page.", queryStatSchema),
      },
      { required: ["stats"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_crawl_stats",
    description: "Get daily crawl statistics for a site.",
    inputSchema: siteOnlyInput,
    outputSchema: s.object(
      "Crawl statistics for a site.",
      {
        stats: s.array("Daily crawl statistic rows.", crawlStatSchema),
      },
      { required: ["stats"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_crawl_issues",
    description: "Get crawl issues and errors reported for a site.",
    inputSchema: siteOnlyInput,
    outputSchema: s.object(
      "Crawl issues for a site.",
      {
        issues: s.array("Crawl issue rows.", crawlIssueSchema),
      },
      { required: ["issues"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_keyword",
    description: "Get impression data for an exact keyword in a country and language over a date range.",
    inputSchema: s.object(
      "Input parameters for Bing keyword research.",
      {
        q: keywordField,
        country: countryField,
        language: languageField,
        startDate: dateField("Inclusive start date in YYYY-MM-DD format."),
        endDate: dateField("Inclusive end date in YYYY-MM-DD format."),
      },
      { required: ["q", "country", "language", "startDate", "endDate"] },
    ),
    outputSchema: s.object(
      "Keyword research result.",
      {
        keywords: s.array("Keyword rows returned by Bing.", keywordSchema),
      },
      { required: ["keywords"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_related_keywords",
    description: "Get related keywords for a query in a country and language over a date range.",
    inputSchema: s.object(
      "Input parameters for Bing related keyword research.",
      {
        q: keywordField,
        country: countryField,
        language: languageField,
        startDate: dateField("Inclusive start date in YYYY-MM-DD format."),
        endDate: dateField("Inclusive end date in YYYY-MM-DD format."),
      },
      { required: ["q", "country", "language", "startDate", "endDate"] },
    ),
    outputSchema: s.object(
      "Related keyword research result.",
      {
        keywords: s.array("Related keyword rows returned by Bing.", keywordSchema),
      },
      { required: ["keywords"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_keyword_stats",
    description: "Get historical keyword impression statistics for a query in a country and language.",
    inputSchema: s.object(
      "Input parameters for Bing historical keyword statistics.",
      {
        q: keywordField,
        country: countryField,
        language: languageField,
      },
      { required: ["q", "country", "language"] },
    ),
    outputSchema: s.object(
      "Historical keyword statistics result.",
      {
        keywords: s.array("Historical keyword statistic rows returned by Bing.", keywordSchema),
      },
      { required: ["keywords"] },
    ),
  }),
];
