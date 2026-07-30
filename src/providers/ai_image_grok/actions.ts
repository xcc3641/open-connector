import type { ActionDefinition } from "../../core/types.ts";

import { createAiImageActions } from "../ai-image-actions.ts";

export const aiImageGrokActions: ActionDefinition[] = createAiImageActions("ai_image_grok", "grok");
