import type { ProviderActionDefinition } from "../../core/provider-definition.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "bluesky" as const;

export const blueskyPostTextMaxBytes = 3000;
export const blueskyPostTextMaxGraphemes = 300;
export const blueskyImageMaxBytes = 1_000_000;
export const blueskyVideoMaxBytes = 50_000_000;

const textEncoder = new TextEncoder();
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const atIdentifierSchema = s.string("A Bluesky handle or DID.", { minLength: 1 });
const cursorSchema = s.string("A cursor returned by Bluesky pagination.", { minLength: 1 });
const postUriSchema = s.string("A Bluesky AT URI for a post or record.", { minLength: 1 });
const cidSchema = s.string("A Bluesky content identifier.", { minLength: 1 });
const compactRecordSchema = s.looseObject("The raw Bluesky object returned by the API.");
const postTextSchema = s.string("The primary post text.", {
  minLength: 1,
  maxLength: blueskyPostTextMaxBytes,
});

const profileSchema = s.looseObject("The detailed Bluesky profile object returned by the API.", {
  did: s.string("The decentralized identifier for the actor."),
  handle: s.string("The current handle for the actor."),
  displayName: s.string("The display name for the actor."),
  description: s.string("The profile description for the actor."),
  avatar: s.url("The actor avatar URL."),
  banner: s.url("The actor banner URL."),
  followersCount: s.integer("The number of followers for the actor."),
  followsCount: s.integer("The number of accounts followed by the actor."),
  postsCount: s.integer("The number of posts by the actor."),
});

const strongRefSchema = s.object("A Bluesky strong reference to a post.", {
  uri: postUriSchema,
  cid: cidSchema,
});

const labelSchema = s.looseObject("A Bluesky moderation label.");
const labelsSchema = s.array("Bluesky moderation labels.", labelSchema);
const postViewerSchema = s.looseObject("Authenticated viewer state for the post.", {
  replyDisabled: s.boolean("Whether the authenticated account is prevented from replying."),
});
const postRecordSchema = s.looseObject("The Bluesky post record.", {
  text: s.string("The post text."),
  createdAt: s.string("The client-declared post creation timestamp."),
  langs: s.array("Human language codes for the post text.", s.string("A language code.")),
  reply: s.looseObject("Reply references for this post.", {
    root: strongRefSchema,
    parent: strongRefSchema,
  }),
});
const postViewSchema = s.looseObject("The complete Bluesky post view returned by AppView.", {
  uri: postUriSchema,
  cid: cidSchema,
  indexedAt: s.string("The server timestamp when the post was indexed."),
  replyCount: s.integer("The number of replies to the post."),
  author: s.looseObject("The Bluesky author view for the post.", {
    did: s.string("The decentralized identifier for the author."),
    handle: s.string("The current handle for the author."),
    displayName: s.string("The display name for the author."),
    labels: labelsSchema,
  }),
  record: postRecordSchema,
  labels: labelsSchema,
  threadgate: s.looseObject("Reply restrictions and allow rules for the post."),
  viewer: postViewerSchema,
});

const feedViewPostSchema = s.object(
  "A Bluesky timeline feed item containing a post and optional reply or repost context.",
  {
    post: postViewSchema,
    reply: compactRecordSchema,
    reason: compactRecordSchema,
    feedContext: s.string("Opaque feed-specific context returned by Bluesky."),
  },
  { required: ["post"], optional: ["reply", "reason", "feedContext"] },
);

const textFacetSchema = s.looseObject("A Bluesky rich text facet object.");
const selfLabelsSchema = s.looseObject("A Bluesky self-label object.");

export const blueskyActions: ProviderActionDefinition[] = [
  defineProviderAction(service, {
    name: "get_profile",
    description: "Get the detailed Bluesky profile for a handle or DID.",
    requiredScopes: [],
    inputSchema: s.object("Parameters for retrieving a Bluesky profile.", {
      actor: atIdentifierSchema,
    }),
    outputSchema: s.object("The Bluesky profile response.", {
      profile: profileSchema,
    }),
  }),
  defineProviderAction(service, {
    name: "get_posts",
    description:
      "Fetch up to 25 Bluesky posts by AT URI with authenticated viewer reply permissions. Missing posts are omitted when deleted or invisible.",
    requiredScopes: [],
    inputSchema: s.object(
      "Parameters for retrieving Bluesky posts.",
      {
        uris: s.array("AT URIs for the posts to retrieve.", postUriSchema, {
          minItems: 1,
          maxItems: 25,
        }),
      },
      { required: ["uris"] },
    ),
    outputSchema: s.object("The Bluesky getPosts response. Missing requested posts remain omitted.", {
      posts: s.array("Posts returned by Bluesky.", postViewSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "get_post_thread",
    description:
      "Fetch a Bluesky post thread, including bounded replies and ancestors, with authenticated viewer state.",
    requiredScopes: [],
    inputSchema: s.object(
      "Parameters for retrieving a Bluesky post thread.",
      {
        uri: postUriSchema,
        depth: s.integer("Maximum reply depth to return.", { minimum: 0, maximum: 1000 }),
        parentHeight: s.integer("Maximum number of parent posts to return.", { minimum: 0, maximum: 1000 }),
      },
      { optional: ["depth", "parentHeight"] },
    ),
    outputSchema: s.object("The Bluesky post thread response.", {
      thread: s.looseObject("The thread tree returned by Bluesky AppView."),
    }),
  }),
  defineProviderAction(service, {
    name: "search_posts",
    description: "Search Bluesky posts with common filters and pagination.",
    requiredScopes: [],
    inputSchema: s.object(
      "Parameters for searching Bluesky posts.",
      {
        q: s.string("The Bluesky search query string.", { minLength: 1 }),
        sort: s.stringEnum("The ranking order for matching posts.", ["top", "latest"]),
        since: s.string("Return posts after this ISO date or datetime.", { minLength: 1 }),
        until: s.string("Return posts before this ISO date or datetime.", { minLength: 1 }),
        mentions: atIdentifierSchema,
        author: atIdentifierSchema,
        lang: s.string("Filter posts by language code.", { minLength: 1 }),
        domain: s.string("Filter posts by linked hostname.", { minLength: 1 }),
        url: s.url("Filter posts by linked URL."),
        tag: s.array(
          "Filter posts by hashtag values without the hash prefix.",
          s.string("A hashtag value.", { minLength: 1, maxLength: 640 }),
        ),
        limit: s.integer("The maximum number of posts to return.", { minimum: 1, maximum: 100 }),
        cursor: cursorSchema,
      },
      {
        optional: ["sort", "since", "until", "mentions", "author", "lang", "domain", "url", "tag", "limit", "cursor"],
      },
    ),
    outputSchema: s.object("The Bluesky search response.", {
      posts: s.array("Posts returned by Bluesky.", postViewSchema),
      cursor: s.nullable(cursorSchema),
      hitsTotal: s.nullable(s.integer("The total hit count when returned by Bluesky.")),
    }),
  }),
  defineProviderAction(service, {
    name: "get_timeline",
    description: "Get the authenticated account's home timeline with cursor pagination.",
    requiredScopes: [],
    inputSchema: s.object(
      "Parameters for retrieving the authenticated Bluesky timeline.",
      {
        algorithm: s.string("Optional Bluesky feed algorithm identifier.", { minLength: 1 }),
        limit: s.integer("The maximum number of posts to return.", { minimum: 1, maximum: 100 }),
        cursor: cursorSchema,
      },
      { optional: ["algorithm", "limit", "cursor"] },
    ),
    outputSchema: s.object("The authenticated Bluesky timeline response.", {
      feed: s.array("Timeline feed items returned by Bluesky.", feedViewPostSchema),
      cursor: s.nullable(cursorSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "create_text_post",
    description: "Create a Bluesky text post in the authenticated account's repository.",
    requiredScopes: [],
    inputSchema: s.object(
      "Fields for creating a Bluesky text post.",
      {
        text: postTextSchema,
        createdAt: s.dateTime("Client-declared timestamp for the post."),
        langs: s.array("Human language codes for the post text.", s.string("A language code.", { minLength: 1 }), {
          maxItems: 3,
        }),
        tags: s.array(
          "Additional hashtag values without the hash prefix.",
          s.string("A hashtag value.", { minLength: 1, maxLength: 640 }),
          { maxItems: 8 },
        ),
        facets: s.array("Rich text facets to attach to the post.", textFacetSchema),
        reply: s.object("Reply references for creating a reply post.", {
          root: strongRefSchema,
          parent: strongRefSchema,
        }),
        labels: selfLabelsSchema,
      },
      { optional: ["createdAt", "langs", "tags", "facets", "reply", "labels"] },
    ),
    outputSchema: s.object("The Bluesky record creation response.", {
      uri: postUriSchema,
      cid: cidSchema,
      validationStatus: s.nullable(s.string("The validation status returned by Bluesky.")),
      commit: s.nullable(compactRecordSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "create_post_with_image",
    description: "Create a Bluesky post with an attached JPEG or PNG image from Base64 data.",
    requiredScopes: [],
    inputSchema: s.object(
      "Fields for creating a Bluesky post with image.",
      {
        text: postTextSchema,
        imageBase64: s.string("Base64 encoded string of the JPEG or PNG image.", { minLength: 1 }),
        imageMimeType: s.stringEnum("MIME type of the image.", ["image/jpeg", "image/png"]),
        alt: s.string("Alt text description for the attached image.", { minLength: 1 }),
        createdAt: s.dateTime("Client-declared timestamp for the post."),
        langs: s.array("Human language codes for the post text.", s.string("A language code.", { minLength: 1 }), {
          maxItems: 3,
        }),
        tags: s.array(
          "Additional hashtag values without the hash prefix.",
          s.string("A hashtag value.", { minLength: 1, maxLength: 640 }),
          { maxItems: 8 },
        ),
      },
      { optional: ["imageMimeType", "alt", "createdAt", "langs", "tags"] },
    ),
    outputSchema: s.object("The Bluesky record creation response.", {
      uri: postUriSchema,
      cid: cidSchema,
      validationStatus: s.nullable(s.string("The validation status returned by Bluesky.")),
      commit: s.nullable(compactRecordSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "like_post",
    description: "Like a Bluesky post by its AT URI and CID.",
    requiredScopes: [],
    inputSchema: s.object("Fields for liking a Bluesky post.", {
      uri: postUriSchema,
      cid: cidSchema,
    }),
    outputSchema: s.object("The Bluesky record creation response for the like.", {
      uri: postUriSchema,
      cid: cidSchema,
    }),
  }),
  defineProviderAction(service, {
    name: "create_post_with_video",
    description: "Create a Bluesky post with a video attachment (MP4 / MOV Base64).",
    requiredScopes: [],
    inputSchema: s.object(
      "Fields for creating a post with video.",
      {
        text: postTextSchema,
        videoBase64: s.string("The Base64 encoded video content.", { minLength: 1 }),
        videoMimeType: s.stringEnum("The video MIME type.", ["video/mp4", "video/quicktime"]),
        alt: s.string("Alt text / accessibility description for the video."),
        width: s.number("Video width in pixels.", { minimum: 1, maximum: 16384 }),
        height: s.number("Video height in pixels.", { minimum: 1, maximum: 16384 }),
        createdAt: s.dateTime("Client-declared timestamp for the post."),
        langs: s.array("Languages used in the post.", s.string("A language code.", { minLength: 1 }), {
          maxItems: 3,
        }),
        tags: s.array("Tags for the post.", s.string("A tag value.", { minLength: 1, maxLength: 640 }), {
          maxItems: 8,
        }),
        facets: s.array("Rich text facets to attach to the post.", textFacetSchema),
      },
      { optional: ["videoMimeType", "alt", "width", "height", "createdAt", "langs", "tags", "facets"] },
    ),
    outputSchema: s.object("The Bluesky record creation response.", {
      uri: postUriSchema,
      cid: cidSchema,
      validationStatus: s.nullable(s.string("The validation status returned by Bluesky.")),
      commit: s.nullable(compactRecordSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "update_profile",
    description: "Update the Bluesky actor profile description or display name.",
    requiredScopes: [],
    inputSchema: s.object(
      "Fields for updating the Bluesky profile.",
      {
        displayName: s.nullable(s.string("The display name.")),
        description: s.nullable(s.string("The bio / description string.")),
      },
      { optional: ["displayName", "description"] },
    ),
    outputSchema: s.object("The Bluesky profile update response.", {
      uri: postUriSchema,
      cid: cidSchema,
    }),
  }),
];

export function getBlueskyPostTextValidationIssues(text: string): string[] {
  const issues: string[] = [];
  if (textEncoder.encode(text).byteLength > blueskyPostTextMaxBytes) {
    issues.push(`text must be at most ${blueskyPostTextMaxBytes} UTF-8 bytes`);
  }

  if (Array.from(graphemeSegmenter.segment(text)).length > blueskyPostTextMaxGraphemes) {
    issues.push(`text must be at most ${blueskyPostTextMaxGraphemes} grapheme clusters`);
  }

  return issues;
}
