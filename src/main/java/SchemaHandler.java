
import com.sun.net.httpserver.HttpExchange;

import java.util.*;

public class SchemaHandler {

    private final ServerContext ctx;

    public SchemaHandler(ServerContext ctx) { this.ctx = ctx; }

    public void handleSchema(HttpExchange ex) throws Exception {
        var endpoints = new ArrayList<Map<String, Object>>();
        var optProg = param("program", "string", false, "Program name (uses current if omitted)");

        addSchema(endpoints, "/health", "GET", "Server health, loaded programs, and available binaries", "system");
        addSchema(endpoints, "/upload", "POST", "Upload and analyze a binary file. Send raw file bytes as request body", "program",
            param("filename", "string", true, "Output filename, e.g. test.exe"),
            param("analyze", "string", false, "Set to 'false' to skip auto-analysis"),
            param("analysis", "string", false, "Analysis depth: fast | normal (default) | thorough. Use 'fast' for huge stripped binaries (e.g. macOS/iOS frameworks) — skips Decompiler Parameter ID and other slow analyzers."));
        addSchema(endpoints, "/import", "POST", "Import a binary already in /binaries directory", "program",
            param("path", "string", true, "Absolute path to binary, e.g. /binaries/test.exe", "body"),
            param("analysis", "string", false, "Analysis depth: fast | normal (default) | thorough. Use 'fast' for huge stripped binaries — skips Decompiler Parameter ID and other slow analyzers."));
        addSchema(endpoints, "/programs", "GET", "List all loaded programs", "program");
        addSchema(endpoints, "/program/close", "POST", "Close and unload a program", "program",
            param("name", "string", true, "Program name to close", "body"));
        addSchema(endpoints, "/program/close-all", "POST", "Close all loaded programs at once. Use keep_current=true to keep the active program", "program",
            param("keep_current", "string", false, "Set to 'true' to keep the current program open (default: false)", "body"));
        addSchema(endpoints, "/program/info", "GET", "Detailed program info (format, language, memory, counts)", "program", optProg);

        // Background-job tracking
        addSchema(endpoints, "/jobs", "GET", "List recent background jobs (newest first)", "system",
            param("limit", "integer", false, "Max entries to return (default 50, max 200)"));
        addSchema(endpoints, "/jobs/{id}", "GET", "Get the state of a background job; supports ?wait=N long-poll", "system",
            param("id", "string", true, "Job UUID (in path)"),
            param("wait", "integer", false, "Block up to N seconds for terminal state (default 0, max 1800)"));
        addSchema(endpoints, "/jobs/{id}/cancel", "POST", "Cancel a running or queued job. Stops the next analyzer step.", "system",
            param("id", "string", true, "Job UUID (in path)"));

        addSchema(endpoints, "/functions", "GET", "List functions with pagination and filtering", "function",
            param("offset", "integer", false, "Skip first N functions (default 0)"),
            param("limit", "integer", false, "Max results (default 100)"),
            param("filter", "string", false, "Filter by name substring"), optProg);
        addSchema(endpoints, "/function", "GET", "Get function details by address or name", "function",
            param("address", "string", true, "Hex address (0x140001000) or function name"), optProg);
        addSchema(endpoints, "/decompile", "POST", "Decompile function to C code by address or name", "function",
            param("address", "string", true, "Hex address (0x140001000) or function name"), optProg);
        addSchema(endpoints, "/disassemble", "POST", "Disassemble instructions at address", "function",
            param("address", "string", true, "Start hex address"),
            param("count", "integer", false, "Number of instructions (default 50)"), optProg);
        addSchema(endpoints, "/function/callers", "GET", "Get functions that call this function", "function",
            param("address", "string", true, "Hex address or function name"), optProg);
        addSchema(endpoints, "/function/callees", "GET", "Get functions called by this function", "function",
            param("address", "string", true, "Hex address or function name"), optProg);
        addSchema(endpoints, "/function/xrefs", "GET", "Get all cross-references to address", "function",
            param("address", "string", true, "Hex address"), optProg);
        addSchema(endpoints, "/function/variables", "GET", "Get function parameters and local variables", "function",
            param("address", "string", true, "Hex address or function name"), optProg);

        addSchema(endpoints, "/imports", "GET", "List imported functions grouped by library", "listing", optProg);
        addSchema(endpoints, "/exports", "GET", "List exported functions", "listing",
            param("limit", "integer", false, "Max results (default 500)"), optProg);
        addSchema(endpoints, "/strings", "GET", "List defined strings in the binary", "listing",
            param("filter", "string", false, "Filter by content substring"),
            param("limit", "integer", false, "Max results (default 200)"), optProg);
        addSchema(endpoints, "/segments", "GET", "List memory segments with permissions", "listing", optProg);
        addSchema(endpoints, "/symbols", "GET", "List symbols", "listing",
            param("filter", "string", false, "Filter by name substring"),
            param("limit", "integer", false, "Max results (default 200)"), optProg);
        addSchema(endpoints, "/memory", "GET", "Read raw memory bytes as hex", "listing",
            param("address", "string", true, "Start hex address"),
            param("length", "integer", false, "Bytes to read (default 64, max 4096)"), optProg);

        addSchema(endpoints, "/rename/function", "POST", "Rename a function", "modify",
            param("address", "string", true, "Function hex address or name", "body"),
            param("name", "string", true, "New function name", "body"), optProg);
        addSchema(endpoints, "/rename/variable", "POST", "Rename a variable in a function", "modify",
            param("function_address", "string", true, "Function hex address or name", "body"),
            param("old_name", "string", true, "Current variable name", "body"),
            param("new_name", "string", true, "New variable name", "body"), optProg);
        addSchema(endpoints, "/rename/label", "POST", "Create or rename a label at address", "modify",
            param("address", "string", true, "Hex address", "body"),
            param("name", "string", true, "Label name", "body"), optProg);
        addSchema(endpoints, "/comment", "POST", "Set a comment at address", "modify",
            param("address", "string", true, "Hex address", "body"),
            param("comment", "string", true, "Comment text", "body"),
            param("type", "string", false, "Comment type: plate, eol, pre, or post (default: plate)", "body"), optProg);
        addSchema(endpoints, "/prototype", "POST", "Set function signature/prototype", "modify",
            param("address", "string", true, "Function hex address or name", "body"),
            param("prototype", "string", true, "C function signature, e.g. int foo(int a, char* b)", "body"), optProg);

        addSchema(endpoints, "/deps/list", "GET", "List library dependencies with import counts and resolution status", "dependency", optProg);
        addSchema(endpoints, "/deps/tree", "POST", "Build recursive dependency tree showing resolved and unresolved deps", "dependency",
            param("program", "string", false, "Program name (uses current if omitted)", "body"),
            param("summary", "string", false, "Set to 'true' for compact output (default: false)", "body"));
        addSchema(endpoints, "/deps/auto-load", "POST", "Auto-import dependency binaries found in directory", "dependency",
            param("directory", "string", false, "Directory to search (default: /binaries)", "body"),
            param("program", "string", false, "Program name (uses current if omitted)", "body"));
        addSchema(endpoints, "/deps/match", "POST", "Match imports of program A against exports of program B", "dependency",
            param("program_a", "string", true, "Importer program name", "body"),
            param("program_b", "string", true, "Exporter program name", "body"));
        addSchema(endpoints, "/deps/trace", "POST", "Trace an imported function through the dependency chain", "dependency",
            param("function", "string", true, "Function name to trace", "body"),
            param("library", "string", false, "Library name (auto-detected if omitted)", "body"), optProg);
        addSchema(endpoints, "/deps/cross-xref", "POST", "Find all loaded programs that import a specific function", "dependency",
            param("function", "string", true, "Function name", "body"),
            param("exporter", "string", false, "Exporter program to exclude from results", "body"));
        addSchema(endpoints, "/deps/graph", "GET", "Build dependency graph of all loaded programs", "dependency",
            param("format", "string", false, "Output format: json or dot (default: json)"));
        addSchema(endpoints, "/deps/unresolved", "GET", "Find all unresolved imports across all loaded programs", "dependency");
        addSchema(endpoints, "/deps/summary", "GET", "Dependency analysis summary with per-library match stats", "dependency", optProg);

        addSchema(endpoints, "/callgraph", "GET", "Build call graph around a function", "callgraph",
            param("address", "string", true, "Hex address or function name"),
            param("depth", "integer", false, "Traversal depth (default 2)"),
            param("direction", "string", false, "Direction: callers, callees, or both (default: both)"),
            param("format", "string", false, "Output format: json or mermaid (default: json)"), optProg);
        addSchema(endpoints, "/callgraph/full", "GET", "Full program call graph (all edges)", "callgraph",
            param("limit", "integer", false, "Max edges (default 1000)"),
            param("format", "string", false, "Output format: json or mermaid (default: json)"), optProg);
        addSchema(endpoints, "/callgraph/path", "POST", "Find shortest call path between two functions (BFS)", "callgraph",
            param("start", "string", true, "Start function address or name", "body"),
            param("end", "string", true, "End function address or name", "body"),
            param("format", "string", false, "Output format: json or mermaid (default: json)"), optProg);

        addSchema(endpoints, "/types", "GET", "List data types", "datatype",
            param("filter", "string", false, "Filter by name substring"),
            param("limit", "integer", false, "Max results (default 200)"), optProg);
        addSchema(endpoints, "/struct", "GET", "Get struct layout with field details", "datatype",
            param("name", "string", true, "Struct name"), optProg);
        addSchema(endpoints, "/struct/create", "POST", "Create a new empty struct", "datatype",
            param("name", "string", true, "Struct name", "body"),
            param("size", "integer", false, "Initial size in bytes (default 0)", "body"), optProg);
        addSchema(endpoints, "/type/apply", "POST", "Apply a data type at address", "datatype",
            param("address", "string", true, "Hex address", "body"),
            param("type", "string", true, "Data type name", "body"), optProg);

        ctx.sendOk(ex, Map.of("endpoints", endpoints, "count", endpoints.size(), "version", "1.2.0"));
    }

    private void addSchema(List<Map<String, Object>> list, String path, String method, String desc, String category, Map<String, Object>... params) {
        var entry = new LinkedHashMap<String, Object>();
        entry.put("path", path);
        entry.put("method", method);
        entry.put("description", desc);
        entry.put("category", category);
        if (params.length > 0) entry.put("params", List.of(params));
        list.add(entry);
    }

    private Map<String, Object> param(String name, String type, boolean required, String desc) {
        return param(name, type, required, desc, "query");
    }

    private Map<String, Object> param(String name, String type, boolean required, String desc, String source) {
        return Map.of("name", name, "type", type, "required", required, "description", desc, "source", source);
    }
}
