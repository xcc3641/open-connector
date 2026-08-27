import type { JsonSchema, ProviderDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "figma_desktop";

const outputSchema = s.unknown(
  "Figma Dev Mode MCP tool result. JSON text content is parsed when possible, plain text is returned as text, and image content is stored as a downloadable transit file.",
);

const nodeIdSchema = s.string(
  'Figma node id such as "123:456" or "123-456". Omit to use the node currently selected in the Figma desktop app. When given a URL like https://figma.com/design/:fileKey/:fileName?node-id=1-2, extract "1:2".',
);
const clientLanguagesSchema = s.string(
  'Comma separated languages used in the calling project, for example "typescript,css". Defaults to "unknown".',
);
const clientFrameworksSchema = s.string(
  'Comma separated frameworks used in the calling project, for example "react" or "flutter". Defaults to "unknown".',
);

export const provider: ProviderDefinition = {
  service,
  displayName: "Figma Desktop (Dev Mode MCP)",
  categories: ["Design", "Developer Tools"],
  authTypes: ["no_auth"],
  auth: [{ type: "no_auth" }],
  homepageUrl: "https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Dev-Mode-MCP-Server",
  actions: [
    action(
      "get_design_context",
      "Get design context for a Figma node: reference code, a screenshot, and contextual metadata for design-to-code work. Adapt the returned code to the target project instead of pasting it verbatim.",
      s.object({
        nodeId: nodeIdSchema,
        clientLanguages: clientLanguagesSchema,
        clientFrameworks: clientFrameworksSchema,
        forceCode: s.boolean(
          "Always return code instead of metadata only when the output is large. Set this only when the user explicitly asks to force code.",
        ),
        artifactType: s.stringEnum(
          [
            "WEB_PAGE_OR_APP_SCREEN",
            "COMPONENT_WITHIN_A_WEB_PAGE_OR_APP_SCREEN",
            "REUSABLE_COMPONENT",
            "DESIGN_SYSTEM",
          ],
          { description: "Type of artifact being created or modified. Omit when it is not obvious." },
        ),
        taskType: s.stringEnum(["CREATE_ARTIFACT", "CHANGE_ARTIFACT", "DELETE_ARTIFACT"], {
          description: "Type of task being performed. Omit when it is not obvious.",
        }),
      }),
    ),
    action(
      "get_metadata",
      "Get an XML structure overview of a node or page in the Figma desktop app, including node ids, names, types, positions, and sizes. Prefer get_design_context for code generation.",
      s.object({
        nodeId: nodeIdSchema,
        clientLanguages: clientLanguagesSchema,
        clientFrameworks: clientFrameworksSchema,
      }),
    ),
    action(
      "get_screenshot",
      "Render a screenshot of a node or the current selection in the Figma desktop app. Works for design files, FigJam boards, and Figma Slides.",
      s.object({
        nodeId: nodeIdSchema,
        contentsOnly: s.boolean(
          "Render the node in isolation, excluding floating or overlapping content. Defaults to false so the screenshot matches the canvas.",
        ),
      }),
    ),
    action(
      "get_variable_defs",
      "Get the variable and style definitions used by a node, such as color, spacing, and typography tokens.",
      s.object({
        nodeId: nodeIdSchema,
        clientLanguages: clientLanguagesSchema,
        clientFrameworks: clientFrameworksSchema,
      }),
    ),
    action(
      "get_motion_context",
      "Get keyframe animation data for a node: animated-node inventory, keyframe tracks with easing curves, and pre-computed CSS or motion.dev snippets. Use after get_design_context.",
      s.object({
        nodeId: nodeIdSchema,
        recursive: s.boolean("Traverse the subtree and return motion data for all animated descendants."),
        clientLanguages: clientLanguagesSchema,
        clientFrameworks: clientFrameworksSchema,
      }),
    ),
    action(
      "get_figjam",
      "Generate UI code for a FigJam node or the current FigJam selection. Only works for FigJam board files.",
      s.object({
        nodeId: nodeIdSchema,
        includeImagesOfNodes: s.boolean("Include images of nodes in the response. Defaults to true."),
      }),
    ),
  ],
};

function action(name: string, description: string, inputSchema: JsonSchema): ReturnType<typeof defineProviderAction> {
  return defineProviderAction(service, {
    name,
    description,
    inputSchema,
    outputSchema,
  });
}
