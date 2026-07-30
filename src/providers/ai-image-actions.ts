import type { ActionDefinition, JsonSchema } from "../core/types.ts";

import { s } from "../core/json-schema.ts";
import { defineProviderAction } from "../core/provider-definition.ts";

export type AiImageBackend = "gpt" | "grok";

const transitFileSchema = s.requiredObject("A generated image stored in local transit storage.", {
  fileId: s.nonEmptyString("The local transit file identifier."),
  downloadUrl: s.url("The local URL used to download the generated image."),
  sizeBytes: s.nonNegativeInteger("The generated image size in bytes."),
  name: s.nonEmptyString("The generated image filename."),
  mimeType: s.nonEmptyString("The generated image MIME type."),
});

const generatedImageSchema = s.object(
  "One generated image and its provider metadata.",
  {
    file: transitFileSchema,
    revisedPrompt: s.nonEmptyString("The prompt revised by the image model, when returned."),
  },
  { required: ["file"], optional: ["revisedPrompt"] },
);

const listModelsOutputSchema = s.requiredObject("Image models available to this connection.", {
  models: s.array("Available image model identifiers.", s.nonEmptyString("An image model identifier.")),
});

const generateImageOutputSchema = s.object(
  "Generated images stored in local transit storage.",
  {
    model: s.nonEmptyString("The image model used for generation."),
    created: s.nonNegativeInteger("The upstream Unix creation timestamp, when returned."),
    images: s.array("Generated images in provider order.", generatedImageSchema, { minItems: 1 }),
    usage: s.object("Usage metadata returned by Sub2API.", {}, { additionalProperties: true }),
  },
  { required: ["model", "images"], optional: ["created", "usage"] },
);

export function createAiImageActions(service: string, backend: AiImageBackend): ActionDefinition[] {
  return [
    defineProviderAction(service, {
      name: "list_models",
      description: `List ${backend === "gpt" ? "GPT" : "Grok"} image models available through this AI-Image connection.`,
      inputSchema: s.object({}, { description: "No input is required." }),
      outputSchema: listModelsOutputSchema,
    }),
    defineProviderAction(service, {
      name: "generate_image",
      description: `Generate images with ${backend === "gpt" ? "GPT Image" : "Grok Imagine"} through Sub2API and store them as downloadable local transit files.`,
      inputSchema: generateImageInputSchema(backend),
      outputSchema: generateImageOutputSchema,
    }),
  ];
}

function generateImageInputSchema(backend: AiImageBackend): JsonSchema {
  const shared = {
    prompt: s.nonEmptyString("A detailed description of the image to generate."),
    model: s.stringEnum(
      backend === "gpt"
        ? ["gpt-image-1", "gpt-image-1.5", "gpt-image-2"]
        : ["grok-imagine", "grok-imagine-image", "grok-imagine-image-quality"],
      {
        default: backend === "gpt" ? "gpt-image-2" : "grok-imagine-image-quality",
        description: "The image model to use. It must be available to the configured Sub2API key.",
      },
    ),
    n: s.integer({ minimum: 1, maximum: 4, default: 1, description: "The number of images to generate." }),
    size: s.nonEmptyString("The requested image size, such as 1024x1024."),
  };

  if (backend === "grok") {
    return s.object("Input for Grok image generation.", shared, {
      required: ["prompt"],
      optional: ["model", "n", "size"],
    });
  }

  return s.object(
    "Input for GPT image generation.",
    {
      ...shared,
      quality: s.stringEnum(["auto", "low", "medium", "high"], {
        description: "The requested GPT image quality.",
      }),
      background: s.stringEnum(["auto", "opaque", "transparent"], {
        description: "The requested GPT image background treatment.",
      }),
      outputFormat: s.stringEnum(["png", "jpeg", "webp"], {
        default: "png",
        description: "The generated image format.",
      }),
      outputCompression: s.integer({
        minimum: 0,
        maximum: 100,
        description: "Compression level for JPEG or WebP output.",
      }),
      moderation: s.nonEmptyString("The GPT image moderation setting."),
    },
    {
      required: ["prompt"],
      optional: ["model", "n", "size", "quality", "background", "outputFormat", "outputCompression", "moderation"],
    },
  );
}
