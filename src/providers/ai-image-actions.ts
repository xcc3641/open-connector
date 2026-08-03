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

const gptImageModels = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"] as const;
const grokImageModels = ["grok-imagine-image-quality", "grok-imagine-image", "grok-imagine"] as const;

export function createAiImageActions(service: string, backend: AiImageBackend): ActionDefinition[] {
  const actions: ActionDefinition[] = [
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

  if (backend === "gpt") {
    actions.push(
      defineProviderAction(service, {
        name: "edit_image",
        description:
          "Edit an existing image with GPT Image through OpenAI images/edits. Provide one source image (and optional mask) as local transit files, plus a prompt describing the edit. Defaults to the best available model (gpt-image-2).",
        inputSchema: editImageInputSchema(),
        outputSchema: generateImageOutputSchema,
        followUpActions: [`${service}.generate_image`, `${service}.generate_with_reference`],
      }),
      defineProviderAction(service, {
        name: "generate_with_reference",
        description:
          "Generate a new image guided by one or more reference images via OpenAI images/edits. Prefer this over plain generate_image when the user supplies style/subject references. Defaults to the best available model (gpt-image-2).",
        inputSchema: generateWithReferenceInputSchema(),
        outputSchema: generateImageOutputSchema,
        followUpActions: [`${service}.edit_image`, `${service}.generate_image`],
      }),
    );
  }

  return actions;
}

function generateImageInputSchema(backend: AiImageBackend): JsonSchema {
  const shared = {
    prompt: s.nonEmptyString("A detailed description of the image to generate."),
    model: s.stringEnum(backend === "gpt" ? [...gptImageModels] : [...grokImageModels], {
      default: backend === "gpt" ? "gpt-image-2" : "grok-imagine-image-quality",
      description:
        backend === "gpt"
          ? "The GPT image model to use. Prefer gpt-image-2 (best). Only override when the connection lacks that model."
          : "The Grok image model to use. Prefer grok-imagine-image-quality (best).",
    }),
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
      ...gptImageOptionFields(),
    },
    {
      required: ["prompt"],
      optional: ["model", "n", "size", "quality", "background", "outputFormat", "outputCompression", "moderation"],
    },
  );
}

function editImageInputSchema(): JsonSchema {
  return s.object(
    "Input for GPT image editing via images/edits.",
    {
      prompt: s.nonEmptyString("Describe how to edit the source image."),
      image: s.transitFile("The source image previously uploaded to local transit storage."),
      mask: s.transitFile(
        "Optional PNG mask transit file. Transparent areas mark regions to edit; opaque areas are preserved.",
      ),
      model: s.stringEnum([...gptImageModels], {
        default: "gpt-image-2",
        description: "The GPT image model to use. Prefer gpt-image-2 (best).",
      }),
      n: s.integer({ minimum: 1, maximum: 4, default: 1, description: "The number of edited images to generate." }),
      size: s.nonEmptyString("The requested image size, such as 1024x1024."),
      ...gptImageOptionFields(),
      inputFidelity: s.stringEnum(["low", "high"], {
        description: "How strongly the model should preserve details from the input image(s).",
      }),
    },
    {
      required: ["prompt", "image"],
      optional: [
        "mask",
        "model",
        "n",
        "size",
        "quality",
        "background",
        "outputFormat",
        "outputCompression",
        "moderation",
        "inputFidelity",
      ],
    },
  );
}

function generateWithReferenceInputSchema(): JsonSchema {
  return s.object(
    "Input for GPT image generation guided by reference images via images/edits.",
    {
      prompt: s.nonEmptyString(
        "Describe the image to generate. Reference images guide style, subject, or composition — they are not a strict pixel edit unless the prompt says so.",
      ),
      referenceImages: s.array(
        "One or more reference images from local transit storage (OpenAI images/edits image[]).",
        s.transitFile("A reference image previously uploaded to local transit storage."),
        { minItems: 1, maxItems: 8 },
      ),
      model: s.stringEnum([...gptImageModels], {
        default: "gpt-image-2",
        description: "The GPT image model to use. Prefer gpt-image-2 (best).",
      }),
      n: s.integer({ minimum: 1, maximum: 4, default: 1, description: "The number of images to generate." }),
      size: s.nonEmptyString("The requested image size, such as 1024x1024."),
      ...gptImageOptionFields(),
      inputFidelity: s.stringEnum(["low", "high"], {
        description: "How strongly the model should preserve details from the reference image(s).",
      }),
    },
    {
      required: ["prompt", "referenceImages"],
      optional: [
        "model",
        "n",
        "size",
        "quality",
        "background",
        "outputFormat",
        "outputCompression",
        "moderation",
        "inputFidelity",
      ],
    },
  );
}

function gptImageOptionFields(): Record<string, JsonSchema> {
  return {
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
  };
}
