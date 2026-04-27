import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Loader2, Play, RotateCw, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { tauri, IS_TAURI, type AnalysisLevel } from "@/lib/bridge";
import { useJobs } from "@/hooks/useJobs";
import { cn } from "@/lib/utils";
import type { FileInfo } from "@/lib/types";

const ANALYSIS_STORAGE_KEY = "ghidra-agent-mcp.analysis-level";

interface Props {
  serverUrl: string;
  binariesDir: string;
  loadedPrograms: string[];
  onChanged: () => void;
  refreshKey: number;
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ImportPanel({ serverUrl, binariesDir, loadedPrograms, onChanged, refreshKey }: Props) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisLevel>(() => {
    const saved = (typeof window !== "undefined"
      ? localStorage.getItem(ANALYSIS_STORAGE_KEY)
      : null) as AnalysisLevel | null;
    return saved ?? "normal";
  });
  useEffect(() => {
    localStorage.setItem(ANALYSIS_STORAGE_KEY, analysis);
  }, [analysis]);

  const loaded = useMemo(() => new Set(loadedPrograms), [loadedPrograms]);

  // Server-side active jobs per program name. Survives tab switching: the local
  // `importing` Set is wiped on unmount, but jobs come from the server via useJobs.
  const { active: activeJobs } = useJobs(serverUrl);
  const activeProgramNames = useMemo(
    () => new Set(activeJobs.map((j) => (j.program ?? "").toLowerCase())),
    [activeJobs]
  );

  const refresh = async () => {
    if (!IS_TAURI || !binariesDir) return;
    setLoading(true);
    setError(null);
    try { setFiles(await tauri.listBinariesDir(binariesDir)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, [binariesDir, refreshKey]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, filter]);

  const stats = useMemo(() => {
    const total = files.length;
    const loadedCount = files.filter((f) => loaded.has(f.name)).length;
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    return { total, loadedCount, totalSize };
  }, [files, loaded]);

  const runImport = async (f: FileInfo) => {
    // Skip if already analyzing somewhere (local click in flight or server job active).
    if (importing.has(f.name) || activeProgramNames.has(f.name.toLowerCase())) return;
    setImporting((s) => new Set(s).add(f.name));
    try {
      // Sync: server blocks up to 10 min on /import, returns terminal state.
      const r = await tauri.importBinary(`/binaries/${f.name}`, serverUrl, analysis);
      const ok = r.status === "ready" || r.imported === true;
      if (!ok) {
        setError(`${f.name}: ${r.error ?? r.message ?? "import failed"}`);
      } else {
        onChanged();
      }
    } catch (e) {
      setError(`${f.name}: ${(e as Error).message}`);
    } finally {
      setImporting((s) => {
        const n = new Set(s); n.delete(f.name); return n;
      });
    }
  };

  const importAll = async () => {
    for (const f of filtered) {
      if (
        loaded.has(f.name) ||
        importing.has(f.name) ||
        activeProgramNames.has(f.name.toLowerCase())
      ) continue;
      await runImport(f);
    }
  };

  const pending = filtered.filter(
    (f) =>
      !loaded.has(f.name) &&
      !activeProgramNames.has(f.name.toLowerCase())
  ).length;

  return (
    <Card className="flex-1 min-h-0 flex flex-col">
      <CardHeader className="flex-row items-start gap-2 space-y-0 py-3">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-sm leading-tight flex items-center gap-2">
            Binaries on server
            {stats.total > 0 && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {stats.loadedCount} / {stats.total}
              </Badge>
            )}
          </CardTitle>
          <p className="font-mono text-[11px] text-muted-foreground truncate mt-1" title={binariesDir}>
            {binariesDir || "(no project path resolved)"}
          </p>
        </div>
        <AnalysisLevelToggle value={analysis} onChange={setAnalysis} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-7" onClick={() => binariesDir && tauri.openFolder(binariesDir)}>
              <FolderOpen className="size-3.5" /> Open
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open binaries folder</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={refresh} disabled={loading}>
              <RotateCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Re-scan</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="sm"
                className="h-7"
                onClick={importAll}
                disabled={pending === 0}
              >
                <Play className="size-3.5" />
                Import {pending > 0 ? `(${pending})` : "all"}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {pending === 0 ? "All visible files are loaded" : `Import ${pending} pending file(s) sequentially`}
          </TooltipContent>
        </Tooltip>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 flex flex-col gap-2">
        {/* filter */}
        {files.length > 0 && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name…"
              className="h-7 pl-7 text-xs"
            />
            {filter && (
              <button
                onClick={() => setFilter("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5"
              >
                clear
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0 rounded-md border bg-muted/30">
          {filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground p-6 text-center">
              {loading ? "Scanning…"
                : files.length === 0 ? "No files. Drop binaries above or copy into docker/binaries/."
                : "No matches for filter."}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((f) => {
                const isLoaded = loaded.has(f.name);
                // True if this file is being analyzed *anywhere* (locally clicked
                // OR a server-side job is active under the same name). The latter
                // makes the badge persistent across tab switches.
                const isImporting =
                  importing.has(f.name) ||
                  activeProgramNames.has(f.name.toLowerCase());
                return (
                  <li key={f.path} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/40">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate" title={f.name}>{f.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{fmtSize(f.size)}</div>
                    </div>
                    {isLoaded ? (
                      <Badge variant="success">loaded</Badge>
                    ) : isImporting ? (
                      <Badge variant="warning">
                        <Loader2 className="size-3 animate-spin" /> analyzing
                      </Badge>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => runImport(f)}>
                            Import
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Analyze & load this binary (~minutes)</TooltipContent>
                      </Tooltip>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        {stats.total > 0 && (
          <div className="text-[10px] text-muted-foreground/80 font-mono px-1">
            {filtered.length === files.length
              ? `total ${fmtSize(stats.totalSize)}`
              : `showing ${filtered.length} / ${stats.total}`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AnalysisLevelToggle({
  value,
  onChange,
}: {
  value: AnalysisLevel;
  onChange: (v: AnalysisLevel) => void;
}) {
  const opts: { v: AnalysisLevel; label: string; hint: string }[] = [
    { v: "fast",     label: "fast",     hint: "Skip slow decompiler analyzers — best for huge stripped binaries (e.g. macOS / iOS frameworks). 3–5× faster. Decompile / callgraph / deps still work." },
    { v: "normal",   label: "normal",   hint: "Ghidra defaults. Good for most PE / ELF binaries." },
    { v: "thorough", label: "thorough", hint: "Reserved for future extra analyzers. Same as normal today." },
  ];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex h-7 rounded-md border bg-muted/30 overflow-hidden text-[11px] font-mono">
          {opts.map((o) => (
            <button
              key={o.v}
              onClick={() => onChange(o.v)}
              className={cn(
                "px-2 transition-colors",
                value === o.v
                  ? "bg-primary/15 text-primary border-l border-r border-primary/30 first:border-l-0 last:border-r-0"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px]">
        <div className="space-y-1 text-[11px]">
          <div><b>Analysis depth</b> for Import.</div>
          <div className="text-muted-foreground">
            {opts.find((o) => o.v === value)?.hint}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
