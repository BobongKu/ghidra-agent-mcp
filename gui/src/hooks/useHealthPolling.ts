import { useEffect, useRef, useState } from "react";
import { getHealth } from "@/lib/api";
import type { HealthResp } from "@/lib/types";

export type ServerStatus = "ok" | "down" | "loading";

export interface HealthState {
  status: ServerStatus;
  data: HealthResp["data"] | null;
  error: string | null;
  lastChecked: number | null;
}

export function useHealthPolling(serverUrl: string, intervalMs = 3000) {
  const [state, setState] = useState<HealthState>({
    status: "loading",
    data: null,
    error: null,
    lastChecked: null,
  });
  const tickRef = useRef<number>(0);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      const id = ++tickRef.current;
      try {
        const r = await getHealth(serverUrl);
        if (!alive || id !== tickRef.current) return;
        setState({
          status: r.status === "ok" ? "ok" : "down",
          data: r.data ?? null,
          error: r.status === "ok" ? null : r.message ?? "error",
          lastChecked: Date.now(),
        });
      } catch (e) {
        if (!alive || id !== tickRef.current) return;
        setState((s) => ({
          status: "down",
          data: s.data,
          error: (e as Error).message,
          lastChecked: Date.now(),
        }));
      }
    };

    void tick();
    const h = window.setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [serverUrl, intervalMs]);

  return state;
}
