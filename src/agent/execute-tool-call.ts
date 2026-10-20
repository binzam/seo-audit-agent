import type { FunctionCall, Part } from "@google/genai";
import { describeError } from "../audit/errors.js";
import { toolArtifact } from "../audit/paths.js";
import type { ToolContext } from "../tools/context.js";
import { findTool } from "./tools.js";

export interface ToolCallOutcome {
  /** The `functionResponse` part to send back to Gemini. */
  part: Part;
  ok: boolean;
}

/**
 * Runs one function call requested by the model and records it:
 *   tools/<step>-<n>-<tool>.json   arguments, timing, and the result or error
 *   events.jsonl                   tool_started + tool_finished / tool_failed
 *   errors.json                    only if the tool failed
 *
 * It never throws for a tool failure: the error is returned to the model so it
 * can report what it could not verify.
 */
export async function executeToolCall(
  call: FunctionCall,
  step: number,
  index: number,
  context: ToolContext,
): Promise<ToolCallOutcome> {
  const { store } = context;
  const name = call.name ?? "unknown";
  const args = call.args ?? {};
  const file = toolArtifact(step, index, name);
  const startedAt = new Date();

  await store.logEvent({ type: "tool_started", step, tool: name, args });

  let ok = true;
  let result: unknown;
  let failure: ReturnType<typeof describeError> | undefined;

  try {
    const tool = call.name ? findTool(call.name) : undefined;

    if (!tool) {
      throw new Error(
        call.name ? `Unknown tool: ${call.name}` : "Missing function name.",
      );
    }

    result = await tool.execute(args, context);
  } catch (error) {
    ok = false;
    failure = describeError(error);
    await store.recordError("tool", error, { step, tool: name });
  }

  const durationMs = Date.now() - startedAt.getTime();

  await store.writeJson(file, {
    tool: name,
    callId: call.id ?? null,
    args,
    startedAt: startedAt.toISOString(),
    durationMs,
    ok,
    ...(failure ? { error: failure } : { result }),
  });

  if (failure) {
    await store.logEvent({
      type: "tool_failed",
      step,
      tool: name,
      file,
      durationMs,
      message: failure.message,
    });
    console.error(`  ✗ ${name} failed: ${failure.message}`);
  } else {
    await store.logEvent({ type: "tool_finished", step, tool: name, file, durationMs });
    console.error(`  ✓ ${name} (${durationMs} ms)`);
  }

  return {
    ok,
    part: {
      functionResponse: {
        ...(call.id ? { id: call.id } : {}),
        name,
        response: failure ? { error: failure.message } : { result },
      },
    },
  };
}
