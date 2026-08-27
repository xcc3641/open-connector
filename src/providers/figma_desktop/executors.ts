import type { ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import type { ProviderFetch } from "../provider-runtime.ts";
import type { FigmaDesktopActionContext } from "./runtime.ts";

import { isPrivateNetworkAccessAllowed } from "../../core/request.ts";
import { defineProviderExecutors } from "../provider-runtime.ts";
import { figmaDesktopActionHandlers, figmaDesktopMcpUrl, shouldSkipFigmaDesktopDnsValidation } from "./runtime.ts";

const service = "figma_desktop";

export const executors: ProviderExecutors = defineProviderExecutors<FigmaDesktopActionContext>({
  service,
  handlers: figmaDesktopActionHandlers,
  // The Figma desktop app serves Dev Mode MCP on the host loopback interface.
  allowPrivateNetwork: isPrivateNetworkAccessAllowed,
  // OrbStack resolves this exact fixed host-service URL to a reserved address.
  // Custom FIGMA_DESKTOP_MCP_URL values retain normal DNS validation.
  skipDnsValidation: shouldSkipFigmaDesktopDnsValidation(figmaDesktopMcpUrl),
  createContext(context: ExecutionContext, fetcher: ProviderFetch): FigmaDesktopActionContext {
    return {
      url: figmaDesktopMcpUrl,
      fetcher,
      transitFiles: context.transitFiles,
      signal: context.signal,
    };
  },
  fallbackMessage: "Figma Dev Mode MCP request failed",
});
