import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  AlertCircle, CheckCircle2, Container, Loader2, Power, RefreshCw, Square, PlayCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { tauri, IS_TAURI, type ComposeResult } from "@/lib/bridge";
import { cn } from "@/lib/utils";

type ComposeAction = "up" | "down" | "restart";

interface ComposeEvent {
  action: ComposeAction;
  phase: "starting" | "log" | "done" | "error";
  line?: string;
  exit_code?: number | null;
}

/**
 * Lifecycle controls for the docker-compose stack.
 *
 * Why this component exists: the GUI is the user's first window into the stack,
 * and forcing them to drop to a terminal to (re)start the container kills the
 * "click to start, click to stop" promise. We surface Start / Stop / Restart
 * here, plus a tail of the stdout/stderr from the most recent action so they
 * can see *why* something failed (image missing, daemon down, port in use,
 * etc.) without having to open Docker logs separately.
 */
export function ContainerControl() {
  const [daemonReachable, setDaemonReachable] = useState<boolean | null>(null);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState<ComposeAction | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [output, setOutput] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<ComposeResult | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);

  // Poll daemon status every 5 s.
  useEffect(() => {
    if (!IS_TAURI) return;
    let mounted = true;
    const tick = async () => {
      try {
        const s = await tauri.dockerStatus();
        if (!mounted) return;
        setDaemonReachable(s.daemon_reachable);
        setServerVersion(s.server_version);
      } catch { if (mounted) setDaemonReachable(false); }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Subscribe to compose progress events.
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: UnlistenFn | null = null;
    (async () => {
      unlisten = await listen<ComposeEvent>("compose-status", (ev) => {
        const p = ev.payload;
        if (p.phase === "starting") {
          setOutput([]);
          setPhase("running");
        } else if (p.phase === "log" && p.line) {
          setOutput((prev) => {
            const next = [...prev, p.line!];
            // Cap tail at 400 lines
            return next.length > 400 ? next.slice(next.length - 400) : next;
          });
          requestAnimationFrame(() => {
            tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
          });
        } else if (p.phase === "done") {
          setPhase("done");
        } else if (p.phase === "error") {
          setPhase("error");
        }
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  const run = async (action: ComposeAction) => {
    if (busy) return;
    setBusy(action);
    setLastResult(null);
    try {
      const r = action === "up"
        ? await tauri.composeUp(false)
        : action === "down"
        ? await tauri.composeDown()
        : await tauri.composeRestart();
      setLastResult(r);
    } catch (e) {
      setLastResult({ action, success: false, exit_code: null, output: String(e) });
      setPhase("error");
    } finally {
      setBusy(null);
    }
  };

  if (!IS_TAURI) {
    return (
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Container className="size-4 text-primary" />
            Container
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          Container controls require the Tauri desktop shell.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 py-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Container className="size-4 text-primary" />
          Container
        </CardTitle>
        <DaemonChip reachable={daemonReachable} version={serverVersion} />
        <span className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          disabled={busy !== null || daemonReachable === false}
          onClick={() => run("up")}
          title="docker compose up -d"
        >
          {busy === "up" ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5 text-success" />}
          Start
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          disabled={busy !== null || daemonReachable === false}
          onClick={() => run("restart")}
          title="docker compose restart"
        >
          {busy === "restart" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Restart
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          disabled={busy !== null || daemonReachable === false}
          onClick={() => run("down")}
          title="docker compose down"
        >
          {busy === "down" ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5 text-destructive" />}
          Stop
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-[11px] text-muted-foreground font-mono">
          {phase === "idle" && !lastResult && "Use the buttons above to manage the docker-compose stack."}
          {phase === "running" && busy && `docker compose ${busy === "up" ? "up -d" : busy}…`}
          {lastResult && phase === "done" && (
            <span className="text-success inline-flex items-center gap-1">
              <CheckCircle2 className="size-3" />
              {lastResult.action} succeeded
              {lastResult.exit_code != null && ` (exit ${lastResult.exit_code})`}
            </span>
          )}
          {lastResult && phase === "error" && (
            <span className="text-destructive inline-flex items-center gap-1">
              <AlertCircle className="size-3" />
              {lastResult.action} failed
              {lastResult.exit_code != null && ` (exit ${lastResult.exit_code})`}
            </span>
          )}
        </div>
        {output.length > 0 && (
          <div className="rounded-md border bg-muted/30 overflow-hidden">
            <ScrollArea className="max-h-[180px]">
              <div ref={tailRef} className="px-3 py-2 font-mono text-[11px] leading-tight whitespace-pre-wrap break-all">
                {output.map((l, i) => (
                  <div
                    key={i}
                    className={cn(
                      l.startsWith("[stderr]") && "text-warning"
                    )}
                  >
                    {l}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DaemonChip({ reachable, version }: { reachable: boolean | null; version: string | null }) {
  if (reachable == null) {
    return <Badge variant="secondary" className="text-[10px] font-mono gap-1.5">checking…</Badge>;
  }
  if (reachable) {
    return (
      <Badge variant="secondary" className="text-[10px] font-mono gap-1.5">
        <Power className="size-2.5 text-success" />
        Docker {version ?? "OK"}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="text-[10px] font-mono gap-1.5">
      <AlertCircle className="size-2.5" />
      daemon down
    </Badge>
  );
}
