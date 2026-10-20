import { resolveToolUrl, type ToolContext } from "./context.js";
import { fetchAndStore } from "./fetch-and-store.js";
import type { RedirectHop } from "./http.js";

/** The model only needs the directives, so cap what is sent back to it. */
const MODEL_CONTENT_LIMIT = 15_000;

export interface RobotsInspection {
  url: string;
  status: number;
  contentType: string;
  redirects: RedirectHop[];
  content: string;
  truncated: boolean;
}

export async function inspectRobotsTxt(
  rawUrl: string,
  context: ToolContext,
): Promise<RobotsInspection> {
  const url = resolveToolUrl(rawUrl, context);
  const robotsUrl = new URL("/robots.txt", url.origin);

  // The full raw file is saved to pages/robots.txt whatever the status code.
  const response = await fetchAndStore(robotsUrl, context, {
    name: "robots",
    extension: "txt",
  });

  return {
    url: response.responseUrl,
    status: response.status,
    contentType: response.contentType,
    redirects: response.redirects,
    content: response.body.slice(0, MODEL_CONTENT_LIMIT),
    truncated: response.body.length > MODEL_CONTENT_LIMIT,
  };
}
