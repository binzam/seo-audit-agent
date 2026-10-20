export type AuditStatus = "running" | "completed" | "failed";

/** Which phase of the run an error came from. */
export type AuditStage = "setup" | "model" | "tool" | "report";

/** Written to `input.json` when a run starts. */
export interface AuditInput {
  requestedUrl: string;
  hostname: string;
  model: string;
  maxSteps: number;
  startedAt: string;
}

/** Written to `manifest.json`; rewritten when the run finishes. */
export interface AuditManifest {
  website: string;
  requestedUrl: string;
  runId: string;
  model: string;
  status: AuditStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  steps: number;
  toolCalls: number;
  errorCount: number;
  report: string | null;
}

export interface AuditSummary {
  steps: number;
  toolCalls: number;
  /** Relative path of the report inside the run directory, if one was written. */
  report: string | null;
}

/** One entry in `errors.json`. */
export interface AuditErrorRecord {
  at: string;
  stage: AuditStage;
  name: string;
  message: string;
  stack?: string;
  step?: number;
  tool?: string;
}

export interface AuditErrorContext {
  step?: number;
  tool?: string;
}

/** One line in `events.jsonl` (the run timeline), minus the timestamp. */
export type AuditEventBody =
  | { type: "run_started"; url: string; model: string; maxSteps: number }
  | { type: "model_request"; step: number; file: string }
  | {
      type: "model_response";
      step: number;
      file: string;
      finishReason: string | null;
      toolCalls: string[];
      usage: unknown;
    }
  | { type: "tool_started"; step: number; tool: string; args: unknown }
  | {
      type: "tool_finished";
      step: number;
      tool: string;
      file: string;
      durationMs: number;
    }
  | {
      type: "tool_failed";
      step: number;
      tool: string;
      file: string;
      durationMs: number;
      message: string;
    }
  | { type: "run_completed"; steps: number; toolCalls: number; report: string }
  | { type: "run_failed"; message: string };

export type AuditEvent = AuditEventBody & { at: string };
