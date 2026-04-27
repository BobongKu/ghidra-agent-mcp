"""
Ghidra Analyzer MCP Bridge
- Dynamic tool registration from /schema
- Large results saved to file, compact summary returned (saves LLM context)
- return_context=true to get raw result inline
- read_result tool to retrieve saved files on demand
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path
import httpx
from mcp.server.fastmcp import FastMCP

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("bridge_lite")

GHIDRA_URL = os.environ.get("GHIDRA_AGENT_MCP_URL", "http://127.0.0.1:18089")
DEFAULT_TIMEOUT = 60.0
LONG_TIMEOUT = 300.0
LONG_TIMEOUT_PATHS = {"/decompile", "/deps/tree", "/deps/auto-load", "/deps/cross-xref",
                      "/deps/summary", "/callgraph/full", "/callgraph/path", "/upload", "/import"}

# Result file storage
RESULT_DIR = Path(os.environ.get("GHIDRA_RESULT_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "docker", "results")))
RESULT_DIR.mkdir(parents=True, exist_ok=True)

# Threshold: results smaller than this are returned inline even in compact mode
COMPACT_THRESHOLD = 4_000  # 4KB — small enough to be cheap in context

mcp = FastMCP("ghidra-agent-mcp")

_clients: dict[float, httpx.Client] = {}


def _get_client(timeout: float) -> httpx.Client:
    c = _clients.get(timeout)
    if c is None or c.is_closed:
        c = httpx.Client(timeout=timeout)
        _clients[timeout] = c
    return c


def ghidra_request(method: str, path: str, params: dict | None = None, body: dict | None = None) -> dict:
    timeout = LONG_TIMEOUT if path in LONG_TIMEOUT_PATHS else DEFAULT_TIMEOUT
    url = f"{GHIDRA_URL}{path}"
    try:
        client = _get_client(timeout)
        if method == "GET":
            resp = client.get(url, params=params)
        else:
            resp = client.post(url, params=params, json=body)
        resp.raise_for_status()
        return resp.json()
    except httpx.TimeoutException:
        return {"status": "error", "message": f"Timeout after {timeout}s on {path}"}
    except httpx.HTTPStatusError as e:
        try:
            return e.response.json()
        except Exception:
            return {"status": "error", "message": f"HTTP {e.response.status_code}: {e.response.text[:500]}"}
    except httpx.ConnectError:
        return {"status": "error", "message": f"Cannot connect to {GHIDRA_URL}. Is the server running?"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# Tools that operate across multiple programs (no single program context)
CROSS_PROGRAM_TOOLS = {"health", "programs", "deps_graph", "deps_unresolved", "deps_cross-xref", "schema"}

# ==================== RESULT FORMATTING ====================

def _extract_context(result: dict, tool_name: str, request_program: str = "") -> tuple[str, str]:
    """Extract program name and key identifier from result for file organization.
    Returns (program_name, identifier)."""
    data = result.get("data", result)

    # Extract program name — prefer request param, then result data
    program = request_program or ""
    if not program and isinstance(data, dict):
        program = data.get("program") or data.get("name", "")
    if not program and isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict):
            program = first.get("program", "")

    # Extract key identifier (function name, address, root, etc.)
    identifier = ""
    if isinstance(data, dict):
        identifier = (data.get("function") or data.get("root") or
                      data.get("address") or "")
    # Clean for filename safety
    identifier = str(identifier).replace("/", "_").replace("\\", "_").replace(":", "").replace(" ", "_")[:40]

    return program, identifier


def _save_result(result: dict, tool_name: str, request_program: str = "") -> str:
    """Save result JSON to structured directory tree.

    Structure:
        results/
        ├── {program}/           # per-program results
        │   └── {tool}[_{id}]_{HHMMSS}.json
        ├── _cross/              # cross-program results
        │   └── {tool}_{HHMMSS}.json
        └── _meta.jsonl          # append-only index
    """
    ts = datetime.now().strftime("%H%M%S")
    program, identifier = _extract_context(result, tool_name, request_program=request_program)

    # Determine subdirectory
    if tool_name in CROSS_PROGRAM_TOOLS or not program:
        subdir = RESULT_DIR / "_cross"
    else:
        safe_prog = program.replace("/", "_").replace("\\", "_")
        subdir = RESULT_DIR / safe_prog
    subdir.mkdir(parents=True, exist_ok=True)

    # Build filename
    parts = [tool_name]
    if identifier:
        parts.append(identifier)
    parts.append(ts)
    filename = "_".join(parts) + ".json"
    filepath = subdir / filename

    # Write result
    filepath.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    # Append to index
    meta_entry = {
        "file": str(filepath),
        "tool": tool_name,
        "program": program or None,
        "identifier": identifier or None,
        "time": datetime.now().isoformat(),
        "size": filepath.stat().st_size,
    }
    meta_path = RESULT_DIR / "_meta.jsonl"
    with open(meta_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(meta_entry, ensure_ascii=False) + "\n")

    return str(filepath)


def _build_summary(result: dict, tool_name: str) -> dict:
    """Build a compact summary from a tool result. Tool-aware extraction of key metrics."""
    status = result.get("status", "ok")
    if status != "ok":
        return {"status": status, "message": result.get("message", "")}

    data = result.get("data", result)

    # Tool-specific summaries
    if tool_name in ("functions", "deps_list", "imports", "exports", "strings", "symbols",
                     "deps_unresolved", "types"):
        # Array-based results: count + first few items
        items = data if isinstance(data, list) else []
        preview = []
        for item in items[:5]:
            if isinstance(item, dict):
                name = item.get("name") or item.get("library") or item.get("program") or str(item)[:60]
                preview.append(str(name))
            else:
                preview.append(str(item)[:60])
        return {
            "status": "ok",
            "count": len(items),
            "preview": preview,
            "has_more": len(items) > 5,
        }

    if tool_name == "deps_summary":
        return {
            "status": "ok",
            "program": data.get("program"),
            "match_rate": data.get("match_rate"),
            "libraries": f"{data.get('libraries_resolved')}/{data.get('libraries_total')} resolved",
            "functions": f"{data.get('functions_matched')}/{data.get('functions_imported')} matched",
        }

    if tool_name in ("deps_tree", "dependency_tree"):
        def _count_tree(node, depth=0):
            children = node.get("children", [])
            total = 1
            max_d = depth
            for c in children:
                ct, cd = _count_tree(c, depth + 1)
                total += ct
                max_d = max(max_d, cd)
            return total, max_d
        nodes, max_depth = _count_tree(data) if isinstance(data, dict) else (0, 0)
        return {
            "status": "ok",
            "root": data.get("name") if isinstance(data, dict) else "?",
            "total_nodes": nodes,
            "max_depth": max_depth,
            "unresolved_count": data.get("unresolved_count", 0) if isinstance(data, dict) else 0,
        }

    if tool_name in ("callgraph", "callgraph_full"):
        if data.get("format") == "mermaid":
            return {
                "status": "ok",
                "format": "mermaid",
                "root": data.get("root", "?"),
                "count": data.get("count", 0),
                "mermaid": data.get("mermaid", ""),
            }
        nodes = data.get("nodes", [])
        edges = data.get("edges", [])
        return {
            "status": "ok",
            "root": data.get("root", "?"),
            "nodes": len(nodes),
            "edges": len(edges),
        }

    if tool_name == "callgraph_path":
        if data.get("format") == "mermaid":
            return {
                "status": "ok",
                "format": "mermaid",
                "found": data.get("found", False),
                "path_length": data.get("length", 0),
                "path": data.get("path", []),
                "mermaid": data.get("mermaid", ""),
            }
        return {
            "status": "ok",
            "found": data.get("found", False),
            "path_length": data.get("length", 0),
            "path": data.get("path", []),
        }

    if tool_name in ("deps_match", "match_imports_exports"):
        return {
            "status": "ok",
            "matched_count": data.get("matched_count", 0),
            "unmatched_count": data.get("unmatched_count", 0),
            "total_exports": data.get("total_exports", 0),
        }

    if tool_name == "deps_cross-xref":
        imported_by = data.get("imported_by", [])
        return {
            "status": "ok",
            "function": data.get("function"),
            "importer_count": data.get("importer_count", 0),
            "importers": [x.get("program") for x in imported_by[:5]],
        }

    if tool_name == "deps_graph":
        return {
            "status": "ok",
            "format": data.get("format"),
            "nodes": len(data.get("nodes", [])),
            "edges": len(data.get("edges", [])),
        }

    if tool_name == "decompile":
        return {
            "status": "ok",
            "function": data.get("function"),
            "address": data.get("address"),
            "code_length": len(data.get("decompiled", "")),
        }

    # Generic fallback: show keys and types
    if isinstance(data, dict):
        summary = {"status": "ok"}
        for k, v in list(data.items())[:8]:
            if isinstance(v, (str, int, float, bool)):
                summary[k] = v
            elif isinstance(v, list):
                summary[k] = f"[{len(v)} items]"
            elif isinstance(v, dict):
                summary[k] = f"{{...{len(v)} keys}}"
        return summary

    return {"status": "ok", "type": type(data).__name__}


def _format_result(result: dict, tool_name: str = "unknown", return_context: bool = False, request_program: str = "") -> str:
    """
    Smart result formatting:
    - return_context=True: always return raw JSON inline
    - Small results (≤ 4KB): return inline
    - Large results: save to file, return compact summary + file path
    """
    text = json.dumps(result, indent=2, ensure_ascii=False)

    # Skip saving for errors and trivial tools
    skip_save = (result.get("status") == "error" or tool_name in ("health", "programs", "schema"))

    # return_context mode: raw inline (with safety truncation)
    if return_context:
        if len(text) > 200_000:
            filepath = _save_result(result, tool_name, request_program=request_program)
            return json.dumps({
                "warning": "Result too large even for return_context mode",
                "size": len(text),
                "saved_to": filepath,
            }, indent=2)
        # Still save to file for future reference
        if not skip_save:
            _save_result(result, tool_name, request_program=request_program)
        return text

    # Always save to file for future reference (qmd, read_result, cross-search)
    if skip_save:
        return text

    filepath = _save_result(result, tool_name, request_program=request_program)

    # Small results: return inline + file path
    if len(text) <= COMPACT_THRESHOLD:
        # Inject file path into result for reference
        if isinstance(result, dict):
            result["result_file"] = filepath
        return json.dumps(result, indent=2, ensure_ascii=False)

    # Large results: save to file, return summary
    summary = _build_summary(result, tool_name)
    summary["result_file"] = filepath
    summary["result_size_chars"] = len(text)
    summary["hint"] = "Full result saved. Use read_result(file_path) for raw data, or read specific sections."
    return json.dumps(summary, indent=2, ensure_ascii=False)


# ==================== TOOL REGISTRATION ====================

def register_tools_from_schema():
    try:
        schema = ghidra_request("GET", "/schema")
    except Exception as e:
        logger.error(f"Failed to fetch schema: {e}")
        return False

    if "data" not in schema:
        logger.error("Invalid schema response")
        return False

    data = schema["data"]
    endpoints = data.get("endpoints", data) if isinstance(data, dict) else data
    count = 0

    for ep in endpoints:
        path = ep["path"]
        method = ep.get("method", "GET")
        description = ep.get("description", f"{method} {path}")
        params_schema = ep.get("params", [])
        tool_name = path.strip("/").replace("/", "_")

        if tool_name in STATIC_TOOL_NAMES:
            continue

        _register_dynamic_tool(tool_name, description, method, path, params_schema)
        count += 1

    logger.info(f"Registered {count} dynamic tools from /schema")
    return True


def _register_dynamic_tool(name: str, description: str, method: str, path: str, params_schema: list):
    """Register MCP tool with explicit params + return_context option."""

    query_params = set()
    body_params = set()
    for p in params_schema:
        source = p.get("source", "query")
        if source == "body":
            body_params.add(p["name"])
        else:
            query_params.add(p["name"])

    if params_schema:
        parts = [f"  - {p['name']}: {p.get('description', '')}{' (required)' if p.get('required') else ''}"
                 for p in params_schema]
        description += "\nParameters:\n" + "\n".join(parts)
    description += "\n  - return_context: Set 'true' to get full raw result inline instead of compact summary"

    # Build explicit parameter function via exec
    required = [p["name"] for p in params_schema if p.get("required")]
    optional = [p["name"] for p in params_schema if not p.get("required")]

    safe = lambda n: n + "_" if n in {"type", "class", "import", "from", "return", "pass", "in"} else n
    sig_parts = [f"{safe(n)}: str" for n in required]
    sig_parts += [f"{safe(n)}: str = ''" for n in optional]
    sig_parts.append("return_context: str = ''")
    sig = ", ".join(sig_parts)

    all_names = required + optional
    kv_parts = [f"'{n}': {safe(n)}" for n in all_names]

    func_code = f"""
def _handler({sig}) -> str:
    raw = {{{", ".join(kv_parts)}}}
    query = {{}}
    body = {{}}
    for k, v in raw.items():
        if v is None or v == '':
            continue
        if k in _bp:
            body[k] = v
        elif k in _qp:
            query[k] = v
        else:
            if _method == 'GET':
                query[k] = v
            else:
                body[k] = v
    rc = return_context.lower() in ('true', '1', 'yes') if return_context else False
    req_prog = raw.get('program', '') or ''
    return _format_result(ghidra_request(_method, _path, params=query or None, body=body or None),
                          tool_name=_tool_name, return_context=rc, request_program=req_prog)
"""

    local_ns = {
        "_bp": body_params,
        "_qp": query_params,
        "_method": method,
        "_path": path,
        "_tool_name": name,
        "_format_result": _format_result,
        "ghidra_request": ghidra_request,
    }
    exec(func_code, local_ns)
    handler = local_ns["_handler"]
    handler.__name__ = name
    handler.__qualname__ = name

    mcp.tool(name=name, description=description)(handler)


# ==================== STATIC TOOLS ====================

STATIC_TOOL_NAMES = {"health", "upload_binary", "import_binary", "decompile_function",
                     "dependency_tree", "dependency_summary", "match_imports_exports",
                     "read_result", "list_results",
                     # Job tracking + cross-program search + batch import
                     "list_jobs", "get_job", "cancel_job", "find_function",
                     "search_strings", "search_symbols", "batch_import_directory",
                     # Schema-derived dynamic tools that we override above
                     "search", "jobs"}


@mcp.tool(name="read_result",
          description="Read a previously saved result file. Use this to retrieve full data from a compact summary.\n"
                      "Parameters:\n"
                      "  - file_path: Path to the saved result file (required)\n"
                      "  - query: Optional search string to filter/grep within the result\n"
                      "  - max_chars: Max characters to return (default 80000)")
def read_result(file_path: str, query: str = "", max_chars: int = 80000) -> str:
    p = Path(file_path)
    if not p.exists():
        return json.dumps({"status": "error", "message": f"File not found: {file_path}"})

    text = p.read_text(encoding="utf-8")

    if query:
        # Filter lines containing the query string (case-insensitive grep)
        lines = text.split("\n")
        matched = [l for l in lines if query.lower() in l.lower()]
        text = f"# Filtered by '{query}' ({len(matched)}/{len(lines)} lines matched)\n" + "\n".join(matched)

    if len(text) > max_chars:
        return text[:max_chars] + f"\n\n... [TRUNCATED at {max_chars} chars, total {len(text)}]"
    return text


@mcp.tool(name="list_results",
          description="List saved result files organized by program. Shows directory tree with sizes.\n"
                      "Parameters:\n  - program: Filter by program name (optional, shows all if omitted)")
def list_results(program: str = "") -> str:
    tree = {}
    # Scan subdirectories
    for subdir in sorted(RESULT_DIR.iterdir()):
        if not subdir.is_dir():
            continue
        dir_name = subdir.name
        if program and dir_name != program and dir_name != "_cross":
            continue
        files = sorted(subdir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
        if not files:
            continue
        entries = []
        for f in files[:30]:
            stat = f.stat()
            entries.append({
                "file": str(f),
                "name": f.name,
                "size_kb": round(stat.st_size / 1024, 1),
                "time": datetime.fromtimestamp(stat.st_mtime).strftime("%H:%M:%S"),
            })
        tree[dir_name] = {"count": len(files), "files": entries}

    total = sum(v["count"] for v in tree.values())
    return json.dumps({"status": "ok", "result_dir": str(RESULT_DIR),
                        "total_files": total, "tree": tree}, indent=2)


@mcp.tool(name="health",
          description="Check server status, list loaded programs and available binaries. Call this first.")
def health() -> str:
    return _format_result(ghidra_request("GET", "/health"), tool_name="health")


@mcp.tool(name="upload_binary",
          description="Stream a local binary file to the server's /binaries folder. Upload only — does NOT "
                      "analyze. After this returns, call import_binary(path='/binaries/<name>', "
                      "analysis='fast'|'normal') to actually analyze.\n"
                      "Parameters:\n"
                      "  - file_path: Local path to the binary file (required)")
def upload_binary(file_path: str) -> str:
    import pathlib
    p = pathlib.Path(file_path)
    if not p.exists():
        return json.dumps({"status": "error", "message": f"File not found: {file_path}"})

    url = f"{GHIDRA_URL}/upload"
    params = {"filename": p.name, "analyze": "false"}
    try:
        with httpx.Client(timeout=LONG_TIMEOUT) as client:
            resp = client.post(url, params=params, content=p.read_bytes(),
                             headers={"Content-Type": "application/octet-stream"})
            resp.raise_for_status()
            return _format_result(resp.json(), tool_name="upload_binary")
    except httpx.ConnectError:
        return json.dumps({"status": "error", "message": f"Cannot connect to {GHIDRA_URL}"})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})


@mcp.tool(name="import_binary",
          description="Analyze a binary that's already in the server's /binaries directory.\n"
                      "Use this after upload_binary or batch_import_directory(analyze=false) to actually run analysis.\n"
                      "The call long-polls until the analyze job is terminal (up to 10 minutes); poll get_job(job_id, "
                      "wait=60) afterwards if you need to keep waiting on a really big binary.\n"
                      "Parameters:\n"
                      "  - path: Path on server, e.g. /binaries/test.exe (required)\n"
                      "  - analysis: Analysis depth: 'fast' | 'normal' (default) | 'thorough'.\n"
                      "      Use 'fast' for huge stripped binaries (macOS / iOS frameworks etc.) — "
                      "      ~3-5x faster, decompile / callgraph / deps still work fully.")
def import_binary(path: str, analysis: str = "normal") -> str:
    return _format_result(
        ghidra_request("POST", "/import",
                       params={"wait": "600"},
                       body={"path": path, "analysis": analysis or "normal"}),
        tool_name="import")


@mcp.tool(name="decompile_function",
          description="Decompile a function to C pseudocode.\n"
                      "Parameters:\n  - address: Hex address or function name (required)\n"
                      "  - program: Program name (optional)\n"
                      "  - return_context: 'true' for full raw result")
def decompile_function(address: str, program: str = "", return_context: str = "") -> str:
    params = {"address": address}
    if program:
        params["program"] = program
    rc = return_context.lower() in ("true", "1", "yes") if return_context else False
    return _format_result(ghidra_request("POST", "/decompile", params=params),
                          tool_name="decompile", return_context=rc, request_program=program)


@mcp.tool(name="dependency_tree",
          description="Build recursive dependency tree.\n"
                      "Parameters:\n  - program: Program name (optional)\n"
                      "  - summary: 'true' for compact (default: true)\n"
                      "  - return_context: 'true' for full raw result")
def dependency_tree(program: str = "", summary: bool = True, return_context: str = "") -> str:
    body = {}
    if program:
        body["program"] = program
    if summary:
        body["summary"] = True
    rc = return_context.lower() in ("true", "1", "yes") if return_context else False
    return _format_result(ghidra_request("POST", "/deps/tree", body=body),
                          tool_name="deps_tree", return_context=rc, request_program=program)


@mcp.tool(name="dependency_summary",
          description="Dependency analysis summary with match rate.\n"
                      "Parameters:\n  - program: Program name (optional)\n"
                      "  - return_context: 'true' for full raw result")
def dependency_summary(program: str = "", return_context: str = "") -> str:
    params = {}
    if program:
        params["program"] = program
    rc = return_context.lower() in ("true", "1", "yes") if return_context else False
    return _format_result(ghidra_request("GET", "/deps/summary", params=params),
                          tool_name="deps_summary", return_context=rc, request_program=program)


@mcp.tool(name="match_imports_exports",
          description="Match imports of program A against exports of program B.\n"
                      "Parameters:\n  - program_a: Importer (required)\n"
                      "  - program_b: Exporter (required)\n"
                      "  - return_context: 'true' for full raw result")
def match_imports_exports(program_a: str, program_b: str, return_context: str = "") -> str:
    rc = return_context.lower() in ("true", "1", "yes") if return_context else False
    return _format_result(
        ghidra_request("POST", "/deps/match", body={"program_a": program_a, "program_b": program_b}),
        tool_name="deps_match", return_context=rc, request_program=program_a)


# ==================== Job tracking ====================

@mcp.tool(name="list_jobs",
          description="List recent import/analyze jobs (newest first).\n"
                      "Use this to check the state of background analyses started by upload_binary or import_binary.\n"
                      "Parameters:\n"
                      "  - limit: Max number of jobs to return (default 20, max 200)")
def list_jobs(limit: str = "20") -> str:
    try:
        n = max(1, min(int(limit), 200))
    except (TypeError, ValueError):
        n = 20
    return _format_result(ghidra_request("GET", "/jobs", params={"limit": str(n)}),
                          tool_name="jobs")


@mcp.tool(name="get_job",
          description="Fetch a single job's state. Optional long-poll until terminal.\n"
                      "Parameters:\n"
                      "  - job_id: UUID returned from upload_binary / import_binary (required)\n"
                      "  - wait: Seconds to long-poll for terminal state (default 0 = no wait, max 1800)")
def get_job(job_id: str, wait: str = "0") -> str:
    try:
        w = max(0, min(int(wait), 1800))
    except (TypeError, ValueError):
        w = 0
    return _format_result(ghidra_request("GET", f"/jobs/{job_id}", params={"wait": str(w)}),
                          tool_name="job")


@mcp.tool(name="cancel_job",
          description="Cancel a running or queued analyze job. The server interrupts the Ghidra TaskMonitor "
                      "at the next analyzer step boundary; the partially-analyzed program is dropped (not "
                      "persisted). Useful when an import is taking far longer than expected — cancel it, "
                      "then re-import with analysis='fast'.\n"
                      "Parameters:\n"
                      "  - job_id: UUID of the job to cancel (required)")
def cancel_job(job_id: str) -> str:
    return _format_result(ghidra_request("POST", f"/jobs/{job_id}/cancel"),
                          tool_name="job_cancel")


# ==================== Cross-program search ====================

@mcp.tool(name="find_function",
          description="Find a function by name across ALL loaded programs.\n"
                      "Returns matching internal and external functions with program, address, and library.\n"
                      "Use this instead of guessing which binary contains a given function.\n"
                      "Parameters:\n"
                      "  - name: Function name substring to match (case-insensitive by default, required)\n"
                      "  - case_sensitive: Set 'true' for exact-case matching\n"
                      "  - limit: Max results (default 100, max 1000)")
def find_function(name: str, case_sensitive: str = "", limit: str = "100") -> str:
    params = {"q": name, "type": "function", "limit": str(limit)}
    if case_sensitive.lower() in ("true", "1", "yes"):
        params["case"] = "true"
    return _format_result(ghidra_request("GET", "/search", params=params),
                          tool_name="search")


@mcp.tool(name="search_strings",
          description="Search defined strings across ALL loaded programs.\n"
                      "Returns matches with program name, address, and string value.\n"
                      "Parameters:\n"
                      "  - query: Substring to find (case-insensitive by default, required)\n"
                      "  - case_sensitive: Set 'true' for exact-case matching\n"
                      "  - limit: Max results (default 100, max 1000)")
def search_strings(query: str, case_sensitive: str = "", limit: str = "100") -> str:
    params = {"q": query, "type": "string", "limit": str(limit)}
    if case_sensitive.lower() in ("true", "1", "yes"):
        params["case"] = "true"
    return _format_result(ghidra_request("GET", "/search", params=params),
                          tool_name="search")


@mcp.tool(name="search_symbols",
          description="Search symbols (labels, functions, data) across ALL loaded programs.\n"
                      "Parameters:\n"
                      "  - query: Substring to find (required)\n"
                      "  - case_sensitive: Set 'true' for exact-case matching\n"
                      "  - limit: Max results (default 100, max 1000)")
def search_symbols(query: str, case_sensitive: str = "", limit: str = "100") -> str:
    params = {"q": query, "type": "symbol", "limit": str(limit)}
    if case_sensitive.lower() in ("true", "1", "yes"):
        params["case"] = "true"
    return _format_result(ghidra_request("GET", "/search", params=params),
                          tool_name="search")


# ==================== Batch import ====================

@mcp.tool(name="batch_import_directory",
          description="Queue every binary in a server-visible directory for import.\n"
                      "Each file becomes a background job; analysis runs sequentially in one worker.\n"
                      "Returns the list of job_ids — poll get_job(job_id, wait=60) for progress.\n"
                      "Parameters:\n"
                      "  - directory: Directory inside the server (default /binaries)\n"
                      "  - pattern: Glob-ish suffix filter (default '' = all files; e.g. '.exe', '.dll')\n"
                      "  - limit: Max files to enqueue (default 50)\n"
                      "  - analysis: Analysis depth for every queued job: 'fast' | 'normal' (default) | 'thorough'.\n"
                      "      Strongly consider 'fast' when batch-loading large/stripped binaries — total wall time "
                      "      for a 50-file directory of ARM64 / Mach-O frameworks drops from hours to ~20 minutes.")
def batch_import_directory(directory: str = "/binaries", pattern: str = "",
                           limit: str = "50", analysis: str = "normal") -> str:
    try:
        n = max(1, min(int(limit), 200))
    except (TypeError, ValueError):
        n = 50
    level = analysis or "normal"

    # Reuse /health to confirm server visibility of binaries dir; fall back to listing via os.
    h = ghidra_request("GET", "/health")
    if h.get("status") != "ok":
        return _format_result(h, tool_name="batch_import_directory")

    server_binaries_dir = h.get("data", {}).get("binaries_dir", "/binaries")
    use_server_listing = (directory == server_binaries_dir or directory == "/binaries")
    files: list[str] = []
    if use_server_listing:
        files = h.get("data", {}).get("available_binaries", []) or []
    else:
        try:
            files = [f for f in os.listdir(directory)
                     if os.path.isfile(os.path.join(directory, f))]
        except Exception as e:
            return json.dumps({"status": "error", "message": f"cannot list {directory}: {e}"})

    if pattern:
        suffix = pattern.lower().lstrip("*")
        files = [f for f in files if f.lower().endswith(suffix)]
    files = files[:n]

    submitted = []
    for fname in files:
        path = directory.rstrip("/") + "/" + fname
        resp = ghidra_request("POST", "/import",
                              params={"wait": "0"},
                              body={"path": path, "analysis": level})
        if resp.get("status") == "ok":
            d = resp.get("data", {})
            submitted.append({
                "file": fname,
                "job_id": d.get("job_id"),
                "status": d.get("status"),
            })
        else:
            submitted.append({
                "file": fname,
                "error": resp.get("message", "unknown"),
            })

    return _format_result({
        "status": "ok",
        "data": {
            "directory": directory,
            "pattern": pattern,
            "analysis": level,
            "submitted": submitted,
            "count": len(submitted),
            "hint": "Poll list_jobs() or get_job(job_id, wait=60) for progress. "
                    "To stop a job partway, call cancel_job(job_id).",
        }
    }, tool_name="batch_import_directory")


# ==================== MAIN ====================

def main():
    try:
        registered = register_tools_from_schema()
        if registered:
            logger.info("Dynamic tool registration successful")
        else:
            logger.warning("Dynamic registration failed, using static tools only")
    except Exception as e:
        logger.warning(f"Schema fetch failed ({e}), using static tools only")

    logger.info(f"Starting MCP bridge (stdio) -> {GHIDRA_URL}")
    logger.info(f"Result files saved to: {RESULT_DIR}")
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
