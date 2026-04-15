import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import com.sun.net.httpserver.HttpExchange;

import ghidra.base.project.GhidraProject;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Program;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolType;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.listing.CodeUnit;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.util.task.TaskMonitor;

import java.io.*;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Shared context for all handlers: programs map, locks, utility methods.
 */
public class ServerContext {

    final Map<String, Program> programs = new ConcurrentHashMap<>();
    volatile Program currentProgram;
    final ReadWriteLock rwLock = new ReentrantReadWriteLock();
    final Gson gson = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();

    GhidraProject project;
    String binariesDir = "/binaries";
    String dataDir = "/data";
    int maxPrograms = 50;

    // API set to real DLL mapping (Windows virtual DLL forwarding)
    private static final Map<String, String> API_SET_MAP = new HashMap<>();
    static {
        API_SET_MAP.put("api-ms-win-core-processthreads-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-processthreads-l1-1-1", "kernel32");
        API_SET_MAP.put("api-ms-win-core-file-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-file-l1-2-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-synch-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-synch-l1-2-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-libraryloader-l1-2-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-libraryloader-l1-2-1", "kernel32");
        API_SET_MAP.put("api-ms-win-core-memory-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-heap-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-heap-l2-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-heap-obsolete-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-errorhandling-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-handle-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-processenvironment-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-string-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-string-obsolete-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-sysinfo-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-profile-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-interlocked-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-debug-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-rtlsupport-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-datetime-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-localization-l1-2-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-localization-obsolete-l1-2-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-registry-l1-1-0", "advapi32");
        API_SET_MAP.put("api-ms-win-core-registry-l1-1-1", "advapi32");
        API_SET_MAP.put("api-ms-win-core-registry-l2-1-0", "advapi32");
        API_SET_MAP.put("api-ms-win-security-base-l1-1-0", "advapi32");
        API_SET_MAP.put("api-ms-win-eventing-provider-l1-1-0", "advapi32");
        API_SET_MAP.put("api-ms-win-core-com-l1-1-0", "combase");
        API_SET_MAP.put("api-ms-win-core-winrt-l1-1-0", "combase");
        API_SET_MAP.put("api-ms-win-core-winrt-string-l1-1-0", "combase");
        API_SET_MAP.put("api-ms-win-core-winrt-error-l1-1-0", "combase");
        API_SET_MAP.put("api-ms-win-core-winrt-error-l1-1-1", "combase");
        API_SET_MAP.put("api-ms-win-core-delayload-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-delayload-l1-1-1", "kernel32");
        API_SET_MAP.put("api-ms-win-core-psapi-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-threadpool-l1-2-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-largeinteger-l1-1-0", "kernel32");
        API_SET_MAP.put("api-ms-win-core-windowserrorreporting-l1-1-3", "kernel32");
        API_SET_MAP.put("api-ms-win-core-shlwapi-legacy-l1-1-0", "shlwapi");
        API_SET_MAP.put("api-ms-win-shcore-scaling-l1-1-1", "shcore");
        API_SET_MAP.put("api-ms-win-shcore-obsolete-l1-1-0", "shlwapi");
        API_SET_MAP.put("api-ms-win-shcore-path-l1-1-0", "shlwapi");
        API_SET_MAP.put("api-ms-win-base-util-l1-1-0", "advapi32");
        API_SET_MAP.put("api-ms-win-crt-string-l1-1-0", "ucrtbase");
        API_SET_MAP.put("api-ms-win-crt-runtime-l1-1-0", "ucrtbase");
        API_SET_MAP.put("api-ms-win-crt-private-l1-1-0", "ucrtbase");
    }

    // ========== LOCKING ==========

    public <T> T withRead(Callable<T> action) throws Exception {
        rwLock.readLock().lock();
        try { return action.call(); }
        finally { rwLock.readLock().unlock(); }
    }

    public <T> T withWrite(Program program, String txName, Callable<T> action) throws Exception {
        rwLock.writeLock().lock();
        int tx = program.startTransaction(txName);
        boolean success = false;
        try {
            T result = action.call();
            success = true;
            return result;
        } finally {
            program.endTransaction(tx, success);
            if (success) program.flushEvents();
            rwLock.writeLock().unlock();
        }
    }

    // ========== HTTP HELPERS ==========

    public void sendOk(HttpExchange ex, Object data) throws IOException {
        sendJson(ex, 200, Map.of("status", "ok", "data", data));
    }

    public void sendError(HttpExchange ex, int code, String message) throws IOException {
        sendJson(ex, code, Map.of("status", "error", "message", message != null ? message : "Unknown error"));
    }

    public void sendJson(HttpExchange ex, int code, Object obj) throws IOException {
        byte[] bytes = gson.toJson(obj).getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(code, bytes.length);
        try (var os = ex.getResponseBody()) { os.write(bytes); }
    }

    public Map<String, String> parseQuery(HttpExchange ex) {
        var map = new LinkedHashMap<String, String>();
        String q = ex.getRequestURI().getRawQuery();
        if (q == null) return map;
        for (String pair : q.split("&")) {
            int idx = pair.indexOf('=');
            if (idx > 0) {
                String key = URLDecoder.decode(pair.substring(0, idx), StandardCharsets.UTF_8);
                String val = URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8);
                map.put(key, val);
            }
        }
        return map;
    }

    public Map<String, Object> parseBody(HttpExchange ex) throws IOException {
        try (var reader = new InputStreamReader(ex.getRequestBody(), StandardCharsets.UTF_8)) {
            var sb = new StringBuilder();
            char[] buf = new char[4096];
            int n;
            while ((n = reader.read(buf)) != -1) sb.append(buf, 0, n);
            String raw = sb.toString().trim();
            if (raw.isEmpty()) return new LinkedHashMap<>();
            try {
                var type = new TypeToken<Map<String, Object>>(){}.getType();
                Map<String, Object> result = gson.fromJson(raw, type);
                return result != null ? result : new LinkedHashMap<>();
            } catch (Exception e) {
                return new LinkedHashMap<>();
            }
        }
    }

    /** Merge query params and body (query takes precedence for 'program') */
    public Map<String, Object> parseRequest(HttpExchange ex) throws IOException {
        var merged = new LinkedHashMap<String, Object>();
        merged.putAll(parseBody(ex));
        parseQuery(ex).forEach(merged::put);
        return merged;
    }

    public String requireParam(Map<String, ?> params, String key) {
        Object val = params.get(key);
        if (val == null || val.toString().isBlank()) throw new IllegalArgumentException("Missing required parameter: " + key);
        return val.toString();
    }

    public int intParam(Map<String, ?> params, String key, int def) {
        Object val = params.get(key);
        if (val == null) return def;
        if (val instanceof Number n) return n.intValue();
        try { return Integer.parseInt(val.toString()); } catch (NumberFormatException e) { return def; }
    }

    // ========== PROGRAM RESOLUTION ==========

    public Program resolveProgram(Map<String, ?> params) {
        Object nameObj = params.get("program");
        String name = nameObj != null ? nameObj.toString() : null;
        if (name != null && !name.isBlank()) {
            Program p = programs.get(name);
            if (p != null) return p;
            for (var entry : programs.entrySet()) {
                if (entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
            }
            for (var entry : programs.entrySet()) {
                if (entry.getKey().toLowerCase().contains(name.toLowerCase())) return entry.getValue();
            }
            throw new IllegalArgumentException("Program not found: '" + name + "'. Available: " + String.join(", ", programs.keySet()));
        }
        if (currentProgram == null) {
            throw new IllegalStateException("No program loaded. Use /upload or /import first.");
        }
        return currentProgram;
    }

    public Address toAddress(Program prog, String addr) {
        String clean = addr.strip();
        if (clean.toLowerCase().startsWith("0x")) clean = clean.substring(2);
        clean = clean.replaceFirst("^0+(?=.)", "");
        try {
            Address a = prog.getAddressFactory().getDefaultAddressSpace().getAddress(clean);
            if (a == null) throw new IllegalArgumentException("Invalid address: '" + addr + "'. Expected hex like 0x140001000");
            return a;
        } catch (ghidra.program.model.address.AddressFormatException e) {
            throw new IllegalArgumentException("Invalid address format: '" + addr + "'. Expected hex like 0x140001000");
        }
    }

    /** Resolve function by address OR name */
    public Function resolveFunction(Program p, String addressOrName) {
        try {
            Address a = toAddress(p, addressOrName);
            Function f = p.getFunctionManager().getFunctionAt(a);
            if (f != null) return f;
            f = p.getFunctionManager().getFunctionContaining(a);
            if (f != null) return f;
        } catch (IllegalArgumentException ignored) {}
        return findFunctionByName(p, addressOrName);
    }

    /** Resolve API set DLL name to real DLL name */
    public String resolveApiSet(String libName) {
        String key = libName.toLowerCase().replaceAll("\\.dll$", "");
        return API_SET_MAP.get(key);
    }

    public Program findProgramByLibName(String libName) {
        Program p = programs.get(libName);
        if (p != null) return p;

        String clean = libName.toLowerCase().replaceAll("\\.(dll|so|exe|dylib|drv)(\\.[0-9.]+)?$", "");
        for (var entry : programs.entrySet()) {
            if (entry.getKey().equalsIgnoreCase(libName)) return entry.getValue();
            String pClean = entry.getKey().toLowerCase().replaceAll("\\.(dll|so|exe|dylib|drv)(\\.[0-9.]+)?$", "");
            if (pClean.equals(clean)) return entry.getValue();
        }
        return null;
    }

    public File findBinaryFile(String dir, String libName) {
        File d = new File(dir);
        if (!d.isDirectory()) return null;

        File exact = new File(d, libName);
        if (exact.exists()) return exact;

        File[] files = d.listFiles();
        if (files == null) return null;
        for (File f : files) {
            if (f.getName().equalsIgnoreCase(libName)) return f;
        }

        String base = libName.toLowerCase().replaceAll("\\.(dll|so|exe|dylib|drv)(\\.[0-9.]+)?$", "");
        for (File f : files) {
            String fBase = f.getName().toLowerCase().replaceAll("\\.(dll|so|exe|dylib|drv)(\\.[0-9.]+)?$", "");
            if (fBase.equals(base)) return f;
        }
        return null;
    }

    public Function findFunctionByName(Program p, String name) {
        var symbols = p.getSymbolTable().getSymbols(name);
        while (symbols.hasNext()) {
            Symbol s = symbols.next();
            if (s.getSymbolType() == SymbolType.FUNCTION) {
                return p.getFunctionManager().getFunctionAt(s.getAddress());
            }
        }
        var funcIt = p.getFunctionManager().getFunctions(true);
        while (funcIt.hasNext()) {
            Function f = funcIt.next();
            if (f.getName().equalsIgnoreCase(name)) return f;
        }
        var extIt = p.getFunctionManager().getExternalFunctions();
        while (extIt.hasNext()) {
            Function f = extIt.next();
            if (f.getName().equalsIgnoreCase(name)) return f;
        }
        return null;
    }

    public List<ghidra.program.model.symbol.Reference> getCallRefsFrom(Program p, Function f) {
        var refs = new ArrayList<ghidra.program.model.symbol.Reference>();
        var it = p.getListing().getInstructions(f.getBody(), true);
        while (it.hasNext()) {
            var instr = it.next();
            for (var ref : instr.getReferencesFrom()) {
                if (ref.getReferenceType().isCall()) refs.add(ref);
            }
        }
        return refs;
    }

    public String bytesToHex(byte[] bytes) { return bytesToHex(bytes, bytes.length); }
    public String bytesToHex(byte[] bytes, int len) {
        var sb = new StringBuilder(len * 2);
        for (int i = 0; i < len; i++) sb.append(String.format("%02x", bytes[i] & 0xff));
        return sb.toString();
    }

    /** Import a file and start auto-analysis. Thread-safe. */
    public synchronized Program importAndAnalyze(File file) throws Exception {
        String fileName = file.getName();
        Program existing = programs.get(fileName);
        if (existing != null) return existing;
        for (Program p : programs.values()) {
            if (p.getName().equalsIgnoreCase(fileName)) return p;
        }

        Program prog = project.importProgram(file);
        if (prog == null) throw new RuntimeException("Import failed for: " + file.getName());

        programs.put(prog.getName(), prog);
        if (currentProgram == null) currentProgram = prog;

        var mgr = ghidra.app.plugin.core.analysis.AutoAnalysisManager.getAnalysisManager(prog);
        mgr.initializeOptions();

        // Disable analyzers that fail in headless mode (no script directories)
        var options = prog.getOptions("Analyzers");
        options.setBoolean("Windows Resource Reference Analyzer", false);

        mgr.reAnalyzeAll(null);
        mgr.startAnalysis(TaskMonitor.DUMMY);
        return prog;
    }
}

