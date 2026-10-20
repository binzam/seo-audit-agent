export interface DescribedError {
  name: string;
  message: string;
  stack?: string;
}

/** Turns anything that was thrown into a plain, JSON-safe object. */
export function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return {
    name: "NonError",
    message: typeof error === "string" ? error : String(error),
  };
}

/** Thrown by `runAudit` so callers know where the logs of a failed run are. */
export class AuditError extends Error {
  readonly directory: string;

  constructor(message: string, directory: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuditError";
    this.directory = directory;
  }
}
