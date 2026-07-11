import type { ActionDefinition, JsonSchema } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";
import { revenuecatProviderScopes } from "./scopes.ts";

const service = "revenuecat";

const rawValueSchema = s.unknown("A raw RevenueCat API value.");
const rawObjectSchema = s.record(rawValueSchema, {
  description: "The raw JSON object returned by the RevenueCat API.",
});
const nonEmptyString = (description: string): JsonSchema => s.string(description, { minLength: 1 });
const idSchema = (description: string): JsonSchema => s.string(description, { minLength: 1, maxLength: 255 });
const paginationLimitSchema = s.integer("The number of items to return, from 1 to 100.", { minimum: 1, maximum: 100 });
const startingAfterSchema = nonEmptyString("RevenueCat pagination cursor: return the page after this resource ID.");
const expandSchema = s.stringArray("RevenueCat expandable fields to include in the response.", {
  itemDescription: "An expandable field name from the RevenueCat API v2 docs.",
});
const productIdsSchema = s.stringArray("RevenueCat product IDs to attach or detach.", {
  minItems: 1,
  maxItems: 50,
  itemDescription: "A RevenueCat product ID.",
});
const packageProductAssociationSchema = s.requiredObject("A RevenueCat package-product association.", {
  productId: idSchema("The RevenueCat product ID to attach to the package."),
  eligibilityCriteria: s.stringEnum("The eligibility criteria RevenueCat should use for this product association.", [
    "all",
    "google_sdk_lt_6",
    "google_sdk_ge_6",
  ]),
});

const pageInputFields = {
  startingAfter: startingAfterSchema,
  limit: paginationLimitSchema,
};
const projectPageInputFields = {
  projectId: idSchema("The RevenueCat project ID."),
  ...pageInputFields,
};
const expandableProjectPageInputFields = {
  ...projectPageInputFields,
  expand: expandSchema,
};
const paginatedOutputSchema = s.requiredObject("A RevenueCat paginated response.", {
  items: s.array("Items returned by RevenueCat.", rawObjectSchema),
  nextPage: s.nullableString("URL for the next page, or null when RevenueCat did not return one."),
  url: s.nullableString("URL for the current page when RevenueCat returned one."),
  raw: rawObjectSchema,
});
const resourceOutputSchema = (resourceName: string): JsonSchema =>
  s.requiredObject(`A RevenueCat ${resourceName} response.`, {
    [resourceName]: rawObjectSchema,
  });
const mutationOutputSchema = (resourceName: string): JsonSchema =>
  s.requiredObject(`A RevenueCat ${resourceName} mutation response.`, {
    [resourceName]: rawObjectSchema,
  });

interface RevenueCatActionSource {
  name: RevenueCatActionName;
  description: string;
  requiredScopes: string[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export type RevenueCatActionName =
  | "list_projects"
  | "list_apps"
  | "list_products"
  | "get_product"
  | "list_entitlements"
  | "get_entitlement"
  | "attach_products_to_entitlement"
  | "detach_products_from_entitlement"
  | "list_offerings"
  | "get_offering"
  | "list_packages"
  | "get_package"
  | "attach_products_to_package"
  | "detach_products_from_package"
  | "list_customers"
  | "get_customer"
  | "list_customer_subscriptions"
  | "get_subscription";

const revenuecatActionSources: RevenueCatActionSource[] = [
  {
    name: "list_projects",
    description: "List RevenueCat projects visible to the API key.",
    requiredScopes: ["project_configuration:projects:read"],
    inputSchema: s.object("Input parameters for listing RevenueCat projects.", pageInputFields, {
      optional: ["startingAfter", "limit"],
    }),
    outputSchema: paginatedOutputSchema,
  },
  {
    name: "list_apps",
    description: "List RevenueCat apps in a project.",
    requiredScopes: ["project_configuration:apps:read"],
    inputSchema: s.object("Input parameters for listing RevenueCat apps.", projectPageInputFields, {
      required: ["projectId"],
      optional: ["startingAfter", "limit"],
    }),
    outputSchema: paginatedOutputSchema,
  },
  {
    name: "list_products",
    description: "List RevenueCat products in a project, optionally filtered by app.",
    requiredScopes: ["project_configuration:products:read"],
    inputSchema: s.object(
      "Input parameters for listing RevenueCat products.",
      {
        ...expandableProjectPageInputFields,
        appId: idSchema("Only return products for this RevenueCat app ID."),
      },
      { required: ["projectId"], optional: ["startingAfter", "limit", "expand", "appId"] },
    ),
    outputSchema: paginatedOutputSchema,
  },
  {
    name: "get_product",
    description: "Get a RevenueCat product by ID.",
    requiredScopes: ["project_configuration:products:read"],
    inputSchema: s.object(
      "Input parameters for getting a RevenueCat product.",
      {
        projectId: idSchema("The RevenueCat project ID."),
        productId: idSchema("The RevenueCat product ID."),
        expand: expandSchema,
      },
      { required: ["projectId", "productId"], optional: ["expand"] },
    ),
    outputSchema: resourceOutputSchema("product"),
  },
  {
    name: "list_entitlements",
    description: "List RevenueCat entitlements in a project.",
    requiredScopes: ["project_configuration:entitlements:read"],
    inputSchema: s.object("Input parameters for listing RevenueCat entitlements.", expandableProjectPageInputFields, {
      required: ["projectId"],
      optional: ["startingAfter", "limit", "expand"],
    }),
    outputSchema: paginatedOutputSchema,
  },
  {
    name: "get_entitlement",
    description: "Get a RevenueCat entitlement by ID.",
    requiredScopes: ["project_configuration:entitlements:read"],
    inputSchema: s.object(
      "Input parameters for getting a RevenueCat entitlement.",
      {
        projectId: idSchema("The RevenueCat project ID."),
        entitlementId: idSchema("The RevenueCat entitlement ID."),
        expand: expandSchema,
      },
      { required: ["projectId", "entitlementId"], optional: ["expand"] },
    ),
    outputSchema: resourceOutputSchema("entitlement"),
  },
  {
    name: "attach_products_to_entitlement",
    description: "Attach RevenueCat products to an entitlement.",
    requiredScopes: ["project_configuration:entitlements:write"],
    inputSchema: s.requiredObject("Input parameters for attaching products to a RevenueCat entitlement.", {
      projectId: idSchema("The RevenueCat project ID."),
      entitlementId: idSchema("The RevenueCat entitlement ID."),
      productIds: productIdsSchema,
    }),
    outputSchema: mutationOutputSchema("entitlement"),
  },
  {
    name: "detach_products_from_entitlement",
    description: "Detach RevenueCat products from an entitlement.",
    requiredScopes: ["project_configuration:entitlements:write"],
    inputSchema: s.requiredObject("Input parameters for detaching products from a RevenueCat entitlement.", {
      projectId: idSchema("The RevenueCat project ID."),
      entitlementId: idSchema("The RevenueCat entitlement ID."),
      productIds: productIdsSchema,
    }),
    outputSchema: mutationOutputSchema("entitlement"),
  },
  {
    name: "list_offerings",
    description: "List RevenueCat offerings in a project.",
    requiredScopes: ["project_configuration:offerings:read"],
    inputSchema: s.object("Input parameters for listing RevenueCat offerings.", expandableProjectPageInputFields, {
      required: ["projectId"],
      optional: ["startingAfter", "limit", "expand"],
    }),
    outputSchema: paginatedOutputSchema,
  },
  {
    name: "get_offering",
    description: "Get a RevenueCat offering by ID.",
    requiredScopes: ["project_configuration:offerings:read"],
    inputSchema: s.object(
      "Input parameters for getting a RevenueCat offering.",
      {
        projectId: idSchema("The RevenueCat project ID."),
        offeringId: idSchema("The RevenueCat offering ID."),
        expand: expandSchema,
      },
      { required: ["projectId", "offeringId"], optional: ["expand"] },
    ),
    outputSchema: resourceOutputSchema("offering"),
  },
  {
    name: "list_packages",
    description: "List RevenueCat packages in an offering.",
    requiredScopes: ["project_configuration:packages:read"],
    inputSchema: s.object(
      "Input parameters for listing RevenueCat packages.",
      {
        ...expandableProjectPageInputFields,
        offeringId: idSchema("The RevenueCat offering ID."),
      },
      { required: ["projectId", "offeringId"], optional: ["startingAfter", "limit", "expand"] },
    ),
    outputSchema: paginatedOutputSchema,
  },
  {
    name: "get_package",
    description: "Get a RevenueCat package by ID.",
    requiredScopes: ["project_configuration:packages:read"],
    inputSchema: s.object(
      "Input parameters for getting a RevenueCat package.",
      {
        projectId: idSchema("The RevenueCat project ID."),
        packageId: idSchema("The RevenueCat package ID."),
        expand: expandSchema,
      },
      { required: ["projectId", "packageId"], optional: ["expand"] },
    ),
    outputSchema: resourceOutputSchema("package"),
  },
  {
    name: "attach_products_to_package",
    description: "Attach RevenueCat products to a package with eligibility criteria.",
    requiredScopes: ["project_configuration:packages:write"],
    inputSchema: s.requiredObject("Input parameters for attaching products to a RevenueCat package.", {
      projectId: idSchema("The RevenueCat project ID."),
      packageId: idSchema("The RevenueCat package ID."),
      products: s.array("Product associations to attach to the package.", packageProductAssociationSchema, {
        minItems: 1,
        maxItems: 50,
      }),
    }),
    outputSchema: mutationOutputSchema("package"),
  },
  {
    name: "detach_products_from_package",
    description: "Detach RevenueCat products from a package.",
    requiredScopes: ["project_configuration:packages:write"],
    inputSchema: s.requiredObject("Input parameters for detaching products from a RevenueCat package.", {
      projectId: idSchema("The RevenueCat project ID."),
      packageId: idSchema("The RevenueCat package ID."),
      productIds: productIdsSchema,
    }),
    outputSchema: mutationOutputSchema("package"),
  },
  {
    name: "list_customers",
    description: "List RevenueCat customers in a project, optionally searching by customer ID.",
    requiredScopes: ["customer_information:customers:read"],
    inputSchema: s.object(
      "Input parameters for listing RevenueCat customers.",
      {
        ...projectPageInputFields,
        search: nonEmptyString("Search text for RevenueCat customer IDs."),
      },
      { required: ["projectId"], optional: ["startingAfter", "limit", "search"] },
    ),
    outputSchema: paginatedOutputSchema,
  },
  {
    name: "get_customer",
    description: "Get a RevenueCat customer by ID.",
    requiredScopes: ["customer_information:customers:read"],
    inputSchema: s.object(
      "Input parameters for getting a RevenueCat customer.",
      {
        projectId: idSchema("The RevenueCat project ID."),
        customerId: nonEmptyString("The RevenueCat customer ID."),
        expand: expandSchema,
      },
      { required: ["projectId", "customerId"], optional: ["expand"] },
    ),
    outputSchema: resourceOutputSchema("customer"),
  },
  {
    name: "list_customer_subscriptions",
    description: "List subscriptions associated with a RevenueCat customer.",
    requiredScopes: ["customer_information:subscriptions:read"],
    inputSchema: s.object(
      "Input parameters for listing a RevenueCat customer's subscriptions.",
      {
        ...projectPageInputFields,
        customerId: nonEmptyString("The RevenueCat customer ID."),
        environment: s.stringEnum("Filter subscriptions by RevenueCat environment.", ["sandbox", "production"]),
      },
      { required: ["projectId", "customerId"], optional: ["startingAfter", "limit", "environment"] },
    ),
    outputSchema: paginatedOutputSchema,
  },
  {
    name: "get_subscription",
    description: "Get a RevenueCat subscription by ID.",
    requiredScopes: ["customer_information:subscriptions:read"],
    inputSchema: s.requiredObject("Input parameters for getting a RevenueCat subscription.", {
      projectId: idSchema("The RevenueCat project ID."),
      subscriptionId: idSchema("The RevenueCat subscription ID."),
    }),
    outputSchema: resourceOutputSchema("subscription"),
  },
];

export const revenuecatActions: ActionDefinition[] = revenuecatActionSources.map((action) =>
  defineProviderAction(service, {
    name: action.name,
    description: action.description,
    requiredScopes: action.requiredScopes,
    providerPermissions: action.requiredScopes,
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
  }),
);

export { revenuecatProviderScopes };
