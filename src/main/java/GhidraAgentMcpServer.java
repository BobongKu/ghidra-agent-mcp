import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import ghidra.GhidraApplicationLayout;
import ghidra.framework.Application;
import ghidra.framework.HeadlessGhidraApplicationConfiguration;
import ghidra.base.project.GhidraProject;

// Handlers are in the default package alongside this class

import java.io.File;
import java.net.InetSocketAddress;
import java.util.concurrent.Executors;

public class GhidraAgentMcpServer {

    private HttpServer server;
    private final ServerContext ctx = new ServerContext();

    public void start(int port, String bindAddress) throws Exception {
        if (!Application.isInitialized()) {
            var layout = new GhidraApplicationLayout();
            var config = new HeadlessGhidraApplicationConfiguration();
            Application.initializeApplication(layout, config);
        }

        File projectDir = new File(ctx.dataDir);
        projectDir.mkdirs();
        try {
            ctx.project = GhidraProject.openProject(ctx.dataDir, "analyzer", true);
        } catch (Exception e) {
            ctx.project = GhidraProject.createProject(ctx.dataDir, "analyzer", false);
        }

        server = HttpServer.create(new InetSocketAddress(bindAddress, port), 0);
        server.setExecutor(Executors.newFixedThreadPool(10));
        registerEndpoints();
        server.start();
        System.out.println("[ghidra-agent-mcp] Server started on " + bindAddress + ":" + port);
        System.out.println("[ghidra-agent-mcp] Binaries directory: " + ctx.binariesDir);
    }

    private void registerEndpoints() {
        var prog = new ProgramHandler(ctx);
        var func = new FunctionHandler(ctx);
        var list = new ListingHandler(ctx);
        var mod  = new ModifyHandler(ctx);
        var dep  = new DependencyHandler(ctx);
        var cg   = new CallGraphHandler(ctx);
        var dt   = new DataTypeHandler(ctx);
        var sch  = new SchemaHandler(ctx);

        // Program management
        route("/health",        "GET",  prog::handleHealth);
        route("/upload",        "POST", prog::handleUpload);
        route("/import",        "POST", prog::handleImport);
        route("/programs",      "GET",  prog::handlePrograms);
        route("/program/close",     "POST", prog::handleProgramClose);
        route("/program/close-all", "POST", prog::handleCloseAll);
        route("/program/info",      "GET",  prog::handleProgramInfo);

        // Function analysis
        route("/functions",          "GET",  func::handleFunctions);
        route("/function",           "GET",  func::handleFunction);
        route("/decompile",          "POST", func::handleDecompile);
        route("/disassemble",        "POST", func::handleDisassemble);
        route("/function/callers",   "GET",  func::handleCallers);
        route("/function/callees",   "GET",  func::handleCallees);
        route("/function/xrefs",     "GET",  func::handleFunctionXrefs);
        route("/function/variables", "GET",  func::handleFunctionVariables);

        // Listing
        route("/imports",  "GET", list::handleImports);
        route("/exports",  "GET", list::handleExports);
        route("/strings",  "GET", list::handleStrings);
        route("/segments", "GET", list::handleSegments);
        route("/symbols",  "GET", list::handleSymbols);
        route("/memory",   "GET", list::handleMemory);

        // Modify
        route("/rename/function", "POST", mod::handleRenameFunction);
        route("/rename/variable", "POST", mod::handleRenameVariable);
        route("/rename/label",    "POST", mod::handleRenameLabel);
        route("/comment",         "POST", mod::handleComment);
        route("/prototype",       "POST", mod::handlePrototype);

        // Dependency analysis
        route("/deps/list",       "GET",  dep::handleDepsList);
        route("/deps/tree",       "POST", dep::handleDepsTree);
        route("/deps/auto-load",  "POST", dep::handleDepsAutoLoad);
        route("/deps/match",      "POST", dep::handleDepsMatch);
        route("/deps/trace",      "POST", dep::handleDepsTrace);
        route("/deps/cross-xref", "POST", dep::handleDepsCrossXref);
        route("/deps/graph",      "GET",  dep::handleDepsGraph);
        route("/deps/unresolved", "GET",  dep::handleDepsUnresolved);
        route("/deps/summary",    "GET",  dep::handleDepsSummary);

        // Call graph
        route("/callgraph",      "GET",  cg::handleCallGraph);
        route("/callgraph/full", "GET",  cg::handleCallGraphFull);
        route("/callgraph/path", "POST", cg::handleCallGraphPath);

        // Data types
        route("/types",         "GET",  dt::handleTypes);
        route("/struct",        "GET",  dt::handleStruct);
        route("/struct/create", "POST", dt::handleStructCreate);
        route("/type/apply",    "POST", dt::handleTypeApply);

        // Schema
        route("/schema", "GET", sch::handleSchema);
    }

    @FunctionalInterface
    interface Handler { void handle(HttpExchange ex) throws Exception; }

    private void route(String path, String method, Handler handler) {
        server.createContext(path, ex -> {
            try {
                String reqMethod = ex.getRequestMethod().toUpperCase();
                if (reqMethod.equals("OPTIONS")) {
                    setCorsHeaders(ex);
                    ex.sendResponseHeaders(204, -1);
                    return;
                }
                setCorsHeaders(ex);
                handler.handle(ex);
            } catch (IllegalArgumentException e) {
                ctx.sendError(ex, 400, e.getMessage());
            } catch (IllegalStateException e) {
                ctx.sendError(ex, 409, e.getMessage());
            } catch (Exception e) {
                System.err.println("[error] " + path + ": " + e.getMessage());
                ctx.sendError(ex, 500, e.getClass().getSimpleName() + ": " + (e.getMessage() != null ? e.getMessage() : "Internal error"));
            }
        });
    }

    private void setCorsHeaders(HttpExchange ex) {
        ex.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ex.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
    }

    // ========== MAIN ==========

    public static void main(String[] args) throws Exception {
        int port = 8089;
        String bind = "127.0.0.1";
        String binDir = "/binaries";
        String dataDir = "/data";
        int maxProgs = 50;

        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--port", "-p" -> port = Integer.parseInt(args[++i]);
                case "--bind", "-b" -> bind = args[++i];
                case "--binaries" -> binDir = args[++i];
                case "--data" -> dataDir = args[++i];
                case "--max-programs" -> maxProgs = Integer.parseInt(args[++i]);
            }
        }

        var server = new GhidraAgentMcpServer();
        server.ctx.binariesDir = binDir;
        server.ctx.dataDir = dataDir;
        server.ctx.maxPrograms = maxProgs;
        server.start(port, bind);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("[ghidra-agent-mcp] Shutting down...");
            server.server.stop(2);
        }));

        Thread.currentThread().join();
    }
}

