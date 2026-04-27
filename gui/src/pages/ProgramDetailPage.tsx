import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Code2, Eye, FileJson, FolderOpen, Loader2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JsonView } from "@/components/JsonView";
import { useResultsWatcher } from "@/hooks/useResultsWatcher";
import { tauri, IS_TAURI } from "@/lib/bridge";
import { getServerUrl } from "@/lib/api";
import type { MetaEntry } from "@/lib/types";

interface DeepLink {
  tab?: "functions" | "imports" | "strings" | "results";
  filter?: string;
  address?: string;
}

interface Props {
  programName: string;
  binariesDir: string;
  metaPath: string | null;
  deepLink?: DeepLink;
  onBack: () => void;
}

interface FunctionItem { address: string; name: string; size?: number; }
interface ImportLib { library: string; count: number; functions: string[]; truncated?: boolean; }
interface StringEntry { address: string; value: string; }

async function ghidraGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const u = new URL(getServerUrl() + path);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.status === "error") throw new Error(j.message);
  return j.data as T;
}

/**
 * POST helper that puts params on the URL as a query string. Most Ghidra
 * "POST" endpoints (e.g. /decompile) actually read parameters from the query,
 * not the body — body-style POSTing returns HTTP 400 "Missing required parameter".
 */
async function ghidraPostQuery<T>(path: string, params: Record<string, string>): Promise<T> {
  const u = new URL(getServerUrl() + path);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u.toString(), { method: "POST" });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.message) msg += `: ${j.message}`;
    } catch {/* not JSON */}
    throw new Error(msg);
  }
  const j = await r.json();
  if (j.status === "error") throw new Error(j.message);
  return j.data as T;
}

export function ProgramDetailPage({ programName, binariesDir, metaPath, deepLink, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<"functions" | "imports" | "strings" | "results">(
    deepLink?.tab ?? "functions"
  );

  // Re-apply tab when deepLink changes (e.g. user clicks another search result).
  useEffect(() => {
    if (deepLink?.tab) setActiveTab(deepLink.tab);
  }, [deepLink?.tab, deepLink?.filter, deepLink?.address]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 overflow-hidden">
      {/* Header */}
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0 py-3">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <CardTitle className="text-sm flex items-center gap-2 font-mono">
            {programName}
          </CardTitle>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="outline" className="h-7"
                disabled={!IS_TAURI || !binariesDir}
                onClick={() => binariesDir && tauri.openFolder(binariesDir)}
              >
                <FolderOpen className="size-3.5" /> Reveal binary
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open <code>docker/binaries/</code> in Explorer</TooltipContent>
          </Tooltip>
        </CardHeader>
      </Card>

      {/* Tabs */}
      <Card className="flex-1 min-h-0 flex flex-col">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          className="flex-1 min-h-0 flex flex-col"
        >
          <CardHeader className="space-y-0 py-3">
            <TabsList className="h-8 self-start">
              <TabsTrigger value="functions" className="text-xs h-7 px-3">Functions</TabsTrigger>
              <TabsTrigger value="imports" className="text-xs h-7 px-3">Imports</TabsTrigger>
              <TabsTrigger value="strings" className="text-xs h-7 px-3">Strings</TabsTrigger>
              <TabsTrigger value="results" className="text-xs h-7 px-3">Results</TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
            <TabsContent value="functions" className="h-full m-0 data-[state=inactive]:hidden">
              <FunctionsTab
                program={programName}
                initialFilter={activeTab === "functions" ? deepLink?.filter : undefined}
                autoDecompileAddress={activeTab === "functions" ? deepLink?.address : undefined}
              />
            </TabsContent>
            <TabsContent value="imports" className="h-full m-0 data-[state=inactive]:hidden">
              <ImportsTab program={programName} />
            </TabsContent>
            <TabsContent value="strings" className="h-full m-0 data-[state=inactive]:hidden">
              <StringsTab
                program={programName}
                initialFilter={activeTab === "strings" ? deepLink?.filter : undefined}
              />
            </TabsContent>
            <TabsContent value="results" className="h-full m-0 data-[state=inactive]:hidden">
              <ResultsTab program={programName} metaPath={metaPath} />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );
}

// ---------- Functions tab ----------
function FunctionsTab({
  program, initialFilter, autoDecompileAddress,
}: {
  program: string;
  initialFilter?: string;
  autoDecompileAddress?: string;
}) {
  const [funcs, setFuncs] = useState<FunctionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState(initialFilter ?? "");
  const [selected, setSelected] = useState<FunctionItem | null>(null);
  const [decompile, setDecompile] = useState<string | null>(null);
  const [decompiling, setDecompiling] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    ghidraGet<FunctionItem[]>("/functions", { program, limit: "5000" })
      .then((d) => alive && setFuncs(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [program]);

  // Apply incoming filter / auto-decompile when deep link changes
  useEffect(() => {
    if (initialFilter !== undefined) setFilter(initialFilter);
  }, [initialFilter]);

  // Auto-decompile when address provided AND functions are loaded
  useEffect(() => {
    if (!autoDecompileAddress || funcs.length === 0) return;
    const target =
      funcs.find((f) => f.address?.toLowerCase() === autoDecompileAddress.toLowerCase()) ??
      funcs.find((f) =>
        autoDecompileAddress.toLowerCase().endsWith(f.address?.toLowerCase() ?? "_no_match"));
    if (target) decompileFn(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDecompileAddress, funcs]);

  const filtered = filter
    ? funcs.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()) ||
                          f.address.includes(filter))
    : funcs;

  const decompileFn = async (f: FunctionItem) => {
    setSelected(f);
    setDecompile(null);
    setDecompiling(true);
    try {
      const data = await ghidraPostQuery<{ decompiled: string }>("/decompile", { program, address: f.address });
      setDecompile(data.decompiled);
    } catch (e) {
      // Translate raw HTTP errors into something a human can act on.
      const raw = (e as Error).message;
      const friendly = raw.startsWith("HTTP 4")
        ? "This function couldn't be decompiled — it may be an external import (declared in another binary) or a thunk. Pick a function defined inside this program."
        : raw.startsWith("HTTP 5")
        ? "Server error during decompile. Check Docker logs (Dashboard → Docker logs)."
        : `Decompile failed: ${raw}`;
      setDecompile(`// ${friendly}\n//\n// Address: ${f.address}\n// Function: ${f.name}`);
    } finally {
      setDecompiling(false);
    }
  };

  return (
    <div className="h-full grid grid-cols-2 gap-0">
      {/* Function list */}
      <div className="flex flex-col min-h-0 border-r">
        <div className="p-2 border-b relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${funcs.length} functions…`}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 px-3 py-2">{error}</div>
        )}
        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <div className="text-sm text-muted-foreground p-6 text-center">
              <Loader2 className="size-4 inline animate-spin mr-1" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground p-6 text-center">No functions match.</div>
          ) : (
            <ul className="divide-y">
              {filtered.map((f) => (
                <li
                  key={f.address}
                  onClick={() => decompileFn(f)}
                  className={`cursor-pointer px-3 py-1.5 hover:bg-accent/40 transition-colors
                    ${selected?.address === f.address ? "bg-primary/20" : ""}`}
                >
                  <div className="text-[12px] font-mono truncate font-medium">
                    <span className="text-warning">{f.name}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">{f.address}</div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground font-mono">
          {filter ? `${filtered.length} / ${funcs.length}` : `${funcs.length} fns`}
        </div>
      </div>

      {/* Decompile pane */}
      <div className="flex flex-col min-h-0">
        <div className="p-2 border-b flex items-center gap-2">
          <Code2 className="size-3.5 text-primary" />
          <span className="text-[12px] font-mono truncate">
            {selected?.name ?? "Pick a function to decompile"}
          </span>
          {decompiling && <Loader2 className="size-3.5 animate-spin text-warning ml-auto" />}
        </div>
        <div className="flex-1 min-h-0">
          {selected && decompile ? (
            <JsonView text={decompile} raw />
          ) : (
            <div className="text-sm text-muted-foreground p-6 text-center">
              Click a function on the left to decompile.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Imports tab ----------
function ImportsTab({ program }: { program: string }) {
  const [data, setData] = useState<ImportLib[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    ghidraGet<ImportLib[]>("/imports", { program })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [program]);

  return (
    <ScrollArea className="h-full">
      {error && <div className="text-xs text-destructive p-3">{error}</div>}
      {loading && <div className="text-sm text-muted-foreground p-6 text-center"><Loader2 className="size-4 inline animate-spin mr-1" /> Loading…</div>}
      {!loading && (
        <div className="divide-y">
          {data.map((lib) => (
            <details key={lib.library} className="px-3 py-2">
              <summary className="cursor-pointer flex items-center gap-2 text-[13px]">
                <span className="font-mono">{lib.library}</span>
                <Badge variant="secondary" className="font-mono text-[10px]">{lib.count}</Badge>
                {lib.truncated && <Badge variant="warning" className="font-mono text-[10px]">truncated</Badge>}
              </summary>
              <ul className="mt-2 ml-4 space-y-0.5 font-mono text-[11.5px] text-muted-foreground">
                {lib.functions.map((fn, i) => <li key={i}>{fn}</li>)}
              </ul>
            </details>
          ))}
        </div>
      )}
    </ScrollArea>
  );
}

// ---------- Results tab ----------
function ResultsTab({ program, metaPath }: { program: string; metaPath: string | null }) {
  const { entries, error } = useResultsWatcher(metaPath, 200);
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);

  const scoped = useMemo(() => {
    return entries.filter(
      (e) => (e.program ?? "").toLowerCase() === program.toLowerCase()
    );
  }, [entries, program]);

  const filtered = useMemo(() => {
    if (!filter) return scoped;
    const q = filter.toLowerCase();
    return scoped.filter(
      (e) =>
        e.tool.toLowerCase().includes(q) ||
        (e.identifier ?? "").toLowerCase().includes(q)
    );
  }, [scoped, filter]);

  const open = async (e: MetaEntry) => {
    try {
      const content = await tauri.readResultFile(e.file, 200_000);
      setPreview({ path: e.file, content });
    } catch (err) {
      setPreview({ path: e.file, content: `(error: ${(err as Error).message})` });
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b flex items-center gap-2">
        <FileJson className="size-3.5 text-primary" />
        <span className="text-[12px] font-medium">Results for this program</span>
        <Badge variant="secondary" className="font-mono text-[10px]">
          {filter ? `${filtered.length} / ${scoped.length}` : scoped.length}
        </Badge>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tool/identifier…"
            className="h-7 pl-7 text-xs w-56"
          />
        </div>
      </div>

      {error && <div className="text-xs text-destructive p-3">{error}</div>}

      <ScrollArea className="flex-1 min-h-0">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground p-8 text-center">
            {scoped.length === 0
              ? "No results yet for this program. Run analysis from the Console or via the LLM bridge."
              : "No matches for filter."}
          </div>
        ) : (
          <ul className="divide-y">
            {[...filtered].reverse().map((e, i) => (
              <li
                key={`${e.file}-${i}`}
                onClick={() => open(e)}
                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-accent/40 cursor-pointer transition-colors"
              >
                <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">
                  {e.tool}
                </Badge>
                <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                  {new Date(e.time).toLocaleTimeString()}
                </span>
                <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium font-mono">
                  {e.identifier
                    ? <span className="text-warning">{e.identifier}</span>
                    : <span className="text-muted-foreground/60">—</span>}
                </span>
                <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                  {e.size < 1024 ? `${e.size} B`
                   : e.size < 1024 * 1024 ? `${(e.size / 1024).toFixed(1)} KB`
                   : `${(e.size / 1024 / 1024).toFixed(2)} MB`}
                </span>
                <Eye className="size-3.5 text-muted-foreground" />
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader>
            <DialogTitle className="font-mono text-[11px] text-muted-foreground truncate">
              {preview?.path}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {preview && <JsonView text={preview.content} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Strings tab ----------
function StringsTab({ program, initialFilter }: { program: string; initialFilter?: string }) {
  const [data, setData] = useState<StringEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState(initialFilter ?? "");

  useEffect(() => {
    if (initialFilter !== undefined) setFilter(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    ghidraGet<StringEntry[]>("/strings", { program, limit: "1000" })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [program]);

  const filtered = filter
    ? data.filter((s) => s.value.toLowerCase().includes(filter.toLowerCase()))
    : data;

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter strings…"
          className="h-7 pl-7 text-xs"
        />
      </div>
      {error && <div className="text-xs text-destructive p-3">{error}</div>}
      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <div className="text-sm text-muted-foreground p-6 text-center"><Loader2 className="size-4 inline animate-spin mr-1" /> Loading…</div>
        ) : (
          <ul className="divide-y">
            {filtered.map((s, i) => (
              <li key={i} className="px-3 py-1.5 font-mono text-[11.5px] flex gap-3">
                <span className="text-muted-foreground/70 shrink-0">{s.address}</span>
                <span className="text-success break-all">{s.value}</span>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
      <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground font-mono">
        {filter ? `${filtered.length} / ${data.length}` : `${data.length} strings`}
      </div>
    </div>
  );
}
