import type { EagleActionContext } from "./runtime.ts";

import { describe, expect, it } from "vitest";
import { eagleActionHandlers, normalizeEagleBaseUrl, validateEagleCredential } from "./runtime.ts";

function mockContext(fetcher: typeof fetch, apiKey = "test-token"): EagleActionContext {
  return {
    apiKey,
    apiBaseUrl: "http://127.0.0.1:41595",
    fetcher,
  };
}

describe("Eagle provider runtime", () => {
  it("normalizes baseUrl correctly", () => {
    expect(normalizeEagleBaseUrl()).toBe("http://127.0.0.1:41595");
    expect(normalizeEagleBaseUrl("http://localhost:41595/api/")).toBe("http://localhost:41595");
    expect(normalizeEagleBaseUrl("http://192.168.1.100:41595")).toBe("http://192.168.1.100:41595");
  });

  it("validates eagle credential against application info", async () => {
    const fetcher: typeof fetch = async (url) => {
      expect(String(url)).toBe("http://127.0.0.1:41595/api/application/info?token=secret-token");
      return new Response(JSON.stringify({ status: "success", data: { version: "4.0.0", platform: "darwin" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await validateEagleCredential({ baseUrl: "http://127.0.0.1:41595" }, "secret-token", fetcher);
    expect(result.profile?.accountId).toBe("eagle:darwin");
    expect(result.profile?.displayName).toBe("Eagle App (4.0.0)");
    expect(result.metadata?.version).toBe("4.0.0");
  });

  it("handles list_items with filters", async () => {
    let requestedUrl = "";
    const fetcher: typeof fetch = async (url) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({
          status: "success",
          data: [{ id: "item-1", name: "test item", ext: "png", tags: ["inspiration"] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const context = mockContext(fetcher);
    const output = await eagleActionHandlers.list_items(
      {
        limit: 10,
        keyword: "banner",
        tags: ["design", "ui"],
        folders: ["folder-123"],
        order_by: "-CREATEDATE",
      },
      context,
    );

    expect(output).toEqual([{ id: "item-1", name: "test item", ext: "png", tags: ["inspiration"] }]);
    expect(requestedUrl).toContain("/api/item/list");
    expect(requestedUrl).toContain("limit=10");
    expect(requestedUrl).toContain("keyword=banner");
    expect(requestedUrl).toContain("tags=design%2Cui");
    expect(requestedUrl).toContain("folders=folder-123");
    expect(requestedUrl).toContain("orderBy=-CREATEDATE");
    expect(requestedUrl).toContain("token=test-token");
  });

  it("handles add_item_from_url", async () => {
    let requestBody: unknown;
    const fetcher: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:41595/api/item/addFromURL");
      expect(init?.method).toBe("POST");
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: "success", data: "item-new-id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const context = mockContext(fetcher);
    const result = await eagleActionHandlers.add_item_from_url(
      {
        url: "https://example.com/image.png",
        name: "Example Image",
        tags: ["mockup"],
        folder_id: "folder-abc",
      },
      context,
    );

    expect(result).toBe("item-new-id");
    expect(requestBody).toMatchObject({
      url: "https://example.com/image.png",
      name: "Example Image",
      tags: ["mockup"],
      folderId: "folder-abc",
      token: "test-token",
    });
  });

  it("handles create_folder", async () => {
    let requestBody: unknown;
    const fetcher: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:41595/api/folder/create");
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: "success", data: { id: "folder-new", name: "New Folder" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const context = mockContext(fetcher);
    const result = await eagleActionHandlers.create_folder(
      {
        folder_name: "New Folder",
        parent: "parent-id",
      },
      context,
    );

    expect(result).toEqual({ id: "folder-new", name: "New Folder" });
    expect(requestBody).toMatchObject({
      folderName: "New Folder",
      parent: "parent-id",
      token: "test-token",
    });
  });
});
