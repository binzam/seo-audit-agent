import { describeError } from "../audit/errors.js";
import type { ToolContext } from "./context.js";
import { fetchText, isHtmlContentType, type FetchedResource } from "./http.js";

export interface StoreOptions {
  /** Base file name inside `pages/`, e.g. `homepage` or `robots`. */
  name: string;
  /** Force the extension. Defaults to `html` for HTML responses, else `txt`. */
  extension?: string;
}

/**
 * Fetches a URL and saves what came back before anything parses it:
 *   pages/<name>.<ext>        the exact body returned by the server
 *   pages/<name>.meta.json    status, headers, redirects, timing (no body)
 *   pages/<name>.error.json   written instead when the request itself fails
 */
export async function fetchAndStore(
  url: URL,
  context: ToolContext,
  options: StoreOptions,
): Promise<FetchedResource> {
  const { store } = context;
  let resource: FetchedResource;

  try {
    resource = await fetchText(url);
  } catch (error) {
    await store.writeJson(`pages/${options.name}.error.json`, {
      requestedUrl: url.href,
      failedAt: new Date().toISOString(),
      ...describeError(error),
    });

    throw error;
  }

  const extension =
    options.extension ?? (isHtmlContentType(resource.contentType) ? "html" : "txt");
  const { body, ...meta } = resource;

  await Promise.all([
    store.writeText(`pages/${options.name}.${extension}`, body),
    store.writeJson(`pages/${options.name}.meta.json`, meta),
  ]);

  return resource;
}
