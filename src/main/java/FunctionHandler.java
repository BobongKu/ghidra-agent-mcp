import com.sun.net.httpserver.HttpExchange;
import ghidra.app.decompiler.DecompInterface;
import ghidra.program.model.listing.*;
import ghidra.util.task.TaskMonitor;

import java.util.*;

public class FunctionHandler {

    private final ServerContext ctx;

    public FunctionHandler(ServerContext ctx) { this.ctx = ctx; }

    public void handleFunctions(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        int offset = ctx.intParam(params, "offset", 0);
        int limit = ctx.intParam(params, "limit", 100);
        String filter = params.getOrDefault("filter", "");

        var list = ctx.withRead(() -> {
            var result = new ArrayList<Map<String, Object>>();
            var it = p.getFunctionManager().getFunctions(true);
            int matched = 0;
            while (it.hasNext() && result.size() < limit) {
                Function f = it.next();
                if (!filter.isEmpty() && !f.getName().toLowerCase().contains(filter.toLowerCase())) continue;
                if (matched++ < offset) continue;
                result.add(Map.of(
                    "name", f.getName(), "address", f.getEntryPoint().toString(),
                    "size", f.getBody().getNumAddresses(), "is_thunk", f.isThunk()
                ));
            }
            return result;
        });
        ctx.sendOk(ex, list);
    }

    public void handleFunction(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String addr = ctx.requireParam(params, "address");
        ctx.sendOk(ex, ctx.withRead(() -> {
            Function f = ctx.resolveFunction(p, addr);
            if (f == null) throw new IllegalArgumentException("No function found for: '" + addr + "'");
            return Map.of(
                "name", f.getName(), "address", f.getEntryPoint().toString(),
                "signature", f.getPrototypeString(true, false),
                "size", f.getBody().getNumAddresses(), "is_thunk", f.isThunk(),
                "calling_convention", f.getCallingConventionName()
            );
        }));
    }

    public void handleDecompile(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String addr = ctx.requireParam(params, "address");

        ctx.sendOk(ex, ctx.withRead(() -> {
            Function f = ctx.resolveFunction(p, addr);
            if (f == null) throw new IllegalArgumentException("No function found for: '" + addr + "'");
            // Note: openProgram() is moved INSIDE the try so dispose() always runs,
            // even if openProgram throws or decompileFunction itself fails.
            DecompInterface decomp = new DecompInterface();
            try {
                decomp.openProgram(p);
                var res = decomp.decompileFunction(f, 60, TaskMonitor.DUMMY);
                String code = (res != null && res.getDecompiledFunction() != null) ?
                    res.getDecompiledFunction().getC() : "Decompilation failed";
                return Map.of("function", f.getName(), "address", f.getEntryPoint().toString(), "decompiled", code);
            } finally {
                try { decomp.dispose(); } catch (Throwable ignored) {}
            }
        }));
    }

    public void handleDisassemble(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String addr = ctx.requireParam(params, "address");
        int count = ctx.intParam(params, "count", 50);

        ctx.sendOk(ex, ctx.withRead(() -> {
            var start = ctx.toAddress(p, addr);
            var lines = new ArrayList<Map<String, String>>();
            var it = p.getListing().getInstructions(start, true);
            int n = 0;
            while (it.hasNext() && n++ < count) {
                var instr = it.next();
                lines.add(Map.of(
                    "address", instr.getAddress().toString(),
                    "mnemonic", instr.getMnemonicString(),
                    "operands", instr.toString().substring(instr.getMnemonicString().length()).trim(),
                    "bytes", ctx.bytesToHex(instr.getBytes())
                ));
            }
            return lines;
        }));
    }

    public void handleCallers(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String addr = ctx.requireParam(params, "address");
        ctx.sendOk(ex, ctx.withRead(() -> {
            Function f = ctx.resolveFunction(p, addr);
            if (f == null) throw new IllegalArgumentException("No function found for: '" + addr + "'");
            var result = new ArrayList<Map<String, String>>();
            for (var ref : p.getReferenceManager().getReferencesTo(f.getEntryPoint())) {
                if (!ref.getReferenceType().isCall()) continue;
                Function caller = p.getFunctionManager().getFunctionContaining(ref.getFromAddress());
                if (caller == null) continue;
                result.add(Map.of(
                    "name", caller.getName(),
                    "address", caller.getEntryPoint().toString(),
                    "call_site", ref.getFromAddress().toString()
                ));
            }
            return result;
        }));
    }

    public void handleCallees(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String addr = ctx.requireParam(params, "address");
        ctx.sendOk(ex, ctx.withRead(() -> {
            Function f = ctx.resolveFunction(p, addr);
            if (f == null) throw new IllegalArgumentException("No function found for: '" + addr + "'");
            var result = new ArrayList<Map<String, String>>();
            for (var ref : ctx.getCallRefsFrom(p, f)) {
                Function callee = p.getFunctionManager().getFunctionAt(ref.getToAddress());
                if (callee == null) continue;
                result.add(Map.of(
                    "name", callee.getName(),
                    "address", callee.getEntryPoint().toString(),
                    "call_site", ref.getFromAddress().toString()
                ));
            }
            return result;
        }));
    }

    public void handleFunctionXrefs(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String addr = ctx.requireParam(params, "address");
        ctx.sendOk(ex, ctx.withRead(() -> {
            var a = ctx.toAddress(p, addr);
            var result = new ArrayList<Map<String, String>>();
            for (var ref : p.getReferenceManager().getReferencesTo(a)) {
                Function from = p.getFunctionManager().getFunctionContaining(ref.getFromAddress());
                result.add(Map.of(
                    "from_address", ref.getFromAddress().toString(),
                    "from_function", from != null ? from.getName() : "unknown",
                    "type", ref.getReferenceType().getName()
                ));
            }
            return result;
        }));
    }

    public void handleFunctionVariables(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String addr = ctx.requireParam(params, "address");
        ctx.sendOk(ex, ctx.withRead(() -> {
            Function f = ctx.resolveFunction(p, addr);
            if (f == null) throw new IllegalArgumentException("No function found for: '" + addr + "'");
            var result = new ArrayList<Map<String, String>>();
            for (var parameter : f.getParameters()) {
                result.add(Map.of(
                    "name", parameter.getName(),
                    "type", parameter.getDataType().getName(),
                    "storage", parameter.getVariableStorage().toString(),
                    "kind", "parameter"
                ));
            }
            for (var local : f.getLocalVariables()) {
                result.add(Map.of(
                    "name", local.getName(),
                    "type", local.getDataType().getName(),
                    "storage", local.getVariableStorage().toString(),
                    "kind", "local"
                ));
            }
            return result;
        }));
    }
}
