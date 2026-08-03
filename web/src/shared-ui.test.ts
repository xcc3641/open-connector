import type { ProviderDefinition } from "./model";

import { describe, expect, it } from "vitest";
import { providerIconSource, resolveProviderIconClass } from "./shared-ui";

function provider(options: Partial<ProviderDefinition> & Pick<ProviderDefinition, "service">): ProviderDefinition {
  return {
    displayName: options.displayName ?? options.service,
    categories: [],
    authTypes: [],
    auth: [],
    actions: [],
    ...options,
    service: options.service,
  };
}

describe("providerIconSource", () => {
  it("prefers the provider definition icon", () => {
    expect(
      providerIconSource(provider({ service: "example", iconUrl: " https://example.com/icon.svg " }), {
        example: "https://static.oomol.com/example.svg",
      }),
    ).toEqual({ kind: "url", value: "https://example.com/icon.svg" });
  });

  it("uses the bundled OOMOL catalog icon", () => {
    expect(
      providerIconSource(provider({ service: "example" }), {
        example: "https://static.oomol.com/example.svg",
      }),
    ).toEqual({ kind: "url", value: "https://static.oomol.com/example.svg" });
  });

  it("uses Google's favicon service when no icon is mapped", () => {
    expect(providerIconSource(provider({ service: "example", homepageUrl: "https://example.com/docs" }), {})).toEqual({
      kind: "url",
      value: "https://www.google.com/s2/favicons?sz=64&domain=example.com",
    });
  });

  it("falls back to initials when no icon or valid homepage is available", () => {
    expect(providerIconSource(provider({ service: "example", homepageUrl: "not a URL" }), {})).toBeUndefined();
  });
});

describe("resolveProviderIconClass", () => {
  it("uses official brand icon classes for AI-Image providers", () => {
    expect(resolveProviderIconClass(provider({ service: "ai_image_gpt", displayName: "AI-Image GPT" }))).toBe(
      "i-logos-openai-icon",
    );
    expect(resolveProviderIconClass(provider({ service: "ai_image_grok", displayName: "AI-Image Grok" }))).toBe(
      "i-logos-grok-icon",
    );
  });

  it("uses product-specific logo classes for mapped Google providers", () => {
    const mappedProviders = [
      {
        service: "google_analytics",
        displayName: "Google Analytics",
        homepageUrl: "https://analytics.google.com",
        expected: "i-logos-google-analytics",
      },
      {
        service: "gmail",
        displayName: "Gmail",
        homepageUrl: "https://mail.google.com",
        expected: "i-logos-google-gmail",
      },
      {
        service: "googlephotos",
        displayName: "Google Photos",
        homepageUrl: "https://www.google.com/photos/about/",
        expected: "i-logos-google-photos",
      },
      {
        service: "google_search_console",
        displayName: "Google Search Console",
        homepageUrl: "https://search.google.com/search-console",
        expected: "i-logos-google-search-console",
      },
      {
        service: "google_cloud_sts",
        displayName: "Google Cloud STS",
        homepageUrl: "https://cloud.google.com/iam/docs/workload-identity-federation",
        expected: "i-logos-google-cloud",
      },
      {
        service: "googledrive",
        displayName: "Google Drive",
        homepageUrl: "https://workspace.google.com/products/drive/",
        expected: "i-logos-google-drive",
      },
      {
        service: "googlecalendar",
        displayName: "Google Calendar",
        homepageUrl: "https://workspace.google.com/products/calendar/",
        expected: "i-logos-google-calendar",
      },
      {
        service: "google_address_validation",
        displayName: "Google Address Validation",
        homepageUrl: "https://developers.google.com/maps/documentation/address-validation",
        expected: "i-logos-google-maps",
      },
      {
        service: "google_routes",
        displayName: "Google Routes",
        homepageUrl: "https://developers.google.com/maps/documentation/routes",
        expected: "i-logos-google-maps",
      },
    ];

    for (const mappedProvider of mappedProviders) {
      expect(resolveProviderIconClass(provider(mappedProvider))).toBe(mappedProvider.expected);
    }
  });

  it("uses the default Google logo class for unmapped Google providers", () => {
    expect(
      resolveProviderIconClass(
        provider({
          service: "google_bigquery",
          displayName: "Google BigQuery",
          homepageUrl: "https://cloud.google.com/bigquery",
        }),
      ),
    ).toBe("i-logos-google-icon");
  });
});
