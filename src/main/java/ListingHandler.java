import com.sun.net.httpserver.HttpExchange;
import ghidra.program.model.data.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Symbol;

import java.util.*;

public class ListingHandler {

    private final ServerContext ctx;

    public ListingHandler(ServerContext ctx) { this.ctx = ctx; }

    public void handleImports(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        // Cap to avoid materialising huge per-library function lists in memory.
        int perLib = Math.max(0, Math.min(ctx.intParam(params, "limit_per_lib", 200), 5000));

        ctx.sendOk(ex, ctx.withRead(() -> {
            var extMgr = p.getExternalManager();
            var result = new ArrayList<Map<String, Object>>();
            for (String libName : extMgr.getExternalLibraryNames()) {
                var funcs = new ArrayList<String>();
                int total = 0;
                var it = extMgr.getExternalLocations(libName);
                while (it.hasNext()) {
                    String label = it.next().getLabel();
                    total++;
                    if (funcs.size() < perLib) funcs.add(label);
                }
                var entry = new LinkedHashMap<String, Object>();
                entry.put("library", libName);
                entry.put("count", total);
                entry.put("functions", funcs);
                if (total > funcs.size()) entry.put("truncated", true);
                result.add(entry);
            }
            return result;
        }));
    }

    public void handleExports(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        int limit = ctx.intParam(params, "limit", 500);

        ctx.sendOk(ex, ctx.withRead(() -> {
            var result = new ArrayList<Map<String, String>>();
            var it = p.getSymbolTable().getExternalEntryPointIterator();
            int n = 0;
            while (it.hasNext() && n++ < limit) {
                var a = it.next();
                Function f = p.getFunctionManager().getFunctionAt(a);
                Symbol s = p.getSymbolTable().getPrimarySymbol(a);
                result.add(Map.of(
                    "address", a.toString(),
                    "name", s != null ? s.getName() : (f != null ? f.getName() : "unknown"),
                    "type", f != null ? "function" : "data"
                ));
            }
            return result;
        }));
    }

    public void handleStrings(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        int limit = ctx.intParam(params, "limit", 200);
        String filter = params.getOrDefault("filter", "");

        ctx.sendOk(ex, ctx.withRead(() -> {
            var result = new ArrayList<Map<String, String>>();
            var it = p.getListing().getDefinedData(true);
            while (it.hasNext() && result.size() < limit) {
                Data d = it.next();
                if (d.getDataType() instanceof StringDataType || d.getDataType() instanceof UnicodeDataType ||
                    d.getDataType().getName().toLowerCase().contains("string")) {
                    String val = d.getDefaultValueRepresentation();
                    if (val != null && (filter.isEmpty() || val.toLowerCase().contains(filter.toLowerCase()))) {
                        result.add(Map.of("address", d.getAddress().toString(), "value", val,
                                          "type", d.getDataType().getName()));
                    }
                }
            }
            return result;
        }));
    }

    public void handleSegments(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        ctx.sendOk(ex, ctx.withRead(() -> {
            var result = new ArrayList<Map<String, Object>>();
            for (MemoryBlock blk : p.getMemory().getBlocks()) {
                result.add(Map.of(
                    "name", blk.getName(), "start", blk.getStart().toString(),
                    "end", blk.getEnd().toString(), "size", blk.getSize(),
                    "read", blk.isRead(), "write", blk.isWrite(), "execute", blk.isExecute()
                ));
            }
            return result;
        }));
    }

    public void handleSymbols(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        int limit = ctx.intParam(params, "limit", 200);
        String filter = params.getOrDefault("filter", "");

        ctx.sendOk(ex, ctx.withRead(() -> {
            var result = new ArrayList<Map<String, String>>();
            var it = p.getSymbolTable().getAllSymbols(true);
            while (it.hasNext() && result.size() < limit) {
                Symbol s = it.next();
                if (!filter.isEmpty() && !s.getName().toLowerCase().contains(filter.toLowerCase())) continue;
                result.add(Map.of("name", s.getName(), "address", s.getAddress().toString(),
                                  "type", s.getSymbolType().toString(), "namespace", s.getParentNamespace().getName()));
            }
            return result;
        }));
    }

    public void handleMemory(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String addr = ctx.requireParam(params, "address");
        int length = Math.min(ctx.intParam(params, "length", 64), 4096);

        ctx.sendOk(ex, ctx.withRead(() -> {
            var a = ctx.toAddress(p, addr);
            byte[] bytes = new byte[length];
            int read = p.getMemory().getBytes(a, bytes);
            return Map.of("address", a.toString(), "length", read, "hex", ctx.bytesToHex(bytes, read));
        }));
    }
}

