import { useEffect, useMemo, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FileWarning, Loader2, Upload, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { tauri, IS_TAURI } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import type { UploadJob } from "@/lib/types";

interface Props {
  serverUrl: string;
  onUploaded: () => void;
}

const basename = (p: string) => p.replace(/\\/g, "/").split("/").pop() || p;

export function DropZone({ serverUrl, onUploaded }: Props) {
  const [hover, setHover] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((ev) => {
        if (ev.payload.type === "over") setHover(true);
        else if (ev.payload.type === "leave") setHover(false);
        else if (ev.payload.type === "drop") {
          setHover(false);
          enqueue(ev.payload.paths as string[]);
        }
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  const enqueue = (paths: string[]) => {
    const newJobs: UploadJob[] = paths.map((p) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      path: p, name: basename(p), size: 0, status: "pending",
    }));
    setJobs((prev) => [...prev, ...newJobs]);
    void runQueue([...newJobs]);
  };

  const runQueue = async (queue: UploadJob[]) => {
    if (busy) return;
    setBusy(true);
    for (const j of queue) {
      setJobs((prev) =>
        prev.map((x) => x.id === j.id ? { ...x, status: "uploading", startedAt: Date.now() } : x)
      );
      try {
        // Sync request: server blocks up to 10 min, returns terminal state.
        // Ghidra analyzes one binary at a time anyway — async polling buys nothing here.
        // Drop = upload-only. The server streams bytes to /binaries and
        // returns immediately (analyze=false). The user picks the analysis
        // level and triggers analysis from the binaries panel below.
        const r = await tauri.uploadBinary(j.path, serverUrl, "normal", false);
        const ok = (r.size != null && r.size > 0) || r.imported === false;
        setJobs((prev) =>
          prev.map((x) =>
            x.id === j.id
              ? {
                  ...x,
                  status: ok ? "done" : "error",
                  message: ok
                    ? "uploaded · click Import to analyze"
                    : (r.error ?? r.message ?? "upload failed"),
                  size: r.size ?? 0,
                  finishedAt: Date.now(),
                }
              : x
          )
        );
        if (ok) onUploaded();
      } catch (e) {
        setJobs((prev) =>
          prev.map((x) =>
            x.id === j.id
              ? { ...x, status: "error", message: (e as Error).message, finishedAt: Date.now() }
              : x
          )
        );
      }
    }
    setBusy(false);
  };

  const browse = async () => {
    if (!IS_TAURI) return;
    const sel = await openDialog({ multiple: true, directory: false });
    if (!sel) return;
    enqueue(Array.isArray(sel) ? sel : [sel]);
  };

  const removeJob = (id: string) =>
    setJobs((prev) => prev.filter((j) => j.id !== id || j.status === "uploading"));

  const clearDone = () => setJobs((prev) => prev.filter((j) => j.status !== "done"));

  const summary = useMemo(() => {
    const total = jobs.length;
    const done = jobs.filter((j) => j.status === "done").length;
    const active = jobs.filter((j) => j.status === "uploading" || j.status === "analyzing").length;
    const err = jobs.filter((j) => j.status === "error").length;
    return { total, done, active, err };
  }, [jobs]);

  return (
    <Card className={cn("relative transition-all", hover && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
      {/* Strong full-card drag-over overlay */}
      {hover && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-primary/15 backdrop-blur-[2px] rounded-lg pointer-events-none animate-in fade-in-0 duration-150">
          <div className="flex flex-col items-center gap-2">
            <div className="grid place-items-center w-16 h-16 rounded-md border-2 border-primary bg-primary/25 text-primary">
              <Upload className="size-7" />
            </div>
            <div className="text-sm font-semibold text-primary">Drop to upload &amp; analyze</div>
          </div>
        </div>
      )}

      <CardHeader className="flex-row items-center gap-2 space-y-0 py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Upload className="size-4 text-primary" />
          Upload binaries
          {summary.total > 0 && (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {summary.done} / {summary.total}
              {summary.active > 0 && ` · ${summary.active} active`}
              {summary.err > 0 && ` · ${summary.err} err`}
            </Badge>
          )}
        </CardTitle>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="sm" variant="ghost" className="h-7" onClick={clearDone} disabled={summary.done === 0}>
                Clear done
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Remove completed entries from queue</TooltipContent>
        </Tooltip>
        <Button size="sm" variant="outline" className="h-7" onClick={browse}>Browse…</Button>
      </CardHeader>

      <CardContent className="space-y-3">
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-md py-8 px-5 border border-dashed transition-colors bg-muted/40",
            hover ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground/40"
          )}
        >
          <div className={cn(
            "grid place-items-center w-12 h-12 rounded-md border transition-colors",
            hover ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground"
          )}>
            <Upload className="size-5" />
          </div>
          <div className="text-sm font-medium">
            {IS_TAURI
              ? <>Drop files here, or <button onClick={browse} className="text-primary hover:underline">browse</button></>
              : <>Native drag &amp; drop only available in Tauri shell</>}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            streamed → /binaries — click Import in the panel below to analyze
          </div>
        </div>

        {jobs.length > 0 && (
          <div className="rounded-md border bg-muted/30 overflow-hidden">
            <ScrollArea className="max-h-40">
              <ul className="divide-y">
                {jobs.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/40">
                    <StatusIcon status={j.status} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate" title={j.path}>{j.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate font-mono">{statusLabel(j)}</div>
                    </div>
                    {j.status !== "uploading" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeJob(j.id)}>
                            <X className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove from queue</TooltipContent>
                      </Tooltip>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusIcon({ status }: { status: UploadJob["status"] }) {
  switch (status) {
    case "uploading":
    case "analyzing":
      return <Loader2 className="size-4 text-warning animate-spin shrink-0" />;
    case "done":
      return <CheckCircle2 className="size-4 text-success shrink-0" />;
    case "error":
      return <FileWarning className="size-4 text-destructive shrink-0" />;
    default:
      return <span className="size-2 rounded-full bg-muted-foreground/60 shrink-0 inline-block" />;
  }
}

function statusLabel(j: UploadJob): string {
  if (j.status === "pending") return "queued";
  if (j.status === "uploading" || j.status === "analyzing") {
    const t = j.startedAt ? Math.round((Date.now() - j.startedAt) / 1000) : 0;
    return `uploading… ${t}s`;
  }
  if (j.status === "done") {
    const dur = j.startedAt && j.finishedAt ? Math.round((j.finishedAt - j.startedAt) / 1000) : 0;
    return `uploaded · ${dur}s · ${j.message ?? ""}`;
  }
  return `failed: ${j.message ?? "unknown"}`;
}
