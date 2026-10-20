import { Type, type FunctionDeclaration, type Schema, type Tool } from "@google/genai";
import { z } from "zod";
import type { ToolContext } from "../tools/context.js";
import { inspectPage } from "../tools/inspect-page.js";
import { inspectRobotsTxt } from "../tools/inspect-robots.js";

export interface RegisteredTool {
  readonly name: string;
  readonly declaration: FunctionDeclaration;
  /** Validates the model's raw arguments, then runs the tool. */
  execute(rawArgs: unknown, context: ToolContext): Promise<unknown>;
}

interface ToolDefinition<TSchema extends z.ZodType> {
  name: string;
  description: string;
  /** What Gemini is told about the arguments. */
  parameters: Schema;
  /** What we actually enforce — the model can send anything. */
  schema: TSchema;
  run: (args: z.output<TSchema>, context: ToolContext) => Promise<unknown>;
}

function defineTool<TSchema extends z.ZodType>(
  definition: ToolDefinition<TSchema>,
): RegisteredTool {
  return {
    name: definition.name,
    declaration: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    },
    execute: async (rawArgs, context) =>
      definition.run(definition.schema.parse(rawArgs), context),
  };
}

const urlArgs = z.object({ url: z.url() });

const inspectPageTool = defineTool({
  name: "inspect_page",
  description:
    "Fetch a public HTTPS webpage on the audited site and inspect its SEO metadata, headings, and links.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: {
        type: Type.STRING,
        description: "The full HTTPS URL of the webpage to inspect.",
      },
    },
    required: ["url"],
  },
  schema: urlArgs,
  run: ({ url }, context) => inspectPage(url, context),
});

const inspectRobotsTool = defineTool({
  name: "inspect_robots_txt",
  description:
    "Fetch the robots.txt file at the origin of the audited website to inspect crawling directives.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: {
        type: Type.STRING,
        description: "The full HTTPS URL of the website.",
      },
    },
    required: ["url"],
  },
  schema: urlArgs,
  run: ({ url }, context) => inspectRobotsTxt(url, context),
});

const TOOLS: readonly RegisteredTool[] = [inspectPageTool, inspectRobotsTool];
const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool] as const));

/** The `tools` value passed to `generateContent`. */
export const toolConfig: Tool[] = [
  { functionDeclarations: TOOLS.map((tool) => tool.declaration) },
];

export function findTool(name: string): RegisteredTool | undefined {
  return TOOLS_BY_NAME.get(name);
}
