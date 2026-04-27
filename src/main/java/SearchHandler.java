import com.sun.net.httpserver.HttpExchange;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Program;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolType;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Cross-program lookup. Used by the LLM bridge ({@code find_function} tool)
 * and the GUI Search page to answer "where is X?" without iterating each
 * program one-by-one.
 *
 * <p>Endpoint: {@code GET /search?q=<query>&type=<function|symbol|string>&limit=N&case=true}.
 */
public class SearchHandler {

    private final ServerContext ctx;

    public SearchHandler(ServerContext ctx) { this.ctx = ctx; }

    public void handleSearch(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        String q = ctx.requireParam(params, "q");
        String type = params.getOrDefault("type", "function").toLowerCase();
        int limit = Math.min(Math.max(1, ctx.intParam(params, "limit", 100)), 1000);
        boolean caseSensitive = "true".equalsIgnoreCase(params.getOrDefault("case", "false"));

        ctx.sendOk(ex, ctx.withRead(() -> {
            var results = new ArrayList<Map<String, Object>>();
            String needle = caseSensitive ? q : q.toLowerCase();
            // Snapshot the program map so concurrent imports don't trigger CME.
            for (var entry : new ArrayList<>(ctx.programs.entrySet())) {
                if (results.size() >= limit) break;
                Program p = entry.getValue();
                int remaining = limit - results.size();
                switch (type) {
                    case "function": searchFunctions(p, needle, caseSensitive, results, remaining); break;
                    case "symbol":   searchSymbols(p, needle, caseSensitive, results, remaining); break;
                    case "string":   searchStrings(p, needle, caseSensitive, results, remaining); break;
                    default:
                        throw new IllegalArgumentException("type must be one of: function, symbol, string");
                }
            }
            var resp = new LinkedHashMap<String, Object>();
            resp.put("query", q);
            resp.put("type", type);
            resp.put("case_sensitive", caseSensitive);
            resp.put("count", results.size());
            resp.put("limit", limit);
            resp.put("has_more", results.size() >= limit);
            resp.put("results", results);
            return resp;
        }));
    }

    private static boolean match(String hay, String needle, boolean caseSensitive) {
        if (caseSensitive) return hay.contains(needle);
        return hay.toLowerCase().contains(needle);
    }

    private void searchFunctions(Program p, String needle, boolean cs,
                                 List<Map<String, Object>> out, int max) {
        // Internal functions
        var it = p.getFunctionManager().getFunctions(true);
        while (it.hasNext() && out.size() < max) {
            Function f = it.next();
            if (match(f.getName(), needle, cs)) {
                var entry = new LinkedHashMap<String, Object>();
                entry.put("program", p.getName());
                entry.put("kind", "function");
                entry.put("name", f.getName());
                entry.put("address", f.getEntryPoint().toString());
                out.add(entry);
            }
        }
        // External (imported) functions — these are what most "WriteFile" lookups hit
        var extIt = p.getFunctionManager().getExternalFunctions();
        while (extIt.hasNext() && out.size() < max) {
            Function f = extIt.next();
            if (match(f.getName(), needle, cs)) {
                var entry = new LinkedHashMap<String, Object>();
                entry.put("program", p.getName());
                entry.put("kind", "function-external");
                entry.put("name", f.getName());
                String lib = "";
                try {
                    if (f.getExternalLocation() != null
                        && f.getExternalLocation().getLibraryName() != null) {
                        lib = f.getExternalLocation().getLibraryName();
                    }
                } catch (Exception ignored) {}
                entry.put("library", lib);
                out.add(entry);
            }
        }
    }

    private void searchSymbols(Program p, String needle, boolean cs,
                               List<Map<String, Object>> out, int max) {
        var it = p.getSymbolTable().getAllSymbols(true);
        while (it.hasNext() && out.size() < max) {
            Symbol s = it.next();
            String name = s.getName();
            if (!match(name, needle, cs)) continue;
            var entry = new LinkedHashMap<String, Object>();
            entry.put("program", p.getName());
            entry.put("kind", "symbol");
            entry.put("name", name);
            entry.put("type", s.getSymbolType() == SymbolType.LABEL ? "label" : s.getSymbolType().toString());
            entry.put("address", s.getAddress().toString());
            entry.put("namespace", s.getParentNamespace().getName(true));
            out.add(entry);
        }
    }

    private void searchStrings(Program p, String needle, boolean cs,
                               List<Map<String, Object>> out, int max) {
        var listing = p.getListing();
        var dataIt = listing.getDefinedData(true);
        while (dataIt.hasNext() && out.size() < max) {
            var data = dataIt.next();
            if (data == null) continue;
            String value;
            try {
                StringDataInstance sdi = StringDataInstance.getStringDataInstance(data);
                if (sdi == null || sdi == StringDataInstance.NULL_INSTANCE) continue;
                value = sdi.getStringValue();
            } catch (Exception e) { continue; }
            if (value == null || value.isEmpty()) continue;
            if (!match(value, needle, cs)) continue;
            Address a = data.getAddress();
            var entry = new LinkedHashMap<String, Object>();
            entry.put("program", p.getName());
            entry.put("kind", "string");
            entry.put("address", a != null ? a.toString() : "");
            entry.put("value", value);
            out.add(entry);
        }
    }
}
