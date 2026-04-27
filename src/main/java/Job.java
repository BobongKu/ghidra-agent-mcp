import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * A long-running unit of work tracked by JobManager (currently: import/analyze).
 *
 * The Job exposes a wait/notify mechanism via {@link #awaitDone(long)} so that
 * an HTTP handler can block on it up to a deadline without busy-polling.
 */
public class Job {
    public final String id;
    public final String type;          // "upload" | "import"
    public final String programName;   // intended target program name
    public final long submittedAt;

    public volatile String status;     // "queued" | "analyzing" | "ready" | "error"
    public volatile long startedAt;
    public volatile long finishedAt;
    public volatile String message;
    public volatile Map<String, Object> result;   // populated on "ready"

    private final Object monitor = new Object();

    public Job(String type, String programName) {
        this.id = UUID.randomUUID().toString();
        this.type = type;
        this.programName = programName;
        this.submittedAt = System.currentTimeMillis();
        this.status = "queued";
    }

    public boolean isTerminal() {
        return "ready".equals(status) || "error".equals(status);
    }

    /** Block until this job reaches a terminal state, or {@code timeoutMillis} elapses. */
    public void awaitDone(long timeoutMillis) throws InterruptedException {
        if (timeoutMillis <= 0 || isTerminal()) return;
        long deadline = System.currentTimeMillis() + timeoutMillis;
        synchronized (monitor) {
            while (!isTerminal()) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) return;
                monitor.wait(remaining);
            }
        }
    }

    public void signalTerminal() {
        synchronized (monitor) { monitor.notifyAll(); }
    }

    public Map<String, Object> toMap() {
        var m = new LinkedHashMap<String, Object>();
        m.put("job_id", id);
        m.put("type", type);
        m.put("program", programName);
        m.put("status", status);
        m.put("submitted_at", submittedAt);
        if (startedAt > 0) m.put("started_at", startedAt);
        if (finishedAt > 0) {
            m.put("finished_at", finishedAt);
            m.put("duration_ms", finishedAt - Math.max(startedAt, submittedAt));
        } else if (startedAt > 0) {
            m.put("running_ms", System.currentTimeMillis() - startedAt);
        }
        if (message != null) m.put("message", message);
        if (result != null) m.put("result", result);
        return m;
    }
}
