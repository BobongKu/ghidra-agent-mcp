
import com.sun.net.httpserver.HttpExchange;
import ghidra.program.model.listing.*;

import java.util.*;

public class CallGraphHandler {

    private final ServerContext ctx;

    public CallGraphHandler(ServerContext ctx) { this.ctx = ctx; }

    public void handleCallGraph(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String addr = ctx.requireParam(params, "address");
        int depth = ctx.intParam(params, "depth", 2);
        String direction = params.getOrDefault("direction", "both");
        String format = params.getOrDefault("format", "json");

        ctx.sendOk(ex, ctx.withRead(() -> {
            Function f = ctx.resolveFunction(p, addr);
            if (f == null) throw new IllegalArgumentException("No function found for: '" + addr + "'");
            var nodes = new LinkedHashMap<String, Map<String, String>>();
            var edges = new ArrayList<Map<String, String>>();
            buildCallGraph(p, f, depth, direction, nodes, edges, new HashSet<>());
            var data = Map.of("root", f.getName(), "nodes", new ArrayList<>(nodes.values()), "edges", edges);
            if ("mermaid".equalsIgnoreCase(format)) {
                return Map.of("root", f.getName(), "format", "mermaid",
                    "mermaid", toMermaid(nodes, edges, f.getName()));
            }
            return data;
        }));
    }

    private void buildCallGraph(Program p, Function f, int depth, String dir,
                                 Map<String, Map<String, String>> nodes, List<Map<String, String>> edges, Set<String> visited) {
        String key = f.getEntryPoint().toString();
        if (!visited.add(key) || depth < 0) return;
        nodes.put(key, Map.of("name", f.getName(), "address", key));
        if (depth == 0) return;

        if ("both".equals(dir) || "callees".equals(dir)) {
            for (var ref : ctx.getCallRefsFrom(p, f)) {
                Function callee = p.getFunctionManager().getFunctionAt(ref.getToAddress());
                if (callee != null) {
                    edges.add(Map.of("from", key, "to", callee.getEntryPoint().toString(), "type", "calls"));
                    buildCallGraph(p, callee, depth - 1, "callees", nodes, edges, visited);
                }
            }
        }
        if ("both".equals(dir) || "callers".equals(dir)) {
            for (var ref : p.getReferenceManager().getReferencesTo(f.getEntryPoint())) {
                if (!ref.getReferenceType().isCall()) continue;
                Function caller = p.getFunctionManager().getFunctionContaining(ref.getFromAddress());
                if (caller != null) {
                    edges.add(Map.of("from", caller.getEntryPoint().toString(), "to", key, "type", "calls"));
                    buildCallGraph(p, caller, depth - 1, "callers", nodes, edges, visited);
                }
            }
        }
    }

    public void handleCallGraphFull(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        int limit = ctx.intParam(params, "limit", 1000);
        String format = params.getOrDefault("format", "json");

        ctx.sendOk(ex, ctx.withRead(() -> {
            var edges = new ArrayList<Map<String, String>>();
            var funcIt = p.getFunctionManager().getFunctions(true);
            while (funcIt.hasNext() && edges.size() < limit) {
                Function f = funcIt.next();
                for (var ref : ctx.getCallRefsFrom(p, f)) {
                    Function callee = p.getFunctionManager().getFunctionAt(ref.getToAddress());
                    if (callee != null) {
                        edges.add(Map.of("from", f.getName(), "to", callee.getName()));
                        if (edges.size() >= limit) break;
                    }
                }
            }
            if ("mermaid".equalsIgnoreCase(format)) {
                return Map.of("format", "mermaid", "count", edges.size(),
                    "mermaid", toMermaidFromEdges(edges, null));
            }
            return Map.of("edges", edges, "count", edges.size());
        }));
    }

    public void handleCallGraphPath(HttpExchange ex) throws Exception {
        var req = ctx.parseRequest(ex);
        String startAddr = ctx.requireParam(req, "start");
        String endAddr = ctx.requireParam(req, "end");
        String format = String.valueOf(req.getOrDefault("format", "json"));
        Program p = ctx.resolveProgram(req);

        ctx.sendOk(ex, ctx.withRead(() -> {
            Function startFunc = ctx.resolveFunction(p, startAddr);
            Function endFunc = ctx.resolveFunction(p, endAddr);
            if (startFunc == null) throw new IllegalArgumentException("Start function not found: " + startAddr);
            if (endFunc == null) throw new IllegalArgumentException("End function not found: " + endAddr);

            var queue = new ArrayDeque<List<String>>();
            var visited = new HashSet<String>();
            String target = endFunc.getEntryPoint().toString();
            queue.add(List.of(startFunc.getEntryPoint().toString()));

            while (!queue.isEmpty()) {
                var path = queue.poll();
                String current = path.get(path.size() - 1);

                if (!visited.add(current)) continue;
                if (path.size() > 20) continue;

                Function f = p.getFunctionManager().getFunctionAt(
                    p.getAddressFactory().getDefaultAddressSpace().getAddress(current));
                if (f == null) continue;
                for (var ref : ctx.getCallRefsFrom(p, f)) {
                    Function callee = p.getFunctionManager().getFunctionAt(ref.getToAddress());
                    if (callee != null) {
                        String calleeAddr = callee.getEntryPoint().toString();
                        if (visited.contains(calleeAddr)) continue;
                        var newPath = new ArrayList<>(path);
                        newPath.add(calleeAddr);
                        if (calleeAddr.equals(target)) {
                            var named = new ArrayList<String>();
                            for (String a : newPath) {
                                Function nf = p.getFunctionManager().getFunctionAt(
                                    p.getAddressFactory().getDefaultAddressSpace().getAddress(a));
                                named.add(nf != null ? nf.getName() : a);
                            }
                            if ("mermaid".equalsIgnoreCase(format)) {
                                return Map.of("found", true, "length", named.size(),
                                    "path", named, "format", "mermaid",
                                    "mermaid", pathToMermaid(named));
                            }
                            return Map.of("path", named, "length", named.size(), "found", true);
                        }
                        queue.add(newPath);
                    }
                }
            }
            return Map.of("found", false, "message", "No path found between " + startFunc.getName() + " and " + endFunc.getName());
        }));
    }

    // ── MermaidJS rendering ──────────────────────────────────

    private String toMermaid(Map<String, Map<String, String>> nodes,
                             List<Map<String, String>> edges, String root) {
        var sb = new StringBuilder();
        sb.append("graph TD\n");
        var idMap = new LinkedHashMap<String, String>();
        int counter = 0;
        for (var entry : nodes.entrySet()) {
            String addr = entry.getKey();
            String name = entry.getValue().get("name");
            String id = "n" + counter++;
            idMap.put(addr, id);
            String label = sanitizeMermaid(name);
            if (addr.equals(root) || name.equals(root)) {
                sb.append("    ").append(id).append("([\"").append(label).append("\"])\n");
            } else {
                sb.append("    ").append(id).append("[\"").append(label).append("\"]\n");
            }
        }
        for (var edge : edges) {
            String fromId = idMap.get(edge.get("from"));
            String toId = idMap.get(edge.get("to"));
            if (fromId != null && toId != null) {
                sb.append("    ").append(fromId).append(" --> ").append(toId).append("\n");
            }
        }
        return sb.toString();
    }

    private String toMermaidFromEdges(List<Map<String, String>> edges, String root) {
        var sb = new StringBuilder();
        sb.append("graph TD\n");
        var nameToId = new LinkedHashMap<String, String>();
        int counter = 0;
        for (var edge : edges) {
            for (String key : List.of("from", "to")) {
                String name = edge.get(key);
                if (!nameToId.containsKey(name)) {
                    String id = "n" + counter++;
                    nameToId.put(name, id);
                }
            }
        }
        for (var entry : nameToId.entrySet()) {
            String name = entry.getKey();
            String id = entry.getValue();
            String label = sanitizeMermaid(name);
            if (name.equals(root)) {
                sb.append("    ").append(id).append("([\"").append(label).append("\"])\n");
            } else {
                sb.append("    ").append(id).append("[\"").append(label).append("\"]\n");
            }
        }
        for (var edge : edges) {
            String fromId = nameToId.get(edge.get("from"));
            String toId = nameToId.get(edge.get("to"));
            sb.append("    ").append(fromId).append(" --> ").append(toId).append("\n");
        }
        return sb.toString();
    }

    private String pathToMermaid(List<String> path) {
        var sb = new StringBuilder();
        sb.append("graph LR\n");
        for (int i = 0; i < path.size(); i++) {
            String id = "p" + i;
            String label = sanitizeMermaid(path.get(i));
            if (i == 0) {
                sb.append("    ").append(id).append("([\"").append(label).append("\"])\n");
            } else if (i == path.size() - 1) {
                sb.append("    ").append(id).append("((\"").append(label).append("\"))\n");
            } else {
                sb.append("    ").append(id).append("[\"").append(label).append("\"]\n");
            }
        }
        for (int i = 0; i < path.size() - 1; i++) {
            sb.append("    p").append(i).append(" --> p").append(i + 1).append("\n");
        }
        return sb.toString();
    }

    private static String sanitizeMermaid(String text) {
        return text.replace("\"", "#quot;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
