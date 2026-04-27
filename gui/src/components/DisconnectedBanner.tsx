import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  if (health.status !== "down") return null;
  // Suppress until we've actually tried at least once
  if (!health.lastChecked) return null;

  return (
    <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 flex items-center gap-3 text-[12px]">
      <AlertTriangle className="size-4 text-destructive shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-destructive">
          Cannot reach the Ghidra server at <code className="font-mono">{serverUrl}</code>
        </div>
        <div className="text-muted-foreground mt-0.5">
          {health.error ? <>Last error: <span className="font-mono">{health.error}</span> · </> : null}
          Check that Docker Desktop is running and the container is up
          (<code className="font-mono">docker compose -f docker/docker-compose.yml up -d</code>).
        </div>
      </div>
      <Button size="sm" variant="outline" className="h-7" onClick={onRetry}>
        <RefreshCw className="size-3.5" /> Retry
      </Button>
    </div>
  );
}
