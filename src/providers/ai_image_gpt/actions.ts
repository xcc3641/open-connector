import type { ActionDefinition } from "../../core/types.ts";

import { createAiImageActions } from "../ai-image-actions.ts";

export const aiImageGptActions: ActionDefinition[] = createAiImageActions("ai_image_gpt", "gpt");
