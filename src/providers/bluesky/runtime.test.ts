import { describe, expect, it } from "vitest";
import { blueskyActions } from "./actions.ts";
import { blueskyActionHandlers } from "./runtime.ts";

const sessionResponse = {
  accessJwt: "access-jwt",
  refreshJwt: "refresh-jwt",
  handle: "hiro3641.bsky.social",
  did: "did:plc:hiro3641",
};

function createAuthenticatedFetcher(handleAppViewRequest: (url: URL, init: RequestInit | undefined) => Response): {
  fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  requests: Array<{ url: URL; init: RequestInit | undefined }>;
} {
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  return {
    requests,
    async fetcher(input, init): Promise<Response> {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.pathname === "/xrpc/com.atproto.server.createSession") {
        return Response.json(sessionResponse);
      }
      return handleAppViewRequest(url, init);
    },
  };
}

describe("Bluesky read actions", () => {
  it("declares get_posts as a 25-URI batch returning complete PostView fields", () => {
    const action = blueskyActions.find(({ name }) => name === "get_posts");

    expect(action?.inputSchema).toMatchObject({
      required: ["uris"],
      properties: {
        uris: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          items: { type: "string" },
        },
      },
    });
    expect(action?.outputSchema).toMatchObject({
      properties: {
        posts: {
          type: "array",
          items: {
            properties: {
              uri: {},
              cid: {},
              indexedAt: {},
              replyCount: {},
              author: {
                properties: {
                  did: {},
                  handle: {},
                  displayName: {},
                  labels: { type: "array" },
                },
              },
              record: {
                properties: {
                  text: {},
                  createdAt: {},
                  langs: { type: "array" },
                  reply: {
                    properties: {
                      root: { properties: { uri: {}, cid: {} } },
                      parent: { properties: { uri: {}, cid: {} } },
                    },
                  },
                },
              },
              labels: { type: "array" },
              threadgate: {},
              viewer: { properties: { replyDisabled: {} } },
            },
          },
        },
      },
    });
  });

  it("declares get_post_thread with bounded optional traversal controls", () => {
    const action = blueskyActions.find(({ name }) => name === "get_post_thread");

    expect(action?.inputSchema).toMatchObject({
      required: ["uri"],
      properties: {
        uri: { type: "string" },
        depth: { type: "integer", minimum: 0, maximum: 1000 },
        parentHeight: { type: "integer", minimum: 0, maximum: 1000 },
      },
    });
    expect(action?.outputSchema).toMatchObject({
      properties: {
        thread: { type: "object", additionalProperties: true },
      },
    });
  });

  it("requests getPosts with repeated URIs and returns only the posts AppView returned", async () => {
    const returnedPost = {
      uri: "at://did:plc:alive/app.bsky.feed.post/1",
      cid: "bafy-alive",
      indexedAt: "2026-08-18T00:00:00.000Z",
      replyCount: 3,
      author: {
        did: "did:plc:alive",
        handle: "alive.bsky.social",
        displayName: "Alive",
        labels: [],
      },
      record: {
        text: "still here",
        createdAt: "2026-08-17T23:59:00.000Z",
        langs: ["en"],
        reply: {
          root: { uri: "at://did:plc:root/app.bsky.feed.post/root", cid: "bafy-root" },
          parent: { uri: "at://did:plc:parent/app.bsky.feed.post/parent", cid: "bafy-parent" },
        },
      },
      labels: [],
      threadgate: { uri: "at://did:plc:alive/app.bsky.feed.threadgate/1", record: { allow: [] } },
      viewer: { replyDisabled: false, like: "at://did:plc:hiro/app.bsky.feed.like/1" },
    };
    const uris = [returnedPost.uri, "at://did:plc:deleted/app.bsky.feed.post/2"];
    const { fetcher, requests } = createAuthenticatedFetcher((url, init) => {
      expect(url.pathname).toBe("/xrpc/app.bsky.feed.getPosts");
      expect(url.searchParams.getAll("uris")).toEqual(uris);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-jwt");
      return Response.json({ posts: [returnedPost] });
    });

    const result = await blueskyActionHandlers.get_posts!(
      { uris },
      {
        apiKey: "app-password",
        handle: "hiro3641.bsky.social",
        fetcher,
      },
    );

    expect(result).toEqual({ posts: [returnedPost] });
    expect(requests).toHaveLength(2);
  });

  it("requests getPostThread with depth and parentHeight and returns the raw thread tree", async () => {
    const uri = "at://did:plc:root/app.bsky.feed.post/root";
    const thread = {
      $type: "app.bsky.feed.defs#threadViewPost",
      post: { uri, cid: "bafy-root", viewer: { replyDisabled: true } },
      replies: [
        {
          $type: "app.bsky.feed.defs#notFoundPost",
          uri: "at://did:plc:missing/app.bsky.feed.post/reply",
          notFound: true,
        },
      ],
    };
    const { fetcher } = createAuthenticatedFetcher((url, init) => {
      expect(url.pathname).toBe("/xrpc/app.bsky.feed.getPostThread");
      expect(url.searchParams.get("uri")).toBe(uri);
      expect(url.searchParams.get("depth")).toBe("8");
      expect(url.searchParams.get("parentHeight")).toBe("2");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-jwt");
      return Response.json({ thread });
    });

    const result = await blueskyActionHandlers.get_post_thread!(
      { uri, depth: 8, parentHeight: 2 },
      {
        apiKey: "app-password",
        handle: "hiro3641.bsky.social",
        fetcher,
      },
    );

    expect(result).toEqual({ thread });
  });
});
