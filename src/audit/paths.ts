import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** Sub-folders created inside every run directory. */
export const RUN_SUBDIRECTORIES = ["pages", "tools", "model"] as const;

/**
 * Root folder for all audits. Defaults to `<project>/audits`, independent of the
 * directory the CLI is launched from. Override with the AUDITS_DIR env variable.
 */
export function auditsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["AUDITS_DIR"];

  return override
    ? resolve(override)
    : resolve(import.meta.dirname, "..", "..", "audits");
}

/** Makes any string safe to use as a single file or folder name. */
export function safeSegment(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9.-]/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 100) || "unknown"
  );
}

/** Sortable, filesystem-safe timestamp, e.g. `2026-10-20T14-03-22-123Z`. */
export function runTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** `audits/<website>/` — one folder per audited website. */
export function websiteDirectory(url: URL, root: string = auditsRoot()): string {
  return join(root, safeSegment(url.host));
}

/** `audits/<website>/<timestamp>/` — one folder per run. */
export function runDirectory(
  url: URL,
  runId: string,
  root: string = auditsRoot(),
): string {
  return join(websiteDirectory(url, root), runId);
}

/**
 * Resolves `relativePath` against `base` and refuses anything that would land
 * outside it (e.g. `../../etc/passwd`).
 */
export function resolveInside(base: string, relativePath: string): string {
  const target = resolve(base, relativePath);
  const rel = relative(base, target);

  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes the audit directory: ${relativePath}`);
  }

  return target;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** `model/001-request.json` / `model/001-response.json` */
export function modelArtifact(step: number, kind: "request" | "response"): string {
  return `model/${pad(step, 3)}-${kind}.json`;
}

/** `tools/001-01-inspect-page.json` (step, call index within the step, tool). */
export function toolArtifact(step: number, index: number, tool: string): string {
  return `tools/${pad(step, 3)}-${pad(index + 1, 2)}-${safeSegment(tool)}.json`;
}

/** Base name for a saved page: `homepage` for `/`, otherwise derived from the path. */
export function pageArtifactName(url: URL): string {
  const path = `${url.pathname}${url.search}`;

  return path === "/" ? "homepage" : `page-${safeSegment(path)}`;
}
