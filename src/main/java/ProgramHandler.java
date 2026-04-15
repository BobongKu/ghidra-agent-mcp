import com.sun.net.httpserver.HttpExchange;
import ghidra.program.model.listing.Program;

import java.io.*;
import java.nio.file.Path;
import java.util.*;

public class ProgramHandler {

    private final ServerContext ctx;

    public ProgramHandler(ServerContext ctx) { this.ctx = ctx; }

    public void handleHealth(HttpExchange ex) throws Exception {
        var info = new LinkedHashMap<String, Object>();
        info.put("server", "ghidra-agent-mcp");
        info.put("version", "1.2.0");
        info.put("programs_loaded", ctx.programs.size());
        info.put("max_programs", ctx.maxPrograms);
        info.put("current_program", ctx.currentProgram != null ? ctx.currentProgram.getName() : "none");
        info.put("programs", new ArrayList<>(ctx.programs.keySet()));
        info.put("binaries_dir", ctx.binariesDir);
        File binDir = new File(ctx.binariesDir);
        if (binDir.isDirectory()) {
            var files = binDir.listFiles();
            if (files != null) {
                var binaries = new ArrayList<String>();
                for (File f : files) { if (f.isFile()) binaries.add(f.getName()); }
                Collections.sort(binaries);
                info.put("available_binaries", binaries);
            }
        }
        if (ctx.programs.isEmpty()) {
            info.put("hint", "No programs loaded. POST /upload?filename=name.exe or POST /import with {\"path\":\"/binaries/name.exe\"}");
        }
        ctx.sendOk(ex, info);
    }

    public void handleUpload(HttpExchange ex) throws Exception {
        var query = ctx.parseQuery(ex);
        String filename = query.getOrDefault("filename", "");
        if (filename.isEmpty()) {
            String cd = ex.getRequestHeaders().getFirst("Content-Disposition");
            if (cd != null && cd.contains("filename=")) {
                filename = cd.replaceAll(".*filename=\"?([^\";]+)\"?.*", "$1");
            }
        }
        if (filename.isEmpty()) { ctx.sendError(ex, 400, "Missing filename. Use ?filename=test.exe"); return; }

        String safeName = Path.of(filename).getFileName().toString();
        if (safeName.isEmpty() || safeName.startsWith(".")) {
            ctx.sendError(ex, 400, "Invalid filename"); return;
        }

        File dest = new File(ctx.binariesDir, safeName);
        try (var in = ex.getRequestBody(); var out = new FileOutputStream(dest)) {
            in.transferTo(out);
        }

        if (dest.length() == 0) {
            dest.delete();
            ctx.sendError(ex, 400, "Empty file received"); return;
        }

        boolean autoImport = !"false".equalsIgnoreCase(query.getOrDefault("analyze", "true"));

        if (autoImport && ctx.programs.size() < ctx.maxPrograms) {
            try {
                Program prog = ctx.importAndAnalyze(dest);
                ctx.sendOk(ex, Map.of(
                    "file", dest.getAbsolutePath(), "size", dest.length(),
                    "imported", true, "name", prog.getName(),
                    "format", prog.getExecutableFormat(),
                    "language", prog.getLanguageID().toString(),
                    "functions", prog.getFunctionManager().getFunctionCount()
                ));
            } catch (Exception e) {
                ctx.sendOk(ex, Map.of("file", dest.getAbsolutePath(), "size", dest.length(),
                    "imported", false, "error", e.getMessage()));
            }
        } else {
            ctx.sendOk(ex, Map.of("file", dest.getAbsolutePath(), "size", dest.length(),
                "imported", false, "message", autoImport ? "Max programs limit reached" : "Auto-import disabled"));
        }
    }

    public void handleImport(HttpExchange ex) throws Exception {
        var body = ctx.parseBody(ex);
        String path = ctx.requireParam(body, "path");
        File file = new File(path);
        if (!file.exists()) { ctx.sendError(ex, 400, "File not found: " + path); return; }
        if (ctx.programs.size() >= ctx.maxPrograms) { ctx.sendError(ex, 400, "Max programs limit (" + ctx.maxPrograms + ") reached."); return; }

        Program prog = ctx.importAndAnalyze(file);
        var result = new LinkedHashMap<String, Object>();
        result.put("name", prog.getName());
        result.put("format", prog.getExecutableFormat());
        result.put("language", prog.getLanguageID().toString());
        result.put("functions", prog.getFunctionManager().getFunctionCount());
        ctx.sendOk(ex, result);
    }

    public void handlePrograms(HttpExchange ex) throws Exception {
        var list = new ArrayList<Map<String, Object>>();
        for (var entry : ctx.programs.entrySet()) {
            Program p = entry.getValue();
            list.add(Map.of(
                "name", p.getName(), "format", p.getExecutableFormat(),
                "language", p.getLanguageID().toString(),
                "functions", p.getFunctionManager().getFunctionCount(),
                "is_current", p == ctx.currentProgram
            ));
        }
        ctx.sendOk(ex, list);
    }

    public void handleProgramClose(HttpExchange ex) throws Exception {
        var body = ctx.parseBody(ex);
        String name = ctx.requireParam(body, "name");
        Program p = ctx.programs.remove(name);
        if (p == null) {
            for (var entry : ctx.programs.entrySet()) {
                if (entry.getKey().equalsIgnoreCase(name)) {
                    p = ctx.programs.remove(entry.getKey());
                    break;
                }
            }
            if (p == null) { ctx.sendError(ex, 404, "Program not found: " + name); return; }
        }
        if (p == ctx.currentProgram) {
            ctx.currentProgram = ctx.programs.isEmpty() ? null : ctx.programs.values().iterator().next();
        }
        p.setTemporary(true);
        ctx.sendOk(ex, Map.of("closed", p.getName()));
    }

    public void handleCloseAll(HttpExchange ex) throws Exception {
        var body = ctx.parseBody(ex);
        boolean keepCurrent = "true".equalsIgnoreCase(String.valueOf(body.getOrDefault("keep_current", "false")));

        var closed = new ArrayList<String>();
        var it = ctx.programs.entrySet().iterator();
        while (it.hasNext()) {
            var entry = it.next();
            if (keepCurrent && entry.getValue() == ctx.currentProgram) continue;
            entry.getValue().setTemporary(true);
            closed.add(entry.getKey());
            it.remove();
        }

        if (!keepCurrent || !ctx.programs.containsValue(ctx.currentProgram)) {
            ctx.currentProgram = ctx.programs.isEmpty() ? null : ctx.programs.values().iterator().next();
        }

        var result = new LinkedHashMap<String, Object>();
        result.put("closed", closed);
        result.put("closed_count", closed.size());
        result.put("remaining", new ArrayList<>(ctx.programs.keySet()));
        ctx.sendOk(ex, result);
    }

    public void handleProgramInfo(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        var mem = p.getMemory();
        ctx.sendOk(ex, ctx.withRead(() -> Map.of(
            "name", p.getName(), "executable_format", p.getExecutableFormat(),
            "language", p.getLanguageID().toString(),
            "compiler", p.getCompilerSpec().getCompilerSpecID().toString(),
            "image_base", p.getImageBase().toString(),
            "min_address", mem.getMinAddress().toString(),
            "max_address", mem.getMaxAddress().toString(),
            "memory_size", mem.getSize(),
            "function_count", p.getFunctionManager().getFunctionCount(),
            "symbol_count", p.getSymbolTable().getNumSymbols()
        )));
    }
}

