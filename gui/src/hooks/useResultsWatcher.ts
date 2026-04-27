import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { tauri, IS_TAURI } from "@/lib/bridge";
import type { MetaEntry } from "@/lib/types";

export function useResultsWatcher(metaPath: string | null, tail = 50) {
  const [entries, setEntries] = useState<MetaEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Initial load + on event refresh
  useEffect(() => {
    if (!metaPath || !IS_TAURI) return;
    let unlisten: UnlistenFn | null = null;
    let alive = true;

    const refresh = async () => {
      try {
        const r = await tauri.readResultsMeta(metaPath, tail);
        if (alive) setEntries(r);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };

    (async () => {
      await refresh();
      try {
        await tauri.startResultsWatcher(metaPath);
        unlisten = await listen<void>("results-changed", () => {
          void refresh();
        });
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();

    return () => {
      alive = false;
      if (unlisten) unlisten();
    };
  }, [metaPath, tail]);

  return { entries, error, reload: () => setEntries((e) => [...e]) };
}
