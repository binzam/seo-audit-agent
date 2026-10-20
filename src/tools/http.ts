import { isIP } from "node:net";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = "LearningSEOAuditBot/1.0";

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
];

export interface RedirectHop {
  from: string;
  to: string;
  status: number;
}

export interface FetchedResource {
  requestedUrl: string;
  responseUrl: string;
  status: number;
  contentType: string;
  /** Response headers, lower-cased. `set-cookie` is never stored. */
  headers: Record<string, string>;
  redirects: RedirectHop[];
  body: string;
  bytes: number;
  fetchedAt: string;
  durationMs: number;
}

/**
 * Accepts only public-looking https URLs. Blocks localhost, internal-looking
 * hostnames, IP literals and embedded credentials.
 *
 * Note: this checks the hostname text, not what it resolves to in DNS.
 */
export function validatePublicHttpsUrl(value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Not a valid URL: ${value}`);
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (url.protocol !== "https:") {
    throw new Error("Only https:// URLs are allowed.");
  }

  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }

  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) {
    throw new Error("IP address hosts are not allowed.");
  }

  if (
    !host.includes(".") ||
    host === "localhost" ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new Error("This host is not allowed.");
  }

  return url;
}

export function isHtmlContentType(contentType: string): boolean {
  const value = contentType.toLowerCase();

  return value.includes("text/html") || value.includes("application/xhtml+xml");
}

/**
 * GETs a URL as text. Follows up to 5 redirects manually so that every hop is
 * validated and recorded. Aborts after 10 s in total and reads at most 1 MB.
 */
export async function fetchText(start: URL): Promise<FetchedResource> {
  const startedAtMs = Date.now();
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const redirects: RedirectHop[] = [];
  let current = start;

  for (let hop = 0; ; hop++) {
    const response = await request(current, signal);
    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();

      if (hop >= MAX_REDIRECTS) {
        throw new Error(
          `Too many redirects (more than ${MAX_REDIRECTS}) starting at ${start.href}.`,
        );
      }

      let next: URL;

      try {
        next = validatePublicHttpsUrl(new URL(location, current).href);
      } catch (error) {
        throw new Error(
          `Blocked redirect from ${current.href} to "${location}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }

      redirects.push({
        from: current.href,
        to: next.href,
        status: response.status,
      });
      current = next;
      continue;
    }

    const { text, bytes } = await readBody(response);

    return {
      requestedUrl: start.href,
      responseUrl: response.url || current.href,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      headers: collectHeaders(response.headers),
      redirects,
      body: text,
      bytes,
      fetchedAt: new Date(startedAtMs).toISOString(),
      durationMs: Date.now() - startedAtMs,
    };
  }
}

async function request(url: URL, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,text/plain,*/*;q=0.1",
      },
    });
  } catch (error) {
    throw new Error(`Request to ${url.href} failed: ${failureReason(error)}`, {
      cause: error,
    });
  }
}

async function readBody(
  response: Response,
): Promise<{ text: string; bytes: number }> {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Empty response body.");
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      bytes += value.byteLength;

      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Response exceeds the 1 MB limit.");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { text: Buffer.concat(chunks).toString("utf8"), bytes };
}

function collectHeaders(headers: Headers): Record<string, string> {
  const collected: Record<string, string> = {};

  headers.forEach((value, key) => {
    if (key !== "set-cookie") collected[key] = value;
  });

  return collected;
}

/** `fetch` reports almost everything as "fetch failed"; the real reason is in `cause`. */
function failureReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";

  return `${error.message}${cause}`;
}
