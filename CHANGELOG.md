# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-27

First marketable release. The product now ships as three coordinated components
(Java Ghidra plugin server, Python MCP bridge, Tauri desktop GUI) and a unified
docker-compose deployment.

### Added — Server (Java)
- **Async job system** (`JobManager`, `Job`, `/jobs`, `/jobs/{id}` endpoints).
  `/upload` and `/import` queue work onto a single dedicated worker thread and
  return immediately with a `job_id`. Long-poll completion via `?wait=N`.
- **`/search` endpoint** — cross-program lookup for `function`, `symbol`, and
  `string` types. Used by the LLM bridge `find_function`/`search_strings`/
  `search_symbols` tools and by the GUI Search page.
- **Project state persistence** — imported programs are saved to the on-disk
  Ghidra project (`/data` volume) and restored on server startup.
- **Resource caps** to prevent OOM on large binaries:
  - `/callgraph/full` — 50 000 edge hard cap, `has_more` flag.
  - `/callgraph/path` — BFS queue (50 000) + visited (100 000) caps,
    `truncated` flag, `max_depth` parameter.
  - `/deps/tree` — depth cap (default 10, max 50), `depth_capped` flag.
  - `/imports` — `limit_per_lib` parameter (default 200, max 5 000).
  - `/upload` — `Content-Length` cap via `GHIDRA_MAX_UPLOAD_BYTES` env (default 1 GiB).
- **Snapshot iteration** of the `programs` map across all handlers (no more
  ConcurrentModificationException risk).
- Atomic `currentProgram` accessors (`getCurrentProgram` / `setCurrentProgram` /
  `removeProgram` / `closeAllPrograms`) under a single `stateLock`.
- Tightened `DecompInterface` init/dispose pattern.
- Graceful shutdown hook closes the Ghidra project, flushing pending writes.

### Added — LLM bridge (`bridge_lite.py`)
- New MCP tools:
  - `list_jobs(limit)` and `get_job(job_id, wait)` — track background analyses.
  - `find_function(name)`, `search_strings(query)`, `search_symbols(query)` —
    cross-program lookup.
  - `batch_import_directory(directory, pattern, limit)` — queue every binary
    in a server-visible directory.

### Added — Desktop GUI (Tauri + React)
- **Multi-page sidebar layout** — Dashboard, Programs, Search, Console, Settings.
- **Programs detail page** — Functions / Imports / Strings / Results tabs;
  inline decompile pane on function click.
- **Cross-program Search page** — function/symbol/string with case toggle;
  click a result to deep-link into the owning program's detail tab.
- **Force-directed dependency graph** (Obsidian-style) — physics-simulated
  view of program → program dependencies.
- **Console page** — auto-loads `/schema`, picks endpoint, renders parameter
  form and JSON response with history (50 calls, persisted in localStorage).
- **Live Docker logs panel** on the Dashboard, replacing the static results
  card. Auto-scroll, pause, clear, download as `.log`.
- **Live `JobsBadge`** in the status bar with a popover showing currently
  active and recent jobs.
- **Pixel-art brand mark** generated via the pixelforge MCP.
- shadcn/ui components throughout; dark theme with red/black palette.
- Tauri commands for: file listing, dependency graph, async upload/import,
  job long-poll, results-watcher, in-app Docker logs streamer, project-path
  resolution, "Open Docker logs" terminal spawn.

### Added — Operations
- `prepare.ps1` — boots Docker Desktop, brings the container up, waits for
  health, batch-imports every file in `docker/binaries/`.
- `deploy.ps1` — clean build / no-build / build-only / clean modes.
- `.mcp.json` — pre-configured MCP servers for Claude Code (added to
  `.gitignore` as it contains secrets).

### Security
- Default container HTTP binding moved from `0.0.0.0:18089` to
  `127.0.0.1:18089`. To expose externally, set `PORT_BIND` in
  `docker-compose.yml` explicitly.
- `.mcp.json` (which contains a Figma PAT and a Gemini API key) is in
  `.gitignore`. README documents secret handling.
