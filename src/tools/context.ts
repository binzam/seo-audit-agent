import type { AuditStore } from "../audit/audit-store.js";
import { validatePublicHttpsUrl } from "./http.js";

/** Everything a tool needs from the current run. */
export interface ToolContext {
  readonly store: AuditStore;
  /** Hostname of the site being audited. Tools may only touch this site. */
  readonly siteHostname: string;
}

function withoutWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Validates a URL requested by the model: public https, and on the audited
 * site (www and non-www count as the same site). This stops page content from
 * steering the agent to fetch arbitrary third-party URLs.
 */
export function resolveToolUrl(rawUrl: string, context: ToolContext): URL {
  const url = validatePublicHttpsUrl(rawUrl);

  if (withoutWww(url.hostname) !== withoutWww(context.siteHostname)) {
    throw new Error(
      `${url.hostname} is outside the audited site (${context.siteHostname}).`,
    );
  }

  return url;
}
