import { useEffect, useRef, useState } from "react";
import { tauri, IS_TAURI } from "@/lib/bridge";
import type { JobInfo } from "@/lib/types";

export interface JobsState {
  jobs: JobInfo[];
  active: JobInfo[];   // queued + analyzing
  error: string | null;
}

/**
 * Polls /jobs aggressively (every 2s) when there is at least one non-terminal
 * job, and idles to 10s otherwise. Updates running_ms locally between polls so
 * the UI feels live without spamming the server.
 */
export function useJobs(serverUrl: string): JobsState {
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<number>(0);

  useEffect(() => {
    if (!IS_TAURI) return;
    let alive = true;

    const fetch = async () => {
      const id = ++tickRef.current;
      try {
        const list = await tauri.listJobs(serverUrl, 20);
        if (!alive || id !== tickRef.current) return;
        setJobs(list);
        setError(null);
      } catch (e) {
        if (!alive || id !== tickRef.current) return;
        setError((e as Error).message);
      }
    };

    void fetch();
    const schedule = () => {
      const hasActive = jobs.some(
        (j) => j.status === "queued" || j.status === "analyzing"
      );
      return hasActive ? 2_000 : 10_000;
    };
    const handle = window.setInterval(fetch, schedule());

    // local tick: nudge running_ms while waiting for next poll, so timer feels live
    const liveHandle = window.setInterval(() => {
      setJobs((prev) =>
        prev.map((j) => {
          if (j.status !== "analyzing") return j;
          const started = j.started_at ?? j.submitted_at ?? Date.now();
          return { ...j, running_ms: Date.now() - started };
        })
      );
    }, 1_000);

    return () => {
      alive = false;
      clearInterval(handle);
      clearInterval(liveHandle);
    };
    // intentionally not depending on jobs — schedule re-evaluates inside setInterval
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  const active = jobs.filter(
    (j) => j.status === "queued" || j.status === "analyzing"
  );
  return { jobs, active, error };
}
