import com.sun.net.httpserver.HttpExchange;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.SourceType;

import java.util.*;

public class ModifyHandler {

    private final ServerContext ctx;

    public ModifyHandler(ServerContext ctx) { this.ctx = ctx; }

    public void handleRenameFunction(HttpExchange ex) throws Exception {
        var req = ctx.parseRequest(ex);
        String addr = ctx.requireParam(req, "address");
        String newName = ctx.requireParam(req, "name");
        Program p = ctx.resolveProgram(req);

        ctx.sendOk(ex, ctx.withWrite(p, "Rename function", () -> {
            Function f = ctx.resolveFunction(p, addr);
            if (f == null) throw new IllegalArgumentException("No function at: " + addr);
            String old = f.getName();
            f.setName(newName, SourceType.USER_DEFINED);
            return Map.of("old_name", old, "new_name", newName, "address", f.getEntryPoint().toString());
        }));
    }

    public void handleRenameVariable(HttpExchange ex) throws Exception {
        var req = ctx.parseRequest(ex);
        String fAddr = ctx.requireParam(req, "function_address");
        String oldName = ctx.requireParam(req, "old_name");
        String newName = ctx.requireParam(req, "new_name");
        Program p = ctx.resolveProgram(req);

        ctx.sendOk(ex, ctx.withWrite(p, "Rename variable", () -> {
            Function f = ctx.resolveFunction(p, fAddr);
            if (f == null) throw new IllegalArgumentException("No function at: " + fAddr);
            for (var v : f.getAllVariables()) {
                if (v.getName().equals(oldName)) {
                    v.setName(newName, SourceType.USER_DEFINED);
                    return Map.of("old_name", oldName, "new_name", newName);
                }
            }
            throw new IllegalArgumentException("Variable not found: " + oldName);
        }));
    }

    public void handleRenameLabel(HttpExchange ex) throws Exception {
        var req = ctx.parseRequest(ex);
        String addr = ctx.requireParam(req, "address");
        String name = ctx.requireParam(req, "name");
        Program p = ctx.resolveProgram(req);

        ctx.sendOk(ex, ctx.withWrite(p, "Create/rename label", () -> {
            var a = ctx.toAddress(p, addr);
            p.getSymbolTable().createLabel(a, name, SourceType.USER_DEFINED);
            return Map.of("address", addr, "name", name);
        }));
    }

    public void handleComment(HttpExchange ex) throws Exception {
        var req = ctx.parseRequest(ex);
        String addr = ctx.requireParam(req, "address");
        String comment = ctx.requireParam(req, "comment");
        String type = req.getOrDefault("type", "plate").toString();
        Program p = ctx.resolveProgram(req);

        ctx.sendOk(ex, ctx.withWrite(p, "Set comment", () -> {
            var a = ctx.toAddress(p, addr);
            int ctype = switch (type) {
                case "eol" -> CodeUnit.EOL_COMMENT;
                case "pre" -> CodeUnit.PRE_COMMENT;
                case "post" -> CodeUnit.POST_COMMENT;
                default -> CodeUnit.PLATE_COMMENT;
            };
            p.getListing().setComment(a, ctype, comment);
            return Map.of("address", addr, "comment", comment, "type", type);
        }));
    }

    public void handlePrototype(HttpExchange ex) throws Exception {
        var req = ctx.parseRequest(ex);
        String addr = ctx.requireParam(req, "address");
        String proto = ctx.requireParam(req, "prototype");
        Program p = ctx.resolveProgram(req);

        ctx.sendOk(ex, ctx.withWrite(p, "Set prototype", () -> {
            Function f = ctx.resolveFunction(p, addr);
            if (f == null) throw new IllegalArgumentException("No function at: " + addr);
            var cmd = new ghidra.app.cmd.function.ApplyFunctionSignatureCmd(
                f.getEntryPoint(),
                new ghidra.app.util.parser.FunctionSignatureParser(
                    p.getDataTypeManager(), null).parse(f.getSignature(), proto),
                SourceType.USER_DEFINED
            );
            cmd.applyTo(p);
            return Map.of("address", addr, "prototype", f.getPrototypeString(true, false));
        }));
    }
}

