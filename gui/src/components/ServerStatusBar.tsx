import { useEffect, useState } from "react";
import { Activity, Power, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { BrandMark } from "@/components/BrandMark";
import { JobsBadge } from "@/components/JobsBadge";
import { setServerUrl } from "@/lib/api";
import { tauri, IS_TAURI } from "@/lib/bridge";
import type { HealthState } from "@/hooks/useHealthPolling";

interface Props {
  serverUrl: string;
  onServerUrlChange: (u: string) => void;
  health: HealthState;
}

export function ServerStatusBar({ serverUrl, onServerUrlChange, health }: Props) {
  const [draft, setDraft] = useState(serverUrl);
  useEffect(() => setDraft(serverUrl), [serverUrl]);

  const dotColor =
    health.status === "ok" ? "text-success"
    : health.status === "loading" ? "text-warning animate-pulseDot"
    : "text-destructive";

  const programCount = health.data?.programs_loaded ?? 0;
  const maxProgs = health.data?.max_programs ?? 0;
  const lastChecked = health.lastChecked
    ? new Date(health.lastChecked).toLocaleTimeString()
    : "—";

  const apply = () => {
    const next = draft.trim().replace(/\/+$/, "");
    if (next && next !== serverUrl) {
      setServerUrl(next);
      onServerUrlChange(next);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b bg-card">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <BrandMark size={32} />
          <div className="flex items-baseline gap-1.5 text-sm">
            <span className="font-semibold tracking-tight">ghidra-agent</span>
            <span className="text-muted-foreground/70">/</span>
            <span className="text-muted-foreground">gui</span>
          </div>
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Status cluster — hover shows last-check time */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={apply}
              className="flex items-center gap-2 outline-none rounded-md px-1 -mx-1 hover:bg-accent/40 transition-colors"
            >
              <span className={`dot ${dotColor}`} />
              <span className="text-xs font-medium uppercase tracking-wide">
                {health.status === "ok" ? "Online" : health.status === "loading" ? "Checking…" : "Offline"}
              </span>
              {health.status === "ok" && (
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {programCount} / {maxProgs} loaded
                </Badge>
              )}
              {health.error && (
                <Badge variant="destructive" className="text-[10px] max-w-[200px] truncate">
                  <Power className="size-3" /> {health.error.slice(0, 32)}
                </Badge>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-0.5">
              <div>Last check: {lastChecked}</div>
              {health.status === "ok" && health.data?.version && (
                <div>Server v{health.data.version}</div>
              )}
              <div className="text-[10px] opacity-70">Click to re-check now</div>
            </div>
          </TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {/* Live jobs popover (only renders when jobs > 0) */}
        {IS_TAURI && health.status === "ok" && <JobsBadge serverUrl={serverUrl} />}

        {/* URL field */}
        <div className="flex items-center gap-2">
          <Activity className="size-3.5 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            onBlur={apply}
            spellCheck={false}
            placeholder="http://127.0.0.1:18089"
            className="w-[280px] h-8 font-mono text-xs"
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={apply}>
              <RefreshCw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh server status</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!IS_TAURI}
              onClick={async () => {
                try { await tauri.openDockerLogs(); }
                catch (e) { alert(`Failed to open docker logs: ${(e as Error).message}`); }
              }}
            >
              <Terminal className="size-3.5" />
              Docker logs
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {IS_TAURI
              ? "Spawn a terminal running `docker compose logs -f`"
              : "Available only in the Tauri desktop app"}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
