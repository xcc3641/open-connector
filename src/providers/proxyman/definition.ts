import type { JsonSchema, ProviderDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "proxyman";
const outputSchema = s.unknown(
  "Read-only Proxyman MCP result. Structured JSON data is returned when available; plain text is returned as text.",
);

const flowIdSchema = s.string("The unique identifier of the captured Proxyman flow.");
const httpMethodSchema = s.string("HTTP method filter, for example GET, POST, PUT, PATCH, DELETE, OPTIONS, or HEAD.");
const filterKeySchema = s.stringEnum(
  ["url", "host", "method", "statusCode", "requestHeader", "responseHeader", "requestBody", "responseBody"],
  { description: "Captured flow field to filter." },
);
const filterMatchingSchema = s.stringEnum(
  ["contains", "notContains", "startWith", "endWith", "equal", "notEqual", "regex", "wildcard"],
  { description: "String matching mode. Default: contains." },
);
const ruleTypeSchema = s.stringEnum(
  [
    "all",
    "breakpoint",
    "maplocal",
    "mapremote",
    "blacklist",
    "scripting",
    "whitelist",
    "reverse_proxy",
    "network_condition",
    "dns_spoofing",
  ],
  { description: "Type of Proxyman rule to list. Default: all." },
);

export const proxymanActionNames = [
  "get_version",
  "get_proxy_status",
  "get_system_proxy_status",
  "get_flows",
  "get_flow_detail",
  "filter_flows",
  "export_flow_curl",
  "list_rules",
  "get_ssl_proxying_list",
  "get_certificate_status",
] as const;

export type ProxymanActionName = (typeof proxymanActionNames)[number];

export const provider: ProviderDefinition = {
  service,
  displayName: "Proxyman",
  categories: ["Developer Tools", "Observability", "Debugging"],
  authTypes: ["no_auth"],
  auth: [{ type: "no_auth" }],
  homepageUrl: "https://proxyman.com",
  actions: [
    action("get_version", "Read the current Proxyman app version and build number.", s.object({})),
    action(
      "get_proxy_status",
      "Read current Proxyman proxy status including recording state, proxy port, and SSL proxying state.",
      s.object({}),
    ),
    action(
      "get_system_proxy_status",
      "Read whether Proxyman is currently overriding the macOS system proxy settings.",
      s.object({}),
    ),
    action(
      "get_flows",
      "Read recent HTTP/HTTPS flows captured by Proxyman. Sensitive headers are redacted by Proxyman when its redaction setting is enabled.",
      s.object({
        host_filter: s.string("Filter flows by host using a case-insensitive substring match."),
        limit: s.integer({ description: "Maximum number of flows to return. Default 50, max 500.", default: 50 }),
        method_filter: httpMethodSchema,
        status_filter: s.integer("Filter flows by HTTP status code, for example 200, 404, or 500."),
      }),
    ),
    action(
      "get_flow_detail",
      "Read full details for one captured Proxyman flow, including headers, body preview, query params, cookies, and matched debugging tools.",
      s.object({ flow_id: flowIdSchema }, { required: ["flow_id"] }),
    ),
    action(
      "filter_flows",
      "Read captured flows matching one or more advanced filters. This does not mutate the Proxyman session.",
      s.object({
        case_sensitive: s.boolean("Single filter case sensitivity. Default false."),
        combination: s.stringEnum(["and", "or"], { description: "How to combine filters. Default: and." }),
        filters: s.array(
          s.object(
            {
              case_sensitive: s.boolean("Whether this filter is case-sensitive. Default false."),
              key: filterKeySchema,
              matching: filterMatchingSchema,
              value: s.string("Filter value."),
            },
            { required: ["key", "value"] },
          ),
          { description: "Multiple filters to combine." },
        ),
        key: filterKeySchema,
        limit: s.integer({ description: "Maximum number of flows to return. Default 50, max 500.", default: 50 }),
        matching: filterMatchingSchema,
        value: s.string("Single filter value."),
      }),
    ),
    action(
      "export_flow_curl",
      "Read a captured flow and export its request as a cURL command. Review before running the exported command.",
      s.object({ flow_id: flowIdSchema }, { required: ["flow_id"] }),
    ),
    action(
      "list_rules",
      "Read active Proxyman debugging rules and their IDs. This only lists rules; it does not create, update, toggle, or delete them.",
      s.object({ rule_type: ruleTypeSchema }),
    ),
    action(
      "get_ssl_proxying_list",
      "Read the current SSL Proxying configuration, including enabled state and include/exclude domain lists.",
      s.object({}),
    ),
    action(
      "get_certificate_status",
      "Read the current status of Proxyman's root certificate, such as installed/trusted/expired state.",
      s.object({}),
    ),
  ],
};

function action(
  name: ProxymanActionName,
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
