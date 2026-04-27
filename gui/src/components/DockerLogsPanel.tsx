import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Pause, Play, Trash2, ScrollText, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { tauri, IS_TAURI } from "@/lib/bridge";

const MAX_LINES = 1000;

export function DockerLogsPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Start streaming when mounted, stop on unmount.
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: UnlistenFn | null = null;
    (async () => {
      try {
        unlisten = await listen<string>("docker-log-line", (ev) => {
          if (pausedRef.current) return;
          setLines((prev) => {
            const next = prev.length >= MAX_LINES
              ? [...prev.slice(prev.length - MAX_LINES + 1), ev.payload]
              : [...prev, ev.payload];
            return next;
          });
        });
        await tauri.startDockerLogs(200);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      if (unlisten) unlisten();
      tauri.stopDockerLogs().catch(() => {});
    };
  }, []);

  // Auto-scroll to bottom on new lines.
  useLayoutEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    if (autoScroll !== atBottom) setAutoScroll(atBottom);
  };

  const downloadLogs = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `docker-logs-${Date.now()}.log`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  };

  return (
    <Card className="flex-1 min-h-0 flex flex-col">
      <CardHeader className="flex-row items-center gap-2 space-y-0 py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ScrollText className="size-4 text-primary" />
          Docker logs
          <Badge variant="secondary" className="font-mono text-[10px]">{lines.length}</Badge>
          {!autoScroll && <Badge variant="warning" className="font-mono text-[10px]">scroll-locked</Badge>}
        </CardTitle>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPaused(!paused)}>
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{paused ? "Resume" : "Pause"} streaming</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setLines([])}>
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear buffer</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={downloadLogs} disabled={lines.length === 0}>
              <Download className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download as .log</TooltipContent>
        </Tooltip>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 p-0">
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border-b border-destructive/30 px-3 py-2">
            {error}
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-auto bg-muted/40 p-2 font-mono text-[11px] leading-[1.45]"
        >
          {!IS_TAURI ? (
            <div className="text-muted-foreground p-4 text-center">
              Native logs streaming requires the Tauri desktop app.
            </div>
          ) : lines.length === 0 ? (
            <div className="text-muted-foreground p-4 text-center">
              Waiting for log output…
            </div>
          ) : (
            lines.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("[stderr]")
                    ? "text-destructive whitespace-pre-wrap break-all"
                    : "whitespace-pre-wrap break-all"
                }
              >
                {line}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
