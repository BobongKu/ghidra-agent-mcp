import { useEffect, useMemo, useRef, useState } from "react";
// react-force-graph-2d expects ESM import; types are bundled.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — package ships its own d.ts, but resolution differs across setups
import ForceGraph2D from "react-force-graph-2d";
import { Loader2 } from "lucide-react";

export interface GraphNode {
  id: string;
  label: string;
  /** "program" = loaded, "external" = unresolved lib */
  kind: "program" | "external";
  format?: string;
  functions?: number;
  is_current?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  weight: number;
  resolved?: boolean;
}

interface Props {
  nodes: GraphNode[];
  links: GraphLink[];
  loading?: boolean;
  selectedId?: string | null;
  onNodeClick?: (n: GraphNode) => void;
  onNodeHover?: (n: GraphNode | null) => void;
}

/**
 * Obsidian-style force-directed dependency graph.
 *
 * Programs are filled circles in the primary colour; unresolved external
 * libraries are smaller, muted, with dashed outlines. Edge thickness scales
 * with import count.
 */
export function DependencyGraph({ nodes, links, loading, selectedId, onNodeClick, onNodeHover }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<unknown>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Theme colours read from CSS variables so the graph follows whatever palette
  // the rest of the GUI uses (currently red/black).
  const theme = useMemo(() => readTheme(), []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Memoise the data so react-force-graph doesn't reset positions on every render.
  const data = useMemo(() => ({ nodes: [...nodes], links: [...links] }), [nodes, links]);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-muted/20">
      {loading && (
        <div className="absolute inset-0 grid place-items-center z-10">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      )}
      {nodes.length === 0 && !loading && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          No programs loaded.
        </div>
      )}
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D
          ref={fgRef as never}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor="transparent"
          nodeRelSize={6}
          cooldownTicks={120}
          nodeLabel={(n: GraphNode) => `${n.label}${n.functions != null ? ` · ${n.functions} fns` : ""}`}
          nodeCanvasObjectMode={() => "after"}
          nodeCanvasObject={(node: GraphNode & { x?: number; y?: number }, ctx, globalScale) => {
            if (node.x == null || node.y == null) return;
            const isProgram = node.kind === "program";
            const isSelected = selectedId && node.id === selectedId;
            const r = isProgram ? 6 : 4;
            // Body
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = isSelected
              ? theme.primary
              : isProgram
                ? theme.primarySoft
                : theme.muted;
            ctx.fill();
            // Outline
            ctx.lineWidth = isSelected ? 2 / globalScale : 1 / globalScale;
            ctx.strokeStyle = isSelected ? theme.primary : isProgram ? theme.primary : theme.line;
            if (!isProgram) ctx.setLineDash([2 / globalScale, 2 / globalScale]);
            ctx.stroke();
            ctx.setLineDash([]);
            // Label
            const fontSize = Math.max(11 / globalScale, 4);
            ctx.font = `${fontSize}px sans-serif`;
            ctx.fillStyle = theme.text;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(node.label, node.x, node.y + r + 2 / globalScale);
          }}
          linkColor={(l: GraphLink) => l.resolved === false ? theme.line : theme.primarySoft}
          linkWidth={(l: GraphLink) => Math.min(0.5 + Math.log10(Math.max(1, l.weight)), 3)}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(n: GraphNode) => onNodeClick?.(n)}
          onNodeHover={(n: GraphNode | null) => onNodeHover?.(n)}
        />
      )}
    </div>
  );
}

function readTheme() {
  if (typeof window === "undefined") {
    return { primary: "#dc2626", primarySoft: "#7f1d1d", muted: "#3a3a3a", line: "#444", text: "#eee" };
  }
  const root = document.body;
  const s = getComputedStyle(root);
  const hsl = (v: string) => `hsl(${v})`;
  const safe = (v: string, fb: string) => v ? hsl(v) : fb;
  return {
    primary:     safe(s.getPropertyValue("--primary").trim(),     "#dc2626"),
    primarySoft: safe(s.getPropertyValue("--accent").trim(),      "#7f1d1d"),
    muted:       safe(s.getPropertyValue("--muted").trim(),       "#1c1c1c"),
    line:        safe(s.getPropertyValue("--border").trim(),      "#333"),
    text:        safe(s.getPropertyValue("--foreground").trim(),  "#eee"),
  };
}
