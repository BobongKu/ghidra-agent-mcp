import com.sun.net.httpserver.HttpExchange;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;

import java.io.File;
import java.util.*;

public class DependencyHandler {

    private final ServerContext ctx;

    public DependencyHandler(ServerContext ctx) { this.ctx = ctx; }

    public void handleDepsList(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);

        ctx.sendOk(ex, ctx.withRead(() -> {
            var result = new ArrayList<Map<String, Object>>();
            var extMgr = p.getExternalManager();
            for (String lib : extMgr.getExternalLibraryNames()) {
                var funcs = new ArrayList<String>();
                var it = extMgr.getExternalLocations(lib);
                while (it.hasNext()) funcs.add(it.next().getLabel());
                boolean loaded = ctx.findProgramByLibName(lib) != null;
                String resolvedVia = null;
                if (!loaded) {
                    String real = ctx.resolveApiSet(lib);
                    if (real != null && ctx.findProgramByLibName(real) != null) {
                        loaded = true;
                        resolvedVia = real;
                    }
                }
                var entry = new LinkedHashMap<String, Object>();
                entry.put("library", lib);
                entry.put("import_count", funcs.size());
                entry.put("functions", funcs);
                entry.put("loaded", loaded);
                if (resolvedVia != null) entry.put("resolved_via", resolvedVia);
                result.add(entry);
            }
            return result;
        }));
    }

    public void handleDepsTree(HttpExchange ex) throws Exception {
        var body = ctx.parseRequest(ex);
        Program p = ctx.resolveProgram(body);
        boolean summary = "true".equalsIgnoreCase(String.valueOf(body.getOrDefault("summary", "false")));
        ctx.sendOk(ex, ctx.withRead(() -> buildDependencyTree(p, new HashSet<>(), summary)));
    }

    private Map<String, Object> buildDependencyTree(Program prog, Set<String> visited, boolean summary) {
        String name = prog.getName();
        String key = name.toLowerCase();

        if (visited.contains(key)) {
            return Map.of("name", name, "already_visited", true);
        }
        visited.add(key);

        var children = new ArrayList<Map<String, Object>>();
        var unresolved = new ArrayList<String>();
        int importFuncCount = 0;

        for (String lib : prog.getExternalManager().getExternalLibraryNames()) {
            var it = prog.getExternalManager().getExternalLocations(lib);
            int libFuncCount = 0;
            while (it.hasNext()) { it.next(); libFuncCount++; }
            importFuncCount += libFuncCount;

            Program dep = ctx.findProgramByLibName(lib);
            if (dep == null) {
                String real = ctx.resolveApiSet(lib);
                if (real != null) dep = ctx.findProgramByLibName(real);
            }

            if (dep != null) {
                children.add(buildDependencyTree(dep, visited, summary));
            } else {
                unresolved.add(summary ? lib + " (" + libFuncCount + " imports)" : lib);
            }
        }

        var result = new LinkedHashMap<String, Object>();
        result.put("name", name);
        result.put("format", prog.getExecutableFormat());
        result.put("children", children);
        if (!summary) {
            result.put("unresolved", unresolved);
        } else {
            result.put("unresolved_count", unresolved.size());
            if (!unresolved.isEmpty()) result.put("unresolved", unresolved);
        }
        result.put("total_import_functions", importFuncCount);
        result.put("total_import_libraries", prog.getExternalManager().getExternalLibraryNames().length);
        return result;
    }

    public void handleDepsAutoLoad(HttpExchange ex) throws Exception {
        var body = ctx.parseBody(ex);
        String dir = body.getOrDefault("directory", ctx.binariesDir).toString();
        Program p = ctx.resolveProgram(body);

        var loaded = new ArrayList<String>();
        var stillUnresolved = new ArrayList<String>();
        var queue = new ArrayDeque<Program>();
        queue.add(p);
        var processed = new HashSet<String>();

        while (!queue.isEmpty()) {
            Program current = queue.poll();
            if (!processed.add(current.getName().toLowerCase())) continue;

            for (String lib : current.getExternalManager().getExternalLibraryNames()) {
                if (ctx.findProgramByLibName(lib) != null) continue;
                String realLib = ctx.resolveApiSet(lib);
                if (realLib != null && ctx.findProgramByLibName(realLib) != null) continue;
                String searchName = realLib != null ? realLib + ".dll" : lib;
                File found = ctx.findBinaryFile(dir, searchName);
                if (found == null) found = ctx.findBinaryFile(dir, lib);
                if (found != null && ctx.programs.size() < ctx.maxPrograms) {
                    try {
                        Program newProg = ctx.importAndAnalyze(found);
                        loaded.add(newProg.getName());
                        queue.add(newProg);
                    } catch (Exception e) {
                        stillUnresolved.add(lib + " (error: " + e.getMessage() + ")");
                    }
                } else {
                    stillUnresolved.add(lib);
                }
            }
        }

        ctx.sendOk(ex, Map.of("loaded", loaded, "still_unresolved", stillUnresolved, "total_programs", ctx.programs.size()));
    }

    public void handleDepsMatch(HttpExchange ex) throws Exception {
        var body = ctx.parseBody(ex);
        String nameA = ctx.requireParam(body, "program_a");
        String nameB = ctx.requireParam(body, "program_b");
        Program a = ctx.resolveProgram(Map.of("program", nameA));
        Program b = ctx.resolveProgram(Map.of("program", nameB));

        ctx.sendOk(ex, ctx.withRead(() -> matchImportsExports(a, b)));
    }
    private Map<String, Object> matchImportsExports(Program importer, Program exporter) {
        HashMap<String, String> exportMap = new HashMap<String, String>();
        AddressIterator entryIt = exporter.getSymbolTable().getExternalEntryPointIterator();
        while (entryIt.hasNext()) {
            Address a = entryIt.next();
            Symbol s = exporter.getSymbolTable().getPrimarySymbol(a);
            if (s == null) continue;
            exportMap.putIfAbsent(s.getName().toLowerCase(), a.toString());
        }
        FunctionIterator funcIt = exporter.getFunctionManager().getFunctions(true);
        while (funcIt.hasNext()) {
            Function f = (Function)funcIt.next();
            if (f.isExternal()) continue;
            exportMap.putIfAbsent(f.getName().toLowerCase(), f.getEntryPoint().toString());
        }
        ArrayList<Map<String, String>> matched = new ArrayList<Map<String, String>>();
        ArrayList<String> unmatched = new ArrayList<String>();
        String exporterBase = exporter.getName().toLowerCase().replaceAll("\\.(dll|so|exe|dylib|drv)[.\\d]*$", "");
        for (String lib : importer.getExternalManager().getExternalLibraryNames()) {
            String real;
            boolean matches;
            String libBase = lib.toLowerCase().replaceAll("\\.(dll|so|exe|dylib|drv)[.\\d]*$", "");
            boolean bl = matches = libBase.equals(exporterBase) || lib.equalsIgnoreCase(exporter.getName());
            if (!matches && (real = this.ctx.resolveApiSet(lib)) != null) {
                matches = real.equalsIgnoreCase(exporterBase);
            }
            if (!matches) continue;
            ExternalLocationIterator it = importer.getExternalManager().getExternalLocations(lib);
            while (it.hasNext()) {
                ExternalLocation loc = it.next();
                String addr = (String)exportMap.get(loc.getLabel().toLowerCase());
                if (addr != null) {
                    matched.add(Map.of("import_name", loc.getLabel(), "export_address", addr));
                    continue;
                }
                unmatched.add(loc.getLabel());
            }
        }
        return Map.of("matched", matched, "matched_count", matched.size(), "unmatched_imports", unmatched, "unmatched_count", unmatched.size(), "total_exports", exportMap.size());
    }

    public void handleDepsTrace(HttpExchange ex) throws Exception {
        Map<String, Object> req = this.ctx.parseRequest(ex);
        String funcName = this.ctx.requireParam(req, "function");
        String libName = req.getOrDefault("library", "").toString();
        Program p = this.ctx.resolveProgram(req);
        this.ctx.sendOk(ex, this.ctx.withRead(() -> {
            ArrayList<Map<String, String>> chain = new ArrayList<Map<String, String>>();
            chain.add(Map.of("program", p.getName(), "function", funcName, "type", "import"));
            String targetLib = libName;
            if (targetLib.isEmpty()) {
                block0: for (String lib : p.getExternalManager().getExternalLibraryNames()) {
                    ExternalLocationIterator it = p.getExternalManager().getExternalLocations(lib);
                    while (it.hasNext()) {
                        if (!it.next().getLabel().equalsIgnoreCase(funcName)) continue;
                        targetLib = lib;
                        break block0;
                    }
                }
            }
            String currentFunc = funcName;
            String currentLib = targetLib;
            HashSet<String> visited = new HashSet<String>();
            while (!currentLib.isEmpty() && visited.add(currentLib.toLowerCase() + "!" + currentFunc.toLowerCase())) {
                Function thunked;
                String real;
                Program dep = this.ctx.findProgramByLibName(currentLib);
                if (dep == null && (real = this.ctx.resolveApiSet(currentLib)) != null) {
                    dep = this.ctx.findProgramByLibName(real);
                }
                if (dep == null) {
                    chain.add(Map.of("library", currentLib, "function", currentFunc, "type", "unresolved"));
                    break;
                }
                Function f = this.ctx.findFunctionByName(dep, currentFunc);
                if (f != null && f.isThunk() && (thunked = f.getThunkedFunction(true)) != null && thunked.isExternal()) {
                    chain.add(Map.of("program", dep.getName(), "function", currentFunc, "type", "forwarded"));
                    ExternalLocation extLoc = thunked.getExternalLocation();
                    if (extLoc != null) {
                        currentLib = extLoc.getLibraryName();
                        currentFunc = extLoc.getLabel();
                        continue;
                    }
                }
                chain.add(Map.of("program", dep.getName(), "function", currentFunc, "type", f != null ? "implemented" : "symbol_only", "address", f != null ? f.getEntryPoint().toString() : "unknown"));
                break;
            }
            return Map.of("chain", chain, "length", chain.size());
        }));
    }

    public void handleDepsCrossXref(HttpExchange ex) throws Exception {
        Map<String, Object> req = this.ctx.parseRequest(ex);
        String funcName = this.ctx.requireParam(req, "function");
        String exporterName = req.getOrDefault("exporter", "").toString();
        this.ctx.sendOk(ex, this.ctx.withRead(() -> {
            ArrayList<Map<String, Object>> importedBy = new ArrayList<Map<String, Object>>();
            for (Map.Entry<String, Program> entry : this.ctx.programs.entrySet()) {
                Program p = entry.getValue();
                if (p.getName().equalsIgnoreCase(exporterName)) continue;
                for (String lib : p.getExternalManager().getExternalLibraryNames()) {
                    ExternalLocationIterator it = p.getExternalManager().getExternalLocations(lib);
                    while (it.hasNext()) {
                        Function thunk;
                        ExternalLocation loc = it.next();
                        if (!loc.getLabel().equalsIgnoreCase(funcName)) continue;
                        LinkedHashSet<String> callSites = new LinkedHashSet<String>();
                        Address extAddr = loc.getAddress();
                        if (extAddr != null) {
                            for (Reference ref : p.getReferenceManager().getReferencesTo(extAddr)) {
                                if (!ref.getReferenceType().isCall()) continue;
                                callSites.add(ref.getFromAddress().toString());
                            }
                        }
                        if ((thunk = loc.getFunction()) != null) {
                            for (Reference ref : p.getReferenceManager().getReferencesTo(thunk.getEntryPoint())) {
                                if (!ref.getReferenceType().isCall()) continue;
                                callSites.add(ref.getFromAddress().toString());
                            }
                        }
                        importedBy.add(Map.of("program", p.getName(), "library", lib, "call_sites", new ArrayList(callSites), "call_count", callSites.size()));
                    }
                }
            }
            return Map.of("function", funcName, "imported_by", importedBy, "importer_count", importedBy.size());
        }));
    }

    public void handleDepsGraph(HttpExchange ex) throws Exception {
        Map<String, String> params = this.ctx.parseQuery(ex);
        String format = params.getOrDefault("format", "json");
        this.ctx.sendOk(ex, this.ctx.withRead(() -> {
            ArrayList<Map<String, Object>> nodes = new ArrayList<Map<String, Object>>();
            ArrayList<Map<String, Object>> edges = new ArrayList<Map<String, Object>>();
            for (Map.Entry<String, Program> entry : this.ctx.programs.entrySet()) {
                Program program = entry.getValue();
                nodes.add(Map.of("name", program.getName(), "format", program.getExecutableFormat(), "functions", program.getFunctionManager().getFunctionCount()));
                for (String lib : program.getExternalManager().getExternalLibraryNames()) {
                    String real;
                    boolean resolved;
                    int count = 0;
                    ExternalLocationIterator it = program.getExternalManager().getExternalLocations(lib);
                    while (it.hasNext()) {
                        it.next();
                        ++count;
                    }
                    boolean bl = resolved = this.ctx.findProgramByLibName(lib) != null;
                    if (!resolved && (real = this.ctx.resolveApiSet(lib)) != null) {
                        resolved = this.ctx.findProgramByLibName(real) != null;
                    }
                    edges.add(Map.of("from", program.getName(), "to", lib, "import_count", count, "resolved", resolved));
                }
            }
            if ("dot".equalsIgnoreCase(format)) {
                StringBuilder sb = new StringBuilder("digraph deps {\n  rankdir=LR;\n");
                for (Map map : edges) {
                    sb.append("  \"").append(map.get("from")).append("\" -> \"").append(map.get("to")).append("\" [label=\"").append(map.get("import_count")).append("\"];\n");
                }
                sb.append("}\n");
                return Map.of("format", "dot", "graph", sb.toString());
            }
            return Map.of("format", "json", "nodes", nodes, "edges", edges);
        }));
    }

    public void handleDepsUnresolved(HttpExchange ex) throws Exception {
        this.ctx.sendOk(ex, this.ctx.withRead(() -> {
            ArrayList<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
            for (Map.Entry<String, Program> entry : this.ctx.programs.entrySet()) {
                Program p = entry.getValue();
                ArrayList<Map<String, Object>> unresolved = new ArrayList<Map<String, Object>>();
                int totalImports = 0;
                for (String lib : p.getExternalManager().getExternalLibraryNames()) {
                    String real;
                    boolean loaded;
                    ArrayList<String> funcs = new ArrayList<String>();
                    ExternalLocationIterator it = p.getExternalManager().getExternalLocations(lib);
                    while (it.hasNext()) {
                        funcs.add(it.next().getLabel());
                    }
                    totalImports += funcs.size();
                    boolean bl = loaded = this.ctx.findProgramByLibName(lib) != null;
                    if (!loaded && (real = this.ctx.resolveApiSet(lib)) != null) {
                        boolean bl2 = loaded = this.ctx.findProgramByLibName(real) != null;
                    }
                    if (loaded) continue;
                    unresolved.add(Map.of("library", lib, "functions", funcs, "count", funcs.size()));
                }
                if (unresolved.isEmpty()) continue;
                result.add(Map.of("program", p.getName(), "unresolved", unresolved, "unresolved_count", unresolved.size(), "total_imports", totalImports));
            }
            return result;
        }));
    }

    public void handleDepsSummary(HttpExchange ex) throws Exception {
        Map<String, String> params = this.ctx.parseQuery(ex);
        Program p = this.ctx.resolveProgram(params);
        this.ctx.sendOk(ex, this.ctx.withRead(() -> {
            int totalLibs = p.getExternalManager().getExternalLibraryNames().length;
            int resolvedLibs = 0;
            int unresolvedLibs = 0;
            ArrayList<Map<String, Object>> perLibrary = new ArrayList<Map<String, Object>>();
            HashMap<String, Set> exportCaches = new HashMap<String, Set>();
            int totalFuncs = 0;
            int matchedFuncs = 0;
            for (String lib : p.getExternalManager().getExternalLibraryNames()) {
                String real;
                ArrayList<String> importNames = new ArrayList<String>();
                ExternalLocationIterator it = p.getExternalManager().getExternalLocations(lib);
                while (it.hasNext()) {
                    importNames.add(it.next().getLabel());
                }
                int libFuncCount = importNames.size();
                totalFuncs += libFuncCount;
                Program dep = this.ctx.findProgramByLibName(lib);
                String resolvedVia = null;
                if (dep == null && (real = this.ctx.resolveApiSet(lib)) != null && (dep = this.ctx.findProgramByLibName(real)) != null) {
                    resolvedVia = real;
                }
                if (dep != null) {
                    ++resolvedLibs;
                    Program depFinal = dep;
                    Set exports = exportCaches.computeIfAbsent(depFinal.getName(), k -> {
                        HashSet<String> set = new HashSet<String>();
                        AddressIterator entryIt = depFinal.getSymbolTable().getExternalEntryPointIterator();
                        while (entryIt.hasNext()) {
                            Symbol s = depFinal.getSymbolTable().getPrimarySymbol(entryIt.next());
                            if (s == null) continue;
                            set.add(s.getName().toLowerCase());
                        }
                        FunctionIterator funcIt2 = depFinal.getFunctionManager().getFunctions(true);
                        while (funcIt2.hasNext()) {
                            Function f2 = (Function)funcIt2.next();
                            if (f2.isExternal()) continue;
                            set.add(f2.getName().toLowerCase());
                        }
                        return set;
                    });
                    int matched = 0;
                    int unmatched = 0;
                    for (String imp : importNames) {
                        if (exports.contains(imp.toLowerCase())) {
                            ++matched;
                            continue;
                        }
                        ++unmatched;
                    }
                    matchedFuncs += matched;
                    LinkedHashMap<String, Object> libEntry = new LinkedHashMap<String, Object>();
                    libEntry.put("library", lib);
                    libEntry.put("resolved", true);
                    if (resolvedVia != null) {
                        libEntry.put("resolved_via", resolvedVia);
                    }
                    libEntry.put("imports", libFuncCount);
                    libEntry.put("matched", matched);
                    libEntry.put("unmatched", unmatched);
                    perLibrary.add(libEntry);
                    continue;
                }
                ++unresolvedLibs;
                perLibrary.add(Map.of("library", lib, "resolved", false, "imports", libFuncCount));
            }
            return Map.of("program", p.getName(), "libraries_total", totalLibs, "libraries_resolved", resolvedLibs, "libraries_unresolved", unresolvedLibs, "functions_imported", totalFuncs, "functions_matched", matchedFuncs, "match_rate", totalFuncs > 0 ? String.format("%.1f%%", (double)matchedFuncs * 100.0 / (double)totalFuncs) : "N/A", "per_library", perLibrary);
        }));
    }
}
