import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  text: string;
  raw?: boolean;
}

export function JsonView({ text, raw }: Props) {
  const { pretty, isJson } = useMemo(() => {
    if (raw) return { pretty: text, isJson: false };
    const trimmed = text.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
      return { pretty: text, isJson: false };
    }
    try {
      const parsed = JSON.parse(trimmed);
      return { pretty: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      return { pretty: text, isJson: false };
    }
  }, [text, raw]);

  const lines = useMemo(() => pretty.split("\n"), [pretty]);
  const [wrap, setWrap] = useState(false);

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b text-[11px] text-muted-foreground bg-card">
        <Badge variant={isJson ? "info" : "outline"} className="font-mono text-[10px]">
          {isJson ? "JSON" : "TEXT"}
        </Badge>
        <span className="font-mono">{lines.length.toLocaleString()} lines · {pretty.length.toLocaleString()} chars</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => setWrap(e.target.checked)}
            className="accent-primary"
          />
          wrap
        </label>
      </div>
      <ScrollArea className="flex-1">
        <table className="w-full border-collapse font-mono text-[12px] leading-[1.55]">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="align-top">
                <td className="select-none text-right text-muted-foreground/60 pr-3 pl-3 py-0
                               sticky left-0 bg-muted/30 border-r border-border/60
                               w-[1%] whitespace-nowrap">
                  {i + 1}
                </td>
                <td className={`pl-3 pr-4 py-0 ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}>
                  {isJson ? <Highlighted line={line} /> : line || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function Highlighted({ line }: { line: string }) {
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = -1;
  while (i < line.length) {
    const ch = line[i];
    if (ch === " " || ch === "\t") {
      let j = i;
      while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
      out.push(line.slice(i, j));
      i = j; continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") { j += 2; continue; }
        if (line[j] === '"') { j++; break; }
        j++;
      }
      const tok = line.slice(i, j);
      let k = j;
      while (k < line.length && (line[k] === " " || line[k] === "\t")) k++;
      const isKey = line[k] === ":";
      out.push(
        <span key={key++} className={isKey ? "text-code-key" : "text-code-string"}>
          {tok}
        </span>
      );
      i = j; continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === "-") {
      let j = i + 1;
      while (j < line.length && /[0-9eE+\-.]/.test(line[j])) j++;
      out.push(<span key={key++} className="text-code-number">{line.slice(i, j)}</span>);
      i = j; continue;
    }
    if (ch === "t" || ch === "f" || ch === "n") {
      const rest = line.slice(i);
      const m = /^(true|false|null)\b/.exec(rest);
      if (m) {
        out.push(<span key={key++} className="text-code-keyword">{m[0]}</span>);
        i += m[0].length; continue;
      }
    }
    if (ch === "{" || ch === "}" || ch === "[" || ch === "]" || ch === "," || ch === ":") {
      out.push(<span key={key++} className="text-muted-foreground/60">{ch}</span>);
      i++; continue;
    }
    out.push(ch);
    i++;
  }
  if (out.length === 0) return <>{" "}</>;
  return <>{out}</>;
}
