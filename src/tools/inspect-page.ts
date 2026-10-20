import { load } from "cheerio";
import { pageArtifactName } from "../audit/paths.js";
import { resolveToolUrl, type ToolContext } from "./context.js";
import { fetchAndStore } from "./fetch-and-store.js";
import { isHtmlContentType, type RedirectHop } from "./http.js";

export interface PageInspection {
  url: string;
  status: number;
  contentType: string;
  redirects: RedirectHop[];
  xRobotsTag: string | null;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string[];
  h1: string[];
  h2Count: number;
  htmlLang: string | null;
  linkCount: number;
}

export interface NonHtmlResponse {
  url: string;
  status: number;
  contentType: string;
  redirects: RedirectHop[];
  error: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

export async function inspectPage(
  rawUrl: string,
  context: ToolContext,
): Promise<PageInspection | NonHtmlResponse> {
  const url = resolveToolUrl(rawUrl, context);
  const response = await fetchAndStore(url, context, {
    name: pageArtifactName(url),
  });

  if (!isHtmlContentType(response.contentType)) {
    return {
      url: response.responseUrl,
      status: response.status,
      contentType: response.contentType,
      redirects: response.redirects,
      error: "The response is not HTML.",
    };
  }

  const $ = load(response.body);

  return {
    url: response.responseUrl,
    status: response.status,
    contentType: response.contentType,
    redirects: response.redirects,
    xRobotsTag: response.headers["x-robots-tag"] ?? null,
    title: clean($("title").first().text()) || null,
    metaDescription:
      $('meta[name="description"]').attr("content")?.trim() || null,
    canonical: $('link[rel="canonical"]').attr("href")?.trim() || null,
    robotsMeta: [
      $('meta[name="robots"]').attr("content"),
      $('meta[name="googlebot"]').attr("content"),
    ].filter(isString),
    h1: $("h1")
      .map((_, element) => clean($(element).text()))
      .get(),
    h2Count: $("h2").length,
    htmlLang: $("html").attr("lang") || null,
    linkCount: $("a[href]").length,
  };
}
