# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Transform job: `--input is required` when no dataset selected** — `Transform.tsx:handleSubmit`
  unconditionally posted `{ input: selectedDataset }` even when `selectedDataset === null`, so the
  job was queued, started, then failed in the child process with a cryptic error. Now blocked
  client-side with a localized error alert before the network request fires. (Same footgun still
  exists in `Format.tsx` — tracked as a Phase 3.1 follow-up in
  `docs/plans/transform-e2e-verification/master-plan.md`.)
- **Transform job: ENOENT on relative dataset path** — `GET /api/v1/datasets` returns paths
  relative to `outputDir` (e.g. `task_xxx/scraped.json`), but `JobExecutor` spawned the CLI with
  `cwd = projectRoot` and `transform.ts` called `path.resolve(options.input)`, resolving the
  relative path against the project root instead of `outputDir`. `executor.ts` now has a
  `PATH_INPUT_OPTIONS` set and a `resolveRelativeInputPath()` helper that resolves relative
  `--input` values against `getConfig().get('outputDir')` before spawn. Absolute paths are left
  unchanged. The fix is command-agnostic — every CLI command with an `--input` option
  (clean/format/translate/export/transform) inherits the protection. Regression tests added in
  `src/server/jobs/executor.test.ts`. Live-verified end-to-end against the dashboard.
- **Scrapy stderr buffered, never streamed** — `scrapy/runner.ts:runCommand` accumulated the Python
  scrapy process's stderr into a local buffer and only returned it on exit, so all per-URL
  `Crawled (200) <GET ...>` logs were invisible during the spider run (only 1 log line appeared for
  a 34-second job). The runner now forwards each stderr line to the parent process stderr in
  real-time, where the executor surfaces it as a live job log. Gated behind `streamStderr: true`
  so version probes don't pollute the log.
- **Spinner only emitted progress once on start** — `tui.ts:ProgressSpinner.update()` just mutated
  local text without re-emitting the NDJSON progress event, so phase transitions (Searching →
  Crawling → Downloading) were invisible to the executor in JSON mode. `update()` now re-emits on
  text change.

### Added

- **Gallery filter: downloaded images only (default)** — The gallery previously showed every URL
  extracted from scraped pages (from `record.files[]`), including images that were discovered but
  not downloaded. A new `GET /api/v1/datasets/:path/manifest` endpoint reads
  `downloads/downloads_manifest.json` from the dataset's task directory and returns the
  `sourceUrl → localPath` map for completed downloads. `GalleryView` fetches this manifest on
  mount and filters to only images actually present in `downloads/images/`, serving them from
  local disk via `/api/v1/media/<localPath>` (fast, offline-capable). A "Show all extracted"
  switch toggles back to the full discovery view for users who want to see everything the scraper
  found.
- **3 new i18n keys**: `dataViewer.gallery.showAll`, `showingAll`, `showingDownloaded`.

### Fixed

- **View Dataset link → "Dataset file not found"** — The CLI emits paths that include the `output/`
  prefix (relative to CWD), so the manager stored `job.outputPath = "output/task_xxx/file.json"`.
  The datasets API then did `path.resolve(outputDir, "output/...")`, producing a double-prefixed
  `outputDir/output/task_xxx/...` that didn't exist. The manager now normalizes via
  `path.relative(outputDir, abs)` so `job.outputPath` is always relative to outputDir. The datasets
  API also strips a stray basename prefix as defense-in-depth for legacy job records.
- **No live job logs streaming during running jobs** — The executor only emitted `log` events for
  non-JSON stderr lines, but the CLI in `--json` mode emits exclusively NDJSON. The catch branch
  never fired so the log pipeline starved. The executor now synthesizes a log line from each
  progress event (`[phase] message`), with consecutive-duplicate dedupe so spinner frames don't
  spam. Live logs panel now updates in real time during running jobs.
- **WebSocket "Reconnecting to server..." banner in dev mode** — Vite proxy declared `/ws` with
  `ws: true` but the frontend connects to `/api/v1/ws`. The `/api` proxy matched the URL but lacked
  WS upgrade handling. Added an explicit `/api/v1/ws` proxy entry with `ws: true` before the `/api`
  catch-all. WebSocket now connects in dev mode.
- **Stale dashboard `dist/` shipping pre-fix gallery code** — `npm run start:web` serves the
  built `dist/` bundle. The previous gallery array-fix commit landed after the last build, so the
  user was running the old GalleryView. Rebuilt the dashboard. (Future: consider auto-rebuilding
  or staleness check on server startup.)

### Added

- **No live job logs in drawer** — Executor emitted `log` events but the manager never broadcast them
  over WebSocket. Added `job:log` event pipeline: manager → WS → jobStore → drawer. Running jobs now
  auto-expand the logs section with a "Live" badge and auto-scroll.
- **Gallery shows "no media" for array fields** — `detectMediaFields` and `getMediaUrl` only handled
  scalar strings. Datasets with `files: ["https://...jpg", ...]` arrays were silently skipped. Both
  functions now unwrap arrays to extract individual image URLs.
- **Job `outputPath` never populated** — Manager stored CLI result data but never extracted
  `outputFile`/`outputDir` from `job.result`. Now extracts and sets `job.outputPath` on completion.
- **Internal files polluting dataset listing** — `scanDataFiles()` picked up job persistence files
  (`jobs/*.json`) and internal task files (`metadata.json`, `downloads_manifest.json`, `operations.jsonl`,
  `errors.jsonl`) as "datasets". Added top-level `jobs/` exclusion and internal filename blocklist.
  Dashboard dataset count dropped from 662 → 547.
- **WebSocket broadcast missing result data** — `job:status` event excluded `result` and `outputPath`
  for completed jobs. Frontend now receives rich completion data without requiring a page refresh.
- **DataTable column overlap** — Dynamic columns had no width constraints, causing text overlap on wide
  datasets. Added `size`/`minSize`/`maxSize` constraints and enabled column resizing.
- **Table horizontal scroll breaking page layout** — Scrolling wide datasets scrolled the entire page.
  Contained horizontal overflow to the table area only.

### Added

- **Job Results section in drawer** — Completed jobs now show records count, output file, and URLs
  scraped as labeled values with badges. Unknown command results fall back to JSON display.
- **"View Dataset" button** — Links from completed job drawer directly to the dataset in DataBrowser
  when `outputPath` is available.
- **Resolved output directory display** — Dashboard and DataBrowser header show the absolute resolved
  output directory path from the config API (`resolvedOutputDir` and `cwd` fields).
- **Sidebar "Datasets" link** — Renamed "Data Viewer" to "Datasets" and moved from buried "Tools" group
  to top-level navigation for better discoverability.
- **`relativizePath` utility** — Frontend displays all job output paths relative to the output directory,
  never as absolute filesystem paths (information disclosure prevention).
- **Path traversal hardening tests** — Added test cases for `../../`, double-encoding (`%252e`), and
  null byte path traversal attempts against the datasets API.
- **`scanDataFiles` edge case handling** — Gracefully handles empty directories, permission-denied
  errors, and symlinks pointing outside the output directory.
- **ProgressPanel completion counters** — Shows final progress counters after job completion (previously
  gated behind `isRunning` flag).
- **30 new unit tests** covering outputPath extraction, scan exclusion, config API enrichment,
  WebSocket broadcast, path relativization (19 tests), and path traversal hardening.

### Fixed

- **All dashboard jobs failing instantly with `CLI_EXIT_ERROR`** — Executor placed `--json` and `--yes`
  after the subcommand name, but Commander.js `.enablePositionalOptions()` requires global options before
  the subcommand. Moved global flags before the command in arg construction. Also skips `json`/`yes` from
  user options to prevent duplicate flags.
- **Unhelpful error messages (`{"exitCode": 1}`)** — Non-JSON stderr lines were silently discarded in an
  empty `catch {}` block. Now captured in a ring buffer (100 lines / 8KB cap), included in error details,
  and used to extract meaningful error messages via a 3-tier heuristic.

### Added

- **stderr capture & log population** — Non-JSON stderr lines emitted as `log` events from executor,
  wired into `job.logs[]` via manager, persisted on job completion/error
- **Signal capture** — Process kill signals (SIGTERM, SIGKILL) captured and included in error messages
- **Structured error display** — Jobs drawer and ProgressPanel show exitCode/signal as badges with
  stderr in a scrollable, expandable `<Code>` block (falls back to JSON for old-format errors)
- **stderr sanitization** — Absolute paths truncated to relative, secrets redacted (Bearer tokens,
  AWS keys, sk- API keys, long hex/base64 strings). Git SHAs preserved.
- **Job wall-clock timeout** — 30-minute default; sends SIGTERM then SIGKILL after 5s grace period.
  Reports `JOB_TIMEOUT` error code.
- **JobErrorDetails type** — Typed interface (`exitCode`, `signal?`, `stderr?`) on both server and
  frontend, with backward-compatible union type
- **6 new i18n keys** for error display strings
- **30+ new unit tests** covering arg ordering, stderr capture, buffer caps, signal handling,
  sanitization patterns, and timeout behavior

### Fixed

- **Jobs page error display showing `[object Object]`** — Server `JobError` is a structured object
  (`{ code, message, details }`) but frontend typed it as `string | null`. Added union type
  `JobError | string | null` with `getErrorMessage()` helper. All 4 consumers updated: drawer,
  ProgressPanel, WebSocket handler, AppShell aria announcement
- **`handleResume` creating new job instead of resuming** — Changed to call `POST /api/v1/jobs/:id/resume`
  with error display on failure
- **Jobs table cluttered with MRT chrome** — Disabled global filter, top/bottom toolbars while keeping
  pagination and sorting infrastructure

### Added

- **Enriched job detail drawer** — Restructured into 5 sections: Summary (command, status, timestamps),
  Error (Alert with code badge + collapsible details), Options (filtered key-value list),
  Logs (collapsible Code block, 50-line truncation with "Show all"), Output
- **Jobs table improvements** — 3-dot context menu replaces inline buttons, error indicator on failed
  jobs, relative timestamps via dayjs, `interrupted` status filter, row hover/selected styling
- **Jobs page accessibility** — `aria-live="assertive"` on error alerts, keyboard navigation
  (tabIndex + Enter/Space) for table rows
- **Jobs page tests** — 33 new component tests covering list rendering, status filter, drawer,
  error display, context menu actions, log truncation, options filtering
- **15 new i18n keys** for Jobs page UI strings

### Changed

- **~90 form fields falsely marked as required** — Commander.js `opt.required` means "expects a value argument",
  not "mandatory option". Changed to check `opt.mandatory` (set by `.requiredOption()`). Only ~5 truly
  mandatory fields now show red asterisks (import --file, export --input/--output, clean --input, run --config)
- **Export page crash** — `Export.tsx` expected `apiGet` to return `DatasetInfo[]` but API returns
  `{ datasets: [...] }`. Fixed to unwrap the response envelope
- **Negated boolean flags rendered as text inputs** — `--no-llm`, `--no-fallback` etc. now correctly
  detected as boolean type via `opt.negate` check
- **CLI-only introspection flags shown in web UI** — `listPresets`, `listProviders`, `listTemplates`,
  `listFormats`, `listLanguages`, `listModels`, `helpFormat` now filtered from command metadata
- **CLI exits with error when run with no arguments** — Commander.js `commander.help` error code
  was not handled alongside `commander.helpDisplayed`, causing `Error: (outputHelp)` on clean help display

### Added

- **Web Dashboard UX Enhancements** — Replace free-text inputs with constrained controls across 20+ form fields
  - CLI commands: Added `.choices()` to 6 CLI commands for single-value fields (output-format, type, strictness, codec, etc.)
  - New API endpoints: `GET /providers` (with availability status), `GET /metadata/enums`, `GET /datasets/:path/fields`
  - FormBuilder: New `MultiSelect`, `TagsInput`, and model-select control types via `FIELD_ENHANCEMENTS` map
  - `metadataStore`: Centralized Zustand store replacing scattered fetch patterns, batch-loads all metadata on app init
  - Search providers: `MultiSelect` with availability indicators (disabled + tooltip for providers missing API keys)
  - Download formats: `Checkbox.Group` with full 10-format list sourced from API
  - Model fields: Searchable `Select` populated from Ollama models across Generate, Transform, Translate pages
  - Progressive disclosure: Download fields hidden until toggle enabled, model field hidden until LLM type selected
  - Split ratio validation: Visual warning when train+val+test ratios don't sum to 100%
  - Empty states: Helpful messages with links when no datasets exist
  - Standardized `Skeleton` loading states and error/button placement across all pages
  - Server-side option validation in `POST /jobs` — returns 400 for invalid choices, passes unknown options
  - Backward-compatible: Presets/configs with comma-separated strings auto-parsed to arrays
  - Array-to-CSV serialization in FormBuilder ensures CLI receives expected format
  - i18n: Translation keys for all new controls added to all 10 language files
  - Accessibility: `aria-live` on ProgressPanel, `IconX` with `aria-label` on Format page, keyboard nav verified
  - 7 new test files: metadataStore, FormBuilder, page interactions, a11y, integration, server endpoints

### Fixed

- **Theme toggle broken** — Header called Mantine's `toggleColorScheme()` which was overridden by
  `forceColorScheme` from Zustand store. Now cycles `auto -> light -> dark` via `uiStore.setTheme()`
- **Pipeline command rejected** — Frontend submitted `'pipeline'` but server only allows `'run'`.
  Changed to `submitJob('run', ...)` matching the CLI command
- **Upload preview path traversal** — `join(filePath)` was a no-op allowing arbitrary file reads.
  Now uses `resolve(UPLOAD_DIR, basename(filePath))` with validation
- **Preview error silently swallowed** — Import page catch block was empty; now shows Alert
- **JobMonitor FAB overlaps BottomNav** — Adjusted FAB position to `bottom: 72px` on mobile

### Added

- **WebSocket connection status banner** — Shows reconnecting/disconnected state in AppShell
- **Dropzone rejection feedback** — Import page shows Alert when unsupported files are dropped
- **Upload cleanup on cancel** — Calls `DELETE /api/v1/upload/:filename` when user cancels import
- **Streaming CSV/JSON preview** — Large files stream-parsed to prevent OOM (follows JSONL pattern)
- **Excel preview message** — Returns clear "preview not available" instead of generic error
- **aria-live region** — Announces job completion/failure for screen readers
- **BottomNav focus indicators** — Visible `focus-visible` ring on keyboard navigation
- **WebSocket reconnect jitter** — Random 0-50% jitter prevents thundering herd on server restart
- **66+ new tests** — Theme toggle, mobile responsive, accessibility, import flow, pipeline flow,
  WebSocket, and upload security tests across 7 new test files (1460 -> 1526 total)

### Added

- **Web Dashboard** — Full browser-based UI for all 14 CLI commands with real-time job monitoring
  - Fastify API server (`src/server/`) with REST + WebSocket APIs
  - React 19 + Mantine v7 SPA (`packages/dashboard/`) with dark/light theme
  - Job system: queue with configurable concurrency, persistence, interrupted job recovery
  - Data Viewer: table with virtual scrolling (100K+ rows), gallery view, record detail
  - FormBuilder: dynamic forms generated from CLI command schemas
  - ProgressPanel: real-time progress via WebSocket with throughput and counters
  - i18n: 10 languages (en, es, fr, de, ar, ja, zh, ko, pt, ru) with RTL support
  - Spotlight command palette (Ctrl+K) for quick navigation
  - Health checker for Ollama, Python, Scrapy, ffmpeg, yt-dlp
  - Disk space pre-flight checks before output-producing jobs
  - Loading skeletons, empty states, accessibility (aria-labels, keyboard nav)
  - Docker deployment via multi-stage Dockerfile
  - `web` CLI command (`dataset-builder web --port 3000 --open`)
  - 149 unit tests for all server modules

### Fixed

- **Vision relevance scoring always high** — VLLM prompt now includes a 5-tier calibration rubric
  with contrastive anchoring so non-matching images score low and get filtered. Previously all
  images received 0.8-1.0 regardless of content. On final retry, calibration is stripped to help
  small models parse JSON.
- **Format command fails on directory input** — `format -i task_folder/` now auto-detects known
  data files (classified.json, transformed.json, etc.) inside the directory instead of throwing
  "Unsupported file format:". Shows a helpful error if no data file is found.

### Added

- **Label modes for image classification** — three ways to control how images are labeled:
  - Default: VLLM assigns free-form labels (unchanged behavior, now with better relevance scoring)
  - `--labels "cat,dog,bird"` / `--labels-file labels.txt`: constrain VLLM to pick from a set,
    with fuzzy matching to snap off-list responses to the nearest valid label
  - `--auto-labels` / `--auto-labels-count N`: two-pass workflow that discovers natural categories
    from a sample of images, consolidates synonyms via text LLM, then classifies all images using
    the discovered labels
- **Label source tracking** — `_meta.labelSource` in output records: `"vllm"`, `"user_labels"`,
  `"auto_discovered"`, or `"deterministic"`
- **Relevance filter stats** — transform stats now show "Relevance filter: N kept, M dropped
  (threshold: X)"
- **Mutual exclusivity validation** — `--labels` + `--auto-labels` and `--auto-labels` + `--no-llm`
  produce clear CLI errors
- **Image classification workflow docs** — new `docs/image-classification-workflow.md` with Mermaid
  pipeline diagram, model invocation counts, real-world cost examples, and optimization reference
- **34 new tests** — relevance scoring (7), user labels (10), auto-labels (8), format directory
  input (9)

### Fixed

- **Download crash on illegal filename characters** — URLs containing `*`, `?`, `:`, `|`, etc.
  (e.g., Medium CDN URLs like `0*A7MUqyCLvZDcHkfM.jpg`) caused an unhandled ENOENT crash on
  Windows. Filenames are now sanitized before writing to disk. Also added error handling on the
  WriteStream to catch filesystem errors as proper exceptions instead of crashing the process.
- **Transform path resolution** — `assetDir` now uses the directory directly when input is a
  directory, instead of incorrectly calling `path.dirname()` which stripped the task folder.
  This was the root cause of "Image not found" errors in the scrape→transform→format pipeline.
- **Vision processor warnings in JSON mode** — all `console.warn` calls in vision-processor.ts
  are now guarded with `isJsonMode()` to prevent stdout corruption; important messages use
  `verboseLog` instead
- **Improved "Image not found" diagnostics** — warning now includes base directory, asset
  localPath, and a hint about checking assetDir configuration

### Added

- **Transform transparency** — stats now show completed/failed input breakdown, `drop_reasons`
  breakdown in human and JSON output, `degraded: true` flag with warnings array when fallback
  rate exceeds 50%, and `generation_method` (llm/deterministic/hybrid) in `_meta` per record
- **Early asset validation** — transform pipeline checks that at least one asset file resolves
  on disk before starting, failing fast with a clear error instead of producing empty output
- **Transform decision log** — new `TransformDecisionLog` class tracks per-record keep/drop
  decisions across filter, classify, threshold, and generate stages; written as
  `transform_decisions.jsonl` alongside output; controlled via `--no-log` flag; path included
  in JSON output stats
- **10 new tests** — path resolution regression tests (directory vs file input, asset path
  resolution) and filterAssets tests (failed/pending/completed status, missing localPath)

- **JSON mode stdout corruption** — guarded all `console.log/error` calls across 14 commands
  with `isJsonMode()` checks; stdout in `--json` mode now contains only valid JSON envelopes
- **ProgressTracker stdout leak** — `renderComplete()`/`renderError()` no longer write to stdout
  in JSON mode; suppressed to prevent JSON stream corruption
- **Missing output envelopes** — added `outputResult()` to `config reset/show/ollama-sync`,
  `clean` vision filter paths, `prune` no-files path, and `web-search` no-results path
- **`--json` hangs on prompts** — `--json` now implies `--yes` to auto-accept confirmations,
  preventing agents from blocking on interactive stdin
- **Circular reference crash** — `outputResult()` now catches `JSON.stringify` circular reference
  errors with a WeakSet-based fallback instead of crashing
- **downloadSummary tautology** — fixed dead-code ternary `return x ? true : true` → `return true`

### Added

- **Unified `--dry-run` support** — transform, translate, and resume commands now support the
  global `--dry-run` flag; compress and prune also respect `getGlobalFlags().dryRun` alongside
  their local options; all dry-run paths emit `dry_run: true` in the JSON result
- **CompletionEvent** — `ProgressTracker.complete()` emits a `{type:'complete'}` NDJSON event to
  stderr in JSON mode, giving agents a clear signal when long-running phases finish
- **Sensitive field masking** — `outputResult()` applies `maskSensitiveFields()` to JSON envelope
  data before serialization, preventing API keys/tokens from leaking
- **Protocol types** — exported `LogEvent`, `ProgressEvent`, `CompletionEvent`, `StderrEvent`,
  and `CLIProtocol` TypeScript interfaces from `src/utils/output.ts`
- **Agent protocol documentation** — `docs/agent-protocol.md` with full JSON protocol spec:
  envelope schemas, NDJSON stderr events, exit codes, per-command output examples
- **63 new tests** — JSON stdout isolation, ProgressTracker JSON mode, exit code coverage,
  dry-run contracts, `--yes` bypass in JSON mode, circular ref/large data, security masking,
  per-command smoke tests (1174 total, up from 1111)

### Fixed

- **Spider text extraction** — changed `.get()` to `.getall()` + join in generated Scrapy spider
  so nested HTML content (e.g., arXiv abstracts in `<blockquote>`) is fully captured instead of
  only the first text node; added `blockquote.abstract` and `#abs` to content selectors
- **Verbose logging disconnected** — `--verbose` CLI flag on transform command now sets
  `process.env.VERBOSE` so `logger.debug()` calls in llm-processor actually fire; added prompt
  logging, raw/cleaned response logging, retry attempt counters, and per-record outcome logging
- **Silent garbage output** — added content duplication detector that warns when >50% of input
  records share identical text (boilerplate); added high fallback rate warning (>50%); completion
  message changes from green checkmark to yellow warning on poor quality
- **Double `extractFinalResponse()` stripping** — removed duplicate thinking-token removal in
  llm-processor.ts (already done in ollama.ts), preventing corruption of thinking model output
- **Small model batch failures** — models with `:0.5b`–`:3b` in name now default to batch size 1;
  identical input text is deduplicated before LLM calls (send once, replicate result); returned
  record IDs are validated against input IDs with mismatch logging

### Added

- **`generationMethod` in `_meta`** — every output record now includes
  `generationMethod: "llm" | "deterministic"` so downstream tools can filter by generation quality
- **Structured failure categories** — `TransformStats.generationFailureBreakdown` tracks
  `emptyResponse`, `jsonParseError`, and `idMismatch` counts separately
- **ArXiv boilerplate pattern** — added `arXivLabs is a framework` fingerprint to
  `BOILERPLATE_PATTERNS` in deterministic.ts
- **Output integrity assertion** — transform command reads back the output file after writing and
  warns if record count doesn't match

- **LLM processor JSON parse failures** — replaced bare `JSON.parse()` at 4 call sites in
  `llm-processor.ts` with `tryParseJson()` that recovers from markdown-wrapped JSON, mixed text
  with embedded JSON, and returns null (triggering retry) instead of throwing on malformed output

### Added

- **Safe JSON parsing** — `safeJsonParse()` / `safeJsonlParse()` in `src/utils/json.ts` replacing
  13 unprotected `JSON.parse` calls across 6 files with CLIError context on failure
- **Credential masking** — `maskSensitiveFields()` in `src/utils/sanitize.ts` redacts API keys in
  DetailedLogger and verbose output to `first3...last3` format
- **Path traversal validation** — `validatePathBoundary()` in `src/utils/pathValidation.ts` prevents
  directory escape; applied to yt-dlp cookie file paths
- **Spider URL hardening** — `sanitizeSpiderUrl()` blocks null bytes, Unicode escapes, triple quotes,
  and URLs >2000 chars in Scrapy spider generation
- **Checkpoint/resume support** — `generate`, `translate`, and `clean` commands now save progress on
  SIGINT and resume via `--resume <checkpoint-file>` flag
- **PARTIAL_SUCCESS(6) exit code** — scrape command exits with code 6 when some URLs succeed and
  some fail, instead of GENERAL_ERROR
- **Streaming JSONL loading** — `loadData()` in formatters uses readline streaming for JSONL files
  with 100 MB size warning for JSON files
- **Chunked formatting** — `formatDataset()` processes records in configurable chunks (default 1000)
  instead of loading all at once
- **Throughput tracking** — `recordThroughput()` method on ProgressTracker calculates records/sec
- **Partial success summary** — `renderSummary()` in TUI displays color-coded succeeded/failed/skipped
- **Extensible error registry** — `registerErrorClassifier()` allows adding error→exit code mappings
  without modifying wrapAction internals

### Changed

- **Error classification in wrapAction()** — unhandled errors now map to specific exit codes:
  ModelNotFoundError→5, LLMAbortError/VisionAbortError→7, ECONNREFUSED/ETIMEDOUT→4, SyntaxError→2
- **Exit code audit** — ~15 GENERAL_ERROR sites across 7 command files reclassified to specific typed
  codes (INVALID_INPUT, NETWORK_ERROR, OLLAMA_UNAVAILABLE)
- **generateTaskId() consolidated** — single timestamp-based implementation in `taskManager.ts`;
  removed duplicate from `detailedLogger.ts`, updated all callers
- **formatBytes() consolidated** — canonical version in `tui.ts` with NaN/negative guard; removed
  duplicate from `downloadSummary.ts` and `compressor/index.ts`
- **truncateLine() ANSI fix** — strips ANSI codes before measuring/truncating, appends reset code
- **Dynamic progress bar** — adapts to terminal width instead of hardcoded 30 chars
- **JSON mode purity** — gated chalk output behind `isJsonMode()` in compress, import, export commands
- **--field-map/--role-map validation** — rejects nested objects and non-string values with CLIError
- **Ollama pool fail-fast** — throws CLIError(OLLAMA_UNAVAILABLE) immediately when zero healthy
  instances available instead of retrying indefinitely

### Improved

- **Type safety** — defined `CleanOptions`, `ScrapeOptions`, `SerpApiResponse`, `DownloadLogger`,
  `JsonSchemaLike` interfaces; replaced `any` in public APIs across 8 files
- **Dead code removal** — removed unused `buildSchemaPrompt()` and `validateAgainstSchema()` from
  `structured.ts`
- **Config access consistency** — audited and confirmed `getConfig()` pattern is uniform across codebase
- **Test coverage** — 51 new tests across 5 test files (json, sanitize, pathValidation,
  commandWrapper, runner); all 1061 tests pass

### Added

- **Project Constitution** — `.specify/memory/constitution.md` v1.0.0 with 8 core principles:
  Robustness, Open Architecture, Forward/Backward Compatibility, Industry Standards,
  High Performance, End-to-End Autonomy, CLI-First Integration, AI Agent Interoperability
- **Feature Spec: Full App Review** (`specs/001-full-app-review/`) — comprehensive codebase
  review covering robustness, security, performance, standards, TUI polish, and refactoring:
  - 6 user stories (P1–P3), 19 functional requirements, 11 success criteria
  - 61 implementation tasks across 9 phases with parallel execution strategy
  - Research findings: 13 unprotected JSON.parse calls, ANSI truncation bug,
    2 duplicated utilities, 60+ `any` types, spider injection edge cases
  - Clarifications: breaking checkpoint format, fail-fast Ollama pool, conservative dead code

### Added

- **Jupyter Notebooks** — 5 interactive notebooks in `notebooks/` for learning the CLI:
  - `01-quickstart` — End-to-end scrape → transform → format walkthrough
  - `02-data-generation` — Faker types and LLM-powered synthetic data
  - `03-import-clean-format` — Import, clean, and export in ML formats
  - `04-pipelines` — Multi-step JSON pipeline workflows
  - `05-vision-datasets` — Image scraping, cleaning, and vision format export
- **AI Agent-Friendly CLI Suggestions** — `docs/agent-friendly-cli.md` with 9 proposals for `--json`, `--quiet`, `--dry-run`, structured errors, and more
- **Agent-Friendly CLI** — full implementation of machine-friendly output and automation features:
  - Global `--json` flag — structured JSON output to stdout, logs redirected to stderr
  - Global `--quiet` flag — suppress progress/status output, keep errors and final result
  - Global `--yes` flag — centralized prompt auto-accept (replaces 7 per-command `-y` flags)
  - Global `--dry-run` flag — preview operations without executing (clean, format, generate, scrape)
  - Global `--stdin` flag — accept JSON options via stdin for complex configurations
  - NDJSON progress events to stderr in `--json` mode (500ms throttle)
  - Typed exit codes (0-7): success, error, invalid input, missing dep, network, Ollama, partial, abort
  - Structured JSON error output with error codes, messages, and details
  - `CLIError` class for typed error propagation across all 14 commands
  - `wrapAction()` command wrapper for consistent error handling in JSON mode
  - Unified `confirm()` utility replacing 7 duplicated readline confirmation blocks
  - Pipeline JSON Schema at `schemas/pipeline.schema.json` with Zod validation
  - `run --validate` subcommand for pipeline config validation without execution
  - Env var overrides: `DATASET_BUILDER_JSON`, `DATASET_BUILDER_QUIET`, `CI`
  - Commander.js `exitOverride()` for structured JSON on arg-parsing errors
  - 83 new tests across 8 test files

### Added

- **Parallel LLM Processing** — 4-10x throughput improvement for transform, translate, and clean commands:
  - Default `ollamaConcurrency` raised from 1 → 4, `ollamaVisionConcurrency` from 1 → 2
  - Priority-based concurrency queue with `drain()` and live `stats` tracking
  - Adaptive batch sizing (auto-grows on fast success, halves on failure/truncation)
  - Prompt deduplication with LRU cache (100 entries) and in-flight request dedup
  - Model pre-warming via `warmupModel()` — eliminates cold-load penalty
- **Multi-Model Task Routing** — `getModelForTask()` selects different models per task type:
  - `ollamaClassifyModel` for relevance scoring (use fast models like `qwen2.5:1.5b`)
  - `ollamaGenerateModel` for content generation
  - Falls back to default `ollamaModel` when not configured
- **Multi-Instance Ollama Pool** (`src/utils/ollamaPool.ts`) — distributed LLM processing:
  - Least-connections load balancing with model-aware routing and weight-based scheduling
  - Health checks (10s interval), automatic failover, single-instance fallback mode
  - Configure via `ollamaInstances` config or `--ollama-instances` CLI flag
- **Auto-Tune Concurrency** — `--auto-tune` flag queries `ollama ps` to suggest safe `NUM_PARALLEL` values based on loaded models and GPU/CPU usage
- **Enhanced TUI** — real-time LLM stats: records/sec throughput, active/max parallel requests, queue depth, model names
- **`config show` action** — displays concurrency settings, model routing, loaded models (via `ollama ps`), and multi-instance config
- **CLI Options** — `--classify-model`, `--generate-model`, `--ollama-instances`, `--auto-tune` on transform/translate/clean commands
- **New Tests** — 27 tests across `llm-parallel-baseline.test.ts` (17) and `ollamaPool.test.ts` (10)

- **CLI Regression Tests** — 7 new test files (35 tests) covering all fixed verification gaps:
  - `format-pipeline.test.ts`, `clean-negation.test.ts`, `clean-dedupe.test.ts`,
    `translate-languages.test.ts`, `multi-word-options.test.ts`, `field-map-syntax.test.ts`,
    `vision-model-config.test.ts`
- **`--output-format` flag for `scrape` command** — canonical flag for output format selection; `-o` now shows deprecation warning when used for format
- **`--field-map` shorthand syntax** — accepts `key:value,key:value` in addition to JSON

### Fixed

- **Format pipeline validation order (RC1)** — field mapping now runs before validation, fixing 24 failures where mapped fields were incorrectly flagged as missing
- **`--no-*` negation flags (RC2)** — `--no-trim`, `--no-remove-empty`, `--no-normalize-newlines`, `--no-check-nsfw` now parse correctly in Commander.js
- **`--dedupe-images` standalone (RC6)** — dedupe flags now included in directory input guard, allowing image deduplication without `--vision-filter`
- **Comma-separated languages (RC4)** — `-l es,fr` now correctly splits and resolves both languages
- **Multi-word option values (RC3)** — `--vision-target "sports cars"` and `--system-prompt` now handle quoted multi-word values
- **Default Ollama model (RC5)** — changed from non-existent `llama2` to `llama3.2`; added `ollamaVisionModel: 'llava'` default; vision filter now throws on model-not-found instead of silently passing all images
- **Improved error messages** — validation, language resolution, vision model, and field-map errors now include received/expected/example context

### Changed

- **Documentation** — README clarifies `--search` vs `--web-search` distinction and `--download` boolean semantics

---

- **CLI Verification Report** (`docs/verification-results.md`) — end-to-end test of 175 CLI commands identifying 39 failures and 10 skips
- **SerpAPI Search Provider** (`src/scrapy/search/providers/serpapi.ts`) — adds SerpAPI-backed Google, Bing, DuckDuckGo, Google Images, and Google Scholar providers
- **Downloader TUI Tests** (`src/downloader/tui.test.ts`) — new test coverage for download progress display
- **SerpAPI Provider Tests** (`src/scrapy/search/providers/__tests__/`) — unit tests for new search provider

### Fixed

- **Progress bar clamping** — prevent negative `repeat()` crashes by clamping filled bar width to `[0, barWidth]` in downloader, generator, and translator TUI
- **Test updates for noFallback behavior** — LLM/Vision processors now return empty results on consecutive failures instead of throwing abort errors; tests updated accordingly
- **`filterScrapedPages` return type** — tests updated for new `{validPages}` object return type
- **`ensureModel` mock** — added to all Ollama mock setups in transformer tests
- **Vitest config** — excluded flaky `scrapy/runner.test.ts`

### Changed

- **Search presets expanded** — web, images, and academic presets now include SerpAPI provider variants

---

- **Image Cleanup Flags for `clean` command** — pre-filter junk images before vision analysis
  - `--remove-junk` removes SVGs, ICOs, icons, logos, favicons, spinners, and files < 5KB
  - `--min-size <bytes>` removes files below a custom byte threshold
  - `--min-dimensions <WxH>` removes images below minimum width/height (e.g. `100x100`)
  - `--vision-sensitivity <n>` sets relevance threshold 0.0–1.0 from CLI
  - New `src/sanitizers/imageCleanup.ts` module with `filterJunkImages()` reusing patterns from `deterministic.ts`
  - Directory input now accepts cleanup flags without requiring `--vision-filter`
- **Concurrent Ollama Requests** — all Ollama calls (text and vision) now support configurable parallelism
  - `ollamaConcurrency` config key for text LLM tasks (default: 1 = sequential)
  - `ollamaVisionConcurrency` config key for vision tasks (default: 1 = sequential)
  - CLI flags: `--ollama-concurrency <n>` and `--vision-concurrency <n>` on clean, transform, and translate commands
  - `ConcurrencyQueue` utility (`src/utils/concurrency.ts`) with `run()`, `map()`, `mapSettled()` methods
- **Ollama Server Auto-Configuration** — automatically sets `OLLAMA_NUM_PARALLEL` and restarts Ollama when concurrency > 1
  - `config ollama-sync` subcommand for manual server sync
  - Auto-triggered at start of clean, transform, translate when concurrency flags > 1

### Changed

- **`--search-limit` renamed to `--search-count`** — new per-provider semantics: `--search-count 15` with 3 providers = each provider fetches 15, dedup removes cross-provider overlap
- **`deduplicateAndRank()` no longer truncates** — returns all unique results instead of slicing to a hard limit, fixing zero-result issue with image providers
- **Smart scraping** — direct file URLs with `metadata.sourceUrl` now also scrape the hosting page at requested depth, deduplicating source URLs
- **Dedup report** — inline display after search (`Found 75 results → 52 unique (23 duplicates removed)`) and in SCRAPE SUMMARY box
- **Each provider gets full count** — removed the `1.5x / providerCount` division that starved individual providers

### Added

- **Object Detection Transform** (`object-detection`) — dual-engine approach with YOLOv8 (Python/ultralytics, recommended) and VLLM (Ollama vision models, fallback)
  - YOLO engine: runs YOLOv8 via Python subprocess → accurate bboxes + class labels + confidence
  - VLLM engine: prompts vision model for structured JSON with percentage-based bboxes → converts to absolute pixels
  - Deterministic fallback (`--no-llm`): single full-image bbox with label from context
  - Output: one record per detected object with `image, bbox, category, confidence, image_width, image_height`
- **Segmentation Transform** (`segmentation`) — uses SAM2 (Segment Anything Model 2) via Python subprocess
  - Auto-generates binary mask PNGs for each detected segment
  - Optional segment labeling via Ollama vision model (or `segment_N` labels with `--no-llm`)
  - Output: one record per mask with `image, mask_path, category, bbox, area, image_width, image_height`
- **COCO-Seg Formatter** (`coco-seg`) — COCO annotation format with `segmentation.mask_file` references, copies mask PNGs to `masks/` directory
- **YOLO-Seg Formatter** (`yolo-seg`) — YOLO segmentation format with polygon coordinates in label TXT files (`class_id x1 y1 x2 y2 ... xn yn` normalized), `data.yaml` config
- **Python Runner** (`src/transformer/python-runner.ts`) — generic Python subprocess runner with JSON parsing, timeout, and Python availability checks
- **Image Utils** (`src/transformer/image-utils.ts`) — reads PNG/JPEG/WebP/GIF/BMP dimensions from file headers without npm dependencies
- **CV Python Scripts** — `scripts/yolo_detect.py`, `scripts/sam_segment.py`, `scripts/mask_to_polygon.py`, `scripts/requirements-cv.txt`
- `--mask-field` CLI option for segmentation formatters
- "CV/Detection templates" section in `--list-templates` output

- **Multi-Source Search** - Combine multiple search engines in a single query with cross-provider deduplication and ranking
  - `--search-provider google,bing,brave` runs all providers in parallel, deduplicates by URL, boosts results found by multiple engines
  - 17 search providers: Google, Bing, DuckDuckGo, Brave, Ollama, YouTube, Reddit, arXiv, Google Scholar, Semantic Scholar, Sketchfab, Google Images, Bing Images, GitHub, X/Twitter, Facebook, Instagram
  - `--source-preset <preset>` for convenient groupings: `web`, `images`, `videos`, `academic`, `code`, `3d-assets`, `social`
  - `--list-providers` and `--list-presets` for discovery
  - Modular provider system (`src/scrapy/search/`) with `BaseSearchProvider` abstract class for easy extension
  - Full backward compatibility — existing single-provider usage unchanged

- **Per-Record Timing** - Transform and format commands now report per-record duration breakdown
  - Transform summary shows `Generation: Xs (avg Xms/record)` after the total duration line
  - Format summary shows `Duration: Xs (avg Xms/record)` after record counts
  - Added `generationDuration` and `avgRecordDuration` fields to `TransformStats`
- **Preserved Progress Bar** - Progress bar last state now stays visible in the terminal
  - On completion: progress bar remains above the completion summary instead of being cleared
  - On Ctrl+C abort: progress bar remains above the abort message so you can see final progress
  - On error: progress bar remains above the error message

### Fixed

- **Model Auto-Pull on Not Found** - When a user specifies a model that doesn't exist locally (e.g. `--model qwen3.5:2b`), the CLI now detects it at pre-flight and prompts to pull instead of silently failing every API call
  - Added `ModelNotFoundError` class and `ensureModel()` method to `OllamaClient` — checks local models, prompts `[Y/n]` to pull, streams download progress (auto-pulls with `-y`)
  - Added "not found" detection in `generate()`, `generateStream()`, and `chat()` error handlers — throws `ModelNotFoundError` instead of generic error
  - All 7 retry loops in vision-processor and llm-processor now bail immediately on `ModelNotFoundError` (no wasted retries)
  - Pre-flight check in `transformDataset()` calls `ensureModel()` after verifying Ollama connectivity
- **TUI Summary Overwrites CLI Prompt** - After `transform` completes or is interrupted (Ctrl+C), the summary stats no longer overwrite the terminal prompt line
  - `ProgressTracker.stop()` now writes a trailing newline in TTY mode to ensure cursor is on a clean line
  - Abort handler sets `trackerStarted = false` after `tracker.stop()` to prevent double-stop

- **Ctrl+C Graceful Shutdown** - Pressing Ctrl+C during `transform` now works properly:
  - In-flight Ollama HTTP requests are cancelled immediately via `AbortController` signals on all `fetch()` calls and `Promise.race` abort on SDK `chat()` calls
  - TUI progress tracker stops immediately (render interval cleared, terminal cleaned up)
  - Checkpoint is always saved on abort — even on fresh runs (previously required `--resume` to have been used)
  - All 6 templates now check the global abort flag and set `abortedEarly` in stats
  - Second Ctrl+C sets a force-quit flag that exits after checkpoint save (no more immediate `process.exit(1)`)
- **Transform Stats Display** - Combined "Generated" and "Vision fallback" into a single line showing VLLM/LLM vs deterministic fallback breakdown

### Added

- **`--no-think` Flag** - Disable VLLM thinking mode for faster vision output (`think: false` on all 6 `ollama.chat()` calls in vision-processor)
- **OllamaClient `abortAll()`** - New method to abort all in-flight fetch requests via shared `AbortController`

### Fixed (previous)

- **Transform Error Masking** - Processors (vision-processor, llm-processor) no longer silently inject deterministic fallback results when LLM/VLLM calls fail; failed records are left undefined so templates can handle them with accurate stats
  - Removed `results.set()` from catch blocks in all processor functions (`scoreRelevance`, `generateQA`, `generateConversation`, `generateInstruction`, `classifyImages`, `captionImages`, `generateVisionQA`)
  - Stats now accurately report `visionFallbackCount`, `generationFailedCount`, `skippedCount`, and `errorCount`
  - Progress bars now include failed items in count (`completed + failed`) so they always reach 100%
- **Transform Resume/Checkpoint** - Fixed checkpoint never saving progress during initial runs, making `--resume` always reprocess everything
  - Orchestrator now populates `processedIds` and `partialResults` from template results
  - Checkpoint saved on abort (`abortedEarly`), cleared on successful completion
- **Transform SIGINT Handling** - Replaced immediate `process.exit(0)` with graceful two-stage abort: first Ctrl+C saves checkpoint, second force quits

### Added

- **`--no-fallback` Flag** - Skip failed records entirely instead of using deterministic fallback (`--no-fallback` and `--no-llm` are mutually exclusive)
- **`--retries` Flag** - Configure retries per LLM/vision call before giving up (default: 3)
- **Consecutive Failure Abort** - In `--no-fallback` mode, 5 consecutive LLM/VLLM failures throw `LLMAbortError`/`VisionAbortError` with partial results, saving checkpoint for `--resume`
- **`skippedCount` and `abortedEarly` Stats** - New fields in transform stats track records skipped in no-fallback mode and whether processing was interrupted

### Fixed

- **Vision-QA JSON Parse Error on Thinking Models** - Fixed `transform -t vision-qa` crashing with `SyntaxError: Unexpected end of JSON input` when using thinking models (e.g. `qwen3.5:9b`)
  - Switched vision processor from raw `OllamaClient.generate()` to `OllamaClient.chat()` with `think: true`, using the ollama SDK's native thinking token separation
  - Added format retry: when `format` + thinking tokens produce empty response, automatically retries without `format` constraint
  - Added `tryParseJson` defensive parser handling raw JSON, markdown code blocks, and embedded JSON in mixed text
  - Added `<think>` tag stripping to `extractFinalResponse` (alongside existing `<thinking>` support)
  - Added explicit `noLlm` guards to `classifyImages`, `captionImages`, `generateVisionQA` — previously relied on accidental error fallback
  - Removed unused `encodeImage` function (chat API handles image encoding internally)
  - Updated test mocks to use `getOllama().chat()` returning plain strings; added regression tests for empty response retry, think tag stripping, malformed JSON fallback, and markdown code block extraction
- **Vision Image Path Resolution** - Fixed transform vision processor resolving image paths relative to app CWD instead of dataset root directory
  - `path.resolve(asset.localPath)` resolved against `process.cwd()` instead of the task directory
  - Now uses `options.assetDir` (populated from input file's parent directory) as the base for `path.resolve()`
  - Fixed in all 3 vision functions: `classifyImages()`, `captionImages()`, `generateVisionQA()`
  - Fixed `fs/promises` mock in vision-processor tests (added `default` export), fixing 6 pre-existing test failures
- **Vision-QA Transform Silent Fallback** - Fixed 5 interacting bugs that caused vision-QA transforms to silently skip VLLM and produce low-quality deterministic output
  - **`--no-llm` flag broken**: Commander `.option('--no-llm', ..., false)` default made `options.llm` always false; removed bogus default and read `options.llm === false`
  - **Model prefix not stripped**: `-m ollama:llava` sent full string to Ollama API; added `stripProviderPrefix()` to strip `ollama:` prefix in `generate()`, `generateStream()`, `chat()`
  - **Silent file-not-found**: `generateVisionQA()` and `captionImages()` silently skipped missing images; added `console.warn` for each
  - **Silent deterministic fallback**: Vision-QA template used `generateContextualQA()` without warning; now tracks VLLM vs fallback counts and logs warnings
  - **Explicit model + unreachable Ollama**: `-m model` with Ollama down silently fell back; now throws descriptive error telling user to start Ollama or use `--no-llm`

### Added

- **Vision Fallback Stats** - New `visionFallbackCount` in transform stats shows how many assets used deterministic fallback instead of VLLM
- **Ollama API Key Auth** - Added `Authorization: Bearer` header support to all Ollama API calls (listModels, ping, generate, generateStream)
- **Cloud Model Detection** - Vision processor warns when cloud models (gemini, claude, kimi) are used, suggesting local alternatives
- **Asset Linker Auto-Discovery** - `autoLoadInput()` now finds manifest files alongside scraped data files automatically
- **Contextual Vision-QA Fallback** - Improved deterministic fallback generates meaningful Q&A from filename, page title, and target topic instead of generic "An image."

### Documentation

- **Comprehensive I/O Specifications** - Added detailed input/output examples to DOCUMENTATION.md
  - Transform template I/O specs for all 8 templates (raw-extract, text-instruct, text-qa, text-conversation, image-classification, image-captioning, vision-qa, audio-classification)
  - Formatter I/O examples for all 14 formatters with sample JSON input/output
  - New Walkthrough 7: Complete LLaVA multimodal pipeline (Images → vision-qa → LLaVA format)
  - Data flow diagrams showing scrape → transform → format pipeline integration

### Added

- **Transform Filter Reason Tracking** - Added detailed breakdown of why records were filtered
  - New `FilterReasons` interface tracking: invalidUrl, invalidTitle, textTooShort, textTooLong, lowWordRatio, missingText
  - Updated `filterScrapedPages()` to return `FilterResult` with reasons and filtered details
  - Stats output now shows filter breakdown: `Filtered: 63 (42 too short, 15 no title, 6 invalid URL)`
  - Verbose mode logs first 10 filtered records with specific reasons
  - Applied to all text templates: text-qa, text-instruct, text-conversation, raw-extract

- **Transform Default Output Location** - Changed default output to use input directory
  - When no `-o` flag provided, output goes to `<input_dir>/transform/transformed.json`
  - Works for both file and directory inputs
  - Creates `transform/` subdirectory automatically
  - Falls back to creating new task folder only if input doesn't exist

### Fixed

- **Transform Missing Records Tracking** - Fixed unexplained record drops in transform stats
  - Added `generationFailedCount` to track records where LLM returned no result
  - Added `qualityFilteredCount` to track records filtered by quality checks (instruction <10 chars, output <20 chars)
  - Stats now show complete pipeline: Input → Filtered → Relevant → Generated → Dropped → Output
  - Example: `Dropped: 15 quality filtered` explains where missing records went

- **chalk.bold error in transform command** - Fixed `chalk.bold is not a function` error
  - Changed from CommonJS `require('chalk')` to ES module `import chalk from 'chalk'`
  - Import now at module level instead of inside function

### Added

- **Transform Resume Capability** - Checkpoint-based resume for interrupted transform operations
  - New `--resume` flag to continue transform from last checkpoint
  - New `--force` flag to clear checkpoint and start fresh
  - Auto-detection of existing checkpoints with user guidance
  - New `TransformCheckpoint` interface for tracking progress
  - New `src/transformer/checkpoint.ts` module with save/load/clear utilities
  - Checkpoints saved every 10 records during processing
  - Checkpoint automatically cleared on successful completion
  - Resuming filters already-processed records and merges results

- **Web Scraping Text Extraction** - Fixed empty text extraction for modern websites
  - Added fallback body text extraction when semantic selectors return no results
  - Expanded content selectors to include modern site patterns (`[class*='content']`, `.page-content`, `[itemprop='articleBody']`, etc.)
  - Reduced minimum text length threshold from 20 to 10 characters
  - Removed over-filtering of legal terms (copyright, terms of service, privacy policy) from ad_keywords

- **Ollama Search Limit Bug** - Fixed `--search-limit` being ignored (always returned 10 results)
  - Removed hardcoded `Math.min(limit, 10)` limitation
  - Implemented pagination with offset parameter for requests > 10 results
  - Added deduplication for aggregated results across multiple API calls
  - Added verbose logging to show actual limits requested vs received

- **Search Result Formatting** - Cleaned up search result display
  - Added consistent numbered list format with `Search Results (N found):` header
  - Added URL and Snippet prefixes for clarity
  - Strips `[web_link]`, `[image_link]` markers, markdown links, and HTML entities from snippets
  - Truncates snippets to 150 characters to prevent terminal flooding
  - Added blank lines between entries for better readability

- **Scrape Progress Tracking** - Fixed misleading record counts and unstructured output
  - Progress tracker now counts actual scraped records (not just URL completions)
  - Added structured summary box after scraping with URLs scraped, records found, duration, and output path
  - Replaced plain `console.log` lines with formatted TUI summary

- **Clean Command Progress Tracking** - Fixed wrong total, no per-record progress, and broken ETA
  - ProgressTracker was initialized with `phases.length` (2-4) instead of actual record count, causing progress to show "1/2 (50%)" instead of per-record progress
  - Added `setTotal()` method to ProgressTracker for resetting progress per phase with accurate ETA
  - Each cleaning phase now shows per-record progress (e.g., "17/34 50%") with phase labels like "LLM filter (2/3)"
  - Added `onProgress` callbacks to `applyLlmFilter()`, `applyMathVerification()`, and `applyFactCheck()`
  - Added `onProgress` to `FilterOptions` in `llmFilter.ts`, replacing `console.log` batch progress

### Added

- **Unified TUI System** (`src/utils/tui.ts`) - New terminal UI components for consistent progress display
  - `ProgressTracker` class with live updating counters, progress bars, and ETA calculation
  - `ProgressSpinner` class for indeterminate operations
  - Helper functions: `formatNumber`, `formatBytes`
  - Integrated across scrape, clean, format, transform, and web-search commands

- **Phase 4: Expanded Formatter Documentation** - Comprehensive documentation for the complete pipeline
  - Added Pipeline Overview section with 3-phase Mermaid diagram (Scrape → Transform → Format)
  - Transform Command Reference: complete CLI syntax, options table, 8 template descriptions
  - Downloads Manifest Reference: full schema documentation, example JSON, usage examples
  - Pipeline Stage Documentation: 6 detailed stages with diagrams (Load, Cleanup, Validate, Field Map, Split, Output)
  - Formatter Reference Cards: all 14 formatters documented with purpose, input/output, CLI examples, options, and gotchas
    - Text formatters (5): alpaca, chatml, sharegpt, oasst, raw
    - Vision formatters (5): llava, imagefolder, csv-images, coco, yolo
    - Audio formatters (2): audiofolder, speech-text
    - HuggingFace formatters (2): datasetdict, parquet
  - End-to-End Walkthroughs: 6 complete examples covering common workflows
    - Articles → Alpaca format
    - Q&A CSV → ChatML
    - Car Images → ImageFolder
    - Object Detection → COCO/YOLO
    - Speech Dataset → Speech-Text
    - Any Data → HuggingFace DatasetDict
  - Known Limitations section with severity table and workarounds
  - Expanded Troubleshooting section for transform and formatter issues
  - Documentation expanded from ~1,700 to 3,045 lines (+1,236 lines)

- **Phase 4: Expanded Formatter Documentation** - Comprehensive documentation for the complete pipeline
  - Updated Table of Contents with 7 new sections (13 total)
  - Pipeline Overview section with 3-phase flow diagram (Scrape → Transform → Format)
  - Transform Command Reference with all options, 8 templates, and process flow diagram
  - Downloads Manifest Reference with full schema documentation and examples
  - Pipeline Stage Documentation (6 stages with Mermaid diagrams):
    - Stage 1: Load & Format Detection
    - Stage 2: Cleanup (deduplication, validation, quality filtering)
    - Stage 3: Validate (required fields per formatter)
    - Stage 4: Field Mapping (template syntax and transformations)
    - Stage 5: Split (ratios and stratified splitting)
    - Stage 6: Output (routing by formatter type)
  - Formatter Reference Cards for all 14 formatters:
    - Text formatters (5): alpaca, chatml, sharegpt, oasst, raw
    - Vision formatters (5): llava, imagefolder, csv-images, coco, yolo
    - Audio formatters (2): audiofolder, speech-text
    - HuggingFace formatters (2): datasetdict, parquet
  - End-to-End Walkthroughs (6 complete examples):
    - Walkthrough 1: Scraped Web Articles → Alpaca
    - Walkthrough 2: Q&A CSV → ChatML
    - Walkthrough 3: Car Images → ImageFolder
    - Walkthrough 4: Object Detection → COCO/YOLO
    - Walkthrough 5: Speech Dataset → Speech-Text
    - Walkthrough 6: Any Data → HuggingFace DatasetDict
  - Known Limitations and Troubleshooting section
    - Limitations table with severity ratings and workarounds
    - Expanded troubleshooting for transform and formatter issues
    - Common error messages and solutions
  - Documentation expanded from ~1,700 lines to 3,045 lines

- **Phase 3: Transform Command** - Convert scraped data to structured records automatically
  - New `transform` CLI command with 8 templates (text-qa, text-instruct, text-conversation, image-classification, image-captioning, vision-qa, audio-classification, raw-extract)
  - Deterministic utilities: junk filtering, boilerplate removal, deduplication (`src/transformer/deterministic.ts`)
  - LLM processor: batched relevance scoring, Q&A generation, instruction generation (`src/transformer/llm-processor.ts`)
  - Vision processor: image classification and captioning using vision models (`src/transformer/vision-processor.ts`)
  - Asset linker: connects manifest assets to scraped page data (`src/transformer/asset-linker.ts`)
  - 6-stage transform pipeline: Load & Detect → Pre-filter → Classify → Generate → Quality → Output
  - Auto-detection of input type (scraped_combined.json, downloads_manifest.json, or task folder)
  - `--no-llm` flag for deterministic-only mode (no API calls required)
  - Progress callbacks with ETA and stage reporting
  - 135 tests across 6 test files
  - Test fixtures for scraped data and manifest

- **Phase 3: Transform Command** - Convert scraped data to structured training records
  - New CLI command: `transform` with 8 templates for text, image, and audio
  - Text templates: `raw-extract`, `text-qa`, `text-instruct`, `text-conversation`
  - Vision templates: `image-classification`, `image-captioning`, `vision-qa`
  - Audio templates: `audio-classification`
  - 6-stage pipeline: Load & Detect → Pre-filter → Classify → Generate → Quality Filter → Output
  - Deterministic utilities (`src/transformer/deterministic.ts`): junk filtering, boilerplate removal, deduplication
  - LLM processor (`src/transformer/llm-processor.ts`): batched processing with retry/backoff
  - Vision processor (`src/transformer/vision-processor.ts`): sequential image classification/captioning
  - Asset linker (`src/transformer/asset-linker.ts`): matches manifest assets to scraped pages
  - Auto-detects input: `scraped_combined.json`, `downloads_manifest.json`, or task folder
  - `--no-llm` flag for deterministic-only mode when Ollama unavailable
  - Relevance scoring with `--target` and `--relevance-threshold` (default 0.5)
  - Progress callbacks with ETA
  - 135 tests across 5 test files (deterministic, LLM, vision, templates, integration)
  - Test fixtures in `src/transformer/__fixtures__/`
  - `downloads_manifest.json` auto-generated in `downloads/` subdirectory per task
  - `AssetManifest` and `AssetRecord` interfaces in `src/downloader/types.ts`
  - Tag extraction from URL paths and page titles (`extractTags()` in `src/downloader/manifest-utils.ts`)
  - Manifest merging on resume (`mergeManifests()`)
  - Page context tracking: `sourcePageTitle`, `sourcePageId`, `altText`, `surroundingText`, `pageDepth`
  - Per-asset metadata: source URL, local path, file type, size, status, duration, tags, relevance (null)
  - 16 unit tests in `src/downloader/manifest.test.ts`

- **Phase 8 Completion: Validation Scripts & Documentation** - Final Phase 8 deliverables
  - Format compliance validator (`scripts/validate-format-compliance.ts`) — tests all 14 formatters against expected schemas
  - Performance benchmark (`scripts/benchmark-formatters.ts`) — 10k record benchmark with <30s threshold for text formatters
  - HuggingFace loading validator (`scripts/validate-hf-loading.sh`) — end-to-end `load_dataset()` test (graceful skip if Python/datasets missing)
  - Field mapping guide in Documentation.md — template syntax, CLI usage, common examples, pipeline ordering
  - Troubleshooting section in Documentation.md — 8 common issues with solutions
  - `field-map.json` fixture with 6 named mapping presets (Q&A→Alpaca, nested paths, composites)
  - npm scripts: `validate:formats`, `benchmark:formatters`, `validate:hf`

### Changed

- **Arrow formatter dropped from scope** — covered by DatasetDict and Parquet formatters; `apache-arrow` is a heavy native dependency and HF's `load_dataset()` handles Arrow conversion internally
- Updated Phase 8 plan checkboxes (all tasks T1-T7 complete) and all 6 Success Metrics verified

- **Phase 8: Formatter Testing & Validation** - Comprehensive test suite for all formatters
  - Vitest test runner with v8 coverage (`vitest`, `@vitest/coverage-v8`)
  - 441 tests across 27 test files covering all 14 formatters
  - Test fixtures in `src/formatters/__fixtures__/` (text, vision, audio, HuggingFace, cleanup data)
  - Core utility tests (70): field mapping, splitting, statistics, hashing, I/O
  - Cleanup pipeline tests (87): dedupe, validate, quality, filter, orchestrator
  - Text formatter tests (62): alpaca, chatml, sharegpt, oasst, raw
  - Vision formatter tests (65): utils, llava, coco, yolo, imagefolder, csv-images
  - Audio formatter tests (30): utils, audiofolder, speech-text
  - HuggingFace formatter tests (58): utils, card, datasetdict, parquet
  - Registry & orchestrator tests (48): registration, lookup, categories, pipeline flow
  - Integration tests (12): end-to-end with real temp dirs for all major formatters
  - npm scripts: `test`, `test:watch`, `test:coverage`
  - Updated `tsconfig.json` to exclude test files from production build

- **Phase 6: HuggingFace Integration** - 2 HuggingFace dataset formatters with dataset card generation
  - `datasetdict` - HuggingFace DatasetDict format with `dataset_info.json` (JSON or Parquet output)
  - `parquet` - Standalone Apache Parquet format for HuggingFace datasets (requires `@dsnp/parquetjs`)
  - Dataset card generator (`README.md` with YAML frontmatter) works with any formatter via `--generate-card`
  - HuggingFace utilities: schema inference, feature mapping, stratified splitting, Parquet row building
  - Stratified splitting via `--stratified-field` maintains class distribution across train/val/test
  - Card metadata CLI options: `--license`, `--task-categories`, `--card-language`, `--card-description`
  - `handlesOwnSplitting` property on `Formatter` interface for formatters that manage their own splitting
  - Field-level statistics (`computeStatistics()`) rendered in dataset card body
  - `metadata.json` written for HF formatter path (same as standard formatters)
  - New dependency: `@dsnp/parquetjs` for Parquet file writing
  - Files: `src/formatters/huggingface/` (new: `card.ts`, `datasetdict.ts`, `parquet.ts`, `utils.ts`, `index.ts`)

### Fixed

- **`stratifiedSplit` seed bug** - Each class group was creating a fresh seeded RNG, causing identical shuffle per group. Now uses a single shared RNG across all groups.
- **Parquet numeric type coercion** - String numbers like `"123"` were silently dropped to `0` instead of parsing correctly. Now uses `Number()` parsing with `NaN` fallback.
- **Duplicate parquet row-building logic** - Extracted shared `buildParquetRow()` to `utils.ts`, imported in both `parquet.ts` and `datasetdict.ts`.
- **Invalid `outputFormat` silently accepted** - Values like `'xml'` or `'arrow'` now rejected with clear error message during validation.
- **Schema inference sampling bias** - `inferHFSchema` only sampled first 100 rows; now samples evenly across the dataset.
- **Hardcoded HF formatter list** - Replaced `['datasetdict', 'parquet'].includes()` check with `handlesOwnSplitting` property.
- **Stale `'arrow'` references** - Removed from `DatasetDictOptions` type and formatter registry category.

- **Phase 5: Audio Formatters** - 2 audio dataset formatters
  - `audiofolder` - Audio classification folder structure (class_name/audio.wav + metadata.csv)
  - `speech-text` - Speech transcription format (audio + text pairs with optional duration/ffprobe)
  - Audio utilities: `validateAudio`, `getAudioMetadata` (ffprobe), `copyAudio`
  - Audio-specific CLI options: `--audio-field`, `--class-field`, `--audio-extensions`, `--text-field`, `--duration-field`, `--extract-duration`, `--copy-media`
  - `--help-format audiofolder` and `--help-format speech-text` detailed help
  - Files: `src/formatters/audio/` (new: `audiofolder.ts`, `speech-text.ts`, `utils.ts`, `index.ts`)

- **Phase 4: Vision Formatters** - 5 vision/detection dataset formatters
  - `llava` - LLaVA vision-language format with image token, base64 embedding, media copying
  - `imagefolder` - HuggingFace ImageFolder classification format (class_name/image.jpg)
  - `csv-images` - CSV metadata with image paths + JSON/JSONL output
  - `coco` - COCO object detection format (annotations.json with images/annotations/categories, auto category mapping, bbox area)
  - `yolo` - YOLO detection format (images/ + labels/ + classes.txt + data.yaml, auto bbox format detection)
  - Vision utilities: `resolveImagePath`, `validateImage`, `copyImage`, `imageToBase64`, `convertBboxCocoToYolo`, `convertBboxYoloToCoco`, `getRelativeImagePath`, `batchValidateImages`
  - Vision-specific CLI options: `--image-token`, `--embed-images`, `--max-embed-size`, `--class-field`, `--image-extensions`, `--bbox-field`, `--category-id-field`, `--category-name-field`, `--image-width`, `--image-height`
  - `--help-format <name>` now shows actual per-formatter help with fields, options, and examples
  - Files: `src/formatters/vision/` (new: `llava.ts`, `imagefolder.ts`, `csv-images.ts`, `coco.ts`, `yolo.ts`, `utils.ts`, `index.ts`)

### Fixed

- **Duplicate `CsvImagesOptions` type** - Removed duplicate interface definition from `csv-images.ts`, now imports from central `types.ts`

- **`format` Command** - Format datasets into ML/LLM training formats
  - Phase 1 (Base): Usage: `npm start -- format -i data.json -f alpaca -o ./output`
    - Supported formats: `alpaca`, `chatml`, `sharegpt`, `raw`
    - Field mapping with template syntax: `--field-map '{"q": "instruction", "a": "output"}'`
    - Train/val/test splitting: `--split 80:10:10` with reproducible seed `--seed 42`
    - Plugin-based formatter architecture for easy extension
    - Files: `src/formatters/index.ts`, `src/formatters/types.ts`, `src/formatters/registry.ts`, `src/formatters/utils.ts`, `src/formatters/text/*.ts`, `src/cli/commands/format.ts`
  - Phase 3 (Text Formatters): OASST formatter, conversation grouping, roleMap, and gap fixes
    - New OASST (OpenAssistant) formatter with message tree structure and parent-child threading
    - ChatML: multi-turn conversation grouping via `--conversation-id-field`, role remapping via `--role-map`, `--include-system` toggle
    - ShareGPT: conversation threading via `--conversation-field`, custom field mapping via `--human-field`/`--assistant-field`, `record.system` field support
    - OASST: custom tree/parent ID fields via `--tree-id-field`/`--parent-id-field`, `--lang` option, system prompt for pre-formatted messages
    - Alpaca: `--include-empty-input` to omit empty input fields, `--default-input` for fallback values
    - Token statistics (totalTokens, avgTokensPerRecord) added to all formatter outputs
    - Per-record format detection (mixed messages/flat records in same dataset)
    - `ExtendedFormatOptions` type uses indexed access types from formatter option interfaces
    - Files: `src/formatters/text/oasst.ts` (new), `src/formatters/text/chatml.ts`, `src/formatters/text/sharegpt.ts`, `src/formatters/text/alpaca.ts`, `src/formatters/text/raw.ts`, `src/formatters/text/index.ts`, `src/formatters/index.ts`, `src/formatters/types.ts`, `src/cli/commands/format.ts`
  - Phase 2 (Cleanup Pipeline): Data cleanup and verification with `--cleanup`
    - Deduplication: `--cleanup-dedupe` with exact match, URL-based, and fuzzy matching (Fuse.js)
    - Field validation: `--cleanup-validate` with `--required-fields` for required field checks
    - Zod schema validation: `validateWithZod()`, `createSchemaFromTypeMap()`, `validateAndTransform()`
    - File reference validation: `--validate-file-fields` to verify file paths exist
    - Email/URL/date/range validation utilities
    - LLM quality scoring: `--cleanup-quality` with `--quality-threshold` filtering
    - Multiple scoring methods: length-based, readability, diversity, format compliance, LLM-based
    - Content filtering: `--min-length`, `--max-length`, `--remove-empty`
    - Advanced filtering: `filterByCriteria()`, `sampleRandom()`, `balanceByField()`, `filterByExpression()` with AND/OR logic
    - Statistics tracking: detailed per-stage stats in metadata output
    - New dependency: `zod` for schema validation
    - Files: `src/formatters/cleanup/index.ts`, `src/formatters/cleanup/dedupe.ts`, `src/formatters/cleanup/validate.ts`, `src/formatters/cleanup/quality.ts`, `src/formatters/cleanup/filter.ts`

- **`generate` Command TUI** - Real-time progress display for LLM generation
  - Alternate screen buffer with progress bar, percentage, and status indicators
  - Shows current/total records, ETA, elapsed time
  - Status indicators: generating, repairing 🔧, retrying 🔄, completed ✓, failed ✗
  - Works for both structured (schema-based) and simple LLM generation
  - Graceful Ctrl+C handling - finishes current record before exiting
  - Follows same pattern as `translator/tui.ts` and `downloader/tui.ts`
  - New file: `src/generators/tui.ts`
  - Modified: `src/generators/structured.ts` (added `onProgress` callback), `src/cli/commands/generate.ts` (TUI integration)

- **`translate` Command** - Translate datasets into multiple languages using LLM (Ollama)
  - Usage: `npm start -- translate -i data.json -l es fr de -y`
  - 29 supported languages with language registry (code, name, native name resolution)
  - Batch processing with Ollama structured output (`format` parameter) for reliable JSON
  - Dynamic batch sizing: auto-reduces when payload exceeds 8KB
  - Fallback chain: structured batch → JSON repair → record-by-record translation
  - Field-level control: `--fields` to translate only specific fields, `--exclude-fields` to skip fields
  - Per-language output (default) or `--merged` mode with `_language` field
  - Output formats: JSON, JSONL, CSV (auto-detects from input format)
  - Progress TUI with alternate screen, per-language stats, ETA, batch progress
  - Graceful Ctrl+C handling: finishes current batch, saves partial results
  - Model registry with `gemini-3-flash-preview:cloud` default
  - Info queries: `--list-languages`, `--list-models`
  - Config keys: `translateModel`, `translateBatchSize`
  - Task system integration with `translate` task type
  - Files: `src/translator/` (new module: `languages.ts`, `engine.ts`, `tui.ts`, `index.ts`), `src/cli/commands/translate.ts` (new), `src/config/defaults.ts`, `src/utils/taskManager.ts`, `src/cli/index.ts`

- **Download Size Estimation** - Pre-download summary now shows estimated file sizes
  - HTTP HEAD requests for regular URLs to get Content-Length
  - `yt-dlp --dump-json` for YouTube video size estimation (filesize_approx)
  - Playlist size estimated by sampling first video and multiplying by entry count
  - Per-type size breakdown: `Image  42 files  (~210 MB)`
  - Total estimated size line with known/unknown count
  - New `getVideoFileSize()` export in `videoHandler.ts`
  - `--no-estimate` flag to skip size estimation (both `scrape` and `resume` commands)
  - Files: `src/utils/downloadSummary.ts`, `src/downloader/videoHandler.ts`, `src/cli/commands/scrape.ts`, `src/cli/commands/resume.ts`

### Fixed

- **Ctrl+C Immediate Abort** - Downloads now abort immediately on first Ctrl+C instead of waiting for active downloads to finish
  - Added shared `AbortController` in `Downloader` class, signaling all in-flight operations on cancel
  - `fetch()` calls now use `AbortSignal.any([timeout, userCancel])` to respond to both timeout and user abort
  - `yt-dlp` child processes killed via `signal.abort` listener calling `ytdlp.kill()`
  - Added `signal?: AbortSignal` to `YouTubeDownloadOptions`, `handleFileDownload()`, and `downloadWithProgress()`
  - Wait loop breaks on `this.aborting` flag, marks remaining active items as failed
  - Double Ctrl+C has `setTimeout(...).unref()` safety net for Windows yt-dlp process cleanup
  - Early abort checks before each retry attempt in both `processItem()` and `handleFileDownload()`
  - Files: `src/downloader/index.ts`, `src/downloader/fileHandler.ts`, `src/downloader/videoHandler.ts`

- **`compress` Command** - Compress video and image files using ffmpeg
  - Usage: `npm start -- compress <path> --codec h264 --quality 23`
  - Options: `--codec` (h264/h265/av1), `--quality` (CRF 0-51), `--image-quality` (1-100), `--format` (mp4/webm/mkv), `--keep-original`, `--dry-run`, `-y`
  - Recursively finds video and image files, shows summary, compresses with progress
  - Replaces originals by default; `--keep-original` preserves them
  - Requires ffmpeg system install
  - Files: `src/compressor/index.ts` (new), `src/cli/commands/compress.ts` (new), `src/cli/index.ts`

- **YouTube Playlist Video Count** - Show actual video count before downloading playlists
  - New `getPlaylistInfo()` function using `yt-dlp --flat-playlist --dump-json`
  - Displays per-playlist breakdown: `Playlist "Title": 47 videos`
  - Updated summary: `Found 3 URLs (127 videos total)` instead of `Found 3 files`
  - Applied to both `scrape` and `resume` commands
  - Files: `src/downloader/videoHandler.ts`, `src/cli/commands/scrape.ts`, `src/cli/commands/resume.ts`

- **Pre-download Summary & Confirmation** - Review downloads before they begin
  - Shows type breakdown, sample URLs, and total counts
  - Readline confirmation prompt (default: Yes)
  - `-y, --yes` flag to skip confirmation on both `scrape` and `resume` commands
  - Files: `src/utils/downloadSummary.ts` (new), `src/cli/commands/scrape.ts`, `src/cli/commands/resume.ts`

- **Configurable YouTube Download Options** - Expose yt-dlp quality/format settings to CLI
  - `--yt-quality <resolution>`: Set video quality (e.g., 720, 1080, best)
  - `--yt-audio-only`: Download audio only (MP3)
  - `--yt-video-only`: Download video only (no audio)
  - Options saved in metadata.json for resume; resume falls back to original task settings
  - Config keys: `ytQuality`, `ytAudioOnly`, `ytVideoOnly`
  - Files: `src/downloader/videoHandler.ts`, `src/downloader/fileHandler.ts`, `src/downloader/index.ts`, `src/config/defaults.ts`, `src/cli/commands/scrape.ts`, `src/cli/commands/resume.ts`

### Fixed

- **TUI Live Refresh** - Fixed download progress display freezing during long yt-dlp downloads
  - Added 200ms periodic `setInterval` refresh in `Downloader.start()` to update TUI independently of download completion callbacks
  - TUI now shows real-time progress even during 10+ minute YouTube downloads
  - File: `src/downloader/index.ts`

- **Translation TUI Progress Not Updating in Realtime** - Fixed progress display freezing during LLM API calls
  - `onProgress()` in `engine.ts` now fires after each batch/record completes, not just before
  - Added 1-second refresh timer in `tui.ts` to keep elapsed time ticking during API waits
  - Removed 100ms throttle that was hiding meaningful progress updates
  - Added "Translating..." / "Completed" status line to TUI display
  - Cleaned up redundant alternate screen escape sequences in both translator and downloader TUIs
  - Files: `src/translator/engine.ts`, `src/translator/tui.ts`, `src/downloader/tui.ts`

### Fixed

- **YouTube Playlist False Failure Reporting** - yt-dlp exits non-zero for partial playlist failures (unavailable/private videos), causing the app to report "0 succeeded, N failed" despite files being on disk
  - `downloadYouTubePlaylist()` now counts actual downloaded files on non-zero exit and returns success if any exist
  - `downloadYouTubeVideo()` checks for downloaded file on disk before reporting failure
  - Added `countDownloadedFiles()` helper to recursively scan output directories for media files
  - Guarded `fs.statSync()` in `processItem()` to handle YouTube's `%(playlist_title)s/%(title)s.%(ext)s` output paths
  - Files: `src/downloader/videoHandler.ts`, `src/downloader/index.ts`

- **YouTube Playlist Downloads** - Fixed playlist URLs silently filtered out of download queue
  - `scrape.ts` format filter and type detection now check `isYouTubePlaylist()` alongside `isYouTubeUrl()`
  - `resume.ts` had zero YouTube awareness; added imports and YouTube URL detection to format filter
  - Added upfront yt-dlp availability check with user-friendly warning before downloads start
  - Result: 10/10 YouTube URLs now detected vs 1/10 before fix
  - Files: `src/cli/commands/scrape.ts`, `src/cli/commands/resume.ts`

- **YouTube URL Detection** - Fixed regex patterns losing backslash escaping during JS template literal evaluation
  - Double-escaped `\.` and `\?` in YouTube regex patterns so Python receives proper regex syntax
  - Root cause: JS template literals silently drop single backslashes (unknown escape sequences)
  - Added regression test verifying backslash preservation in generated spider code
  - Files: `src/scrapy/runner.ts`, `src/scrapy/runner.test.ts`

- **Download Progress Display** - TUI now shows explicit "Files: X/Y (Z%)" progress indicator in the header
  - Added progress percentage calculation alongside existing completed/failed/pending counts
  - Located in `src/downloader/tui.ts:52`

- **Duplicate Scrape JSONs** - Fixed files appearing in both root output and task folder
  - Added `outputDir` parameter to `runScrapy()` for direct task folder writing
  - Modified `combineScrapedOutputs()` to write directly to task folder
  - Added cleanup of individual temp files after combining
  - Files: `src/scrapy/runner.ts`, `src/cli/commands/scrape.ts`

- **Spam/Ads Content Filtering** - Enhanced spider content filtering to remove ads and unrelated content
  - Added comprehensive CSS selectors for ad containers, cookie banners, newsletters, social widgets
  - Added text-based filtering for common ad phrases and spam content
  - Increased minimum text length filter from 10 to 20 characters
  - Added parent element checking for ad containers
  - File: `src/scrapy/runner.ts`

- **Enhanced Logging** - Added per-file download logging with detailed tracking
  - Log every download attempt with URL, source URL, and attempt number
  - Log every completion with file size, duration, and path
  - Log every failure with error type and status code
  - Integrated with existing DetailedLogger system
  - Files: `src/downloader/index.ts`, `src/downloader/fileHandler.ts`

- **Task Metadata Type Field** - Added `taskType` field to identify operation type
  - Added to TaskInfo interface and metadata creation
  - Values: 'scrape', 'generate', 'resume', 'clean', 'import', 'export'
  - Files: `src/utils/taskManager.ts`, `src/utils/detailedLogger.ts`, `src/cli/commands/scrape.ts`, `src/cli/commands/resume.ts`

- **YouTube Video Downloads** - Added yt-dlp integration for downloading YouTube videos
  - New `videoHandler.ts` module with `isYouTubeUrl()` and `downloadYouTubeVideo()` functions
  - Spider now detects YouTube URLs in links
  - File handler routes YouTube URLs to yt-dlp instead of standard HTTP download
  - Requires yt-dlp installation separately
  - Files: `src/downloader/videoHandler.ts` (new), `src/downloader/fileHandler.ts`, `src/scrapy/runner.ts`

- **YouTube Video Download Recognition** - Fixed YouTube URLs not being recognized for download
  - Spider now adds the scraped URL itself to `files` array if it's a YouTube video
  - Video format filter now recognizes YouTube URLs without file extensions
  - Import `isYouTubeUrl` in scrape command for format detection
  - Files: `src/scrapy/runner.ts`, `src/cli/commands/scrape.ts`

### Added

- **`resume` Command** - Resume downloads from existing task folders
  - Usage: `npm start -- resume <task-directory>`
  - Options: `--overwrite`, `--concurrent <n>`, `--timeout <ms>`, `--verbose`
  - Automatically detects already-downloaded files and skips them
  - Updates metadata.json with resume history and stats
  - Uses original task settings from metadata (concurrency, timeout, formats)

- **Detailed Logger Utility** - Structured logging system for all operations
  - Creates `logs/` subdirectory in task folders with three log files:
    - `operations.jsonl` - Structured JSONL log entries
    - `stdout.log` - Human-readable formatted logs
    - `errors.jsonl` - Error-level entries only
  - Error classification: HTTP codes, timeouts, DNS errors, connection issues
  - Integrated with scrape command for comprehensive operation tracking

### Fixed

- **Hotlink Protection Bypass** - Fixed incorrect Referer header causing 403 errors on CDN-protected images
  - Added `sourceUrl` field to `DownloadItem` interface to track source page URL
  - Pass `source_url` from scraped items through download chain to `handleFileDownload()`
  - Use source page URL as Referer header instead of deriving from file URL
  - Correct flow: `Scrapy Spider → enrichEntry(source_url) → handleDownloads(sourceUrl) → downloadWithProgress(referer)`
  - Fixes 403 errors on hotlink-protected images (e.g., CDN images requiring page Referer)

### Changed

- **Task-Based Output Organization** - Scrape downloads now organized in task folders
  - New folder structure: `output/task_{timestamp}_{id}/`
  - Subdirectories: `downloads/{images,videos,pdfs,documents,csv,html,other}/`, `scraped/`, `cleaned/`, `logs/`
  - Metadata file (`metadata.json`) with task info: query, provider, timestamps, stats
  - Individual scrape results saved to `scraped/page_{XXX}.json`
  - Combined output copied to task folder
  - Type-based subdirectory mapping for downloads

- **Download Timing Optimizations** - Reduced retry delays for faster downloads
  - 403 errors: 1s→2s→4s (max 8s) → 500ms→1s→2s (max 2s)
  - Other errors: 1s→2s→3s (max 5s) → 500ms→1s→1.5s (max 1.5s)
  - Default timeout: 30s → 15s (configurable via `--timeout`)

### Added

- **`--timeout` CLI Option** - Configurable download timeout for scrape command
  - Usage: `npm start -- scrape --search "images" --download --timeout 10000`
  - Default: 15000ms (15 seconds)

### Fixed

- **Downloader Error Handling** - Fixed process crash on download failures (HTTP 403, network errors)
  - Added `.catch()` handler to promise chain in `src/downloader/index.ts:108-129` to prevent unhandled rejections
  - Added error event listener in constructor to prevent `ERR_UNHANDLED_ERROR` when emit() has no listeners
  - Failed downloads now tracked gracefully without crashing the process
  - Downloads continue even when individual files fail

- **TUI Error Display** - Improved error visibility in download progress UI
  - Added `extractBriefError()` function to convert full error messages to brief types (e.g., "HTTP 403", "Timeout")
  - Normal mode: Shows brief error types only (e.g., "HTTP 403", "Connection refused")
  - Verbose mode: Shows full error details with `printSummary()` function
  - Added final summary showing completed/failed counts with error details (when verbose)

- **HTTP 403 Forbidden Handling** - Added retry logic with User-Agent rotation
  - Added array of 5 realistic User-Agent strings for rotation
  - Added `getRequestHeaders()` with browser-like headers (Accept, Accept-Language, Referer)
  - Implemented exponential backoff retry (1s, 2s, 4s...) for 403 errors
  - Extracts referer from URL for more authentic requests
  - Maximum retry attempts: 3 with configurable backoff

- **Python Syntax Error in Generated Spider (Escape Sequences)** - Fixed unterminated string literal error in generated spider code
  - Changed `text = "\n\n".join(unique_texts)` to `text = "\\n\\n".join(unique_texts)` in `src/scrapy/runner.ts:147`
  - JavaScript template literals interpret `\n` as actual newlines, breaking Python syntax
  - Double backslash (`\\n`) produces literal `\n` in output, which is valid Python
  - Added regression test in `src/scrapy/runner.test.ts`

- **Scraped Data Missing Unique IDs** - Combined scrape output now includes unique identifiers and metadata for each entry
  - Added `id` field with format `entry_{index}_{timestamp}` for tracking
  - Added `source_url` field to track origin URL for each entry
  - Added `scraped_at` field with ISO timestamp
  - New `enrichEntry()` function in `src/cli/commands/scrape.ts`

- **Text Extraction Includes HTML/CSS/JS** - Fixed spider to extract only visible page content
  - Replaced `response.css("::text")` which captured scripts and styles
  - Now targets semantic elements: `p, h1-h6, article, section, main, .content, #content`
  - Explicitly excludes: `script, style, noscript, nav, footer, header[role='banner'], svg`
  - Filters out short fragments (< 10 chars) and removes duplicates

- **PDF Detection Missing Many Files** - Enhanced PDF discovery in spider
  - Added detection for PDFs in `<embed>` and `<iframe>` tags
  - Added check for links with `type="application/pdf"` attribute
  - Added check for `data-pdf` and `data-file` attributes
  - Now catches PDFs with query parameters or tracking URLs

- **Images Not Downloaded** - Fixed image URLs not being passed to downloader
  - Images from `<img src>` and `<img srcset>` now added to `files` field
  - Responsive images via `srcset` attribute are parsed and included
  - `<source src>` tags for responsive media are also captured
  - All media URLs deduplicated before adding to output

### Added

- **Ollama Web Search** - Added support for Ollama's web search API
  - New `web-search` command for standalone web searches
    - `--query, -q` - Search query (required)
    - `--max-results, -n` - Maximum results (default: 5, max: 10)
    - `--output, -o` - Output file path
    - `--format, -f` - Output format (json, jsonl, csv)
  - New `--web-search` flag for `generate` command to enhance LLM prompts with web context
  - API key support with priority: `OLLAMA_API_KEY` env var > `ollamaApiKey` config
  - Config option `webSearchMaxResults` for default result limit
  - Web search module at `src/generators/webSearch.ts` with `webSearch()`, `formatSearchResultsAsContext()`, and `isWebSearchAvailable()` functions
  - `WebSearchResult`, `WebSearchOptions`, `WebSearchResponse` interfaces in `src/generators/ollama.ts`
  - Ollama now available as scrape search provider (`--search-provider ollama`)
  - `searchOllamaApi()` function for API-based search in scrape command

- **Ollama Search Provider** - Added Ollama as a search provider for scrape command
  - New `ollama` provider option for `--search-provider` in scrape command
  - Configurable via `searchProvider` config option
  - Auto-detects provider based on available API keys (brave > ollama > bing > google > duckduckgo)
  - Falls back to DuckDuckGo HTML scraping if no API key configured

### Fixed

- **Python Syntax Error in Generated Spider** - Fixed JavaScript spread operator in Python template string
  - Changed `[...img_urls, ...video_urls]` to `img_urls + video_urls` in `src/scrapy/runner.ts:146`
  - This was causing a Python syntax error when the `scrape --search` command generated temporary spider files
  - The spread operator (`...`) is JavaScript syntax, not valid Python

- **Scrape Search Provider Always DuckDuckGo** - Fixed `--search-provider` option ignoring configuration
  - Removed hardcoded `duckduckgo` default from CLI option
  - Provider now determined by priority: CLI flag > config > auto-detect based on API keys
  - Auto-detection order: brave > ollama > bing > google > duckduckgo
  - New config option `searchProvider` to set default provider

- **Auto-Search Returns 0 URLs** - Fixed search functionality with API-based search and enhanced HTML scraping
  - Added API-based search support for Brave, Bing, Google Custom Search, and **Ollama Web Search**
  - API keys can be set via config: `braveApiKey`, `bingApiKey`, `googleApiKey`, `googleSearchEngineId`, `ollamaApiKey`
  - New `searchOllamaApi()` function in `src/scrapy/autoSearch.ts`
  - HTML scraping now tries APIs first when keys are configured, falls back to scraping
  - Enhanced anti-bot detection including RTL text detection (Google redirect pages)
  - Added command-line options: `--search-api-key`, `--search-engine-id`
  - Improved error messages suggesting API key usage for reliable results

- **LLM Structured Output Fails Silently** - Fixed JSON parsing errors with detailed logging and recovery
  - Added comprehensive verbose logging throughout structured generation

- **Scrape with Search Not Actually Scraping or Downloading** - Fixed critical issue where search results bypassed scraping
  - New flow: Search → Scrape URLs → Discover files → Download files (was: Search → Try to download URLs directly)
  - Added `scrapeSearchResults()` function to scrape each search result URL
  - Added `combineScrapedOutputs()` function to merge multiple scraped outputs into single file
  - Updated `handleDownloads()` to extract file URLs from `files` field in scraped data
  - Spider now extracts downloadable file URLs from links and media tags (img, video)
  - Supports file types: PDF, images (jpg, png, gif, webp, svg), videos (mp4, webm, avi), documents (docx, pptx, csv), archives, audio
  - Format filtering with regex patterns for each file type
  - Deduplication of discovered file URLs
  - Helpful error messages when no files match requested formats

- **Scrape with Search Not Actually Scraping or Downloading** - Fixed broken scrape flow where search results were not being scraped
  - Fixed spider to extract file URLs (images, PDFs, videos, documents, etc.) from pages
  - New `scrapeSearchResults()` function scrapes each search result URL before downloading
  - New `combineScrapedOutputs()` function merges multiple scrape outputs into single file
  - Fixed `handleDownloads()` to extract file URLs from scraped `files` field (not just page URLs)
  - Now follows correct flow: Search → Scrape → Download (was incorrectly: Search → Try to download URLs directly)
  - Added format pattern matching for file type filtering (image, pdf, video, etc.)
  - Improved progress logging throughout scrape and download process
  - Raw responses are logged when JSON parsing fails
  - Specific validation failure reasons are now logged
  - Response timing tracked per attempt

- **Limited JSON Repair** - Enhanced JSON repair beyond simple bracket balancing
  - Added deterministic repairs: trailing commas, curly quotes, unescaped characters
  - Added comment removal from JSON responses
  - Returns detailed repair status (attempted, success/failure)

- **Poor Execution Summary** - Added comprehensive metrics reporting for LLM generation
  - New `GenerationMetrics` interface with success rate, errors, timing breakdown
  - Success rate percentage displayed
  - Error breakdown by type (Schema Validation, JSON Parse, Request Failed, etc.)
  - JSON repair statistics (attempts, successes, rate)
  - Average response time tracking

- **Flat Output Structure** - Implemented task ID folder organization
  - LLM generation now creates `output/task_XXXXXXXX/` folders
  - Output saved in `generated/` subfolder within task directory
  - Metadata file created with generation stats and task info
  - Task ID displayed at generation start and in summary

- **Generate Ignores Prompt** - Fixed `generate` command defaulting to Faker even when prompt (`-p`) or auto-schema (`-a`) was provided
  - LLM mode now auto-detects when prompt or auto-schema options are present
  - No longer requires explicit `-t llm` flag when using prompt-based generation

- **Global Verbose Option** - Added `--verbose` global flag for detailed debugging output across all commands
  - Created `src/utils/logger.ts` utility with `verboseLog()` function
  - Search commands now show detailed fetch URLs, response status, selector attempts, and extracted results

### Fixed

- **Cheerio Import** - Fixed `cheerio.load is not a function` error in auto-search and importers by using correct ES module import syntax (`import * as cheerio from 'cheerio'`)
- **LLM Thinking Tokens** - Added automatic filtering of reasoning/thinking tokens from models like DeepSeek-R1 using `extractFinalResponse()` helper
- **Native Structured Outputs** - Updated to use Ollama's native `format` parameter for reliable JSON schema adherence instead of prompt engineering
- **Auto-Schema Generation** - Added `--auto-schema` flag to generate JSON schemas from natural language descriptions (e.g., `"product with name, price, description"`)
- **Default Output Path** - LLM generation now saves to `./output/llm_<timestamp>.json` when no `-o` flag is provided, with path displayed to user
- **Download Validation** - Fixed unhandled "Invalid image file" errors by adding content-type validation and graceful warning instead of throwing
- **Task Organization** - Added task management system (`src/utils/taskManager.ts`) for organizing output files with unique task IDs and subfolders

### Planned

- Add support for more file formats (Avro)
- Implement caching for LLM responses
- Add support for custom scrapy spiders
- Add data validation schemas
- Implement incremental scraping

## [0.1.0] - 2026-02-22

### Added

#### Core Features

- **CLI Framework** - Command-line interface built with Commander.js
- **Configuration System** - Centralized config with get/set/list/reset commands
  - Persistent storage using `conf` library
  - Type-safe configuration with TypeScript
  - Support for: outputDir, maxConcurrent, ollamaModel, ollamaUrl, filterStrictness, batchSize, visionSensitivity, verbose

#### Data Generation

- **Faker Integration** - Synthetic data generation via @faker-js/faker
  - Support for: person, address, company, product, text, lorem data types
  - Locale support (en, de, es, fr, etc.)
  - Export to JSON, JSONL, CSV formats
- **LLM Integration** - Ollama API client for text generation
  - Streaming and non-streaming generation
  - Structured JSON output with schema validation
  - Retry logic with exponential backoff
  - Model management (list, ping)
- **Batch Generation** - Generate multiple records with progress tracking

#### Web Scraping

- **Auto-Search** - Search engine integration for URL discovery
  - Support for Google, Bing, and DuckDuckGo
  - Configurable result limits
  - HTML parsing with Cheerio
- **Scrapy Integration** - Python Scrapy integration for web scraping
  - Multiple spider support
  - Configurable depth and output formats
  - Custom settings file support
- **Multi-threaded Downloader** - Concurrent file downloads with TUI progress
  - Support for images, videos, PDFs, PPTX, DOCX, CSV
  - Configurable concurrency
  - Retry logic with exponential backoff
  - Progress bars with real-time updates

#### Data Import/Export

- **Multi-format Importers** - Import from various file formats
  - CSV with custom delimiters
  - JSON and JSONL
  - XML with automatic extraction
  - XLS/XLSX (Excel)
  - TXT (line-based)
  - HTML (links, images, headings, paragraphs)
- **Multi-format Exporters** - Export to various file formats
  - JSON with pretty-print option
  - JSONL (newline-delimited)
  - CSV with proper escaping
  - Object flattening for nested data

#### Data Sanitization

- **Basic Cleaning** - Core data cleaning operations
  - Remove duplicates
  - Trim whitespace
  - Convert to lowercase
  - Remove empty fields
  - Normalize line endings
- **LLM Filter** - LLM-based text filtering
  - Profanity detection
  - Relevance filtering by topic
  - Hallucination detection
  - Configurable strictness (low/medium/high)
  - Batch processing support
- **Math Verifier** - Mathematical expression verification
  - Expression extraction from text
  - Evaluation using mathjs
  - Support for complex expressions
  - Validation of equality claims
- **Fact Checker** - Factual claim verification using LLM
- **Vision Filter** - Vision-based image filtering
  - NSFW content detection
  - Minors check
  - Image relevance by topic
  - Configurable sensitivity

#### File Management

- **Prune Command** - Clean output files by age or pattern
  - Dry-run mode for safe preview
  - Force mode for non-interactive deletion
  - Recursive file matching
  - Age-based filtering (days)
  - Glob-like pattern matching

#### Development Tools

- **ESLint Configuration** - Code linting with @eslint/js
- **Prettier Configuration** - Code formatting
- **Husky Integration** - Git hooks for pre-commit checks
- **TypeScript Support** - Full TypeScript implementation
- **Lint-staged** - Run linting on staged files

### Technical Details

#### Architecture

- Modular component design
- Event-driven downloader with TUI
- Singleton pattern for configuration and Ollama client
- Strategy pattern for importers/exporters
- Command pattern for CLI commands

#### External Dependencies

- Ollama for LLM capabilities (requires local installation)
- Python with Scrapy for web scraping
- Node.js with TypeScript

#### Configuration Storage

- Platform-specific config directory via `conf` library
- JSON-based configuration file
- Environment variable support via dotenv

### Known Issues

- Test coverage focused on formatters; other modules (scraper, generators) not yet covered
- LLM features require running Ollama instance
- Scrapy integration requires Python installation
- Vision filter is simulated (not using actual vision models)
- Some search providers may block automated requests

## [0.0.1] - 2026-02-20

### Added

- Initial project setup
- Basic project structure with TypeScript
- CLI framework with Commander.js
- README.md with usage instructions
- Package.json with dependencies
- TypeScript configuration
- ESLint and Prettier setup
- Husky pre-commit hooks

---

## Version History Summary

| Version | Date       | Key Features                                                                                                     |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| 0.1.0   | 2026-02-22 | Full feature implementation: config, scrape, generate, clean, prune, import, export, LLM integration, sanitizers |
| 0.0.1   | 2026-02-20 | Initial project setup                                                                                            |

## Migration Notes

### Upgrading to 0.1.0

- Configuration system is now persistent
- Previous command-line defaults may need adjustment
- Ollama integration requires local Ollama installation

## Contributing

When adding new features:

1. Update this CHANGELOG.md
2. Follow conventional commit format
3. Update Documentation.md with new APIs
4. Add examples to the Usage section

## Future Roadmap

### Short Term (Next Release)

- [x] Comprehensive test suite (Phase 8 - formatters)
- [ ] Better error messages
- [ ] Configuration validation
- [ ] More file format support

### Medium Term

- [ ] Plugin system for custom sanitizers
- [ ] Web UI for visual data exploration
- [ ] Pipeline caching
- [ ] Incremental updates

### Long Term

- [ ] Distributed scraping
- [ ] Cloud storage integration
- [ ] Dataset versioning
- [ ] Collaboration features
