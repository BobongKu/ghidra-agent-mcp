import com.sun.net.httpserver.HttpExchange;
import ghidra.program.model.data.*;
import ghidra.program.model.listing.Program;

import java.util.*;

public class DataTypeHandler {

    private final ServerContext ctx;

    public DataTypeHandler(ServerContext ctx) { this.ctx = ctx; }

    public void handleTypes(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String filter = params.getOrDefault("filter", "");
        int limit = ctx.intParam(params, "limit", 200);

        ctx.sendOk(ex, ctx.withRead(() -> {
            var result = new ArrayList<Map<String, Object>>();
            var it = p.getDataTypeManager().getAllDataTypes();
            while (it.hasNext() && result.size() < limit) {
                DataType dt = it.next();
                if (!filter.isEmpty() && !dt.getName().toLowerCase().contains(filter.toLowerCase())) continue;
                result.add(Map.of("name", dt.getName(), "category", dt.getCategoryPath().toString(),
                                  "size", dt.getLength(), "type", dt.getClass().getSimpleName()));
            }
            return result;
        }));
    }

    public void handleStruct(HttpExchange ex) throws Exception {
        var params = ctx.parseQuery(ex);
        Program p = ctx.resolveProgram(params);
        String name = ctx.requireParam(params, "name");

        ctx.sendOk(ex, ctx.withRead(() -> {
            var dtm = p.getDataTypeManager();
            DataType dt = dtm.getDataType("/" + name);
            if (dt == null) {
                var it = dtm.getAllStructures();
                while (it.hasNext()) {
                    Structure s = (Structure) it.next();
                    if (s.getName().equalsIgnoreCase(name)) { dt = s; break; }
                }
            }
            if (!(dt instanceof Structure s)) throw new IllegalArgumentException("Struct not found: " + name);

            var fields = new ArrayList<Map<String, Object>>();
            for (var comp : s.getComponents()) {
                fields.add(Map.of("offset", comp.getOffset(),
                    "name", comp.getFieldName() != null ? comp.getFieldName() : "",
                    "type", comp.getDataType().getName(), "size", comp.getLength(),
                    "comment", comp.getComment() != null ? comp.getComment() : ""));
            }
            return Map.of("name", s.getName(), "size", s.getLength(), "fields", fields);
        }));
    }

    public void handleStructCreate(HttpExchange ex) throws Exception {
        var req = ctx.parseRequest(ex);
        String name = ctx.requireParam(req, "name");
        int size = ctx.intParam(req, "size", 0);
        Program p = ctx.resolveProgram(req);

        ctx.sendOk(ex, ctx.withWrite(p, "Create struct", () -> {
            var struct = new StructureDataType(name, size);
            p.getDataTypeManager().addDataType(struct, DataTypeConflictHandler.DEFAULT_HANDLER);
            return Map.of("name", name, "size", size);
        }));
    }

    public void handleTypeApply(HttpExchange ex) throws Exception {
        var req = ctx.parseRequest(ex);
        String addr = ctx.requireParam(req, "address");
        String typeName = ctx.requireParam(req, "type");
        Program p = ctx.resolveProgram(req);

        ctx.sendOk(ex, ctx.withWrite(p, "Apply type", () -> {
            var a = ctx.toAddress(p, addr);
            var dtm = p.getDataTypeManager();
            DataType dt = dtm.getDataType("/" + typeName);
            if (dt == null) {
                var it = dtm.getAllDataTypes();
                while (it.hasNext()) {
                    DataType candidate = it.next();
                    if (candidate.getName().equalsIgnoreCase(typeName)) { dt = candidate; break; }
                }
            }
            if (dt == null) throw new IllegalArgumentException("Type not found: " + typeName);
            p.getListing().createData(a, dt);
            return Map.of("address", addr, "type", dt.getName(), "size", dt.getLength());
        }));
    }
}

