import { join } from "node:path";
import type {
  Content,
  GenerateContentConfig,
  GoogleGenAI,
} from "@google/genai";
import { AuditStore } from "../audit/audit-store.js";
import { AuditError, describeError } from "../audit/errors.js";
import { modelArtifact } from "../audit/paths.js";
import type { ToolContext } from "../tools/context.js";
import { validatePublicHttpsUrl } from "../tools/http.js";
import type { AuditStage } from "../types/audit.js";
import { executeToolCall } from "./execute-tool-call.js";
import { AUDIT_INSTRUCTIONS, buildAuditPrompt } from "./instructions.js";
import { toolConfig } from "./tools.js";

const DEFAULT_MAX_STEPS = 8;
const REPORT_FILE = "report.md";

export interface RunAuditOptions {
  url: string;
  ai: Pick<GoogleGenAI, "models">;
  model: string;
  /** Upper bound on model/tool round trips. */
  maxSteps?: number;
}

export interface AuditResult {
  /** Absolute path of this run's folder. */
  directory: string;
  /** Absolute path of `report.md`. */
  reportPath: string;
  report: string;
  steps: number;
}

/**
 * Runs the model/tool loop for one URL and saves every part of it to
 * `audits/<website>/<timestamp>/`. Throws `AuditError` (which carries the run
 * directory) if the audit fails; the failure is saved too.
 */
export async function runAudit(options: RunAuditOptions): Promise<AuditResult> {
  const { ai, model, maxSteps = DEFAULT_MAX_STEPS } = options;

  // Validate before creating any folder on disk.
  const target = validatePublicHttpsUrl(options.url);

  const store = await AuditStore.create({ url: target, model, maxSteps });
  const context: ToolContext = { store, siteHostname: target.hostname };

  const config: GenerateContentConfig = {
    systemInstruction: AUDIT_INSTRUCTIONS,
    tools: toolConfig,
  };
  const contents: Content[] = [
    { role: "user", parts: [{ text: buildAuditPrompt(target.href) }] },
  ];

  let stage: AuditStage = "setup";
  let steps = 0;
  let toolCalls = 0;

  console.error(`Audit folder: ${store.directory}`);

  try {
    for (let step = 1; step <= maxSteps; step++) {
      steps = step;
      stage = "model";
      console.error(`[step ${step}] Asking ${model}...`);

      // Save the request first, so it exists even if the call fails.
      const requestFile = modelArtifact(step, "request");

      await store.writeJson(requestFile, { step, model, config, contents });
      await store.logEvent({ type: "model_request", step, file: requestFile });

      const response = await ai.models.generateContent({
        model,
        contents,
        config,
      });

      const functionCalls = response.functionCalls ?? [];
      const responseFile = modelArtifact(step, "response");

      await store.writeJson(responseFile, response);
      await store.logEvent({
        type: "model_response",
        step,
        file: responseFile,
        finishReason: response.candidates?.[0]?.finishReason ?? null,
        toolCalls: functionCalls.map((call) => call.name ?? "unknown"),
        usage: response.usageMetadata,
      });

      const modelContent = response.candidates?.[0]?.content;

      if (!modelContent) {
        throw new Error("Gemini returned no response content.");
      }

      // Keep the model's turn (including its tool calls) in the history.
      contents.push(modelContent);

      if (functionCalls.length === 0) {
        stage = "report";

        const text = response.text?.trim();

        if (!text) {
          throw new Error("Gemini finished without producing a report.");
        }

        const report = renderReport(text, target, store, model);

        await store.writeText(REPORT_FILE, report);
        await store.logEvent({
          type: "run_completed",
          steps,
          toolCalls,
          report: REPORT_FILE,
        });
        await store.finish("completed", { steps, toolCalls, report: REPORT_FILE });

        return {
          directory: store.directory,
          reportPath: join(store.directory, REPORT_FILE),
          report,
          steps,
        };
      }

      stage = "tool";
      console.error(
        `[step ${step}] Tool calls: ${functionCalls.map((call) => call.name).join(", ")}`,
      );

      const outcomes = await Promise.all(
        functionCalls.map((call, index) =>
          executeToolCall(call, step, index, context),
        ),
      );

      toolCalls += outcomes.length;

      contents.push({
        role: "user",
        parts: outcomes.map((outcome) => outcome.part),
      });
    }

    throw new Error(
      `Agent reached the maximum of ${maxSteps} steps without producing a report.`,
    );
  } catch (error) {
    const { message } = describeError(error);

    try {
      await store.recordError(stage, error, steps > 0 ? { step: steps } : {});
      await store.logEvent({ type: "run_failed", message });
      await store.finish("failed", { steps, toolCalls, report: null });
    } catch (loggingError) {
      console.error("Could not write the failure log:", loggingError);
    }

    throw new AuditError(message, store.directory, { cause: error });
  }
}

function renderReport(
  body: string,
  target: URL,
  store: AuditStore,
  model: string,
): string {
  return [
    `# SEO audit: ${target.host}`,
    "",
    `- **URL:** ${target.href}`,
    `- **Model:** ${model}`,
    `- **Run:** ${store.runId}`,
    "",
    "---",
    "",
    body,
    "",
  ].join("\n");
}
