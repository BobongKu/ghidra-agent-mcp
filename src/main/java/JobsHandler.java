import com.sun.net.httpserver.HttpExchange;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class JobsHandler {

    private final ServerContext ctx;

    public JobsHandler(ServerContext ctx) { this.ctx = ctx; }

    /** GET /jobs ?limit=50 — list recent jobs newest-first. */
    public void handleList(HttpExchange ex) throws Exception {
        var query = ctx.parseQuery(ex);
        int limit = parseIntDef(query.get("limit"), 50);
        var jobs = ctx.jobManager.listRecent(Math.max(1, Math.min(limit, 200)));
        var data = new ArrayList<Map<String, Object>>(jobs.size());
        for (Job j : jobs) data.add(j.toMap());
        ctx.sendOk(ex, data);
    }

    /**
     * GET /jobs/{id} ?wait=N — fetch a specific job's state.
     * Optional {@code wait=N} blocks up to N seconds for the job to reach a
     * terminal state, so polling clients can request a long-poll instead of
     * a tight loop.
     */
    public void handleGet(HttpExchange ex) throws Exception {
        String path = ex.getRequestURI().getPath();
        String id = path.substring("/jobs/".length()).replaceAll("/+$", "");
        if (id.isBlank()) {
            ctx.sendError(ex, 400, "missing job id in /jobs/{id}");
            return;
        }
        Job job = ctx.jobManager.get(id);
        if (job == null) {
            ctx.sendError(ex, 404, "job not found: " + id);
            return;
        }
        var query = ctx.parseQuery(ex);
        long waitSec = parseLongDef(query.get("wait"), 0L);
        if (waitSec > 0 && !job.isTerminal()) {
            try { job.awaitDone(Math.min(waitSec, 1800) * 1000L); }
            catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
        ctx.sendOk(ex, job.toMap());
    }

    private static int parseIntDef(String s, int def) {
        if (s == null) return def;
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return def; }
    }

    private static long parseLongDef(String s, long def) {
        if (s == null) return def;
        if ("false".equalsIgnoreCase(s)) return 0;
        if ("true".equalsIgnoreCase(s)) return 1800;
        try { return Long.parseLong(s); } catch (NumberFormatException e) { return def; }
    }

    /** Helper: parse the {@code wait} query param shared by /upload, /import, /jobs/{id}. */
    public static long parseWaitParam(Map<String, String> query, long def) {
        return parseLongDef(query.get("wait"), def);
    }

    /** Used by callers that want a stable bounded value. */
    public static long boundedWait(long requested, long max) {
        return Math.max(0, Math.min(requested, max));
    }

    @SuppressWarnings("unused")
    private static List<String> nothing() { return List.of(); } // placate compiler order
}
