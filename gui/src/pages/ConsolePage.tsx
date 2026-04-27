import { useEffect, useMemo, useState } from "react";
import { Play, Loader2, Search, History, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JsonView } from "@/components/JsonView";
import { getServerUrl } from "@/lib/api";

interface SchemaParam {
  name: string;
  description?: string;
  required?: boolean;
  source?: "query" | "body";
  type?: string;
}

interface SchemaEndpoint {
  path: string;
  method: string;
  description?: string;
  params?: SchemaParam[];
}

interface HistoryItem {
  ts: number;
  endpoint: string;
  params: Record<string, string>;
  status: number;
  durationMs: number;
}

const HISTORY_KEY = "console.history.v1";

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(h: HistoryItem[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50))); } catch {}
}

interface Props {
  serverUrl: string;
}

export function ConsolePage({ serverUrl }: Props) {
  const [endpoints, setEndpoints] = useState<SchemaEndpoint[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<SchemaEndpoint | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<{ json: string; status: number; ms: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory());

  // Fetch /schema once
  useEffect(() => {
    fetch(`${serverUrl}/schema`)
      .then((r) => r.json())
      .then((j) => {
        const eps = (j?.data?.endpoints ?? j?.data ?? []) as SchemaEndpoint[];
        setEndpoints(eps.sort((a, b) => a.path.localeCompare(b.path)));
      })
      .catch(() => setEndpoints([]));
  }, [serverUrl]);

  const filtered = useMemo(
    () => filter
      ? endpoints.filter((e) =>
          e.path.toLowerCase().includes(filter.toLowerCase()) ||
          (e.description ?? "").toLowerCase().includes(filter.toLowerCase()))
      : endpoints,
    [endpoints, filter]
  );

  const pickEndpoint = (ep: SchemaEndpoint) => {
    setSelected(ep);
    const initial: Record<string, string> = {};
    ep.params?.forEach((p) => { initial[p.name] = ""; });
    setParamValues(initial);
    setResponse(null);
  };

  const exec = async () => {
    if (!selected) return;
    setRunning(true);
    const t0 = Date.now();
    try {
      const u = new URL(getServerUrl() + selected.path);
      const body: Record<string, string> = {};
      const queryOnly: Record<string, string> = {};
      const usedParams: Record<string, string> = {};
      selected.params?.forEach((p) => {
        const v = paramValues[p.name];
        if (!v) return;
        usedParams[p.name] = v;
        if (p.source === "body") body[p.name] = v;
        else queryOnly[p.name] = v;
      });
      // For unknown source: if method=GET → query, else → body
      const isPost = selected.method.toUpperCase() === "POST";
      Object.entries(queryOnly).forEach(([k, v]) => u.searchParams.set(k, v));
      const init: RequestInit = {
        method: selected.method.toUpperCase(),
      };
      if (isPost && Object.keys(body).length) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(body);
      }
      const res = await fetch(u.toString(), init);
      const text = await res.text();
      const ms = Date.now() - t0;
      setResponse({ json: text, status: res.status, ms });
      const next = [{
        ts: Date.now(),
        endpoint: `${selected.method} ${selected.path}`,
        params: usedParams,
        status: res.status,
        durationMs: ms,
      }, ...history].slice(0, 50);
      setHistory(next);
      saveHistory(next);
    } catch (e) {
      const ms = Date.now() - t0;
      setResponse({ json: JSON.stringify({ error: (e as Error).message }), status: 0, ms });
    } finally {
      setRunning(false);
    }
  };

  const clearHistory = () => { setHistory([]); saveHistory([]); };

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[280px_minmax(0,1fr)] gap-4 p-4">
      {/* Endpoint list */}
      <Card className="flex flex-col min-h-0">
        <CardHeader className="space-y-0 py-3">
          <CardTitle className="text-sm">Endpoints <Badge variant="secondary" className="font-mono text-[10px]">{endpoints.length}</Badge></CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="h-7 pl-7 text-xs" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0">
          <ScrollArea className="h-full">
            <ul className="divide-y">
              {filtered.map((ep) => (
                <li key={ep.method + ep.path}>
                  <button
                    onClick={() => pickEndpoint(ep)}
                    className={`w-full text-left px-3 py-2 hover:bg-accent/40 transition-colors
                      ${selected?.path === ep.path && selected.method === ep.method ? "bg-primary/15" : ""}`}
                  >
                    <div className="flex items-center gap-2 text-[11.5px] font-mono">
                      <Badge variant="outline" className={`text-[10px] px-1 py-0
                        ${ep.method === "GET" ? "text-success border-success/40" : "text-warning border-warning/40"}`}>
                        {ep.method}
                      </Badge>
                      <span className="truncate">{ep.path}</span>
                    </div>
                    {ep.description && (
                      <div className="text-[10.5px] text-muted-foreground mt-0.5 line-clamp-2">{ep.description}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Form + response */}
      <div className="flex flex-col gap-4 min-h-0">
        <Card>
          <CardHeader className="space-y-0 py-3">
            {selected ? (
              <>
                <CardTitle className="text-sm font-mono">
                  <Badge variant="outline" className={`text-[10px] mr-2
                    ${selected.method === "GET" ? "text-success border-success/40" : "text-warning border-warning/40"}`}>
                    {selected.method}
                  </Badge>
                  {selected.path}
                </CardTitle>
                {selected.description && (
                  <p className="text-[12px] text-muted-foreground mt-1">{selected.description}</p>
                )}
              </>
            ) : (
              <CardTitle className="text-sm text-muted-foreground">Pick an endpoint on the left</CardTitle>
            )}
          </CardHeader>
          {selected && (
            <CardContent className="space-y-2.5">
              {(selected.params ?? []).map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-[12px] font-mono">
                    {p.name}
                    {p.required && <span className="text-destructive">*</span>}
                  </label>
                  <Input
                    value={paramValues[p.name] ?? ""}
                    onChange={(e) => setParamValues((s) => ({ ...s, [p.name]: e.target.value }))}
                    placeholder={p.description ?? ""}
                    className="h-7 text-xs flex-1"
                  />
                  {p.source && (
                    <Badge variant="outline" className="text-[9px] uppercase">{p.source}</Badge>
                  )}
                </div>
              ))}
              <div className="flex justify-end pt-1">
                <Button size="sm" onClick={exec} disabled={running}>
                  {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  Send
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Response */}
        <Card className="flex-1 min-h-0 flex flex-col">
          <CardHeader className="flex-row items-center gap-2 space-y-0 py-3">
            <CardTitle className="text-sm">Response</CardTitle>
            {response && (
              <>
                <Badge variant={response.status >= 200 && response.status < 300 ? "success" : "destructive"} className="font-mono text-[10px]">
                  {response.status || "ERR"}
                </Badge>
                <span className="text-[11px] text-muted-foreground font-mono">{response.ms}ms</span>
              </>
            )}
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
            {response ? (
              <JsonView text={response.json} />
            ) : (
              <div className="text-sm text-muted-foreground p-6 text-center">No response yet.</div>
            )}
          </CardContent>
        </Card>

        {/* History */}
        {history.length > 0 && (
          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0 py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="size-3.5" /> History
                <Badge variant="secondary" className="font-mono text-[10px]">{history.length}</Badge>
              </CardTitle>
              <div className="flex-1" />
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={clearHistory}>
                <Trash2 className="size-3.5" />
              </Button>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-32">
                <ul className="divide-y">
                  {history.slice(0, 12).map((h, i) => (
                    <li key={i} className="px-1 py-1 text-[11px] font-mono text-muted-foreground flex items-center gap-2">
                      <span className="w-16">{new Date(h.ts).toLocaleTimeString()}</span>
                      <span className="flex-1 truncate">{h.endpoint}</span>
                      <Badge variant={h.status >= 200 && h.status < 300 ? "success" : "destructive"} className="font-mono text-[10px]">
                        {h.status}
                      </Badge>
                      <span className="w-12 text-right">{h.durationMs}ms</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
