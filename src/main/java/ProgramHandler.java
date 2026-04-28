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
        info.put("version", "1.0.1");
        Program cp = ctx.getCurrentProgram();
        info.put("programs_loaded", ctx.programs.size());
        info.put("max_programs", ctx.maxPrograms);
        info.put("current_program", cp != null ? cp.getName() : "none");
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
        // Background-job summary
        info.put("jobs", ctx.jobManager.countsByStatus());
        if (ctx.programs.isEmpty()) {
            info.put("hint", "No programs loaded. POST /upload?filename=name.exe or POST /import with {\"path\":\"/binaries/name.exe\"}");
        }
        ctx.sendOk(ex, info);
    }

    /**
     * POST /upload?filename=...&analyze=[true|false]&wait=[seconds|true|false]
     *
     * Streams the request body to {@code <binariesDir>/<filename>}. If
     * {@code analyze=true} (default), submits an import/analyze job and either
     * waits up to {@code wait} seconds for completion (default 120) or returns
     * immediately with {@code wait=0}. The response always includes the
     * {@code job_id} so callers can poll {@code /jobs/{id}}.
     */
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

        // Reject obviously oversized uploads up-front (cheaper than streaming bytes
        // we'll throw away). Override via env GHIDRA_MAX_UPLOAD_BYTES (default 1 GiB).
        long maxBytes = parseLongEnv("GHIDRA_MAX_UPLOAD_BYTES", 1024L * 1024 * 1024);
        String cl = ex.getRequestHeaders().getFirst("Content-Length");
        if (cl != null) {
            try {
                long len = Long.parseLong(cl);
                if (len > maxBytes) {
                    ctx.sendError(ex, 413,
                        "Upload too large: " + len + " bytes (max " + maxBytes + ")");
                    return;
                }
            } catch (NumberFormatException ignored) {}
        }

        File dest = new File(ctx.binariesDir, safeName);
        boolean writeOk = false;
        try (var in = ex.getRequestBody(); var out = new FileOutputStream(dest)) {
            // Cap the actual transfer in case Content-Length lied or was missing.
            long copied = 0;
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                copied += n;
                if (copied > maxBytes) {
                    throw new IOException("Upload exceeded max size " + maxBytes + " bytes");
                }
                out.write(buf, 0, n);
            }
            writeOk = true;
        } finally {
            if (!writeOk && dest.exists()) {
                // Partial / failed write — drop the orphan to avoid disk noise.
                try { dest.delete(); } catch (Exception ignored) {}
            }
        }

        if (dest.length() == 0) {
            dest.delete();
            ctx.sendError(ex, 400, "Empty file received"); return;
        }

        boolean autoImport = !"false".equalsIgnoreCase(query.getOrDefault("analyze", "true"));
        if (!autoImport) {
            ctx.sendOk(ex, Map.of(
                "file", dest.getAbsolutePath(),
                "size", dest.length(),
                "imported", false,
                "message", "Auto-import disabled"
            ));
            return;
        }
        if (ctx.programs.size() >= ctx.maxPrograms) {
            ctx.sendOk(ex, Map.of(
                "file", dest.getAbsolutePath(),
                "size", dest.length(),
                "imported", false,
                "message", "Max programs limit (" + ctx.maxPrograms + ") reached."
            ));
            return;
        }

        // Submit job + (optionally) wait
        long waitSec = JobsHandler.parseWaitParam(query, 120);
        var level = ServerContext.AnalysisLevel.parse(query.get("analysis"));
        Job job = submitImportJob("upload", safeName, dest, level);
        respondWithJob(ex, job, waitSec, dest);
    }

    /**
     * POST /import {"path": "/binaries/foo.exe"}?wait=...
     * Same async semantics as /upload, but the file is already on disk in the
     * server-visible binaries directory.
     */
    public void handleImport(HttpExchange ex) throws Exception {
        var body = ctx.parseBody(ex);
        String path = ctx.requireParam(body, "path");
        File file = new File(path);
        if (!file.exists()) { ctx.sendError(ex, 400, "File not found: " + path); return; }
        if (ctx.programs.size() >= ctx.maxPrograms) {
            ctx.sendError(ex, 400, "Max programs limit (" + ctx.maxPrograms + ") reached.");
            return;
        }

        var query = ctx.parseQuery(ex);
        long waitSec = JobsHandler.parseWaitParam(query, 120);
        // /import accepts the analysis level via query OR body.
        String levelStr = query.get("analysis");
        if (levelStr == null) {
            Object bodyVal = body.get("analysis");
            if (bodyVal != null) levelStr = bodyVal.toString();
        }
        var level = ServerContext.AnalysisLevel.parse(levelStr);
        Job job = submitImportJob("import", file.getName(), file, level);
        respondWithJob(ex, job, waitSec, file);
    }

    /** Submit an import-and-analyze job to the worker thread. */
    private Job submitImportJob(String type, String programName, File file,
                                ServerContext.AnalysisLevel level) {
        return ctx.jobManager.submit(type, programName,
            (Job self) -> {
                Program prog = ctx.importAndAnalyze(file, level, self);
                return Map.of(
                    "name", prog.getName(),
                    "format", prog.getExecutableFormat(),
                    "language", prog.getLanguageID().toString(),
                    "functions", prog.getFunctionManager().getFunctionCount(),
                    "analysis", level.name().toLowerCase()
                );
            });
    }

    /**
     * Wait up to {@code waitSec} for the job, then send a response that always
     * includes {@code job_id} + current state, plus inline import details when
     * the job is already terminal.
     */
    private void respondWithJob(HttpExchange ex, Job job, long waitSec, File file) throws Exception {
        if (waitSec > 0) {
            try { job.awaitDone(Math.min(waitSec, 1800) * 1000L); }
            catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
        var resp = new LinkedHashMap<String, Object>();
        resp.put("file", file.getAbsolutePath());
        resp.put("size", file.length());
        resp.putAll(job.toMap());
        if ("ready".equals(job.status) && job.result != null) {
            resp.put("imported", true);
            resp.putAll(job.result);
        } else if ("error".equals(job.status)) {
            resp.put("imported", false);
            resp.put("error", job.message);
        } else {
            resp.put("imported", false);
            resp.put("hint", "Job " + job.status + ". Poll /jobs/" + job.id + "?wait=60 for completion.");
        }
        ctx.sendOk(ex, resp);
    }

    public void handlePrograms(HttpExchange ex) throws Exception {
        Program cp = ctx.getCurrentProgram();
        var snapshot = new ArrayList<>(ctx.programs.entrySet());
        var list = new ArrayList<Map<String, Object>>();
        for (var entry : snapshot) {
            Program p = entry.getValue();
            list.add(Map.of(
                "name", p.getName(), "format", p.getExecutableFormat(),
                "language", p.getLanguageID().toString(),
                "functions", p.getFunctionManager().getFunctionCount(),
                "is_current", p == cp
            ));
        }
        ctx.sendOk(ex, list);
    }

    public void handleProgramClose(HttpExchange ex) throws Exception {
        var body = ctx.parseBody(ex);
        String name = ctx.requireParam(body, "name");
        Program p = ctx.removeProgram(name);
        if (p == null) { ctx.sendError(ex, 404, "Program not found: " + name); return; }
        try { p.setTemporary(true); } catch (Exception ignored) {}
        ctx.sendOk(ex, Map.of("closed", p.getName()));
    }

    public void handleCloseAll(HttpExchange ex) throws Exception {
        var body = ctx.parseBody(ex);
        boolean keepCurrent = "true".equalsIgnoreCase(String.valueOf(body.getOrDefault("keep_current", "false")));
        var closed = ctx.closeAllPrograms(keepCurrent);
        var result = new LinkedHashMap<String, Object>();
        result.put("closed", closed);
        result.put("closed_count", closed.size());
        result.put("remaining", new ArrayList<>(ctx.programs.keySet()));
        ctx.sendOk(ex, result);
    }

    private static long parseLongEnv(String key, long def) {
        String v = System.getenv(key);
        if (v == null || v.isBlank()) return def;
        try { return Long.parseLong(v.trim()); } catch (NumberFormatException e) { return def; }
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
