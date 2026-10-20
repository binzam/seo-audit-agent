import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AuditErrorContext,
  AuditErrorRecord,
  AuditEventBody,
  AuditInput,
  AuditManifest,
  AuditStage,
  AuditStatus,
  AuditSummary,
} from "../types/audit.js";
import { describeError } from "./errors.js";
import {
  RUN_SUBDIRECTORIES,
  resolveInside,
  runDirectory,
  runTimestamp,
} from "./paths.js";

export interface CreateAuditStoreOptions {
  url: URL;
  model: string;
  maxSteps: number;
  /** Override the audits root (mainly for tests). */
  root?: string;
}

/**
 * Owns one run directory: `audits/<website>/<timestamp>/`.
 * Everything the audit produces is saved through this class.
 */
export class AuditStore {
  readonly directory: string;
  readonly website: string;
  readonly runId: string;

  private manifest: AuditManifest;
  private readonly startedAtMs: number;
  private readonly errors: AuditErrorRecord[] = [];
  /** Serialises writes to files that several concurrent callers append to. */
  private queue: Promise<void> = Promise.resolve();

  private constructor(directory: string, manifest: AuditManifest) {
    this.directory = directory;
    this.website = manifest.website;
    this.runId = manifest.runId;
    this.manifest = manifest;
    this.startedAtMs = Date.parse(manifest.startedAt);
  }

  static async create(options: CreateAuditStoreOptions): Promise<AuditStore> {
    const { url, model, maxSteps, root } = options;
    const startedAt = new Date();
    const runId = runTimestamp(startedAt);
    const directory = runDirectory(url, runId, root);

    await Promise.all(
      RUN_SUBDIRECTORIES.map((name) =>
        mkdir(join(directory, name), { recursive: true }),
      ),
    );

    const input: AuditInput = {
      requestedUrl: url.href,
      hostname: url.hostname,
      model,
      maxSteps,
      startedAt: startedAt.toISOString(),
    };

    const manifest: AuditManifest = {
      website: url.host,
      requestedUrl: url.href,
      runId,
      model,
      status: "running",
      startedAt: input.startedAt,
      completedAt: null,
      durationMs: null,
      steps: 0,
      toolCalls: 0,
      errorCount: 0,
      report: null,
    };

    const store = new AuditStore(directory, manifest);

    await Promise.all([
      store.writeJson("input.json", input),
      store.writeJson("manifest.json", manifest),
      store.writeJson("errors.json", []),
    ]);

    await store.logEvent({
      type: "run_started",
      url: url.href,
      model,
      maxSteps,
    });

    return store;
  }

  async writeText(relativePath: string, content: string): Promise<void> {
    const path = resolveInside(this.directory, relativePath);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  /**
   * The value is serialised immediately, so later mutations of `data`
   * (e.g. the growing conversation history) do not leak into the file.
   */
  async writeJson(relativePath: string, data: unknown): Promise<void> {
    await this.writeText(relativePath, `${JSON.stringify(data, null, 2)}\n`);
  }

  /** Appends one line to `events.jsonl`, the chronological log of the run. */
  logEvent(event: AuditEventBody): Promise<void> {
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;

    return this.enqueue(() =>
      appendFile(join(this.directory, "events.jsonl"), line, "utf8"),
    );
  }

  /** Adds an entry to `errors.json` (rewritten in full, in order). */
  recordError(
    stage: AuditStage,
    error: unknown,
    context: AuditErrorContext = {},
  ): Promise<void> {
    this.errors.push({
      at: new Date().toISOString(),
      stage,
      ...describeError(error),
      ...context,
    });

    const snapshot = `${JSON.stringify(this.errors, null, 2)}\n`;

    return this.enqueue(() => this.writeText("errors.json", snapshot));
  }

  /** Marks the run as finished and rewrites `manifest.json`. */
  async finish(
    status: Exclude<AuditStatus, "running">,
    summary: AuditSummary,
  ): Promise<void> {
    const completedAt = new Date();

    this.manifest = {
      ...this.manifest,
      status,
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - this.startedAtMs,
      steps: summary.steps,
      toolCalls: summary.toolCalls,
      errorCount: this.errors.length,
      report: summary.report,
    };

    await this.writeJson("manifest.json", this.manifest);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);

    // A failed write must not poison the queue for later writes.
    this.queue = run.catch(() => undefined);

    return run;
  }
}
