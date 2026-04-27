import { useState } from "react";
import { AlertTriangle, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tauri, IS_TAURI } from "@/lib/bridge";
import type { HealthState } from "@/hooks/useHealthPolling";

interface Props {
  health: HealthState;
  serverUrl: string;
  onRetry?: () => void;
}

/**
 * Slim banner shown above the page content when /health has been failing for
 * more than the first poll. Tells the user what to check and offers a retry.
 *
 * Hidden when the connection is healthy or the very first check is still pending.
 */
export function DisconnectedBanner({ health, serverUrl, onRetry }: Props) {
  const [starting, setStarting] = useState(false);
  const [startMsg, setStartMsg] = useState<string | null>(null);

  if (health.status !== "down") return null;
  // Suppress until we've actually tried at least once
  if (!health.lastChecked) return null;

  const startContainer = async () => {
    if (!IS_TAURI) return;
    setStarting(true);
    setStartMsg(null);
    try {
      const r = await tauri.composeUp(false);
      if (r.success) {
        setStartMsg("started — waiting for server…");
        // Trigger an immediate retry; the polling will then clear the banner.
        setTimeout(() => onRetry?.(), 1500);
      } else {
        setStartMsg(`failed (exit ${r.exit_code ?? "?"}). Check Settings → Container for details.`);
      }
    } catch (e) {
      setStartMsg(`error: ${(e as Error).message}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 flex items-center gap-3 text-[12px]">
      <AlertTriangle className="size-4 text-destructive shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-destructive">
          Cannot reach the Ghidra server at <code className="font-mono">{serverUrl}</code>
        </div>
        <div className="text-muted-foreground mt-0.5">
          {health.error ? <>Last error: <span className="font-mono">{health.error}</span> · </> : null}
          Make sure Docker Desktop is running, then click Start to launch the container.
          {startMsg && <span className="ml-2 font-mono">{startMsg}</span>}
        </div>
      </div>
      {IS_TAURI && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          onClick={startContainer}
          disabled={starting}
        >
          {starting
            ? <Loader2 className="size-3.5 animate-spin" />
            : <PlayCircle className="size-3.5 text-success" />}
          Start container
        </Button>
      )}
      <Button size="sm" variant="outline" className="h-7" onClick={onRetry}>
        <RefreshCw className="size-3.5" /> Retry
      </Button>
    </div>
  );
}
