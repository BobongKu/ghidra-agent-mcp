import { useEffect, useMemo, useState } from "react";
import { Search as SearchIcon, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DeepLink {
  tab?: "functions" | "imports" | "strings" | "results";
  filter?: string;
  address?: string;
}

interface Props {
  serverUrl: string;
  onOpenProgram: (programName: string, deepLink?: DeepLink) => void;
}

type SearchType = "function" | "symbol" | "string";

interface FunctionResult {
  program: string;
  kind: "function" | "function-external";
  name: string;
  address?: string;
  library?: string;
}
interface SymbolResult {
  program: string;
  kind: "symbol";
  name: string;
  type: string;
  address: string;
  namespace: string;
}
interface StringResult {
  program: string;
  kind: "string";
  address: string;
  value: string;
}

type AnyResult = FunctionResult | SymbolResult | StringResult;

interface ApiResponse {
  query: string;
  type: SearchType;
  count: number;
  limit: number;
  has_more: boolean;
  case_sensitive: boolean;
  results: AnyResult[];
}

export function SearchPage({ serverUrl, onOpenProgram }: Props) {
  const [type, setType] = useState<SearchType>("function");
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const u = new URL(`${serverUrl}/search`);
      u.searchParams.set("q", query.trim());
      u.searchParams.set("type", type);
      u.searchParams.set("limit", "200");
      if (caseSensitive) u.searchParams.set("case", "true");
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.status === "error") throw new Error(j.message);
      setData(j.data);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  // Re-run when type or case-sensitivity flag changes (and we already have a query)
  useEffect(() => {
    if (data) runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, caseSensitive]);

  const grouped = useMemo(() => {
    if (!data) return new Map<string, AnyResult[]>();
    const m = new Map<string, AnyResult[]>();
    for (const r of data.results) {
      const k = r.program;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  }, [data]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 overflow-hidden">
      <Card>
        <CardHeader className="space-y-0 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <SearchIcon className="size-4 text-primary" />
            Cross-program search
            {data && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {data.count} results{data.has_more ? " (capped)" : ""}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Tabs value={type} onValueChange={(v) => setType(v as SearchType)}>
              <TabsList className="h-7">
                <TabsTrigger value="function" className="text-[11px] h-6 px-2.5">Function</TabsTrigger>
                <TabsTrigger value="symbol" className="text-[11px] h-6 px-2.5">Symbol</TabsTrigger>
                <TabsTrigger value="string" className="text-[11px] h-6 px-2.5">String</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative flex-1">
              <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder={
                  type === "function" ? "e.g. WriteFile, _o__, FUN_140012a40"
                    : type === "symbol" ? "e.g. main, _start, ?Class@std@@"
                    : "e.g. https://, error, %s "
                }
                className="h-7 pl-7 text-xs"
                autoFocus
              />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="accent-primary"
              />
              case
            </label>
            <Button size="sm" onClick={runSearch} disabled={loading || !query.trim()}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <SearchIcon className="size-3.5" />}
              Search
            </Button>
          </div>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="flex-1 min-h-0 flex flex-col">
        <CardContent className="flex-1 min-h-0 p-0">
          {!data && !loading && (
            <div className="text-sm text-muted-foreground p-8 text-center">
              Enter a query above. Search runs across every loaded program in one call.
            </div>
          )}
          {data && (
            <ScrollArea className="h-full">
              {grouped.size === 0 ? (
                <div className="text-sm text-muted-foreground p-8 text-center">No matches.</div>
              ) : (
                <div className="divide-y">
                  {Array.from(grouped.entries()).map(([prog, results]) => (
                    <details key={prog} open className="px-3 py-2">
                      <summary className="cursor-pointer flex items-center gap-2 text-[13px] mb-1">
                        <span className="font-mono">{prog}</span>
                        <Badge variant="secondary" className="font-mono text-[10px]">{results.length}</Badge>
                        <button
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onOpenProgram(prog); }}
                          className="ml-2 text-[10px] text-primary hover:underline"
                        >
                          open program →
                        </button>
                      </summary>
                      <ul className="ml-4 divide-y">
                        {results.map((r, i) => (
                          <ResultRow
                            key={`${prog}-${i}`}
                            r={r}
                            type={type}
                            query={query}
                            onClick={() => onOpenProgram(r.program, deepLinkFor(r, type, query))}
                          />
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              )}
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Map a search result row to a ProgramDetail deep-link payload.
 * - function (internal) → Functions tab, auto-decompile via address
 * - function (external) → Functions tab, filter by name
 * - symbol → Functions tab, filter by name (good first guess; many symbols ARE functions)
 * - string → Strings tab, filter by query
 */
function deepLinkFor(r: AnyResult, type: SearchType, query: string): DeepLink {
  if (type === "function") {
    const f = r as FunctionResult;
    if (f.kind === "function" && f.address) {
      return { tab: "functions", address: f.address, filter: f.name };
    }
    return { tab: "functions", filter: f.name };
  }
  if (type === "symbol") {
    const s = r as SymbolResult;
    return { tab: "functions", filter: s.name };
  }
  // string
  return { tab: "strings", filter: query };
}

function ResultRow({
  r, type, query, onClick,
}: {
  r: AnyResult;
  type: SearchType;
  query: string;
  onClick: () => void;
}) {
  void query;
  const baseClass = "flex items-center gap-2 px-1 py-1 hover:bg-accent/30 cursor-pointer transition-colors";
  if (type === "function") {
    const f = r as FunctionResult;
    const isExternal = f.kind === "function-external";
    return (
      <li className={baseClass} onClick={onClick} title="Open in program detail">
        <Badge variant={isExternal ? "warning" : "outline"} className="font-mono text-[10px]">
          {isExternal ? "ext" : "fn"}
        </Badge>
        <span className="font-mono text-[12.5px] flex-1 truncate text-warning">{f.name}</span>
        {f.library && <span className="font-mono text-[10.5px] text-muted-foreground">{f.library}</span>}
        {f.address && <span className="font-mono text-[10.5px] text-muted-foreground/70">{f.address}</span>}
      </li>
    );
  }
  if (type === "symbol") {
    const s = r as SymbolResult;
    return (
      <li className={baseClass} onClick={onClick} title="Open in program detail">
        <Badge variant="outline" className="font-mono text-[10px]">{s.type}</Badge>
        <span className="font-mono text-[12.5px] flex-1 truncate">{s.name}</span>
        {s.namespace && s.namespace !== "Global" && <span className="font-mono text-[10.5px] text-muted-foreground">{s.namespace}</span>}
        <span className="font-mono text-[10.5px] text-muted-foreground/70">{s.address}</span>
      </li>
    );
  }
  // string
  const s = r as StringResult;
  return (
    <li className={`${baseClass} items-start`} onClick={onClick} title="Open in program detail">
      <span className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0 pt-0.5">{s.address}</span>
      <span className="font-mono text-[12px] text-success break-all">{s.value}</span>
    </li>
  );
}
