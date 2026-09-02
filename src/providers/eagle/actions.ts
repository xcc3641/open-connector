import type { ProviderActionDefinition } from "../../core/provider-definition.ts";
import type { JsonSchema } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "eagle";

const outputSchema = s.unknown("Eagle API operation result.");

export const eagleActionNames = [
  "get_application_info",
  "get_library_info",
  "get_library_history",
  "switch_library",
  "list_items",
  "get_item_info",
  "get_item_thumbnail",
  "add_item_from_url",
  "add_item_from_path",
  "add_items_from_paths",
  "add_bookmark",
  "update_item",
  "move_items_to_trash",
  "refresh_item_thumbnail",
  "refresh_item_palette",
  "list_folders",
  "create_folder",
  "rename_folder",
  "update_folder",
  "list_tags",
] as const;

export type EagleActionName = (typeof eagleActionNames)[number];

function action(
  name: EagleActionName,
  description: string,
  inputSchema: JsonSchema,
): ProviderActionDefinition<EagleActionName> {
  return defineProviderAction(service, {
    name,
    description,
    inputSchema,
    outputSchema,
  });
}

export const eagleActions: ProviderActionDefinition[] = [
  action(
    "get_application_info",
    "Read Eagle application details including version, build number, platform, and preferences.",
    s.object({}),
  ),
  action(
    "get_library_info",
    "Read currently active Eagle library information, folder hierarchy, smart folders, tags groups, and library path.",
    s.object({}),
  ),
  action("get_library_history", "List recently opened Eagle libraries.", s.object({})),
  action(
    "switch_library",
    "Switch the active Eagle library to another library path.",
    s.object(
      {
        library_path: s.string("Absolute file path of the .library folder to switch to."),
      },
      { required: ["library_path"] },
    ),
  ),
  action(
    "list_items",
    "Query and filter items in the Eagle library by keyword, tags, folders, extension, and ordering.",
    s.object({
      limit: s.integer("Maximum number of items to return (default 50, max 200).", {
        default: 50,
        minimum: 1,
        maximum: 200,
      }),
      offset: s.integer("Pagination offset (default 0).", { default: 0, minimum: 0 }),
      order_by: s.stringEnum(
        [
          "CREATEDATE",
          "-CREATEDATE",
          "FILESIZE",
          "-FILESIZE",
          "NAME",
          "-NAME",
          "RATING",
          "-RATING",
          "BTIME",
          "-BTIME",
          "MTIME",
          "-MTIME",
        ],
        { description: "Sorting field and direction. Prefix '-' indicates descending order." },
      ),
      keyword: s.string("Search keyword to match against item titles and annotations."),
      ext: s.string("Filter by file extension without dot (e.g. 'png', 'jpg', 'mp4', 'pdf')."),
      tags: s.array(s.string("Tag name."), {
        description: "List of tag names to filter by (matches items containing all specified tags).",
      }),
      folders: s.array(s.string("Folder ID."), {
        description: "List of folder IDs to filter by.",
      }),
    }),
  ),
  action(
    "get_item_info",
    "Retrieve complete metadata and details for a specific item in Eagle by its ID.",
    s.object(
      {
        id: s.string("Item unique ID."),
      },
      { required: ["id"] },
    ),
  ),
  action(
    "get_item_thumbnail",
    "Retrieve the local file path to the thumbnail image for a specific item in Eagle.",
    s.object(
      {
        id: s.string("Item unique ID."),
      },
      { required: ["id"] },
    ),
  ),
  action(
    "add_item_from_url",
    "Import a new item into Eagle by downloading it from a web URL.",
    s.object(
      {
        url: s.string("URL of the image/media file to import."),
        name: s.string("Item name/title."),
        website: s.string("Source webpage URL where the asset was found."),
        tags: s.array(s.string("Tag to attach.")),
        annotation: s.string("Annotation or notes describing the item."),
        modification_time: s.integer("Creation/modification timestamp in milliseconds."),
        folder_id: s.string("Folder ID to place the new item into."),
        headers: s.object(
          "Optional custom HTTP headers to send when downloading the file (e.g. referer or cookie).",
          {},
          { additionalProperties: true },
        ),
      },
      { required: ["url", "name"] },
    ),
  ),
  action(
    "add_item_from_path",
    "Import a file from a local host file path into the Eagle library.",
    s.object(
      {
        path: s.string("Absolute local file path on the host machine to import."),
        name: s.string("Item name/title."),
        website: s.string("Source webpage URL."),
        tags: s.array(s.string("Tag to attach.")),
        annotation: s.string("Annotation or notes."),
        folder_id: s.string("Folder ID to place the item into."),
      },
      { required: ["path", "name"] },
    ),
  ),
  action(
    "add_items_from_paths",
    "Batch import multiple files from local host file paths into Eagle.",
    s.object(
      {
        items: s.array(
          s.object(
            {
              path: s.string("Absolute local file path."),
              name: s.string("Item name."),
              website: s.string("Source webpage URL."),
              annotation: s.string("Notes or description."),
              tags: s.array(s.string("Tag.")),
            },
            { required: ["path", "name"] },
          ),
          { description: "List of items to import.", minItems: 1 },
        ),
        folder_id: s.string("Target folder ID for all imported items."),
      },
      { required: ["items"] },
    ),
  ),
  action(
    "add_bookmark",
    "Add a webpage URL bookmark item into Eagle with an optional base64 thumbnail.",
    s.object(
      {
        url: s.string("Webpage URL to bookmark."),
        name: s.string("Bookmark title."),
        base64: s.string("Base64-encoded screenshot image data (optional)."),
        tags: s.array(s.string("Tag.")),
        annotation: s.string("Notes or description."),
        folder_id: s.string("Target folder ID."),
      },
      { required: ["url", "name"] },
    ),
  ),
  action(
    "update_item",
    "Update properties and metadata of an existing item in Eagle (tags, annotation, url, star rating).",
    s.object(
      {
        id: s.string("Item ID to update."),
        tags: s.array(s.string("Updated list of tags.")),
        annotation: s.string("Updated annotation/notes."),
        url: s.string("Updated source URL."),
        star: s.integer("Star rating from 0 to 5.", { minimum: 0, maximum: 5 }),
      },
      { required: ["id"] },
    ),
  ),
  action(
    "move_items_to_trash",
    "Move one or more items to the Eagle library trash.",
    s.object(
      {
        item_ids: s.array(s.string("Item ID to move to trash."), { minItems: 1 }),
      },
      { required: ["item_ids"] },
    ),
  ),
  action(
    "refresh_item_thumbnail",
    "Regenerate the thumbnail for a specific item in Eagle.",
    s.object(
      {
        id: s.string("Item ID."),
      },
      { required: ["id"] },
    ),
  ),
  action(
    "refresh_item_palette",
    "Re-analyze the dominant color palette for a specific item in Eagle.",
    s.object(
      {
        id: s.string("Item ID."),
      },
      { required: ["id"] },
    ),
  ),
  action("list_folders", "Retrieve the complete folder tree from the current Eagle library.", s.object({})),
  action(
    "create_folder",
    "Create a new folder in the Eagle library.",
    s.object(
      {
        folder_name: s.string("Name of the folder to create."),
        parent: s.string("Parent folder ID. If omitted, creates at root level."),
      },
      { required: ["folder_name"] },
    ),
  ),
  action(
    "rename_folder",
    "Rename an existing folder in the Eagle library.",
    s.object(
      {
        folder_id: s.string("Folder ID to rename."),
        new_name: s.string("New folder name."),
      },
      { required: ["folder_id", "new_name"] },
    ),
  ),
  action(
    "update_folder",
    "Update folder properties (name, description, or icon color).",
    s.object(
      {
        folder_id: s.string("Folder ID to update."),
        new_name: s.string("New folder name."),
        new_description: s.string("New folder description."),
        new_color: s.string(
          "New folder color theme (e.g. 'red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'pink', 'gray').",
        ),
      },
      { required: ["folder_id"] },
    ),
  ),
  action("list_tags", "List all tags and their usage count in the active Eagle library.", s.object({})),
];
