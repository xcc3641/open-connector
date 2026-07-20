import type { JsonSchema, ProviderDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "context7";
const outputSchema = s.unknown(
  "Context7 documentation response. Most actions return curated markdown/text from Context7.",
);

export const context7ActionNames = ["resolve_library_id", "query_docs"] as const;
export type Context7ActionName = (typeof context7ActionNames)[number];

export const provider: ProviderDefinition = {
  service,
  displayName: "Context7",
  categories: ["Developer Tools", "Documentation", "AI"],
  authTypes: ["no_auth", "api_key"],
  auth: [
    { type: "no_auth" },
    {
      type: "api_key",
      label: "API Key",
      placeholder: "ctx7sk-...",
      description:
        "Optional Context7 API key for higher rate limits on the hosted MCP endpoint. Sent as the CONTEXT7_API_KEY HTTP header (format ctx7sk-...). Create one in the Context7 dashboard: https://context7.com/dashboard. Docs: https://context7.com/docs/howto/api-keys",
    },
  ],
  homepageUrl: "https://context7.com",
  actions: [
    action(
      "resolve_library_id",
      "Resolve a package, SDK, framework, API, CLI tool, or cloud service name to a Context7-compatible library ID. Call this before query_docs unless the user already provided a /org/project or /org/project/version library ID.",
      s.object(
        {
          libraryName: s.string(
            "Official library or product name, with proper punctuation where possible, for example 'Next.js', 'React', 'Prisma', or 'Customer.io'.",
          ),
          query: s.string(
            "The user question or task used to rank matching libraries. Do not include secrets, credentials, proprietary code, or personal data.",
          ),
        },
        { required: ["query", "libraryName"] },
      ),
    ),
    action(
      "query_docs",
      "Query up-to-date Context7 documentation and code examples for one library/framework/API topic. Use resolve_library_id first unless the user already provided a valid Context7 library ID.",
      s.object(
        {
          libraryId: s.string(
            "Exact Context7-compatible library ID, for example '/reactjs/react.dev', '/vercel/next.js', '/supabase/supabase', or '/vercel/next.js/v14.3.0-canary.87'.",
          ),
          query: s.string(
            "Specific documentation question scoped to a single concept. Do not include secrets, credentials, proprietary code, or personal data.",
          ),
        },
        { required: ["libraryId", "query"] },
      ),
    ),
  ],
};

function action(
  name: Context7ActionName,
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
