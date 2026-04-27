import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Single-thread executor for long-running Ghidra import/analysis jobs.
 *
 * <p>Why single-thread: Ghidra's auto-analysis manager and project-level mutations
 * are not safe to run concurrently on different programs without careful locking.
 * The previous {@code synchronized} on {@link ServerContext#importAndAnalyze}
 * had the same effect — but it serialized the work on the HTTP threads, exhausting
 * the (small) thread pool whenever multiple imports were in flight. This class
 * moves the work off the HTTP threads onto a dedicated worker.
 *
 * <p>Old jobs are retained up to {@link #MAX_HISTORY} entries so callers can
 * still query terminal state via {@code /jobs/{id}} after the fact.
 */
public class JobManager {

    private static final int MAX_HISTORY = 200;

    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    /** Newest first. Used to bound history and serve {@code /jobs} listing. */
    private final Deque<String> recent = new ConcurrentLinkedDeque<>();

    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "ghidra-import-worker");
        t.setDaemon(true);
        return t;
    });

    @FunctionalInterface
    public interface JobTask {
        Map<String, Object> run() throws Exception;
    }

    /** Submit a unit of work. Returns immediately with the queued {@link Job}. */
    public Job submit(String type, String programName, JobTask task) {
        Job job = new Job(type, programName);
        jobs.put(job.id, job);
        recent.addFirst(job.id);
        // Trim history (keep terminal entries newest-first)
        while (recent.size() > MAX_HISTORY) {
            String oldId = recent.pollLast();
            if (oldId != null) jobs.remove(oldId);
        }
        executor.submit(() -> {
            job.status = "analyzing";
            job.startedAt = System.currentTimeMillis();
            try {
                job.result = task.run();
                job.status = "ready";
            } catch (Throwable t) {
                job.status = "error";
                job.message = t.getClass().getSimpleName()
                        + ": " + (t.getMessage() != null ? t.getMessage() : "(no message)");
                System.err.println("[job " + job.id + "] " + job.message);
            } finally {
                job.finishedAt = System.currentTimeMillis();
                job.signalTerminal();
            }
        });
        return job;
    }

    public Job get(String id) {
        return jobs.get(id);
    }

    public List<Job> listRecent(int limit) {
        var out = new ArrayList<Job>();
        int n = 0;
        for (String id : recent) {
            if (n >= limit) break;
            Job j = jobs.get(id);
            if (j != null) {
                out.add(j);
                n++;
            }
        }
        return out;
    }

    /** Aggregate counts for {@code /health} display. */
    public Map<String, Long> countsByStatus() {
        var counts = new LinkedHashMap<String, Long>();
        counts.put("queued", 0L);
        counts.put("analyzing", 0L);
        counts.put("ready", 0L);
        counts.put("error", 0L);
        for (Job j : jobs.values()) {
            counts.merge(j.status, 1L, Long::sum);
        }
        return counts;
    }

    public void shutdown() {
        executor.shutdown();
    }
}
