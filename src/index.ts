import "dotenv/config";
import { runAudit } from "./agent/run-audit.js";
import { AuditError } from "./audit/errors.js";
import { createGeminiClient } from "./services/gemini.js";

async function main(): Promise<void> {
  const url = process.argv[2];

  if (!url) {
    console.error("Usage: pnpm exec tsx src/index.ts https://example.com");
    process.exitCode = 1;
    return;
  }

  try {
    const { ai, model } = createGeminiClient();
    const result = await runAudit({ url, ai, model });

    console.log("\n=== SEO AUDIT REPORT ===\n");
    console.log(result.report);
    console.error(`\nFull audit log saved to ${result.directory}`);
  } catch (error) {
    console.error(
      "The audit failed:",
      error instanceof Error ? error.message : error,
    );

    if (error instanceof AuditError) {
      console.error(`Details were saved to ${error.directory}`);
    }

    process.exitCode = 1;
  }
}

void main();
