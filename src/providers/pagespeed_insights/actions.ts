import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "pagespeed_insights";

export type PagespeedInsightsActionName = "runPagespeed";

const strategySchema = s.stringEnum("The analysis strategy to use. Desktop is the API default.", [
  "STRATEGY_UNSPECIFIED",
  "DESKTOP",
  "MOBILE",
]);

const categorySchema = s.stringEnum("A Lighthouse category to run.", [
  "CATEGORY_UNSPECIFIED",
  "ACCESSIBILITY",
  "BEST_PRACTICES",
  "PERFORMANCE",
  "PWA",
  "SEO",
  "AGENTIC_BROWSING",
]);

const categoryScoreSchema = s.looseObject("A Lighthouse category score summary.", {
  id: s.string("Category id returned by Lighthouse."),
  title: s.string("Human-readable category title."),
  score: s.number("Category score from 0 to 1 when available."),
  description: s.string("Optional category description."),
  manualDescription: s.string("Optional manual description for the category."),
});

const loadingExperienceSchema = s.looseObject("Chrome UX Report loading experience metrics.", {
  id: s.string("URL or origin id for the loading experience payload."),
  overall_category: s.string("Overall CrUX category such as FAST, AVERAGE, or SLOW."),
  initial_url: s.string("Initial URL associated with the loading experience payload."),
  origin_fallback: s.boolean("Whether origin-level data was used as a fallback."),
  metrics: s.unknownObject("CrUX metric distributions keyed by metric id."),
});

const lighthouseResultSchema = s.looseObject("Lighthouse result payload returned by PageSpeed Insights.", {
  requestedUrl: s.string("URL requested for analysis."),
  finalUrl: s.string("Final URL after redirects."),
  mainDocumentUrl: s.string("Main document URL analyzed by Lighthouse."),
  finalDisplayedUrl: s.string("Final displayed URL reported by Lighthouse."),
  lighthouseVersion: s.string("Lighthouse version used for the run."),
  userAgent: s.string("User agent string used during analysis."),
  fetchTime: s.string("Timestamp when Lighthouse fetched the page."),
  runWarnings: s.array("Warnings emitted during the Lighthouse run.", s.unknown("A run warning value.")),
  configSettings: s.unknownObject("Lighthouse config settings used for the run."),
  environment: s.unknownObject("Environment metadata for the Lighthouse run."),
  categories: s.record("Lighthouse categories keyed by category id.", categoryScoreSchema),
  categoryGroups: s.unknownObject("Lighthouse category group metadata."),
  audits: s.unknownObject("Full Lighthouse audit results keyed by audit id."),
  timing: s.unknownObject("Lighthouse timing metadata."),
  i18n: s.unknownObject("Internationalization metadata from Lighthouse."),
  stackPacks: s.array("Stack packs attached to the Lighthouse result.", s.unknownObject("A stack pack entry.")),
  entities: s.array("Entity metadata attached to the Lighthouse result.", s.unknownObject("An entity entry.")),
  fullPageScreenshot: s.unknownObject("Full-page screenshot payload when requested by Lighthouse."),
  runtimeError: s.unknownObject("Runtime error details when Lighthouse failed partially."),
});

const runPagespeedOutputSchema = s.looseObject("PageSpeed Insights runPagespeed response.", {
  id: s.string("Canonical id for the analyzed page."),
  kind: s.string("Resource kind returned by the PageSpeed Insights API."),
  analysisUTCTimestamp: s.string("UTC timestamp when the analysis completed."),
  captchaResult: s.string("Captcha result status when a captcha challenge was involved."),
  version: s.unknownObject("PageSpeed Insights API version metadata."),
  loadingExperience: loadingExperienceSchema,
  originLoadingExperience: loadingExperienceSchema,
  lighthouseResult: lighthouseResultSchema,
  categories: s.record(
    "Convenience map of Lighthouse category summaries extracted from lighthouseResult.categories.",
    categoryScoreSchema,
  ),
});

export const pagespeedInsightsActions: ActionDefinition[] = [
  defineProviderAction(service, {
    name: "runPagespeed",
    description:
      "Run Google PageSpeed Insights / Lighthouse analysis for a URL and return scores, audits, and CrUX loading experience data.",
    requiredScopes: [],
    inputSchema: s.object(
      "Input parameters for PageSpeed Insights runPagespeed.",
      {
        url: s.nonEmptyString("Required URL to fetch and analyze. Must be an http(s) URL."),
        strategy: strategySchema,
        category: s.array(categorySchema, {
          description: "Lighthouse categories to run. Repeatable. If omitted, only the Performance category is run.",
          minItems: 1,
        }),
        locale: s.nonEmptyString("Locale used to localize formatted results, such as en or en_US."),
        captchaToken: s.nonEmptyString("Captcha token when filling out a captcha challenge."),
        utmCampaign: s.nonEmptyString("Optional campaign name for analytics."),
        utmSource: s.nonEmptyString("Optional campaign source for analytics."),
        fields: s.nonEmptyString(
          "Optional Google API fields selector to reduce response size, such as id,analysisUTCTimestamp,lighthouseResult(categories).",
        ),
      },
      {
        optional: ["strategy", "category", "locale", "captchaToken", "utmCampaign", "utmSource", "fields"],
      },
    ),
    outputSchema: runPagespeedOutputSchema,
  }),
];
