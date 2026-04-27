import { useEffect, useMemo, useState } from "react";
import { Boxes, Cpu, ChevronRight, X, Layers, Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { DependencyGraph, type GraphLink, type GraphNode } from "@/components/DependencyGraph";
import { closeProgram, getPrograms, getServerUrl } from "@/lib/api";
import type { ProgramInfo } from "@/lib/types";

interface Props {
  serverUrl: string;
  programs: string[];
  onChanged: () => void;
  onOpen: (name: string) => void;
}

interface DepsGraphResponse {
  format?: string;
  nodes: { name: string; format?: string; functions?: number }[];
  edges: { from: string; to: string; import_count: number; resolved: boolean }[];
}

export function ProgramsPage({ serverUrl, programs, onChanged, onOpen }: Props) {
  const [details, setDetails] = useState<ProgramInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [closing, setClosing] = useState<string | null>(null);
  const [graph, setGraph] = useState<DepsGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showExternals, setShowExternals] = useState(false);

  // Fetch program details
  useEffect(() => {
    let alive = true;
    if (programs.length === 0) { setDetails([]); return; }
    getPrograms(serverUrl)
      .then((d) => alive && setDetails(d))
      .catch(() => alive && setDetails([]));
    return () => { alive = false; };
  }, [serverUrl, programs.join("|")]);

  // Fetch dependency graph
  useEffect(() => {
    let alive = true;
    if (programs.length === 0) { setGraph(null); return; }
    setGraphLoading(true);
    fetch(`${getServerUrl()}/deps/graph?format=json`)
      .then((r) => r.json())
      .then((j) => { if (alive) setGraph(j.data ?? null); })
      .catch(() => { if (alive) setGraph(null); })
      .finally(() => { if (alive) setGraphLoading(false); });
    return () => { alive = false; };
  }, [serverUrl, programs.join("|")]);

  const filtered = filter
    ? details.filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()))
    : details;

  const handleClose = async (name: string) => {
    setClosing(name);
    try { await closeProgram(name, serverUrl); onChanged(); }
    finally { setClosing(null); }
  };

  // Convert /deps/graph response → graph data for DependencyGraph.
  // By default we hide unresolved external libraries and edges that point to
  // them — Windows binaries pull in dozens of api-ms-win-* DLLs and the graph
  // becomes unreadable. Toggle showExternals to include them.
  const { graphNodes, graphLinks, externalCount } = useMemo(() => {
    if (!graph) {
      return { graphNodes: [] as GraphNode[], graphLinks: [] as GraphLink[], externalCount: 0 };
    }
    const programIds = new Set(graph.nodes.map((n) => n.name.toLowerCase()));
    const nodes: GraphNode[] = [];
    const seen = new Set<string>();

    for (const n of graph.nodes) {
      const cur = details.find((d) => d.name === n.name)?.is_current ?? false;
      nodes.push({
        id: n.name, label: n.name, kind: "program",
        format: n.format, functions: n.functions, is_current: cur,
      });
      seen.add(n.name.toLowerCase());
    }

    const links: GraphLink[] = [];
    let externalSeen = 0;
    for (const e of graph.edges) {
      const targetIsProgram = programIds.has(e.to.toLowerCase());
      if (!targetIsProgram) externalSeen++;
      if (!showExternals && !targetIsProgram) continue;

      if (!seen.has(e.to.toLowerCase()) && !targetIsProgram) {
        nodes.push({ id: e.to, label: e.to, kind: "external" });
        seen.add(e.to.toLowerCase());
      }
      links.push({
        source: e.from, target: e.to,
        weight: e.import_count ?? 1, resolved: e.resolved,
      });
    }
    return { graphNodes: nodes, graphLinks: links, externalCount: externalSeen };
  }, [graph, details, showExternals]);

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 p-4 overflow-hidden">
      {/* LEFT — programs list */}
      <Card className="flex flex-col min-h-0">
        <CardHeader className="flex-row items-center gap-2 space-y-0 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="size-4 text-primary" />
            Loaded programs
            <Badge variant="secondary" className="font-mono text-[10px]">{details.length}</Badge>
          </CardTitle>
          <div className="flex-1" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="h-7 w-40 text-xs"
          />
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0">
          {details.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center px-4">
              No programs loaded. Use the <strong>Dashboard</strong> to upload binaries.
            </div>
          ) : (
            <ScrollArea className="h-full">
              <ul className="divide-y">
                {filtered.map((p) => (
                  <li
                    key={p.name}
                    onMouseEnter={() => setHoveredId(p.name)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => { setSelectedId(p.name); onOpen(p.name); }}
                    className={`relative px-3 py-2 transition-colors cursor-pointer
                      ${(hoveredId === p.name || selectedId === p.name)
                        ? "bg-primary/15 border-l-2 border-primary"
                        : "border-l-2 border-transparent hover:bg-accent/40"}`}
                  >
                    <div className="flex items-center gap-2">
                      <Boxes className="size-3.5 text-primary shrink-0" />
                      <span className={`text-[13px] truncate flex-1 font-medium font-mono`}>{p.name}</span>
                      {p.is_current && <Badge className="font-mono text-[10px] h-5 px-1.5">current</Badge>}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); handleClose(p.name); }}
                            onKeyDown={(e) => e.key === "Enter" && handleClose(p.name)}
                            className="size-6 grid place-items-center text-muted-foreground hover:text-destructive rounded"
                            aria-label="Close program"
                            aria-disabled={closing === p.name}
                          >
                            <X className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Close program</TooltipContent>
                      </Tooltip>
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    </div>
                    <div className="text-[10.5px] text-muted-foreground mt-0.5 ml-5 flex flex-wrap items-center gap-1.5 font-mono">
                      <span className="inline-flex items-center gap-0.5"><Cpu className="size-3" />{p.language}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{p.format}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{p.functions} fns</span>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* RIGHT — dependency graph */}
      <Card className="flex flex-col min-h-0">
        <CardHeader className="flex-row items-center gap-2 space-y-0 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Network className="size-4 text-primary" />
            Dependency graph
            <Badge variant="secondary" className="font-mono text-[10px]">
              {graphNodes.length} nodes · {graphLinks.length} edges
            </Badge>
          </CardTitle>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showExternals}
              onChange={(e) => setShowExternals(e.target.checked)}
              className="accent-primary"
            />
            <span>Show externals</span>
            {externalCount > 0 && (
              <Badge variant="secondary" className="font-mono text-[9px] h-4 px-1">
                +{externalCount}
              </Badge>
            )}
          </label>
          <span className="text-[10.5px] text-muted-foreground ml-2">
            {hoveredId ? <>hovering <span className="font-mono text-foreground">{hoveredId}</span></> : "drag · scroll"}
          </span>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0 relative">
          <DependencyGraph
            nodes={graphNodes}
            links={graphLinks}
            loading={graphLoading}
            selectedId={hoveredId ?? selectedId}
            onNodeClick={(n) => { if (n.kind === "program") { setSelectedId(n.id); onOpen(n.id); } }}
            onNodeHover={(n) => setHoveredId(n?.id ?? null)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
