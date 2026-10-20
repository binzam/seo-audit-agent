# SEO Audit Agent

A command-line AI agent that audits the technical SEO of a public web page. Give it a URL and it uses [Google Gemini](https://ai.google.dev/) with function calling to inspect the page and its `robots.txt`, then writes a prioritised, evidence-based report.

Every run is fully logged to disk: the exact HTML the server returned, every tool result, every request and response exchanged with Gemini, and any errors. Each run gets its own timestamped folder, so nothing is ever overwritten.

## Features

- **Evidence-first audits.** The model must call tools before making claims, and is instructed never to invent findings.
- **Two tools:** `inspect_page` (title, meta description, canonical, robots meta, `X-Robots-Tag` header, headings, links, redirects) and `inspect_robots_txt` (crawl directives).
- **Complete audit trail.** Raw HTML, raw `robots.txt`, tool outputs, model requests and responses, a run timeline and an error log are all saved.
- **One folder per website, one timestamped folder per run.**
- **Safe by default.** HTTPS only, public hosts only, same-site only, size and time limits (see [Security](#security)).
- **Strictly typed** TypeScript, validated tool arguments (zod), no runtime surprises.

## Requirements

- **Node.js 20.11 or newer** (22 LTS recommended)
- **[pnpm](https://pnpm.io/)**
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey)

## Quick start

```bash
git clone https://github.com/binzam/seo-audit-agent.git
cd seo-audit-agent
pnpm install
```

Create your environment file and add your key:

```bash
cp .env.example .env
# then edit .env and set GEMINI_API_KEY
```

Run an audit:

```bash
pnpm start https://example.com
```

The report is printed to your terminal and saved to `audits/example.com/<timestamp>/report.md`.

To save only the report to a file of your choice, redirect stdout. Progress messages go to stderr, so they will not end up in the file:

```bash
pnpm start https://example.com > report.md
```

## Configuration

Settings are read from environment variables (or from `.env`).

| Variable         | Required | Default            | Description                                      |
| ---------------- | -------- | ------------------ | ------------------------------------------------ |
| `GEMINI_API_KEY` | Yes      | none               | Your Gemini API key.                             |
| `GEMINI_MODEL`   | No       | `gemini-3.8-flash` | Any Gemini model that supports function calling. |
| `AUDITS_DIR`     | No       | `<project>/audits` | Where audit folders are written.                 |

Never commit your `.env` file. It is listed in `.gitignore`.

## Usage

```bash
pnpm start <url>
```

- `<url>` must be a full `https://` URL of a public website, for example `https://example.com/pricing`.
- The agent audits that page, plus the site's `/robots.txt`.
- Exit code is `0` on success and `1` on failure. On failure, the CLI prints the folder where the details were saved.

Example terminal output (progress goes to stderr, the report to stdout):

```text
Audit folder: /path/to/seo-audit-agent/audits/example.com/2026-10-20T14-03-22-123Z
[step 1] Asking gemini-3.8-flash...
[step 1] Tool calls: inspect_page, inspect_robots_txt
  ✓ inspect_page (412 ms)
  ✓ inspect_robots_txt (233 ms)
[step 2] Asking gemini-3.8-flash...

=== SEO AUDIT REPORT ===
...
```

## Where the logs go

Each run writes to its own folder:

```text
audits/
└── example.com/                          one folder per audited website
    └── 2026-10-20T14-03-22-123Z/         one folder per run (UTC timestamp)
        ├── input.json                    URL, model, step limit, start time
        ├── manifest.json                 status, duration, step/tool/error counts
        ├── events.jsonl                  chronological timeline of the whole run
        ├── report.md                     the final audit report
        ├── errors.json                   every error encountered ([] if none)
        ├── pages/
        │   ├── homepage.html             the exact HTML the server returned
        │   ├── homepage.meta.json        status, headers, redirects, timing
        │   ├── robots.txt                the raw robots.txt
        │   └── robots.meta.json
        ├── tools/
        │   └── 001-01-inspect-page.json  arguments, timing and result of each tool call
        └── model/
            ├── 001-request.json         history and config sent to Gemini
            └── 001-response.json        raw SDK response, including function calls
```

| Artifact                            | What it tells you                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input.json`                        | Which URL was audited and which model was used                                                                                                            |
| `manifest.json`                     | Final status (`running`, `completed`, `failed`), duration, counts                                                                                         |
| `events.jsonl`                      | One JSON object per line: `run_started`, `model_request`, `model_response`, `tool_started`, `tool_finished`, `tool_failed`, `run_completed`, `run_failed` |
| `pages/*.html` / `pages/robots.txt` | What the server actually returned, before any parsing                                                                                                     |
| `pages/*.meta.json`                 | Final URL, status code, response headers (never `set-cookie`), redirect chain                                                                             |
| `pages/*.error.json`                | Written instead of a body when a request fails (timeout, DNS, blocked redirect)                                                                           |
| `tools/*.json`                      | The exact result (or error) handed back to the model                                                                                                      |
| `model/*-request.json`              | System instruction, tool declarations and full conversation for that step                                                                                 |
| `model/*-response.json`             | The raw Gemini response, including token usage                                                                                                            |
| `report.md`                         | The final human-readable audit                                                                                                                            |
| `errors.json`                       | Errors with stage, step, tool and stack trace                                                                                                             |

Request files are written before the API call is made, so they exist even when the call fails. If a page is not the homepage, its files are named after its path, for example `pages/page-pricing.html`.

Your API key is never written to the logs. The audit folders do contain the pages you audited, so avoid committing them if that matters (`audits/` is in `.gitignore`).

## How it works

```mermaid
flowchart LR
    CLI["index.ts<br/>CLI"] --> Run["run-audit.ts<br/>model/tool loop"]
    Run -->|request| Gemini["Gemini"]
    Gemini -->|function calls| Run
    Run --> Exec["execute-tool-call.ts"]
    Exec --> Tools["inspect_page<br/>inspect_robots_txt"]
    Tools --> Web[("Target website")]
    Run --> Store["audit-store.ts"]
    Exec --> Store
    Tools --> Store
    Store --> Disk[("audits/site/timestamp/")]
```

1. `index.ts` reads the URL from the command line.
2. `runAudit` validates the URL, creates the run folder and sends the prompt, system instructions and tool declarations to Gemini.
3. When Gemini asks for tools, each call is validated, executed, saved and logged, and the result is sent back to the model.
4. This repeats for at most **8 steps**. When the model replies without requesting tools, its text becomes `report.md`.
5. If anything fails, the error is saved, the manifest is marked `failed`, and the CLI exits with code 1.

Tool failures are not fatal. The error is returned to the model, which is instructed to state what it could not verify.

## Project structure

```text
src/
├── index.ts                  CLI entry: reads arguments, starts an audit
├── agent/
│   ├── run-audit.ts          the model/tool-call loop
│   ├── execute-tool-call.ts  runs and logs a single tool call
│   ├── tools.ts              tool declarations and registry (zod-validated args)
│   └── instructions.ts       the agent's system instructions
├── audit/
│   ├── audit-store.ts        saves every artifact to disk
│   ├── paths.ts              safe, predictable directory and file names
│   └── errors.ts             error helpers
├── services/
│   └── gemini.ts             Gemini SDK initialisation
├── tools/
│   ├── http.ts               URL validation and safe fetching
│   ├── context.ts            per-run tool context and same-site rule
│   ├── fetch-and-store.ts    fetches a URL and saves the raw response
│   ├── inspect-page.ts       HTML SEO inspection (cheerio)
│   └── inspect-robots.ts     robots.txt inspection
└── types/
    └── audit.ts              shared types
```

## Security

The agent fetches URLs, and some of the content it reads is untrusted, so it is deliberately restrictive:

- **HTTPS only.** Embedded credentials, `localhost`, IP address hosts, single-label hosts and `.local`, `.localhost`, `.internal`, `.lan` and `.home.arpa` hosts are rejected.
- **Same site only.** The model can only request URLs on the audited site (`www` and non-`www` count as the same). This limits what a prompt injection hidden in a page can make the agent fetch.
- **Redirects are followed manually**, up to 5 hops, and every hop is validated and recorded.
- **Limits:** 10 seconds per fetch (including redirects) and 1 MB per response.
- **Untrusted content rule.** The system instructions tell the model to treat tool output as data and never follow instructions found in it.

Limitation: validation checks the hostname text, not what it resolves to in DNS. Do not expose this tool as a public service without adding DNS-level SSRF protection.

Note that the extracted page data (title, headings, meta tags, robots.txt and so on) is sent to the Gemini API as part of the conversation.

## Scope and limitations

- Audits one page plus `robots.txt` per run. It does not crawl the site.
- Reads the static HTML returned by the server. JavaScript-rendered content is not executed.
- It cannot know whether a page is actually indexed, and is instructed not to claim it.
- Reports are generated by an LLM. Treat them as a well-evidenced starting point and check findings against the saved artifacts.

## Development

```bash
pnpm typecheck     # tsc --noEmit
```

Add these scripts to `package.json` if they are not there yet:

```json
"scripts": {
  "start": "tsx src/index.ts",
  "typecheck": "tsc --noEmit"
}
```

### Adding a tool

1. Create `src/tools/my-tool.ts` exporting `async function myTool(rawUrl: string, context: ToolContext)`. Use `resolveToolUrl` to validate the URL and `fetchAndStore` to fetch and save the raw response.
2. In `src/agent/tools.ts`, define it with `defineTool({ name, description, parameters, schema, run })` and add it to the `TOOLS` array.
3. Mention when to use it in `src/agent/instructions.ts`.

Its arguments, timing and results are then logged automatically under `tools/`.

## Troubleshooting

| Problem                                                           | Likely cause and fix                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Missing GEMINI_API_KEY in your .env file.`                       | Create `.env` in the project root (see [Quick start](#quick-start)) and run from there. |
| `Only https:// URLs are allowed.`                                 | Pass a full URL starting with `https://`.                                               |
| `This host is not allowed.` / `IP address hosts are not allowed.` | The URL points to a private, local or IP host. Audit a public domain name.              |
| `... is outside the audited site` (in `errors.json`)              | The model asked for a URL on another site. This is expected protection.                 |
| `Request to ... failed: fetch failed (...)`                       | DNS, TLS or timeout problem. The reason is in parentheses and in `pages/*.error.json`.  |
| `Agent reached the maximum of 8 steps`                            | The model kept calling tools. Inspect `events.jsonl` to see what it was doing.          |
| Model not found or 404 from Gemini                                | Set `GEMINI_MODEL` to a model available to your key.                                    |
| 429 / quota errors                                                | Rate limit or quota on your Gemini key. Wait, or check your plan.                       |

When something goes wrong, start with `manifest.json`, then `errors.json`, then `events.jsonl` in the run folder.

## License

ISC
