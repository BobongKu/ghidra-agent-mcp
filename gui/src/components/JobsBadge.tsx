import { useState } from "react";
import { Ban, CheckCircle2, FileWarning, Loader2, XCircle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useJobs } from "@/hooks/useJobs";
import { tauri } from "@/lib/bridge";
import type { JobInfo } from "@/lib/types";

interface Props {
  serverUrl: string;
}

const fmtMs = (ms?: number) => {
  if (ms == null) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem.toString().padStart(2, "0")}s`;
};

const statusIcon = (s?: string) => {
  switch (s) {
    case "queued":
      return <span className="size-2 rounded-full bg-muted-foreground inline-block" />;
    case "analyzing":
      return <Loader2 className="size-3.5 text-warning animate-spin" />;
    case "ready":
      return <CheckCircle2 className="size-3.5 text-success" />;
    case "error":
      return <FileWarning className="size-3.5 text-destructive" />;
    case "cancelled":
      return <Ban className="size-3.5 text-muted-foreground" />;
    default:
      return null;
  }
};

export function JobsBadge({ serverUrl }: Props) {
  const { jobs, active } = useJobs(serverUrl);

  // Hide chip when there's no job at all
  if (jobs.length === 0) return null;

  const hasActive = active.length > 0;
  const summary = hasActive
    ? `${active.length} active`
    : "jobs";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 px-2 h-7 rounded-md border border-border
                     bg-muted/40 hover:bg-accent transition-colors"
          title="Open jobs panel"
        >
          {hasActive
            ? <Loader2 className="size-3.5 text-warning animate-spin" />
            : <Zap className="size-3.5 text-muted-foreground" />}
          <span className="text-[11px] font-medium">{summary}</span>
          {hasActive && active[0]?.running_ms != null && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {fmtMs(active[0].running_ms)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-0" sideOffset={8}>
        <div className="px-3 py-2 border-b flex items-center gap-2">
          <Zap className="size-3.5 text-primary" />
          <span className="text-[12px] font-semibold uppercase tracking-wide">Jobs</span>
          <span className="flex-1" />
          <Badge variant="secondary" className="font-mono text-[10px]">
            {active.length} active · {jobs.length - active.length} done
          </Badge>
        </div>
        <ScrollArea className="max-h-[320px]">
          {jobs.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">No jobs.</div>
          ) : (
            <ul className="divide-y">
              {jobs.map((j) => <JobRow key={j.job_id ?? Math.random()} j={j} serverUrl={serverUrl} />)}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function JobRow({ j, serverUrl }: { j: JobInfo; serverUrl: string }) {
  const elapsed = j.status === "analyzing"
    ? j.running_ms
    : j.duration_ms;
  const cancellable = (j as JobInfo & { cancellable?: boolean }).cancellable
    ?? (j.status === "queued" || j.status === "analyzing");
  const cancelRequested = (j as JobInfo & { cancel_requested?: boolean }).cancel_requested ?? false;

  const [busy, setBusy] = useState(false);
  const onCancel = async () => {
    if (!j.job_id) return;
    setBusy(true);
    try { await tauri.cancelJob(j.job_id, serverUrl); }
    catch (e) { console.warn("cancel failed:", e); }
    finally { setBusy(false); }
  };

  return (
    <li className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent/40">
      <span className="shrink-0">{statusIcon(j.status)}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] truncate font-medium font-mono" title={j.program ?? ""}>
          {j.program ?? "(unknown)"}
        </div>
        <div className="text-[10.5px] text-muted-foreground flex items-center gap-1.5 font-mono">
          <span>{j.type ?? "—"}</span>
          <span className="text-muted-foreground/50">·</span>
          <span>{j.status ?? "—"}</span>
          {cancelRequested && j.status === "analyzing" && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-warning">cancelling…</span>
            </>
          )}
          {j.message && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="truncate text-destructive" title={j.message}>{j.message}</span>
            </>
          )}
        </div>
      </div>
      <span className="text-[11px] font-mono text-muted-foreground shrink-0">{fmtMs(elapsed)}</span>
      {cancellable && !cancelRequested && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          title="Cancel this job"
          disabled={busy}
          onClick={onCancel}
        >
          <XCircle className="size-3.5 text-muted-foreground hover:text-destructive" />
        </Button>
      )}
    </li>
  );
}
