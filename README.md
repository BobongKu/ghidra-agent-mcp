# Ghidra Agent MCP

Docker headless Ghidra + MCP bridge for AI-powered binary analysis.

Ghidra runs in a Docker container as an HTTP API server. A Python MCP bridge (`bridge_lite.py`) connects any LLM that supports [Model Context Protocol](https://modelcontextprotocol.io) to the Ghidra API.

## Architecture

```
LLM (Claude, GPT, etc.)
  |  MCP (stdio)
  v
bridge_lite.py          -- Python, registers tools from /schema dynamically
  |  HTTP (port 18089)
  v
Docker: GhidraAgentMcpServer  -- Java 21, Ghidra 12.0.3 headless
  |
  v
/binaries/*.exe,*.dll   -- analysis targets (volume mount)
```

## Requirements

- Docker Desktop
- Python 3.10+ with pip
- 4GB+ RAM available for Docker

## One-Line Setup

```bash
# Linux / macOS
git clone https://github.com/bobongku/ghidra-agent-mcp.git
cd ghidra-agent-mcp && chmod +x setup.sh && ./setup.sh

# Windows (cmd or PowerShell)
git clone https://github.com/bobongku/ghidra-agent-mcp.git
cd ghidra-agent-mcp && setup.bat
```

This installs Python dependencies, builds the Docker image, starts the server, and verifies health — all in one step. First run takes ~5 minutes (downloads Ghidra). Subsequent runs are fast.

After setup, **Claude Code** auto-detects the included `.mcp.json` — just restart Claude Code in this directory.

## Manual Setup

### 1. Place binaries

Put the PE files you want to analyze in `docker/binaries/`:

```
docker/binaries/
  notepad.exe
  kernel32.dll
  user32.dll
  ...
```

### 2. Build and start

```powershell
# PowerShell (Windows)
.\deploy.ps1              # Build Docker image + start container + wait for health

# Or manually
docker compose -f docker/docker-compose.yml up -d --build
```

First build downloads Ghidra (~400MB) and compiles — takes a few minutes.
Subsequent builds use Docker cache and are fast.

### 3. Verify server is running

```bash
curl http://127.0.0.1:18089/health
```

### 4. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 5. Connect your LLM

#### Claude Code

`.mcp.json` is included in the project root — Claude Code picks it up automatically when opened in this directory.

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ghidra-agent-mcp": {
      "command": "python",
      "args": ["C:/path/to/ghidra-agent-mcp/bridge_lite.py"],
      "env": {
        "GHIDRA_AGENT_MCP_URL": "http://127.0.0.1:18089"
      }
    }
  }
}
```

#### Other MCP clients (Cline, Continue.dev, Open-WebUI+MCPO)

The bridge runs on stdio transport:

```bash
python bridge_lite.py
```

Set `GHIDRA_AGENT_MCP_URL` environment variable if the server is not at `http://127.0.0.1:18089`.

## Tool Categories

The server exposes ~30 tools via MCP, dynamically registered from the `/schema` endpoint:

| Category | Tools | Description |
|----------|-------|-------------|
| **Program** | `health`, `import_binary`, `upload_binary`, `program_info`, `programs` | Server status, binary management |
| **Listing** | `functions`, `imports`, `exports`, `strings`, `symbols`, `segments`, `memory` | Binary content browsing |
| **Code** | `decompile_function`, `disassemble` | Decompilation and disassembly |
| **Call Analysis** | `callgraph`, `function_callers`, `function_callees`, `function_xrefs`, `function_variables` | Call flow analysis |
| **Dependencies** | `dependency_tree`, `dependency_summary`, `match_imports_exports`, `deps_list`, `deps_trace`, `deps_cross-xref`, `deps_graph`, `deps_unresolved`, `deps_auto-load` | DLL dependency analysis with API set forwarding |
| **Modify** | `rename_function`, `rename_variable`, `rename_label`, `comment`, `prototype` | Annotation and renaming |
| **Data Types** | `types`, `struct`, `struct_create`, `type_apply` | Type system |
| **Results** | `read_result`, `list_results` | Saved result file management |

## Context-Saving Mode (Compact Results)

Large results (>4KB) are automatically saved to `docker/results/` and a compact summary is returned instead:

```
LLM calls: imports(program="notepad.exe")

Returns (compact):
{
  "status": "ok",
  "count": 56,
  "preview": ["GDI32.DLL", "USER32.DLL", ...],
  "result_file": "docker/results/notepad.exe/imports_105836.json",
  "hint": "Use read_result(file_path) for full data"
}
```

- **Default**: compact summary + file path (saves LLM context)
- **`return_context=true`**: full raw JSON inline (when you need all the data)
- **`read_result(file_path, query="keyword")`**: grep within saved files
- **`list_results()`**: browse saved files by program

### Result directory structure

```
docker/results/
  notepad.exe/           # per-program results
    imports_105836.json
    deps_tree_131330.json
    callgraph_entry_131310.json
  kernel32.dll/
    exports_110009.json
  _cross/                # cross-program results (deps_graph, deps_unresolved)
    deps_graph_131340.json
  _meta.jsonl            # append-only index of all saved files
```

## Typical Workflow

```
1. health()                              -- check server, see available binaries
2. import_binary(path="/binaries/x.exe") -- import and auto-analyze
3. program_info(program="x.exe")         -- overview: format, functions, symbols
4. functions(filter="Main", limit=10)    -- find functions of interest
5. decompile_function(address="entry")   -- read pseudocode
6. dependency_summary(program="x.exe")   -- see DLL resolution status
7. read_result(file_path, query="...")   -- drill into large saved results
```

## deploy.ps1 Options

```powershell
.\deploy.ps1              # Full: clean build + start + health wait
.\deploy.ps1 -NoBuild     # Skip build, just (re)start container
.\deploy.ps1 -BuildOnly   # Build image only
.\deploy.ps1 -Clean       # Remove everything (images, volumes, results)
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `GHIDRA_AGENT_MCP_URL` | `http://127.0.0.1:18089` | Server URL (bridge side) |
| `GHIDRA_RESULT_DIR` | `./docker/results` | Where to save large results |
| `GHIDRA_MCP_PORT` | `8089` | Server port (container side) |
| `BIND_ADDRESS` | `0.0.0.0` | Server bind address |
| `AUTO_IMPORT` | `false` | Auto-import all binaries on startup |

## Troubleshooting

### Import timeout on MCP but server actually succeeds

Large binaries (kernel32.dll, shell32.dll) can take 30-90s to analyze. The MCP client may timeout before the server finishes, but the import completes on the server side. Check with `health()` — if the program appears in the loaded list, it worked.

Import binaries sequentially, not in parallel. Each import is `synchronized` on the server, so parallel requests queue up and compound the timeout.

### Server won't start / port conflict

Port `18089` is used on the host. Check `docker compose -f docker/docker-compose.yml logs -f` for errors, or change the port in `docker/docker-compose.yml`.

## qmd Integration (Optional)

[qmd](https://github.com/tobi/qmd) can index the saved JSON result files for cross-file keyword search.

Add to `~/.config/qmd/index.yml`:

```yaml
collections:
  ghidra-results:
    path: /path/to/ghidra-agent-mcp/docker/results
    pattern: "**/*.json"
```

Then:
```bash
qmd update                                          # index result files
qmd search "CreateFileW" -c ghidra-results --json   # search across all results
qmd get "qmd://ghidra-results/notepad-exe/imports-132837.json:385" -l 10  # read specific lines
```

> **Note**: `qmd collection add` CLI defaults to `**/*.md` pattern and ignores the positional pattern argument (as of v2.1.0). Edit `~/.config/qmd/index.yml` directly to set `pattern: "**/*.json"`.

## Project Structure

```
ghidra-agent-mcp/
  setup.sh                       # One-line setup (Linux/macOS)
  setup.bat                      # One-line setup (Windows)
  .mcp.json                      # Claude Code auto-config
  bridge_lite.py                 # MCP bridge (Python)
  deploy.ps1                     # Advanced deploy script (PowerShell)
  requirements.txt               # Python dependencies
  docker/
    Dockerfile                   # Runtime image (pre-built JAR)
    docker-compose.yml           # Container config
    ghidra-agent-mcp.jar         # Pre-built server JAR
    entrypoint.sh                # JVM launch with Ghidra classpath
    install-extensions.sh        # Optional Ghidra extension installer
    binaries/                    # Put analysis targets here
    results/                     # Saved MCP results (auto-created)
```

## Limits

- **Max programs**: 50 loaded simultaneously (Docker 4GB mem_limit)
- **Recommended**: 7-10 programs for stable operation
- **Import timeout**: MCP default 60s, large binaries may need up to 300s
- **Result file threshold**: 4KB — smaller results returned inline, larger saved to file
